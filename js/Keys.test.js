import {describe, expect, it, mock} from 'bun:test'
import Keys from './Keys'


describe('Keys', () => {
  it('dispatches keydown to the handler bound to the same character', () => {
    const keys = new Keys({addEventListener: mock()})
    const cbA = mock()
    keys.map('a', cbA, 'a key')

    expect(cbA).not.toHaveBeenCalled()
    keys.onKeyDown({key: 'a'})
    expect(cbA).toHaveBeenCalledTimes(1)
  })

  it('treats lowercase and uppercase as distinct (Shift produces uppercase event.key)', () => {
    const keys = new Keys({addEventListener: mock()})
    const cbV = mock()
    const cbVUpper = mock()
    keys.map('v', cbV, 'plain v')
    keys.map('V', cbVUpper, 'Shift+v')

    keys.onKeyDown({key: 'v'})
    expect(cbV).toHaveBeenCalledTimes(1)
    expect(cbVUpper).not.toHaveBeenCalled()

    keys.onKeyDown({key: 'V'})
    expect(cbV).toHaveBeenCalledTimes(1)
    expect(cbVUpper).toHaveBeenCalledTimes(1)
  })

  it('dispatches the backtick key, and not while typing in an input', () => {
    const doc = {activeElement: null}
    const keys = new Keys({addEventListener: mock(), document: doc})
    const toggle = mock()
    keys.map('`', toggle, 'Toggle performance panel')

    keys.onKeyDown({key: '`'})
    expect(toggle).toHaveBeenCalledTimes(1)

    // The search box (INPUT) and other text fields still take the character.
    doc.activeElement = {tagName: 'INPUT'}
    keys.onKeyDown({key: '`'})
    doc.activeElement = {tagName: 'TEXTAREA'}
    keys.onKeyDown({key: '`'})
    doc.activeElement = {tagName: 'DIV', isContentEditable: true}
    keys.onKeyDown({key: '`'})
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('addAction queues click-only actions visible in keys.actions', () => {
    const keys = new Keys({addEventListener: mock()})
    const fn = mock()
    keys.addAction(fn, 'click only')
    expect(keys.actions).toHaveLength(1)
    expect(keys.actions[0].msg).toBe('click only')
    keys.actions[0].fn()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('skips dispatch when the active element is a text input', () => {
    const cb = mock()
    const fakeWindow = {addEventListener: mock(), document: {activeElement: {tagName: 'INPUT'}}}
    const keys = new Keys(fakeWindow)
    keys.map('a', cb, 'a key')
    keys.onKeyDown({key: 'a'})
    expect(cb).not.toHaveBeenCalled()
  })

  it('leaves the browser\'s own shortcuts (Ctrl or Cmd with a key) alone', () => {
    const cb = mock()
    const keys = new Keys({addEventListener: mock()})
    keys.map('-', cb, 'minus')
    keys.onKeyDown({key: '-', ctrlKey: true})
    keys.onKeyDown({key: '-', metaKey: true})
    expect(cb).not.toHaveBeenCalled()
    keys.onKeyDown({key: '-'})
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
