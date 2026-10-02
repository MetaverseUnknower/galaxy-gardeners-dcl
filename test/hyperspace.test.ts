// Hyperspace outside the front window while the ship travels: the stars stretch into streaks at departure (with a
// flash), settle into a calmer, sparser tunnel for the rest of the trip, and shrink back to nothing on arrival.
// Joining mid-trip goes straight to the cruise. Moved and stretched only: no material is re-set while it runs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Material, Transform, engine } from '@dcl/sdk/ecs'

let traveling = false
let elapsedMs = 0
vi.mock('../src/navigation', async (orig) => ({
  ...(await orig<any>()),
  isCurrentlyTraveling: () => traveling,
  getTravelElapsedMs: () => (traveling ? elapsedMs : 0),
}))

import { hyperspaceSystem, hyperspaceState, resetHyperspace, hyperspaceRoot } from '../src/hyperspace'
import { setTopViewHidden } from '../src/topViewHide'

const FPS = 60
function run(seconds: number): void {
  for (let i = 0; i < Math.round(seconds * FPS); i++) { hyperspaceSystem(1 / FPS); if (traveling) elapsedMs += 1000 / FPS }
}
function transforms(): number { let n = 0; for (const _ of engine.getEntitiesWith(Transform)) n++; return n }

beforeEach(() => { traveling = false; elapsedMs = 0; resetHyperspace() })
afterEach(() => { setTopViewHidden(false); vi.restoreAllMocks() })

describe('hyperspace outside the window', () => {
  it("isn't there while the ship sits in a system", () => {
    run(5)
    expect(hyperspaceState()).toEqual({ phase: 'off', streaks: 0 })
  })

  it('jumps in at departure, then settles into a calmer, sparser cruise', () => {
    traveling = true
    run(0.5)
    expect(hyperspaceState().phase).toBe('jump')
    run(2)
    const jump = hyperspaceState()
    run(8)
    const cruise = hyperspaceState()
    expect(cruise.phase).toBe('cruise')
    expect(cruise.streaks).toBeGreaterThan(0)
    expect(cruise.streaks).toBeLessThan(jump.streaks)
  })

  it('goes straight to the cruise when you join a trip already under way', () => {
    traveling = true; elapsedMs = 10 * 60_000
    run(0.1)
    expect(hyperspaceState().phase).toBe('cruise')
  })

  it('drops out on arrival and leaves nothing behind', () => {
    const before = transforms()
    traveling = true
    run(10)
    traveling = false
    run(0.5)
    expect(hyperspaceState().phase).toBe('drop')
    run(3)
    expect(hyperspaceState()).toEqual({ phase: 'off', streaks: 0 })
    expect(transforms()).toBe(before)
  })

  it('runs a long cruise without re-setting any material', () => {
    traveling = true; elapsedMs = 10 * 60_000
    run(0.1)
    const materials = vi.spyOn(Material, 'setPbrMaterial')
    run(60)
    expect(materials).not.toHaveBeenCalled()
  })

  it('stays hidden while the top-down map view is up', () => {
    traveling = true; elapsedMs = 10 * 60_000
    run(0.1)
    setTopViewHidden(true)
    run(2)
    const scale = Transform.get(hyperspaceRoot()!).scale
    expect([scale.x, scale.y, scale.z]).toEqual([0, 0, 0])
    expect(hyperspaceState().phase).toBe('cruise')
  })
})
