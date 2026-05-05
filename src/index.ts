import { engine, Transform } from '@dcl/sdk/ecs'
import { authenticate } from './auth'
import * as api from './api'
import { createProjectorBase, renderStarSystems, clearMap, starEntities } from './galaxyMap'
import { setupInteraction, setSelectionCallback, getSelectedSystem } from './interaction'
import { startTravel, updateTravelState, checkArrival, travelUpdateSystem, isCurrentlyTraveling } from './navigation'
import { setupUi, setSelectedSystemUI, setTravelingStatus, setStatusMessage, setTravelConfirmCallback } from './ui'
import { StarSystem, PlayerInfo } from './types'
import { drawRouteLine } from './navigation'

let playerInfo: PlayerInfo | null = null
let systems: StarSystem[] = []
let arrivalCheckTimer = 0

export async function main() {
  setupUi()
  setStatusMessage('Connecting...')
  createProjectorBase()

  try {
    setStatusMessage('Authenticating...')
    const { hasPlayer } = await authenticate()

    if (!hasPlayer) {
      setStatusMessage('Finding galaxy...')
      const galaxies = await api.getAvailableGalaxies()
      if (galaxies.length === 0) {
        setStatusMessage('No galaxies available')
        return
      }

      const { getPlayerData } = await import('~system/Players')
      const userData = await getPlayerData({})
      const username = userData.data?.displayName || 'Explorer'

      await api.joinGalaxy(galaxies[0].id, username)
    }

    setStatusMessage('Loading player data...')
    playerInfo = await api.getPlayerMe()

    setStatusMessage('Loading galaxy map...')
    systems = await api.getSystems(playerInfo.galaxy_id)

    renderStarSystems(systems, playerInfo.home_system_id, playerInfo.current_system_id)
    setupInteraction()

    setSelectionCallback(async (system: StarSystem | null) => {
      if (!system) {
        setSelectedSystemUI(null, null)
        return
      }

      // Draw route line from current system to selected
      if (playerInfo?.current_system_id) {
        for (const [entity, sys] of starEntities) {
          if (sys.id === playerInfo.current_system_id) {
            const fromPos = Transform.get(entity).position
            for (const [destEntity, destSys] of starEntities) {
              if (destSys.id === system.id) {
                const toPos = Transform.get(destEntity).position
                drawRouteLine(fromPos, toPos)
                break
              }
            }
            break
          }
        }
      }

      try {
        const fuelInfo = await api.getFuelCost(system.id)
        setSelectedSystemUI(system, fuelInfo)
      } catch {
        setSelectedSystemUI(system, null)
      }
    })

    setTravelConfirmCallback(async () => {
      const selected = getSelectedSystem()
      if (!selected) return

      try {
        setStatusMessage('Initiating travel...')
        await startTravel(selected.id)
        setTravelingStatus(selected.name)
        setSelectedSystemUI(null, null)
        setStatusMessage(null)
      } catch (err: any) {
        setStatusMessage(`Travel failed: ${err.message}`)
      }
    })

    await updateTravelState()
    if (isCurrentlyTraveling()) {
      const status = await api.getTravelStatus()
      const destSystem = systems.find(s => s.id === status.destination_system_id)
      if (destSystem) {
        setTravelingStatus(destSystem.name)
      }
    }

    setStatusMessage(null)
  } catch (err: any) {
    setStatusMessage(`Error: ${err.message}`)
    console.error('Galaxy Gardeners init error:', err)
  }

  engine.addSystem(travelUpdateSystem)

  engine.addSystem((dt: number) => {
    arrivalCheckTimer += dt
    if (arrivalCheckTimer >= 5) {
      arrivalCheckTimer = 0
      if (isCurrentlyTraveling()) {
        checkArrival().then(arrived => {
          if (arrived) {
            setTravelingStatus(null)
            setStatusMessage('Arrived!')
            reloadMap()
          }
        })
      }
    }
  })
}

async function reloadMap(): Promise<void> {
  clearMap()
  playerInfo = await api.getPlayerMe()
  systems = await api.getSystems(playerInfo.galaxy_id)
  renderStarSystems(systems, playerInfo.home_system_id, playerInfo.current_system_id)
  setupInteraction()
}
