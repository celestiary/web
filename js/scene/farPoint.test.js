import {describe, expect, it} from 'bun:test'
import {
  AdditiveBlending,
  LOD,
  LessEqualDepth,
  Object3D,
  PerspectiveCamera,
  PointsMaterial,
  Vector3,
} from 'three'
import {DISPLAY_GAIN, OVERLAY_LAYER} from '../shared.js'
import {neutral} from './hdr.js'
import {
  MOON_POINT_LEVEL,
  MOON_POINT_PX,
  PLANET_POINT_PX,
  POINT_AT_RADII,
  POINT_HANDOFF_RANGE,
  discFlux,
  discMeanValue,
  farPointColor,
  farPointLevel,
  handoffRatio,
  lambertPhase,
  farPointOptions,
  FovLOD,
  fovScale,
  meshReach,
  newFarPoint,
  pointSwitchDistance,
  setDrawingBuffer,
} from './farPoint.js'


const JUPITER_RADIUS = 6.9911e7


describe('pointSwitchDistance', () => {
  it('is the mesh range in radii', () => {
    expect(pointSwitchDistance(1)).toBe(POINT_AT_RADII)
    expect(pointSwitchDistance(JUPITER_RADIUS)).toBe(JUPITER_RADIUS * POINT_AT_RADII)
  })
})


describe('farPointColor', () => {
  it('is the display value, not an sRGB hex converted to linear', () => {
    const c = farPointColor(0.5)
    expect([c.r, c.g, c.b]).toEqual([0.5, 0.5, 0.5])
    // What 0x808080 became, and why moons' points were lost.
    const hex = new PointsMaterial({color: 0x808080}).color
    expect(hex.r).toBeLessThan(0.25)
  })
})


describe('farPointOptions', () => {
  for (const isMoon of [false, true]) {
    const who = isMoon ? 'a moon' : 'a planet'

    it(`for ${who} is an untonemapped, additive marker`, () => {
      const o = farPointOptions(isMoon)
      expect(o.toneMapped).toBe(false)
      expect(o.blending).toBe(AdditiveBlending)
      expect(o.transparent).toBe(true)
      expect(o.sizeAttenuation).toBe(false)
    })

    it(`for ${who} is depth-tested and writes no depth`, () => {
      const o = farPointOptions(isMoon)
      expect(o.depthTest).toBe(true)
      expect(o.depthWrite).toBe(false)
      const material = new PointsMaterial(o)
      expect(material.depthFunc).toBe(LessEqualDepth)
    })

    it(`for ${who} is at least a pixel across`, () => {
      expect(farPointOptions(isMoon).size).toBeGreaterThanOrEqual(1)
    })
  }

  it('makes a moon\'s point dimmer than a planet\'s, but plainly visible', () => {
    const planet = farPointOptions(false)
    const moon = farPointOptions(true)
    expect(planet.color.r).toBe(1)
    expect(moon.color.r).toBe(MOON_POINT_LEVEL)
    expect(moon.color.r).toBeLessThan(planet.color.r)
    // Half the display range: a lone pixel at 22% was lost among the stars.
    expect(moon.color.r).toBeGreaterThanOrEqual(0.5)
    expect(moon.size).toBe(MOON_POINT_PX)
    expect(planet.size).toBe(PLANET_POINT_PX)
    expect(moon.size).toBeLessThanOrEqual(planet.size)
  })
})


describe('newFarPoint', () => {
  it('is drawn in the scene pass, after the opaque meshes', () => {
    const p = newFarPoint(true)
    const scenePass = new PerspectiveCamera()
    const overlayPass = new PerspectiveCamera()
    overlayPass.layers.set(OVERLAY_LAYER)
    // Transparent, so three sorts it after the opaque bodies whose depth it
    // tests against; and on the default layer, so the atmosphere pass hazes
    // it as it does the stars (a bright day sky hides it).
    expect(p.material.transparent).toBe(true)
    expect(p.layers.test(scenePass.layers)).toBe(true)
    expect(p.layers.test(overlayPass.layers)).toBe(false)
  })

  it('is a single point at the body\'s centre', () => {
    const p = newFarPoint(false)
    expect(p.isPoints).toBe(true)
    expect(p.geometry.getAttribute('position').count).toBe(1)
    expect(p.name).toBe('far point')
  })
})


describe('the planet LOD', () => {
  /** @returns {object} A LOD like Planet.newPlanet's, with a stand-in mesh */
  function lodFor(radius, isMoon) {
    const mesh = new Object3D
    const point = newFarPoint(isMoon)
    const lod = new LOD
    lod.addLevel(mesh, 1)
    lod.addLevel(point, pointSwitchDistance(radius))
    return {lod, mesh, point}
  }

  /** @returns {PerspectiveCamera} At the given distance along +z */
  function cameraAt(distance) {
    const camera = new PerspectiveCamera
    camera.position.set(0, 0, distance)
    camera.updateMatrixWorld()
    return camera
  }

  it('draws a moon as a mesh inside 500 radii and its point beyond', () => {
    const radius = 1.8216e6 // Io
    const {lod, mesh, point} = lodFor(radius, true)
    lod.update(cameraAt(499 * radius))
    expect(mesh.visible).toBe(true)
    expect(point.visible).toBe(false)
    lod.update(cameraAt(501 * radius))
    expect(mesh.visible).toBe(false)
    expect(point.visible).toBe(true)
  })

  it('selects the moon\'s point from the planet\'s side, not its own', () => {
    // The camera 1e10 m from Jupiter, the moon 4.2e8 m from Jupiter: the
    // moon is a point there, wherever the LOD is parented.
    const radius = 1.8216e6
    const {lod, point} = lodFor(radius, true)
    lod.position.set(4.2e8, 0, 0)
    lod.updateMatrixWorld()
    lod.update(cameraAt(1e10))
    expect(point.visible).toBe(true)
    const d = new Vector3().setFromMatrixPosition(lod.matrixWorld).distanceTo(new Vector3(0, 0, 1e10))
    expect(d / radius).toBeGreaterThan(POINT_AT_RADII)
  })
})


describe('fovScale', () => {
  it('is 1 at the reference field of view', () => {
    expect(fovScale({fov: 45})).toBe(1)
  })

  it('is the ratio of the tangent half-angles', () => {
    const toRad = Math.PI / 180
    expect(fovScale({fov: 1})).toBeCloseTo(Math.tan(0.5 * toRad) / Math.tan(22.5 * toRad), 12)
    expect(fovScale({fov: 1})).toBeLessThan(0.025)
    expect(fovScale({fov: 90})).toBeGreaterThan(2)
  })
})


describe('FovLOD', () => {
  const R = JUPITER_RADIUS

  // A LOD of mesh and point at the planet's switch distance, with the camera
  // `distance` away on +z.
  function levelAt(distance, fov, zoom = 1) {
    const lod = new FovLOD()
    const mesh = new Object3D()
    const point = new Object3D()
    lod.addLevel(mesh, 1)
    lod.addLevel(point, pointSwitchDistance(R))
    const camera = new PerspectiveCamera(fov, 1, 1, 1e20)
    camera.position.set(0, 0, distance)
    camera.zoom = zoom
    camera.updateMatrixWorld()
    lod.updateMatrixWorld()
    lod.update(camera)
    return mesh.visible ? 'mesh' : 'point'
  }

  it('is a LOD', () => {
    expect(new FovLOD().isLOD).toBe(true)
  })

  it('at 45 degrees chooses as three\'s LOD does', () => {
    const d = pointSwitchDistance(R)
    expect(levelAt(d * 0.99, 45)).toBe('mesh')
    expect(levelAt(d * 1.01, 45)).toBe('point')
  })

  it('draws the mesh at a distance that is a point at 45, when the FOV is narrow', () => {
    const d = pointSwitchDistance(R) * 10
    expect(levelAt(d, 45)).toBe('point')
    expect(levelAt(d, 1)).toBe('mesh')
  })

  it('draws a point nearer than the switch distance, when the FOV is wide', () => {
    const d = pointSwitchDistance(R) * 0.8
    expect(levelAt(d, 45)).toBe('mesh')
    expect(levelAt(d, 120)).toBe('point')
  })

  it('keeps camera.zoom', () => {
    const d = pointSwitchDistance(R) * 10
    expect(levelAt(d, 45, 20)).toBe('mesh')
  })

  it('switches where the body has the same apparent size', () => {
    const d = pointSwitchDistance(R) / fovScale({fov: 1})
    expect(levelAt(d * 0.99, 1)).toBe('mesh')
    expect(levelAt(d * 1.01, 1)).toBe('point')
  })
})


describe('meshReach', () => {
  it('at the reference canvas (and before any is set), reaches past 500 radii, a 3.1 px disc, to a 2 px one', () => {
    expect(meshReach()).toBeCloseTo(3.09 / PLANET_POINT_PX, 2)
  })

  it('reaches to where the disc is the point\'s size, on a taller canvas', () => {
    setDrawingBuffer(879, 1)
    try {
      // 500 radii is 4.2 px across over 879 px at 45°; the point is 2.
      expect(meshReach()).toBeCloseTo(4.245 / PLANET_POINT_PX, 2)
      // At the reach, the disc is the point's size.
      const toRad = Math.PI / 180
      const d = pointSwitchDistance(JUPITER_RADIUS) * meshReach()
      const px = 2 * JUPITER_RADIUS / d / (2 * Math.tan(22.5 * toRad)) * 879
      expect(px).toBeCloseTo(PLANET_POINT_PX, 6)
    } finally {
      setDrawingBuffer(640, 1)
    }
  })

  it('never shortens the range (CesiumLayers.meshRange shares it)', () => {
    setDrawingBuffer(900, 3)
    try {
      expect(meshReach()).toBe(1)
    } finally {
      setDrawingBuffer(640, 1)
    }
  })

  it('scales only a drawnSize FovLOD', () => {
    setDrawingBuffer(1280, 1)
    try {
      const at = (drawnSize) => {
        const lod = new FovLOD({drawnSize})
        const mesh = new Object3D()
        lod.addLevel(mesh, 1)
        lod.addLevel(new Object3D(), pointSwitchDistance(JUPITER_RADIUS))
        const camera = new PerspectiveCamera(45, 1, 1, 1e20)
        camera.position.set(0, 0, pointSwitchDistance(JUPITER_RADIUS) * 1.5)
        camera.updateMatrixWorld()
        lod.updateMatrixWorld()
        lod.update(camera)
        return mesh.visible
      }
      expect(at(true)).toBe(true)
      expect(at(false)).toBe(false)
    } finally {
      setDrawingBuffer(640, 1)
    }
  })
})


describe('the far point\'s hand-off to the disc', () => {
  const n = (v) => neutral([v, v, v])[0]

  it('Lambert\'s phase law: whole at full, none at new, 1/π at quarter', () => {
    expect(lambertPhase(0)).toBeCloseTo(1, 12)
    expect(lambertPhase(Math.PI)).toBeCloseTo(0, 12)
    expect(lambertPhase(Math.PI / 2)).toBeCloseTo(1 / Math.PI, 12)
    expect(discMeanValue(0.39, 1, 0)).toBeCloseTo(0.39 * DISPLAY_GAIN * 2 / 3, 12)
  })

  it('a disc\'s light is its area at its value, but for the rim the toe darkens', () => {
    // Large: the rim is a small part.
    expect(discFlux(50, 0.4) / (Math.PI * 2500 * n(0.4))).toBeCloseTo(1, 1)
    // A pixel across: under its area at its mean, the rim's pixels dimmer.
    expect(discFlux(0.9, 0.4)).toBeLessThan(Math.PI * 0.81 * n(0.4))
    expect(discFlux(0.9, 0.4)).toBeGreaterThan(0.5 * Math.PI * 0.81 * n(0.4))
    // Continuous and growing with the radius.
    let prev = 0
    for (let r = 0.1; r < 30; r *= 1.1) {
      const f = discFlux(r, 0.4)
      expect(f).toBeGreaterThan(prev)
      prev = f
    }
    expect(discFlux(0, 0.4)).toBe(0)
    expect(discFlux(1, 0)).toBe(0)
  })

  it('carries the disc\'s light where the mesh takes over, the marker\'s far off, and blends between', () => {
    const p = {marker: 1, radiusPx: 0.89, value: 0.41, pointPx: 2}
    // Mars at its arrival exposure, at the hand-off: the disc's light over
    // the point's 4 px, not the marker's white (7 times brighter).
    const atHandoff = farPointLevel({...p, ratio: 1})
    expect(atHandoff * 4).toBeCloseTo(discFlux(0.89, 0.41), 9)
    expect(atHandoff).toBeLessThan(0.3)
    expect(farPointLevel({...p, ratio: POINT_HANDOFF_RANGE})).toBeCloseTo(1, 12)
    expect(farPointLevel({...p, ratio: 100})).toBeCloseTo(1, 12)
    let prev = atHandoff
    for (let r = 1.1; r < POINT_HANDOFF_RANGE; r *= 1.1) {
      const l = farPointLevel({...p, ratio: r})
      expect(l).toBeGreaterThanOrEqual(prev)
      expect(l - prev).toBeLessThan(0.1)
      prev = l
    }
    // A moon's marker; a disc brighter than the point can be is white.
    expect(farPointLevel({...p, marker: MOON_POINT_LEVEL, ratio: 10})).toBeCloseTo(MOON_POINT_LEVEL, 12)
    expect(farPointLevel({...p, value: 1e6, ratio: 1})).toBe(1)
  })

  it('the hand-off is where the planet LOD switches', () => {
    setDrawingBuffer(640, 1)
    const camera = new PerspectiveCamera(45, 1.5, 1, 1e20)
    const r = JUPITER_RADIUS
    expect(handoffRatio(pointSwitchDistance(r) * meshReach(), r, camera)).toBeCloseTo(1, 12)
    camera.fov = 1
    expect(handoffRatio(pointSwitchDistance(r) * meshReach() / fovScale(camera), r, camera)).toBeCloseTo(1, 12)
    // And the LOD agrees: the point just past it, the mesh just short.
    const lod = new FovLOD({drawnSize: true})
    lod.addLevel(new Object3D(), 1)
    lod.addLevel(new Object3D(), pointSwitchDistance(r))
    for (const [k, level] of [[1.01, 1], [0.99, 0]]) {
      camera.position.set(0, 0, k * pointSwitchDistance(r) * meshReach() / fovScale(camera))
      camera.updateMatrixWorld()
      lod.update(camera)
      expect(lod.getCurrentLevel()).toBe(level)
    }
  })
})
