// Desk buttons and panels catch the pointer only. A collider with no layer is solid too (the SDK's default is
// CL_POINTER | CL_PHYSICS), so every redraw (a COLLECT, a refresh) dropped new solid boxes where the captain was
// standing, and the engine shoved them clear, sometimes out through the hull (Skat's report, Oct 5 2026).
import { describe, it, expect } from 'vitest'
import { engine, MeshCollider, ColliderLayer } from '@dcl/sdk/ecs'
import { clickable } from '../src/stations/draw'

describe('clickable desk elements', () => {
  it('catch clicks without being solid', () => {
    const e = engine.addEntity()
    clickable(e, 'Collect', () => {})
    expect(MeshCollider.get(e).collisionMask).toBe(ColliderLayer.CL_POINTER)
  })
})
