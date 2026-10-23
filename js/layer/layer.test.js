import fs from 'node:fs'
import {describe, expect, it} from 'bun:test'
import {Matrix4, Object3D, PerspectiveCamera, Vector3} from 'three'
import {eciToEcf, gstime, json2satrec, propagate} from 'satellite.js'
import OrbitsLayer from './OrbitsLayer.js'
import {anchorMatcher, dishAnchor, satelliteAnchor, siteAnchor, spacecraftAnchor} from './anchors.js'
import {bodyFixedToEcef, equatorToEcef} from './frames.js'
import {hostOrigin, isAllowedOrigin, originTransport} from './origins.js'
import {HELLO_RESEND_MS, serveLayer} from './protocol.js'
import {gmstRad} from '../scene/celestialFrame.js'
import {latLngAltToBodyFixed} from '../coords.js'
import {unixMsToJd} from '../scene/satellites/sgp4.js'


// Layer mode (design/LayerMode.md): the frames, the anchors' ids, the
// origins, the control plane, and the layer's scene against satellite.js's
// own ECI to ECF.


const PUBLIC = new URL('../../public/', import.meta.url)
const fromDisk = (url) => Promise.resolve(fs.existsSync(new URL(url, PUBLIC)) ?
  {ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(new URL(url, PUBLIC), 'utf8')))} :
  {ok: false, status: 404})
// Within the snapshot's elements' windows.
const T = Date.parse('2026-10-23T20:17:00Z')


describe('layer mode frames', () => {
  it('turns the equator frame to ECEF as Animation turns Earth', () => {
    const g = 1.234
    const earth = new Object3D()
    earth.setRotationFromAxisAngle(new Vector3(0, 1, 0), g)
    // A place on Earth: body-fixed, turned into the equator frame, then to ECEF.
    const body = latLngAltToBodyFixed(40.24, -4.25, 0, 6378137)
    const eq = body.clone().applyQuaternion(earth.quaternion)
    const viaLayer = eq.applyMatrix4(equatorToEcef(g, new Matrix4))
    expect(viaLayer.distanceTo(new Vector3(...bodyFixedToEcef(body)))).toBeLessThan(1e-6)
    // And ECEF's axes: Greenwich on the equator is +X, 90°E +Y, the pole +Z.
    expect(bodyFixedToEcef(latLngAltToBodyFixed(0, 90, 0, 1)).map((x) => Math.round(x))).toEqual([0, 1, 0])
    expect(bodyFixedToEcef(latLngAltToBodyFixed(90, 0, 0, 1)).map((x) => Math.round(x))).toEqual([0, 0, 1])
  })
})


describe('layer mode anchors', () => {
  it('names things with URI-style ids', () => {
    expect(satelliteAnchor(25544)).toBe('norad:25544')
    expect(dishAnchor('DSS43')).toBe('dsn:DSS-43')
    expect(siteAnchor('gdscc')).toBe('dsn-site:gdscc')
    expect(spacecraftAnchor('VGR1')).toBe('spacecraft:vgr1')
  })

  it('matches a subscription', () => {
    const m = anchorMatcher(['norad:25544', 'dsn:*'])
    expect([m('norad:25544'), m('norad:1'), m('dsn:DSS-43'), m('dsn-site:gdscc')]).toEqual([true, false, true, false])
    expect(anchorMatcher(['*'])('anything')).toBe(true)
  })
})


describe('layer mode origins', () => {
  it('allows the listed hosts and localhost on any port, nothing else', () => {
    expect(isAllowedOrigin('https://pablo-mayrgundter.github.io')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:5481')).toBe(true)
    expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false)
    expect(isAllowedOrigin('http://localhost:80x')).toBe(false)
    expect(isAllowedOrigin('https://pablo-mayrgundter.github.io.evil.com')).toBe(false)
    expect(isAllowedOrigin('null')).toBe(false)
  })

  it('takes the host from ?host= or the referrer, if allowed', () => {
    expect(hostOrigin({search: '?host=http://localhost:5481'})).toBe('http://localhost:5481')
    expect(hostOrigin({search: '', referrer: 'https://pablo-mayrgundter.github.io/netmap/?x'})).toBe('https://pablo-mayrgundter.github.io')
    expect(hostOrigin({search: '?host=https://evil.com', referrer: 'https://evil.com/'})).toBeNull()
  })

  it('drops messages from another window or origin, and posts to the host only', () => {
    const listeners = []
    const win = {addEventListener: (t, f) => listeners.push(f), removeEventListener: () => {}}
    const sent = []
    const parent = {postMessage: (m, o) => sent.push([m, o])}
    const t = originTransport({target: parent, origin: 'http://localhost:5481', win})
    const got = []
    t.onMessage((m) => got.push(m.type))
    for (const ev of [
      {source: parent, origin: 'http://localhost:5481', data: {type: 'ok'}},
      {source: parent, origin: 'https://evil.com', data: {type: 'origin'}},
      {source: {}, origin: 'http://localhost:5481', data: {type: 'source'}},
    ]) {
      listeners.forEach((f) => f(ev))
    }
    expect(got).toEqual(['ok'])
    t.post({type: 'x'})
    expect(sent).toEqual([[{type: 'x'}, 'http://localhost:5481']])
  })
})


describe('layer mode control plane', () => {
  /** @returns {object} a fake transport, layer and timers */
  function rig() {
    const posted = []
    let listener = null
    const interval = {fn: null, cleared: false}
    const calls = []
    const layer = {
      applyView: (v) => calls.push(['view', v.viewId, v.timeMs]),
      anchors: () => [{id: 'dsn:DSS-43', ecef: [1, 2, 3]}],
      subscribe: (p) => calls.push(['subscribe', p]),
      dispose: () => calls.push(['dispose']),
    }
    let resolve
    const loaded = new Promise((r) => (resolve = r))
    const clock = {ms: 1000}
    const served = serveLayer({
      transport: {post: (m) => posted.push(m), onMessage: (f) => {
        listener = f
        return () => (listener = null)
      }},
      layer, loaded, nowMs: () => clock.ms,
      render: () => calls.push(['render']), endFrame: () => calls.push(['frame-end']),
      timers: {setInterval: (fn) => (interval.fn = fn), clearInterval: () => (interval.cleared = true)},
    })
    return {posted, send: (m) => listener?.(m), interval, calls, resolve, served, clock}
  }

  it('says hello until acked, then draws each view and posts its anchors after its frame', async () => {
    const r = rig()
    expect(r.posted[0]).toMatchObject({type: 'layer:hello', version: 1, kind: 'celestiary-orbits'})
    expect(r.posted[0].extent.radiusM).toBeGreaterThan(4.2e7)
    r.interval.fn()
    expect(r.posted.filter((m) => m.type === 'layer:hello')).toHaveLength(2)
    r.send({type: 'layer:hello-ack'})
    r.interval.fn()
    expect(r.interval.cleared).toBe(true)
    // A view before the data is in: drawn once it is.
    r.send({type: 'layer:view', viewId: 7, timeMs: T, viewMatrix: [], projectionMatrix: []})
    expect(r.calls).toEqual([])
    r.resolve([])
    await new Promise((res) => setTimeout(res, 0))
    expect(r.calls).toEqual([['view', 7, T], ['render'], ['frame-end']])
    const last = r.posted[r.posted.length - 1]
    expect(last).toEqual({type: 'layer:anchors', viewId: 7, timeMs: T, anchors: [{id: 'dsn:DSS-43', ecef: [1, 2, 3]}]})
    expect(r.posted.some((m) => m.type === 'layer:status' && m.status === 'ready')).toBe(true)
    expect(HELLO_RESEND_MS).toBeLessThanOrEqual(1000)
  })

  it('takes the host\'s clock for views without a time, and stops when hidden or disposed', async () => {
    const r = rig()
    r.resolve([])
    await new Promise((res) => setTimeout(res, 0))
    r.send({type: 'layer:time', utcMs: T, rate: 60})
    r.clock.ms += 1000
    r.send({type: 'layer:view', viewId: 1})
    expect(r.calls[0]).toEqual(['view', 1, T + 60000])
    r.send({type: 'layer:anchors-subscribe', patterns: ['norad:*']})
    expect(r.calls).toContainEqual(['subscribe', ['norad:*']])
    r.send({type: 'layer:visibility', state: 'hidden'})
    r.send({type: 'layer:view', viewId: 2, timeMs: T})
    expect(r.calls.filter((c) => c[0] === 'view')).toHaveLength(1)
    r.send({type: 'layer:dispose'})
    expect(r.calls).toContainEqual(['dispose'])
  })
})


describe('OrbitsLayer', () => {
  it('puts the satellites and networks in ECEF at the host\'s time: the ISS where satellite.js puts it', async () => {
    const layer = new OrbitsLayer({fetchFn: fromDisk})
    expect(await layer.load({satellites: true, networks: ['I', 'D']})).toEqual([])
    const cam = new PerspectiveCamera(45, 1.6, 1e4, 1e9)
    cam.position.set(4e7, 0, 0)
    cam.up.set(0, 0, 1)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    layer.applyView({viewMatrix: cam.matrixWorldInverse.toArray(), projectionMatrix: cam.projectionMatrix.toArray(), timeMs: T})
    expect(layer.gmst).toBeCloseTo(gmstRad(unixMsToJd(T)), 12)
    layer.subscribe(['norad:25544', 'norad:41917', 'dsn:*', 'dsn-site:*'])
    const anchors = layer.anchors()
    const iss = anchors.find((a) => a.id === 'norad:25544')
    // satellite.js's own TEME → ECF, by its own GMST.
    const {SATELLITES_URL} = await import('./OrbitsLayer.js')
    const {columns, rows} = JSON.parse(fs.readFileSync(new URL(SATELLITES_URL, PUBLIC), 'utf8'))
    const omm = Object.fromEntries(columns.map((c, i) => [c, rows.find((x) => x[0] === 25544)[i]]))
    const date = new Date(T)
    const f = eciToEcf(propagate(json2satrec(omm), date).position, gstime(date))
    expect(Math.hypot(iss.ecef[0] - (f.x * 1e3), iss.ecef[1] - (f.y * 1e3), iss.ecef[2] - (f.z * 1e3))).toBeLessThan(50)
    // An Iridium, from its Constellation, at ~780 km.
    const ir = anchors.find((a) => a.id === 'norad:41917')
    expect(Math.hypot(...ir.ecef) / 1e3).toBeGreaterThan(7000)
    // Madrid's complex where its latitude and longitude say.
    const mad = anchors.find((a) => a.id === 'dsn-site:mdscc')
    expect(Math.asin(mad.ecef[2] / Math.hypot(...mad.ecef)) * 180 / Math.PI).toBeCloseTo(40.2413554, 6)
    expect(anchors.filter((a) => a.kind === 'dsn-dish').length).toBeGreaterThan(12)
    // The camera is the host's: the drawn points take its distance rules.
    expect(layer.satellites.points.visible).toBe(true)
    expect(layer.satellites.drawnCount).toBeGreaterThan(400)
  })
})
