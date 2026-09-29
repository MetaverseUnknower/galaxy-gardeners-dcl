// Frame budgets: things that run every frame must not re-set materials or rebuild meshes every frame. In the Unity
// explorer each re-set can make a new material; doing it every frame all session is how a scene wears the explorer
// down. These step the real systems for a while and count the writes.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Material, MeshRenderer } from '@dcl/sdk/ecs'

vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getSystemDetail: vi.fn(async () => ({
    system: { id: 's1', name: 'Test', star_type: 'yellow_star' },
    planets: [{ id: 'p1', orbital_slot: 2, planet_type: 'rocky', supports_life: false, name: 'One', moons: [] }],
    asteroidBelts: [],
  })),
}))

import { createEnvironment, twinkleSystem } from '../src/environment'
import { createProjectorBase, galaxyAnimationSystem, switchViewMode, setViewModeCallback, zoomMap } from '../src/galaxyMap'
import { renderSystemView, systemViewAnimationSystem, clearSystemView } from '../src/systemView'

const FPS = 60
function run(system: (dt: number) => void, seconds: number): void {
  for (let i = 0; i < seconds * FPS; i++) system(1 / FPS)
}
afterEach(() => { vi.restoreAllMocks() })

describe('frame budgets', () => {
  it('the starfield twinkles without touching any material', () => {
    createEnvironment()
    const materials = vi.spyOn(Material, 'setPbrMaterial')
    run(twinkleSystem, 10)
    expect(materials).not.toHaveBeenCalled()   // was 30 a frame: 18,000 in these 10 s
  })

  it('the hologram beam writes its materials a few times a second, not every frame', () => {
    createProjectorBase()
    run(galaxyAnimationSystem, 15)   // past its 8 s warm-up and 3 s fade-in
    const materials = vi.spyOn(Material, 'setPbrMaterial')
    run(galaxyAnimationSystem, 10)
    expect(materials.mock.calls.length).toBeLessThan(10 * 12 * 2)   // under 12 a second per layer (was 60 per layer)
    const looks = new Set(materials.mock.calls.map(c => JSON.stringify((c[1] as any).albedoColor)))
    expect(looks.size).toBeLessThanOrEqual(2 * 11)   // 2 layers x 11 pulse steps, reused (every frame was new before)
  })

  it('the beam cone is rebuilt only on zoom, not while idle or switching views', async () => {
    createProjectorBase()
    run(galaxyAnimationSystem, 3)
    const meshes = vi.spyOn(MeshRenderer, 'setCylinder')
    run(galaxyAnimationSystem, 5)
    expect(meshes).not.toHaveBeenCalled()
    setViewModeCallback(async () => { await Promise.resolve() })
    switchViewMode('system')
    run(galaxyAnimationSystem, 3)                  // shrinks, then asks for the system view
    await new Promise(r => setTimeout(r, 0))       // the view swap resolves
    run(galaxyAnimationSystem, 3)                  // grows back
    expect(meshes.mock.calls.length).toBeLessThanOrEqual(4)   // was 2 a frame through the whole transition
    meshes.mockClear()
    zoomMap(1)
    run(galaxyAnimationSystem, 3)
    expect(meshes.mock.calls.length).toBeGreaterThan(0)       // zoom still reshapes the cone
    expect(meshes.mock.calls.length).toBeLessThan(3 * FPS)    // but not every frame of it
  })

  it("the system view's star glow pulses without re-setting its material", async () => {
    await renderSystemView('s1')
    const materials = vi.spyOn(Material, 'setPbrMaterial')
    run(systemViewAnimationSystem, 5)
    expect(materials).not.toHaveBeenCalled()
    clearSystemView()
  })
})
