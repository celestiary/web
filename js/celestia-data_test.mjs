import Testing from './lib/testing.js/testing.mjs';
import {info} from './log.mjs';
import * as CelestiaData from './celestia-data.mjs';
import * as fs from 'fs';

const tests = new Testing();


// https://stackoverflow.com/questions/8609289/convert-a-binary-nodejs-buffer-to-javascript-arraybuffer
function toArrayBuffer(buf) {
  var ab = new ArrayBuffer(buf.length);
  var view = new Uint8Array(ab);
  for (var i = 0; i < buf.length; ++i) {
    view[i] = buf[i];
  }
  return ab;
}


tests.add('Asterisms clean', () => {
    const starDat = toArrayBuffer(fs.readFileSync('../data/stars.dat'));
    const catalog = CelestiaData.readCatalogFile(starDat);
    //console.log('catalog: ', catalog);
    CelestiaData.readStarNamesFile(fs.readFileSync('../data/starnames.dat', 'utf-8'), catalog);
    const records = CelestiaData.readAsterismsFile(fs.readFileSync('../data/asterisms-clean.dat', 'utf-8'));
    console.log('records: ', JSON.stringify(records));
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      JSON.stringify(CelestiaData.reifyAsterism(record, catalog));
      console.log(`record[${i}] reified: `, record);
    }
  });

tests.run();
