import { ITEM_IDS, createItemStack } from './items.js';
import { mulberry32 } from './noise.js';
import { CHEST_SLOTS } from './storage.js';

// Weighted table for the supplies tucked away in village houses and barns.
// Everything here is craftable or gatherable, so loot never replaces progress.
const VILLAGE_LOOT = [
  { id: ITEM_IDS.BREAD, min: 2, max: 5, weight: 5 },
  { id: ITEM_IDS.IRON_INGOT, min: 1, max: 3, weight: 4 },
  { id: ITEM_IDS.COAL, min: 2, max: 6, weight: 4 },
  { id: 5, min: 4, max: 8, weight: 4 }, // oak planks
  { id: 63, min: 4, max: 8, weight: 3 }, // torches
  { id: ITEM_IDS.WHEAT_SEEDS, min: 2, max: 5, weight: 3 },
  { id: ITEM_IDS.EMERALD, min: 1, max: 2, weight: 2 },
  { id: ITEM_IDS.STRING, min: 2, max: 4, weight: 2 },
  { id: ITEM_IDS.FLINT, min: 1, max: 2, weight: 2 },
  { id: ITEM_IDS.ARROW, min: 4, max: 8, weight: 2 },
  { id: 303, min: 1, max: 1, weight: 1 }, // wooden sword
  { id: ITEM_IDS.BOW, min: 1, max: 1, weight: 1 },
  { id: ITEM_IDS.GOLDEN_APPLE, min: 1, max: 1, weight: 1 },
];

const TOTAL_WEIGHT = VILLAGE_LOOT.reduce((sum, entry) => sum + entry.weight, 0);

function pickEntry(random) {
  let roll = random() * TOTAL_WEIGHT;
  for (const entry of VILLAGE_LOOT) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return VILLAGE_LOOT[0];
}

/**
 * Deterministic starter loot for a generated village chest. The seed comes
 * from the chest coordinates alone, so every player sees the same contents
 * without storing anything in the world generator.
 */
export function villageChestLoot(x, y, z) {
  const seed = (
    Math.imul(Math.floor(x) | 0, 73856093)
    ^ Math.imul(Math.floor(y) | 0, 19349663)
    ^ Math.imul(Math.floor(z) | 0, 83492791)
  ) >>> 0;
  const random = mulberry32(seed);
  const slots = new Array(CHEST_SLOTS).fill(null);
  const stacks = 3 + Math.floor(random() * 4);
  let slot = 0;
  for (let i = 0; i < stacks; i++) {
    const entry = pickEntry(random);
    const count = entry.min + Math.floor(random() * (entry.max - entry.min + 1));
    const stack = createItemStack(entry.id, count);
    if (!stack) continue;
    slots[slot++] = stack;
  }
  return slots;
}
