import {describe, expect, it} from 'bun:test'
import {Group, Vector3} from 'three'
import PixelMarker, {pixelMarkerSize} from './PixelMarker.js'
import {OVERLAY_LAYER} from '../../shared.js'
import {NAKED_EYE, RUBIN, instrumentFieldRange} from '../observer/instrument.js'
import {sceneReferred} from '../hdr.js'


const deps = {sceneReferred, OVERLAY_LAYER}


describe('pixelMarkerSize', () => {
  it('is the angle\'s fraction of the screen: angle over field, times height', () => {
    // 0.2″ in a 1° field over 1,000 px: 0.2 / 3600 / 1 × 1000 = 0.0556 px.
    const wide = pixelMarkerSize(1, 1000, 0.2)
    expect(wide.opacity).toBeCloseTo(0.2 / 3600 * 1000, 9)
    // Held to one pixel, so it never draws under it.
    expect(wide.sidePx).toBe(1)
  })

  it('is one full pixel at the instrument\'s pixel limit, for any canvas', () => {
    for (const h of [500, 1000, 1758]) {
      const {minDeg} = instrumentFieldRange(RUBIN, h)
      const {sidePx, opacity} = pixelMarkerSize(minDeg, h, RUBIN.pixelScaleArcsec)
      expect(sidePx).toBeCloseTo(1, 9)
      expect(opacity).toBeCloseTo(1, 9)
    }
  })

  it('fades with the fraction while wider than that, and grows while narrower', () => {
    const h = 1000
    const limit = RUBIN.pixelScaleArcsec / 3600 * h
    const half = pixelMarkerSize(limit * 2, h, RUBIN.pixelScaleArcsec)
    expect(half.sidePx).toBe(1)
    expect(half.opacity).toBeCloseTo(0.5, 9)
    expect(pixelMarkerSize(limit * 8, h, RUBIN.pixelScaleArcsec).opacity).toBeCloseTo(0.125, 9)
    // Narrower, as with the optics off: the side is the pixel's own, opaque.
    const near = pixelMarkerSize(limit / 10, h, RUBIN.pixelScaleArcsec)
    expect(near.sidePx).toBeCloseTo(10, 9)
    expect(near.opacity).toBe(1)
  })

  it('draws the resolution 3.5 pixels across at the limit, opaque out to 3.5 times that field', () => {
    const h = 500
    const {minDeg} = instrumentFieldRange(RUBIN, h)
    const res = pixelMarkerSize(minDeg, h, RUBIN.resolutionArcsec)
    expect(res.sidePx).toBeCloseTo(3.5, 9)
    expect(res.opacity).toBe(1)
    expect(pixelMarkerSize(minDeg * 3.5, h, RUBIN.resolutionArcsec).opacity).toBeCloseTo(1, 9)
    expect(pixelMarkerSize(minDeg * 7, h, RUBIN.resolutionArcsec).opacity).toBeCloseTo(0.5, 9)
  })

  it('is nothing for an angle, field or canvas that isn\'t positive', () => {
    expect(pixelMarkerSize(1, 1000, 0)).toEqual({sidePx: 1, opacity: 0})
    expect(pixelMarkerSize(0, 1000, 0.2)).toEqual({sidePx: 1, opacity: 0})
    expect(pixelMarkerSize(1, 0, 0.2)).toEqual({sidePx: 1, opacity: 0})
    expect(pixelMarkerSize(NaN, 1000, 0.2)).toEqual({sidePx: 1, opacity: 0})
  })
})


describe('PixelMarker', () => {
  const make = (view) => new PixelMarker({deps, view: () => ({instrument: RUBIN, fovDeg: 1, heightPx: 1000, ...view})})

  it('is off until switched on, on the overlay layer only, and nothing a pick can hit', () => {
    const marker = make()
    marker.update()
    expect(marker.visible).toBe(false)
    expect(marker.layers.isEnabled(OVERLAY_LAYER)).toBe(true)
    expect(marker.layers.isEnabled(0)).toBe(false)
    expect(marker.raycast()).toBeUndefined()
    marker.dispose()
  })

  it('sizes both squares each frame from the field and the canvas', () => {
    const marker = make({fovDeg: 200 / 3600})
    marker.enabled = true
    marker.preAnimCb(0, 2461000)
    expect(marker.visible).toBe(true)
    const {uSidePx, uOpacity} = marker.material.uniforms
    expect(uSidePx.value.x).toBeCloseTo(1, 9)
    expect(uSidePx.value.y).toBeCloseTo(3.5, 9)
    expect(uOpacity.value.x).toBeCloseTo(1, 9)
    const wide = make({fovDeg: 2})
    wide.enabled = true
    wide.update()
    expect(wide.material.uniforms.uSidePx.value.x).toBe(1)
    expect(wide.material.uniforms.uOpacity.value.x).toBeCloseTo(0.2 / 3600 / 2 * 1000, 9)
    marker.dispose()
    wide.dispose()
  })

  it('is hidden when the instrument has no pixel scale', () => {
    const eye = make({instrument: NAKED_EYE})
    eye.enabled = true
    eye.update()
    expect(eye.visible).toBe(false)
    const none = make({instrument: null})
    none.enabled = true
    none.update()
    expect(none.visible).toBe(false)
    eye.dispose()
    none.dispose()
  })

  it('takes the pixel for the resolution where the instrument has no other', () => {
    const marker = make({instrument: {pixelScaleArcsec: 1, resolutionArcsec: null}, heightPx: 3600})
    marker.enabled = true
    marker.update()
    const {uSidePx} = marker.material.uniforms
    expect(uSidePx.value.x).toBeCloseTo(1, 9)
    expect(uSidePx.value.y).toBeCloseTo(1, 9)
    marker.dispose()
  })

  it('sits at its parent\'s place, so it follows the body Animation moves', () => {
    const parent = new Group
    const marker = make()
    parent.add(marker)
    parent.position.set(1e12, 2e11, -3e12)
    parent.updateMatrixWorld(true)
    expect(marker.getWorldPosition(new Vector3).toArray()).toEqual([1e12, 2e11, -3e12])
    marker.dispose()
    expect(marker.parent).toBe(null)
  })
})
