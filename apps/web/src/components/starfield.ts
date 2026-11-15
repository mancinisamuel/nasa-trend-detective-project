import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  type Scene,
} from "three";

// E-62: one THREE.Points (one draw call) on a shell around the earth (radius 100).
// The stars live in the scene, so they turn with the OrbitControls camera.
const STAR_COUNT = 4000;
const INNER_RADIUS = 900;
const OUTER_RADIUS = 1600;
const SEED = 62;

// Small deterministic PRNG so the sky looks the same on every load.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const VERTEX_SHADER = /* glsl */ `
  attribute float size;
  attribute float brightness;
  attribute float phase;
  uniform float time;
  uniform float twinkle;
  uniform float pixelRatio;
  varying float vBrightness;
  void main() {
    float flicker = 1.0 - twinkle * 0.35 * (0.5 + 0.5 * sin(time * (0.8 + phase * 0.25) + phase));
    vBrightness = brightness * flicker;
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Soft round sprite: bright core plus a faint glow, no texture needed.
const FRAGMENT_SHADER = /* glsl */ `
  varying float vBrightness;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.45, 0.0, d);
    float glow = pow(1.0 - d, 3.0) * 0.45;
    float a = (core + glow) * vBrightness;
    gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, a);
  }
`;

export function addStarfield(scene: Scene, reducedMotion: boolean): () => void {
  const next = random(SEED);
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const brightness = new Float32Array(STAR_COUNT);
  const phases = new Float32Array(STAR_COUNT);

  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform direction on the sphere, radius somewhere in the shell.
    const z = next() * 2 - 1;
    const angle = next() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const radius = INNER_RADIUS + next() * (OUTER_RADIUS - INNER_RADIUS);
    positions[i * 3] = r * Math.cos(angle) * radius;
    positions[i * 3 + 1] = z * radius;
    positions[i * 3 + 2] = r * Math.sin(angle) * radius;
    // Mostly small, faint stars, a few big bright ones.
    const weight = next() ** 3;
    sizes[i] = 1.5 + weight * 5;
    brightness[i] = 0.35 + weight * 0.65;
    phases[i] = next() * Math.PI * 2;
  }

  const geometry = new BufferGeometry()
    .setAttribute("position", new Float32BufferAttribute(positions, 3))
    .setAttribute("size", new Float32BufferAttribute(sizes, 1))
    .setAttribute("brightness", new Float32BufferAttribute(brightness, 1))
    .setAttribute("phase", new Float32BufferAttribute(phases, 1));

  const uniforms = {
    time: { value: 0 },
    twinkle: { value: reducedMotion ? 0 : 1 },
    pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const stars = new Points(geometry, material);
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  if (!reducedMotion) {
    // The only per-frame work: one uniform.
    stars.onBeforeRender = () => {
      uniforms.time.value = performance.now() / 1000;
    };
  }
  scene.add(stars);

  return () => {
    scene.remove(stars);
    geometry.dispose();
    material.dispose();
  };
}
