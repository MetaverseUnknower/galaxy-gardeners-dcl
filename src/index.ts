import { engine, Transform } from '@dcl/sdk/ecs'
import { authenticate } from './auth'
import * as api from './api'
import { createProjectorBase, renderStarSystems, clearMap, starEntities, galaxyAnimationSystem, setViewModeCallback, switchViewMode, setCanSwitchCheck, hideCurrentLocationMarker } from './galaxyMap'
import { setupInteraction, setSelectionCallback, getSelectedSystem } from './interaction'
import { startTravel, updateTravelState, checkArrival, travelUpdateSystem, isCurrentlyTraveling, drawRouteLine, setCurrentSystemForTravel } from './navigation'
import { setupUi, setSelectedSystemUI, setTravelingStatus, setStatusMessage, setTravelConfirmCallback, setViewSystemCallback, setCurrentSystemId, updateNotification, showNotification } from './ui'
import { StarSystem, PlayerInfo } from './types'
import { renderSystemView, clearSystemView, systemViewAnimationSystem } from './systemView'
import { createEnvironment, respawnSystem, twinkleSystem } from './environment'
import { createShipDisplay, setMissionNotifyCallback } from './shipDisplay'
import { createDiscoveryPanel, setDiscoveryNotifyCallback } from './discoveryPanel'

let playerInfo: PlayerInfo | null = null
let systems: StarSystem[] = []
let arrivalCheckTimer = 0
let statusClearTimer = -1

export async function main() {
  setupUi()
  setStatusMessage('Connecting...')
  createEnvironment()
  createProjectorBase()

  try {
    setStatusMessage('Authenticating...')
    const { hasPlayer } = await authenticate()

    if (!hasPlayer) {
      setStatusMessage('Finding galaxy...')
      const galaxies = await api.getAvailableGalaxies()
      if (galaxies.length === 0) { setStatusMessage('No galaxies available'); return }
      const { getUserData } = await import('~system/UserIdentity')
      const userData = await getUserData({})
      const username = userData.data?.displayName || 'Explorer'
      await api.joinGalaxy(galaxies[0].id, username)
    }

    setStatusMessage('Loading player data...')
    playerInfo = await api.getPlayerMe()

    setStatusMessage('Loading galaxy map...')
    systems = await api.getSystems(playerInfo.galaxy_id)

    renderStarSystems(systems, playerInfo.home_system_id, playerInfo.current_system_id)
    setupInteraction()

    setMissionNotifyCallback((text, color) => showNotification(text, color))
    createShipDisplay()

    setDiscoveryNotifyCallback((text, color) => showNotification(text, color))
    createDiscoveryPanel(systems, playerInfo.current_system_id)

    setSelectionCallback(async (system: StarSystem | null) => {
      if (!system) { setSelectedSystemUI(null, null); return }
      if (playerInfo?.current_system_id) {
        for (const [entity, sys] of starEntities) {
          if (sys.id === playerInfo.current_system_id) {
            const fromPos = Transform.get(entity).position
            for (const [destEntity, destSys] of starEntities) {
              if (destSys.id === system.id) {
                drawRouteLine(fromPos, Transform.get(destEntity).position)
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
      } catch { setSelectedSystemUI(system, null) }
    })

    setTravelConfirmCallback(async () => {
      const selected = getSelectedSystem()
      if (!selected) return
      try {
        setStatusMessage('Initiating travel...')
        hideCurrentLocationMarker()
        await startTravel(selected.id)
        setTravelingStatus(selected.name)
        setSelectedSystemUI(null, null)
        setStatusMessage(null)
      } catch (err: any) { setStatusMessage(`Travel failed: ${err.message}`) }
    })

    setCurrentSystemId(playerInfo.current_system_id)
    setCurrentSystemForTravel(playerInfo.current_system_id)
    setCanSwitchCheck(() => !isCurrentlyTraveling())
    setViewSystemCallback(() => {
      if (playerInfo?.current_system_id && !isCurrentlyTraveling()) switchViewMode('system')
    })

    setViewModeCallback(async (mode) => {
      if (mode === 'system') {
        if (!playerInfo?.current_system_id) return
        setSelectedSystemUI(null, null)
        clearMap()
        await renderSystemView(playerInfo.current_system_id)
      } else {
        clearSystemView()
        renderStarSystems(systems, playerInfo!.home_system_id, playerInfo!.current_system_id)
        setupInteraction()
      }
    })

    await updateTravelState()
    if (isCurrentlyTraveling()) {
      const status = await api.getTravelStatus()
      const destId = (status as any).destinationSystemId || status.destination_system_id
      const destSystem = systems.find(s => s.id === destId)
      if (destSystem) setTravelingStatus(destSystem.name)
    }

    setStatusMessage(null)
  } catch (err: any) {
    setStatusMessage(`Error: ${err.message}`)
    console.error('Galaxy Gardeners init error:', err)
  }

  engine.addSystem(travelUpdateSystem)
  engine.addSystem(galaxyAnimationSystem)
  engine.addSystem(systemViewAnimationSystem)
  engine.addSystem(respawnSystem)
  engine.addSystem(twinkleSystem)

  engine.addSystem((dt: number) => {
    updateNotification(dt)
    if (statusClearTimer > 0) { statusClearTimer -= dt; if (statusClearTimer <= 0) { statusClearTimer = -1; setStatusMessage(null) } }
    arrivalCheckTimer += dt
    if (arrivalCheckTimer >= 5) {
      arrivalCheckTimer = 0
      if (isCurrentlyTraveling()) {
        checkArrival().then(arrived => {
          if (arrived) { setTravelingStatus(null); setStatusMessage('Arrived!'); statusClearTimer = 3; reloadMap() }
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
