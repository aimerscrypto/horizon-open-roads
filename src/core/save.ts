// Persistent progress + settings in localStorage.
export type Quality = 'low' | 'medium' | 'high';
export interface Settings { quality: Quality; master: number; engine: number; ambience: number; units: 'kmh' | 'mph'; weather: 'dynamic' | 'clear' | 'rain'; timeFlow: 'cycle' | 'day' | 'sunset' | 'night'; camShake: boolean; }
export interface ActivityRecord { best: number; stars: number; runs: number; }
export interface SaveData { v: 1; credits: number; xp: number; car: string; owned: string[]; activities: Record<string, ActivityRecord>; settings: Settings; distance: number; camMode: number; seenIntro: boolean; }

const KEY = 'horizon-open-roads-v1';
const ALL_CARS = ['coupe', 'gt', 'suv', 'hyper'];
/** First-run default: integrated GPUs start on Low, everything else on Medium. */
function detectQuality(): Quality {
  try {
    const gl = document.createElement('canvas').getContext('webgl2'); if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/SwiftShader|llvmpipe|Software/i.test(name)) return 'low';
    if (/Intel/i.test(name) && !/Arc/i.test(name)) return 'low';
    if (/RTX|RX [5-9]\d{3}|Apple M|Radeon Pro|GTX 1[06-9]|GTX 9[78]0/i.test(name)) return 'high';
  } catch { /* fall through */ }
  return 'medium';
}
const defaults = (): SaveData => ({
  v: 1, credits: 5000, xp: 0, car: 'coupe', owned: [...ALL_CARS], activities: {}, distance: 0, camMode: 0, seenIntro: false,
  settings: { quality: 'medium', master: 0.8, engine: 0.8, ambience: 0.6, units: 'kmh', weather: 'dynamic', timeFlow: 'cycle', camShake: true },
});
export class Save {
  data: SaveData;
  isNew = false;
  constructor() {
    const d = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const p = JSON.parse(raw); Object.assign(d, p); d.settings = Object.assign(defaults().settings, p.settings || {}); } else this.isNew = true;
    } catch { this.isNew = true; }
    // Every car is free: make sure all of them are in the garage, including on older saves.
    for (const id of ALL_CARS) if (!d.owned.includes(id)) d.owned.push(id);
    if (this.isNew) d.settings.quality = detectQuality();
    this.data = d;
  }
  write() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ } }
  reset() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } this.data = defaults(); }
  get level() { return 1 + Math.floor(Math.sqrt(this.data.xp / 400)); }
  get levelProgress() { const l = this.level, a = (l - 1) * (l - 1) * 400, b = l * l * 400; return (this.data.xp - a) / (b - a); }
  get totalStars() { return Object.values(this.data.activities).reduce((s, a) => s + a.stars, 0); }
}
