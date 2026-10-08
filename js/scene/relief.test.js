import {describe, expect, it} from 'bun:test'
import {readFileSync, statSync} from 'fs'


/**
 * A JPEG's size from its start-of-frame marker.
 *
 * @param {Buffer} buf
 * @returns {{width: number, height: number, components: number}}
 */
function jpegSize(buf) {
  let i = 2
  while (i < buf.length) {
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker >= 0xC0 && marker <= 0xC2) {
      return {height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), components: buf[i + 9]}
    }
    i += 2 + len
  }
  return null
}


describe('the Moon\'s relief (Planet.md, "Relief")', () => {
  const moon = JSON.parse(readFileSync('./public/data/moon.json', 'utf8'))

  it('has a normal map', () => {
    expect(moon.texture_normal).toBe(true)
  })

  it('is 2048x1024 RGB, as the colour map\'s layout, and under the 1 MB that would need Git LFS', () => {
    const path = './public/textures/moon_normal.jpg'
    const size = jpegSize(readFileSync(path))
    expect(size).toEqual({width: 2048, height: 1024, components: 3})
    expect(statSync(path).size).toBeLessThan(1 << 20)
  })
})
