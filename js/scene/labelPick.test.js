import {Group, PerspectiveCamera, Points} from 'three'
import {LABEL_SLOP_PX, hitLabel, labelBoxes} from './labelPick.js'


const RECT = {left: 0, top: 0, width: 800, height: 600}


/**
 * @param {Array<Array<number>>} labels [x, y, z, side, textWidth, textHeight] each
 * @param {Array<object>} targets
 * @returns {Points} A label sheet's sprites, as SpriteSheet.compile tags them
 */
function labelPoints(labels, targets) {
  const points = new Points()
  points.userData.sheet = {
    labelCount: labels.length,
    positions: labels.flatMap(([x, y, z]) => [x, y, z]),
    sizes: labels.flatMap(([, , , side]) => [side, side]),
    textSizes: labels.flatMap(([, , , , w, h]) => [w, h]),
    _posLow: null,
  }
  points.userData.labelTargets = targets
  return points
}


/** @returns {PerspectiveCamera} At z = 10, looking down -z at the origin */
function camera() {
  const cam = new PerspectiveCamera(45, RECT.width / RECT.height, 0.1, 1000)
  cam.position.set(0, 0, 10)
  cam.updateMatrixWorld()
  return cam
}


describe('labelBoxes', () => {
  it('puts a label\'s text along the top of its square, centred on its position', () => {
    const root = new Group()
    root.add(labelPoints([[0, 0, 0, 100, 100, 20]], [{kind: 'body', name: 'earth'}]))
    const [box] = labelBoxes(root, camera(), RECT)
    expect(box.left).toBeCloseTo(350)
    expect(box.top).toBeCloseTo(250)
    expect(box.width).toBe(100)
    expect(box.height).toBe(20)
    expect(box.target).toEqual({kind: 'body', name: 'earth'})
  })

  it('scales device px to CSS px, and offsets by the canvas on screen', () => {
    const root = new Group()
    root.add(labelPoints([[0, 0, 0, 100, 100, 20]], [{name: 'a'}]))
    const [box] = labelBoxes(root, camera(), {...RECT, left: 10, top: 20}, 2)
    expect(box.left).toBeCloseTo(385)
    expect(box.top).toBeCloseTo(295)
    expect(box.width).toBe(50)
    expect(box.height).toBe(10)
  })

  it('leaves out hidden labels, ones behind the camera, untargeted sheets and labels', () => {
    const root = new Group()
    const hidden = new Group()
    hidden.visible = false
    hidden.add(labelPoints([[0, 0, 0, 100, 100, 20]], [{name: 'hidden'}]))
    root.add(hidden)
    root.add(labelPoints([[0, 0, 20, 100, 100, 20]], [{name: 'behind'}]))
    root.add(labelPoints([[0, 0, 0, 100, 100, 20]], undefined))
    root.add(labelPoints([[0, 0, 0, 100, 100, 20], [1, 0, 0, 100, 100, 20]], [null, {name: 'shown'}]))
    expect(labelBoxes(root, camera(), RECT).map((b) => b.target.name)).toEqual(['shown'])
  })

  it('places labels through their parents\' transforms', () => {
    const root = new Group()
    const moved = new Group()
    moved.position.set(0, 0, -10) // twice as far: half the offset on screen
    moved.add(labelPoints([[2, 0, 0, 10, 10, 10]], [{name: 'a'}]))
    root.add(moved)
    const near = labelBoxes(new Group().add(labelPoints([[2, 0, 0, 10, 10, 10]], [{name: 'b'}])), camera(), RECT)[0]
    const far = labelBoxes(root, camera(), RECT)[0]
    expect((far.left + 5) - 400).toBeCloseTo(((near.left + 5) - 400) / 2)
  })
})


describe('hitLabel', () => {
  const box = (left, top, name, depth = 0) => ({left, top, width: 100, height: 20, depth, target: {name}})

  it('hits within a label\'s text, give or take the slop', () => {
    const boxes = [box(350, 250, 'a')]
    expect(hitLabel(400, 260, boxes)).toEqual({name: 'a'})
    expect(hitLabel(350 - LABEL_SLOP_PX, 250 - LABEL_SLOP_PX, boxes)).toEqual({name: 'a'})
    expect(hitLabel(350 - LABEL_SLOP_PX - 1, 260, boxes)).toBe(null)
    expect(hitLabel(400, 270 + LABEL_SLOP_PX + 1, boxes)).toBe(null)
    expect(hitLabel(400, 260, [])).toBe(null)
  })

  it('takes the label whose centre is nearest, then the nearer one', () => {
    expect(hitLabel(400, 265, [box(350, 250, 'a'), box(350, 256, 'b')])).toEqual({name: 'b'})
    expect(hitLabel(400, 262, [box(350, 250, 'a'), box(350, 256, 'b')])).toEqual({name: 'a'})
    expect(hitLabel(400, 260, [box(350, 250, 'far', 0.9), box(350, 250, 'near', 0.5)])).toEqual({name: 'near'})
  })
})
