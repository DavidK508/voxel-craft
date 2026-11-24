import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from 'three';

import {
  CHUNK_SIZE,
  PAD_X,
  PAD_Y,
  PAD_Z,
  SEA_LEVEL,
  WORLD_HEIGHT,
} from '../src/shared/constants.js';
import {
  BLOCK_DEFS,
  decodeState,
  getBedId,
  getBlock,
  getButtonId,
  getDoorId,
  getDustId,
  getLampId,
  getLeverId,
  getPistonId,
  getRepeaterId,
  getWallTorchId,
  isSolid,
} from '../src/shared/blocks.js';
import {
  getItem,
  getMaxStack,
  createItemStack,
  getArmorInfo,
  getSpawnEggId,
  ITEM_IDS,
  SPEAR_IDS,
  getToolInfo,
} from '../src/shared/items.js';
import {
  COOKING_RECIPES,
  CookingSession,
  getCookingRecipe,
  getFuelSeconds,
  isFuel,
} from '../src/shared/cooking.js';
import {
  CROPS,
  FARMLAND_BLOCK,
  getCropStage,
  getNextCropStage,
  getPlantableCrop,
  hasWaterNearby,
  isFarmland,
  isHoe,
  isTillable,
} from '../src/shared/farming.js';
import { CHEST_BLOCK, CHEST_SLOTS } from '../src/shared/storage.js';
import { getBiomeInfo, biomeWeather } from '../src/shared/biomes.js';
import { ANIMAL_TIMING, animalDiet } from '../src/shared/animalFoods.js';
import { Weather } from '../src/render/Weather.js';
import { Ambience, ambienceModeFor } from '../src/render/Ambience.js';
import { Rainbow, RAINBOW_ANCHOR } from '../src/render/Rainbow.js';
import { BlockParticles, averageTileColor } from '../src/render/BlockParticles.js';
import { HUD } from '../src/ui/HUD.js';
import { ContainerStorage } from '../src/game/ContainerStorage.js';
import { isInWater, waterSurfaceAt } from '../src/shared/water.js';
import { TEXTURE_COUNT, TILE } from '../src/shared/textures.js';
import { RECIPES, findRecipe } from '../src/shared/recipes.js';
import { villageChestLoot } from '../src/shared/loot.js';
import { SimplexNoise, NoiseField, mulberry32 } from '../src/shared/noise.js';
import { Inventory } from '../src/game/Inventory.js';
import { ItemDrops } from '../src/game/ItemDrops.js';
import { offersForVillager, performTrade, countItem } from '../src/shared/trades.js';
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
  BIOME,
  BIOME_INFO,
  END_ORIGIN,
  NETHER_ORIGIN,
  WorldGenerator,
} from '../src/world/generator.js';
import { buildPaddedVolume, meshChunk } from '../src/world/mesher.js';
import { AQUATIC_MOBS, HOSTILE_MOBS, MOBS, passivePool, spawnablePassive } from '../src/entities/mobs.js';
import { Entity } from '../src/entities/Entity.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { FluidSimulation } from '../src/world/Fluids.js';
import { RedstoneSimulation } from '../src/game/Redstone.js';
import {
  MAP_SIZE,
  mapMarkers,
  normalizeMapPoint,
  playerColor,
   projectPoint,
  sampleTerrain,
  terrainColorAt,
} from '../src/ui/minimap.js';

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

/** Meshes a single block in an otherwise empty chunk and returns its bounds. */
function meshSingleBlock(id, x = 8, y = 10, z = 8) {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  blocks[localIndex(x, y, z)] = id;
  const mesh = meshChunk(buildPaddedVolume(blocks, () => null), 0, 0).solid;
  assert.ok(mesh, `block ${id} should produce geometry`);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.vertexCount; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = mesh.positions[i * 3 + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { mesh, min, max, size: max.map((value, i) => value - min[i]) };
}

/** Tiny in-memory world for exercising the redstone simulation. */
function makeRedstoneWorld() {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  return {
    blocks,
    chunks: new Map([['0,0', { cx: 0, cz: 0, blocks }]]),
    getBlock(x, y, z) {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return 0;
      return blocks[localIndex(x, y, z)];
    },
    setBlock(x, y, z, id) {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return false;
      blocks[localIndex(x, y, z)] = id;
      return true;
    },
    isChunkLoadedAt(x, z) {
      return x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE;
    },
  };
}

function makeRedstoneSim(world) {
  return new RedstoneSimulation(world, {
    getPlayer: () => ({ position: { x: 8, y: 10, z: 8 }, dead: false }),
    getEntities: () => [],
  });
}

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
    getHeightAt() {
      return ground;
    },
    isChunkLoadedAt() {
      return true;
    },
  };
}

/** A river at x 0..8 filled to sea level, with dry banks on either side. */
function makeWaterWorld() {
  const ground = SEA_LEVEL - 6;
  return {
    getBlock(x, y, z) {
      if (y < 0) return 13;
      if (y <= ground) return 1;
      if (y <= SEA_LEVEL && x >= 0 && x <= 8) return 11;
      return 0;
    },
    isSolidAt(x, y, z) {
      const id = this.getBlock(x, y, z);
      return id !== 0 && id !== 11;
    },
    getHeightAt() {
      return ground;
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
  assert.equal(BLOCK_DEFS.length, 205);
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
  assert.equal(getBlock(183).key, 'farmland');
  assert.equal(getBlock(184).key, 'wheat_crop_young');
  assert.equal(getBlock(199).key, 'millet_crop');
  assert.equal(getBlock(199).solid, false);
  assert.deepEqual(getBlock(199).drops, [{ id: 526, count: 1 }, { id: 525, count: 1 }]);
  assert.equal(getBlock(200).key, 'chest');
  assert.equal(getBlock(200).interactive, 'chest');
  assert.deepEqual(getBlock(200).drops, [{ id: 200, count: 1 }]);
  assert.equal(getBlock(69).key, 'bed_foot_0');
  assert.equal(getBlock(69).interactive, 'bed');
  assert.equal(getBlock(69).customShape, true);
  assert.equal(getBlock(63).customShape, true);
  assert.equal(getBlock(81).interactive, 'door');
  assert.equal(getBlock(149).light, 0);
  assert.equal(getBlock(150).light, 15);
  const ids = BLOCK_DEFS.map((block) => block.id);
  assert.equal(new Set(ids).size, ids.length, 'block ids must be unique');
  assert.deepEqual([...new Set(ids)].sort((a, b) => a - b),
    Array.from({ length: BLOCK_DEFS.length }, (_, i) => i + 1),
    'block ids must cover the whole range without gaps');
  for (const block of BLOCK_DEFS) {
    assert.ok(block.id > 0 && block.id < 256, `invalid id ${block.id}`);
    assert.equal(block.tiles.length, 6);
    assert.ok(block.name.length > 0);
  }
});

await test('Redstone states round-trip and craft', () => {
  assert.deepEqual(decodeState(1), null);
  assert.deepEqual(decodeState(getBedId(3, true)), { type: 'bed', facing: 3, head: true });
  assert.deepEqual(decodeState(getDoorId(2, true, 1)), { type: 'door', facing: 2, open: true, half: 1 });
  assert.deepEqual(decodeState(getLeverId(1, true)), { type: 'lever', facing: 1, powered: true });
  assert.deepEqual(decodeState(getRepeaterId(0, true, 4)), { type: 'repeater', facing: 0, powered: true, delay: 4 });
  assert.deepEqual(decodeState(getLampId(true)), { type: 'lamp', lit: true });
  assert.deepEqual(decodeState(182), { type: 'redstone_ore' });

  assert.equal(findRecipe([5, 5, null, 5, 5, null, 5, 5, null], 3).result.id, 81);
  assert.equal(findRecipe([400, 4, null, null], 2).result.id, 97);
  assert.equal(findRecipe([449, 449, 449, 449, 449, 449, 449, 449, 449], 3).result.id, 181);
  assert.equal(getItem(449).key, 'redstone');
  assert.equal(getItem(448).key, 'slime_ball');
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

await test('extra tool tiers, armor sets and creature materials are registered', () => {
  assert.equal(getItem(316).key, 'gold_pickaxe');
  assert.equal(getItem(316).tool.tier, 2);
  assert.equal(getItem(319).key, 'gold_sword');
  assert.equal(getItem(320).key, 'netherite_pickaxe');
  assert.equal(getItem(320).tool.tier, 5);
  assert.equal(getItem(323).key, 'netherite_sword');
  assert.equal(getItem(404).tool, undefined);
  assert.equal(getArmorInfo(512).defense, 2);
  assert.equal(getArmorInfo(516).defense, 4);
  assert.equal(createItemStack(519).durability, 600);

  for (const id of [474, 475, 476, 477, 478]) assert.ok(getItem(id), `item ${id} should exist`);
  assert.equal(getItem(474).key, 'netherite_ingot');
  assert.equal(getItem(478).key, 'camel_hide');

  const ingot = findRecipe([405, 405, 25, 25, 404, null, null, null, null], 3);
  assert.equal(ingot?.result.id, 474);
  const goldSword = findRecipe([404, null, null, 404, null, null, 400, null, null], 3);
  assert.equal(goldSword?.result.id, 319);
  const netherHelmet = findRecipe([474, 474, 474, 474, null, 474, null, null, null], 3);
  assert.equal(netherHelmet?.result.id, 516);

  assert.ok(MOBS.camel.drops.some((drop) => drop.id === 478), 'camels yield hides');
  assert.ok(MOBS.spider.drops.some((drop) => drop.id === 476), 'spiders yield fangs');
  assert.ok(MOBS.ender_dragon.drops.some((drop) => drop.id === 475), 'dragons yield scales');
  assert.ok(MOBS.wolf.drops.some((drop) => drop.id === 477), 'wolves yield fur');
});

await test('stove toolkit is craftable and registered', () => {
  assert.equal(getItem(ITEM_IDS.FRYING_PAN).use, 'cook');
  assert.equal(getItem(ITEM_IDS.WOODEN_HOE).tool.type, 'hoe');
  assert.equal(createItemStack(ITEM_IDS.IRON_HOE).durability, 250);
  assert.equal(getItem(ITEM_IDS.COOKED_POTATO).food.nutrition, 6);
  assert.equal(getCookingRecipe(ITEM_IDS.POTATO).output, ITEM_IDS.COOKED_POTATO);
  assert.ok(isFuel(ITEM_IDS.COAL));
  assert.equal(getFuelSeconds(5), 15);

  const pan = findRecipe([403, 403, 403, null, null, 400, null, null, null], 3);
  assert.equal(pan?.result.id, ITEM_IDS.FRYING_PAN);
  const hoe = findRecipe([403, 403, null, null, 400, null, null, 400, null], 3);
  assert.equal(hoe?.result.id, ITEM_IDS.IRON_HOE);
  assert.ok(COOKING_RECIPES.length >= 10, 'the stove should cook a full recipe book');
});

await test('stove consumes fuel and turns raw food into cooked food', () => {
  const session = new CookingSession();
  session.setSlot(0, { id: ITEM_IDS.POTATO, count: 2 });

  // No fuel means no progress at all.
  assert.equal(session.tick(5), false);
  assert.equal(session.progress, 0);

  session.setSlot(1, { id: ITEM_IDS.COAL, count: 1 });
  session.tick(4);
  assert.equal(session.fuelRemaining, 76);
  assert.ok(Math.abs(session.progress - 4 / 7) < 1e-9);

  session.tick(3);
  assert.equal(session.getSlot(0).count, 1);
  assert.deepEqual(session.getSlot(2), { id: ITEM_IDS.COOKED_POTATO, count: 1 });
  assert.ok(session.progress < 1e-9);

  // A blocked output slot must not silently eat the next potato.
  session.setSlot(0, { id: ITEM_IDS.POTATO, count: 1 });
  session.setSlot(2, { id: 5, count: 1 });
  session.tick(7);
  assert.equal(session.getSlot(2).id, 5);
  assert.equal(session.getSlot(0).count, 1);
});

await test('farming registry maps seeds, soil, stages and watering', () => {
  assert.equal(FARMLAND_BLOCK, 183);
  assert.ok(isTillable(2));
  assert.ok(!isTillable(4));
  assert.ok(isFarmland(FARMLAND_BLOCK));
  assert.ok(isHoe(ITEM_IDS.IRON_HOE));
  assert.equal(CROPS.length, 5);

  const potato = getPlantableCrop(ITEM_IDS.POTATO);
  assert.equal(potato.key, 'potato');
  assert.deepEqual(potato.stages, [190, 191, 192]);
  assert.equal(getCropStage(64).stage, 3);
  assert.equal(getCropStage(200), null);
  assert.equal(getNextCropStage(190), 191);
  assert.equal(getNextCropStage(192), 66);
  assert.equal(getNextCropStage(66), null);

  const wetWorld = { getBlock: (x) => (x === 1 ? 11 : 3) };
  const dryWorld = { getBlock: () => 3 };
  assert.ok(hasWaterNearby(wetWorld, 0, 10, 0));
  assert.ok(!hasWaterNearby(dryWorld, 0, 10, 0));
});

await test('chests are craftable storage blocks with textures', () => {
  assert.equal(CHEST_SLOTS, 27);
  assert.equal(getItem(CHEST_BLOCK).placeBlock, CHEST_BLOCK);
  const recipe = findRecipe([5, 5, 5, 5, null, 5, 5, 5, 5], 3);
  assert.equal(recipe?.result.id, CHEST_BLOCK);
  for (const name of ['chest_top', 'chest_side', 'chest_front']) {
    assert.ok(TILE[name] >= 0 && TILE[name] < TEXTURE_COUNT, `missing texture ${name}`);
  }
});

await test('chest storage survives save/load and drops contents when broken', () => {
  const storage = new ContainerStorage();
  const slots = storage.slotsAt(3, 64, -7);
  assert.equal(slots.length, CHEST_SLOTS);
  slots[0] = { id: 5, count: 64 };
  slots[4] = { id: ITEM_IDS.IRON_HOE, count: 1, durability: 120 };

  const saved = storage.serialize();
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].items.map((item) => item.slot), [0, 4]);

  const restored = new ContainerStorage();
  restored.deserialize(saved);
  assert.deepEqual(restored.slotsAt(3, 64, -7)[0], { id: 5, count: 64 });
  assert.deepEqual(restored.slotsAt(3, 64, -7)[4], {
    id: ITEM_IDS.IRON_HOE, count: 1, durability: 120,
  });

  // Invalid stacks in a hand-edited save must not leak into the game.
  const invalid = new ContainerStorage();
  invalid.deserialize([{ x: 1, y: 2, z: 3, items: [{ slot: 0, stack: { id: 99999, count: 5 } }] }]);
  assert.equal(invalid.slotsAt(1, 2, 3)[0], null);

  // An emptied village chest still remembers that it was already looted.
  storage.markLooted(9, 64, 9);
  const marked = storage.serialize();
  assert.equal(marked.find((entry) => entry.x === 9 && entry.z === 9)?.looted, true);
  const restoredMarked = new ContainerStorage();
  restoredMarked.deserialize(marked);
  assert.equal(restoredMarked.isLooted(9, 64, 9), true);
  assert.deepEqual(restoredMarked.slotsAt(9, 64, 9), new Array(CHEST_SLOTS).fill(null));
  restoredMarked.remove(9, 64, 9);
  assert.equal(restoredMarked.isLooted(9, 64, 9), false);

  const contents = restored.remove(3, 64, -7);
  assert.equal(contents[0].id, 5);
  assert.equal(restored.has(3, 64, -7), false);
});

await test('hostile mobs carry visible weapons', async () => {
  const { buildMobModel } = await import('../src/entities/models.js');
  for (const key of ['zombie', 'skeleton', 'spider', 'enderman', 'blaze']) {
    const model = buildMobModel(key);
    assert.ok(model.weapon, `${key} should have a weapon pivot`);
    assert.ok(model.weapon.children.length > 0, `${key} weapon should have geometry`);
  }
  assert.equal(buildMobModel('cow').weapon, undefined, 'peaceful animals are unarmed');
});

await test('mob attacks swing the held weapon and settle back to idle', () => {
  const world = makeFlatWorld(6);
  const player = { position: { x: 60, y: 6, z: 60 }, creative: false, dead: false, damage() {} };
  const zombie = new Entity(MOBS.zombie, { x: 0.5, y: 6, z: 0.5 });
  const cow = new Entity(MOBS.cow, { x: 2.5, y: 6, z: 0.5 });
  const attacks = [];
  const manager = { entities: [zombie, cow], onAttack: (attacker, target) => attacks.push(target) };
  const restX = zombie.model.weapon.rotation.x;

  zombie.attackTarget(cow, player, manager);
  assert.deepEqual(attacks, [cow], 'attack callbacks receive the victim');
  assert.equal(zombie.attackSwing, 1, 'an attack should start a swing');
  zombie.syncModel(0.1);
  assert.notEqual(zombie.model.weapon.rotation.x, restX, 'the weapon should move during the swing');

  for (let i = 0; i < 20; i++) zombie.syncModel(0.05);
  assert.equal(zombie.attackSwing, 0, 'the swing should finish');
  assert.equal(zombie.model.weapon.rotation.x, restX, 'the weapon should return to its rest pose');
  assert.ok(Number.isFinite(zombie.model.group.rotation.y), 'visual yaw stays finite');
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

await test('overworld carves long water-filled rivers', () => {
  const seed = 0x1234abcd;
  const generator = new WorldGenerator(seed);
  const step = 4;
  const half = 128;
  const width = (half * 2) / step;
  const mask = new Uint8Array(width * width);
  const coords = [];
  for (let z = -half; z < half; z += step) {
    for (let x = -half; x < half; x += step) {
      const height = generator.heightAt(x, z);
      if (height < SEA_LEVEL - 2 && generator.riverStrengthAt(x, z) > 0.6) {
        mask[((z + half) / step) * width + (x + half) / step] = 1;
        coords.push([x, z]);
      }
    }
  }
  assert.ok(coords.length > 60, `expected a river, found ${coords.length} cells`);

  // The signal must form one long channel rather than a scatter of ponds.
  const seen = new Uint8Array(mask.length);
  let largest = 0;
  let span = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const queue = [i];
    seen[i] = 1;
    let size = 0;
    let minX = width;
    let maxX = 0;
    let minZ = width;
    let maxZ = 0;
    while (queue.length) {
      const cell = queue.pop();
      const cx = cell % width;
      const cz = (cell / width) | 0;
      size++;
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minZ = Math.min(minZ, cz);
      maxZ = Math.max(maxZ, cz);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= width || nz >= width) continue;
          const next = nz * width + nx;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    largest = Math.max(largest, size);
    span = Math.max(span, (maxX - minX) * step, (maxZ - minZ) * step);
  }
  assert.ok(largest > 60, `river should be continuous, largest channel has ${largest} cells`);
  assert.ok(span > 64, `river should run for many blocks, got ${span}`);

  // Carved beds are filled with water up to sea level by the generator.
  const [wx, wz] = coords[0];
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const chunk = generateChunk(cx, cz, seed);
  const lx = wx - cx * CHUNK_SIZE;
  const lz = wz - cz * CHUNK_SIZE;
  assert.equal(chunk.blocks[localIndex(lx, SEA_LEVEL, lz)], 11, 'river surface should be water');
});

await test('overworld stays mostly land instead of scattered islands', () => {
  for (const seed of [0x1234abcd, 7, 99, 2024]) {
    const generator = new WorldGenerator(seed);
    let water = 0;
    let shallow = 0;
    let total = 0;
    for (let z = -192; z < 192; z += 6) {
      for (let x = -192; x < 192; x += 6) {
        const height = generator.heightAt(x, z);
        total++;
        if (height < SEA_LEVEL - 2) water++;
        else if (height <= SEA_LEVEL) shallow++;
      }
    }
    assert.ok(water / total < 0.35, `seed ${seed}: too much ocean (${water}/${total})`);
    assert.ok(shallow / total < 0.08, `seed ${seed}: too many shallow wetlands (${shallow}/${total})`);
  }
});

await test('redstone ore is generated underground and drops raw redstone', () => {
  let ore = 0;
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const { blocks } = generateChunk(cx, cz, 0x1234abcd);
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i] === 182) ore++;
      }
    }
  }
  assert.ok(ore > 0, 'redstone ore must be findable in the ground');
  assert.deepEqual(getBlock(182).drops, [{ id: 449, count: 1 }]);
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
  const minX = village.x - 40;
  const maxX = village.x + 40;
  const minZ = village.z - 40;
  const maxZ = village.z + 40;
  for (let cz = Math.floor(minZ / CHUNK_SIZE); cz <= Math.floor(maxZ / CHUNK_SIZE); cz++) {
    for (let cx = Math.floor(minX / CHUNK_SIZE); cx <= Math.floor(maxX / CHUNK_SIZE); cx++) {
      const chunk = generateChunk(cx, cz, seed);
      for (let i = 0; i < chunk.blocks.length; i++) {
        const id = chunk.blocks[i];
        if (id >= 60) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  for (const crop of [64, 65, 66, 67, 199]) {
    assert.ok((counts.get(crop) ?? 0) > 5, `village garden should contain crop ${crop}`);
  }
  assert.ok((counts.get(FARMLAND_BLOCK) ?? 0) > 20, 'village garden should be tilled');
  assert.ok((counts.get(68) ?? 0) > 30, 'village farm should be fenced');
  assert.ok((counts.get(60) ?? 0) > 0, 'village farm should store hay');
  assert.ok((counts.get(CHEST_BLOCK) ?? 0) >= 14, 'village houses and barn should have chests');
});

await test('villages place fourteen distinct houses with doors, windows and paths', () => {
  const seed = 424242;
  const spawn = findSpawn(seed);
  const village = nearbyVillages(spawn.x, spawn.z, seed)[0];

  const collect = (chunkAt) => {
    const blocks = new Map();
    const minX = village.x - 40;
    const maxX = village.x + 40;
    const minZ = village.z - 40;
    const maxZ = village.z + 40;
    for (let cz = Math.floor(minZ / CHUNK_SIZE); cz <= Math.floor(maxZ / CHUNK_SIZE); cz++) {
      for (let cx = Math.floor(minX / CHUNK_SIZE); cx <= Math.floor(maxX / CHUNK_SIZE); cx++) {
        const chunk = chunkAt(cx, cz);
        for (let i = 0; i < chunk.blocks.length; i++) {
          const id = chunk.blocks[i];
          if (id === 0) continue;
          const wx = cx * CHUNK_SIZE + (i & 15);
          const wz = cz * CHUNK_SIZE + ((i >> 4) & 15);
          blocks.set(`${wx},${i >> 8},${wz}`, id);
        }
      }
    }
    return blocks;
  };

  const blocks = collect((cx, cz) => generateChunk(cx, cz, seed));
  const doorSpots = new Set();
  let doors = 0;
  let glass = 0;
  let paths = 0;
  for (const [key, id] of blocks) {
    if (id >= 81 && id <= 96) {
      doors++;
      const [x, , z] = key.split(',').map(Number);
      doorSpots.add(`${x},${z}`);
    }
    if (id === 12) glass++;
    if (id === 10) paths++;
  }
  assert.ok(doors >= 28, `expected fourteen two-block doors, found ${doors}`);
  assert.ok(doorSpots.size >= 14, `expected fourteen separate house entrances, found ${doorSpots.size}`);
  assert.ok(glass >= 80, `expected house windows, found ${glass} glass blocks`);
  assert.ok(paths >= 60, `expected gravel lanes, found ${paths} path blocks`);
  const spots = [...doorSpots].map((spot) => spot.split(',').map(Number));
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      assert.ok(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1]) > 3,
        `houses should not overlap: ${spots[i]} and ${spots[j]}`);
    }
  }

  const fresh = new WorldGenerator(seed);
  const again = collect((cx, cz) => fresh.generateChunk(cx, cz));
  assert.deepEqual([...again].sort(), [...blocks].sort(), 'village layout must be deterministic');
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
  // A slim post plus a small flame billboard above it.
  assert.ok(top > 11.9 && top < 12.1, `torch should be a slim post with a flame, got top ${top}`);
  assert.equal(torchBrightest, 238, 'torch light should bake as level 14');
});

await test('decorative blocks use rectangular, non-cube geometry', () => {
  assert.equal(TEXTURE_COUNT, 117);
  for (const name of ['bed_top', 'bed_side', 'torch_stick', 'torch_flame', 'oak_fence',
    'door_bottom', 'door_top', 'lever_off', 'button_off', 'plate_off', 'wire_off',
    'repeater_off', 'piston_side', 'lamp_off', 'redstone_block', 'redstone_ore']) {
    assert.ok(TILE[name] >= 0 && TILE[name] < TEXTURE_COUNT, `missing texture ${name}`);
  }
  assert.ok(TILE.bed_top > 63, 'late atlas tiles need seven mesh bits');

  const torch = meshSingleBlock(63);
  assert.ok(torch.mesh.tiles.includes(TILE.torch_flame), 'flame tile must survive mesh packing');
  assert.ok(torch.size[0] < 0.2 && torch.size[2] < 0.2, 'torch must be a slim post');
  assert.ok(torch.max[1] > 11 && torch.max[1] < 11.1, 'torch flame sits just above the block');

  const wallTorch = meshSingleBlock(getWallTorchId(2));
  assert.ok(wallTorch.size[1] < 0.6, 'wall torch must be horizontal, not a cube');
  assert.ok(wallTorch.size[2] > 0.5, 'wall torch stick protrudes from the wall');

  const bed = meshSingleBlock(getBedId(0, false));
  assert.ok(bed.mesh.tiles.includes(TILE.bed_top), 'bed tile must survive mesh packing');
  assert.ok(bed.size[1] < 0.8, `bed must stay low, got height ${bed.size[1]}`);
  assert.ok(bed.size[0] > 0.8 && bed.size[2] > 0.8, 'bed footprint fills its cell');
  assert.ok(bed.mesh.vertexCount / 4 > 30, 'bed needs legs, frame and mattress, not one box');
  const head = meshSingleBlock(getBedId(0, true));
  assert.ok(head.mesh.tiles.includes(TILE.white_wool), 'head has a separate pillow');
  assert.ok(head.size[1] > bed.size[1], 'headboard rises above the footboard');

  // Both halves must fill their own cell along the bed axis so the joined
  // bed has no gap in the middle, and only the outer ends get raised boards.
  const southFoot = meshSingleBlock(getBedId(2, false), 8, 10, 8);
  const southHead = meshSingleBlock(getBedId(2, true), 8, 10, 9);
  assert.ok(Math.abs(southFoot.min[2] - 8) < 1e-6
    && Math.abs(southFoot.max[2] - 9) < 1e-6, 'foot half fills its cell along the bed axis');
  assert.ok(Math.abs(southHead.min[2] - 9) < 1e-6
    && Math.abs(southHead.max[2] - 10) < 1e-6, 'head half meets the foot at the shared boundary');
  const highZ = (mesh, minY) => {
    const values = [];
    for (let i = 0; i < mesh.vertexCount; i++) {
      if (mesh.positions[i * 3 + 1] > minY) values.push(mesh.positions[i * 3 + 2]);
    }
    return values;
  };
  const footBoards = highZ(southFoot.mesh, 10.7);
  const headBoards = highZ(southHead.mesh, 10.78);
  assert.ok(footBoards.length > 0 && footBoards.every((z) => z < 8.25),
    'footboard must sit at the outer end, not at the seam');
  assert.ok(headBoards.length > 0 && headBoards.every((z) => z > 9.75),
    'headboard must sit at the outer end, not at the seam');

  const fence = meshSingleBlock(68);
  assert.ok(Math.abs(fence.size[0] - 0.25) < 1e-6, 'fence post is thin in X');
  assert.ok(Math.abs(fence.size[2] - 0.25) < 1e-6, 'fence post is thin in Z');
  assert.ok(fence.size[1] > 1.4, 'fence post is taller than a block');

  const closed = meshSingleBlock(getDoorId(0, false, 0));
  assert.ok(closed.size[2] < 0.25, 'closed door is a thin panel');
  assert.ok(closed.size[1] > 0.9, 'door spans nearly a full block vertically');
  assert.ok(Math.abs(closed.max[1] - 11) < 1e-6, 'lower half reaches the next cell');
  const upper = meshSingleBlock(getDoorId(0, false, 1), 8, 11, 8);
  assert.ok(Math.abs(upper.min[1] - 11) < 1e-6, 'upper half starts at the same boundary');
  const open = meshSingleBlock(getDoorId(0, true, 0));
  assert.ok(open.size[0] < 0.2, 'open door is a thin panel rotated onto the X axis');
  assert.ok(open.size[2] > 0.8, 'open door swings across the whole cell');

  const lever = meshSingleBlock(getLeverId(2, false));
  assert.ok(lever.size[1] < 0.6, 'lever is a low mechanism');
  const button = meshSingleBlock(getButtonId(2, false));
  assert.ok(button.size[1] < 0.4, 'button is a small, flat control');
  const wire = meshSingleBlock(getDustId(false));
  assert.ok(wire.size[1] < 0.2, 'redstone dust is flat on the floor');
  assert.ok(wire.size[0] > 0.9 && wire.size[2] > 0.9, 'dust crosses the cell');
  const repeater = meshSingleBlock(getRepeaterId(0, false, 1));
  assert.ok(repeater.size[1] < 0.4, 'repeater is a low rectangular device');
});

await test('lever handle follows facing, mounting and power state', () => {
  const deviceTiles = new Set([
    TILE.cobblestone, TILE.oak_planks, TILE.lever_off, TILE.lever_on,
  ]);
  const facingX = [0, 1, 0, -1];
  const facingZ = [-1, 0, 1, 0];

  // Bounds of the lever alone: the supporting wall is excluded by its tile.
  const meshLever = (facing, powered, wall = false) => {
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    blocks[localIndex(8, 10, 8)] = getLeverId(facing, powered);
    if (wall) {
      blocks[localIndex(8 - facingX[facing], 10, 8 - facingZ[facing])] = 1;
    }
    const mesh = meshChunk(buildPaddedVolume(blocks, () => null), 0, 0).solid;
    assert.ok(mesh, 'lever should produce geometry');
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const tiles = new Set();
    let quads = 0;
    for (let i = 0; i < mesh.vertexCount; i += 4) {
      if (!deviceTiles.has(mesh.tiles[i])) continue;
      quads++;
      tiles.add(mesh.tiles[i]);
      for (let v = 0; v < 4; v++) {
        for (let axis = 0; axis < 3; axis++) {
          const value = mesh.positions[(i + v) * 3 + axis];
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
    }
    return { min, max, quads, tiles };
  };

  const off = meshLever(2, false);
  const on = meshLever(2, true);
  assert.ok(off.quads >= 20 && on.quads >= 20, 'lever is more than a single box');
  assert.ok(off.tiles.has(TILE.lever_off) && !off.tiles.has(TILE.lever_on));
  assert.ok(on.tiles.has(TILE.lever_on) && !on.tiles.has(TILE.lever_off));
  assert.ok(off.tiles.has(TILE.cobblestone) && off.tiles.has(TILE.oak_planks));
  // Unpowered handle stands up; powering it folds the handle down.
  assert.ok(off.max[1] - on.max[1] > 0.2, 'off handle is raised, on handle is down');
  assert.ok(on.max[2] > off.max[2] + 0.1, 'powered handle points along the facing');

  for (const facing of [0, 1, 2, 3]) {
    const powered = meshLever(facing, true);
    const axis = facing % 2 === 0 ? 2 : 0;
    const sign = facing === 1 || facing === 2 ? 1 : -1;
    const far = sign > 0 ? powered.max[axis] : powered.min[axis];
    assert.ok(Math.abs(far - (8.5 + sign * 0.3125)) < 1e-6,
      `facing ${facing} handle must extend outwards`);

    const wall = meshLever(facing, false, true);
    const near = sign > 0 ? wall.min[axis] : wall.max[axis];
    assert.ok(Math.abs(near - (8.5 - sign * 0.5)) < 1e-6,
      `facing ${facing} wall plate must sit flush with the wall`);
    assert.ok(wall.max[1] > 10.85, `facing ${facing} wall lever handle is raised`);
    const wallOn = meshLever(facing, true, true);
    assert.ok(wallOn.min[1] < 10.25, `facing ${facing} wall lever handle drops when powered`);
  }
});

await test('redstone devices respond to levers, wires, repeaters and pistons', () => {
  const world = makeRedstoneWorld();
  const sim = makeRedstoneSim(world);
  const set = (x, y, z, id) => world.setBlock(x, y, z, id);

  // Lever -> wire -> door.
  set(8, 10, 8, getLeverId(0, false));
  set(8, 10, 9, getDustId(false));
  set(8, 10, 10, getDoorId(0, false, 0));
  set(8, 11, 10, getDoorId(0, false, 1));
  sim.update(0.1); // establish the unpowered baseline
  assert.equal(sim.interact(8, 10, 8), true);
  sim.update(0.1);
  assert.equal(sim.wirePower.get('8,10,9'), 15, 'a lever powers adjacent dust');
  assert.equal(world.getBlock(8, 10, 10), getDoorId(0, true, 0), 'door opens on signal');
  assert.equal(world.getBlock(8, 11, 10), getDoorId(0, true, 1), 'both door halves follow');

  // Signal decays along dust, and a repeater restores it after its delay.
  const lineWorld = makeRedstoneWorld();
  const lineSim = makeRedstoneSim(lineWorld);
  lineWorld.setBlock(4, 10, 4, getLeverId(0, true));
  for (let z = 5; z <= 8; z++) lineWorld.setBlock(4, 10, z, getDustId(false));
  lineWorld.setBlock(4, 10, 9, getRepeaterId(2, false, 1));
  lineWorld.setBlock(4, 10, 10, getDustId(false));
  lineWorld.setBlock(4, 10, 11, getLampId(false));
  lineSim.update(0.1);
  assert.equal(lineSim.wirePower.get('4,10,5'), 15);
  assert.equal(lineSim.wirePower.get('4,10,8'), 12, 'dust loses one strength per block');
  lineSim.update(0.2);
  assert.equal(lineWorld.getBlock(4, 10, 9), getRepeaterId(2, true, 1), 'repeater fires after its delay');
  lineSim.update(0.1);
  assert.equal(lineWorld.getBlock(4, 10, 11), getLampId(true), 'repeater output lights the lamp');

  // Piston pushes a block one cell forward and restores it when depowered.
  const pistonWorld = makeRedstoneWorld();
  const pistonSim = makeRedstoneSim(pistonWorld);
  pistonWorld.setBlock(3, 10, 6, getLeverId(0, false));
  pistonWorld.setBlock(4, 10, 6, getDustId(false));
  pistonWorld.setBlock(5, 10, 6, getPistonId(1, false, false));
  pistonWorld.setBlock(7, 10, 6, 5);
  pistonSim.update(0.1); // establish the unpowered baseline
  pistonWorld.setBlock(3, 10, 6, getLeverId(0, true));
  pistonSim.update(0.1);
  assert.equal(pistonWorld.getBlock(5, 10, 6), getPistonId(1, true, false), 'piston extends');
  assert.equal(pistonWorld.getBlock(6, 10, 6), 163 + 1, 'piston head fills the gap');
  assert.equal(pistonWorld.getBlock(8, 10, 6), 5, 'pushable block moves forward');
  pistonWorld.setBlock(3, 10, 6, getLeverId(0, false));
  pistonSim.update(0.1);
  pistonSim.update(0.1);
  assert.equal(pistonWorld.getBlock(5, 10, 6), getPistonId(1, false, false), 'piston retracts');
  assert.equal(pistonWorld.getBlock(6, 10, 6), 0, 'head is removed');
  assert.equal(pistonWorld.getBlock(7, 10, 6), 5, 'block returns to its place');
});

await test('redstone respects manual doors, direct signals and timed buttons', () => {
  // A player-opened door stays open while the redstone signal is unchanged.
  const world = makeRedstoneWorld();
  const sim = makeRedstoneSim(world);
  world.setBlock(8, 10, 5, getDoorId(0, false, 0));
  world.setBlock(8, 11, 5, getDoorId(0, false, 1));
  sim.update(0.1);
  world.setBlock(8, 10, 5, getDoorId(0, true, 0));
  world.setBlock(8, 11, 5, getDoorId(0, true, 1));
  for (let i = 0; i < 3; i++) sim.update(0.1);
  assert.equal(world.getBlock(8, 10, 5), getDoorId(0, true, 0), 'manual door stays open');

  // A powered lever directly next to a door needs no dust.
  const directWorld = makeRedstoneWorld();
  const directSim = makeRedstoneSim(directWorld);
  directWorld.setBlock(4, 10, 5, getLeverId(0, false));
  directWorld.setBlock(4, 10, 6, getDoorId(0, false, 0));
  directWorld.setBlock(4, 11, 6, getDoorId(0, false, 1));
  directSim.update(0.1);
  directWorld.setBlock(4, 10, 5, getLeverId(0, true));
  directSim.update(0.1);
  assert.equal(directWorld.getBlock(4, 10, 6), getDoorId(0, true, 0), 'lever opens adjacent door');

  // Buttons emit a pulse and then release themselves.
  const buttonWorld = makeRedstoneWorld();
  const buttonSim = makeRedstoneSim(buttonWorld);
  buttonWorld.setBlock(6, 10, 5, getButtonId(0, false));
  assert.equal(buttonSim.interact(6, 10, 5), true);
  assert.equal(buttonWorld.getBlock(6, 10, 5), getButtonId(0, true), 'button presses');
  buttonSim.update(2);
  assert.equal(buttonWorld.getBlock(6, 10, 5), getButtonId(0, false), 'button releases');
});

await test('multi-block devices remove both halves', () => {
  const world = makeRedstoneWorld();
  const sim = makeRedstoneSim(world);
  const set = (x, y, z, id) => world.setBlock(x, y, z, id);

  // Bed facing north: the head is one cell north of the foot.
  set(4, 10, 5, getBedId(0, false));
  set(4, 10, 4, getBedId(0, true));
  sim.onBlockRemoved(4, 10, 5, getBedId(0, false));
  assert.equal(world.getBlock(4, 10, 4), 0, 'breaking the foot removes the head');

  set(4, 10, 5, getBedId(0, false));
  set(4, 10, 4, getBedId(0, true));
  sim.onBlockRemoved(4, 10, 4, getBedId(0, true));
  assert.equal(world.getBlock(4, 10, 5), 0, 'breaking the head removes the foot');

  // Bed facing east: the head is one cell east of the foot.
  set(4, 10, 5, getBedId(1, false));
  set(5, 10, 5, getBedId(1, true));
  sim.onBlockRemoved(4, 10, 5, getBedId(1, false));
  assert.equal(world.getBlock(5, 10, 5), 0, 'east-facing bed removes the right neighbour');

  // Door halves follow each other.
  set(8, 10, 5, getDoorId(2, false, 0));
  set(8, 11, 5, getDoorId(2, false, 1));
  sim.onBlockRemoved(8, 10, 5, getDoorId(2, false, 0));
  assert.equal(world.getBlock(8, 11, 5), 0, 'breaking the door bottom removes the top');

  set(8, 10, 5, getDoorId(2, false, 0));
  set(8, 11, 5, getDoorId(2, false, 1));
  sim.onBlockRemoved(8, 11, 5, getDoorId(2, false, 1));
  assert.equal(world.getBlock(8, 10, 5), 0, 'breaking the door top removes the bottom');
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

await test('creatures steer around walls instead of pressing into them', () => {
  const solids = new Set();
  for (let x = -10; x <= 40; x++) {
    for (let z = -12; z <= 12; z++) solids.add(`${x},0,${z}`);
  }
  // A short wall directly in front of the creature, open ground at z >= 3.
  for (let z = -2; z <= 2; z++) {
    for (let y = 1; y <= 3; y++) solids.add(`${1},${y},${z}`);
  }
  const world = makeSetWorld(solids);
  const player = { position: { x: 100, y: 2, z: 100 }, creative: false, dead: false };
  const mob = { ...MOBS.villager, speed: 4 };
  const villager = new Entity(mob, { x: 0.5, y: 1.02, z: 0.5 }, { home: { x: 20, z: 0 } });
  const manager = { entities: [villager], onAttack: null };

  const steered = villager.steerAround(world, 1, 0, 0.1);
  assert.equal(steered.detour, true, 'a blocked route should produce a detour');
  assert.ok(Math.abs(steered.z) > 0.1, 'the detour turns sideways');

  for (let i = 0; i < 900; i++) villager.update(1 / 30, world, player, manager);
  assert.ok(villager.position.x > 2, `creature should get around the wall, got x=${villager.position.x.toFixed(1)}`);
  assert.equal(villager.dead, false);
});

await test('nether portal leads to a hell with pigs', () => {
  assert.equal(MOBS.nether_pig.kind, 'passive');
  assert.ok(MOBS.nether_pig.dimensions.includes('nether'));
  assert.ok(passivePool('nether').some((mob) => mob.key === 'nether_pig'));
  assert.ok(!passivePool('overworld').some((mob) => mob.key === 'nether_pig'));
  assert.ok(!spawnablePassive(BIOME.NETHER).some((mob) => mob.key === 'nether_pig'));

  const world = { ...makeFlatWorld(39), getHeightAt: () => 39 };
  const manager = new EntityManager({ scene: { add() {} }, world, drops: null, seed: 3 });
  const player = {
    position: { x: NETHER_ORIGIN.x + 0.5, y: 41, z: NETHER_ORIGIN.z - 3.5 },
    creative: false,
    dead: false,
    damage() {},
  };
  manager.update(0.1, player, { day: false });
  const pigs = manager.entities.filter((entity) => entity.type === 'nether_pig');
  assert.ok(pigs.length >= 3, 'the nether plaza should start with a pig herd');
  assert.ok(!manager.entities.some((entity) => entity.kind === 'boss'), 'the Nether no longer hosts the boss');
});

await test('end portal awakens a flying dragon boss', () => {
  assert.equal(MOBS.ender_dragon.kind, 'boss');
  assert.ok(MOBS.ender_dragon.health > 300);
  assert.ok(MOBS.ender_dragon.dimensions.includes('end'));
  assert.ok(!HOSTILE_MOBS.some((mob) => mob.key === 'ender_dragon'), 'boss must not join random hostile spawns');

  const world = { ...makeFlatWorld(63), getHeightAt: () => 63 };
  const manager = new EntityManager({ scene: { add() {} }, world, drops: null, seed: 3 });
  const player = {
    position: { x: END_ORIGIN.x + 0.5, y: 65, z: END_ORIGIN.z - 3.5 },
    creative: false,
    dead: false,
    damage() {},
  };
  manager.update(0.1, player, { day: true });
  const boss = manager.entities.find((entity) => entity.kind === 'boss');
  assert.ok(boss, 'the End plaza should spawn the dragon');
  assert.equal(boss.type, 'ender_dragon');
  assert.equal(boss.flying, true);
});

await test('dragon hunts the player, resists blunt weapons and respawns later', () => {
  const world = makeFlatWorld(5);
  const manager = new EntityManager({ scene: { add() {} }, world, drops: null, seed: 4 });
  const boss = manager.spawnMob('ender_dragon', 0.5, 6.02, 0.5);
  const cow = manager.spawnMob('cow', 1.6, 6.02, 0.5);
  const player = {
    position: { x: 3.5, y: 6, z: 0.5 },
    creative: false,
    dead: false,
    damage() {},
  };
  boss.update(1 / 60, world, player, manager);
  assert.equal(boss.huntTarget, player, 'boss must focus on the player');
  assert.equal(cow.health, cow.maxHealth, 'boss should ignore nearby animals');

  const beforeAxe = boss.health;
  manager.attack(boss, 10, player, { type: 'axe', tier: 3 });
  assert.equal(beforeAxe - boss.health, 5.5);
  const beforeSword = boss.health;
  manager.attack(boss, 10, player, { type: 'sword', tier: 3 });
  assert.equal(beforeSword - boss.health, 16);

  manager.attack(boss, 9999, player, { type: 'sword', tier: 3 });
  assert.equal(boss.dead, true);
  assert.ok(manager.bossRespawnAt > manager.time, 'defeated boss gets a respawn delay');
});

await test('every creature drops a spawn egg that summons it', () => {
  for (const key of Object.keys(MOBS)) {
    const id = getSpawnEggId(key);
    assert.ok(id, `${key} needs a spawn egg`);
    const item = getItem(id);
    assert.equal(item.use, 'spawn_egg');
    assert.equal(item.spawn, key);
  }

  const eggId = getSpawnEggId('cow');
  const drops = [];
  const manager = new EntityManager({
    scene: { add() {} },
    world: makeFlatWorld(5),
    drops: { spawn(...args) { drops.push(args); } },
    seed: 5,
  });
  const cow = manager.spawnMob('cow', 0.5, 6.02, 0.5);
  manager.attack(cow, 999, { position: { x: 0, y: 6, z: 0 }, creative: false, dead: false });
  assert.ok(
    drops.some(([id, count]) => id === eggId && count === 1),
    'a killed cow must drop exactly one cow egg',
  );
});

await test('using a spawn egg summons its creature', async () => {
  globalThis.location ??= { search: '' };
  const { Game } = await import('../src/game/Game.js');
  const item = getItem(getSpawnEggId('cow'));
  const spawned = [];
  let consumed = 0;
  const fakeGame = {
    world: { ...makeFlatWorld(5), getHeightAt: () => 5 },
    player: {
      position: { x: 0, y: 6, z: 0 },
      getDirection: () => ({ x: 0, y: 0, z: -1 }),
    },
    entities: {
      spawnMob(type, x, y, z, options) {
        spawned.push({ type, x, y, z, options });
        return { name: MOBS[type].name };
      },
    },
    isCreative: () => false,
    inventory: { consumeSelected(count) { consumed += count; } },
    audio: { playClick() {} },
    hud: { toast() {} },
    onInventoryChanged() {},
  };

  assert.equal(Game.prototype.useSpawnEgg.call(fakeGame, item, null), true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].type, 'cow');
  assert.equal(spawned[0].y, 6.02);
  assert.equal(consumed, 1);
});

await test('hostile monsters burn in daylight but not at night, underground or in other dimensions', () => {
  const drops = [];
  const manager = new EntityManager({
    scene: { add() {} },
    world: makeFlatWorld(5),
    drops: { spawn(...args) { drops.push(args); } },
    seed: 6,
  });
  const zombie = manager.spawnMob('zombie', 0.5, 6.02, 0.5);

  manager.updateSunlight(zombie, 10, false, 'overworld');
  assert.equal(zombie.health, zombie.maxHealth, 'no burning at night');
  manager.updateSunlight(zombie, 10, true, 'nether');
  assert.equal(zombie.health, zombie.maxHealth, 'no burning outside the overworld');

  manager.updateSunlight(zombie, 4, true, 'overworld');
  assert.equal(zombie.dead, true, 'an exposed zombie should die in the sun');

  const player = {
    position: { x: 0, y: 6, z: 0 },
    creative: false,
    dead: false,
    damage() {},
  };
  manager.update(1 / 60, player, { day: true });
  assert.ok(!manager.entities.includes(zombie), 'a burned mob is removed like any other kill');
  assert.ok(drops.some(([id]) => id === getSpawnEggId('zombie')), 'sunlight kills still drop eggs');
});

await test('a roof shields monsters from sunlight', () => {
  const world = makeSetWorld(new Set(['0,9,0']));
  const manager = new EntityManager({ scene: { add() {} }, world, drops: null, seed: 6 });
  const zombie = manager.spawnMob('zombie', 0.5, 6.02, 0.5);
  manager.updateSunlight(zombie, 10, true, 'overworld');
  assert.equal(zombie.dead, false, 'a solid roof must block the sun');
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

await test('HUD stacks debug and online players instead of overlapping them', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const start = html.indexOf('<div class="hud-left-stack">');
  const end = html.indexOf('<div id="break-progress"');
  assert.ok(start >= 0 && end > start, 'the shared left HUD stack must exist');
  const stack = html.slice(start, end);
  assert.match(stack, /id="debug"/);
  assert.match(stack, /id="player-list"/);
  assert.match(css, /\.hud-left-stack\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.player-list\s*\{[^}]*position:\s*static/);
});

await test('terrain and sky shaders animate water, glow, stars and selection', async () => {
  globalThis.location ??= { search: '' };
  const { TerrainMaterials } = await import('../src/render/TerrainMaterials.js');
  const materials = new TerrainMaterials({ dispose() {} }, 8);
  assert.equal(materials.solid.uniforms.uWave.value, 0, 'solid terrain must not flow');
  assert.equal(materials.water.uniforms.uWave.value, 1, 'water uses the wave path');
  assert.equal(materials.water.transparent, true);
  assert.equal(materials.water.uniforms.uTime, materials.uniforms.uTime, 'time uniform is shared');
  assert.match(materials.water.vertexShader, /displaced\.y \+= 0\.025 \* uWave/);
  assert.match(materials.water.fragmentShader, /vec4 tex2 = texture\(uAtlas, vec3\(vUv \+ flowB, vTile\)\)/);
  assert.match(materials.water.fragmentShader, /step\(0\.35, vLight\)/);

  const sky = readFileSync(new URL('../src/render/Sky.js', import.meta.url), 'utf8');
  assert.match(sky, /uTime \* 2\.3/, 'stars twinkle over time');
  assert.match(sky, /this\.uniforms\.uTime\.value = this\.time/);
  const game = readFileSync(new URL('../src/game/Game.js', import.meta.url), 'utf8');
  assert.match(game, /selection\.material\.opacity = 0\.55 \+ 0\.25 \* Math\.sin\(this\.sky\.time \* 4\)/);
});

await test('minimap projects world points around the player', () => {
  const center = { x: 100, z: -40 };
  const middle = projectPoint(center, center);
  assert.equal(middle.x, MAP_SIZE / 2);
  assert.equal(middle.y, MAP_SIZE / 2);
  assert.equal(middle.clamped, false);

  const north = projectPoint({ x: 100, z: -88 }, center);
  assert.ok(north.y < middle.y, 'north (-Z) should be drawn above the player');

  const far = projectPoint({ x: 100, z: -1000 }, center);
  assert.equal(far.clamped, true);
  assert.ok(far.y >= 0 && far.y < MAP_SIZE, 'distant markers stay on the canvas');
});

await test('minimap collects respawn, death and remote player markers', () => {
  const markers = mapMarkers({
    spawn: { x: 1, z: 2 },
    lastDeath: { x: 3, z: 4 },
    players: [
      { id: 'anna', name: 'Аня', x: 5, z: 6, spawn: { x: 7, z: 8 }, lastDeath: { x: 9, z: 10 } },
      { id: 'boris', name: 'Боря', x: 0, z: 0 },
    ],
  });
  assert.equal(markers.filter((marker) => marker.type === 'spawn').length, 2);
  assert.equal(markers.filter((marker) => marker.type === 'death').length, 2);
  assert.equal(markers.filter((marker) => marker.type === 'player').length, 2);
  assert.equal(markers[0].label, 'Спавн');
  assert.equal(markers.find((marker) => marker.type === 'death').label, 'Смерть');
  assert.ok(new Set(markers.map((marker) => marker.color)).size > 1);
  assert.equal(playerColor('anna'), playerColor('anna'));
  assert.deepEqual(normalizeMapPoint({ x: '4', z: '5' }), { x: 4, y: 0, z: 5 });
  assert.equal(normalizeMapPoint(null), null);
});

await test('minimap samples loaded terrain and water into an RGBA buffer', () => {
  const world = {
    getHeightAt: (x) => (x < 0 ? SEA_LEVEL - 7 : SEA_LEVEL + 2),
    getBiomeIdAt: (x) => (x < 0 ? BIOME.OCEAN : BIOME.FOREST),
    getBlock: (x, y) => (x < 0 && y <= SEA_LEVEL ? 11 : 1),
  };
  const pixels = sampleTerrain(world, { x: 0, z: 0 }, 8, 8, 2);
  assert.equal(pixels.length, 8 * 8 * 4);
  assert.deepEqual(
    Array.from(pixels.slice(0, 3)),
    terrainColorAt(BIOME.OCEAN, SEA_LEVEL - 7, 11),
    'water columns use a blue depth-tinted colour',
  );
  const landOffset = (4 * 8 + 4) * 4;
  assert.deepEqual(
    Array.from(pixels.slice(landOffset, landOffset + 3)),
    terrainColorAt(BIOME.FOREST, SEA_LEVEL + 2, 1),
    'land uses its biome colour',
  );
  assert.ok(pixels[3] === 255 && pixels[landOffset + 3] === 255);

  const empty = sampleTerrain({}, { x: 0, z: 0 }, 2, 2, 2);
  assert.equal(empty[3], 255, 'unloaded chunks stay opaque');
  assert.ok(empty[0] < 32, 'unloaded chunks draw as dark terrain');
});

await test('fish and axolotl swim, spawn on banks and flop back to water', () => {
  assert.deepEqual(AQUATIC_MOBS.map((mob) => mob.key).sort(), ['axolotl', 'fish']);
  assert.ok(MOBS.fish.aquatic && MOBS.axolotl.aquatic);
  assert.ok(MOBS.fish.drops.some((drop) => drop.id === 473), 'fish drop raw fish');
  assert.equal(getItem(473).key, 'raw_fish');
  assert.ok(!spawnablePassive(BIOME.OCEAN).some((mob) => mob.aquatic), 'fish are not land spawns');
  for (const key of ['fish', 'axolotl']) {
    assert.equal(getItem(getSpawnEggId(key)).spawn, key);
  }

  const world = makeWaterWorld();
  assert.equal(waterSurfaceAt(world, 2, 0), SEA_LEVEL);
  assert.equal(waterSurfaceAt(world, 12, 0), null);
  assert.equal(isInWater(world, { x: 2, y: SEA_LEVEL, z: 0 }), true);
  assert.equal(isInWater(world, { x: 12, y: SEA_LEVEL, z: 0 }), false);

  const player = { position: { x: 200, y: 70, z: 200 }, creative: false, dead: false };
  const fish = new Entity(MOBS.fish, { x: 2.5, y: SEA_LEVEL + 2.5, z: 0.5 });
  const manager = { entities: [fish], onAttack: null };
  assert.equal(fish.collides(world, 2.5, SEA_LEVEL - 0.5, 0.5), false, 'fish move through water');
  for (let i = 0; i < 60; i++) fish.update(1 / 30, world, player, manager);
  assert.equal(fish.inWater, true, 'fish settles in the river');
  assert.ok(
    fish.position.y >= SEA_LEVEL - 2 && fish.position.y <= SEA_LEVEL + 0.5,
    `fish stayed near the surface (y=${fish.position.y})`,
  );

  const stranded = new Entity(MOBS.axolotl, { x: 12.5, y: SEA_LEVEL - 5 + 1.02, z: 0.5 });
  manager.entities.push(stranded);
  stranded.update(1 / 30, world, player, manager);
  assert.ok(stranded.waterTarget, 'a stranded axolotl must find nearby water');
  assert.equal(stranded.state, 'to_water');
  assert.ok(stranded.velocity.x < 0, 'it flops towards the river');
});

await test('beached aquatic mobs suffocate while fish in water survive', () => {
  const drops = [];
  const dryWorld = makeFlatWorld(5);
  const dry = new EntityManager({
    scene: { add() {} },
    world: dryWorld,
    drops: { spawn(...args) { drops.push(args); } },
    seed: 9,
  });
  const stranded = dry.spawnMob('fish', 2.5, 6.02, 2.5);
  const player = { position: { x: 4, y: 6, z: 4 }, creative: false, dead: false };
  for (let i = 0; i < 180; i++) dry.update(1 / 30, player, { day: true });
  assert.equal(stranded.dead, true, 'a fish stuck on land must die');
  assert.ok(drops.some(([id]) => id === getSpawnEggId('fish')), 'suffocated fish drop their egg');

  const waterWorld = makeWaterWorld();
  const wet = new EntityManager({ scene: { add() {} }, world: waterWorld, drops: null, seed: 9 });
  const swimmer = wet.spawnMob('axolotl', 2.5, SEA_LEVEL, 0.5);
  for (let i = 0; i < 180; i++) {
    swimmer.update(1 / 30, waterWorld, player, wet);
    wet.updateStranding(swimmer, 1 / 30);
  }
  assert.equal(swimmer.dead, false, 'aquatic mobs in water stay alive');
});

await test('aquatic mobs are kept in a visible school near the player', () => {
  const world = makeWaterWorld();
  const manager = new EntityManager({ scene: { add() {} }, world, drops: null, seed: 11 });
  const player = { position: { x: 12, y: SEA_LEVEL, z: 0 }, creative: false, dead: false };

  manager.update(1.1, player, { day: true });
  const school = manager.entities.filter((entity) => entity.aquatic);
  assert.ok(school.length >= 2, `expected visible aquatic life, got ${school.length}`);
  assert.ok(
    school.every((entity) => entity.position.x >= 0 && entity.position.x <= 9),
    'the school swims in the nearby river',
  );
  assert.ok(
    school.every((entity) => entity.position.y > SEA_LEVEL - 1 && entity.position.y <= SEA_LEVEL),
    'the school swims at the water surface where it can be seen',
  );

  for (let i = 0; i < 4; i++) manager.ensureAquaticLife(player, 'overworld');
  const count = manager.entities.length;
  manager.ensureAquaticLife(player, 'overworld');
  assert.equal(manager.entities.length, count, 'a full school is not endlessly respawned');

  const nether = new EntityManager({ scene: { add() {} }, world, drops: null, seed: 11 });
  nether.ensureAquaticLife(player, 'nether');
  assert.equal(nether.entities.length, 0, 'aquatic mobs stay in the overworld');
});

await test('aquatic spawn eggs place mobs in water or on the bank', async () => {
  globalThis.location ??= { search: '' };
  const { Game } = await import('../src/game/Game.js');
  const world = makeWaterWorld();
  const spawned = [];
  let consumed = 0;
  const fakeGame = {
    world,
    player: {
      position: { x: 12, y: SEA_LEVEL - 4, z: 0 },
      getDirection: () => ({ x: 0, y: 0, z: -1 }),
    },
    entities: {
      spawnMob(type, x, y, z, options) {
        spawned.push({ type, x, y, z, options });
        return { name: MOBS[type].name };
      },
    },
    isCreative: () => false,
    inventory: { consumeSelected(count) { consumed += count; } },
    audio: { playClick() {} },
    hud: { toast() {} },
    onInventoryChanged() {},
  };
  const egg = getItem(getSpawnEggId('fish'));

  assert.equal(Game.prototype.useSpawnEgg.call(
    fakeGame,
    egg,
    { x: 2, y: SEA_LEVEL, z: 0, id: 11, normal: { y: 1 } },
  ), true);
  assert.equal(spawned[0].type, 'fish');
  assert.ok(spawned[0].y < SEA_LEVEL && spawned[0].y > SEA_LEVEL - 1, 'fish spawns underwater');

  assert.equal(Game.prototype.useSpawnEgg.call(
    fakeGame,
    egg,
    { x: 12, y: SEA_LEVEL - 6, z: 0, id: 1, normal: { y: 1 } },
  ), true);
  assert.equal(spawned[1].y, SEA_LEVEL - 6 + 1.02, 'fish can also be placed on a bank');
  assert.equal(consumed, 2);
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

await test('water generated with the world flows into opened gaps', () => {
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

  // Ordinary generator output: no bucket, no saved fluid level.
  world.setBlock(0, 0, 0, 4);
  world.setBlock(1, 0, 0, 4);
  world.setBlock(0, 1, 0, 11);
  fluids.remove(1, 1, 0);
  fluids.wake(1, 1, 0);
  fluids.step();
  assert.equal(world.getBlock(1, 1, 0), 11, 'natural water should flood the opened cell');
  assert.ok(
    !fluids.serialize().some(([x, y, z]) => x === 0 && y === 1 && z === 0),
    'natural water should not be saved as a player source',
  );
  for (let i = 0; i < 20; i++) fluids.step();
  assert.equal(world.getBlock(0, 1, 0), 11, 'natural water should stay a stable source');

  world.setBlock(2, 4, 0, 11);
  fluids.wake(2, 3, 0);
  fluids.step();
  assert.equal(world.getBlock(2, 3, 0), 11, 'natural water should fall into a hole');
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

  player.damage(5, 'pvp', true);
  assert.equal(player.health, 15, 'PvP damage must bypass creative immunity');
  player.health = 20;
  player.damageCooldown = 0;

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

    lan.sendLanTo(welcome.id, { type: 'give', stack: { id: 440, count: 1 } }, 'host');
    await waitFor(() => clientEvents.some((message) => message.type === 'give'));
    assert.ok(
      !hostEvents.some((message) => message.type === 'give'),
      'a targeted give must not echo back to the host',
    );

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

await test('villager trades consume payment and deliver goods', () => {
  const inventory = new Inventory();
  inventory.setSlot(0, { id: 441, count: 16 });
  const offers = offersForVillager({ position: { x: 10.2, z: -4.7 } });
  assert.equal(offers.length, 4, 'a villager should expose four offers');
  assert.deepEqual(offersForVillager({ position: { x: 10.2, z: -4.7 } }), offers);
  const wheatOffer = offers.find((offer) => offer.give.id === 441) ?? {
    give: { id: 441, count: 16 }, get: { id: 440, count: 1 },
  };
  const result = performTrade(inventory, wheatOffer);
  assert.equal(result, null, 'the goods should fit in the inventory');
  assert.equal(countItem(inventory, 441), 0, 'payment must be consumed');
  assert.equal(countItem(inventory, 440), 1, 'the player must receive emeralds');
  assert.equal(performTrade(inventory, wheatOffer), false, 'a broke player cannot trade');
});

await test('drops keep stable network ids and can be mirrored', () => {
  const scene = { add() {}, remove() {} };
  const icons = new Map([
    [441, { width: 16, height: 16 }],
    [440, { width: 16, height: 16 }],
  ]);
  const assets = { iconCanvasCache: icons, blockIconCache: icons };
  const drops = new ItemDrops(scene, makeFlatWorld(5), assets, null);
  const drop = drops.spawn(441, 3, 1, 6, 2, null, 0.5, 77);
  assert.equal(drop.uid, 77);
  assert.equal(drops.findByUid(77), drop);
  assert.deepEqual(drops.serialize().map((item) => item.uid), [77]);

  drops.applyState([
    { uid: 77, id: 441, count: 2, x: 4, y: 7, z: 5, age: 1 },
    { uid: 78, id: 440, count: 1, x: 6, y: 7, z: 5, age: 0 },
  ]);
  assert.equal(drops.drops.length, 2);
  assert.equal(drops.findByUid(77).count, 2);
  assert.equal(drops.findByUid(77).position.x, 4);
  assert.ok(drops.findByUid(78), 'new host drops should be created locally');

  drops.applyState([{ uid: 78, id: 440, count: 1, x: 6, y: 7, z: 5 }]);
  assert.equal(drops.findByUid(77), null, 'stale drops are removed');
  drops.removeByUid(999);
  assert.equal(drops.drops.length, 1);

  let echoed = 0;
  drops.networkSink = () => { echoed++; };
  assert.ok(drops.spawnRemote(440, 2, 0, 0, 0, null, 0.2, 79), 'remote drop should be mirrored');
  assert.equal(echoed, 0, 'mirrored drops must not be echoed back to the host');
  assert.equal(drops.spawnRemote(440, 1, 0, 0, 0, null, 0.2, 79), null, 'duplicate uid must be ignored');
  drops.networkSink = null;
  drops.dispose();
});

await test('biomes expose distinct palettes, weather and ground cover', () => {
  const ids = Object.values(BIOME);
  assert.equal(ids.length, 12);
  assert.notDeepEqual(
    BIOME_INFO[BIOME.DESERT].grassTint,
    BIOME_INFO[BIOME.FOREST].grassTint,
  );
  assert.notEqual(BIOME_INFO[BIOME.DESERT].fog, BIOME_INFO[BIOME.FOREST].fog);
  assert.equal(biomeWeather(BIOME.DESERT), 'none');
  assert.equal(biomeWeather(BIOME.SNOWY), 'snow');
  assert.equal(biomeWeather(BIOME.SWAMP), 'rain');
  assert.equal(getBiomeInfo(999).name, BIOME_INFO[BIOME.PLAINS].name);
  for (const id of ids) {
    const info = BIOME_INFO[id];
    assert.ok(info.name, `biome ${id} needs a name`);
    assert.equal(info.grassTint.length, 3);
    assert.equal(info.leavesTint.length, 3);
    assert.equal(info.waterTint.length, 3);
    assert.ok(Array.isArray(info.groundCover));
    for (const [block] of info.groundCover) {
      assert.ok(getBlock(block), `biome ${id} references unknown block ${block}`);
    }
  }
});

await test('generated chunks place climate-appropriate ground cover', () => {
  const seen = new Set();
  for (let cx = -2; cx <= 2 && seen.size < 3; cx++) {
    for (let cz = -2; cz <= 2 && seen.size < 3; cz++) {
      const { blocks } = generateChunk(cx, cz, 0x5eed);
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          for (let y = SEA_LEVEL + 1; y < WORLD_HEIGHT - 18; y++) {
            const id = blocks[localIndex(x, y, z)];
            if (![201, 202, 203, 204].includes(id)) continue;
            seen.add(id);
            assert.ok(
              getBlock(blocks[localIndex(x, y - 1, z)]).solid,
              'ground cover must sit on solid ground',
            );
          }
        }
      }
    }
  }
  assert.ok(seen.size >= 2, `expected several kinds of ground cover, got ${[...seen]}`);
});

await test('mesher bakes biome tints into the terrain geometry', () => {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  blocks[localIndex(8, 10, 8)] = 2; // grass: climate-sensitive top and side
  blocks[localIndex(10, 10, 10)] = 1; // stone: must stay neutral
  const biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

  const tintAt = (biome, tile) => {
    biomes.fill(biome);
    const mesh = meshChunk(buildPaddedVolume(blocks, () => null), 0, 0, null, biomes).solid;
    assert.ok(mesh, 'the test chunk should produce geometry');
    assert.equal(mesh.tints.length, mesh.vertexCount * 3);
    for (let i = 0; i < mesh.vertexCount; i++) {
      if (mesh.tiles[i] === tile) {
        return [mesh.tints[i * 3], mesh.tints[i * 3 + 1], mesh.tints[i * 3 + 2]];
      }
    }
    return null;
  };

  const desertGrass = tintAt(BIOME.DESERT, TILE.grass_top);
  const forestGrass = tintAt(BIOME.FOREST, TILE.grass_top);
  const expected = BIOME_INFO[BIOME.DESERT].grassTint.map((value) => Math.round(value * 128));
  assert.deepEqual(desertGrass, expected);
  assert.notDeepEqual(desertGrass, forestGrass, 'biomes must not share one tint');
  assert.deepEqual(tintAt(BIOME.DESERT, TILE.stone), [128, 128, 128]);
});

await test('weather follows the camera and switches between rain and snow', () => {
  const weather = new Weather({ add() {} });
  const camera = { position: { x: 5, y: 12, z: -3 } };
  weather.update(camera, 'rain', 1 / 60);
  assert.equal(weather.mode, 'rain');
  assert.equal(weather.points.visible, true);
  assert.deepEqual(
    [weather.points.position.x, weather.points.position.y, weather.points.position.z],
    [5, 12, -3],
  );
  // Pin one flake away from the wrap-around edge so the fall is deterministic.
  const startY = 5;
  weather.positions[1] = startY;
  weather.update(camera, 'snow', 0.5);
  assert.ok(weather.positions[1] < startY, 'particles fall over time');
  assert.equal(weather.mode, 'snow');
  assert.equal(weather.material.size, 0.11, 'snowflakes are larger than raindrops');
  weather.update(camera, null, 1 / 60);
  assert.equal(weather.points.visible, false, 'clear biomes show no precipitation');
  weather.dispose();
});

await test('ambient air changes with biome, daylight and dimension', () => {
  assert.equal(ambienceModeFor({ category: 'forest', daylight: 1 }), 'pollen');
  assert.equal(ambienceModeFor({ category: 'birch', daylight: 0.8 }), 'pollen');
  assert.equal(ambienceModeFor({ category: 'swamp', daylight: 0.8 }), 'petals');
  assert.equal(ambienceModeFor({ category: 'forest', daylight: 0.1 }), 'fireflies');
  assert.equal(ambienceModeFor({ category: 'snowy', daylight: 1 }), 'ice');
  assert.equal(ambienceModeFor({ category: 'desert', daylight: 1 }), 'dust');
  assert.equal(ambienceModeFor({ dimension: 'nether' }), 'embers');
  assert.equal(ambienceModeFor({ dimension: 'end' }), 'void');

  const ambience = new Ambience({ add() {} }, 40);
  const camera = { position: { x: 5, y: 12, z: -3 } };
  const start = Array.from(ambience.positions.slice(0, 3));
  ambience.update(camera, 'pollen', 0.5);
  assert.equal(ambience.mode, 'pollen');
  assert.equal(ambience.points.visible, true);
  assert.deepEqual(
    [ambience.points.position.x, ambience.points.position.y, ambience.points.position.z],
    [5, 12, -3],
  );
  assert.notDeepEqual(Array.from(ambience.positions.slice(0, 3)), start, 'motes drift over time');
  const pollen = ambience.baseColors[1];
  ambience.update(camera, 'fireflies', 0.1);
  assert.notEqual(ambience.baseColors[1], pollen, 'each mood has its own palette');
  assert.equal(ambience.material.blending, THREE.AdditiveBlending, 'night motes glow');
  ambience.clear();
  assert.equal(ambience.points.visible, false);
  ambience.dispose();
});

await test('rainbow stays fixed in the world and fades after rain', () => {
  const rainbow = new Rainbow({ add() {} });
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, 70, -5);
  camera.rotation.set(0.08, 0.6, 0);
  camera.updateMatrixWorld();

  rainbow.update(camera, 'rain', 1, 0.5);
  assert.equal(rainbow.mesh.visible, true);
  assert.ok(rainbow.opacity > 0.5, 'rain leaves a visible arc');
  const expected = camera.position.clone().addScaledVector(RAINBOW_ANCHOR, 150);
  assert.ok(rainbow.mesh.position.distanceTo(expected) < 1e-5, 'the arc hangs at a fixed world bearing');
  assert.equal(rainbow.mesh.rotation.x, 0, 'the arc stays upright');
  assert.equal(rainbow.mesh.rotation.z, 0, 'the arc never tilts with head bob');
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(rainbow.mesh.quaternion);
  const towardsCamera = camera.position.clone().sub(rainbow.mesh.position).normalize();
  assert.ok(normal.dot(towardsCamera) > 0.999, 'the arc faces the player');

  // Turning the head must not drag the rainbow across the sky.
  const still = rainbow.mesh.position.clone();
  const yaw = rainbow.mesh.quaternion.clone();
  camera.rotation.set(-0.9, 2.7, 0.15);
  camera.updateMatrixWorld();
  rainbow.update(camera, 'rain', 1, 0.5);
  assert.ok(rainbow.mesh.position.distanceTo(still) < 1e-5, 'looking around leaves the arc in place');
  assert.ok(rainbow.mesh.quaternion.angleTo(yaw) < 1e-6, 'head yaw does not rotate the arc');
  assert.ok(rainbow.geometry.getAttribute('color').count > 1000, 'seven bands need real geometry');

  rainbow.update(camera, null, 1, 2);
  assert.equal(rainbow.opacity, 0, 'the arc fades once the memory expires');
  assert.equal(rainbow.mesh.visible, false);
  rainbow.reset();
  assert.equal(rainbow.rainTimer, 0);
  rainbow.dispose();
});

await test('block debris samples atlas colours, flies and expires', () => {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) {
    data[i * 4] = 220;
    data[i * 4 + 1] = 40;
    data[i * 4 + 2] = 30;
    data[i * 4 + 3] = 255;
  }
  const canvas = {
    width: 16,
    height: 16,
    getContext: () => ({ getImageData: () => ({ data }) }),
  };
  const tile = getBlock(1).faceTiles[0];
  const assets = { tileCanvases: new Map([[tile, canvas]]) };
  const color = averageTileColor(assets, tile);
  assert.ok(color.r > color.g && color.g > color.b, 'the atlas tile supplies a warm stone colour');
  assert.equal(averageTileColor(assets, 999), null);

  const particles = new BlockParticles({ add() {} }, assets, 64);
  assert.ok(particles.blockColor(1).r > 0.5, 'block colours are cached from the atlas');
  particles.burst(0.5, 4.5, -1.5, 1, 12);
  assert.equal(particles.points.visible, true);
  assert.ok(particles.life[0] > 0);
  const y = particles.positions[1];
  particles.update(0.05);
  assert.notEqual(particles.positions[1], y, 'debris is launched and pulled by gravity');
  particles.update(2);
  assert.equal(particles.life[0], 0);
  assert.equal(particles.points.visible, false, 'expired debris is culled');
  particles.dispose();
});

await test('breaking and mirrored LAN edits spawn block debris', async () => {
  globalThis.location ??= { search: '' };
  const { Game } = await import('../src/game/Game.js');
  const bursts = [];
  const particles = {
    burst(...args) { bursts.push(args); },
  };
  const game = {
    inventory: { selectedStack: null, damageSelected: () => false },
    world: { setBlock: () => true },
    redstone: null,
    fluids: null,
    sendNetworkEdit() {},
    blockParticles: particles,
    audio: { playBreak() {} },
    isCreative: () => true,
    onInventoryChanged() {},
  };
  Game.prototype.breakBlock.call(game, { x: 3, y: 9, z: -2 }, { id: 17 });
  assert.deepEqual(bursts[0].slice(0, 4), [3.5, 9.5, -1.5, 17]);

  Game.prototype.applyNetworkEdit.call({
    world: {
      getBlock: () => 17,
      setBlock: () => true,
      isChunkLoadedAt: () => true,
    },
    blockParticles: particles,
  }, { x: 1, y: 8, z: 2, id: 0 });
  assert.deepEqual(bursts[1].slice(0, 4), [1.5, 8.5, 2.5, 17]);
});

await test('new worlds open with a replayable welcome banner', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(html, /id="welcome-banner"/);
  assert.match(html, /id="welcome-title"/);
  assert.match(css, /\.welcome-banner\.welcome-play\s*\{[^}]*welcome-life/);

  const classes = new Set(['hidden']);
  const style = {
    setProperty(key, value) { this[key] = value; },
  };
  const title = { textContent: '' };
  const subtitle = { textContent: '' };
  const hud = Object.create(HUD.prototype);
  hud.welcomeEl = {
    style,
    offsetWidth: 620,
    classList: {
      add(...names) { for (const name of names) classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
    },
  };
  hud.welcomeTitleEl = title;
  hud.welcomeSubtitleEl = subtitle;
  hud.showWelcome('Мир проснулся', 'оглянись', 80);
  assert.equal(title.textContent, 'Мир проснулся');
  assert.equal(subtitle.textContent, 'оглянись');
  assert.equal(style['--welcome-duration'], '80ms');
  assert.ok(classes.has('welcome-play') && !classes.has('hidden'));

  hud.showWelcome('Ещё раз', '', 80);
  assert.ok(classes.has('welcome-play'), 'the animation can be replayed');
});

await test('animals can be tamed, fed, bred and grow from babies', () => {
  const world = makeFlatWorld(5);
  const drops = [];
  const manager = new EntityManager({
    scene: { add() {} },
    world,
    drops: { spawn(...args) { drops.push(args); } },
    seed: 13,
  });
  const player = { position: { x: 0.5, y: 6, z: 0.5 }, creative: false, dead: false };

  const originalRandom = Math.random;
  Math.random = () => 0; // guarantee the taming roll succeeds
  try {
    const wolf = manager.spawnMob('wolf', 1, 6.02, 1);
    assert.equal(manager.feed(wolf, 430, player), null, 'a wild wolf ignores meat');
    assert.equal(manager.feed(wolf, 422, player), 'tamed');
    assert.equal(wolf.tamed, true);
    assert.equal(wolf.owner, player);
    assert.equal(manager.feed(wolf, 430, player), 'loved', 'a tamed wolf can breed');
  } finally {
    Math.random = originalRandom;
  }

  const cowA = manager.spawnMob('cow', 2, 6.02, 2);
  const cowB = manager.spawnMob('cow', 3, 6.02, 2);
  cowA.health = 5;
  assert.equal(manager.feed(cowA, 441, player), 'loved');
  assert.equal(cowA.health, 7, 'feeding heals the animal');
  assert.equal(manager.feed(cowB, 441, player), 'bred');
  const baby = manager.entities.find((entity) => entity.baby && entity.type === 'cow');
  assert.ok(baby, 'a baby cow should appear');
  assert.equal(baby.growTimer, ANIMAL_TIMING.growthSeconds);
  assert.ok(cowA.breedingCooldown > 0 && cowB.breedingCooldown > 0);
  assert.equal(manager.feed(cowA, 441, player), 'fed', 'cooldown prevents instant breeding');
  assert.equal(manager.feed(cowB, 1, player), null, 'wrong food is not consumed');
  baby.growTimer = 1;
  assert.equal(manager.feed(baby, 441, player), 'grown');
  assert.equal(baby.baby, false, 'enough food finishes growing the baby');
});

await test('pets follow and sit, animals panic, lay eggs and regrow wool', () => {
  const world = makeFlatWorld(5);
  const drops = [];
  const manager = new EntityManager({
    scene: { add() {} },
    world,
    drops: { spawn(...args) { drops.push(args); } },
    seed: 17,
  });
  const player = { position: { x: 0.5, y: 6, z: 0.5 }, creative: false, dead: false };

  const pet = manager.spawnMob('wolf', 1, 6.02, 1, { tamed: true, owner: player });
  assert.equal(pet.isPet, true);
  pet.position.set(8.5, 6.02, 0.5);
  pet.update(1 / 30, world, player, manager);
  assert.equal(pet.state, 'follow');
  assert.ok(pet.velocity.x < 0, 'a pet walks towards its owner');
  const movingSpeed = Math.abs(pet.velocity.x);
  pet.sitting = true;
  pet.update(1 / 30, world, player, manager);
  assert.equal(pet.state, 'sit');
  assert.ok(Math.abs(pet.velocity.x) < movingSpeed, 'a sitting pet slows down');

  const cow = manager.spawnMob('cow', 2, 6.02, 2);
  cow.hit(1, { position: { x: 0, z: 0 } });
  cow.position.set(2.5, 6.02, 0.5);
  cow.update(1 / 30, world, player, manager);
  assert.equal(cow.state, 'flee');
  assert.ok(cow.velocity.x < 0, 'panic runs away from the attacker');

  const chicken = manager.spawnMob('chicken', 4, 6.02, 4);
  drops.length = 0;
  chicken.eggTimer = 0.01;
  chicken.update(0.02, world, player, manager);
  assert.ok(drops.some(([id]) => id === 428), 'chickens lay eggs on a timer');

  const sheep = manager.spawnMob('sheep', 5, 6.02, 5, { sheared: true });
  sheep.woolTimer = 0.02;
  sheep.update(0.03, world, player, manager);
  assert.equal(sheep.sheared, false, 'wool grows back after the timer');

  sheep.sheared = true; // sheared again before the kill
  drops.length = 0;
  manager.dropLoot(sheep);
  assert.equal(
    drops.some(([id]) => id === 42),
    false,
    'a shorn sheep carries no wool when killed',
  );
  assert.ok(drops.some(([id]) => id === 434), 'mutton still drops');

  pet.sitting = true;
  pet.baby = true;
  pet.growTimer = 12;
  const data = pet.serialize();
  const restoredManager = new EntityManager({ scene: { add() {} }, world, drops: null, seed: 17 });
  restoredManager.load([data], player.position, player);
  const restored = restoredManager.entities[0];
  assert.equal(restored.tamed, true);
  assert.equal(restored.owner, player, 'saved pets know their current owner');
  assert.equal(restored.sitting, true);
  assert.equal(restored.baby, true);
  assert.equal(restored.growTimer, 12);
  assert.equal(restored.serialize().type, 'wolf');
});

await test('right-clicking an animal with its food feeds it', async () => {
  globalThis.location ??= { search: '' };
  const { Game } = await import('../src/game/Game.js');
  let consumed = 0;
  const toasts = [];
  const fed = [];
  const fakeGame = {
    player: {
      eyePosition: { x: 0, y: 2, z: 0 },
      getDirection: () => ({ x: 0, y: 0, z: -1 }),
      sneaking: false,
    },
    entities: {
      pick() { return { entity: { type: 'cow' } }; },
      feed(entity, itemId) {
        fed.push(itemId);
        return itemId === 441 ? 'fed' : null;
      },
    },
    isCreative: () => false,
    inventory: { consumeSelected(count) { consumed += count; } },
    audio: { playClick() {} },
    hud: { toast(message) { toasts.push(message); } },
    onInventoryChanged() {},
  };

  assert.equal(Game.prototype.feedEntity.call(fakeGame, { id: 441 }), true);
  assert.deepEqual(fed, [441]);
  assert.equal(consumed, 1);
  assert.equal(toasts.length, 1);
  assert.equal(Game.prototype.feedEntity.call(fakeGame, { id: 1 }), false);
  assert.equal(consumed, 1, 'refused food stays in the inventory');
  fakeGame.player.sneaking = true;
  assert.equal(Game.prototype.feedEntity.call(fakeGame, { id: 441 }), false);

  const picked = { type: 'sheep', sheared: false, position: { x: 0, y: 6, z: 0 } };
  const shearsGame = {
    ...fakeGame,
    player: { ...fakeGame.player, sneaking: false },
    entities: { pick() { return { entity: picked }; } },
    drops: { spawn() {} },
    inventory: { damageSelected() { return false; } },
  };
  assert.equal(Game.prototype.useSpecialItem.call(shearsGame, { use: 'shears' }, null), true);
  assert.equal(picked.sheared, true);
  assert.equal(picked.woolTimer, ANIMAL_TIMING.woolRegrowSeconds);
});

await test('village houses are furnished with real beds', () => {
  const seed = 424242;
  const spawn = findSpawn(seed);
  const village = nearbyVillages(spawn.x, spawn.z, seed)[0];
  let feet = 0;
  let heads = 0;
  for (let cz = Math.floor((village.z - 40) / CHUNK_SIZE); cz <= Math.floor((village.z + 40) / CHUNK_SIZE); cz++) {
    for (let cx = Math.floor((village.x - 40) / CHUNK_SIZE); cx <= Math.floor((village.x + 40) / CHUNK_SIZE); cx++) {
      const chunk = generateChunk(cx, cz, seed);
      for (const id of chunk.blocks) {
        const state = decodeState(id);
        if (state?.type !== 'bed') continue;
        if (state.head) heads++;
        else feet++;
      }
    }
  }
  assert.ok(feet >= 14, `expected fourteen house beds, found ${feet}`);
  assert.ok(heads >= 14, `expected fourteen bed headboards, found ${heads}`);
});

await test('villages follow the natural terrain instead of flattening it', () => {
  const seed = 424242;
  const generator = new WorldGenerator(seed);
  const spawn = findSpawn(seed);
  const village = nearbyVillages(spawn.x, spawn.z, seed)[0];
  const plan = generator.villagePlan(village);
  assert.equal(plan.houses.length, 14, 'the village grew to fourteen houses');
  assert.ok(
    new Set(plan.houses.map((house) => house.style)).size >= 10,
    'houses should come in many styles',
  );

  // Nothing outside the built plots may be touched: no terrace disc, no
  // mounds. Every free column keeps exactly the height the noise gave it.
  const inPlots = (x, z) => plan.plots.some((plot) => (
    x >= plot.x0 && x <= plot.x1 && z >= plot.z0 && z <= plot.z1
  ));
  const tops = new Set();
  let free = 0;
  for (let dz = -40; dz <= 40; dz++) {
    for (let dx = -40; dx <= 40; dx++) {
      if (Math.hypot(dx, dz) > 40) continue;
      const wx = village.x + dx;
      const wz = village.z + dz;
      if (inPlots(wx, wz)) continue;
      const surface = generator.villageSurfaceY(village, wx, wz);
      assert.equal(surface, generator.heightAt(wx, wz), `free ground at ${wx},${wz} stays natural`);
      tops.add(surface);
      free++;
    }
  }
  assert.ok(free > 3000, `most of the village area is untouched ground, got ${free}`);
  assert.ok(tops.size >= 8, `the terrain keeps its relief, got ${tops.size} distinct tops`);

  // Column tops must match the surface the generator actually built: plot
  // levels inside the plots, raw terrain everywhere else.
  const chunks = new Map();
  const chunkAt = (wx, wz) => {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    if (!chunks.has(key)) chunks.set(key, generator.generateChunk(cx, cz));
    return chunks.get(key);
  };
  for (let dz = -24; dz <= 24; dz++) {
    for (let dx = -24; dx <= 24; dx++) {
      const wx = village.x + dx;
      const wz = village.z + dz;
      const chunk = chunkAt(wx, wz);
      const lx = wx - Math.floor(wx / CHUNK_SIZE) * CHUNK_SIZE;
      const lz = wz - Math.floor(wz / CHUNK_SIZE) * CHUNK_SIZE;
      assert.equal(
        chunk.heights[lx + lz * CHUNK_SIZE],
        generator.villageSurfaceY(village, wx, wz),
        `column tops follow the built surface at ${wx},${wz}`,
      );
    }
  }

  // The free ground keeps its real surface blocks: dirt fill or a dug pit
  // here would be exactly the old bulges next to the village.
  const naturalSurfaces = new Set([1, 2, 8, 10, 18, 38, 49]);
  for (let dz = -36; dz <= 36; dz++) {
    for (let dx = -36; dx <= 36; dx++) {
      const wx = village.x + dx;
      const wz = village.z + dz;
      if (inPlots(wx, wz)) continue;
      const h = generator.heightAt(wx, wz);
      if (h <= SEA_LEVEL + 1) continue;
      const chunk = chunkAt(wx, wz);
      const lx = wx - Math.floor(wx / CHUNK_SIZE) * CHUNK_SIZE;
      const lz = wz - Math.floor(wz / CHUNK_SIZE) * CHUNK_SIZE;
      const id = chunk.blocks[lx + (lz << 4) + (h << 8)];
      assert.ok(
        naturalSurfaces.has(id),
        `untouched ground at ${wx},${wz} keeps its natural surface, got block ${id}`,
      );
    }
  }

  // Every doorstep is walkable: the floor never sits more than one block
  // away from the lane that reaches it.
  for (const house of plan.houses) {
    const doorX = house.door === 1 ? house.w - 1 : house.door === 3 ? 0 : Math.floor(house.w / 2);
    const doorZ = house.door === 0 ? 0 : house.door === 2 ? house.d - 1 : Math.floor(house.d / 2);
    const stepX = house.door === 1 ? 1 : house.door === 3 ? -1 : 0;
    const stepZ = house.door === 2 ? 1 : house.door === 0 ? -1 : 0;
    const lane = generator.heightAt(
      village.x + house.ox + doorX + stepX,
      village.z + house.oz + doorZ + stepZ,
    );
    assert.ok(
      Math.abs(house.base - lane) <= 1,
      `doorstep of style ${house.style} is walkable (floor ${house.base}, lane ${lane})`,
    );
  }
});

await test('creatures cannot pass through each other or the player', () => {
  const world = makeFlatWorld(0);
  const player = {
    position: { x: 0.5, y: 1, z: 0.5 },
    creative: true,
    dead: false,
    damage() {},
  };
  const manager = new EntityManager({ scene: { add() {} }, world, drops: null, seed: 9 });
  const a = manager.spawnMob('cow', 0.5, 1, 0.5);
  const b = manager.spawnMob('cow', 0.65, 1, 0.5);
  manager.update(1 / 60, player, { day: true, creative: true });
  assert.ok(
    Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) >= 0.85,
    'two cows should be pushed apart',
  );
  const before = { x: player.position.x, z: player.position.z };
  const villager = manager.spawnMob('villager', 0.45, 1, 0.5);
  manager.update(1 / 60, player, { day: true, creative: true });
  assert.deepEqual(
    { x: player.position.x, z: player.position.z },
    before,
    'the player is not shoved by mobs',
  );
  assert.ok(
    Math.hypot(villager.position.x - player.position.x, villager.position.z - player.position.z) >= 0.55,
    'a villager should be pushed out of the player',
  );
});

await test('creatures open doors and closed doors swing back after traffic leaves', () => {
  const world = {
    getBlock(x, y, z) {
      if (y === 0) return 1;
      if (x === 1 && z === 0 && y === 1) return getDoorId(2, false, 0);
      if (x === 1 && z === 0 && y === 2) return getDoorId(2, false, 1);
      return 0;
    },
    isSolidAt(x, y, z) {
      return getBlock(this.getBlock(x, y, z))?.solid === true;
    },
    isChunkLoadedAt() { return true; },
  };
  const player = { position: { x: 20, y: 1, z: 20 }, creative: true, dead: false, damage() {} };
  const manager = new EntityManager({ scene: { add() {} }, world, drops: null, seed: 10 });
  const requests = [];
  manager.onDoorRequest = (x, y, z, open) => requests.push({ x, y, z, open });
  const villager = manager.spawnMob('villager', 0.5, 1, 0.5, { home: { x: 2, z: 0 } });
  villager.steerAround(world, 1, 0, 0.1, manager);
  assert.ok(requests.some((request) => request.open), 'a blocked creature should request the door to open');

  manager.time = 100;
  villager.position.set(8.5, 1, 8.5);
  manager.updateDoorTimers(player);
  assert.ok(requests.some((request) => !request.open), 'unused doors close again');
});

await test('villagers claim beds, sleep at night and wake at sunrise', () => {
  const world = makeFlatWorld(0);
  world.getBlock = (x, y, z) => {
    if (y === 0) return 1;
    if (x === 3 && y === 1 && z === 3) return getBedId(2, false);
    if (x === 3 && y === 1 && z === 4) return getBedId(2, true);
    return 0;
  };
  const player = { position: { x: 20, y: 1, z: 20 }, creative: true, dead: false, damage() {} };
  const manager = new EntityManager({ scene: { add() {} }, world, drops: null, seed: 11 });
  const sleeper = manager.spawnMob('villager', 5.5, 1, 5.5, { home: { x: 4, z: 4 } });
  manager.updateVillagerBeds();
  assert.deepEqual(sleeper.bed, { x: 3, y: 1, z: 3 }, 'the villager should claim the bed foot');
  const other = manager.spawnMob('villager', 5.5, 1, 6.5, { home: { x: 4, z: 4 } });
  manager.updateVillagerBeds();
  assert.equal(other.bed, null, 'a bed can only be claimed once');
  for (let i = 0; i < 240; i++) {
    manager.update(1 / 30, player, { day: false, creative: true, timeOfDay: 18000 });
  }
  assert.equal(sleeper.sleeping, true, 'the villager should lie down at night');
  assert.ok(Math.abs(sleeper.position.x - 3.5) < 0.2, 'the sleeper rests on the bed');
  manager.update(1 / 30, player, { day: true, creative: true, timeOfDay: 6000 });
  assert.equal(sleeper.sleeping, false, 'sunrise wakes the villager');
});

await test('village chests hold deterministic useful loot without restocking placed chests', async () => {
  const loot = villageChestLoot(10, 65, 20).filter(Boolean);
  assert.ok(loot.length >= 3, 'generated chests should contain several stacks');
  assert.deepEqual(villageChestLoot(10, 65, 20), villageChestLoot(10, 65, 20));
  assert.notDeepEqual(villageChestLoot(11, 65, 20), villageChestLoot(10, 65, 20));
  for (const stack of loot) assert.ok(getItem(stack.id), `loot item ${stack.id} must exist`);

  const { Game } = await import('../src/game/Game.js');
  const seed = 424242;
  const village = nearbyVillages(findSpawn(seed).x, findSpawn(seed).z, seed)[0];
  let target = { x: village.x + 5, y: village.y + 1, z: village.z + 5, id: 200 };
  const containers = new ContainerStorage();
  let slots = containers.slotsAt(target.x, target.y, target.z);
  let opened = null;
  const fakeGame = {
    world: { seed },
    player: { sneaking: false, raycast: () => target },
    inventory: {},
    containers,
    onInventoryChanged() {},
    openInventory(index, options) { opened = options; },
  };
  Game.prototype.useItem.call(fakeGame);
  assert.ok(opened?.chest);
  assert.ok(slots.some(Boolean), 'a village chest should be stocked on first open');
  assert.equal(containers.isLooted(target.x, target.y, target.z), true);

  slots.fill(null); // the player emptied the chest
  Game.prototype.useItem.call(fakeGame);
  assert.ok(slots.every((stack) => stack === null), 'emptied chests are not refilled');

  target = { x: village.x + 9, y: village.y + 1, z: village.z + 9, id: 200 };
  containers.markLooted(target.x, target.y, target.z);
  slots = containers.slotsAt(target.x, target.y, target.z);
  Game.prototype.useItem.call(fakeGame);
  assert.ok(slots.every((stack) => stack === null), 'player-placed chests stay empty');

  target = { x: 1000, y: 70, z: 1000, id: 200 };
  slots = containers.slotsAt(target.x, target.y, target.z);
  Game.prototype.useItem.call(fakeGame);
  assert.ok(slots.every((stack) => stack === null), 'chests outside villages stay empty');
});

await test('spears, bows and arrows extend the weapon roster', async () => {
  const materials = ['wood', 'stone', 'iron', 'diamond', 'gold', 'netherite'];
  materials.forEach((material, index) => {
    assert.equal(SPEAR_IDS[material], 324 + index);
    assert.equal(getToolInfo(SPEAR_IDS[material]).type, 'spear');
    assert.ok(RECIPES.some((recipe) => recipe.id === `${material}_spear`));
  });
  assert.equal(getToolInfo(303).type, 'sword', 'existing tool ids must not shift');
  assert.equal(getItem(ITEM_IDS.BOW).tool.type, 'bow');
  assert.equal(getItem(ITEM_IDS.ARROW).stack, 64);
  const spear = findRecipe([null, 403, null, null, 403, null, 403, 400, null], 3);
  assert.equal(spear?.result.id, SPEAR_IDS.iron);
  assert.ok(RECIPES.some((recipe) => recipe.id === 'bow'));
  assert.ok(RECIPES.some((recipe) => recipe.id === 'arrow'));

  const { Game } = await import('../src/game/Game.js');
  const game = {
    inventory: { selectedStack: { id: SPEAR_IDS.iron } },
    isCreative: () => false,
  };
  assert.ok(Game.prototype.getAttackDamage.call(game) > 4, 'a spear hits harder than bare hands');
  let consumed = 0;
  let attack = null;
  let reach = 0;
  const bowGame = {
    ...game,
    attackCooldown: 0,
    riding: false,
    net: null,
    inventory: {
      selectedStack: { id: ITEM_IDS.BOW },
      consumeItem(id) { if (id === ITEM_IDS.ARROW) { consumed++; return true; } return false; },
      damageSelected() { return false; },
    },
    player: { eyePosition: {}, getDirection: () => ({}), raycast: () => null },
    entities: {
      pick(eye, direction, maxDistance) {
        reach = maxDistance;
        return { entity: {}, distance: 6 };
      },
      attack(entity, damage, player, tool) { attack = { damage, tool }; return false; },
    },
    audio: { playClick() {} },
    hud: { toast() {} },
    tryAttackPlayer() { return false; },
    getAttackDamage() { return 6; },
  };
  assert.equal(Game.prototype.tryAttack.call(bowGame), true);
  assert.equal(consumed, 1, 'a bow shot consumes one arrow');
  assert.ok(reach >= 12, 'bows reach farther than melee weapons');
  assert.equal(attack.tool.type, 'bow');
});

await test('riverbeds are sealed and fluids settle during world generation', () => {
  let exposedAir = 0;
  let lavaOnWater = 0;
  let caveWater = 0;
  let waterCells = 0;
  for (const seed of [0x1234abcd, 424242]) {
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const { blocks, heights } = generateChunk(cx, cz, seed);
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const floor = heights[x + z * CHUNK_SIZE];
            for (let y = 1; y <= SEA_LEVEL; y++) {
              const id = blocks[localIndex(x, y, z)];
              const wetNeighbor = (nx, ny, nz) => {
                if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE || ny < 1 || ny > SEA_LEVEL) return false;
                const n = blocks[localIndex(nx, ny, nz)];
                return n === 11 || n === 19;
              };
              const side = wetNeighbor(x + 1, y, z) || wetNeighbor(x - 1, y, z)
                || wetNeighbor(x, y, z + 1) || wetNeighbor(x, y, z - 1);
              if (id === 0) {
                // No air pocket may face open water: that is the "hole into a
                // cave" you could see in a riverbed or ocean floor.
                if (side || wetNeighbor(x, y + 1, z)) exposedAir++;
              } else if (id === 30 && (side || wetNeighbor(x, y + 1, z))) {
                lavaOnWater++;
              } else if (id === 11) {
                waterCells++;
                // Water above its own column floor can only come from the
                // generation-time flood filling a cave cavity.
                if (floor >= y && y < SEA_LEVEL) caveWater++;
                // Unsupported water (air hanging underneath) is unphysical.
                if (y < SEA_LEVEL && blocks[localIndex(x, y + 1, z)] === 0) exposedAir++;
              }
            }
          }
        }
      }
    }
  }
  assert.equal(exposedAir, 0, 'no generated air cell may touch water at or below sea level');
  assert.equal(lavaOnWater, 0, 'lava touching generated water must harden into obsidian');
  assert.ok(waterCells > 20000, `expected real water bodies, found ${waterCells} cells`);
  assert.ok(caveWater > 0, 'water physics must flood cave cavities below sea level');
});

await test('the overworld raises tall mountain ranges', () => {
  const generator = new WorldGenerator(2266711628);
  let max = 0;
  let min = WORLD_HEIGHT;
  let above112 = 0;
  let above128 = 0;
  let belowSea = 0;
  let n = 0;
  for (let x = -1500; x <= 1500; x += 10) {
    for (let z = -1500; z <= 1500; z += 10) {
      const h = generator.heightAt(x, z);
      n++;
      if (h > max) max = h;
      if (h < min) min = h;
      if (h > 112) above112++;
      if (h > 128) above128++;
      if (h < SEA_LEVEL) belowSea++;
    }
  }
  assert.ok(max >= 150, `mountain peaks should tower well above the old cap, got ${max}`);
  assert.ok(above128 > 0, 'snow-capped summits must exist above the snow line');
  assert.ok(above112 / n > 0.01, `mountains biome should cover real ranges, got ${(above112 / n * 100).toFixed(2)}%`);
  assert.ok(belowSea / n > 0.05, 'oceans and rivers must survive the height changes');
  assert.ok(min >= 6 && max < WORLD_HEIGHT - 18, 'heights stay inside the clamped build range');
});

await test('dynamite has a block, texture, item and recipe', () => {
  const tnt = getBlock(205);
  assert.equal(tnt.key, 'tnt');
  assert.equal(tnt.name, 'Динамит');
  assert.equal(tnt.faceTiles[0], TILE.tnt);
  assert.ok(TILE.tnt < TEXTURE_COUNT, 'the tnt tile belongs to the atlas');
  const item = getItem(205);
  assert.equal(item.placeBlock, 205, 'block items are derived automatically');
  const recipe = findRecipe([424, 8, 424, 8, 424, 8, 424, 8, 424], 3);
  assert.equal(recipe.result.id, 205, 'five gunpowder and four sand craft dynamite');
  assert.equal(recipe.result.count, 1);
});

await test('explosions remove blocks, spare bedrock and chain into dynamite', async () => {
  globalThis.location ??= { search: '' };
  const { Game } = await import('../src/game/Game.js');
  const key = (x, y, z) => `${x},${y},${z}`;
  const storage = new Map([
    [key(0, 5, 0), 1],
    [key(1, 5, 0), 13],
    [key(0, 4, 0), 11],
    [key(0, 5, 1), 25],
    [key(2, 5, 0), 205],
  ]);
  const bursts = [];
  const sounds = [];
  const damageTaken = [];
  const flashes = [];
  const game = {
    world: {
      getBlock: (x, y, z) => storage.get(key(x, y, z)) ?? 0,
      setBlock(x, y, z, id) { storage.set(key(x, y, z), id); return true; },
    },
    scene: { add() {}, remove() {} },
    audio: {
      playExplosion() { sounds.push('boom'); },
      playFuse() { sounds.push('hiss'); },
    },
    blockParticles: { burst(...args) { bursts.push(args); } },
    entities: null,
    player: {
      position: { x: 0.5, y: 5.5, z: 2.5 },
      dead: false,
      damage(amount, cause) { damageTaken.push([amount, cause]); },
    },
    isCreative: () => false,
    net: null,
    primedTnt: [],
    explosionFlashes: [],
    sendNetworkEdit() {},
    setBlockSynced: Game.prototype.setBlockSynced,
    explodeAt: Game.prototype.explodeAt,
    spawnExplosionFlash: Game.prototype.spawnExplosionFlash,
    primeTntAt: Game.prototype.primeTntAt,
    createTntMesh: Game.prototype.createTntMesh,
    removePrimedTntMesh: Game.prototype.removePrimedTntMesh,
    updatePrimedTnt: Game.prototype.updatePrimedTnt,
  };

  const removed = Game.prototype.explodeAt.call(game, 0.5, 5.5, 0.5, { radius: 2, damage: 7 });
  assert.ok(removed >= 1, 'the blast must clear breakable blocks');
  assert.equal(game.world.getBlock(0, 5, 0), 0, 'stone at the centre is gone');
  assert.equal(game.world.getBlock(1, 5, 0), 13, 'bedrock survives');
  assert.equal(game.world.getBlock(0, 4, 0), 11, 'water survives');
  assert.equal(game.world.getBlock(0, 5, 1), 25, 'obsidian survives');
  assert.equal(bursts.length, removed, 'every removed block sprays debris');
  assert.ok(sounds.includes('boom'), 'the explosion is audible');
  assert.equal(damageTaken.length, 1, 'the player takes splash damage');
  assert.ok(damageTaken[0][0] >= 1 && damageTaken[0][0] <= 7, 'damage falls off with distance');
  assert.equal(game.explosionFlashes.length, 1, 'a flash bloom animates the blast');
  assert.equal(game.primedTnt.length, 1, 'nearby dynamite chains instead of dying');
  assert.equal(game.primedTnt[0].x, 2, 'the chained charge takes over the block position');
  assert.equal(game.world.getBlock(2, 5, 0), 0, 'the primed charge is now an entity');

  // The fuse counts down, flashes and detonates the chained charge.
  game.primedTnt[0].fuse = 0.01;
  storage.set(key(1, 4, 0), 1);
  Game.prototype.updatePrimedTnt.call(game, 0.02);
  assert.equal(game.primedTnt.length, 0, 'the charge detonates and is removed');
  assert.equal(game.world.getBlock(1, 4, 0), 0, 'the chained explosion removes new blocks too');
  assert.equal(game.explosionFlashes.length, 2, 'each detonation flashes');
  Game.prototype.updateExplosionFlashes.call(game, 1);
  assert.equal(game.explosionFlashes.length, 0, 'expired flashes are cleaned up');
});

await test('explosion craters drink in the neighbouring water', async () => {
  globalThis.location ??= { search: '' };
  const { Game } = await import('../src/game/Game.js');
  const key = (x, y, z) => `${x},${y},${z}`;
  // A stone shelf: solid floor up to y=4, a wall block at (1,5,0) and a
  // natural water source behind it at (2,5,0) that nothing has woken yet.
  const storage = new Map([[key(1, 5, 0), 1]]);
  const world = {
    getBlock: (x, y, z) => (y <= 4 ? 1 : storage.get(key(x, y, z)) ?? 0),
    setBlock(x, y, z, id) { storage.set(key(x, y, z), id); return true; },
    isSolidAt(x, y, z) { return this.getBlock(x, y, z) !== 0; },
    getHeightAt() { return 4; },
    isChunkLoadedAt() { return true; },
  };
  const fluids = new FluidSimulation(world);
  const game = {
    world,
    scene: null,
    audio: null,
    blockParticles: null,
    entities: null,
    player: null,
    fluids,
    net: null,
    primedTnt: [],
    explosionFlashes: [],
    sendNetworkEdit() {},
    setBlockSynced: Game.prototype.setBlockSynced,
    spawnExplosionFlash: Game.prototype.spawnExplosionFlash,
    isCreative: () => true,
  };

  const removed = Game.prototype.explodeAt.call(game, 0.5, 5.5, 0.5, { radius: 1.2, damage: 0 });
  assert.equal(removed, 2, 'the blast punches two blocks out of the wall and floor');
  assert.equal(world.getBlock(1, 5, 0), 0, 'the wall block is gone');
  assert.equal(world.getBlock(2, 5, 0), 11, 'the water source itself survives');
  for (let i = 0; i < 4; i++) fluids.update(1);
  assert.equal(world.getBlock(1, 5, 0), 11, 'water pours into the fresh crater');
  assert.equal(world.getBlock(0, 5, 0), 11, 'and spreads one block further in');
});

await test('a creeper fuse calls the game explosion hook', async () => {
  const manager = new EntityManager({ scene: { add() {} }, world: makeFlatWorld(5), drops: null, seed: 13 });
  const creeper = manager.spawnMob('creeper', 0.5, 6.02, 0.5);
  assert.ok(MOBS.creeper.explodes, 'creepers still carry the explodes flag');
  const events = [];
  manager.onExplode = (x, y, z, options) => events.push({ x, y, z, options });
  const player = { position: { x: 0.5, y: 6, z: 1.2 }, creative: false, dead: false };
  creeper.updateFuse(1.4, player, player, manager);
  assert.equal(events.length, 1, 'the detonation reaches the game layer');
  assert.ok(Math.abs(events[0].x - 0.5) < 0.01, 'the explosion happens where the creeper stood');
  assert.ok(events[0].options.radius > 2, 'creepers blast a pocket, not a point');
  assert.equal(creeper.dead, true);
  assert.equal(creeper.exploded, true, 'exploded creepers skip their loot drop');

  // Without the hook the old point-blank damage still applies.
  const plain = new EntityManager({ scene: { add() {} }, world: makeFlatWorld(5), drops: null, seed: 14 });
  const lone = plain.spawnMob('creeper', 0.5, 6.02, 0.5);
  let hit = null;
  const victim = {
    position: { x: 0.5, y: 6, z: 1.2 },
    creative: false,
    damage(amount, cause) { hit = { amount, cause }; },
  };
  lone.updateFuse(1.4, victim, victim, plain);
  assert.ok(hit && hit.cause.includes('крипер'), 'the fallback still wounds the target');
  assert.equal(lone.exploded, true);
});

console.log(`\n${results.length - failed}/${results.length} tests passed.`);
if (failed > 0) {
  console.error(`${failed} test(s) failed.`);
  process.exitCode = 1;
}
