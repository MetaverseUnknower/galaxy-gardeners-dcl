// Hides every other player's avatar inside the ship so the interior reads as your own vessel.
// Visual only: other players are still present in the world, in voice and chat, and at the consoles.
import { engine, Transform, AvatarModifierArea, AvatarModifierType } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { getUserData } from '~system/UserIdentity'
import { PLATFORM_Y } from './environment'

// Covers the whole hull (about 34m across, 19m tall) with margin.
const AREA_CENTER = Vector3.create(128, PLATFORM_Y + 8, 128)
const AREA_SIZE = Vector3.create(44, 30, 44)

export async function setupSoloShip(): Promise<void> {
  let selfId = ''
  try { const me = await getUserData({}); selfId = me.data?.userId ?? '' } catch { /* keep everyone visible if identity is unavailable */ }
  if (!selfId) return
  const area = engine.addEntity()
  Transform.create(area, { position: AREA_CENTER })
  AvatarModifierArea.create(area, { area: AREA_SIZE, modifiers: [AvatarModifierType.AMT_HIDE_AVATARS], excludeIds: [selfId] })
}
