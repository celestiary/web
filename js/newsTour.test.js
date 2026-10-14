import {describe, expect, it} from 'bun:test'
import {HOLD_MIN_MS, holdMs, parseChangelog, tourCaption, tourStops} from './changelog.js'
import NewsTour, {ARRIVAL_TIMEOUT_MS, MAX_STEP_MS} from './newsTour.js'


const FRAME_MS = 16

/**
 * @param {string} date
 * @param {string} headline
 * @param {?string} permalink
 * @returns {object}
 */
function entry(date, headline, permalink) {
  return {id: `${date}-${headline}`, date, headline, text: 'A sentence about it.', permalink, links: [], epic: null,
    image: null}
}

const ENTRIES = parseChangelog({entries: [
  entry('2026-10-13', 'five', '#sun/earth'),
  entry('2026-10-12', 'four', null),
  entry('2026-10-11', 'three', '#sun/jupiter'),
  entry('2026-10-10', 'two', null),
  entry('2026-10-09', 'one', '#galaxy:ngc2403'),
]})


/**
 * A tour on a fake camera: `go` begins a flight that lands after `flightMs`
 * of frames; `arrived` says when.
 *
 * @param {object} [opts]
 * @param {number} [opts.flightMs]
 * @param {Array<object>} [opts.stops]
 * @returns {object}
 */
function setup({flightMs = 2000, stops = tourStops(ENTRIES)} = {}) {
  const log = {went: [], changes: [], ended: []}
  const camera = {flyingFor: null, arrivedAt: null}
  const tour = new NewsTour({
    go: (e, i) => {
      log.went.push(`${i}:${e.headline}`)
      camera.flyingFor = 0
    },
    arrived: () => camera.flyingFor !== null && camera.flyingFor >= flightMs,
    onChange: (s) => log.changes.push(s && {index: s.index, phase: s.phase, paused: s.paused}),
    onEnd: (finished) => log.ended.push(finished),
  })
  let now = 1000
  /**
   * @param {number} ms Run frames this long
   */
  const run = (ms) => {
    for (let t = 0; t < ms; t += FRAME_MS) {
      now += FRAME_MS
      // The flight's clock is the frame clock, held while the tour is paused
      // (Celestiary._frameFlight).
      if (camera.flyingFor !== null && !tour.paused) {
        camera.flyingFor += FRAME_MS
      }
      tour.frame(now)
    }
  }
  return {tour, log, run, stops, camera}
}


describe('the changelog tour', () => {
  it('flies to the first stop, shows its caption, holds, then flies on, in order', () => {
    const {tour, log, run, stops} = setup()
    expect(stops.map((e) => e.headline)).toEqual(['five', 'three', 'one'])
    expect(tour.start(stops)).toBe(true)
    expect(log.went).toEqual(['0:five'])
    expect(tour.state.phase).toBe('flying')
    expect(tour.state.count).toBe(3)
    // Not yet there.
    run(1500)
    expect(tour.state.phase).toBe('flying')
    // There: the caption.
    run(700)
    expect(tour.state.phase).toBe('holding')
    expect(tour.state.caption.headline).toBe('five')
    const hold = holdMs(tourCaption(stops[0]))
    // Held for its time, then on to the next.
    run(hold - 500)
    expect(tour.state.index).toBe(0)
    run(1000)
    expect(tour.state.index).toBe(1)
    expect(tour.state.phase).toBe('flying')
    expect(log.went).toEqual(['0:five', '1:three'])
    // The whole tour, then it ends having run out.
    run(20000)
    expect(log.went).toEqual(['0:five', '1:three', '2:one'])
    expect(log.ended).toEqual([true])
    expect(tour.active).toBe(false)
    expect(tour.state).toBe(null)
    expect(log.changes.at(-1)).toBe(null)
  })

  it('plays only the entries it is given, which have a permalink: an entry without one is never a stop', () => {
    const {log, run, tour, stops} = setup()
    tour.start(stops)
    run(60000)
    expect(log.went.map((w) => w.split(':')[1])).toEqual(['five', 'three', 'one'])
    expect(log.went.join()).not.toContain('four')
    expect(log.went.join()).not.toContain('two')
  })

  it('can begin from a chosen entry', () => {
    const stops = tourStops(ENTRIES, {from: ENTRIES[2].id})
    const {tour, log, run} = setup({stops})
    tour.start(stops)
    run(60000)
    expect(log.went).toEqual(['0:three', '1:one'])
  })

  it('holds longer for a longer caption', () => {
    const long = {...ENTRIES[0], text: 'A long first sentence that runs on and on and on and on and on and on, for a while.'}
    expect(holdMs(tourCaption(long))).toBeGreaterThan(holdMs(tourCaption({...long, text: 'Short.'})))
  })

  it('next skips to the next stop, from a flight or a hold; from the last it ends', () => {
    const {tour, log, run, stops} = setup()
    tour.start(stops)
    tour.next()
    expect(tour.state.index).toBe(1)
    run(2500)
    expect(tour.state.phase).toBe('holding')
    tour.next()
    expect(tour.state.index).toBe(2)
    expect(tour.state.phase).toBe('flying')
    run(2500)
    tour.next()
    expect(log.ended).toEqual([true])
    expect(tour.active).toBe(false)
    expect(log.went).toEqual(['0:five', '1:three', '2:one'])
  })

  it('previous goes back a stop; from the first it begins again', () => {
    const {tour, log, run, stops} = setup()
    tour.start(stops)
    run(2500)
    tour.next()
    run(2500)
    expect(tour.state.index).toBe(1)
    tour.previous()
    expect(tour.state.index).toBe(0)
    expect(tour.state.phase).toBe('flying')
    tour.previous()
    expect(tour.state.index).toBe(0)
    expect(log.went).toEqual(['0:five', '1:three', '0:five', '0:five'])
  })

  it('pausing holds the clock: the caption stays, and a flight waits', () => {
    const {tour, log, run, stops, camera} = setup()
    tour.start(stops)
    run(500)
    tour.togglePause()
    expect(tour.state.paused).toBe(true)
    // A flight under way stands still (the fake camera's clock is held).
    const at = camera.flyingFor
    run(10000)
    expect(camera.flyingFor).toBe(at)
    expect(tour.state.phase).toBe('flying')
    tour.togglePause()
    run(2000)
    expect(tour.state.phase).toBe('holding')
    // Paused in a hold: it stays as long as it's wanted.
    tour.togglePause()
    run(60000)
    expect(tour.state.index).toBe(0)
    expect(tour.state.phase).toBe('holding')
    tour.togglePause()
    run(HOLD_MIN_MS + 200)
    expect(tour.state.index).toBe(1)
    expect(log.ended).toEqual([])
  })

  it('skipping while paused carries on from the new stop', () => {
    const {tour, run, stops} = setup()
    tour.start(stops)
    run(2500)
    tour.togglePause()
    tour.next()
    expect(tour.state.paused).toBe(false)
    run(2500)
    expect(tour.state.index).toBe(1)
    expect(tour.state.phase).toBe('holding')
  })

  it('stop ends it where it is, once, and says it did not finish', () => {
    const {tour, log, run, stops} = setup()
    tour.start(stops)
    run(500)
    tour.stop()
    tour.stop()
    expect(log.ended).toEqual([false])
    expect(tour.active).toBe(false)
    expect(log.changes.at(-1)).toBe(null)
    // Nothing more happens.
    const went = log.went.length
    run(60000)
    expect(log.went.length).toBe(went)
    tour.next()
    tour.previous()
    tour.togglePause()
    expect(log.went.length).toBe(went)
  })

  it('abandoning drops it without ending it', () => {
    const {tour, log, run, stops} = setup()
    tour.start(stops)
    run(500)
    tour.abandon()
    expect(tour.active).toBe(false)
    expect(log.ended).toEqual([])
    expect(log.changes.at(-1)).toBe(null)
  })

  it('a stop whose scene never arrives is skipped after a while', () => {
    const {tour, log, run, stops} = setup({flightMs: Infinity})
    tour.start(stops)
    run(ARRIVAL_TIMEOUT_MS - 1000)
    expect(tour.state.index).toBe(0)
    run(2000)
    expect(tour.state.index).toBe(1)
    run(ARRIVAL_TIMEOUT_MS * 3)
    expect(log.ended).toEqual([true])
    expect(log.went.length).toBe(3)
  })

  it('a long frame (a hidden tab) does not skip the hold', () => {
    const {tour, run, stops} = setup()
    tour.start(stops)
    run(2500)
    expect(tour.state.phase).toBe('holding')
    // One frame, a minute later.
    tour.frame(1000 + 60000)
    expect(tour.state.index).toBe(0)
    expect(MAX_STEP_MS).toBeLessThanOrEqual(100)
  })

  it('has nothing to play without stops', () => {
    const {tour, log} = setup({stops: []})
    expect(tour.start([])).toBe(false)
    expect(tour.active).toBe(false)
    expect(tour.state).toBe(null)
    expect(log.went).toEqual([])
  })

  it('tells its view of every change', () => {
    const {tour, log, run, stops} = setup()
    tour.start(stops)
    run(2500)
    tour.togglePause()
    expect(log.changes.map((c) => c && `${c.index}:${c.phase}${c.paused ? ':paused' : ''}`))
        .toEqual(['0:flying', '0:holding', '0:holding:paused'])
  })
})
