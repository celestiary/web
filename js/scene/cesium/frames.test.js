import {Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3} from 'three'
import {latLngAltToBodyFixed} from '../../coords.js'
import {toRad} from '../../shared.js'
import {
  bodyToEcef,
  cameraToEcefView,
  cesiumFov,
  ecefToBody,
  angleToArc,
  ellipsoidCameraPosition,
  NIGHT_LIGHT_EDGE,
  nightInView,
  nightVisible,
  sunLightDirectionEcef,
} from './frames.js'


const R = 6378137


/**
 * Cesium's Cartesian3.fromDegrees on a sphere of radius r.
 *
 * @returns {Array<number>}
 */
function sphereFromDegrees(lngDeg, latDeg, r) {
  const lng = lngDeg * toRad
  const lat = latDeg * toRad
  return [r * Math.cos(lat) * Math.cos(lng), r * Math.cos(lat) * Math.sin(lng), r * Math.sin(lat)]
}


/** Asserts two 3-vectors are within tol of each other. */
function expectClose(a, b, tol = 1e-6) {
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(a[i] - b[i])).toBeLessThan(tol)
  }
}


describe('bodyToEcef', () => {
  it('maps celestiary lat/lng to the same point as Cesium fromDegrees', () => {
    for (const [lat, lng] of [[0, 0], [0, 90], [45, -60], [-33.9, 18.4], [89, 170]]) {
      const ecef = bodyToEcef(latLngAltToBodyFixed(lat, lng, 0, R))
      expectClose(ecef, sphereFromDegrees(lng, lat, R), 1e-3)
    }
  })

  it('is a proper rotation (right-handed axes stay right-handed)', () => {
    const x = bodyToEcef(new Vector3(1, 0, 0))
    const y = bodyToEcef(new Vector3(0, 1, 0))
    const z = bodyToEcef(new Vector3(0, 0, 1))
    const cross = new Vector3(...x).cross(new Vector3(...y))
    expectClose(cross.toArray(), z)
  })

  it('round-trips through ecefToBody', () => {
    const v = new Vector3(1.5, -2.25, 3.125)
    expectClose(ecefToBody(bodyToEcef(v)).toArray(), v.toArray())
  })
})


describe('cameraToEcefView', () => {
  it('a camera above 0°N 0°E looking down sees the planet centre', () => {
    const body = new Matrix4() // identity: body frame == world
    const cam = new PerspectiveCamera()
    cam.position.set(2 * R, 0, 0)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    const view = cameraToEcefView(cam.matrixWorld, body)
    expectClose(view.position, [2 * R, 0, 0], 1e-3)
    expectClose(view.direction, [-1, 0, 0])
    expectClose(view.up, [0, 0, 1]) // three's default up (+Y body) is north
  })

  it('undoes the body\'s tilt, spin and heliocentric offset', () => {
    const q = new Quaternion().setFromEuler(new Euler(0.41, 1.3, 0.2))
    const body = new Matrix4().compose(new Vector3(1.5e11, -2e10, 3e9), q, new Vector3(1, 1, 1))
    // Camera 3R above 45°N 60°W, in the body frame, then carried into world.
    const local = latLngAltToBodyFixed(45, -60, 2 * R, R)
    const cam = new PerspectiveCamera()
    cam.position.copy(local).applyMatrix4(body)
    cam.up.set(0, 1, 0).applyQuaternion(q)
    cam.lookAt(new Vector3().setFromMatrixPosition(body))
    cam.updateMatrixWorld()
    const view = cameraToEcefView(cam.matrixWorld, body)
    expectClose(view.position, sphereFromDegrees(-60, 45, 3 * R), 1)
    const toCentre = new Vector3(...view.position).negate().normalize()
    expectClose(view.direction, toCentre.toArray(), 1e-6)
  })
})


describe('sunLightDirectionEcef', () => {
  it('points from the Sun (world origin) toward the body, in ECEF', () => {
    // Body on the world +X axis, unrotated: light travels +X world = +X ECEF.
    const body = new Matrix4().makeTranslation(1.5e11, 0, 0)
    expectClose(sunLightDirectionEcef(body, new Vector3()), [1, 0, 0])
  })
})


describe('cesiumFov', () => {
  it('passes vertical fov through for portrait canvases', () => {
    expect(cesiumFov(0.8, 0.5)).toBe(0.8)
  })

  it('widens to the horizontal fov for landscape canvases', () => {
    const fov = cesiumFov(2 * Math.atan(1), 2)
    expect(Math.tan(fov / 2)).toBeCloseTo(2, 10)
  })
})


describe('ellipsoidCameraPosition', () => {
  const mars = 3389500
  const marsRadii = [3396190, 3396190, 3376200]

  it('keeps the camera on the same ray from the body centre', () => {
    // 30,000 km over Mars at 25° S: where lat/lng/alt placement erred.
    const cam = bodyToEcef(latLngAltToBodyFixed(-25, -160, 3e7, mars))
    const out = ellipsoidCameraPosition(cam, mars, marsRadii)
    const r0 = Math.hypot(...cam)
    const r1 = Math.hypot(...out)
    for (let i = 0; i < 3; i++) {
      expect(out[i] / r1).toBeCloseTo(cam[i] / r0, 12)
    }
  })

  it('keeps the height over the ellipsoid, along the ray', () => {
    const cam = bodyToEcef(latLngAltToBodyFixed(-33.9, 18.4, 5000, 6371010))
    const out = ellipsoidCameraPosition(cam, 6371010, [R, R, 6356752.314245179])
    const r = Math.hypot(...out)
    const [x, y, z] = out.map((v) => v / r)
    const surface = 1 / Math.hypot(x / R, y / R, z / 6356752.314245179)
    expect(r - surface).toBeCloseTo(5000, 6)
  })

  it('puts an equatorial camera over the equatorial radius', () => {
    const out = ellipsoidCameraPosition([6371010 + 5000, 0, 0], 6371010, [R, R, 6356752.314245179])
    expect(out[0]).toBeCloseTo(R + 5000, 6)
    expect(out[1]).toBe(0)
    expect(out[2]).toBe(0)
  })
})


describe('nightVisible', () => {
  // Sunlight travels along -x: the Sun is at +x, the sub-solar point (r, 0, 0).
  const light = [-1, 0, 0]
  const deg = Math.PI / 180

  it('is false over the day side from orbit', () => {
    expect(nightVisible([R + 4e5, 0, 0], light, R)).toBe(false)
    expect(nightVisible([R + 2e7, 0, 0], light, R)).toBe(false)
  })

  it('is true over the night side', () => {
    expect(nightVisible([-(R + 4e5), 0, 0], light, R)).toBe(true)
    expect(nightVisible([0, R + 4e5, 0], light, R)).toBe(true)
  })

  it('is true from the day side once the horizon reaches the night, not from low orbit', () => {
    // From geostationary height the cap reaches 81 degrees from the
    // sub-point: a camera 10 degrees round from the sub-solar point sees 91.
    const at = (h) => [(R + h) * Math.cos(10 * deg), (R + h) * Math.sin(10 * deg), 0]
    expect(nightVisible(at(3.6e7), light, R)).toBe(true)
    expect(nightVisible(at(4e5), light, R)).toBe(false)
  })

  it('on the ground, is true where the Sun is under 3 degrees up, and not higher', () => {
    const at = (angle) => [(R * Math.cos(angle * deg)) + 1, R * Math.sin(angle * deg), 0]
    expect(nightVisible(at(86), light, R)).toBe(true)
    expect(nightVisible(at(60), light, R)).toBe(false)
  })
})


describe('angleToArc', () => {
  const deg = Math.PI / 180
  it('is the angle to the arc where the point projects inside it, else to the nearer end', () => {
    const u = [1, 0, 0]
    const v = [0, 1, 0]
    expect(angleToArc([Math.SQRT1_2, Math.SQRT1_2, 0], u, v)).toBeCloseTo(0, 12)
    expect(angleToArc([Math.cos(10 * deg) * Math.SQRT1_2, Math.cos(10 * deg) * Math.SQRT1_2, Math.sin(10 * deg)], u, v))
        .toBeCloseTo(10 * deg, 12)
    expect(angleToArc([0, -1, 0], u, v)).toBeCloseTo(90 * deg, 12)
    expect(angleToArc([-1, 0, 0], u, v)).toBeCloseTo(90 * deg, 12)
  })
})


describe('nightInView', () => {
  // Sunlight travels along -x: the Sun is at +x.
  const light = [-1, 0, 0]
  const deg = Math.PI / 180
  const fovy = 45 * deg
  const cover = R * 1.01
  const unit = (a) => a.map((x) => x / Math.hypot(...a))
  const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])

  // The lights pass's own N·S for a ray (newLightsMaterial), in ECEF.
  const passNS = (position, dir) => {
    const c = position.map((x) => -x)
    const along = dot(c, dir)
    const miss = dot(c, c) - (along * along)
    const chord = Math.sqrt(Math.max((R * R) - miss, 0))
    let t = along - chord
    if (t < 0) {
      t = along + chord
    }
    const n = unit(dir.map((x, i) => (x * Math.max(t, 0)) - c[i]))
    return -dot(n, light)
  }
  // Whether the pass draws a light anywhere, from a dense grid of rays that
  // reach Cesium's cover.
  const sampled = (view, aspect) => {
    const {position, direction, up} = view
    const right = unit([(direction[1] * up[2]) - (direction[2] * up[1]), (direction[2] * up[0]) - (direction[0] * up[2]),
      (direction[0] * up[1]) - (direction[1] * up[0])])
    const ty = Math.tan(fovy / 2)
    const n = 48
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const x = ((2 * i / n) - 1) * ty * aspect
        const y = ((2 * j / n) - 1) * ty
        const dir = unit(direction.map((v, k) => v + (x * right[k]) + (y * up[k])))
        const along = -dot(position, dir)
        const d2 = dot(position, position)
        const hits = d2 <= cover * cover || (along > 0 && d2 - (along * along) <= cover * cover)
        if (hits && passNS(position, dir) < NIGHT_LIGHT_EDGE) {
          return true
        }
      }
    }
    return false
  }
  // A camera at `position` looking along `direction`, with an up orthogonal to it.
  const viewOf = (position, direction) => {
    const d = unit(direction)
    const helper = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    const along = dot(helper, d)
    return {position, direction: d, up: unit(helper.map((h, i) => h - (along * d[i])))}
  }

  it('is false looking down on the day side from the ground, and facing the Sun by day', () => {
    // 7.5 km up, the Sun 30 degrees up.
    const p = [(R + 7500) * Math.cos(60 * deg), (R + 7500) * Math.sin(60 * deg), 0]
    expect(nightInView(viewOf(p, p.map((x) => -x)), fovy, 16 / 9, light, R, cover)).toBe(false)
    expect(nightInView(viewOf(p, [1, -0.2, 0]), fovy, 16 / 9, light, R, cover)).toBe(false)
  })

  it('facing a low Sun is false, where the cap test said true; facing away, true', () => {
    // The Sun 5 degrees up: the night is past the horizon behind the camera.
    const p = [(R + 7500) * Math.cos(85 * deg), (R + 7500) * Math.sin(85 * deg), 0]
    expect(nightVisible(p, light, R)).toBe(true)
    // Toward the Sun's azimuth, along the ground.
    expect(nightInView(viewOf(p, [1, -0.05, 0]), fovy, 16 / 9, light, R, cover)).toBe(false)
    expect(nightInView(viewOf(p, [-1, -0.05, 0]), fovy, 16 / 9, light, R, cover)).toBe(true)
  })

  it('from orbit, is false with only the day side in the frame, true with the terminator in it', () => {
    // 20,000 km over a point 60 degrees from the sub-solar point: the cap
    // reaches the night, but a narrow look at the sub-solar side doesn't.
    const p = [(R + 2e7) * Math.cos(60 * deg), (R + 2e7) * Math.sin(60 * deg), 0]
    expect(nightVisible(p, light, R)).toBe(true)
    const towardDay = [(R * Math.cos(20 * deg)) - p[0], (R * Math.sin(20 * deg)) - p[1], 0]
    expect(nightInView(viewOf(p, towardDay), 5 * deg, 1, light, R, cover)).toBe(false)
    expect(nightInView(viewOf(p, p.map((x) => -x)), fovy, 1, light, R, cover)).toBe(true)
  })

  it('is false looking away from the body', () => {
    const p = [-(R + 4e5), 0, 0]
    expect(nightInView(viewOf(p, [-1, 0, 0]), fovy, 1, light, R, cover)).toBe(false)
  })

  it('never misses a ray the pass would light (random views against a dense grid of rays)', () => {
    let seed = 12345
    const rand = () => {
      seed = ((seed * 1103515245) + 12345) % 2147483648
      return seed / 2147483648
    }
    let conservative = 0
    let night = 0
    for (let k = 0; k < 300; k++) {
      const h = [10, 7500, 4e5, 4e6, 2e7, 3e8][k % 6]
      const lat = (rand() - 0.5) * Math.PI
      const lng = rand() * 2 * Math.PI
      const p = [(R + h) * Math.cos(lat) * Math.cos(lng), (R + h) * Math.cos(lat) * Math.sin(lng), (R + h) * Math.sin(lat)]
      const down = rand() < 0.5
      const dir = [rand() - 0.5, rand() - 0.5, rand() - 0.5].map((x, i) => x - (down ? p[i] / (R + h) : 0))
      const view = viewOf(p, dir)
      const aspect = 0.5 + (rand() * 1.5)
      const inView = nightInView(view, fovy, aspect, light, R, cover)
      if (sampled(view, aspect)) {
        night++
        expect(inView).toBe(true)
      } else if (inView) {
        conservative++
      }
    }
    expect(night).toBeGreaterThan(50)
    // Conservative, but not wildly: most views without night read false.
    expect(conservative).toBeLessThan(60)
    // A dense grid over hundreds of views: seconds under load, as precommit
    // runs it beside other work.
  }, 30000)
})
