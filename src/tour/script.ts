// The STEM ship tour, scene by scene. Mirrors the iOS walkthrough's seven scenes with every instruction pointed at
// the ship's desks. {placeholders} come from the server's /api/walkthrough/scene-data/:scene (nested keys with dots).
import { ShotId } from './shots'
import { TourEvent } from './events'

export type StepSetup = 'systemView' | 'galaxyView' | 'shipOverview' | 'podOperations' | 'shipSystems' | 'floraSummary' | 'floraVault'
export type Step = { shot: ShotId; lines: string[]; panel?: { title: string; text: string }; waitFor?: TourEvent; setup?: StepSetup }
export type TourScene = { number: number; resume: string; steps: Step[] }

export const TOUR: TourScene[] = [
  {
    number: 1,
    resume: "Welcome back, Captain. Let's pick up where we left off.",
    steps: [
      { shot: 'bridge', panel: { title: 'SHIP STATUS', text: 'ALL SYSTEMS NOMINAL' }, lines: [
        "Welcome aboard, Captain. I'm STEM — your Ship Telemetry and Exploration Module. I run the navigation, monitor the systems, manage the pods, and keep the lights on.",
        "I've been with this ship a while. You're the new part. Let me show you around.",
      ] },
    ],
  },
  {
    number: 2,
    resume: 'Welcome back, Captain. I was showing you your home system.',
    steps: [
      { shot: 'hologram', setup: 'systemView',
        panel: { title: 'SYSTEM SCAN', text: 'HOME SYSTEM: {starName}\nSTAR TYPE: {starType} — {starDescription}\nPLANETS: {planetCount}\nASTEROID BELTS: {beltCount}' },
        lines: [
          '{introLine}',
          "Some of these planets support life — alien flora that's never been cataloged. Barren worlds and gas giants won't have any, but the ones that do each host a unique species. That's where you come in.",
          '{stationLine}',
        ] },
    ],
  },
  {
    number: 3,
    resume: 'Back online. We were setting up your first expeditions.',
    steps: [
      { shot: 'hologramClose', setup: 'systemView',
        panel: { title: 'EXPLORATION TARGET', text: 'TARGET: {targetPlanet.name}\nTYPE: {targetPlanet.type}\nRISK: {targetPlanet.riskTier}' },
        lines: [
          'Your exploration pods scan planets for alien flora without disturbing the ecosystem. Each scan brings back a holographic sample. The catalog entry is permanent.',
          '{targetPlanet.name} looks safe enough for your first scan. Click it on the hologram, then press DEPLOY EXPLORATION POD.',
        ], waitFor: 'exploration_deployed' },
      { shot: 'hologramClose', setup: 'systemView',
        panel: { title: 'MINING TARGET', text: 'TARGET: {targetBelt.name}\nRISK: {targetBelt.riskLevel}\nREWARDS: Iron Ore, Copper Ore, Helium-3' },
        lines: [
          "A scan of a safe planet takes about {expeditionTimeMinutes} minutes, and expeditions keep running while you're away.",
          'Your other pods are mining pods. They bring back resources from asteroid belts — fuel for the ship and materials for upgrades. Click {targetBelt.name} on the hologram and press DEPLOY MINING POD.',
        ], waitFor: 'mining_deployed' },
      { shot: 'hologram', lines: [
        "Two expeditions running at once. When they return you'll have your first specimen and your first batch of resources. Now, the ship.",
      ] },
    ],
  },
  {
    number: 4,
    resume: 'Systems restored. I was walking you through the ship.',
    steps: [
      { shot: 'shipDesk', setup: 'shipOverview', lines: [
        'This is the ship desk. Ship Overview shows your fuel, cargo, ship stats and active missions — collect finished expeditions here.',
        'REFINE turns mined Helium-3 into 20 fuel and Plasma Crystals into 50. It works anywhere, no station needed.',
      ] },
      { shot: 'shipDesk', setup: 'podOperations', lines: [
        'Pod Operations — view your pods and build new ones. You have {miningPods} mining and {explorationPods} exploration pods.',
      ] },
      { shot: 'shipDesk', setup: 'shipSystems', lines: [
        'Ship Systems — upgrade your fuel tank, shielding, pod bays and more. Upgrades install instantly while docked, and take time in the field.',
      ] },
      { shot: 'floraDesk', setup: 'floraVault', lines: [
        'The Collections desk holds your Flora Catalog, your Specimen Vault — {vaultCapacity} sample slots to start — and your cargo hold.',
      ] },
    ],
  },
  {
    number: 5,
    resume: "Reconnected. Let's talk about fuel and stations.",
    steps: [
      { shot: 'shipDesk', setup: 'shipOverview', panel: { title: 'FUEL STATUS', text: 'FUEL: {fuelCurrent} / {fuelCapacity}\nSOLAR RECHARGE: ACTIVE' }, lines: [
        'Fuel keeps you moving. Travel costs fuel for every galactic unit of distance. Run out and you wait for solar recharge.',
        'Three ways to refuel: refine Helium-3 or Plasma Crystals, wait for the star to recharge you, or buy Fuel Cells with BUY FUEL.',
      ] },
      { shot: 'navConsole', lines: [
        'This is the Stellar Navigation console. {homeStationName} is right here in this system. Press DOCK on the console.',
      ], waitFor: 'docked' },
      { shot: 'navConsole', lines: [
        "Docked. Stations mean cheaper repairs and instant upgrades. When you're ready to move on, press UNDOCK on this console.",
      ] },
    ],
  },
  {
    number: 6,
    resume: 'Signal reacquired. We were looking at the discovery system.',
    steps: [
      { shot: 'discovery', panel: { title: 'DISCOVERY ARRAY', text: 'STATUS: ONLINE\nDIRECTIONS: INWARD · LATERAL · VERTICAL · OUTWARD' }, lines: [
        'The galaxy is near-infinite. New systems are discovered as you push outward, from the Stellar Discovery desk.',
        'Inward — toward the core: riskier, rarer flora. Outward — toward the rim: safer, sparser. Lateral — same depth, new territory. Vertical — above or below the galactic plane, where unusual systems hide.',
        'Every system you discover is visible to all explorers, but you get credit as the discoverer — permanently.',
      ] },
    ],
  },
  {
    number: 7,
    resume: 'Back in range. Take a look at this, Captain.',
    steps: [
      { shot: 'galaxyTop', setup: 'galaxyView', panel: { title: 'TOUR COMPLETE', text: 'MINE · UPGRADE · EXPLORE · DISCOVER · TRADE' }, lines: [
        "This is the galaxy. Every dot is a star system. Most haven't been discovered yet.",
        '{scanLine}',
        "I'll be here whenever you need me — press STEM at the top of the screen. The galaxy is yours, Captain.",
      ] },
    ],
  },
]

/** Replaces {key} and {nested.key} with values from the scene data; unknown keys become '—'. */
export function fill(text: string, data: Record<string, any>): string {
  return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, key: string) => {
    const v = key.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), data)
    return v === undefined || v === null || v === '' ? '—' : String(v)
  })
}
