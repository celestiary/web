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
  const sunRadiusMeters = 695700000;
  const sunAbsMag = 4.83;
  const sun = {
    x: 0, y: 0, z: 0,
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
