# Pod Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players recall mining and exploration pods before they start home, with a recall time, a fresh loss roll, and a partial haul that depend on the expedition's risk tier and phase.

**Architecture:** A pure rules module on the server (`recall.ts`) owns the phase table and every formula; a thin service (`recallService.ts`) loads the expedition, applies the rules, and rewrites the expedition in place (status stays `in_progress`, so collection, the travel block, the completion cron and the iOS app keep working). Two routes expose preview and recall, the expedition list gains phase end times, and the DCL scene shows phases, a RECALL button and a confirmation dialog.

**Tech Stack:** Server: Node 20, TypeScript, Express, Supabase JS, Vitest. Scene: Decentraland SDK 7.23 (ECS, ReactEcs UI).

**Spec:** `docs/superpowers/specs/2026-09-26-pod-recall-design.md` (in the galaxy-gardeners-dcl repo)

## Global Constraints

- Server work happens in a git worktree off `origin/main` on branch `feat/pod-recall`: never commit on the user's checkout (it is on `feat/fuel-drops`). Create it with:
  `git -C ~/Git/galaxy-gardeners-server worktree add ~/Git/galaxy-gardeners-server-recall -b feat/pod-recall origin/main`
  then `ln -s ~/Git/galaxy-gardeners-server/node_modules ~/Git/galaxy-gardeners-server-recall/node_modules` and `ln -s ~/Git/galaxy-gardeners-server/.env ~/Git/galaxy-gardeners-server-recall/.env`. All server paths below are relative to `~/Git/galaxy-gardeners-server-recall`.
- Scene work happens in `~/Git/galaxy-gardeners-dcl` on its current branch `feature/ship-stations`.
- Always run Node 20: prefix commands with `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null &&`.
- Server tests: `npx vitest run <path>`; full suite `npx vitest run`. Scene check: `npm run build` (must print "Type checking completed without errors").
- Phase table (out / on site; back mirrors out): safe or low 2/5, 1/5; moderate or medium 3/10, 2/5; dangerous or high 1/5, 3/5; hostile or extreme 1/8, 3/4.
- Recall difficulty: safe 0, moderate 0.10, dangerous 0.25, hostile 0.50. Tier launch loss: 0.05, 0.15, 0.30, 0.50. Loss floor: existing `POD_LOSS_FLOOR` (0.02).
- `recallMinutes = min( min(elapsed, out) × (1 + difficulty), T − elapsed )`; `exposure = min(1, elapsed / out)`; `lossChance = max(tierLoss × 0.5 × exposure − shielding/100, POD_LOSS_FLOOR)`, or 0 during the walkthrough; `share = clamp((elapsed − out)/site, 0, 1)`.
- Recall allowed only when status is `in_progress`, `recalled_at` is null, and the phase is `en_route` or `on_site`.
- Expedition status never changes on recall; the recall rewrites `completes_at`, `pod_lost`, `rewards`, `recalled_at`.
- Migration file is `supabase/migrations/047_expedition_recall.sql` (046 belongs to the unmerged fuel drops branch).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Do not push, deploy, or run migrations: Task 7 lists those steps for the user to approve.

## Review Focus

- A pod whose launch roll was "lost" (no pre-rolled loot) survives the recall while on site: it must still bring back a share, from freshly rolled loot. Test in Task 3.
- Recall requested twice (double click, two devices): only the first applies; the second gets "already on its way back". Test in Task 3 (the update is guarded on `recalled_at is null`).
- Recall of someone else's expedition id: 404, no change. Test in Task 4.
- Walkthrough players: loss chance 0 even though the floor is 2 %. Test in Task 1.
- The expedition list with a mix of belt, planet and moon expeditions and completed ones: every in-progress row gets both phase end times; finished rows are left alone. Test in Task 2.

---

### Task 1: Recall rules module (pure)

**Files:**
- Create: `src/services/expedition/recall.ts`
- Test: `src/services/expedition/__tests__/recall.test.ts`

**Interfaces:**
- Consumes: `POD_LOSS_FLOOR` from `src/utils/constants.ts`.
- Produces (all exported from `recall.ts`):
  - `type RiskTier = 'safe' | 'moderate' | 'dangerous' | 'hostile'`
  - `type ExpeditionPhase = 'en_route' | 'on_site' | 'returning'`
  - `EXPEDITION_PHASES`, `RECALL_DIFFICULTY`, `TIER_LOSS`
  - `tierFromBeltRisk(level: string | null | undefined): RiskTier`
  - `tierFromBodyRisk(tier: string | null | undefined): RiskTier`
  - `phaseTimes(durationMinutes: number, tier: RiskTier): { outMinutes: number; siteMinutes: number }`
  - `expeditionPhase(elapsedMinutes: number, durationMinutes: number, tier: RiskTier): ExpeditionPhase`
  - `interface RecallInput { status: string; recalledAt: string | null; durationMinutes: number; elapsedMinutes: number; tier: RiskTier; shielding: number; protectedFromLoss: boolean }`
  - `interface RecallPreview { allowed: boolean; reason?: string; phase: ExpeditionPhase; recallMinutes: number; waitMinutes: number; lossChance: number; share: number }`
  - `previewRecall(input: RecallInput): RecallPreview`
  - `recalledRewards(type: 'mining' | 'exploration', rewards: any, share: number, random: () => number): any | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/expedition/__tests__/recall.test.ts
import { describe, it, expect } from 'vitest';
import {
  EXPEDITION_PHASES, tierFromBeltRisk, tierFromBodyRisk, phaseTimes, expeditionPhase,
  previewRecall, recalledRewards, type RecallInput,
} from '../recall.js';

const base = (over: Partial<RecallInput>): RecallInput => ({
  status: 'in_progress', recalledAt: null, durationMinutes: 720, elapsedMinutes: 0,
  tier: 'hostile', shielding: 0, protectedFromLoss: false, ...over,
});

describe('phase table', () => {
  it('mirrors the out leg on the way back and sums to the whole trip', () => {
    for (const r of Object.values(EXPEDITION_PHASES)) expect(r.out * 2 + r.site).toBeCloseTo(1, 10);
  });
  it('maps belt risk and body risk to tiers', () => {
    expect(tierFromBeltRisk('low')).toBe('safe');
    expect(tierFromBeltRisk('medium')).toBe('moderate');
    expect(tierFromBeltRisk('high')).toBe('dangerous');
    expect(tierFromBeltRisk('extreme')).toBe('hostile');
    expect(tierFromBeltRisk(undefined)).toBe('safe');
    expect(tierFromBodyRisk('dangerous')).toBe('dangerous');
    expect(tierFromBodyRisk('weird')).toBe('safe');
  });
  it('splits a 12 hour hostile trip into 90 min out and 540 min on site', () => {
    expect(phaseTimes(720, 'hostile')).toEqual({ outMinutes: 90, siteMinutes: 540 });
  });
  it('reports the phase at the boundaries', () => {
    expect(expeditionPhase(89, 720, 'hostile')).toBe('en_route');
    expect(expeditionPhase(90, 720, 'hostile')).toBe('on_site');
    expect(expeditionPhase(629, 720, 'hostile')).toBe('on_site');
    expect(expeditionPhase(630, 720, 'hostile')).toBe('returning');
  });
});

describe('previewRecall', () => {
  it('turns an en-route pod around: back in the time it has flown, scaled by difficulty, no haul', () => {
    const p = previewRecall(base({ elapsedMinutes: 30 }));
    expect(p.allowed).toBe(true);
    expect(p.phase).toBe('en_route');
    expect(p.recallMinutes).toBeCloseTo(45, 10);   // 30 × 1.5
    expect(p.share).toBe(0);
    expect(p.lossChance).toBeCloseTo(0.5 * 0.5 * (30 / 90), 10);
  });
  it('matches the spec worked example (hostile, recalled 3 h into the site phase)', () => {
    const p = previewRecall(base({ elapsedMinutes: 270 }));
    expect(p.phase).toBe('on_site');
    expect(p.recallMinutes).toBeCloseTo(135, 10);  // 90 × 1.5
    expect(p.waitMinutes).toBe(450);
    expect(p.lossChance).toBeCloseTo(0.25, 10);
    expect(p.share).toBeCloseTo(180 / 540, 10);
  });
  it('never takes longer than waiting', () => {
    const p = previewRecall(base({ elapsedMinutes: 629 }));   // last minute on site: 91 min left
    expect(p.recallMinutes).toBe(91);
  });
  it('applies shielding and the floor', () => {
    expect(previewRecall(base({ elapsedMinutes: 270, shielding: 10 })).lossChance).toBeCloseTo(0.15, 10);
    expect(previewRecall(base({ elapsedMinutes: 270, shielding: 90 })).lossChance).toBeCloseTo(0.02, 10);
  });
  it('protects walkthrough players completely', () => {
    expect(previewRecall(base({ elapsedMinutes: 270, protectedFromLoss: true })).lossChance).toBe(0);
  });
  it('refuses on the return leg, after a recall, and for finished trips', () => {
    expect(previewRecall(base({ elapsedMinutes: 630 }))).toMatchObject({ allowed: false, reason: 'The pod is already on its return leg' });
    expect(previewRecall(base({ elapsedMinutes: 100, recalledAt: '2026-09-26T00:00:00Z' }))).toMatchObject({ allowed: false, reason: 'This pod is already on its way back' });
    expect(previewRecall(base({ elapsedMinutes: 100, status: 'completed_success' }))).toMatchObject({ allowed: false, reason: 'This expedition is already finished' });
  });
  it('safe tier has no breakaway penalty', () => {
    const p = previewRecall(base({ tier: 'safe', durationMinutes: 5, elapsedMinutes: 2.5 }));   // on site
    expect(p.recallMinutes).toBeCloseTo(2, 10);
    expect(p.share).toBeCloseTo(0.5, 10);
  });
});

describe('recalledRewards', () => {
  it('scales mining loot down and drops resources that round to zero', () => {
    expect(recalledRewards('mining', { iron_ore: 10, titanium: 1 }, 0.35, () => 0)).toEqual({ iron_ore: 3 });
  });
  it('returns nothing for mining when every resource rounds to zero', () => {
    expect(recalledRewards('mining', { titanium: 1 }, 0.5, () => 0)).toBeNull();
  });
  it('treats the exploration share as the chance the scan finished', () => {
    const r = { species_id: 's1', sample_collected: true };
    expect(recalledRewards('exploration', r, 0.4, () => 0.39)).toEqual(r);
    expect(recalledRewards('exploration', r, 0.4, () => 0.41)).toBeNull();
  });
  it('returns nothing with no share or no loot', () => {
    expect(recalledRewards('mining', { iron_ore: 10 }, 0, () => 0)).toBeNull();
    expect(recalledRewards('mining', null, 0.8, () => 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npx vitest run src/services/expedition/__tests__/recall.test.ts`
Expected: FAIL, cannot find module `../recall.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/expedition/recall.ts
// Galaxy Gardeners — Expedition phases and recall rules (pure; no database access).
// Documented in docs/mechanics/expeditions.md.

import { POD_LOSS_FLOOR } from '../../utils/constants.js';

export type RiskTier = 'safe' | 'moderate' | 'dangerous' | 'hostile';
export type ExpeditionPhase = 'en_route' | 'on_site' | 'returning';

/** Share of the trip spent flying out and working on site. The return leg mirrors the out leg. */
export const EXPEDITION_PHASES: Record<RiskTier, { out: number; site: number }> = {
  safe: { out: 2 / 5, site: 1 / 5 },
  moderate: { out: 3 / 10, site: 2 / 5 },
  dangerous: { out: 1 / 5, site: 3 / 5 },
  hostile: { out: 1 / 8, site: 3 / 4 },
};

/** Extra time to break away from a site, as a fraction of the out leg. */
export const RECALL_DIFFICULTY: Record<RiskTier, number> = { safe: 0, moderate: 0.1, dangerous: 0.25, hostile: 0.5 };

/** Launch loss chance per tier (the same values deploy.ts uses). */
export const TIER_LOSS: Record<RiskTier, number> = { safe: 0.05, moderate: 0.15, dangerous: 0.3, hostile: 0.5 };

const BELT_TO_TIER: Record<string, RiskTier> = { low: 'safe', medium: 'moderate', high: 'dangerous', extreme: 'hostile' };

export function tierFromBeltRisk(level: string | null | undefined): RiskTier {
  return BELT_TO_TIER[level ?? ''] ?? 'safe';
}

export function tierFromBodyRisk(tier: string | null | undefined): RiskTier {
  return tier && tier in EXPEDITION_PHASES ? (tier as RiskTier) : 'safe';
}

export function phaseTimes(durationMinutes: number, tier: RiskTier): { outMinutes: number; siteMinutes: number } {
  const r = EXPEDITION_PHASES[tier];
  return { outMinutes: durationMinutes * r.out, siteMinutes: durationMinutes * r.site };
}

export function expeditionPhase(elapsedMinutes: number, durationMinutes: number, tier: RiskTier): ExpeditionPhase {
  const { outMinutes, siteMinutes } = phaseTimes(durationMinutes, tier);
  if (elapsedMinutes < outMinutes) return 'en_route';
  if (elapsedMinutes < outMinutes + siteMinutes) return 'on_site';
  return 'returning';
}

export interface RecallInput {
  status: string;
  recalledAt: string | null;
  durationMinutes: number;
  elapsedMinutes: number;
  tier: RiskTier;
  /** blast_shielding (mining) or environmental_shielding (exploration), in percentage points. */
  shielding: number;
  /** True during the walkthrough, when pods are never lost. */
  protectedFromLoss: boolean;
}

export interface RecallPreview {
  allowed: boolean;
  reason?: string;
  phase: ExpeditionPhase;
  recallMinutes: number;
  waitMinutes: number;
  lossChance: number;
  share: number;
}

export function previewRecall(i: RecallInput): RecallPreview {
  const phase = expeditionPhase(i.elapsedMinutes, i.durationMinutes, i.tier);
  const { outMinutes, siteMinutes } = phaseTimes(i.durationMinutes, i.tier);
  const waitMinutes = Math.max(0, i.durationMinutes - i.elapsedMinutes);
  const breakaway = Math.min(i.elapsedMinutes, outMinutes) * (1 + RECALL_DIFFICULTY[i.tier]);
  const recallMinutes = Math.min(breakaway, waitMinutes);
  const exposure = outMinutes > 0 ? Math.min(1, i.elapsedMinutes / outMinutes) : 1;
  const lossChance = i.protectedFromLoss
    ? 0
    : Math.max(TIER_LOSS[i.tier] * 0.5 * exposure - i.shielding / 100, POD_LOSS_FLOOR);
  const share = siteMinutes > 0 ? Math.min(1, Math.max(0, (i.elapsedMinutes - outMinutes) / siteMinutes)) : 0;
  const result = { phase, recallMinutes, waitMinutes, lossChance, share };

  if (i.status !== 'in_progress') return { ...result, allowed: false, reason: 'This expedition is already finished' };
  if (i.recalledAt) return { ...result, allowed: false, reason: 'This pod is already on its way back' };
  if (phase === 'returning') return { ...result, allowed: false, reason: 'The pod is already on its return leg' };
  return { ...result, allowed: true };
}

/** What a surviving recalled pod brings home, from the loot it would have brought on a full trip. */
export function recalledRewards(type: 'mining' | 'exploration', rewards: any, share: number, random: () => number): any | null {
  if (!rewards || share <= 0) return null;
  if (type === 'mining') {
    const out: Record<string, number> = {};
    for (const [resource, qty] of Object.entries(rewards as Record<string, number>)) {
      const kept = Math.floor(qty * share);
      if (kept > 0) out[resource] = kept;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  // Exploration: the scan either finished or it did not.
  return random() < share ? rewards : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npx vitest run src/services/expedition/__tests__/recall.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/expedition/recall.ts src/services/expedition/__tests__/recall.test.ts
git commit -m "Expeditions: phase table and recall rules

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Migration, recall reward helpers, and phase times on the expedition list

**Files:**
- Create: `supabase/migrations/047_expedition_recall.sql`
- Modify: `src/services/expedition/deploy.ts` (export `rollMiningRewards`; add `rollExplorationRewards`)
- Modify: `src/services/expedition/complete.ts` (add `recalled_at` to both selects in `getPlayerExpeditions`)
- Create: `src/services/expedition/recallService.ts` (this task adds `withPhases`; Task 3 adds the rest)
- Test: `src/services/expedition/__tests__/recallService.test.ts`

**Interfaces:**
- Consumes: `tierFromBeltRisk`, `tierFromBodyRisk`, `phaseTimes`, `RiskTier` from Task 1.
- Produces:
  - `export async function rollMiningRewards(riskLevel: string, systemId: string): Promise<Record<string, number>>` (deploy.ts, now exported, body unchanged)
  - `export async function rollExplorationRewards(playerId: string, target: { planetId?: string | null; moonId?: string | null }, specimenVault: number): Promise<{ species_id: string; sample_collected: boolean }>` (deploy.ts)
  - `export async function withPhases(rows: any[]): Promise<any[]>` (recallService.ts): returns the rows with `phase_out_ends_at` and `phase_site_ends_at` (ISO strings) added to every `in_progress` row.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/047_expedition_recall.sql
-- Pod recall: when a pod was called home early. The expedition keeps status 'in_progress' until collected;
-- a recall rewrites completes_at, pod_lost and rewards and stamps this column.
ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;
```

- [ ] **Step 2: Write the failing test**

```ts
// src/services/expedition/__tests__/recallService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockChain } from '../../../__mocks__/supabase.js';

vi.mock('../../../db/supabase.js', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('../deploy.js', () => ({ rollMiningRewards: vi.fn(), rollExplorationRewards: vi.fn() }));

import { supabase } from '../../../db/supabase.js';
import { withPhases } from '../recallService.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('withPhases', () => {
  it('adds phase end times to every in-progress row by its body risk, and leaves finished rows alone', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'asteroid_belts') return mockChain({ data: [{ id: 'b1', risk_level: 'extreme' }], error: null });
      if (table === 'planets') return mockChain({ data: [{ id: 'p1', risk_tier: 'safe' }], error: null });
      if (table === 'moons') return mockChain({ data: [{ id: 'm1', risk_tier: 'dangerous' }], error: null });
      return mockChain();
    });
    const start = '2026-09-26T00:00:00.000Z';
    const rows = [
      { id: 'e1', status: 'in_progress', started_at: start, duration_minutes: 720, belt_id: 'b1' },
      { id: 'e2', status: 'in_progress', started_at: start, duration_minutes: 5, planet_id: 'p1' },
      { id: 'e3', status: 'in_progress', started_at: start, duration_minutes: 240, moon_id: 'm1' },
      { id: 'e4', status: 'completed_success', started_at: start, duration_minutes: 60, belt_id: 'b1' },
    ];
    const out = await withPhases(rows);
    expect(out[0]).toMatchObject({ phase_out_ends_at: '2026-09-26T01:30:00.000Z', phase_site_ends_at: '2026-09-26T10:30:00.000Z' });
    expect(out[1]).toMatchObject({ phase_out_ends_at: '2026-09-26T00:02:00.000Z', phase_site_ends_at: '2026-09-26T00:03:00.000Z' });
    expect(out[2]).toMatchObject({ phase_out_ends_at: '2026-09-26T00:48:00.000Z', phase_site_ends_at: '2026-09-26T03:12:00.000Z' });
    expect(out[3].phase_out_ends_at).toBeUndefined();
  });

  it('returns rows untouched when nothing is in progress', async () => {
    const rows = [{ id: 'e4', status: 'collected' }];
    expect(await withPhases(rows)).toEqual(rows);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npx vitest run src/services/expedition/__tests__/recallService.test.ts`
Expected: FAIL, cannot find module `../recallService.js`.

- [ ] **Step 4: Implement**

In `src/services/expedition/deploy.ts`, change `async function rollMiningRewards(` to `export async function rollMiningRewards(` and append:

```ts
/** An exploration result for a planet or moon: the body's species (or 'pending_creation') and whether a sample fits in the vault. */
export async function rollExplorationRewards(
  playerId: string,
  target: { planetId?: string | null; moonId?: string | null },
  specimenVault: number,
): Promise<{ species_id: string; sample_collected: boolean }> {
  const { count: sampleCount } = await supabase
    .from('samples')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', playerId);
  const speciesQuery = supabase.from('flora_species').select('id');
  const { data: existingSpecies } = await (target.moonId
    ? speciesQuery.eq('moon_id', target.moonId)
    : speciesQuery.eq('planet_id', target.planetId as string)
  ).maybeSingle();
  return {
    species_id: existingSpecies?.id ?? 'pending_creation',
    sample_collected: (sampleCount ?? 0) < specimenVault,
  };
}
```

In `src/services/expedition/complete.ts`, in both selects inside `getPlayerExpeditions`, change `planet_id, moon_id, belt_id` to `planet_id, moon_id, belt_id, recalled_at` (the second select keeps its trailing `, collected_at`).

Create `src/services/expedition/recallService.ts`:

```ts
// Galaxy Gardeners — Pod recall (database side). The rules live in recall.ts.

import { supabase } from '../../db/supabase.js';
import { phaseTimes, tierFromBeltRisk, tierFromBodyRisk, type RiskTier } from './recall.js';

const MINUTE = 60 * 1000;

async function riskById(table: 'asteroid_belts' | 'planets' | 'moons', ids: string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const column = table === 'asteroid_belts' ? 'risk_level' : 'risk_tier';
  const { data } = await supabase.from(table).select(`id, ${column}`).in('id', ids);
  return new Map((data ?? []).map((r: any) => [r.id, r[column] ?? null]));
}

/** Adds phase_out_ends_at / phase_site_ends_at to every in-progress expedition so clients can show the phase live. */
export async function withPhases(rows: any[]): Promise<any[]> {
  const active = rows.filter(r => r.status === 'in_progress');
  if (active.length === 0) return rows;
  const ids = (key: string) => [...new Set(active.map(r => r[key]).filter(Boolean))] as string[];
  const [belts, planets, moons] = await Promise.all([
    riskById('asteroid_belts', ids('belt_id')),
    riskById('planets', ids('planet_id')),
    riskById('moons', ids('moon_id')),
  ]);
  return rows.map(r => {
    if (r.status !== 'in_progress') return r;
    const tier: RiskTier = r.belt_id
      ? tierFromBeltRisk(belts.get(r.belt_id))
      : tierFromBodyRisk(r.moon_id ? moons.get(r.moon_id) : planets.get(r.planet_id));
    const { outMinutes, siteMinutes } = phaseTimes(r.duration_minutes, tier);
    const start = new Date(r.started_at).getTime();
    return {
      ...r,
      phase_out_ends_at: new Date(start + outMinutes * MINUTE).toISOString(),
      phase_site_ends_at: new Date(start + (outMinutes + siteMinutes) * MINUTE).toISOString(),
    };
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npx vitest run src/services/expedition`
Expected: PASS, including the existing deploy and complete tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/047_expedition_recall.sql src/services/expedition/deploy.ts src/services/expedition/complete.ts src/services/expedition/recallService.ts src/services/expedition/__tests__/recallService.test.ts
git commit -m "Expeditions: recalled_at column, reward helpers, phase end times on the list

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Recall preview and recall (service)

**Files:**
- Modify: `src/services/expedition/recallService.ts`
- Test: `src/services/expedition/__tests__/recallService.test.ts` (add cases)

**Interfaces:**
- Consumes: `previewRecall`, `recalledRewards`, `RecallPreview`, tier helpers (Task 1); `rollMiningRewards`, `rollExplorationRewards` (Task 2).
- Produces (exported from `recallService.ts`):
  - `class RecallError extends Error { status: number }`
  - `getRecallPreview(playerId: string, expeditionId: string, now?: Date): Promise<RecallPreview>`
  - `recallExpedition(playerId: string, expeditionId: string, now?: Date, random?: () => number): Promise<{ completesAt: string; recallMinutes: number }>`

- [ ] **Step 1: Write the failing tests** (append to `recallService.test.ts`)

```ts
import { rollMiningRewards } from '../deploy.js';
import { getRecallPreview, recallExpedition, RecallError } from '../recallService.js';

const START = '2026-09-26T00:00:00.000Z';
const at = (minutes: number) => new Date(new Date(START).getTime() + minutes * 60 * 1000);

function setup(exp: any, opts: { updated?: any[]; updateCount?: number } = {}) {
  const updates: any[] = opts.updated ?? [];
  (supabase.from as any).mockImplementation((table: string) => {
    if (table === 'expeditions') {
      const chain = mockChain({ data: exp, error: null });
      chain.update = vi.fn().mockImplementation((row: any) => {
        updates.push(row);
        return mockChain({ data: opts.updateCount === 0 ? [] : [{ id: exp?.id }], error: null });
      });
      return chain;
    }
    if (table === 'asteroid_belts') return mockChain({ data: { risk_level: 'extreme', system_id: 'sys-1' }, error: null });
    if (table === 'planets' || table === 'moons') return mockChain({ data: { risk_tier: 'hostile' }, error: null });
    if (table === 'ships') return mockChain({ data: { blast_shielding: 0, environmental_shielding: 0, specimen_vault: 10 }, error: null });
    if (table === 'players') return mockChain({ data: { walkthrough_completed: true, walkthrough_skipped: false }, error: null });
    return mockChain();
  });
  return updates;
}

const miningExp = (over: any = {}) => ({
  id: 'e1', player_id: 'pl-1', expedition_type: 'mining', status: 'in_progress', recalled_at: null,
  started_at: START, duration_minutes: 720, belt_id: 'b1', planet_id: null, moon_id: null,
  pod_lost: false, rewards: { iron_ore: 13 }, ...over,   // 13 × ⅓ = 4.33 → 4 (avoids ⅓ float edge cases)
});

describe('getRecallPreview', () => {
  it('previews a hostile mining pod 3 h into its site phase', async () => {
    setup(miningExp());
    const p = await getRecallPreview('pl-1', 'e1', at(270));
    expect(p).toMatchObject({ allowed: true, phase: 'on_site', recallMinutes: 135, waitMinutes: 450 });
    expect(p.share).toBeCloseTo(1 / 3, 10);
  });
  it('404s when the expedition is not the player\'s', async () => {
    setup(null);
    await expect(getRecallPreview('pl-1', 'nope', at(10))).rejects.toMatchObject({ status: 404 });
  });
});

describe('recallExpedition', () => {
  it('rewrites the expedition in place with the new return time, a surviving pod and a scaled haul', async () => {
    const updates = setup(miningExp());
    const r = await recallExpedition('pl-1', 'e1', at(270), () => 0.9);   // 0.9 ≥ 25 % loss → survives
    expect(r.recallMinutes).toBe(135);
    expect(r.completesAt).toBe(at(405).toISOString());
    expect(updates).toEqual([{ completes_at: at(405).toISOString(), pod_lost: false, rewards: { iron_ore: 4 }, recalled_at: at(270).toISOString() }]);
  });
  it('loses the pod when the fresh roll fails, with no haul', async () => {
    const updates = setup(miningExp());
    await recallExpedition('pl-1', 'e1', at(270), () => 0.1);
    expect(updates[0]).toMatchObject({ pod_lost: true, rewards: null });
  });
  it('rolls fresh loot for a pod whose launch roll was lost, then scales it', async () => {
    (rollMiningRewards as any).mockResolvedValue({ copper_ore: 10 });   // 10 × ⅓ = 3.33 → 3
    const updates = setup(miningExp({ pod_lost: true, rewards: null }));
    await recallExpedition('pl-1', 'e1', at(270), () => 0.9);
    expect(rollMiningRewards).toHaveBeenCalledWith('extreme', 'sys-1');
    expect(updates[0]).toMatchObject({ pod_lost: false, rewards: { copper_ore: 3 } });
  });
  it('refuses a second recall that loses the race', async () => {
    setup(miningExp(), { updateCount: 0 });
    await expect(recallExpedition('pl-1', 'e1', at(270), () => 0.9)).rejects.toMatchObject({ status: 400, message: 'This pod is already on its way back' });
  });
  it('refuses on the return leg without touching the expedition', async () => {
    const updates = setup(miningExp());
    await expect(recallExpedition('pl-1', 'e1', at(700), () => 0.9)).rejects.toBeInstanceOf(RecallError);
    expect(updates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npx vitest run src/services/expedition/__tests__/recallService.test.ts`
Expected: FAIL, `getRecallPreview` / `recallExpedition` / `RecallError` not exported.

- [ ] **Step 3: Implement** (append to `recallService.ts`, and extend its imports)

Replace the import line from `./recall.js` with:

```ts
import { phaseTimes, previewRecall, recalledRewards, tierFromBeltRisk, tierFromBodyRisk, type RecallPreview, type RiskTier } from './recall.js';
import { rollMiningRewards, rollExplorationRewards } from './deploy.js';
```

Append:

```ts
export class RecallError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface Loaded {
  exp: any;
  tier: RiskTier;
  beltRisk: string | null;
  systemId: string | null;
  shielding: number;
  specimenVault: number;
  protectedFromLoss: boolean;
}

async function load(playerId: string, expeditionId: string): Promise<Loaded> {
  const { data: exp } = await supabase
    .from('expeditions')
    .select('id, player_id, expedition_type, status, recalled_at, started_at, duration_minutes, belt_id, planet_id, moon_id, pod_lost, rewards')
    .eq('id', expeditionId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (!exp) throw new RecallError(404, 'Expedition not found');

  let tier: RiskTier;
  let beltRisk: string | null = null;
  let systemId: string | null = null;
  if (exp.belt_id) {
    const { data: belt } = await supabase.from('asteroid_belts').select('risk_level, system_id').eq('id', exp.belt_id).single();
    beltRisk = belt?.risk_level ?? null;
    systemId = belt?.system_id ?? null;
    tier = tierFromBeltRisk(beltRisk);
  } else {
    const table = exp.moon_id ? 'moons' : 'planets';
    const { data: body } = await supabase.from(table).select('risk_tier').eq('id', exp.moon_id ?? exp.planet_id).single();
    tier = tierFromBodyRisk(body?.risk_tier);
  }

  const { data: ship } = await supabase
    .from('ships')
    .select('blast_shielding, environmental_shielding, specimen_vault')
    .eq('player_id', playerId)
    .single();
  const { data: player } = await supabase
    .from('players')
    .select('walkthrough_completed, walkthrough_skipped')
    .eq('id', playerId)
    .single();

  return {
    exp,
    tier,
    beltRisk,
    systemId,
    shielding: exp.expedition_type === 'mining' ? ship?.blast_shielding ?? 0 : ship?.environmental_shielding ?? 0,
    specimenVault: ship?.specimen_vault ?? 0,
    protectedFromLoss: !!player && !player.walkthrough_completed && !player.walkthrough_skipped,
  };
}

function preview(l: Loaded, now: Date): RecallPreview {
  return previewRecall({
    status: l.exp.status,
    recalledAt: l.exp.recalled_at,
    durationMinutes: l.exp.duration_minutes,
    elapsedMinutes: (now.getTime() - new Date(l.exp.started_at).getTime()) / MINUTE,
    tier: l.tier,
    shielding: l.shielding,
    protectedFromLoss: l.protectedFromLoss,
  });
}

/** What a recall would do right now, without rolling anything. */
export async function getRecallPreview(playerId: string, expeditionId: string, now: Date = new Date()): Promise<RecallPreview> {
  return preview(await load(playerId, expeditionId), now);
}

/** Calls the pod home: rolls loss and the partial haul, then rewrites the expedition in place (status unchanged). */
export async function recallExpedition(
  playerId: string,
  expeditionId: string,
  now: Date = new Date(),
  random: () => number = Math.random,
): Promise<{ completesAt: string; recallMinutes: number }> {
  const l = await load(playerId, expeditionId);
  const p = preview(l, now);
  if (!p.allowed) throw new RecallError(400, p.reason ?? 'Recall not allowed');

  const podLost = random() < p.lossChance;
  let rewards: any = null;
  if (!podLost && p.share > 0) {
    // A pod whose launch roll was "lost" carries no loot; roll it fresh so a surviving recall is not shortchanged.
    let full = l.exp.rewards;
    if (!full) {
      full = l.exp.expedition_type === 'mining'
        ? await rollMiningRewards(l.beltRisk ?? 'low', l.systemId as string)
        : await rollExplorationRewards(playerId, { planetId: l.exp.planet_id, moonId: l.exp.moon_id }, l.specimenVault);
    }
    rewards = recalledRewards(l.exp.expedition_type, full, p.share, random);
  }

  const completesAt = new Date(now.getTime() + p.recallMinutes * MINUTE).toISOString();
  const { data: updated } = await supabase
    .from('expeditions')
    .update({ completes_at: completesAt, pod_lost: podLost, rewards, recalled_at: now.toISOString() })
    .eq('id', expeditionId)
    .eq('status', 'in_progress')
    .is('recalled_at', null)
    .select('id');
  if (!updated || updated.length === 0) throw new RecallError(400, 'This pod is already on its way back');

  return { completesAt, recallMinutes: p.recallMinutes };
}
```

- [ ] **Step 4: Run the tests**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npx vitest run src/services/expedition`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/expedition/recallService.ts src/services/expedition/__tests__/recallService.test.ts
git commit -m "Expeditions: recall preview and recall service

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Routes

**Files:**
- Modify: `src/routes/expeditions.ts`
- Test: `src/routes/__tests__/expeditions-recall.test.ts`

**Interfaces:**
- Consumes: `withPhases`, `getRecallPreview`, `recallExpedition`, `RecallError` (Tasks 2 and 3).
- Produces: `GET /api/expeditions` now returns rows with `recalled_at`, `phase_out_ends_at`, `phase_site_ends_at`; `GET /api/expeditions/:id/recall-preview` → `RecallPreview`; `POST /api/expeditions/:id/recall` → `{ completesAt, recallMinutes }`. Errors: `{ error }` with 404 or 400.

- [ ] **Step 1: Write the failing test**

```ts
// src/routes/__tests__/expeditions-recall.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';

vi.mock('../../middleware/auth.js', () => ({
  requirePlayer: (req: any, _res: any, next: any) => { req.playerId = 'pl-1'; next(); },
}));
vi.mock('../../services/expedition/deploy.js', () => ({ deployMiningPod: vi.fn(), deployExplorationPod: vi.fn(), deployExplorationPodToMoon: vi.fn() }));
vi.mock('../../services/expedition/discovery.js', () => ({ getDiscoveryOptions: vi.fn(), startDiscovery: vi.fn(), completeDiscovery: vi.fn(), getActiveDiscovery: vi.fn() }));
vi.mock('../../services/expedition/complete.js', () => ({
  completeExpedition: vi.fn(), collectExpedition: vi.fn(),
  getPlayerExpeditions: vi.fn().mockResolvedValue([{ id: 'e1', status: 'in_progress' }]),
}));
const service = vi.hoisted(() => ({
  withPhases: vi.fn(async (rows: any[]) => rows.map(r => ({ ...r, phase_out_ends_at: 'A', phase_site_ends_at: 'B' }))),
  getRecallPreview: vi.fn(),
  recallExpedition: vi.fn(),
}));
vi.mock('../../services/expedition/recallService.js', async () => {
  class RecallError extends Error { constructor(public status: number, m: string) { super(m); } }
  return { ...service, RecallError };
});

import { expeditionsRouter } from '../expeditions.js';
import { RecallError } from '../../services/expedition/recallService.js';

function createApp() { const app = express(); app.use(express.json()); app.use('/expeditions', expeditionsRouter); return app; }

async function call(method: 'GET' | 'POST', path: string) {
  const server = http.createServer(createApp());
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    server.listen(0, () => {
      const { port } = server.address() as any;
      const r = http.request({ hostname: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': 0 } }, (res: any) => {
        let d = ''; res.on('data', (c: string) => { d += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: JSON.parse(d || '{}') }); });
      });
      r.on('error', (e: Error) => { server.close(); reject(e); });
      r.end();
    });
  });
}

beforeEach(() => { service.getRecallPreview.mockReset(); service.recallExpedition.mockReset(); });

describe('expedition recall routes', () => {
  it('adds phase times to the expedition list', async () => {
    const res = await call('GET', '/expeditions');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 'e1', phase_out_ends_at: 'A', phase_site_ends_at: 'B' });
  });
  it('returns the preview', async () => {
    service.getRecallPreview.mockResolvedValue({ allowed: true, phase: 'on_site', recallMinutes: 135, waitMinutes: 450, lossChance: 0.25, share: 0.33 });
    const res = await call('GET', '/expeditions/e1/recall-preview');
    expect(res.status).toBe(200);
    expect(service.getRecallPreview).toHaveBeenCalledWith('pl-1', 'e1');
    expect(res.body.recallMinutes).toBe(135);
  });
  it('recalls', async () => {
    service.recallExpedition.mockResolvedValue({ completesAt: 'T', recallMinutes: 135 });
    const res = await call('POST', '/expeditions/e1/recall');
    expect(res.status).toBe(200);
    expect(service.recallExpedition).toHaveBeenCalledWith('pl-1', 'e1');
    expect(res.body).toEqual({ completesAt: 'T', recallMinutes: 135 });
  });
  it('passes through 404 for someone else\'s expedition', async () => {
    service.recallExpedition.mockRejectedValue(new (RecallError as any)(404, 'Expedition not found'));
    const res = await call('POST', '/expeditions/other/recall');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Expedition not found');
  });
  it('passes through 400 with the reason', async () => {
    service.getRecallPreview.mockRejectedValue(new (RecallError as any)(400, 'The pod is already on its return leg'));
    const res = await call('GET', '/expeditions/e1/recall-preview');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('The pod is already on its return leg');
  });
  it('500s on unexpected errors', async () => {
    service.recallExpedition.mockRejectedValue(new Error('db down'));
    const res = await call('POST', '/expeditions/e1/recall');
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npx vitest run src/routes/__tests__/expeditions-recall.test.ts`
Expected: FAIL (routes missing; list lacks phase fields).

- [ ] **Step 3: Implement** in `src/routes/expeditions.ts`

Add to the imports:

```ts
import { withPhases, getRecallPreview, recallExpedition, RecallError } from '../services/expedition/recallService.js';
```

In `GET /`, change `res.json(expeditions);` to `res.json(await withPhases(expeditions));`.

Add after the `POST /collect/:expeditionId` route:

```ts
function recallErrorStatus(err: any): number {
  return err instanceof RecallError ? err.status : 500;
}

/** GET /api/expeditions/:expeditionId/recall-preview — What recalling this pod now would do (nothing is rolled). */
expeditionsRouter.get('/:expeditionId/recall-preview', async (req, res) => {
  try {
    const result = await getRecallPreview((req as AuthenticatedRequest).playerId, req.params.expeditionId);
    res.json(result);
  } catch (err: any) {
    res.status(recallErrorStatus(err)).json({ error: err.message });
  }
});

/** POST /api/expeditions/:expeditionId/recall — Call the pod home early (loss and partial haul rolled now, revealed on collection). */
expeditionsRouter.post('/:expeditionId/recall', async (req, res) => {
  try {
    const result = await recallExpedition((req as AuthenticatedRequest).playerId, req.params.expeditionId);
    res.json(result);
  } catch (err: any) {
    res.status(recallErrorStatus(err)).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Run the full server suite and the type check**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npx vitest run && npx tsc --noEmit -p . 2>&1 | grep -v authDcl | head`
Expected: all tests pass; no type errors besides the pre-existing `authDcl.ts` one (if still present on main).

- [ ] **Step 5: Commit**

```bash
git add src/routes/expeditions.ts src/routes/__tests__/expeditions-recall.test.ts
git commit -m "Expeditions: recall preview and recall routes; phase times on the list

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Mechanics wiki pages

**Files:**
- Create: `docs/mechanics/README.md`
- Create: `docs/mechanics/expeditions.md`

**Interfaces:** documentation only; values must match `src/utils/constants.ts`, `src/services/expedition/deploy.ts`, `src/utils/formulas.ts` and `recall.ts` on this branch.

- [ ] **Step 1: Write `docs/mechanics/README.md`**

```markdown
# Game Mechanics

How the numbers in Galaxy Gardeners work. One page per system; each states the formula, where its constants live in the code, and a worked example.

| Page | Covers |
|---|---|
| [Expeditions](expeditions.md) | Pod trip length, pod loss, loot, trip phases, recalling a pod |

Keep a page in step with its source files: when a constant changes, update the page in the same commit.
```

- [ ] **Step 2: Write `docs/mechanics/expeditions.md`**

```markdown
# Expeditions

Mining pods work asteroid belts; exploration pods scan planets and moons for flora. Every trip's outcome (whether the pod survives and what it brings back) is rolled at launch and revealed when the trip is collected.

## Trip length

    duration = round(baseMinutes / expeditionSpeed)

`baseMinutes` comes from the target's risk tier, `expeditionSpeed` from the Star Drive upgrade (1.0 = no upgrade) times any global event multiplier. Source: `expeditionDuration` in `src/utils/formulas.ts`.

| Belt risk | Planet/moon risk | Base minutes | Launch loss chance |
|---|---|---|---|
| low | safe | 5 | 5 % |
| medium | moderate | 60 | 15 % |
| high | dangerous | 240 | 30 % |
| extreme | hostile | 720 | 50 % |

Source: `BELT_RISK` and the planet risk tiers in `src/utils/constants.ts`.

## Pod loss at launch

    lossChance = max(tierLoss − shielding / 100, 2 %)

Shielding is `blast_shielding` for mining and `environmental_shielding` for exploration (ship upgrades). The 2 % floor is `POD_LOSS_FLOOR`. During the walkthrough pods are never lost. Source: `src/services/expedition/deploy.ts`.

## Loot

- **Mining:** rolled from the belt's loot table for its risk level (`rollMiningRewards` in `deploy.ts`).
- **Exploration:** the body's flora species, plus a specimen sample if the vault has room (`rollExplorationRewards` in `deploy.ts`).

## Phases

Every trip of length T has three phases. Easy targets are mostly travel; hard ones are mostly work on site.

| Tier | Out | On site | Back |
|---|---|---|---|
| low / safe | 2/5 | 1/5 | 2/5 |
| medium / moderate | 3/10 | 2/5 | 3/10 |
| high / dangerous | 1/5 | 3/5 | 1/5 |
| extreme / hostile | 1/8 | 3/4 | 1/8 |

Source: `EXPEDITION_PHASES` in `src/services/expedition/recall.ts`.

## Recalling a pod

A pod can be recalled while it is **en route** or **on site**, once per trip. On the back leg it is already coming home.

**Recall time**

    recallMinutes = min( min(elapsed, out) × (1 + difficulty),  T − elapsed )

| Tier | difficulty |
|---|---|
| low / safe | 0 |
| medium / moderate | 0.10 |
| high / dangerous | 0.25 |
| extreme / hostile | 0.50 |

An en-route pod turns around; an on-site pod breaks away and flies the whole out leg, slowed by how hostile the site is. Never slower than waiting.

**Loss on the way out** (a fresh roll replaces the launch roll)

    exposure   = min(1, elapsed / out)
    lossChance = max(tierLoss × 0.5 × exposure − shielding / 100, 2 %)    (0 during the walkthrough)

**Partial haul** (only if the pod survives)

    share = clamp((elapsed − out) / site, 0, 1)

- Mining: each resource becomes `floor(quantity × share)`; zeros are dropped.
- Exploration: the scan finished with probability `share`; otherwise the pod returns empty.
- A pod whose launch roll said "lost" has fresh loot rolled first, so a surviving recall still brings its share.

Source: `previewRecall` and `recalledRewards` in `src/services/expedition/recall.ts`; `recallExpedition` in `recallService.ts`.

**Worked example.** Hostile planet, T = 12 h: out 1.5 h, on site 9 h, back 1.5 h. Recalled at 4.5 h (3 h into the site phase):

- recall time = min(1.5 h × 1.5, 7.5 h) = 2 h 15 m
- loss chance = 50 % × 0.5 × 1 = 25 % before shielding
- share = 3 h / 9 h = 33 %: the scan result comes back one time in three

A recalled expedition keeps its in-progress status with a new return time, so it is collected like any other trip.
```

- [ ] **Step 3: Check the numbers against the code**

Run: `grep -n "podLoss\|baseMinutes\|POD_LOSS_FLOOR =" src/utils/constants.ts && grep -n "export const EXPEDITION_PHASES\|RECALL_DIFFICULTY" -A5 src/services/expedition/recall.ts`
Expected: every value in the two pages appears in the output.

- [ ] **Step 4: Commit**

```bash
git add docs/mechanics/README.md docs/mechanics/expeditions.md
git commit -m "Docs: mechanics wiki, starting with expeditions and pod recall

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Scene — phases, RECALL button, confirmation dialog

Work in `~/Git/galaxy-gardeners-dcl`.

**Files:**
- Create: `src/stations/podPhase.ts`
- Modify: `src/api.ts` (two calls)
- Modify: `src/ui.tsx` (recall dialog)
- Modify: `src/stations/shipOverview.ts` (Active Missions rows, countdown signature)
- Modify: `src/stations/sectorMap.ts` (RETURNING label)

**Interfaces:**
- Consumes: server fields `recalled_at`, `phase_out_ends_at`, `phase_site_ends_at` on each expedition from `GET /api/expeditions`; the two recall routes.
- Produces:
  - `podPhase(e: any, now?: number): 'EN ROUTE' | 'ON SITE' | 'RETURNING' | null` and `canRecall(e: any, now?: number): boolean` (podPhase.ts)
  - `api.getRecallPreview(expeditionId: string)`, `api.recallExpedition(expeditionId: string)`
  - `openRecallDialog(expeditionId: string, label: string): void` (ui.tsx)

- [ ] **Step 1: Add `src/stations/podPhase.ts`**

```ts
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
```

- [ ] **Step 2: Add the API calls** in `src/api.ts`, after `getExpeditions`:

```ts
export type RecallPreview = { allowed: boolean; reason?: string; phase: string; recallMinutes: number; waitMinutes: number; lossChance: number; share: number }

/** What recalling this pod now would do (server-computed, nothing rolled yet). */
export async function getRecallPreview(expeditionId: string): Promise<RecallPreview> {
  return apiGet<RecallPreview>(`/api/expeditions/${expeditionId}/recall-preview`)
}

/** Call the pod home early. The outcome is rolled now and revealed on collection. */
export async function recallExpedition(expeditionId: string): Promise<{ completesAt: string; recallMinutes: number }> {
  return apiPost(`/api/expeditions/${expeditionId}/recall`)
}
```

- [ ] **Step 3: Add the recall dialog** in `src/ui.tsx`

After the `let showPurchaseDialog = false` line add:

```ts
type RecallDialogState = { expeditionId: string; label: string; preview: api.RecallPreview | null; working: boolean; error: string | null }
let recallDialog: RecallDialogState | null = null

const fmtMinutes = (m: number): string => {
  const total = Math.max(1, Math.ceil(m))
  const h = Math.floor(total / 60)
  return h > 0 ? `${h}h ${String(total % 60).padStart(2, '0')}m` : `${total}m`
}
const serverError = (err: any): string => {
  const m = /^API error \d+: (.*)$/s.exec(String(err?.message ?? ''))
  if (m) { try { return JSON.parse(m[1]).error ?? 'Recall failed' } catch { return 'Recall failed' } }
  return err?.message || 'Recall failed'
}

/** Opens the recall confirmation for one expedition and loads its preview. */
export function openRecallDialog(expeditionId: string, label: string): void {
  recallDialog = { expeditionId, label, preview: null, working: false, error: null }
  api.getRecallPreview(expeditionId)
    .then(p => { if (recallDialog?.expeditionId === expeditionId) recallDialog.preview = p })
    .catch(err => { if (recallDialog?.expeditionId === expeditionId) recallDialog.error = serverError(err) })
}

async function confirmRecall(): Promise<void> {
  const d = recallDialog
  if (!d || d.working) return
  d.working = true
  try {
    const r = await api.recallExpedition(d.expeditionId)
    showNotification(`Recall signal sent. The ${d.label.toLowerCase()} pod is back in ${fmtMinutes(r.recallMinutes)}.`, Color4.create(0, 0.9, 1, 1))
    recallDialog = null
    refreshStation('ship')
  } catch (err: any) {
    d.working = false
    d.error = serverError(err)
  }
}
```

Before `const PurchaseDialog = () => {` add the component:

```tsx
const RecallDialog = () => {
  const d = recallDialog
  if (!d) return null
  const p = d.preview
  const lines: string[] = d.error ? [d.error]
    : !p ? ['Contacting the pod…']
    : !p.allowed ? [p.reason ?? 'Recall not possible']
    : [
      `Recall: back in ${fmtMinutes(p.recallMinutes)} · ${p.share > 0 ? `~${Math.round(p.share * 100)}% of the haul` : 'returns empty'} · ${Math.round(p.lossChance * 100)}% loss risk`,
      `Or wait: back in ${fmtMinutes(p.waitMinutes)} with the full result`,
    ]
  const canConfirm = !!p && p.allowed && !d.error && !d.working
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(640), flexDirection: 'column', padding: { top: px(20), bottom: px(20), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', height: px(36), margin: { bottom: px(12) } }} uiText={{ value: `RECALL ${d.label.toUpperCase()} POD?`, fontSize: px(26), color: Color4.create(0, 1, 1, 1), textAlign: 'middle-center' }} />
        {lines.map((line, i) => (
          <UiEntity key={`rl${i}`} uiTransform={{ width: '100%', height: px(28), margin: { bottom: px(6) } }} uiText={{ value: line, fontSize: px(18), color: i === 0 ? Color4.White() : Color4.create(0.6, 0.7, 0.8, 1), textAlign: 'middle-center' }} />
        ))}
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: px(12) } }}>
          <UiEntity uiTransform={{ width: px(200), height: px(44), margin: { right: px(12) }, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: canConfirm ? Color4.create(0.6, 0.1, 0.5, 1) : Color4.create(0.15, 0.15, 0.15, 1) }}
            uiText={{ value: d.working ? 'SENDING…' : 'RECALL', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { if (canConfirm) void confirmRecall() }} />
          <UiEntity uiTransform={{ width: px(200), height: px(44), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0, 0.4, 0.5, 1) }}
            uiText={{ value: 'KEEP WORKING', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { recallDialog = null }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
```

In the HUD root, add `<RecallDialog />` directly after `<PurchaseDialog />`.

- [ ] **Step 4: Active Missions rows** in `src/stations/shipOverview.ts`

Add imports:

```ts
import { podPhase, canRecall } from './podPhase'
import { openRecallDialog } from '../ui'
```

(if `../ui` is already imported in this file, add `openRecallDialog` to that import instead).

In `drawMissions`, replace these three lines:

```ts
    const mining = exp.expedition_type === 'mining'
    text(missionBag, low, 0.25, y, mining ? 'Mining' : 'Exploration', 0.34, mining ? Color4.create(0.9, 0.7, 0.3, 1) : GREEN, TextAlignMode.TAM_MIDDLE_LEFT)
    text(missionBag, low, 1.75, y, timeText, 0.34, isComplete ? Color4.create(1, 1, 0.3, 1) : DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
    if (isComplete && !status) button(missionBag, low, 2.25, y, 0.75, 0.24, 'COLLECT', 'Complete Mission', () => collect(exp.id), { size: 0.26 })
```

with:

```ts
    const mining = exp.expedition_type === 'mining'
    const phase = isComplete ? null : podPhase(exp)
    const label = mining ? 'Mining' : 'Exploration'
    text(missionBag, low, 0.25, y, phase ? `${label} · ${phase}` : label, 0.3, mining ? Color4.create(0.9, 0.7, 0.3, 1) : GREEN, TextAlignMode.TAM_MIDDLE_LEFT)
    text(missionBag, low, 1.75, y, timeText, 0.34, isComplete ? Color4.create(1, 1, 0.3, 1) : DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
    if (isComplete && !status) button(missionBag, low, 2.25, y, 0.75, 0.24, 'COLLECT', 'Complete Mission', () => collect(exp.id), { size: 0.26 })
    else if (!status && canRecall(exp)) button(missionBag, low, 2.25, y, 0.75, 0.24, 'RECALL', `Recall ${label.toLowerCase()} pod`, () => openRecallDialog(exp.id, label), { size: 0.24, variant: 'magenta' })
```

At the bottom of the file, change the countdown watcher's read function so phase changes redraw the rows:

```ts
  () => screens ? expeditions.map((e: any) => `${e.id}:${minutesUntil(e.completes_at)}:${podPhase(e) ?? ''}`).join('|') : '',
```

- [ ] **Step 5: Sector map label** in `src/stations/sectorMap.ts`

Replace:

```ts
      : (pods.length > 1 ? `${pods.length} OUT · ${formatMinutes(soonest)}` : formatMinutes(soonest))
```

with:

```ts
      : (pods.length > 1 ? `${pods.length} OUT · ${formatMinutes(soonest)}` : `${pods[0].recalled_at ? 'RETURNING ' : ''}${formatMinutes(soonest)}`)
```

- [ ] **Step 6: Build**

Run: `cd ~/Git/galaxy-gardeners-dcl && source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | sed -E 's/\x1b\[[0-9;]*m//g' | grep -E "error|Type checking" | tail -3`
Expected: `Type checking completed without errors`.

- [ ] **Step 7: Commit**

```bash
git add src/stations/podPhase.ts src/api.ts src/ui.tsx src/stations/shipOverview.ts src/stations/sectorMap.ts
git commit -m "Pod recall in the scene: phases on missions, RECALL button, confirmation with both options

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Release (needs the user's go-ahead at each step)

- [ ] **Step 1: The user runs migration 047** in the Supabase SQL editor on staging and production:

```sql
ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;
```

The server's expedition list selects `recalled_at`, so the server must not be deployed before this runs.

- [ ] **Step 2: Merge and push the server** (from the worktree, after the full suite passes):

```bash
cd ~/Git/galaxy-gardeners-server-recall
git fetch origin && git rebase origin/main
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npx vitest run
git push origin HEAD:main
git merge-base --is-ancestor origin/staging HEAD && git push origin HEAD:staging
```

Wait for Railway production to report SUCCESS for the new commit.

- [ ] **Step 3: Deploy the scene** (the user signs with the MetaPetal wallet 0x7e56…374C):

```bash
cd ~/Git/galaxy-gardeners-dcl && source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build && npm run deploy -- --target-content https://worlds-content-server.decentraland.org --skip-build
```

- [ ] **Step 4: Manual check in the world**

1. Send a mining pod to a belt; Active Missions shows `Mining · EN ROUTE` with a RECALL button.
2. Press RECALL: the dialog shows recall time, "returns empty", loss risk, and the wait option. Confirm; the row shows `RETURNING`.
3. Collect when it lands; travel is allowed again.
4. Send another pod, wait until `ON SITE`, recall: the dialog shows a haul percentage; after collection the haul is at most that share.

- [ ] **Step 5: Remove the worktree** once the branch is merged:

```bash
git -C ~/Git/galaxy-gardeners-server worktree remove ~/Git/galaxy-gardeners-server-recall
```
