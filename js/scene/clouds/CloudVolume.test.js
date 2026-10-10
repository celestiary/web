import {
  CLOUD_HEIGHT_M, FAR_FIELD_FADE_M, SHELL_FADE_M, VOLUME_FADE_M, farFieldOpacity, shellOpacity,
} from './CloudShell.js'
import {DEFAULT_SCALE, cloudOptions, volumeShare} from './CloudVolume.js'


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
