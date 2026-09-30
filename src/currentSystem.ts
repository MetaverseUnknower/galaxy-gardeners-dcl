// Everything aboard that reads the star the ship is at: the window star, the sleep view, and the desk's solar
// recharge. Scene load and every arrival go through here, so no reader is left on the star the trip left.
import { StarSystem } from './types'
import { setSleepSystem } from './sleepMode'
import { setWindowStarSystem } from './windowStar'
import { setSolarRechargeRate } from './stations/shipOverview'
import { refreshStation } from './stations'

export function showCurrentSystem(system: StarSystem | null): void {
  setSleepSystem(system)
  setWindowStarSystem(system)
  setSolarRechargeRate(system?.solar_recharge_rate ?? 0)   // a black hole, or a system off the map: no recharge
  refreshStation('ship')
}
