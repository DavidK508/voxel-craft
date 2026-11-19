import { getArmorInfo, getItem, getMaxStack, createItemStack } from '../shared/items.js';

export const INVENTORY_SIZE = 36;
export const HOTBAR_SIZE = 9;

/**
 * Tools must always carry their remaining durability. Several code paths build
 * stacks by hand (crafting cursor, quick move, old saves), so normalising here
 * keeps every tool breakable instead of silently lasting forever.
 */
function withToolDurability(stack) {
  if (!stack) return null;
  const item = getItem(stack.id);
  const meta = item?.tool ?? item?.armor;
  if (!meta) return stack;
  const max = meta.durability;
  const current = Number.isFinite(stack.durability) ? stack.durability : max;
  return { ...stack, durability: Math.max(0, Math.min(max, current)) };
}

export class Inventory {
  constructor() {
    this.slots = new Array(INVENTORY_SIZE).fill(null);
    // Equipped armor in Minecraft order: head, chest, legs, feet.
    this.armor = new Array(4).fill(null);
    this.selected = 0;
  }

  get selectedStack() {
    return this.slots[this.selected];
  }

  setSelected(index) {
    this.selected = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  }

  add(id, count = 1, durability = undefined) {
    const item = getItem(id);
    if (!item) return count;
    let remaining = count;
    const maxStack = getMaxStack(id);

    if (maxStack > 1) {
      for (let i = 0; i < INVENTORY_SIZE && remaining > 0; i++) {
        const slot = this.slots[i];
        if (slot && slot.id === id && slot.count < maxStack) {
          const move = Math.min(maxStack - slot.count, remaining);
          slot.count += move;
          remaining -= move;
        }
      }
    }

    for (let i = 0; i < INVENTORY_SIZE && remaining > 0; i++) {
      if (!this.slots[i]) {
        const move = Math.min(maxStack, remaining);
        this.slots[i] = withToolDurability({
          id,
          count: move,
          ...(durability !== undefined ? { durability } : {}),
        });
        remaining -= move;
      }
    }
    return remaining;
  }

  addStack(stack) {
    if (!stack) return null;
    const item = getItem(stack.id);
    if (!item) return stack;
    let remaining = stack.count;
    const maxStack = getMaxStack(stack.id);
    if (maxStack > 1) {
      for (let i = 0; i < INVENTORY_SIZE && remaining > 0; i++) {
        const slot = this.slots[i];
        if (slot && slot.id === stack.id && slot.count < maxStack) {
          const move = Math.min(maxStack - slot.count, remaining);
          slot.count += move;
          remaining -= move;
        }
      }
    }
    for (let i = 0; i < INVENTORY_SIZE && remaining > 0; i++) {
      if (!this.slots[i]) {
        const move = Math.min(maxStack, remaining);
        this.slots[i] = withToolDurability({ ...stack, count: move });
        remaining -= move;
      }
    }
    return remaining > 0 ? { ...stack, count: remaining } : null;
  }

  addStackToRange(stack, start, end, skip = -1) {
    if (!stack) return null;
    const item = getItem(stack.id);
    if (!item) return stack;
    let remaining = stack.count;
    const maxStack = getMaxStack(stack.id);
    const from = Math.max(0, start);
    const to = Math.min(INVENTORY_SIZE, end);

    if (maxStack > 1) {
      for (let i = from; i < to && remaining > 0; i++) {
        if (i === skip) continue;
        const slot = this.slots[i];
        if (slot && slot.id === stack.id && slot.count < maxStack) {
          const move = Math.min(maxStack - slot.count, remaining);
          slot.count += move;
          remaining -= move;
        }
      }
    }
    for (let i = from; i < to && remaining > 0; i++) {
      if (i === skip) continue;
      if (!this.slots[i]) {
        const move = Math.min(maxStack, remaining);
        this.slots[i] = withToolDurability({ ...stack, count: move });
        remaining -= move;
      }
    }
    return remaining > 0 ? { ...stack, count: remaining } : null;
  }

  canAdd(id, count = 1) {
    const item = getItem(id);
    if (!item) return false;
    const maxStack = getMaxStack(id);
    let space = 0;
    for (const slot of this.slots) {
      if (!slot) space += maxStack;
      else if (slot.id === id) space += Math.max(0, maxStack - slot.count);
      if (space >= count) return true;
    }
    return false;
  }

  removeFromSlot(index, count = 1) {
    const slot = this.slots[index];
    if (!slot) return null;
    const take = Math.min(slot.count, count);
    const result = { ...slot, count: take };
    slot.count -= take;
    if (slot.count <= 0) this.slots[index] = null;
    return result;
  }

  takeOne(index) {
    return this.removeFromSlot(index, 1);
  }

  setSlot(index, stack) {
    if (index < 0 || index >= INVENTORY_SIZE) return;
    this.slots[index] = withToolDurability(stack);
  }

  setArmorSlot(index, stack) {
    if (index < 0 || index >= this.armor.length) return;
    this.armor[index] = withToolDurability(stack);
  }

  swap(a, b) {
    const tmp = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = tmp;
  }

  consumeSelected(count = 1) {
    const slot = this.slots[this.selected];
    if (!slot) return;
    slot.count -= count;
    if (slot.count <= 0) this.slots[this.selected] = null;
  }

  damageSelected(amount = 1) {
    const slot = this.slots[this.selected];
    if (!slot || slot.durability === undefined) return false;
    slot.durability -= amount;
    if (slot.durability <= 0) {
      this.slots[this.selected] = null;
      return true;
    }
    return false;
  }

  firstEmptySlot() {
    return this.slots.findIndex((slot) => !slot);
  }

  countItem(id) {
    return this.slots.reduce((sum, slot) => sum + (slot?.id === id ? slot.count : 0), 0);
  }

  isEmpty() {
    return this.slots.every((slot) => !slot);
  }

  armorPoints() {
    return this.armor.reduce((sum, stack) => sum + (getArmorInfo(stack?.id)?.defense ?? 0), 0);
  }

  /** Wears down every equipped piece; returns true when anything changed. */
  damageArmor(amount = 1) {
    let changed = false;
    for (let i = 0; i < this.armor.length; i++) {
      const stack = this.armor[i];
      const info = getArmorInfo(stack?.id);
      if (!stack || !info) continue;
      stack.durability = (stack.durability ?? info.durability) - amount;
      changed = true;
      if (stack.durability <= 0) this.armor[i] = null;
    }
    return changed;
  }

  serialize() {
    return {
      slots: this.slots.map((slot) => (slot ? { ...slot } : null)),
      armor: this.armor.map((slot) => (slot ? { ...slot } : null)),
      selected: this.selected,
    };
  }

  deserialize(data) {
    if (!data) return;
    const slots = Array.isArray(data.slots) ? data.slots : [];
    this.slots = new Array(INVENTORY_SIZE).fill(null);
    for (let i = 0; i < Math.min(INVENTORY_SIZE, slots.length); i++) {
      const slot = slots[i];
      if (slot && getItem(slot.id)) {
        this.slots[i] = withToolDurability({
          id: slot.id,
          count: Math.max(1, Math.min(getMaxStack(slot.id), slot.count || 1)),
          ...(slot.durability !== undefined ? { durability: slot.durability } : {}),
        });
      }
    }
    const armor = Array.isArray(data.armor) ? data.armor : [];
    this.armor = new Array(4).fill(null);
    for (let i = 0; i < Math.min(4, armor.length); i++) {
      const stack = armor[i];
      if (!stack || !getItem(stack.id)) continue;
      this.armor[i] = withToolDurability({
        id: stack.id,
        count: 1,
        ...(stack.durability !== undefined ? { durability: stack.durability } : {}),
      });
    }
    this.selected = Math.max(0, Math.min(HOTBAR_SIZE - 1, data.selected || 0));
  }

  /** Creative hotbar: common building blocks, already in full stacks. */
  fillCreativeKit() {
    const kit = [
      21, // верстак
      2, // травяной блок
      3, // земля
      4, // булыжник
      5, // дубовые доски
      6, // дубовое бревно
      12, // стекло
      8, // песок
      23, // кирпичный блок
    ];
    for (const id of kit) this.add(id, 64);
  }

  clear() {
    this.slots.fill(null);
    this.armor.fill(null);
    this.selected = 0;
  }

  static fromSerialized(data) {
    const inventory = new Inventory();
    inventory.deserialize(data);
    return inventory;
  }

  static createCreative() {
    const inventory = new Inventory();
    inventory.fillCreativeKit();
    return inventory;
  }

  static makeStack(id, count = 1) {
    return createItemStack(id, count);
  }
}
