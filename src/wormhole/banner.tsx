// The wormhole banner: which system it opens to, how long it stays open, and JUMP / RETURN.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../uiScale'
import { wormholeEvent, closesInText, jumpThroughWormhole, returnThroughWormhole, isWormholeBusy, podWarning } from './state'
import { isViewingRemoteSystem } from '../systemView'

const VIOLET = Color4.create(0.75, 0.45, 1, 1)
const AMBER = Color4.create(1, 0.72, 0.2, 1)
const DIM = Color4.create(0.45, 0.65, 0.75, 1)
const BG = Color4.create(0.05, 0.02, 0.12, 0.92)
const DARK = Color4.create(0.05, 0.02, 0.1, 1)
const GREY = Color4.create(0.15, 0.15, 0.2, 1)

export const WormholeBanner = () => {
  const ev = wormholeEvent()
  if (!ev) return null
  const busy = isWormholeBusy()
  const returning = ev.canReturn
  const enabled = !busy && (returning || ev.canJump)
  const label = busy ? 'JUMPING…' : returning ? `RETURN TO ${(ev.trip?.originName ?? 'ORIGIN').toUpperCase()}` : 'JUMP'
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: px(isViewingRemoteSystem() ? 70 : 20) }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', padding: px(8) }} uiBackground={{ color: BG }}>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
          <Label value={`WORMHOLE OPEN TO ${ev.targetName.toUpperCase()}  ·  CLOSES IN ${closesInText()}`} fontSize={px(15)} color={VIOLET} uiTransform={{ margin: { left: px(10), right: px(14) } }} />
          <UiEntity uiTransform={{ height: px(32), padding: { left: px(14), right: px(14) }, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: enabled ? VIOLET : GREY }}
            onMouseDown={() => { if (!enabled) return; void (returning ? returnThroughWormhole() : jumpThroughWormhole()) }}>
            <Label value={label} fontSize={px(13)} color={enabled ? DARK : DIM} />
          </UiEntity>
        </UiEntity>
        {!returning && !ev.canJump && ev.jumpBlockedReason ? <Label value={ev.jumpBlockedReason} fontSize={px(12)} color={DIM} uiTransform={{ margin: { top: px(4) } }} /> : null}
        {returning && ev.podsOut > 0 ? <Label value={podWarning(ev.podsOut)} fontSize={px(12)} color={AMBER} uiTransform={{ margin: { top: px(4) } }} /> : null}
      </UiEntity>
    </UiEntity>
  )
}
