import CameraPath, {unwrapDegrees} from './tour'
import {EARTH_RADIUS_METER, planEarthPass} from './nightSide'
import {ASTRO_UNIT_METER, LIGHTYEAR_METER, SUN_RADIUS_METER} from './shared'


/**
 * The homepage's tour (DESIGN.md "Homepage"): behind the title, the search
 * and the cards, a slow loop from the Sun to Earth and out to the stars,
 * on the real scene at the visitor's own time, the exposure metering as it
 * goes.  About two minutes and a third, then a fade to black and round again.
 *
 * Over Earth the path is planned against the Sun, not the ground
 * (nightSide.js): it comes in over the evening's crescent, passes over the
 * terminator into Earth's shadow, the Sun hidden behind Earth, and holds
 * there while the exposure adapts and the city lights come up, over
 * whichever night side near local midnight has the most of them now.  So
 * every visit shows the same picture, and only the place under it changes
 * with the hour.
 *
 * Azimuths are from a body's sunward direction (the Sun's: toward Earth),
 * counterclockwise seen from the north (tour.js).  Distances are from the
 * body's centre.
 */


/** Near the Sun: a slow drift round it, its disc a third of the frame. */
export const HOME_TOUR_START = Object.freeze([
  Object.freeze({at: 0, body: 'sun', dist: 4.5 * SUN_RADIUS_METER, az: 95, el: 10, fov: 45}),
  Object.freeze({at: 14000, body: 'sun', dist: 4 * SUN_RADIUS_METER, az: 70, el: 6, fov: 45, ease: 'inOut'}),
])

/** Out from Earth to the stars. */
const HOME_TOUR_OUT = Object.freeze([
  // Out through the planets' orbits, turning to the Sun.
  {at: 96000, body: 'sun', dist: 40 * ASTRO_UNIT_METER, az: 40, el: 28, fov: 45, ease: 'inOut', turn: 0.5},
  // Out to the stars, the Sun one of them.
  {at: 114000, body: 'sun', dist: 12 * LIGHTYEAR_METER, az: 25, el: 30, fov: 55, ease: 'inOut'},
  // On out among Gaia's stars, the Milky Way around them.
  {at: 132000, body: 'sun', dist: 3200 * LIGHTYEAR_METER, az: 10, el: 32, fov: 60, ease: 'inOut'},
  // A moment there, then round again.
  {at: 140000, body: 'sun', dist: 3300 * LIGHTYEAR_METER, az: 8, el: 32, fov: 60, ease: 'linear'},
])

// Pulling back from the shadow, out to the Moon's distance, toward the day
// side: the Sun rises over the limb.
const PULL_BACK_DIST = 60 * EARTH_RADIUS_METER
const PULL_BACK_AZ = 55
const PULL_BACK_EL = 20


/**
 * The Earth segment's times, ms: the arrival over the crescent, into the
 * shadow, the hold's end (14 s there: nightSide.js, the meter's adaptation
 * measured in DESIGN.md "The tour"), the pull back.
 */
export const HOME_TOUR_EARTH_MS = Object.freeze({arrive: 32000, shadow: 50000, hold: 64000, back: 78000})


/**
 * The tour's keyframes for a pass over Earth.
 *
 * @param {object} pass planEarthPass's (nightSide.js): the `arrive`, `pass`
 *   (into the shadow) and `hold` keyframes' angles and distances
 * @returns {Array<object>}
 */
export function homeTourKeyframes(pass) {
  const backAz = unwrapDegrees(PULL_BACK_AZ, pass.hold.az)
  return [
    ...HOME_TOUR_START,
    // On to Earth: the camera turns to it in the first part, then closes
    // in, Earth growing steadily, to arrive over the evening's crescent.
    {at: HOME_TOUR_EARTH_MS.arrive, body: 'earth', dist: pass.arrive.dist, az: pass.arrive.az, el: pass.arrive.el,
      fov: 45, ease: 'inOut', turn: 0.45},
    // Over the terminator into Earth's shadow: the crescent thins, the Sun
    // sets behind the limb, and the night side faces the camera.
    {at: HOME_TOUR_EARTH_MS.shadow, body: 'earth', dist: pass.pass.dist, az: pass.pass.az, el: pass.pass.el,
      fov: 42, ease: 'inOut'},
    // Held in the shadow, creeping in, while the eye adapts to the night:
    // the city lights come up, the sunlit air a ring round the limb.
    {at: HOME_TOUR_EARTH_MS.hold, body: 'earth', dist: pass.hold.dist, az: pass.hold.az, el: pass.hold.el,
      fov: 42, ease: 'inOut'},
    // Pulling back toward the day side, out to the Moon's distance.
    {at: HOME_TOUR_EARTH_MS.back, body: 'earth', dist: PULL_BACK_DIST, az: backAz, el: PULL_BACK_EL,
      fov: 45, ease: 'inOut'},
    ...HOME_TOUR_OUT,
  ]
}


/**
 * Where the tour holds for a still scene (prefers-reduced-motion), ms: in
 * Earth's shadow, the night side's lights up once the exposure adapts.
 */
export const HOME_TOUR_STILL_MS = 58000


/**
 * A fade to black, ms, over the end of the loop and back from it over its
 * start, so the jump from the far stars to the Sun isn't seen.
 */
export const HOME_TOUR_LOOP_FADE_MS = 1200


/**
 * The homepage's tour, looping, planned for a time.
 *
 * @param {number} [ms] Unix epoch ms: the scene's date when it starts
 * @param {object} [opts]
 * @param {Function} [opts.sunAt] The Sun from Earth at a Julian Day, ecliptic
 *   of date (tonight.js): the app's ephemeris
 * @returns {CameraPath} With `plan`, the pass over Earth it was planned for
 *   (planEarthPass)
 */
export function homeTour(ms = Date.now(), opts = {}) {
  const plan = planEarthPass(ms, opts)
  const path = new CameraPath(homeTourKeyframes(plan), {loop: true})
  path.plan = plan
  return path
}
