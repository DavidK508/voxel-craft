import * as THREE from 'three';
import { Entity } from './Entity.js';
import {
  MOBS,
  hostilePool,
  passivePool,
  rollDrops,
  spawnablePassive,
} from './mobs.js';
import { dimensionAt, nearbyVillages, END_ORIGIN, NETHER_ORIGIN } from '../world/generator.js';
import { SEA_LEVEL, WORLD_HEIGHT } from '../shared/constants.js';
import { getSpawnEggId } from '../shared/items.js';
import { waterSurfaceAt } from '../shared/water.js';

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

export class EntityManager {
  constructor({ scene, world, drops, seed, audio = null }) {
    this.scene = scene;
    this.world = world;
    this.drops = drops;
    this.audio = audio;
    this.seed = seed >>> 0;
    this.entities = [];
    this.time = 0;
    this.spawnTimer = 1.2;
    this.aquaticTimer = 1;
    this.villageTimer = 0;
    this.villageCache = [];
    this.villageCacheTimer = 0;
    this.golemCooldowns = new Map();
    this.bossRespawnAt = 0;
    this.pigSeedAt = 0;
    this.onAttack = null;
    this.onBossSpawn = null;
    this.onBossDefeat = null;
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

    this.villageTimer -= dt;
    if (this.villageTimer <= 0) {
      this.villageTimer = 2.5;
      this.trySpawnVillagers(player);
    }
  }

  dropLoot(entity) {
    if (!this.drops) return;
    const x = entity.position.x;
    const y = entity.position.y + entity.height * 0.5;
    const z = entity.position.z;
    for (const stack of rollDrops(entity.mob)) {
      this.drops.spawn(stack.id, stack.count, x, y, z);
    }
    // Every creature yields the egg that can summon it again.
    const eggId = getSpawnEggId(entity.type);
    if (eggId !== null) this.drops.spawn(eggId, 1, x, y, z);
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
    entity.dispose();
    this.entities.splice(index, 1);
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

  load(list, playerPosition = { x: 0, z: 0 }) {
    this.clear();
    if (!Array.isArray(list)) return;
    for (const data of list) {
      const mob = MOBS[data?.type];
      if (!mob) continue;
      if (!Number.isFinite(Number(data.x)) || !Number.isFinite(Number(data.y))) continue;
      const distance = Math.hypot(Number(data.x) - playerPosition.x, Number(data.z) - playerPosition.z);
      if (distance > 110) continue;
      this.spawnMob(mob.key, Number(data.x), Number(data.y), Number(data.z), {
        yaw: Number(data.yaw) || 0,
        health: Number(data.health) || mob.health,
        tamed: Boolean(data.tamed),
        saddled: Boolean(data.saddled),
        armored: Boolean(data.armored),
        sheared: Boolean(data.sheared),
        home: data.home,
      });
    }
  }

  clear() {
    for (const entity of this.entities) entity.dispose();
    this.entities.length = 0;
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
