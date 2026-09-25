// Search effects outside the bridge window while a star discovery is running: laser beams sweeping the sky from
// a scanner on the hull below the window, and a sonar-style ping ring expanding outward.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getDiscoveryScan } from './discoveryPanel'
import { hideInTopView } from './topViewHide'

// Outside the south window (glass at z 111..114, x 119..137, y 37..52); the view looks toward -z.
const EMITTER = Vector3.create(128, 38.5, 108)
const BEAM_LENGTH = 70
const BEAMS = [
  { color: Color3.create(1, 0.2, 0.8), speed: 0.23, phase: 0, yawSpan: 38, pitch: [8, 34] as const },
  { color: Color3.create(0, 0.9, 1), speed: 0.17, phase: 2.1, yawSpan: 30, pitch: [14, 42] as const },
  { color: Color3.create(0.6, 0.3, 1), speed: 0.31, phase: 4.0, yawSpan: 44, pitch: [4, 26] as const },
]
const PING_SECONDS = 3.2
const PING_MAX_RADIUS = 34
const PING_CENTER = Vector3.create(128, 46, 52)   // behind the local star (z 58), in front of the galaxy band (z 48)

let beams: Entity[] = []
let ping: Entity | null = null
let t = 0

function setupEffects(): void {
  for (const b of BEAMS) {
    const e = engine.addEntity()
    MeshRenderer.setCylinder(e, 0.3, 1)   // thin at the emitter, spreading with distance
    Material.setPbrMaterial(e, { albedoColor: Color4.create(b.color.r, b.color.g, b.color.b, 0.35), emissiveColor: b.color, emissiveIntensity: 4, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false })
    Transform.create(e, { position: EMITTER, scale: Vector3.create(0.12, BEAM_LENGTH, 0.12) })
    hideInTopView(e)
    beams.push(e)
  }
  ping = engine.addEntity()
  MeshRenderer.setCylinder(ping)
  Transform.create(ping, { position: PING_CENTER, rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.create(1, 0.02, 1) })
  hideInTopView(ping)
}

function teardown(): void {
  for (const e of beams) engine.removeEntity(e)
  beams = []
  if (ping) { engine.removeEntity(ping); ping = null }
}

engine.addSystem((dt: number) => {
  const scanning = getDiscoveryScan() !== null
  if (!scanning) { if (beams.length) teardown(); return }
  if (!beams.length) { setupEffects(); t = 0 }
  t += dt

  BEAMS.forEach((b, i) => {
    const tr = Transform.getMutableOrNull(beams[i])
    if (!tr || (tr.scale.x === 0 && tr.scale.y === 0)) return   // hidden for the top view
    const yaw = Math.sin(t * b.speed * Math.PI * 2 + b.phase) * b.yawSpan * Math.PI / 180
    const pitchDeg = b.pitch[0] + (b.pitch[1] - b.pitch[0]) * (0.5 + 0.5 * Math.sin(t * b.speed * 1.7 + b.phase * 1.3))
    const p = pitchDeg * Math.PI / 180
    const dir = Vector3.create(Math.sin(yaw) * Math.cos(p), Math.sin(p), -Math.cos(yaw) * Math.cos(p))
    tr.rotation = Quaternion.fromToRotation(Vector3.Up(), dir)
    tr.position = Vector3.add(EMITTER, Vector3.scale(dir, BEAM_LENGTH / 2))
  })

  if (ping) {
    const tr = Transform.getMutableOrNull(ping)
    if (tr && !(tr.scale.x === 0 && tr.scale.z === 0)) {
      const k = (t % PING_SECONDS) / PING_SECONDS
      const r = 1 + k * PING_MAX_RADIUS
      tr.scale = Vector3.create(r * 2, 0.02, r * 2)
      const a = 0.28 * (1 - k)
      Material.setPbrMaterial(ping, { albedoColor: Color4.create(0, 0.9, 1, a), emissiveColor: Color3.create(0, 0.9 * (1 - k), 1 - k), emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false })
    }
  }
})
