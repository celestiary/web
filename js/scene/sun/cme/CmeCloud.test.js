import {describe, expect, it} from 'bun:test'
import {Color, Vector3} from 'three'
import {CME_DEPS} from '../SunLayers.js'
import {GRAMS_PER_ELECTRON, SUN_RADIUS_CM, THOMSON_CM2} from '../corona.js'
import {MAX_CMES} from '../limits.js'
import {MAX_HEIGHT, PUFF_SCALE, cmeCloud, detailCount, targetSizes} from './CmeCloud.js'
import {SEGMENTS, STRANDS} from './cmeModel.js'


const {CmeCloud, electronFactor} = cmeCloud(CME_DEPS)


/** @returns {object} A renderer that records what is asked of it */
function stubRenderer() {
  const calls = []
  const scene = {width: 1920, height: 1080, name: 'scene'}
  const state = {target: scene, color: new Color(0x102030), alpha: 0.5}
  return {
    calls,
    state,
    scene,
    autoClear: true,
    getRenderTarget: () => state.target,
    setRenderTarget(target) {
      state.target = target
      calls.push(['target', target?.name ?? `${target.width}x${target.height}`])
    },
    getDrawingBufferSize: (v) => v.set(1920, 1080),
    getClearAlpha: () => state.alpha,
    getClearColor: (c) => c.copy(state.color),
    setClearColor(c, alpha) {
      state.color = new Color(c)
      state.alpha = alpha
    },
    clear() {
      calls.push(['clear', state.color.getHex(), state.alpha, this.autoClear])
    },
    render(s) {
      calls.push(['render', s.children.filter((m) => m.visible).length])
    },
  }
}


const camera = {projectionMatrix: {elements: Object.assign(new Array(16).fill(0), {5: 1 / Math.tan(4.5 * Math.PI / 180)})}}
const item = (front, mass = 1e15) => ({
  cme: {launch: 1.7e12, front, speed: 450, width: 0.44, mass, source: {lat: 10, lon: 20}},
  d: new Vector3(1, 0, 0), east: new Vector3(0, 0, -1), north: new Vector3(0, 1, 0),
})
const view = {sunCentre: new Vector3(0, 0, -35), radius: 6.957e8, seed: 0, ms: 1.7e12 + 3.6e6}


describe('the CMEs\' particles', () => {
  it('scatter as their electrons do: the factor on a particle\'s column', () => {
    const electrons = 1e15 / GRAMS_PER_ELECTRON
    expect(electrons).toBeGreaterThan(5e38)
    expect(electronFactor(1e15)).toBeCloseTo(
        3 * THOMSON_CM2 * electrons / (16 * Math.sqrt(2 * Math.PI) * (SUN_RADIUS_CM ** 2)), 20)
    // A number a float32 holds, where the electrons themselves aren't.
    expect(electronFactor(1e15)).toBeGreaterThan(4e-9)
    expect(electronFactor(1e15)).toBeLessThan(7e-9)
    expect(electronFactor(2e15)).toBeCloseTo(2 * electronFactor(1e15), 18)
  })

  it('are drawn fewer when the CME is small on screen, never under a fifth of them', () => {
    expect(detailCount(1000, 1900)).toBe(1900)
    expect(detailCount(260, 1900)).toBe(1900)
    expect(detailCount(130, 1900)).toBe(950)
    expect(detailCount(5, 1900)).toBe(380)
  })

  it('have two targets: the threads\' the frame\'s to 900 px, the puffs\' a quarter of it', () => {
    expect(targetSizes(960, 540)).toEqual({threads: [960, 540], puffs: [240, 135]})
    const big = targetSizes(3840, 2160)
    expect(big.threads).toEqual([1600, MAX_HEIGHT])
    expect(big.puffs).toEqual([1600 * PUFF_SCALE, MAX_HEIGHT * PUFF_SCALE])
  })

  it('are a ribbon a thread and a quad a puff, a mesh of each for every CME drawn at once', () => {
    const cloud = new CmeCloud
    expect(cloud.threads.meshes.length).toBe(MAX_CMES)
    expect(cloud.puffs.meshes.length).toBe(MAX_CMES)
    const ribbon = cloud.threads.meshes[0].geometry
    expect(ribbon.getAttribute('position').count).toBe(2 * (SEGMENTS + 1))
    expect(ribbon.getIndex().count).toBe(6 * SEGMENTS)
    expect(ribbon.getAttribute('aPath').count).toBe(STRANDS[0] + STRANDS[2])
    const quad = cloud.puffs.meshes[0].geometry
    expect(quad.getAttribute('position').count).toBe(4)
    expect(quad.getAttribute('aPath').count).toBe(STRANDS[1])
    // The attributes are shared; the counts drawn are each mesh's own.
    expect(cloud.threads.meshes[1].geometry.getAttribute('aPath')).toBe(ribbon.getAttribute('aPath'))
    expect(cloud.threads.meshes[1].geometry).not.toBe(ribbon)
    cloud.dispose()
  })
})


describe('the CMEs\' pass', () => {
  it('draws both targets cleared to nothing, and leaves the renderer as it found it', () => {
    const cloud = new CmeCloud
    const renderer = stubRenderer()
    const drawn = cloud.render(renderer, camera, [item(3.6), item(12)], view)
    expect(renderer.calls).toEqual([
      ['target', '1600x900'],
      ['clear', 0, 0, false],
      ['render', 2],
      ['target', '400x225'],
      ['clear', 0, 0, false],
      ['render', 2],
      ['target', 'scene'],
    ])
    expect(renderer.state.target).toBe(renderer.scene)
    expect(renderer.state.color.getHex()).toBe(0x102030)
    expect(renderer.state.alpha).toBe(0.5)
    expect(renderer.autoClear).toBe(true)
    expect(drawn.threads).toBe(cloud.threads.target.texture)
    expect(drawn.puffs).toBe(cloud.puffs.target.texture)
    cloud.dispose()
  })

  it('gives each CME its frame, its shape, its electrons and its count', () => {
    const cloud = new CmeCloud
    // A CME just off the surface, 200 px in radius on this frame, and one 1,700.
    cloud.render(stubRenderer(), camera, [item(1.2), item(0.3 * 35, 4e15)], view)
    expect(cloud.shapes.length).toBe(2)
    const [near, far] = cloud.threads.meshes
    const u = near.material.uniforms
    // An orthonormal frame, outward the CME's own direction.
    expect(u.uD.value.toArray()).toEqual([1, 0, 0])
    expect(u.uT.value.length()).toBeCloseTo(1, 9)
    expect(u.uT.value.dot(u.uD.value)).toBeCloseTo(0, 9)
    expect(u.uB.value.clone().sub(u.uD.value.clone().cross(u.uT.value)).length()).toBeCloseTo(0, 9)
    expect(u.uShape.value.y).toBeCloseTo(cloud.shapes[0].H, 6)
    expect(u.uSunCentre.value.z).toBe(-35)
    expect(u.uLight.value.x).toBeCloseTo(electronFactor(1e15), 15)
    expect(far.material.uniforms.uLight.value.x).toBeCloseTo(electronFactor(4e15), 15)
    // Half the target in pixels, and pixels a radius at a depth of one.
    expect(u.uScreen.value.x).toBe(800)
    expect(u.uScreen.value.y).toBe(450)
    expect(u.uScreen.value.z).toBeCloseTo(450 / Math.tan(4.5 * Math.PI / 180), 6)
    expect(cloud.puffs.meshes[0].material.uniforms.uScreen.value.y).toBeCloseTo(112.5, 6)
    // The larger on screen is drawn with more of its particles, and each
    // with the share scale that keeps its light whole.
    const count = (mesh) => mesh.geometry.instanceCount
    expect(count(far)).toBeGreaterThan(count(near))
    for (const mesh of [near, far]) {
      expect(mesh.material.uniforms.uLight.value.y).toBeCloseTo(cloud.threads.count / count(mesh), 9)
    }
    // The rest aren't drawn.
    expect(cloud.threads.meshes.filter((m) => m.visible).length).toBe(2)
    expect(cloud.puffs.meshes.filter((m) => m.visible).length).toBe(2)
    cloud.render(stubRenderer(), camera, [], view)
    expect(cloud.threads.meshes.filter((m) => m.visible).length).toBe(0)
    cloud.dispose()
  })

  it('leaves out a CME the camera is inside: nearer the star than its front, in its direction', () => {
    const cloud = new CmeCloud
    const visible = () => cloud.threads.meshes.map((m) => m.visible).slice(0, 2)
    // The camera is 35 radii out on +z (the star at −35 in view space).
    const toward = {...item(38), d: new Vector3(0, 0, 1)}
    const away = {...item(38), d: new Vector3(0, 0, -1)}
    const short = {...item(20), d: new Vector3(0, 0, 1)}
    cloud.render(stubRenderer(), camera, [toward, away], view)
    expect(visible()).toEqual([false, true])
    expect(cloud.puffs.meshes[0].visible).toBe(false)
    cloud.render(stubRenderer(), camera, [short, toward], view)
    expect(visible()).toEqual([true, false])
    cloud.dispose()
  })
})
