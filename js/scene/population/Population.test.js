import {describe, expect, it} from 'bun:test'
import {Object3D, Vector3} from 'three'
import Population from './Population.js'


/** A label sheet without a canvas. */
class StubSheet {
  /** */
  constructor() {
    this.labels = []
    this.positions = []
    this.positionAttribute = null
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {string} text
   */
  add(x, y, z, text) {
    this.labels.push(text)
    this.positions.push(x, y, z)
  }

  /** @returns {Object3D} */
  compile() {
    const sprites = new Object3D
    sprites.userData.sheet = this
    return sprites
  }
}


const R = 7e6
// A low orbit's rate, rad/s: about 97 minutes a turn.
const W = 2 * Math.PI / (97 * 60)
const JD = 2461337


/**
 * Objects on circles in planes of their own (by id), at a low orbit's
 * radius and rate: where each is at a date, exactly, and how many times
 * its position (`asked`) and its state, to carry it from (`states`), were
 * worked out.
 */
class Circles extends Population {
  /** @param {...any} args */
  constructor(...args) {
    super(...args)
    this.asked = 0
    this.states = 0
  }


  /**
   * @param {...any} args
   * @returns {boolean} Population's, counted
   */
  stateAt(...args) {
    this.states++
    return super.stateAt(...args)
  }

  /**
   * @param {object} rec
   * @param {number} jd
   * @param {Vector3} out
   * @returns {boolean}
   */
  positionAt(rec, jd, out) {
    this.asked++
    const a = (W * (jd - JD) * 86400) + rec.id
    const tilt = rec.id * 0.37
    out.set(R * Math.cos(a), R * Math.sin(a) * Math.sin(tilt), R * Math.sin(a) * Math.cos(tilt))
    return true
  }
}


const circles = (n, groups = {}) => new Circles(Array.from({length: n}, (_, i) =>
  ({id: i + 1, name: `Sat ${i + 1}`, group: i < 10 ? 'a' : 'b', eccentricity: 0})), {body: 'earth', groups,
  Sheet: StubSheet})
const shownCount = (pop) => {
  const show = pop.points.geometry.attributes.aShow
  let n = 0
  for (let i = 0; i < show.count; i++) {
    n += show.getX(i)
  }
  return n
}


describe('Population, a counted group', () => {
  it('shows the first of it in the data\'s order, as many as its count', () => {
    const pop = circles(30, {a: {label: 'A'}, b: {label: 'B', count: 5, orderedBy: 'serial number'}})
    expect(pop.groups()).toEqual([
      {key: 'a', label: 'A', kind: 'a', color: '#c8c8c8', count: 10, shown: true},
      {key: 'b', label: 'B', kind: 'b', color: '#c8c8c8', count: 20, shown: true, limit: 5,
        orderedBy: 'serial number'},
    ])
    pop.update(JD)
    const show = pop.points.geometry.attributes.aShow
    expect(Array.from(show.array.slice(8, 17))).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0])
    expect(pop.maxLabels()).toBe(15)
    // More of it, and the names' budget can reach them; fewer, and it's held to them.
    let changes = 0
    pop.onChange = () => changes++
    pop.setGroupCount('b', 20)
    expect(pop.maxLabels()).toBe(30)
    pop.setLabelBudget(30)
    pop.setGroupCount('b', 2)
    expect(pop.labelBudget).toBe(12)
    expect(changes).toBe(3)
    pop.setGroupCount('b', 99, true)
    expect(pop.groupCount('b')).toBe(20)
    expect(pop.defaultGroupCount('b')).toBe(5)
    // A group without a count shows whole, and has no slider.
    pop.setGroupCount('a', 1)
    expect(pop.groupCount('a')).toBe(10)
    expect(pop.defaultGroupCount('a')).toBeNull()
  })
})


describe('Population, many shown', () => {
  it('works out each exactly while few are shown', () => {
    const pop = circles(100)
    pop.update(JD)
    expect(pop.asked).toBe(100)
    pop.update(JD + 1e-5)
    expect(pop.asked).toBe(200)
  })

  it('carries thousands along their circles, working out a frame\'s budget of them exactly in turn', () => {
    const pop = circles(3000)
    pop.update(JD)
    // The frame's budget: the rest come in over the next frame.
    expect(pop.states).toBe(2500)
    expect(shownCount(pop)).toBe(2500)
    pop.update(JD + (1 / 86400))
    expect(shownCount(pop)).toBe(3000)
    // From here, each frame works out the budget exactly, the rest carried.
    const states = pop.states
    // Ten minutes on, more than a tenth of a turn.
    const jd = JD + (10 / 1440)
    pop.update(jd)
    expect(pop.states - states).toBe(2500)
    const pos = pop.points.geometry.attributes.position
    const exact = new Vector3
    let worst = 0
    for (let i = 0; i < 3000; i++) {
      pop.positionAt(pop.records[i], jd, exact)
      worst = Math.max(worst, exact.distanceTo(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))))
    }
    // On a circle, carried is exact but for float32: a metre or so at 7,000 km.
    expect(worst).toBeLessThan(5)
  })

  it('works out exactly an object not on a near circle, and one carried too long', () => {
    const pop = circles(2500)
    pop.records[0].eccentricity = 0.7
    pop.update(JD)
    const states = pop.states
    // Two hours on: past how long one is carried, so each is worked out
    // again, within the budget (and the next in turn with what's left).
    const jd = JD + (2 / 24)
    pop.update(jd)
    expect(pop.states - states).toBe(2500)
    expect(shownCount(pop)).toBe(2500)
    // The eccentric one, exactly.
    const pos = pop.points.geometry.attributes.position
    const exact = new Vector3
    pop.positionAt(pop.records[0], jd, exact)
    expect(new Vector3(pos.getX(0), pos.getY(0), pos.getZ(0)).distanceTo(exact)).toBeLessThan(2)
  })
})


describe('Population, a group drawn elsewhere', () => {
  it('leaves its points to the drawer while it draws them, and names them where its dots are', () => {
    const pop = circles(3000)
    // The drawer's index of each is its id + 1000; it draws all but every
    // hundredth.
    const asked = []
    const drawer = {
      drawing: true,
      indexOf: (id) => id + 1000,
      isShown: (j) => (j - 1000) % 100 !== 0,
      positionAtJd: (j, jd, out) => {
        asked.push(j)
        return out.set(j - 1000, 0, 0)
      },
    }
    pop.setGroupDrawer('b', drawer)
    pop.setLabelBudget(20)
    pop.update(JD)
    // Group a's 10 worked out here (many shown: carried, so their states,
    // then again in turn with the frame's budget to spare); none of b's
    // 2,990, which the drawer draws.  Its positions only for the names.
    expect(pop.states).toBe(20)
    expect(asked).toEqual([1011, 1012, 1013, 1014, 1015, 1016, 1017, 1018, 1019, 1020])
    const show = pop.points.geometry.attributes.aShow
    expect(show.getX(0)).toBe(1)
    expect(show.getX(10)).toBe(2)
    // One the drawer doesn't draw (#100) isn't placed.
    expect(show.getX(99)).toBe(0)
    expect(pop.drawnCount).toBe(10)
    // The names: the budget reaches into b, at the drawer's places.
    expect(pop._nameIds.length).toBe(20)
    const pos = pop.points.geometry.attributes.position
    expect([pos.getX(10), pos.getY(10)]).toEqual([11, 0])
    // The drawer stops (its overlay off): the group is drawn here again,
    // coming in within the frame's budget.
    drawer.drawing = false
    const before = pop.states
    pop.update(JD + (1 / 86400))
    expect(pop.states - before).toBe(2500)
    expect(show.getX(10)).toBe(1)
    pop.setGroupDrawer('b', null)
    expect(pop.drawers.size).toBe(0)
  })
})
