import * as THREE from 'three';

const materialCache = new Map();

function material(color) {
  let mat = materialCache.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, fog: true });
    materialCache.set(color, mat);
  }
  return mat;
}

function box(parent, w, h, d, color, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function overlay(parent, w, h, d, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color: 0xb7b7bd, fog: true }),
  );
  mesh.position.set(x, y, z);
  mesh.visible = false;
  parent.add(mesh);
  return mesh;
}

const ARMOR_COLORS = {
  leather: 0x8a5a2c,
  iron: 0xb7b7bd,
  diamond: 0x2ab8ad,
};

/**
 * A small blocky avatar for the third-person camera and LAN players.
 *
 * The model is built from boxes only, matching the rest of the game (the scene
 * has no lights, so everything uses MeshBasicMaterial). It faces -Z at yaw 0,
 * which is exactly the direction Player.getDirection() returns.
 */
export class PlayerModel {
  constructor(name = '') {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.walkPhase = 0;
    this.sneakAmount = 0;
    this.name = '';

    this.body = new THREE.Group();
    this.body.position.y = 1.08;
    this.group.add(this.body);
    box(this.body, 0.5, 0.72, 0.28, 0x3f8fd0);

    this.head = new THREE.Group();
    this.head.position.y = 1.44;
    this.group.add(this.head);
    box(this.head, 0.46, 0.46, 0.46, 0xc98e63, 0, 0.23, 0);
    // Face: two eyes and a mouth on the -Z side.
    box(this.head, 0.09, 0.09, 0.02, 0x2b2b33, -0.11, 0.28, -0.235);
    box(this.head, 0.09, 0.09, 0.02, 0x2b2b33, 0.11, 0.28, -0.235);
    box(this.head, 0.16, 0.04, 0.02, 0x7a4a35, 0, 0.13, -0.235);
    // Hair cap.
    box(this.head, 0.48, 0.14, 0.48, 0x3b2a1e, 0, 0.39, 0.01);

    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.33, 1.4, 0);
    this.group.add(this.leftArm);
    box(this.leftArm, 0.16, 0.68, 0.18, 0xc98e63, 0, -0.32, 0);

    this.rightArm = new THREE.Group();
    this.rightArm.position.set(0.33, 1.4, 0);
    this.group.add(this.rightArm);
    box(this.rightArm, 0.16, 0.68, 0.18, 0xc98e63, 0, -0.32, 0);

    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.125, 0.72, 0);
    this.group.add(this.leftLeg);
    box(this.leftLeg, 0.2, 0.72, 0.22, 0x3b4b8a, 0, -0.36, 0);

    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.125, 0.72, 0);
    this.group.add(this.rightLeg);
    box(this.rightLeg, 0.2, 0.72, 0.22, 0x3b4b8a, 0, -0.36, 0);

    // Armor overlays, hidden until a matching piece is equipped.
    this.armor = {
      head: overlay(this.head, 0.52, 0.52, 0.52, 0, 0.23, 0),
      chest: overlay(this.body, 0.56, 0.56, 0.34, 0, 0.06, 0),
      legs: [
        overlay(this.leftLeg, 0.23, 0.42, 0.25, 0, -0.22, 0),
        overlay(this.rightLeg, 0.23, 0.42, 0.25, 0, -0.22, 0),
      ],
      feet: [
        overlay(this.leftLeg, 0.24, 0.18, 0.28, 0, -0.63, -0.02),
        overlay(this.rightLeg, 0.24, 0.18, 0.28, 0, -0.63, -0.02),
      ],
    };

    this.nameTag = this.buildNameTag();
    this.group.add(this.nameTag);
    this.setName(name);
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

  setArmor(stacks = []) {
    const bySlot = {
      head: stacks[0],
      chest: stacks[1],
      legs: stacks[2],
      feet: stacks[3],
    };
    for (const [slot, stack] of Object.entries(bySlot)) {
      const targets = Array.isArray(this.armor[slot]) ? this.armor[slot] : [this.armor[slot]];
      const color = stack?.color ?? ARMOR_COLORS[stack?.material] ?? 0xb7b7bd;
      for (const mesh of targets) {
        mesh.visible = Boolean(stack);
        if (stack) mesh.material.color.setHex(color);
      }
    }
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  /**
   * @param {{position: THREE.Vector3, yaw: number, pitch: number, velocity: THREE.Vector3,
   *          onGround: boolean, sneaking: boolean}} state
   */
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
    this.group.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose?.();
        if (child.material && child.material !== materialCache.get(child.material.color?.getHex?.())) {
          child.material.dispose?.();
        }
      }
    });
    this.nameTag.userData.texture?.dispose?.();
    this.nameTag.material?.dispose?.();
  }
}
