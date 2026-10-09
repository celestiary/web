import {describe, expect, it} from 'bun:test'
import {PerspectiveCamera, Vector3} from 'three'
import {newCameraGoToTween} from './camera.js'


describe('newCameraGoToTween', () => {
  it('says how far along the way the camera is: what the exposure follows on the way', () => {
    const camera = new PerspectiveCamera(45, 1, 1, 1e12)
    camera.position.set(0, 0, 1000)
    const end = new Vector3(0, 0, 100)
    const tween = newCameraGoToTween(camera, new Vector3(0, 0, 0), end)
    // tween.js's own start time (the tween starts itself).
    const start = tween.getStartTime?.() ?? tween._startTime
    expect(tween.travels).toBe(true)
    expect(tween.travelProgress()).toBe(0)
    // Turning first: the camera hasn't moved, and the progress is nil.
    tween.update(start + (0.3 * 1800))
    expect(tween.travelProgress()).toBe(0)
    expect(camera.position.z).toBeCloseTo(1000, 6)
    // Halfway along the position channel (40-100% of the tween).
    tween.update(start + (0.7 * 1800))
    expect(tween.travelProgress()).toBeCloseTo(0.5, 9)
    expect(camera.position.z).toBeCloseTo(550, 6)
    // The progress is the fraction of the way the camera has come.
    tween.update(start + (0.85 * 1800))
    const p = tween.travelProgress()
    expect(camera.position.z).toBeCloseTo(1000 - (900 * p), 6)
    tween.update(start + 1800)
    expect(tween.travelProgress()).toBe(1)
    expect(camera.position.z).toBeCloseTo(100, 6)
  })
})
