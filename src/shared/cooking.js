import { ITEM_IDS, getMaxStack } from './items.js';

/**
 * Fuel-based cooking. The recipe book shows these in the stove/pan UI, and the
 * session below owns the three slots and the burn timer independently of any
 * DOM code so it can be tested directly.
 */
export const COOKING_SLOTS = Object.freeze({ INPUT: 0, FUEL: 1, OUTPUT: 2 });

export const FUEL_IDS = Object.freeze([
  ITEM_IDS.COAL, 5, 6, 34, 36, 400, 60,
]);

const FUEL_SECONDS = new Map([
  [ITEM_IDS.COAL, 80],
  [5, 15], // planks
  [6, 15], // oak log
  [34, 15], // birch log
  [36, 15], // spruce log
  [400, 5], // stick
  [60, 20], // hay bale
]);

export const COOKING_RECIPES = Object.freeze([
  { id: 'cooked_potato', input: ITEM_IDS.POTATO, output: ITEM_IDS.COOKED_POTATO, seconds: 7 },
  { id: 'cooked_carrot', input: ITEM_IDS.CARROT, output: ITEM_IDS.COOKED_CARROT, seconds: 7 },
  { id: 'cooked_beetroot', input: ITEM_IDS.BEETROOT, output: ITEM_IDS.COOKED_BEETROOT, seconds: 7 },
  { id: 'cooked_millet', input: ITEM_IDS.MILLET, output: ITEM_IDS.COOKED_MILLET, seconds: 9 },
  { id: 'cooked_porkchop', input: ITEM_IDS.RAW_PORKCHOP, output: ITEM_IDS.COOKED_PORKCHOP, seconds: 10 },
  { id: 'cooked_beef', input: ITEM_IDS.RAW_BEEF, output: ITEM_IDS.COOKED_BEEF, seconds: 10 },
  { id: 'cooked_mutton', input: ITEM_IDS.RAW_MUTTON, output: ITEM_IDS.COOKED_MUTTON, seconds: 10 },
  { id: 'cooked_rabbit', input: ITEM_IDS.RAW_RABBIT, output: ITEM_IDS.COOKED_RABBIT, seconds: 10 },
  { id: 'cooked_chicken', input: ITEM_IDS.RAW_CHICKEN, output: ITEM_IDS.COOKED_CHICKEN, seconds: 10 },
  { id: 'cooked_fish', input: ITEM_IDS.RAW_FISH, output: ITEM_IDS.COOKED_FISH, seconds: 8 },
  { id: 'fried_egg', input: ITEM_IDS.EGG, output: ITEM_IDS.FRIED_EGG, seconds: 6 },
]);

const recipeByInput = new Map(COOKING_RECIPES.map((recipe) => [recipe.input, recipe]));

export function getCookingRecipe(inputId) {
  return recipeByInput.get(inputId) ?? null;
}

export function getFuelSeconds(itemId) {
  return FUEL_SECONDS.get(itemId) ?? 0;
}

export function isFuel(itemId) {
  return getFuelSeconds(itemId) > 0;
}

/** Preferred order for the one-click "fill stove" helper in the recipe book. */
export function preferredFuel(inventory) {
  if (!inventory?.countItem) return null;
  for (const id of FUEL_IDS) {
    if (inventory.countItem(id) > 0) return id;
  }
  return null;
}

export class CookingSession {
  constructor() {
    this.slots = [null, null, null];
    this.progress = 0;
    this.fuelRemaining = 0;
    this.fuelTotal = 0;
  }

  getSlot(index) {
    return this.slots[index] ?? null;
  }

  setSlot(index, stack) {
    const previous = this.slots[index];
    this.slots[index] = stack ?? null;
    if (index === COOKING_SLOTS.INPUT && previous?.id !== stack?.id) {
      this.progress = 0;
    }
    if (index === COOKING_SLOTS.FUEL && (!stack || previous?.id !== stack?.id)) {
      this.fuelRemaining = 0;
      this.fuelTotal = 0;
    }
  }

  clear() {
    this.slots = [null, null, null];
    this.progress = 0;
    this.fuelRemaining = 0;
    this.fuelTotal = 0;
  }

  get recipe() {
    return getCookingRecipe(this.slots[COOKING_SLOTS.INPUT]?.id);
  }

  canStoreOutput(itemId) {
    const output = this.slots[COOKING_SLOTS.OUTPUT];
    if (output && output.id !== itemId) return false;
    const capacity = output ? getMaxStack(itemId) - output.count : getMaxStack(itemId);
    return capacity > 0;
  }

  /**
   * Advances the stove. Returns true only when an item count changed, so the UI
   * can redraw meters every frame but only syncs the inventory when it matters.
   */
  tick(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return false;
    const recipe = this.recipe;
    if (!recipe) {
      if (this.progress !== 0) this.progress = 0;
      return false;
    }

    let changed = false;
    if (this.fuelRemaining <= 0) {
      const fuel = this.slots[COOKING_SLOTS.FUEL];
      const seconds = getFuelSeconds(fuel?.id);
      if (seconds <= 0) {
        if (this.progress !== 0) this.progress = 0;
        return false;
      }
      fuel.count -= 1;
      if (fuel.count <= 0) this.slots[COOKING_SLOTS.FUEL] = null;
      this.fuelTotal = seconds;
      this.fuelRemaining = seconds;
      changed = true;
    }

    const burn = Math.min(dt, this.fuelRemaining);
    this.fuelRemaining = Math.max(0, this.fuelRemaining - burn);
    this.progress += burn / recipe.seconds;

    if (this.progress >= 1) {
      if (!this.canStoreOutput(recipe.output)) {
        this.progress = 1;
        return changed;
      }
      const input = this.slots[COOKING_SLOTS.INPUT];
      input.count -= 1;
      if (input.count <= 0) this.slots[COOKING_SLOTS.INPUT] = null;
      const output = this.slots[COOKING_SLOTS.OUTPUT];
      if (output) output.count += 1;
      else this.slots[COOKING_SLOTS.OUTPUT] = { id: recipe.output, count: 1 };
      this.progress = 0;
      changed = true;
    }
    return changed;
  }
}
