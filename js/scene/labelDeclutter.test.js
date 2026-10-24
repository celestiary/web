import {describe, expect, it} from 'bun:test'
import {Group, PerspectiveCamera, Points} from 'three'
import {
  BODY_RANK, bodyRank, boxesTouch, byImportance, declutter, declutterLabels, isTargetLabel, placeRank,
  showAllLabels,
} from './labelDeclutter.js'
import {labelBoxes} from './labelPick.js'


const RECT = {left: 0, top: 0, width: 800, height: 600}
const box = (left, top, width = 60, height = 12) => ({left, top, width, height})


describe('ranks', () => {
  it('orders bodies by radius, and puts any body above any place', () => {
    const jupiter = bodyRank(6.9911e7)
    const ganymede = bodyRank(2.634e6)
    const io = bodyRank(1.821e6)
    const tinyMoon = bodyRank(1e3)
    expect(jupiter).toBeGreaterThan(ganymede)
    expect(ganymede).toBeGreaterThan(io)
    expect(tinyMoon).toBeGreaterThan(placeRank(0, 0, 1))
    expect(tinyMoon).toBeGreaterThan(BODY_RANK)
  })

  it('orders places by tier, then by their order in the tier (largest first)', () => {
    expect(placeRank(0, 5, 10)).toBeGreaterThan(placeRank(1, 0, 10))
    expect(placeRank(2, 0, 10)).toBeGreaterThan(placeRank(2, 1, 10))
    expect(placeRank(3, 9, 10)).toBeGreaterThan(0)
    expect(placeRank(0, 0, 1)).toBeLessThan(BODY_RANK)
  })
})


describe('isTargetLabel', () => {
  const body = {kind: 'body', name: 'jupiter'}
  const place = {kind: 'place', body: 'moon', name: 'Tycho'}
  it('is the targeted body\'s name, only while the target is a body', () => {
    expect(isTargetLabel(body, {obj: {props: {name: 'jupiter'}}, label: null})).toBe(true)
    expect(isTargetLabel(body, {obj: {props: {name: 'io'}}, label: null})).toBe(false)
    // A place on Jupiter targeted: its body's name is not the target.
    expect(isTargetLabel(body, {obj: {props: {name: 'jupiter'}}, label: place})).toBe(false)
  })

  it('is the targeted place', () => {
    expect(isTargetLabel(place, {obj: {props: {name: 'moon'}}, label: {...place, lat: 1}})).toBe(true)
    expect(isTargetLabel(place, {obj: null, label: {...place, name: 'Plato'}})).toBe(false)
    expect(isTargetLabel(place, {obj: null, label: null})).toBe(false)
  })

  it('is never a star or asterism label, which don\'t take part', () => {
    expect(isTargetLabel({kind: 'star'}, {obj: null, label: {kind: 'star'}})).toBe(false)
  })
})


describe('boxesTouch', () => {
  it('is true for boxes that overlap or are within the gap', () => {
    expect(boxesTouch(box(0, 0), box(30, 5))).toBe(true)
    expect(boxesTouch(box(0, 0), box(62, 0), 3)).toBe(true)
    expect(boxesTouch(box(0, 0), box(64, 0), 3)).toBe(false)
    expect(boxesTouch(box(0, 0), box(0, 14), 3)).toBe(true)
    expect(boxesTouch(box(0, 0), box(0, 16), 3)).toBe(false)
  })
})


describe('declutter', () => {
  it('asks a box with a pad for that much more room clear', () => {
    // 5 px apart: clear of the gap, not of a 6 px pad as well.
    expect(Array.from(declutter([box(0, 0), {...box(65, 0), pad: 6}]))).toEqual([1, 0])
    expect(Array.from(declutter([box(0, 0), {...box(75, 0), pad: 6}]))).toEqual([1, 1])
    // What a padded box asks of others, not of itself: one after it needs the gap only.
    expect(Array.from(declutter([{...box(0, 0), pad: 6}, box(65, 0)]))).toEqual([1, 1])
  })

  it('draws every label that touches none', () => {
    const boxes = [box(0, 0), box(100, 0), box(0, 100), box(300, 300)]
    expect(Array.from(declutter(boxes))).toEqual([1, 1, 1, 1])
  })

  it('hides a label that touches a more important one, the first of the pair kept', () => {
    expect(Array.from(declutter([box(0, 0), box(20, 4)]))).toEqual([1, 0])
    expect(Array.from(declutter([box(20, 4), box(0, 0)]))).toEqual([1, 0])
  })

  it('judges by what is drawn: a hidden label hides nothing', () => {
    // A touches B, B touches C, A does not touch C: B is hidden, so C stays.
    const boxes = [box(0, 0), box(50, 0), box(100, 0)]
    expect(Array.from(declutter(boxes))).toEqual([1, 0, 1])
  })

  it('finds a touch across the grid\'s cells and off the canvas\'s edge', () => {
    // 96 px cells: these sit either side of x = 96 and of x = 0.
    expect(Array.from(declutter([box(60, 0), box(110, 0, 30)]))).toEqual([1, 0])
    expect(Array.from(declutter([box(-70, -20), box(-30, -14)]))).toEqual([1, 0])
    expect(Array.from(declutter([box(-300, 0), box(300, 0)]))).toEqual([1, 1])
  })

  it('handles a few hundred labels in a cluster, drawing a disjoint subset', () => {
    const boxes = []
    for (let i = 0; i < 400; i++) {
      boxes.push(box((i * 37) % 700, (i * 53) % 560))
    }
    const shown = declutter(boxes)
    const drawn = boxes.filter((_, i) => shown[i])
    expect(drawn.length).toBeGreaterThan(20)
    expect(drawn.length).toBeLessThan(400)
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        expect(boxesTouch(drawn[i], drawn[j])).toBe(false)
      }
    }
    // Greedy: every hidden box touches one drawn before it.
    boxes.forEach((b, i) => {
      if (!shown[i]) {
        expect(boxes.slice(0, i).some((o, j) => shown[j] && boxesTouch(o, b))).toBe(true)
      }
    })
  })
})


describe('byImportance', () => {
  it('puts the target first, then the higher rank, then the nearer', () => {
    const labels = [
      {name: 'far', first: false, rank: 5, depth: 0.9},
      {name: 'near', first: false, rank: 5, depth: 0.1},
      {name: 'big', first: false, rank: 1010, depth: 0.9},
      {name: 'target', first: true, rank: 1, depth: 0.99},
    ]
    expect(labels.sort(byImportance).map((l) => l.name)).toEqual(['target', 'big', 'near', 'far'])
  })
})


/**
 * A label sheet as SpriteSheet gives them, to the extent the declutter uses.
 *
 * @param {Array<Array<number>>} labels [x, y, z] each, the text 100 x 14 px
 * @param {Array<object>} targets
 * @param {Array<number>} ranks
 * @param {object} [userData]
 * @returns {Points}
 */
function labelPoints(labels, targets, ranks, userData = {declutter: true}) {
  const points = new Points()
  const sheet = {
    labelCount: labels.length,
    positions: labels.flatMap(([x, y, z]) => [x, y, z]),
    sizes: labels.flatMap(() => [100, 100]),
    textSizes: labels.flatMap(() => [100, 14]),
    _posLow: null,
    shown: labels.map(() => 1),
    setShown(i, v) {
      const next = v ? 1 : 0
      const changed = this.shown[i] !== next
      this.shown[i] = next
      return changed
    },
  }
  points.userData = {...userData, sheet, labelTargets: targets, labelRank: ranks}
  return points
}


/** @returns {PerspectiveCamera} At z = 10, looking down -z at the origin */
function camera() {
  const cam = new PerspectiveCamera(45, RECT.width / RECT.height, 0.1, 1000)
  cam.position.set(0, 0, 10)
  cam.updateMatrixWorld()
  return cam
}


describe('declutterLabels', () => {
  const jupiter = {kind: 'body', name: 'jupiter'}
  const ganymede = {kind: 'body', name: 'ganymede'}
  const io = {kind: 'body', name: 'io'}

  /** Three bodies' names a few px apart, in the order given. */
  function cluster(order = [jupiter, ganymede, io]) {
    const root = new Group()
    const sheets = order.map((target, i) => {
      const rank = {jupiter: bodyRank(6.9e7), ganymede: bodyRank(2.6e6), io: bodyRank(1.8e6)}[target.name]
      const p = labelPoints([[i * 0.02, 0, 0]], [target], [rank])
      root.add(p)
      return p.userData.sheet
    })
    return {root, sheets}
  }

  it('hides the smaller bodies\' names that touch the larger body\'s', () => {
    const {root, sheets} = cluster()
    const stats = declutterLabels(root, camera(), RECT)
    expect(sheets.map((s) => s.shown[0])).toEqual([1, 0, 0])
    expect(stats).toEqual({labels: 3, hidden: 2, changed: 2})
  })

  it('is by rank, not by order in the scene', () => {
    const {root, sheets} = cluster([io, ganymede, jupiter])
    declutterLabels(root, camera(), RECT)
    expect(sheets.map((s) => s.shown[0])).toEqual([0, 0, 1])
  })

  it('always draws the target\'s, whatever its rank', () => {
    const {root, sheets} = cluster()
    declutterLabels(root, camera(), RECT, {current: {obj: {props: {name: 'io'}}, label: null}})
    expect(sheets.map((s) => s.shown[0])).toEqual([0, 0, 1])
  })

  it('shows a label again once it no longer touches, and reports only changes', () => {
    const {root, sheets} = cluster()
    declutterLabels(root, camera(), RECT)
    expect(declutterLabels(root, camera(), RECT).changed).toBe(0)
    // The camera moves in: the names are far enough apart.
    const near = camera()
    near.position.set(0, 0, 0.12)
    near.updateMatrixWorld()
    declutterLabels(root, near, RECT)
    expect(sheets.map((s) => s.shown[0])).toEqual([1, 1, 1])
  })

  it('changes nothing where labels don\'t touch', () => {
    const root = new Group()
    const p = labelPoints([[-1, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0]],
        ['a', 'b', 'c', 'd'].map((name) => ({kind: 'place', body: 'moon', name})), [4, 3, 2, 1])
    root.add(p)
    const stats = declutterLabels(root, camera(), RECT)
    expect(p.userData.sheet.shown).toEqual([1, 1, 1, 1])
    expect(stats).toEqual({labels: 4, hidden: 0, changed: 0})
  })

  it('leaves out sheets that don\'t opt in, and labels well off the canvas', () => {
    const root = new Group()
    const stars = labelPoints([[0, 0, 0]], [{kind: 'star', name: 'Sirius'}], [0], {})
    const planet = labelPoints([[0, 0, 0], [60, 0, 0]], [jupiter, io], [1010, 1000])
    root.add(stars, planet)
    const stats = declutterLabels(root, camera(), RECT)
    expect(stats.labels).toBe(1) // Io's is far off to the side
    expect(stars.userData.sheet.shown).toEqual([1])
    expect(planet.userData.sheet.shown).toEqual([1, 1])
  })

  it('leaves what is hidden out of a pick, but not out of the declutter', () => {
    const {root, sheets} = cluster()
    declutterLabels(root, camera(), RECT)
    expect(labelBoxes(root, camera(), RECT).map((b) => b.target.name)).toEqual(['jupiter'])
    expect(labelBoxes(root, camera(), RECT, 1, {hidden: true}).length).toBe(3)
    expect(sheets[1].shown[0]).toBe(0)
  })

  it('holds a shown name in place against a higher one that is hidden (declutterHold)', () => {
    // Two satellites' names a few px apart, of one population's sheet.
    const sats = [{kind: 'satellite', id: 1, body: 'earth'}, {kind: 'satellite', id: 2, body: 'earth'}]
    const held = labelPoints([[0, 0, 0], [0.02, 0, 0]], sats, [6, 5.5], {declutter: true, declutterHold: 1})
    const sheet = held.userData.sheet
    // The lower was shown, the higher not (it drifted in from elsewhere).
    sheet.shown = [0, 1]
    sheet.decluttered = true
    const root = new Group()
    root.add(held)
    declutterLabels(root, camera(), RECT)
    expect(sheet.shown).toEqual([0, 1])
    // Without the hold, the higher takes the place back at once: what makes
    // names change down the ranks frame after frame.
    held.userData.declutterHold = 0
    declutterLabels(root, camera(), RECT)
    expect(sheet.shown).toEqual([1, 0])
    // The hold never lifts a satellite's name over a body's.
    held.userData.declutterHold = 1
    const planet = labelPoints([[0.01, 0, 0]], [jupiter], [bodyRank(6.9e7)])
    root.add(planet)
    declutterLabels(root, camera(), RECT)
    expect([planet.userData.sheet.shown[0], ...sheet.shown]).toEqual([1, 0, 0])
  })

  it('asks a hidden name of a holding sheet for room to spare, but not on the sheet\'s first pass', () => {
    const sats = [{kind: 'satellite', id: 1, body: 'earth'}, {kind: 'satellite', id: 2, body: 'earth'}]
    // From z = 10, 1.48 apart is about 107 px: 7 px clear of the other's 100 px box.
    const p = labelPoints([[0, 0, 0], [1.48, 0, 0]], sats, [6, 5.5], {declutter: true, declutterHold: 1})
    const sheet = p.userData.sheet
    sheet.shown = [0, 0]
    const root = new Group()
    root.add(p)
    declutterLabels(root, camera(), RECT)
    expect(sheet.shown).toEqual([1, 1])
    // Hidden once, it needs more than the gap to come back.
    sheet.setShown(1, false)
    declutterLabels(root, camera(), RECT)
    expect(sheet.shown).toEqual([1, 0])
  })

  it('sizes a scaled label\'s box by its scale, so a smaller name takes less room', () => {
    const sats = [{kind: 'satellite', id: 1, body: 'earth'}, {kind: 'satellite', id: 2, body: 'earth'}]
    const p = labelPoints([[0, 0, 0], [1.4, 0, 0]], sats, [6, 5.5], {declutter: true})
    const root = new Group()
    root.add(p)
    declutterLabels(root, camera(), RECT)
    // 1.4 apart, about 101 px: they touch at full size ...
    expect(p.userData.sheet.shown).toEqual([1, 0])
    // ... and not at three quarters.
    p.userData.sheet.scales = [0.75, 0.75]
    declutterLabels(root, camera(), RECT)
    expect(p.userData.sheet.shown).toEqual([1, 1])
    expect(labelBoxes(root, camera(), RECT)[0].width).toBeCloseTo(75, 6)
  })

  it('hides a name behind its body, which then takes no room (labelOccluder)', () => {
    // From z = 10: one name behind a unit sphere at the origin, one in front,
    // at the same spot on screen; the one behind ranked higher.
    const occluder = new Group()
    occluder.bodyRadius = 1
    const sats = [{kind: 'satellite', id: 1, body: 'earth'}, {kind: 'satellite', id: 2, body: 'earth'}]
    const p = labelPoints([[0, 0, -2], [0, 0, 2]], sats, [6, 5.5], {declutter: true})
    const root = new Group()
    root.add(occluder, p)
    declutterLabels(root, camera(), RECT)
    expect(p.userData.sheet.shown).toEqual([1, 0])
    p.userData.labelOccluder = occluder
    const stats = declutterLabels(root, camera(), RECT)
    expect(p.userData.sheet.shown).toEqual([0, 1])
    expect(stats).toEqual({labels: 2, hidden: 1, changed: 2})
    // An eye inside the sphere (on low ground) sees down to its horizon.
    const low = camera()
    low.position.set(0, 0, 0.5)
    low.updateMatrixWorld()
    declutterLabels(root, low, RECT)
    expect(p.userData.sheet.shown[0]).toBe(0)
    // Off to the side, past the limb, it's seen again.
    p.userData.sheet.positions[0] = 3
    declutterLabels(root, camera(), RECT)
    expect(p.userData.sheet.shown).toEqual([1, 1])
  })

  it('draws everything again when switched off', () => {
    const {root, sheets} = cluster()
    declutterLabels(root, camera(), RECT)
    showAllLabels(root)
    expect(sheets.map((s) => s.shown[0])).toEqual([1, 1, 1])
  })
})
