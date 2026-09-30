// Wormholes in the system view: a portal at the edge of the system for a black hole's linked wormhole, and one for an
// open wormhole event's target. Clicking one does what the star panel's button would; where the panel offers
// nothing, the portal is only to look at. The animation moves things and never re-sets a material.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Material, engine, Transform } from '@dcl/sdk/ecs'
import { setSignedFetchHandler } from './system/SignedFetch'

let detail: any = null
let event: any = null
vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getSystemDetail: vi.fn(async () => detail),
  getWormholeEvent: vi.fn(async () => event),
}))

import { renderSystemView, systemViewAnimationSystem, clearSystemView, setBlackHoleNotify } from '../src/systemView'
import { portalState, pressPortal } from '../src/wormhole/systemPortal'
import { refreshWormhole, setWormholeCutscenePlayer, setWormholeArrivedCallback } from '../src/wormhole/state'
import { isBlackHoleJumpArmed, resetBlackHoleArm } from '../src/wormhole/blackHole'

const FPS = 60
function run(seconds: number): void { for (let i = 0; i < seconds * FPS; i++) systemViewAnimationSystem(1 / FPS) }
function transforms(): number { let n = 0; for (const _ of engine.getEntitiesWith(Transform)) n++; return n }

const LINKED_HOLE = {
  system: { id: 'bh1', name: 'Altpodaion', star_type: 'black_hole', has_wormhole: true },
  planets: [{ id: 'p1', orbital_slot: 2, planet_type: 'rocky', supports_life: false, name: 'One', moons: [] }],
  asteroidBelts: [],
  wormhole: { targetSystemId: 'bh2', targetSystemName: 'Primhexens' },
}
const LONE_HOLE = { ...LINKED_HOLE, wormhole: null }
const PLAIN_STAR = { ...LINKED_HOLE, system: { id: 'y1', name: 'Rhizmundia', star_type: 'yellow_star', has_wormhole: false }, wormhole: null }
const openEvent = (targetSystemId: string, over: any = {}) => ({
  id: 'ev1', targetSystemId, targetName: 'Rhizmundia', startsAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 3600_000).toISOString(), trip: null, podsOut: 0,
  canJump: true, jumpBlockedReason: null, canReturn: false, ...over,
})

const said: string[] = []
const requests: string[] = []
beforeEach(async () => {
  said.length = 0; requests.length = 0
  setBlackHoleNotify(t => said.push(t))
  resetBlackHoleArm()
  event = null
  await refreshWormhole()
  setWormholeCutscenePlayer(async (_k, midpoint) => { await midpoint?.() })
  setWormholeArrivedCallback(async () => {})
  setSignedFetchHandler(async (req) => { requests.push(req.url); return { ok: true, status: 200, statusText: 'OK', headers: {}, body: '{"systemId":"x","systemName":"X","traveled":true,"fromSystem":"A","toSystem":"B","toSystemId":"bh2"}' } })
})
afterEach(() => { clearSystemView(); vi.restoreAllMocks() })

describe("a black hole's wormhole", () => {
  it('opens at the edge of a black hole whose wormhole is linked, and can be clicked from aboard', async () => {
    detail = LINKED_HOLE
    await renderSystemView('bh1')
    expect(portalState()).toEqual([{ kind: 'blackHole', clickable: true, hoverText: 'Wormhole to Primhexens', eld: false }])
  })
  it("isn't there while the black hole's wormhole is unlinked", async () => {
    detail = LONE_HOLE
    await renderSystemView('bh1')
    expect(portalState()).toEqual([])
  })
  it("is only to look at in a survey: the ship isn't there to jump", async () => {
    detail = LINKED_HOLE
    await renderSystemView('bh1', { readOnly: true })
    expect(portalState()).toEqual([{ kind: 'blackHole', clickable: false, hoverText: 'Wormhole to Primhexens', eld: false }])
  })
  it("asks first: STEM's fuel warning, and the jump arms", async () => {
    detail = LINKED_HOLE
    await renderSystemView('bh1')
    pressPortal('blackHole')
    expect(said.join(' ')).toMatch(/Primhexens.*no solar recharge/)
    expect(isBlackHoleJumpArmed()).toBe(true)
    expect(requests).toEqual([])
  })
  it('jumps on the second press', async () => {
    detail = LINKED_HOLE
    await renderSystemView('bh1')
    pressPortal('blackHole')
    pressPortal('blackHole')
    await new Promise(r => setTimeout(r, 0))
    expect(requests.some(u => u.endsWith('/api/ships/wormhole'))).toBe(true)
  })
})

describe("a wormhole event's wormhole", () => {
  it("opens in the event's target system, and not elsewhere", async () => {
    event = openEvent('y1'); await refreshWormhole()
    detail = PLAIN_STAR
    await renderSystemView('y1', { readOnly: true })
    run(0.1)
    expect(portalState().map(p => p.kind)).toEqual(['event'])
    expect(portalState()[0].hoverText).toMatch(/^Wormhole, closes \d+:\d\d (AM|PM)$/)
    clearSystemView()
    event = openEvent('elsewhere'); await refreshWormhole()
    await renderSystemView('y1', { readOnly: true })
    run(0.1)
    expect(portalState()).toEqual([])
  })
  it('appears when the event opens and goes when it closes, while the view is up', async () => {
    detail = PLAIN_STAR
    await renderSystemView('y1')
    run(0.1)
    expect(portalState()).toEqual([])
    event = openEvent('y1'); await refreshWormhole()
    run(0.1)
    expect(portalState().map(p => p.kind)).toEqual(['event'])
    event = null; await refreshWormhole()
    run(0.1)
    expect(portalState()).toEqual([])
  })
  it('jumps from a survey of the target (event jumps work from anywhere)', async () => {
    event = openEvent('y1'); await refreshWormhole()
    detail = PLAIN_STAR
    await renderSystemView('y1', { readOnly: true })
    run(0.1)
    expect(portalState()[0].clickable).toBe(true)
    pressPortal('event')
    await new Promise(r => setTimeout(r, 0))
    expect(requests.some(u => u.endsWith('/api/events/wormhole/jump'))).toBe(true)
  })
  it('returns from the target once the ship is there', async () => {
    event = openEvent('y1', { canJump: false, canReturn: true, trip: { originSystemId: 'o', originName: 'Home' } }); await refreshWormhole()
    detail = PLAIN_STAR
    await renderSystemView('y1')
    run(0.1)
    pressPortal('event')
    await new Promise(r => setTimeout(r, 0))
    expect(requests.some(u => u.endsWith('/api/events/wormhole/return'))).toBe(true)
  })
  it("is only to look at when the jump is blocked", async () => {
    event = openEvent('y1', { canJump: false, jumpBlockedReason: 'Your ship is mid-flight, Captain.' }); await refreshWormhole()
    detail = PLAIN_STAR
    await renderSystemView('y1', { readOnly: true })
    run(0.1)
    expect(portalState()[0].clickable).toBe(false)
  })
  it('sits opposite the black hole portal when a linked black hole is also the target', async () => {
    event = openEvent('bh1'); await refreshWormhole()
    detail = LINKED_HOLE
    await renderSystemView('bh1')
    run(0.1)
    expect(portalState().map(p => p.kind).sort()).toEqual(['blackHole', 'event'])
  })
})

describe("a wormhole the Eld built (bought on the black market)", () => {
  it('wears their rings, and says whose it is', async () => {
    event = openEvent('y1', { eldBuilt: true }); await refreshWormhole()
    detail = PLAIN_STAR
    await renderSystemView('y1', { readOnly: true })
    run(0.1)
    expect(portalState()[0].eld).toBe(true)
    expect(portalState()[0].hoverText).toMatch(/^Eld wormhole, closes /)
  })
  it("a free event's wormhole doesn't", async () => {
    event = openEvent('y1', { eldBuilt: false }); await refreshWormhole()
    detail = PLAIN_STAR
    await renderSystemView('y1', { readOnly: true })
    run(0.1)
    expect(portalState()[0].eld).toBe(false)
  })
  it('gains or loses the rings if the server changes its mind while the view is up', async () => {
    event = openEvent('y1', { eldBuilt: false }); await refreshWormhole()
    detail = PLAIN_STAR
    await renderSystemView('y1')
    run(0.1)
    event = openEvent('y1', { eldBuilt: true }); await refreshWormhole()
    run(0.1)
    expect(portalState().map(p => p.eld)).toEqual([true])
  })
  it('turns without re-setting any material', async () => {
    event = openEvent('y1', { eldBuilt: true }); await refreshWormhole()
    detail = PLAIN_STAR
    await renderSystemView('y1')
    run(0.1)
    const materials = vi.spyOn(Material, 'setPbrMaterial')
    run(10)
    expect(materials).not.toHaveBeenCalled()
  })
})

describe('the portals and the view', () => {
  it('go with the view', async () => {
    const before = transforms()
    event = openEvent('bh1'); await refreshWormhole()
    detail = LINKED_HOLE
    await renderSystemView('bh1')
    run(0.1)
    clearSystemView()
    expect(portalState()).toEqual([])
    expect(transforms()).toBe(before)
  })
  it('animate without re-setting any material', async () => {
    event = openEvent('bh1'); await refreshWormhole()
    detail = LINKED_HOLE
    await renderSystemView('bh1')
    run(0.1)   // the event portal builds on the first frames
    const materials = vi.spyOn(Material, 'setPbrMaterial')
    run(10)
    expect(materials).not.toHaveBeenCalled()
  })
})
