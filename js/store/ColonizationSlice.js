import {DEFAULT_PARAMS} from '../scene/Colonization.js'
import {DEFAULT_PULSE, DEFAULT_STYLE} from '../scene/ColonizationLines.js'
import {formatTokenNumber, formatTokenValue, parseTokenValue} from '../permalink.js'


/**
 * Human expansion (scene/Colonization.md)
 *
 * @param {Function} set
 * @param {Function} get
 * @returns {object} Zustand slice
 */
export default function createColonizationSlice(set, get) {
  return {
    // Mirrors Scene's 'x' setting, so the drawer's switch follows the 'x'
    // and 'V' keys.  Scene.toggleColonization writes it.
    isColonizationVisible: true,
  }
}


// The app's ID in the widgets drawer (ui/apps.jsx) and the permalink.
export const EXPANSION_APP_ID = 'expansion'


/**
 * The Human Expansion app's state (ui/ColonizationApp.jsx), as the widgets
 * slice keeps it for the permalink.  The model parameters are the computed
 * spread's while there is one (isRun), else the form's.
 */
export const DEFAULT_EXPANSION = Object.freeze({
  ...DEFAULT_PARAMS,
  playSeconds: 30,
  isRun: false,
  progress: 0, // 0 to 1 along the timeline
  isPlaying: false,
  pacing: 'stars', // or 'years'
  routeHip: null, // the star whose route from the Sun is drawn
  style: Object.freeze({...DEFAULT_STYLE}),
  pulse: Object.freeze({...DEFAULT_PULSE}),
})


// The app's controls' ranges, which a permalink's values are held to.
export const LIMITS = Object.freeze({
  speedC: [0.001, 1],
  numNeighbors: [1, 32],
  launchDelayYears: [0, Infinity],
  playSeconds: [1, Infinity],
  progress: [0, 1],
  width: [0.5, 12],
  opacity: [0.05, 1],
  attenuationLy: [10, 10000],
  stepSec: [0.02, Infinity],
  trail: [0, 30],
})


/**
 * The `apps.expansion` state token (design/URLs.md): what differs from
 * DEFAULT_EXPANSION, as `name=value`s.
 *
 * @param {object} s An expansion state
 * @returns {string|null} The token's value, null if all defaults
 */
export function encodeExpansionToken(s) {
  const d = DEFAULT_EXPANSION
  const num = (v, dv) => (v === dv ? null : formatTokenNumber(v))
  const bool = (v, dv) => (v === dv ? null : (v ? 1 : 0))
  const value = formatTokenValue([], {
    c: num(s.speedC, d.speedC),
    k: num(s.numNeighbors, d.numNeighbors),
    delay: num(s.launchDelayYears, d.launchDelayYears),
    dur: num(s.playSeconds, d.playSeconds),
    run: bool(s.isRun, d.isRun),
    at: s.isRun ? num(s.progress, d.progress) : null,
    play: s.isRun ? bool(s.isPlaying, d.isPlaying) : null,
    pace: s.pacing === d.pacing ? null : s.pacing,
    star: s.routeHip ?? null,
    w0: num(s.style.widthFirst, d.style.widthFirst),
    w1: num(s.style.widthLast, d.style.widthLast),
    op: num(s.style.opacity, d.style.opacity),
    atten: bool(s.style.sizeAttenuation, d.style.sizeAttenuation),
    full: num(s.style.attenuationLy, d.style.attenuationLy),
    pulse: bool(s.pulse.on, d.pulse.on),
    T: num(s.pulse.stepSec, d.pulse.stepSec),
    N: num(s.pulse.trail, d.pulse.trail),
  })
  return value || null
}


/**
 * @param {string} [value] The `apps.expansion` token's value
 * @returns {object} An expansion state: the token's values, held to LIMITS,
 *   over DEFAULT_EXPANSION; a bad value is its default
 */
export function decodeExpansionToken(value) {
  const {named} = parseTokenValue(value)
  const d = DEFAULT_EXPANSION
  const num = (name, dv, [min, max], isInt = false) => {
    const str = named[name]
    const v = Number(str)
    if (!str || !Number.isFinite(v) || (isInt && !Number.isInteger(v))) {
      return dv
    }
    return Math.min(Math.max(v, min), max)
  }
  const bool = (name, dv) => (named[name] === '1' ? true : named[name] === '0' ? false : dv)
  const star = Number(named.star)
  return {
    speedC: num('c', d.speedC, LIMITS.speedC),
    numNeighbors: num('k', d.numNeighbors, LIMITS.numNeighbors, true),
    launchDelayYears: num('delay', d.launchDelayYears, LIMITS.launchDelayYears),
    playSeconds: num('dur', d.playSeconds, LIMITS.playSeconds),
    isRun: bool('run', d.isRun),
    progress: num('at', d.progress, LIMITS.progress),
    isPlaying: bool('play', d.isPlaying),
    pacing: named.pace === 'years' ? 'years' : d.pacing,
    routeHip: named.star && Number.isInteger(star) && star >= 0 ? star : d.routeHip,
    style: {
      widthFirst: num('w0', d.style.widthFirst, LIMITS.width),
      widthLast: num('w1', d.style.widthLast, LIMITS.width),
      opacity: num('op', d.style.opacity, LIMITS.opacity),
      sizeAttenuation: bool('atten', d.style.sizeAttenuation),
      attenuationLy: num('full', d.style.attenuationLy, LIMITS.attenuationLy),
    },
    pulse: {
      on: bool('pulse', d.pulse.on),
      stepSec: num('T', d.pulse.stepSec, LIMITS.stepSec),
      trail: num('N', d.pulse.trail, LIMITS.trail, true),
    },
  }
}
