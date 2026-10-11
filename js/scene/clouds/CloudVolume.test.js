import {
  CLOUD_HEIGHT_M, FAR_FIELD_FADE_M, SHELL_FADE_M, VOLUME_FADE_M, farFieldOpacity, shellOpacity,
} from './CloudShell.js'
import {Matrix3, Vector3, Vector4} from 'three'
import {
  DEFAULT_SCALE, MOVING_FRAMES, STILL_EYE_M, STILL_FRAMES, STILL_ROTATION, STILL_SUN_RAD, cloudOptions, historyFrames,
  inputsUnchanged, volumeShare,
} from './CloudVolume.js'


describe('volumeShare and shellOpacity', () => {
  const at = (overDeck) => CLOUD_HEIGHT_M + overDeck

  it('bring the volume in over the whole shell, then take the shell out from under it', () => {
    const [top, mid] = VOLUME_FADE_M
    const [, bottom] = SHELL_FADE_M
    expect(mid).toBe(SHELL_FADE_M[0])
    expect([top, bottom]).toEqual(FAR_FIELD_FADE_M)
    // Above the band: the shell alone.
    expect(volumeShare(at(top + 1))).toBe(0)
    expect(shellOpacity(at(top + 1), 1)).toBe(1)
    // The upper half: the volume comes in, the shell stays whole.
    const upper = at((top + mid) / 2)
    expect(volumeShare(upper)).toBeCloseTo(0.5, 12)
    expect(shellOpacity(upper, 1)).toBe(1)
    // Where they meet: both whole.
    expect(volumeShare(at(mid))).toBe(1)
    expect(shellOpacity(at(mid), 1)).toBe(1)
    // The lower half: the shell goes, the volume stays.
    const lower = at((mid + bottom) / 2)
    expect(volumeShare(lower)).toBe(1)
    expect(shellOpacity(lower, 1)).toBeCloseTo(0.5, 12)
    // Under the band: the volume alone.
    expect(volumeShare(at(bottom - 1))).toBe(1)
    expect(shellOpacity(at(bottom - 1), 1)).toBe(0)
    expect(volumeShare(0)).toBe(1)
  })

  it('leave the shell its old fade while the volume is not ready', () => {
    for (const h of [at(30000), at(20000), at(14000), at(8000), at(4000), 0]) {
      expect(shellOpacity(h, 0)).toBe(farFieldOpacity(h))
    }
    // Half ready: halfway between the two.
    const h = at(8000)
    expect(shellOpacity(h, 0.5)).toBeCloseTo((farFieldOpacity(h) + shellOpacity(h, 1)) / 2, 12)
  })
})


describe('cloudOptions', () => {
  it('reads the page\'s clouds options', () => {
    expect(cloudOptions('')).toEqual({off: false, scale: DEFAULT_SCALE, noTemporal: false})
    expect(cloudOptions('?clouds=off')).toMatchObject({off: true})
    expect(cloudOptions('?clouds=full').scale).toBe(1)
    expect(cloudOptions('?clouds=quarter').scale).toBe(0.25)
    expect(cloudOptions('?perf=1&clouds=notemporal,full')).toMatchObject({noTemporal: true, scale: 1, off: false})
    expect(cloudOptions(undefined).off).toBe(false)
  })
})


describe('historyFrames', () => {
  it('accumulates a still view toward the mean, and caps a changing one at the exponential window', () => {
    expect(historyFrames(50, false, false)).toBe(0)
    // Still: n grows by one a frame, so the blend's weight n / (n + 1)
    // is 0, 1/2, 2/3, ... the running mean.
    let n = 0
    for (let i = 0; i < 5; i++) {
      n = historyFrames(n, false, true)
      expect(n).toBe(i + 1)
    }
    expect(historyFrames(STILL_FRAMES - 1, false, true)).toBe(STILL_FRAMES)
    expect(historyFrames(STILL_FRAMES, false, true)).toBe(STILL_FRAMES)
    // Changing: capped at MOVING_FRAMES, a weight of 0.9.
    expect(historyFrames(MOVING_FRAMES - 1, true, true)).toBe(MOVING_FRAMES)
    expect(historyFrames(MOVING_FRAMES, true, true)).toBe(MOVING_FRAMES)
    expect(MOVING_FRAMES / (MOVING_FRAMES + 1)).toBeCloseTo(0.9, 12)
    // A converged still history re-enters the window at its weight, not at zero.
    expect(historyFrames(STILL_FRAMES, true, true)).toBe(MOVING_FRAMES)
  })
})


describe('inputsUnchanged', () => {
  const tables = {atmos: {}, transmittance: {}, multiScatter: {}}
  const inputs = (over = {}) => ({
    eye: new Vector3(6371472, 0, 0), sun: new Vector3(0.6, 0.8, 0), viewToBody: new Matrix3(), proj: new Vector4(1, 2, 0, 0),
    opacity: 1, map: 3, width: 735, height: 418, atmosphere: {...tables}, ...over,
  })

  it('is the same view within the tolerances', () => {
    const a = inputs()
    expect(inputsUnchanged(a, inputs())).toBe(true)
    expect(inputsUnchanged(a, inputs({eye: new Vector3(6371472 + (STILL_EYE_M / 2), 0, 0)}))).toBe(true)
    expect(inputsUnchanged(a, inputs({sun: new Vector3(0.6, 0.8, STILL_SUN_RAD / 2)}))).toBe(true)
    const turned = new Matrix3()
    turned.elements[1] = STILL_ROTATION / 2
    expect(inputsUnchanged(a, inputs({viewToBody: turned}))).toBe(true)
  })

  it('is a changed view past them, or for any other input', () => {
    const a = inputs()
    expect(inputsUnchanged(a, inputs({eye: new Vector3(6371472 + (STILL_EYE_M * 2), 0, 0)}))).toBe(false)
    expect(inputsUnchanged(a, inputs({sun: new Vector3(0.6, 0.8, STILL_SUN_RAD * 2)}))).toBe(false)
    const turned = new Matrix3()
    turned.elements[5] = STILL_ROTATION * 2
    expect(inputsUnchanged(a, inputs({viewToBody: turned}))).toBe(false)
    expect(inputsUnchanged(a, inputs({proj: new Vector4(1, 2.1, 0, 0)}))).toBe(false)
    expect(inputsUnchanged(a, inputs({opacity: 0.5}))).toBe(false)
    expect(inputsUnchanged(a, inputs({map: 4}))).toBe(false)
    expect(inputsUnchanged(a, inputs({width: 736}))).toBe(false)
    expect(inputsUnchanged(a, inputs({atmosphere: {...tables, multiScatter: {}}}))).toBe(false)
  })
})
