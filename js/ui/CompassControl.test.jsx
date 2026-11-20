import {describe, expect, it} from 'bun:test'
import {angleAround, compassLabel} from './CompassControl.jsx'


describe('the compass control (#361, step 3)', () => {
  it('says the heading, and what a tap does', () => {
    expect(compassLabel(0)).toBe('Heading north (tap: level)')
    expect(compassLabel(Math.PI / 2)).toBe('Heading 90° (tap: north up)')
    expect(compassLabel(-Math.PI / 2)).toBe('Heading 270° (tap: north up)')
  })

  it('measures a press\'s angle round the dial clockwise from up, as the screen shows it', () => {
    expect(angleAround(10, 0, 10, 10)).toBeCloseTo(0, 12)
    expect(angleAround(20, 10, 10, 10)).toBeCloseTo(Math.PI / 2, 12)
    expect(angleAround(0, 10, 10, 10)).toBeCloseTo(-Math.PI / 2, 12)
  })
})
