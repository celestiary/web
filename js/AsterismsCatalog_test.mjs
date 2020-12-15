import {readFileSync} from 'fs';

import Testing from './lib/testing.js/testing.mjs';

import AsterismsCatalog from './AsterismsCatalog.mjs';
import StarsCatalog from './StarsCatalog.mjs';

import {toArrayBuffer} from './utils.mjs';


const tests = new Testing();


tests.add('AsterismsCatalog', () => {
    const starsCatalog = new StarsCatalog();
    starsCatalog.read(toArrayBuffer(readFileSync('../data/stars.dat')));
    tests.assertEquals(106747, starsCatalog.numStars);
    const asterisms = new AsterismsCatalog(starsCatalog);
    asterisms.read(readFileSync('../data/asterisms.dat', 'utf-8'));
    tests.assertEquals(89, Object.keys(asterisms.byName).length);
  });

tests.run();