import React, {Fragment, useEffect, useRef, useState} from 'react'
import {formatEntryDate, localStorageOrNull, readShowAll, visibleEntries, writeShowAll} from '../changelog'
import {permalinkHref} from '../permalink'
import {SOCIAL_PLATFORMS} from '../socialLinks.mjs'
import {FacebookIcon, SmallCloseIcon, SmallFilterIcon, SmallPlayIcon, XIcon} from './NewsIcons'


// The icon for each platform of an entry's social links.
const SOCIAL_ICONS = {x: XIcon, facebook: FacebookIcon}


// How many entries show at first, and how many more each "Show earlier" adds.
const FIRST_ENTRIES = 8
const MORE_ENTRIES = 16


/**
 * The homepage's What's new (DESIGN.md "What's new"): the changelog's latest
 * entries, each with its headline, date and text.  An entry with a
 * permalink flies to its scene as a card does (Celestiary.openLink) and can
 * start the changelog tour from itself (Celestiary.startNewsTour); one
 * without is for reading.  The entries that came since the visitor's last
 * visit are tagged New.  It opens on the featured entries; "Show all updates"
 * adds the lesser features and fixes, and the visitor's choice is
 * remembered (localStorage, in try/catch).  A featured entry that has been
 * announced links to its posts on X and Facebook.  Esc closes it before it
 * leaves the homepage.
 *
 * @param {object} props
 * @param {object} props.celestiary
 * @param {Array<object>} props.entries The changelog (changelog.js), newest first
 * @param {Set<string>} props.fresh The ids of the entries new to this visitor
 * @param {Function} props.onClose
 * @param {?Storage} [props.storage] Where the choice is kept (the browser's by default)
 * @returns {React.ReactElement}
 */
export default function WhatsNew({celestiary, entries: allEntries, fresh, onClose, storage = localStorageOrNull()}) {
  const [shown, setShown] = useState(FIRST_ENTRIES)
  const [showAll, setShowAll] = useState(() => readShowAll(storage))
  const closeRef = useRef(null)
  const entries = visibleEntries(allEntries, showAll)
  // A filter only where there is something to filter.
  const canFilter = allEntries.some((e) => e.featured) && allEntries.some((e) => !e.featured)
  const lesser = allEntries.filter((e) => !e.featured).length
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

  // The tour follows the list, whether or not the choice could be stored.
  const play = (opts) => {
    onClose()
    celestiary.startNewsTour({...opts, showAll})
  }

  const toggleAll = () => {
    writeShowAll(!showAll, storage)
    setShowAll(!showAll)
    setShown(FIRST_ENTRIES)
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
        {canFilter &&
          <div className='news-filter'>
            <span className='news-filter-note' data-testid='news-filter-note'>
              {showAll ? 'All updates, including lesser features and fixes' : 'Featured updates'}
            </span>
            <button
              type='button'
              className='news-filter-toggle'
              data-testid='news-filter-toggle'
              aria-pressed={showAll}
              onClick={toggleAll}
            >
              <SmallFilterIcon/>
              {showAll ? 'Show featured only' : `Show all updates (${lesser} more)`}
            </button>
          </div>}
        <div className='news-body'>
          <ol className='news-list' aria-label={showAll ? 'All updates' : 'Featured updates'}>
            {entries.slice(0, shown).map((entry, i) => (
              <li
                key={entry.id}
                className={`news-entry${fresh.has(entry.id) ? ' news-entry-new' : ''}`}
                data-testid={`news-entry-${i}`}
              >
                <div className='news-meta'>
                  <time dateTime={entry.date}>{formatEntryDate(entry.date)}</time>
                  {fresh.has(entry.id) && <span className='news-new'>New</span>}
                  {showAll && entry.featured && <span className='news-featured'>Featured</span>}
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
                    {entry.social &&
                      <span className='news-social' data-testid={`news-social-${i}`}>
                        {Object.values(SOCIAL_PLATFORMS).filter((p) => entry.social[p.key]).map((p) => {
                          const Icon = SOCIAL_ICONS[p.key]
                          return (
                            <a
                              key={p.key}
                              className='news-social-link'
                              href={entry.social[p.key]}
                              target='_blank'
                              rel='noopener'
                              aria-label={p.aria}
                              title={p.aria}
                              data-testid={`news-social-${p.key}-${i}`}
                            >
                              <Icon/>
                            </a>
                          )
                        })}
                      </span>}
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
