// The STEM terminal dialog for the ship tour: STEM's current line, an optional data panel above it,
// and NEXT / SKIP TOUR (or the skip confirmation, or the one-time tour offer).
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../uiScale'

export type DialogState = { lines: string[]; index: number; panel?: { title: string; text: string }; waiting: boolean; busy: boolean; last: boolean; confirmSkip: boolean; offer: boolean }
export type DialogHandlers = { next(): void; moveOn(): void; skip(): void; confirmSkip(yes: boolean): void; offer(yes: boolean): void }

let state: DialogState | null = null
let handlers: DialogHandlers | null = null
export function setTourDialog(s: DialogState | null, h: DialogHandlers | null): void { state = s; handlers = h }

const CYAN = Color4.create(0, 0.9, 1, 1)
const MAGENTA = Color4.create(1, 0.25, 0.85, 1)
const DIM = Color4.create(0.45, 0.65, 0.75, 1)
const BG = Color4.create(0.02, 0.05, 0.12, 0.94)
const SLOT = Color4.create(0.05, 0.12, 0.2, 1)
const DARK = Color4.create(0.02, 0.05, 0.1, 1)
const W = 900

// A plain function (not a component) so it can carry a key: ReactEcs components don't accept one.
function btn(key: string, label: string, onClick: () => void, primary: boolean = false, color: Color4 = CYAN) {
  return (
    <UiEntity key={key} uiTransform={{ height: px(34), padding: { left: px(18), right: px(18) }, margin: { left: px(8) }, justifyContent: 'center', alignItems: 'center' }}
      uiBackground={{ color: primary ? color : SLOT }} onMouseDown={onClick}>
      <Label value={label} fontSize={px(13)} color={primary ? DARK : color} />
    </UiEntity>
  )
}

export const TourDialog = () => {
  if (!state || !handlers) return null
  const s = state, h = handlers
  const line = s.lines[s.index] ?? ''
  const finishing = s.last && s.index >= s.lines.length - 1
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { bottom: px(90) }, flexDirection: 'column', alignItems: 'center' }}>
      {s.panel ? (
        <UiEntity uiTransform={{ width: px(W), flexDirection: 'column', padding: px(14), margin: { bottom: px(8) } }} uiBackground={{ color: BG }}>
          <Label value={s.panel.title} fontSize={px(13)} color={MAGENTA} uiTransform={{ height: px(22) }} textAlign="middle-left" />
          <UiEntity uiTransform={{ width: '100%', height: px(22 * s.panel.text.split('\n').length) }}
            uiText={{ value: s.panel.text, fontSize: px(15), color: Color4.White(), textAlign: 'top-left', textWrap: 'wrap' }} />
        </UiEntity>
      ) : null}
      <UiEntity uiTransform={{ width: px(W), flexDirection: 'column', padding: px(16) }} uiBackground={{ color: BG }}>
        <Label value="STEM" fontSize={px(13)} color={CYAN} uiTransform={{ height: px(22) }} textAlign="middle-left" />
        <UiEntity uiTransform={{ width: '100%', height: px(88) }}
          uiText={{ value: line, fontSize: px(18), color: Color4.White(), textAlign: 'top-left', textWrap: 'wrap' }} />
        <UiEntity uiTransform={{ width: '100%', height: px(36), flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
          {s.offer ? btn('no', 'NO THANKS', () => h.offer(false)) : null}
          {s.offer ? btn('yes', 'TAKE TOUR', () => h.offer(true), true) : null}
          {!s.offer && s.confirmSkip ? <Label key="q" value="Skip the tour? Pods can be lost once the tour ends." fontSize={px(14)} color={DIM} uiTransform={{ flexGrow: 1 }} textAlign="middle-left" /> : null}
          {!s.offer && s.confirmSkip ? btn('stay', 'KEEP GOING', () => h.confirmSkip(false)) : null}
          {!s.offer && s.confirmSkip ? btn('skipyes', 'SKIP TOUR', () => h.confirmSkip(true), true, MAGENTA) : null}
          {!s.offer && !s.confirmSkip ? <Label key="w" value={s.waiting ? 'Waiting for you, Captain…' : ''} fontSize={px(14)} color={DIM} uiTransform={{ flexGrow: 1 }} textAlign="middle-left" /> : null}
          {!s.offer && !s.confirmSkip ? btn('skip', 'SKIP TOUR', () => h.skip(), false, MAGENTA) : null}
          {!s.offer && !s.confirmSkip && s.waiting ? btn('moveon', 'MOVE ON', () => h.moveOn()) : null}
          {!s.offer && !s.confirmSkip && !s.waiting && !s.busy ? btn('next', finishing ? 'FINISH' : 'NEXT', () => h.next(), true) : null}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
