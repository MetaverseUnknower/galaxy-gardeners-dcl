# Pod Recall — Design

**Date:** 2026-09-26
**Status:** Draft for review
**Repos:** galaxy-gardeners-server (rules, route, docs), galaxy-gardeners-dcl (scene UI). iOS app: no changes required; recall UI there is a later follow-up.

## Goal

Let a player call a mining or exploration pod home early, mainly so they can travel (the server blocks travel while any expedition is out). A recall is a real decision: it takes time, the pod can still be lost on the way out, and a pod that had started working brings back only part of its haul.

Out of scope: star discoveries (the discovery desk), which are not pod expeditions.

## Expedition phases

Every expedition of length T is split into three phases whose proportions depend on the risk tier. Easy targets are mostly travel; hard targets are mostly work on site.

| Belt risk (mining) | Planet/moon risk (exploration) | Out | On site | Back |
|---|---|---|---|---|
| low | safe | 2/5 | 1/5 | 2/5 |
| medium | moderate | 3/10 | 2/5 | 3/10 |
| high | dangerous | 1/5 | 3/5 | 1/5 |
| extreme | hostile | 1/8 | 3/4 | 1/8 |

With `out = T × outRatio` and `site = T × siteRatio`, a pod is:

- **en route** while `elapsed < out`
- **on site** while `out ≤ elapsed < out + site`
- **returning** once `elapsed ≥ out + site` (the back leg)

T is the expedition's stored `duration_minutes` (already adjusted for Star Drive and event speed). Elapsed is measured from `started_at`.

## Recall rules

A recall is allowed only while the expedition is `in_progress`, not already recalled, and the pod is **en route or on site**. Once it is on the back leg it is already coming home.

**1. Recall time** (how long until the pod is back):

```
recallMinutes = min( min(elapsed, out) × (1 + difficulty),  T − elapsed )
```

| Tier | difficulty |
|---|---|
| low / safe | 0 |
| medium / moderate | 0.10 |
| high / dangerous | 0.25 |
| extreme / hostile | 0.50 |

An en-route pod simply turns around (it has flown `elapsed`, so it returns in about that long). An on-site pod must break away and fly the whole out leg, slowed by how hostile the site is. The time is capped at the time the trip had left, so recalling is never slower than waiting.

**2. Loss chance on the way out.** A fresh roll replaces the loss that was rolled at launch:

```
exposure   = min(1, elapsed / out)
lossChance = max( tierLoss × 0.5 × exposure − shielding / 100,  POD_LOSS_FLOOR )
```

`tierLoss` is the tier's launch loss (5 / 15 / 30 / 50 %). Shielding is the same stat the launch roll uses: `blast_shielding` for mining, `environmental_shielding` for exploration. `POD_LOSS_FLOOR` is the existing 2 % floor. Walkthrough protection (no losses during the tutorial) applies as at launch.

**3. Haul share** (only if the pod survives and had reached the site):

```
share = clamp( (elapsed − out) / site, 0, 1 )
```

- **Mining:** each resource in the pre-rolled haul becomes `floor(qty × share)`; resources that round to 0 are dropped. En route (share 0) returns empty.
- **Exploration:** the scan either finished or it did not. The pod returns its pre-rolled result (species and sample) with probability `share`; otherwise it returns empty. En route returns empty.

A pod lost on recall returns nothing and is destroyed, exactly like a pod lost on a normal trip.

## Worked example

Hostile planet, T = 12 h → out 1.5 h, on site 9 h, back 1.5 h. Recalled at elapsed 4.5 h (3 h into the site phase):

- recall time = min(1.5 h × 1.5, 7.5 h) = **2 h 15 m**
- loss chance = 50 % × 0.5 × 1 − shielding = **25 %** (before shielding)
- share = 3 h / 9 h = **33 %** → the scan result comes back with 33 % probability

## Server

- **Constants** (`src/utils/constants.ts`): `EXPEDITION_PHASES` (the ratio table) and `RECALL_DIFFICULTY`.
- **Pure rules module** (`src/services/expedition/recall.ts`): `expeditionPhase(...)` and `planRecall(...)` compute phase, eligibility, recall time, loss chance and share with an injectable random source. No database access, fully unit tested.
- **Route** `GET /api/expeditions/:id/recall-preview` → `{ allowed, reason?, phase, recallMinutes, waitMinutes, lossChance, share }` for the confirmation dialog (no randomness applied).
- **Route** `POST /api/expeditions/:id/recall` → rolls loss and share, then updates the expedition in place: `completes_at = now + recallMinutes`, `pod_lost`, `rewards` (scaled or cleared), `recalled_at = now`. Status stays `in_progress`, so collection, the travel block, the completion cron and the current iOS app all keep working unchanged; the result stays hidden until collection like any trip.
- **Migration** `047_expedition_recall.sql` (046 is taken by the unmerged fuel drops branch): `expeditions.recalled_at TIMESTAMPTZ NULL`. The expedition list returns `recalled_at` so clients can label the pod RETURNING.
- **Errors:** not your expedition (404), not in progress / already recalled / past the recall window (400 with the reason).

## Scene (DCL)

- **Active Missions** (ship overview): each running pod shows its phase — `EN ROUTE`, `ON SITE`, or `RETURNING` (back leg or recalled) — next to its countdown, and a `RECALL` button while recall is allowed.
- **Recall confirmation:** a small 2D dialog built from the preview: "Recall: back in 2h 15m · ~33 % of the haul · 25 % loss risk. Or wait: back in 7h 30m with the full result." Buttons RECALL / KEEP WORKING.
- **Pod Operations** sector map: recalled pods read `RETURNING` in the route label.
- Countdowns use the existing live countdown watcher.

## Documentation (the calculations wiki)

`docs/mechanics/` in the server repo becomes the home for game formulas, one page per system. This work adds:

- `docs/mechanics/README.md` — index of mechanics pages.
- `docs/mechanics/expeditions.md` — expedition duration (base minutes by tier, Star Drive), launch loss chances and shielding, loot, the phase table, and the full recall rules with the worked example.

Each page states the formula, the constants with their source file, and a worked example, so it can be published as a wiki later.

## Testing

- Unit tests for `recall.ts`: phase boundaries per tier; recall time en route, on site, and capped by time left; loss chance with exposure, shielding and floor; mining share rounding and dropped zeros; exploration share as a probability (deterministic random source); refusal on the back leg, after a previous recall, and for finished trips.
- Route tests for preview and recall: ownership, refusal reasons, the in-place update (status unchanged, new `completes_at`, `recalled_at` set).
- Scene: build check plus a manual pass (recall a pod en route and on site; confirm RETURNING, countdown, collection, and that travel unblocks after collection).

## Open follow-ups (not in this work)

- Recall UI in the iOS app (the server change is compatible; the app just won't offer the button yet).
