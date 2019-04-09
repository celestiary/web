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
  console.log('num records: ', numRecords);
  const catalog = {
    count: numRecords,
    index: {},
    stars: [],
    minMag: -8.25390625,
    maxMag: 15.4453125
  }
  // Didn't see the sun in the stars.dat catalog, so adding it
  // manually.  If wrong, it'll be in there twice but indexed once
  const sun = {
    x: 0, y: 0, z: 0,
    mag: -26.74,
    kind: 0,
    type: 4,
    sub: 2,
    lum: 6
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

    const mag = data.getInt16(offset, littleEndian) / 256;
    offset += 2;

    const clazz = data.getUint16(offset, littleEndian);
    offset += 2;

    const kind = clazz & 0xF000 >>> 12;
    const type = clazz & 0x0F00 >>> 8;
    const sub  = clazz & 0x00F0 >>> 4;
    const lum  = clazz & 0x000F;

    const star = {
      x: x,
      y: y,
      z: z,
      mag: mag,
      kind: kind,
      type: type,
      sub: sub,
      lum: lum
    };
    catalog.index[hipId] = star;
    catalog.stars.push(star);
  }
  return catalog;
}


export function loadStars(cb) {
  if (!cb) {
    throw new Error('Undefined callback');
  }
  fetch('/data/stars.dat').then((body) => {
    body.arrayBuffer().then((buffer) => {
        const catalog = readCatalogFile(buffer);
        cb(catalog);
    })
  });
}
