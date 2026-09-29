import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3, Color4 } from '@dcl/sdk/math'
import { createStation } from './stations'
import { authenticate } from './auth'
import * as api from './api'
import { createProjectorBase, restoreMapView, renderStarSystems, clearMap, starEntities, galaxyAnimationSystem, setViewModeCallback, switchViewMode, setCanSwitchCheck, hideCurrentLocationMarker, getViewMode, setWormholeTarget } from './galaxyMap'
import { setupInteraction, setSelectionCallback, getSelectedSystem, selectSystem } from './interaction'
import { getPlayer } from '@dcl/sdk/players'
import { startTravel, updateTravelState, checkArrival, travelUpdateSystem, isCurrentlyTraveling, drawRouteLine, setCurrentSystemForTravel } from './navigation'
import { oneAtATime } from './oneAtATime'
import { setupUi, setSelectedSystemUI, setSelectedSystemFuel, setTravelingStatus, setStatusMessage, setTravelConfirmCallback, setViewSystemCallback, setCurrentSystemId, updateNotification, showNotification, showStemMessage } from './ui'
import { StarSystem, PlayerInfo } from './types'
import { renderSystemView, clearSystemView, systemViewAnimationSystem, setSurveyReturn, setBlackHoleNotify } from './systemView'
import { createEnvironment, respawnSystem, twinkleSystem, DECK_Y } from './environment'
import { shipOverviewView, setSolarRechargeRate } from './stations/shipOverview'
import { shipSystemsView } from './stations/shipSystems'
import { podOperationsView, setPodOpsSystemId } from './stations/podOperations'
import { createNavConsole, setNavConsoleSystem, refreshNavConsole } from './navConsole'
import { setupConsoleCamera } from './consoleCamera'
import { loadPrefs, getPref, setPref } from './prefs'
import { setupSoloShip } from './soloShip'
import { setGuideNotifyCallback } from './guide'
import { isTourRunning, setupTour, startTourIfNeeded } from './tour/runner'
import { refreshSystemProgress } from './systemProgress'
import { onWormholeChanged, setWormholeNotify, setWormholeArrivedCallback, setWormholeCutscenePlayer, playWormholeCutscene, refreshWormhole, closesAtText, podWord } from './wormhole/state'
import { playCutscene } from './wormhole/cutscene'
import { startSoundtrack, setSoundtrackContext } from './soundtrack'
import { playSfx, setSfxSystemId } from './sfx'
import { setSleepSystem } from './sleepMode'
import { setWindowStarSystem } from './windowStar'
import './windowScan'
import { setupHeatMap } from './heatMap'
import { isDocked, loadDockedStatus, onDockingChanged, undock } from './docking'
import { refreshStation } from './stations'
import { createDiscoveryPanel, refreshDiscoveryPanel, setDiscoveryNotifyCallback, setDiscoveryCompleteCallback } from './discoveryPanel'
import { movePlayerTo } from '~system/RestrictedActions'
import { summaryView, inventoryView } from './stations/floraCollections'
import { catalogView, vaultView, setFloraSelectCallback } from './stations/floraSpecies'
import { setSelectedFlora, clearSelectedFlora, setCloseDetailCallback } from './ui'
import { selectBody } from './systemView'

let playerInfo: PlayerInfo | null = null
let viewSystemId: string | null = null   // a visited system being surveyed in the hologram (null: the ship's own)

// Wormhole events: STEM notices, the map reload after a jump, and the opened / closed cutscenes
function setupWormholeEvents(): void {
  const VIOLET = Color4.create(0.75, 0.45, 1, 1)
  setWormholeNotify((text, warning) => showNotification(text, warning ? Color4.create(1, 0.72, 0.2, 1) : VIOLET, warning ? 8 : 6))
  // A wormhole jump undocks the ship on the server
  setWormholeArrivedCallback(async () => { await loadDockedStatus(); await reloadMap() })
  setWormholeCutscenePlayer(playCutscene)
  onWormholeChanged(async (prev, next) => {
    setWormholeTarget(next?.targetSystemId ?? null)
    await tourFinished()   // the tour owns the camera; the cutscenes wait for it
    // One event can replace another between polls: the old one closes, then the new one opens
    if (prev) {
      await playWormholeCutscene('close', () => reloadMap())
      const lost = prev.trip && prev.podsOut > 0 ? ` We lost contact with ${podWord(prev.podsOut)}.` : ''
      showNotification(`The wormhole to ${prev.targetName} has closed.${lost}`, VIOLET, 8)
      if (lost) playSfx('pod_destroyed')   // the server destroyed them at closing
      void refreshStation('ship')          // lost pods leave the missions list and the pod count
    }
    // Once per event per player: reloading doesn't replay it
    if (next && getPref<string>('wormholeSeen', '') !== next.id) {
      setPref('wormholeSeen', next.id)
      await playWormholeCutscene('open')
      showNotification(`Captain, a wormhole just opened to ${next.targetName}! It's open until ${closesAtText()}.`, VIOLET, 8)
    }
  })
  void refreshWormhole()
}

// The opening fanfare plays once per player, ever: the first time they come aboard. Anyone who has already started,
// finished or skipped the tour has been aboard before (this rule arrived after them), so they don't hear it again.
const FANFARE_PREF = 'boardingFanfarePlayed'
async function playFirstBoardingFanfare(): Promise<void> {
  if (getPref<boolean>(FANFARE_PREF, false)) return
  let firstTime = false
  try {
    const w = await api.getWalkthroughState()
    firstTime = !w.walkthroughCompleted && !w.walkthroughSkipped && !(w.walkthroughScene > 0)
  } catch { return }   // unknown: stay quiet and ask again next time
  setPref(FANFARE_PREF, true)
  if (firstTime) playSfx('game_start')
}

function tourFinished(): Promise<void> {
  if (!isTourRunning()) return Promise.resolve()
  return new Promise(resolve => {
    const wait = () => { if (!isTourRunning()) { engine.removeSystem(wait); resolve() } }
    engine.addSystem(wait)
  })
}

async function showSystemView(): Promise<void> {
  if (!playerInfo?.current_system_id) return
  const target = viewSystemId ?? playerInfo.current_system_id
  const remote = target !== playerInfo.current_system_id
  const nameOf = (id: string) => systems.find(s => s.id === id)?.name ?? 'Unknown system'
  setSurveyReturn(() => { viewSystemId = null; void showSystemView() }, nameOf(playerInfo.current_system_id))
  await renderSystemView(target, { readOnly: remote, title: nameOf(target) })
  refreshNavConsole()
  if (remote) showNotification(`Survey of ${systems.find(s => s.id === target)?.name ?? 'a visited system'}: from your visit, read only`, Color4.create(0.35, 1, 0.55, 1))
}
let systems: StarSystem[] = []
let arrivalCheckTimer = 0
let statusClearTimer = -1

export async function main() {
  setupUi()
  setStatusMessage('Connecting...')
  createEnvironment()
  createProjectorBase()
  createNavConsole()
  setupConsoleCamera()
  setupTour()
  void setupSoloShip()
  setGuideNotifyCallback(text => showNotification(text, Color4.create(1, 0.25, 0.85, 1)))
  setBlackHoleNotify(text => showStemMessage(text))

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
    await loadPrefs()
    restoreMapView()   // the player's saved map height, zoom and rotation
    void startSoundtrack()

    // Apply solar recharge on scene load
    try { await api.solarRecharge() } catch {}

    setStatusMessage('Loading galaxy map...')
    systems = await api.getSystems(playerInfo.galaxy_id)

    setupHeatMap(playerInfo.galaxy_id)
    renderStarSystems(systems, playerInfo.home_system_id, playerInfo.current_system_id)
    setupInteraction()
    void refreshSystemProgress()   // visited / explored rings on the map

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

    setCloseDetailCallback(() => {
      selectBody(null)
      clearSelectedFlora()
    })

    setFloraSelectCallback((flora) => {
      clearSelectedFlora()
      setSelectedFlora(flora)
    })

    const currentSys = systems.find(s => s.id === playerInfo!.current_system_id)
    if (currentSys) setSolarRechargeRate(currentSys.solar_recharge_rate)
    // No docking in the scene yet, so the station theme waits for that feature.
    setSoundtrackContext({ docked: isDocked(), system: currentSys ?? null })
    setSfxSystemId(playerInfo.current_system_id)
    setSleepSystem(currentSys ?? null)
    setWindowStarSystem(currentSys ?? null)
    onDockingChanged(() => {
      setSoundtrackContext({ docked: isDocked(), system: systems.find(x => x.id === playerInfo?.current_system_id) ?? null })
      refreshStation('ship')   // docked pricing, and the UPGRADE button
    })
    void loadDockedStatus()

    const floraStation = createStation({
      id: 'flora',
      position: Vector3.create(117.2, DECK_Y, 121.3),
      yaw: -32 + 90,
      views: [summaryView, catalogView, vaultView, inventoryView],
      notify: showNotification,
    })
    const shipStation = createStation({
      id: 'ship',
      position: Vector3.create(128 + (128 - 117.2), DECK_Y, 121.3),
      yaw: -(-32 + 90),
      views: [shipOverviewView, shipSystemsView, podOperationsView],
      notify: showNotification,
    })
    void Promise.all([floraStation.refresh(), shipStation.refresh()])

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
      // Open the panel immediately with whatever is known; a cached quote shows at once and refreshes if stale.
      const cached = api.peekFuelCost(system.id)
      setSelectedSystemUI(system, cached?.value ?? null, !cached?.fresh)
      if (!cached?.fresh) {
        api.getFuelCost(system.id)
          .then(fuel => setSelectedSystemFuel(system.id, fuel))
          .catch(() => setSelectedSystemFuel(system.id, null))
      }
    })

    setTravelConfirmCallback(async () => {
      const selected = getSelectedSystem()
      if (!selected) return
      try {
        if (isDocked()) { setStatusMessage('Releasing docking clamps...'); await undock(true) }
        setStatusMessage('Initiating travel...')
        hideCurrentLocationMarker()
        await startTravel(selected.id)
        api.invalidateFuelCosts()
        setTravelingStatus(selected.name)
        refreshNavConsole()   // the station card switches to IN TRANSIT
        refreshDiscoveryPanel()   // the current system reads Deep space
        setSelectedSystemUI(null, null)
        setStatusMessage(null)
      } catch (err: any) { setStatusMessage(`Travel failed: ${err.message}`) }
    })

    setCurrentSystemId(playerInfo.current_system_id)

    setPodOpsSystemId(playerInfo.current_system_id)

    const consoleSystemId = playerInfo.current_system_id

    setNavConsoleSystem(systems.find(s => s.id === consoleSystemId) ?? null)
    setCurrentSystemForTravel(playerInfo.current_system_id)
    setCanSwitchCheck(() => !isCurrentlyTraveling())
    // VIEW SYSTEM: the ship's own system, or a read-only survey of a system visited before
    setViewSystemCallback((systemId) => {
      if (!playerInfo?.current_system_id || isCurrentlyTraveling()) return
      viewSystemId = systemId
      if (getViewMode() === 'system') void showSystemView()
      else switchViewMode('system')
    })

    setViewModeCallback(async (mode) => {
      if (mode === 'system') {
        if (!playerInfo?.current_system_id) return
        setSelectedSystemUI(null, null)
        clearMap()
        await showSystemView()
      } else {
        viewSystemId = null   // back to the galaxy: the next system view is the ship's own again
        clearSystemView()
        renderStarSystems(systems, playerInfo!.home_system_id, playerInfo!.current_system_id)
        setupInteraction()
      }
    })

    await updateTravelState()
    if (isCurrentlyTraveling()) {
      hideCurrentLocationMarker()
      refreshDiscoveryPanel()   // loaded mid-trip: panels were drawn before the travel state was known
      refreshNavConsole()
      const status = await api.getTravelStatus()
      const destId = (status as any).destinationSystemId || status.destination_system_id
      const destSystem = systems.find(s => s.id === destId)
      if (destSystem) setTravelingStatus(destSystem.name)
    }

    setStatusMessage(null)
    await playFirstBoardingFanfare()
    void startTourIfNeeded()
    setupWormholeEvents()   // after the desks, docking and travel state exist: the tour reads all three
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

// One reload at a time: arrival, a wormhole jump and its close can all ask at once, and two overlapping reloads both
// clear before either draws, so both draw (a doubled map). A request during a reload runs once more after it.
const reloadMap = oneAtATime(() => reloadMapOnce())

async function reloadMapOnce(): Promise<void> {
  api.invalidateFuelCosts()   // arrived somewhere new: every quote changes
  clearMap()
  playerInfo = await api.getPlayerMe()
  setCurrentSystemId(playerInfo.current_system_id)   // the star panel's VIEW SYSTEM / TRAVEL choice follows the ship
  setPodOpsSystemId(playerInfo.current_system_id)
  setCurrentSystemForTravel(playerInfo.current_system_id)   // the next trip's route line starts here
  const consoleSystemId = playerInfo.current_system_id
  setNavConsoleSystem(systems.find(s => s.id === consoleSystemId) ?? null)
  systems = await api.getSystems(playerInfo.galaxy_id)
  setSoundtrackContext({ docked: isDocked(), system: systems.find(s => s.id === playerInfo!.current_system_id) ?? null })
  setSfxSystemId(playerInfo.current_system_id)
  setSleepSystem(systems.find(s => s.id === playerInfo!.current_system_id) ?? null)
  setWindowStarSystem(systems.find(s => s.id === playerInfo!.current_system_id) ?? null)
  renderStarSystems(systems, playerInfo.home_system_id, playerInfo.current_system_id)
  setupInteraction()
  void refreshSystemProgress()   // the system just arrived at is now visited
  void createDiscoveryPanel(systems, playerInfo.current_system_id)   // new system: name, coordinates and search options
}
