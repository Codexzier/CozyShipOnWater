// Perlin-Noise (Improved Noise, Ken Perlin 2002) mit ganzzahligem Hash.
// Die JS-Version (CPU, für Schiff & Bojen) und die GLSL-Version (GPU, für die
// Wasseroberfläche) sind absichtlich identisch aufgebaut, damit beide dieselben
// Wellen "sehen".

export const WAVE = {
  freq: 0.09,       // Grundfrequenz der Wellen (1/m)  -> größte Welle ca. 11 m
  octaves: 5,
  lacunarity: 2.03,
  gain: 0.5,
  timeScale: 0.16,  // wie schnell sich das Wellenmuster verändert
  driftX: 0.035,    // Drift des Musters (Windrichtung) in Noise-Einheiten / s
  driftZ: 0.02,
};

const P = [374761393, 668265263, 1274126177];

function hash3(x, y, z) {
  let h = (Math.imul(x, P[0]) + Math.imul(y, P[1]) + Math.imul(z, P[2])) >>> 0;
  h = Math.imul((h ^ (h >>> 13)) >>> 0, P[2]) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function grad(hh, x, y, z) {
  const h = hh & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

export function perlin(x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const wx = x - fx, wy = y - fy, wz = z - fz;
  const ix = fx | 0, iy = fy | 0, iz = fz | 0;
  const u = fade(wx), v = fade(wy), w = fade(wz);

  const g = (dx, dy, dz) => grad(hash3(ix + dx, iy + dy, iz + dz), wx - dx, wy - dy, wz - dz);
  const x00 = lerp(g(0, 0, 0), g(1, 0, 0), u);
  const x10 = lerp(g(0, 1, 0), g(1, 1, 0), u);
  const x01 = lerp(g(0, 0, 1), g(1, 0, 1), u);
  const x11 = lerp(g(0, 1, 1), g(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

export function fbm(x, y, z) {
  let a = 1, s = 0, n = 0;
  for (let i = 0; i < WAVE.octaves; i++) {
    s += a * perlin(x, y, z);
    n += a;
    x = x * WAVE.lacunarity + 17.1;
    y = y * WAVE.lacunarity + 5.3;
    z = z * WAVE.lacunarity + 9.7;
    a *= WAVE.gain;
  }
  return s / n;
}

/**
 * Höhe der "freien" Wasseroberfläche (ohne Kielwasser) an der Stelle (x, z)
 * im Schiffskoordinatensystem. `travel` ist die vom Schiff zurückgelegte
 * Strecke: das Schiff steht im Ursprung, die Welt (Wellenmuster) läuft vorbei.
 */
export function waveHeight(x, z, time, travel, amp) {
  return amp * fbm(
    x * WAVE.freq + time * WAVE.driftX,
    (z - travel) * WAVE.freq + time * WAVE.driftZ,
    time * WAVE.timeScale,
  );
}

const f = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

export const GLSL_NOISE = /* glsl */ `
uint hash3(ivec3 p) {
  uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u + uint(p.z) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}
float pgrad(uint hh, vec3 d) {
  uint h = hh & 15u;
  float u = h < 8u ? d.x : d.y;
  float v = h < 4u ? d.y : ((h == 12u || h == 14u) ? d.x : d.z);
  return (((h & 1u) == 0u) ? u : -u) + (((h & 2u) == 0u) ? v : -v);
}
float perlin(vec3 p) {
  vec3 fl = floor(p);
  vec3 w = p - fl;
  ivec3 i = ivec3(fl);
  vec3 q = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  float a = pgrad(hash3(i + ivec3(0,0,0)), w - vec3(0,0,0));
  float b = pgrad(hash3(i + ivec3(1,0,0)), w - vec3(1,0,0));
  float c = pgrad(hash3(i + ivec3(0,1,0)), w - vec3(0,1,0));
  float d = pgrad(hash3(i + ivec3(1,1,0)), w - vec3(1,1,0));
  float e = pgrad(hash3(i + ivec3(0,0,1)), w - vec3(0,0,1));
  float f = pgrad(hash3(i + ivec3(1,0,1)), w - vec3(1,0,1));
  float g = pgrad(hash3(i + ivec3(0,1,1)), w - vec3(0,1,1));
  float h = pgrad(hash3(i + ivec3(1,1,1)), w - vec3(1,1,1));
  return mix(mix(mix(a, b, q.x), mix(c, d, q.x), q.y),
             mix(mix(e, f, q.x), mix(g, h, q.x), q.y), q.z);
}
float fbm(vec3 p) {
  float a = 1.0, s = 0.0, n = 0.0;
  for (int i = 0; i < ${WAVE.octaves}; i++) {
    s += a * perlin(p);
    n += a;
    p = p * ${f(WAVE.lacunarity)} + vec3(17.1, 5.3, 9.7);
    a *= ${f(WAVE.gain)};
  }
  return s / n;
}
float baseHeight(vec2 xz, float t, float travel, float amp) {
  return amp * fbm(vec3(
    xz.x * ${f(WAVE.freq)} + t * ${f(WAVE.driftX)},
    (xz.y - travel) * ${f(WAVE.freq)} + t * ${f(WAVE.driftZ)},
    t * ${f(WAVE.timeScale)}));
}
`;
