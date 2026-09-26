// Credits: a small HUD button (above the GUIDE button's spot) that opens the game's credits.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from './uiScale'

// Studio and producer first, then leads and design, then development and assets, then hosting.
const CREDITS: [string, string][] = [
  ['Development', 'MetaPetal Studios'],
  ['Executive Producer', 'MetaPetal Lilac'],
  ['Lead Developer', 'Unknower'],
  ['Game Mechanics Design', 'Unknower'],
  ['AI Developer', 'Claude Opus'],
  ['3D Modeling', 'LowPolyModels & ChatGPT'],
  ['Music', 'AI-Generated via Suno, Prompts by Unknower'],
  ['Web & API Hosting', 'Livication'],
]

let open = false

const CYAN = Color4.create(0, 0.9, 1, 1)
const DIM = Color4.create(0.45, 0.65, 0.75, 1)
const PANEL_BG = Color4.create(0.02, 0.05, 0.12, 0.94)
const SLOT_BG = Color4.create(0.05, 0.12, 0.2, 1)
const DARK = Color4.create(0.02, 0.05, 0.1, 1)

export const CreditsButton = () => (
  <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(68), left: px(360) }, width: px(90), height: px(28), justifyContent: 'center', alignItems: 'center' }}
    uiBackground={{ color: open ? CYAN : PANEL_BG }}
    onMouseDown={() => { open = !open }}>
    <Label value="CREDITS" fontSize={px(12)} color={open ? DARK : CYAN} />
  </UiEntity>
)

export const CreditsPanel = () => {
  if (!open) return null
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(560), flexDirection: 'column', padding: px(24) }} uiBackground={{ color: PANEL_BG }}>
        <UiEntity uiTransform={{ width: '100%', height: px(30), flexDirection: 'row', alignItems: 'center', margin: { bottom: px(16) } }}>
          <Label value="GALAXY GARDENERS  //  CREDITS" fontSize={px(16)} color={CYAN} uiTransform={{ flexGrow: 1 }} textAlign="middle-left" />
          <UiEntity uiTransform={{ width: px(28), height: px(28), justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: SLOT_BG }}
            onMouseDown={() => { open = false }}>
            <Label value="X" fontSize={px(13)} color={CYAN} />
          </UiEntity>
        </UiEntity>
        {CREDITS.map(([role, who]) => (
          <UiEntity key={role} uiTransform={{ width: '100%', flexDirection: 'column', margin: { bottom: px(12) } }}>
            <Label value={role.toUpperCase()} fontSize={px(12)} color={DIM} uiTransform={{ height: px(18) }} textAlign="middle-left" />
            <Label value={who} fontSize={px(17)} color={Color4.White()} uiTransform={{ height: px(24) }} textAlign="middle-left" />
          </UiEntity>
        ))}
      </UiEntity>
    </UiEntity>
  )
}
