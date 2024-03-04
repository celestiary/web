import {readFileSync} from 'fs'

import StarsCatalog from './StarsCatalog.js'
import {toArrayBuffer} from './utils.js'


const STARS_DAT = './public/data/stars.dat'
const STAR_NAMES_DAT = './public/data/starnames.dat'

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
}


describe('StarsCatalog', () => {
  it('minimal catalog loads', () => {
    const starByHip = {0: TEST_STAR}
    const hipByName = {Sun: 0}
    const namesByHip = {0: ['Sun']}
    const minMag = 10
    const maxMag = 1
    const catalog = new StarsCatalog(1, starByHip, hipByName, namesByHip, minMag, maxMag)
    expect(catalog.numStars).toEqual(1)
  })

  it('StarsCatalog#read', () => {
    const catalog = new StarsCatalog()
    catalog.read(toArrayBuffer(readFileSync(STARS_DAT)))
    expect(catalog.numStars).toEqual(106747)
  })

  it('StarsCatalog#downsample', () => {
    let catalog = new StarsCatalog()
    catalog = catalog.read(toArrayBuffer(readFileSync(STARS_DAT))).downsample(1000)
    expect(catalog.numStars).toEqual(1000)
  })

  it('StarsCatalog#readNames', () => {
    const catalog = new StarsCatalog()
    catalog.read(toArrayBuffer(readFileSync(STARS_DAT)))
    catalog.readNames(readFileSync(STAR_NAMES_DAT, 'utf-8'))
    // TODO(pablo): was 5699
    expect(catalog.hipByName.size).toEqual(5672)
  })
})
