import { engine, Entity, Transform, MeshRenderer, Material, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { movePlayerTo } from '~system/RestrictedActions'
import { hideInTopView } from './topViewHide'

const CENTER = Vector3.create(128, 80, 128)
const BOX_SIZE = 150

// Top of the ship's raised central dais (the galaxy projector stands here).
export const PLATFORM_Y = 40
// The main deck around the dais is 1.09m lower; the station panels stand on it.
export const DECK_Y = PLATFORM_Y - 1.09
// Top of the interior model's central dais: the projector base sits on it. (Dais top is 0.657 in
// model units, and the interior is placed at PLATFORM_Y - 1.33, so 0.657 - 1.33.)
export const DAIS_Y = PLATFORM_Y - 0.673
// Top of galaxy_projector_base.glb as placed below (model height 0.75, z-scaled 0.7, stood upright): the hologram beam starts here.
export const PROJECTOR_TOP_Y = DAIS_Y + 0.75 * 0.7
// Hull walls start ~14.5m from center, so the panels sit at ~12.5m.

let seed = 777
function seededRandom(): number {
  seed = (seed * 16807 + 0) % 2147483647
  return (seed - 1) / 2147483646
}

export function createEnvironment(): void {
  seed = 777

  // Skybox GLB
  const skybox = engine.addEntity()
  Transform.create(skybox, {
    position: Vector3.create(CENTER.x, CENTER.y, CENTER.z),
    scale: Vector3.create(1.833, 1.833, 1.833),
    rotation: Quaternion.fromEulerDegrees(0, 0, 0)
  })
  GltfContainer.create(skybox, { src: 'assets/models/skybox.glb' })

  // Nav panel model (under discovery panel)
  const navPanel = engine.addEntity()
  Transform.create(navPanel, {
    position: Vector3.create(128, DECK_Y, 113.8),
    scale: Vector3.create(1, 1, 1),
    rotation: Quaternion.fromEulerDegrees(180, 0, 180)
  })
  GltfContainer.create(navPanel, { src: 'assets/models/nav_panel_low_1.glb', visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS })
  hideInTopView(navPanel)

  // Galaxy projector base model
  const projectorModel = engine.addEntity()
  Transform.create(projectorModel, {
    position: Vector3.create(128, DAIS_Y, 128),
    scale: Vector3.create(1, 1, 0.7),
    rotation: Quaternion.fromEulerDegrees(-90, 0, 0)
  })
  GltfContainer.create(projectorModel, { src: 'assets/models/galaxy_projector_base.glb', visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS })

  // Ship interior. DaisyClass_Interior.glb is a Y-up export (no axis-fix rotation needed). Its central
  // dais tops out at model y 1.33 and the main deck at 0.24, so it is lowered by 1.33 to put the dais
  // top exactly at PLATFORM_Y and the deck at DECK_Y.
  const INTERIOR_SCALE = 1
  const interior = engine.addEntity()
  Transform.create(interior, {
    position: Vector3.create(128, PLATFORM_Y - 1.33 * INTERIOR_SCALE, 128),
    scale: Vector3.create(INTERIOR_SCALE, INTERIOR_SCALE, INTERIOR_SCALE)
  })
  GltfContainer.create(interior, {
    src: 'assets/models/DaisyClass_Interior.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS
  })

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

  starfieldRoot = engine.addEntity()
  Transform.create(starfieldRoot, { position: CENTER })

  for (let i = 0; i < starCount; i++) {
    const theta = seededRandom() * Math.PI * 2
    const phi = Math.acos(2 * seededRandom() - 1)
    const r = (BOX_SIZE / 2) * 0.95

    const x = r * Math.sin(phi) * Math.cos(theta)
    const y = r * Math.sin(phi) * Math.sin(theta)
    const z = r * Math.cos(phi)

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
      scale: Vector3.create(baseSize, baseSize, baseSize),
      parent: starfieldRoot!
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
let starfieldRoot: Entity | null = null
let starfieldRotX = 0
let starfieldRotY = 0
let starfieldRotZ = 0
const DRIFT_SPEED_X = 0.15
const DRIFT_SPEED_Y = 0.25
const DRIFT_SPEED_Z = 0.1
let twinkleTime = 0
let twinkleIndex = 0

export function twinkleSystem(dt: number): void {
  twinkleTime += dt

  // Slowly drift the starfield rotation
  if (starfieldRoot) {
    starfieldRotX += DRIFT_SPEED_X * dt
    starfieldRotY += DRIFT_SPEED_Y * dt
    starfieldRotZ += DRIFT_SPEED_Z * dt
    const transform = Transform.getMutable(starfieldRoot)
    transform.rotation = Quaternion.fromEulerDegrees(starfieldRotX, starfieldRotY, starfieldRotZ)
  }

  const batchSize = 30
  for (let i = 0; i < batchSize; i++) {
    const idx = (twinkleIndex + i) % skyboxStars.length
    if (idx >= skyboxStars.length) continue
    const star = skyboxStars[idx]

    // Twinkle by size only: each star keeps the material it was created with. Re-setting 30 materials a frame with
    // ever-changing glow values churned the explorer's materials all session.
    const twinkle = 0.5 + 0.5 * Math.sin(twinkleTime * star.twinkleSpeed + star.twinklePhase)
    const scale = star.baseSize * (0.5 + twinkle * 0.6)
    Transform.getMutable(star.entity).scale = Vector3.create(scale, scale, scale)
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
