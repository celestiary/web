import fs from 'node:fs'
import {describe, expect, it} from 'bun:test'
import {Matrix4, Object3D, PerspectiveCamera, Vector3} from 'three'
import {eciToEcf, gstime, json2satrec, propagate} from 'satellite.js'
import OrbitsLayer from './OrbitsLayer.js'
import {DEFAULT_SUBSCRIPTION, anchorMatcher, compileSubscription, dishAnchor,
  naifAnchor, satelliteAnchor, siteAnchor, spacecraftAnchor} from './anchors.js'
import {bodyFixedToEcef, equatorToEcef} from './frames.js'
import {hostOrigin, isAllowedOrigin} from './origins.js'
import {HELLO_RESEND_MS, serveLayer} from './protocol.js'
import {callsIn, meteredTransport, payloadBytes} from './wire.js'
import {gmstRad} from '../scene/celestialFrame.js'
import {latLngAltToBodyFixed} from '../coords.js'
import {unixMsToJd} from '../scene/satellites/sgp4.js'


// Layer mode (design/LayerMode.md): the frames, the anchors' ids, the
// origins, the control plane, and the layer's scene against satellite.js's
// own ECI to ECF.


const PUBLIC = new URL('../../public/', import.meta.url)
const fromDisk = (url) => Promise.resolve(fs.existsSync(new URL(url, PUBLIC)) ?
  {ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(new URL(url, PUBLIC), 'utf8')))} :
  {ok: false, status: 404})
// Within the snapshot's elements' windows.
const T = Date.parse('2026-10-23T20:17:00Z')


describe('layer mode frames', () => {
  it('turns the equator frame to ECEF as Animation turns Earth', () => {
    const g = 1.234
    const earth = new Object3D()
    earth.setRotationFromAxisAngle(new Vector3(0, 1, 0), g)
    // A place on Earth: body-fixed, turned into the equator frame, then to ECEF.
    const body = latLngAltToBodyFixed(40.24, -4.25, 0, 6378137)
    const eq = body.clone().applyQuaternion(earth.quaternion)
    const viaLayer = eq.applyMatrix4(equatorToEcef(g, new Matrix4))
    expect(viaLayer.distanceTo(new Vector3(...bodyFixedToEcef(body)))).toBeLessThan(1e-6)
    // And ECEF's axes: Greenwich on the equator is +X, 90°E +Y, the pole +Z.
    expect(bodyFixedToEcef(latLngAltToBodyFixed(0, 90, 0, 1)).map((x) => Math.round(x))).toEqual([0, 1, 0])
    expect(bodyFixedToEcef(latLngAltToBodyFixed(90, 0, 0, 1)).map((x) => Math.round(x))).toEqual([0, 0, 1])
  })
})


describe('layer mode anchors', () => {
  it('names things with portal RFC 0001\'s ids (§8.2)', () => {
    expect(satelliteAnchor(25544)).toBe('norad:25544')
    expect(dishAnchor('DSS43')).toBe('dsn:DSS-43')
    expect(siteAnchor('gdscc')).toBe('dsn:GDSCC')
    expect(spacecraftAnchor('vgr1')).toBe('dsn-sc:VGR1')
    expect(naifAnchor(-31)).toBe('naif:-31')
    expect(naifAnchor(NaN)).toBeNull()
    // Nothing flows until a host subscribes (§8.1).
    expect(DEFAULT_SUBSCRIPTION).toEqual([])
  })

  it('matches a subscription', () => {
    const m = anchorMatcher(['norad:25544', 'dsn:*'])
    expect([m('norad:25544'), m('norad:1'), m('dsn:DSS-43'), m('dsn:GDSCC'), m('dsn-sc:VGR1')]).toEqual([true, false, true, true, false])
    expect(anchorMatcher(['*'])('anything')).toBe(true)
  })

  it('compiles a subscription by scheme, so whole schemes can be skipped', () => {
    const sub = compileSubscription(['norad:25544', 'dsn:*', {near: {p: [1, 2, 3], n: 5}, pattern: 'norad:*'}, {near: {p: [1]}}])
    expect([sub.wantsScheme('norad'), sub.whole('norad'), sub.wantsScheme('dsn'), sub.whole('dsn'), sub.wantsScheme('dsn-sc')])
        .toEqual([true, false, true, true, false])
    expect([...sub.exact.get('norad')]).toEqual(['norad:25544'])
    // A malformed near is dropped; a good one keeps its own pattern.
    expect(sub.near.length).toBe(1)
    expect(sub.near[0].n).toBe(5)
    expect(sub.near[0].match.whole('norad')).toBe(true)
    expect(sub.near[0].match.wantsScheme('dsn')).toBe(false)
  })
})


describe('layer mode origins', () => {
  it('allows the listed hosts and localhost on any port, nothing else', () => {
    expect(isAllowedOrigin('https://pablo-mayrgundter.github.io')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:5481')).toBe(true)
    expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false)
    expect(isAllowedOrigin('http://localhost:80x')).toBe(false)
    expect(isAllowedOrigin('https://pablo-mayrgundter.github.io.evil.com')).toBe(false)
    expect(isAllowedOrigin('null')).toBe(false)
  })

  it('takes the host from ancestorOrigins, the referrer or ?host=, in that order, if allowed', () => {
    expect(hostOrigin({search: '?host=http://localhost:5481'})).toBe('http://localhost:5481')
    expect(hostOrigin({search: '', referrer: 'https://pablo-mayrgundter.github.io/netmap/?x'})).toBe('https://pablo-mayrgundter.github.io')
    expect(hostOrigin({search: '?host=http://localhost:1', ancestors: ['http://localhost:5490'], referrer: 'http://localhost:2/'}))
        .toBe('http://localhost:5490')
    expect(hostOrigin({search: '?host=https://evil.com', referrer: 'https://evil.com/', ancestors: ['https://evil.com']})).toBeNull()
  })
})


describe('layer mode control plane', () => {
  /** @returns {object} a fake transport, layer and timers */
  function rig() {
    const posted = []
    let listener = null
    const interval = {fn: null, cleared: false}
    const calls = []
    const layer = {
      subscribed: false,
      applyView: (v, viewId) => calls.push(['view', viewId, v.timeMs, v.earth?.radius]),
      anchors: () => [{id: 'dsn:DSS-43', p: [1, 2, 3]}],
      subscribe: (p) => {
        layer.subscribed = p.length > 0
        calls.push(['subscribe', p])
      },
      dispose: () => calls.push(['dispose']),
    }
    let resolve
    const loaded = new Promise((r) => (resolve = r))
    const clock = {ms: 1000}
    const served = serveLayer({
      transport: {post: (m) => posted.push(m), onMessage: (f) => {
        listener = f
        return () => (listener = null)
      }},
      layer, loaded, nowMs: () => clock.ms, clock: () => clock.ms,
      meter: {take: () => ({calls: 10, messages: 12, bytes: 4096, postMs: 0.5})},
      render: () => calls.push(['render']), endFrame: () => calls.push(['frame-end']),
      announce: () => calls.push(['announce']),
      timers: {setInterval: (fn) => (interval.fn = fn), clearInterval: () => (interval.cleared = true)},
    })
    return {posted, send: (m) => listener?.(m), interval, calls, resolve, served, clock, layer}
  }

  // portal-netgl 0.4.0's NetGLLayerViewMessage (layer-view.ts), as its
  // deck.gl host (attachNetGLDeckLayer) sends it.
  const viewMsg = (viewId, timeMs = T) => ({type: 'layer:view', viewId, view: {
    frame: 'ecef', viewMatrix: [], projectionMatrix: [], viewport: [0, 0, 640, 400], pixelRatio: 1, timeMs,
    earth: {model: 'sphere', radius: 6370972},
  }})

  it('sends its frames\' costs about once a second, only when asked', async () => {
    const r = rig()
    r.resolve([])
    await new Promise((res) => setTimeout(res, 0))
    const stats = () => r.posted.filter((m) => m.type === 'layer:stats')
    r.send(viewMsg(1))
    expect(r.served.state.last).toMatchObject({calls: 10, messages: 12, bytes: 4096, recordMs: 0.5})
    expect(stats()).toHaveLength(0)
    r.send({type: 'layer:stats-subscribe', intervalMs: 1000})
    for (let k = 0; k < 5; k++) {
      r.clock.ms += 300
      r.send(viewMsg(2 + k))
    }
    // 1500 ms of frames: one report, of the frames up to the second.
    expect(stats()).toHaveLength(1)
    expect(stats()[0]).toMatchObject({frames: 4, calls: 10, bytes: 4096, recordMs: 0.5})
    r.send({type: 'layer:stats-subscribe', enabled: false})
    r.clock.ms += 5000
    r.send(viewMsg(9))
    expect(stats()).toHaveLength(1)
  })

  it('announces itself both ways, until the host is heard from', () => {
    const r = rig()
    // NetGL's handshake, which 0.4.0's host waits on before its first view.
    expect(r.calls[0]).toEqual(['announce'])
    expect(r.posted[0]).toMatchObject({type: 'layer:hello', version: 1, adapter: 'celestiary-orbits',
      capabilities: {depth: ['shared'], frames: ['ecef'], anchors: true}, contracts: {alpha: 'coverage', color: 'display'}})
    expect(r.posted[0].contracts.depth).toBeUndefined()
    expect(r.posted[0].extent.sphere.radius).toBeGreaterThan(4.2e7)
    // Nearest anchors are offered, so a host may ask for them.
    expect(r.posted[0].ext['portal.anchors/1']).toEqual({publish: ['norad', 'dsn', 'dsn-sc', 'naif'], near: true})
    r.interval.fn()
    expect(r.posted.filter((m) => m.type === 'layer:hello')).toHaveLength(2)
    // NetGL's ack is the other handshake's: hello goes on until its own.
    r.send({type: 'netgl:ready-ack'})
    r.interval.fn()
    expect(r.interval.cleared).toBe(false)
    r.send({type: 'layer:hello-ack', accepted: true})
    r.interval.fn()
    expect(r.interval.cleared).toBe(true)
    expect(HELLO_RESEND_MS).toBeLessThanOrEqual(1000)
  })

  it('draws each view, from its envelope, ending in frame-end, and no anchors until subscribed', async () => {
    const r = rig()
    // A view before the data is in: drawn once it is.
    r.send(viewMsg(7))
    expect(r.calls).toEqual([['announce']])
    r.resolve([])
    await new Promise((res) => setTimeout(res, 0))
    expect(r.calls.slice(1)).toEqual([['view', 7, T, 6370972], ['render'], ['frame-end']])
    expect(r.posted.some((m) => m.type === 'layer:anchors')).toBe(false)
    expect(r.posted.some((m) => m.type === 'layer:status' && m.status === 'ready')).toBe(true)
    r.send({type: 'layer:anchors-subscribe', patterns: ['dsn:*']})
    r.send(viewMsg(8))
    expect(r.posted[r.posted.length - 1])
        .toEqual({type: 'layer:anchors', viewId: 8, timeMs: T, anchors: [{id: 'dsn:DSS-43', p: [1, 2, 3]}]})
    // A subscription changes what's drawn: the host is asked for a frame.
    expect(r.posted.some((m) => m.type === 'layer:invalidate' && m.reason === 'anchors subscribed')).toBe(true)
    // A flat view (#296's first shape) isn't one.
    r.send({type: 'layer:view', viewId: 9, viewMatrix: [], timeMs: T})
    expect(r.calls.filter((c) => c[0] === 'view')).toHaveLength(2)
  })

  it('asks for a frame when its content changes with no new view', async () => {
    const r = rig()
    r.resolve([])
    await new Promise((res) => setTimeout(res, 0))
    // Loaded, with no view waiting: the host's still view needs drawing again.
    expect(r.posted.filter((m) => m.type === 'layer:invalidate').map((m) => m.reason)).toEqual(['loaded'])
    // The layer's own changes (the DSN's feed), through its hook.
    r.served.state.ready = true
    const layerHook = r.layer.onInvalidate
    layerHook('dsn feed')
    expect(r.posted[r.posted.length - 1]).toEqual({type: 'layer:invalidate', reason: 'dsn feed'})
  })

  it('takes the host\'s clock for views without a time, and stops when hidden or disposed', async () => {
    const r = rig()
    r.resolve([])
    await new Promise((res) => setTimeout(res, 0))
    r.send({type: 'layer:time', timeMs: T, rate: 60})
    r.clock.ms += 1000
    const msg = viewMsg(1)
    delete msg.view.timeMs
    r.send(msg)
    expect(r.calls[1]).toEqual(['view', 1, T + 60000, 6370972])
    r.send({type: 'layer:anchors-subscribe', patterns: ['norad:*']})
    expect(r.calls).toContainEqual(['subscribe', ['norad:*']])
    r.send({type: 'layer:visibility', state: 'hidden'})
    r.send(viewMsg(2))
    expect(r.calls.filter((c) => c[0] === 'view')).toHaveLength(1)
    r.send({type: 'layer:dispose'})
    expect(r.calls).toContainEqual(['dispose'])
  })
})


describe('layer mode wire', () => {
  const env = (arr) => ({__netgl_typedarray: arr.constructor.name, buffer: arr.buffer, offset: arr.byteOffset, length: arr.length})

  it('meters what goes out, a frame at a time: wire 1\'s calls and wire 2\'s batches', () => {
    const sent = []
    const m = meteredTransport({post: (msg) => sent.push(msg), onMessage: () => () => {}}, {clock: () => 0})
    m.transport.post({name: 'bufferSubData', args: [34962, 0, env(new Float32Array(10))]})
    m.transport.post({type: 'netgl:frame-end'})
    const t = m.take()
    expect([t.calls, t.messages]).toEqual([1, 2])
    expect(t.bytes).toBe(payloadBytes(sent[0]) + payloadBytes(sent[1]))
    expect(m.take().messages).toBe(0)
    const batch = {type: 'netgl:batch', batch: [{name: 'enable', args: [2929]}, {name: 'drawArrays', args: [0, 0, 3]},
      {type: 'netgl:frame-end'}]}
    expect(callsIn(batch)).toBe(2)
    m.transport.post(batch)
    expect(m.take()).toMatchObject({calls: 2, messages: 1})
  })

  it('meters the port a wire-2 host hands over, as the guest context sees the ack', () => {
    let deliver = null
    const m = meteredTransport({post: () => {}, onMessage: (fn) => {
      deliver = fn
      return () => {}
    }}, {clock: () => 0})
    const onPort = []
    const port = {postMessage: (msg, transfer) => onPort.push([msg, transfer])}
    const heard = []
    m.transport.onMessage((msg) => {
      heard.push(msg.type)
      // What portal-netgl's guest context does with the ack's port.
      msg.port?.postMessage({type: 'netgl:port', seq: 0, after: 3})
    })
    deliver({type: 'netgl:ready-ack', wire: 2, port})
    expect(heard).toEqual(['netgl:ready-ack'])
    port.postMessage({type: 'netgl:batch', batch: [{name: 'drawArrays', args: [0, 0, 3]}, {type: 'netgl:frame-end'}]})
    expect(onPort.map(([msg]) => msg.type)).toEqual(['netgl:port', 'netgl:batch'])
    expect(onPort[1][1]).toEqual([])
    expect(m.take()).toMatchObject({calls: 1, messages: 2})
    // A repeated ack doesn't wrap it twice.
    deliver({type: 'netgl:ready-ack', wire: 2, port})
    m.take()
    port.postMessage({type: 'layer:anchors', anchors: []})
    expect(m.take().messages).toBe(1)
  })
})


describe('OrbitsLayer', () => {
  it('puts the satellites and networks in ECEF at the host\'s time: the ISS where satellite.js puts it', async () => {
    const layer = new OrbitsLayer({fetchFn: fromDisk})
    expect(await layer.load({satellites: true, networks: ['I', 'D']})).toEqual([])
    const cam = new PerspectiveCamera(45, 1.6, 1e4, 1e9)
    cam.position.set(4e7, 0, 0)
    cam.up.set(0, 0, 1)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    const view = {frame: 'ecef', viewMatrix: cam.matrixWorldInverse.toArray(), projectionMatrix: cam.projectionMatrix.toArray(),
      viewport: [0, 0, 640, 400], pixelRatio: 1, timeMs: T, earth: {model: 'sphere', radius: 6370972}}
    layer.applyView(view, 1)
    expect(layer.gmst).toBeCloseTo(gmstRad(unixMsToJd(T)), 12)
    expect(layer.anchors()).toEqual([])
    layer.subscribe(['norad:25544', 'norad:41917', 'dsn:*'])
    const anchors = layer.anchors()
    const iss = anchors.find((a) => a.id === 'norad:25544')
    // satellite.js's own TEME → ECF, by its own GMST.
    const {SATELLITES_URL} = await import('./OrbitsLayer.js')
    const {columns, rows} = JSON.parse(fs.readFileSync(new URL(SATELLITES_URL, PUBLIC), 'utf8'))
    const omm = Object.fromEntries(columns.map((c, i) => [c, rows.find((x) => x[0] === 25544)[i]]))
    const date = new Date(T)
    const f = eciToEcf(propagate(json2satrec(omm), date).position, gstime(date))
    // Orbits stay in true ECEF, whatever the host's Earth.
    expect(Math.hypot(iss.p[0] - (f.x * 1e3), iss.p[1] - (f.y * 1e3), iss.p[2] - (f.z * 1e3))).toBeLessThan(50)
    // An Iridium, from its Constellation, at ~780 km.
    const ir = anchors.find((a) => a.id === 'norad:41917')
    expect(Math.hypot(...ir.p) / 1e3).toBeGreaterThan(7000)
    // Madrid's complex where its latitude and longitude say, on the host's
    // sphere (deck's 6,370,972 m), with its own position in geo.
    const mad = anchors.find((a) => a.id === 'dsn:MDSCC')
    expect(Math.asin(mad.p[2] / Math.hypot(...mad.p)) * 180 / Math.PI).toBeCloseTo(40.2413554, 6)
    expect(Math.hypot(...mad.p)).toBeCloseTo(6370972, 3)
    expect(mad.geo).toEqual([40.2413554, -4.2480085, 0])
    const dishes = anchors.filter((a) => a.kind === 'dsn-dish')
    expect(dishes.length).toBeGreaterThan(12)
    expect(Math.hypot(...dishes[0].p)).toBeCloseTo(6370972, 3)
    // The dishes the DSN draws are on it too.
    expect(layer.networks.D.dishes[0].bodyFixed.length()).toBeCloseTo(6370972, 3)
    // The camera is the host's: the drawn points take its distance rules.
    expect(layer.satellites.points.visible).toBe(true)
    expect(layer.satellites.drawnCount).toBeGreaterThan(400)

    // Only what's subscribed is walked: `dsn:*` alone asks no satellite.
    let asked = 0
    const positionAt = layer.satellites.positionAt.bind(layer.satellites)
    layer.satellites.positionAt = (...a) => {
      asked++
      return positionAt(...a)
    }
    layer.subscribe(['dsn:*'])
    expect(layer.anchors().every((a) => a.id.startsWith('dsn:'))).toBe(true)
    expect(asked).toBe(0)
    // An exact id is looked up, not matched against every record.
    layer.subscribe(['norad:25544'])
    expect(layer.anchors().map((a) => a.id)).toEqual(['norad:25544'])
    expect(asked).toBe(1)

    // The nearest n to a point: here, the ISS's own.
    layer.subscribe([{near: {p: iss.p, n: 3}, pattern: 'norad:*'}])
    const near = layer.anchors()
    expect(near.length).toBe(3)
    expect(near[0].id).toBe('norad:25544')
    const d = near.map((a) => Math.hypot(...a.p.map((x, k) => x - iss.p[k])))
    expect(d[1]).toBeGreaterThanOrEqual(d[0])
    expect(d[2]).toBeGreaterThanOrEqual(d[1])
  })
})
