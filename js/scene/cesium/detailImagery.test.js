import {DetailWorkers} from './detailImagery.js'


// A worker that answers each tile with its key's bytes, on demand.
const fakeWorkers = () => {
  const made = []
  const make = () => {
    const w = {sent: [], postMessage(msg) {
      w.sent.push(msg)
    }}
    w.reply = (i = 0) => {
      const {id, job} = w.sent.splice(i, 1)[0]
      w.onmessage({data: {id, buffer: new TextEncoder().encode(job.key).buffer}})
    }
    made.push(w)
    return w
  }
  return {made, make}
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))


describe('DetailWorkers', () => {
  it('sends a tile to the worker its key hashes to, the same each time', () => {
    const {made, make} = fakeWorkers()
    const pool = new DetailWorkers(make, 2)
    pool.run({key: '3/4/7'}, () => false)
    pool.run({key: '3/4/7'}, () => false)
    const counts = made.map((w) => w.sent.length)
    expect(counts.sort()).toEqual([0, 2])
  })

  it('keeps a few in flight a worker, queues the rest, and drops what Cesium gave up', async () => {
    const {made, make} = fakeWorkers()
    const pool = new DetailWorkers(make, 1)
    const given = new Set()
    const results = []
    for (let i = 0; i < 6; i++) {
      pool.run({key: `k${i}`}, () => given.has(i)).then(
          (b) => results.push(new TextDecoder().decode(b)), (e) => results.push(e.message))
    }
    const w = made[0]
    expect(w.sent).toHaveLength(3)
    given.add(3)
    w.reply()
    await settle()
    // k3 dropped, k4 sent in its place.
    expect(w.sent.map((m) => m.job.key)).toEqual(['k1', 'k2', 'k4'])
    while (w.sent.length) {
      w.reply()
      await settle()
    }
    expect(results).toEqual(['k0', 'cancelled', 'k1', 'k2', 'k4', 'k5'])
    expect(pool.made).toBe(5)
  })

  it('fails over to the main thread when a worker errs', async () => {
    const {made, make} = fakeWorkers()
    const pool = new DetailWorkers(make, 1)
    const p = pool.run({key: 'a'}, () => false)
    made[0].onerror()
    await expect(p).rejects.toThrow('worker failed')
    expect(pool.failed).toBe(true)
  })
})
