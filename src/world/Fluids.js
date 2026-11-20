import { getBlock } from '../shared/blocks.js';

export const WATER_ID = 11;
export const LAVA_ID = 30;

const MAX_LEVEL = { [WATER_ID]: 7, [LAVA_ID]: 3 };
const TICK_SECONDS = 0.22;
const MAX_UPDATES_PER_TICK = 6000;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function keyOf(x, y, z) {
  return `${x},${y},${z}`;
}

function parseKey(key) {
  const [x, y, z] = key.split(',').map(Number);
  return { x, y, z };
}

function isFluid(id) {
  return id === WATER_ID || id === LAVA_ID;
}

/**
 * A tiny Minecraft-style fluid automaton.
 *
 * Water and lava are still ordinary block ids (the renderer only knows full
 * cubes), but this class remembers a spread level per cell. A placed source is
 * level 0; every step it flows down (a falling column) and sideways up to 7
 * blocks for water or 3 for lava. Cells without a source dry up again, and
 * lava touching water turns into cobblestone/obsidian. Water created by the
 * terrain generator is adopted as an endless source once a neighbouring cell
 * changes, so oceans, lakes and rivers can flow into freshly opened gaps.
 */
export class FluidSimulation {
  constructor(world) {
    this.world = world;
    this.levels = new Map();
    this.sources = new Set();
    // Water placed by the terrain generator starts as an ordinary block. Once a
    // neighbouring cell changes we adopt it as an endless natural source so it
    // can flow into the gap instead of sitting there like a solid.
    this.natural = new Set();
    this.falling = new Set();
    this.queue = new Set();
    this.timer = 0;
  }

  claimNatural(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    if (!isFluid(id)) return;
    const key = keyOf(x, y, z);
    if (this.levels.has(key)) {
      this.queue.add(key);
      return;
    }
    this.levels.set(key, 0);
    this.natural.add(key);
    this.falling.delete(key);
    this.queue.add(key);
  }

  setSource(x, y, z, id) {
    if (!isFluid(id)) return;
    const key = keyOf(x, y, z);
    this.levels.set(key, 0);
    this.sources.add(key);
    this.natural.delete(key);
    this.falling.delete(key);
    this.queue.add(key);
  }

  /** Removes the bookkeeping for a cell (for example after a bucket fill). */
  remove(x, y, z) {
    const key = keyOf(x, y, z);
    this.levels.delete(key);
    this.sources.delete(key);
    this.natural.delete(key);
    this.falling.delete(key);
  }

  /** Wakes the fluid in this cell and its six neighbours. */
  wake(x, y, z) {
    const key = keyOf(x, y, z);
    if (this.levels.has(key)) this.queue.add(key);
    else this.claimNatural(x, y, z);
    this.wakeNeighbors(x, y, z);
  }

  wakeNeighbors(x, y, z) {
    for (const [dx, dy, dz] of [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ]) {
      this.claimNatural(x + dx, y + dy, z + dz);
    }
  }

  update(dt) {
    this.timer += dt;
    if (this.timer < TICK_SECONDS) return;
    this.timer = 0;
    this.step();
  }

  step() {
    if (this.queue.size === 0) return;
    const pending = [...this.queue];
    this.queue.clear();
    let budget = MAX_UPDATES_PER_TICK;

    for (const key of pending) {
      if (budget-- <= 0) {
        this.queue.add(key);
        continue;
      }
      const { x, y, z } = parseKey(key);
      const id = this.world.getBlock(x, y, z);
      if (!isFluid(id)) {
        this.levels.delete(key);
        this.sources.delete(key);
        this.natural.delete(key);
        this.falling.delete(key);
        continue;
      }

      if (!this.levels.has(key)) continue;

      const level = this.levels.get(key);
      if (!this.supported(key, x, y, z, id, level)) {
        this.world.setBlock(x, y, z, 0);
        this.levels.delete(key);
        this.sources.delete(key);
        this.natural.delete(key);
        this.falling.delete(key);
        this.wakeNeighbors(x, y, z);
        continue;
      }

      // Lava + water: flowing lava becomes cobblestone, a source becomes
      // obsidian, exactly like the real game.
      if (id === LAVA_ID && this.touchesWater(x, y, z)) {
        this.world.setBlock(x, y, z, level === 0 && this.sources.has(key) ? 25 : 4);
        this.levels.delete(key);
        this.sources.delete(key);
        this.natural.delete(key);
        this.falling.delete(key);
        this.wakeNeighbors(x, y, z);
        continue;
      }

      this.flow(x, y, z, id, level);
    }
  }

  supported(key, x, y, z, id, level) {
    // Real sources and natural ocean/river water never dry out.
    if (this.sources.has(key) || this.natural.has(key)) return true;
    if (level === 0 && !this.falling.has(key)) return true;
    if (this.world.getBlock(x, y + 1, z) === id) return true;
    if (level <= 0) return false;

    for (const [dx, dz] of DIRECTIONS) {
      const nx = x + dx;
      const nz = z + dz;
      if (this.world.getBlock(nx, y, nz) !== id) continue;
      const neighbour = this.levels.get(keyOf(nx, y, nz)) ?? 0;
      if (neighbour < level) return true;
    }
    return false;
  }

  flow(x, y, z, id, level) {
    if (y > 0) {
      const below = this.world.getBlock(x, y - 1, z);
      if (this.canFlowInto(below, id) && this.world.setBlock(x, y - 1, z, id)) {
        const belowKey = keyOf(x, y - 1, z);
        this.levels.set(belowKey, 0);
        this.sources.delete(belowKey);
        this.falling.add(belowKey);
        this.queue.add(belowKey);
      }
    }

    const max = MAX_LEVEL[id];
    if (level >= max) return;

    for (const [dx, dz] of DIRECTIONS) {
      const nx = x + dx;
      const nz = z + dz;
      const neighbourId = this.world.getBlock(nx, y, nz);
      if (!this.canFlowInto(neighbourId, id)) continue;
      const neighbourKey = keyOf(nx, y, nz);
      const existingLevel = this.levels.get(neighbourKey);
      if (existingLevel !== undefined && existingLevel <= level + 1) continue;
      if (!this.world.setBlock(nx, y, nz, id)) continue;
      this.levels.set(neighbourKey, level + 1);
      this.sources.delete(neighbourKey);
      this.falling.delete(neighbourKey);
      this.queue.add(neighbourKey);
    }
  }

  canFlowInto(blockId, fluidId) {
    if (blockId === 0) return true;
    if (blockId === fluidId) return false;
    // Never replace solids or other fluids; only empty cells are flooded.
    return false;
  }

  touchesWater(x, y, z) {
    for (const [dx, dy, dz] of [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ]) {
      if (this.world.getBlock(x + dx, y + dy, z + dz) === WATER_ID) return true;
    }
    return false;
  }

  serialize() {
    const result = [];
    for (const [key, level] of this.levels) {
      const { x, y, z } = parseKey(key);
      const id = this.world.getBlock(x, y, z);
      if (!isFluid(id) || this.natural.has(key)) continue;
      result.push([x, y, z, level, this.sources.has(key) ? 1 : 0]);
    }
    return result;
  }

  load(entries) {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 4) continue;
      const [x, y, z, level, source] = entry;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (!isFluid(this.world.getBlock(x, y, z))) continue;
      const key = keyOf(x, y, z);
      this.levels.set(key, Number(level) || 0);
      if (source) this.sources.add(key);
      else if ((Number(level) || 0) === 0) this.falling.add(key);
    }
  }

  dispose() {
    this.levels.clear();
    this.sources.clear();
    this.natural.clear();
    this.falling.clear();
    this.queue.clear();
  }
}

export { isFluid };
