// Info menu: a small meatball (•••) HUD button with the credits and links to the terms of service and privacy policy.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { openExternalUrl } from '~system/RestrictedActions'
import { px } from './uiScale'

const TERMS_URL = 'https://galaxygardeners.app/terms-of-service'
const PRIVACY_URL = 'https://galaxygardeners.app/privacy-policy'

// Studio and producer first, then leads and design, then development and assets, then hosting.
const CREDITS: [string, string][] = [
  ['Development', 'MetaPetal Studios'],
  ['Executive Producer', 'MetaPetal Lilac'],
  ['Lead Developer', 'Unknower'],
  ['Game Mechanics Design', 'Unknower'],
  ['AI Developer', 'Claude Opus'],
  ['3D Modeling', 'LowPolyModels, Unknower, ChatGPT'],
  ['Music', 'Unknower via Suno'],
  ['Web & API Hosting', 'Livication'],
]

let open = false        // credits panel
let menuOpen = false

const CYAN = Color4.create(0, 0.9, 1, 1)
const DIM = Color4.create(0.45, 0.65, 0.75, 1)
const PANEL_BG = Color4.create(0.02, 0.05, 0.12, 0.94)
const SLOT_BG = Color4.create(0.05, 0.12, 0.2, 1)
const DARK = Color4.create(0.02, 0.05, 0.1, 1)

function openLink(url: string): void {
  menuOpen = false
  void openExternalUrl({ url }).catch((err) => console.log('[menu] openExternalUrl failed', err))   // the explorer asks to confirm
}

const MENU_ITEMS: [string, () => void][] = [
  ['CREDITS', () => { menuOpen = false; open = true }],
  ['TERMS OF SERVICE', () => openLink(TERMS_URL)],
  ['PRIVACY POLICY', () => openLink(PRIVACY_URL)],
]

export const InfoMenu = () => (
  <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(64), left: px(330) }, flexDirection: 'column' }}>
    <UiEntity uiTransform={{ width: px(44), height: px(28), justifyContent: 'center', alignItems: 'center' }}
      uiBackground={{ color: menuOpen ? CYAN : PANEL_BG }}
      onMouseDown={() => { menuOpen = !menuOpen }}>
      <Label value="•••" fontSize={px(14)} color={menuOpen ? DARK : CYAN} />
    </UiEntity>
    {menuOpen ? (
      <UiEntity uiTransform={{ width: px(180), flexDirection: 'column', padding: px(4), margin: { top: px(4) } }} uiBackground={{ color: PANEL_BG }}>
        {MENU_ITEMS.map(([label, onClick]) => (
          <UiEntity key={label} uiTransform={{ width: '100%', height: px(30), margin: { bottom: px(2) }, padding: { left: px(10) }, alignItems: 'center' }}
            uiBackground={{ color: SLOT_BG }} onMouseDown={onClick}>
            <Label value={label} fontSize={px(12)} color={CYAN} textAlign="middle-left" />
          </UiEntity>
        ))}
      </UiEntity>
    ) : null}
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
