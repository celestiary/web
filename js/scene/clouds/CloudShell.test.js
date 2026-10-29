import {afterEach, describe, expect, it} from 'bun:test'
import {PerspectiveCamera} from 'three'
import {clearCredits, getCredits, hasCredit, CREDIT_GRACE_FRAMES} from '../../credits.js'
import {GIBS_CREDIT, GIBS_CREDIT_ID, creditGibs} from '../gibs.js'
import {CLOUD_HEIGHT_M, CREDIT_MIN_PX, cloudsCredited, newCloudShell} from './CloudShell.js'


const EARTH_M = 6371e3


describe('NASA GIBS\'s credit', () => {
  afterEach(() => clearCredits())

  it('gives GIBS\'s credit short in the footer, linked to GIBS\'s page, on arrival then fading', () => {
    expect(GIBS_CREDIT.text).toBe('Imagery: NASA GIBS / ESDIS')
    expect(GIBS_CREDIT.href).toBe('https://earthdata.nasa.gov/gibs')
    creditGibs('clouds', true)
    expect(getCredits()[0]).toMatchObject({id: GIBS_CREDIT_ID, persistence: 'timed'})
  })

  it('credits the clouds drawn big enough to see, the shell\'s or the volume\'s', () => {
    const r = EARTH_M + CLOUD_HEIGHT_M
    // From the Moon, 600 px high at 45°: Earth's disc is ~25 px across.
    expect(cloudsCredited(r, 3.84e8, 45, 600, 1, 0)).toBe(true)
    // From Jupiter: a pixel.
    expect(cloudsCredited(r, 6.3e11, 45, 600, 1, 0)).toBe(false)
    // At the disc's threshold.
    const at = r / Math.sin(CREDIT_MIN_PX / 600 * Math.PI / 4)
    expect(cloudsCredited(r, at * 0.99, 45, 600, 1, 0)).toBe(true)
    expect(cloudsCredited(r, at * 1.01, 45, 600, 1, 0)).toBe(false)
    // Under the deck: the volume's, or none drawn.
    expect(cloudsCredited(r, EARTH_M + 100, 60, 600, 0, 0.5)).toBe(true)
    expect(cloudsCredited(r, EARTH_M + 100, 60, 600, 0, 0)).toBe(false)
  })

  it('follows the shell: in while it draws a GIBS day, out after a grace when it doesn\'t', () => {
    const map = {texture: null, fromGibs: false, update: () => {}, drawn: () => {}, gain: () => 1}
    let ready = true
    const shell = newCloudShell(EARTH_M, map, {ready: () => ready})
    shell.updateMatrixWorld()
    const camera = new PerspectiveCamera(45, 1.5, 1, 1e12)
    camera.position.set(0, 0, 4e7)
    camera.updateMatrixWorld()
    const renderer = {domElement: {clientHeight: 600}}
    const scene = {getObjectByName: () => null}
    const time = {simTime: 0}
    // A frame: the animation's callback, then the render (three calls
    // onBeforeRender only for a shell it draws).
    const frame = () => {
      shell.preAnimCb(time)
      if (shell.visible) {
        shell.onBeforeRender(renderer, scene, camera)
      }
    }
    // The bundled clouds, or none yet: no credit.
    frame()
    frame()
    expect(hasCredit(GIBS_CREDIT_ID)).toBe(false)
    // A day from GIBS lands.
    map.fromGibs = true
    frame()
    frame()
    expect(hasCredit(GIBS_CREDIT_ID)).toBe(true)
    // The clouds turned off ('i'): out once the grace has passed.
    ready = false
    for (let i = 0; i <= CREDIT_GRACE_FRAMES; i++) {
      expect(hasCredit(GIBS_CREDIT_ID)).toBe(true)
      frame()
    }
    expect(hasCredit(GIBS_CREDIT_ID)).toBe(false)
    // Back on, but Earth far off: still none.
    ready = true
    camera.position.set(0, 0, 6e11)
    camera.updateMatrixWorld()
    frame()
    frame()
    expect(hasCredit(GIBS_CREDIT_ID)).toBe(false)
  })
})
