// Which bodies take an exploration pod. Mirrors the server's refusals (expedition/deploy.ts), so nothing offers a
// deploy the server will turn down: the body has to support life, and barren planets and moons never qualify.

export function planetExplorable(p: { planet_type?: string | null; supports_life?: boolean | null }): boolean {
  return !!p.supports_life && p.planet_type !== 'barren'
}

export function moonExplorable(m: { moon_type?: string | null; supports_life?: boolean | null }): boolean {
  return !!m.supports_life && m.moon_type !== 'barren_moon'
}
