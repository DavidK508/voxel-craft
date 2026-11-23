import * as THREE from 'three';
import { getBlock } from '../shared/blocks.js';
import { SEA_LEVEL } from '../shared/constants.js';
import { isInWater, isWaterBlock, waterSurfaceAt } from '../shared/water.js';
import { buildMobModel } from './models.js';

const GRAVITY = 26;
const HALF = 0.3;
const TAU = Math.PI * 2;
// Angles tried (in radians) when the direct route is blocked. Keeping the
// first clear turn small makes creatures slide around corners instead of
// pressing their face into a wall forever.
const AVOID_ANGLES = [0.6, -0.6, 1.15, -1.15, 1.75, -1.75, Math.PI];
const AVOID_DETOUR_SECONDS = 0.7;

function randomAngle() {
  return Math.random() * TAU;
}

let nextEntityId = 1;
export function resetEntityIds() {
  nextEntityId = 1;
}

/**
 * A single living creature. Models are procedurally assembled boxes (the scene
 * intentionally has no lights, so everything uses MeshBasicMaterial).
 */
export class Entity {
  constructor(mob, position, options = {}) {
    this.id = options.id ?? `entity-${nextEntityId++}`;
    this.type = mob.key;
    this.mob = mob;
    this.name = mob.name;
    this.kind = mob.kind;
    this.isBoss = mob.kind === 'boss';
    this.hostile = mob.kind === 'hostile' || this.isBoss;
    this.width = mob.width;
    this.height = mob.height;
    this.flying = !!mob.flying;
    this.aquatic = !!mob.aquatic;
    this.inWater = false;
    this.airTime = 0;
    this.dryTime = 0;
    this.waterTarget = null;
    this.waterTimer = 0;
    this.flopTimer = 0;
    this.position = new THREE.Vector3(position.x, position.y, position.z);
    this.velocity = new THREE.Vector3();
    this.yaw = options.yaw ?? randomAngle();
    this.health = options.health ?? mob.health;
    this.maxHealth = mob.health;
    this.onGround = false;
    this.dead = false;
    this.tamed = options.tamed ?? false;
    this.saddled = options.saddled ?? false;
    this.armored = options.armored ?? false;
    this.sheared = options.sheared ?? false;
    this.ridden = false;
    this.home = options.home ? { x: options.home.x, z: options.home.z } : null;
    this.state = 'idle';
    this.timer = 0.5 + Math.random() * 2.5;
    this.attackCooldown = 0;
    this.hurtTime = 0;
    this.fleeTimer = 0;
    this.provoked = 0;
    this.fuse = 0;
    this.exploded = false;
    this.target = null;
    this.guardTimer = 0;
    this.huntTarget = null;
    this.huntTimer = 0;
    this.walkPhase = Math.random() * TAU;
    this.detourTimer = 0;
    this.detourAngle = 0;
    this.time = Math.random() * 10;
    this.model = buildMobModel(mob.model);
    this.model.group.position.copy(this.position);
    this.syncModel(0);
  }

  get eyeY() {
    return this.position.y + this.height * 0.8;
  }

  get center() {
    return new THREE.Vector3(this.position.x, this.position.y + this.height / 2, this.position.z);
  }

  collides(world, x, y, z) {
    const h = this.width / 2;
    const minX = Math.floor(x - h + 0.001);
    const maxX = Math.floor(x + h - 0.001);
    const minY = Math.floor(y + 0.001);
    const maxY = Math.floor(y + this.height - 0.001);
    const minZ = Math.floor(z - h + 0.001);
    const maxZ = Math.floor(z + h - 0.001);
    for (let by = minY; by <= maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        for (let bx = minX; bx <= maxX; bx++) {
          const id = world.getBlock(bx, by, bz);
          // Aquatic mobs swim through water but are still stopped by solids/lava.
          if (this.aquatic && isWaterBlock(id)) continue;
          const block = getBlock(id);
          if (block?.solid === true) return true;
          // Fluid blocks (water/lava) are treated as solid for entity collision,
          // preventing mobs from walking on water or through it.
          if (block?.fluid === true) return true;
        }
      }
    }
    return false;
  }

  moveAxis(world, axis, amount) {
    if (!amount) return false;
    const old = axis === 0 ? this.position.x : axis === 1 ? this.position.y : this.position.z;
    if (axis === 0) this.position.x += amount;
    else if (axis === 1) this.position.y += amount;
    else this.position.z += amount;
    if (!this.collides(world, this.position.x, this.position.y, this.position.z)) return false;
    if (axis === 0) this.position.x = old;
    else if (axis === 1) this.position.y = old;
    else this.position.z = old;
    if (axis === 1 && amount < 0) {
      this.onGround = true;
      this.velocity.y = 0;
    } else {
      this.velocity[axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'] = 0;
    }
    return true;
  }

  /** Moves horizontally and climbs one-block steps, keeping creatures out of walls. */
  moveHorizontal(world, dx, dz) {
    if (this.moveAxis(world, 0, dx)) {
      if (!this.tryStepUp(world)) this.velocity.x = 0;
    }
    if (this.moveAxis(world, 2, dz)) {
      if (!this.tryStepUp(world)) this.velocity.z = 0;
    }
  }

  tryStepUp(world) {
    if (!this.onGround && !this.flying) return false;
    const y = this.position.y;
    this.position.y += 1.02;
    if (!this.collides(world, this.position.x, this.position.y, this.position.z)) return true;
    this.position.y = y;
    return false;
  }

  groundBelow(world, fromY) {
    const bx = Math.floor(this.position.x);
    const bz = Math.floor(this.position.z);
    for (let y = Math.floor(fromY); y > Math.max(0, fromY - 24); y--) {
      if (world.isSolidAt(bx, y, bz)) return y + 1;
    }
    return null;
  }

  /**
   * Open-loop wandering and straight-line homing both get stuck on walls: the
   * collision reverts the blocked axis but the AI keeps pushing next frame.
   * Probe a little ahead and rotate the desired velocity towards the first
   * clear route. The chosen detour is held briefly so the creature does not
   * jitter between equally good left/right turns.
   */
  steerAround(world, x, z, dt) {
    const length = Math.hypot(x, z);
    if (length < 0.04 || !world?.getBlock) return { x, z, detour: false };
    const nx = x / length;
    const nz = z / length;
    const direction = (angle) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return { x: nx * cos - nz * sin, z: nx * sin + nz * cos };
    };
    const clear = (angle, distance) => {
      const dir = direction(angle);
      return !this.collides(
        world,
        this.position.x + dir.x * distance,
        this.position.y,
        this.position.z + dir.z * distance,
      );
    };

    if (clear(0, 0.85) && clear(0, 1.45)) {
      this.detourTimer = 0;
      this.detourAngle = 0;
      return { x, z, detour: false };
    }

    if (this.detourTimer > 0 && clear(this.detourAngle, 0.85)) {
      this.detourTimer -= dt;
      const dir = direction(this.detourAngle);
      return { x: dir.x * length, z: dir.z * length, detour: true };
    }

    for (const angle of AVOID_ANGLES) {
      if (!clear(angle, 0.85)) continue;
      if (!clear(angle, 1.45) && angle !== Math.PI) continue;
      this.detourAngle = angle;
      this.detourTimer = AVOID_DETOUR_SECONDS;
      const dir = direction(angle);
      return { x: dir.x * length, z: dir.z * length, detour: true };
    }
    return { x, z, detour: false };
  }

  update(dt, world, player, manager) {
    if (this.dead) return;
    // Keep the world handy for the fluid-ground check below; without this the
    // entity would treat the water surface as solid ground.
    this.world = world;
    this.time += dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.hurtTime = Math.max(0, this.hurtTime - dt);
    this.provoked = Math.max(0, this.provoked - dt);
    if (this.fleeTimer > 0) this.fleeTimer = Math.max(0, this.fleeTimer - dt);

    if (!world.isChunkLoadedAt(this.position.x, this.position.z)) {
      this.syncModel(dt);
      return;
    }

    // A ridden mount is driven by rideUpdate() instead of its own AI.
    if (this.ridden) {
      this.syncModel(dt);
      return;
    }

    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    const canHunt = !player.creative && !player.dead;

    let moveX = 0;
    let moveZ = 0;
    let speed = this.mob.speed;

    if (this.aquatic) {
      const swim = this.aquaticAi(dt, world, dx, dz);
      moveX = swim.x;
      moveZ = swim.z;
      speed = swim.speed;
    } else if (this.kind === 'guardian') {
      // Iron golems stay near their village and intercept hostile mobs before
      // they can reach the villagers. Hurting a villager (or the golem itself)
      // makes them turn on the player for a while.
      this.guardTimer -= dt;
      let target = this.target;
      if (target && (target.dead || this.distanceTo(target) > 22)) target = null;
      if (this.guardTimer <= 0 || !target) {
        this.guardTimer = 0.5;
        target = this.findHostile(manager);
        this.target = target;
      }

      const playerThreat = this.provoked > 0 && canHunt && distance < 24;
      if (playerThreat) {
        this.state = 'guard';
        this.yaw = Math.atan2(-dx, -dz);
        if (distance > this.mob.attackRange) {
          moveX = -Math.sin(this.yaw);
          moveZ = -Math.cos(this.yaw);
          speed *= 1.25;
        } else {
          this.attackPlayer(player, manager);
        }
      } else if (target) {
        const tx = target.position.x - this.position.x;
        const tz = target.position.z - this.position.z;
        const td = Math.hypot(tx, tz);
        this.state = 'guard';
        this.yaw = Math.atan2(-tx, -tz);
        if (td > this.mob.attackRange) {
          moveX = -Math.sin(this.yaw);
          moveZ = -Math.cos(this.yaw);
          speed *= 1.25;
        } else {
          this.attackEntity(target, manager);
        }
      } else {
        const hx = this.home ? this.home.x - this.position.x : 0;
        const hz = this.home ? this.home.z - this.position.z : 0;
        const homeDistance = Math.hypot(hx, hz);
        if (this.home && homeDistance > 10) {
          this.state = 'return';
          this.yaw = Math.atan2(-hx, -hz);
          moveX = -Math.sin(this.yaw);
          moveZ = -Math.cos(this.yaw);
        } else {
          this.timer -= dt;
          if (this.timer <= 0) {
            this.timer = 3 + Math.random() * 4;
            this.state = Math.random() < 0.5 ? 'idle' : 'wander';
            this.yaw = randomAngle();
          }
          if (this.state === 'wander') {
            moveX = -Math.sin(this.yaw) * 0.4;
            moveZ = -Math.cos(this.yaw) * 0.4;
          }
        }
      }
    } else if (this.hostile) {
      // Hostile mobs hunt the nearest player or peaceful creature (animals,
      // villagers), so the world feels alive and golems have someone to save.
      this.huntTimer -= dt;
      let prey = this.huntTarget;
      if (prey && (prey.dead || this.distanceTo(prey) > 28 || (prey === player && !canHunt))) prey = null;
      if (this.huntTimer <= 0 || !prey) {
        this.huntTimer = 1;
        prey = this.findPrey(player, canHunt, manager);
        this.huntTarget = prey;
      }

      if (prey) {
        const tx = prey.position.x - this.position.x;
        const tz = prey.position.z - this.position.z;
        const targetDistance = Math.hypot(tx, tz);
        this.state = 'chase';
        this.yaw = Math.atan2(-tx, -tz);
        if (targetDistance > this.mob.attackRange * 0.75) {
          moveX = -Math.sin(this.yaw);
          moveZ = -Math.cos(this.yaw);
        } else {
          this.attackTarget(prey, player, manager);
        }
      } else {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.timer = 2 + Math.random() * 4;
          this.state = Math.random() < 0.45 ? 'idle' : 'wander';
          this.yaw = randomAngle();
        }
        if (this.state === 'wander') {
          moveX = -Math.sin(this.yaw) * 0.55;
          moveZ = -Math.cos(this.yaw) * 0.55;
        }
      }
    } else if (this.kind === 'neutral' && this.provoked > 0 && distance < 18) {
      this.state = 'chase';
      this.yaw = Math.atan2(-dx, -dz);
      if (distance > 1.4) {
        moveX = -Math.sin(this.yaw);
        moveZ = -Math.cos(this.yaw);
      } else {
        this.attackPlayer(player, manager);
      }
    } else if (this.fleeTimer > 0) {
      this.state = 'flee';
      this.yaw = Math.atan2(dx, dz);
      moveX = -Math.sin(this.yaw);
      moveZ = -Math.cos(this.yaw);
      speed *= 1.35;
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 2 + Math.random() * 4;
        this.state = Math.random() < 0.45 ? 'idle' : 'wander';
        this.yaw = randomAngle();
      }
      // Villagers and farm animals with a home drift back towards it instead
      // of wandering off across the whole biome.
      if (this.home) {
        const hx = this.home.x - this.position.x;
        const hz = this.home.z - this.position.z;
        const limit = this.kind === 'villager' ? 12 : 7;
        if (Math.hypot(hx, hz) > limit) {
          this.state = 'return';
          this.yaw = Math.atan2(-hx, -hz);
        }
      }
      if (this.state === 'wander' || this.state === 'return') {
        moveX = -Math.sin(this.yaw) * 0.55;
        moveZ = -Math.cos(this.yaw) * 0.55;
      }
    }

    if (!this.aquatic && !this.flying) {
      const steered = this.steerAround(world, moveX, moveZ, dt);
      moveX = steered.x;
      moveZ = steered.z;
      if (steered.detour && this.state !== 'chase') {
        this.yaw = Math.atan2(-moveX, -moveZ);
      }
    }

    this.velocity.x += (moveX * speed - this.velocity.x) * Math.min(1, dt * 8);
    this.velocity.z += (moveZ * speed - this.velocity.z) * Math.min(1, dt * 8);

    this.onGround = false;
    // Avoid treating water/lava as ground so entities don't "walk on water".
    if (this.world && this.world.getBlock) {
      const below = this.world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y - 0.1), Math.floor(this.position.z));
      if (getBlock(below)?.fluid === true) this.onGround = false;
    }
    if (this.aquatic) {
      this.updateAquaticBuoyancy(world, dt);
    } else if (this.flying) {
      const targetY = this.groundBelow(world, this.position.y + 4) ?? this.position.y;
      const bob = Math.sin(this.time * 2.4 + this.walkPhase) * 0.35;
      const wanted = targetY + 2.2 + bob;
      this.velocity.y += (wanted - this.position.y) * Math.min(1, dt * 3);
      this.velocity.y = Math.max(-6, Math.min(6, this.velocity.y));
    } else {
      this.velocity.y -= GRAVITY * dt;
      this.velocity.y = Math.max(-30, this.velocity.y);
    }

    const steps = Math.max(1, Math.min(6, Math.ceil(Math.max(
      Math.abs(this.velocity.x * dt), Math.abs(this.velocity.y * dt), Math.abs(this.velocity.z * dt),
    ) / 0.3)));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.moveAxis(world, 1, this.velocity.y * stepDt);
      this.moveHorizontal(world, this.velocity.x * stepDt, this.velocity.z * stepDt);
    }

    // Never leave a creature buried in terrain after a chunk edit.
    if (this.collides(world, this.position.x, this.position.y + 0.05, this.position.z)) {
      this.position.y += 0.12;
      this.velocity.y = Math.max(0, this.velocity.y);
    }
    if (this.position.y < -4) {
      this.dead = true;
      this.exploded = false;
    }

    this.syncModel(dt);
    if (this.hostile && this.mob.explodes) this.updateFuse(dt, this.huntTarget, player);
  }

  /** Fish and axolotls swim, then flop toward the nearest water when stranded. */
  aquaticAi(dt, world, dx, dz) {
    const surface = waterSurfaceAt(
      world,
      this.position.x,
      this.position.z,
      Math.max(SEA_LEVEL + 8, this.position.y + 10),
      SEA_LEVEL - 22,
    );
    const wet = isInWater(world, this.position, 0.1)
      || (surface != null && this.position.y <= surface + 1.1);
    this.inWater = wet;

    if (wet) {
      this.airTime = 0;
      this.waterTarget = null;
    } else {
      this.airTime += dt;
      this.waterTimer -= dt;
      if (this.waterTimer <= 0) {
        this.waterTimer = 2;
        this.waterTarget = this.findNearbyWater(world, 14);
      }
    }

    if (this.fleeTimer > 0 && Math.hypot(dx, dz) > 0.01) {
      this.state = 'flee';
      this.yaw = Math.atan2(dx, dz);
      return {
        x: -Math.sin(this.yaw),
        z: -Math.cos(this.yaw),
        speed: this.mob.speed * 1.3,
      };
    }

    if (!wet && this.waterTarget) {
      const tx = this.waterTarget.x - this.position.x;
      const tz = this.waterTarget.z - this.position.z;
      if (Math.hypot(tx, tz) > 0.4) {
        this.state = 'to_water';
        this.yaw = Math.atan2(-tx, -tz);
        return {
          x: -Math.sin(this.yaw),
          z: -Math.cos(this.yaw),
          speed: this.mob.speed * 1.2,
        };
      }
    }

    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 2 + Math.random() * 4;
      this.state = Math.random() < 0.5 ? 'idle' : 'wander';
      this.yaw = randomAngle();
    }
    if (this.state === 'wander') {
      return {
        x: -Math.sin(this.yaw) * 0.5,
        z: -Math.cos(this.yaw) * 0.5,
        speed: this.mob.speed,
      };
    }
    return { x: 0, z: 0, speed: this.mob.speed };
  }

  findNearbyWater(world, radius = 14) {
    let best = null;
    let bestDistance = Infinity;
    const bx = Math.floor(this.position.x);
    const bz = Math.floor(this.position.z);
    const fromY = Math.max(SEA_LEVEL + 8, this.position.y + 10);
    for (let dz = -radius; dz <= radius; dz += 4) {
      for (let dx = -radius; dx <= radius; dx += 4) {
        const x = bx + dx;
        const z = bz + dz;
        const y = waterSurfaceAt(world, x + 0.5, z + 0.5, fromY, SEA_LEVEL - 22);
        if (y == null) continue;
        const distance = dx * dx + dz * dz;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x: x + 0.5, z: z + 0.5, y };
        }
      }
    }
    return best;
  }

  updateAquaticBuoyancy(world, dt) {
    const surface = waterSurfaceAt(
      world,
      this.position.x,
      this.position.z,
      Math.max(SEA_LEVEL + 8, this.position.y + 10),
      SEA_LEVEL - 22,
    );
    if (surface != null && this.position.y <= surface + 1.1) {
      const targetY = surface - this.height * 0.55 + 0.12;
      this.velocity.y += (targetY - this.position.y) * Math.min(1, dt * 6);
      this.velocity.y *= Math.max(0, 1 - dt * 5);
      this.inWater = true;
      this.airTime = 0;
      this.dryTime = 0;
      this.flopTimer = 0.6;
    } else {
      this.inWater = false;
      this.dryTime += dt;
      this.velocity.y -= GRAVITY * 0.5 * dt;
      const below = world.getBlock?.(
        Math.floor(this.position.x),
        Math.floor(this.position.y - 0.1),
        Math.floor(this.position.z),
      );
      const grounded = below != null && getBlock(below)?.solid === true;
      this.flopTimer -= dt;
      if (grounded && this.flopTimer <= 0) {
        // Stranded mobs flap along the bank instead of sitting motionless.
        this.velocity.y = 3.1;
        this.flopTimer = 1.2 + Math.random() * 0.8;
      }
    }
    this.velocity.y = Math.max(-9, Math.min(5, this.velocity.y));
  }

  /**
   * Player-driven movement for a saddled mount. The Game sets `yaw` from the
   * camera before calling this each frame.
   */
  rideUpdate(dt, world, { forward = 0, strafe = 0, jump = false } = {}) {
    if (this.dead) return;
    this.time += dt;
    this.hurtTime = Math.max(0, this.hurtTime - dt);

    const f = Math.max(-1, Math.min(1, forward));
    const s = Math.max(-1, Math.min(1, strafe));
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let moveX = fx * f + rx * s;
    let moveZ = fz * f + rz * s;
    const length = Math.hypot(moveX, moveZ);
    if (length > 1) {
      moveX /= length;
      moveZ /= length;
    }

    const rideSpeed = this.mob.speed * 2.8;
    this.velocity.x += (moveX * rideSpeed - this.velocity.x) * Math.min(1, dt * 10);
    this.velocity.z += (moveZ * rideSpeed - this.velocity.z) * Math.min(1, dt * 10);

    if (jump && this.onGround) {
      this.velocity.y = 8.4;
      this.onGround = false;
    }
    this.velocity.y -= GRAVITY * dt;
    this.velocity.y = Math.max(-30, this.velocity.y);

    const steps = Math.max(1, Math.min(8, Math.ceil(Math.max(
      Math.abs(this.velocity.x * dt), Math.abs(this.velocity.y * dt), Math.abs(this.velocity.z * dt),
    ) / 0.3)));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.moveAxis(world, 1, this.velocity.y * stepDt);
      this.moveHorizontal(world, this.velocity.x * stepDt, this.velocity.z * stepDt);
    }

    if (this.position.y < -4) {
      this.dead = true;
      this.ridden = false;
    }
    this.syncModel(dt);
  }

  updateFuse(dt, target, player) {
    if (!target || target.dead) {
      this.fuse = Math.max(0, this.fuse - dt);
      return;
    }
    const isPlayer = target === player;
    const distance = this.distanceTo(target);
    if (distance < 2.4 && (!isPlayer || !player.creative)) {
      this.fuse += dt;
      if (this.fuse > 1.3) {
        if (isPlayer) player.damage(6, 'взрыв крипера');
        else target.hit(6, this);
        this.dead = true;
        this.exploded = true;
      }
    } else {
      this.fuse = Math.max(0, this.fuse - dt);
    }
  }

  /** Horizontal distance to another entity or the player. */
  distanceTo(other) {
    return Math.hypot(other.position.x - this.position.x, other.position.z - this.position.z);
  }

  /** Nearest player or peaceful creature for a hostile mob to hunt. */
  findPrey(player, canHunt, manager) {
    // The boss ignores the local wildlife and only hunts the player.
    if (this.isBoss) return canHunt ? player : null;
    let best = null;
    let bestDistance = Infinity;
    const consider = (entity) => {
      if (!entity || entity === this || entity.dead) return;
      const distance = this.distanceTo(entity);
      if (distance > 20 || distance >= bestDistance) return;
      best = entity;
      bestDistance = distance;
    };

    if (canHunt) consider(player);
    for (const entity of manager?.entities ?? []) {
      if (entity === this || entity.dead) continue;
      const huntable = entity.kind === 'passive'
        || entity.kind === 'neutral'
        || entity.kind === 'villager';
      if (!huntable) continue;
      // Ground monsters cannot catch flying animals, so do not chase them.
      if (entity.flying && !this.flying) continue;
      consider(entity);
    }
    return best;
  }

  attackTarget(target, player, manager) {
    if (target === player) {
      this.attackPlayer(player, manager);
      return;
    }
    if (this.attackCooldown > 0 || !this.mob.damage || !target || target.dead) return;
    this.attackCooldown = 1.35;
    target.hit(this.mob.damage, this);
    manager?.onAttack?.(this);
  }

  /** Nearest living hostile mob that is a threat to this golem's village. */
  findHostile(manager) {
    if (!manager?.entities) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const entity of manager.entities) {
      if (entity === this || entity.dead || !entity.hostile) continue;
      const distance = this.distanceTo(entity);
      if (distance > 20 || distance >= bestDistance) continue;
      // Do not chase a mob away from the village the golem is protecting.
      if (this.home) {
        const fromHome = Math.hypot(
          entity.position.x - this.home.x,
          entity.position.z - this.home.z,
        );
        if (fromHome > 26) continue;
      }
      best = entity;
      bestDistance = distance;
    }
    return best;
  }

  attackEntity(target, manager) {
    if (this.attackCooldown > 0 || !this.mob.damage || !target || target.dead) return;
    this.attackCooldown = 1.2;
    target.hit(this.mob.damage, this);
    manager?.onAttack?.(this);
    if (target.dead) this.target = null;
  }

  attackPlayer(player, manager) {
    if (this.attackCooldown > 0 || !this.mob.damage) return;
    this.attackCooldown = 1.35;
    player.damage(this.mob.damage, `атака (${this.name.toLowerCase()})`);
    manager?.onAttack?.(this);
  }

  syncModel(dt) {
    const group = this.model.group;
    group.position.copy(this.position);
    group.rotation.y = this.yaw;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 0.1) this.walkPhase += dt * (4 + speed * 2.2);
    const swing = speed > 0.1 ? Math.sin(this.walkPhase) * 0.55 : 0;
    this.model.legs?.forEach((leg, index) => {
      const phase = index % 2 === 0 ? swing : -swing;
      leg.rotation.x = phase;
    });
    this.model.arms?.forEach((arm, index) => {
      arm.rotation.x = index % 2 === 0 ? -swing * 0.6 : swing * 0.6;
    });
    if (this.model.wings) {
      const flap = Math.sin(this.time * 16 + this.walkPhase) * 0.55;
      for (let i = 0; i < this.model.wings.length; i++) {
        const wing = this.model.wings[i];
        wing.rotation.z = i % 2 === 0 ? flap : -flap;
      }
    }
    if (this.model.head) {
      this.model.head.rotation.x = speed > 0.1 ? Math.sin(this.walkPhase * 2) * 0.05 : 0;
    }
    if (this.model.rods) {
      for (let i = 0; i < this.model.rods.length; i++) {
        this.model.rods[i].rotation.y = this.time * (1.4 + i * 0.1) + i;
      }
    }
    // Flash red while hurt without allocating a new material every frame.
    const flash = this.hurtTime > 0;
    group.visible = flash ? Math.floor(this.hurtTime * 20) % 2 === 0 : true;
  }

  hit(amount, attacker = null) {
    if (this.dead) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtTime = 0.35;
    if (attacker) {
      if (this.kind === 'guardian') this.provoked = Math.max(this.provoked, 20);
      else if (this.kind === 'neutral' || this.hostile) this.provoked = 8;
      else this.fleeTimer = 5;
    }
    if (this.health <= 0) {
      this.dead = true;
    }
    return this.dead;
  }

  tame() {
    this.tamed = true;
    this.fleeTimer = 0;
  }

  serialize() {
    return {
      type: this.type,
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      yaw: this.yaw,
      health: this.health,
      tamed: this.tamed,
      saddled: this.saddled,
      armored: this.armored,
      sheared: this.sheared,
      home: this.home ? { x: this.home.x, z: this.home.z } : null,
    };
  }

  dispose() {
    this.model?.group.removeFromParent();
  }
}
