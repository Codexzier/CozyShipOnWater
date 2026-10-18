import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';
import { GLSL_SKY, skyUniforms } from './sky.js';

export const waterUniforms = {
  uAmp: { value: 0.25 },
  uTravel: { value: 0 },      // zurückgelegte Strecke (m) - für Schaum, Kräuselung, Meeresboden
  uTravelN: { value: 0 },     // dasselbe in Noise-Einheiten - für die Wellenhöhe
  uWaveFreq: { value: 1 / 11 },
  uWaterColor: { value: new THREE.Color('#1e6f9f') },
  uIOR: { value: 1.33 },
  uDepth: { value: 10 },
  uLight: { value: 1 },
  uRain: { value: 0 },
  uStorm: { value: 0 },
  // Schiff / Kielwasser (Schiffskoordinaten: Bug zeigt nach -z)
  uShipL: { value: 4 },
  uShipB: { value: 1.8 },
  uWakeAmp: { value: 0.1 },
  uWakeFoam: { value: 1 },
  uSpeed: { value: 0 },
};

// Gitter mit hoher Dichte um das Schiff, nach außen immer gröber.
function createGeometry(n = 420, extent = 700) {
  const warp = (u) => Math.sign(u) * (0.1 * Math.abs(u) + 0.9 * Math.pow(Math.abs(u), 3));
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      pos[k++] = warp((i / n) * 2 - 1) * extent;
      pos[k++] = 0;
      pos[k++] = warp((j / n) * 2 - 1) * extent;
    }
  }
  const idx = new Uint32Array(n * n * 6);
  k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), extent * 2);
  return g;
}

const WAKE = /* glsl */ `
uniform float uShipL, uShipB, uWakeAmp, uSpeed;

// Bug-/Kielwasser (Kelvin-Wellen) im Schiffs-Koordinatensystem.
// Das Muster steht relativ zum Schiff still - das Wasser strömt hindurch.
float wakeHeight(vec2 p) {
  if (uWakeAmp < 0.002) return 0.0;
  float L = uShipL, B = uShipB;
  float zb = -0.46 * L;                  // Position des Bugs
  float d = p.y - zb;                    // Abstand hinter dem Bug
  float ax = abs(p.x);
  float A = uWakeAmp;

  // Bugwelle: Wasserberg vor dem Bug, Wellental an den Rumpfseiten
  float bow = exp(-(pow(p.x / (0.62 * B), 2.0) + pow((p.y - zb + 0.12 * L) / (0.20 * L), 2.0)));
  float h = 0.9 * A * bow;
  float side = exp(-pow(ax / (0.7 * B + 0.04 * max(d, 0.0)), 2.0))
             * smoothstep(0.0, 0.25 * L, d) * (1.0 - smoothstep(0.7 * L, 1.15 * L, d));
  h -= 0.5 * A * side;

  if (d > 0.0) {
    float lam = 0.55 * L + 0.18 * uSpeed * uSpeed;
    float k = 6.2831853 / lam;
    float r = ax / (0.355 * d + 0.55 * B);                    // 1.0 = Kelvin-Kante (19.5°)
    float decay = inversesqrt(1.0 + d / (1.4 * L)) * exp(-d / (16.0 * L));
    float ramp = smoothstep(0.0, 0.5 * L, d);
    // Querwellen (Bögen) innerhalb des Keils
    float inner = smoothstep(1.25, 0.75, r);
    float arcs = cos(k * sqrt(d * d + 2.6 * p.x * p.x));
    h += 0.8 * A * decay * ramp * inner * arcs;
    // Divergierende Wellen entlang der Kelvin-Kante (V-Linien)
    float edge = exp(-pow((r - 1.0) / 0.2, 2.0));
    h += 0.95 * A * decay * ramp * edge * cos(k * 1.5 * d - 1.2);
    // Turbulente Spur direkt hinter dem Heck
    float core = exp(-pow(ax / (0.55 * B + 0.05 * d), 2.0)) * exp(-d / (4.0 * L));
    h -= 0.18 * A * core * smoothstep(0.1 * L, 0.5 * L, d);
  }
  return h;
}
`;

export function createWater() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms, ...waterUniforms },
    fog: false,
    vertexShader: /* glsl */ `
      ${GLSL_NOISE}
      ${WAKE}
      uniform float uTime, uAmp, uTravelN, uTravel;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vH;

      float surface(vec2 p) {
        // Das Kielwasser wird vom Wasser mitgenommen: seine Stärke schwankt mit
        // einem Noise, der mit dem Wasser nach hinten wandert.
        float wm = 0.8 + 0.4 * perlin(vec3(p.x * 0.5, (p.y - uTravel) * 0.5, uTime * 0.3));
        return baseHeight(p, uTime, uTravelN, uAmp) + wakeHeight(p) * wm;
      }

      void main() {
        vec2 p = position.xz;
        float dist = length(cameraPosition - vec3(p.x, 0.0, p.y));
        float e = 0.1 + dist * 0.004;
        float h = surface(p);
        float hx = surface(p + vec2(e, 0.0));
        float hz = surface(p + vec2(0.0, e));
        vNormal = normalize(vec3(h - hx, e, h - hz));
        vH = h;
        vWorld = vec3(p.x, h, p.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_NOISE}
      ${GLSL_SKY}
      ${WAKE}
      uniform float uAmp, uTravel, uTravelN, uIOR, uDepth, uLight, uRain, uStorm, uWakeFoam;
      uniform vec3 uWaterColor;
      uniform float uFogDensity;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vH;

      void main() {
        vec3 N = normalize(vNormal);
        float dist = length(cameraPosition - vWorld);

        // feine Kräuselung (Perlin) - schwächt sich mit der Entfernung ab, Regen verstärkt sie
        float detail = (0.035 + 0.05 * min(uAmp, 1.5) + 0.07 * uRain) / (1.0 + dist * 0.012);
        // Koordinaten im Wasser-System: das Wasser strömt mit der Schiffsgeschwindigkeit nach hinten
        vec2 q = vec2(vWorld.x, vWorld.z - uTravel);
        N = normalize(N + detail * vec3(perlin(vec3(q * 1.7, uTime * 0.5)),
                                        0.0,
                                        perlin(vec3(q * 1.7 + 31.7, uTime * 0.5 + 7.0))) * 2.0);

        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = clamp(dot(N, V), 0.001, 1.0);

        // Fresnel aus dem Brechungsindex (Schlick)
        float F0 = pow((uIOR - 1.0) / (uIOR + 1.0), 2.0);
        float F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);

        // Spiegelung: Himmel (inkl. Sonne/Mond)
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 refl = skyColor(R, true);
        float sunVis = smoothstep(-0.05, 0.1, uSunDir.y) * (1.0 - uOvercast * 0.85);
        float moonVis = uNight * (1.0 - uOvercast * 0.9);
        refl += uSunColor * pow(max(dot(R, uSunDir), 0.0), 220.0) * 0.9 * sunVis;
        refl += vec3(0.55, 0.65, 0.9) * pow(max(dot(R, uMoonDir), 0.0), 220.0) * 0.25 * moonVis;

        // Brechung (Snellius): Strahl ins Wasser bis zum Meeresboden
        vec3 T = refract(-V, N, 1.0 / uIOR);
        float tdist = (vWorld.y + uDepth) / max(-T.y, 0.05);
        vec3 hit = vWorld + T * tdist;
        vec2 hw = vec2(hit.x, hit.z - uTravel);
        float sandN = perlin(vec3(hw * 0.35, 3.0));
        vec3 sand = vec3(0.78, 0.68, 0.48) * (0.75 + 0.25 * sandN);
        float c1 = 1.0 - abs(perlin(vec3(hw * 0.75, uTime * 0.35)));
        float c2 = 1.0 - abs(perlin(vec3(hw * 1.1 + 9.0, uTime * 0.3 + 4.0)));
        float caustic = pow(c1 * c2, 7.0) * 3.0;
        vec3 floorCol = (sand + caustic * uSunColor * 0.6) * (uWaterColor * 1.4 + 0.15) * (0.4 + 0.6 * uDay);
        vec3 deep = uWaterColor * (0.55 + 0.45 * uDay);
        float fade = 1.0 - exp(-tdist * 0.2);
        vec3 refr = mix(floorCol, deep, fade);
        // Streulicht an Wellenbergen
        refr += uWaterColor * 0.5 * smoothstep(0.0, 0.8, vH / max(uAmp, 0.15)) * uLight * 0.35;
        refr *= uLight * (0.85 + 0.3 * clamp(dot(N, normalize(uSunDir + vec3(0.0, 0.4, 0.0))), 0.0, 1.0));

        vec3 col = mix(refr, refl, F);

        // Schaum: Bugwelle, Kielwasser, Rumpfkante, Wellenkämme (Sturm)
        float L = uShipL, B = uShipB;
        float zb = -0.46 * L;
        float d = vWorld.z - zb;
        // Schaum-Textur im Wasser-System, in Fahrtrichtung gestreckt -> Schlieren, die nach hinten wandern
        float fn = perlin(vec3(q.x * 2.1, q.y * 1.2, uTime * 0.5)) * 0.5 + perlin(vec3(q.x * 4.7 + 3.0, q.y * 2.6, uTime * 0.8)) * 0.35 + 0.5;
        float foam = 0.0;
        if (uWakeAmp > 0.002) {
          float s = clamp(uWakeAmp * 5.0, 0.0, 1.0) * uWakeFoam;
          float bowF = exp(-(pow(vWorld.x / (0.9 * B), 2.0) + pow((vWorld.z - zb + 0.08 * L) / (0.16 * L), 2.0)));
          float trail = exp(-pow(abs(vWorld.x) / (0.38 * B + 0.025 * max(d, 0.0)), 2.0))
                      * exp(-max(d, 0.0) / (2.6 * L)) * smoothstep(0.1 * L, 0.6 * L, d);
          float edge = exp(-pow((abs(vWorld.x) / (0.355 * max(d, 0.1) + 0.55 * B) - 1.0) / 0.12, 2.0))
                     * exp(-max(d, 0.0) / (4.0 * L)) * smoothstep(0.2 * L, 0.7 * L, d) * 0.5;
          float hull = smoothstep(1.5, 1.0, length(vec2(vWorld.x / (0.5 * B), (vWorld.z + 0.04 * L) / (0.52 * L))));
          foam = (bowF * 0.8 + trail * 0.75 + edge * 0.8 + hull * 0.55) * s;
        }
        float crest = smoothstep(0.55, 1.0, vH / max(uAmp, 0.3) * (0.5 + uStorm)) * uStorm;
        foam = clamp(foam * smoothstep(0.28, 0.62, fn + foam * 0.35) + crest * smoothstep(0.45, 0.7, fn), 0.0, 1.0);
        col = mix(col, vec3(0.93, 0.96, 0.98) * (0.1 + 0.9 * uLight), foam * 0.8);

        // Nebel
        float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
        col = mix(col, uHorizon, fog);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(createGeometry(), mat);
  mesh.frustumCulled = false;
  return mesh;
}
