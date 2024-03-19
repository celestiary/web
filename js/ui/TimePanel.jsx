import React, {ReactElement, useEffect, useState} from 'react'
import Box from '@mui/material/Box'
import ButtonGroup from '@mui/material/ButtonGroup'
import Divider from '@mui/material/Divider'
import TimeFastForwardIcon from '@mui/icons-material/FastForward'
import TimeFastRewindIcon from '@mui/icons-material/FastRewind'
import TimeNowIcon from '@mui/icons-material/SettingsBackupRestore'
import TimePauseIcon from '@mui/icons-material/PauseCircleOutline'
import CalendarIcon from '@mui/icons-material/CalendarMonth'
import Time from '../Time'
import useStore from '../store/useStore'
import useIsMobile from '../useIsMobile'
import DatePicker from './DatePicker'
import TooltipIconButton from './TooltipIconButton'
import TooltipToggleButton from './TooltipToggleButton'


/**
 * A time control panel and simulation rate display
 *
 * @property {Time} time Time holder object for sys and sim time
 * @property {string} timeStr Time str state shared with app
 * @property {boolean} isPaused Simulation is paused
 * @returns {ReactElement}
 */
export default function TimePanel({time, timeStr, isPaused, setIsPaused}) {
  const isDatePickerVisible = useStore((state) => state.isDatePickerVisible)
  const setIsDatePickerVisible = useStore((state) => state.setIsDatePickerVisible)

  const [timeScale, setTimeScale] = useState(0)
  const isMobile = useIsMobile()


  useEffect(() => {
    setTimeScale(updateTimeMsg(time, isPaused))
  }, [time, setTimeScale, timeStr, isPaused])


  // TODO(pablo): redundant.. setting time state isn't reactive
  const onPauseClick = () => {
    setIsPaused(!isPaused)
    time.togglePause()
  }


  const mobileTimeStyle = {
    fontSize: 'x-small',
    textAlign: 'right',
  }


  return (
    <div id='time-id'>
      <Box
        id='date-id'
        sx={{
          ...isMobile ? mobileTimeStyle : {},
        }}
      >
        <>{timeStr} {isMobile || `(${time.simTimeJulianDay().toLocaleString()} Julian)`}</>
      </Box>
      <div id='time-scale-id'>{timeScale}</div>
      <ButtonGroup aria-label='Time and date controls'>
        <TooltipIconButton tip='Fast rewind' onClick={() => time.changeTimeScale(-1)} icon={<TimeFastRewindIcon/>}/>
        <TooltipIconButton tip='Now' onClick={() => time.setTimeToNow()} icon={<TimeNowIcon/>}/>
        <TooltipToggleButton tip='Pause' onClick={onPauseClick} icon={<TimePauseIcon/>}/>
        <TooltipIconButton tip='Fast forward' onClick={() => time.changeTimeScale(1)} icon={<TimeFastForwardIcon/>}/>
        <Divider orientation='vertical' variant='middle' flexItem/>
        <TooltipIconButton tip='Set date & time' onClick={() => setIsDatePickerVisible(true)} icon={<CalendarIcon/>}/>
      </ButtonGroup>
      {isDatePickerVisible &&
       <DatePicker
         time={time}
         isVisible={isDatePickerVisible}
         setIsVisible={setIsDatePickerVisible}
       />}
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

