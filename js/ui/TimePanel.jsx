import React, {ReactElement, useEffect, useState} from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import TimeFastForwardIcon from '@mui/icons-material/FastForward'
import TimeFastRewindIcon from '@mui/icons-material/FastRewind'
import TimeNowIcon from '@mui/icons-material/SettingsBackupRestore'
import TimePauseIcon from '@mui/icons-material/PauseCircleOutline'
import CalendarIcon from '@mui/icons-material/CalendarMonth'
import Time from '../Time'
import useStore from '../store/useStore'
import useIsMobile from '../useIsMobile'
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
  const isTimeDialogVisible = useStore((state) => state.isTimeDialogVisible)
  const setIsTimeDialogVisible = useStore((state) => state.setIsTimeDialogVisible)

  const [simYear, setSimYear] = useState('')
  const [simMonth, setSimMonth] = useState('')
  const [simDay, setSimDay] = useState('')
  
  const [timeScale, setTimeScale] = useState('')
  const [unixTime, setUnixTime] = useState(null)
  const [era, setEra] = useState('CE')
  const isMobile = useIsMobile()


  useEffect(() => {
    setTimeScale(updateTimeMsg(time, isPaused))
  }, [time, setTimeScale, timeStr, isPaused])


  // TODO(pablo): redundant.. setting time state isn't reactive
  const onPauseClick = () => {
    setIsPaused(!isPaused)
    time.togglePause()
  }


  /** Open datetime setter dialog on calendar icon click */
  function onSetDatetimeClick() {
    console.log('time.simTime', time.simTime)

    /** @returns {number} fractional part of num */
    function getFractionalPart(num) {
      return Math.abs(num) - Math.floor(Math.abs(num))
    }

    const y = time.simTime / 1000 / 86400 / 365.25
    setSimYear(1970 + Math.floor(y))

    const m = getFractionalPart(y) * 12 // TODO(pablo)
    setSimMonth(1 + Math.floor(m))

    const d = getFractionalPart(m) * 30 // TODO(pablo)
    setSimDay(Math.floor(d))

    setUnixTime(time.simTime)
    setIsTimeDialogVisible(true)
  }


  /**
   * Toggle date and time picker visibility
   *
   * @param {dayjs} d
   */
  function onChange(d) {
    setUnixTime(d.unix() * 1000)
  }


  /** Toggle date and time picker visibility */
  function onDialogOk() {
    setIsTimeDialogVisible(false)
    console.log('y:${simYear} m:${simMonth} d:${simDay} e:${era}')
    const millisPerDay = 86400 * 1000
    let t = simYear * 365.25 * millisPerDay
    t += simMonth * 30 * millisPerDay
    t += simDay * millisPerDay
    // y * (era === 'CE' ? 1 : -1) * unixTime
    console.log('time', t, new Date(t))
    time.setTime(t)
  }


  const mobileTimeStyle = {
    fontSize: 'x-small',
    textAlign: 'center',
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
        <TooltipIconButton tip='Set date & time' onClick={onSetDatetimeClick} icon={<CalendarIcon/>}/>
        <Dialog open={isTimeDialogVisible} onClose={() => setIsTimeDialogVisible(false)}>
          <DialogTitle>Date & Time</DialogTitle>
          <DialogContent>
            <FormControl sx={{m: '1em 0'}}>
              <Stack spacing={2}>
                <FormLabel id='date-group-label'>Date</FormLabel>
                <Stack direction='row' aria-labelledby='date-group-label'>
                  <TextField value={simYear} onChange={(event) => setSimYear(event.target.value)} sx={{width: '4em'}}/>
                  <TextField value={simMonth} onChange={(event) => setSimMonth(event.target.value)} sx={{width: '2em'}}/>
                  <TextField value={simDay} onChange={(event) => setSimDay(event.target.value)} sx={{width: '2em'}}/>
                </Stack>
                <FormLabel id='era-radio-buttons-group-label'>Era</FormLabel>
                <RadioGroup
                  aria-labelledby='era-radio-buttons-group-label'
                  defaultValue='CE'
                  value={era}
                  onChange={(event) => setEra(event.target.value)}
                  row
                >
                  <FormControlLabel value='BCE' control={<Radio/>} label='BCE' />
                  <FormControlLabel value='CE' control={<Radio/>} label='CE' />
                </RadioGroup>
              </Stack>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button onClick={onDialogOk}>Set time</Button>
          </DialogActions>
        </Dialog>
      </ButtonGroup>
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

