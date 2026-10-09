/** The camera modes the keys switch on and off, by the name the readout shows. */
export const NAV_MODE_NAMES = {
  track: 'Tracking',
  follow: 'Following',
}


/**
 * What the readout shows when a mode changes ('t' tracking, 'f' following).
 *
 * @param {string} mode 'track' or 'follow'
 * @param {boolean} on
 * @returns {string} 'Tracking on', 'Following off'
 */
export function formatNavMode(mode, on) {
  return `${NAV_MODE_NAMES[mode] ?? mode} ${on ? 'on' : 'off'}`
}
