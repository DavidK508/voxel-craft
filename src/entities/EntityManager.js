import * as THREE from 'three';
import { Entity } from './Entity.js';
import {
  MOBS,
  hostilePool,
  passivePool,
  rollDrops,
  spawnablePassive,
} from './mobs.js';
import { HORIZONTAL_OFFSETS, decodeState } from '../shared/blocks.js';
import { dimensionAt, nearbyVillages, END_ORIGIN, NETHER_ORIGIN } from '../world/generator.js';
import { PLAYER_HEIGHT, PLAYER_WIDTH, SEA_LEVEL, WORLD_HEIGHT } from '../shared/constants.js';
import { getSpawnEggId } from '../shared/items.js';
import { waterSurfaceAt } from '../shared/water.js';
import { ANIMAL_TIMING, animalDiet } from '../shared/animalFoods.js';

const finite = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const MAX_ENTITIES = 28;
const DESPAWN_DISTANCE = 90;
const SPAWN_MIN = 22;
const SPAWN_MAX = 46;
const FARM_ANIMALS = ['cow', 'pig', 'sheep', 'chicken'];
const FARM_ANIMAL_COUNT = 4;
const BOSS_RESPAWN_SECONDS = 120;
const SUN_DAMAGE_PER_SECOND = 6;
const STRANDED_GRACE_SECONDS = 2.5;
const STRANDED_DAMAGE_PER_SECOND = 4;
const AQUATIC_TARGET = 6;
const DOOR_HOLD_SECONDS = 2.5;
const BED_SEARCH_RADIUS = 15;

export class EntityManager {
  constructor({ scene, world, drops, seed, audio = null }) {
    this.scene = scene;
    this.world = world;
    this.drops = drops;
    this.audio = audio;
    this.seed = seed >>> 0;
    this.entities = [];
    this.player = null;
    this.time = 0;
    this.spawnTimer = 1.2;
    this.aquaticTimer = 1;
    this.villageTimer = 0;
    this.villageCache = [];
    this.villageCacheTimer = 0;
    this.golemCooldowns = new Map();
    this.openDoors = new Map();
    this.bedClaims = new Map();
    this.day = true;
    this.timeOfDay = 6000;
    this.bossRespawnAt = 0;
    this.pigSeedAt = 0;
    this.onAttack = null;
    this.onBossSpawn = null;
    this.onBossDefeat = null;
    this.onDoorRequest = null;
  }

  add(entity) {
    if (entity.model?.group) this.scene.add(entity.model.group);
    this.entities.push(entity);
    return entity;
  }

  spawnMob(type, x, y, z, options = {}) {
    const mob = MOBS[type];
    if (!mob) return null;
    const entity = new Entity(mob, { x, y, z }, options);
    return this.add(entity);
  }

  update(dt, player, { timeOfDay = 0, creative = false, day = true } = {}) {
    this.player = player;
    this.day = day;
    this.timeOfDay = timeOfDay;
    this.time += dt;
    const dimension = dimensionAt(player.position.x, player.position.z);
    const max = dimension === 'overworld' ? MAX_ENTITIES : 14;

    for (let i = this.entities.length - 1; i >= 0; i--) {
      const entity = this.entities[i];
      const entityDimension = dimensionAt(entity.position.x, entity.position.z);
      const distance = Math.hypot(
        entity.position.x - player.position.x,
        entity.position.z - player.position.z,
      );
      const tooFar = distance > DESPAWN_DISTANCE
        || (entity.hostile && distance > 72)
        || entityDimension !== dimension;
      this.updateSunlight(entity, dt, day, dimension);
      if (entity.dead || tooFar) {
        if (entity.dead) {
          if (entity.kind === 'boss') this.registerBossDefeat(entity);
          if (!entity.exploded) this.dropLoot(entity);
        }
        this.removeAt(i);
        continue;
      }
      entity.update(dt, this.world, player, this);
      this.updateStranding(entity, dt);
    }

    // Creatures share the same space: separate overlapping bodies after every
    // AI step so nothing can walk straight through the player or a neighbour.
    this.resolveEntityCollisions(player);
    this.updateDoorTimers(player);

    this.villageTimer -= dt;
    if (this.villageTimer <= 0) {
      this.villageTimer = 2.5;
      this.updateVillagerBeds();
      this.trySpawnVillagers(player);
    }

    this.ensureNetherLife(player, dimension);
    this.ensureEndLife(player, dimension);
    this.aquaticTimer -= dt;
    if (this.aquaticTimer <= 0) {
      // Fish and axolotls are kept as a visible school near the player instead
      // of relying on the rare random spawn in trySpawn().
      this.aquaticTimer = 3;
      this.ensureAquaticLife(player, dimension);
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.8 + Math.random() * 2.4;
      if (this.entities.length < max) this.trySpawn(player, dimension, day);
    }

  }

  dropLoot(entity) {
    if (!this.drops) return;
    const x = entity.position.x;
    const y = entity.position.y + entity.height * 0.5;
    const z = entity.position.z;
    for (const stack of rollDrops(entity.mob)) {
      // A shorn sheep carries no wool until it grows back.
      if (entity.sheared && entity.type === 'sheep' && stack.id === 42) continue;
      // Babies are too small to yield meat or hides.
      if (entity.baby) continue;
      this.drops.spawn(stack.id, stack.count, x, y, z);
    }
    // Every creature yields the egg that can summon it again.
    const eggId = getSpawnEggId(entity.type);
    if (eggId !== null) this.drops.spawn(eggId, 1, x, y, z);
  }

  /**
   * Feeds an animal with the held item. Returns a short status string for the
   * HUD, or null when the creature ignores that item (so the player keeps it).
   */
  feed(entity, itemId, player = this.player) {
    if (!entity || entity.dead) return null;
    const diet = animalDiet(entity.type);
    if (!diet) return null;

    // Taming items are special: bones are not wolf food, but they earn trust.
    if (!entity.tamed && diet.tameFood === itemId) {
      if (Math.random() < (diet.tameChance ?? 1)) {
        entity.tame(player);
        return 'tamed';
      }
      entity.fleeTimer = 2.5;
      return 'tame-failed';
    }
    if (!diet.foods.includes(itemId)) return null;

    if (entity.baby) {
      entity.growTimer = Math.max(0, entity.growTimer - ANIMAL_TIMING.feedGrowthBoost);
      if (entity.growTimer === 0) entity.baby = false;
      entity.health = Math.min(entity.maxHealth, entity.health + 1);
      return 'grown';
    }

    // Wild wolves ignore meat; only bones earn their trust.
    if (diet.pet && !entity.tamed) return null;

    entity.health = Math.min(entity.maxHealth, entity.health + 2);
    entity.fleeTimer = 0;
    if (!diet.breedFoods.includes(itemId) || entity.breedingCooldown > 0) return 'fed';
    entity.loveTimer = ANIMAL_TIMING.loveSeconds;
    const partner = this.findMate(entity);
    if (partner && this.breed(entity, partner)) return 'bred';
    return 'loved';
  }

  /** Finds a nearby, similarly fed partner ready to breed with this animal. */
  findMate(entity) {
    const diet = animalDiet(entity.type);
    if (!diet || entity.baby || entity.loveTimer <= 0) return null;
    return this.entities.find((other) => (
      other !== entity
      && !other.dead
      && other.type === entity.type
      && !other.baby
      && other.loveTimer > 0
      && other.breedingCooldown <= 0
      && (!diet.pet || (other.tamed && other.owner === entity.owner))
      && Math.hypot(
        other.position.x - entity.position.x,
        other.position.z - entity.position.z,
      ) <= 8
    )) ?? null;
  }

  /** Spawns a baby and puts both parents on a breeding cooldown. */
  breed(a, b) {
    if (!a || !b || a.dead || b.dead || a.type !== b.type) return null;
    if (this.entities.length >= MAX_ENTITIES + AQUATIC_TARGET) return null;
    a.loveTimer = 0;
    b.loveTimer = 0;
    a.breedingCooldown = ANIMAL_TIMING.breedCooldown;
    b.breedingCooldown = ANIMAL_TIMING.breedCooldown;
    return this.spawnMob(a.type, a.position.x + 0.5, a.position.y, a.position.z + 0.5, {
      baby: true,
      growTimer: ANIMAL_TIMING.growthSeconds,
      tamed: a.tamed && b.tamed,
      owner: a.tamed ? a.owner : b.owner,
      home: a.home ?? b.home,
    });
  }

  /**
   * Overworld monsters burn when the sun can actually reach them. Damage is
   * gradual so the kill still runs through the normal death/loot path.
   */
  updateSunlight(entity, dt, day, dimension) {
    if (!entity.hostile || entity.dead || !day || dimension !== 'overworld') return;
    if (!this.isSunlit(entity)) return;
    entity.hit(SUN_DAMAGE_PER_SECOND * dt, null);
  }

  /**
   * A beached fish or axolotl gets a brief chance to flop back into the water,
   * then suffocates. Death goes through the normal hit()/loot path.
   */
  updateStranding(entity, dt) {
    if (!entity.aquatic || entity.dead || entity.inWater) return;
    if (entity.dryTime < STRANDED_GRACE_SECONDS) return;
    entity.hit(STRANDED_DAMAGE_PER_SECOND * dt);
  }

  isSunlit(entity) {
    if (typeof this.world?.isSolidAt !== 'function') return false;
    const bx = Math.floor(entity.position.x);
    const bz = Math.floor(entity.position.z);
    const startY = Math.ceil(entity.position.y + entity.height);
    for (let y = startY; y < WORLD_HEIGHT; y++) {
      if (this.world.isSolidAt(bx, y, bz)) return false;
    }
    return true;
  }

  removeAt(index) {
    const entity = this.entities[index];
    if (!entity) return;
    this.releaseBed(entity);
    entity.dispose();
    this.entities.splice(index, 1);
  }

  /** Asks the game to swing a door open, keeping it open while traffic is near. */
  requestDoor(x, y, z, open = true) {
    if (!this.onDoorRequest) return;
    const key = `${x},${y},${z}`;
    if (!open) {
      this.openDoors.delete(key);
      this.onDoorRequest(x, y, z, false);
      return;
    }
    if (this.openDoors.has(key)) {
      this.openDoors.set(key, this.time + DOOR_HOLD_SECONDS);
      return;
    }
    this.openDoors.set(key, this.time + DOOR_HOLD_SECONDS);
    this.onDoorRequest(x, y, z, true);
  }

  /** Closes doors once the hold expires and nobody is standing in them. */
  updateDoorTimers(player) {
    if (!this.onDoorRequest) return;
    for (const [key, expiry] of this.openDoors) {
      if (this.time < expiry) continue;
      const [x, y, z] = key.split(',').map(Number);
      const centreX = x + 0.5;
      const centreZ = z + 0.5;
      const occupied = this.entities.some((entity) => !entity.dead
        && Math.hypot(entity.position.x - centreX, entity.position.z - centreZ) < 1.3)
        || (player && !player.dead
          && Math.hypot(player.position.x - centreX, player.position.z - centreZ) < 1.3);
      if (occupied) {
        this.openDoors.set(key, this.time + 0.6);
        continue;
      }
      this.openDoors.delete(key);
      this.onDoorRequest(x, y, z, false);
    }
  }

  /** Separates overlapping AABBs so mobs cannot walk through each other or the player. */
  resolveEntityCollisions(player) {
    const world = this.world;
    const bodies = this.entities
      .filter((entity) => !entity.dead && !entity.sleeping && !entity.ridden)
      .map((entity) => ({
        entity,
        width: entity.width,
        height: entity.height,
        fixed: false,
      }));
    if (player && !player.dead) {
      bodies.push({ entity: player, width: PLAYER_WIDTH, height: PLAYER_HEIGHT, fixed: true });
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          const minDistance = (a.width + b.width) / 2;
          const ax = a.entity.position.x;
          const az = a.entity.position.z;
          const bx = b.entity.position.x;
          const bz = b.entity.position.z;
          let dx = bx - ax;
          let dz = bz - az;
          let distance = Math.hypot(dx, dz);
          if (distance >= minDistance) continue;
          if (a.entity.position.y + a.height <= b.entity.position.y
            || b.entity.position.y + b.height <= a.entity.position.y) continue;
          if (distance < 0.0001) {
            dx = 1;
            dz = 0;
            distance = 1;
          }
          const nx = dx / distance;
          const nz = dz / distance;
          const overlap = minDistance - distance + 0.001;
          const aMoves = !a.fixed && typeof a.entity.collides === 'function';
          const bMoves = !b.fixed && typeof b.entity.collides === 'function';
          if (!aMoves && !bMoves) continue;
          const aShare = aMoves ? (bMoves ? 0.5 : 1) : 0;
          const bShare = bMoves ? (aMoves ? 0.5 : 1) : 0;
          if (aMoves) {
            const x = ax - nx * overlap * aShare;
            const z = az - nz * overlap * aShare;
            if (!a.entity.collides(world, x, a.entity.position.y, z)) {
              a.entity.position.x = x;
              a.entity.position.z = z;
              a.entity.syncModel?.(0);
            }
          }
          if (bMoves) {
            const x = bx + nx * overlap * bShare;
            const z = bz + nz * overlap * bShare;
            if (!b.entity.collides(world, x, b.entity.position.y, z)) {
              b.entity.position.x = x;
              b.entity.position.z = z;
              b.entity.syncModel?.(0);
            }
          }
        }
      }
    }
  }

  /** Lets unclaimed villagers pick a nearby bed, one owner per bed. */
  updateVillagerBeds() {
    if (!this.world?.getBlock) return;
    const world = this.world;
    for (const [key, id] of this.bedClaims) {
      const [x, y, z] = key.split(',').map(Number);
      const owner = this.entities.find((entity) => entity.id === id);
      const state = decodeState(world.getBlock(x, y, z));
      if (!owner || owner.dead || state?.type !== 'bed' || state.head) this.bedClaims.delete(key);
    }
    for (const entity of this.entities) {
      if (entity.dead || entity.kind !== 'villager' || entity.bed) continue;
      const origin = entity.home ?? entity.position;
      const cx = Math.floor(origin.x);
      const cz = Math.floor(origin.z);
      const cy = Math.floor(entity.position.y);
      let found = false;
      for (let dz = -BED_SEARCH_RADIUS; dz <= BED_SEARCH_RADIUS && !found; dz++) {
        for (let dx = -BED_SEARCH_RADIUS; dx <= BED_SEARCH_RADIUS && !found; dx++) {
          const x = cx + dx;
          const z = cz + dz;
          for (let y = cy - 2; y <= cy + 2 && !found; y++) {
            const state = decodeState(world.getBlock(x, y, z));
            if (state?.type !== 'bed' || state.head) continue;
            const key = `${x},${y},${z}`;
            if (this.bedClaims.has(key)) continue;
            const offset = HORIZONTAL_OFFSETS[state.facing];
            const head = decodeState(world.getBlock(x + offset.x, y, z + offset.z));
            if (head?.type !== 'bed' || !head.head) continue;
            this.bedClaims.set(key, entity.id);
            entity.bed = { x, y, z };
            found = true;
          }
        }
      }
    }
  }

  releaseBed(entity) {
    if (!entity?.bed) return;
    const key = `${entity.bed.x},${entity.bed.y},${entity.bed.z}`;
    if (this.bedClaims.get(key) === entity.id) this.bedClaims.delete(key);
    entity.bed = null;
    entity.sleeping = false;
  }

  randomSpawnPoint(player, dimension, min = SPAWN_MIN, max = SPAWN_MAX) {
    const angle = Math.random() * Math.PI * 2;
    const distance = min + Math.random() * (max - min);
    const x = Math.floor(player.position.x + Math.cos(angle) * distance) + 0.5;
    const z = Math.floor(player.position.z + Math.sin(angle) * distance) + 0.5;
    if (!this.world.isChunkLoadedAt(x, z)) return null;
    if (dimensionAt(x, z) !== dimension) return null;
    const height = this.world.getHeightAt(x, z);
    if (height == null || height <= 0) return null;
    const ground = this.world.getBlock(Math.floor(x), height, Math.floor(z));
    if (ground === 0 || ground === 11 || ground === 30 || ground === 55 || ground === 58) return null;
    return { x, y: height + 1.02, z };
  }

  /**
   * Water columns in rings around the player. Aquatic mobs should be spawned
   * where the player can actually see them, not at a random distant offset.
   */
  findNearbyWaterColumns(player, maxRadius = 34) {
    const columns = [];
    for (let radius = 6; radius <= maxRadius; radius += 3) {
      // Dense enough to spot a 3-4 block wide river at any angle.
      const samples = Math.max(12, Math.round(radius * 2.5));
      const phase = radius * 0.37;
      for (let i = 0; i < samples; i++) {
        const angle = (i / samples) * Math.PI * 2 + phase;
        const x = Math.floor(player.position.x + Math.cos(angle) * radius) + 0.5;
        const z = Math.floor(player.position.z + Math.sin(angle) * radius) + 0.5;
        if (!this.world.isChunkLoadedAt?.(x, z) || dimensionAt(x, z) !== 'overworld') continue;
        const surface = waterSurfaceAt(this.world, x, z, SEA_LEVEL + 4, SEA_LEVEL - 20);
        if (surface == null || this.world.getBlock(Math.floor(x), surface + 1, Math.floor(z)) !== 0) continue;
        columns.push({ x, z, y: surface, radius });
      }
      if (columns.length >= 3) break;
    }
    return columns;
  }

  /** Finds a river/lake column or the adjacent sandy bank for aquatic mobs. */
  randomAquaticSpawnPoint(player, shore = false) {
    const columns = this.findNearbyWaterColumns(player);
    if (!columns.length) return null;
    const spot = columns[Math.floor(Math.random() * Math.min(3, columns.length))];
    if (!shore) return { x: spot.x, y: spot.y - 0.35, z: spot.z, shore: false };

    const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 1], [-2, -1], [2, -1], [-2, 1]];
    for (const [dx, dz] of offsets) {
      const sx = spot.x + dx;
      const sz = spot.z + dz;
      if (dimensionAt(sx, sz) !== 'overworld') continue;
      const height = this.world.getHeightAt(Math.floor(sx), Math.floor(sz));
      if (height == null || height < SEA_LEVEL - 2 || height > SEA_LEVEL + 3) continue;
      const ground = this.world.getBlock(Math.floor(sx), height, Math.floor(sz));
      if (ground === 0 || ground === 11 || ground === 30 || ground === 55 || ground === 58) continue;
      if (this.world.getBlock(Math.floor(sx), height + 1, Math.floor(sz)) !== 0) continue;
      return { x: sx, y: height + 1.02, z: sz, shore: true };
    }
    return null;
  }

  /** Keeps a small school of fish/axolotls swimming in view of the player. */
  ensureAquaticLife(player, dimension) {
    if (dimension !== 'overworld') return;
    const nearby = this.entities.filter((entity) => (
      entity.aquatic && !entity.dead
      && Math.hypot(entity.position.x - player.position.x, entity.position.z - player.position.z) < 44
    ));
    if (nearby.length >= AQUATIC_TARGET) return;
    if (this.entities.length >= MAX_ENTITIES + AQUATIC_TARGET) return;
    const point = this.randomAquaticSpawnPoint(player);
    if (!point) return;

    const fish = MOBS.fish;
    const axolotl = MOBS.axolotl;
    let remaining = Math.min(AQUATIC_TARGET - nearby.length, 3);
    while (remaining > 0) {
      const mob = Math.random() < 0.78 ? fish : axolotl;
      const size = Math.min(
        remaining,
        mob === fish ? 2 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 2),
      );
      let placed = 0;
      for (let i = 0; i < size; i++) {
        const px = point.x + (Math.random() - 0.5) * 1.2;
        const pz = point.z + (Math.random() - 0.5) * 1.2;
        const surface = waterSurfaceAt(this.world, px, pz, SEA_LEVEL + 4, SEA_LEVEL - 20);
        if (surface == null) continue;
        this.spawnMob(mob.key, px, surface - mob.height * 0.55 + 0.12, pz, {
          home: { x: point.x, z: point.z },
        });
        placed++;
      }
      remaining -= Math.max(1, placed);
    }
  }

  /** The Nether plaza always has a small herd. */
  ensureNetherLife(player, dimension) {
    if (dimension !== 'nether') return;
    const distance = Math.hypot(
      player.position.x - NETHER_ORIGIN.x,
      player.position.z - NETHER_ORIGIN.z,
    );
    if (distance > 44) return;
    if (this.time >= this.pigSeedAt) this.seedNetherPigs();
  }

  /** The End dragon owns the End plaza and returns two minutes after a kill. */
  ensureEndLife(player, dimension) {
    if (dimension !== 'end') return;
    const distance = Math.hypot(
      player.position.x - END_ORIGIN.x,
      player.position.z - END_ORIGIN.z,
    );
    if (distance > 44) return;
    const bossAlive = this.entities.some((entity) => entity.kind === 'boss' && !entity.dead);
    if (!bossAlive && this.time >= this.bossRespawnAt) this.spawnEndBoss();
  }

  spawnEndBoss() {
    // Offset from the centre so it does not overlap the return portal or pillars.
    const x = END_ORIGIN.x + 6.5;
    const z = END_ORIGIN.z - 5.5;
    if (!this.world.isChunkLoadedAt(x, z)) return;
    const height = this.world.getHeightAt(Math.floor(x), Math.floor(z));
    if (height == null) return;
    const ground = this.world.getBlock(Math.floor(x), height, Math.floor(z));
    const above = this.world.getBlock(Math.floor(x), height + 1, Math.floor(z));
    if (ground === 0 || ground === 11 || ground === 30 || ground === 55 || ground === 58 || above !== 0) return;
    const boss = this.spawnMob('ender_dragon', x, height + 1.02, z, {
      home: { x: END_ORIGIN.x, z: END_ORIGIN.z },
    });
    if (boss) this.onBossSpawn?.(boss);
  }

  seedNetherPigs() {
    const pigs = this.entities.filter((entity) => entity.type === 'nether_pig' && !entity.dead).length;
    if (pigs < 3) {
      for (let i = pigs; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
        const radius = 4 + Math.random() * 3;
        const x = NETHER_ORIGIN.x + Math.cos(angle) * radius;
        const z = NETHER_ORIGIN.z + Math.sin(angle) * radius;
        if (!this.world.isChunkLoadedAt(x, z)) continue;
        const height = this.world.getHeightAt(Math.floor(x), Math.floor(z));
        if (height == null) continue;
        const ground = this.world.getBlock(Math.floor(x), height, Math.floor(z));
        const above = this.world.getBlock(Math.floor(x), height + 1, Math.floor(z));
        if (ground === 0 || ground === 11 || ground === 30 || ground === 55 || above !== 0) continue;
        this.spawnMob('nether_pig', x, height + 1.02, z, { home: { x, z } });
      }
    }
    this.pigSeedAt = this.time + 45;
  }

  registerBossDefeat(boss) {
    if (this.bossRespawnAt > this.time) return;
    this.bossRespawnAt = this.time + BOSS_RESPAWN_SECONDS;
    this.onBossDefeat?.(boss);
  }

  trySpawn(player, dimension, day) {
    // Aquatic life is handled separately by ensureAquaticLife() so schools
    // appear near the player instead of at a random distant water column.
    const hostile = !day || dimension !== 'overworld';
    if (hostile && Math.random() < (dimension === 'overworld' ? 0.7 : 0.9)) {
      const pool = hostilePool(dimension);
      if (pool.length === 0) return;
      const mob = pool[Math.floor(Math.random() * pool.length)];
      const point = this.randomSpawnPoint(player, dimension, 20, 38);
      if (!point) return;
      this.spawnMob(mob.key, point.x, point.y, point.z);
      return;
    }

    if (dimension === 'nether') {
      const pool = passivePool('nether');
      if (pool.length === 0) return;
      const mob = pool[Math.floor(Math.random() * pool.length)];
      const point = this.randomSpawnPoint(player, dimension, 18, 34);
      if (!point) return;
      const [minGroup, maxGroup] = mob.group ?? [1, 1];
      const group = minGroup + Math.floor(Math.random() * (maxGroup - minGroup + 1));
      for (let i = 0; i < group; i++) {
        const px = point.x + (Math.random() - 0.5) * 2.5;
        const pz = point.z + (Math.random() - 0.5) * 2.5;
        const height = this.world.getHeightAt(Math.floor(px), Math.floor(pz));
        if (height == null) continue;
        this.spawnMob(mob.key, px, height + 1.02, pz, { home: { x: px, z: pz } });
      }
      return;
    }
    if (dimension !== 'overworld') return;
    const biome = this.world.getBiomeIdAt?.(
      Math.floor(player.position.x),
      Math.floor(player.position.z),
    );
    if (biome == null) return;
    const pool = spawnablePassive(biome);
    if (pool.length === 0) return;
    let total = 0;
    for (const mob of pool) total += mob.spawnWeight ?? 1;
    let roll = Math.random() * total;
    let chosen = pool[0];
    for (const mob of pool) {
      roll -= mob.spawnWeight ?? 1;
      if (roll <= 0) {
        chosen = mob;
        break;
      }
    }
    const point = this.randomSpawnPoint(player, dimension);
    if (!point) return;
    const [minGroup, maxGroup] = chosen.group ?? [1, 1];
    const group = minGroup + Math.floor(Math.random() * (maxGroup - minGroup + 1));
    for (let i = 0; i < group; i++) {
      const px = point.x + (Math.random() - 0.5) * 3;
      const pz = point.z + (Math.random() - 0.5) * 3;
      const height = this.world.getHeightAt(Math.floor(px), Math.floor(pz));
      if (height == null) continue;
      this.spawnMob(chosen.key, px, height + 1.02, pz);
    }
  }

  refreshVillages(player) {
    this.villageCacheTimer -= 1;
    if (this.villageCacheTimer > 0 && this.villageCache.length) return;
    this.villageCacheTimer = 8;
    this.villageCache = nearbyVillages(player.position.x, player.position.z, this.seed);
  }

  trySpawnVillagers(player) {
    if (dimensionAt(player.position.x, player.position.z) !== 'overworld') return;
    this.refreshVillages(player);
    for (const village of this.villageCache) {
      const distance = Math.hypot(village.x - player.position.x, village.z - player.position.z);
      if (distance > 80) continue;
      const nearby = this.entities.filter((entity) => (
        !entity.dead
        && Math.abs(entity.position.x - village.x) < 24
        && Math.abs(entity.position.z - village.z) < 24
      ));
      const villagers = nearby.filter((entity) => entity.kind === 'villager').length;
      const guardians = nearby.filter((entity) => entity.kind === 'guardian').length;

      // Every village gets one iron golem that guards its villagers. After a
      // golem is killed it stays gone for a while so it cannot be farmed.
      const golemKey = `${Math.round(village.x)},${Math.round(village.z)}`;
      const golemOnCooldown = (this.golemCooldowns.get(golemKey) ?? 0) > this.time;
      if (guardians < 1 && !golemOnCooldown) {
        const x = village.x + (Math.random() - 0.5) * 10;
        const z = village.z + (Math.random() - 0.5) * 10;
        if (this.world.isChunkLoadedAt(x, z)) {
          const height = this.world.getHeightAt(Math.floor(x), Math.floor(z));
          const ground = height == null
            ? 0
            : this.world.getBlock(Math.floor(x), height, Math.floor(z));
          if (height != null && ground !== 0 && ground !== 11) {
            this.spawnMob('iron_golem', x, height + 1.02, z, {
              home: { x: village.x, z: village.z },
            });
          }
        }
      }

      if (villagers < 4) {
        const x = village.x + (Math.random() - 0.5) * 10;
        const z = village.z + (Math.random() - 0.5) * 10;
        if (this.world.isChunkLoadedAt(x, z)) {
          const height = this.world.getHeightAt(Math.floor(x), Math.floor(z));
          const ground = height == null
            ? 0
            : this.world.getBlock(Math.floor(x), height, Math.floor(z));
          if (height != null && ground !== 0 && ground !== 11) {
            this.spawnMob('villager', x, height + 1.02, z, {
              home: { x: village.x, z: village.z },
            });
          }
        }
      }

      this.ensureFarmAnimals(village, nearby);
    }
  }

  /** Keeps a small herd of farm animals inside the village paddock. */
  ensureFarmAnimals(village, nearby) {
    const farm = village.farm;
    if (!farm) return;
    const inFarm = (entity) => (
      !entity.dead
      && FARM_ANIMALS.includes(entity.type)
      && entity.position.x >= farm.minX - 2
      && entity.position.x <= farm.maxX + 2
      && entity.position.z >= farm.minZ - 2
      && entity.position.z <= farm.maxZ + 2
    );
    const animals = nearby.filter(inFarm);
    if (animals.length >= FARM_ANIMAL_COUNT) return;

    for (let i = animals.length; i < FARM_ANIMAL_COUNT; i++) {
      const type = FARM_ANIMALS[i % FARM_ANIMALS.length];
      const x = farm.minX + Math.random() * (farm.maxX - farm.minX) + 0.5;
      const z = farm.minZ + Math.random() * (farm.maxZ - farm.minZ) + 0.5;
      if (!this.world.isChunkLoadedAt(x, z)) continue;
      const height = this.world.getHeightAt(Math.floor(x), Math.floor(z));
      if (height == null) continue;
      const ground = this.world.getBlock(Math.floor(x), height, Math.floor(z));
      const above = this.world.getBlock(Math.floor(x), height + 1, Math.floor(z));
      if (ground === 0 || ground === 11 || above !== 0) continue;
      this.spawnMob(type, x, height + 1.02, z, {
        home: { x: farm.x, z: farm.z },
      });
    }
  }

  /** Ray/box test used by the player's left click. Returns the closest entity. */
  pick(origin, direction, maxDistance) {
    let best = null;
    let bestDistance = maxDistance;
    for (const entity of this.entities) {
      if (entity.dead) continue;
      const half = entity.width / 2 + 0.12;
      const boxMin = new THREE.Vector3(
        entity.position.x - half,
        entity.position.y - 0.05,
        entity.position.z - half,
      );
      const boxMax = new THREE.Vector3(
        entity.position.x + half,
        entity.position.y + entity.height + 0.05,
        entity.position.z + half,
      );
      const hit = rayBox(origin, direction, boxMin, boxMax, bestDistance);
      if (hit != null && hit < bestDistance) {
        best = entity;
        bestDistance = hit;
      }
    }
    return best ? { entity: best, distance: bestDistance } : null;
  }

  attack(entity, damage, player, tool = null) {
    if (!entity || entity.dead) return false;
    const wasVillager = entity.kind === 'villager';
    let applied = damage;
    // Iron golems shrug off most weapons but their iron body is weak to
    // pickaxes, which lets the player actually fight one.
    if (entity.type === 'iron_golem') {
      applied = tool?.type === 'pickaxe'
        ? 5 + (tool.tier ?? 1) * 3
        : damage * 0.35;
      if (player?.creative) applied = Math.max(applied, 10);
    }
    // The boss' burning hide turns most blows aside; swords bite deep.
    if (entity.kind === 'boss') {
      applied = tool?.type === 'sword' ? damage * 1.6 : damage * 0.55;
      if (player?.creative) applied = Math.max(applied, 12);
    }
    const died = entity.hit(applied, player);
    if (wasVillager && player) this.provokeGolems(entity.position);
    if (died) {
      if (entity.kind === 'boss') this.registerBossDefeat(entity);
      if (entity.kind === 'guardian' && entity.home) {
        const key = `${Math.round(entity.home.x)},${Math.round(entity.home.z)}`;
        this.golemCooldowns.set(key, this.time + 45);
      }
      this.dropLoot(entity);
      const index = this.entities.indexOf(entity);
      if (index >= 0) this.removeAt(index);
    }
    return died;
  }

  /** Angers every golem close enough to have seen (or heard) the attack. */
  provokeGolems(from) {
    for (const entity of this.entities) {
      if (entity.dead || entity.kind !== 'guardian') continue;
      const distance = Math.hypot(
        entity.position.x - from.x,
        entity.position.z - from.z,
      );
      if (distance > 40) continue;
      entity.provoked = Math.max(entity.provoked, 30);
      entity.target = null;
    }
  }

  findAllNear(x, z, radius = 6) {
    return this.entities.filter((entity) => (
      !entity.dead && Math.hypot(entity.position.x - x, entity.position.z - z) <= radius
    ));
  }

  serialize() {
    return this.entities.filter((entity) => !entity.dead).map((entity) => entity.serialize());
  }

  load(list, playerPosition = { x: 0, z: 0 }, player = this.player ?? null) {
    this.clear();
    if (!Array.isArray(list)) return;
    for (const data of list) {
      const mob = MOBS[data?.type];
      if (!mob) continue;
      if (!Number.isFinite(Number(data.x)) || !Number.isFinite(Number(data.y))) continue;
      const distance = Math.hypot(Number(data.x) - playerPosition.x, Number(data.z) - playerPosition.z);
      if (distance > 110) continue;
      const baby = Boolean(data.baby);
      this.spawnMob(mob.key, Number(data.x), Number(data.y), Number(data.z), {
        yaw: finite(data.yaw, 0),
        health: finite(data.health, mob.health),
        tamed: Boolean(data.tamed),
        saddled: Boolean(data.saddled),
        armored: Boolean(data.armored),
        sheared: Boolean(data.sheared),
        baby,
        growTimer: finite(data.growTimer, baby ? ANIMAL_TIMING.growthSeconds : 0),
        breedingCooldown: finite(data.breedingCooldown, 0),
        loveTimer: finite(data.loveTimer, 0),
        // A saved chicken needs its lay timer back, otherwise it lays instantly.
        eggTimer: finite(data.eggTimer, ANIMAL_TIMING.eggSeconds),
        woolTimer: finite(data.woolTimer, 0),
        sitting: Boolean(data.sitting),
        bed: data.bed,
        sleeping: Boolean(data.sleeping),
        // Owner is runtime-only; the current player adopts saved pets.
        owner: data.tamed ? player : null,
        home: data.home,
      });
    }
    for (const entity of this.entities) {
      if (entity.kind !== 'villager' || !entity.bed) continue;
      const key = `${entity.bed.x},${entity.bed.y},${entity.bed.z}`;
      if (!this.bedClaims.has(key)) this.bedClaims.set(key, entity.id);
      else this.releaseBed(entity);
    }
  }

  clear() {
    for (const entity of this.entities) {
      this.releaseBed(entity);
      entity.dispose();
    }
    this.entities.length = 0;
    this.bedClaims.clear();
    this.openDoors.clear();
    // A fresh visit should always find pigs waiting on the plaza.
    this.pigSeedAt = 0;
  }

  dispose() {
    this.clear();
    this.villageCache.length = 0;
    this.golemCooldowns.clear();
  }
}

/** Slab ray/AABB intersection; returns the entry distance or null. */
function rayBox(origin, direction, min, max, maxDistance) {
  let tmin = 0;
  let tmax = maxDistance;
  const axes = ['x', 'y', 'z'];
  for (const axis of axes) {
    const o = origin[axis];
    const d = direction[axis];
    const lo = min[axis];
    const hi = max[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
