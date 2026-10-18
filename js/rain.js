import * as THREE from 'three';

/** Regen als Linienstriche, komplett im Vertex-Shader animiert (kein CPU-Aufwand pro Frame). */
export function createRain(count = 9000) {
  const pos = new Float32Array(count * 2 * 3);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    for (let k = 0; k < 2; k++) {
      pos.set([x, y, z], (i * 2 + k) * 3);
      end[i * 2 + k] = k;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: 60 },
      uIntensity: { value: 0 },
      uWind: { value: 0.25 },
      uColor: { value: new THREE.Color(0.75, 0.82, 0.9) },
    },
    vertexShader: /* glsl */ `
      attribute float aEnd;
      uniform float uTime, uBox, uWind;
      uniform vec3 uCenter;
      varying float vA;
      void main() {
        float speed = 22.0;
        vec3 p = position * uBox;
        p.y -= uTime * speed;
        p.x += uTime * speed * uWind;
        p = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5 + uCenter;
        p.y += aEnd * 1.1;
        p.x -= aEnd * 1.1 * uWind;
        vA = 1.0 - aEnd * 0.8;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform vec3 uColor;
      varying float vA;
      void main() { gl_FragColor = vec4(uColor, vA * 0.38 * uIntensity); }`,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  return lines;
}
