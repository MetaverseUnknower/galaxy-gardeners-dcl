// Galaxy Gardeners — shared station data helpers.
// Small pure functions used by more than one station view; kept here so behavior stays identical
// wherever it's used instead of drifting between copies.

/** Sum of `inventory[].quantity` on a ship dashboard (or 0 if there is no dashboard/inventory). */
export function cargoUsed(dashboard: any): number {
  return (dashboard?.inventory || []).reduce((s: number, r: any) => s + (r.quantity ?? 0), 0)
}

/** Replaces underscores with spaces and capitalizes each word, e.g. "fuel_tank" -> "Fuel Tank". */
export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase())
}

export const TRAIT_KEYS = ['atmosphere', 'temperature', 'gravity', 'moisture', 'radiation', 'soil'] as const
