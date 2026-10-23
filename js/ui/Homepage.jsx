import React, {ReactElement, useCallback, useEffect, useRef, useState} from 'react'
import {checkNew, freshIds, markSeen, stampEntries, unseenCount} from '../changelog'
import {HOME_CARDS, cardImage} from '../home'
import {handOffLoadingTitle} from '../loading'
import {permalinkHref} from '../permalink'
import SearchBar from './SearchBar'
import WhatsNew from './WhatsNew'


/**
 * The homepage's foreground (DESIGN.md "Homepage"), over the tour: the
 * title (the loading title, handed off), the app's search, and four scene
 * cards.  Tonight's sky lands on the visitor's own sky
 * (Celestiary.openTonight: their location asked for on the click); the
 * others open their links in the app (Celestiary.openLink);
 * Esc, the "Explore" button, or a click, drag or wheel on the scene leaves
 * for the live scene (Celestiary.leaveHome).  A What's new button opens
 * the changelog's latest entries (ui/WhatsNew.jsx), with a marker for what's
 * new since the visitor's last visit.
 *
 * Its phase is Celestiary's (store/HomeSlice.js): 'waiting' (laid out,
 * unseen, so the loading title has a place to go), 'in', 'out'.
 *
 * @param {object} props
 * @param {object} props.celestiary
 * @param {string} props.phase
 * @returns {ReactElement}
 */
export default function Homepage({celestiary, phase}) {
  const [locating, setLocating] = useState(false)
  const [news, setNews] = useState(null)
  const [newsOpen, setNewsOpen] = useState(false)
  const titleRef = useRef(null)
  const newsButtonRef = useRef(null)

  // Tonight's sky asks where the visitor is now, on the click, not before.
  const openTonight = () => {
    if (locating) {
      return
    }
    setLocating(true)
    celestiary.openTonight().catch((e) => {
      console.warn('Tonight\'s sky:', e)
      setLocating(false)
    })
  }

  // The button and its marker, from the changelog's dates, which the app
  // carries (changelogStamp.json): the changelog itself is fetched when What's
  // new opens (#258).
  useEffect(() => {
    const dates = stampEntries()
    if (dates.length) {
      // The marker counts the featured entries, what What's new opens on.
      const {since} = checkNew(dates)
      setNews({dates, since, unseen: unseenCount(stampEntries(undefined, 'featured'), since), entries: null, fresh: new Set()})
    }
  }, [celestiary])

  const openNews = () => {
    setNewsOpen(true)
    // Seeing the entries clears the marker; they stay tagged New while open.
    markSeen(news.dates)
    setNews({...news, unseen: 0})
    celestiary.loadNews().then((entries) => {
      if (!entries.length) {
        throw new Error('no entries')
      }
      setNews((n) => (n && {...n, entries, fresh: freshIds(entries, n.since)}))
    }).catch((e) => {
      // No changelog, no button, as when it failed with the page before.
      console.warn('What\'s new:', e)
      setNewsOpen(false)
      setNews(null)
    })
  }
  const closeNews = useCallback(() => {
    setNewsOpen(false)
    newsButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (phase === 'in') {
      handOffLoadingTitle(titleRef.current, {reducedMotion: prefersReducedMotion()})
    }
  }, [phase])

  return (
    <div id='home' className={`home home-${phase}`} data-testid='home'>
      <div className='home-scrim' aria-hidden='true'/>
      <section className='home-content' aria-labelledby='home-title'>
        <h1 id='home-title' ref={titleRef} className='home-title'>Celestiary</h1>
        <p className='home-sr-only'>
          The universe to scale, live in your browser: search for a body, star or place, or open one of the
          scenes below.
        </p>
        <div className='home-search'>
          <SearchBar celestiary={celestiary} home/>
        </div>
        <ul className='home-cards' aria-label='Scenes'>
          {HOME_CARDS.map((card) => (
            <li key={card.id}>
              {card.link === null ?
              <button
                type='button'
                className='home-card'
                data-testid={`home-card-${card.id}`}
                aria-busy={locating}
                onClick={openTonight}
              >
                <img className='home-card-image' src={cardImage(card.id)} alt='' width='600' height='375'/>
                <span className='home-card-words'>
                  <span className='home-card-title'>{card.title}</span>
                  <span className='home-card-text'>{locating ? 'Finding where you are…' : card.text}</span>
                </span>
              </button> :
              <a
                className='home-card'
                href={cardHref(card.link)}
                data-testid={`home-card-${card.id}`}
                onClick={(e) => {
                  // A new tab or window takes the link itself.
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                    return
                  }
                  e.preventDefault()
                  celestiary.openLink(card.link)
                }}
              >
                <img className='home-card-image' src={cardImage(card.id)} alt='' width='600' height='375'/>
                <span className='home-card-words'>
                  <span className='home-card-title'>{card.title}</span>
                  <span className='home-card-text'>{card.text}</span>
                </span>
              </a>}
            </li>
          ))}
        </ul>
        <div className='home-actions'>
          {news &&
            <button
              type='button'
              className='home-news'
              ref={newsButtonRef}
              data-testid='home-news'
              aria-haspopup='dialog'
              aria-busy={newsOpen && !news.entries}
              onClick={openNews}
            >
              What&apos;s new
              {news.unseen > 0 &&
                <span className='home-news-marker' data-testid='home-news-marker'>
                  {news.unseen} new
                </span>}
            </button>}
          <button
            type='button'
            className='home-explore'
            data-testid='home-explore'
            onClick={() => celestiary.leaveHome()}
          >
            Explore the live scene <kbd>Esc</kbd>
          </button>
        </div>
      </section>
      {newsOpen && news?.entries && <WhatsNew celestiary={celestiary} entries={news.entries} fresh={news.fresh} onClose={closeNews}/>}
    </div>
  )
}


/**
 * @param {string} link A fragment
 * @returns {string} The card's link as a URL, the page's query kept
 */
function cardHref(link) {
  return permalinkHref(link, document.baseURI, window.location.search)
}


/** @returns {boolean} */
function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
}
