import { ITEM_IDS } from './items.js';

/** Block id of tilled soil. Crop stages live in 184-199 so saves stay one byte. */
export const FARMLAND_BLOCK = 183;

export const HOE_IDS = Object.freeze([
  ITEM_IDS.WOODEN_HOE,
  ITEM_IDS.STONE_HOE,
  ITEM_IDS.IRON_HOE,
  ITEM_IDS.DIAMOND_HOE,
]);

const hoeSet = new Set(HOE_IDS);

export const CROPS = Object.freeze([
  {
    key: 'wheat', name: 'Пшеница', seed: ITEM_IDS.WHEAT_SEEDS,
    yield: ITEM_IDS.WHEAT, stages: [184, 185, 186], mature: 64,
  },
  {
    key: 'carrot', name: 'Морковь', seed: ITEM_IDS.CARROT,
    yield: ITEM_IDS.CARROT, stages: [187, 188, 189], mature: 65,
  },
  {
    key: 'potato', name: 'Картофель', seed: ITEM_IDS.POTATO,
    yield: ITEM_IDS.POTATO, stages: [190, 191, 192], mature: 66,
  },
  {
    key: 'beetroot', name: 'Свёкла', seed: ITEM_IDS.BEETROOT,
    yield: ITEM_IDS.BEETROOT, stages: [193, 194, 195], mature: 67,
  },
  {
    key: 'millet', name: 'Пшено', seed: ITEM_IDS.MILLET_SEEDS,
    yield: ITEM_IDS.MILLET, stages: [196, 197, 198], mature: 199,
  },
]);

const cropByBlock = new Map();
const cropBySeed = new Map();
for (const crop of CROPS) {
  crop.stages.forEach((id, index) => cropByBlock.set(id, { crop, stage: index }));
  cropByBlock.set(crop.mature, { crop, stage: 3 });
  cropBySeed.set(crop.seed, crop);
}

export function isTillable(id) {
  return id === 2 || id === 3 || id === 49;
}

export function isFarmland(id) {
  return id === FARMLAND_BLOCK;
}

export function isHoe(id) {
  return hoeSet.has(id);
}

export function getPlantableCrop(seedId) {
  return cropBySeed.get(seedId) ?? null;
}

/** Returns `{ crop, stage }` for young and mature crop blocks, else null. */
export function getCropStage(blockId) {
  return cropByBlock.get(blockId) ?? null;
}

export function getNextCropStage(blockId) {
  const info = cropByBlock.get(blockId);
  if (!info || info.stage >= 3) return null;
  return info.crop.stages[info.stage + 1] ?? info.crop.mature;
}

/** Water in any orthogonal neighbour keeps a plot watered. */
export function hasWaterNearby(world, x, y, z) {
  if (!world?.getBlock) return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (world.getBlock(x + dx, y, z + dz) === 11) return true;
  }
  return false;
}
