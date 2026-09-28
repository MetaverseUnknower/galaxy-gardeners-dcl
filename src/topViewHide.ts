// Entities that should vanish while the top-down map view is active (screens and desks that would
// stand above the black backdrop). Kept import-free so any module can register without cycles.
import { Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

const hidden = new Map<Entity, Vector3>()
const registered = new Set<Entity>()

export function hideInTopView(entity: Entity): void { registered.add(entity) }
/** True while the top-down view has the registered screens hidden. */
export function isTopViewHiding(): boolean { return hidden.size > 0 }

export function setTopViewHidden(on: boolean): void {
  if (on) {
    for (const e of registered) {
      if (hidden.has(e)) continue
      const t = Transform.getMutableOrNull(e)
      if (!t) { registered.delete(e); continue }
      hidden.set(e, Vector3.create(t.scale.x, t.scale.y, t.scale.z))
      t.scale = Vector3.create(0, 0, 0)
    }
  } else {
    for (const [e, scale] of hidden) {
      const t = Transform.getMutableOrNull(e)
      if (t) t.scale = scale
    }
    hidden.clear()
  }
}
