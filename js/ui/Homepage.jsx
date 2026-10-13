import React, {ReactElement, useEffect, useRef, useState} from 'react'
import {HOME_CARDS, cardImage} from '../home'
import {handOffLoadingTitle} from '../loading'
import {permalinkHref} from '../permalink'
import SearchBar from './SearchBar'


/**
 * The homepage's foreground (DESIGN.md "Homepage"), over the tour: the
 * title (the loading title, handed off), the app's search, and four scene
 * cards.  Tonight's sky lands on the visitor's own sky
 * (Celestiary.openTonight: their location asked for on the click); the
 * others open their links in the app (Celestiary.openLink);
 * Esc, the "Explore" button, or a click, drag or wheel on the scene leaves
 * for the live scene (Celestiary.leaveHome).
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
  const titleRef = useRef(null)

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
        <button
          type='button'
          className='home-explore'
          data-testid='home-explore'
          onClick={() => celestiary.leaveHome()}
        >
          Explore the live scene <kbd>Esc</kbd>
        </button>
      </section>
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
