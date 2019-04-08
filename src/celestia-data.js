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
    stars: []
  }
  for (let i = 0; i < numRecords; i++) {
    const hipId = data.getUint32(offset, littleEndian);
    offset += 4;

    const x = data.getFloat32(offset, littleEndian);
    offset += 4;

    const y = data.getFloat32(offset, littleEndian);
    offset += 4;

    const z = data.getFloat32(offset, littleEndian);
    offset += 4;

    const mag = data.getInt16(offset, littleEndian);
    offset += 2;

    const spec = data.getUint16(offset, littleEndian);
    offset += 2;

    const star = {
      x: x,
      y: y,
      z: z,
      mag: mag,
      spec: spec
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
