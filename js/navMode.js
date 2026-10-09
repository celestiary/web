/** The camera modes the keys switch on and off, by the name the readout shows. */
export const NAV_MODE_NAMES = {
  track: 'Tracking',
  follow: 'Following',
}


/** Why 'f' can't turn following off, as the readout says it. */
const NOTES = {
  root: 'nothing above the Sun to leave',
  landed: 'landed: pinned to the surface',
}


/**
 * What the readout shows when a mode changes ('t' tracking, 'f' following).
 * A `note` (why 'f' did nothing) follows, in brackets.
 *
 * @param {string} mode 'track' or 'follow'
 * @param {boolean} on
 * @param {string} [note] 'root' or 'landed'
 * @returns {string} 'Tracking on', 'Following off', 'Following on (landed: pinned to the surface)'
 */
export function formatNavMode(mode, on, note) {
  const text = `${NAV_MODE_NAMES[mode] ?? mode} ${on ? 'on' : 'off'}`
  return NOTES[note] ? `${text} (${NOTES[note]})` : text
}
