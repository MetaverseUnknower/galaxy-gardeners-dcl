// The local star, seen through the bridge window: a billboarded sprite well outside the north window (inside the
// skybox), matching the current system's star type. Uses the same sprites as sleep mode so both views agree.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { STAR_SPRITES } from './sleepMode'
import { StarSystem } from './types'
import { hideInTopView } from './topViewHide'

// Window glass spans roughly x 119..137, y 37..52, z 111..114 in world space (north wall of the interior model).
const STAR_POSITION = Vector3.create(128, 46, 58)   // 70m north of the ship centre; the skybox radius is ~88m
const SIZE_PER_UNIT = 90                             // sprite size (fraction of the sleep view) → metres at this distance

let entity: Entity | null = null

export function setWindowStarSystem(system: StarSystem | null): void {
  const sprite = STAR_SPRITES[system?.star_type ?? ''] ?? STAR_SPRITES.yellow_star
  if (!entity) {
    entity = engine.addEntity()
    MeshRenderer.setPlane(entity)
    Billboard.create(entity, { billboardMode: BillboardMode.BM_ALL })
  }
  const size = sprite.size * SIZE_PER_UNIT
  Transform.createOrReplace(entity, { position: STAR_POSITION, scale: Vector3.create(size, size, 1) })
  hideInTopView(entity)   // the top camera's black backdrop view should stay clean
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
