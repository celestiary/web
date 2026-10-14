import React, {Fragment, useEffect, useRef, useState} from 'react'
import {formatEntryDate} from '../changelog'
import {permalinkHref} from '../permalink'
import {SmallCloseIcon, SmallPlayIcon} from './NewsIcons'


// How many entries show at first, and how many more each "Show earlier" adds.
const FIRST_ENTRIES = 8
const MORE_ENTRIES = 16


/**
 * The homepage's What's new (DESIGN.md "What's new"): the changelog's latest
 * entries, each with its headline, date and text.  An entry with a
 * permalink flies to its scene as a card does (Celestiary.openLink) and can
 * start the changelog tour from itself (Celestiary.startNewsTour); one
 * without is for reading.  The entries that came since the visitor's last
 * visit are tagged New.  Esc closes it before it leaves the homepage.
 *
 * @param {object} props
 * @param {object} props.celestiary
 * @param {Array<object>} props.entries The changelog (changelog.js), newest first
 * @param {Set<string>} props.fresh The ids of the entries new to this visitor
 * @param {Function} props.onClose
 * @returns {React.ReactElement}
 */
export default function WhatsNew({celestiary, entries, fresh, onClose}) {
  const [shown, setShown] = useState(FIRST_ENTRIES)
  const closeRef = useRef(null)
  const flyable = entries.filter((e) => e.permalink).length

  useEffect(() => {
    closeRef.current?.focus()
    // Before the app's own Esc, which would leave the homepage.
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const play = (opts) => {
    onClose()
    celestiary.startNewsTour(opts)
  }

  return (
    <div className='news-panel' data-testid='news-panel'>
      <div
        className='news-sheet'
        role='dialog'
        aria-modal='true'
        aria-labelledby='news-title'
      >
        <header className='news-head'>
          <h2 id='news-title' className='news-title'>What&apos;s new</h2>
          <div className='news-head-actions'>
            {flyable > 0 &&
              <button
                type='button'
                className='news-play'
                data-testid='news-play'
                onClick={() => play({})}
              >
                <SmallPlayIcon/>
                Play the tour
              </button>}
            <button
              type='button'
              className='news-close'
              ref={closeRef}
              aria-label='Close'
              data-testid='news-close'
              onClick={onClose}
            >
              <SmallCloseIcon/>
            </button>
          </div>
        </header>
        <div className='news-body'>
          <ol className='news-list' aria-label='Latest changes'>
            {entries.slice(0, shown).map((entry, i) => (
              <li
                key={entry.id}
                className={`news-entry${fresh.has(entry.id) ? ' news-entry-new' : ''}`}
                data-testid={`news-entry-${i}`}
              >
                <div className='news-meta'>
                  <time dateTime={entry.date}>{formatEntryDate(entry.date)}</time>
                  {fresh.has(entry.id) && <span className='news-new'>New</span>}
                </div>
                <h3 className='news-headline'>{entry.headline.replace(/`/g, '')}</h3>
                {entry.image &&
                  <img className='news-image' src={entry.image.src} alt={entry.image.alt} loading='lazy'/>}
                <div className='news-text'>{renderText(entry.text)}</div>
                <div className='news-foot'>
                  {entry.permalink &&
                    <div className='news-actions'>
                      <a
                        className='news-fly'
                        href={permalinkHref(entry.permalink, document.baseURI, window.location.search)}
                        data-testid={`news-fly-${i}`}
                        onClick={(e) => {
                          // A new tab or window takes the link itself.
                          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                            return
                          }
                          e.preventDefault()
                          onClose()
                          celestiary.openLink(entry.permalink)
                        }}
                      >
                        Fly there
                      </a>
                      <button
                        type='button'
                        className='news-from'
                        data-testid={`news-from-${i}`}
                        onClick={() => play({from: entry.id})}
                      >
                        Tour from here
                      </button>
                    </div>}
                  <div className='news-links'>
                    {entry.links.map((l) => (
                      <a key={l.url} href={l.url} target='_blank' rel='noopener noreferrer'>
                        {l.kind === 'pr' ? 'PR' : 'Issue'} #{l.number}
                      </a>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {shown < entries.length &&
            <button
              type='button'
              className='news-more'
              data-testid='news-more'
              onClick={() => setShown(shown + MORE_ENTRIES)}
            >
              Show earlier ({entries.length - shown} more)
            </button>}
        </div>
      </div>
    </div>
  )
}


/**
 * An entry's text as paragraphs, its `code` spans as code.
 *
 * @param {string} text Paragraphs separated by a blank line
 * @returns {Array<React.ReactElement>}
 */
export function renderText(text) {
  return text.split(/\n\s*\n/).filter(Boolean).map((paragraph, i) => (
    <p key={i}>
      {paragraph.split('`').map((part, j) => (
        j % 2 === 1 ? <code key={j}>{part}</code> : <Fragment key={j}>{part}</Fragment>
      ))}
    </p>
  ))
}
