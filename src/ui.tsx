import ReactEcs, { ReactEcsRenderer, UiEntity, Label, Input } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { StarSystem, FuelCostResponse } from './types'
import { getTravelProgress, getTravelRemainingMs } from './navigation'
import { getSelectedBody, BodyInfo, isViewingRemoteSystem, viewedSystemName, ownSystemTitle, returnFromSurvey } from './systemView'
import { switchViewMode } from './galaxyMap'

let selectedFlora: any = null
let onCloseDetailPanel: (() => void) | null = null
export function setSelectedFlora(flora: any): void { selectedFlora = flora }
export function clearSelectedFlora(): void { selectedFlora = null }
export function setCloseDetailCallback(cb: () => void): void { onCloseDetailPanel = cb }
import { isCurrentlyTraveling } from './navigation'
import { refreshStation } from './stations'
import { getCameraMode, setCameraMode, CAMERA_MODES, CAMERA_MODE_LABELS, isCameraSuspended } from './consoleCamera'
import { teleportTo } from '~system/RestrictedActions'
import { currentTrack, isMuted, toggleMuted, nextTrack } from './soundtrack'
import { isSleeping, sleepSceneVisible, sleepCurtain, wake, sleepIntroVisible, dismissSleepIntro, sleepView, sleepViewIndex, setSleepView, SLEEP_VIEWS, MILKY_WAY, STAR_Y, galacticPlaneOffset, BACKDROPS, BACKDROP_SCALE, ATLAS, atlasUvs, sleepCelestials, NEBULAE, NEBULA_WRAP, starSprite, starOffset, layerOffset, sleepSpecks, driftSpeeds, panFraction } from './sleepMode'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { px } from './uiScale'
import { StemButton, StemPanel } from './stemChat'
import { GuideButton, GuidePanel } from './guide'
import { InfoMenu, CreditsPanel, LegalPanel } from './credits'
import { emitTourEvent } from './tour/events'
import { TourDialog } from './tour/dialog'
import { WormholeBanner } from './wormhole/banner'
import { WormholeOverlay } from './wormhole/flash'
import { HawkingOverlay } from './hawkingDrift'
import { isWormholeBusy } from './wormhole/state'
import { blackHoleLink, loadBlackHoleLink, isBlackHoleJumpArmed, resetBlackHoleArm, wormholeOpen } from './wormhole/blackHole'
import { eventWormholeOffer, useEventWormhole, pressBlackHoleJump } from './wormhole/actions'
import { progressLabel, systemProgress } from './systemProgress'
import { selectSystem } from './interaction'
import { payMana, redeemManaPurchase, paymentErrorMessage } from './payments'
import * as api from './api'
import { constructionCosts, costRows, canBegin, beginConstruction } from './construction'
import { callsAt, helpFor, fuelChoices, nearestStation, towCost, distressPlace, respondTo, sendFuelTo, towToSafety, towMinutes, durationText, sendDistress, distressMessage, DISTRESS_PRESETS } from './distress'


let selectedSystem: StarSystem | null = null
let fuelInfo: FuelCostResponse | null = null
let fuelLoading = false
let fuelFailed = false
let travelingTo: string | null = null
let statusMessage: string | null = null
let onTravelConfirm: (() => void | Promise<void>) | null = null
// True from CONFIRM until the server answers: a second press used to start travel again mid-request.
let travelStarting = false
let onViewSystem: ((systemId: string) => void) | null = null
let showTravelConfirm = false
let currentSystemId: string | null = null
let deployStatus: string | null = null   // only 'Deploying...' while a request is in flight; results go to notifications
let deploying = false                     // the button's lock: set only while a deploy request is pending
let lastSelectedBodyId: string | null = null
let discoveryDescription: string | null = null
let notification: { text: string; color: Color4; timer: number } | null = null

// Fuel dialogs
let showPurchaseDialog = false

type RecallDialogState = { expeditionId: string; label: string; preview: api.RecallPreview | null; working: boolean; error: string | null }
let recallDialog: RecallDialogState | null = null

const fmtMinutes = (m: number): string => {
  const total = Math.max(1, Math.ceil(m))
  const h = Math.floor(total / 60)
  return h > 0 ? `${h}h ${String(total % 60).padStart(2, '0')}m` : `${total}m`
}
const serverError = (err: any): string => {
  const m = /^API error \d+: (.*)$/s.exec(String(err?.message ?? ''))
  if (m) { try { return JSON.parse(m[1]).error ?? 'Recall failed' } catch { return 'Recall failed' } }
  return err?.message || 'Recall failed'
}

/** Opens the recall confirmation for one expedition and loads its preview. */
export function openRecallDialog(expeditionId: string, label: string): void {
  recallDialog = { expeditionId, label, preview: null, working: false, error: null }
  api.getRecallPreview(expeditionId)
    .then(p => { if (recallDialog?.expeditionId === expeditionId) recallDialog.preview = p })
    .catch(err => { if (recallDialog?.expeditionId === expeditionId) recallDialog.error = serverError(err) })
}

async function confirmRecall(): Promise<void> {
  const d = recallDialog
  if (!d || d.working) return
  d.working = true
  try {
    const r = await api.recallExpedition(d.expeditionId)
    showNotification(`Recall signal sent. The ${d.label.toLowerCase()} pod is back in ${fmtMinutes(r.recallMinutes)}.`, Color4.create(0, 0.9, 1, 1))
    recallDialog = null
    refreshStation('ship')
  } catch (err: any) {
    d.working = false
    d.error = serverError(err)
  }
}

let showRefineryDialog = false
let purchaseStatus: string | null = null
let refineryStatus: string | null = null
let refineryInventory: { helium_3: number; plasma_crystals: number; fuel_cells: number } = { helium_3: 0, plasma_crystals: 0, fuel_cells: 0 }

export function openPurchaseDialog(): void { showPurchaseDialog = true; showRefineryDialog = false; purchaseStatus = null }
export function closePurchaseDialog(): void { showPurchaseDialog = false; purchaseStatus = null }
export function openRefineryDialog(): void {
  showRefineryDialog = true; showPurchaseDialog = false; refineryStatus = null
  loadRefineryInventory()
}
export function closeRefineryDialog(): void { showRefineryDialog = false; refineryStatus = null }

// Build a station (the nav console's BUILD STATION): a name, the costs against the hold, and BEGIN CONSTRUCTION
let buildDialog: { systemId: string; name: string; inventory: { resource_type: string; quantity: number }[] | null; status: string | null; busy: boolean; generation: number } | null = null
let buildGeneration = 0
export function openBuildStationDialog(systemId: string): void {
  buildDialog = { systemId, name: '', inventory: null, status: null, busy: false, generation: ++buildGeneration }
  const d = buildDialog
  api.getShipDashboard()
    .then(dash => { d.inventory = dash.inventory || [] })
    .catch(() => { d.inventory = []; d.status = "Couldn't read the hold. Close this and try again." })
}
function closeBuildStationDialog(): void { buildDialog = null }

// Send a distress call (the Ship Overview's SEND DISTRESS CALL): an optional message, quick lines, then SEND CALL
let distressDialog: { message: string; status: string | null; busy: boolean; generation: number } | null = null
let distressGeneration = 0
export function openDistressDialog(): void { distressDialog = { message: '', status: null, busy: false, generation: ++distressGeneration } }
function closeDistressDialog(): void { distressDialog = null }
async function submitDistress(): Promise<void> {
  const d = distressDialog
  if (!d || d.busy) return
  d.busy = true; d.status = 'Transmitting…'
  try {
    await sendDistress(distressMessage(d.message))
    if (distressDialog === d) distressDialog = null
    showNotification('Distress beacon transmitting, Captain. Every ship in the galaxy can hear us.', Color4.create(1, 0.35, 0.8, 1), 8)
    void refreshStation('ship')
  } catch (err: any) {
    d.busy = false; d.status = err?.message || 'The distress beacon failed to transmit'
  }
}

async function submitBuild(): Promise<void> {
  const d = buildDialog
  if (!d || d.busy || !d.inventory) return
  const check = canBegin(costRows(constructionCosts(), d.inventory), d.name)
  if (!check.ok) { d.status = check.reason; return }
  d.busy = true; d.status = 'Laying down the first girders…'
  try {
    await beginConstruction(d.systemId, d.name)
    if (buildDialog === d) buildDialog = null
    showNotification(`Construction has begun, Captain. ${d.name.trim()} will be ready in 24 hours.`, Color4.create(0.35, 1, 0.55, 1), 8)
  } catch (err: any) {
    d.busy = false; d.status = err?.message || 'Construction failed'
  }
}

async function loadRefineryInventory(): Promise<void> {
  try {
    const dashboard = await api.getShipDashboard()
    const inv = dashboard.inventory || []
    refineryInventory = { helium_3: 0, plasma_crystals: 0, fuel_cells: dashboard.ship?.fuel_cells ?? 0 }
    for (const item of inv) {
      if (item.resource_type === 'helium_3') refineryInventory.helium_3 = item.quantity
      if (item.resource_type === 'plasma_crystals') refineryInventory.plasma_crystals = item.quantity
    }
  } catch {}
}

async function handleRefine(resourceType: string): Promise<void> {
  refineryStatus = 'Refining...'
  try {
    const result = await api.refineFuel(resourceType, 1)
    refineryStatus = `+${result.fuelGained.toFixed(0)} fuel!`
    await loadRefineryInventory()
    api.invalidateFuelCosts()
    refreshStation('ship')
  } catch (err: any) { refineryStatus = err.message || 'Refine failed' }
}

let purchasing = false
async function handleManaPurchase(tierId: string, manaAmount: number): Promise<void> {
  if (purchasing) return
  purchasing = true
  purchaseStatus = `Confirm sending ${manaAmount} MANA (Polygon) in your wallet…`
  try {
    const txHash = await payMana(manaAmount)
    purchaseStatus = 'Payment sent. Waiting for Polygon to confirm…'
    const result = await redeemManaPurchase(tierId, txHash, attempt => { purchaseStatus = `Waiting for Polygon to confirm… (${attempt * 3}s)` })
    purchaseStatus = `Purchased! Total cells: ${result.fuelCells}`
    api.invalidateFuelCosts()
    refreshStation('ship')
  } catch (err: any) { purchaseStatus = paymentErrorMessage(err, 'Purchase failed') }
  finally { purchasing = false }
}

export function updateNotification(dt: number): void {
  if (notification) { notification.timer -= dt; if (notification.timer <= 0) notification = null }
  if (stemMessage) { stemMessage.age += dt; if (stemMessage.age >= stemMessage.until) stemMessage = null }
}

// STEM speaking up unprompted (the black hole warnings): a terminal readout, typed out, under STEM's own header
let stemMessage: { text: string; lines: number; age: number; until: number } | null = null
const STEM_TYPE_RATE = 70   // characters per second
// STEM wraps its own lines, like a terminal: set once for the whole message, with a column kept free at the end of
// every line for the cursor, so neither the typing nor the blinking cursor can move a word. Monospace 18px is ~11px a
// character in the ~680px text area (~62 columns); 52 leaves room for the estimate to be off.
const STEM_COLUMNS = 52
export function wrapColumns(text: string, columns: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > columns) { lines.push(line); line = word }
    else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines
}
/** A message from STEM, typed out in its terminal banner; it stays `seconds` after it finishes typing. */
export function showStemMessage(text: string, seconds: number = 8): void {
  const lines = wrapColumns(`> ${text}`, STEM_COLUMNS - 1)   // - 1: the cursor's column
  const wrapped = lines.join('\n')
  stemMessage = { text: wrapped, lines: lines.length, age: 0, until: wrapped.length / STEM_TYPE_RATE + seconds }
}
export function showNotification(text: string, color: Color4, duration: number = 5): void {
  notification = { text, color, timer: duration }
}
export function setDiscoveryDescription(text: string | null): void { discoveryDescription = text }

async function deployPod(body: BodyInfo): Promise<void> {
  if (deploying) return
  deploying = true
  deployStatus = 'Deploying...'
  try {
    if (body.type === 'belt') await api.deployMiningPod(body.id)
    else if (body.type === 'moon') await api.deployExplorationPodToMoon(body.id)
    else await api.deployExplorationPod(body.id)
    showNotification(body.type === 'belt' ? 'Mining pod deployed!' : 'Exploration pod deployed!', Color4.create(0, 1, 0.5, 1))
    emitTourEvent(body.type === 'belt' ? 'mining_deployed' : 'exploration_deployed')
    api.invalidateFuelCosts()
    refreshStation('ship')
  } catch (err: any) {
    showNotification(deployErrorMessage(err), Color4.create(1, 0.3, 0.3, 1))
  } finally {
    // Re-enable right away: the server allows several pods on one body as long as an idle pod is available.
    deploying = false
    deployStatus = null
  }
}

/** "API error 400: {"error":"No idle mining pods"}" → "No idle mining pods" */
function deployErrorMessage(err: any): string {
  const msg = String(err?.message ?? '')
  const m = /^API error \d+: (.*)$/s.exec(msg)
  if (m) { try { return JSON.parse(m[1]).error ?? 'Deploy failed' } catch { return 'Deploy failed' } }
  return msg || 'Deploy failed'
}

/** Opens the star panel right away; `loading` shows the route indicator until setSelectedSystemFuel arrives. */
export function setSelectedSystemUI(system: StarSystem | null, fuel: FuelCostResponse | null, loading: boolean = false): void {
  selectedSystem = system; fuelInfo = fuel; fuelLoading = loading; fuelFailed = false; showTravelConfirm = false; deployStatus = null
  if (system) loadScan(system.id)
  resetBlackHoleArm()
  void loadBlackHoleLink(system)
}
/** Fills in route data for the star that is still selected; late answers for a star the player moved on from are dropped. */
export function setSelectedSystemFuel(systemId: string, fuel: FuelCostResponse | null): void {
  if (selectedSystem?.id !== systemId) return
  fuelLoading = false
  if (fuel) { fuelInfo = fuel; fuelFailed = false } else if (!fuelInfo) fuelFailed = true
}
export function setTravelingStatus(systemName: string | null): void { travelingTo = systemName }
export function setStatusMessage(msg: string | null): void { statusMessage = msg }
export function setTravelConfirmCallback(callback: () => void | Promise<void>): void { onTravelConfirm = callback }

function confirmTravel(): void {
  if (travelStarting || !onTravelConfirm) return
  travelStarting = true
  Promise.resolve(onTravelConfirm()).catch(() => { /* the callback reports its own errors */ }).finally(() => { travelStarting = false })
}
export function setViewSystemCallback(callback: (systemId: string) => void): void { onViewSystem = callback }

// Long-range scans for the star panel, fetched when a star is selected and kept for a minute
const scans = new Map<string, { at: number; value: api.SystemScan | null }>()
function loadScan(systemId: string): void {
  const hit = scans.get(systemId)
  if (hit && Date.now() - hit.at < 60_000) return
  scans.set(systemId, { at: Date.now(), value: hit?.value ?? null })
  api.getSystemScan(systemId).then(v => { scans.set(systemId, { at: Date.now(), value: v }) }).catch(() => { /* the line just stays empty */ })
}
const NOUNS: Record<'planets' | 'moons' | 'belts', [string, string]> = { planets: ['PLANET', 'PLANETS'], moons: ['MOON', 'MOONS'], belts: ['BELT', 'BELTS'] }
function reading(r: api.ScanReading, kind: 'planets' | 'moons' | 'belts'): string {
  if (!r) return ''
  const [one, many] = NOUNS[kind]
  if ('exact' in r) return `${r.exact} ${r.exact === 1 ? one : many}`
  if ('min' in r) return `${r.min}–${r.max} ${many}`
  return `${r.word.toUpperCase()} ${many}`
}
/** [heading, body] for the star panel, or null while the scan hasn't arrived. */
function scanLines(systemId: string): [string, string] | null {
  const s = scans.get(systemId)?.value
  if (!s) return null
  if (!s.visited && s.tier === 0) return ['LONG-RANGE SCAN', 'INSTALL A DISCOVERY ARRAY TO SCAN UNVISITED STARS']
  const heading = s.visited ? 'SURVEYED' : s.tier >= 3 ? 'LONG-RANGE SCAN · T3 · 100% CONFIDENCE' : `LONG-RANGE SCAN · T${s.tier}`
  return [heading, [reading(s.planets, 'planets'), reading(s.moons, 'moons'), reading(s.belts, 'belts')].join('  ·  ')]
}
export function setCurrentSystemId(id: string | null): void { currentSystemId = id }

// Star panel: JUMP THROUGH WORMHOLE on the wormhole's target, RETURN THROUGH WORMHOLE on it once there
function wormholeButton(systemId: string) {
  const offer = eventWormholeOffer(systemId, systemId === currentSystemId)
  if (!offer) return null
  const busy = isWormholeBusy()
  return (
    <UiEntity uiTransform={{ width: '100%', height: px(50), margin: { top: px(14) }, justifyContent: 'center', alignItems: 'center' }}
      uiBackground={{ color: busy ? Color4.create(0.15, 0.15, 0.2, 1) : Color4.create(0.45, 0.2, 0.7, 1) }}
      uiText={{ value: busy ? 'JUMPING…' : offer === 'return' ? 'RETURN THROUGH WORMHOLE' : 'JUMP THROUGH WORMHOLE', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
      onMouseDown={() => useEventWormhole(offer)} />
  )
}

// The black hole the ship is at, if its wormhole is linked: jump to the other one. Asks once first (STEM), since
// there's no solar recharge on the far side.
function blackHoleButton(systemId: string) {
  if (systemId !== currentSystemId) return null
  const link = blackHoleLink(systemId)
  if (!link) return null
  const busy = isWormholeBusy()
  const armed = isBlackHoleJumpArmed()
  const label = busy ? 'JUMPING…' : armed ? `CONFIRM JUMP TO ${link.targetName.toUpperCase()}` : `JUMP THROUGH WORMHOLE → ${link.targetName.toUpperCase()}`
  return (
    <UiEntity uiTransform={{ width: '100%', height: px(50), margin: { top: px(14) }, justifyContent: 'center', alignItems: 'center' }}
      uiBackground={{ color: busy ? Color4.create(0.15, 0.15, 0.2, 1) : armed ? Color4.create(0.75, 0.35, 0.95, 1) : Color4.create(0.45, 0.2, 0.7, 1) }}
      uiText={{ value: label, fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
      onMouseDown={() => pressBlackHoleJump(link, fuelInfo ? fuelInfo.current_fuel : null, text => showStemMessage(text))} />
  )
}

// Star panel: other captains' distress calls from this star. Respond from afar; once here, send fuel or tow them to
// the nearest station (asks once first: a tow costs twice the trip).
const TOW_ARM_MS = 8000
let towArmed: { callId: string; at: number } | null = null
let distressBusy = false
async function distressAction(work: () => Promise<string>): Promise<void> {
  if (distressBusy) return
  distressBusy = true
  try { showNotification(await work(), Color4.create(0.35, 1, 0.55, 1), 8) }
  catch (err: any) { showNotification(err?.message || 'That failed, Captain.', Color4.create(1, 0.4, 0.4, 1)) }
  finally { distressBusy = false }
}
function distressButton(key: string, label: string, enabled: boolean, onPress: () => void, width?: number) {
  return (
    <UiEntity key={key} uiTransform={{ width: width !== undefined ? px(width) : '100%', height: px(44), margin: { top: px(8), right: px(6) }, justifyContent: 'center', alignItems: 'center' }}
      uiBackground={{ color: enabled ? Color4.create(0.55, 0.08, 0.16, 1) : Color4.create(0.15, 0.15, 0.15, 1) }}
      uiText={{ value: label, fontSize: px(17), color: enabled ? Color4.White() : Color4.create(0.45, 0.45, 0.45, 1), textAlign: 'middle-center' }}
      onMouseDown={() => { if (enabled) onPress() }} />
  )
}
function distressSection(systemId: string) {
  const list = callsAt(systemId)
  if (!list.length) return null
  const { systems, hereId, ship } = distressPlace()
  const RED = Color4.create(1, 0.35, 0.4, 1)
  return (
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: px(14) } }}>
      {list.map(c => {
        const help = helpFor(c, currentSystemId, isCurrentlyTraveling())
        const replies = c.acceptorCount === 0 ? 'no replies yet' : `${c.acceptorCount} responding`
        let actions: any = null
        if (help === 'respond') {
          actions = distressButton(`respond-${c.id}`, 'RESPOND TO DISTRESS CALL', !distressBusy, () => void distressAction(async () => {
            await respondTo(c.id)
            return `On our way to ${c.username}, Captain. TRAVEL to ${c.systemName} to help.`
          }))
        } else if (help === 'responding') {
          actions = <UiEntity uiTransform={{ width: '100%', height: px(26), margin: { top: px(6) } }} uiText={{ value: `You're responding. TRAVEL to ${c.systemName} to help.`, fontSize: px(16), color: RED, textAlign: 'middle-center' }} />
        } else if (help === 'help') {
          const amounts = fuelChoices(ship?.fuel ?? 0)
          const dest = hereId ? nearestStation(hereId, systems) : null
          const cost = dest && hereId ? towCost(hereId, dest.id, systems) : 0
          const minutes = dest && hereId ? towMinutes(hereId, dest.id, systems) : 0
          const canTow = !!dest && (ship?.fuel ?? 0) >= cost && !distressBusy
          const armed = towArmed?.callId === c.id && Date.now() - towArmed.at <= TOW_ARM_MS
          actions = (
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'column' }}>
              <UiEntity uiTransform={{ width: '100%', flexDirection: 'row' }}>
                {amounts.length
                  ? amounts.map(n => distressButton(`fuel-${c.id}-${n}`, `SEND ${n} FUEL`, !distressBusy, () => void distressAction(async () => {
                      const sent = await sendFuelTo(c.id, n)
                      return `Transferred ${Math.round(sent)} fuel to ${c.username}, Captain. They can move again.`
                    }), 180))
                  : <UiEntity uiTransform={{ width: '100%', height: px(26), margin: { top: px(6) } }} uiText={{ value: 'Not enough fuel to share', fontSize: px(16), color: Color4.create(0.5, 0.5, 0.5, 1), textAlign: 'middle-center' }} />}
              </UiEntity>
              {dest ? distressButton(`tow-${c.id}`, armed ? `CONFIRM TOW TO ${dest.name.toUpperCase()} (−${cost} FUEL, ${durationText(minutes)})` : `TOW TO ${dest.name.toUpperCase()} · −${cost} FUEL · ${durationText(minutes)}`, canTow, () => {
                if (!armed) { towArmed = { callId: c.id, at: Date.now() }; return }
                towArmed = null
                void distressAction(async () => {
                  await towToSafety(c.id, dest.id)
                  return `Tow lines secured, Captain. We'll haul ${c.username} to ${dest.name}: about ${durationText(minutes)}.`
                })
              }) : null}
            </UiEntity>
          )
        }
        return (
          <UiEntity key={c.id} uiTransform={{ width: '100%', flexDirection: 'column', padding: { top: px(10), bottom: px(10), left: px(12), right: px(12) }, margin: { bottom: px(8) } }} uiBackground={{ color: Color4.create(0.2, 0.03, 0.06, 0.85) }}>
            <UiEntity uiTransform={{ width: '100%', height: px(26) }} uiText={{ value: `DISTRESS · ${c.username} is stranded here`, fontSize: px(19), color: RED, textAlign: 'middle-left' }} />
            <UiEntity uiTransform={{ width: '100%', height: px(22) }} uiText={{ value: c.message ? `"${c.message}" · ${replies}` : replies, fontSize: px(15), color: Color4.create(0.75, 0.6, 0.62, 1), textAlign: 'middle-left' }} />
            {actions}
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

const SystemInfoPanel = () => {
  if (!selectedSystem) return null
  const canAfford = fuelInfo ? fuelInfo.current_fuel >= fuelInfo.fuel_cost : false
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { bottom: px(40) }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: px(620), flexDirection: 'column', padding: { top: px(24), bottom: px(24), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.92) }}>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { bottom: px(8) } }}>
          <UiEntity uiTransform={{ height: px(44), flex: 1 }} uiText={{ value: selectedSystem.name, fontSize: px(36), color: Color4.create(0, 1, 1, 1), textAlign: 'middle-center' }} />
          <UiEntity
            uiTransform={{ width: px(36), height: px(36), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.3, 0.1, 0.1, 1) }}
            uiText={{ value: 'X', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { selectSystem(null) }}
          />
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: px(28), margin: { bottom: px(6) } }} uiText={{ value: (selectedSystem.star_type || 'unknown').replace(/_/g, ' ').toUpperCase(), fontSize: px(20), color: Color4.create(0.6, 0.6, 0.6, 1), textAlign: 'middle-center' }} />
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { bottom: px(8) } }}>
          {selectedSystem.has_station ? <UiEntity uiTransform={{ height: px(24), margin: { right: px(16) } }} uiText={{ value: 'STATION', fontSize: px(18), color: Color4.create(0, 1, 1, 1) }} /> : null}
          {wormholeOpen(selectedSystem) ? <UiEntity uiTransform={{ height: px(24) }} uiText={{ value: 'WORMHOLE', fontSize: px(18), color: Color4.create(0.6, 0.2, 1, 1) }} /> : null}
        </UiEntity>
        {progressLabel(selectedSystem.id) ? <UiEntity uiTransform={{ width: '100%', height: px(24), margin: { bottom: px(8) } }} uiText={{ value: progressLabel(selectedSystem.id)!, fontSize: px(18), color: systemProgress(selectedSystem.id)?.explored ? Color4.create(0.35, 1, 0.55, 1) : Color4.create(0.3, 0.8, 0.45, 1), textAlign: 'middle-center' }} /> : null}
        {scanLines(selectedSystem.id) ? (
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { bottom: px(8) } }}>
            <UiEntity uiTransform={{ width: '100%', height: px(20) }} uiText={{ value: scanLines(selectedSystem.id)![0], fontSize: px(14), color: Color4.create(0.45, 0.65, 0.75, 1), textAlign: 'middle-center' }} />
            <UiEntity uiTransform={{ width: '100%', height: px(24) }} uiText={{ value: scanLines(selectedSystem.id)![1], fontSize: px(17), color: Color4.White(), textAlign: 'middle-center' }} />
          </UiEntity>
        ) : null}
        {selectedSystem.discovered_by_name ? <UiEntity uiTransform={{ width: '100%', height: px(24), margin: { bottom: px(8) } }} uiText={{ value: `Discovered by ${selectedSystem.discovered_by_name}`, fontSize: px(18), color: Color4.create(0.5, 0.5, 0.5, 1), textAlign: 'middle-center' }} /> : null}
        {fuelInfo ? (
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: px(8) } }}>
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { bottom: px(4) } }}>
              <UiEntity uiTransform={{ height: px(28), margin: { right: px(24) } }} uiText={{ value: `Distance: ${fuelInfo.distance.toFixed(1)}`, fontSize: px(20), color: Color4.create(0.8, 0.8, 0.8, 1) }} />
              <UiEntity uiTransform={{ height: px(28) }} uiText={{ value: `Fuel cost: ${fuelInfo.fuel_cost.toFixed(1)}`, fontSize: px(20), color: canAfford ? Color4.create(0, 1, 0.5, 1) : Color4.create(1, 0.3, 0.3, 1) }} />
            </UiEntity>
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { bottom: px(4) } }}>
              <UiEntity uiTransform={{ height: px(24), margin: { right: px(24) } }} uiText={{ value: `Your fuel: ${fuelInfo.current_fuel.toFixed(1)}`, fontSize: px(18), color: Color4.create(0.6, 0.6, 0.6, 1) }} />
              <UiEntity uiTransform={{ height: px(24) }} uiText={{ value: `Travel time: ${fuelInfo.travel_minutes >= 60 ? `${Math.floor(fuelInfo.travel_minutes / 60)}h ${fuelInfo.travel_minutes % 60}m` : `${fuelInfo.travel_minutes}m`}`, fontSize: px(18), color: Color4.create(0.6, 0.6, 0.6, 1) }} />
            </UiEntity>
            {!canAfford ? <UiEntity uiTransform={{ width: '100%', height: px(22) }} uiText={{ value: 'Not enough fuel', fontSize: px(16), color: Color4.create(1, 0.3, 0.3, 0.8), textAlign: 'middle-center' }} /> : null}
          </UiEntity>
        ) : selectedSystem.id !== currentSystemId && (fuelLoading || fuelFailed) ? (
          <UiEntity uiTransform={{ width: '100%', height: px(28), margin: { top: px(8) } }}
            uiText={{ value: fuelLoading ? `Plotting course${'.'.repeat(1 + Math.floor(Date.now() / 400) % 3)}` : 'Route data unavailable', fontSize: px(20), color: Color4.create(0.45, 0.65, 0.75, 1), textAlign: 'middle-center' }} />
        ) : null}
        {selectedSystem.id === currentSystemId || systemProgress(selectedSystem.id)?.visited ? <UiEntity uiTransform={{ width: '100%', height: px(50), margin: { top: px(14) }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.1, 0.3, 0.5, 1) }} uiText={{ value: selectedSystem.id === currentSystemId ? 'VIEW SYSTEM' : 'VIEW SURVEY', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { if (onViewSystem && selectedSystem) onViewSystem(selectedSystem.id) }} /> : null}
        {wormholeButton(selectedSystem.id)}
        {blackHoleButton(selectedSystem.id)}
        {distressSection(selectedSystem.id)}
        {selectedSystem.id !== currentSystemId && fuelInfo && !showTravelConfirm ? (() => {
          const traveling = isCurrentlyTraveling()
          const canTravel = canAfford && !traveling
          const label = traveling ? 'IN TRANSIT' : (canAfford ? 'TRAVEL' : 'INSUFFICIENT FUEL')
          return <UiEntity uiTransform={{ width: '100%', height: px(50), margin: { top: px(14) }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: canTravel ? Color4.create(0, 0.4, 0.5, 1) : Color4.create(0.15, 0.15, 0.15, 1) }} uiText={{ value: label, fontSize: px(20), color: canTravel ? Color4.White() : Color4.create(0.4, 0.4, 0.4, 1), textAlign: 'middle-center' }} onMouseDown={() => { if (canTravel) showTravelConfirm = true }} />
        })() : null}
        {showTravelConfirm ? (
          <UiEntity uiTransform={{ margin: { top: px(14) }, flexDirection: 'column', alignItems: 'center' }}>
            <UiEntity uiTransform={{ width: '100%', height: px(28), margin: { bottom: px(10) } }} uiText={{ value: `Travel to ${selectedSystem.name}? (${fuelInfo!.fuel_cost.toFixed(1)} fuel)`, fontSize: px(20), color: Color4.create(1, 1, 0, 1), textAlign: 'middle-center' }} />
            <UiEntity uiTransform={{ flexDirection: 'row' }}>
              <UiEntity uiTransform={{ width: px(160), height: px(46), margin: { right: px(12) }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: travelStarting ? Color4.create(0.15, 0.15, 0.15, 1) : Color4.create(0, 0.6, 0.3, 1) }} uiText={{ value: travelStarting ? `ENGAGING${'.'.repeat(1 + Math.floor(Date.now() / 400) % 3)}` : 'CONFIRM', fontSize: px(20), color: travelStarting ? Color4.create(0.7, 0.7, 0.7, 1) : Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { confirmTravel() }} />
              <UiEntity uiTransform={{ width: px(160), height: px(46), justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: travelStarting ? Color4.create(0.15, 0.15, 0.15, 1) : Color4.create(0.4, 0.1, 0.1, 1) }} uiText={{ value: 'CANCEL', fontSize: px(20), color: travelStarting ? Color4.create(0.4, 0.4, 0.4, 1) : Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { if (!travelStarting) showTravelConfirm = false }} />
            </UiEntity>
          </UiEntity>
        ) : null}
      </UiEntity>
    </UiEntity>
  )
}

const BodyDetailPanel = () => {
  const body = getSelectedBody() || selectedFlora
  if (!body) { lastSelectedBodyId = null; return null }   // closing the panel forgets the body, so reopening starts fresh
  if (body.id !== lastSelectedBodyId) { lastSelectedBodyId = body.id; if (!deploying) deployStatus = null }
  const typeColors: Record<string, Color4> = { planet: Color4.create(0.2, 0.8, 0.4, 1), moon: Color4.create(0.7, 0.7, 0.6, 1), belt: Color4.create(0.9, 0.7, 0.3, 1), flora: Color4.create(0.9, 0.4, 0.7, 1) }
  const titleColor = typeColors[body.type] || Color4.create(0, 1, 1, 1)
  const detailEntries = Object.entries(body.details) as [string, string][]
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: px(30), right: px(30) }, flexDirection: 'column', width: px(480) }}>
      {body.imageUrl ? (
        <UiEntity uiTransform={{ width: px(480), height: px(480), margin: { bottom: px(6) }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.7) }}>
          <UiEntity uiTransform={{ width: px(440), height: px(440) }} uiBackground={{ texture: { src: body.imageUrl }, textureMode: 'stretch', color: Color4.create(1, 1, 1, 1) }} />
        </UiEntity>
      ) : null}
      <UiEntity uiTransform={{ width: px(480), flexDirection: 'column', padding: { top: px(20), bottom: px(20), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.92) }}>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: px(2) } }}>
          <UiEntity uiTransform={{ height: px(46), flex: 1 }} uiText={{ value: body.name, fontSize: px(36), color: titleColor, textAlign: 'middle-left', textWrap: 'nowrap' }} />
          <UiEntity
            uiTransform={{ width: px(36), height: px(36), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.3, 0.1, 0.1, 1) }}
            uiText={{ value: 'X', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { selectedFlora = null; if (onCloseDetailPanel) onCloseDetailPanel() }}
          />
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: px(26), margin: { bottom: px(16) } }} uiText={{ value: body.type.toUpperCase(), fontSize: px(18), color: Color4.create(0.45, 0.45, 0.45, 1), textAlign: 'middle-left' }} />
        {detailEntries.map(([key, val]) => (
          <UiEntity key={key} uiTransform={{ width: '100%', flexDirection: 'row', margin: { bottom: px(8) } }}>
            <UiEntity uiTransform={{ width: px(160), height: px(30) }} uiText={{ value: key, fontSize: px(22), color: Color4.create(0.5, 0.5, 0.5, 1), textAlign: 'middle-left' }} />
            <UiEntity uiTransform={{ height: px(30) }} uiText={{ value: val.charAt(0).toUpperCase() + val.slice(1), fontSize: px(22), color: Color4.create(0.9, 0.9, 0.9, 1), textAlign: 'middle-left' }} />
          </UiEntity>
        ))}
        {body.canDeploy ? <UiEntity uiTransform={{ width: '100%', height: px(50), margin: { top: px(14) }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: deploying ? Color4.create(0.15, 0.15, 0.15, 1) : Color4.create(0, 0.4, 0.5, 1) }} uiText={{ value: deploying ? (deployStatus ?? 'Deploying...') : (body.type === 'belt' ? 'DEPLOY MINING POD' : 'DEPLOY EXPLORATION POD'), fontSize: px(20), color: deploying ? Color4.create(0.7, 0.7, 0.7, 1) : Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { if (!deploying) void deployPod(body) }} /> : null}
      </UiEntity>
    </UiEntity>
  )
}

const TravelStatusPanel = () => {
  if (!travelingTo) return null
  const { progress, remainingDistance } = getTravelProgress()
  const pct = Math.floor(progress * 100)
  const secs = Math.ceil(getTravelRemainingMs() / 1000)
  const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), sec = secs % 60
  const two = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  const eta = secs <= 0 ? 'ARRIVING' : `ARRIVES IN  ${h > 0 ? `${h}:${two(m)}` : m}:${two(sec)}`
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: px(20) }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: px(500), flexDirection: 'column', padding: { top: px(20), bottom: px(20), left: px(20), right: px(20) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.92) }}>
        <UiEntity uiTransform={{ width: '100%', height: px(32), margin: { bottom: px(8) } }} uiText={{ value: `Traveling to ${travelingTo}`, fontSize: px(24), color: Color4.create(0, 1, 0.5, 1), textAlign: 'middle-center' }} />
        <UiEntity uiTransform={{ width: '100%', height: px(30), margin: { bottom: px(4) } }} uiText={{ value: eta, fontSize: px(22), color: Color4.create(0, 0.9, 1, 1), textAlign: 'middle-center' }} />
        <UiEntity uiTransform={{ width: '100%', height: px(24), margin: { bottom: px(8) } }} uiText={{ value: `${pct}% — ${remainingDistance.toFixed(1)} units remaining`, fontSize: px(18), color: Color4.create(0.7, 0.7, 0.7, 1), textAlign: 'middle-center' }} />
        <UiEntity uiTransform={{ width: '100%', height: px(8) }} uiBackground={{ color: Color4.create(0.15, 0.15, 0.15, 1) }}>
          <UiEntity uiTransform={{ width: `${pct}%`, height: '100%' }} uiBackground={{ color: Color4.create(0, 1, 0.5, 0.8) }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// While surveying a visited system: which one is on the hologram, and a one-click way back.
const SurveyBar = () => {
  if (!isViewingRemoteSystem()) return null
  const own = ownSystemTitle()
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: px(20) }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', padding: px(8) }} uiBackground={{ color: Color4.create(0.02, 0.05, 0.12, 0.92) }}>
        <Label value={`SURVEYING  ${viewedSystemName().toUpperCase()}`} fontSize={px(16)} color={Color4.create(0.35, 1, 0.55, 1)} uiTransform={{ margin: { left: px(10), right: px(16) } }} />
        <UiEntity uiTransform={{ height: px(32), padding: { left: px(14), right: px(14) }, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0, 0.9, 1, 1) }} onMouseDown={() => { returnFromSurvey() }}>
          <Label value={own ? `BACK TO ${own.toUpperCase()}` : 'BACK TO YOUR SYSTEM'} fontSize={px(13)} color={Color4.create(0.02, 0.05, 0.1, 1)} />
        </UiEntity>
        <UiEntity uiTransform={{ height: px(32), padding: { left: px(14), right: px(14) }, margin: { left: px(8) }, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.05, 0.12, 0.2, 1) }} onMouseDown={() => { switchViewMode('galaxy') }}>
          <Label value="BACK TO GALAXY" fontSize={px(13)} color={Color4.create(0, 0.9, 1, 1)} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// The explorer sometimes draws digits from its emoji font (boxed "keycap" numbers), seemingly once its glyph
// texture has filled during a long session. Drawing every digit invisibly from the start gets them into the
// texture early; the countdowns, fuel and timers then have them.
const DigitWarmup = () => (
  <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: 0, left: 0 }, width: px(300), height: px(20) }}>
    <Label value="0123456789:%.–/" fontSize={px(14)} color={Color4.create(0, 0, 0, 0)} />
  </UiEntity>
)

// The banner's text wraps; the box grows by whole lines (estimated: ~55 characters of 22px text per 652px line)
const BANNER_CHARS_PER_LINE = 55
const BANNER_LINE_HEIGHT = 30
// STEM's banner: its lines are wrapped in showStemMessage
const STEM_LINE_HEIGHT = 26
const STEM_CYAN = Color4.create(0.3, 0.95, 1, 1)
const STEM_DIM = Color4.create(0.3, 0.95, 1, 0.55)
const StemBanner = () => {
  if (!stemMessage) return null
  const typed = Math.min(stemMessage.text.length, Math.floor(stemMessage.age * STEM_TYPE_RATE))
  // Blinking cursor: the lines are already fixed (showStemMessage), so it can't move a word
  const cursor = Math.floor(stemMessage.age * 2.5) % 2 === 0 ? '|' : '\u00A0'
  const lines = stemMessage.lines
  // Below the ordinary banner when both are up
  const top = notification ? 60 + 32 + BANNER_LINE_HEIGHT * Math.max(1, Math.ceil(notification.text.length / BANNER_CHARS_PER_LINE)) + 10 : 60
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: px(top) }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: px(720), flexDirection: 'row' }} uiBackground={{ color: Color4.create(0.01, 0.03, 0.025, 0.96) }}>
        <UiEntity uiTransform={{ width: px(4), height: '100%' }} uiBackground={{ color: STEM_CYAN }} />
        <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column', padding: { top: px(10), bottom: px(14), left: px(18), right: px(18) } }}>
          <UiEntity uiTransform={{ width: '100%', height: px(18), margin: { bottom: px(6) } }}
            uiText={{ value: 'STEM  //  SHIP TELEMETRY AND EXPLORATION MODULE', fontSize: px(12), color: STEM_DIM, textAlign: 'middle-left', font: 'monospace' }} />
          <UiEntity uiTransform={{ width: '100%', height: px(STEM_LINE_HEIGHT * lines) }}
            uiText={{ value: `${stemMessage.text.slice(0, typed)}${cursor}`, fontSize: px(18), color: STEM_CYAN, textAlign: 'top-left', textWrap: 'nowrap', font: 'monospace' }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

const NotificationBanner = () => {
  if (!notification) return null
  const lines = Math.max(1, Math.ceil(notification.text.length / BANNER_CHARS_PER_LINE))
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: px(60) }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: px(700), padding: { top: px(16), bottom: px(16), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', height: px(BANNER_LINE_HEIGHT * lines) }} uiText={{ value: notification.text, fontSize: px(22), color: notification.color, textAlign: 'middle-center', textWrap: 'wrap' }} />
      </UiEntity>
    </UiEntity>
  )
}

const DiscoveryDescriptionBar = () => {
  if (!discoveryDescription) return null
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { bottom: px(20) }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: px(700), padding: { top: px(12), bottom: px(12), left: px(20), right: px(20) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.9) }}>
        <UiEntity uiTransform={{ width: '100%', height: px(26) }} uiText={{ value: discoveryDescription, fontSize: px(20), color: Color4.create(0.7, 0.7, 0.7, 1), textAlign: 'middle-center' }} />
      </UiEntity>
    </UiEntity>
  )
}

const StatusBar = () => {
  if (!statusMessage) return null
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: px(20) }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: px(500), padding: { top: px(10), bottom: px(10), left: px(10), right: px(10) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.8) }}>
        <UiEntity uiTransform={{ width: '100%', height: px(22) }} uiText={{ value: statusMessage, fontSize: px(16), color: Color4.create(0.8, 0.8, 0.8, 1), textAlign: 'middle-center' }} />
      </UiEntity>
    </UiEntity>
  )
}

const RecallDialog = () => {
  const d = recallDialog
  if (!d) return null
  const p = d.preview
  const lines: string[] = d.error ? [d.error]
    : !p ? ['Contacting the pod…']
    : !p.allowed ? [p.reason ?? 'Recall not possible']
    : [
      `Recall: back in ${fmtMinutes(p.recallMinutes)} · ${p.share > 0 ? `~${Math.round(p.share * 100)}% of the haul` : 'returns empty'} · ${Math.round(p.lossChance * 100)}% loss risk`,
      `Or wait: back in ${fmtMinutes(p.waitMinutes)} with the full result`,
    ]
  const canConfirm = !!p && p.allowed && !d.error && !d.working
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(640), flexDirection: 'column', padding: { top: px(20), bottom: px(20), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', height: px(36), margin: { bottom: px(12) } }} uiText={{ value: `RECALL ${d.label.toUpperCase()} POD?`, fontSize: px(26), color: Color4.create(0, 1, 1, 1), textAlign: 'middle-center' }} />
        {lines.map((line, i) => (
          <UiEntity key={`rl${i}`} uiTransform={{ width: '100%', height: px(28), margin: { bottom: px(6) } }} uiText={{ value: line, fontSize: px(18), color: i === 0 ? Color4.White() : Color4.create(0.6, 0.7, 0.8, 1), textAlign: 'middle-center' }} />
        ))}
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: px(12) } }}>
          <UiEntity uiTransform={{ width: px(200), height: px(44), margin: { right: px(12) }, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: canConfirm ? Color4.create(0.6, 0.1, 0.5, 1) : Color4.create(0.15, 0.15, 0.15, 1) }}
            uiText={{ value: d.working ? 'SENDING…' : 'RECALL', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { if (canConfirm) void confirmRecall() }} />
          <UiEntity uiTransform={{ width: px(200), height: px(44), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0, 0.4, 0.5, 1) }}
            uiText={{ value: 'KEEP WORKING', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { recallDialog = null }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

const PurchaseDialog = () => {
  if (!showPurchaseDialog) return null
  const tiers = [
    { id: 'mana_single', name: 'Quick Top-Up', cells: 1, mana: 10, image: 'assets/images/QuickTopUp.png' },
    { id: 'mana_triple', name: 'Explorer Pack', cells: 3, mana: 20, image: 'assets/images/ExplorerPack.png' },
    { id: 'mana_bulk', name: 'Deep Space Expedition', cells: 10, mana: 50, image: 'assets/images/DeepSpaceExpedition.png' },
  ]
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(700), flexDirection: 'column', padding: { top: px(24), bottom: px(24), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: px(16) } }}>
          <UiEntity uiTransform={{ height: px(40), flex: 1 }} uiText={{ value: 'PURCHASE FUEL CELLS', fontSize: px(28), color: Color4.create(0, 1, 1, 1), textAlign: 'middle-center' }} />
          <UiEntity
            uiTransform={{ width: px(36), height: px(36), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.3, 0.1, 0.1, 1) }}
            uiText={{ value: 'X', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { closePurchaseDialog() }}
          />
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between' }}>
          {tiers.map(tier => (
            <UiEntity key={tier.id} uiTransform={{ width: px(200), flexDirection: 'column', alignItems: 'center' }}>
              <UiEntity uiTransform={{ width: px(180), height: px(180), margin: { bottom: px(8) } }} uiBackground={{ texture: { src: tier.image }, textureMode: 'stretch', color: Color4.White() }} />
              <UiEntity uiTransform={{ height: px(24), margin: { bottom: px(4) } }} uiText={{ value: tier.name, fontSize: px(18), color: Color4.White(), textAlign: 'middle-center' }} />
              <UiEntity uiTransform={{ height: px(20), margin: { bottom: px(8) } }} uiText={{ value: `${tier.cells} cell${tier.cells > 1 ? 's' : ''} = ${tier.cells * 50} fuel`, fontSize: px(14), color: Color4.create(0.6, 0.6, 0.6, 1), textAlign: 'middle-center' }} />
              <UiEntity
                uiTransform={{ width: px(160), height: px(44), justifyContent: 'center', alignItems: 'center' }}
                uiBackground={{ color: Color4.create(0, 0.4, 0.5, 1) }}
                uiText={{ value: `${tier.mana} MANA`, fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
                onMouseDown={() => { handleManaPurchase(tier.id, tier.mana) }}
              />
            </UiEntity>
          ))}
        </UiEntity>
        {purchaseStatus ? <UiEntity uiTransform={{ width: '100%', height: px(28), margin: { top: px(12) } }} uiText={{ value: purchaseStatus, fontSize: px(18), color: Color4.create(0.8, 0.8, 0.3, 1), textAlign: 'middle-center' }} /> : null}
      </UiEntity>
    </UiEntity>
  )
}

const RefineryDialog = () => {
  if (!showRefineryDialog) return null
  const resources = [
    { type: 'helium_3', name: 'Helium-3', fuel: 20, quantity: refineryInventory.helium_3, color: Color4.create(0.3, 0.8, 1, 1) },
    { type: 'plasma_crystals', name: 'Plasma Crystals', fuel: 50, quantity: refineryInventory.plasma_crystals, color: Color4.create(0.8, 0.3, 1, 1) },
    { type: 'fuel_cell', name: 'Fuel Cells', fuel: 50, quantity: refineryInventory.fuel_cells, color: Color4.create(0, 1, 0.5, 1) },
  ]
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(500), flexDirection: 'column', padding: { top: px(24), bottom: px(24), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: px(16) } }}>
          <UiEntity uiTransform={{ height: px(40), flex: 1 }} uiText={{ value: 'FUEL REFINERY', fontSize: px(28), color: Color4.create(0, 1, 1, 1), textAlign: 'middle-center' }} />
          <UiEntity
            uiTransform={{ width: px(36), height: px(36), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.3, 0.1, 0.1, 1) }}
            uiText={{ value: 'X', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { closeRefineryDialog() }}
          />
        </UiEntity>
        {resources.map(res => (
          <UiEntity key={res.type} uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'center', margin: { bottom: px(12) }, padding: { top: px(10), bottom: px(10), left: px(12), right: px(12) } }} uiBackground={{ color: Color4.create(0.05, 0.08, 0.15, 0.8) }}>
            <UiEntity uiTransform={{ flex: 1, flexDirection: 'column' }}>
              <UiEntity uiTransform={{ height: px(26) }} uiText={{ value: res.name, fontSize: px(22), color: res.color, textAlign: 'middle-left' }} />
              <UiEntity uiTransform={{ height: px(20) }} uiText={{ value: `${res.quantity} available  |  +${res.fuel} fuel each`, fontSize: px(14), color: Color4.create(0.5, 0.5, 0.5, 1), textAlign: 'middle-left' }} />
            </UiEntity>
            <UiEntity
              uiTransform={{ width: px(100), height: px(40), justifyContent: 'center', alignItems: 'center' }}
              uiBackground={{ color: res.quantity > 0 ? Color4.create(0, 0.4, 0.5, 1) : Color4.create(0.15, 0.15, 0.15, 1) }}
              uiText={{ value: 'REFINE', fontSize: px(18), color: res.quantity > 0 ? Color4.White() : Color4.create(0.4, 0.4, 0.4, 1), textAlign: 'middle-center' }}
              onMouseDown={() => { if (res.quantity > 0) handleRefine(res.type) }}
            />
          </UiEntity>
        ))}
        {refineryStatus ? <UiEntity uiTransform={{ width: '100%', height: px(28), margin: { top: px(8) } }} uiText={{ value: refineryStatus, fontSize: px(18), color: Color4.create(0.8, 0.8, 0.3, 1), textAlign: 'middle-center' }} /> : null}
      </UiEntity>
    </UiEntity>
  )
}


const BuildStationDialog = () => {
  const d = buildDialog
  if (!d) return null
  const rows = d.inventory ? costRows(constructionCosts(), d.inventory) : []
  const check = d.inventory ? canBegin(rows, d.name) : { ok: false as const, reason: 'Checking the hold…' }
  const ready = check.ok && !d.busy
  const GREEN_UI = Color4.create(0.35, 1, 0.55, 1), RED_UI = Color4.create(1, 0.4, 0.4, 1), GREY = Color4.create(0.5, 0.5, 0.5, 1)
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(540), flexDirection: 'column', padding: { top: px(24), bottom: px(24), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: px(6) } }}>
          <UiEntity uiTransform={{ height: px(40), flex: 1 }} uiText={{ value: 'BUILD A STATION', fontSize: px(28), color: Color4.create(0, 1, 1, 1), textAlign: 'middle-center' }} />
          <UiEntity uiTransform={{ width: px(36), height: px(36), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.3, 0.1, 0.1, 1) }}
            uiText={{ value: 'X', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { closeBuildStationDialog() }} />
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: px(40), margin: { bottom: px(14) } }}
          uiText={{ value: 'Construction takes 24 hours. The resources are used up as soon as it begins.', fontSize: px(15), color: GREY, textAlign: 'middle-center' }} />
        <Input
          key={`build-name-${d.generation}`}
          uiTransform={{ width: '100%', height: px(44), margin: { bottom: px(14) } }}
          uiBackground={{ color: Color4.create(0.05, 0.12, 0.2, 1) }}
          fontSize={px(18)}
          color={Color4.White()}
          placeholder="Name your station"
          placeholderColor={GREY}
          value={d.name}
          onChange={(v) => { d.name = v; if (!d.busy) d.status = null }}
          onSubmit={(v) => { d.name = v; void submitBuild() }}
        />
        {rows.map(r => (
          <UiEntity key={r.resource} uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'center', margin: { bottom: px(8) }, padding: { top: px(8), bottom: px(8), left: px(12), right: px(12) } }} uiBackground={{ color: Color4.create(0.05, 0.08, 0.15, 0.8) }}>
            <UiEntity uiTransform={{ flex: 1, height: px(24) }} uiText={{ value: r.label, fontSize: px(19), color: Color4.White(), textAlign: 'middle-left' }} />
            <UiEntity uiTransform={{ width: px(180), height: px(24) }} uiText={{ value: `${r.have} / ${r.need}`, fontSize: px(19), color: r.short ? RED_UI : GREEN_UI, textAlign: 'middle-right' }} />
          </UiEntity>
        ))}
        <UiEntity uiTransform={{ width: '100%', height: px(50), margin: { top: px(10) }, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: ready ? Color4.create(0, 0.45, 0.25, 1) : Color4.create(0.15, 0.15, 0.15, 1) }}
          uiText={{ value: d.busy ? 'BEGINNING…' : 'BEGIN CONSTRUCTION', fontSize: px(20), color: ready ? Color4.White() : Color4.create(0.45, 0.45, 0.45, 1), textAlign: 'middle-center' }}
          onMouseDown={() => { void submitBuild() }} />
        {d.status || !check.ok ? <UiEntity uiTransform={{ width: '100%', height: px(28), margin: { top: px(8) } }} uiText={{ value: d.status ?? (check.ok ? '' : check.reason), fontSize: px(16), color: d.status ? Color4.create(0.8, 0.8, 0.3, 1) : GREY, textAlign: 'middle-center' }} /> : null}
      </UiEntity>
    </UiEntity>
  )
}

const DistressDialog = () => {
  const d = distressDialog
  if (!d) return null
  const MAGENTA_UI = Color4.create(1, 0.35, 0.8, 1), GREY = Color4.create(0.5, 0.5, 0.5, 1)
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(540), flexDirection: 'column', padding: { top: px(24), bottom: px(24), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.06, 0.01, 0.05, 0.96) }}>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: px(6) } }}>
          <UiEntity uiTransform={{ height: px(40), flex: 1 }} uiText={{ value: 'SEND A DISTRESS CALL', fontSize: px(28), color: MAGENTA_UI, textAlign: 'middle-center' }} />
          <UiEntity uiTransform={{ width: px(36), height: px(36), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.3, 0.1, 0.1, 1) }}
            uiText={{ value: 'X', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { closeDistressDialog() }} />
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: px(40), margin: { bottom: px(14) } }}
          uiText={{ value: 'Every ship in the galaxy will hear this. You can cancel it any time.', fontSize: px(15), color: GREY, textAlign: 'middle-center' }} />
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', margin: { bottom: px(10) } }}>
          {DISTRESS_PRESETS.map(p => (
            <UiEntity key={p.label} uiTransform={{ flex: 1, height: px(40), margin: { right: px(8) }, justifyContent: 'center', alignItems: 'center' }}
              uiBackground={{ color: Color4.create(0.18, 0.04, 0.14, 1) }}
              uiText={{ value: p.label, fontSize: px(17), color: MAGENTA_UI, textAlign: 'middle-center' }}
              onMouseDown={() => { d.message = p.text; d.generation = ++distressGeneration }} />
          ))}
        </UiEntity>
        <Input
          key={`distress-message-${d.generation}`}
          uiTransform={{ width: '100%', height: px(44), margin: { bottom: px(14) } }}
          uiBackground={{ color: Color4.create(0.12, 0.04, 0.1, 1) }}
          fontSize={px(17)}
          color={Color4.White()}
          placeholder="Add a message (optional)"
          placeholderColor={GREY}
          value={d.message}
          onChange={(v) => { d.message = v }}
          onSubmit={(v) => { d.message = v; void submitDistress() }}
        />
        <UiEntity uiTransform={{ width: '100%', height: px(50), justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: d.busy ? Color4.create(0.15, 0.15, 0.15, 1) : Color4.create(0.55, 0.08, 0.35, 1) }}
          uiText={{ value: d.busy ? 'TRANSMITTING…' : 'SEND CALL', fontSize: px(20), color: d.busy ? Color4.create(0.6, 0.6, 0.6, 1) : Color4.White(), textAlign: 'middle-center' }}
          onMouseDown={() => { void submitDistress() }} />
        {d.status ? <UiEntity uiTransform={{ width: '100%', height: px(28), margin: { top: px(8) } }} uiText={{ value: d.status, fontSize: px(16), color: Color4.create(0.8, 0.8, 0.3, 1), textAlign: 'middle-center' }} /> : null}
      </UiEntity>
    </UiEntity>
  )
}

const CameraSwitch = () => {
  if (isCameraSuspended()) return null   // the ship tour holds the camera
  const current = getCameraMode()
  if (current === 'free') return null   // only shown while a fixed view is active, as the way back
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(20), right: px(30) }, flexDirection: 'row', alignItems: 'center', padding: px(4) }}
      uiBackground={{ color: Color4.create(0.02, 0.05, 0.12, 0.85) }}>
      <Label value="CAMERA" fontSize={px(12)} color={Color4.create(0.45, 0.65, 0.75, 1)} uiTransform={{ margin: { left: px(8), right: px(8) } }} />
      {CAMERA_MODES.map(mode => (
        <UiEntity key={mode} uiTransform={{ width: px(76), height: px(26), margin: { right: px(4) }, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: mode === current ? Color4.create(0, 0.9, 1, 1) : Color4.create(0.05, 0.12, 0.2, 1) }}
          onMouseDown={() => { setCameraMode(mode) }}>
          <Label value={CAMERA_MODE_LABELS[mode]} fontSize={px(12)} color={mode === current ? Color4.create(0.02, 0.05, 0.1, 1) : Color4.create(0, 0.9, 1, 1)} />
        </UiEntity>
      ))}
    </UiEntity>
  )
}

// The Terminal is the Galaxy Gardeners build in Genesis City; the explorer confirms the jump with the player.
const TERMINAL_PARCEL = { x: 35, y: -121 }

const ReturnToTerminal = () => (
  <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(104), left: px(60) }, width: px(190), height: px(30), justifyContent: 'center', alignItems: 'center' }}
    uiBackground={{ color: Color4.create(0.02, 0.05, 0.12, 0.85) }}
    onMouseDown={() => { void teleportTo({ worldCoordinates: TERMINAL_PARCEL }) }}>
    <Label value="RETURN TO TERMINAL" fontSize={px(12)} color={Color4.create(0, 0.9, 1, 1)} />
  </UiEntity>
)

const MusicBar = () => {
  const track = currentTrack()
  if (!track) return null   // nothing to show until the playlist has loaded
  const muted = isMuted()
  const title = track.artist ? `${track.title} — ${track.artist}` : track.title
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: px(20), right: px(30) }, flexDirection: 'row', alignItems: 'center', padding: px(4) }}
      uiBackground={{ color: Color4.create(0.02, 0.05, 0.12, 0.85) }}>
      <Label value={muted ? '♪ MUTED' : `♪ ${title}`} fontSize={px(12)} color={Color4.create(0.45, 0.65, 0.75, 1)} uiTransform={{ margin: { left: px(8), right: px(8) } }} />
      <UiEntity uiTransform={{ width: px(60), height: px(26), margin: { right: px(4) }, justifyContent: 'center', alignItems: 'center' }}
        uiBackground={{ color: Color4.create(0.05, 0.12, 0.2, 1) }}
        onMouseDown={() => { nextTrack() }}>
        <Label value="NEXT" fontSize={px(12)} color={Color4.create(0, 0.9, 1, 1)} />
      </UiEntity>
      <UiEntity uiTransform={{ width: px(76), height: px(26), justifyContent: 'center', alignItems: 'center' }}
        uiBackground={{ color: muted ? Color4.create(0.05, 0.12, 0.2, 1) : Color4.create(0, 0.9, 1, 1) }}
        onMouseDown={() => { toggleMuted() }}>
        <Label value={muted ? 'UNMUTE' : 'MUTE'} fontSize={px(12)} color={muted ? Color4.create(0, 0.9, 1, 1) : Color4.create(0.02, 0.05, 0.1, 1)} />
      </UiEntity>
    </UiEntity>
  )
}

const WHITE = Color4.White()
const tex = (src: string, tint?: [number, number, number], alpha: number = 1) => ({ texture: { src }, textureMode: 'stretch' as const, color: tint || alpha < 1 ? Color4.create(tint?.[0] ?? 1, tint?.[1] ?? 1, tint?.[2] ?? 1, alpha) : WHITE })

/** Bedroom fitted to the screen height at its native aspect, panning slowly if wider than the screen. The space
 *  layers live inside the same clipped box so the window always looks out on them. */
const SleepOverlay = () => {
  if (!sleepSceneVisible()) return null
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const cw = canvas?.width ?? 1920
  const ch = canvas?.height ?? 1080
  const view = sleepView()
  const h = ch
  const w = Math.round(h * view.aspect)
  const overflow = Math.max(0, w - cw)
  const left = overflow > 0 ? -Math.round(overflow * panFraction()) : Math.round((cw - w) / 2)
  const star = starSprite()
  const so = starOffset()
  const starW = star.size * 100 * so.scale
  const pct = (v: number): `${number}%` => `${v}%` as `${number}%`
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(0), left: px(0) }, width: '100%', height: '100%' }} uiBackground={{ color: Color4.create(0.005, 0.005, 0.02, 1) }}>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(0), left }, width: w, height: h, overflow: 'hidden' }}>
        {(() => {
          // The very back of the scene; everything else drifts faster in front of it.
          const mw = MILKY_WAY
          const hPct = mw.width * view.aspect / mw.aspect
          const d = layerOffset(mw.speed, mw.wrap)
          const x = ((mw.start - d + mw.width + mw.wrap) % mw.wrap) - mw.width
          // Centred on the star's height, shifted by how far this system sits above or below the galactic plane.
          return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: pct(x), top: pct(STAR_Y + galacticPlaneOffset() - hPct / 2) }, width: pct(mw.width), height: pct(hPct) }} uiBackground={tex(mw.src, undefined, mw.alpha)} />
        })()}
        {BACKDROPS.map((bd, i) => {
          // Tiles at native aspect, BACKDROP_SCALE of the room height, in a grid wide and tall enough to cover while scrolling.
          const hPct = 100 * BACKDROP_SCALE
          const wPct = hPct * bd.aspect / view.aspect
          const cols = Math.ceil(100 / wPct) + 1
          const rows = Math.ceil(100 / hPct)
          const d = layerOffset(bd.speed, wPct)
          const tiles: ReactEcs.JSX.Element[] = []
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            tiles.push(<UiEntity key={`bd${i}-${r}-${c}`} uiTransform={{ positionType: 'absolute', position: { left: pct(-d + c * wPct), top: pct(r * hPct) }, width: pct(wPct), height: pct(hPct) }} uiBackground={tex(bd.src, undefined, bd.alpha)} />)
          }
          return tiles
        })}
        {sleepCelestials().map((cb, i) => {
          const x = ((cb.x - layerOffset(driftSpeeds.speck * cb.depth, 200) + 200) % 200) - 50
          return <UiEntity key={`cb${i}`} uiTransform={{ positionType: 'absolute', position: { left: pct(x), top: pct(cb.y) }, width: pct(cb.size), height: pct(cb.size * view.aspect / ATLAS.cellAspect) }}
            uiBackground={{ texture: { src: ATLAS.src }, textureMode: 'stretch', uvs: atlasUvs(cb.cell), color: Color4.create(1, 1, 1, cb.alpha) }} />
        })}
        {sleepSpecks().map((sp, i) => {
          const x = ((sp.x - layerOffset(driftSpeeds.speck * sp.depth, 200) + 200) % 200) - 50
          return <UiEntity key={`sp${i}`} uiTransform={{ positionType: 'absolute', position: { left: pct(x), top: pct(sp.y) }, width: pct(sp.size), height: pct(sp.size * view.aspect) }} uiBackground={tex(sp.src, undefined, sp.alpha)} />
        })}
        {NEBULAE.map((neb, i) => {
          // Enters from the right, crosses, and is gone for most of its cycle.
          const d = layerOffset(driftSpeeds.nebula[i], NEBULA_WRAP)
          const x = 100 + i * 140 - d
          const bob = Math.sin((i + 1) * 0.7 + d * 0.02) * 2
          return <UiEntity key={`neb${i}`} uiTransform={{ positionType: 'absolute', position: { left: pct(((x + neb.width + NEBULA_WRAP) % NEBULA_WRAP) - neb.width), top: pct(neb.top + bob) }, width: pct(neb.width), height: pct(neb.height) }} uiBackground={tex(neb.src, undefined, neb.alpha)} />
        })}
        <UiEntity uiTransform={{ positionType: 'absolute', position: { left: pct(50 - starW / 2), top: pct(STAR_Y - starW * view.aspect / 2) }, width: pct(starW), height: pct(starW * view.aspect) }} uiBackground={tex(star.src, star.tint)} />
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(0), left: px(0) }, width: '100%', height: '100%' }} uiBackground={tex(view.src)} />
      </UiEntity>
      {/* Controls sit at the bottom right, above the music bar, clear of the chat window on the left. */}
      <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: px(60), right: px(30) }, flexDirection: 'row', alignItems: 'center', padding: px(4) }} uiBackground={{ color: Color4.create(0.02, 0.05, 0.12, 0.85) }}>
        <Label value="QUARTERS" fontSize={px(12)} color={Color4.create(0.45, 0.65, 0.75, 1)} uiTransform={{ margin: { left: px(8), right: px(8) } }} />
        {SLEEP_VIEWS.map((_, i) => (
          <UiEntity key={`view${i}`} uiTransform={{ width: px(32), height: px(26), margin: { right: px(4) }, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: i === sleepViewIndex() ? Color4.create(0, 0.9, 1, 1) : Color4.create(0.05, 0.12, 0.2, 1) }}
            onMouseDown={() => { setSleepView(i) }}>
            <Label value={`${i + 1}`} fontSize={px(12)} color={i === sleepViewIndex() ? Color4.create(0.02, 0.05, 0.1, 1) : Color4.create(0, 0.9, 1, 1)} />
          </UiEntity>
        ))}
        <UiEntity uiTransform={{ width: px(76), height: px(26), margin: { left: px(8) }, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0, 0.9, 1, 1) }} onMouseDown={() => { wake() }}>
          <Label value="WAKE" fontSize={px(12)} color={Color4.create(0.02, 0.05, 0.1, 1)} />
        </UiEntity>
      </UiEntity>
      <MusicBar />
      <SleepIntro />
      <SleepCurtain />
    </UiEntity>
  )
}

/** First-time explanation of the quarters: a place to rest and listen, which changes nothing about the trip. */
const SleepIntro = () => {
  if (!sleepIntroVisible()) return null
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(560), flexDirection: 'column', padding: px(24) }} uiBackground={{ color: Color4.create(0.02, 0.05, 0.12, 0.92) }}>
        <Label value="YOUR QUARTERS" fontSize={px(16)} color={Color4.create(0, 0.9, 1, 1)} uiTransform={{ height: px(26), margin: { bottom: px(10) } }} textAlign="middle-left" />
        <UiEntity uiTransform={{ width: '100%', height: px(190) }}
          uiText={{ value: "This is a place to relax, look out at the stars and listen to the music.\n\nSleeping doesn't change your travel time or anything else aboard: your trip, pods and scans carry on exactly as they would. Pick a view with the numbers below, and press WAKE whenever you're ready.", fontSize: px(16), color: Color4.White(), textAlign: 'top-left', textWrap: 'wrap' }} />
        <UiEntity uiTransform={{ width: '100%', height: px(34), flexDirection: 'row', justifyContent: 'flex-end', margin: { top: px(10) } }}>
          <UiEntity uiTransform={{ width: px(110), height: '100%', justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0, 0.9, 1, 1) }} onMouseDown={() => { dismissSleepIntro() }}>
            <Label value="GOT IT" fontSize={px(13)} color={Color4.create(0.02, 0.05, 0.1, 1)} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

/** Black fade over whatever is showing; drawn last so it covers everything. */
const SleepCurtain = () => {
  const a = sleepCurtain()
  if (!isSleeping() || a <= 0.001) return null
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%' }} uiBackground={{ color: Color4.create(0, 0, 0, a) }} />
}

// While the world fades to or from black, the normal HUD stays up under the curtain; once dark, the room takes over.
const uiComponent = () => sleepSceneVisible() ? <SleepOverlay /> : (
  <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
    <DigitWarmup />
    <SystemInfoPanel />
    <BodyDetailPanel />
    <TravelStatusPanel />
    <SurveyBar />
    <WormholeBanner />
    <NotificationBanner />
    <StemBanner />
    <DiscoveryDescriptionBar />
    <StatusBar />
    <PurchaseDialog />
    <RecallDialog />
    <RefineryDialog />
    <BuildStationDialog />
    <DistressDialog />
    <CameraSwitch />
    <MusicBar />
    <ReturnToTerminal />
    <StemButton />
    <StemPanel />
    <GuideButton />
    <GuidePanel />
    <InfoMenu />
    <CreditsPanel />
    <LegalPanel />
    <TourDialog />
    <WormholeOverlay />
    <HawkingOverlay />
    <SleepCurtain />
  </UiEntity>
)

export function setupUi(): void { ReactEcsRenderer.setUiRenderer(uiComponent) }
