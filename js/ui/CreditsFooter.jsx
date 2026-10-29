import React, {Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore} from 'react'
import MuiDialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import useIsMobile from '../useIsMobile'
import {getCredits, hasCredit, setCreditsMotion, subscribeCredits} from '../credits.js'
import {CESIUM_BODIES} from '../scene/cesium/bodies.js'
import {bingShown} from '../scene/cesium/CesiumLayers.js'
import {SPECTRAL_CLASSES} from '../scene/stellar.js'


/**
 * Every attribution on screen in one small line along the bottom, as a
 * map's (design/UI.md, "The credits footer"): Cesium's, which its
 * CreditDisplay keeps up to date in its own element, and celestiary's own
 * (credits.js), each while its data is drawn.  A timed credit fades in as
 * its data arrives and out some seconds later (credits.js, its phase);
 * Cesium's goes to the ion logo alone.  The info icon at the line's end
 * shows every applicable one in the line while it's hovered or focused from
 * the keyboard, and opens the credits dialog (CreditsDialog.jsx, loaded on
 * the first open) on a click or a tap.  HTML chrome: it fades with the rest
 * (html.chrome-hidden) and `v` hides it (Celestiary._navDisplay).  Empty,
 * it isn't laid out.  Too long for the width (a phone's), it wraps: Bing's
 * terms forbid hiding its attribution behind a tap (CESIUM.md, "Credits").
 *
 * @param {object} props
 * @param {?object} [props.celestiary] For the dialog's live facts
 * @returns {React.ReactElement}
 */
export default function CreditsFooter({celestiary = null}) {
  const entries = useSyncExternalStore(subscribeCredits, getCredits, getCredits)
  const [open, setOpen] = useState(CLOSED)
  const [dialog, setDialog] = useState(false)
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
  const handlers = {
    // A mouse's hover only: a touch's tap opens the dialog.
    onPointerEnter: (ev) => ev.pointerType === 'mouse' && setOpen((s) => affordance(s, 'enter')),
    onPointerLeave: (ev) => ev.pointerType === 'mouse' && setOpen((s) => affordance(s, 'leave')),
    onFocus: (ev) => setOpen((s) => affordance(s, ev.target?.matches?.(':focus-visible') ? 'focus' : 'none')),
    onBlur: (ev) => {
      if (!ev.currentTarget.contains(ev.relatedTarget)) {
        setOpen((s) => affordance(s, 'blur'))
      }
    },
  }
  return (
    <>
      <CreditsView entries={entries} open={isOpen(open)} handlers={handlers} onInfo={() => setDialog(true)}/>
      {dialog &&
        <Suspense fallback={null}>
          <CreditsDialog open={dialog} onClose={() => setDialog(false)} celestiary={celestiary}/>
        </Suspense>}
    </>)
}


/**
 * What the credits dialog's chunk shares with the first load, handed to it
 * rather than imported there (ui/creditsDialog.js says why): React, MUI's
 * dialog as ui/Dialog.jsx uses it, the registry, and the tables its facts
 * read (credits/facts.js refs).
 */
export const CREDITS_DIALOG_DEPS = Object.freeze({
  React, Dialog: MuiDialog, DialogTitle, DialogContent, IconButton, CloseIcon, useIsMobile,
  getCredits, hasCredit, subscribeCredits,
  refs: Object.freeze({bodies: CESIUM_BODIES, spectralClasses: SPECTRAL_CLASSES, bingShown}),
})


/**
 * The credits dialog and its facts, in a chunk of their own: imported on the
 * first open, so the first load doesn't carry them (esbuild/budget.js).
 *
 * @returns {Promise<{default: Function}>} The dialog's component, for React's lazy
 */
export function loadCreditsDialog() {
  return import('./creditsDialog.js')
      .then((m) => ({default: m.creditsDialog(CREDITS_DIALOG_DEPS).CreditsDialog}))
      .catch((err) => {
        // A failed chunk (a stale build, offline): no dialog, rather than an
        // error thrown into the app's render.  (Not staleBuild.js's
        // staleRoute: importing it here moved it into a chunk of its own.)
        console.warn('[credits] the credits dialog didn\'t load', err)
        return {default: () => null}
      })
}


const CreditsDialog = lazy(loadCreditsDialog)


const CLOSED = Object.freeze({hover: false, focus: false})


/**
 * The line's state: every applicable credit in it while a mouse hovers it
 * (a touch's tap opens the dialog instead) or the keyboard focuses it.
 *
 * @param {{hover: boolean, focus: boolean}} s
 * @param {string} event enter, leave, focus, blur, none
 * @returns {{hover: boolean, focus: boolean}}
 */
export function affordance(s, event) {
  switch (event) {
    case 'enter': return {...s, hover: true}
    case 'leave': return {...s, hover: false}
    case 'focus': return {...s, focus: true}
    case 'blur': return {...s, focus: false}
    default: return s
  }
}


/**
 * @param {{hover: boolean, focus: boolean}} s
 * @returns {boolean}
 */
export function isOpen(s) {
  return s.hover || s.focus
}


/**
 * The footer from props, for tests (a server render runs no effects, so an
 * element entry renders its empty slot).  Closed, it draws the credits in
 * the line, fading, or compact (credits.js phases); open, every applicable
 * one whole.
 *
 * @param {object} props
 * @param {Array<object>} props.entries credits.js getCredits
 * @param {boolean} [props.open] Hovered or focused
 * @param {object} [props.handlers] The line's hover and focus handlers
 * @param {Function} [props.onInfo] The info icon's click
 * @returns {React.ReactElement}
 */
export function CreditsView({entries, open = false, handlers, onInfo}) {
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
      <div className='credits-line' {...handlers}>
        {shown.map((entry, i) => (
          <React.Fragment key={entry.id}>
            {i > 0 && <span className='credits-sep' aria-hidden='true'>·</span>}
            <span className={entryClass(entry, open)} data-credit={entry.id}>
              {entry.element ? <ElementSlot element={entry.element}/> : <CreditItems items={entry.items}/>}
            </span>
          </React.Fragment>
        ))}
        {entries.length > 0 &&
          <button type='button' className='credits-more' aria-label='Credits' title='Credits'
            aria-haspopup='dialog' onClick={onInfo}>
            <InfoOutlined fontSize='inherit' aria-hidden='true'/>
          </button>}
      </div>
    </footer>)
}


/**
 * @param {object} entry
 * @param {boolean} open
 * @returns {string} Its classes: fading or compact while closed, and
 *   keeps-logo for Cesium's (index.css)
 */
function entryClass(entry, open) {
  const classes = ['credits-entry']
  if (entry.keepsLogo) {
    classes.push('keeps-logo')
  }
  if (!open && (entry.phase === 'fading' || entry.phase === 'compact')) {
    classes.push(entry.phase)
  }
  return classes.join(' ')
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
