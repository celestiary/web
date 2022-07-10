import {readFileSync} from 'fs'

import Testing from '@pablo-mayrgundter/testing.js/testing.js'

import AsterismsCatalog from './AsterismsCatalog.js'
import StarsCatalog from './StarsCatalog.js'
import {toArrayBuffer} from './utils.js'


const tests = new Testing()


tests.add('AsterismsCatalog', () => {
  const starsCatalog = new StarsCatalog()
  starsCatalog.read(toArrayBuffer(readFileSync('../public/data/stars.dat')))
  tests.assertEquals(106747, starsCatalog.numStars)
  const asterisms = new AsterismsCatalog(starsCatalog)
  asterisms.read(readFileSync('../public/data/asterisms.dat', 'utf-8'))
  tests.assertEquals(89, Object.keys(asterisms.byName).length)
})

tests.run()
