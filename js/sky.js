import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';

// Uniforms, die sich Himmel, Wasser und Regen teilen (gleiche Objekte -> immer synchron).
export const skyUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uSunColor: { value: new THREE.Color() },
  uDay: { value: 1 },        // 0 = Nacht, 1 = Tag
  uNight: { value: 0 },
  uOvercast: { value: 0 },   // 0 = klar, 1 = komplett bewölkt
  uFogDensity: { value: 0.004 },
};

const smooth = THREE.MathUtils.smoothstep;
const mix = (a, b, t) => a + (b - a) * t;
const C = (r, g, b) => new THREE.Color().setRGB(r, g, b);   // lineare Farben

const ZENITH_DAY = C(0.045, 0.19, 0.56);
const ZENITH_DUSK = C(0.07, 0.09, 0.26);
const ZENITH_NIGHT = C(0.002, 0.005, 0.02);
const HORIZON_DAY = C(0.46, 0.64, 0.88);
const HORIZON_DUSK = C(0.95, 0.38, 0.14);
const HORIZON_NIGHT = C(0.012, 0.02, 0.05);
const SUN_DAY = C(1.0, 0.93, 0.8);
const SUN_DUSK = C(1.0, 0.45, 0.18);
const GREY_DAY = C(0.5, 0.53, 0.58);

const tmp = new THREE.Color();

/** Setzt den gemeinsamen Himmelszustand aus Tageszeit (h) und Bewölkung. */
export function updateSky(hours, overcast, storm) {
  const u = skyUniforms;
  const a = ((hours - 6) / 12) * Math.PI;           // 6 Uhr Aufgang, 18 Uhr Untergang
  const sun = u.uSunDir.value.set(-Math.cos(a) * 0.62, Math.sin(a), 0.5 + Math.cos(a) * 0.42 * 0.6).normalize();
  u.uMoonDir.value.set(-sun.x * 0.8, -sun.y, -sun.z * 0.8 + 0.2).normalize();

  const day = smooth(sun.y, -0.12, 0.28);
  const dusk = Math.exp(-Math.pow(sun.y / 0.2, 2)) * (1 - overcast * 0.6);   // Dämmerungsfarben
  u.uDay.value = day;
  u.uNight.value = 1 - smooth(sun.y, -0.25, 0.05);
  u.uOvercast.value = overcast;

  u.uZenith.value.copy(ZENITH_NIGHT).lerp(ZENITH_DAY, day).lerp(ZENITH_DUSK, dusk * 0.8);
  u.uHorizon.value.copy(HORIZON_NIGHT).lerp(HORIZON_DAY, day).lerp(HORIZON_DUSK, dusk * 0.85);
  u.uSunColor.value.copy(SUN_DAY).lerp(SUN_DUSK, dusk);

  // Bewölkung: Himmel in Richtung Grau, abhängig vom Tageslicht
  tmp.copy(GREY_DAY).multiplyScalar(mix(0.03, 1, day) * (1 - storm * 0.55));
  u.uZenith.value.lerp(tmp, overcast * 0.85);
  u.uHorizon.value.lerp(tmp.multiplyScalar(1.1), overcast * 0.85);
  return { sun, day, dusk };
}

export const GLSL_SKY = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uSunColor;
uniform float uDay, uNight, uOvercast;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 skyColor(vec3 dir, bool withClouds) {
  float y = max(dir.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(y, 0.45));
  // Dunst am Horizont
  col = mix(uHorizon, col, smoothstep(0.0, 0.18, y));

  float sd = max(dot(dir, uSunDir), 0.0);
  float md = max(dot(dir, uMoonDir), 0.0);
  float visSun = smoothstep(-0.05, 0.05, uSunDir.y) * (1.0 - uOvercast * 0.92);
  // Sonne: Scheibe + Glühen
  col += uSunColor * (smoothstep(0.99955, 0.9998, sd) * 25.0 + pow(sd, 400.0) * 1.4 + pow(sd, 12.0) * 0.18) * visSun;
  // Mond & Sterne
  float visMoon = smoothstep(0.0, 0.1, uMoonDir.y) * uNight * (1.0 - uOvercast * 0.9);
  col += vec3(0.75, 0.82, 1.0) * (smoothstep(0.99975, 0.9999, md) * 3.0 + pow(md, 300.0) * 0.12 + pow(md, 20.0) * 0.012) * visMoon;
  if (uNight > 0.01 && dir.y > 0.0) {
    vec3 sp = dir * 140.0;
    float h = hash13(floor(sp));
    float star = step(0.9935, h) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5));
    col += vec3(0.8, 0.85, 1.0) * star * 2.2 * uNight * (1.0 - uOvercast) * smoothstep(0.0, 0.2, dir.y);
  }

  if (withClouds && dir.y > 0.0) {
    vec2 uv = dir.xz / (dir.y + 0.18) * 0.9 + vec2(uTime * 0.004, uTime * 0.0025);
    float n = perlin(vec3(uv * 1.1, uTime * 0.01)) * 0.55 + perlin(vec3(uv * 2.3 + 7.0, uTime * 0.015)) * 0.3
            + perlin(vec3(uv * 4.9 + 3.0, 1.0)) * 0.15;
    float cover = mix(0.12, -0.35, uOvercast);
    float c = smoothstep(cover, cover + 0.45, n) * smoothstep(0.0, 0.22, dir.y);
    vec3 lit = mix(vec3(0.95, 0.95, 0.97), uSunColor, 0.35) * mix(0.015, 1.0, uDay);
    vec3 shade = mix(uZenith * 1.6 + 0.04, vec3(0.22, 0.24, 0.28) * mix(0.03, 1.0, uDay), uOvercast);
    vec3 ccol = mix(lit, shade, clamp(uOvercast * 0.9 + (1.0 - n) * 0.25, 0.0, 1.0));
    ccol += uSunColor * pow(sd, 6.0) * 0.4 * visSun;           // Silberrand zur Sonne hin
    col = mix(col, ccol, c * mix(0.78, 0.97, uOvercast));
  }
  return col;
}
`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;   // immer ganz hinten
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_NOISE}
      ${GLSL_SKY}
      uniform float uFogDensity;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = skyColor(dir, true);
        // Nebel verschluckt den Himmel zum Horizont hin
        float fogMix = clamp(uFogDensity * 55.0, 0.0, 1.0);
        col = mix(col, uHorizon, fogMix * (1.0 - smoothstep(0.0, 0.45 + fogMix * 0.5, dir.y)));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.scale.setScalar(1500);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
