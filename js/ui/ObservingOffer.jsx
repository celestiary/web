import React from 'react'
import useStore from '../store/useStore'
import {RedLightIcon} from './DockIcons'


/**
 * AR has started after dark (Celestiary._offerObserving): a card offers the
 * observing (red) theme (js/observing.js; design/UI.md), above the dock and
 * the info sheet on a phone, at the bottom elsewhere.  It goes once taken,
 * declined, or when AR ends.
 *
 * @property {object} celestiary
 * @returns {?React.ReactElement}
 */
export default function ObservingOffer({celestiary}) {
  const offer = useStore((state) => state.observingOffer)
  const setObservingOffer = useStore((state) => state.setObservingOffer)
  return (
    <OfferView
      offer={offer}
      onAccept={() => celestiary.toggleObserving()}
      onDecline={() => setObservingOffer(false)}
    />
  )
}


/**
 * The card as its state has it.
 *
 * @property {boolean} offer
 * @property {Function} onAccept turns the theme on (which ends the offer)
 * @property {Function} onDecline
 * @returns {?React.ReactElement}
 */
export function OfferView({offer, onAccept, onDecline}) {
  if (!offer) {
    return null
  }
  return (
    <div id='observing-offer' role='dialog' aria-labelledby='observing-offer-title' data-testid='observing-offer'>
      <div className='observing-offer-words'>
        <div id='observing-offer-title' className='observing-offer-title'>It&apos;s dark where you are</div>
        <div className='observing-offer-text'>Red light keeps your eyes used to the dark.</div>
      </div>
      <div className='observing-offer-actions'>
        <button type='button' className='dock-pill on' onClick={onAccept} data-testid='observing-offer-accept'>
          <RedLightIcon/> Red light
        </button>
        <button type='button' className='observing-offer-decline' onClick={onDecline} data-testid='observing-offer-decline'>
          Not now
        </button>
      </div>
    </div>
  )
}
