import { TILE } from './textures.js';

export const AIR = 0;

const all = (tile) => [tile, tile, tile, tile, tile, tile];
const topBottomSide = (top, bottom, side) => [top, bottom, side, side, side, side];

// Horizontal facings match the player's yaw: 0 = north (-Z), 1 = east (+X),
// 2 = south (+Z), 3 = west (-X). Pistons additionally use 4 = down, 5 = up.
export const HORIZONTAL_OFFSETS = Object.freeze([
  { x: 0, y: 0, z: -1 },
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 0, z: 0 },
]);

export const FACING_OFFSETS = Object.freeze([
  ...HORIZONTAL_OFFSETS,
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 1, z: 0 },
]);

export const STATE_IDS = Object.freeze({
  BED: 69,
  TORCH_WALL: 77,
  DOOR: 81,
  LEVER: 97,
  BUTTON: 105,
  PLATE: 113,
  DUST: 115,
  REPEATER: 117,
  LAMP: 149,
  PISTON: 151,
  PISTON_HEAD: 163,
  STICKY_PISTON: 169,
  REDSTONE_BLOCK: 181,
  REDSTONE_ORE: 182,
});

const facingOf = (value, limit = 4) => ((Math.floor(Number(value) || 0) % limit) + limit) % limit;

export function facingFromYaw(yaw) {
  return facingOf(Math.round(-Number(yaw || 0) / (Math.PI / 2)));
}

export function facingFromNormal(normal) {
  if (!normal) return 0;
  if (normal.y > 0.5) return 5;
  if (normal.y < -0.5) return 4;
  if (normal.x > 0.5) return 1;
  if (normal.x < -0.5) return 3;
  if (normal.z > 0.5) return 2;
  return 0;
}

export const getBedId = (facing, head = false) => STATE_IDS.BED + facingOf(facing) * 2 + (head ? 1 : 0);
export const getWallTorchId = (facing) => STATE_IDS.TORCH_WALL + facingOf(facing);
export const getDoorId = (facing, open = false, half = 0) => (
  STATE_IDS.DOOR + facingOf(facing) * 4 + (open ? 2 : 0) + (half ? 1 : 0)
);
export const getLeverId = (facing, powered = false) => STATE_IDS.LEVER + facingOf(facing) * 2 + (powered ? 1 : 0);
export const getButtonId = (facing, pressed = false) => STATE_IDS.BUTTON + facingOf(facing) * 2 + (pressed ? 1 : 0);
export const getPlateId = (powered = false) => STATE_IDS.PLATE + (powered ? 1 : 0);
export const getDustId = (powered = false) => STATE_IDS.DUST + (powered ? 1 : 0);
export const getRepeaterId = (facing, powered = false, delay = 1) => (
  STATE_IDS.REPEATER + facingOf(facing) * 8 + (powered ? 4 : 0) + (Math.min(4, Math.max(1, Math.floor(delay))) - 1)
);
export const getLampId = (lit = false) => STATE_IDS.LAMP + (lit ? 1 : 0);
export const getPistonId = (facing, extended = false, sticky = false) => (
  (sticky ? STATE_IDS.STICKY_PISTON : STATE_IDS.PISTON) + facingOf(facing, 6) * 2 + (extended ? 1 : 0)
);
export const getPistonHeadId = (facing) => STATE_IDS.PISTON_HEAD + facingOf(facing, 6);

export function decodeState(id) {
  const value = Number(id);
  if (!Number.isFinite(value)) return null;
  if (value >= STATE_IDS.BED && value < STATE_IDS.TORCH_WALL) {
    const offset = value - STATE_IDS.BED;
    return { type: 'bed', facing: offset >> 1, head: (offset & 1) === 1 };
  }
  if (value >= STATE_IDS.TORCH_WALL && value < STATE_IDS.DOOR) {
    return { type: 'torch', facing: value - STATE_IDS.TORCH_WALL };
  }
  if (value >= STATE_IDS.DOOR && value < STATE_IDS.LEVER) {
    const offset = value - STATE_IDS.DOOR;
    return { type: 'door', facing: (offset >> 2) & 3, open: (offset & 2) !== 0, half: offset & 1 };
  }
  if (value >= STATE_IDS.LEVER && value < STATE_IDS.BUTTON) {
    const offset = value - STATE_IDS.LEVER;
    return { type: 'lever', facing: offset >> 1, powered: (offset & 1) === 1 };
  }
  if (value >= STATE_IDS.BUTTON && value < STATE_IDS.PLATE) {
    const offset = value - STATE_IDS.BUTTON;
    return { type: 'button', facing: offset >> 1, pressed: (offset & 1) === 1 };
  }
  if (value >= STATE_IDS.PLATE && value < STATE_IDS.DUST) {
    return { type: 'plate', powered: value === STATE_IDS.PLATE + 1 };
  }
  if (value >= STATE_IDS.DUST && value < STATE_IDS.REPEATER) {
    return { type: 'wire', powered: value === STATE_IDS.DUST + 1 };
  }
  if (value >= STATE_IDS.REPEATER && value < STATE_IDS.LAMP) {
    const offset = value - STATE_IDS.REPEATER;
    return {
      type: 'repeater',
      facing: (offset >> 3) & 3,
      powered: (offset & 4) !== 0,
      delay: (offset & 3) + 1,
    };
  }
  if (value >= STATE_IDS.LAMP && value < STATE_IDS.PISTON) {
    return { type: 'lamp', lit: value === STATE_IDS.LAMP + 1 };
  }
  if (value >= STATE_IDS.PISTON && value < STATE_IDS.PISTON_HEAD) {
    const offset = value - STATE_IDS.PISTON;
    return { type: 'piston', facing: (offset >> 1) & 7, extended: (offset & 1) === 1, sticky: false };
  }
  if (value >= STATE_IDS.PISTON_HEAD && value < STATE_IDS.STICKY_PISTON) {
    return { type: 'piston_head', facing: value - STATE_IDS.PISTON_HEAD };
  }
  if (value >= STATE_IDS.STICKY_PISTON && value < STATE_IDS.REDSTONE_BLOCK) {
    const offset = value - STATE_IDS.STICKY_PISTON;
    return { type: 'piston', facing: (offset >> 1) & 7, extended: (offset & 1) === 1, sticky: true };
  }
  if (value === STATE_IDS.REDSTONE_BLOCK) return { type: 'redstone_block' };
  if (value === STATE_IDS.REDSTONE_ORE) return { type: 'redstone_ore' };
  return null;
}

function pistonTiles(facing, head = false) {
  const side = head ? TILE.piston_head_side : TILE.piston_side;
  const top = head ? TILE.piston_head_top : TILE.piston_top;
  const front = head ? TILE.piston_head_top : TILE.piston_front;
  const tiles = all(side);
  tiles[0] = top;
  tiles[1] = side;
  if (facing === 0) tiles[5] = front;
  else if (facing === 1) tiles[2] = front;
  else if (facing === 2) tiles[4] = front;
  else if (facing === 3) tiles[3] = front;
  else if (facing === 4) tiles[1] = front;
  else tiles[0] = front;
  return tiles;
}

/**
 * Block registry.
 *
 * faceTiles order: +Y (top), -Y (bottom), +X (east), -X (west), +Z (south), -Z (north)
 * hardness is the Minecraft-style base hardness. Break time is derived from it.
 */
const defs = [
  {
    id: 1, key: 'stone', name: 'Камень', hardness: 1.5, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.stone), drops: [{ id: 4, count: 1 }],
  },
  {
    id: 2, key: 'grass_block', name: 'Травяной блок', hardness: 0.6, tool: 'shovel',
    faceTiles: topBottomSide(TILE.grass_top, TILE.dirt, TILE.grass_side),
    drops: [{ id: 3, count: 1 }], mergeSides: false,
  },
  {
    id: 3, key: 'dirt', name: 'Земля', hardness: 0.5, tool: 'shovel',
    faceTiles: all(TILE.dirt), drops: [{ id: 3, count: 1 }],
  },
  {
    id: 4, key: 'cobblestone', name: 'Булыжник', hardness: 2, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.cobblestone), drops: [{ id: 4, count: 1 }],
  },
  {
    id: 5, key: 'oak_planks', name: 'Дубовые доски', hardness: 2, tool: 'axe',
    faceTiles: all(TILE.oak_planks), drops: [{ id: 5, count: 1 }],
  },
  {
    id: 6, key: 'oak_log', name: 'Дубовое бревно', hardness: 2, tool: 'axe',
    faceTiles: topBottomSide(TILE.oak_log_top, TILE.oak_log_top, TILE.oak_log_side),
    drops: [{ id: 6, count: 1 }],
  },
  {
    id: 7, key: 'oak_leaves', name: 'Дубовая листва', hardness: 0.2, tool: 'axe',
    faceTiles: all(TILE.oak_leaves), opaque: false, cutout: true, renderLayer: 'cutout',
    drops: [{ id: 406, count: 1, chance: 0.12 }],
  },
  {
    id: 8, key: 'sand', name: 'Песок', hardness: 0.5, tool: 'shovel',
    faceTiles: all(TILE.sand), drops: [{ id: 8, count: 1 }],
  },
  {
    id: 9, key: 'sandstone', name: 'Песчаник', hardness: 0.8, tool: 'pickaxe', minTier: 1,
    faceTiles: topBottomSide(TILE.sandstone_top, TILE.sandstone_bottom, TILE.sandstone_side),
    drops: [{ id: 9, count: 1 }],
  },
  {
    id: 10, key: 'gravel', name: 'Гравий', hardness: 0.6, tool: 'shovel',
    faceTiles: all(TILE.gravel), drops: [{ id: 10, count: 1 }],
  },
  {
    id: 11, key: 'water', name: 'Вода', hardness: -1, fluid: true,
    faceTiles: all(TILE.water), solid: false, opaque: false, renderLayer: 'water',
  },
  {
    id: 12, key: 'glass', name: 'Стекло', hardness: 0.3, tool: 'pickaxe',
    faceTiles: all(TILE.glass), opaque: false, cutout: true, renderLayer: 'cutout',
    // Daylight passes through glass, so a glass roof must not cast a shadow.
    skyTransparent: true,
    drops: [],
  },
  {
    id: 13, key: 'bedrock', name: 'Бедрок', hardness: -1,
    faceTiles: all(TILE.bedrock), drops: [],
  },
  {
    id: 14, key: 'coal_ore', name: 'Угольная руда', hardness: 3, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.coal_ore), drops: [{ id: 401, count: 1 }],
  },
  {
    id: 15, key: 'iron_ore', name: 'Железная руда', hardness: 3, tool: 'pickaxe', minTier: 2,
    faceTiles: all(TILE.iron_ore), drops: [{ id: 403, count: 1 }],
  },
  {
    id: 16, key: 'gold_ore', name: 'Золотая руда', hardness: 3, tool: 'pickaxe', minTier: 2,
    faceTiles: all(TILE.gold_ore), drops: [{ id: 404, count: 1 }],
  },
  {
    id: 17, key: 'diamond_ore', name: 'Алмазная руда', hardness: 3, tool: 'pickaxe', minTier: 3,
    faceTiles: all(TILE.diamond_ore), drops: [{ id: 405, count: 1 }],
  },
  {
    id: 18, key: 'snow_block', name: 'Снег', hardness: 0.4, tool: 'shovel',
    faceTiles: all(TILE.snow), drops: [{ id: 18, count: 1 }],
  },
  {
    id: 19, key: 'ice', name: 'Лёд', hardness: 0.5, tool: 'pickaxe',
    faceTiles: all(TILE.ice), drops: [],
  },
  {
    id: 20, key: 'cactus', name: 'Кактус', hardness: 0.4,
    faceTiles: topBottomSide(TILE.cactus_top, TILE.cactus_top, TILE.cactus_side),
    drops: [{ id: 20, count: 1 }],
  },
  {
    id: 21, key: 'crafting_table', name: 'Верстак', hardness: 2.5, tool: 'axe',
    faceTiles: topBottomSide(TILE.crafting_table_top, TILE.oak_planks, TILE.crafting_table_side),
    drops: [{ id: 21, count: 1 }], interactive: 'crafting',
  },
  {
    id: 22, key: 'furnace', name: 'Печь', hardness: 3.5, tool: 'pickaxe', minTier: 1,
    faceTiles: [TILE.furnace_side, TILE.furnace_side, TILE.furnace_side, TILE.furnace_side, TILE.furnace_front, TILE.furnace_side],
    drops: [{ id: 22, count: 1 }], interactive: 'furnace', light: 12,
  },
  {
    id: 23, key: 'bricks', name: 'Кирпичный блок', hardness: 2, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.bricks), drops: [{ id: 23, count: 1 }],
  },
  {
    id: 24, key: 'clay', name: 'Глина', hardness: 0.6, tool: 'shovel',
    faceTiles: all(TILE.clay), drops: [{ id: 24, count: 1 }],
  },
  {
    id: 25, key: 'obsidian', name: 'Обсидиан', hardness: 50, tool: 'pickaxe', minTier: 4,
    faceTiles: all(TILE.obsidian), drops: [{ id: 25, count: 1 }],
  },
  {
    id: 26, key: 'deepslate', name: 'Глубинносланец', hardness: 3, tool: 'pickaxe', minTier: 1,
    faceTiles: topBottomSide(TILE.deepslate_top, TILE.deepslate_top, TILE.deepslate),
    drops: [{ id: 26, count: 1 }],
  },
  {
    id: 27, key: 'mossy_cobblestone', name: 'Замшелый булыжник', hardness: 2, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.mossy_cobblestone), drops: [{ id: 27, count: 1 }],
  },
  {
    id: 28, key: 'stone_bricks', name: 'Каменный кирпич', hardness: 1.5, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.stone_bricks), drops: [{ id: 28, count: 1 }],
  },
  {
    id: 29, key: 'glowstone', name: 'Светокамень', hardness: 0.3, tool: 'pickaxe',
    faceTiles: all(TILE.glowstone), drops: [{ id: 29, count: 1 }], light: 15,
  },
  {
    id: 30, key: 'lava', name: 'Лава', hardness: -1, fluid: true,
    faceTiles: all(TILE.lava), solid: false, opaque: true, light: 15,
  },
  {
    id: 31, key: 'iron_block', name: 'Железный блок', hardness: 5, tool: 'pickaxe', minTier: 2,
    faceTiles: all(TILE.iron_block), drops: [{ id: 31, count: 1 }],
  },
  {
    id: 32, key: 'gold_block', name: 'Золотой блок', hardness: 3, tool: 'pickaxe', minTier: 2,
    faceTiles: all(TILE.gold_block), drops: [{ id: 32, count: 1 }],
  },
  {
    id: 33, key: 'diamond_block', name: 'Алмазный блок', hardness: 5, tool: 'pickaxe', minTier: 3,
    faceTiles: all(TILE.diamond_block), drops: [{ id: 33, count: 1 }],
  },
  {
    id: 34, key: 'birch_log', name: 'Берёзовое бревно', hardness: 2, tool: 'axe',
    faceTiles: topBottomSide(TILE.birch_log_top, TILE.birch_log_top, TILE.birch_log_side),
    drops: [{ id: 34, count: 1 }],
  },
  {
    id: 35, key: 'birch_leaves', name: 'Берёзовая листва', hardness: 0.2, tool: 'axe',
    faceTiles: all(TILE.birch_leaves), opaque: false, cutout: true, renderLayer: 'cutout',
    drops: [{ id: 406, count: 1, chance: 0.1 }],
  },
  {
    id: 36, key: 'spruce_log', name: 'Еловое бревно', hardness: 2, tool: 'axe',
    faceTiles: topBottomSide(TILE.spruce_log_top, TILE.spruce_log_top, TILE.spruce_log_side),
    drops: [{ id: 36, count: 1 }],
  },
  {
    id: 37, key: 'spruce_leaves', name: 'Еловая листва', hardness: 0.2, tool: 'axe',
    faceTiles: all(TILE.spruce_leaves), opaque: false, cutout: true, renderLayer: 'cutout',
    drops: [{ id: 406, count: 1, chance: 0.1 }],
  },
  {
    id: 38, key: 'red_sand', name: 'Красный песок', hardness: 0.5, tool: 'shovel',
    faceTiles: all(TILE.red_sand), drops: [{ id: 38, count: 1 }],
  },
  {
    id: 39, key: 'terracotta', name: 'Терракота', hardness: 1.25, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.terracotta), drops: [{ id: 39, count: 1 }],
  },
  {
    id: 40, key: 'pumpkin', name: 'Тыква', hardness: 1, tool: 'axe',
    faceTiles: topBottomSide(TILE.pumpkin_top, TILE.pumpkin_top, TILE.pumpkin_side),
    drops: [{ id: 40, count: 1 }], mergeSides: false,
  },
  {
    id: 41, key: 'melon', name: 'Арбуз', hardness: 1, tool: 'axe',
    faceTiles: topBottomSide(TILE.melon_top, TILE.melon_top, TILE.melon_side),
    drops: [{ id: 41, count: 1 }], mergeSides: false,
  },
  {
    id: 42, key: 'white_wool', name: 'Белая шерсть', hardness: 0.8,
    faceTiles: all(TILE.white_wool), drops: [{ id: 42, count: 1 }],
  },
  {
    id: 43, key: 'red_wool', name: 'Красная шерсть', hardness: 0.8,
    faceTiles: all(TILE.red_wool), drops: [{ id: 43, count: 1 }],
  },
  {
    id: 44, key: 'blue_wool', name: 'Синяя шерсть', hardness: 0.8,
    faceTiles: all(TILE.blue_wool), drops: [{ id: 44, count: 1 }],
  },
  {
    id: 45, key: 'green_wool', name: 'Зелёная шерсть', hardness: 0.8,
    faceTiles: all(TILE.green_wool), drops: [{ id: 45, count: 1 }],
  },
  {
    id: 46, key: 'yellow_wool', name: 'Жёлтая шерсть', hardness: 0.8,
    faceTiles: all(TILE.yellow_wool), drops: [{ id: 46, count: 1 }],
  },
  {
    id: 47, key: 'black_wool', name: 'Чёрная шерсть', hardness: 0.8,
    faceTiles: all(TILE.black_wool), drops: [{ id: 47, count: 1 }],
  },
  {
    id: 48, key: 'bookshelf', name: 'Книжная полка', hardness: 1.5, tool: 'axe',
    faceTiles: topBottomSide(TILE.oak_planks, TILE.oak_planks, TILE.bookshelf),
    drops: [{ id: 48, count: 1 }],
  },
  {
    id: 49, key: 'snowy_grass_block', name: 'Заснеженная трава', hardness: 0.6, tool: 'shovel',
    faceTiles: topBottomSide(TILE.snow, TILE.dirt, TILE.snow_side),
    drops: [{ id: 3, count: 1 }], mergeSides: false,
  },
  {
    id: 50, key: 'netherrack', name: 'Незеррак', hardness: 0.4, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.netherrack), drops: [{ id: 50, count: 1 }],
  },
  {
    id: 51, key: 'soul_sand', name: 'Песок душ', hardness: 0.5, tool: 'shovel',
    faceTiles: all(TILE.soul_sand), drops: [{ id: 51, count: 1 }],
  },
  {
    id: 52, key: 'nether_bricks', name: 'Незерский кирпич', hardness: 2, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.nether_bricks), drops: [{ id: 52, count: 1 }],
  },
  {
    id: 53, key: 'magma', name: 'Магма', hardness: 0.5, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.magma), drops: [{ id: 53, count: 1 }], light: 3,
  },
  {
    id: 54, key: 'quartz_ore', name: 'Кварцевая руда', hardness: 3, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.quartz_ore), drops: [{ id: 405, count: 1, chance: 0.2 }],
  },
  {
    id: 55, key: 'nether_portal', name: 'Портал в Ад', hardness: -1, fluid: false,
    faceTiles: all(TILE.nether_portal), solid: false, opaque: false,
    cutout: false, skyTransparent: true, renderLayer: 'water', light: 11, drops: [],
  },
  {
    id: 56, key: 'end_stone', name: 'Камень Края', hardness: 3, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.end_stone), drops: [{ id: 56, count: 1 }],
  },
  {
    id: 57, key: 'end_portal_frame', name: 'Рамка портала Края', hardness: -1,
    faceTiles: topBottomSide(TILE.end_portal_frame_top, TILE.end_stone, TILE.end_portal_frame_side),
    drops: [],
  },
  {
    id: 58, key: 'end_portal', name: 'Портал Края', hardness: -1,
    faceTiles: all(TILE.end_portal), solid: false, opaque: false,
    skyTransparent: true, renderLayer: 'water', light: 15, drops: [],
  },
  {
    id: 59, key: 'purpur_block', name: 'Пурпурный блок', hardness: 1.5, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.purpur_block), drops: [{ id: 59, count: 1 }],
  },
  {
    id: 60, key: 'hay_block', name: 'Стог сена', hardness: 0.5,
    faceTiles: topBottomSide(TILE.hay_block_top, TILE.hay_block_top, TILE.hay_block_side),
    drops: [{ id: 60, count: 1 }], mergeSides: false,
  },
  {
    id: 61, key: 'emerald_ore', name: 'Изумрудная руда', hardness: 3, tool: 'pickaxe', minTier: 3,
    faceTiles: all(TILE.emerald_ore), drops: [{ id: 440, count: 1 }],
  },
  {
    id: 62, key: 'emerald_block', name: 'Изумрудный блок', hardness: 5, tool: 'pickaxe', minTier: 2,
    faceTiles: all(TILE.emerald_block), drops: [{ id: 62, count: 1 }],
  },
  {
    id: 63, key: 'torch', name: 'Факел', hardness: 0, light: 14,
    faceTiles: all(TILE.torch_stick), drops: [{ id: 63, count: 1 }],
    solid: false, opaque: false, cutout: false, skyTransparent: true,
    renderLayer: 'cutout', mergeSides: false,
    torch: true, facing: 5, customShape: true,
    stickTile: TILE.torch_stick, flameTile: TILE.torch_flame, pushable: false,
  },
  {
    id: 64, key: 'wheat_crop', name: 'Пшеница', hardness: 0,
    faceTiles: all(TILE.wheat_crop), drops: [{ id: 441, count: 1 }],
    solid: false, opaque: false, cutout: true,
    renderLayer: 'cutout', mergeSides: false, crossHeight: 0.9,
  },
  {
    id: 65, key: 'carrot_crop', name: 'Морковь', hardness: 0,
    faceTiles: all(TILE.carrot_crop), drops: [{ id: 445, count: 1 }],
    solid: false, opaque: false, cutout: true,
    renderLayer: 'cutout', mergeSides: false, crossHeight: 0.9,
  },
  {
    id: 66, key: 'potato_crop', name: 'Картофель', hardness: 0,
    faceTiles: all(TILE.potato_crop), drops: [{ id: 446, count: 1 }],
    solid: false, opaque: false, cutout: true,
    renderLayer: 'cutout', mergeSides: false, crossHeight: 0.9,
  },
  {
    id: 67, key: 'beetroot_crop', name: 'Свёкла', hardness: 0,
    faceTiles: all(TILE.beetroot_crop), drops: [{ id: 447, count: 1 }],
    solid: false, opaque: false, cutout: true,
    renderLayer: 'cutout', mergeSides: false, crossHeight: 0.9,
  },
  {
    id: 68, key: 'oak_fence', name: 'Дубовый забор', hardness: 1.2, tool: 'axe',
    faceTiles: all(TILE.oak_fence), drops: [{ id: 68, count: 1 }],
    opaque: false, cutout: true, renderLayer: 'cutout',
    mergeSides: false, crossHeight: 1,
    customShape: true,
  },
];

// Multi-block and powered states are encoded directly in the block id, so the
// existing edit/serialization format (one byte per cell) needs no migration.
const stateDefs = [];
const state = (def) => stateDefs.push(def);

for (let facing = 0; facing < 4; facing++) {
  for (let head = 0; head < 2; head++) {
    state({
      id: getBedId(facing, head === 1),
      key: head ? `bed_head_${facing}` : `bed_foot_${facing}`,
      name: head ? 'Кровать (изголовье)' : 'Кровать',
      hardness: 0.2,
      faceTiles: topBottomSide(TILE.bed_top, TILE.oak_planks, TILE.bed_side),
      drops: head ? [] : [{ id: 69, count: 1 }],
      interactive: 'bed', mergeSides: false,
      solid: false, opaque: false, renderLayer: 'cutout',
      bed: true, facing, head: head === 1, customShape: true,
      item: head === 0, itemId: 69, pushable: false,
    });
  }
}

for (let facing = 0; facing < 4; facing++) {
  state({
    id: getWallTorchId(facing), key: `wall_torch_${facing}`, name: 'Факел на стене',
    hardness: 0, light: 14, faceTiles: all(TILE.torch_stick),
    drops: [{ id: 63, count: 1 }],
    solid: false, opaque: false, cutout: false, skyTransparent: true,
    renderLayer: 'cutout', mergeSides: false,
    torch: true, facing, customShape: true,
    stickTile: TILE.torch_stick, flameTile: TILE.torch_flame,
    item: false, itemId: 63, pushable: false,
  });
}

for (let facing = 0; facing < 4; facing++) {
  for (let open = 0; open < 2; open++) {
    for (let half = 0; half < 2; half++) {
      state({
        id: getDoorId(facing, open === 1, half),
        key: `door_${facing}_${open}_${half}`,
        name: half ? 'Дверь (верх)' : 'Дубовая дверь',
        hardness: 1.5, tool: 'axe',
        faceTiles: topBottomSide(
          half ? TILE.door_top : TILE.door_bottom,
          TILE.door_bottom,
          TILE.door_bottom,
        ),
        drops: half ? [] : [{ id: getDoorId(facing, open === 1, 0), count: 1 }],
        interactive: 'door', mergeSides: false,
        solid: open === 0, opaque: false, renderLayer: 'cutout',
        door: true, facing, open: open === 1, half, customShape: true,
        item: !open && half === 0, itemId: getDoorId(facing, 0, 0),
        stickTile: TILE.oak_planks, pushable: false,
      });
    }
  }
}

for (let facing = 0; facing < 4; facing++) {
  for (let powered = 0; powered < 2; powered++) {
    state({
      id: getLeverId(facing, powered === 1), key: `lever_${facing}_${powered}`,
      name: powered ? 'Рычаг (вкл)' : 'Рычаг',
      hardness: 0.5, faceTiles: all(powered ? TILE.lever_on : TILE.lever_off),
      drops: [{ id: getLeverId(facing, 0), count: 1 }],
      interactive: 'lever', solid: false, opaque: false, cutout: true,
      renderLayer: 'cutout', mergeSides: false,
      lever: true, facing, powered: powered === 1, customShape: true,
      item: powered === 0, itemId: getLeverId(facing, 0), pushable: false,
    });
  }
}

for (let facing = 0; facing < 4; facing++) {
  for (let pressed = 0; pressed < 2; pressed++) {
    state({
      id: getButtonId(facing, pressed === 1), key: `button_${facing}_${pressed}`,
      name: pressed ? 'Кнопка (нажата)' : 'Каменная кнопка',
      hardness: 0.5, faceTiles: all(pressed ? TILE.button_on : TILE.button_off),
      drops: [{ id: getButtonId(facing, 0), count: 1 }],
      interactive: 'button', solid: false, opaque: false, cutout: true,
      renderLayer: 'cutout', mergeSides: false,
      button: true, facing, pressed: pressed === 1, customShape: true,
      item: pressed === 0, itemId: getButtonId(facing, 0), pushable: false,
    });
  }
}

for (let powered = 0; powered < 2; powered++) {
  state({
    id: getPlateId(powered === 1), key: powered ? 'pressure_plate_on' : 'pressure_plate',
    name: powered ? 'Нажимная плита (активна)' : 'Нажимная плита',
    hardness: 0.5, faceTiles: all(powered ? TILE.plate_on : TILE.plate_off),
    drops: [{ id: getPlateId(0), count: 1 }],
    solid: false, opaque: false, cutout: true, renderLayer: 'cutout', mergeSides: false,
    plate: true, powered: powered === 1, customShape: true,
    item: powered === 0, itemId: getPlateId(0), pushable: false,
  });
}

for (let powered = 0; powered < 2; powered++) {
  state({
    id: getDustId(powered === 1), key: powered ? 'redstone_wire_powered' : 'redstone_wire',
    name: powered ? 'Redstone пыль (активна)' : 'Redstone пыль',
    hardness: 0, faceTiles: all(powered ? TILE.wire_on : TILE.wire_off),
    drops: [{ id: getDustId(0), count: 1 }],
    solid: false, opaque: false, cutout: true, renderLayer: 'cutout',
    mergeSides: false, light: powered ? 2 : 0,
    wire: true, powered: powered === 1, customShape: true,
    item: powered === 0, itemId: getDustId(0), pushable: false,
  });
}

for (let facing = 0; facing < 4; facing++) {
  for (let powered = 0; powered < 2; powered++) {
    for (let delay = 1; delay <= 4; delay++) {
      state({
        id: getRepeaterId(facing, powered === 1, delay),
        key: `repeater_${facing}_${powered}_${delay}`,
        name: powered ? 'Повторитель (активен)' : 'Redstone повторитель',
        hardness: 0, faceTiles: all(powered ? TILE.repeater_on : TILE.repeater_off),
        drops: [{ id: getRepeaterId(facing, 0, delay), count: 1 }],
        interactive: 'redstone_delay',
        solid: false, opaque: false, cutout: true, renderLayer: 'cutout', mergeSides: false,
        repeater: true, facing, powered: powered === 1, delay,
        customShape: true,
        item: !powered && delay === 1, itemId: getRepeaterId(facing, 0, 1),
        pushable: false,
      });
    }
  }
}

for (let lit = 0; lit < 2; lit++) {
  state({
    id: getLampId(lit === 1), key: lit ? 'redstone_lamp_on' : 'redstone_lamp',
    name: lit ? 'Redstone лампа ( горит)' : 'Redstone лампа',
    hardness: 0.3, faceTiles: all(lit ? TILE.lamp_on : TILE.lamp_off),
    drops: [{ id: getLampId(0), count: 1 }],
    light: lit ? 15 : 0,
    lamp: true, lit: lit === 1, item: lit === 0, itemId: getLampId(0),
  });
}

for (const sticky of [false, true]) {
  for (let facing = 0; facing < 6; facing++) {
    for (let extended = 0; extended < 2; extended++) {
      state({
        id: getPistonId(facing, extended === 1, sticky),
        key: `${sticky ? 'sticky_' : ''}piston_${facing}_${extended}`,
        name: sticky ? 'Липкий поршень' : 'Поршень',
        hardness: 1.5, faceTiles: pistonTiles(facing),
        drops: [{ id: getPistonId(facing, 0, sticky), count: 1 }],
        solid: true,
        piston: true, facing, extended: extended === 1, sticky,
        item: !extended && facing === 0,
        itemId: getPistonId(0, 0, sticky), pushable: false,
      });
    }
  }
}

for (let facing = 0; facing < 6; facing++) {
  state({
    id: getPistonHeadId(facing), key: `piston_head_${facing}`, name: 'Головка поршня',
    hardness: 1.5, faceTiles: pistonTiles(facing, true),
    drops: [], solid: true,
    pistonHead: true, facing,
    item: false, itemId: getPistonId(0, 0, false), pushable: false,
  });
}

defs.push(
  {
    id: STATE_IDS.REDSTONE_BLOCK, key: 'redstone_block', name: 'БлокRedstone',
    hardness: 1.5, faceTiles: all(TILE.redstone_block),
    drops: [{ id: STATE_IDS.REDSTONE_BLOCK, count: 1 }],
    light: 7, redstoneSource: 15, pushable: false,
  },
  {
    id: STATE_IDS.REDSTONE_ORE, key: 'redstone_ore', name: 'Redstone руда',
    hardness: 3, tool: 'pickaxe', minTier: 1,
    faceTiles: all(TILE.redstone_ore),
    drops: [{ id: 449, count: 1 }],
  },
  ...stateDefs,
);


const byId = new Array(256).fill(null);
for (const def of defs) {
  const block = {
    solid: true,
    opaque: true,
    cutout: false,
    skyTransparent: false,
    renderLayer: 'solid',
    fluid: false,
    light: 0,
    mergeSides: true,
    interactive: null,
    drops: [],
    minTier: 0,
    tool: null,
    item: true,
    itemId: 0,
    customShape: false,
    pushable: true,
    ...def,
  };
  block.tiles = block.faceTiles;
  byId[block.id] = Object.freeze(block);
}
byId[AIR] = Object.freeze({
  id: 0, key: 'air', name: 'Воздух', solid: false, opaque: false, cutout: false,
  renderLayer: 'none', fluid: false, hardness: -1, faceTiles: [0, 0, 0, 0, 0, 0],
  tiles: [0, 0, 0, 0, 0, 0], drops: [], mergeSides: true, light: 0,
});

export const BLOCKS = Object.freeze(byId);
export const BLOCK_DEFS = Object.freeze(defs.map((def) => BLOCKS[def.id]));
export const BLOCKS_BY_KEY = Object.freeze(
  Object.fromEntries(BLOCK_DEFS.map((block) => [block.key, block])),
);

export function getBlock(id) {
  return BLOCKS[id] ?? BLOCKS[AIR];
}

/** Item id produced by a block variant (state ids share one craftable item). */
export function getBlockItemId(id) {
  const block = BLOCKS[id];
  if (!block || block.id === AIR) return 0;
  return block.itemId || block.id;
}

export function isSolid(id) {
  return BLOCKS[id]?.solid === true;
}

export function isOpaque(id) {
  return BLOCKS[id]?.opaque === true;
}

export function isRenderable(id) {
  const block = BLOCKS[id];
  return !!block && block.renderLayer !== 'none';
}

export const PLACEABLE_BLOCKS = Object.freeze(
  BLOCK_DEFS.filter((block) => block.item
    && block.id !== 11 && block.id !== 30 && block.id !== 13)
    .map((block) => block.id),
);
