import React, {useEffect, useState} from 'react'
import TimeFastForwardIcon from '@mui/icons-material/FastForward'
import TimeFastRewindIcon from '@mui/icons-material/FastRewind'
import TimeNowIcon from '@mui/icons-material/SettingsBackupRestore'
import TimePauseIcon from '@mui/icons-material/PauseCircleOutline'
import Time from '../Time'
import TooltipIconButton from './TooltipIconButton'


/**
 * A time control panel and simulation rate display
 *
 * @property {Time} time Time holder object for sys and sim time
 * @property {string} timeStr Time str state shared with app
 * @property {boolean} isPaused Simulation is paused
 * @returns {React.ReactElement}
 */
export default function TimePanel({time, timeStr, isPaused, setIsPaused}) {
  const [timeScale, setTimeScale] = useState('')


  useEffect(() => {
    setTimeScale(updateTimeMsg(time, isPaused))
  }, [time, setTimeScale, timeStr, isPaused])


  // TODO(pablo): redundant.. setting time state isn't reactive
  const onPauseClick = () => {
    setIsPaused(!isPaused)
    time.togglePause()
  }

  return (
    <div id='time-id'>
      <div id='date-id'>{timeStr} ({time.simTimeJulianDay().toLocaleString()} Julian)</div>
      <div id='time-scale-id'>{timeScale}</div>
      <div id='time-controls-id'>
        <TooltipIconButton tip='Fast rewind' onClick={() => time.changeTimeScale(-1)} icon={<TimeFastRewindIcon/>}/>
        <TooltipIconButton tip='Now' onClick={() => time.setTimeToNow()} icon={<TimeNowIcon/>}/>
        <TooltipIconButton tip='Pause' onClick={onPauseClick} icon={<TimePauseIcon/>}/>
        <TooltipIconButton tip='Fast forward' onClick={() => time.changeTimeScale(1)} icon={<TimeFastForwardIcon/>}/>
      </div>
    </div>
  )
}


/**
 * Either 'real-time', '(paused)' or a friendly ratio of simTime /
 * realTime, e.g. 1 day/s
 *
 * @param {Time} time
 * @param {boolean} isPaused React state
 * @returns {string}
 */
function updateTimeMsg(time, isPaused) {
  let msg
  if (time.timeScale === 1) {
    msg = 'real-time'
  } else {
    const timeScale = time.timeScale
    const tsAbs = Math.abs(timeScale)
    let tsAbbrev = timeScale
    let tsUnit = 'secs'
    if (tsAbs > 60) {
      tsAbbrev = timeScale / 60
      tsUnit = 'mins'
      if (tsAbs > 3600) {
        tsAbbrev = timeScale / 3600
        tsUnit = 'hrs'
        if (tsAbs > 86400) {
          tsAbbrev = timeScale / 86400
          tsUnit = 'days'
          if (tsAbs > 31557600) {
            tsAbbrev = timeScale / 31557600
            tsUnit = 'yrs'
          }
        }
      }
    }
    msg = `${tsAbbrev.toLocaleString()} ${tsUnit}/sec`
  }
  if (isPaused) {
    msg += ' (paused)'
  }
  return msg
}

