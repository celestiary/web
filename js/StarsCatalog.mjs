// TODO: Unify with temperature-based color alg in shaders/star.frag.
//
// TODO: plenty of color work to do here based on
// https://en.wikipedia.org/wiki/Stellar_classification. The
// method used here to choose colors is to hover my mouse over the
// color chart near the top of the page, above a given class, and
// record the RGB values in the table below.
//
// TODO: use color lookup attributes:
// https://threejs.org/examples/#webgl_geometry_colors_lookuptable
export const StarSpectra = [
  [142,176,255, 'O'], // 0,
  [165,191,255, 'B'], // 1,
  [205,218,255, 'A'], // 2,
  [242,239,254, 'F'], // 3,
  [255,238,229,'G'], // 4,
  [255,219,178, 'K'], // 5,
  [255,180,80, 'M'],  // 6,
  [255,180,80, 'R'],  // 7, like M
  [255,180,80, 'S'],  // 8, like M
  [255,180,80, 'N'],  // 9, like M
  [142,176,255, 'WC'],   // 10, like O
  [142,176,255, 'WN'],   // 11, like O
  [142,176,255, 'Unk.'], // 12, like O?
  [255,118,0, 'L'],      // 13,
  [255,0,0, 'T'],        // 14,
  [10,10,10, 'Carbon']]; // 15, ?



export default class StarsCatalog {
  /** @see StarsCatalog#downsample for call with all the args. */
  constructor(numStars = 0,
              starsByHip = {}, hipByName = {}, namesByHip = {},
              minMag = -8.25390625, maxMag = 15.4453125) {
    this.starsByHip = starsByHip;
    this.hipByName = hipByName;
    this.namesByHip = namesByHip;
    this.minMag = minMag;
    this.maxMag = maxMag;
    this.numStars = numStars;
    this.numNamedStars = 0;
    this.numNames = 0;
  }


  load(cb) {
    if (!cb) {
      throw new Error('Undefined callback');
    }
    fetch('data/stars.dat').then((body) => {
        body.arrayBuffer().then((buffer) => {
            this.read(buffer);
            fetch('data/starnames.dat').then((body) => {
                body.text().then((text) => {
                    this.readNames(text);
                    cb();
                  })
              });
          })
      });
  }


  read(buffer) {
    const header = "CELSTARS\x00\x01";
    const data = new DataView(buffer);
    let offset = 0;
    check(header, data, offset);
    offset += header.length;

    this.numStars = data.getUint32(offset, littleEndian);
    offset += 4;

    // Didn't see the sun in the stars.dat catalog, so adding it
    // manually.  If wrong, it'll be in there twice but indexed once
    const sunRadiusMeters = 695700000;
    const sunAbsMag = 4.83;
    const sun = {
      x: 0, y: 0, z: 0,
      hipId: 0,
      mag: sunAbsMag,
      kind: 0,
      spectralType: 4,
      sub: 2,
      lum: 6,
      radiusMeters: sunRadiusMeters
    };
    this.starsByHip[0] = sun;
    for (let i = 0; i < this.numStars; i++) {
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

      const kind = (clazz & 0xF000) >>> 12;
      const type = (clazz & 0x0F00) >>> 8;
      const sub  = (clazz & 0x00F0) >>> 4;
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
        spectralType: type,
        sub: sub,
        lumClass: lumClass,
        lumRelSun: lumRelSun,
        radiusMeters: radiusMeters
      };
      this.starsByHip[hipId] = star;
    }
    return this;
  }


  readNames(text) {
    const records = text.split('\n');
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const parts = record.split(':');
      if (parts.length < 2 && i < records.length - 1) {
        console.warn(`Malformed name record ${i}: `, parts);
        continue;
      }
      const hipId = parseInt(parts.shift());
      this.namesByHip[hipId] = parts;
      this.numNamedStars++;
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j];
        this.hipByName[part] = hipId;
        this.numNames++;
        // ZET1 Aqr -> ZET Aqr
        let match = part.match(/(\w{2,3})\d+ (\w{3})/);
        if (match) {
          const fix = match[1] + ' ' + match[2];
          this.hipByName[fix] = hipId;
          this.numNames++;
        }
        // IOT Cnc A -> Iot Cnc
        match = part.match(/(\w{2,3}) (\w{3}).*/);
        if (match) {
          const fix = match[1] + ' ' + match[2];
          this.hipByName[fix] = hipId;
          this.numNames++;
        }
      }
    }
  }


  downsample(n, keep = {}) {
    if (this.numStars < n) {
      return this;
    }
    const stars = [];
    for (let hipId in this.starsByHip) {
      stars.push(this.starsByHip[hipId]);
    }
    const sampled = [];
    let kept = 0;
    for (let keepId in keep) {
      sampled[kept++] = this.starsByHip[keepId];
    }
    for (let i = kept; i < n; i++) {
      const star = stars[Math.floor(Math.random() * stars.length)];
      if (keep[star.hipId]) {// Already have it, try again.
        continue;
      }
      sampled.push(star);
    }

    let numStars = sampled.length,
      starsByHip = {}, hipByName = {}, namesByHip = {},
      minMag = Number.MAX_VALUE, maxMag = Number.MIN_VALUE;
    for (let i = 0; i < numStars; i++) {
      const star = sampled[i];
      if (star.absMag < minMag) {
        minMag = star.absMag;
      }
      if (star.absMag > maxMag) {
        maxMag = star.absMag;
      }
      const hipId = star.hipId;
      starsByHip[hipId] = star;
      const names = this.namesByHip[hipId];
      if (names) {
        namesByHip[hipId] = names;
      }
    }
    for (let name in this.hipByName) {
      const hipId = this.hipByName[name];
      if (starsByHip[hipId]) {
        hipByName[name] = hipId;
      }
    }
    return new StarsCatalog(numStars, starsByHip, hipByName, namesByHip, minMag, maxMag);
  }


  reifyName(origName) {
    let name = origName;
    let hipId = this.hipByName[name];
    if (!hipId) {
      name = abbrev(name);
      hipId = this.hipByName[name];
    }
    if (!hipId) {
      name = abbrevVariant(name);
      hipId = this.hipByName[name];
    }
    if (hipId) {
      const names = this.namesByHip[hipId];
      name = names[0];
    }
    //if (!hipId)
    //  throw new Error(`Could not reify origName(${origName}) for hipId(${hipId})`);
    return [origName, name, hipId];
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
