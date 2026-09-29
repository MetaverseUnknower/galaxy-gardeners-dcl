// Black hole wormholes in the ship: the star panel offers the jump from a linked black hole, asks once (STEM warns
// there's no solar recharge on the far side), then jumps through the same cutscene as event wormholes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setSignedFetchHandler } from './system/SignedFetch'

let detail: any = null
const detailCalls: string[] = []
vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getSystemDetail: vi.fn(async (id: string) => { detailCalls.push(id); return detail }),
}))

import { loadBlackHoleLink, blackHoleLink, armBlackHoleJump, resetBlackHoleArm, ARM_SECONDS } from '../src/wormhole/blackHole'
import { jumpThroughBlackHole, setWormholeArrivedCallback, setWormholeNotify, setWormholeCutscenePlayer } from '../src/wormhole/state'

const HOLE = { id: 'bh1', name: 'Altpodaion', has_wormhole: true } as any
beforeEach(() => { detailCalls.length = 0; resetBlackHoleArm() })

describe('the link', () => {
  it("knows where the black hole's wormhole leads", async () => {
    detail = { system: { id: 'bh1' }, wormhole: { targetSystemId: 'bh2', targetSystemName: 'Primhexens' } }
    await loadBlackHoleLink(HOLE)
    expect(blackHoleLink('bh1')).toEqual({ systemId: 'bh1', targetId: 'bh2', targetName: 'Primhexens' })
    expect(blackHoleLink('elsewhere')).toBeNull()
  })
  it("offers nothing for a lone black hole (its wormhole isn't linked yet)", async () => {
    detail = { system: { id: 'bh3' }, wormhole: null }
    await loadBlackHoleLink({ id: 'bh3', name: 'Lonely', has_wormhole: true } as any)
    expect(blackHoleLink('bh3')).toBeNull()
  })
  it("doesn't ask the server about systems without a wormhole", async () => {
    await loadBlackHoleLink({ id: 'sun', name: 'Plainstar', has_wormhole: false } as any)
    expect(detailCalls).toEqual([])
    expect(blackHoleLink('sun')).toBeNull()
  })
})

describe('confirming', () => {
  it('asks once, jumps on the second press, and asks again if the captain waits too long', () => {
    expect(armBlackHoleJump(0)).toBe('armed')
    expect(armBlackHoleJump(2000)).toBe('go')
    expect(armBlackHoleJump(3000)).toBe('armed')                          // a fresh ask after a jump
    expect(armBlackHoleJump(3000 + ARM_SECONDS * 1000 + 1)).toBe('armed') // waited too long: asks again
  })
})

describe('jumping', () => {
  it('jumps through the cutscene, reloading the map while the screen is white', async () => {
    setSignedFetchHandler(async (req) => ({
      ok: true, status: 200, statusText: 'OK', headers: {},
      body: req.url.endsWith('/api/ships/wormhole') ? '{"traveled":true,"fromSystem":"Altpodaion","toSystem":"Primhexens","toSystemId":"bh2"}' : 'null',
    }))
    const order: string[] = []
    setWormholeArrivedCallback(async () => { order.push('arrived') })
    setWormholeCutscenePlayer(async (kind, midpoint) => { order.push(`cutscene:${kind}`); await midpoint?.() })
    await jumpThroughBlackHole()
    expect(order).toEqual(['cutscene:jump', 'arrived'])
  })
  it("passes on the server's reason when the jump is refused", async () => {
    setSignedFetchHandler(async () => ({ ok: false, status: 400, statusText: '400', headers: {}, body: "We're mid-jump already, Captain." }))
    const said: string[] = []
    setWormholeNotify((text) => said.push(text))
    await jumpThroughBlackHole()
    expect(said).toEqual(["We're mid-jump already, Captain."])
  })
})
