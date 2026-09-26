// Phase of a pod on its trip, from the phase end times the server sends with each expedition.
export type PodPhase = 'EN ROUTE' | 'ON SITE' | 'RETURNING'

export function podPhase(e: any, now: number = Date.now()): PodPhase | null {
  if (e?.status !== 'in_progress') return null
  if (e.recalled_at) return 'RETURNING'
  const out = e.phase_out_ends_at ? new Date(e.phase_out_ends_at).getTime() : NaN
  const site = e.phase_site_ends_at ? new Date(e.phase_site_ends_at).getTime() : NaN
  if (isNaN(out) || isNaN(site)) return null
  return now < out ? 'EN ROUTE' : now < site ? 'ON SITE' : 'RETURNING'
}

/** Recall is offered while the pod is flying out or working, once per trip. */
export function canRecall(e: any, now: number = Date.now()): boolean {
  const phase = podPhase(e, now)
  return !e?.recalled_at && (phase === 'EN ROUTE' || phase === 'ON SITE')
}
