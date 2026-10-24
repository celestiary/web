import {describe, expect, it} from 'bun:test'
import {BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3} from 'three'
import {buildOccluder, discRays, rayHits, sunBlocked} from './modelOccluder.js'


// The Sun's disc from 1 AU, radians.
const DISC = 4.65e-3


/**
 * @param {number} size
 * @returns {Group} A model: a square sheet `size` metres across, facing +Z
 *   (one-sided, as JWST's sunshield is), at its origin
 */
function sheet(size) {
  const root = new Group
  root.add(new Mesh(new PlaneGeometry(size, size), new MeshStandardMaterial))
  return root
}


describe('modelOccluder', () => {
  it('marks every triangle in a grid in the root\'s frame, small parts too', () => {
    const root = new Group
    const big = new Mesh(new PlaneGeometry(10, 10), new MeshStandardMaterial)
    const small = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshStandardMaterial)
    big.position.set(0, 5, 0)
    small.position.set(4, -2, 0)
    root.add(big, small)
    // Placed in a scene: the grid is in the model's frame regardless.
    root.position.set(1e11, 0, 0)
    const occ = buildOccluder(root, 64)
    expect(occ.cell).toBeCloseTo(12.05 / 64, 6)
    // The sheet, 5 m up, and the box: both met, and the gap between not.
    expect(rayHits(occ, [0, 5, 5], [0, 0, -1])).toBe(true)
    expect(rayHits(occ, [4, -2, 5], [0, 0, -1])).toBe(true)
    expect(rayHits(occ, [4, -1, 5], [0, 0, -1])).toBe(false)
    expect(buildOccluder(new Group)).toBeNull()
  })

  it('places each instance of an instanced mesh', () => {
    const root = new Group
    const inst = new InstancedMesh(new PlaneGeometry(1, 1), new MeshStandardMaterial, 2)
    inst.setMatrixAt(0, new Matrix4().makeTranslation(-3, 0, 0))
    inst.setMatrixAt(1, new Matrix4().makeTranslation(3, 0, 0))
    root.add(inst)
    const occ = buildOccluder(root)
    expect(rayHits(occ, [3, 0, 5], [0, 0, -1])).toBe(true)
    expect(rayHits(occ, [0, 0, 5], [0, 0, -1])).toBe(false)
  })

  it('a ray meets a triangle from either side, and only ahead of it', () => {
    const occ = buildOccluder(sheet(2))
    expect(rayHits(occ, [0, 0, 5], [0, 0, -1])).toBe(true)
    expect(rayHits(occ, [0, 0, -5], [0, 0, 1])).toBe(true)
    expect(rayHits(occ, [0, 0, 5], [0, 0, 1])).toBe(false)
    expect(rayHits(occ, [1.5, 0, 5], [0, 0, -1])).toBe(false)
    // Edge on, along its plane's normal axis offset: missed; along the
    // plane itself, met (the grid is a cell thick).
    expect(rayHits(occ, [5, 0, 0], [-1, 0, 0])).toBe(true)
    expect(rayHits(occ, [5, 0, 1], [-1, 0, 0])).toBe(false)
  })

  it('casts its rays across the disc, the centre first', () => {
    const dir = new Vector3(0, 0, -1)
    const rays = discRays(dir, DISC)
    expect(rays[0].angleTo(dir)).toBe(0)
    for (const r of rays) {
      expect(r.angleTo(dir)).toBeLessThanOrEqual(DISC * 1.0001)
    }
    expect(rays.length).toBe(31)
  })

  it('hides the whole disc behind the sunshield, half of it past its edge, none beside it', () => {
    // The Sun 1 AU down -Z; the camera 10 m behind a 20 m sheet.
    const sun = new Vector3(0, 0, -1.496e11)
    const root = sheet(20)
    root.updateMatrixWorld(true)
    const occ = buildOccluder(root)
    const behind = sunBlocked(occ, root, new Vector3(0, 0, 10), sun, DISC)
    expect(behind).toEqual({fraction: 1, centre: true})
    // The sheet's edge through the disc's centre, from 200 m, where the
    // disc spans 1.9 m, a dozen of the grid's 16 cm cells (nearer, the disc
    // is inside one cell, and the edge's cell hides all of it or none).
    const edge = sunBlocked(occ, root, new Vector3(10, 0, 200), sun, DISC)
    expect(edge.fraction).toBeGreaterThan(0.3)
    expect(edge.fraction).toBeLessThan(0.7)
    const beside = sunBlocked(occ, root, new Vector3(11, 0, 10), sun, DISC)
    expect(beside.fraction).toBe(0)
  })

  it('follows the model as it turns', () => {
    const sun = new Vector3(0, 0, -1.496e11)
    const root = sheet(20)
    const occ = buildOccluder(root)
    // Edge on to the Sun, the camera half a metre off its plane: nothing hidden.
    const cam = new Vector3(0.5, 0, 10)
    root.rotation.y = Math.PI / 2
    root.updateMatrixWorld(true)
    expect(sunBlocked(occ, root, cam, sun, DISC).fraction).toBe(0)
    root.rotation.y = 0
    root.updateMatrixWorld(true)
    expect(sunBlocked(occ, root, cam, sun, DISC).fraction).toBe(1)
  })
})
