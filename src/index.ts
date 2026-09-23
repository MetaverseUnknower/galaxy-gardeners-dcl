import { engine, Transform, TextAlignMode } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { Color4 } from '@dcl/sdk/math'
import { createStation, ViewDefinition } from './stations'
import { Bag, clearBag, text, frame, header, bar, button, tile, listRow, CYAN, DIM, MUTED } from './stations/draw'
import { DECK_Y } from './environment'
import { authenticate } from './auth'
import * as api from './api'
import { createProjectorBase, renderStarSystems, clearMap, starEntities, galaxyAnimationSystem, setViewModeCallback, switchViewMode, setCanSwitchCheck, hideCurrentLocationMarker } from './galaxyMap'
import { setupInteraction, setSelectionCallback, getSelectedSystem, selectSystem } from './interaction'
import { getPlayer } from '@dcl/sdk/players'
import { startTravel, updateTravelState, checkArrival, travelUpdateSystem, isCurrentlyTraveling, drawRouteLine, setCurrentSystemForTravel } from './navigation'
import { setupUi, setSelectedSystemUI, setTravelingStatus, setStatusMessage, setTravelConfirmCallback, setViewSystemCallback, setCurrentSystemId, updateNotification, showNotification, openPurchaseDialog, openRefineryDialog } from './ui'
import { StarSystem, PlayerInfo } from './types'
import { renderSystemView, clearSystemView, systemViewAnimationSystem } from './systemView'
import { createEnvironment, respawnSystem, twinkleSystem } from './environment'
import { createShipDisplay, setMissionNotifyCallback, setOpenRefineryCallback, setOpenPurchaseCallback } from './shipDisplay'
import { shipOverviewView, setSolarRechargeRate } from './stations/shipOverview'
import { shipSystemsView } from './stations/shipSystems'
import { createDiscoveryPanel, setDiscoveryNotifyCallback, setDiscoveryCompleteCallback } from './discoveryPanel'
import { movePlayerTo } from '~system/RestrictedActions'
import { createUpgradesPanel, setUpgradeNotifyCallback } from './upgradesPanel'
import { createCatalogPanel, setFloraSelectCallback } from './catalogPanel'
import { summaryView, inventoryView } from './stations/floraCollections'
import { setSelectedFlora, clearSelectedFlora, setCloseDetailCallback } from './ui'
import { selectBody } from './systemView'

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
    setOpenRefineryCallback(() => openRefineryDialog())
    setOpenPurchaseCallback(() => openPurchaseDialog())
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

    setCloseDetailCallback(() => {
      selectBody(null)
      clearSelectedFlora()
    })

    setFloraSelectCallback((flora) => {
      clearSelectedFlora()
      setSelectedFlora(flora)
    })
    createCatalogPanel()

    // TEMP (Task 1 verification): stub views exercising every helper; replaced in Task 6
    const stubView = (id: string, fail = false): ViewDefinition => {
      const bag: Bag = []
      return {
        id,
        async render({ top, low }, ctx) {
          frame(bag, top, 0, 0, 5.6, 2.8)
          header(bag, top, -2.6, 1.05, { icon: 'assets/icons/catalog-icon.png', title: `VIEW ${id.toUpperCase()}`, subtitle: 'explore // study // preserve' })
          text(bag, top, 2.6, 1.1, `fuel ${ctx.dashboard?.ship?.fuel_current ?? '?'}`, 0.4, DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
          tile(bag, top, -1.85, -0.3, 1.6, 1.5, { icon: 'assets/icons/catalog-icon.png', title: 'Tile A', subtitle: 'selected', selected: true, hover: 'A', onClick: () => ctx.setView('a') })
          tile(bag, top, 0, -0.3, 1.6, 1.5, { icon: 'assets/icons/specimen-icon.png', title: 'Tile B', subtitle: 'goes to b', hover: 'B', onClick: () => ctx.setView('b') })
          tile(bag, top, 1.85, -0.3, 1.6, 1.5, { title: 'Fail', subtitle: 'throws', hover: 'fail', onClick: () => ctx.setView('fail') })
          text(bag, top, 0, -1.25, 'SELECT A CATEGORY', 0.3, MUTED)
          frame(bag, low, -1.4, 0, 2.6, 2.2)
          header(bag, low, -2.6, 0.85, { title: 'LIST', subtitle: 'rows' })
          listRow(bag, low, -1.4, 0.3, 2.3, 0.32, { label: 'Row one', sublabel: 'selected', selected: true, hover: 'one', onClick: () => ctx.notify('row one', Color4.create(0, 1, 0.5, 1)) })
          listRow(bag, low, -1.4, -0.1, 2.3, 0.32, { label: 'Row two', hover: 'two', onClick: () => ctx.notify('row two', Color4.create(0, 1, 0.5, 1)) })
          bar(bag, low, -1.4, -0.6, 2.2, 0.66)
          frame(bag, low, 1.4, 0, 2.6, 2.2)
          button(bag, low, 1.4, 0.5, 2.0, 0.4, 'PRIMARY', 'primary', () => ctx.notify('primary', CYAN), { variant: 'primary' })
          button(bag, low, 1.4, 0, 2.0, 0.4, 'OUTLINE', 'outline', () => ctx.refresh(), { icon: 'assets/icons/refinery-icon.png' })
          button(bag, low, 1.4, -0.5, 2.0, 0.4, 'DISABLED', 'disabled', () => {}, { variant: 'disabled' })
          if (fail) throw new Error('forced')
        },
        clear() { clearBag(bag) },
      }
    }
    const west = createStation({ id: 'flora', position: Vector3.create(117.2, DECK_Y, 121.3), yaw: -32 + 90, views: [summaryView, stubView('catalog'), stubView('vault'), inventoryView], notify: showNotification })
    const east = createStation({ id: 'ship', position: Vector3.create(128 + (128 - 117.2), DECK_Y, 121.3), yaw: -(-32 + 90), views: [shipOverviewView, shipSystemsView], notify: showNotification })
    await Promise.all([west.refresh(), east.refresh()])

    setSelectionCallback(async (system: StarSystem | null) => {
      clearSelectedFlora()
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
