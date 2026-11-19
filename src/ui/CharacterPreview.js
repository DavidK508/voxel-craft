import * as THREE from 'three';
import { getItem } from '../shared/items.js';
import { PlayerModel } from '../player/PlayerModel.js';

/** A small live 3D mannequin shown next to the armor slots. */
export class CharacterPreview {
  constructor(container) {
    this.container = container;
    if (!container) return;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(132, 190, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'character-preview-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 132 / 190, 0.1, 20);
    this.camera.position.set(0, 1.12, 3.35);
    this.camera.lookAt(0, 1.02, 0);

    this.model = new PlayerModel('');
    this.model.setVisible(true);
    this.model.nameTag.visible = false;
    this.scene.add(this.model.group);
    this.yaw = -0.45;
    this.walkPhase = 0;
    this.running = false;
    this.frame = (now) => {
      if (!this.running) return;
      const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0.016;
      this.lastTime = now;
      this.tick(dt);
      this.raf = requestAnimationFrame(this.frame);
    };
  }

  setArmor(stacks) {
    if (!this.model) return;
    const mapped = (stacks ?? []).map((stack) => {
      if (!stack) return null;
      return { material: getItem(stack.id)?.iconMaterial ?? 'leather' };
    });
    this.model.setArmor(mapped);
  }

  tick(dt) {
    if (!this.renderer) return;
    this.yaw += dt * 0.32;
    this.walkPhase += dt * 4;
    this.model.update({
      position: new THREE.Vector3(0, 0, 0),
      yaw: this.yaw,
      pitch: 0,
      velocity: { x: 0.9 + Math.sin(this.walkPhase) * 0.1, z: 0 },
      onGround: true,
      sneaking: false,
    }, dt);
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (!this.renderer || this.running) return;
    this.running = true;
    this.lastTime = 0;
    this.raf = requestAnimationFrame(this.frame);
    this.tick(0.016);
  }

  stop() {
    if (!this.renderer) return;
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  dispose() {
    this.stop();
    if (!this.renderer) return;
    this.model.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.renderer = null;
  }
}
