// Pod Operations — orbital sector map: the current system's bodies on their orbits, routes for pods
// that are out, and click-to-deploy (mining on belts, exploration on life-bearing planets and moons).
import { Entity, TextAlignMode } from '@dcl/sdk/ecs'
import { Color3 } from '@dcl/sdk/math'
import * as api from '../api'
import { orbitalRadius } from '../systemView'
import { StationContext } from '../stations'
import { Bag, text, frame, line, ring, dot, CYAN3, MAGENTA3, CYAN, DIM, MUTED, WHITE, GREEN, RED } from './draw'

interface Body { id: string; name: string; kind: 'planet' | 'moon' | 'belt'; x: number; y: number; deployable: boolean }
const LEFT = TextAlignMode.TAM_MIDDLE_LEFT, RIGHT = TextAlignMode.TAM_MIDDLE_RIGHT
const STAR = Color3.create(1, 0.85, 0.4)
const ORBIT = Color3.create(0.1, 0.4, 0.55)
const BELT = Color3.create(0.55, 0.3, 0.7)

export function minutesLeft(completesAt: string): number { return Math.max(0, Math.ceil((new Date(completesAt).getTime() - Date.now()) / 60000)) }
export function formatMinutes(mins: number): string { const h = Math.floor(mins / 60); return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m` }

/** Draws the map inside a frame centered at (cx, cy). Returns body names by id for other panels. */
export async function renderSectorMap(bag: Bag, root: Entity, cx: number, cy: number, w: number, h: number, ctx: StationContext, systemId: string | null): Promise<Record<string, string>> {
  frame(bag, root, cx, cy, w, h)
  const top = cy + h / 2, left = cx - w / 2, right = cx + w / 2, bottom = cy - h / 2
  text(bag, root, left + 0.1, top - 0.14, 'DESTINATION MAP', 0.28, CYAN, LEFT)
  // Legend, top right
  const ly = top - 0.12
  line(bag, root, right - 0.62, ly, right - 0.5, ly, CYAN3); text(bag, root, right - 0.68, ly, 'EXPLORATION ROUTES', 0.14, DIM, RIGHT)
  line(bag, root, right - 0.62, ly - 0.14, right - 0.5, ly - 0.14, MAGENTA3); text(bag, root, right - 0.68, ly - 0.14, 'MINING ROUTES', 0.14, DIM, RIGHT)
  dot(bag, root, right - 0.56, ly - 0.28, 0.05, BELT); text(bag, root, right - 0.68, ly - 0.28, 'RESOURCE SITE', 0.14, DIM, RIGHT)
  text(bag, root, right - 0.1, bottom + 0.1, 'ORBITAL SECTOR MAP  ///', 0.14, MUTED, RIGHT)

  const names: Record<string, string> = {}
  if (!systemId) { text(bag, root, cx, cy, 'No current system', 0.3, MUTED); return names }
  let detail: any, exps: any[]
  try { [detail, exps] = await Promise.all([api.getSystemDetail(systemId), api.getExpeditions()]) }
  catch { text(bag, root, cx, cy, 'Sector data unavailable', 0.3, MUTED); return names }

  const sys = detail.system || detail
  const starType: string | null = sys.star_type || null
  const planets: any[] = detail.planets || []
  const belts: any[] = detail.asteroidBelts || []
  const maxSlot = planets.length ? Math.max(...planets.map((p: any) => p.orbital_slot)) : 1
  const habitableSlot = Math.max(2, Math.min(Math.floor(maxSlot / 2) + 1, 4))
  const beltR = (i: number) => i === 0 ? orbitalRadius(habitableSlot, starType) + 0.9 : i === 1 ? orbitalRadius(maxSlot, starType) + 2.5 : orbitalRadius(Math.max(1, habitableSlot - (belts.length - i)), starType) + 0.9
  let extent = 2
  for (const p of planets) extent = Math.max(extent, orbitalRadius(p.orbital_slot, starType))
  belts.forEach((_, i) => { extent = Math.max(extent, beltR(i)) })

  // Map geometry: leave room for the title row above and the footer below.
  const mx = cx - 0.1, my = cy - 0.12
  const mapR = Math.min(w, h) / 2 - 0.42
  const scale = mapR / extent
  dot(bag, root, mx, my, 0.12, STAR)
  const bodies: Body[] = []

  planets.forEach((p: any, i: number) => {
    const r = orbitalRadius(p.orbital_slot, starType) * scale
    ring(bag, root, mx, my, r, ORBIT, { segments: 36, thickness: 0.006, alpha: 0.8 })
    const a = ((p.orbital_slot * 137.508 + 25) * Math.PI) / 180
    const x = mx + Math.cos(a) * r, y = my + Math.sin(a) * r
    const barren = p.planet_type === 'barren'
    bodies.push({ id: p.id, name: p.name, kind: 'planet', x, y, deployable: !!p.supports_life && !barren })
    names[p.id] = p.name
    const moons: any[] = p.moons || []
    moons.slice(0, 3).forEach((m: any, j: number) => {
      const ma = a + 1.2 + j * 1.1
      const mxp = x + Math.cos(ma) * 0.13, myp = y + Math.sin(ma) * 0.13
      bodies.push({ id: m.id, name: m.name, kind: 'moon', x: mxp, y: myp, deployable: true })
      names[m.id] = m.name
    })
    void i
  })
  belts.forEach((b: any, i: number) => {
    const r = beltR(i) * scale
    ring(bag, root, mx, my, r, BELT, { segments: 40, dashed: true, thickness: 0.01, alpha: 0.9 })
    const a = ((i * 97 + 200) * Math.PI) / 180
    bodies.push({ id: b.id, name: b.name, kind: 'belt', x: mx + Math.cos(a) * r, y: my + Math.sin(a) * r, deployable: true })
    names[b.id] = b.name
  })

  // Routes for pods that are out
  const shipX = left + 0.22, shipY = bottom + 0.3
  dot(bag, root, shipX, shipY, 0.09, WHITE); text(bag, root, shipX + 0.08, shipY, 'SHIP', 0.14, DIM, LEFT)
  const active = (exps || []).filter((e: any) => e.status !== 'collected')
  const outAt = new Map<string, any>()
  for (const e of active) { const id = e.belt_id || e.moon_id || e.planet_id; if (id) outAt.set(id, e) }
  for (const b of bodies) {
    const e = outAt.get(b.id)
    if (!e) continue
    const c = e.expedition_type === 'mining' ? MAGENTA3 : CYAN3
    line(bag, root, shipX, shipY, b.x, b.y, c, { thickness: 0.01, alpha: 0.85 })
    const ready = e.status === 'completed' || (e.completes_at && new Date(e.completes_at).getTime() <= Date.now())
    text(bag, root, (shipX + b.x) / 2, (shipY + b.y) / 2 + 0.06, ready ? 'READY' : formatMinutes(minutesLeft(e.completes_at)), 0.14, ready ? GREEN : Color3ToColor4(c), TextAlignMode.TAM_MIDDLE_CENTER)
  }

  // Body markers and labels
  for (const b of bodies) {
    const out = outAt.has(b.id)
    const c = b.kind === 'belt' ? BELT : out ? CYAN3 : b.deployable ? CYAN3 : Color3.create(0.35, 0.45, 0.55)
    const size = b.kind === 'moon' ? 0.045 : b.kind === 'belt' ? 0.06 : 0.08
    const hover = b.deployable && !out ? (b.kind === 'belt' ? `Deploy mining pod to ${b.name}` : `Deploy exploration pod to ${b.name}`) : undefined
    dot(bag, root, b.x, b.y, size, c, hover ? { hover, onClick: () => deploy(b, ctx) } : {})
    if (b.kind !== 'moon') text(bag, root, b.x + 0.07, b.y - 0.07, b.name, 0.14, out ? WHITE : DIM, LEFT)
  }
  return names
}

function Color3ToColor4(c: Color3) { return { r: c.r, g: c.g, b: c.b, a: 1 } }

async function deploy(body: Body, ctx: StationContext): Promise<void> {
  ctx.notify(`Deploying to ${body.name}…`, CYAN)
  try {
    await ctx.busy(body.kind === 'belt' ? api.deployMiningPod(body.id) : body.kind === 'moon' ? api.deployExplorationPodToMoon(body.id) : api.deployExplorationPod(body.id))
    ctx.notify(body.kind === 'belt' ? 'Mining pod deployed!' : 'Exploration pod deployed!', GREEN)
    await ctx.refresh()
  } catch (err: any) {
    ctx.notify(err?.message || 'Deploy failed', RED)
  }
}
