import * as THREE from 'three';
import { getBlock } from '../shared/blocks.js';
import { getItem } from '../shared/items.js';
import { OUTFITS, SKIN_TONES, normalizeAppearance } from '../shared/appearance.js';

/**
 * First-person hand and held item.
 *
 * Minecraft keeps the arm in a separate overlay pass so it never clips into
 * the world and always sits in front of the GUI. This class builds that
 * overlay: a blocky sleeve/skin arm plus a real 3D block (using the atlas
 * tiles) or a flat pixel-art icon for tools and other items.
 */
export class Viewmodel {
  constructor({ assets = null, appearance = null } = {}) {
    this.assets = assets;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.01, 10);
    this.root = new THREE.Group();
    this.scene.add(this.root);

    const ambient = new THREE.AmbientLight(0xffffff, 1.7);
    const sunlight = new THREE.DirectionalLight(0xffffff, 1.1);
    sunlight.position.set(-0.5, 1.2, 1.4);
    this.scene.add(ambient, sunlight);

    this.sleeveMaterial = new THREE.MeshLambertMaterial({ color: 0x3f8fd0 });
    this.skinMaterial = new THREE.MeshLambertMaterial({ color: 0xd9a178 });
    this.hairMaterial = new THREE.MeshLambertMaterial({ color: 0x3a2a1e });

    this.arm = new THREE.Group();
    this.root.add(this.arm);

    this.forearm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.48, 0.2), [
      this.sleeveMaterial, this.sleeveMaterial, this.sleeveMaterial,
      this.sleeveMaterial, this.sleeveMaterial, this.sleeveMaterial,
    ]);
    this.forearm.position.set(0.08, -0.19, 0.06);
    this.forearm.rotation.z = -0.14;

    this.hand = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.19, 0.19), this.skinMaterial);
    this.hand.position.set(0, 0.11, 0);

    this.cuff = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.22), this.sleeveMaterial);
    this.cuff.position.set(0.045, -0.08, 0.05);

    this.arm.add(this.forearm, this.hand, this.cuff);

    this.held = new THREE.Group();
    this.held.position.set(-0.04, 0.19, -0.03);
    this.arm.add(this.held);

    this.textures = [];
    this.heldId = null;
    this.bobPhase = 0;
    this.swingTime = 0;
    this.visible = true;
    this.basePosition = new THREE.Vector3(0.58, -0.54, -0.9);
    this.baseRotation = new THREE.Euler(-0.18, -0.32, -0.16);
    this.root.position.copy(this.basePosition);
    this.root.rotation.copy(this.baseRotation);

    this.setAppearance(appearance);
  }

  /** Keeps the sleeve and skin in sync with the character creator. */
  setAppearance(value) {
    const appearance = normalizeAppearance(value ?? {});
    const outfit = OUTFITS.find((entry) => entry.id === appearance.outfit) ?? OUTFITS[0];
    const skin = SKIN_TONES.find((entry) => entry.id === appearance.skin) ?? SKIN_TONES[1];
    this.sleeveMaterial.color.setHex(outfit.shirt);
    this.skinMaterial.color.setHex(skin.color);
  }

  clearHeld() {
    for (const child of [...this.held.children]) {
      this.held.remove(child);
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material?.dispose?.();
      }
    }
    for (const texture of this.textures) texture.dispose();
    this.textures.length = 0;
  }

  canvasTexture(canvas) {
    if (!canvas) return null;
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    return texture;
  }

  /**
   * Blocks get a real six-sided cube textured with their atlas tiles; tools
   * and loose items use their pixel-art icon on a flat billboard, the same
   * silhouette the hotbar shows.
   */
  setItem(id) {
    if (id === this.heldId) return;
    this.clearHeld();
    this.heldId = id ?? null;
    const item = getItem(id);
    if (!item || !this.assets) return;

    const block = item.placeBlock ? getBlock(item.placeBlock) : null;
    const tiles = block?.faceTiles;
    if (tiles && this.assets.tileCanvases) {
      const materials = tiles.map((tile) => {
        const texture = this.canvasTexture(this.assets.tileCanvases.get(tile));
        return new THREE.MeshLambertMaterial({ map: texture, color: texture ? 0xffffff : 0x777777 });
      });
      // BoxGeometry face order is +X, -X, +Y, -Y, +Z, -Z; faceTiles uses
      // +Y, -Y, +X, -X, +Z, -Z.
      const order = [2, 3, 0, 1, 4, 5];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), order.map((i) => materials[i]));
      mesh.rotation.set(-0.24, 0.62, 0.12);
      this.held.add(mesh);
      return;
    }

    const canvas = this.assets.iconCanvasCache?.get(id)
      ?? this.assets.iconCanvasCache?.get(item.blockId ?? item.placeBlock);
    const texture = this.canvasTexture(canvas);
    if (!texture) return;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide }),
    );
    plane.rotation.set(-0.18, 0.2, 0.14);
    this.held.add(plane);
  }

  /** Starts the familiar downward arm swing. */
  swing() {
    this.swingTime = 0.24;
  }

  /**
   * @param {number} dt seconds since the previous frame
   * @param {{ visible?: boolean, heldId?: number|null, walking?: boolean }} state
   */
  update(dt, state = {}) {
    this.visible = state.visible !== false;
    if (state.heldId !== undefined) this.setItem(state.heldId);

    const moving = !!state.walking && this.visible;
    this.bobPhase += dt * (moving ? 9.5 : 1.6);
    const bobX = Math.cos(this.bobPhase * 0.5) * (moving ? 0.022 : 0.004);
    const bobY = Math.sin(this.bobPhase) * (moving ? 0.024 : 0.006);
    this.root.position.set(
      this.basePosition.x + bobX,
      this.basePosition.y + bobY,
      this.basePosition.z,
    );

    let swingX = 0;
    let swingY = 0;
    if (this.swingTime > 0) {
      this.swingTime = Math.max(0, this.swingTime - dt);
      const progress = 1 - this.swingTime / 0.24;
      const arc = Math.sin(progress * Math.PI);
      swingX = -arc * 0.95;
      swingY = arc * 0.42;
    }
    this.root.rotation.set(
      this.baseRotation.x + swingX,
      this.baseRotation.y + swingY,
      this.baseRotation.z,
    );
  }

  /** Renders the overlay after the world with a cleared depth buffer. */
  render(renderer, width, height) {
    if (!this.visible || !width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = previousAutoClear;
  }

  dispose() {
    this.clearHeld();
    this.forearm.geometry.dispose();
    this.hand.geometry.dispose();
    this.cuff.geometry.dispose();
    this.sleeveMaterial.dispose();
    this.skinMaterial.dispose();
    this.hairMaterial.dispose();
    this.scene.clear();
  }
}
