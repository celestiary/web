import {Object3D, Quaternion, Vector3} from 'three'
import * as Shared from '../shared'
import debug from '../debug'
import {J2000_JD, gmstRad, precessionQuaternion, utcToTtJulianDay} from './celestialFrame.js'
import {moonScenePosition} from './lunarTheory.js'
import {BodyLine, fineSteps} from './bodyLine.js'
import {equatorQuaternion, poleAndMeridian, textureTurn} from './iauRotation.js'
import {orbitAt} from './meanElements.js'
import {elementsOfDate} from './orbitElements.js'
import {PLANET_NAMES, planetsApprox} from './planetsApprox.js'
import {
  JUPITER_SATURN_SAMPLES,
  ORBIT_LINE_POINTS,
  OrbitPath,
  OrbitPaths,
  SUN_GM_M3_PER_DAY2,
  unitEllipse,
} from './orbitPath.js'


const SECONDS_PER_DAY = 86400

// The Moon's share of the Earth-Moon mass, 1 / (1 + M_Earth / M_Moon):
// Earth's wobble about the barycentre is this much of the Moon's position.
const MOON_MASS_FRACTION = 1 / (1 + 81.30056)

// A mean-element line's ellipse is redrawn when its eccentricity has
// drifted (Pluto's, by Standish's rates) enough to move it by this much of
// the body's radius: b moves by a·e·Δe.
const ECCENTRICITY_REDRAW_RADII = 1e-4
const TWO_PI = 2 * Math.PI

// The hand-over from the stand-in planets (planetsApprox.js) to VSOP87C, once
// it has loaded: the planets glide from the one to the other over this long,
// rather than jump by the stand-in's error (up to a few thousand km for the
// inner planets, millions for Jupiter and Saturn, in 2026).
export const HANDOVER_MS = 1500

// With no one asking sooner (Celestiary asks as its scene is revealed, at
// most 4 s, or 8 s on the homepage, after the camera is placed), VSOP87C is
// fetched this long after the first frame: for the scenes with no reveal,
// the guide's.
const LOAD_AFTER_MS = 10000


/**
 * Animate scene, currently just orbits.  For major planets uses VSOP87C, and
 * for the Moon the truncated ELP-2000/82 of Meeus 47 (lunarTheory.js), both
 * in the mean ecliptic and equinox of date.  Pluto and the other moons
 * follow published mean elements (meanElements.js), referred to J2000 and
 * precessed to date here.  Every body but Earth (GMST) is turned to its IAU
 * WGCCRE pole and prime meridian (iauRotation.js).
 * The planets' and the Moon's orbit lines are their paths, sampled from
 * the same ephemerides (orbitPath.js); the other bodies' are their
 * mean-element ellipses of date.
 *
 * VSOP87C's coefficients are 2.6 MB, so they are not in the first chunk:
 * `loadEphemeris` fetches them after the first frame, and until they are in
 * the planets are placed by Standish's mean elements (planetsApprox.js),
 * then glide to VSOP87C's places over HANDOVER_MS (`planetCoords`).
 */
export default class Animation {
  /**
   * @param {object} time
   * @param {?Function} [vsop] a VSOP87C function to use in place of the
   *     wasm one `loadEphemeris` loads (tests); null for none yet, the
   *     stand-in's planets until `setEphemeris`.  Left out, the one already
   *     loaded by another Animation, else none yet.
   */
  constructor(time, vsop = undefined) {
    this.time = time
    // VSOP87C's function, or null until it has loaded.
    this.vsop = vsop === undefined ? loadedVsop : vsop
    /** Milliseconds, for the hand-over; tests set a deterministic one. */
    this.clock = performance.now.bind(performance)
    // The hand-over from the stand-in: null when none is due, 'pending'
    // from the series loading to the next frame, else the clock then.
    this._handover = null
    this._loadRequested = this.vsop !== null
    this._firstFrameAt = null
    // The stand-in's positions for a frame's placement, and for the orbit
    // lines' samples (vsopAt): apart, so sampling a line doesn't overwrite
    // the frame's.
    this._standIn = {}
    this._sampled = {}
    this._blended = {}
    /** Called when VSOP87C has loaded, with no arguments. */
    this.onEphemeris = null
    this.curVsopCoords = this.vsopAt(J2000_JD)
    this.Y_AXIS = new Vector3(0, 1, 0)
    // Per-frame Moon position, from updateMoon.
    this.moonPos = new Vector3
    this._tmpVec = new Vector3
    // Per-frame date state, from setDate: the Julian Day of the last
    // animate / animateAtJD, the same in TT, and the rotation from the
    // ecliptic of J2000 (mean elements, IAU poles) to the scene's, of date.
    this.jd = null
    this.jde = J2000_JD
    this.precession = new Quaternion
    this._orbitQuat = new Quaternion
    this._orbitPos = new Vector3
    this._lineBody = new Vector3
    this._invQuat = new Quaternion
    // A body's pole and meridian, from poleAndMeridian.
    this._pm = {ra: 0, dec: 0, w: 0}
    // Orbit line rebuilds, run within a per-frame budget.
    this.orbitPaths = new OrbitPaths
  }


  /**
   * @param {number} jd Julian Day (UTC)
   * @returns {object} VSOP87C's heliocentric (x, y, z) of each planet, AU,
   *   in the mean ecliptic of date; before it has loaded (`vsopReady`), the
   *   stand-in's (planetsApprox.js), good to minutes of arc near the present.
   *   The same object is overwritten by the next call.
   */
  vsopAt(jd) {
    return this.vsop ? this.vsop(jd) : planetsApprox(jd, this._sampled)
  }


  /** @returns {boolean} whether vsopAt gives VSOP87C's positions yet */
  vsopReady() {
    return this.vsop !== null
  }


  /**
   * Fetch VSOP87C, if it isn't in or on its way, and switch to it when it
   * arrives.  Called once the scene is up (Celestiary, as it is revealed),
   * and by `animate` a few seconds into the run if no one has.
   *
   * @returns {Promise} Resolved when the planets are on VSOP87C, or when
   *   fetching it failed: the stand-in carries on
   */
  loadEphemeris() {
    if (this._loadRequested) {
      return loadingVsop ?? Promise.resolve()
    }
    this._loadRequested = true
    return fetchVsop().then((vsop) => {
      this.setEphemeris(vsop)
    }, (err) => {
      // Not retried: a browser keeps a failed import() for the page's life,
      // so a retry never reaches the network.  A reload does.
      console.warn('VSOP87C failed to load; the planets stay on mean elements.', err)
    })
  }


  /**
   * Switch the planets to VSOP87C.  The next frame starts the glide there.
   *
   * @param {Function} vsop
   */
  setEphemeris(vsop) {
    if (this.vsop) {
      return
    }
    this.vsop = vsop
    this._handover = 'pending'
    this.onEphemeris?.()
  }


  /**
   * The planets' places for this frame's date: VSOP87C's, or the stand-in's
   * before it has loaded, or between them while it hands over, so the
   * switch is a glide of the difference to nothing, not a jump.  The glide
   * is of the two ephemerides at the frame's date, so it stays right when
   * the date moves, a permalink or a flight setting one meanwhile.
   *
   * @param {number} jd Julian Day (UTC)
   * @returns {object} each planet's (x, y, z), AU, ecliptic of date
   */
  planetCoords(jd) {
    if (!this.vsop) {
      return planetsApprox(jd, this._standIn)
    }
    const vsop = this.vsop(jd)
    if (this._handover === null) {
      return vsop
    }
    const now = this.clock()
    if (this._handover === 'pending') {
      this._handover = now
    }
    const t = Math.max(0, now - this._handover) / HANDOVER_MS
    if (!(t < 1)) {
      this._handover = null
      return vsop
    }
    // Smoothstep: no start or stop to the glide.
    const w = 1 - (t * t * (3 - (2 * t)))
    const standIn = planetsApprox(jd, this._standIn)
    for (const name of PLANET_NAMES) {
      const c = this._blended[name] ?? (this._blended[name] = {x: 0, y: 0, z: 0})
      const v = vsop[name]
      const s = standIn[name]
      c.x = v.x + (w * (s.x - v.x))
      c.y = v.y + (w * (s.y - v.y))
      c.z = v.z + (w * (s.z - v.z))
    }
    return this._blended
  }


  /** @param {object} scene */
  animate(scene) {
    this.time.updateTime()
    this._loadLater()
    const jd = this.time.simTimeJulianDay()
    // Time clamps the date to where the ephemerides hold; this is a
    // second line of defence, so nothing is placed at NaN.
    if (!Number.isFinite(jd)) {
      return
    }
    this.setDate(jd)
    this.animateSystem(scene)
    this.orbitPaths.pump()
  }


  /**
   * The safety net for `loadEphemeris`: a scene no one reveals (the guide's)
   * still gets VSOP87C, a few seconds after its first frame.
   */
  _loadLater() {
    if (this._loadRequested) {
      return
    }
    const now = this.clock()
    this._firstFrameAt ??= now
    if (now - this._firstFrameAt >= LOAD_AFTER_MS) {
      this.loadEphemeris()
    }
  }


  /**
   * Animate the scene at a specific Julian Day without advancing the clock.
   * Used to position planets at a saved permalink time before camera restore.
   *
   * @param {object} scene Three.js scene
   * @param {number} jd Julian Day number
   */
  animateAtJD(scene, jd) {
    if (!Number.isFinite(jd)) {
      return
    }
    this.setDate(jd)
    this.animateSystem(scene)
    this.orbitPaths.pump()
  }


  /**
   * Everything animateSystem needs for a date, computed once per frame.
   *
   * @param {number} jd Julian Day (UTC)
   */
  setDate(jd) {
    this.jd = jd
    this.curVsopCoords = this.planetCoords(jd)
    this.jde = utcToTtJulianDay(jd)
    precessionQuaternion(J2000_JD, this.jde, this.precession)
    this.updateMoon(jd)
  }


  /**
   * The Moon's geocentric position for this frame.  Meeus's series is in
   * TT; the simulation clock is UTC.  Its orientation is the IAU model's,
   * like every body's but Earth's.
   *
   * @param {number} jd Julian Day (UTC)
   */
  updateMoon(jd) {
    moonScenePosition(utcToTtJulianDay(jd), this.moonPos)
  }


  /**
   * Recursive animation of orbits and rotations at the current time.
   *
   * @param {!Object3D} system
   */
  animateSystem(system) {
    if (system.preAnimCb) {
      // The Julian Day being animated, for callbacks that follow the date
      // (StellarFrame's precession); animateAtJD's needn't be the clock's.
      system.preAnimCb(this.time, this.jd)
    }

    if (system.poleModel) {
      this.orientPole(system)
    }

    if (system.siderealRotationPeriod || system.meridianModel) {
      // Spin about the body's local +Y, its pole as planetTilt has it, so
      // that +X, the prime meridian, is where its rotation model says.
      const name = system.props && system.props.name
      if (name === 'earth') {
        // Greenwich Mean Sidereal Time: planetTilt's rotateX(-ε) leaves +X
        // at the equinox of date on the equator, so a turn by GMST puts
        // Greenwich at its right ascension (iauRotation.test.js checks it
        // against the IAU model and Horizons).
        system.setRotationFromAxisAngle(this.Y_AXIS, gmstRad(this.time.simTimeJulianDay()))
      } else if (system.meridianModel) {
        // The IAU prime meridian W, measured from the equator's node,
        // which planetTilt's +X points at (orientPole).
        const w = poleAndMeridian(system.meridianModel, this.jde, this._pm).w
        system.setRotationFromAxisAngle(this.Y_AXIS, w * Shared.toRad)
        if (system.surface && system.textureRotation) {
          system.surface.rotation.y = textureTurn(system.textureRotation, this.jde, w) * Shared.toRad
        }
      } else {
        // No model (only the demo descriptors): a turn per sidereal
        // period, from an arbitrary meridian.
        const period = system.siderealRotationPeriod.scalar ?? system.siderealRotationPeriod
        system.setRotationFromAxisAngle(this.Y_AXIS, Shared.twoPi * ((this.time.simTimeSecs() / period) % 1))
      }
    }

    // This is referred to by a comment in scene.js#addOrbitingPlanet.
    if (system.orbit) {
      // Get an object with the (x,y,z) coordinates of each planet.
      // console.log('LOOKUP vsop for, in', sysName, vsopCoords)
      const sysName = system.name.split('.')[0]
      const vsopCoord = this.curVsopCoords[sysName]
      let x
      let y
      let z
      if (sysName === 'moon') {
        ({x, y, z} = this.moonPos)
        this.followPath(system)
      } else if (system.elements) {
        ({x, y, z} = this.placeByElements(system))
      } else if (vsopCoord === undefined) {
        // No elements: a flat ellipse in the ecliptic, centred on the
        // parent.  Only the demo descriptors (e.g. earth-as-moon.json) have
        // no elements now.
        const eccentricity = system.orbit.eccentricity
        const aRadius = system.orbit.semiMajorAxis.scalar
        const bRadius = aRadius * Math.sqrt(1.0 - Math.pow(eccentricity, 2.0))
        // -1.0 because orbits are counter-clockwise when viewed from above North of Earth.
        const angle = -1.0 * this.time.simTimeSecs() / system.orbit.siderealOrbitPeriod.scalar * Shared.twoPi
        x = aRadius * Math.cos(angle)
        y = 0
        z = bRadius * Math.sin(angle)
      } else {
        ({x, y, z} = vsopScene(vsopCoord, this._tmpVec))
        this.followPath(system)
      }
      // Never a non-finite position: keep the last good one.
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        system.position.set(x, y, z)
        this.lineThroughBody(system)
      }
      if (sysName === 'earth') {
        debug().log(`SMA: ${system.orbit.semiMajorAxis.scalar}, syspos: ${system.position}, ` +
                    `vsopCoord: ${vsopCoord}, delta: ${vsopCoord.x - x}, ${vsopCoord.y - y}, ${vsopCoord.z - z}`)
      }
      if (system.orbitDiagram?.visible) {
        this.layOrbitDiagram(system)
      }
      if (system.postAnimCb) {
        system.postAnimCb(system)
      }
    }

    system.children.forEach((child) => this.animateSystem(child))
  }


  /**
   * Keep a planet's or the Moon's orbit line on its path: turn it from
   * J2000 to the date, and ask for a rebuild when the date has moved on
   * (orbitPath.js).  The line stays drawn meanwhile, even when its window
   * no longer holds the body: an orbit's shape changes slowly, and hiding
   * it made it flicker at high time rates.  Cheap unless a rebuild is due,
   * and the rebuild itself is left to orbitPaths.pump.
   *
   * @param {Object3D} orbitPosition
   */
  followPath(orbitPosition) {
    const shape = orbitPosition.orbitShape
    if (!shape) {
      return
    }
    if (orbitPosition.orbitPath === undefined) {
      orbitPosition.orbitPath = this.newOrbitPath(orbitPosition)
    }
    const path = orbitPosition.orbitPath
    if (!path) {
      return
    }
    shape.quaternion.copy(this.precession)
    if (path.isStale(this.jd)) {
      this.orbitPaths.request(path, this.jd)
    }
  }


  /**
   * Keep a body's orbit line through its centre close up: the fine arc and
   * origin around the body (bodyLine.js).  For a sampled path, in the
   * line's frame (the ecliptic of J2000, turned by this.precession); for a
   * mean-element ellipse, in its unit ellipse's.
   *
   * @param {Object3D} orbitPosition just placed
   */
  lineThroughBody(orbitPosition) {
    const radius = orbitPosition.bodyRadius
    const shape = orbitPosition.orbitShape
    if (!(radius > 0) || !shape) {
      return
    }
    const body = this._lineBody.copy(orbitPosition.position)
    const path = orbitPosition.orbitPath
    if (path) {
      path.follow(this.jd, body.applyQuaternion(this._invQuat.copy(this.precession).invert()))
      return
    }
    const bodyLine = shape.bodyLine
    if (bodyLine) {
      // Into the unit ellipse's frame: undo layOrbitShape's shift,
      // rotation and scale.
      const a = shape.scale.x
      body.sub(shape.position).applyQuaternion(this._invQuat.copy(shape.quaternion).invert()).divideScalar(a)
      const e = bodyLine.e
      const E = Math.atan2(body.z / Math.sqrt(1 - (e * e)), body.x)
      bodyLine.follow(body, (((E / TWO_PI) + 1) % 1) * (bodyLine.n - 1), radius / a)
    }
  }


  /**
   * The OrbitPath for a planet's or the Moon's orbit line, sampling the
   * ephemeris its body is placed by.
   *
   * @param {Object3D} orbitPosition
   * @returns {OrbitPath|null} null if its orbit line isn't Planet.newOrbit's
   */
  newOrbitPath(orbitPosition) {
    const shape = orbitPosition.orbitShape
    const line = shape.line
    if (!line) {
      return null
    }
    // The samples are in metres, in the ecliptic of J2000, around the primary.
    shape.scale.setScalar(1)
    shape.position.set(0, 0, 0)
    // Until its first build: the unit ellipse isn't this path.
    line.visible = false
    const name = orbitPosition.name.split('.')[0]
    const periodDays = orbitPosition.orbit.siderealOrbitPeriod.scalar / SECONDS_PER_DAY
    const moonAt = (jd, target) => moonScenePosition(utcToTtJulianDay(jd), target)
    // For the fine arc around the body.
    const size = {
      a: orbitPosition.orbit.semiMajorAxis.scalar,
      e: orbitPosition.orbit.eccentricity || 0,
      radius: orbitPosition.bodyRadius || 0,
    }
    if (name === 'moon') {
      return new OrbitPath(line, {positionAt: moonAt, periodDays, ...size})
    }
    const planetAt = (jd, target) => vsopScene(this.vsopAt(jd)[name], target)
    // Drawn from the stand-in until VSOP87C is in, then redrawn.
    const opts = {positionAt: planetAt, periodDays, mu: SUN_GM_M3_PER_DAY2, ...size,
      approximate: () => !this.vsopReady()}
    if (name === 'jupiter' || name === 'saturn') {
      opts.samples = JUPITER_SATURN_SAMPLES
    }
    if (name === 'earth') {
      // Earth's path is the Earth-Moon barycentre's, smooth enough for the
      // sparse samples, and its monthly wobble about it, per vertex.
      const moon = new Vector3
      opts.positionAt = (jd, target) => planetAt(jd, target).addScaledVector(moonAt(jd, moon), MOON_MASS_FRACTION)
      opts.offsetAt = (jd, target) => moonAt(jd, target).multiplyScalar(-MOON_MASS_FRACTION)
    }
    return new OrbitPath(line, opts)
  }


  /**
   * Place a body on its mean-element orbit (meanElements.js) at this
   * frame's date, relative to its primary, and lay its orbit line on the
   * same ellipse.  The elements are referred to J2000; the precession
   * rotation takes both to the scene's frame, of date.
   *
   * @param {Object3D} orbitPosition with `elements`
   * @returns {Vector3} the position, in the parent's (unrotated) frame
   */
  placeByElements(orbitPosition) {
    const q = this._orbitQuat
    const pos = this._orbitPos
    const {a, e} = orbitAt(orbitPosition.elements, this.jde, q, pos)
    q.premultiply(this.precession)
    pos.applyQuaternion(this.precession)
    this.layOrbitShape(orbitPosition.orbitShape, q, a, e, orbitPosition.bodyRadius)
    return pos
  }


  /**
   * Lay a body's orbit diagram (Scene.showOrbitElement) on its elements of
   * this frame's date, in the scene's frame: the elements' reference plane
   * turned to the ecliptic of J2000 and on by the precession, as
   * placeByElements turns the orbit, or, for the Moon's of date, as they
   * are.
   *
   * @param {Object3D} orbitPosition with `orbitDiagram`
   */
  layOrbitDiagram(orbitPosition) {
    const diagram = orbitPosition.orbitDiagram
    const el = elementsOfDate(orbitPosition.name.split('.')[0], orbitPosition.orbit, this.jde)
    if (!el) {
      diagram.visible = false
      return
    }
    diagram.setElements(el)
    diagram.scale.setScalar(el.a)
    diagram.quaternion.copy(el.frame)
    if (!el.ofDate) {
      diagram.quaternion.premultiply(this.precession)
    }
  }


  /**
   * Lay an orbit line (Planet.newOrbit's flat unit ellipse, centred on its
   * parent, major axis along +X, in the XZ plane) on an orbit: rotated by
   * quat, scaled to a, and shifted so the primary is at the focus.  The
   * ellipse is redrawn if e has drifted from the one it was drawn for.
   *
   * @param {Object3D} shape the orbit line's group, or undefined
   * @param {Quaternion} quat the orbit's orientation, pericentre along +X
   * @param {number} a semi-major axis, metres
   * @param {number} e eccentricity
   * @param {number} [radius] the body's, metres: the line is drawn through
   *     its centre to a small fraction of it (bodyLine.js)
   */
  layOrbitShape(shape, quat, a, e, radius = 0) {
    if (!shape) {
      return
    }
    const line = shape.line
    if (line) {
      if (!shape.bodyLine) {
        shape.bodyLine = new BodyLine(line, {n: ORBIT_LINE_POINTS, closed: true})
        shape.bodyLine.e = NaN
      }
      const bodyLine = shape.bodyLine
      const redraw = radius > 0 ? ECCENTRICITY_REDRAW_RADII * radius / (a * Math.max(e, 1e-3)) : 1e-6
      if (!(Math.abs(e - bodyLine.e) < redraw)) {
        const b = Math.sqrt(1 - (e * e))
        const curve = {
          at: (u, target) => {
            const E = TWO_PI * u / (ORBIT_LINE_POINTS - 1)
            return target.set(Math.cos(E), 0, b * Math.sin(E))
          },
          correct: false,
        }
        const steps = radius > 0 ? fineSteps(a, e, radius, ORBIT_LINE_POINTS) : 1
        bodyLine.setCoarse(unitEllipse(e, new Float64Array(3 * ORBIT_LINE_POINTS)), curve, steps, bodyLine.origin)
        bodyLine.e = e
      }
    }
    shape.quaternion.copy(quat)
    shape.scale.setScalar(a)
    // Ellipse centre = focus - a·e toward pericentre.
    shape.position.copy(this._tmpVec.set(1, 0, 0).applyQuaternion(quat)).multiplyScalar(-a * e)
  }


  /**
   * Turn a planetTilt node to the plane of the body's equator: +Y, the
   * body's north pole, at its IAU pole, and +X at the ascending node of its
   * equator on the ICRF equator, where the prime meridian W is measured
   * from; both of date.  Replaces Planet.load's rotateX(-obliquity), which
   * could only lean a pole toward ecliptic longitude 90°.  The spun node
   * below it turns by W.
   *
   * @param {Object3D} planetTilt with `poleModel` (iauRotation.js)
   */
  orientPole(planetTilt) {
    const pm = poleAndMeridian(planetTilt.poleModel, this.jde, this._pm)
    equatorQuaternion(pm, planetTilt.quaternion).premultiply(this.precession)
  }
}


/**
 * A VSOP87C position (heliocentric ecliptic of date, AU) in the scene's
 * axes, metres: scene (x, z, -y).
 *
 * @param {{x: number, y: number, z: number}} c
 * @param {Vector3} target
 * @returns {Vector3}
 */
function vsopScene(c, target) {
  const au = Shared.ASTRO_UNIT_METER
  return target.set(c.x * au, c.z * au, -c.y * au)
}


// VSOP87C's function once the chunk with its coefficients is in (vsop.js,
// split from the first chunk by the dynamic import), shared by Animations.
let loadedVsop = null
let loadingVsop = null


/**
 * @returns {Promise<Function>} VSOP87C's function, fetching its chunk once
 */
function fetchVsop() {
  loadingVsop ??= import('../vsop')
      .then(({loadVsop87c}) => new Promise((resolve) => loadVsop87c(resolve)))
      .then((vsop) => {
        loadedVsop = vsop
        return vsop
      })
  loadingVsop.catch(() => {
    loadingVsop = null
  })
  return loadingVsop
}
