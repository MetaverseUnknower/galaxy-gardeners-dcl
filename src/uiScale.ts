import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'

// HUD sizes are authored for a 1080-tall canvas and scaled to the actual canvas height, so every
// button and label keeps the same size relative to the screen on any display (retina included).
const REFERENCE_HEIGHT = 1080
function uiScale(): number {
  const c = UiCanvasInformation.getOrNull(engine.RootEntity)
  return c && c.height > 0 ? c.height / REFERENCE_HEIGHT : 1
}
export const px = (n: number): number => Math.round(n * uiScale())
