import { SEA_LEVEL, WORLD_HEIGHT } from './constants.js';

export const WATER_BLOCK_ID = 11;

export function isWaterBlock(id) {
  return id === WATER_BLOCK_ID;
}

/** Topmost contiguous water block in a column, or null when the column is dry. */
export function waterSurfaceAt(world, x, z, fromY = SEA_LEVEL + 4, minY = 0) {
  if (!world?.getBlock) return null;
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const start = Math.max(0, Math.min(WORLD_HEIGHT - 1, Math.floor(fromY)));
  const bottom = Math.max(0, Math.floor(minY));
  for (let y = start; y >= bottom; y--) {
    if (isWaterBlock(world.getBlock(bx, y, bz))) return y;
  }
  return null;
}

export function isInWater(world, position, offsetY = 0.2) {
  if (!world?.getBlock) return false;
  return isWaterBlock(world.getBlock(
    Math.floor(position.x),
    Math.floor(position.y + offsetY),
    Math.floor(position.z),
  ));
}
