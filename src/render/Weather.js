import * as THREE from 'three';

const COUNT = 720;
const RADIUS = 26;
const HEIGHT = 22;

/**
 * Lightweight biome weather. A single point cloud follows the camera and wraps
 * around it, so rain and snow work anywhere in an infinite world without any
 * chunk-specific state.
 */
export class Weather {
  constructor(scene) {
    this.positions = new Float32Array(COUNT * 3);
    this.speeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * RADIUS * 2;
      this.positions[i * 3 + 1] = (Math.random() - 0.5) * HEIGHT;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * RADIUS * 2;
      this.speeds[i] = 0.7 + Math.random() * 0.6;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: 0xbcd9ee,
      size: 0.07,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this.mode = null;
  }

  update(camera, mode, dt) {
    this.mode = mode ?? null;
    this.points.visible = !!this.mode && dt > 0;
    if (!this.points.visible) return;

    const rain = this.mode === 'rain';
    this.material.color.setHex(rain ? 0xbcd9ee : 0xffffff);
    this.material.size = rain ? 0.055 : 0.11;
    this.material.opacity = rain ? 0.55 : 0.85;
    const fall = rain ? 26 : 3.6;
    const drift = rain ? 1.4 : 0.55;

    for (let i = 0; i < COUNT; i++) {
      const index = i * 3;
      this.positions[index + 1] -= fall * this.speeds[i] * dt;
      this.positions[index] += drift * dt;
      if (this.positions[index + 1] < -HEIGHT / 2) {
        this.positions[index + 1] += HEIGHT;
        this.positions[index] = (Math.random() - 0.5) * RADIUS * 2;
        this.positions[index + 2] = (Math.random() - 0.5) * RADIUS * 2;
      }
      if (this.positions[index] > RADIUS) this.positions[index] -= RADIUS * 2;
    }
    this.points.position.set(camera.position.x, camera.position.y, camera.position.z);
    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
