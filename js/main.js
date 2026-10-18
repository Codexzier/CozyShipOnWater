import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { waveState } from './noise.js';
import { skyUniforms, updateSky, createSky } from './sky.js';
import { waterUniforms, createWater } from './water.js';
import { SHIPS, loadAssets, Ship, Buoys } from './ships.js';
import { createRain } from './rain.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;

// ---------- Einstellungen (Ziel-Werte der Regler) ----------
const WEATHER = {
  clear: { amp: 0.25, fog: 0.0, rain: 0.0, overcast: 0.0, storm: 0 },
  haze: { amp: 0.3, fog: 0.45, rain: 0.0, overcast: 0.5, storm: 0 },
  rain: { amp: 0.6, fog: 0.25, rain: 0.7, overcast: 0.85, storm: 0 },
  storm: { amp: 1.5, fog: 0.3, rain: 1.0, overcast: 1.0, storm: 1 },
};
const settings = {
  amp: 0.25, waveLen: 11, color: '#1e6f9f', ior: 1.33, speed: 4, wake: true,
  hours: 11, cycle: false, fog: 0, rain: 0, weather: 'clear', ship: 'boat-fishing-small',
  volume: 0.5,
};
// aktuelle, weich nachgeführte Werte
const cur = { amp: settings.amp, waveLen: settings.waveLen, ior: settings.ior, speed: 0, fog: 0, rain: 0, overcast: 0, storm: 0, hours: settings.hours, wake: 1 };
const tmpColor = new THREE.Color();
const waterColor = new THREE.Color(settings.color);

// ---------- three.js Grundaufbau ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xffffff, 0.004);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 4000);

const target = new THREE.Vector3(0, 1.2, 0);
const DEFAULT_DIR = new THREE.Vector3(0.6, 0.3, -0.74).normalize();    // rechts, vor dem Schiff
const camDist = (def) => def.cam * Math.min(Math.max(1.25 / camera.aspect, 1), 2.4);   // Hochformat: weiter weg
camera.position.copy(target).addScaledVector(DEFAULT_DIR, camDist(SHIPS[0]));

const controls = new OrbitControls(camera, canvas);
controls.target.copy(target);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 3.5;
controls.maxDistance = 170;
controls.maxPolarAngle = Math.PI * 0.495;      // nicht unter die Wasseroberfläche
controls.zoomSpeed = 0.9;
controls.update();

const sky = createSky();
const water = createWater();
scene.add(sky, water);

const hemi = new THREE.HemisphereLight(0xffffff, 0x234a66, 1);
const sunLight = new THREE.DirectionalLight(0xffffff, 3);
const moonLight = new THREE.DirectionalLight(0x9db8ff, 0);
scene.add(hemi, sunLight, moonLight, sunLight.target, moonLight.target);

const rain = createRain();
scene.add(rain);

let ship, buoys, shipDef = SHIPS[0];

// ---------- Kamera-Zoom beim Schiffswechsel ----------
let zoomAnim = { left: 0, total: 1 };
function zoomTo(factor) {
  zoomAnim = { left: 0.8, total: factor };
}

function setShip(id, animate = true) {
  const def = SHIPS.find((s) => s.id === id) || SHIPS[0];
  const prev = shipDef;
  shipDef = def;
  settings.ship = def.id;
  ship.set(def);
  buoys.setOffset(def.B);
  waterUniforms.uShipL.value = def.L;
  waterUniforms.uShipB.value = def.B;
  if (animate && prev !== def) zoomTo(def.cam / prev.cam);
}

function resetCamera() {
  zoomAnim.left = 0;
  camera.position.copy(target).addScaledVector(DEFAULT_DIR, camDist(shipDef));
  controls.update();
}

// ---------- Musik ----------
const audio = new Audio('assets/audio/Lofi_Chillout_Clockpunk.mp3');
audio.loop = true;
audio.volume = settings.volume;
audio.preload = 'auto';
let userPaused = false;
function musicUI() {
  const on = !audio.paused;
  $('music').textContent = on ? '♪ Musik aus' : '♪ Musik an';
  $('music').classList.toggle('off', !on);
}
audio.addEventListener('play', musicUI);
audio.addEventListener('pause', musicUI);
function tryPlay() { return audio.play().catch(() => {}); }
// Browser erlauben Ton erst nach einer Interaktion -> bei der ersten Geste starten.
const unlock = () => { if (!userPaused && audio.paused) tryPlay(); };
['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));
tryPlay();

// ---------- UI ----------
function bindRange(id, key, fmt, apply) {
  const el = $(id), out = $(id + 'Out');
  const show = () => { out.textContent = fmt(+el.value); };
  el.addEventListener('input', () => { settings[key] = +el.value; show(); apply?.(); });
  show();
}
const fmtHours = (h) => {
  const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

bindRange('amp', 'amp', (v) => `${v.toFixed(2)} m`);
bindRange('waveLen', 'waveLen', (v) => `${v.toFixed(0)} m`);
bindRange('ior', 'ior', (v) => v.toFixed(2));
bindRange('speed', 'speed', (v) => `${v.toFixed(1)} m/s`);
bindRange('time', 'hours', fmtHours);
bindRange('fog', 'fog', (v) => `${Math.round(v * 100)} %`);
bindRange('rain', 'rain', (v) => `${Math.round(v * 100)} %`);
bindRange('vol', 'volume', (v) => `${Math.round(v * 100)} %`, () => { audio.volume = settings.volume; });
$('color').addEventListener('input', (e) => { settings.color = e.target.value; });
$('wake').addEventListener('change', (e) => { settings.wake = e.target.checked; });
$('cycle').addEventListener('change', (e) => { settings.cycle = e.target.checked; });

for (const s of SHIPS) {
  const o = document.createElement('option');
  o.value = s.id;
  o.textContent = `${s.name} – ${s.id}`;
  $('ship').append(o);
}
$('ship').addEventListener('change', (e) => setShip(e.target.value));

function setSlider(id, value) {
  const el = $(id);
  el.value = value;
  el.dispatchEvent(new Event('input'));
}
$('weather').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-w]');
  if (!b) return;
  const w = WEATHER[b.dataset.w];
  settings.weather = b.dataset.w;
  document.querySelectorAll('#weather button').forEach((x) => x.classList.toggle('on', x === b));
  setSlider('amp', w.amp);
  setSlider('fog', w.fog);
  setSlider('rain', w.rain);
});

$('music').addEventListener('click', () => {
  if (audio.paused) { userPaused = false; tryPlay(); } else { userPaused = true; audio.pause(); }
});
$('resetCam').addEventListener('click', resetCamera);
$('photo').addEventListener('click', () => {
  renderer.render(scene, camera);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cozy-ship-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
});

const panel = $('panel'), showBtn = $('showPanel');
function setPanel(open) {
  panel.classList.toggle('hidden', !open);
  showBtn.hidden = open;
}
$('hidePanel').addEventListener('click', () => setPanel(false));
showBtn.addEventListener('click', () => setPanel(true));
window.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') setPanel(panel.classList.contains('hidden'));
});

// ---------- Größe ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
camera.position.copy(target).addScaledVector(DEFAULT_DIR, camDist(SHIPS[0]));
controls.update();
if (window.innerWidth <= 720) setPanel(false);   // am Handy zuerst die Szene zeigen

// ---------- Hauptschleife ----------
const clock = new THREE.Clock();
let simTime = 0, travel = 0, travelN = 0;
const tmpV = new THREE.Vector3();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const k = 1 - Math.exp(-dt * 3);
  simTime += dt;

  // Werte weich nachführen (Regler & Wetterwechsel wirken sanft)
  const w = WEATHER[settings.weather];
  const overcastT = Math.max(w.overcast, settings.rain * 0.85, settings.fog * 0.5);
  cur.amp += (settings.amp - cur.amp) * k;
  cur.waveLen += (settings.waveLen - cur.waveLen) * k;
  cur.ior += (settings.ior - cur.ior) * k;
  cur.speed += (settings.speed - cur.speed) * (1 - Math.exp(-dt * 1.5));
  cur.fog += (settings.fog - cur.fog) * (1 - Math.exp(-dt * 1.2));
  cur.rain += (settings.rain - cur.rain) * (1 - Math.exp(-dt * 1.2));
  cur.overcast += (overcastT - cur.overcast) * (1 - Math.exp(-dt * 0.9));
  cur.storm += (w.storm - cur.storm) * (1 - Math.exp(-dt * 0.9));
  cur.wake += ((settings.wake ? 1 : 0) - cur.wake) * k;
  waterColor.lerp(tmpColor.set(settings.color), k);

  if (settings.cycle) {
    settings.hours = (settings.hours + dt * (24 / 240)) % 24;      // ein Tag = 4 Minuten
    $('time').value = settings.hours;
    $('timeOut').textContent = fmtHours(settings.hours);
  }
  cur.hours = settings.hours;

  waveState.freq = 1 / cur.waveLen;
  travel += cur.speed * dt;
  travelN += cur.speed * dt * waveState.freq;
  const { day } = updateSky(cur.hours, cur.overcast, cur.storm);
  skyUniforms.uTime.value = simTime;
  skyUniforms.uFogDensity.value = 0.0032 + cur.fog * 0.03;

  // Wasser
  const L = shipDef.L;
  const speedF = THREE.MathUtils.smoothstep(cur.speed, 0, 1.2) * (0.25 + 0.75 * Math.min(cur.speed / 8, 1.3));
  waterUniforms.uAmp.value = cur.amp;
  waterUniforms.uTravel.value = travel;
  waterUniforms.uTravelN.value = travelN;
  waterUniforms.uWaveFreq.value = waveState.freq;
  waterUniforms.uWaterColor.value.copy(waterColor);
  waterUniforms.uIOR.value = cur.ior;
  waterUniforms.uLight.value = (0.07 + 0.93 * day) * (1 - 0.4 * cur.overcast);
  waterUniforms.uRain.value = cur.rain;
  waterUniforms.uStorm.value = cur.storm;
  waterUniforms.uSpeed.value = cur.speed;
  waterUniforms.uWakeAmp.value = cur.wake * speedF * 0.13 * Math.pow(L, 0.75);
  waterUniforms.uWakeFoam.value = cur.wake;

  // Licht & Nebel
  const night = skyUniforms.uNight.value;
  sunLight.color.copy(skyUniforms.uSunColor.value);
  sunLight.position.copy(skyUniforms.uSunDir.value).multiplyScalar(100);
  sunLight.intensity = 3.2 * day * (1 - 0.7 * cur.overcast);
  moonLight.position.copy(skyUniforms.uMoonDir.value).multiplyScalar(100);
  moonLight.intensity = 0.55 * night * (1 - 0.5 * cur.overcast);
  hemi.color.copy(skyUniforms.uZenith.value).lerp(skyUniforms.uHorizon.value, 0.5).multiplyScalar(1.5).addScalar(0.04);
  hemi.groundColor.copy(waterColor).lerp(tmpColor.set('#d9c9a0'), 0.35).multiplyScalar(0.7);
  hemi.intensity = 0.4 + 1.5 * day;
  scene.fog.color.copy(skyUniforms.uHorizon.value);
  scene.fog.density = skyUniforms.uFogDensity.value;

  // Schiff & Bojen
  ship.update(dt, simTime, travelN, cur.amp, cur.speed, night);
  buoys.update(simTime, travel, travelN, cur.amp, night);

  // Kamera
  if (zoomAnim.left > 0) {
    const step = Math.min(dt, zoomAnim.left);
    const f = Math.pow(zoomAnim.total, step / 0.8);
    tmpV.copy(camera.position).sub(controls.target).multiplyScalar(f);
    camera.position.copy(controls.target).add(tmpV);
    zoomAnim.left -= step;
  }
  controls.update();
  sky.position.copy(camera.position);

  // Regen
  const ru = rain.material.uniforms;
  rain.visible = cur.rain > 0.01;
  ru.uTime.value = simTime;
  ru.uIntensity.value = cur.rain;
  ru.uBox.value = Math.max(45, camera.position.distanceTo(controls.target) * 1.3);
  ru.uCenter.value.copy(camera.position).add(controls.target).multiplyScalar(0.5);
  ru.uWind.value = 0.12 + cur.storm * 0.5;
  ru.uColor.value.copy(skyUniforms.uHorizon.value).multiplyScalar(1.4).addScalar(0.05);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- Start ----------
try {
  const { buoy } = await loadAssets();
  ship = new Ship();
  buoys = new Buoys(buoy);
  scene.add(ship.group, buoys.group);
  setShip(settings.ship, false);
  $('ship').value = settings.ship;
  frame();
  window.__app = { settings, cur, camera, controls, setShip, setPanel, waterUniforms };
  requestAnimationFrame(() => $('loader').classList.add('done'));
} catch (err) {
  console.error(err);
  $('loaderText').textContent = 'Fehler beim Laden: ' + err.message;
}
