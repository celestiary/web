import React from 'react'


function updateTimeMsg(time) {
  let msg = ''
  if (time.timeScale == 1) {
    msg = 'real-time'
  } else {
    msg = time.timeScale.toLocaleString() + ' secs/s'
  }
  if (time.pause) {
    msg += ' (paused)'
  }
  return msg
}


export default function TimePanel({time, timeStr}) {
  const [timeScale, setTimeScale] = React.useState('')
  React.useEffect(() => {
    setTimeScale(updateTimeMsg(time))
  }, [timeStr]) // TODO: shouldn't depend on this to set time-scale.
  return (
    <div id="time-id">
      <div id="date-id">{timeStr}</div>
      <div id="time-scale-id">{timeScale}</div>
      <div id="time-controls-id">
        <button onClick={() => {
          time.changeTimeScale(1)
        }}>+</button>
        <button onClick={() => {
          time.changeTimeScale(-1)
        }}>-</button>
        <button onClick={() => {
          time.changeTimeScale(0)
        }}>=</button>
        <button onClick={() => {
          time.invertTimeScale()
        }}>/</button>
      </div>
    </div>)
}
