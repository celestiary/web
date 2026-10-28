import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react'
import {getCredits, setCreditsMotion, subscribeCredits} from '../credits.js'


/**
 * Every attribution on screen in one small line along the bottom, as a
 * map's (design/UI.md, "The credits footer"): Cesium's, which its
 * CreditDisplay keeps up to date in its own element, and celestiary's own
 * (credits.js), each while its data is drawn.  A timed credit fades in as
 * its data arrives and out some seconds later (credits.js, its phase); the
 * *Credits* button at the line's end shows every applicable one again while
 * it's hovered, focused from the keyboard, or tapped (tapped, until a tap
 * elsewhere or on it).  HTML chrome: it fades with the rest
 * (html.chrome-hidden) and `v` hides it (Celestiary._navDisplay).  Empty,
 * it isn't laid out.  Too long for the width (a phone's), it wraps: Bing's
 * terms forbid hiding its attribution behind a tap (CESIUM.md, "Credits").
 *
 * @returns {React.ReactElement}
 */
export default function CreditsFooter() {
  const entries = useSyncExternalStore(subscribeCredits, getCredits, getCredits)
  const [open, setOpen] = useState(CLOSED)
  const ref = useRef(null)
  // Reduced motion: in and out, no fade (index.css too).
  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) {
      return undefined
    }
    const apply = () => setCreditsMotion({reduced: query.matches})
    apply()
    query.addEventListener?.('change', apply)
    return () => query.removeEventListener?.('change', apply)
  }, [])
  // Tapped open, a tap anywhere else closes it.
  useEffect(() => {
    if (!open.pinned) {
      return undefined
    }
    const away = (ev) => {
      if (!ref.current?.contains(ev.target)) {
        setOpen((s) => affordance(s, 'away'))
      }
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open.pinned])
  const on = (event) => () => setOpen((s) => affordance(s, event))
  const handlers = {
    // A mouse's hover only: a touch's tap toggles (onToggle).
    onPointerEnter: (ev) => ev.pointerType === 'mouse' && setOpen((s) => affordance(s, 'enter')),
    onPointerLeave: (ev) => ev.pointerType === 'mouse' && setOpen((s) => affordance(s, 'leave')),
    onFocus: (ev) => setOpen((s) => affordance(s, ev.target?.matches?.(':focus-visible') ? 'focus' : 'none')),
    onBlur: (ev) => {
      if (!ev.currentTarget.contains(ev.relatedTarget)) {
        setOpen((s) => affordance(s, 'blur'))
      }
    },
  }
  return <CreditsView entries={entries} open={isOpen(open)} lineRef={ref} handlers={handlers} onToggle={on('tap')}/>
}


const CLOSED = Object.freeze({hover: false, focus: false, pinned: false})


/**
 * The *Credits* button's state: open while hovered (a mouse's pointer; a
 * touch's tap toggles instead), focused from the keyboard, or tapped open.
 *
 * @param {{hover: boolean, focus: boolean, pinned: boolean}} s
 * @param {string} event enter, leave, focus, blur, tap, away (a tap elsewhere), none
 * @returns {{hover: boolean, focus: boolean, pinned: boolean}}
 */
export function affordance(s, event) {
  switch (event) {
    case 'enter': return {...s, hover: true}
    case 'leave': return {...s, hover: false}
    case 'focus': return {...s, focus: true}
    case 'blur': return {...s, focus: false}
    // A tap pins it open (a hover's or a focus's too, so it stays once the
    // pointer leaves); a tap on a pinned one closes it, however it opened.
    case 'tap': return s.pinned ? CLOSED : {...s, pinned: true}
    case 'away': return {...s, pinned: false}
    default: return s
  }
}


/**
 * @param {{hover: boolean, focus: boolean, pinned: boolean}} s
 * @returns {boolean}
 */
export function isOpen(s) {
  return s.hover || s.focus || s.pinned
}


/**
 * The footer from props, for tests (a server render runs no effects, so an
 * element entry renders its empty slot).  Closed, it draws the credits in
 * the line and fading (credits.js phases); open, every applicable one.
 *
 * @param {object} props
 * @param {Array<object>} props.entries credits.js getCredits
 * @param {boolean} [props.open] The *Credits* button open
 * @param {object} [props.lineRef]
 * @param {object} [props.handlers] The line's hover and focus handlers
 * @param {Function} [props.onToggle] The button's tap
 * @returns {React.ReactElement}
 */
export function CreditsView({entries, open = false, lineRef, handlers, onToggle}) {
  const shown = open ? entries : entries.filter((e) => e.phase !== 'out')
  const classes = ['credits-footer']
  if (entries.length === 0) {
    classes.push('empty')
  }
  if (open) {
    classes.push('open')
  }
  return (
    <footer id='credits-footer' className={classes.join(' ')} data-testid='credits-footer' aria-label='Credits'>
      <div className='credits-line' ref={lineRef} {...handlers}>
        {shown.map((entry, i) => (
          <React.Fragment key={entry.id}>
            {i > 0 && <span className='credits-sep' aria-hidden='true'>·</span>}
            <span className={!open && entry.phase === 'fading' ? 'credits-entry fading' : 'credits-entry'}
              data-credit={entry.id}>
              {entry.element ? <ElementSlot element={entry.element}/> : <CreditItems items={entry.items}/>}
            </span>
          </React.Fragment>
        ))}
        {entries.length > 0 &&
          <button type='button' className='credits-more' aria-expanded={open}
            title={open ? 'Credits' : 'Show all credits'} onClick={onToggle}>
            Credits
          </button>}
      </div>
    </footer>)
}


/**
 * @param {object} props
 * @param {Array<{text?: string, href?: string}>} props.items Sanitized (credits.js)
 * @returns {React.ReactElement}
 */
function CreditItems({items}) {
  return items.map((item, i) => (
    <React.Fragment key={i}>
      {i > 0 && <span className='credits-sep' aria-hidden='true'>·</span>}
      {item.href ?
        <a href={item.href} target='_blank' rel='noopener noreferrer'>{item.text}</a> :
        <span>{item.text}</span>}
    </React.Fragment>
  ))
}


/**
 * Mounts an element a library manages (Cesium's credits) where its entry
 * is, and takes it out with the entry.
 *
 * @param {object} props
 * @param {HTMLElement} props.element
 * @returns {React.ReactElement}
 */
function ElementSlot({element}) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.appendChild(element)
    return () => element.remove?.()
  }, [element])
  return <span ref={ref} className='credits-slot'/>
}
