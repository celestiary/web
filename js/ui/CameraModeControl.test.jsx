import {describe, expect, it} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'


// PhoneDock.test.jsx mocks './CameraModeControl' for the whole process (bun's
// mock.module); the query makes this the real module (AGENTS.md).
const REAL = './CameraModeControl.jsx?real'
const {CameraModeView, bodyLabel, cameraModeLabel} = await import(REAL)
const {cameraModeChoices} = await import('./CameraModeMenu.jsx')


const label = (name) => bodyLabel(name, {objects: {ed138: {props: {label: '2026 ED138'}}}})


describe('the camera control (#361, step 2)', () => {
  it('names how the camera moves, in words, with (auto) when the height chose', () => {
    expect(cameraModeLabel({mode: 'turning', auto: true, body: 'earth'}, label)).toBe('Turning with Earth (auto)')
    expect(cameraModeLabel({mode: 'turning', auto: false, body: 'earth'}, label)).toBe('Turning with Earth')
    expect(cameraModeLabel({mode: 'orbit', auto: true, body: 'mars'}, label)).toBe('Riding Mars\'s orbit (auto)')
    expect(cameraModeLabel({mode: 'fixed', auto: false, body: 'sun'}, label)).toBe('Fixed in space')
    expect(cameraModeLabel({mode: 'standing', auto: false, body: 'moon'}, label)).toBe('Standing on Moon')
    expect(cameraModeLabel({mode: null, auto: false, body: null}, label)).toBe(null)
  })

  it('takes a body\'s own label where it has one', () => {
    expect(cameraModeLabel({mode: 'orbit', auto: false, body: 'ed138'}, label)).toBe('Riding 2026 ED138\'s orbit')
  })

  it('offers the four ways with their keys, the current one checked', () => {
    const choices = cameraModeChoices({mode: 'turning', auto: false, body: 'earth'}, label)
    expect(choices.map((c) => c.id)).toEqual(['fixed', 'orbit', 'turning', 'auto', 'standing'])
    const byId = Object.fromEntries(choices.map((c) => [c.id, c]))
    expect(byId.turning.checked).toBe(true)
    expect(byId.turning.key).toBe('y')
    expect(byId.orbit.key).toBe('f')
    expect(byId.auto.checked).toBe(false)
    // Standing needs a place: shown, not chosen here.
    expect(byId.standing.disabled).toBe(true)
    expect(byId.standing.hint).toBe('Double-click the ground')
  })

  it('checks "by height" rather than the way while the height chooses', () => {
    const byId = Object.fromEntries(cameraModeChoices({mode: 'turning', auto: true, body: 'earth'}, label)
        .map((c) => [c.id, c]))
    expect(byId.auto.checked).toBe(true)
    expect(byId.turning.checked).toBe(false)
  })

  it('can\'t leave the Sun, and landed only standing is checked and nothing else chosen', () => {
    const atSun = Object.fromEntries(cameraModeChoices({mode: 'orbit', auto: true, body: 'sun'}, label,
        {canLeave: false}).map((c) => [c.id, c]))
    expect(atSun.fixed.disabled).toBe(true)
    expect(atSun.fixed.hint).toBe('Nothing above Sun to leave')
    const landed = cameraModeChoices({mode: 'standing', auto: false, body: 'earth'}, label)
    expect(landed.filter((c) => !c.disabled)).toEqual([])
    expect(landed.find((c) => c.checked).id).toBe('standing')
  })

  it('draws the label as a button, and nothing with no body to ride', () => {
    const html = renderToStaticMarkup(
        <CameraModeView state={{mode: 'turning', auto: true, body: 'earth'}} label={label} canLeave
          tracking={false} flash onChoose={() => {}}/>)
    expect(html).toContain('data-testid="camera-mode"')
    expect(html).toContain('Turning with Earth (auto)')
    expect(html).toContain('camera-mode-flash')
    expect(renderToStaticMarkup(
        <CameraModeView state={{mode: null, auto: false, body: null}} label={label} canLeave tracking={false}
          flash={false} onChoose={() => {}}/>)).toBe('')
  })
})
