import * as THREE from 'three';

// One small cloud of motes follows the camera. No chunk state, no textures:
// just two GPU buffers that are rewritten in place every frame.
const COUNT = 220;
const RADIUS = 20;
const HEIGHT = 12;

const PALETTES = Object.freeze({
  pollen: [0xffe9a3, 0xfff6cf, 0xd8f58a, 0xf7b7d8],
  petals: [0xffa8c8, 0xffd1e0, 0xfff0a8, 0xe8a2ff],
  fireflies: [0xfff59a, 0xd9ff8a, 0x8affc1, 0xfffbe0],
  dust: [0xf6d49b, 0xffe3b0, 0xd9b77a, 0xf3c98d],
  night: [0x9fc9ff, 0xc7b6ff, 0xe1efff, 0x8fb8e8],
  ice: [0xd8f5ff, 0xffffff, 0x9fdcff, 0xc3ecff],
  embers: [0xff6b3d, 0xffa54a, 0xffd166, 0xff3b30],
  void: [0xb197fc, 0xe5b3ff, 0x8fd8ff, 0xffffff],
});

const GLOW_MODES = new Set(['fireflies', 'ice', 'embers', 'void']);

const NIGHT_FORESTS = new Set(['forest', 'birch', 'plains', 'swamp', 'taiga']);

/**
 * Picks the air mood from the same biome/daylight/weather values the rest of
 * the environment already computes. Kept pure so it can be regression-tested.
 */
export function ambienceModeFor({
  dimension = 'overworld',
  category = 'plains',
  daylight = 1,
  weather = null,
} = {}) {
  if (dimension === 'nether') return 'embers';
  if (dimension === 'end') return 'void';

  const snowy = category === 'snowy' || category === 'mountains' || weather === 'snow';
  if (snowy) return 'ice';
  if (daylight < 0.28) return NIGHT_FORESTS.has(category) ? 'fireflies' : 'night';
  if (category === 'desert' || category === 'beach') return 'dust';
  if (category === 'forest' || category === 'birch') return 'pollen';
  if (category === 'swamp') return 'petals';
  if (category === 'ocean') return 'night';
  return 'pollen';
}

export class Ambience {
  constructor(scene, count = COUNT) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.baseColors = new Float32Array(count * 3);
    this.phases = new Float32Array(count);
    this.speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const index = i * 3;
      this.positions[index] = (Math.random() - 0.5) * RADIUS * 2;
      this.positions[index + 1] = (Math.random() - 0.5) * HEIGHT;
      this.positions[index + 2] = (Math.random() - 0.5) * RADIUS * 2;
      this.phases[i] = Math.random() * Math.PI * 2;
      this.speeds[i] = 0.55 + Math.random() * 0.85;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.PointsMaterial({
      size: 0.13,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);

    this.mode = null;
    this.time = 0;
  }

  setMode(mode) {
    const next = mode ?? null;
    if (next === this.mode) return;
    this.mode = next;
    this.points.visible = !!next;
    if (!next) return;

    const palette = PALETTES[next] ?? PALETTES.pollen;
    const color = new THREE.Color();
    for (let i = 0; i < this.count; i++) {
      color.setHex(palette[i % palette.length]);
      const index = i * 3;
      this.baseColors[index] = color.r;
      this.baseColors[index + 1] = color.g;
      this.baseColors[index + 2] = color.b;
      this.colors[index] = color.r;
      this.colors[index + 1] = color.g;
      this.colors[index + 2] = color.b;
    }
    this.geometry.attributes.color.needsUpdate = true;
    this.material.blending = GLOW_MODES.has(next) ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.material.size = GLOW_MODES.has(next) ? 0.16 : 0.13;
    this.material.needsUpdate = true;
  }

  update(camera, mode, dt) {
    this.setMode(mode);
    if (!this.mode || !camera) return;

    this.time += dt;
    const glow = GLOW_MODES.has(this.mode);
    const breeze = this.mode === 'petals' ? 0.55 : 0.28;

    for (let i = 0; i < this.count; i++) {
      const index = i * 3;
      const phase = this.phases[i];
      const speed = this.speeds[i];
      this.positions[index] += (breeze * speed + 0.08) * dt;
      this.positions[index + 1] += Math.sin(this.time * speed * 1.7 + phase) * 0.5 * dt;
      this.positions[index + 2] += Math.cos(this.time * speed + phase) * 0.35 * dt;

      if (this.positions[index] > RADIUS) this.positions[index] -= RADIUS * 2;
      if (this.positions[index + 1] > HEIGHT / 2) this.positions[index + 1] -= HEIGHT;
      if (this.positions[index + 1] < -HEIGHT / 2) this.positions[index + 1] += HEIGHT;
      if (this.positions[index + 2] > RADIUS) this.positions[index + 2] -= RADIUS * 2;
      if (this.positions[index + 2] < -RADIUS) this.positions[index + 2] += RADIUS * 2;

      if (glow) {
        const twinkle = 0.55 + 0.45 * Math.sin(this.time * speed * 3.1 + phase);
        this.colors[index] = this.baseColors[index] * twinkle;
        this.colors[index + 1] = this.baseColors[index + 1] * twinkle;
        this.colors[index + 2] = this.baseColors[index + 2] * twinkle;
      }
    }

    this.points.position.set(camera.position.x, camera.position.y, camera.position.z);
    this.geometry.attributes.position.needsUpdate = true;
    if (glow) this.geometry.attributes.color.needsUpdate = true;
  }

  clear() {
    this.setMode(null);
  }

  dispose() {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
