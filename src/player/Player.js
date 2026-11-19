import * as THREE from 'three';
import {
  FLY_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_EYE,
  PLAYER_HEIGHT,
  PLAYER_REACH,
  PLAYER_WIDTH,
  SNEAK_SPEED,
  SPRINT_SPEED,
  SWIM_SPEED,
  TERMINAL_VELOCITY,
  WALK_SPEED,
} from '../shared/constants.js';
import { BLOCKS, getBlock } from '../shared/blocks.js';
import { getToolInfo } from '../shared/items.js';

const EPS = 0.001;
const HALF_WIDTH = PLAYER_WIDTH / 2;

export class Player {
  constructor(spawn = { x: 0.5, y: 80, z: 0.5 }) {
    this.position = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.inLava = false;
    this.sneaking = false;
    this.sprinting = false;
    this.flying = false;
    this.creative = false;

    this.health = 20;
    this.maxHealth = 20;
    // Sum of the equipped armor defense points; Game keeps this in sync.
    this.armorPoints = 0;
    this.hunger = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 15;
    this.maxAir = 15;
    this.fallDistance = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.drownTimer = 0;
    this.lavaTimer = 0;
    this.damageCooldown = 0;
    this.dead = false;
    this.lastDamageCause = '';
    this.walkDistance = 0;
    this.stepTimer = 0;
    this.moving = false;
  }

  get eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + PLAYER_EYE, this.position.z);
  }

  getDirection() {
    const cosPitch = Math.cos(this.pitch);
    return new THREE.Vector3(
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch,
    );
  }

  /**
   * Creative mode makes the player immortal, well fed and able to fly. Flight
   * itself is toggled with a double tap of Space in Game, this only switches
   * the movement rules and tops up the survival bars.
   */
  setCreative(enabled) {
    this.creative = Boolean(enabled);
    if (!this.creative) this.flying = false;
    if (this.creative) {
      this.health = this.maxHealth;
      this.hunger = 20;
      this.saturation = 20;
      this.air = this.maxAir;
      this.exhaustion = 0;
      this.fallDistance = 0;
    }
  }

  look(dx, dy, sensitivity) {
    const factor = 0.0022 * sensitivity;
    this.yaw -= dx * factor;
    this.pitch -= dy * factor;
    const limit = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  update(dt, input, world, inputEnabled = true) {
    if (this.dead) return;
    dt = Math.min(dt, 0.05);
    this.damageCooldown = Math.max(0, this.damageCooldown - dt);

    const feetBlock = world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + 0.15), Math.floor(this.position.z));
    const headBlock = world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + PLAYER_EYE), Math.floor(this.position.z));
    this.inWater = feetBlock === 11 || headBlock === 11;
    this.headInWater = headBlock === 11;
    this.inLava = feetBlock === 30 || headBlock === 30;

    const forwardInput = inputEnabled ? (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0) : 0;
    const strafeInput = inputEnabled ? (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0) : 0;
    const wantSneak = inputEnabled && !this.flying
      && (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    const wantSprint = inputEnabled && (input.isDown('ControlLeft') || input.isDown('ControlRight')) && forwardInput > 0 && (this.hunger > 6 || this.creative);
    this.sneaking = wantSneak && !this.inWater;
    this.sprinting = wantSprint && !this.sneaking && !this.inWater;
    this.moving = forwardInput !== 0 || strafeInput !== 0;

    const speed = this.flying
      ? FLY_SPEED
      : this.inWater ? SWIM_SPEED : this.sneaking ? SNEAK_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    wish.addScaledVector(forward, forwardInput);
    wish.addScaledVector(right, strafeInput);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed);

    const accel = this.flying ? 14 : this.inWater ? 6 : this.onGround ? 18 : 3.2;
    const blend = Math.min(1, accel * dt);
    this.velocity.x += (wish.x - this.velocity.x) * blend;
    this.velocity.z += (wish.z - this.velocity.z) * blend;

    if (this.flying) {
      // Creative flight: Space climbs, Shift descends, releasing both hovers.
      const up = inputEnabled && input.isDown('Space') ? 1 : 0;
      const down = inputEnabled && (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) ? 1 : 0;
      const targetY = (up - down) * FLY_SPEED;
      this.velocity.y += (targetY - this.velocity.y) * Math.min(1, 16 * dt);
      this.fallDistance = 0;
    } else if (this.inWater) {
      this.velocity.y -= 7.5 * dt;
      if (inputEnabled && input.isDown('Space')) this.velocity.y += 22 * dt;
      this.velocity.y = Math.max(-4.5, Math.min(4.2, this.velocity.y));
      this.fallDistance = 0;
    } else {
      this.velocity.y -= GRAVITY * dt;
      if (this.velocity.y < -TERMINAL_VELOCITY) this.velocity.y = -TERMINAL_VELOCITY;
      if (inputEnabled && input.isDown('Space') && this.onGround) {
        this.velocity.y = JUMP_VELOCITY;
        if (this.sprinting) {
          this.velocity.x += forward.x * 1.8;
          this.velocity.z += forward.z * 1.8;
        }
        this.onGround = false;
      }
    }

    const move = new THREE.Vector3(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
    const maxMove = Math.max(Math.abs(move.x), Math.abs(move.y), Math.abs(move.z));
    const steps = Math.min(10, Math.max(1, Math.ceil(maxMove / 0.35)));
    const stepDt = dt / steps;

    const prevX = this.position.x;
    const prevZ = this.position.z;
    this.onGround = false;

    for (let i = 0; i < steps; i++) {
      if (this.moveAxis(world, 1, this.velocity.y * stepDt)) {
        if (this.velocity.y < 0) this.onGround = true;
        this.velocity.y = 0;
      }
      if (this.moveAxis(world, 0, this.velocity.x * stepDt)) this.velocity.x = 0;
      if (this.moveAxis(world, 2, this.velocity.z * stepDt)) this.velocity.z = 0;
    }

    if (this.sneaking && this.onGround && !this.hasGroundSupport(world)) {
      this.position.x = prevX;
      this.position.z = prevZ;
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    if (this.onGround && this.fallDistance > 0) {
      if (!this.creative) {
        const damage = Math.floor(this.fallDistance - 3.2);
        if (damage > 0) this.damage(damage, 'падение с высоты');
      }
      this.fallDistance = 0;
    } else if (!this.onGround && this.velocity.y < 0 && !this.inWater && !this.flying) {
      this.fallDistance += -this.velocity.y * dt;
    }

    if (this.moving && this.onGround) {
      this.walkDistance += Math.hypot(this.velocity.x, this.velocity.z) * dt;
    }

    this.updateVitals(dt, world);
  }

  updateVitals(dt, world) {
    if (this.creative) {
      this.health = this.maxHealth;
      this.hunger = 20;
      this.saturation = 20;
      this.air = this.maxAir;
      this.exhaustion = 0;
      this.regenTimer = 0;
      this.starveTimer = 0;
      this.drownTimer = 0;
      this.lavaTimer = 0;
    } else {
      this.updateSurvivalVitals(dt);
    }

    // Safety net: never leave a player trapped inside terrain after chunk edits.
    if (world.isSolidAt(Math.floor(this.position.x), Math.floor(this.position.y + 0.1), Math.floor(this.position.z))) {
      this.position.y += Math.max(0.2, 2.2 * dt);
      this.velocity.y = Math.max(0, this.velocity.y);
    }
  }

  updateSurvivalVitals(dt) {
    const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
    const movementExhaustion = this.sprinting ? 0.11 : horizontal > 0.1 ? 0.025 : 0.004;
    this.exhaustion += movementExhaustion * dt;

    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }

    if (this.hunger >= 18 && this.health < this.maxHealth) {
      this.regenTimer += dt;
      if (this.regenTimer >= 3.2) {
        this.regenTimer = 0;
        this.health = Math.min(this.maxHealth, this.health + 1);
        this.exhaustion += 1.5;
      }
    } else {
      this.regenTimer = 0;
    }

    if (this.hunger <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 4) {
        this.starveTimer = 0;
        this.damage(1, 'голод');
      }
    } else {
      this.starveTimer = 0;
    }

    if (this.headInWater) {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) {
        this.drownTimer += dt;
        if (this.drownTimer >= 1) {
          this.drownTimer = 0;
          this.damage(2, 'утопление');
        }
      }
    } else {
      this.air = Math.min(this.maxAir, this.air + dt * 4);
      this.drownTimer = 0;
    }

    if (this.inLava) {
      this.lavaTimer += dt;
      if (this.lavaTimer >= 0.5) {
        this.lavaTimer = 0;
        this.damage(4, 'лава');
      }
    } else {
      this.lavaTimer = 0;
    }
  }

  moveAxis(world, axis, amount) {
    if (amount === 0) return false;
    const p = this.position;
    if (axis === 0) p.x += amount;
    else if (axis === 1) p.y += amount;
    else p.z += amount;

    const minX = Math.floor(p.x - HALF_WIDTH + EPS);
    const maxX = Math.floor(p.x + HALF_WIDTH - EPS);
    const minY = Math.floor(p.y + EPS);
    const maxY = Math.floor(p.y + PLAYER_HEIGHT - EPS);
    const minZ = Math.floor(p.z - HALF_WIDTH + EPS);
    const maxZ = Math.floor(p.z + HALF_WIDTH - EPS);

    let hit = false;
    let boundary = amount > 0 ? Infinity : -Infinity;

    for (let by = minY; by <= maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        for (let bx = minX; bx <= maxX; bx++) {
          if (!world.isSolidAt(bx, by, bz)) continue;
          hit = true;
          if (axis === 0) {
            const candidate = amount > 0 ? bx - HALF_WIDTH - EPS : bx + 1 + HALF_WIDTH + EPS;
            boundary = amount > 0 ? Math.min(boundary, candidate) : Math.max(boundary, candidate);
          } else if (axis === 1) {
            const candidate = amount > 0 ? by - PLAYER_HEIGHT - EPS : by + 1 + EPS;
            boundary = amount > 0 ? Math.min(boundary, candidate) : Math.max(boundary, candidate);
          } else {
            const candidate = amount > 0 ? bz - HALF_WIDTH - EPS : bz + 1 + HALF_WIDTH + EPS;
            boundary = amount > 0 ? Math.min(boundary, candidate) : Math.max(boundary, candidate);
          }
        }
      }
    }

    if (hit && Number.isFinite(boundary)) {
      if (axis === 0) p.x = boundary;
      else if (axis === 1) p.y = boundary;
      else p.z = boundary;
    }
    return hit;
  }

  hasGroundSupport(world) {
    const p = this.position;
    const y = Math.floor(p.y - 0.08);
    const minX = Math.floor(p.x - HALF_WIDTH + 0.02);
    const maxX = Math.floor(p.x + HALF_WIDTH - 0.02);
    const minZ = Math.floor(p.z - HALF_WIDTH + 0.02);
    const maxZ = Math.floor(p.z + HALF_WIDTH - 0.02);
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (world.isSolidAt(x, y, z)) return true;
      }
    }
    return false;
  }

  intersectsBlock(bx, by, bz) {
    const p = this.position;
    return (
      p.x + HALF_WIDTH > bx + EPS &&
      p.x - HALF_WIDTH < bx + 1 - EPS &&
      p.y + PLAYER_HEIGHT > by + EPS &&
      p.y < by + 1 - EPS &&
      p.z + HALF_WIDTH > bz + EPS &&
      p.z - HALF_WIDTH < bz + 1 - EPS
    );
  }

  /**
   * Voxel DDA raycast. Fluids are skipped by default so the player cannot
   * target water/lava when building; bucket filling asks for them explicitly.
   */
  raycast(world, maxDistance = PLAYER_REACH, includeFluids = false) {
    const origin = this.eyePosition;
    const direction = this.getDirection();
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const stepX = direction.x > 0 ? 1 : direction.x < 0 ? -1 : 0;
    const stepY = direction.y > 0 ? 1 : direction.y < 0 ? -1 : 0;
    const stepZ = direction.z > 0 ? 1 : direction.z < 0 ? -1 : 0;
    const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / direction.x);
    const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / direction.y);
    const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / direction.z);
    let tMaxX = stepX === 0 ? Infinity : stepX > 0 ? (x + 1 - origin.x) / direction.x : (origin.x - x) / -direction.x;
    let tMaxY = stepY === 0 ? Infinity : stepY > 0 ? (y + 1 - origin.y) / direction.y : (origin.y - y) / -direction.y;
    let tMaxZ = stepZ === 0 ? Infinity : stepZ > 0 ? (z + 1 - origin.z) / direction.z : (origin.z - z) / -direction.z;

    let normal = { x: 0, y: 0, z: 0 };
    let distance = 0;
    for (let i = 0; i < 256; i++) {
      const id = world.getBlock(x, y, z);
      const block = getBlock(id);
      if (id !== 0 && (includeFluids || !block.fluid) && block.renderLayer !== 'none') {
        return { x, y, z, id, normal, distance };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        distance = tMaxX;
        tMaxX += tDeltaX;
        normal = { x: -stepX, y: 0, z: 0 };
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        distance = tMaxY;
        tMaxY += tDeltaY;
        normal = { x: 0, y: -stepY, z: 0 };
      } else {
        z += stepZ;
        distance = tMaxZ;
        tMaxZ += tDeltaZ;
        normal = { x: 0, y: 0, z: -stepZ };
      }
      if (distance > maxDistance) break;
    }
    return null;
  }

  canHarvest(block, heldId) {
    if (!block || block.hardness < 0) return false;
    if (!block.tool || (block.minTier || 0) === 0) return true;
    const tool = getToolInfo(heldId);
    return !!tool && tool.type === block.tool && tool.tier >= (block.minTier || 0);
  }

  getBreakTime(block, heldId) {
    if (this.creative) return 0.05;
    if (!block || block.hardness < 0) return Infinity;
    const tool = getToolInfo(heldId);
    const correctTool = tool && tool.type === block.tool;
    const speed = correctTool ? tool.speed : 1;
    const canHarvest = this.canHarvest(block, heldId);
    return Math.max(0.05, (block.hardness * (canHarvest ? 1.5 : 5)) / speed);
  }

  damage(amount, cause = '') {
    if (this.creative || this.dead || this.damageCooldown > 0) return;
    // Minecraft-style armor: 4% less damage per defense point, capped at 80%.
    const reduction = Math.min(0.8, Math.max(0, this.armorPoints) * 0.04);
    const dealt = reduction > 0 ? Math.max(1, amount * (1 - reduction)) : amount;
    this.health = Math.max(0, this.health - dealt);
    this.damageCooldown = 0.45;
    this.lastDamageCause = cause;
    if (this.health <= 0) this.dead = true;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  eat(nutrition, saturation, regeneration = 0) {
    this.hunger = Math.min(20, this.hunger + nutrition);
    this.saturation = Math.min(20, this.saturation + saturation);
    if (regeneration) this.health = Math.min(this.maxHealth, this.health + regeneration);
  }

  addExhaustion(amount) {
    this.exhaustion += amount;
  }

  respawn(spawn) {
    this.position.set(spawn.x, spawn.y, spawn.z);
    this.velocity.set(0, 0, 0);
    this.flying = false;
    this.health = this.maxHealth;
    this.hunger = 20;
    this.saturation = 5;
    this.air = this.maxAir;
    this.fallDistance = 0;
    this.dead = false;
    this.damageCooldown = 0;
    this.lastDamageCause = '';
  }

  serialize() {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      hunger: this.hunger,
      saturation: this.saturation,
      air: this.air,
    };
  }

  deserialize(data) {
    if (!data) return;
    this.position.set(data.x ?? 0.5, data.y ?? 80, data.z ?? 0.5);
    this.yaw = data.yaw ?? 0;
    this.pitch = data.pitch ?? 0;
    this.health = data.health ?? 20;
    this.hunger = data.hunger ?? 20;
    this.saturation = data.saturation ?? 5;
    this.air = data.air ?? this.maxAir;
    this.dead = this.health <= 0;
  }
}
