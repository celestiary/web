import React, {useEffect, useRef, useState} from 'react'
import {formatEntryDate} from '../changelog'
import {CloseIcon, PauseIcon, PlayIcon, SkipNextIcon, SkipPreviousIcon} from './NewsIcons'


// How long the controls stay up after the pointer last moved, ms (on a
// device with a pointer that can hover; a touch screen's stay).
const CONTROLS_AWAKE_MS = 3500


/**
 * The changelog tour's caption and controls (DESIGN.md "What's new"), over
 * the scene while the tour plays (newsTour.js): the entry's date, headline
 * and sentence once the camera is there, and previous, pause, next and
 * stop.  Made for screen recording: the caption is large, on a scrim, and
 * nothing else is on screen; the controls fade away when the pointer rests
 * and wake when it moves.  Keys: Space pauses, the arrows skip, Esc ends
 * (Celestiary._onNewsKey).
 *
 * @param {object} props
 * @param {object} props.celestiary
 * @param {object} props.tour The tour's state (NewsTour.state)
 * @returns {React.ReactElement}
 */
export default function NewsTour({celestiary, tour}) {
  const [awake, setAwake] = useState(true)
  // The caption on screen: the stop's once the camera is there, and held
  // while it fades out for the flight to the next, so the next stop's words
  // don't show before they're meant to.
  const [shown, setShown] = useState(tour.phase === 'holding' ? {entry: tour.entry, caption: tour.caption} : null)
  const timerRef = useRef(null)

  useEffect(() => {
    const wake = () => {
      setAwake(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setAwake(false), CONTROLS_AWAKE_MS)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timerRef.current)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  const {entry, caption, index, count, phase, paused} = tour
  const showing = phase === 'holding'
  useEffect(() => {
    if (showing) {
      setShown({entry, caption})
    }
  }, [showing, entry])
  const act = (action) => () => celestiary.newsTourControl(action)

  return (
    <div
      id='news-tour'
      className={`news-tour${showing ? ' news-tour-showing' : ''}${awake || paused ? ' news-tour-awake' : ''}`}
      role='region'
      aria-label='What&apos;s new tour'
      data-testid='news-tour'
      data-phase={phase}
    >
      <div className='news-scrim' aria-hidden='true'/>
      <div className='news-caption' aria-live='polite' data-testid='news-caption'>
        {shown &&
          <>
            <div className='news-caption-meta'>
              <time dateTime={shown.entry.date}>{formatEntryDate(shown.entry.date)}</time>
            </div>
            <h2 className='news-caption-headline'>{shown.caption.headline}</h2>
            {shown.caption.sentence && <p className='news-caption-text'>{shown.caption.sentence}</p>}
          </>}
      </div>
      <div className='news-controls' data-testid='news-controls'>
        <button type='button' aria-label='Previous' data-testid='news-prev' onClick={act('previous')}>
          <SkipPreviousIcon/>
        </button>
        <button
          type='button'
          aria-label={paused ? 'Play' : 'Pause'}
          data-testid='news-pause'
          onClick={act('pause')}
        >
          {paused ? <PlayIcon/> : <PauseIcon/>}
        </button>
        <button type='button' aria-label='Next' data-testid='news-next' onClick={act('next')}>
          <SkipNextIcon/>
        </button>
        <span className='news-count' data-testid='news-count'>{index + 1} / {count}</span>
        <button type='button' aria-label='Stop the tour' data-testid='news-stop' onClick={act('stop')}>
          <CloseIcon/>
        </button>
      </div>
    </div>
  )
}
