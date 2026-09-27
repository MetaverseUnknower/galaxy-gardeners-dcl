// Info menu: a small kebab (⋮) HUD button with the credits, the terms of service and privacy policy, and (soon)
// connecting the mobile app.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { openExternalUrl } from '~system/RestrictedActions'
import { px } from './uiScale'
import { TERMS, PRIVACY, LegalDoc, LegalBlock } from './legalText'


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
let legal: LegalDoc | null = null   // the terms or privacy text being read

const CYAN = Color4.create(0, 0.9, 1, 1)
const DIM = Color4.create(0.45, 0.65, 0.75, 1)
const PANEL_BG = Color4.create(0.02, 0.05, 0.12, 0.94)
const SLOT_BG = Color4.create(0.05, 0.12, 0.2, 1)
const DARK = Color4.create(0.02, 0.05, 0.1, 1)

function openLink(url: string): void {
  void openExternalUrl({ url }).catch((err) => console.log('[menu] openExternalUrl failed', err))   // the explorer asks to confirm
}

// A null action shows the item disabled with a SOON tag.
const MENU_ITEMS: [string, (() => void) | null][] = [
  ['CONNECT MOBILE APP', null],   // will link a Decentraland wallet to the iOS app's account
  ['CREDITS', () => { menuOpen = false; legal = null; open = true }],
  ['TERMS OF SERVICE', () => { menuOpen = false; open = false; legal = TERMS }],
  ['PRIVACY POLICY', () => { menuOpen = false; open = false; legal = PRIVACY }],
]
const MUTED = Color4.create(0.3, 0.38, 0.45, 1)

export const InfoMenu = () => (
  <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(64), left: px(322) }, flexDirection: 'column' }}>
    <UiEntity uiTransform={{ width: px(28), height: px(28), flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
      uiBackground={{ color: menuOpen ? CYAN : PANEL_BG }}
      onMouseDown={() => { menuOpen = !menuOpen }}>
      {/* Three drawn dots rather than a ⋮ glyph, which the explorer's font may not have */}
      {[0, 1, 2].map(i => (
        <UiEntity key={`kebab${i}`} uiTransform={{ width: px(4), height: px(4), margin: { top: px(i === 0 ? 0 : 3) } }}
          uiBackground={{ color: menuOpen ? DARK : CYAN }} />
      ))}
    </UiEntity>
    {menuOpen ? (
      <UiEntity uiTransform={{ width: px(220), flexDirection: 'column', padding: px(4), margin: { top: px(4) } }} uiBackground={{ color: PANEL_BG }}>
        {MENU_ITEMS.map(([label, onClick]) => (
          <UiEntity key={label} uiTransform={{ width: '100%', height: px(30), margin: { bottom: px(2) }, padding: { left: px(10), right: px(8) }, flexDirection: 'row', alignItems: 'center' }}
            uiBackground={{ color: SLOT_BG }} onMouseDown={() => { onClick?.() }}>
            <Label value={label} fontSize={px(12)} color={onClick ? CYAN : MUTED} uiTransform={{ flexGrow: 1 }} textAlign="middle-left" />
            {onClick ? null : <Label value="SOON" fontSize={px(10)} color={MUTED} textAlign="middle-right" />}
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

// --- Terms / privacy reader: the full text in a scroll area, the website link underneath ---

const LEGAL_W = 720
const LEGAL_PAD = 24
const SCROLL_H = 520
const STYLE: Record<LegalBlock['kind'], { size: number; line: number; gap: number; color: Color4 }> = {
  h1: { size: 22, line: 28, gap: 6, color: CYAN },
  updated: { size: 13, line: 18, gap: 14, color: DIM },
  h2: { size: 17, line: 23, gap: 6, color: CYAN },
  p: { size: 15, line: 21, gap: 12, color: Color4.White() },
  li: { size: 15, line: 21, gap: 6, color: Color4.White() },
}

// DCL doesn't size wrapped text to its content, so estimate each block's height from its length.
function blockHeight(b: LegalBlock): number {
  const st = STYLE[b.kind]
  const width = LEGAL_W - LEGAL_PAD * 2 - 20 - (b.kind === 'li' ? 18 : 0)   // 20: scrollbar
  const perLine = Math.floor(width / (st.size * 0.53))
  return Math.max(1, Math.ceil((b.kind === 'li' ? b.text.length + 2 : b.text.length) / perLine)) * st.line
}

export const LegalPanel = () => {
  if (!legal) return null
  const doc = legal
  const title = doc.blocks.find(b => b.kind === 'h1')?.text ?? ''
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(LEGAL_W), flexDirection: 'column', padding: px(LEGAL_PAD) }} uiBackground={{ color: PANEL_BG }}>
        <UiEntity uiTransform={{ width: '100%', height: px(30), flexDirection: 'row', alignItems: 'center', margin: { bottom: px(12) } }}>
          <Label value={`GALAXY GARDENERS  //  ${title.toUpperCase()}`} fontSize={px(16)} color={CYAN} uiTransform={{ flexGrow: 1 }} textAlign="middle-left" />
          <UiEntity uiTransform={{ width: px(28), height: px(28), justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: SLOT_BG }}
            onMouseDown={() => { legal = null }}>
            <Label value="X" fontSize={px(13)} color={CYAN} />
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: px(SCROLL_H), flexDirection: 'column', overflow: 'scroll' }}>
          {doc.blocks.filter(b => b.kind !== 'h1').map((b, i) => {
            const st = STYLE[b.kind]
            return (
              <UiEntity key={`legal${i}`} uiTransform={{ width: '100%', height: px(blockHeight(b)), margin: { bottom: px(st.gap) }, padding: { left: px(b.kind === 'li' ? 18 : 0), right: px(20) }, flexShrink: 0 }}
                uiText={{ value: b.kind === 'li' ? `• ${b.text}` : b.text, fontSize: px(st.size), color: st.color, textAlign: 'top-left', textWrap: 'wrap' }} />
            )
          })}
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: px(30), flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', margin: { top: px(12) } }}>
          <UiEntity uiTransform={{ height: px(28), padding: { left: px(14), right: px(14) }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: SLOT_BG }}
            onMouseDown={() => { openLink(doc.url) }}>
            <Label value="VIEW ON GALAXYGARDENERS.APP" fontSize={px(12)} color={DIM} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
