import { readFileSync } from 'fs';
import Testing from '@pablo-mayrgundter/testing.js/testing.js';
import StarsCatalog from './StarsCatalog.js';
import { toArrayBuffer } from './utils.js';
const tests = new Testing();
const STARS_DAT = '../public/data/stars.dat';
const STAR_NAMES_DAT = '../public/data/starnames.dat';
const TEST_STAR = {
    x: 0,
    y: 0,
    z: 0,
    hipId: 0,
    absMag: 1,
    kind: 'M',
    spectralType: '0',
    sub: '0',
    lumClass: 1,
    lumRelSun: 1,
    radius: 1,
};
tests.add('Minimal catalog', () => {
    const starsByHip = { 0: TEST_STAR };
    const hipByName = { Sun: 0 };
    const namesByHip = { 0: ['Sun'] };
    const minMag = 10;
    const maxMag = 1;
    const catalog = new StarsCatalog(1, starsByHip, hipByName, namesByHip, minMag, maxMag);
    tests.assertEquals(1, catalog.numStars);
});
tests.add('StarsCatalog#read', () => {
    const catalog = new StarsCatalog();
    catalog.read(toArrayBuffer(readFileSync(STARS_DAT)));
    tests.assertEquals(106747, catalog.numStars);
});
tests.add('StarsCatalog#downsample', () => {
    let catalog = new StarsCatalog();
    catalog = catalog.read(toArrayBuffer(readFileSync(STARS_DAT))).downsample(1000);
    tests.assertEquals(1000, catalog.numStars);
});
tests.add('StarsCatalog#readNames', () => {
    const catalog = new StarsCatalog();
    catalog.read(toArrayBuffer(readFileSync(STARS_DAT)));
    catalog.readNames(readFileSync(STAR_NAMES_DAT, 'utf-8'));
    tests.assertEquals(5699, Object.keys(catalog.hipByName).length);
});
tests.run();
