import { BLOCK_DEFS, getBlock } from './blocks.js';

export const ITEM_IDS = Object.freeze({
  STICK: 400,
  COAL: 401,
  IRON_INGOT: 403,
  GOLD_INGOT: 404,
  DIAMOND: 405,
  APPLE: 406,
  FLINT: 410,
  GOLDEN_APPLE: 413,
  FLINT_AND_STEEL: 414,
  BUCKET: 415,
  WATER_BUCKET: 416,
  LAVA_BUCKET: 417,
  SHEARS: 418,
  SADDLE: 419,
  LEATHER: 420,
  FEATHER: 421,
  BONE: 422,
  STRING: 423,
  GUNPOWDER: 424,
  ENDER_PEARL: 425,
  BLAZE_POWDER: 426,
  EYE_OF_ENDER: 427,
  EGG: 428,
  HONEY_BOTTLE: 429,
  RAW_PORKCHOP: 430,
  COOKED_PORKCHOP: 431,
  RAW_BEEF: 432,
  COOKED_BEEF: 433,
  RAW_MUTTON: 434,
  COOKED_MUTTON: 435,
  RAW_RABBIT: 436,
  COOKED_RABBIT: 437,
  RAW_CHICKEN: 438,
  COOKED_CHICKEN: 439,
  EMERALD: 440,
  WHEAT: 441,
  BREAD: 442,
  SWEET_BERRIES: 443,
  HORSE_ARMOR: 444,
  CARROT: 445,
  POTATO: 446,
  BEETROOT: 447,
  SLIME_BALL: 448,
  REDSTONE: 449,
  // Farming, stove and cooked-food items (520+ keeps old save ids intact).
  WOODEN_HOE: 520,
  STONE_HOE: 521,
  IRON_HOE: 522,
  DIAMOND_HOE: 523,
  FRYING_PAN: 524,
  MILLET_SEEDS: 525,
  MILLET: 526,
  COOKED_POTATO: 527,
  COOKED_CARROT: 528,
  COOKED_BEETROOT: 529,
  COOKED_MILLET: 530,
  COOKED_FISH: 531,
  FRIED_EGG: 532,
  WHEAT_SEEDS: 533,
  RAW_FISH: 473,
  NETHERITE_INGOT: 474,
  ENDER_SCALE: 475,
  SPIDER_FANG: 476,
  WOLF_FUR: 477,
  CAMEL_HIDE: 478,
  LEATHER_HELMET: 500,
  LEATHER_CHESTPLATE: 501,
  LEATHER_LEGGINGS: 502,
  LEATHER_BOOTS: 503,
  IRON_HELMET: 504,
  IRON_CHESTPLATE: 505,
  IRON_LEGGINGS: 506,
  IRON_BOOTS: 507,
  DIAMOND_HELMET: 508,
  DIAMOND_CHESTPLATE: 509,
  DIAMOND_LEGGINGS: 510,
  DIAMOND_BOOTS: 511,
});

const TOOL_MATERIALS = [
  { key: 'wood', name: 'Деревянный', tier: 1, speed: 2, durability: 60, prefix: 'Деревянная' },
  { key: 'stone', name: 'Каменный', tier: 2, speed: 4, durability: 132, prefix: 'Каменная' },
  { key: 'iron', name: 'Железный', tier: 3, speed: 6, durability: 250, prefix: 'Железная' },
  { key: 'diamond', name: 'Алмазный', tier: 4, speed: 8, durability: 1562, prefix: 'Алмазная' },
  // Appended so all existing tool IDs keep their saved values.
  { key: 'gold', name: 'Золотой', tier: 2, speed: 9, durability: 80, prefix: 'Золотая' },
  { key: 'netherite', name: 'Незеритовый', tier: 5, speed: 10, durability: 2400, prefix: 'Незеритовая' },
];

const TOOL_TYPES = [
  { key: 'pickaxe', name: 'кирка', suffix: 'кирка', type: 'pickaxe' },
  { key: 'axe', name: 'топор', suffix: 'топор', type: 'axe' },
  { key: 'shovel', name: 'лопата', suffix: 'лопата', type: 'shovel' },
  { key: 'sword', name: 'меч', suffix: 'меч', type: 'sword' },
];

const toolDefs = [];
let toolId = 300;
for (const material of TOOL_MATERIALS) {
  for (const type of TOOL_TYPES) {
    toolDefs.push({
      id: toolId++,
      key: `${material.key}_${type.key}`,
      name: `${material.name} ${type.suffix}`,
      stack: 1,
      icon: type.key,
      iconMaterial: material.key,
      tool: {
        type: type.type,
        tier: material.tier,
        speed: material.speed,
        durability: material.durability,
      },
    });
  }
}

const ARMOR_MATERIALS = [
  {
    key: 'leather', name: 'Кожаный', base: 500,
    defense: [1, 3, 2, 1], durability: [55, 80, 75, 65],
  },
  {
    key: 'iron', name: 'Железный', base: 504,
    defense: [2, 6, 5, 2], durability: [165, 240, 225, 195],
  },
  {
    key: 'diamond', name: 'Алмазный', base: 508,
    defense: [3, 8, 6, 3], durability: [363, 528, 495, 429],
  },
  {
    key: 'gold', name: 'Золотой', base: 512,
    defense: [2, 5, 3, 1], durability: [80, 120, 110, 90],
  },
  {
    key: 'netherite', name: 'Незеритовый', base: 516,
    defense: [4, 9, 7, 4], durability: [520, 760, 700, 600],
  },
];

const ARMOR_TYPES = [
  { key: 'helmet', suffix: 'шлем', slot: 'head' },
  { key: 'chestplate', suffix: 'нагрудник', slot: 'chest' },
  { key: 'leggings', suffix: 'поножи', slot: 'legs' },
  { key: 'boots', suffix: 'ботинки', slot: 'feet' },
];

// Hoes use a separate id range so every existing tool keeps its saved value.
const HOE_MATERIAL_KEYS = ['wood', 'stone', 'iron', 'diamond'];
const hoeDefs = [];
let hoeId = 520;
for (const key of HOE_MATERIAL_KEYS) {
  const material = TOOL_MATERIALS.find((entry) => entry.key === key);
  hoeDefs.push({
    id: hoeId++,
    key: `${material.key}_hoe`,
    name: `${material.name} мотыга`,
    stack: 1,
    icon: 'hoe',
    iconMaterial: material.key,
    tool: {
      type: 'hoe',
      tier: material.tier,
      speed: material.speed,
      durability: material.durability,
    },
  });
}

const armorDefs = [];
for (const material of ARMOR_MATERIALS) {
  ARMOR_TYPES.forEach((type, index) => {
    armorDefs.push({
      id: material.base + index,
      key: `${material.key}_${type.key}`,
      name: `${material.name} ${type.suffix}`,
      stack: 1,
      icon: type.key,
      iconMaterial: material.key,
      armor: {
        slot: type.slot,
        defense: material.defense[index],
        durability: material.durability[index],
      },
    });
  });
}

const materialDefs = [
  { id: 400, key: 'stick', name: 'Палка', stack: 64, icon: 'stick' },
  { id: 401, key: 'coal', name: 'Уголь', stack: 64, icon: 'coal' },
  { id: 403, key: 'iron_ingot', name: 'Железный слиток', stack: 64, icon: 'iron_ingot' },
  { id: 404, key: 'gold_ingot', name: 'Золотой слиток', stack: 64, icon: 'gold_ingot' },
  { id: 405, key: 'diamond', name: 'Алмаз', stack: 64, icon: 'diamond' },
  { id: 406, key: 'apple', name: 'Яблоко', stack: 64, icon: 'apple', food: { nutrition: 4, saturation: 2.4 } },
  { id: 410, key: 'flint', name: 'Кремень', stack: 64, icon: 'flint' },
  {
    id: 413, key: 'golden_apple', name: 'Золотое яблоко', stack: 64, icon: 'golden_apple',
    food: { nutrition: 4, saturation: 9.6, regeneration: 6 },
  },
  { id: 414, key: 'flint_and_steel', name: 'Огниво', stack: 1, icon: 'flint_and_steel', use: 'ignite' },
  { id: 415, key: 'bucket', name: 'Ведро', stack: 1, icon: 'bucket', use: 'bucket' },
  { id: 416, key: 'water_bucket', name: 'Ведро воды', stack: 1, icon: 'water_bucket', use: 'bucket_water' },
  { id: 417, key: 'lava_bucket', name: 'Ведро лавы', stack: 1, icon: 'lava_bucket', use: 'bucket_lava' },
  {
    id: 418, key: 'shears', name: 'Ножницы', stack: 1, icon: 'shears', use: 'shears',
    tool: { type: 'shears', tier: 1, speed: 2, durability: 238 },
  },
  { id: 419, key: 'saddle', name: 'Седло', stack: 1, icon: 'saddle', use: 'saddle' },
  { id: 420, key: 'leather', name: 'Кожа', stack: 64, icon: 'leather' },
  { id: 421, key: 'feather', name: 'Перо', stack: 64, icon: 'feather' },
  { id: 422, key: 'bone', name: 'Кость', stack: 64, icon: 'bone' },
  { id: 423, key: 'string', name: 'Нить', stack: 64, icon: 'string' },
  { id: 424, key: 'gunpowder', name: 'Порох', stack: 64, icon: 'gunpowder' },
  { id: 425, key: 'ender_pearl', name: 'Жемчуг Края', stack: 16, icon: 'ender_pearl' },
  { id: 426, key: 'blaze_powder', name: 'Огненный порошок', stack: 64, icon: 'blaze_powder' },
  { id: 427, key: 'eye_of_ender', name: 'Око Эндера', stack: 64, icon: 'eye_of_ender' },
  { id: 428, key: 'egg', name: 'Яйцо', stack: 64, icon: 'egg' },
  {
    id: 429, key: 'honey_bottle', name: 'Бутылочка мёда', stack: 16, icon: 'honey_bottle',
    food: { nutrition: 6, saturation: 1.2 },
  },
  { id: 430, key: 'raw_porkchop', name: 'Сырая свинина', stack: 64, icon: 'raw_porkchop', food: { nutrition: 3, saturation: 1.8 } },
  { id: 431, key: 'cooked_porkchop', name: 'Жареная свинина', stack: 64, icon: 'cooked_porkchop', food: { nutrition: 8, saturation: 12.8 } },
  { id: 432, key: 'raw_beef', name: 'Сырая говядина', stack: 64, icon: 'raw_beef', food: { nutrition: 3, saturation: 1.8 } },
  { id: 433, key: 'cooked_beef', name: 'Стейк', stack: 64, icon: 'cooked_beef', food: { nutrition: 8, saturation: 12.8 } },
  { id: 434, key: 'raw_mutton', name: 'Сырая баранина', stack: 64, icon: 'raw_mutton', food: { nutrition: 2, saturation: 1.2 } },
  { id: 435, key: 'cooked_mutton', name: 'Жареная баранина', stack: 64, icon: 'cooked_mutton', food: { nutrition: 6, saturation: 9.6 } },
  { id: 436, key: 'raw_rabbit', name: 'Сырая крольчатина', stack: 64, icon: 'raw_rabbit', food: { nutrition: 3, saturation: 1.8 } },
  { id: 437, key: 'cooked_rabbit', name: 'Жареная крольчатина', stack: 64, icon: 'cooked_rabbit', food: { nutrition: 5, saturation: 6 } },
  { id: 438, key: 'raw_chicken', name: 'Сырая курица', stack: 64, icon: 'raw_chicken', food: { nutrition: 2, saturation: 1.2 } },
  { id: 439, key: 'cooked_chicken', name: 'Жареная курица', stack: 64, icon: 'cooked_chicken', food: { nutrition: 6, saturation: 7.2 } },
  { id: 440, key: 'emerald', name: 'Изумруд', stack: 64, icon: 'emerald' },
  { id: 441, key: 'wheat', name: 'Пшеница', stack: 64, icon: 'wheat' },
  { id: 442, key: 'bread', name: 'Хлеб', stack: 64, icon: 'bread', food: { nutrition: 5, saturation: 6 } },
  { id: 443, key: 'sweet_berries', name: 'Сладкие ягоды', stack: 64, icon: 'sweet_berries', food: { nutrition: 2, saturation: 0.4 } },
  { id: 444, key: 'horse_armor', name: 'Конская броня', stack: 1, icon: 'horse_armor', use: 'horse_armor' },
  { id: 445, key: 'carrot', name: 'Морковь', stack: 64, icon: 'carrot', food: { nutrition: 3, saturation: 1.2 } },
  { id: 446, key: 'potato', name: 'Картофель', stack: 64, icon: 'potato', food: { nutrition: 1, saturation: 0.3 } },
  { id: 447, key: 'beetroot', name: 'Свёкла', stack: 64, icon: 'beetroot', food: { nutrition: 1, saturation: 0.6 } },
  { id: 448, key: 'slime_ball', name: 'Слизевый шарик', stack: 64, icon: 'slime_ball' },
  { id: 449, key: 'redstone', name: 'Redstone', stack: 64, icon: 'redstone' },
  { id: 473, key: 'raw_fish', name: 'Сырая рыба', stack: 64, icon: 'fish', food: { nutrition: 2, saturation: 1.2 } },
  { id: 524, key: 'frying_pan', name: 'Сковорода', stack: 1, icon: 'frying_pan', use: 'cook' },
  { id: 525, key: 'millet_seeds', name: 'Семена пшена', stack: 64, icon: 'millet_seeds' },
  { id: 526, key: 'millet', name: 'Пшено', stack: 64, icon: 'millet', food: { nutrition: 2, saturation: 0.8 } },
  { id: 527, key: 'cooked_potato', name: 'Жареный картофель', stack: 64, icon: 'cooked_potato', food: { nutrition: 6, saturation: 7.2 } },
  { id: 528, key: 'cooked_carrot', name: 'Жареная морковь', stack: 64, icon: 'cooked_carrot', food: { nutrition: 5, saturation: 6 } },
  { id: 529, key: 'cooked_beetroot', name: 'Жареная свёкла', stack: 64, icon: 'cooked_beetroot', food: { nutrition: 5, saturation: 6 } },
  { id: 530, key: 'cooked_millet', name: 'Жареное пшено', stack: 64, icon: 'cooked_millet', food: { nutrition: 7, saturation: 8.4 } },
  { id: 531, key: 'cooked_fish', name: 'Жареная рыба', stack: 64, icon: 'cooked_fish', food: { nutrition: 6, saturation: 7.2 } },
  { id: 532, key: 'fried_egg', name: 'Яичница', stack: 64, icon: 'fried_egg', food: { nutrition: 5, saturation: 5 } },
  { id: 533, key: 'wheat_seeds', name: 'Семена пшеницы', stack: 64, icon: 'wheat_seeds' },
  { id: 474, key: 'netherite_ingot', name: 'Незеритовый слиток', stack: 64, icon: 'netherite_ingot' },
  { id: 475, key: 'ender_scale', name: 'Чешуя Края', stack: 16, icon: 'ender_scale' },
  { id: 476, key: 'spider_fang', name: 'Клык паука', stack: 64, icon: 'spider_fang' },
  { id: 477, key: 'wolf_fur', name: 'Волчья шерсть', stack: 64, icon: 'wolf_fur' },
  { id: 478, key: 'camel_hide', name: 'Верблюжья кожа', stack: 64, icon: 'camel_hide' },
];

/** One egg per creature. Killing any mob drops the egg that summons it again. */
const SPAWN_EGG_DEFS = Object.freeze([
  ['cow', 'Яйцо коровы'],
  ['pig', 'Яйцо свиньи'],
  ['sheep', 'Яйцо овцы'],
  ['chicken', 'Яйцо курицы'],
  ['rabbit', 'Яйцо кролика'],
  ['horse', 'Яйцо лошади'],
  ['camel', 'Яйцо верблюда'],
  ['wolf', 'Яйцо волка'],
  ['fox', 'Яйцо лисы'],
  ['bee', 'Яйцо пчелы'],
  ['bird', 'Яйцо птицы'],
  ['villager', 'Яйцо жителя'],
  ['iron_golem', 'Яйцо железного голема'],
  ['zombie', 'Яйцо зомби'],
  ['skeleton', 'Яйцо скелета'],
  ['spider', 'Яйцо паука'],
  ['creeper', 'Яйцо крипера'],
  ['enderman', 'Яйцо странника Края'],
  ['blaze', 'Яйцо всполоха'],
  ['nether_pig', 'Яйцо адской свиньи'],
  ['ender_dragon', 'Яйцо дракона Края'],
  ['fish', 'Яйцо рыбы'],
  ['axolotl', 'Яйцо аксолотля'],
]);

const spawnEggIds = new Map();
SPAWN_EGG_DEFS.forEach(([spawn, name], index) => {
  const id = 450 + index;
  spawnEggIds.set(spawn, id);
  materialDefs.push({
    id,
    key: `spawn_egg_${spawn}`,
    name,
    stack: 16,
    icon: 'egg',
    use: 'spawn_egg',
    spawn,
  });
});

/** Item id of the egg that summons `type`, or null for unknown creatures. */
export function getSpawnEggId(type) {
  return spawnEggIds.get(type) ?? null;
}

const itemMap = new Map();
for (const def of toolDefs) itemMap.set(def.id, Object.freeze({ ...def, tool: Object.freeze(def.tool) }));
for (const def of hoeDefs) itemMap.set(def.id, Object.freeze({ ...def, tool: Object.freeze(def.tool) }));
for (const def of armorDefs) itemMap.set(def.id, Object.freeze({ ...def, armor: Object.freeze(def.armor) }));
for (const def of materialDefs) itemMap.set(def.id, Object.freeze({ ...def }));

for (const block of BLOCK_DEFS) {
  if (block.item === false) continue;
  if (block.id === 11 || block.id === 30 || block.id === 13) continue;
  itemMap.set(block.id, Object.freeze({
    id: block.id,
    key: `block_${block.key}`,
    name: block.name,
    stack: 64,
    icon: 'block',
    blockId: block.id,
    placeBlock: block.id,
  }));
}

export const ITEMS = Object.freeze(Object.fromEntries(itemMap));
export const ITEM_LIST = Object.freeze([...itemMap.values()]);

export function getItem(id) {
  if (id == null) return null;
  if (id < 256) {
    const block = getBlock(id);
    if (!block || block.id === 0) return null;
    return ITEMS[id] ?? null;
  }
  return ITEMS[id] ?? null;
}

export function getItemName(id) {
  return getItem(id)?.name ?? 'Неизвестный предмет';
}

export function getMaxStack(id) {
  return getItem(id)?.stack ?? 64;
}

export function createItemStack(id, count = 1) {
  const item = getItem(id);
  if (!item) return null;
  const stack = { id, count };
  if (item.tool) stack.durability = item.tool.durability;
  if (item.armor) stack.durability = item.armor.durability;
  return stack;
}

export function getToolInfo(id) {
  return getItem(id)?.tool ?? null;
}

export function getArmorInfo(id) {
  return getItem(id)?.armor ?? null;
}

export function getFoodInfo(id) {
  return getItem(id)?.food ?? null;
}

export const TOOL_MATERIAL_LIST = Object.freeze(TOOL_MATERIALS);
