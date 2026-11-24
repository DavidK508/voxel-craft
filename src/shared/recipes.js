import { ITEM_IDS, SPEAR_IDS } from './items.js';

const WOOD = [5];
const STONE = [4];
const IRON = [403];
const DIAMOND = [405];
const GOLD = [404];
const NETHERITE = [474];
const LOGS = [6, 34, 36];

const toolRecipes = [];
const materialSets = [
  { key: 'wooden', material: WOOD, pickaxe: 300, axe: 301, shovel: 302, sword: 303 },
  { key: 'stone', material: STONE, pickaxe: 304, axe: 305, shovel: 306, sword: 307 },
  { key: 'iron', material: IRON, pickaxe: 308, axe: 309, shovel: 310, sword: 311 },
  { key: 'diamond', material: DIAMOND, pickaxe: 312, axe: 313, shovel: 314, sword: 315 },
  { key: 'gold', material: GOLD, pickaxe: 316, axe: 317, shovel: 318, sword: 319 },
  { key: 'netherite', material: NETHERITE, pickaxe: 320, axe: 321, shovel: 322, sword: 323 },
];

for (const set of materialSets) {
  toolRecipes.push(
    { id: `${set.key}_pickaxe`, pattern: ['MMM', ' S ', ' S '], key: { M: set.material, S: 400 }, result: { id: set.pickaxe, count: 1 } },
    { id: `${set.key}_axe`, pattern: ['MM', 'MS', ' S'], key: { M: set.material, S: 400 }, result: { id: set.axe, count: 1 } },
    { id: `${set.key}_shovel`, pattern: ['M', 'S', 'S'], key: { M: set.material, S: 400 }, result: { id: set.shovel, count: 1 } },
    { id: `${set.key}_sword`, pattern: ['M', 'M', 'S'], key: { M: set.material, S: 400 }, result: { id: set.sword, count: 1 } },
  );
}

const spearMaterials = {
  wood: WOOD, stone: STONE, iron: IRON,
  diamond: DIAMOND, gold: GOLD, netherite: NETHERITE,
};
// The lower blade is deliberately offset: a centred ['M','M','S'] shape would
// collapse into the existing sword recipe after the matcher trims empty edges.
const spearRecipes = Object.entries(SPEAR_IDS).map(([material, id]) => ({
  id: `${material}_spear`,
  pattern: [' M ', ' M ', 'MS '],
  key: { M: spearMaterials[material], S: 400 },
  result: { id, count: 1 },
}));

const hoeRecipes = [
  { id: 'wooden_hoe', pattern: ['MM', ' S', ' S'], key: { M: 5, S: 400 }, result: { id: ITEM_IDS.WOODEN_HOE, count: 1 } },
  { id: 'stone_hoe', pattern: ['MM', ' S', ' S'], key: { M: 4, S: 400 }, result: { id: ITEM_IDS.STONE_HOE, count: 1 } },
  { id: 'iron_hoe', pattern: ['MM', ' S', ' S'], key: { M: 403, S: 400 }, result: { id: ITEM_IDS.IRON_HOE, count: 1 } },
  { id: 'diamond_hoe', pattern: ['MM', ' S', ' S'], key: { M: 405, S: 400 }, result: { id: ITEM_IDS.DIAMOND_HOE, count: 1 } },
];

const armorRecipes = [];
const armorSets = [
  { key: 'leather', material: 420, base: 500 },
  { key: 'iron', material: 403, base: 504 },
  { key: 'diamond', material: 405, base: 508 },
  { key: 'gold', material: 404, base: 512 },
  { key: 'netherite', material: 474, base: 516 },
];

for (const set of armorSets) {
  armorRecipes.push(
    { id: `${set.key}_helmet`, pattern: ['MMM', 'M M'], key: { M: set.material }, result: { id: set.base, count: 1 } },
    { id: `${set.key}_chestplate`, pattern: ['M M', 'MMM', 'MMM'], key: { M: set.material }, result: { id: set.base + 1, count: 1 } },
    { id: `${set.key}_leggings`, pattern: ['MMM', 'M M', 'M M'], key: { M: set.material }, result: { id: set.base + 2, count: 1 } },
    { id: `${set.key}_boots`, pattern: ['M M', 'M M'], key: { M: set.material }, result: { id: set.base + 3, count: 1 } },
  );
}

export const RECIPES = Object.freeze([
  { id: 'planks', shapeless: [{ any: LOGS }], result: { id: 5, count: 4 } },
  { id: 'sticks', pattern: ['P', 'P'], key: { P: 5 }, result: { id: 400, count: 4 } },
  { id: 'crafting_table', pattern: ['PP', 'PP'], key: { P: 5 }, result: { id: 21, count: 1 } },
  { id: 'chest', pattern: ['PPP', 'P P', 'PPP'], key: { P: 5 }, result: { id: 200, count: 1 } },
  { id: 'furnace', pattern: ['CCC', 'C C', 'CCC'], key: { C: 4 }, result: { id: 22, count: 1 } },
  { id: 'stone_bricks', pattern: ['CC', 'CC'], key: { C: 4 }, result: { id: 28, count: 4 } },
  { id: 'sandstone', pattern: ['SS', 'SS'], key: { S: 8 }, result: { id: 9, count: 1 } },
  { id: 'iron_block', pattern: ['III', 'III', 'III'], key: { I: 403 }, result: { id: 31, count: 1 } },
  { id: 'gold_block', pattern: ['GGG', 'GGG', 'GGG'], key: { G: 404 }, result: { id: 32, count: 1 } },
  { id: 'diamond_block', pattern: ['DDD', 'DDD', 'DDD'], key: { D: 405 }, result: { id: 33, count: 1 } },
  { id: 'iron_from_block', shapeless: [{ any: [31] }], result: { id: 403, count: 9 } },
  { id: 'gold_from_block', shapeless: [{ any: [32] }], result: { id: 404, count: 9 } },
  { id: 'diamond_from_block', shapeless: [{ any: [33] }], result: { id: 405, count: 9 } },
  {
    id: 'netherite_ingot',
    shapeless: [{ any: [405] }, { any: [405] }, { any: [25] }, { any: [25] }, { any: [404] }],
    result: { id: 474, count: 1 },
  },
  { id: 'golden_apple', pattern: ['GGG', 'GAG', 'GGG'], key: { G: 404, A: 406 }, result: { id: 413, count: 1 } },
  // Fire starter ("огнемёт") and buckets.
  { id: 'flint_and_steel', shapeless: [{ any: [410] }, { any: [403] }], result: { id: 414, count: 1 } },
  { id: 'bucket', pattern: ['I I', ' I '], key: { I: 403 }, result: { id: 415, count: 1 } },
  { id: 'shears', pattern: [' I', 'I '], key: { I: 403 }, result: { id: 418, count: 1 } },
  { id: 'saddle', pattern: ['LLL', 'LSL'], key: { L: 420, S: 423 }, result: { id: 419, count: 1 } },
  { id: 'bread', pattern: ['WWW'], key: { W: 441 }, result: { id: 442, count: 1 } },
  // Stove toolkit: a pan for portable cooking and hoes for tilling soil.
  { id: 'frying_pan', pattern: ['III', '  S'], key: { I: 403, S: 400 }, result: { id: ITEM_IDS.FRYING_PAN, count: 1 } },
  { id: 'wheat_seeds', shapeless: [{ any: [441] }], result: { id: ITEM_IDS.WHEAT_SEEDS, count: 2 } },
  { id: 'eye_of_ender', shapeless: [{ any: [425] }, { any: [426] }], result: { id: 427, count: 1 } },
  { id: 'horse_armor', pattern: ['L L', 'LLL', 'LLL'], key: { L: 420 }, result: { id: 444, count: 1 } },
  { id: 'string_from_wool', shapeless: [{ any: [42] }], result: { id: 423, count: 4 } },
  { id: 'torch', shapeless: [{ any: [401] }, { any: [400] }], result: { id: 63, count: 4 } },
  // Dynamite: five gunpowder and four sand in a checkerboard.
  { id: 'tnt', pattern: ['GSG', 'SGS', 'GSG'], key: { G: ITEM_IDS.GUNPOWDER, S: 8 }, result: { id: 205, count: 1 } },
  // A bed is three wool above three planks, just like Minecraft.
  { id: 'bed', pattern: ['WWW', 'PPP'], key: { W: 42, P: 5 }, result: { id: 69, count: 1 } },
  // Ranged weapons: arrows from flint, wooden sticks and feathers.
  {
    id: 'arrow',
    shapeless: [{ any: [410] }, { any: [400] }, { any: [421] }],
    result: { id: ITEM_IDS.ARROW, count: 4 },
  },
  {
    id: 'bow',
    pattern: [' S ', 'S T', ' S '],
    key: { S: 400, T: 423 },
    result: { id: ITEM_IDS.BOW, count: 1 },
  },
  // Doors and Redstone mechanisms.
  { id: 'oak_door', pattern: ['PP', 'PP', 'PP'], key: { P: 5 }, result: { id: 81, count: 1 } },
  { id: 'lever', shapeless: [{ any: [400] }, { any: [4] }], result: { id: 97, count: 1 } },
  { id: 'stone_button', shapeless: [{ any: [4] }], result: { id: 105, count: 1 } },
  { id: 'pressure_plate', pattern: ['SS'], key: { S: 4 }, result: { id: 113, count: 1 } },
  { id: 'redstone_block', pattern: ['RRR', 'RRR', 'RRR'], key: { R: 449 }, result: { id: 181, count: 1 } },
  { id: 'redstone_from_block', shapeless: [{ any: [181] }], result: { id: 449, count: 9 } },
  { id: 'repeater', pattern: ['R R', 'STS'], key: { R: 449, S: 4, T: 400 }, result: { id: 117, count: 1 } },
  { id: 'redstone_lamp', shapeless: [{ any: [449] }, { any: [29] }], result: { id: 149, count: 1 } },
  { id: 'piston', pattern: ['PPP', 'CIC', 'CRC'], key: { P: 5, C: 4, I: 403, R: 449 }, result: { id: 151, count: 1 } },
  { id: 'sticky_piston', shapeless: [{ any: [151] }, { any: [448] }], result: { id: 169, count: 1 } },
  ...armorRecipes,
  ...toolRecipes,
  ...spearRecipes,
  ...hoeRecipes,
]);

function normalizeIngredient(ingredient) {
  if (ingredient == null) return [];
  if (Array.isArray(ingredient)) return ingredient.slice();
  if (typeof ingredient === 'object' && Array.isArray(ingredient.any)) return ingredient.any.slice();
  if (typeof ingredient === 'number') return [ingredient];
  return [];
}

/**
 * Turns a recipe into a `size * size` crafting grid description.
 *
 * Every non-empty cell is an array of acceptable item ids, or null for an empty
 * cell. The function returns null when the recipe cannot be placed in a grid of
 * the requested size (for example a 3x3 recipe in the 2x2 inventory grid).
 * Recipes are anchored to the top-left corner; the matcher ignores the offset,
 * so this is purely a UI convenience.
 */
export function recipeToPlacement(recipe, size) {
  const gridSize = size === 3 ? 3 : 2;
  const cells = new Array(gridSize * gridSize).fill(null);

  if (recipe.shapeless) {
    if (recipe.shapeless.length > cells.length) return null;
    for (let i = 0; i < recipe.shapeless.length; i++) {
      const candidates = normalizeIngredient(recipe.shapeless[i]);
      if (candidates.length === 0) return null;
      cells[i] = candidates;
    }
    return cells;
  }

  const pattern = normalizePattern(recipe);
  if (!pattern) return null;
  if (pattern.length > gridSize || pattern[0].length > gridSize) return null;

  for (let r = 0; r < pattern.length; r++) {
    for (let c = 0; c < pattern[r].length; c++) {
      const symbol = pattern[r][c];
      if (symbol === ' ') continue;
      const candidates = normalizeIngredient(recipe.key[symbol]);
      if (candidates.length === 0) return null;
      cells[r * gridSize + c] = candidates;
    }
  }
  return cells;
}

function ingredientMatches(ingredient, itemId) {
  if (itemId == null) return false;
  if (Array.isArray(ingredient)) return ingredient.includes(itemId);
  if (ingredient && Array.isArray(ingredient.any)) return ingredient.any.includes(itemId);
  return ingredient === itemId;
}

function normalizePattern(recipe) {
  const rows = recipe.pattern;
  let minR = rows.length;
  let maxR = -1;
  let minC = Infinity;
  let maxC = -1;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] !== ' ') {
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
    }
  }
  if (maxR < 0) return null;
  const trimmed = [];
  for (let r = minR; r <= maxR; r++) {
    trimmed.push(rows[r].slice(minC, maxC + 1));
  }
  return trimmed;
}

function matchShaped(recipe, grid, size) {
  const pattern = normalizePattern(recipe);
  if (!pattern) return false;
  if (pattern.length > size || pattern[0].length > size) return false;

  let minR = size;
  let maxR = -1;
  let minC = size;
  let maxC = -1;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r * size + c]) {
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
    }
  }
  if (maxR < 0) return false;
  const height = maxR - minR + 1;
  const width = maxC - minC + 1;
  if (height !== pattern.length || width !== pattern[0].length) return false;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const symbol = pattern[r][c];
      const itemId = grid[(minR + r) * size + (minC + c)];
      if (symbol === ' ') {
        if (itemId) return false;
      } else {
        const ingredient = recipe.key[symbol];
        if (!ingredientMatches(ingredient, itemId)) return false;
      }
    }
  }
  return true;
}

function matchShapeless(recipe, grid) {
  const items = grid.filter(Boolean);
  if (items.length !== recipe.shapeless.length) return false;
  const used = new Array(items.length).fill(false);
  for (const ingredient of recipe.shapeless) {
    let found = false;
    for (let i = 0; i < items.length; i++) {
      if (!used[i] && ingredientMatches(ingredient, items[i])) {
        used[i] = true;
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

export function findRecipe(grid, size) {
  for (const recipe of RECIPES) {
    const matches = recipe.shapeless
      ? matchShapeless(recipe, grid)
      : matchShaped(recipe, grid, size);
    if (matches) return recipe;
  }
  return null;
}
