import Parser from './lib/parser.js/parser.mjs';

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


function readCatalogFile(buffer) {
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
  console.log('Star names: ', records.length);
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const parts = record.split(':');
    if (parts.length < 2 && i < records.length - 1) {
      console.warn(`Malformed name record ${i}: `, parts);
      continue;
    }
    const hipId = parseInt(parts.shift());
    catalog.namesByHip[hipId] = parts;
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      catalog.hipByName[part] = hipId;
      // ZET1 Aqr -> ZET Aqr
      let match = part.match(/(\w{2,3})\d+ (\w{3})/);
      if (match) {
        const fix = match[1] + ' ' + match[2];
        catalog.hipByName[fix] = hipId;
      }
      // IOT Cnc A -> Iot Cnc
      match = part.match(/(\w{2,3}) (\w{3}).*/);
      if (match) {
        const fix = match[1] + ' ' + match[2];
        catalog.hipByName[fix] = hipId;
      }
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
function readAsterismsFile(text) {
  let records = [];
  let recordName = null;
  let paths = [];
  let path = [];
  let names = [];
  let nameList = [];
  const Grammar = {
    'Start': { // List of records
      rule: [ 'Record', [ 'Start', Parser.Terminal ] ]
    },
    'Record': {
      rule: [ 'Name', 'OuterArray' ],
      callback: (state, match) => {
        recordName = names.pop();
        const record = {
          name: recordName,
          paths: paths
        };
        records.push(record);
        recordName = null;
        paths = [];
        names = [];
        nameList = [];
      }
    },
    'Name': {
      rule: [ /"([\p{L}0-9 ]+)" */u ],
      callback: (state, match) => {
        const name = match[1];
        names.push(name);
      }
    },
    'NameList': {
      rule: [ 'Name', [ 'NameList', Parser.Terminal ] ],
      callback: (state, match) => {
        nameList.unshift(names.pop());
      }
    },
    'OuterArray': {
      rule: [ /\s*\[\s*/ , 'ListInnerArray' , /\s*\]\s*/ ],
    },
    'ListInnerArray': {
      rule: [ 'Path', [ 'ListInnerArray', Parser.Terminal ] ],
    },
    'Path': {
      rule: [ /\s*\[\s*/ , 'NameList', /\s*\]\s*/ ],
      callback: (state, match) => {
        paths.push(nameList);
        nameList = [];
      }
    }
  };
  const offset = new Parser().parse(text, Grammar, 'Start');
  if (offset != text.length) {
    console.warn(`Cannot parse asterisms, offset(${offset}) != text.length(${text.length})`);
  } else {
    console.log(`Asterisms: ${records.length}`);
  }
  return records;
}


function loadStars(cb) {
  if (!cb) {
    throw new Error('Undefined callback');
  }
  fetch('data/stars.dat').then((body) => {
    body.arrayBuffer().then((buffer) => {
        const catalog = readCatalogFile(buffer);
        fetch('data/starnames.dat').then((body) => {
            body.text().then((text) => {
                readStarNamesFile(text, catalog);
                cb(catalog);
              })
          });
    })
  });
}


function reifyName(origName, catalog) {
  let name = origName;
  let hipId = catalog.hipByName[name];
  let score = 1;
  if (!hipId) {
    name = abbrev(name);
    hipId = catalog.hipByName[name];
    if (hipId) {
      //console.log(`${origName} --abbrev-> ${name}, hipId: ${hipId}`);
      score++;
    }
  }
  if (!hipId) {
    name = abbrevVariant(name);
    hipId = catalog.hipByName[name];
    if (hipId) {
      //console.log(`${origName} --abbrevVariant-> ${name}, hipId: ${hipId}`);
      score++;
    }
  }
  if (hipId) {
    const names = catalog.namesByHip[hipId];
    name = names[0];
  } else {
    score++;
  }
  return [origName, name, hipId, score];
}


function reifyAsterism(record, catalog) {
  const paths = record.paths;
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    for (let n = 0; n < path.length; n++) {
      const [origName, name, hipId] = reifyName(path[n], catalog);
      if (hipId) {
        path[n] = name;
      }
    }
  }
}


function abbrev(name) {
  const parts = name.split(/\s+/);
  parts[0] = parts[0].substring(0, 3).toUpperCase();
  const out = parts.join(' ');
  return out;
}


function abbrevVariant(name) {
  const parts = name.split(/\s+/);
  const num = variants[parts[0]];
  if (num) {
    parts[0] = num;
  }
  return parts.join(' ');
}


// TODO: https://en.wikipedia.org/wiki/Bayer_designation
// Meantime, these are what I've observed:
const variants = {
  ALP: 'ALF',
  THE: 'TET',
};

export {
  loadStars,
  readAsterismsFile,
  readCatalogFile,
  readStarNamesFile,
  reifyName,
  reifyAsterism,
}
