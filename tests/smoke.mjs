import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  CHUNK_SIZE,
  PAD_X,
  PAD_Y,
  PAD_Z,
  SEA_LEVEL,
  WORLD_HEIGHT,
} from '../src/shared/constants.js';
import { BLOCK_DEFS, getBlock, isSolid } from '../src/shared/blocks.js';
import { getItem, getMaxStack, createItemStack, getArmorInfo } from '../src/shared/items.js';
import { findRecipe } from '../src/shared/recipes.js';
import { SimplexNoise, NoiseField, mulberry32 } from '../src/shared/noise.js';
import { Inventory } from '../src/game/Inventory.js';
import {
  advanceTimeOfDay,
  cycleDurations,
  DAY_TICKS,
  TICKS_PER_DAY,
  isDaytime,
  normalizeDayMinutes,
} from '../src/game/dayCycle.js';
import {
  GAME_MODE_CREATIVE,
  GAME_MODE_SURVIVAL,
  normalizeGameMode,
} from '../src/shared/gameModes.js';
import { Player } from '../src/player/Player.js';
import {
  generateChunk,
  findSpawn,
  nearbyVillages,
  BIOME_INFO,
} from '../src/world/generator.js';
import { buildPaddedVolume, meshChunk } from '../src/world/mesher.js';
import { MOBS } from '../src/entities/mobs.js';
import { Entity } from '../src/entities/Entity.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { FluidSimulation } from '../src/world/Fluids.js';

const results = [];
let failed = 0;

const require = createRequire(import.meta.url);

function waitFor(predicate, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeout) {
        reject(new Error('timed out waiting for a LAN message'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    failed++;
    results.push({ name, ok: false, error });
    console.error(`FAIL ${name}`);
    console.error(`     ${error?.stack ?? error}`);
  }
}

const localIndex = (x, y, z) => x + (z << 4) + (y << 8);
const padIndex = (x, y, z) => (y + 1) * PAD_X * PAD_Z + (z + 1) * PAD_X + (x + 1);

function hashBlocks(blocks) {
  let hash = 2166136261;
  for (let i = 0; i < blocks.length; i += 97) {
    hash ^= blocks[i];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeFlatWorld(ground = 5) {
  return {
    getBlock(x, y, z) {
      if (y < 0) return 13;
      if (y <= ground) return 1;
      return 0;
    },
    isSolidAt(x, y, z) {
      return y < 0 || y <= ground;
    },
    isChunkLoadedAt() {
      return true;
    },
  };
}

function makeSetWorld(solids) {
  return {
    getBlock(x, y, z) {
      return solids.has(`${x},${y},${z}`) ? 1 : 0;
    },
    isSolidAt(x, y, z) {
      return solids.has(`${x},${y},${z}`);
    },
    isChunkLoadedAt() {
      return true;
    },
  };
}

const noInput = { isDown: () => false, isMouseDown: () => false };

await test('block registry is complete and immutable', () => {
  assert.equal(BLOCK_DEFS.length, 69);
  assert.equal(getBlock(0).key, 'air');
  assert.equal(getBlock(1).key, 'stone');
  assert.equal(getBlock(999).key, 'air');
  assert.equal(isSolid(0), false);
  assert.equal(isSolid(1), true);
  assert.equal(isSolid(11), false);
  assert.equal(getBlock(63).key, 'torch');
  assert.equal(getBlock(63).solid, false);
  assert.equal(getBlock(63).light, 14);
  assert.equal(getBlock(22).light, 12);
  assert.equal(getBlock(29).light, 15);
  assert.equal(getBlock(64).key, 'wheat_crop');
  assert.equal(getBlock(64).solid, false);
  assert.equal(getBlock(65).key, 'carrot_crop');
  assert.equal(getBlock(66).key, 'potato_crop');
  assert.equal(getBlock(67).key, 'beetroot_crop');
  assert.equal(getBlock(68).key, 'oak_fence');
  assert.equal(getBlock(68).solid, true);
  assert.equal(getBlock(69).key, 'bed');
  assert.equal(getBlock(69).interactive, 'bed');
  for (const block of BLOCK_DEFS) {
    assert.ok(block.id > 0 && block.id < 256, `invalid id ${block.id}`);
    assert.equal(block.tiles.length, 6);
    assert.ok(block.name.length > 0);
  }
});

await test('item registry exposes blocks, tools and food', () => {
  assert.equal(getItem(1).placeBlock, 1);
  assert.equal(getItem(300).tool.type, 'pickaxe');
  assert.equal(getItem(300).tool.tier, 1);
  assert.equal(getItem(406).food.nutrition, 4);
  assert.equal(getItem(445).food.nutrition, 3);
  assert.equal(getItem(446).food.nutrition, 1);
  assert.equal(getItem(447).food.nutrition, 1);
  assert.equal(getMaxStack(300), 1);
  assert.equal(getMaxStack(5), 64);
  const stack = createItemStack(300);
  assert.equal(stack.durability, 60);
  assert.equal(createItemStack(9999), null);

  const helmet = getArmorInfo(504);
  assert.equal(helmet.slot, 'head');
  assert.equal(helmet.defense, 2);
  assert.equal(createItemStack(504).durability, helmet.durability);
  assert.equal(getItem(69).placeBlock, 69);
});

await test('noise is deterministic and bounded', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 32; i++) assert.equal(a(), b());
  const noise = new SimplexNoise(777);
  for (let i = 0; i < 200; i++) {
    const value = noise.noise2(i * 0.13, i * -0.07);
    assert.ok(Number.isFinite(value));
    assert.ok(value >= -1.0001 && value <= 1.0001);
  }
  const fieldA = new NoiseField(999);
  const fieldB = new NoiseField(999);
  assert.equal(
    fieldA.terrain.fbm2(12.3, 45.6, 4, 2, 0.5),
    fieldB.terrain.fbm2(12.3, 45.6, 4, 2, 0.5),
  );
});

await test('chunk generation produces valid terrain arrays', () => {
  const seed = 0x1234abcd;
  const chunk = generateChunk(0, 0, seed);
  assert.ok(chunk.blocks instanceof Uint8Array);
  assert.ok(chunk.heights instanceof Uint8Array);
  assert.ok(chunk.biomes instanceof Uint8Array);
  assert.equal(chunk.blocks.length, CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  assert.equal(chunk.heights.length, CHUNK_SIZE * CHUNK_SIZE);
  assert.equal(chunk.biomes.length, CHUNK_SIZE * CHUNK_SIZE);

  for (let i = 0; i < chunk.biomes.length; i++) {
    assert.ok(BIOME_INFO[chunk.biomes[i]], `unknown biome ${chunk.biomes[i]}`);
  }

  assert.equal(chunk.blocks[localIndex(0, 0, 0)], 13);
  const height = chunk.heights[0];
  assert.ok(height > 0 && height < WORLD_HEIGHT - 10);
  assert.ok(isSolid(chunk.blocks[localIndex(0, height, 0)]));
  assert.equal(chunk.blocks[localIndex(0, WORLD_HEIGHT - 1, 0)], 0);

  const again = generateChunk(0, 0, seed);
  assert.equal(hashBlocks(chunk.blocks), hashBlocks(again.blocks));

  const other = generateChunk(0, 0, seed + 1);
  assert.notEqual(hashBlocks(chunk.blocks), hashBlocks(other.blocks));
});

await test('spawn search returns a safe land position', () => {
  const seed = 424242;
  const spawn = findSpawn(seed);
  assert.ok(Number.isFinite(spawn.x));
  assert.ok(Number.isFinite(spawn.y));
  assert.ok(Number.isFinite(spawn.z));
  assert.ok(spawn.y > SEA_LEVEL + 1);
  assert.ok(BIOME_INFO[spawn.biome]);
  const again = findSpawn(seed);
  assert.deepEqual(again, spawn);
});

await test('fresh games spawn inside a village with crops and a livestock farm', () => {
  for (const seed of [424242, 7]) {
    const spawn = findSpawn(seed);
    assert.ok(spawn.village, 'spawn should point at a village');
    const villages = nearbyVillages(spawn.x, spawn.z, seed);
    assert.ok(villages.length > 0, 'spawn must be near a village');
    const nearest = villages.reduce((best, village) => {
      const distance = Math.hypot(village.x - (spawn.x - 0.5), village.z - (spawn.z - 4.5));
      return !best || distance < best.distance ? { village, distance } : best;
    }, null);
    assert.ok(nearest.distance < 1, `spawn is ${nearest.distance} blocks from the village centre`);
    assert.ok(nearest.village.farm, 'village should describe its livestock farm');
  }

  const seed = 424242;
  const spawn = findSpawn(seed);
  const village = nearbyVillages(spawn.x, spawn.z, seed)
    .reduce((best, candidate) => {
      const distance = Math.hypot(candidate.x - spawn.x, candidate.z - spawn.z);
      return !best || distance < best.distance ? { village: candidate, distance } : best;
    }, null).village;

  const counts = new Map();
  const minX = village.x - 27;
  const maxX = village.x + 27;
  const minZ = village.z - 27;
  const maxZ = village.z + 27;
  for (let cz = Math.floor(minZ / CHUNK_SIZE); cz <= Math.floor(maxZ / CHUNK_SIZE); cz++) {
    for (let cx = Math.floor(minX / CHUNK_SIZE); cx <= Math.floor(maxX / CHUNK_SIZE); cx++) {
      const chunk = generateChunk(cx, cz, seed);
      for (let i = 0; i < chunk.blocks.length; i++) {
        const id = chunk.blocks[i];
        if (id >= 60) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  for (const crop of [64, 65, 66, 67]) {
    assert.ok((counts.get(crop) ?? 0) > 5, `village garden should contain crop ${crop}`);
  }
  assert.ok((counts.get(68) ?? 0) > 30, 'village farm should be fenced');
  assert.ok((counts.get(60) ?? 0) > 0, 'village farm should store hay');
});

await test('padded volume copies center and all eight neighbours', () => {
  const center = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  const east = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  const north = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  const corner = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);

  center[localIndex(15, 100, 3)] = 5;
  center[localIndex(0, 101, 4)] = 6;
  east[localIndex(0, 100, 3)] = 7;
  north[localIndex(3, 100, 15)] = 8;
  corner[localIndex(0, 100, 15)] = 9;

  const padded = buildPaddedVolume(center, (dx, dz) => {
    if (dx === 1 && dz === 0) return east;
    if (dx === 0 && dz === -1) return north;
    if (dx === 1 && dz === -1) return corner;
    return null;
  });

  assert.equal(padded.length, PAD_X * PAD_Y * PAD_Z);
  assert.equal(padded[padIndex(15, 100, 3)], 5);
  assert.equal(padded[padIndex(0, 101, 4)], 6);
  assert.equal(padded[padIndex(16, 100, 3)], 7);
  assert.equal(padded[padIndex(3, 100, -1)], 8);
  assert.equal(padded[padIndex(16, 100, -1)], 9);
  assert.equal(padded[padIndex(-1, 100, 3)], 0);
});

await test('greedy mesher builds valid solid geometry', () => {
  const seed = 0x77aa55;
  const chunks = new Map();
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      chunks.set(`${dx},${dz}`, generateChunk(dx, dz, seed));
    }
  }
  const center = chunks.get('0,0');
  // Plant a block near the top of the world: the mesher must reach it even
  // though it sits far above the terrain (terrain is capped at WORLD_HEIGHT-18
  // and trees cannot reach this high).
  const probeY = 250;
  center.blocks[5 + (5 << 4) + (probeY << 8)] = 1;
  const padded = buildPaddedVolume(center.blocks, (dx, dz) => chunks.get(`${dx},${dz}`)?.blocks ?? null);
  const result = meshChunk(padded, 0, 0);
  assert.ok(result.solid, 'center chunk should produce solid geometry');
  const solid = result.solid;
  assert.ok(solid.positions.length > 0);
  assert.equal(solid.positions.length % 3, 0);
  assert.equal(solid.normals.length, solid.positions.length);
  assert.equal(solid.uvs.length / 2, solid.positions.length / 3);
  assert.equal(solid.tiles.length, solid.positions.length / 3);
  assert.equal(solid.aos.length, solid.positions.length / 3);
  assert.equal(solid.indices.length % 3, 0);
  assert.ok(solid.indices.length / 3 > 100, 'expected a non-trivial mesh');

  // Regression: Y is WORLD_HEIGHT tall while X/Z only span one chunk, so the
  // mesher used to walk a 16^3 cube and silently drop everything above y=16.
  let meshTop = -Infinity;
  for (let i = 1; i < solid.positions.length; i += 3) {
    if (solid.positions[i] > meshTop) meshTop = solid.positions[i];
  }
  assert.ok(
    meshTop >= probeY + 1,
    `mesh should reach y=${probeY + 1}, got ${meshTop}`,
  );
  for (let i = 0; i < solid.aos.length; i++) {
    // AO is packed into a Uint8 attribute (0..255) and normalized by the GPU.
    assert.ok(solid.aos[i] >= 0 && solid.aos[i] <= 255);
  }
});

await test('skylight puts the floor under a roof in shadow', () => {
  // Floor across the whole chunk at y=10 plus a 5x5 roof at y=14. The floor
  // below the roof must lose its skylight; the floor outside must keep it.
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      blocks[localIndex(x, 10, z)] = 1;
      if (x <= 4 && z <= 4) blocks[localIndex(x, 14, z)] = 1;
    }
  }
  const padded = buildPaddedVolume(blocks, () => null);
  const solid = meshChunk(padded, 0, 0).solid;
  assert.ok(solid, 'the scene should mesh');
  assert.equal(solid.skies.length, solid.positions.length / 3);

  let shadowed = 0;
  let openSky = 0;
  for (let i = 0; i < solid.vertexCount; i++) {
    const x = solid.positions[i * 3];
    const y = solid.positions[i * 3 + 1];
    const z = solid.positions[i * 3 + 2];
    if (y !== 11) continue; // top faces of the floor
    if (solid.skies[i] === 0) shadowed++;
    // Cells from x/z=6 on are outside every quad that touches the roof's
    // shadow, so anything there must be fully open sky.
    if (x >= 6 && z >= 6) {
      assert.equal(solid.skies[i], 255, `open floor at (${x},${z}) must stay lit`);
      openSky++;
    }
  }
  assert.ok(shadowed > 0, 'expected at least one fully shadowed floor vertex');
  assert.ok(openSky > 0, 'expected at least one lit open-floor vertex');
});

await test('emissive blocks bake block light into the mesh', () => {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      blocks[localIndex(x, 10, z)] = 1;
    }
  }
  // Glowstone (light 15) in the middle of the floor.
  blocks[localIndex(8, 11, 8)] = 29;
  const glow = meshChunk(buildPaddedVolume(blocks, () => null), 0, 0).solid;
  assert.ok(glow, 'glowstone scene should mesh');
  assert.equal(glow.lights.length, glow.positions.length / 3);
  let brightest = 0;
  for (let i = 0; i < glow.lights.length; i++) brightest = Math.max(brightest, glow.lights[i]);
  assert.equal(brightest, 255, 'a glowstone face must reach full block light');

  // A torch is both a light source and its own slim piece of geometry.
  blocks[localIndex(8, 11, 8)] = 0;
  blocks[localIndex(4, 11, 4)] = 63;
  const torch = meshChunk(buildPaddedVolume(blocks, () => null), 0, 0).solid;
  let top = -Infinity;
  let torchBrightest = 0;
  for (let i = 0; i < torch.vertexCount; i++) {
    top = Math.max(top, torch.positions[i * 3 + 1]);
    torchBrightest = Math.max(torchBrightest, torch.lights[i]);
  }
  assert.ok(top > 11.5 && top < 11.7, `torch should be a short post, got top ${top}`);
  assert.equal(torchBrightest, 238, 'torch light should bake as level 14');
});

await test('iron golems guard villagers', () => {
  const golemMob = MOBS.iron_golem;
  assert.equal(golemMob.kind, 'guardian');
  assert.ok(golemMob.health <= 60);
  assert.ok(golemMob.damage > 0);
  assert.equal(golemMob.village, true);

  const world = makeFlatWorld(5);
  const player = { position: { x: 0, y: 6, z: 0 }, creative: false, dead: false };
  const golem = new Entity(golemMob, { x: 0.5, y: 6.02, z: 0.5 }, {
    home: { x: 0, z: 0 },
  });
  let damageTaken = 0;
  const zombie = {
    hostile: true,
    dead: false,
    position: { x: 1.6, y: 6, z: 0.5 },
    hit(amount) { damageTaken += amount; },
  };
  const manager = { entities: [golem, zombie], onAttack: null };
  golem.update(1 / 60, world, player, manager);
  assert.equal(golem.target, zombie, 'golem should lock onto the nearby zombie');
  assert.equal(damageTaken, golemMob.damage, 'golem should hit the zombie in range');
});

await test('golems enrage at villager killers and can be mined', () => {
  const scene = { add() {} };
  const manager = new EntityManager({ scene, world: makeFlatWorld(5), drops: null, seed: 7 });
  const home = { x: 0, z: 0 };
  const villager = manager.spawnMob('villager', 2, 6, 0, { home });
  const golem = manager.spawnMob('iron_golem', 0.5, 6, 0.5, { home });
  const player = {
    position: { x: 1, y: 6, z: 0 },
    creative: false,
    dead: false,
    health: 20,
    damage(amount) {
      this.health -= amount;
      this.hitCount = (this.hitCount ?? 0) + 1;
    },
  };

  manager.attack(villager, 999, player);
  assert.equal(villager.dead, true);
  assert.ok(golem.provoked > 0, 'killing a villager must anger the golem');

  golem.position.set(1.5, 6, 0.5);
  golem.update(1 / 60, makeFlatWorld(5), player, manager);
  assert.ok(player.hitCount > 0, 'an angry golem must attack the player');

  // A pickaxe is the right tool for an iron golem; other tools barely work.
  const beforePickaxe = golem.health;
  manager.attack(golem, 1, player, { type: 'pickaxe', tier: 3 });
  assert.equal(beforePickaxe - golem.health, 14);
  const beforeAxe = golem.health;
  manager.attack(golem, 4, player, { type: 'axe', tier: 3 });
  assert.ok(beforeAxe - golem.health < 2, 'an axe should not be effective');

  const dropIds = golem.mob.drops.map((drop) => drop.id);
  for (const id of [403, 31, 440, 405]) {
    assert.ok(dropIds.includes(id), `golem should drop item ${id}`);
  }
});

await test('monsters hunt animals and villagers, golems defend them', () => {
  const world = makeFlatWorld(5);
  const player = {
    position: { x: 60, y: 6, z: 60 },
    creative: false,
    dead: false,
    damage() {},
  };
  const cow = new Entity(MOBS.cow, { x: 1.5, y: 6, z: 0.5 });
  const villager = new Entity(MOBS.villager, { x: 4.5, y: 6, z: 0.5 }, { home: { x: 4, z: 0 } });
  const zombieCow = new Entity(MOBS.zombie, { x: 0.5, y: 6, z: 0.5 });
  const zombieVillager = new Entity(MOBS.zombie, { x: 5.5, y: 6, z: 0.5 });
  const manager = { entities: [cow, villager, zombieCow, zombieVillager], onAttack: null };

  zombieCow.update(1 / 60, world, player, manager);
  zombieVillager.update(1 / 60, world, player, manager);
  assert.equal(zombieCow.huntTarget, cow, 'zombie should hunt the nearest animal');
  assert.equal(zombieVillager.huntTarget, villager, 'zombie should hunt the nearest villager');
  assert.ok(cow.health < cow.maxHealth, 'zombie should damage the animal');
  assert.ok(villager.health < villager.maxHealth, 'zombie should damage the villager');

  // A golem standing next to the monsters must hit them.
  const golem = new Entity(MOBS.iron_golem, { x: 2.0, y: 6, z: 0.5 }, { home: { x: 0, z: 0 } });
  manager.entities.push(golem);
  const zombieHealth = zombieCow.health;
  golem.update(1 / 60, world, player, manager);
  assert.ok(zombieCow.health < zombieHealth, 'golem should protect the animals');
});

await test('crafting recipes match shaped and shapeless grids', () => {
  const planks = findRecipe([6, null, null, null], 2);
  assert.equal(planks?.id, 'planks');
  assert.equal(planks.result.id, 5);
  assert.equal(planks.result.count, 4);

  const sticks = findRecipe([5, null, 5, null], 2);
  assert.equal(sticks?.id, 'sticks');

  const torch = findRecipe([401, 400, null, null], 2);
  assert.equal(torch?.id, 'torch');
  assert.equal(torch.result.id, 63);
  assert.equal(torch.result.count, 4);

  const table = findRecipe([5, 5, 5, 5], 2);
  assert.equal(table?.id, 'crafting_table');

  const pickaxe = findRecipe(
    [5, 5, 5, null, 400, null, null, 400, null],
    3,
  );
  assert.equal(pickaxe?.id, 'wooden_pickaxe');
  assert.equal(pickaxe.result.id, 300);
  assert.equal(pickaxe.result.id, 300);

  const bed = findRecipe([42, 42, 42, 5, 5, 5, null, null, null], 3);
  assert.equal(bed?.id, 'bed');
  assert.equal(bed.result.id, 69);

  const helmet = findRecipe([403, 403, 403, 403, null, 403, null, null, null], 3);
  assert.equal(helmet?.id, 'iron_helmet');
  assert.equal(helmet.result.id, 504);

  const chestplate = findRecipe([405, null, 405, 405, 405, 405, 405, 405, 405], 3);
  assert.equal(chestplate?.id, 'diamond_chestplate');
  assert.equal(chestplate.result.id, 509);

  assert.equal(findRecipe(new Array(9).fill(null), 3), null);
  assert.equal(findRecipe([1, null, null, null], 2), null);
});

await test('inventory stacks, splits, serializes and restores', () => {
  const inventory = new Inventory();
  assert.equal(inventory.add(5, 70), 0);
  assert.equal(inventory.countItem(5), 70);
  assert.equal(inventory.slots[0].count, 64);
  assert.equal(inventory.slots[1].count, 6);

  const remainder = inventory.addStack({ id: 5, count: 70 });
  assert.equal(remainder, null);
  assert.equal(inventory.countItem(5), 140);

  const kit = new Inventory();
  kit.add(300, 1);
  kit.add(301, 1);
  kit.add(302, 1);
  kit.add(303, 1);
  kit.add(406, 5);
  kit.add(5, 16);
  kit.add(21, 1);
  assert.equal(kit.countItem(300), 1);
  assert.equal(kit.countItem(406), 5);

  kit.setSelected(4);
  const restored = Inventory.fromSerialized(kit.serialize());
  assert.equal(restored.selected, 4);
  assert.equal(restored.countItem(406), 5);
  assert.deepEqual(restored.slots, kit.slots);

  const taken = kit.removeFromSlot(4, 2);
  assert.equal(taken.count, 2);
  assert.equal(kit.countItem(406), 3);
  assert.equal(kit.damageSelected(1), false);
});

await test('inventory equips and persists armor', () => {
  const inventory = new Inventory();
  inventory.setArmorSlot(0, createItemStack(504));
  inventory.setArmorSlot(1, createItemStack(505));
  inventory.setArmorSlot(2, createItemStack(506));
  inventory.setArmorSlot(3, createItemStack(507));
  assert.equal(inventory.armorPoints(), 2 + 6 + 5 + 2);

  const restored = Inventory.fromSerialized(inventory.serialize());
  assert.equal(restored.armorPoints(), inventory.armorPoints());
  assert.equal(restored.armor[0].id, 504);

  assert.equal(restored.damageArmor(1), true);
  assert.equal(restored.armor[0].durability, getArmorInfo(504).durability - 1);

  // Ten thousand hits break every piece, so the slots end up empty.
  for (let i = 0; i < 10000; i++) restored.damageArmor(10);
  assert.ok(restored.armor.every((stack) => stack === null));
  assert.equal(restored.armorPoints(), 0);
});

await test('fluids flow downwards and spread sideways', () => {
  const blocks = new Map();
  const world = {
    getBlock(x, y, z) {
      return blocks.get(`${x},${y},${z}`) ?? 0;
    },
    setBlock(x, y, z, id) {
      const key = `${x},${y},${z}`;
      if ((blocks.get(key) ?? 0) === id) return false;
      if (id === 0) blocks.delete(key);
      else blocks.set(key, id);
      return true;
    },
  };
  const fluids = new FluidSimulation(world);
  world.setBlock(0, 5, 0, 11);
  fluids.setSource(0, 5, 0, 11);
  fluids.step();
  assert.equal(world.getBlock(0, 4, 0), 11, 'water should fall straight down');
  fluids.step();
  fluids.step();
  assert.equal(world.getBlock(0, 3, 0), 11, 'the falling column should keep going');
  assert.ok(
    [[1, 4, 0], [-1, 4, 0], [0, 4, 1], [0, 4, -1]].some(([x, y, z]) => world.getBlock(x, y, z) === 11),
    'water should spread sideways from the bottom of the column',
  );

  // Removing the source dries the column and the spill.
  fluids.remove(0, 5, 0);
  world.setBlock(0, 5, 0, 0);
  fluids.wake(0, 5, 0);
  for (let i = 0; i < 20; i++) fluids.step();
  assert.equal(world.getBlock(0, 4, 0), 0, 'unsupported water must dry up');
});

await test('player lands on the ground and cannot fall through', () => {
  const world = makeFlatWorld(5);
  const player = new Player({ x: 0.5, y: 10, z: 0.5 });
  for (let i = 0; i < 240; i++) player.update(1 / 60, noInput, world);
  assert.ok(Math.abs(player.position.y - 6.0) < 0.02, `landed at ${player.position.y}`);
  assert.equal(player.onGround, true);
  assert.ok(Math.abs(player.velocity.y) < 0.001);
  assert.equal(player.health, 20);
});

await test('player jumps and collides with walls', () => {
  const world = makeFlatWorld(5);
  const player = new Player({ x: 0.5, y: 6.001, z: 0.5 });
  const jumpInput = {
    isDown: (code) => code === 'Space',
    isMouseDown: () => false,
  };
  // The player starts airborne: let it settle on the ground before jumping.
  for (let i = 0; i < 5; i++) player.update(1 / 60, noInput, world);
  assert.equal(player.onGround, true, 'player should land before jumping');

  player.update(1 / 60, jumpInput, world);
  assert.ok(player.velocity.y > 0, 'jump should set upward velocity');
  const startY = player.position.y;
  // Sample the whole arc: with GRAVITY=32 the jump peaks around frame 16 and
  // the player is already descending by frame 30, so only the peak proves the rise.
  let peakY = startY;
  for (let i = 0; i < 30; i++) {
    player.update(1 / 60, noInput, world);
    if (player.position.y > peakY) peakY = player.position.y;
  }
  assert.ok(peakY > startY + 0.5, 'player should rise');

  const wallWorld = makeSetWorld(new Set(['1,6,0', '1,7,0']));
  player.position.set(0.5, 6.001, 0.5);
  player.velocity.set(0, 0, 0);
  const blocked = player.moveAxis(wallWorld, 0, 1);
  assert.equal(blocked, true);
  assert.ok(player.position.x < 0.71, `stopped at x=${player.position.x}`);
});

await test('player raycast finds a block and reports its normal', () => {
  const world = makeSetWorld(new Set(['0,7,-2']));
  const player = new Player({ x: 0.5, y: 6.001, z: 0.5 });
  player.yaw = 0;
  player.pitch = 0;
  const hit = player.raycast(world, 8);
  assert.ok(hit, 'raycast should hit the wall');
  assert.equal(hit.x, 0);
  assert.equal(hit.y, 7);
  assert.equal(hit.z, -2);
  assert.deepEqual(hit.normal, { x: 0, y: 0, z: 1 });
});

await test('tool tiers gate harvesting and break time', () => {
  const player = new Player();
  const stone = getBlock(1);
  assert.equal(player.canHarvest(stone, 0), false);
  assert.equal(player.canHarvest(stone, 300), true);
  assert.equal(player.canHarvest(stone, 301), false); // wooden axe cannot mine stone
  assert.equal(player.canHarvest(stone, 304), true); // stone pickaxe can
  const handTime = player.getBreakTime(stone, 0);
  const woodenTime = player.getBreakTime(stone, 300);
  const stoneTime = player.getBreakTime(stone, 304);
  assert.ok(handTime > woodenTime);
  assert.ok(woodenTime > stoneTime);
  assert.equal(player.getBreakTime(getBlock(13), 303), Infinity);
  assert.equal(player.canHarvest(getBlock(13), 303), false);
});

await test('player vitals consume food and serialize', () => {
  const player = new Player({ x: 4.5, y: 20, z: -3.5 });
  player.hunger = 10;
  player.health = 12;
  player.eat(4, 2.4, 2);
  assert.equal(player.hunger, 14);
  assert.equal(player.health, 14);
  player.damage(5, 'тест');
  assert.equal(player.health, 9);
  const data = player.serialize();
  const restored = new Player();
  restored.deserialize(data);
  assert.equal(restored.position.x, 4.5);
  assert.equal(restored.position.z, -3.5);
  assert.equal(restored.health, 9);
});

await test('game mode selection normalizes unknown values to survival', () => {
  assert.equal(normalizeGameMode('creative'), GAME_MODE_CREATIVE);
  assert.equal(normalizeGameMode('survival'), GAME_MODE_SURVIVAL);
  assert.equal(normalizeGameMode(undefined), GAME_MODE_SURVIVAL);
  assert.equal(normalizeGameMode('nonsense'), GAME_MODE_SURVIVAL);
  assert.equal(normalizeGameMode(null), GAME_MODE_SURVIVAL);
});

await test('survival starts empty while creative starts with blocks', () => {
  assert.ok(new Inventory().isEmpty(), 'a fresh survival inventory starts empty');

  const creative = Inventory.createCreative();
  assert.equal(creative.isEmpty(), false);
  assert.equal(creative.countItem(2), 64);
  assert.equal(creative.countItem(3), 64);
  assert.ok(
    creative.slots.slice(0, 9).every((slot) => slot?.count === 64),
    'creative hotbar should hold nine full stacks',
  );
});

await test('one slider keeps day and night lengths in sync', () => {
  assert.equal(normalizeDayMinutes(0), 1);
  assert.equal(normalizeDayMinutes(999), 60);
  assert.equal(normalizeDayMinutes('nonsense'), 10);

  const cycle = cycleDurations(15);
  assert.equal(cycle.dayMinutes, 15);
  assert.equal(cycle.nightMinutes, 15);
  const clamped = cycleDurations(0);
  assert.equal(clamped.dayMinutes, 1);
  assert.equal(clamped.nightMinutes, 1);

  // Equal halves advance at the same ticks-per-second rate.
  const dayAdvance = advanceTimeOfDay(0, 300, cycle.dayMinutes, cycle.nightMinutes);
  const nightAdvance = advanceTimeOfDay(DAY_TICKS, 300, cycle.dayMinutes, cycle.nightMinutes) - DAY_TICKS;
  assert.ok(dayAdvance > 0);
  assert.ok(Math.abs(dayAdvance - nightAdvance) < 1e-6);

  // A 10/10 cycle moves sunrise → sunset → sunrise after 20 real minutes.
  assert.ok(Math.abs(advanceTimeOfDay(0, 600, 10, 10) - DAY_TICKS) < 1e-6);
  assert.ok(Math.abs(advanceTimeOfDay(DAY_TICKS, 600, 10, 10)) < 1e-6);

  assert.equal(isDaytime(0), true);
  assert.equal(isDaytime(DAY_TICKS - 1), true);
  assert.equal(isDaytime(DAY_TICKS), false);
  assert.equal(isDaytime(TICKS_PER_DAY - 1), false);
});

await test('creative players ignore damage and break blocks instantly', () => {
  const world = makeFlatWorld(5);
  const player = new Player({ x: 0.5, y: 6.001, z: 0.5 });
  player.setCreative(true);
  assert.equal(player.creative, true);
  assert.equal(player.getBreakTime(getBlock(1), 0), 0.05);

  player.health = 20;
  player.damage(10, 'тест');
  assert.equal(player.health, 20, 'creative damage must be ignored');

  player.hunger = 0;
  player.air = 0;
  player.updateVitals(1 / 60, world);
  assert.equal(player.hunger, 20);
  assert.equal(player.saturation, 20);
  assert.equal(player.air, player.maxAir);

  player.setCreative(false);
  assert.equal(player.flying, false);
  player.damage(4, 'тест');
  assert.equal(player.health, 16, 'survival players still take damage');
});

await test('LAN server relays presence, world state and edits', async () => {
  const lan = require('../src/main/lan.js');
  const hostEvents = [];
  const clientEvents = [];
  lan.setLanSenders(
    (message) => hostEvents.push(message),
    (message) => clientEvents.push(message),
  );

  try {
    const info = await lan.startLanServer(0);
    assert.ok(info.port > 0, 'server should bind an ephemeral port');
    await lan.joinLanServer('127.0.0.1', info.port);
    await waitFor(() => clientEvents.some((message) => message.type === 'welcome'));
    const welcome = clientEvents.find((message) => message.type === 'welcome');
    assert.ok(welcome.id, 'the server should assign a client id');

    lan.sendLan({ type: 'hello', name: 'Тест' }, 'client');
    await waitFor(() => hostEvents.some(
      (message) => message.type === 'client-joined' && message.name === 'Тест',
    ));

    lan.sendLan({ type: 'state', seed: 123, edits: [[1, 2, 3, 4]] }, 'host');
    await waitFor(() => clientEvents.some(
      (message) => message.type === 'state' && message.seed === 123,
    ));

    lan.sendLan({ type: 'edit', x: 1, y: 2, z: 3, id: 5 }, 'host');
    await waitFor(() => clientEvents.some(
      (message) => message.type === 'edit' && message.id === 5,
    ));

    lan.sendLan({ type: 'edit', x: 9, y: 8, z: 7, id: 0 }, 'client');
    await waitFor(() => hostEvents.some(
      (message) => message.type === 'edit' && message.x === 9 && message.from === 'client',
    ));
  } finally {
    lan.stopLan();
  }
});

console.log(`\n${results.length - failed}/${results.length} tests passed.`);
if (failed > 0) {
  console.error(`${failed} test(s) failed.`);
  process.exitCode = 1;
}
