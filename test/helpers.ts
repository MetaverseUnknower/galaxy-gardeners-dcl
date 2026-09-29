// Test helpers: step the engine like the explorer does, and count what's alive in it.
import { engine, Transform } from '@dcl/sdk/ecs'

/** Runs every system for `seconds` of frames at `fps`. */
export async function tick(seconds: number, fps = 60): Promise<void> {
  const dt = 1 / fps
  for (let i = 0; i < Math.round(seconds * fps); i++) await engine.update(dt)
}

/** Entities that have a Transform (everything the scene places in the world). */
export function liveEntities(): number {
  let n = 0
  for (const _ of engine.getEntitiesWith(Transform)) n++
  return n
}
