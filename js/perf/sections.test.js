import {describe, expect, it} from 'bun:test'
import Sections, {CpuClock} from './sections.js'


/** A clock that records what it was told, and the time. */
function recorder() {
  const events = []
  return {events, start: (n) => events.push(`+${n}`), stop: (n) => events.push(`-${n}`)}
}


describe('Sections', () => {
  it('stops the section under one it opens, and resumes it when that closes', () => {
    const clock = recorder()
    const s = new Sections(clock)
    s.open('scene')
    s.open('galaxy')
    s.close('galaxy')
    s.close('scene')
    expect(clock.events).toEqual(['+scene', '-scene', '+galaxy', '-galaxy', '+scene', '-scene'])
  })

  it('never has two segments running at once', () => {
    const running = new Set()
    let max = 0
    const clock = {
      start: (n) => {
        running.add(n)
        max = Math.max(max, running.size)
      },
      stop: (n) => running.delete(n),
    }
    const s = new Sections(clock)
    s.open('other')
    s.open('cesium')
    s.open('cesium.replay')
    s.close('cesium.replay')
    s.open('cesium.decode')
    s.close('cesium.decode')
    s.close('cesium')
    s.open('atmosphere')
    s.close('atmosphere')
    s.closeAll()
    expect(max).toBe(1)
    expect(running.size).toBe(0)
  })

  it('closes what an exception left open inside a section, and resumes the one above', () => {
    const clock = recorder()
    const s = new Sections(clock)
    s.open('cesium')
    s.open('cesium.replay')
    expect(s.close('cesium')).toBe(true)
    expect(s.depth).toBe(0)
    expect(clock.events).toEqual(['+cesium', '-cesium', '+cesium.replay', '-cesium.replay'])
  })

  it('ignores closing a name that is not open', () => {
    const clock = recorder()
    const s = new Sections(clock)
    s.open('scene')
    expect(s.close('clouds')).toBe(false)
    expect(s.top).toBe('scene')
    expect(clock.events).toEqual(['+scene'])
  })

  it('closeAll stops everything, innermost first', () => {
    const clock = recorder()
    const s = new Sections(clock)
    s.open('a')
    s.open('b')
    s.closeAll()
    expect(clock.events).toEqual(['+a', '-a', '+b', '-b'])
    expect(s.top).toBe(null)
  })
})


describe('CpuClock over Sections', () => {
  it('gives each name its own time, an outer one without the inner', () => {
    let t = 0
    const cpu = new CpuClock(() => t)
    const s = new Sections(cpu)
    s.open('other')
    t = 1
    s.open('scene')
    t = 4
    s.open('galaxy')
    t = 10
    s.close('galaxy')
    t = 12
    s.close('scene')
    t = 13
    s.closeAll()
    expect(cpu.take()).toEqual({other: 2, scene: 5, galaxy: 6})
  })

  it('adds the segments of one name up', () => {
    let t = 0
    const cpu = new CpuClock(() => t)
    const s = new Sections(cpu)
    s.open('cesium')
    t = 1
    s.open('replay')
    t = 3
    s.close('replay')
    t = 4
    s.open('replay')
    t = 9
    s.close('replay')
    t = 10
    s.closeAll()
    const ms = cpu.take()
    expect(ms.replay).toBe(7)
    expect(ms.cesium).toBe(3)
  })

  it('the sections add up to the frame', () => {
    let t = 0
    const cpu = new CpuClock(() => t)
    const s = new Sections(cpu)
    s.open('other')
    for (const [name, ms] of [['scene', 3], ['clouds', 1], ['atmosphere', 2]]) {
      t += 1
      s.open(name)
      t += ms
      s.close(name)
    }
    t += 1
    s.closeAll()
    const ms = cpu.take()
    expect(Object.values(ms).reduce((a, b) => a + b, 0)).toBe(t)
  })

  it('starts afresh after a take', () => {
    let t = 0
    const cpu = new CpuClock(() => t)
    cpu.start('a')
    t = 2
    cpu.stop('a')
    expect(cpu.take()).toEqual({a: 2})
    expect(cpu.take()).toEqual({})
  })
})
