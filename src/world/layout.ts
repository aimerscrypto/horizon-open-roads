// Hand-authored world layout: one connected map, three biomes, a main loop and a dirt cut-through.
// Coordinates: +X east, +Z south, Y up. Metres.
import { noise2, smoothstep } from '../core/noise';

export const WORLD_SIZE = 4480;
export const HALF = WORLD_SIZE / 2;
export const CELL = 4;
export const GRID = WORLD_SIZE / CELL; // cells per side
export const CHUNK_CELLS = 70;
export const CHUNKS = GRID / CHUNK_CELLS; // 16

export type Surface = 'asphalt' | 'dirt';
export interface RoadDef {
  id: string; name: string; surface: Surface; halfWidth: number; closed: boolean;
  pts: [number, number, number][]; // x, z, y
}

export const ROADS: RoadDef[] = [
  {
    id: 'loop', name: 'Horizon Loop', surface: 'asphalt', halfWidth: 5.6, closed: true,
    pts: [
      // Desert — long fast sweepers
      [-300, 1500, 30], [-900, 1560, 28], [-1480, 1320, 32], [-1760, 800, 40], [-1660, 220, 56], [-1720, -300, 84],
      // Mountain — climb, switchbacks, summit tunnel, descent
      [-1560, -700, 128], [-1250, -900, 164], [-900, -925, 190], [-790, -1010, 201], [-900, -1095, 212],
      [-1200, -1110, 234], [-1310, -1195, 245], [-1200, -1280, 256], [-850, -1310, 280], [-480, -1430, 310],
      [-130, -1540, 334], [330, -1520, 326], [740, -1350, 288], [1010, -1060, 236], [900, -760, 200],
      // Forest — flowing, narrow-feeling road under the pines
      [1140, -520, 170], [1500, -350, 136], [1760, 0, 112], [1600, 350, 96], [1810, 650, 90], [1560, 920, 85],
      [1710, 1250, 80], [1350, 1510, 70], [900, 1400, 60], [470, 1610, 45],
    ],
  },
  {
    id: 'cut', name: 'Dust Devil Cut', surface: 'dirt', halfWidth: 4.2, closed: false,
    pts: [
      [-1660, 220, 56], [-1380, 120, 60], [-1000, 190, 58], [-560, 360, 52], [-120, 210, 56], [300, 330, 62],
      [720, 420, 72], [1060, 250, 86], [1340, 300, 92], [1600, 350, 96],
    ],
  },
];

/** Rivers / canyons carve the terrain; roads crossing them become bridges automatically. */
export interface RiverDef { id: string; water: boolean; bottom: number; top: number; pts: [number, number, number][]; }
export const RIVERS: RiverDef[] = [
  {
    id: 'pine-river', water: true, bottom: 9, top: 34,
    pts: [[1480, -900, 196], [1420, -640, 150], [1335, -430, 118], [1300, -120, 96], [1290, 150, 80], [1300, 290, 74],
      [1230, 640, 62], [1150, 1050, 52], [1110, 1300, 47], [1125, 1460, 44], [1180, 1800, 38], [1200, 2300, 34]],
  },
  {
    id: 'red-canyon', water: false, bottom: 12, top: 46,
    pts: [[-2300, 470, 18], [-1950, 500, 20], [-1700, 520, 22], [-1420, 580, 26], [-1150, 700, 33], [-960, 790, 42]],
  },
];

/** Tunnel: road samples of `road` inside this circle are roofed over by the summit ridge. */
export const TUNNEL = { road: 'loop', x: 100, z: -1535, r: 150, ridge: 78 };

export const START = { road: 'loop', s: -80 };

/** Biome weights (desert, mountain, forest), each 0..1 summing to 1. */
export function biomeAt(x: number, z: number, out: [number, number, number]): [number, number, number] {
  const wob = noise2(x * 0.0021, z * 0.0021, 91) * 140;
  const m = smoothstep(-330, -820, z + wob * 0.6 - Math.max(0, -x - 1300) * 0.25);
  const f = (1 - m) * smoothstep(250, 700, x + wob + (z > 1300 ? (z - 1300) * 0.5 : 0));
  out[0] = Math.max(0, 1 - m - f); out[1] = m; out[2] = f;
  return out;
}

// ---------- Activities ----------
export type ActivityKind = 'race' | 'trial' | 'trap' | 'drift';
export interface ActivityDef {
  id: string; kind: ActivityKind; name: string; biome: 'Desert' | 'Mountain' | 'Forest'; road: string;
  /** distance along road for start (race/trial), trap position, or drift zone start */
  s0: number; /** end distance (races wrap around the loop) */ s1: number;
  /** star thresholds: time in s (race/trial, lower is better), km/h (trap), points (drift) */
  stars: [number, number, number]; reward: number; blurb: string;
}

export const ACTIVITIES: ActivityDef[] = [
  { id: 'race-desert', kind: 'race', name: 'Redrock Sprint', biome: 'Desert', road: 'loop', s0: 90, s1: 2950, stars: [76, 65, 56], reward: 6000, blurb: 'Flat-out point-to-point across the desert floor and over Red Canyon.' },
  { id: 'race-mountain', kind: 'race', name: 'Summit Hillclimb', biome: 'Mountain', road: 'loop', s0: 3420, s1: 7440, stars: [140, 118, 102], reward: 9000, blurb: 'Switchbacks, the summit tunnel and a long drop toward the pines.' },
  { id: 'race-forest', kind: 'race', name: 'Pinewood Run', biome: 'Forest', road: 'loop', s0: 8560, s1: 11850, stars: [104, 88, 76], reward: 7000, blurb: 'A flowing ribbon of tarmac under the trees, with two river crossings.' },
  { id: 'trial-loop', kind: 'trial', name: 'Horizon Grand Tour', biome: 'Desert', road: 'loop', s0: 40, s1: -1, stars: [335, 288, 252], reward: 20000, blurb: 'One full 12.7 km lap of the Horizon Loop against the clock.' },
  { id: 'trial-cut', kind: 'trial', name: 'Dust Devil Dash', biome: 'Desert', road: 'cut', s0: 70, s1: 3360, stars: [112, 94, 82], reward: 8000, blurb: 'Dirt, crests and a timber bridge. Bring the SUV.' },
  { id: 'trap-desert', kind: 'trap', name: 'Mesa Straight', biome: 'Desert', road: 'loop', s0: 930, s1: 0, stars: [190, 240, 285], reward: 2500, blurb: 'Speed trap' },
  { id: 'trap-mountain', kind: 'trap', name: 'Summit Tunnel', biome: 'Mountain', road: 'loop', s0: 6420, s1: 0, stars: [150, 195, 235], reward: 2500, blurb: 'Speed trap' },
  { id: 'trap-forest', kind: 'trap', name: 'Lakeside Blast', biome: 'Forest', road: 'loop', s0: 11000, s1: 0, stars: [160, 200, 240], reward: 2500, blurb: 'Speed trap' },
  { id: 'drift-mountain', kind: 'drift', name: 'Switchback Slide', biome: 'Mountain', road: 'loop', s0: 4060, s1: 5080, stars: [4000, 10000, 20000], reward: 2500, blurb: 'Drift zone' },
  { id: 'drift-forest', kind: 'drift', name: 'Timberline Esses', biome: 'Forest', road: 'loop', s0: 9250, s1: 10200, stars: [4000, 10000, 20000], reward: 2500, blurb: 'Drift zone' },
  { id: 'drift-desert', kind: 'drift', name: 'Canyon Sweep', biome: 'Desert', road: 'loop', s0: 1700, s1: 2560, stars: [3500, 9000, 18000], reward: 2500, blurb: 'Drift zone' },
];
