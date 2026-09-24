import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { StarSystem, FuelCostResponse } from './types'
import { getTravelProgress } from './navigation'
import { getSelectedBody, BodyInfo } from './systemView'

let selectedFlora: any = null
let onCloseDetailPanel: (() => void) | null = null
export function setSelectedFlora(flora: any): void { selectedFlora = flora }
export function clearSelectedFlora(): void { selectedFlora = null }
export function setCloseDetailCallback(cb: () => void): void { onCloseDetailPanel = cb }
import { isCurrentlyTraveling } from './navigation'
import { refreshStation } from './stations'
import { getCameraMode, setCameraMode, CAMERA_MODES, CAMERA_MODE_LABELS } from './consoleCamera'
import { teleportTo } from '~system/RestrictedActions'
import { currentTrack, isMuted, toggleMuted, nextTrack } from './soundtrack'
import { isSleeping, wake, sleepView, sleepViewIndex, setSleepView, SLEEP_VIEWS, MILKY_WAY, BACKDROPS, BACKDROP_SCALE, ATLAS, atlasUvs, sleepCelestials, NEBULAE, NEBULA_WRAP, starSprite, starOffset, layerOffset, sleepSpecks, driftSpeeds, panFraction } from './sleepMode'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'

// HUD sizes are authored for a 1080-tall canvas and scaled to the actual canvas height, so every
// button and label keeps the same size relative to the screen on any display (retina included).
const REFERENCE_HEIGHT = 1080
function uiScale(): number {
  const c = UiCanvasInformation.getOrNull(engine.RootEntity)
  return c && c.height > 0 ? c.height / REFERENCE_HEIGHT : 1
}
const px = (n: number): number => Math.round(n * uiScale())
import { selectSystem } from './interaction'
import { payMana, redeemManaPurchase, paymentErrorMessage } from './payments'
import * as api from './api'


let selectedSystem: StarSystem | null = null
let fuelInfo: FuelCostResponse | null = null
let travelingTo: string | null = null
let statusMessage: string | null = null
let onTravelConfirm: (() => void) | null = null
let onViewSystem: (() => void) | null = null
let showTravelConfirm = false
let currentSystemId: string | null = null
let deployStatus: string | null = null
let lastSelectedBodyId: string | null = null
let discoveryDescription: string | null = null
let notification: { text: string; color: Color4; timer: number } | null = null

// Fuel dialogs
let showPurchaseDialog = false
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
    refreshStation('ship')
  } catch (err: any) { purchaseStatus = paymentErrorMessage(err, 'Purchase failed') }
  finally { purchasing = false }
}

export function updateNotification(dt: number): void {
  if (notification) { notification.timer -= dt; if (notification.timer <= 0) notification = null }
}
export function showNotification(text: string, color: Color4, duration: number = 5): void {
  notification = { text, color, timer: duration }
}
export function setDiscoveryDescription(text: string | null): void { discoveryDescription = text }

async function deployPod(body: BodyInfo): Promise<void> {
  deployStatus = 'Deploying...'
  try {
    if (body.type === 'belt') { await api.deployMiningPod(body.id); deployStatus = 'Mining pod deployed!' }
    else if (body.type === 'moon') { await api.deployExplorationPodToMoon(body.id); deployStatus = 'Exploration pod deployed!' }
    else { await api.deployExplorationPod(body.id); deployStatus = 'Exploration pod deployed!' }
    refreshStation('ship')
  } catch (err: any) { deployStatus = err.message || 'Deploy failed' }
}

export function setSelectedSystemUI(system: StarSystem | null, fuel: FuelCostResponse | null): void {
  selectedSystem = system; fuelInfo = fuel; showTravelConfirm = false; deployStatus = null
}
export function setTravelingStatus(systemName: string | null): void { travelingTo = systemName }
export function setStatusMessage(msg: string | null): void { statusMessage = msg }
export function setTravelConfirmCallback(callback: () => void): void { onTravelConfirm = callback }
export function setViewSystemCallback(callback: () => void): void { onViewSystem = callback }
export function setCurrentSystemId(id: string | null): void { currentSystemId = id }

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
          {selectedSystem.has_wormhole ? <UiEntity uiTransform={{ height: px(24) }} uiText={{ value: 'WORMHOLE', fontSize: px(18), color: Color4.create(0.6, 0.2, 1, 1) }} /> : null}
        </UiEntity>
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
        ) : null}
        {selectedSystem.id === currentSystemId ? <UiEntity uiTransform={{ width: '100%', height: px(50), margin: { top: px(14) }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.1, 0.3, 0.5, 1) }} uiText={{ value: 'VIEW SYSTEM', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { if (onViewSystem) onViewSystem() }} /> : null}
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
              <UiEntity uiTransform={{ width: px(160), height: px(46), margin: { right: px(12) }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0, 0.6, 0.3, 1) }} uiText={{ value: 'CONFIRM', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { if (onTravelConfirm) onTravelConfirm() }} />
              <UiEntity uiTransform={{ width: px(160), height: px(46), justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.4, 0.1, 0.1, 1) }} uiText={{ value: 'CANCEL', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { showTravelConfirm = false }} />
            </UiEntity>
          </UiEntity>
        ) : null}
      </UiEntity>
    </UiEntity>
  )
}

const BodyDetailPanel = () => {
  const body = getSelectedBody() || selectedFlora
  if (!body) return null
  if (body.id !== lastSelectedBodyId) { lastSelectedBodyId = body.id; deployStatus = null }
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
        {body.canDeploy ? <UiEntity uiTransform={{ width: '100%', height: px(50), margin: { top: px(14) }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: deployStatus ? Color4.create(0.15, 0.15, 0.15, 1) : Color4.create(0, 0.4, 0.5, 1) }} uiText={{ value: deployStatus || (body.type === 'belt' ? 'DEPLOY MINING POD' : 'DEPLOY EXPLORATION POD'), fontSize: px(20), color: deployStatus ? Color4.create(0.7, 0.7, 0.7, 1) : Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { if (!deployStatus) deployPod(body) }} /> : null}
      </UiEntity>
    </UiEntity>
  )
}

const TravelStatusPanel = () => {
  if (!travelingTo) return null
  const { progress, remainingDistance } = getTravelProgress()
  const pct = Math.floor(progress * 100)
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: px(20) }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: px(500), flexDirection: 'column', padding: { top: px(20), bottom: px(20), left: px(20), right: px(20) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.92) }}>
        <UiEntity uiTransform={{ width: '100%', height: px(32), margin: { bottom: px(8) } }} uiText={{ value: `Traveling to ${travelingTo}`, fontSize: px(24), color: Color4.create(0, 1, 0.5, 1), textAlign: 'middle-center' }} />
        <UiEntity uiTransform={{ width: '100%', height: px(24), margin: { bottom: px(8) } }} uiText={{ value: `${pct}% — ${remainingDistance.toFixed(1)} units remaining`, fontSize: px(18), color: Color4.create(0.7, 0.7, 0.7, 1), textAlign: 'middle-center' }} />
        <UiEntity uiTransform={{ width: '100%', height: px(8) }} uiBackground={{ color: Color4.create(0.15, 0.15, 0.15, 1) }}>
          <UiEntity uiTransform={{ width: `${pct}%`, height: '100%' }} uiBackground={{ color: Color4.create(0, 1, 0.5, 0.8) }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

const NotificationBanner = () => {
  if (!notification) return null
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: px(60) }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: px(700), padding: { top: px(16), bottom: px(16), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', height: px(30) }} uiText={{ value: notification.text, fontSize: px(22), color: notification.color, textAlign: 'middle-center' }} />
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


const CameraSwitch = () => {
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
  if (!isSleeping()) return null
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
          return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: pct(x), top: pct((100 - hPct) / 2 - 8) }, width: pct(mw.width), height: pct(hPct) }} uiBackground={tex(mw.src, undefined, mw.alpha)} />
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
        <UiEntity uiTransform={{ positionType: 'absolute', position: { left: pct(50 - starW / 2), top: pct(26 - starW * view.aspect / 2) }, width: pct(starW), height: pct(starW * view.aspect) }} uiBackground={tex(star.src, star.tint)} />
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
    </UiEntity>
  )
}

const uiComponent = () => isSleeping() ? <SleepOverlay /> : (
  <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
    <SystemInfoPanel />
    <BodyDetailPanel />
    <TravelStatusPanel />
    <NotificationBanner />
    <DiscoveryDescriptionBar />
    <StatusBar />
    <PurchaseDialog />
    <RefineryDialog />
    <CameraSwitch />
    <MusicBar />
    <ReturnToTerminal />
  </UiEntity>
)

export function setupUi(): void { ReactEcsRenderer.setUiRenderer(uiComponent) }
