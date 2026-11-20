import * as THREE from 'three';
import { getMaxStack } from '../shared/items.js';
import { getBlockItemId } from '../shared/blocks.js';

const HALF = 0.14;
const HEIGHT = 0.28;
const MAX_AGE = 300;
const PICKUP_RADIUS_SQ = 1.8 * 1.8;

export class ItemDrops {
  constructor(scene, world, assets, audio) {
    this.scene = scene;
    this.world = world;
    this.assets = assets;
    this.audio = audio;
    this.drops = [];
    this.materials = new Map();
    this.time = 0;
    this.nextId = 1;
    // LAN hooks. `networkSink` sends spawns instead of creating a local sprite
    // (guests let the host own every drop); `onSpawn` echoes host-owned drops.
    this.networkSink = null;
    this.onSpawn = null;
    this.pickupHandler = null;
  }

  getMaterial(itemId) {
    let material = this.materials.get(itemId);
    if (material) return material;
    const canvas = this.assets.iconCanvasCache.get(itemId) ?? this.assets.blockIconCache.get(itemId);
    if (!canvas) return null;
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      depthWrite: false,
      fog: false,
    });
    this.materials.set(itemId, material);
    return material;
  }

  spawn(id, count, x, y, z, velocity = null, pickupDelay = 0.55, uid = null) {
    if (!id || count <= 0) return null;
    if (this.networkSink) {
      this.networkSink({
        id, count, x, y, z, pickupDelay,
        vx: velocity?.x ?? 0,
        vy: velocity?.y ?? 0,
        vz: velocity?.z ?? 0,
      });
      return null;
    }
    const material = this.getMaterial(id);
    if (!material) return null;
    const sprite = new THREE.Sprite(material);
    const scale = 0.55;
    sprite.scale.set(scale, scale, scale);
    sprite.renderOrder = 4;
    sprite.frustumCulled = true;
    this.scene.add(sprite);

    const assignedUid = uid ?? this.nextId++;
    if (Number.isFinite(assignedUid)) this.nextId = Math.max(this.nextId, assignedUid + 1);
    const drop = {
      uid: assignedUid,
      id,
      count,
      position: new THREE.Vector3(x, y, z),
      velocity: velocity
        ? velocity.clone()
        : new THREE.Vector3((Math.random() - 0.5) * 2.2, 2.2 + Math.random() * 1.5, (Math.random() - 0.5) * 2.2),
      age: 0,
      pickupDelay,
      onGround: false,
      phase: Math.random() * Math.PI * 2,
      sprite,
    };
    sprite.position.set(x, y + 0.25, z);
    this.drops.push(drop);
    this.onSpawn?.(drop);
    return drop;
  }

  /** Creates a sprite mirrored from the host without echoing it back. */
  spawnRemote(id, count, x, y, z, velocity = null, pickupDelay = 0.2, uid = null) {
    if (Number.isFinite(uid) && this.findByUid(uid)) return null;
    const sink = this.networkSink;
    this.networkSink = null;
    try {
      return this.spawn(id, count, x, y, z, velocity, pickupDelay, uid);
    } finally {
      this.networkSink = sink;
    }
  }

  spawnBlockDrops(block, x, y, z, player, heldId) {
    if (!block || !block.drops?.length) return;
    if (!player.canHarvest(block, heldId)) return;
    for (const drop of block.drops) {
      if (drop.chance !== undefined && Math.random() > drop.chance) continue;
      const itemId = drop.id < 256 ? getBlockItemId(drop.id) : drop.id;
      if (!itemId) continue;
      this.spawn(itemId, drop.count ?? 1, x + 0.5, y + 0.35, z + 0.5);
    }
  }

  spawnStack(stack, x, y, z, pickupDelay = 0.55) {
    if (!stack) return;
    const max = getMaxStack(stack.id);
    let remaining = stack.count;
    while (remaining > 0) {
      const count = Math.min(max, remaining);
      this.spawn(stack.id, count, x, y, z, new THREE.Vector3(
        (Math.random() - 0.5) * 3.5,
        2.5 + Math.random() * 2.2,
        (Math.random() - 0.5) * 3.5,
      ), pickupDelay);
      remaining -= count;
    }
  }

  collides(position) {
    const minX = Math.floor(position.x - HALF);
    const maxX = Math.floor(position.x + HALF);
    const minY = Math.floor(position.y - HALF);
    const maxY = Math.floor(position.y + HEIGHT);
    const minZ = Math.floor(position.z - HALF);
    const maxZ = Math.floor(position.z + HALF);
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (this.world.isSolidAt(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  moveAxis(drop, axis, amount) {
    if (amount === 0) return false;
    const old = drop.position.getComponent(axis);
    drop.position.setComponent(axis, old + amount);
    if (!this.collides(drop.position)) return false;
    drop.position.setComponent(axis, old);
    if (axis === 1 && amount < 0) {
      drop.onGround = true;
      drop.velocity.y = 0;
    } else {
      drop.velocity.setComponent(axis, 0);
    }
    return true;
  }

  update(dt, player, inventory) {
    this.time += dt;
    const px = player.position.x;
    const py = player.position.y + 0.85;
    const pz = player.position.z;
    let pickedUp = false;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      drop.age += dt;
      drop.pickupDelay -= dt;

      const block = this.world.getBlock(
        Math.floor(drop.position.x),
        Math.floor(drop.position.y),
        Math.floor(drop.position.z),
      );
      const inWater = block === 11;
      if (inWater) {
        drop.velocity.y += 10 * dt;
        drop.velocity.y = Math.min(drop.velocity.y, 1.2);
        drop.velocity.x *= Math.max(0, 1 - dt * 3);
        drop.velocity.z *= Math.max(0, 1 - dt * 3);
      } else {
        drop.velocity.y -= 22 * dt;
        if (drop.velocity.y < -30) drop.velocity.y = -30;
      }

      drop.onGround = false;
      const steps = Math.max(1, Math.min(4, Math.ceil(Math.max(
        Math.abs(drop.velocity.x * dt),
        Math.abs(drop.velocity.y * dt),
        Math.abs(drop.velocity.z * dt),
      ) / 0.2)));
      const stepDt = dt / steps;
      for (let s = 0; s < steps; s++) {
        this.moveAxis(drop, 1, drop.velocity.y * stepDt);
        this.moveAxis(drop, 0, drop.velocity.x * stepDt);
        this.moveAxis(drop, 2, drop.velocity.z * stepDt);
      }

      if (drop.onGround) {
        const friction = Math.max(0, 1 - dt * 9);
        drop.velocity.x *= friction;
        drop.velocity.z *= friction;
        if (Math.abs(drop.velocity.x) < 0.02) drop.velocity.x = 0;
        if (Math.abs(drop.velocity.z) < 0.02) drop.velocity.z = 0;
      }

      if (drop.position.y < -8) {
        this.remove(i);
        continue;
      }

      const bob = Math.sin(this.time * 3.2 + drop.phase) * 0.055;
      drop.sprite.position.set(drop.position.x, drop.position.y + 0.24 + bob, drop.position.z);
      const pulse = 1 + Math.sin(this.time * 2.1 + drop.phase) * 0.025;
      drop.sprite.scale.set(0.55 * pulse, 0.55 * pulse, 0.55);

      const dx = drop.position.x - px;
      const dy = drop.position.y - py;
      const dz = drop.position.z - pz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (drop.pickupDelay <= 0 && distSq < PICKUP_RADIUS_SQ) {
        // A guest asks the host for the item instead of taking it locally;
        // the host removes the drop and sends it back as a `give` message.
        if (this.pickupHandler?.(drop) === true) continue;
        const remainder = inventory.addStack({ id: drop.id, count: drop.count });
        if (!remainder) {
          this.remove(i);
          this.audio?.playPickup();
          pickedUp = true;
          continue;
        }
        if (remainder.count < drop.count) {
          drop.count = remainder.count;
          this.audio?.playPickup();
          pickedUp = true;
        }
      }

      if (drop.age > MAX_AGE) {
        this.remove(i);
      }
    }

    this.mergeNearby();
    return pickedUp;
  }

  mergeNearby() {
    if (this.drops.length < 2 || this.drops.length > 120) return;
    for (let i = 0; i < this.drops.length; i++) {
      const a = this.drops[i];
      if (!a || a.age < 0.4) continue;
      const max = getMaxStack(a.id);
      if (a.count >= max) continue;
      for (let j = i + 1; j < this.drops.length; j++) {
        const b = this.drops[j];
        if (!b || b.id !== a.id || b.age < 0.4) continue;
        const dx = a.position.x - b.position.x;
        const dy = a.position.y - b.position.y;
        const dz = a.position.z - b.position.z;
        if (dx * dx + dy * dy + dz * dz > 0.55 * 0.55) continue;
        const move = Math.min(max - a.count, b.count);
        if (move <= 0) continue;
        a.count += move;
        b.count -= move;
        if (b.count <= 0) {
          this.remove(j);
          j--;
        }
        if (a.count >= max) break;
      }
    }
  }

  findByUid(uid) {
    return this.drops.find((drop) => drop.uid === uid) ?? null;
  }

  removeByUid(uid) {
    const index = this.drops.findIndex((drop) => drop.uid === uid);
    if (index >= 0) this.remove(index);
  }

  serialize() {
    return this.drops.map((drop) => ({
      uid: drop.uid,
      id: drop.id,
      count: drop.count,
      x: drop.position.x,
      y: drop.position.y,
      z: drop.position.z,
      age: drop.age,
    }));
  }

  /** Mirrors the host's authoritative drop list into a guest's scene. */
  applyState(items) {
    if (!Array.isArray(items)) return;
    const seen = new Set();
    for (const item of items) {
      const uid = Number(item?.uid);
      const id = Number(item?.id);
      const count = Number(item?.count);
      if (!Number.isFinite(uid) || !Number.isFinite(id) || !Number.isFinite(count)) continue;
      seen.add(uid);
      let drop = this.findByUid(uid);
      if (!drop) {
        drop = this.spawnRemote(id, count, Number(item.x) || 0, Number(item.y) || 0,
          Number(item.z) || 0, new THREE.Vector3(), 0.2, uid);
        if (!drop) continue;
      }
      drop.count = count;
      drop.position.set(Number(item.x) || 0, Number(item.y) || 0, Number(item.z) || 0);
      drop.age = Number(item.age) || 0;
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      if (!seen.has(this.drops[i].uid)) this.remove(i);
    }
  }

  remove(index) {
    const drop = this.drops[index];
    if (!drop) return;
    this.scene.remove(drop.sprite);
    this.drops.splice(index, 1);
  }

  clear() {
    for (const drop of this.drops) this.scene.remove(drop.sprite);
    this.drops.length = 0;
  }

  dispose() {
    this.clear();
    for (const material of this.materials.values()) {
      material.map?.dispose();
      material.dispose();
    }
    this.materials.clear();
  }
}
