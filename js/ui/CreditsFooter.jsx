import React, {useEffect, useRef, useSyncExternalStore} from 'react'
import {getCredits, subscribeCredits} from '../credits.js'


/**
 * Every attribution on screen in one small line along the bottom, as a
 * map's (design/UI.md, "The credits footer"): Cesium's, which its
 * CreditDisplay keeps up to date in its own element, and celestiary's own
 * (credits.js), each while its data is drawn.  HTML chrome: it fades with
 * the rest (html.chrome-hidden) and `v` hides it (Celestiary._navDisplay).
 * Empty, it isn't laid out.  Too long for the width (a phone's), it wraps:
 * Bing's terms forbid hiding its attribution behind a tap (CESIUM.md,
 * "Credits").
 *
 * @returns {React.ReactElement}
 */
export default function CreditsFooter() {
  return <CreditsView entries={useSyncExternalStore(subscribeCredits, getCredits, getCredits)}/>
}


/**
 * The footer from props, for tests (a server render runs no effects, so an
 * element entry renders its empty slot).
 *
 * @param {object} props
 * @param {Array<object>} props.entries credits.js getCredits
 * @returns {React.ReactElement}
 */
export function CreditsView({entries}) {
  return (
    <footer id='credits-footer' className={entries.length === 0 ? 'credits-footer empty' : 'credits-footer'}
      data-testid='credits-footer' aria-label='Credits'>
      <div className='credits-line'>
        {entries.map((entry, i) => (
          <React.Fragment key={entry.id}>
            {i > 0 && <span className='credits-sep' aria-hidden='true'>·</span>}
            <span className='credits-entry' data-credit={entry.id}>
              {entry.element ? <ElementSlot element={entry.element}/> : <CreditItems items={entry.items}/>}
            </span>
          </React.Fragment>
        ))}
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
