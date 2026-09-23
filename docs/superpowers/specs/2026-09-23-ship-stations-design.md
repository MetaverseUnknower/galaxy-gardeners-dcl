# Ship and Flora Stations — Design

Date: 2026-09-23 (revised the same day to follow the concept art)

## Goal

Consolidate everything ship-related and everything inventory/flora-related onto two
physical stations inside the DaisyClass interior, styled after the concept art in
`references/`. Each station is a pair of desk models already in the scene: a tall
desk (top screen) and a low desk in front of it (low screen). The framework must be
reusable so further stations are a config entry.

## References

- `references/ship-overview-concept.png` — ship station, Overview view
- `references/ship-upgrades-concept.png` — ship station, Systems (upgrades) view
- `references/flora-station-concept.png` — flora station, Collections
- `references/pod-operations-concept.png` — a future Pod Operations view (out of scope)

The concepts define the visual language: dark navy glass panels with thin cyan
(`#00E5FF`-ish) border lines, section headers of icon + title + small uppercase
subtitle, cyan progress bars, cyan outline buttons with a bright filled variant for
the primary action, magenta as the selected/accent color, small muted footers and
quotes. Screens are content-dense but every element has a frame.

## Current state

- `src/shipDisplay.ts`, `src/upgradesPanel.ts`, `src/catalogPanel.ts` draw three
  floating panels in world coordinates from hard-coded centers.
- Desk models: `nav_panel_high_1.glb` (tall; vertical screen slab x ±3, y 2.22..5.27,
  front face at model z 0.79) and `nav_panel_low_1.glb` (low; sloped face from
  (y 0.5, z -1.3) to (y 2.2, z 0.7), ~50° from vertical). Model front is -z.
- West pair at (117.2, DECK_Y, 121.3) yaw `-32 + 90`; east pair mirrored across x=128
  with yaw negated. Desk rotation is `fromEulerDegrees(180, yaw, 180)`.
- Icons in `assets/icons/` are white glyphs on transparency, tinted in-scene.
- `assets/models/DaisyClass_Exterior.glb` (93.5 × 93.6 × 21.7 at scale 1) is unused
  in this scene and serves as the ship hologram at scale 0.012.

## Design

### Station framework (`src/stations.ts`)

```ts
interface StationConfig {
  id: string
  position: Vector3          // desk pair position on the deck (world)
  yaw: number                // middle Euler value; framework applies (180, yaw, 180)
  views: ViewDefinition[]    // first is the default
  notify: (text: string, color: Color4) => void
}
interface ViewDefinition {
  id: string
  render(screens: { top: Entity; low: Entity }, ctx: StationContext): Promise<void>
  clear(): void
}
interface StationContext {
  dashboard: any | null      // shared getShipDashboard() result; null if it has never loaded
  notify(text: string, color: Color4): void
  refresh(): Promise<void>   // re-fetch dashboard, clear and re-render the current view
  setView(id: string): Promise<void>
}
interface Station { id: string; setView(id: string): Promise<void>; refresh(): Promise<void>; destroy(): void }
```

`createStation` spawns the two desk models and two invisible **screen roots** parented
to them, using constants measured from the models: top root at desk-local
(0, 3.75, 0.79) with no tilt; low root at (0, 1.35, -0.3) tilted 50° back. A view
draws its entities as children of a root in screen coordinates: x to the viewer's
right, y up, negative z toward the viewer. Views never compute world coordinates, so
moving a desk moves everything on it, and the mirrored station is the same config
with the yaw negated.

Usable areas: top screen 5.6 × 2.8, low screen 5.6 × 2.4.

A view renders **both** screens at once. Switching views clears both. `refresh()`
keeps the current view. Overlapping refreshes are coalesced with a flag. If a view's
`render` throws, the framework clears it and draws "Unable to load" on the top screen;
`dashboard` keeps its last good value when the fetch fails.

`refreshStation(id)` is exported for code outside the stations (the 2D overlays).

### Drawing helpers (`src/stations/draw.ts`)

One module implements the concept's visual language so views only compose:
`text`, `frame` (glass + border strips, cyan or magenta), `header` (icon + title +
subtitle), `bar` (track + fill), `button` (outline / primary / magenta / disabled),
`tile` (category card with icon, title, subtitle, selected state), `listRow`
(selectable row with optional thumbnail), `image`, `icon` (tinted glyph), and
`hologram` (a GLB child that slowly yaws). Colors are constants here.

### Ship station (east pair)

**Overview view** (default), per `ship-overview-concept.png`:

- Top: header "SHIP OVERVIEW / KEEP EXPLORING"; top-right "RESOURCES used / capacity"
  with a bar. Left frame FUEL: gauge bar, "current / capacity", "Solar Recharge:
  +x fuel/hr", and two outline buttons REFINE and BUY FUEL that open the existing 2D
  overlays. Right frame: the ship hologram and an UPGRADES » button that switches to
  the Systems view.
- Low: left frame SHIP STATS, six rows of label / value / bar (bars are cosmetic,
  scaled by a per-stat nominal maximum). Right frame ACTIVE MISSIONS: rows of type,
  time remaining or READY, and a COLLECT button; paged when more than five; empty
  state "No active missions / CHART A COURSE. MAKE IT COUNT." The Pod Operations
  button in the concept is out of scope and not drawn.

**Systems view**, per `ship-upgrades-concept.png`:

- Top: header "SHIP SYSTEMS / UPGRADE AND MAINTAIN YOUR VESSEL"; ship hologram in the
  center; up to five upgrade cards per side (label "Cargo Hold T1" + cost line).
  Clicking a card selects it (magenta frame). Footer "A DEEPER UNIVERSE AWAITS".
- Low: left frame SELECTED MODULE: name, a one-line description per category,
  CURRENT LEVEL / NEXT LEVEL, and the stat modifier entries. Middle frame REQUIRED
  RESOURCES: one row per cost with "have / need" and a check or cross, then a large
  UPGRADE button (primary when affordable, disabled otherwise). Right frame SYSTEM
  STATUS: bars for Fuel, Cargo, Vault, Blast Shielding, Env. Shielding. Bottom-left
  "‹ BACK TO OVERVIEW".
- After a successful upgrade: toast, `refresh()`, selection stays on the same category
  if it still has a next tier, else the first card.

### Flora station (west pair), per `flora-station-concept.png`

The top screen is the same in every flora view: header "SHIP COLLECTIONS / EXPLORE //
STUDY // PRESERVE", a quote at the right, three tiles FLORA CATALOG (Discovered
Species), SPECIMEN VAULT (Captured Life Forms), RESOURCE INVENTORY (Materials &
Resources), and footer "SELECT A CATEGORY". The tile of the current view is
highlighted. Clicking a tile switches view.

- **Summary view** (default): low screen shows three counters with bars: species
  discovered, jars used / vault capacity, cargo used / capacity.
- **Catalog view**: low screen header "FLORA CATALOG / PLANTS & BOTANICAL DATA",
  top-right "n SPECIES DISCOVERED". Left: species list rows (thumbnail + name), paged
  by five, selected row highlighted. Center: large image of the selected species.
  Right: name, rarity, location, system, and the traits from the detail endpoint
  (loading state while it fetches). Selecting a species also calls the existing
  flora-select callback so the rest of the scene behaves as it does today.
  Bottom-left "‹ BACK TO COLLECTIONS" returns to Summary.
- **Vault view**: same layout with specimens grouped by species and "(xN)" counts;
  header "SPECIMEN VAULT / CAPTURED LIFE FORMS", top-right "jars / capacity" bar.
- **Inventory view**: header "RESOURCE INVENTORY / MATERIALS & RESOURCES", top-right
  "used / capacity" bar; rows of resource name, quantity and a bar, two columns when
  more than six.

### Icons

Existing glyphs used: `catalog-icon.png` (catalog tiles/headers), `specimen-icon.png`
(vault), `refinery-icon.png` and `fuel-purchase-icon.png` (fuel buttons),
`arrow-icon.png` (back and paging). Wanted in the same style, white glyph on
transparency, 512×512: `fuel-icon.png` (drop), `upgrades-icon.png` (wrench),
`systems-icon.png` (emblem), `stats-icon.png` (bars), `missions-icon.png` (target),
`resources-icon.png` (crystal), `check-icon.png`, `cross-icon.png`. Every icon slot is
optional: a header or tile without an icon file simply omits the glyph, so the work
does not block on art.

### Data and refresh

- One shared dashboard fetch per station refresh. The upgrades list and the catalog
  list are fetched by the views that need them.
- Refresh triggers: view switch, after any action (collect, upgrade, refine via the
  overlay's existing hook), and the scene-load path in `src/index.ts`.
- Failure: "Unable to load" on the top screen; last good dashboard kept; next refresh
  retries.

### Removals

- `src/shipDisplay.ts` and its floating fuel/missions panel behind the galaxy controls.
- `src/upgradesPanel.ts` and its east-wall panel.
- `src/catalogPanel.ts` and its floating panel.
- The four station desk entities in `src/environment.ts` (the framework spawns them).
- The `createShipDisplay` / `createUpgradesPanel` / `createCatalogPanel` wiring in
  `src/index.ts`, replaced by two `createStation` calls.

Unchanged: discovery desk and panel, the galaxy map, its control panel and the
display-screen desk model it sits on north of center (the "back panel", must not
move), system view, the 2D refinery and purchase overlays in `src/ui.tsx`, `src/api.ts`.

## Verification

No test runner exists in this repo. Verification is:

1. `npm run build` type-checks clean.
2. In the local preview: every view on both stations against its concept image;
   collect a mission; select an upgrade card and confirm the low screen follows;
   open REFINE and BUY FUEL; select a species and confirm the detail pane and the
   existing flora callback; confirm the removed panels are gone and the galaxy
   controls are untouched.
3. Deploy to `metapetal.dcl.eth` and spot-check the same in the world.

## Out of scope

- Pod Operations view and any pod/fabrication UI.
- A 3D refinery (the 2D overlay stays).
- Any change to the API or server.
