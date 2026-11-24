import * as THREE from 'three';
import { getBlock } from '../shared/blocks.js';

const CAPACITY = 384;
const GRAVITY = 17;

/**
 * Averages a 16x16 atlas tile into one sRGB colour. Atlas canvases are keyed
 * by tile index, so this works for every block without a hand-written palette.
 */
export function averageTileColor(assets, tile) {
  const canvas = assets?.tileCanvases?.get?.(tile);
  if (!canvas?.getContext) return null;
  try {
    const width = canvas.width || 16;
    const height = canvas.height || 16;
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha < 0.05) continue;
      r += data[i] * alpha;
      g += data[i + 1] * alpha;
      b += data[i + 2] * alpha;
      weight += alpha;
    }
    if (weight < 1) return null;
    return new THREE.Color().setRGB(
      r / weight / 255,
      g / weight / 255,
      b / weight / 255,
      THREE.SRGBColorSpace,
    );
  } catch (error) {
    return null;
  }
}

/**
 * Pooled debris for breaking and placing blocks. One draw call, fixed memory,
 * and colours sampled from the real texture atlas at first use.
 */
export class BlockParticles {
  constructor(scene, assets = null, capacity = CAPACITY) {
    this.assets = assets;
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.baseColors = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.cursor = 0;
    this.colorCache = new Map();

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  blockColor(id) {
    if (this.colorCache.has(id)) return this.colorCache.get(id);
    const block = getBlock(id);
    const color = averageTileColor(this.assets, block?.faceTiles?.[0] ?? 0)
      ?? new THREE.Color(0x9a8c76);
    this.colorCache.set(id, color);
    return color;
  }

  burst(x, y, z, blockId, count = 18) {
    const base = this.blockColor(blockId);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const index = i * 3;
      this.positions[index] = x + (Math.random() - 0.5) * 0.7;
      this.positions[index + 1] = y + (Math.random() - 0.5) * 0.7;
      this.positions[index + 2] = z + (Math.random() - 0.5) * 0.7;
      this.velocities[index] = (Math.random() - 0.5) * 3.2;
      this.velocities[index + 1] = 2 + Math.random() * 3.4;
      this.velocities[index + 2] = (Math.random() - 0.5) * 3.2;
      const shade = 0.82 + Math.random() * 0.35;
      this.baseColors[index] = base.r * shade;
      this.baseColors[index + 1] = base.g * shade;
      this.baseColors[index + 2] = base.b * shade;
      this.colors[index] = this.baseColors[index];
      this.colors[index + 1] = this.baseColors[index + 1];
      this.colors[index + 2] = this.baseColors[index + 2];
      this.life[i] = 0.55 + Math.random() * 0.45;
      this.maxLife[i] = this.life[i];
    }
    this.points.visible = true;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  update(dt) {
    let active = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const index = i * 3;
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        this.colors[index] = 0;
        this.colors[index + 1] = 0;
        this.colors[index + 2] = 0;
        continue;
      }
      active++;
      this.velocities[index + 1] -= GRAVITY * dt;
      this.positions[index] += this.velocities[index] * dt;
      this.positions[index + 1] += this.velocities[index + 1] * dt;
      this.positions[index + 2] += this.velocities[index + 2] * dt;
      const fade = this.life[i] / this.maxLife[i];
      this.colors[index] = this.baseColors[index] * fade;
      this.colors[index + 1] = this.baseColors[index + 1] * fade;
      this.colors[index + 2] = this.baseColors[index + 2] * fade;
    }
    this.points.visible = active > 0;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.colors.fill(0);
    this.points.visible = false;
    this.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
