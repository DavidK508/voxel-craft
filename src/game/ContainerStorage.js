import { getItem, getMaxStack } from '../shared/items.js';
import { CHEST_SLOTS } from '../shared/storage.js';

const keyOf = (x, y, z) => `${x},${y},${z}`;

function normalizeStack(stack) {
  if (!stack || !getItem(stack.id)) return null;
  const count = Math.max(1, Math.min(getMaxStack(stack.id), Math.floor(Number(stack.count) || 1)));
  return {
    id: stack.id,
    count,
    ...(Number.isFinite(stack.durability) ? { durability: Math.max(0, stack.durability) } : {}),
  };
}

/**
 * Per-coordinate contents for placeable containers. The slot array returned by
 * `slotsAt` is the live storage: the chest UI mutates it directly, so saves can
 * simply serialise this map without a separate commit step.
 */
export class ContainerStorage {
  constructor() {
    this.containers = new Map();
  }

  slotsAt(x, y, z) {
    const key = keyOf(x, y, z);
    let slots = this.containers.get(key);
    if (!slots) {
      slots = new Array(CHEST_SLOTS).fill(null);
      this.containers.set(key, slots);
    }
    return slots;
  }

  has(x, y, z) {
    return this.containers.has(keyOf(x, y, z));
  }

  /** Returns the contents when a chest is broken, removing it from storage. */
  remove(x, y, z) {
    const key = keyOf(x, y, z);
    const slots = this.containers.get(key);
    this.containers.delete(key);
    return slots ?? null;
  }

  serialize() {
    const result = [];
    for (const [key, slots] of this.containers) {
      const [x, y, z] = key.split(',').map(Number);
      if (![x, y, z].every(Number.isFinite)) continue;
      const items = [];
      for (let index = 0; index < slots.length; index++) {
        const stack = normalizeStack(slots[index]);
        if (stack) items.push({ slot: index, stack });
      }
      if (!items.length) continue;
      result.push({ x, y, z, items });
    }
    return result;
  }

  deserialize(entries) {
    this.containers.clear();
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      const x = Math.floor(Number(entry?.x));
      const y = Math.floor(Number(entry?.y));
      const z = Math.floor(Number(entry?.z));
      if (![x, y, z].every(Number.isFinite)) continue;
      const slots = new Array(CHEST_SLOTS).fill(null);
      const items = Array.isArray(entry.items) ? entry.items : [];
      for (const item of items) {
        const index = Math.floor(Number(item?.slot));
        const stack = normalizeStack(item?.stack);
        if (index >= 0 && index < CHEST_SLOTS && stack) slots[index] = stack;
      }
      if (slots.some(Boolean)) this.containers.set(keyOf(x, y, z), slots);
    }
  }

  clear() {
    this.containers.clear();
  }
}
