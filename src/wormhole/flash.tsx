// Wormhole cutscene overlay: the white flash, and while a cutscene plays, a click anywhere skips it.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../uiScale'
import { flashAlpha, isCutscenePlaying, skipCutscene } from './cutscene'

export const WormholeOverlay = () => {
  const a = flashAlpha()
  const playing = isCutscenePlaying()
  if (a <= 0.001 && !playing) return null
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 }, justifyContent: 'flex-end', alignItems: 'flex-end' }}
      uiBackground={{ color: Color4.create(1, 1, 1, a) }}
      onMouseDown={() => { if (isCutscenePlaying()) skipCutscene() }}>
      {playing ? <Label value="CLICK TO SKIP" fontSize={px(12)} color={Color4.create(0.75, 0.45, 1, 0.9)} uiTransform={{ margin: { right: px(30), bottom: px(90) } }} /> : null}
    </UiEntity>
  )
}
