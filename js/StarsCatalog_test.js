import {readFileSync} from 'fs';

import Testing from '@pablo-mayrgundter/testing.js/testing.js';

import StarsCatalog from './StarsCatalog.js';
import {toArrayBuffer} from './utils.js';


const tests = new Testing();


tests.add('StarsCatalog#read', () => {
    const catalog = new StarsCatalog();
    catalog.read(toArrayBuffer(readFileSync('../data/stars.dat')));
    tests.assertEquals(106747, catalog.numStars);
  });


tests.add('StarsCatalog#downsample', () => {
    let catalog = new StarsCatalog();
    catalog = catalog.read(toArrayBuffer(readFileSync('../data/stars.dat'))).downsample(1000);
    tests.assertEquals(1000, catalog.numStars);
  });


tests.add('StarsCatalog#readNames', () => {
    const catalog = new StarsCatalog();
    catalog.read(toArrayBuffer(readFileSync('../data/stars.dat')));
    catalog.readNames(readFileSync('../data/starnames.dat', 'utf-8'));
    tests.assertEquals(5699, Object.keys(catalog.hipByName).length);
  })

tests.run();
