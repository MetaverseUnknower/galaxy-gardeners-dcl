// "Cabin lights down" at the Stellar Navigation console: the other stations' screens are the light in the room, so
// a dark shade fades in over each screen face (as if they'd gone to standby) while the player is at the console,
// letting the hologram carry the room. Shades have no collider, so they never block clicks.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { isAtConsole, getCameraMode } from './consoleCamera'

const MAX_SHADE = 0.82
const FADE_PER_SECOND = 1.1
const MARGIN = 0.15          // shade overhangs the screen content a little on every side
const SHADE_Z = -0.1         // in front of all screen content (drawn between z -0.01 and -0.06)

type Shade = { root: Entity; shade: Entity; w: number; h: number; cy: number }
const shades: Shade[] = []
let level = 0
let shownAlpha = -1

/** Shade a screen root whose content spans ±halfW × ±halfH around (0, centerY) in its own plane. */
export function registerDimmableScreen(root: Entity, halfW: number, halfH: number, centerY: number = 0): void {
  const shade = engine.addEntity()
  MeshRenderer.setPlane(shade)
  Transform.create(shade, { parent: root, position: Vector3.create(0, centerY, SHADE_Z), scale: Vector3.Zero() })
  shades.push({ root, shade, w: halfW * 2 + MARGIN * 2, h: halfH * 2 + MARGIN * 2, cy: centerY })
  shownAlpha = -1
}

engine.addSystem((dt: number) => {
  // Drop shades whose screen was rebuilt (the discovery desk recreates its roots).
  for (let i = shades.length - 1; i >= 0; i--) {
    if (!Transform.has(shades[i].root)) { engine.removeEntity(shades[i].shade); shades.splice(i, 1) }
  }
  const want = isAtConsole() && getCameraMode() !== 'top' ? 1 : 0
  level = want > level ? Math.min(want, level + dt * FADE_PER_SECOND) : Math.max(want, level - dt * FADE_PER_SECOND)
  const alpha = MAX_SHADE * level * level * (3 - 2 * level)
  if (Math.abs(alpha - shownAlpha) < 0.005) return
  shownAlpha = alpha
  for (const s of shades) {
    const t = Transform.getMutable(s.shade)
    t.scale = alpha > 0.001 ? Vector3.create(s.w, s.h, 1) : Vector3.Zero()
    Material.setPbrMaterial(s.shade, { albedoColor: Color4.create(0, 0.004, 0.012, alpha), emissiveColor: Color3.Black(), metallic: 0, roughness: 1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false })
  }
})
