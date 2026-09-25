// The local star, seen through the bridge window: a billboarded sprite well outside the north window (inside the
// skybox), matching the current system's star type. Uses the same sprites as sleep mode so both views agree.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { STAR_SPRITES } from './sleepMode'
import { StarSystem } from './types'
import { hideInTopView } from './topViewHide'
import { getTravelDestination, getTravelFraction } from './navigation'

// Window glass spans roughly x 119..137, y 37..52, z 111..114 in world space (north wall of the interior model).
const STAR_POSITION = Vector3.create(128, 46, 58)   // 70m north of the ship centre; the skybox radius is ~88m
const SIZE_PER_UNIT = 90                             // sprite size (fraction of the sleep view) → metres at this distance

const MIN_TRAVEL_FRACTION = 0.06   // a distant speck at departure, still findable in the window

let entity: Entity | null = null
let current: StarSystem | null = null
let shownSrc = ''

/** The system we're in; while travelling the window follows the destination instead. */
export function setWindowStarSystem(system: StarSystem | null): void {
  current = system
  if (!entity) {
    entity = engine.addEntity()
    MeshRenderer.setPlane(entity)
    Billboard.create(entity, { billboardMode: BillboardMode.BM_ALL })
    hideInTopView(entity)   // the top camera's black backdrop view should stay clean
    engine.addSystem(windowStarSystem)
  }
  windowStarSystem()
}

function spriteFor(system: StarSystem | null) { return STAR_SPRITES[system?.star_type ?? ''] ?? STAR_SPRITES.yellow_star }

function applySprite(sprite: { src: string; tint: [number, number, number] }): void {
  if (!entity || sprite.src + sprite.tint.join() === shownSrc) return
  shownSrc = sprite.src + sprite.tint.join()
  const tint = Color3.create(sprite.tint[0], sprite.tint[1], sprite.tint[2])
  Material.setPbrMaterial(entity, {
    texture: Material.Texture.Common({ src: sprite.src }),
    emissiveTexture: Material.Texture.Common({ src: sprite.src }),
    albedoColor: Color4.create(tint.r, tint.g, tint.b, 1),
    emissiveColor: tint,
    emissiveIntensity: 2,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  })
}

/** Home star at full size; in transit, the destination star grown in proportion to the distance covered. */
function windowStarSystem(): void {
  if (!entity) return
  const dest = getTravelDestination()
  const sprite = spriteFor(dest ?? current)
  const growth = dest ? Math.max(MIN_TRAVEL_FRACTION, getTravelFraction()) : 1
  applySprite(sprite)
  const size = sprite.size * SIZE_PER_UNIT * growth
  const t = Transform.getMutableOrNull(entity)
  if (!t) { Transform.create(entity, { position: STAR_POSITION, scale: Vector3.create(size, size, 1) }); return }
  if (t.scale.x === 0 && t.scale.y === 0) return   // hidden for the top view; leave it hidden
  t.position = STAR_POSITION
  t.scale = Vector3.create(size, size, 1)
}
