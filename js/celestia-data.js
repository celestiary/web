import Parser from '/js/parser.mjs';

// From https://en.wikibooks.org/wiki/Celestia/Binary_Star_File
const littleEndian = true;


function check(expect, actual, offset) {
  for (let i = 0; i < expect.length; i++) {
    const eC = expect.charCodeAt(i);
    const aC = actual.getUint8(offset + i, littleEndian);
    if (eC == aC) {
      continue;
    }
    throw new Error(`Check failed at index ${i}, expected: ${eC}, actual: ${aC}`);
  }
}


export function readCatalogFile(buffer) {
  const header = "CELSTARS\x00\x01";
  const data = new DataView(buffer);
  let offset = 0;
  check(header, data, offset);
  offset += header.length;

  const numRecords = data.getUint32(offset, littleEndian);
  offset += 4;
  const catalog = {
    count: numRecords,
    index: {},
    stars: [],
    minMag: -8.25390625,
    maxMag: 15.4453125,
    hipByName: {},
    namesByHip: {}
  }
  // Didn't see the sun in the stars.dat catalog, so adding it
  // manually.  If wrong, it'll be in there twice but indexed once
  const sunRadiusMeters = 695700000;
  const sunAbsMag = 4.83;
  const sun = {
    x: 0, y: 0, z: 0,
    hipId: 0,
    mag: sunAbsMag,
    kind: 0,
    type: 4,
    sub: 2,
    lum: 6,
    radiusMeters: sunRadiusMeters
  };
  catalog.stars.push(sun);
  catalog.index[0] = sun;
  for (let i = 0; i < numRecords; i++) {
    const hipId = data.getUint32(offset, littleEndian);
    offset += 4;

    const x = data.getFloat32(offset, littleEndian);
    offset += 4;

    const y = data.getFloat32(offset, littleEndian);
    offset += 4;

    const z = data.getFloat32(offset, littleEndian);
    offset += 4;

    const absMag = data.getInt16(offset, littleEndian) / 256;
    offset += 2;

    const clazz = data.getUint16(offset, littleEndian);
    offset += 2;

    const kind = clazz & 0xF000 >>> 12;
    const type = clazz & 0x0F00 >>> 8;
    const sub  = clazz & 0x00F0 >>> 4;
    const lumClass  = clazz & 0x000F;

    // http://cas.sdss.org/dr4/en/proj/advanced/hr/radius1.asp
    // Omitting the temperature factor for now as it changes radius by
    // only a factor of 3 up or down.
    const absMagD = sunAbsMag - absMag;
    const lumRelSun = Math.pow(2.512, absMagD);
    const radiusMeters = sunRadiusMeters * Math.pow(lumRelSun, 0.5);

    const star = {
      x: x,
      y: y,
      z: z,
      hipId: hipId,
      absMag: absMag,
      kind: kind,
      type: type,
      sub: sub,
      lumClass: lumClass,
      lumRelSun: lumRelSun,
      radiusMeters: radiusMeters
    };
    catalog.index[hipId] = star;
    catalog.stars.push(star);
    //if (hipId == 70890) {
    //  console.log('Proxima Centauri: ', star);
    //}
  }
  return catalog;
}


function readStarNamesFile(text, catalog) {
  const records = text.split('\n');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const parts = record.split(':');
    if (parts.length < 2) {
      console.warn('Malformed name record: ', record);
      continue;
    }
    const hipId = parseInt(parts.shift());
    catalog.namesByHip[hipId] = parts;
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      catalog.hipByName[part] = hipId;
    }
  }
}


/**
 * Many records of this form
 * "Caelum"
 * [
 *   [ "Alpha Cae" "Beta Cae" ]
 *   ...
 * ]
 */
export function readAsterismsFile(text, catalog) {
  const asterisms = {};
  let numRecords = 0;
  const Grammar = {
    rules: {
      0: {
        rule: [ 1, 2 ],
        callback: (state, termIndex, choiceIndex) => {
          console.log(`Named record! choiceIndex(${choiceIndex}), numRecords(${numRecords})`);
          numRecords++;
          if (++numRecords > 10) {
            throw new Error('too many!');
          }
        }
      },
      1: { // Repeatedly match quoted names, e.g. "Alpha Cae" "Beta Cae"
        rule: [ /\"([A-Za-z0-9 ]+)\"\s*/g ],
        callback: (state, termIndex, match) => {
          console.log(`Name encountered: match(${match})`);
        }
      },
      2: { // Array record, peels off the outside brackets.
        rule: [ /\s*\[\s*/ , 3 , /\s*\]\s*/ ],
        callback: (state, termIndex, match) => {
          console.log(`array record: match(${match})`);
        }
      },
      3: { // Sequence of arrays of name
        rule: [ 4, 3, -1 ],
        callback: (state, termIndex, choiceIndex) => {
          console.log(`sequence of arrays of name: choiceIndex(${choiceIndex})`);
        }
      },
      4: { // Array of named nodes
        rule: [ /\s*\[\s*/ , 1 , /\s*\]\s*/ ],
        callback: (state, termIndex, match) => {
          console.log(`named node: match(${match})`);
        }
      }
    }
  };
  catalog.asterisms = asterisms;
  const offset = Parser.parse(text, Grammar, 0);
  if (offset != text.length) {
    console.warn(`Cannot parse asterisms, offset(${offset}) != text.length(${text.length})`);
  } else {
    console.log(`Parsed!`);
  }
}


export function loadStars(cb) {
  if (!cb) {
    throw new Error('Undefined callback');
  }
  fetch('/data/stars.dat').then((body) => {
    body.arrayBuffer().then((buffer) => {
        const catalog = readCatalogFile(buffer);
        fetch('/data/starnames.dat').then((body) => {
            body.text().then((text) => {
                readStarNamesFile(text, catalog);
                cb(catalog);
              })
          });
    })
  });
}
