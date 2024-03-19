import React, {ReactElement, useCallback, useEffect, useState} from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import useIsMobile from '../useIsMobile'
import NumberField from './NumberField'


/** @returns {ReactElement} */
export default function DatePicker({time, isVisible, setIsVisible}) {
  const [simTime] = useState(time.simTime)
  const [simYear, setSimYear] = useState(0)
  const [simMonth, setSimMonth] = useState(0)
  const [simDay, setSimDay] = useState(0)
  const [simHours, setSimHours] = useState(0)
  const [simMinutes, setSimMinutes] = useState(0)
  const [simSeconds, setSimSeconds] = useState(0)
  const isMobile = useIsMobile()

  /** Open datetime setter dialog on calendar icon click */
  const onLoad = useCallback(() => {
    const date = new Date(simTime)
    setSimYear(date.getFullYear())
    setSimMonth(date.getMonth() + 1)
    setSimDay(date.getDate())
    setSimHours(date.getHours())
    setSimMinutes(date.getMinutes())
    setSimSeconds(date.getSeconds())
    setIsVisible(true)
  }, [simTime, setIsVisible])

  useEffect(() => {
    onLoad()
  }, [onLoad])

  /** Toggle date and time picker visibility */
  function onDialogOk() {
    setIsVisible(false)
    const date = new Date(time.simTime)
    date.setFullYear(simYear)
    date.setMonth(simMonth - 1)
    date.setDate(simDay)
    date.setHours(simHours)
    date.setMinutes(simMinutes)
    date.setSeconds(simSeconds)
    time.setTime(date.getTime())
  }

  return (
    <Dialog open={isVisible} onClose={() => setIsVisible(false)}>
      <DialogTitle>Date & Time</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Stack direction={isMobile ? 'column' : 'row'} aria-labelledby='date-group-label' sx={{p: '1em 0.5em'}}>
            <NumberField label='Year' value={simYear} onChange={(val) => setSimYear(val)}/>
            <NumberField label='Month' value={simMonth} onChange={(val) => setSimMonth(val)}/>
            <NumberField label='Day' value={simDay} onChange={(val) => setSimDay(val)}/>
            <NumberField label='Hour' value={simHours} onChange={(val) => setSimHours(val)}/>
            <NumberField label='Minute' value={simMinutes} onChange={(val) => setSimMinutes(val)}/>
            <NumberField label='Second' value={simSeconds} onChange={(val) => setSimSeconds(val)}/>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDialogOk}>Set time</Button>
      </DialogActions>
    </Dialog>
  )
}
