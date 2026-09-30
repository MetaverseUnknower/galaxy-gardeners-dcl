// The ship follows the system it's in: on arrival the desk's solar recharge line has to come from the new star, not
// the one the trip left (a black hole showed the departure star's +5.0 fuel/hr).
import { describe, it, expect } from 'vitest'
import { showCurrentSystem } from '../src/currentSystem'
import { solarRechargeLine } from '../src/stations/shipOverview'
import { StarSystem } from '../src/types'

const star = (id: string, star_type: string, solar_recharge_rate: number) =>
  ({ id, name: id, star_type, solar_recharge_rate, coord_r: 10, coord_theta: 0, coord_x: 10, coord_y: 0, coord_z: 0 }) as unknown as StarSystem

describe('the current system', () => {
  it("shows the star's solar recharge", () => {
    showCurrentSystem(star('Rhizmundia', 'yellow_star', 5))
    expect(solarRechargeLine()).toBe('Solar Recharge: +5.0 fuel/hr')
  })
  it('drops the recharge line on arriving at a black hole', () => {
    showCurrentSystem(star('Rhizmundia', 'yellow_star', 5))
    showCurrentSystem(star('Altpodaion', 'black_hole', 0))
    expect(solarRechargeLine()).toBeNull()
  })
  it("drops it when the system isn't on the map, rather than keeping the last star's", () => {
    showCurrentSystem(star('Rhizmundia', 'yellow_star', 5))
    showCurrentSystem(null)
    expect(solarRechargeLine()).toBeNull()
  })
})
