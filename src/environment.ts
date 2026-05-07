import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, GltfContainer } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { movePlayerTo } from '~system/RestrictedActions'

const CENTER = Vector3.create(128, 80, 128)
const BOX_SIZE = 120
const PLATFORM_RADIUS = 20

export const PLATFORM_Y = 40

let seed = 777
function seededRandom(): number {
  seed = (seed * 16807 + 0) % 2147483647
  return (seed - 1) / 2147483646
}

export function createEnvironment(): void {
  seed = 777

  const half = BOX_SIZE / 2
  const black = {
    albedoColor: Color4.create(0.005, 0.005, 0.01, 1),
    emissiveColor: Color3.create(0, 0, 0),
    emissiveIntensity: 0,
    metallic: 0,
    roughness: 1,
    castShadows: false
  }

  const t = 0.1

  // Floor
  const floor = engine.addEntity()
  Transform.create(floor, { position: Vector3.create(CENTER.x, CENTER.y - half, CENTER.z), scale: Vector3.create(BOX_SIZE, t, BOX_SIZE) })
  MeshRenderer.setBox(floor)
  Material.setPbrMaterial(floor, black)

  // Ceiling
  const ceiling = engine.addEntity()
  Transform.create(ceiling, { position: Vector3.create(CENTER.x, CENTER.y + half, CENTER.z), scale: Vector3.create(BOX_SIZE, t, BOX_SIZE) })
  MeshRenderer.setBox(ceiling)
  Material.setPbrMaterial(ceiling, black)

  // North (-Z)
  const north = engine.addEntity()
  Transform.create(north, { position: Vector3.create(CENTER.x, CENTER.y, CENTER.z - half), scale: Vector3.create(BOX_SIZE, BOX_SIZE, t) })
  MeshRenderer.setBox(north)
  Material.setPbrMaterial(north, black)

  // South (+Z)
  const south = engine.addEntity()
  Transform.create(south, { position: Vector3.create(CENTER.x, CENTER.y, CENTER.z + half), scale: Vector3.create(BOX_SIZE, BOX_SIZE, t) })
  MeshRenderer.setBox(south)
  Material.setPbrMaterial(south, black)

  // East (+X)
  const east = engine.addEntity()
  Transform.create(east, { position: Vector3.create(CENTER.x + half, CENTER.y, CENTER.z), scale: Vector3.create(t, BOX_SIZE, BOX_SIZE) })
  MeshRenderer.setBox(east)
  Material.setPbrMaterial(east, black)

  // West (-X)
  const west = engine.addEntity()
  Transform.create(west, { position: Vector3.create(CENTER.x - half, CENTER.y, CENTER.z), scale: Vector3.create(t, BOX_SIZE, BOX_SIZE) })
  MeshRenderer.setBox(west)
  Material.setPbrMaterial(west, black)

  // Player platform
  const platform = engine.addEntity()
  Transform.create(platform, {
    position: Vector3.create(CENTER.x, PLATFORM_Y - 0.05, CENTER.z),
    scale: Vector3.create(PLATFORM_RADIUS * 2, 0.1, PLATFORM_RADIUS * 2)
  })
  MeshRenderer.setCylinder(platform)
  MeshCollider.setCylinder(platform)
  Material.setPbrMaterial(platform, {
    albedoColor: Color4.create(0.03, 0.03, 0.06, 1),
    emissiveColor: Color3.create(0, 0.05, 0.1),
    emissiveIntensity: 0.5,
    metallic: 0.9,
    roughness: 0.2
  })

  // Test model
  const testModel = engine.addEntity()
  Transform.create(testModel, {
    position: Vector3.create(128, PLATFORM_Y, 139),
    scale: Vector3.create(0.5, 0.5, 0.5),
    rotation: Quaternion.fromEulerDegrees(-90, 180, 0)
  })
  GltfContainer.create(testModel, { src: 'assets/models/display_screen_low_poly.glb' })

  // Platform edge ring glow
  const edgeSegments = 48
  for (let i = 0; i < edgeSegments; i++) {
    const angle = (i / edgeSegments) * Math.PI * 2
    const dot = engine.addEntity()
    Transform.create(dot, {
      position: Vector3.create(
        CENTER.x + Math.cos(angle) * PLATFORM_RADIUS,
        PLATFORM_Y + 0.02,
        CENTER.z + Math.sin(angle) * PLATFORM_RADIUS
      ),
      scale: Vector3.create(0.08, 0.03, 0.08)
    })
    MeshRenderer.setSphere(dot)
    Material.setPbrMaterial(dot, {
      albedoColor: Color4.create(0, 0.5, 0.8, 0.6),
      emissiveColor: Color3.create(0, 0.4, 0.6),
      emissiveIntensity: 2,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
  }

  // Starfield
  const starCount = 600
  interface SkyboxStar {
    entity: Entity
    color: Color3
    baseSize: number
    baseIntensity: number
    twinkleSpeed: number
    twinklePhase: number
  }

  for (let i = 0; i < starCount; i++) {
    const theta = seededRandom() * Math.PI * 2
    const phi = Math.acos(2 * seededRandom() - 1)
    const r = (BOX_SIZE / 2) * 0.95

    const x = CENTER.x + r * Math.sin(phi) * Math.cos(theta)
    const y = CENTER.y + r * Math.sin(phi) * Math.sin(theta)
    const z = CENTER.z + r * Math.cos(phi)

    const brightness = 0.3 + seededRandom() * 0.7
    const baseSize = 0.06 + seededRandom() * 0.18

    const colorRoll = seededRandom()
    let starColor: Color3
    if (colorRoll < 0.7) {
      starColor = Color3.create(brightness, brightness, brightness)
    } else if (colorRoll < 0.85) {
      starColor = Color3.create(brightness * 0.7, brightness * 0.8, brightness)
    } else {
      starColor = Color3.create(brightness, brightness * 0.85, brightness * 0.6)
    }

    const baseIntensity = 3 + seededRandom() * 4
    const twinkleSpeed = 0.5 + seededRandom() * 3
    const twinklePhase = seededRandom() * Math.PI * 2

    const star = engine.addEntity()
    Transform.create(star, {
      position: Vector3.create(x, y, z),
      scale: Vector3.create(baseSize, baseSize, baseSize)
    })
    MeshRenderer.setSphere(star)
    Material.setPbrMaterial(star, {
      albedoColor: Color4.create(starColor.r, starColor.g, starColor.b, 1),
      emissiveColor: starColor,
      emissiveIntensity: baseIntensity
    })

    skyboxStars.push({ entity: star, color: starColor, baseSize, baseIntensity, twinkleSpeed, twinklePhase })
  }
}

interface SkyboxStar {
  entity: Entity
  color: Color3
  baseSize: number
  baseIntensity: number
  twinkleSpeed: number
  twinklePhase: number
}

const skyboxStars: SkyboxStar[] = []
let twinkleTime = 0
let twinkleIndex = 0

export function twinkleSystem(dt: number): void {
  twinkleTime += dt

  const batchSize = 30
  for (let i = 0; i < batchSize; i++) {
    const idx = (twinkleIndex + i) % skyboxStars.length
    if (idx >= skyboxStars.length) continue
    const star = skyboxStars[idx]

    const twinkle = 0.5 + 0.5 * Math.sin(twinkleTime * star.twinkleSpeed + star.twinklePhase)
    const scale = star.baseSize * (0.6 + twinkle * 0.4)
    const intensity = star.baseIntensity * (0.3 + twinkle * 0.7)

    const transform = Transform.getMutable(star.entity)
    transform.scale = Vector3.create(scale, scale, scale)
    Material.setPbrMaterial(star.entity, {
      albedoColor: Color4.create(star.color.r, star.color.g, star.color.b, 1),
      emissiveColor: star.color,
      emissiveIntensity: intensity
    })
  }
  twinkleIndex = (twinkleIndex + batchSize) % Math.max(1, skyboxStars.length)
}

let respawnCooldown = 0

export function respawnSystem(dt: number): void {
  respawnCooldown -= dt
  if (respawnCooldown > 0) return

  const player = getPlayer()
  if (!player?.position) return

  if (player.position.y < PLATFORM_Y - 5) {
    respawnCooldown = 2
    movePlayerTo({
      newRelativePosition: Vector3.create(CENTER.x, PLATFORM_Y + 0.5, CENTER.z + 11),
      cameraTarget: Vector3.create(CENTER.x, PLATFORM_Y + 1, CENTER.z)
    })
  }
}
