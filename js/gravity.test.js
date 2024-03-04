import {
  G,
  step,
  // updateAccelerations,
} from './gravity.js'


describe('gravity', () => {
  it('particle at rest', () => {
    const pos = [0, 0, 0]
    const vel = [0, 0, 0]
    const acc = [null, null, null]
    const mass = [1]

    const zeros = [0, 0, 0]
    applyAndAssert(
        pos, vel, acc, mass,
        zeros, pos,
        zeros, vel,
        zeros, acc)
    expect(mass[0]).toEqual(1)
  })


  it('particle in motion', () => {
    const pos = [0, 0, 0]
    const vel = [1, 2, 3]
    const acc = [null, null, null]
    const mass = [1]
    applyAndAssert(
        pos, vel, acc, mass,
        [1, 2, 3], pos,
        [1, 2, 3], vel,
        [0, 0, 0], acc)
  })


  it('two particles', () => {
    const pos = [0, 0, 0, 1, 0, 0]
    const vel = [0, 0, 0, 0, 0, 0]
    const acc = [null, null, null, null, null, null]
    const mass = [1, 1]
    applyAndAssert(
        pos, vel, acc, mass,
        [0, 0, 0, 1, 0, 0], pos,
        [G / 2, 0, 0, -G / 2, 0, 0], vel,
        [G, 0, 0, -G, 0, 0], acc,
        'on first step')
    /* tests.applyAndAssert(pos, vel, acc, mass,
       [G, 0, 0, 1-G, 0, 0], pos,
       [G, 0, 0, -G, 0, 0], vel,
       [2*G, 0, 0, -2*G, 0, 0], acc,
       'on second step')*/
  })
})


/** Expect vectors and components to be equal */
function assertVectorsEqual(vec1, vec2, appendMsg = '') {
  if (vec1.length !== vec2.length) {
    throw new Error('vector lengths must be equal')
  }
  for (let i = 0; i < vec1.length; i++) {
    expect(vec1[i]).toEqual(vec2[i])
  }
}


/** Apply step and test vectors */
function applyAndAssert(
    pos, vel, acc, mass,
    expPos, actPos,
    expVel, actVel,
    expAcc, actAcc,
    appendMsg = '') {
  const dt = 1
  step(pos, vel, acc, mass, dt)
  assertVectorsEqual(expPos, actPos, `for pos ${appendMsg}`)
  assertVectorsEqual(expVel, actVel, `for vel ${appendMsg}`)
  assertVectorsEqual(expAcc, actAcc, `for acclerations ${appendMsg}`)
}
