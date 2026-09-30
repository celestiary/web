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
import {OVERLAY_LAYER} from '../shared.js'
import {
  MOON_POINT_LEVEL,
  MOON_POINT_PX,
  PLANET_POINT_PX,
  POINT_AT_RADII,
  farPointColor,
  farPointOptions,
  newFarPoint,
  pointSwitchDistance,
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
