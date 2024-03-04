import {readFileSync} from 'fs'

import AsterismsCatalog from './AsterismsCatalog.js'
import StarsCatalog from './StarsCatalog.js'
import {toArrayBuffer} from './utils.js'


describe('AsterismsCatalog', () => {
  it('constructor loads data', () => {
    const starsCatalog = new StarsCatalog()
    starsCatalog.read(toArrayBuffer(readFileSync('./public/data/stars.dat')))
    expect(starsCatalog.numStars).toEqual(106747)
    const asterisms = new AsterismsCatalog(starsCatalog)
    asterisms.read(readFileSync('./public/data/asterisms.dat', 'utf-8'))
    expect(asterisms.byName.size).toEqual(89)
  })
})

