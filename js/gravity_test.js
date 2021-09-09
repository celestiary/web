import Testing from '@pablo-mayrgundter/testing.js/testing.js';

import {
  G,
  step,
  updateAccelerations
} from './gravity.js';


Testing.prototype.assertVectorsEqual = function(vec1, vec2, appendMsg = '') {
  if (vec1.length != vec2.length) {
    throw new Error('vector lengths must be equal');
  }
  const coordNames = ['X', 'Y', 'Z'];
  for (let i = 0; i < vec1.length; i++) {
    this.assertEquals(vec1[i], vec2[i], `coord:${i} ${coordNames[i%3]} vector components not equal, expected:${vec1[i]}, got:${vec2[i]} ${appendMsg}`);
  }
};


Testing.prototype.applyAndAssert = function(
    pos, vel, acc, mass,
    expPos, actPos,
    expVel, actVel,
    expAcc, actAcc,
    appendMsg = '') {
  const dt = 1;
  step(pos, vel, acc, mass, dt);
  this.assertVectorsEqual(expPos, actPos, `for pos ${appendMsg}`);
  this.assertVectorsEqual(expVel, actVel, `for vel ${appendMsg}`);
  this.assertVectorsEqual(expAcc, actAcc, `for acclerations ${appendMsg}`);
}

const tests = new Testing();


tests.add('particle at rest', () => {
  const pos = [0, 0, 0],
        vel = [0, 0, 0],
        acc = [null, null, null],
        mass = [1];

  const zeros = [0, 0, 0];
  tests.applyAndAssert(pos, vel, acc, mass,
    zeros, pos,
    zeros, vel,
    zeros, acc);
  tests.assertEquals(1, mass[0]);
});


tests.add('particle in motion', () => {
  const pos = [0, 0, 0],
        vel = [1, 2, 3],
        acc = [null, null, null],
        mass = [1];
  tests.applyAndAssert(pos, vel, acc, mass,
    [1, 2, 3], pos,
    [1, 2, 3], vel,
    [0, 0, 0], acc);
});


tests.add('two particles', () => {
  const pos = [0, 0, 0, 1, 0, 0],
        vel = [0, 0, 0, 0, 0, 0],
        acc = [null, null, null, null, null, null],
        mass = [1, 1];
  tests.applyAndAssert(pos, vel, acc, mass,
                       [0, 0, 0, 1, 0, 0], pos,
                       [G/2, 0, 0, -G/2, 0, 0], vel,
                       [G, 0, 0, -G, 0, 0], acc,
                       'on first step');
  tests.applyAndAssert(pos, vel, acc, mass,
                       [G, 0, 0, 1-G, 0, 0], pos,
                       [G, 0, 0, -G, 0, 0], vel,
                       [2*G, 0, 0, -2*G, 0, 0], acc,
                       'on second step');
});


tests.run();

