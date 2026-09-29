// Rules behind this week's features: server error messages, STEM's terminal wrapping, one-at-a-time jobs, the
// Hawking drift's timeline and cancel window, and wormhole event changes.
import { describe, it, expect, vi } from 'vitest'
import { tick } from './helpers'
import { setSignedFetchHandler } from './system/SignedFetch'

let wormholeReplies: any[] = []
vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getWormholeEvent: vi.fn(async () => wormholeReplies.shift() ?? null),
}))

import * as api from '../src/api'
import { errorBody } from '../src/api'
import { wrapColumns } from '../src/ui'
import { oneAtATime } from '../src/oneAtATime'
import { playHawkingDrift, cancelHawkingDrift } from '../src/hawkingDrift'
import { refreshWormhole, onWormholeChanged, podWarning } from '../src/wormhole/state'

describe('server error messages', () => {
  it("wraps the bare error text the explorer hands the scene back into JSON, so callers read it as before", () => {
    expect(JSON.parse(errorBody("The wormhole's time dilation is interfering with the pod bay"))).toEqual({
      error: "The wormhole's time dilation is interfering with the pod bay",
    })
    expect(errorBody('{"error":"No idle mining pods"}')).toBe('{"error":"No idle mining pods"}')   // still JSON: as is
    expect(JSON.parse(errorBody('404'))).toEqual({ error: '404' })                                   // JSON, but not an object
    expect(JSON.parse(errorBody(''))).toEqual({ error: 'Request failed' })
  })

  it('a refused request reaches the caller with the server message', async () => {
    setSignedFetchHandler(async () => ({ ok: false, status: 400, statusText: '400', headers: {}, body: 'Not enough fuel, Captain.' }))
    const err: any = await api.wormholeJump().catch(e => e)
    const m = /^API error (\d+): (.*)$/s.exec(err.message)
    expect(m?.[1]).toBe('400')
    expect(JSON.parse(m![2]).error).toBe('Not enough fuel, Captain.')
    setSignedFetchHandler(async () => ({ ok: true, status: 200, statusText: 'OK', headers: {}, body: '{}' }))
  })
})

describe("STEM's terminal wrapping", () => {
  const text = "> Captain, please don't stare directly into the black hole simulation. Prolonged viewing is linked to Hawking drift: crews start hearing their own thoughts a few seconds late."
  it('keeps every line within its columns and never splits a word', () => {
    const lines = wrapColumns(text, 51)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(51)
    expect(lines.join(' ')).toBe(text)
  })
  it('fits short messages on one line', () => {
    expect(wrapColumns('> Hello, Captain.', 51)).toEqual(['> Hello, Captain.'])
  })
})

describe('one at a time', () => {
  it('never runs the job twice at once, and runs once more for calls made during a run', async () => {
    let running = 0, maxRunning = 0, runs = 0
    const job = oneAtATime(async () => {
      running++; maxRunning = Math.max(maxRunning, running); runs++
      await new Promise(r => setTimeout(r, 5))
      running--
    })
    await Promise.all([job(), job(), job(), job()])
    expect(maxRunning).toBe(1)
    expect(runs).toBe(2)   // the first call, then one more for the three that came in meanwhile
  })
})

describe('Hawking drift', () => {
  it('moves the captain in the dark and explains once sight is back', async () => {
    const midpoint = vi.fn(), done = vi.fn()
    playHawkingDrift(midpoint, done)
    await tick(0.7)   // the move happens 0.6 s in, while it's fully dark
    expect(midpoint).toHaveBeenCalledTimes(1)
    expect(done).not.toHaveBeenCalled()
    await tick(3)
    expect(done).toHaveBeenCalledTimes(1)
  })
  it('can be called off until the screen is fully black, and not after', async () => {
    const midpoint = vi.fn(), done = vi.fn()
    playHawkingDrift(midpoint, done)
    await tick(0.1)
    expect(cancelHawkingDrift()).toBe(true)
    await tick(3)
    expect(midpoint).not.toHaveBeenCalled()
    expect(done).not.toHaveBeenCalled()

    const midpoint2 = vi.fn(), done2 = vi.fn()
    playHawkingDrift(midpoint2, done2)
    await tick(0.4)
    expect(cancelHawkingDrift()).toBe(false)   // committed at full black
    await tick(3)
    expect(midpoint2).toHaveBeenCalledTimes(1)
    expect(done2).toHaveBeenCalledTimes(1)
  })
})

describe('wormhole events', () => {
  const ev = (id: string, trip = false) => ({
    id, targetSystemId: `t-${id}`, targetName: `Target ${id}`, startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 3600_000).toISOString(),
    trip: trip ? { originSystemId: 'home', originName: 'Home' } : null, podsOut: trip ? 2 : 0,
    canJump: !trip, jumpBlockedReason: null, canReturn: trip,
  })
  it('reports opening, one event replacing another, and closing', async () => {
    const seen: [string | null, string | null][] = []
    onWormholeChanged((prev, next) => seen.push([prev?.id ?? null, next?.id ?? null]))
    wormholeReplies = [ev('A'), ev('A'), ev('B'), null]
    for (let i = 0; i < 4; i++) await refreshWormhole()
    expect(seen).toEqual([[null, 'A'], ['A', 'B'], ['B', null]])
  })
  it('warns about the pods by count', () => {
    expect(podWarning(1)).toMatch(/lose contact with 1 pod!/)
    expect(podWarning(3)).toMatch(/lose contact with 3 pods!/)
  })
})
