// The Stellar Discovery desk: builds that overlap (a map reload and a finished discovery at once) must end with one
// panel, not two stacked on each other, and rebuilding must not leak.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { liveEntities, tick } from './helpers'

type Deferred = { promise: Promise<any>; resolve: (v: any) => void }
const deferred = (): Deferred => { let resolve!: (v: any) => void; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
let optionsQueue: Deferred[] = []
const OPTIONS = [
  { direction: 'inward', label: 'Inward', estimatedMinutes: 30, fuelCost: 2 },
  { direction: 'outward', label: 'Outward', estimatedMinutes: 45, fuelCost: 3 },
]
vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getDiscoveryOptions: vi.fn(() => (optionsQueue.length ? optionsQueue.shift()!.promise : Promise.resolve(OPTIONS))),
  getActiveDiscovery: vi.fn(async () => null),
}))

import { createDiscoveryPanel, clearDiscoveryPanel } from '../src/discoveryPanel'

const SYSTEMS: any[] = [
  { id: 'a', name: 'Alpha', coord_x: 0, coord_y: 0, coord_z: 0, coord_r: 0, coord_theta: 0, star_type: 'yellow_star' },
  { id: 'b', name: 'Beta', coord_x: 5, coord_y: 3, coord_z: 1, coord_r: 5.8, coord_theta: 0.54, star_type: 'red_dwarf' },
]

beforeEach(() => { clearDiscoveryPanel(); optionsQueue = [] })

describe('discovery panel', () => {
  it('rebuilding leaves the same number of entities', async () => {
    await createDiscoveryPanel(SYSTEMS, 'a')
    await tick(0.5)
    const once = liveEntities()
    for (let i = 0; i < 4; i++) await createDiscoveryPanel(SYSTEMS, 'a')
    await tick(0.5)   // cabinDim prunes the shades of screens that are gone on its next pass
    expect(liveEntities()).toBe(once)
  })

  it('two overlapping builds end with one panel, whichever fetch answers first', async () => {
    await createDiscoveryPanel(SYSTEMS, 'a')
    await tick(0.5)
    const once = liveEntities()
    clearDiscoveryPanel()
    const slow = deferred(), fast = deferred()
    optionsQueue = [slow, fast]
    const first = createDiscoveryPanel(SYSTEMS, 'a')    // its fetch answers last
    const second = createDiscoveryPanel(SYSTEMS, 'a')
    fast.resolve(OPTIONS); await second
    slow.resolve(OPTIONS); await first
    await tick(0.5)
    expect(liveEntities()).toBe(once)
  })
})
