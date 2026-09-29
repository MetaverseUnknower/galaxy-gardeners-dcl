// The system view hologram: re-rendering must not leak entities, and a stale render must not draw over a newer one.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { liveEntities, tick } from './helpers'

const detail = (starType: string) => ({
  system: { id: 's1', name: 'Test', star_type: starType },
  planets: [
    { id: 'p1', orbital_slot: 1, planet_type: 'rocky', supports_life: false, name: 'One', moons: [] },
    { id: 'p2', orbital_slot: 3, planet_type: 'gas_giant', supports_life: false, name: 'Two', moons: [] },
  ],
  asteroidBelts: [{ id: 'b1', name: 'Belt', risk_level: 'low' }],
})
let nextDetail: any = detail('yellow_star')
vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getSystemDetail: vi.fn(async () => nextDetail),
}))

import { renderSystemView, clearSystemView } from '../src/systemView'

beforeEach(() => { clearSystemView(); nextDetail = detail('yellow_star') })

describe('system view', () => {
  it('re-rendering the same system leaves the same number of entities', async () => {
    await renderSystemView('s1')
    const once = liveEntities()
    for (let i = 0; i < 5; i++) await renderSystemView('s1')
    expect(liveEntities()).toBe(once)
  })

  it('two renders at once (quick clicks) end with one hologram, not two', async () => {
    await renderSystemView('s1')
    const once = liveEntities()
    clearSystemView()
    await Promise.all([renderSystemView('s1'), renderSystemView('s1')])
    expect(liveEntities()).toBe(once)
  })

  it('a black hole draws its disk and halo, and re-rendering it leaks none of them', async () => {
    nextDetail = detail('black_hole')
    await renderSystemView('s1')
    const once = liveEntities()
    await renderSystemView('s1')
    await renderSystemView('s1')
    expect(liveEntities()).toBe(once)
  })

  it('clearing removes everything it drew', async () => {
    const before = liveEntities()
    await renderSystemView('s1')
    expect(liveEntities()).toBeGreaterThan(before)
    clearSystemView()
    await tick(0.1)
    expect(liveEntities()).toBe(before)
  })
})
