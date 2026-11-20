import {describe, expect, it} from 'bun:test'
import {planetsApprox} from '../planetsApprox.js'
import {buildMission} from './mission'
import {currentEvent, missionEvents, nextEvent, previousEvent} from './events'


describe('Suntan mission events', () => {
  const mission = buildMission(planetsApprox)
  const events = missionEvents(mission)
  const day = (event) => new Date(event.t * 1000).toISOString().slice(0, 10)

  it('lists every named moment in time order', () => {
    // Launch, seven flybys, two perihelia, three burns, arrival.
    expect(events.length).toBe(14)
    for (let i = 1; i < events.length; i++) {
      expect(events[i].t).toBeGreaterThan(events[i - 1].t)
    }
    expect(events[0].id).toBe('launch')
    expect(events[events.length - 1].id).toBe('arrival')
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length)
  })

  it('dates the moments the panel jumps to', () => {
    const byId = Object.fromEntries(events.map((event) => [event.id, event]))
    expect(day(byId.launch)).toBe('2018-08-12')
    expect(day(byId.venus7)).toBe('2024-11-06')
    expect(day(byId.perihelionFirst)).toBe('2018-11-06')
    expect(day(byId.perihelionClosest)).toBe('2024-12-24')
    expect(day(byId.burn3)).toBe('2027-04-29')
    expect(byId.arrival.t).toBe(mission.tArrive)
  })

  it('steps to the neighbouring events', () => {
    const release = events.find((event) => event.id === 'burn3')
    expect(nextEvent(events, release.t).id).toBe('arrival')
    expect(previousEvent(events, release.t).id).toBe('burn2')
    // Just past an event, stepping back leaves it rather than landing on it again.
    expect(previousEvent(events, release.t + 60, 3600).id).toBe('burn2')
    expect(previousEvent(events, release.t + 7200, 3600).id).toBe('burn3')
    expect(nextEvent(events, mission.tArrive)).toBe(undefined)
    expect(previousEvent(events, mission.tStart)).toBe(undefined)
  })

  it('names the current event', () => {
    expect(currentEvent(events, mission.tStart - 1)).toBe(undefined)
    expect(currentEvent(events, mission.tRelease + 3600).id).toBe('burn3')
  })
})
