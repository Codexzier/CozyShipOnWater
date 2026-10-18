import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { waveHeight } from './noise.js';

// L = Länge, B = Breite (Modelleinheiten = Meter), draft = wie tief der Rumpf eintaucht,
// cam = Standard-Kameraabstand. Alle Kenney-Modelle zeigen mit dem Bug nach +z.
export const SHIPS = [
  { id: 'boat-fishing-small', name: 'Fischerboot (klein)', L: 3.9, B: 1.8, draft: 0.25, cam: 11, light: 2.3 },
  { id: 'boat-sail-a', name: 'Segelboot', L: 3.8, B: 1.8, draft: 0.25, cam: 12, light: 3.6 },
  { id: 'boat-speed-b', name: 'Schnellboot', L: 3.3, B: 1.8, draft: 0.2, cam: 10, light: 1.4 },
  { id: 'ship-cargo-a', name: 'Frachtschiff', L: 10.5, B: 3.9, draft: 0.5, cam: 28, light: 3.2 },
  { id: 'ship-large', name: 'Großsegler (zwei Masten)', L: 13.1, B: 4.8, draft: 0.6, cam: 36, light: 9.2 },
  { id: 'ship-ocean-liner', name: 'Ozeandampfer', L: 21.3, B: 4.8, draft: 0.6, cam: 50, light: 7.8 },
];

const loader = new GLTFLoader();
const load = (file) => new Promise((res, rej) => loader.load(`assets/models/${file}.glb`, res, undefined, rej));

export async function loadAssets() {
  const [buoy, ...ships] = await Promise.all([load('buoy-flag'), ...SHIPS.map((s) => load(s.id))]);
  SHIPS.forEach((s, i) => { s.scene = ships[i].scene; });
  return { buoy: buoy.scene };
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW = glowTexture();
const BUOY_SCALE = 1.0;

function glowSprite(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
  }));
  s.scale.setScalar(size);
  return s;
}

/** Das Schiff steht im Ursprung und fährt nach -z. Es schwimmt auf den Wellen. */
export class Ship {
  constructor() {
    this.group = new THREE.Group();          // Bewegung (Heben, Nicken, Rollen)
    this.pivot = new THREE.Group();          // statische Ausrichtung des Modells
    this.group.add(this.pivot);
    this.lantern = new THREE.PointLight(0xffc27a, 0, 30, 1.6);
    this.glow = glowSprite(0xffb55e, 1.4);
    this.group.add(this.lantern, this.glow);
    this.pitch = 0; this.roll = 0; this.y = 0;
    this.def = null;
    this.spawn = 1;
  }

  set(def) {
    this.def = def;
    this.pivot.clear();
    const model = def.scene.clone(true);
    model.rotation.y = Math.PI;              // Bug von +z nach -z drehen
    model.position.y = -def.draft;
    model.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = false; });
    this.pivot.add(model);
    const lampY = def.light - def.draft;
    this.lantern.position.set(0, lampY, 0);
    this.glow.position.set(0, lampY, 0);
    this.spawn = 0;                          // sanftes Einblenden (Skalierung)
  }

  update(dt, time, travelN, amp, speed, night) {
    const { L, B } = this.def;
    const h = (x, z) => waveHeight(x, z, time, travelN, amp);
    const hb = h(0, -0.36 * L), hs = h(0, 0.36 * L);
    const hp = h(-0.4 * B, 0), hst = h(0.4 * B, 0);
    const hc = h(0, 0);
    const targetY = (hb + hs + hp + hst + hc) / 5;
    const trim = -Math.min(speed / 12, 1) * 0.04;                  // Bug hebt sich leicht beim Fahren
    const tp = Math.atan2(hb - hs, 0.72 * L) * 0.9 - trim;
    const tr = Math.atan2(hst - hp, 0.8 * B) * 0.9;
    const k = 1 - Math.exp(-dt * 6);
    this.y += (targetY - this.y) * k;
    this.pitch += (tp - this.pitch) * k;
    this.roll += (tr - this.roll) * k;
    this.group.position.y = this.y;
    this.group.rotation.set(this.pitch, 0, this.roll, 'ZXY');
    this.spawn = Math.min(1, this.spawn + dt * 2.5);
    this.pivot.scale.setScalar(0.001 + 0.999 * (1 - Math.pow(1 - this.spawn, 3)));
    this.lantern.intensity = night * 14;
    this.glow.material.opacity = night;
    this.glow.visible = night > 0.02;
  }
}

/** Bojen links und rechts der Fahrrinne. Sie stehen in der Welt, das Schiff fährt vorbei. */
export class Buoys {
  constructor(template, count = 14, spacing = 26) {
    this.group = new THREE.Group();
    this.spacing = spacing;
    this.span = count * spacing;
    this.items = [];
    this.offset = 7;
    for (let i = 0; i < count; i++) {
      for (const side of [-1, 1]) {
        const root = new THREE.Group();
        const model = template.clone(true);
        model.scale.setScalar(BUOY_SCALE);
        root.add(model);
        // Backbord rot, Steuerbord grün (Seezeichen)
        const color = side < 0 ? 0xff3b30 : 0x35e06a;
        const lamp = glowSprite(color, 1.6);
        lamp.position.set(0, 2.55 * BUOY_SCALE, 0);
        root.add(lamp);
        this.group.add(root);
        this.items.push({
          root, lamp, side,
          worldZ: -i * spacing - (side > 0 ? spacing / 2 : 0),     // links/rechts versetzt
          jitter: (Math.sin(i * 12.9898 + side * 4.1) * 0.5 + 0.5) * 2.2,
          phase: i * 1.7 + side,
        });
      }
    }
  }

  setOffset(shipBeam) { this.offset = shipBeam / 2 + 5.5; }

  update(time, travel, travelN, amp, night) {
    const zFar = -this.span + 40, zNear = 60;
    for (const b of this.items) {
      // Position im Schiffssystem; "wrap" lässt die Boje hinten verschwinden und vorn neu auftauchen
      let z = b.worldZ + travel;
      z = ((z - zNear) % this.span + this.span) % this.span + zNear - this.span;
      const x = b.side * (this.offset + b.jitter);
      const e = 0.7;
      const h0 = waveHeight(x, z, time, travelN, amp);
      const hx = waveHeight(x + e, z, time, travelN, amp);
      const hz = waveHeight(x, z + e, time, travelN, amp);
      b.root.position.set(x, h0 - 0.1, z);
      b.root.rotation.set(Math.atan2(hz - h0, e) * -0.9 + Math.sin(time * 0.9 + b.phase) * 0.03 * (0.3 + amp),
                          0, Math.atan2(hx - h0, e) * 0.9 + Math.cos(time * 0.8 + b.phase) * 0.03 * (0.3 + amp));
      const fadeIn = THREE.MathUtils.smoothstep(z, zFar, zFar + 25);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(z, 28, 50);
      const s = Math.max(fadeIn * fadeOut, 0.001);
      b.root.scale.setScalar(s);
      const blink = 0.55 + 0.45 * Math.sin(time * 2.4 + b.phase * 2);
      b.lamp.material.opacity = (0.12 + night * 0.9) * blink;
    }
  }
}
