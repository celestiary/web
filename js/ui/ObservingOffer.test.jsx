import {describe, expect, it} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {OfferView} from './ObservingOffer.jsx'


describe('ObservingOffer', () => {
  it('shows nothing unless AR has offered the red light', () => {
    expect(renderToStaticMarkup(<OfferView offer={false} onAccept={() => {}} onDecline={() => {}}/>)).toBe('')
  })

  it('offers it, with a way to decline', () => {
    const html = renderToStaticMarkup(<OfferView offer onAccept={() => {}} onDecline={() => {}}/>)
    expect(html).toContain('data-testid="observing-offer"')
    expect(html).toContain('It&#x27;s dark where you are')
    expect(html).toContain('data-testid="observing-offer-accept"')
    expect(html).toContain('data-testid="observing-offer-decline"')
  })
})
