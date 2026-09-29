// The fuel gauge during a trip: the server charges the whole trip at departure, and the gauges burn it down over the
// trip. A desk still holding the pre-departure fuel added the burn on top (299/150 on a 149.5-fuel trip).
import { describe, it, expect, vi } from 'vitest'

const now = Date.now()
vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  travel: vi.fn(async () => ({ ok: true })),
  getTravelStatus: vi.fn(async () => ({
    isTraveling: true, destinationSystemId: 'far',
    startedAt: new Date(now).toISOString(), completesAt: new Date(now + 3 * 3600_000).toISOString(),
    fuelStart: 150, fuelEnd: 0.5,
  })),
}))

import { startTravel, displayedFuel, onDeparture } from '../src/navigation'

describe('fuel gauge on a trip', () => {
  it('tells the desks to refresh as soon as the ship departs, so they read the charged fuel', async () => {
    const departed = vi.fn()
    onDeparture(departed)
    await startTravel('far')
    expect(departed).toHaveBeenCalledTimes(1)
  })
  it('shows the departure fuel at the start of the trip, from the charged server value', async () => {
    await startTravel('far')
    expect(displayedFuel(0.5, 150)).toBeCloseTo(150, 0)
  })
  it('never shows more than the tank holds, even from a stale pre-departure value', async () => {
    await startTravel('far')
    expect(displayedFuel(150, 150)).toBeLessThanOrEqual(150)   // was 299.5
  })
})
