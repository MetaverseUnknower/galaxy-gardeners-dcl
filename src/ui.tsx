import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { StarSystem, FuelCostResponse } from './types'
import { getTravelProgress } from './navigation'
import { getSelectedBody, BodyInfo } from './systemView'
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
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { bottom: 40 }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: 620, flexDirection: 'column', padding: { top: 24, bottom: 24, left: 24, right: 24 } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.92) }}>
        <UiEntity uiTransform={{ width: '100%', height: 44, margin: { bottom: 8 } }} uiText={{ value: selectedSystem.name, fontSize: 36, color: Color4.create(0, 1, 1, 1), textAlign: 'middle-center' }} />
        <UiEntity uiTransform={{ width: '100%', height: 28, margin: { bottom: 6 } }} uiText={{ value: (selectedSystem.star_type || 'unknown').replace(/_/g, ' ').toUpperCase(), fontSize: 20, color: Color4.create(0.6, 0.6, 0.6, 1), textAlign: 'middle-center' }} />
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { bottom: 8 } }}>
          {selectedSystem.has_station ? <UiEntity uiTransform={{ height: 24, margin: { right: 16 } }} uiText={{ value: 'STATION', fontSize: 18, color: Color4.create(0, 1, 1, 1) }} /> : null}
          {selectedSystem.has_wormhole ? <UiEntity uiTransform={{ height: 24 }} uiText={{ value: 'WORMHOLE', fontSize: 18, color: Color4.create(0.6, 0.2, 1, 1) }} /> : null}
        </UiEntity>
        {selectedSystem.discovered_by_name ? <UiEntity uiTransform={{ width: '100%', height: 24, margin: { bottom: 8 } }} uiText={{ value: `Discovered by ${selectedSystem.discovered_by_name}`, fontSize: 18, color: Color4.create(0.5, 0.5, 0.5, 1), textAlign: 'middle-center' }} /> : null}
        {fuelInfo ? (
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: 8 } }}>
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { bottom: 4 } }}>
              <UiEntity uiTransform={{ height: 28, margin: { right: 24 } }} uiText={{ value: `Distance: ${fuelInfo.distance.toFixed(1)}`, fontSize: 20, color: Color4.create(0.8, 0.8, 0.8, 1) }} />
              <UiEntity uiTransform={{ height: 28 }} uiText={{ value: `Fuel cost: ${fuelInfo.fuel_cost.toFixed(1)}`, fontSize: 20, color: canAfford ? Color4.create(0, 1, 0.5, 1) : Color4.create(1, 0.3, 0.3, 1) }} />
            </UiEntity>
            <UiEntity uiTransform={{ width: '100%', height: 24, margin: { bottom: 4 } }} uiText={{ value: `Your fuel: ${fuelInfo.current_fuel.toFixed(1)}`, fontSize: 18, color: Color4.create(0.6, 0.6, 0.6, 1), textAlign: 'middle-center' }} />
            {!canAfford ? <UiEntity uiTransform={{ width: '100%', height: 22 }} uiText={{ value: 'Not enough fuel', fontSize: 16, color: Color4.create(1, 0.3, 0.3, 0.8), textAlign: 'middle-center' }} /> : null}
          </UiEntity>
        ) : null}
        {selectedSystem.id === currentSystemId ? <UiEntity uiTransform={{ width: '100%', height: 50, margin: { top: 14 }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.1, 0.3, 0.5, 1) }} uiText={{ value: 'VIEW SYSTEM', fontSize: 20, color: Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { if (onViewSystem) onViewSystem() }} /> : null}
        {selectedSystem.id !== currentSystemId && fuelInfo && !showTravelConfirm ? <UiEntity uiTransform={{ width: '100%', height: 50, margin: { top: 14 }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: canAfford ? Color4.create(0, 0.4, 0.5, 1) : Color4.create(0.15, 0.15, 0.15, 1) }} uiText={{ value: canAfford ? 'TRAVEL' : 'INSUFFICIENT FUEL', fontSize: 20, color: canAfford ? Color4.White() : Color4.create(0.4, 0.4, 0.4, 1), textAlign: 'middle-center' }} onMouseDown={() => { if (canAfford) showTravelConfirm = true }} /> : null}
        {showTravelConfirm ? (
          <UiEntity uiTransform={{ margin: { top: 14 }, flexDirection: 'column', alignItems: 'center' }}>
            <UiEntity uiTransform={{ width: '100%', height: 28, margin: { bottom: 10 } }} uiText={{ value: `Travel to ${selectedSystem.name}? (${fuelInfo!.fuel_cost.toFixed(1)} fuel)`, fontSize: 20, color: Color4.create(1, 1, 0, 1), textAlign: 'middle-center' }} />
            <UiEntity uiTransform={{ flexDirection: 'row' }}>
              <UiEntity uiTransform={{ width: 160, height: 46, margin: { right: 12 }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0, 0.6, 0.3, 1) }} uiText={{ value: 'CONFIRM', fontSize: 20, color: Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { if (onTravelConfirm) onTravelConfirm() }} />
              <UiEntity uiTransform={{ width: 160, height: 46, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.4, 0.1, 0.1, 1) }} uiText={{ value: 'CANCEL', fontSize: 20, color: Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { showTravelConfirm = false }} />
            </UiEntity>
          </UiEntity>
        ) : null}
      </UiEntity>
    </UiEntity>
  )
}

const BodyDetailPanel = () => {
  const body = getSelectedBody()
  if (!body) return null
  if (body.id !== lastSelectedBodyId) { lastSelectedBodyId = body.id; deployStatus = null }
  const typeColors: Record<string, Color4> = { planet: Color4.create(0.2, 0.8, 0.4, 1), moon: Color4.create(0.7, 0.7, 0.6, 1), belt: Color4.create(0.9, 0.7, 0.3, 1) }
  const titleColor = typeColors[body.type] || Color4.create(0, 1, 1, 1)
  const detailEntries = Object.entries(body.details)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: 30, right: 30 }, flexDirection: 'column', width: 480 }}>
      {body.imageUrl ? (
        <UiEntity uiTransform={{ width: 480, height: 480, margin: { bottom: 6 }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.7) }}>
          <UiEntity uiTransform={{ width: 440, height: 440 }} uiBackground={{ texture: { src: body.imageUrl }, textureMode: 'stretch', color: Color4.create(1, 1, 1, 1) }} />
        </UiEntity>
      ) : null}
      <UiEntity uiTransform={{ width: 480, flexDirection: 'column', padding: { top: 20, bottom: 20, left: 24, right: 24 } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.92) }}>
        <UiEntity uiTransform={{ width: '100%', height: 46, margin: { bottom: 2 } }} uiText={{ value: body.name, fontSize: 36, color: titleColor, textAlign: 'middle-left', textWrap: 'nowrap' }} />
        <UiEntity uiTransform={{ width: '100%', height: 26, margin: { bottom: 16 } }} uiText={{ value: body.type.toUpperCase(), fontSize: 18, color: Color4.create(0.45, 0.45, 0.45, 1), textAlign: 'middle-left' }} />
        {detailEntries.map(([key, val]) => (
          <UiEntity key={key} uiTransform={{ width: '100%', flexDirection: 'row', margin: { bottom: 8 } }}>
            <UiEntity uiTransform={{ width: 160, height: 30 }} uiText={{ value: key, fontSize: 22, color: Color4.create(0.5, 0.5, 0.5, 1), textAlign: 'middle-left' }} />
            <UiEntity uiTransform={{ height: 30 }} uiText={{ value: val.charAt(0).toUpperCase() + val.slice(1), fontSize: 22, color: Color4.create(0.9, 0.9, 0.9, 1), textAlign: 'middle-left' }} />
          </UiEntity>
        ))}
        {body.canDeploy ? <UiEntity uiTransform={{ width: '100%', height: 50, margin: { top: 14 }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: deployStatus ? Color4.create(0.15, 0.15, 0.15, 1) : Color4.create(0, 0.4, 0.5, 1) }} uiText={{ value: deployStatus || (body.type === 'belt' ? 'DEPLOY MINING POD' : 'DEPLOY EXPLORATION POD'), fontSize: 20, color: deployStatus ? Color4.create(0.7, 0.7, 0.7, 1) : Color4.White(), textAlign: 'middle-center' }} onMouseDown={() => { if (!deployStatus) deployPod(body) }} /> : null}
      </UiEntity>
    </UiEntity>
  )
}

const TravelStatusPanel = () => {
  if (!travelingTo) return null
  const { progress, remainingDistance } = getTravelProgress()
  const pct = Math.floor(progress * 100)
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { bottom: 40 }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: 500, flexDirection: 'column', padding: { top: 20, bottom: 20, left: 20, right: 20 } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.92) }}>
        <UiEntity uiTransform={{ width: '100%', height: 32, margin: { bottom: 8 } }} uiText={{ value: `Traveling to ${travelingTo}`, fontSize: 24, color: Color4.create(0, 1, 0.5, 1), textAlign: 'middle-center' }} />
        <UiEntity uiTransform={{ width: '100%', height: 24, margin: { bottom: 8 } }} uiText={{ value: `${pct}% — ${remainingDistance.toFixed(1)} units remaining`, fontSize: 18, color: Color4.create(0.7, 0.7, 0.7, 1), textAlign: 'middle-center' }} />
        <UiEntity uiTransform={{ width: '100%', height: 8 }} uiBackground={{ color: Color4.create(0.15, 0.15, 0.15, 1) }}>
          <UiEntity uiTransform={{ width: `${pct}%`, height: '100%' }} uiBackground={{ color: Color4.create(0, 1, 0.5, 0.8) }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

const NotificationBanner = () => {
  if (!notification) return null
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: 60 }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: 700, padding: { top: 16, bottom: 16, left: 24, right: 24 } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', height: 30 }} uiText={{ value: notification.text, fontSize: 22, color: notification.color, textAlign: 'middle-center' }} />
      </UiEntity>
    </UiEntity>
  )
}

const DiscoveryDescriptionBar = () => {
  if (!discoveryDescription) return null
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { bottom: 20 }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: 700, padding: { top: 12, bottom: 12, left: 20, right: 20 } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.9) }}>
        <UiEntity uiTransform={{ width: '100%', height: 26 }} uiText={{ value: discoveryDescription, fontSize: 20, color: Color4.create(0.7, 0.7, 0.7, 1), textAlign: 'middle-center' }} />
      </UiEntity>
    </UiEntity>
  )
}

const StatusBar = () => {
  if (!statusMessage) return null
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: 20 }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: 500, padding: { top: 10, bottom: 10, left: 10, right: 10 } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.8) }}>
        <UiEntity uiTransform={{ width: '100%', height: 22 }} uiText={{ value: statusMessage, fontSize: 16, color: Color4.create(0.8, 0.8, 0.8, 1), textAlign: 'middle-center' }} />
      </UiEntity>
    </UiEntity>
  )
}

const uiComponent = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
    <SystemInfoPanel />
    <BodyDetailPanel />
    <TravelStatusPanel />
    <NotificationBanner />
    <DiscoveryDescriptionBar />
    <StatusBar />
  </UiEntity>
)

export function setupUi(): void { ReactEcsRenderer.setUiRenderer(uiComponent) }
