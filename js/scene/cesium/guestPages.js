/**
 * Cesium's bodies on guest pages of their own (?cesium=iframe;
 * design/CesiumGuest.md): for each, an iframe on the guest page's origin, a
 * NetGL receiver for its frames, the views posted to it and the frames held
 * for its (lockstep), its night lights' part, its messages (the status, the
 * heights asked for), and the round trips' timing.  CesiumLayers loads this
 * on its first guest page (_load), so none of it is in the first load
 * (esbuild/budget.js); it composites the frames as its own.  It imports
 * nothing: what it needs of the first load's modules comes through the
 * layers, or esbuild would split them into chunks shared with this one and
 * the first load would grow.
 */
export default class GuestPages {
  /** @param {object} layers The CesiumLayers */
  constructor(layers) {
    this.layers = layers
    // The last view's id, over every guest page.
    this._viewId = 0
    // The last GUEST_STATS_N frames' waits for a guest's (noteWait).
    this._waits = []
    // requestGroundHeight's last request.
    this._heightId = 0
  }


  /**
   * Before a body's guest page's frames are drained in _compositeBody,
   * where the page renders its own Cesium.  Its night lights' part, when
   * one may come in this drain (asked for this frame, or in the last frame,
   * which a re-run replays), goes to a target of its own
   * (CesiumLayers._replayConfig, beforeFrame), readied here.
   *
   * @param {object} body
   * @param {boolean} unseen The body's shell wasn't drawn: nothing shows
   */
  beforeDrain(body, unseen) {
    body.drainedLights = false
    body.lightsReady = !unseen && (body.postedLights || body.lastLights) === true
    if (body.lightsReady) {
      this._prepareLights(this.layers._cesiumTarget())
    }
  }


  /**
   * After the drain: what it had, and whether it was in step, this frame
   * drawn with the guest's frame of this frame's view.
   *
   * @param {object} body
   */
  afterDrain(body) {
    body.lastLights = body.drainedLights
    body.steps.drawn++
    if (body.receiver.drainedViews.at(-1) === body.posted) {
      body.steps.inStep++
    }
  }


  /**
   * Add a body's night lights' part, drained with its day frame, into the
   * scene's render, as the page's own (CesiumLayers._drawNightLights).
   *
   * @param {object} sceneRT
   * @param {object} body
   * @param {object} node The body's node
   */
  drawLights(sceneRT, body, node) {
    if (body.drainedLights && body.lightsReady) {
      this.layers._decodeLights(sceneRT, this.lightsTarget(), node)
    }
  }


  /**
   * The body's Cesium on a page of its own (design/CesiumGuest.md): an
   * iframe on the guest page's origin, a NetGL receiver for its frames,
   * and its status by message.  Ready once the guest's handshake is in.
   *
   * @param {string} name
   */
  async load(name) {
    const L = this.layers
    L.bodies[name] = {status: 'loading'}
    L._publishStatus(name, 'loading')
    let netgl
    try {
      netgl = await import('@pablo-mayrgundter/portal-netgl/core')
    } catch (err) {
      L._fail(name, err)
      return
    }
    const page = L._guestPageUrl(name)
    const iframe = document.createElement('iframe')
    // Laid out at the frame's size, but not seen: the guest's Cesium sizes
    // its canvas from its page (display: none would give it none).
    Object.assign(iframe.style, {
      position: 'fixed', left: '0', top: '0', border: '0', visibility: 'hidden', pointerEvents: 'none', zIndex: '-1',
      width: `${L.ui.width}px`, height: `${L.ui.height}px`,
    })
    iframe.src = page.href
    document.body.appendChild(iframe)
    const body = {
      status: 'loading', remote: true, name, iframe, frames: 0, tilesLoaded: false, groundHeight: null,
      waiting: null, posted: null, postedAt: 0, holdUntil: 0, size: null, credits: L._creditsFor(),
      // Frames drawn, those in step with their view, and the guest's
      // round trips (a view posted to its frame in), for design/CesiumGuest.md.
      steps: {drawn: 0, inStep: 0, trips: 0, tripMs: 0},
      // The last GUEST_STATS_N round trips, split (_splitTrip; stats).
      trips: [], trip: null, origin: page.origin,
      // The night lights (_drawNightLights): the guest has them (its
      // status), the receiver routes parts, and this frame's and the last
      // drain's.
      night: false, parts: false, part: null, postedLights: false, lastLights: false, drainedLights: false,
      lightsReady: false,
    }
    L.bodies[name] = body
    const own = () => L.bodies[name] === body
    const {renderer} = L.ui
    body.receiver = netgl.makeNetGLHostReceiver({
      gl: renderer.getContext(),
      // Pinned to the guest page's origin: the receiver may hand it a port.
      transport: netgl.iframeTransport(iframe, {origin: page.origin}),
      wire: 2,
      replay: L._replayConfig(() => body.size, body),
      // Each part to its target (_replayConfig): the day frame to
      // _cesiumRT, the lights to _lightsRT.  Called only from 0.6.8 on,
      // which is how the lights know they can be asked for.
      beforeFrame: (end) => this._onPart(body, end),
      onReady: () => {
        if (own() && body.status === 'loading') {
          body.status = 'ready'
          L._publishStatus(name, 'ready')
        }
      },
      onControl: (msg) => own() && this._onMessage(name, body, msg),
      onError: (err) => console.warn('[cesium layer] replay error:', err),
    })
    body.receiver.onFrame((end) => own() && this._onFrame(body, end))
  }


  /**
   * Send this frame's view to each body drawn by a guest page, one view in
   * flight a body: the frame then waits for the guest's frame of it
   * (awaiting).  A body whose last view is still out gets none, and
   * its last frame is drawn again.
   *
   * @param {Array<{name: string, node: object}>} drawn This frame's active and warming bodies
   */
  postViews(drawn) {
    const L = this.layers
    const remote = drawn.filter(({name}) => L.bodies[name]?.remote && L.bodies[name].status === 'ready' &&
      L.bodies[name].waiting === null)
    if (remote.length === 0) {
      return
    }
    // The bodies' matrices as the render will have them.
    L.ui.scene?.updateMatrixWorld?.()
    for (const {name, node} of remote) {
      const body = L.bodies[name]
      const view = L._guestViewOf(name, node)
      const [width, height] = view.size
      if (body.iframe.style.width !== `${width}px` || body.iframe.style.height !== `${height}px`) {
        body.iframe.style.width = `${width}px`
        body.iframe.style.height = `${height}px`
      }
      body.heightM = view.heightM
      body.distanceScale = view.distanceScale
      body.size = view.size
      // Its night lights too, as a second part of the frame, where they can
      // show: when the guest has them (its status's `night`) and the
      // receiver routes parts (portal-netgl 0.6.8's beforeFrame, seen
      // called).
      body.nightInView = body.parts === true && L._nightInView(body, name, node, view)
      body.postedLights = L._lightsShow(body)
      const viewId = ++this._viewId
      body.waiting = viewId
      body.posted = viewId
      body.postedAt = performance.now()
      body.holdUntil = body.postedAt + L.guestWaitMs
      // New York, drawn by the guest page's Cesium: the switch.
      const nyc = name === 'earth' ? L.newYork.enabled : undefined
      body.receiver.post({type: 'cesium:view', viewId, view, lights: body.postedLights, nyc})
    }
  }


  /**
   * @returns {boolean} Whether this frame waits for a guest page's frame of
   *   its view (ThreeUi.renderLoop): one is in flight, and not for longer
   *   than guestWaitMs
   */
  awaiting() {
    const now = performance.now()
    for (const body of Object.values(this.layers.bodies)) {
      if (body.remote && body.waiting !== null && now < body.holdUntil) {
        return true
      }
    }
    return false
  }


  /**
   * A guest page's frame is in (the receiver's onFrame): when it's its
   * view's last part (the lights, when they were asked for), the view has
   * landed, and a frame held for it is drawn.
   *
   * @param {object} body
   * @param {object} end Its frame-end
   */
  _onFrame(body, end) {
    if ((end.part === 'lights') !== (body.postedLights === true)) {
      return
    }
    body.frames++
    if (end.viewId === undefined || end.viewId === body.waiting) {
      const landed = performance.now()
      body.steps.trips++
      body.steps.tripMs += landed - body.postedAt
      // Split when the frame's status (its timing) follows it in.
      body.trip = {viewId: body.waiting, postedAt: body.postedAt, landed}
      body.waiting = null
      this.layers.ui.resumeFrame?.()
    }
  }


  /**
   * Before each of a guest page's frames replays (the receiver's
   * beforeFrame, portal-netgl 0.6.8): which part it is, so _replayConfig
   * sends it to its target.  Its being called at all says the receiver
   * routes parts, and so that the lights can be asked for.
   *
   * @param {object} body
   * @param {object} end Its frame-end
   */
  _onPart(body, end) {
    body.parts = true
    body.part = end.part ?? null
    if (end.part === 'lights') {
      body.drainedLights = true
    }
  }


  /**
   * A guest page's own messages: its status after each frame, or its
   * failure.
   *
   * @param {string} name
   * @param {object} body
   * @param {object} msg
   */
  _onMessage(name, body, msg) {
    if (msg?.type === 'cesium:status') {
      this._splitTrip(body, msg)
      body.tilesLoaded = msg.tilesLoaded === true
      body.groundHeight = Number.isFinite(msg.groundHeight) ? msg.groundHeight : null
      // Its night lights' layer, and that their frame works.
      body.night = msg.night === true
      // Its city's state, for the layers control (_publishNewYork); none
      // while the switch is off here, until the guest has freed it.
      if (name === 'earth' && 'newYork' in msg) {
        this.layers._newYork = msg.newYork && this.layers.newYork.enabled ? {status: msg.newYork, remote: true} : null
      }
      if (msg.credits) {
        this.layers._showGuestCredits(body, msg.credits)
      }
    } else if (msg?.type === 'cesium:height') {
      // The answer to a requestGroundHeight.
      const answer = body.heights?.get(msg.id)
      if (answer) {
        body.heights.delete(msg.id)
        answer(Number.isFinite(msg.height) ? msg.height : null)
      }
    } else if (msg?.type === 'cesium:error') {
      this.layers._fail(name, new Error(`the Cesium guest page failed: ${String(msg.message).slice(0, 300)}`))
    }
  }


  /**
   * Split a guest frame's round trip by the timing its status carries: the
   * view's way to the guest, the guest's frame, and the frame's way back.
   * Wall-clock times on both sides (timeOrigin + now: one clock in one
   * browser).
   *
   * @param {object} body
   * @param {object} msg A `cesium:status`
   */
  _splitTrip(body, msg) {
    const {trip} = body
    const t = msg.timing
    if (!trip || msg.viewId !== trip.viewId || !Number.isFinite(t?.receivedAt) || !Number.isFinite(t?.renderMs)) {
      return
    }
    body.trip = null
    const origin = performance.timeOrigin
    const toGuestMs = t.receivedAt - (origin + trip.postedAt)
    const backMs = (origin + trip.landed) - (t.receivedAt + t.renderMs)
    body.trips.push({tripMs: trip.landed - trip.postedAt, toGuestMs, guestMs: t.renderMs, backMs})
    if (body.trips.length > GUEST_STATS_N) {
      body.trips.shift()
    }
  }


  /**
   * Note how long a frame waited for its guests' (ThreeUi._drawFrame).
   *
   * @param {number} ms
   */
  noteWait(ms) {
    this._waits.push(ms)
    if (this._waits.length > GUEST_STATS_N) {
      this._waits.shift()
    }
  }


  /**
   * The guest pages' timing for ?perf=1's snapshot (perf.js): per body, over
   * the last GUEST_STATS_N round trips, the trip, the view's way in, the
   * guest's frame and the way back, mean and p95; and the frames' waits.
   *
   * @returns {Array<object>} Empty with no guest page
   */
  stats() {
    const stat = (xs) => {
      if (xs.length === 0) {
        return null
      }
      const sorted = [...xs].sort((a, b) => a - b)
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length
      return {mean: +mean.toFixed(2), p95: +sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))].toFixed(2)}
    }
    return Object.entries(this.layers.bodies).filter(([, b]) => b.remote).map(([name, b]) => ({
      name,
      origin: b.origin,
      frames: b.frames,
      inStep: b.steps.drawn ? +(b.steps.inStep / b.steps.drawn).toFixed(3) : null,
      n: b.trips.length,
      tripMs: stat(b.trips.map((x) => x.tripMs)),
      toGuestMs: stat(b.trips.map((x) => x.toGuestMs)),
      guestMs: stat(b.trips.map((x) => x.guestMs)),
      backMs: stat(b.trips.map((x) => x.backMs)),
      waitMs: stat(this._waits),
    }))
  }


  /**
   * The terrain's height at a place, from a guest page: groundHeightAt's
   * answer for a body whose Cesium is on one, which it gives by message.
   * Null, at once, where no active body is on a guest page, and after
   * GROUND_REPLY_MS without an answer.
   *
   * @param {object} node A body's rotating node
   * @param {number} lat Degrees
   * @param {number} lng Degrees, east-positive
   * @returns {Promise<number|null>} Metres over the sphere, as groundHeightAt
   */
  requestGroundHeight(node, lat, lng) {
    const a = this.layers.active.find((x) => x.node === node)
    const body = a && this.layers.bodies[a.name]
    if (!body?.remote || body.status !== 'ready') {
      return Promise.resolve(null)
    }
    const id = ++this._heightId
    body.heights ??= new Map()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        body.heights.delete(id)
        resolve(null)
      }, GROUND_REPLY_MS)
      body.heights.set(id, (height) => {
        clearTimeout(timer)
        resolve(height)
      })
      body.receiver.post({type: 'cesium:height', id, lat, lng, radius: node.props.radius.scalar})
    })
  }


  /**
   * A guest page's night lights' target (_drawNightLights): as _cesiumRT,
   * its size, its depth and stencil.
   *
   * @returns {object}
   */
  lightsTarget() {
    return this.layers._cesiumTarget('_lightsRT')
  }


  /**
   * Ready the lights' target for a guest page's lights part, as the page
   * readies _cesiumRT for its own (_drawNightLights): cleared to
   * transparent, with the shell's stencil (drawn into _cesiumRT this frame)
   * and the depth.  _cesiumRT stays bound.
   *
   * @param {object} cesiumRT
   */
  _prepareLights(cesiumRT) {
    const {renderer} = this.layers.ui
    const lightsRT = this.lightsTarget()
    this.layers._blitDepth(cesiumRT, lightsRT, true)
    renderer.setRenderTarget(lightsRT)
    renderer.getClearColor(this.layers._clearColor)
    const clearAlpha = renderer.getClearAlpha()
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, false, false)
    renderer.setClearColor(this.layers._clearColor, clearAlpha)
    renderer.setRenderTarget(cesiumRT)
  }
}


// How many round trips, and waits, stats summarises.
const GUEST_STATS_N = 240
// How long requestGroundHeight waits for a guest page's answer, ms.
const GROUND_REPLY_MS = 1000
