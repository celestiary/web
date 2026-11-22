/**
 * The Earth breathing app's panel (ui/apps.jsx; design/URLs.md, the time
 * token's day steps), a chunk of its own loaded on the app's first open:
 * play and pause, the speed in days a second, the date and month, and a
 * scrubber over the year that lands on the day's solar noon.  The steps
 * themselves are the clock's (Time.setStepDays): the app opens them on its
 * view (store/breathingApp.js startBreathing) and its stop ends them.
 *
 * No JSX and no imports from the first load: what this chunk shares with it
 * (React, MUI's pieces, the app's constants) comes in `deps` from apps.jsx,
 * which has them already (AGENTS.md, keep the first load lean).
 *
 * @param {object} deps {React, Box, Stack, Typography, IconButton, Slider,
 *   ToggleButton, ToggleButtonGroup, PlayIcon, PauseIcon, speeds,
 *   daysPerSecond}
 * @returns {Function} The panel's component
 */
export function breathingApp(deps) {
  const {React, Box, Stack, Typography, IconButton, Slider, ToggleButton, ToggleButtonGroup, PlayIcon, PauseIcon,
    speeds, daysPerSecond} = deps
  const h = React.createElement
  const {useEffect, useState} = React


  /**
   * @param {object} time
   * @returns {object} What the panel shows of the clock
   */
  function readClock(time) {
    return {ms: time.simTime, paused: time.isPaused, stepping: time.stepDays > 0, rate: daysPerSecond(time.timeScale)}
  }


  /**
   * @property {object} celestiary The app
   * @returns {object} The panel
   */
  function BreathingApp({celestiary}) {
    const time = celestiary.time
    const [clock, setClock] = useState(() => readClock(time))
    // The clock isn't React state; read it a few times a second.
    useEffect(() => {
      const timer = setInterval(() => setClock(readClock(time)), READOUT_MS)
      return () => clearInterval(timer)
    }, [time])
    const refresh = () => setClock(readClock(time))
    const steps = () => {
      if (time.stepDays === 0) {
        time.setStepDays(1)
      }
    }
    const togglePause = () => {
      steps()
      time.setPaused(!time.isPaused)
      celestiary.setIsPaused?.(time.isPaused)
      refresh()
    }
    const setSpeed = (e, days) => {
      if (days !== null) {
        steps()
        time.setRate(days * DAY_S)
        refresh()
      }
    }
    // A day of the year, landed at its noon under the camera.
    const date = new Date(clock.ms)
    const year = date.getUTCFullYear()
    const yearStart = Date.UTC(year, 0, 1, NOON_UTC_HOUR)
    const dayOfYear = Math.floor((clock.ms - Date.UTC(year, 0, 1)) / DAY_MS) + 1
    const toDay = (e, day) => {
      const target = yearStart + ((day - 1) * DAY_MS)
      time.setTime(time.noonNear ? time.noonNear(target) : target)
      refresh()
    }
    const speed = speeds.includes(clock.rate) ? clock.rate : null
    const month = date.toLocaleDateString('en-US', {month: 'long', timeZone: 'UTC'})
    const day = date.toLocaleDateString('en-US', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'})
    return h(Box, {'sx': {px: 2, pb: 2}, 'data-testid': 'breathing-app'},
        h(Typography, {variant: 'body2', sx: {mb: 1.5}},
            'Earth from noon to noon: the clock jumps a day at a time, always to local noon under the camera, ' +
            'so the Sun holds over the same ground while the seasons go round. The snow comes and goes, the land ' +
            'greens and browns, and the terminator rocks north and south.'),
        h(Box, {'sx': {fontFamily: 'monospace', fontSize: '0.8rem', mb: 0.5}, 'data-testid': 'breathing-date'},
            h('div', null, `${month}, day ${dayOfYear}`),
            h('div', null, `${day}, ${date.toISOString().slice(11, 16)} UTC (noon below)`),
            h('div', null, clock.stepping ? `${clock.rate.toLocaleString('en-US')} days a second${clock.paused ?
              ', paused' : ''}` : 'Not stepping: press play')),
        h(Stack, {direction: 'row', alignItems: 'center', spacing: 0.5},
            h(IconButton, {'size': 'small', 'onClick': togglePause, 'aria-label': clock.paused || !clock.stepping ?
              'Play' : 'Pause', 'data-testid': 'breathing-play'},
            h(clock.paused || !clock.stepping ? PlayIcon : PauseIcon, {fontSize: 'small'})),
            h(ToggleButtonGroup, {'size': 'small', 'exclusive': true, 'value': speed, 'onChange': setSpeed,
              'aria-label': 'Days a second', 'sx': {flexWrap: 'wrap'}},
            speeds.map((days) => h(ToggleButton, {key: days, value: days,
              sx: {px: 0.75, py: 0.25, textTransform: 'none', fontSize: '0.7rem'}}, `${days} d/s`)))),
        h(Slider, {'size': 'small', 'aria-label': 'Day of the year', 'min': 1, 'max': DAYS_IN_SCRUBBER,
          'value': Math.min(DAYS_IN_SCRUBBER, Math.max(1, dayOfYear)), 'onChange': toDay,
          'data-testid': 'breathing-year'}))
  }

  return BreathingApp
}


const READOUT_MS = 250
const DAY_S = 86400
const DAY_MS = DAY_S * 1000
const DAYS_IN_SCRUBBER = 365
// The scrubber's target before its noon is found: midday UTC.
const NOON_UTC_HOUR = 12
