import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { StarSystem, FuelCostResponse } from './types'

let selectedSystem: StarSystem | null = null
let fuelInfo: FuelCostResponse | null = null
let travelingTo: string | null = null
let statusMessage: string | null = null
let onTravelConfirm: (() => void) | null = null
let showTravelConfirm = false

export function setSelectedSystemUI(system: StarSystem | null, fuel: FuelCostResponse | null): void {
  selectedSystem = system
  fuelInfo = fuel
  showTravelConfirm = false
}

export function setTravelingStatus(systemName: string | null): void {
  travelingTo = systemName
}

export function setStatusMessage(msg: string | null): void {
  statusMessage = msg
}

export function setTravelConfirmCallback(callback: () => void): void {
  onTravelConfirm = callback
}

const SystemInfoPanel = () => {
  if (!selectedSystem) return null

  return (
    <UiEntity
      uiTransform={{
        width: 320,
        height: 'auto',
        positionType: 'absolute',
        position: { right: 20, top: 20 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.9) }}
    >
      <UiEntity uiTransform={{ padding: 16, flexDirection: 'column' }}>
        <UiEntity
          uiTransform={{ margin: { bottom: 8 } }}
          uiText={{ value: selectedSystem.name, fontSize: 20, color: Color4.create(0, 1, 1, 1) }}
        />
        <UiEntity
          uiTransform={{ margin: { bottom: 4 } }}
          uiText={{
            value: `Star: ${selectedSystem.star_type || 'Unknown'}`,
            fontSize: 14,
            color: Color4.create(0.7, 0.7, 0.7, 1)
          }}
        />
        {selectedSystem.has_station ? (
          <UiEntity
            uiTransform={{ margin: { bottom: 4 } }}
            uiText={{ value: 'Has Station', fontSize: 14, color: Color4.create(0, 1, 1, 1) }}
          />
        ) : null}
        {selectedSystem.discovered_by ? (
          <UiEntity
            uiTransform={{ margin: { bottom: 4 } }}
            uiText={{
              value: `Discovered by: ${selectedSystem.discovered_by}`,
              fontSize: 13,
              color: Color4.create(0.6, 0.6, 0.6, 1)
            }}
          />
        ) : null}
        {selectedSystem.has_wormhole ? (
          <UiEntity
            uiTransform={{ margin: { bottom: 4 } }}
            uiText={{ value: 'Has Wormhole', fontSize: 14, color: Color4.create(0.6, 0.2, 1, 1) }}
          />
        ) : null}
        {fuelInfo ? (
          <UiEntity uiTransform={{ margin: { top: 8 }, flexDirection: 'column' }}>
            <UiEntity
              uiText={{
                value: `Distance: ${fuelInfo.distance.toFixed(1)} | Fuel: ${fuelInfo.fuel_cost.toFixed(1)}`,
                fontSize: 13,
                color: Color4.create(0.8, 0.8, 0.8, 1)
              }}
            />
            <UiEntity
              uiText={{
                value: `Current fuel: ${fuelInfo.current_fuel.toFixed(1)}`,
                fontSize: 13,
                color: fuelInfo.current_fuel >= fuelInfo.fuel_cost
                  ? Color4.create(0, 1, 0.5, 1)
                  : Color4.create(1, 0.3, 0.3, 1)
              }}
            />
          </UiEntity>
        ) : null}
        {fuelInfo && !showTravelConfirm ? (
          <UiEntity
            uiTransform={{ margin: { top: 12 }, width: '100%', height: 36, alignItems: 'center', justifyContent: 'center' }}
            uiBackground={{ color: Color4.create(0, 0.4, 0.5, 1) }}
            uiText={{ value: 'TRAVEL', fontSize: 16, color: Color4.White() }}
            onMouseDown={() => { showTravelConfirm = true }}
          />
        ) : null}
        {showTravelConfirm ? (
          <UiEntity uiTransform={{ margin: { top: 12 }, flexDirection: 'column' }}>
            <UiEntity
              uiText={{
                value: `Travel to ${selectedSystem.name}?`,
                fontSize: 14,
                color: Color4.create(1, 1, 0, 1)
              }}
            />
            <UiEntity uiTransform={{ flexDirection: 'row', margin: { top: 8 } }}>
              <UiEntity
                uiTransform={{ width: 100, height: 32, margin: { right: 8 }, alignItems: 'center', justifyContent: 'center' }}
                uiBackground={{ color: Color4.create(0, 0.6, 0.3, 1) }}
                uiText={{ value: 'CONFIRM', fontSize: 14, color: Color4.White() }}
                onMouseDown={() => { if (onTravelConfirm) onTravelConfirm() }}
              />
              <UiEntity
                uiTransform={{ width: 100, height: 32, alignItems: 'center', justifyContent: 'center' }}
                uiBackground={{ color: Color4.create(0.4, 0.1, 0.1, 1) }}
                uiText={{ value: 'CANCEL', fontSize: 14, color: Color4.White() }}
                onMouseDown={() => { showTravelConfirm = false }}
              />
            </UiEntity>
          </UiEntity>
        ) : null}
      </UiEntity>
    </UiEntity>
  )
}

const TravelStatusPanel = () => {
  if (!travelingTo) return null

  return (
    <UiEntity
      uiTransform={{
        width: 280,
        height: 'auto',
        positionType: 'absolute',
        position: { right: 20, bottom: 20 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.9) }}
    >
      <UiEntity uiTransform={{ padding: 12 }}>
        <UiEntity
          uiText={{
            value: `Traveling to ${travelingTo}...`,
            fontSize: 14,
            color: Color4.create(0, 1, 0.5, 1)
          }}
        />
      </UiEntity>
    </UiEntity>
  )
}

const StatusBar = () => {
  if (!statusMessage) return null

  return (
    <UiEntity
      uiTransform={{
        width: 400,
        height: 'auto',
        positionType: 'absolute',
        position: { left: '50%', top: 20 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.8) }}
    >
      <UiEntity uiTransform={{ padding: 8 }}>
        <UiEntity
          uiText={{ value: statusMessage, fontSize: 14, color: Color4.create(0.8, 0.8, 0.8, 1) }}
        />
      </UiEntity>
    </UiEntity>
  )
}

const uiComponent = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
    <SystemInfoPanel />
    <TravelStatusPanel />
    <StatusBar />
  </UiEntity>
)

export function setupUi(): void {
  ReactEcsRenderer.setUiRenderer(uiComponent)
}
