// Which bodies take an exploration pod, matching the server's refusals (expedition/deploy.ts): a planet or moon has
// to support life, and barren ones never do. The system view's panel and the Pod Operations sector map both ask here.
import { describe, it, expect } from 'vitest'
import { planetExplorable, moonExplorable } from '../src/bodyRules'

describe('exploration pods', () => {
  it('go to moons with life', () => {
    expect(moonExplorable({ moon_type: 'ice_moon', supports_life: true })).toBe(true)
  })
  it("don't go to moons without life", () => {
    expect(moonExplorable({ moon_type: 'rocky_moon', supports_life: false })).toBe(false)
    expect(moonExplorable({ moon_type: 'volcanic_moon' })).toBe(false)
  })
  it("don't go to barren moons, whatever they claim", () => {
    expect(moonExplorable({ moon_type: 'barren_moon', supports_life: true })).toBe(false)
  })
  it('follow the same rule for planets', () => {
    expect(planetExplorable({ planet_type: 'oceanic', supports_life: true })).toBe(true)
    expect(planetExplorable({ planet_type: 'desert', supports_life: false })).toBe(false)
    expect(planetExplorable({ planet_type: 'barren', supports_life: true })).toBe(false)
  })
})
