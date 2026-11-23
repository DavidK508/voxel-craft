import * as THREE from 'three';
import { normalizeAppearance } from '../shared/appearance.js';
import {
  createPlayerModel,
  hasPlayerModel,
} from '../entities/modelLoader.js';

const materialCache = new Map();
const flatCache = new Map();

// BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z. A tiny fake light on
// each face makes the blocky avatars readable without adding real lights.
const FACE_SHADES = [0.82, 0.72, 1.0, 0.55, 0.92, 0.76];

function material(color, shade = 1) {
  const key = `${color}:${shade}`;
  let mat = materialCache.get(key);
  if (!mat) {
    const tinted = new THREE.Color(color).multiplyScalar(shade);
    mat = new THREE.MeshBasicMaterial({ color: tinted, fog: true });
    materialCache.set(key, mat);
  }
  return mat;
}

function flat(color) {
  let mat = flatCache.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, fog: true });
    flatCache.set(color, mat);
  }
  return mat;
}

function shaded(color) {
  return FACE_SHADES.map((shade) => material(color, shade));
}

function box(parent, w, h, d, color, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shaded(color));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function overlay(parent, w, h, d, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shaded(0xb7b7bd));
  mesh.position.set(x, y, z);
  mesh.visible = false;
  parent.add(mesh);
  return mesh;
}

const ARMOR_COLORS = {
  leather: 0x8a5a2c,
  iron: 0xc2c7cf,
  diamond: 0x2fd0bf,
  gold: 0xe5b93f,
  netherite: 0x5b5368,
};

/**
 * A blocky avatar for third person, LAN players and the character creator.
 * Uses the Blender GLB when available and procedural boxes otherwise.
 * Faces -Z at yaw 0, exactly like Player.getDirection().
 */
export class PlayerModel {
  constructor(name = '', appearance = null) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.walkPhase = 0;
    this.sneakAmount = 0;
    this.name = '';
    this.appearance = normalizeAppearance(appearance);
    this.appliedAppearance = this.appearance;
    this.usesGLB = false;
    this.appliedArmor = [];
    this.buildBody(this.appearance, createPlayerModel());

    this.nameTag = this.buildNameTag();
    this.group.add(this.nameTag);
    this.setName(name);
  }

  buildBody(look, glb) {
    this.shirtMesh = null;
    this.accentMesh = null;
    this.skinMeshes = [];
    this.browMeshes = [];
    this.sleeveMeshes = [];
    this.pantMeshes = [];

    if (glb) {
      this.usesGLB = true;
      this.body = glb.body;
      this.head = glb.head;
      this.leftArm = glb.leftArm;
      this.rightArm = glb.rightArm;
      this.leftLeg = glb.leftLeg;
      this.rightLeg = glb.rightLeg;
      this.group.add(glb.group);
      this.shirtMesh = glb.roles.shirt.find((m) => m.name.startsWith('shirt_body')) ?? null;
      this.accentMesh = glb.roles.accent[0] ?? null;
      this.skinMeshes = [...glb.roles.skin];
      this.browMeshes = [...glb.roles.brow];
      this.sleeveMeshes = glb.roles.shirt.filter((m) => m.name.startsWith('shirt_sleeve'));
      this.pantMeshes = glb.roles.pants.filter((m) => m.name.startsWith('pants_leg'));
    } else {
      this.usesGLB = false;
      this.body = new THREE.Group();
      this.body.position.y = 1.08;
      this.group.add(this.body);
      this.shirtMesh = box(this.body, 0.54, 0.72, 0.3, look.shirt);
      box(this.body, 0.56, 0.09, 0.32, 0x2c2f36, 0, -0.28, 0);
      this.accentMesh = box(this.body, 0.2, 0.07, 0.32, look.accent, 0, 0.33, -0.01);

      this.head = new THREE.Group();
      this.head.position.y = 1.44;
      this.group.add(this.head);
      const skinBox = (w, h, d, x, y, z) => {
        const mesh = box(this.head, w, h, d, look.skinTone, x, y, z);
        this.skinMeshes.push(mesh);
        return mesh;
      };
      skinBox(0.48, 0.48, 0.48, 0, 0.23, 0);
      box(this.head, 0.12, 0.11, 0.02, 0xf5f1e6, -0.115, 0.28, -0.25);
      box(this.head, 0.12, 0.11, 0.02, 0xf5f1e6, 0.115, 0.28, -0.25);
      box(this.head, 0.055, 0.07, 0.025, 0x33435c, -0.105, 0.275, -0.265);
      box(this.head, 0.055, 0.07, 0.025, 0x33435c, 0.125, 0.275, -0.265);
      this.browMeshes = [
        box(this.head, 0.11, 0.025, 0.02, look.hairTint, -0.115, 0.355, -0.255),
        box(this.head, 0.11, 0.025, 0.02, look.hairTint, 0.115, 0.355, -0.255),
      ];
      skinBox(0.08, 0.1, 0.07, 0, 0.19, -0.26);
      box(this.head, 0.17, 0.035, 0.02, 0x8d5245, 0, 0.09, -0.25);

      this.leftArm = new THREE.Group();
      this.leftArm.position.set(-0.35, 1.4, 0);
      this.group.add(this.leftArm);
      this.rightArm = new THREE.Group();
      this.rightArm.position.set(0.35, 1.4, 0);
      this.group.add(this.rightArm);
      for (const arm of [this.leftArm, this.rightArm]) {
        this.sleeveMeshes.push(box(arm, 0.18, 0.28, 0.2, look.shirt, 0, -0.13, 0));
        this.skinMeshes.push(box(arm, 0.16, 0.4, 0.18, look.skinTone, 0, -0.46, 0));
      }

      this.leftLeg = new THREE.Group();
      this.leftLeg.position.set(-0.13, 0.72, 0);
      this.group.add(this.leftLeg);
      this.rightLeg = new THREE.Group();
      this.rightLeg.position.set(0.13, 0.72, 0);
      this.group.add(this.rightLeg);
      for (const leg of [this.leftLeg, this.rightLeg]) {
        this.pantMeshes.push(box(leg, 0.22, 0.72, 0.23, look.pants, 0, -0.36, 0));
        box(leg, 0.24, 0.14, 0.28, 0x403223, 0, -0.65, -0.02);
      }
    }

    this.hair = new THREE.Group();
    this.head.add(this.hair);
    this.buildHair();
    this.buildArmor();
    this.applyLook(look);
  }

  buildArmor() {
    this.armor = {
      head: overlay(this.head, 0.52, 0.52, 0.52, 0, 0.23, 0),
      chest: overlay(this.body, 0.58, 0.58, 0.34, 0, 0.05, 0),
      legs: [
        overlay(this.leftLeg, 0.24, 0.46, 0.26, 0, -0.25, 0),
        overlay(this.rightLeg, 0.24, 0.46, 0.26, 0, -0.25, 0),
      ],
      feet: [
        overlay(this.leftLeg, 0.26, 0.2, 0.3, 0, -0.63, -0.02),
        overlay(this.rightLeg, 0.26, 0.2, 0.3, 0, -0.63, -0.02),
      ],
    };
    this.armorDetails = {
      // Metal helmets get a dark visor so they don't look like solid cubes.
      head: [box(this.head, 0.3, 0.07, 0.02, 0x1b2026, 0, 0.29, -0.27)],
      chest: [
        box(this.body, 0.13, 0.13, 0.02, 0xffffff, 0, 0.1, -0.18),
        box(this.body, 0.16, 0.1, 0.22, 0xffffff, -0.33, 0.25, 0),
        box(this.body, 0.16, 0.1, 0.22, 0xffffff, 0.33, 0.25, 0),
      ],
      legs: [],
      feet: [],
    };
    this.setArmor(this.appliedArmor);
  }

  /** Swaps procedural geometry for the Blender model once it finishes loading. */
  refreshModel() {
    if (this.usesGLB || !hasPlayerModel()) return;
    const glb = createPlayerModel();
    if (!glb?.body || !glb?.head) return;
    for (const part of [this.body, this.head, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg]) {
      part.removeFromParent();
    }
    this.buildBody(this.appearance, glb);
    this.setName(this.name);
  }

  buildHair() {
    for (const mesh of [...this.hair.children]) {
      this.hair.remove(mesh);
      mesh.geometry?.dispose?.();
    }
    const color = this.appearance.hairTint;
    const add = (w, h, d, x, y, z) => box(this.hair, w, h, d, color, x, y, z);
    switch (this.appearance.hairStyle) {
      case 'bald':
        break;
      case 'buzz':
        add(0.5, 0.06, 0.5, 0, 0.45, 0.01);
        break;
      case 'long':
        add(0.5, 0.13, 0.5, 0, 0.41, 0.01);
        add(0.05, 0.4, 0.5, -0.24, 0.23, 0.01);
        add(0.05, 0.4, 0.5, 0.24, 0.23, 0.01);
        add(0.5, 0.34, 0.06, 0, 0.17, 0.24);
        break;
      case 'ponytail':
        add(0.5, 0.13, 0.5, 0, 0.41, 0.01);
        add(0.05, 0.24, 0.5, -0.24, 0.31, 0.01);
        add(0.05, 0.24, 0.5, 0.24, 0.31, 0.01);
        add(0.14, 0.3, 0.14, 0, 0.13, 0.3);
        break;
      default: // short
        add(0.5, 0.13, 0.5, 0, 0.41, 0.01);
        add(0.05, 0.24, 0.5, -0.24, 0.31, 0.01);
        add(0.05, 0.24, 0.5, 0.24, 0.31, 0.01);
        break;
    }
  }

  buildNameTag() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      fog: false,
    }));
    sprite.scale.set(1.7, 0.32, 1);
    sprite.position.y = 2.15;
    sprite.visible = false;
    sprite.userData.canvas = canvas;
    sprite.userData.texture = texture;
    return sprite;
  }

  setName(name) {
    this.name = name || '';
    const sprite = this.nameTag;
    const canvas = sprite.userData.canvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.name) {
      ctx.font = 'bold 26px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillText(this.name, 128, 26);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.name, 128, 24);
    }
    sprite.userData.texture.needsUpdate = true;
    sprite.visible = Boolean(this.name);
  }

  applyLook(look) {
    const cached = new Set([...materialCache.values(), ...flatCache.values()]);
    const paint = (mesh, color) => {
      if (!mesh) return;
      if (this.usesGLB && !cached.has(mesh.material)) mesh.material.dispose?.();
      mesh.material = this.usesGLB ? flat(color) : shaded(color);
    };
    paint(this.shirtMesh, look.shirt);
    paint(this.accentMesh, look.accent);
    for (const mesh of this.sleeveMeshes) paint(mesh, look.shirt);
    for (const mesh of this.pantMeshes) paint(mesh, look.pants);
    for (const mesh of this.skinMeshes) paint(mesh, look.skinTone);
    for (const mesh of this.browMeshes) paint(mesh, look.hairTint);
  }

  setAppearance(appearance) {
    const next = normalizeAppearance(appearance);
    const previous = this.appliedAppearance;
    if (previous && previous.outfit === next.outfit && previous.skin === next.skin
      && previous.hairStyle === next.hairStyle && previous.hairColor === next.hairColor) return;
    this.appliedAppearance = next;
    this.appearance = next;
    this.applyLook(next);
    this.buildHair();
  }

  setArmor(stacks = []) {
    this.appliedArmor = stacks;
    const bySlot = {
      head: stacks[0],
      chest: stacks[1],
      legs: stacks[2],
      feet: stacks[3],
    };
    for (const [slot, stack] of Object.entries(bySlot)) {
      const targets = Array.isArray(this.armor[slot]) ? this.armor[slot] : [this.armor[slot]];
      const materialName = stack?.material ?? 'iron';
      const color = stack?.color ?? ARMOR_COLORS[materialName] ?? 0xb7b7bd;
      const metal = materialName === 'iron' || materialName === 'diamond';
      for (const mesh of targets) {
        mesh.visible = Boolean(stack);
        if (stack) mesh.material = shaded(color);
      }
      for (const mesh of this.armorDetails[slot] ?? []) {
        mesh.visible = Boolean(stack) && metal;
        if (stack && metal) mesh.material = shaded(materialName === 'diamond' ? 0x0c5f5a : 0x4a5058);
      }
    }
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  update(state, dt) {
    if (!state) return;
    const { position, yaw = 0, pitch = 0 } = state;
    this.group.position.set(position.x, position.y, position.z);
    this.group.rotation.y = yaw;

    const speed = Math.hypot(state.velocity?.x ?? 0, state.velocity?.z ?? 0);
    if (speed > 0.35 && state.onGround !== false) {
      this.walkPhase += dt * speed * 2.4;
    }
    const swing = Math.min(0.85, speed * 0.28) * Math.sin(this.walkPhase);
    const target = state.sneaking ? 1 : 0;
    this.sneakAmount += (target - this.sneakAmount) * Math.min(1, dt * 10);

    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;
    this.leftArm.rotation.x = -swing * 0.85;
    this.rightArm.rotation.x = swing * 0.85;
    this.head.rotation.x = pitch;
    this.body.rotation.x = -this.sneakAmount * 0.28;
    this.head.position.y = 1.44 - this.sneakAmount * 0.12;
    this.group.position.y -= this.sneakAmount * 0.08;
  }

  dispose() {
    const cached = new Set([...materialCache.values(), ...flatCache.values()]);
    this.group.traverse((child) => {
      if (!child.isMesh) return;
      // GLB clones share their geometry with the cached original.
      if (!child.userData.sharedGeometry) child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        if (mat && !cached.has(mat)) mat.dispose?.();
      }
    });
    this.nameTag.userData.texture?.dispose?.();
    this.nameTag.material?.dispose?.();
  }
}
