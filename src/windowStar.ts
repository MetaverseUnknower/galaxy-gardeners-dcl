// The local star, seen through the bridge window: a billboarded sprite well outside the south window (inside the
// skybox), matching the current system's star type. Uses the same sprites as sleep mode so both views agree.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { STAR_SPRITES, MILKY_WAY } from './sleepMode'
import { StarSystem } from './types'
import { hideInTopView } from './topViewHide'
import { getTravelDestination, getTravelFraction } from './navigation'

// Window glass spans roughly x 119..137, y 37..52, z 111..114 in world space (south wall of the interior model;
// looking out, +x is to the viewer's left).
const STAR_POSITION = Vector3.create(128, 46, 58)   // 70m south of the ship centre; the skybox radius is ~88m
const SIZE_PER_UNIT = 90                             // sprite size (fraction of the sleep view) → metres at this distance

const MIN_TRAVEL_FRACTION = 0.06   // a distant speck at departure, still findable in the window

// Galaxy band in transit: straight ahead when heading for the core, off to the side when travelling laterally,
// gone when heading outward. Behind the star (farther out), height set by distance from the galactic plane.
const BAND_Z = 48                  // 80m out, just inside the skybox
const BAND_WIDTH = 70
const BAND_SIDE_OFFSET = 34        // metres of sideways shift at 90° off the core
const BAND_ALPHA = 0.45
const BAND_VISIBLE_DEG = 115       // fades out between 90° and this

let entity: Entity | null = null
let band: Entity | null = null
let bandAlpha = -1
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
/** Signed angle (degrees) from the heading to the galactic core, in the galactic plane; positive = core to the left. */
function coreBearing(from: StarSystem, to: StarSystem): number {
  const hx = to.coord_x - from.coord_x, hy = to.coord_y - from.coord_y
  const cx = -from.coord_x, cy = -from.coord_y
  if (Math.hypot(hx, hy) < 1e-6 || Math.hypot(cx, cy) < 1e-6) return 0
  return Math.atan2(hx * cy - hy * cx, hx * cx + hy * cy) * 180 / Math.PI
}

function updateBand(dest: StarSystem | null, frac: number): void {
  const bearing = dest && current ? coreBearing(current, dest) : 180
  const off = Math.abs(bearing)
  const alpha = off <= 90 ? BAND_ALPHA : off >= BAND_VISIBLE_DEG ? 0 : BAND_ALPHA * (BAND_VISIBLE_DEG - off) / (BAND_VISIBLE_DEG - 90)
  if (alpha <= 0) {
    if (band) { engine.removeEntity(band); band = null; bandAlpha = -1 }
    return
  }
  if (!band) {
    band = engine.addEntity()
    MeshRenderer.setPlane(band)
    Billboard.create(band, { billboardMode: BillboardMode.BM_ALL })
    hideInTopView(band)
  }
  // Height: above the plane you look down on the disc, so the band sits lower (same rule as sleep mode).
  const z = current && dest ? current.coord_z + (dest.coord_z - current.coord_z) * frac : 0
  const y = STAR_POSITION.y - Math.max(-1, Math.min(1, z / 25)) * 10
  const x = STAR_POSITION.x + Math.max(-1, Math.min(1, bearing / 90)) * BAND_SIDE_OFFSET   // +x is the viewer's left
  const h = BAND_WIDTH / MILKY_WAY.aspect
  const t = Transform.getMutableOrNull(band)
  if (!t) Transform.create(band, { position: Vector3.create(x, y, BAND_Z), scale: Vector3.create(BAND_WIDTH, h, 1) })
  else if (!(t.scale.x === 0 && t.scale.y === 0)) { t.position = Vector3.create(x, y, BAND_Z); t.scale = Vector3.create(BAND_WIDTH, h, 1) }
  if (Math.abs(alpha - bandAlpha) < 0.01) return
  bandAlpha = alpha
  Material.setPbrMaterial(band, {
    texture: Material.Texture.Common({ src: MILKY_WAY.src }),
    emissiveTexture: Material.Texture.Common({ src: MILKY_WAY.src }),
    albedoColor: Color4.create(1, 1, 1, alpha),
    emissiveColor: Color3.create(alpha, alpha, alpha),
    emissiveIntensity: 1.5,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  })
}

function windowStarSystem(): void {
  if (!entity) return
  const dest = getTravelDestination()
  const sprite = spriteFor(dest ?? current)
  const frac = getTravelFraction()
  const growth = dest ? Math.max(MIN_TRAVEL_FRACTION, frac) : 1
  updateBand(dest, frac)
  applySprite(sprite)
  const size = sprite.size * SIZE_PER_UNIT * growth
  const t = Transform.getMutableOrNull(entity)
  if (!t) { Transform.create(entity, { position: STAR_POSITION, scale: Vector3.create(size, size, 1) }); return }
  if (t.scale.x === 0 && t.scale.y === 0) return   // hidden for the top view; leave it hidden
  t.position = STAR_POSITION
  t.scale = Vector3.create(size, size, 1)
}
