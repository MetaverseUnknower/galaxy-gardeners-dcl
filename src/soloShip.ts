// Hides every other player's avatar inside the ship so the interior reads as your own vessel.
// Visual only: other players are still present in the world, in voice and chat, and at the consoles.
// Guides (guide.tsx) can be revealed to a player, and a guide can turn the hiding off to see everyone.
import { engine, Entity, Transform, AvatarModifierArea, AvatarModifierType } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { getUserData } from '~system/UserIdentity'
import { PLATFORM_Y } from './environment'

// Covers the whole hull (about 34m across, 19m tall) with margin.
const AREA_CENTER = Vector3.create(128, PLATFORM_Y + 8, 128)
const AREA_SIZE = Vector3.create(44, 30, 44)

let area: Entity | null = null
let selfId = ''
let solo = true
let alsoVisible: string[] = []

function apply(): void {
  if (!area) return
  if (!solo) { AvatarModifierArea.deleteFrom(area); return }
  // Addresses can arrive in either case; list both so the match doesn't depend on it
  const ids = [selfId, ...alsoVisible].flatMap(id => [id, id.toLowerCase()])
  AvatarModifierArea.createOrReplace(area, { area: AREA_SIZE, modifiers: [AvatarModifierType.AMT_HIDE_AVATARS], excludeIds: Array.from(new Set(ids)) })
}

export async function setupSoloShip(): Promise<void> {
  try { const me = await getUserData({}); selfId = me.data?.userId ?? '' } catch { /* keep everyone visible if identity is unavailable */ }
  if (!selfId) return
  area = engine.addEntity()
  Transform.create(area, { position: AREA_CENTER })
  apply()
}

/** Players who stay visible inside the ship besides yourself (guides revealed to you). */
export function setAlsoVisible(ids: string[]): void {
  alsoVisible = ids
  apply()
}

/** false shows everyone in the ship (a guide's SEE CREW view). */
export function setSolo(on: boolean): void {
  solo = on
  apply()
}
