// Deterministic gradient noise helpers used by terrain, scatter and effects.
export function hash2(ix: number, iz: number, seed = 0): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(ix: number, iz: number, seed: number, dx: number, dz: number): number {
  const a = hash2(ix, iz, seed) * 6.2831853;
  return Math.cos(a) * dx + Math.sin(a) * dz;
}
/** Perlin gradient noise, roughly -1..1 */
export function noise2(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fade(fx), v = fade(fz);
  const a = grad(ix, iz, seed, fx, fz), b = grad(ix + 1, iz, seed, fx - 1, fz);
  const c = grad(ix, iz + 1, seed, fx, fz - 1), d = grad(ix + 1, iz + 1, seed, fx - 1, fz - 1);
  return (a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v) * 1.41;
}
export function fbm(x: number, z: number, oct: number, seed = 0, lac = 2.03, gain = 0.5): number {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * noise2(x * f, z * f, seed + i * 17); norm += amp; amp *= gain; f *= lac; }
  return sum / norm;
}
/** Ridged multifractal, 0..1 */
export function ridged(x: number, z: number, oct: number, seed = 0): number {
  let amp = 0.5, f = 1, sum = 0, norm = 0, prev = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(noise2(x * f, z * f, seed + i * 31));
    n *= n; sum += n * amp * prev; norm += amp; prev = Math.min(1, n * 1.4 + 0.3); amp *= 0.5; f *= 2.07;
  }
  return sum / norm;
}
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (cur: number, target: number, rate: number, dt: number) => lerp(cur, target, 1 - Math.exp(-rate * dt));
