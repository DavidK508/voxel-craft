import { BIOME } from '../world/generator.js';

/**
 * Mob registry.
 *
 * `kind` drives the AI: passive mobs wander and flee, hostile mobs hunt the
 * player, villagers stay near their village and never fight.
 * `model` selects a procedural box model from models.js.
 */
export const MOBS = Object.freeze({
  cow: {
    key: 'cow', name: 'Корова', kind: 'passive', model: 'cow',
    health: 10, speed: 1.15, width: 0.9, height: 1.35,
    biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.TAIGA],
    group: [2, 3], spawnWeight: 1.1,
    drops: [{ id: 432, min: 1, max: 3 }, { id: 420, min: 0, max: 2 }],
  },
  pig: {
    key: 'pig', name: 'Свинья', kind: 'passive', model: 'pig',
    health: 10, speed: 1.25, width: 0.85, height: 0.95,
    biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.TAIGA, BIOME.SWAMP],
    group: [2, 4], spawnWeight: 1.2,
    drops: [{ id: 430, min: 1, max: 3 }],
  },
  sheep: {
    key: 'sheep', name: 'Овца', kind: 'passive', model: 'sheep',
    health: 8, speed: 1.05, width: 0.9, height: 1.2,
    biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.MOUNTAINS, BIOME.TAIGA],
    group: [2, 4], spawnWeight: 1.2, shearable: true,
    drops: [{ id: 434, min: 1, max: 2 }, { id: 42, min: 1, max: 2 }],
  },
  chicken: {
    key: 'chicken', name: 'Курица', kind: 'passive', model: 'chicken',
    health: 4, speed: 1.0, width: 0.5, height: 0.75,
    biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.TAIGA],
    group: [2, 4], spawnWeight: 0.9,
    drops: [{ id: 438, min: 1, max: 2 }, { id: 421, min: 1, max: 2 }],
  },
  rabbit: {
    key: 'rabbit', name: 'Кролик', kind: 'passive', model: 'rabbit',
    health: 3, speed: 2.1, width: 0.4, height: 0.5,
    biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.DESERT, BIOME.SNOWY, BIOME.TAIGA],
    group: [1, 3], spawnWeight: 0.9,
    drops: [{ id: 436, min: 1, max: 1 }],
  },
  horse: {
    key: 'horse', name: 'Лошадь', kind: 'passive', model: 'horse',
    health: 22, speed: 2.2, width: 1.0, height: 1.7,
    biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.SNOWY, BIOME.MOUNTAINS],
    group: [1, 2], spawnWeight: 0.7, tameable: true, rideable: true,
    drops: [{ id: 420, min: 1, max: 2 }],
  },
  camel: {
    key: 'camel', name: 'Верблюд', kind: 'passive', model: 'camel',
    health: 26, speed: 2.3, width: 1.1, height: 2.0,
    biomes: [BIOME.DESERT],
    group: [1, 2], spawnWeight: 0.8, tameable: true, rideable: true,
    drops: [{ id: 420, min: 1, max: 3 }, { id: 478, min: 1, max: 2 }],
  },
  wolf: {
    key: 'wolf', name: 'Волк', kind: 'neutral', model: 'wolf',
    health: 10, speed: 2.4, width: 0.7, height: 0.9,
    biomes: [BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.TAIGA, BIOME.SNOWY],
    group: [1, 3], spawnWeight: 0.8, tameable: true, damage: 2, weapon: 'fangs',
    drops: [{ id: 422, min: 0, max: 1 }, { id: 477, min: 1, max: 2 }],
  },
  fox: {
    key: 'fox', name: 'Лиса', kind: 'passive', model: 'fox',
    health: 8, speed: 2.3, width: 0.6, height: 0.75,
    biomes: [BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.TAIGA, BIOME.SNOWY],
    group: [1, 2], spawnWeight: 0.7,
    drops: [{ id: 421, min: 0, max: 1 }, { id: 477, min: 0, max: 1 }],
  },
  bee: {
    key: 'bee', name: 'Пчела', kind: 'passive', model: 'bee',
    health: 4, speed: 1.6, width: 0.35, height: 0.35,
    biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH_FOREST],
    group: [1, 3], spawnWeight: 0.7, flying: true,
    drops: [{ id: 429, min: 0, max: 1 }],
  },
  bird: {
    key: 'bird', name: 'Птица', kind: 'passive', model: 'bird',
    health: 3, speed: 2.0, width: 0.4, height: 0.45,
    biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.TAIGA, BIOME.BEACH],
    group: [1, 3], spawnWeight: 0.8, flying: true,
    drops: [{ id: 421, min: 1, max: 2 }],
  },
  villager: {
    key: 'villager', name: 'Житель', kind: 'villager', model: 'villager',
    health: 20, speed: 0.9, width: 0.6, height: 1.9,
    biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.DESERT], village: true,
    drops: [],
  },
  iron_golem: {
    key: 'iron_golem', name: 'Железный голем', kind: 'guardian', model: 'iron_golem',
    health: 60, speed: 1.0, width: 1.2, height: 2.6,
    damage: 7, attackRange: 2.2, village: true,
    // Valuable loot: the golem is built from iron, and its village ties make
    // it a source of emeralds and the occasional diamond.
    drops: [
      { id: 403, min: 4, max: 7 },
      { id: 31, min: 1, max: 2 },
      { id: 440, min: 1, max: 2 },
      { id: 405, min: 0, max: 1 },
    ],
  },
  zombie: {
    key: 'zombie', name: 'Зомби', kind: 'hostile', model: 'zombie',
    health: 20, speed: 1.7, width: 0.6, height: 1.9,
    damage: 3, attackRange: 1.5, weapon: 'sword',
    drops: [{ id: 422, min: 0, max: 1 }, { id: 476, min: 0, max: 1 }],
  },
  skeleton: {
    key: 'skeleton', name: 'Скелет', kind: 'hostile', model: 'skeleton',
    health: 16, speed: 1.55, width: 0.6, height: 1.9,
    damage: 2, attackRange: 1.6, weapon: 'bow',
    drops: [{ id: 422, min: 1, max: 2 }, { id: 421, min: 0, max: 2 }],
  },
  spider: {
    key: 'spider', name: 'Паук', kind: 'hostile', model: 'spider',
    health: 14, speed: 2.1, width: 1.1, height: 0.75,
    damage: 2, attackRange: 1.4, weapon: 'fangs',
    drops: [{ id: 423, min: 1, max: 2 }, { id: 476, min: 1, max: 2 }],
  },
  creeper: {
    key: 'creeper', name: 'Крипер', kind: 'hostile', model: 'creeper',
    health: 20, speed: 1.4, width: 0.6, height: 1.7,
    damage: 0, attackRange: 1.6, explodes: true,
    drops: [{ id: 424, min: 1, max: 2 }],
  },
  enderman: {
    key: 'enderman', name: 'Странник Края', kind: 'hostile', model: 'enderman',
    health: 30, speed: 2.0, width: 0.6, height: 2.6,
    damage: 4, attackRange: 1.8, dimensions: ['end'], weapon: 'claws',
    drops: [{ id: 425, min: 1, max: 2 }],
  },
  blaze: {
    key: 'blaze', name: 'Всполох', kind: 'hostile', model: 'blaze',
    health: 20, speed: 1.2, width: 0.7, height: 1.6,
    damage: 3, attackRange: 1.7, dimensions: ['nether'], flying: true, weapon: 'staff',
    drops: [{ id: 426, min: 1, max: 2 }],
  },
  nether_pig: {
    key: 'nether_pig', name: 'Адская свинья', kind: 'passive', model: 'nether_pig',
    health: 12, speed: 1.3, width: 0.9, height: 1.05,
    dimensions: ['nether'], group: [2, 4], spawnWeight: 1,
    drops: [{ id: 430, min: 1, max: 2 }, { id: 426, min: 0, max: 1 }],
  },
  ender_dragon: {
    key: 'ender_dragon', name: 'Дракон Края', kind: 'boss', model: 'ender_dragon',
    health: 320, speed: 3.4, width: 2.4, height: 4.2,
    damage: 12, attackRange: 3.2, dimensions: ['end'], flying: true,
    // Swords are the only reliable way through the dragon's dense scales
    // (see EntityManager.attack).
    drops: [
      { id: 425, min: 4, max: 8 },
      { id: 427, min: 1, max: 3 },
      { id: 405, min: 3, max: 6 },
      { id: 440, min: 2, max: 4 },
      { id: 475, min: 1, max: 3 },
    ],
  },
  fish: {
    key: 'fish', name: 'Рыба', kind: 'passive', model: 'fish',
    health: 4, speed: 1.4, width: 0.42, height: 0.38,
    aquatic: true, biomes: [BIOME.OCEAN, BIOME.BEACH, BIOME.SWAMP],
    group: [3, 6], spawnWeight: 1.2,
    drops: [{ id: 473, min: 1, max: 2 }],
  },
  axolotl: {
    key: 'axolotl', name: 'Аксолотль', kind: 'passive', model: 'axolotl',
    health: 7, speed: 1.1, width: 0.5, height: 0.55,
    aquatic: true, biomes: [BIOME.OCEAN, BIOME.BEACH, BIOME.SWAMP],
    group: [1, 2], spawnWeight: 0.6,
    drops: [{ id: 448, min: 0, max: 1 }, { id: 473, min: 0, max: 1 }],
  },
});

export const PASSIVE_MOBS = Object.values(MOBS).filter((m) => m.kind === 'passive' || m.kind === 'neutral');
export const AQUATIC_MOBS = Object.values(MOBS).filter((mob) => mob.aquatic);
export const HOSTILE_MOBS = Object.values(MOBS).filter((m) => m.kind === 'hostile');

/** Mobs that can spawn in a biome during the overworld day. */
export function spawnablePassive(biome) {
  return PASSIVE_MOBS.filter((mob) => (
    mob.biomes?.includes(biome) && !mob.dimensions && !mob.aquatic
  ));
}

/** Peaceful mobs that belong to a non-overworld dimension (e.g. Nether pigs). */
export function passivePool(dimension) {
  if (dimension === 'overworld') return [];
  return PASSIVE_MOBS.filter((mob) => mob.dimensions?.includes(dimension));
}

/** Hostile pool per dimension. */
export function hostilePool(dimension) {
  if (dimension === 'nether') {
    return HOSTILE_MOBS.filter((mob) => !mob.dimensions || mob.dimensions.includes('nether'));
  }
  if (dimension === 'end') {
    return HOSTILE_MOBS.filter((mob) => !mob.dimensions || mob.dimensions.includes('end'));
  }
  return HOSTILE_MOBS.filter((mob) => !mob.dimensions);
}

export function rollDrops(mob) {
  const result = [];
  for (const drop of mob.drops ?? []) {
    const min = drop.min ?? 1;
    const max = drop.max ?? min;
    const count = min + Math.floor(Math.random() * (max - min + 1));
    if (count > 0) result.push({ id: drop.id, count });
  }
  return result;
}
