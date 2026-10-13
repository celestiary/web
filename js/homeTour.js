import CameraPath from './tour'
import {ASTRO_UNIT_METER, LIGHTYEAR_METER, SUN_RADIUS_METER} from './shared'


/**
 * The homepage's tour (DESIGN.md "Homepage"): behind the title, the search
 * and the cards, a slow loop from the Sun to Earth and out to the stars,
 * on the real scene, the exposure metering as it goes.  About two minutes,
 * then a fade to black and round again.
 *
 * Azimuths are from a body's sunward direction (the Sun's: toward Earth),
 * counterclockwise seen from the north (tour.js).  Distances are from the
 * body's centre.
 */


const EARTH_RADIUS_METER = 6.371e6


export const HOME_TOUR_KEYFRAMES = Object.freeze([
  // Near the Sun: a slow drift round it, its disc a third of the frame.
  {at: 0, body: 'sun', dist: 4.5 * SUN_RADIUS_METER, az: 95, el: 10, fov: 45},
  {at: 14000, body: 'sun', dist: 4 * SUN_RADIUS_METER, az: 70, el: 6, fov: 45, ease: 'inOut'},
  // On to Earth: the camera turns to it in the first part, then closes in,
  // Earth growing steadily, to arrive over the day side.
  {at: 32000, body: 'earth', dist: 3.4 * EARTH_RADIUS_METER, az: 30, el: 12, fov: 45, ease: 'inOut', turn: 0.45},
  // A pass over the day side to the dusk terminator.
  {at: 56000, body: 'earth', dist: 2.9 * EARTH_RADIUS_METER, az: 105, el: 18, fov: 42, ease: 'inOut'},
  // Pulling back toward the day side, out to the Moon's distance.
  {at: 70000, body: 'earth', dist: 60 * EARTH_RADIUS_METER, az: 55, el: 20, fov: 45, ease: 'inOut'},
  // Out through the planets' orbits, turning to the Sun.
  {at: 88000, body: 'sun', dist: 40 * ASTRO_UNIT_METER, az: 40, el: 28, fov: 45, ease: 'inOut', turn: 0.5},
  // Out to the stars, the Sun one of them.
  {at: 106000, body: 'sun', dist: 12 * LIGHTYEAR_METER, az: 25, el: 30, fov: 55, ease: 'inOut'},
  // On out among Gaia's stars, the Milky Way around them.
  {at: 124000, body: 'sun', dist: 3200 * LIGHTYEAR_METER, az: 10, el: 32, fov: 60, ease: 'inOut'},
  // A moment there, then round again.
  {at: 132000, body: 'sun', dist: 3300 * LIGHTYEAR_METER, az: 8, el: 32, fov: 60, ease: 'linear'},
])


/**
 * Where the tour holds for a still scene (prefers-reduced-motion), ms: over
 * Earth's day side and terminator, mid-pass.
 */
export const HOME_TOUR_STILL_MS = 44000


/**
 * A fade to black, ms, over the end of the loop and back from it over its
 * start, so the jump from the far stars to the Sun isn't seen.
 */
export const HOME_TOUR_LOOP_FADE_MS = 1200


/** @returns {CameraPath} The homepage's tour, looping */
export function homeTour() {
  return new CameraPath(HOME_TOUR_KEYFRAMES, {loop: true})
}
