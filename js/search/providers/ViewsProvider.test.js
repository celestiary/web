import {describe, expect, it} from 'bun:test'
import ViewsProvider from './ViewsProvider.js'


describe('ViewsProvider', () => {
  it('lists each view as a result of kind view, with its opener and its body', () => {
    const open = () => {}
    const p = new ViewsProvider([
      {id: 'rubin-watch', name: 'Watch 2026 ED138 from the Rubin Observatory', aliases: ['rubin'],
        path: 'milkyway/sun/ed138', target: 'ed138', open},
      {id: 'plain', name: 'A view', path: 'milkyway', open},
    ])
    expect(p.lazy).toBe(false)
    const all = p.collectAll()
    expect(all).toHaveLength(2)
    expect(all[0]).toEqual({id: 'view:rubin-watch', displayName: 'Watch 2026 ED138 from the Rubin Observatory',
      aliases: ['rubin'], kind: 'view', path: 'milkyway/sun/ed138', parent: null, payload: {open, target: 'ed138'}})
    expect(all[1].aliases).toEqual([])
    expect(all[1].payload.target).toBe(null)
  })
})
