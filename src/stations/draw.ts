// Galaxy Gardeners — Station drawing helpers
// Implements the concept art's visual language once: dark glass frames with thin cyan borders,
// icon + title + subtitle headers, cyan bars, outline/primary buttons, category tiles, list rows.
// All helpers draw children of a screen root in screen coordinates (x right, y up, -z toward viewer).
import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, TextShape, TextAlignMode, InputAction, pointerEventsSystem, ColliderLayer, GltfContainer } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'

export type Bag = Entity[]

export const CYAN3 = Color3.create(0, 0.9, 1)
export const CYAN = Color4.create(0, 0.9, 1, 1)
export const MAGENTA3 = Color3.create(1, 0.25, 0.8)
export const MAGENTA = Color4.create(1, 0.25, 0.8, 1)
export const WHITE = Color4.create(0.92, 0.95, 1, 1)
export const DIM = Color4.create(0.45, 0.65, 0.75, 1)
export const MUTED = Color4.create(0.35, 0.45, 0.55, 1)
export const GREEN3 = Color3.create(0.2, 1, 0.6)
export const GREEN = Color4.create(0.2, 1, 0.6, 1)
export const RED3 = Color3.create(1, 0.35, 0.35)
export const RED = Color4.create(1, 0.35, 0.35, 1)
const GLASS_FILL = Color4.create(0.02, 0.05, 0.12, 0.55)
const TRACK_FILL = Color4.create(0.05, 0.12, 0.2, 0.9)

// Textured planes: the old ship display rotated its icons 180° to read from -z. If images render
// mirrored in the preview, change this to fromEulerDegrees(0, 0, 0).
const IMAGE_ROT = Quaternion.fromEulerDegrees(0, 180, 0)

export function clearBag(bag: Bag): void { for (const e of bag) engine.removeEntity(e); bag.length = 0 }

/** Makes any box-shaped entity (a frame's fill, a button) respond to pointer clicks. */
export function clickable(e: Entity, hover: string, onClick: () => void): void {
  MeshCollider.setBox(e)
  pointerEventsSystem.onPointerDown({ entity: e, opts: { button: InputAction.IA_POINTER, hoverText: hover, maxDistance: 10 } }, onClick)
}

export function text(into: Bag, root: Entity, x: number, y: number, str: string, size: number, color: Color4 = WHITE, align: TextAlignMode = TextAlignMode.TAM_MIDDLE_CENTER, z: number = -0.04): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, z), parent: root })
  TextShape.create(e, { text: str, fontSize: size, textColor: color, textAlign: align })
  into.push(e)
  return e
}

function box(into: Bag, root: Entity, x: number, y: number, z: number, w: number, h: number, fill: Color4, emissive?: Color3, emissiveIntensity: number = 0): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, z), scale: Vector3.create(w, h, 0.01), parent: root })
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, { albedoColor: fill, emissiveColor: emissive ?? Color3.Black(), emissiveIntensity, metallic: 0.2, roughness: 0.8, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  into.push(e)
  return e
}

/** Glass panel with four thin emissive border strips. Returns the fill entity. */
export function frame(into: Bag, root: Entity, x: number, y: number, w: number, h: number, opts: { border?: Color3; borderWidth?: number; fill?: Color4; z?: number } = {}): Entity {
  const z = opts.z ?? -0.01
  const bw = opts.borderWidth ?? 0.02
  const border = opts.border ?? CYAN3
  const borderFill = Color4.create(border.r, border.g, border.b, 1)
  const fill = box(into, root, x, y, z, w, h, opts.fill ?? GLASS_FILL)
  box(into, root, x, y + h / 2, z - 0.005, w, bw, borderFill, border, 2)
  box(into, root, x, y - h / 2, z - 0.005, w, bw, borderFill, border, 2)
  box(into, root, x - w / 2, y, z - 0.005, bw, h, borderFill, border, 2)
  box(into, root, x + w / 2, y, z - 0.005, bw, h, borderFill, border, 2)
  return fill
}

/** Progress bar: dark track with a filled portion from the left. pct is clamped to 0..1. */
export function bar(into: Bag, root: Entity, x: number, y: number, w: number, pct: number, opts: { h?: number; color?: Color3; z?: number } = {}): void {
  const h = opts.h ?? 0.12
  const z = opts.z ?? -0.03
  const c = opts.color ?? CYAN3
  const p = Math.max(0, Math.min(1, isFinite(pct) ? pct : 0))
  box(into, root, x, y, z, w, h, TRACK_FILL)
  const fw = Math.max(0.01, p * w)
  box(into, root, x - (w - fw) / 2, y, z - 0.005, fw, h * 0.7, Color4.create(c.r, c.g, c.b, 1), c, 2.5)
}

/** Tinted glyph from a white-on-transparent PNG. */
export function icon(into: Bag, root: Entity, x: number, y: number, size: number, src: string, opts: { color?: Color3; z?: number } = {}): Entity {
  const c = opts.color ?? CYAN3
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, opts.z ?? -0.04), scale: Vector3.create(size, size, 1), rotation: IMAGE_ROT, parent: root })
  MeshRenderer.setPlane(e)
  Material.setPbrMaterial(e, { texture: Material.Texture.Common({ src }), emissiveTexture: Material.Texture.Common({ src }), albedoColor: Color4.create(c.r, c.g, c.b, 1), emissiveColor: c, emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  into.push(e)
  return e
}

/** Left-aligned section header: optional icon, cyan title, dim uppercase subtitle underneath. */
export function header(into: Bag, root: Entity, x: number, y: number, opts: { icon?: string; title: string; subtitle?: string; size?: number }): void {
  const size = opts.size ?? 0.9
  let tx = x
  if (opts.icon) { icon(into, root, x + size * 0.28, y, size * 0.5, opts.icon); tx = x + size * 0.65 }
  text(into, root, tx, y + (opts.subtitle ? 0.06 : 0), opts.title, size, CYAN, TextAlignMode.TAM_MIDDLE_LEFT)
  if (opts.subtitle) text(into, root, tx, y - size * 0.32, opts.subtitle.toUpperCase(), size * 0.36, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
}

/** Clickable button. 'outline' = dark fill + cyan border + cyan text; 'primary' = bright cyan fill + dark text;
 *  'magenta' = magenta border/text; 'disabled' = muted, not clickable. */
export function button(into: Bag, root: Entity, x: number, y: number, w: number, h: number, label: string, hover: string, onClick: () => void, opts: { variant?: 'outline' | 'primary' | 'magenta' | 'disabled'; size?: number; icon?: string; z?: number } = {}): Entity {
  const variant = opts.variant ?? 'outline'
  const z = opts.z ?? -0.03
  const size = opts.size ?? 0.42
  const accent = variant === 'magenta' ? MAGENTA3 : variant === 'disabled' ? Color3.create(0.3, 0.38, 0.45) : CYAN3
  const fill = variant === 'primary' ? Color4.create(accent.r, accent.g, accent.b, 1) : Color4.create(0.02, 0.06, 0.12, 0.95)
  const btn = frame(into, root, x, y, w, h, { border: accent, fill, z })
  const labelColor = variant === 'primary' ? Color4.create(0.02, 0.05, 0.1, 1) : variant === 'disabled' ? MUTED : Color4.create(accent.r, accent.g, accent.b, 1)
  let lx = x
  if (opts.icon) { icon(into, root, x - w / 2 + h * 0.6, y, h * 0.6, opts.icon, { color: variant === 'primary' ? Color3.create(0.02, 0.05, 0.1) : accent, z: z - 0.01 }); lx = x + h * 0.3 }
  text(into, root, lx, y, label, size, labelColor, TextAlignMode.TAM_MIDDLE_CENTER, z - 0.01)
  if (variant !== 'disabled') clickable(btn, hover, onClick)
  return btn
}

/** Category card: icon on top, title, subtitle. Selected cards get a bright border. */
export function tile(into: Bag, root: Entity, x: number, y: number, w: number, h: number, opts: { icon?: string; title: string; subtitle?: string; selected?: boolean; hover: string; onClick: () => void }): void {
  const border = opts.selected ? CYAN3 : Color3.create(0.1, 0.35, 0.45)
  const fill = opts.selected ? Color4.create(0.02, 0.12, 0.2, 0.8) : GLASS_FILL
  const f = frame(into, root, x, y, w, h, { border, borderWidth: opts.selected ? 0.035 : 0.02, fill })
  if (opts.icon) icon(into, root, x, y + h * 0.15, h * 0.42, opts.icon, { color: opts.selected ? CYAN3 : Color3.create(0.2, 0.55, 0.7) })
  text(into, root, x, y - h * 0.24, opts.title.toUpperCase(), 0.5, opts.selected ? CYAN : DIM)
  if (opts.subtitle) text(into, root, x, y - h * 0.38, opts.subtitle.toUpperCase(), 0.28, opts.selected ? DIM : MUTED)
  clickable(f, opts.hover, opts.onClick)
}

/** Selectable list row with optional thumbnail on the left. */
export function listRow(into: Bag, root: Entity, x: number, y: number, w: number, h: number, opts: { label: string; sublabel?: string; selected?: boolean; hover: string; onClick: () => void; imageSrc?: string | null }): void {
  const border = opts.selected ? CYAN3 : Color3.create(0.1, 0.3, 0.4)
  const fill = opts.selected ? Color4.create(0.02, 0.2, 0.3, 0.9) : Color4.create(0.02, 0.05, 0.12, 0.6)
  const f = frame(into, root, x, y, w, h, { border, fill })
  let lx = x - w / 2 + 0.12
  if (opts.imageSrc) { image(into, root, x - w / 2 + h * 0.55, y, h * 0.8, h * 0.8, opts.imageSrc, { z: -0.03 }); lx = x - w / 2 + h * 1.1 }
  text(into, root, lx, y + (opts.sublabel ? 0.05 : 0), opts.label, 0.36, opts.selected ? WHITE : DIM, TextAlignMode.TAM_MIDDLE_LEFT)
  if (opts.sublabel) text(into, root, lx, y - 0.08, opts.sublabel, 0.26, MUTED, TextAlignMode.TAM_MIDDLE_LEFT)
  if (opts.selected) text(into, root, x + w / 2 - 0.12, y, '›', 0.5, CYAN, TextAlignMode.TAM_MIDDLE_RIGHT)
  clickable(f, opts.hover, opts.onClick)
}

/** Untinted textured plane (species images). */
export function image(into: Bag, root: Entity, x: number, y: number, w: number, h: number, src: string, opts: { z?: number } = {}): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, opts.z ?? -0.04), scale: Vector3.create(w, h, 1), rotation: IMAGE_ROT, parent: root })
  MeshRenderer.setPlane(e)
  Material.setBasicMaterial(e, { texture: Material.Texture.Common({ src }) })
  into.push(e)
  return e
}

// Slowly yawing GLB "hologram". One shared system drives every live hologram.
const spinning: Entity[] = []
let spinSystemAdded = false
function spinSystem(dt: number): void {
  for (let i = spinning.length - 1; i >= 0; i--) {
    const t = Transform.getMutableOrNull(spinning[i])
    if (!t) { spinning.splice(i, 1); continue }
    t.rotation = Quaternion.multiply(t.rotation, Quaternion.fromEulerDegrees(0, 12 * dt, 0))
  }
}
export function hologram(into: Bag, root: Entity, x: number, y: number, src: string, scale: number, opts: { z?: number; spin?: boolean } = {}): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, opts.z ?? -0.15), scale: Vector3.create(scale, scale, scale), parent: root })
  GltfContainer.create(e, { src })
  into.push(e)
  if (opts.spin !== false) { spinning.push(e); if (!spinSystemAdded) { engine.addSystem(spinSystem); spinSystemAdded = true } }
  return e
}
