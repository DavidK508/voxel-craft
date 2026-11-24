/**
 * Minecraft-style animal interactions.
 *
 * Keeping diet and timing data outside the mob registry lets the entity code
 * stay generic: wolves, horses and livestock all share the same feed/breed
 * pipeline and only differ by the numbers in this table.
 */
const WHEAT = 441;
const CARROT = 445;
const POTATO = 446;
const SEEDS = 533;
const MILLET_SEEDS = 525;
const BONE = 422;
const RAW_BEEF = 430;
const RAW_MUTTON = 434;
const RAW_CHICKEN = 438;
const SWEET_BERRIES = 443;
const RAW_FISH = 473;
const DANDELION = 202;
const POPPY = 203;

export const ANIMAL_TIMING = Object.freeze({
  growthSeconds: 90,
  feedGrowthBoost: 25,
  breedCooldown: 55,
  loveSeconds: 30,
  eggSeconds: 90,
  woolRegrowSeconds: 120,
  followDistance: 2.6,
  leashDistance: 12,
});

export const ANIMAL_DIET = Object.freeze({
  cow: { foods: [WHEAT], breedFoods: [WHEAT] },
  pig: { foods: [CARROT, POTATO], breedFoods: [CARROT, POTATO] },
  sheep: { foods: [WHEAT], breedFoods: [WHEAT] },
  chicken: { foods: [SEEDS, MILLET_SEEDS], breedFoods: [SEEDS, MILLET_SEEDS], laysEggs: true },
  rabbit: { foods: [CARROT], breedFoods: [CARROT] },
  horse: { foods: [WHEAT, CARROT], breedFoods: [WHEAT], tameFood: WHEAT, tameChance: 0.6, rideable: true },
  camel: { foods: [WHEAT], breedFoods: [WHEAT], tameFood: WHEAT, tameChance: 0.5, rideable: true },
  wolf: {
    foods: [RAW_BEEF, RAW_MUTTON, RAW_CHICKEN],
    breedFoods: [RAW_BEEF, RAW_MUTTON, RAW_CHICKEN],
    tameFood: BONE,
    tameChance: 0.45,
    pet: true,
  },
  fox: { foods: [SWEET_BERRIES, RAW_CHICKEN], breedFoods: [SWEET_BERRIES] },
  bee: { foods: [DANDELION, POPPY], breedFoods: [DANDELION, POPPY] },
  bird: { foods: [SEEDS, MILLET_SEEDS], breedFoods: [SEEDS, MILLET_SEEDS] },
  fish: { foods: [RAW_FISH], breedFoods: [RAW_FISH] },
  axolotl: { foods: [RAW_FISH], breedFoods: [RAW_FISH] },
});

/** Returns the diet entry for an entity type, or null for untameable mobs. */
export function animalDiet(type) {
  return ANIMAL_DIET[type] ?? null;
}
