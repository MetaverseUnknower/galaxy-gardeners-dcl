import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { authenticate } from './auth'
import * as api from './api'
import { createProjectorBase, renderStarSystems, clearMap, starEntities, galaxyAnimationSystem, setViewModeCallback, switchViewMode, setCanSwitchCheck, hideCurrentLocationMarker } from './galaxyMap'
import { setupInteraction, setSelectionCallback, getSelectedSystem, selectSystem } from './interaction'
import { getPlayer } from '@dcl/sdk/players'
import { startTravel, updateTravelState, checkArrival, travelUpdateSystem, isCurrentlyTraveling, drawRouteLine, setCurrentSystemForTravel } from './navigation'
import { setupUi, setSelectedSystemUI, setTravelingStatus, setStatusMessage, setTravelConfirmCallback, setViewSystemCallback, setCurrentSystemId, updateNotification, showNotification } from './ui'
import { StarSystem, PlayerInfo } from './types'
import { renderSystemView, clearSystemView, systemViewAnimationSystem } from './systemView'
import { createEnvironment, respawnSystem, twinkleSystem } from './environment'
import { createShipDisplay, setMissionNotifyCallback, setSolarRechargeRate } from './shipDisplay'
import { createDiscoveryPanel, setDiscoveryNotifyCallback, setDiscoveryCompleteCallback } from './discoveryPanel'
import { movePlayerTo } from '~system/RestrictedActions'
import { createUpgradesPanel, setUpgradeNotifyCallback } from './upgradesPanel'
import { createCatalogPanel } from './catalogPanel'

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

    // Apply solar recharge on scene load
    try { await api.solarRecharge() } catch {}

    setStatusMessage('Loading galaxy map...')
    systems = await api.getSystems(playerInfo.galaxy_id)

    renderStarSystems(systems, playerInfo.home_system_id, playerInfo.current_system_id)
    setupInteraction()

    setMissionNotifyCallback((text, color) => showNotification(text, color))
    const currentSys = systems.find(s => s.id === playerInfo!.current_system_id)
    if (currentSys) setSolarRechargeRate(currentSys.solar_recharge_rate)
    createShipDisplay()

    setDiscoveryNotifyCallback((text, color) => showNotification(text, color))
    setDiscoveryCompleteCallback(async (newSystemId, newSystemName) => {
      // Reload systems to include the new one
      systems = await api.getSystems(playerInfo!.galaxy_id)
      clearMap()
      renderStarSystems(systems, playerInfo!.home_system_id, playerInfo!.current_system_id)
      setupInteraction()

      // Find and select the new star
      for (const [entity, sys] of starEntities) {
        if (sys.id === newSystemId) {
          selectSystem(sys, entity)

          // Get the star's world position (local pos + galaxy root offset)
          const localPos = Transform.get(entity).position
          const rootPos = Vector3.create(128, 41, 128) // MAP_CENTER approximate
          const worldPos = Vector3.create(
            rootPos.x + localPos.x,
            rootPos.y + localPos.y,
            rootPos.z + localPos.z
          )

          // Point camera at the new star from current position
          const player = getPlayer()
          if (player?.position) {
            movePlayerTo({
              newRelativePosition: player.position,
              cameraTarget: worldPos
            })
          }
          break
        }
      }

      // Refresh discovery panel with updated systems
      createDiscoveryPanel(systems, playerInfo!.current_system_id)
    })
    createDiscoveryPanel(systems, playerInfo.current_system_id)

    setUpgradeNotifyCallback((text, color) => showNotification(text, color))
    createUpgradesPanel()

    createCatalogPanel()

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
      hideCurrentLocationMarker()
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
