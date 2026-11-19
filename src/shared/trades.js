import { getItem } from './items.js';

/** Simple, deterministic villager barter offers (give -> get). */
export const VILLAGER_OFFERS = [
  { id: 'wheat', give: { id: 441, count: 16 }, get: { id: 440, count: 1 } },
  { id: 'iron', give: { id: 403, count: 6 }, get: { id: 440, count: 1 } },
  { id: 'diamond', give: { id: 405, count: 4 }, get: { id: 440, count: 1 } },
  { id: 'bread', give: { id: 440, count: 1 }, get: { id: 442, count: 4 } },
  { id: 'apple', give: { id: 440, count: 1 }, get: { id: 406, count: 3 } },
  { id: 'carrot', give: { id: 440, count: 1 }, get: { id: 445, count: 5 } },
];

/** Every villager gets a stable set of four offers based on its position. */
export function offersForVillager(entity) {
  const x = Number(entity?.position?.x) || 0;
  const z = Number(entity?.position?.z) || 0;
  const seed = Math.abs(Math.floor(x * 31 + z * 17)) % VILLAGER_OFFERS.length;
  return Array.from({ length: 4 }, (_, i) => VILLAGER_OFFERS[(seed + i) % VILLAGER_OFFERS.length]);
}

export function countItem(inventory, id) {
  let count = 0;
  for (const stack of inventory?.slots ?? []) {
    if (stack?.id === id) count += stack.count;
  }
  return count;
}

function consumeItems(inventory, id, count) {
  let left = count;
  for (let i = 0; i < (inventory?.slots?.length ?? 0) && left > 0; i++) {
    const stack = inventory.slots[i];
    if (stack?.id !== id) continue;
    const take = Math.min(stack.count, left);
    inventory.removeFromSlot(i, take);
    left -= take;
  }
  return left === 0;
}

/** Returns false when the trade is impossible, otherwise the leftover stack. */
export function performTrade(inventory, offer) {
  if (!inventory || !offer) return false;
  if (!consumeItems(inventory, offer.give.id, offer.give.count)) return false;
  return inventory.addStack({ id: offer.get.id, count: offer.get.count });
}

export function describeOffer(offer) {
  if (!offer) return '';
  const give = getItem(offer.give.id)?.name ?? '?';
  const get = getItem(offer.get.id)?.name ?? '?';
  return `${offer.give.count} × ${give} → ${offer.get.count} × ${get}`;
}
