import {
  CHUNK_SIZE,
  PAD_X,
  PAD_Y,
  PAD_Z,
  SUN_AXIS_X,
  SUN_AXIS_Z,
  WORLD_HEIGHT,
} from '../shared/constants.js';
import { BLOCKS, BLOCK_DEFS, HORIZONTAL_OFFSETS, isRenderable } from '../shared/blocks.js';
import { TILE } from '../shared/textures.js';
import { BIOME, BIOME_INFO } from '../shared/biomes.js';

const PAD_STRIDE_Z = PAD_X;
const PAD_STRIDE_Y = PAD_X * PAD_Z;

// Horizon shadows reach this many blocks across the 3x3 neighbourhood the
// world already keeps generated for AO. They follow the sun's fixed travel
// plane, so two directions (sunrise and sunset side) are enough.
export const HORIZON_PAD = CHUNK_SIZE;
export const HORIZON_SIZE = CHUNK_SIZE + HORIZON_PAD * 2;
const HORIZON_STEPS = HORIZON_PAD;
const SUN_LENGTH = Math.hypot(SUN_AXIS_X, SUN_AXIS_Z);
const SUN_STEP_X = SUN_AXIS_X / SUN_LENGTH;
const SUN_STEP_Z = SUN_AXIS_Z / SUN_LENGTH;

const POSITIVE_FACE = [2, 0, 4]; // +X, +Y, +Z
const NEGATIVE_FACE = [3, 1, 5]; // -X, -Y, -Z

function padIndex(x, y, z) {
  return (y + 1) * PAD_STRIDE_Y + (z + 1) * PAD_STRIDE_Z + (x + 1);
}

function isOpaqueAt(padded, x, y, z) {
  if (x < -1 || x > CHUNK_SIZE || y < -1 || y > WORLD_HEIGHT || z < -1 || z > CHUNK_SIZE) return 0;
  const block = BLOCKS[padded[padIndex(x, y, z)]];
  return block && block.opaque ? 1 : 0;
}

// Crops still use crossed billboards. Everything else with a non-cube silhouette
// declares `customShape` in its block definition and is emitted after the
// greedy cube pass.
const CROSS_IDS = new Set([64, 65, 66, 67, 201, 202, 203, 204]);
const CUSTOM_IDS = new Set(BLOCK_DEFS.filter((block) => block.customShape).map((block) => block.id));
const FENCE_ID = 68;

// Tint multipliers are baked per vertex (128 = unchanged) so the terrain shader
// needs no biome lookup. Only climate-sensitive tiles are tinted: stone, ores,
// planks and devices keep their authored colours everywhere.
const NEUTRAL_TINT = [1, 1, 1];
const tintScratch = [1, 1, 1];
const GRASS_TILES = [TILE.grass_top, TILE.grass_side, TILE.tall_grass, TILE.dandelion, TILE.poppy];
const LEAVES_TILES = [TILE.oak_leaves, TILE.birch_leaves, TILE.spruce_leaves];
const WATER_TILES = [TILE.water];

function tintForTile(tile, biomeId) {
  const info = BIOME_INFO[biomeId] ?? BIOME_INFO[BIOME.PLAINS];
  let tint = NEUTRAL_TINT;
  if (GRASS_TILES.includes(tile)) tint = info.grassTint;
  else if (LEAVES_TILES.includes(tile)) tint = info.leavesTint;
  else if (WATER_TILES.includes(tile)) tint = info.waterTint;
  tintScratch[0] = tint[0];
  tintScratch[1] = tint[1];
  tintScratch[2] = tint[2];
  return tintScratch;
}

/**
 * Flood-fills block light from emissive blocks (torches, glowstone, furnaces,
 * lava, portals) through non-opaque cells of the padded volume. Levels are
 * 0..15 and lose one unit per block, exactly like Minecraft's block light.
 */
function computeBlockLight(padded, topRow) {
  const light = new Uint8Array(PAD_X * PAD_Y * PAD_Z);
  const queue = [];
  for (let y = 0; y <= topRow; y++) {
    for (let z = -1; z <= CHUNK_SIZE; z++) {
      for (let x = -1; x <= CHUNK_SIZE; x++) {
        const index = padIndex(x, y, z);
        const level = BLOCKS[padded[index]]?.light ?? 0;
        if (level > 0) {
          light[index] = level;
          queue.push((index << 4) | level);
        }
      }
    }
  }

  const dirs = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
  ];
  let head = 0;
  while (head < queue.length) {
    const packed = queue[head++];
    const index = packed >> 4;
    const level = packed & 15;
    if (level <= 1) continue;

    const y = Math.floor(index / PAD_STRIDE_Y) - 1;
    const rest = index - (y + 1) * PAD_STRIDE_Y;
    const z = Math.floor(rest / PAD_STRIDE_Z) - 1;
    const x = rest - (z + 1) * PAD_STRIDE_Z - 1;
    const next = level - 1;

    for (const [dx, dy, dz] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < -1 || nx > CHUNK_SIZE || nz < -1 || nz > CHUNK_SIZE) continue;
      if (ny < -1 || ny > WORLD_HEIGHT) continue;
      const nIndex = padIndex(nx, ny, nz);
      if (BLOCKS[padded[nIndex]]?.opaque) continue;
      if (light[nIndex] >= next) continue;
      light[nIndex] = next;
      queue.push((nIndex << 4) | next);
    }
  }
  return light;
}

function lightAtIndex(light, x, y, z) {
  if (x < -1 || x > CHUNK_SIZE || y < -1 || y > WORLD_HEIGHT || z < -1 || z > CHUNK_SIZE) return 0;
  return light[padIndex(x, y, z)];
}

/** Adds one axis-aligned quad using the same UV convention as greedy faces. */
function addFace(bucket, axis, sign, fixed, u0, u1, v0, v1, tile, sky, light, tint = NEUTRAL_TINT) {
  const uAxis = axis === 0 ? 2 : 0;
  const vAxis = axis === 1 ? 2 : 1;
  const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const points = corners.map(([u, v]) => {
    const p = [0, 0, 0];
    p[axis] = fixed;
    p[uAxis] = u;
    p[vAxis] = v;
    return p;
  });
  const uvs = axis === 1
    ? corners.map(([u, v]) => [u, v])
    : corners.map(([u, v]) => [u, -v]);
  const normal = [0, 0, 0];
  normal[axis] = sign;
  // This UV convention follows Z/Y for X faces and X/Z for top faces, so the
  // geometric winding is reversed on those two axes. Flip it to keep the
  // generated boxes front-facing from the outside.
  const winding = sign * (axis === 2 ? 1 : -1);
  bucket.addQuad(points, normal, uvs, tile, 255, sky, 0, 0, winding, light, tint);
}

/** Emits a textured box. Tiles follow the block faceTiles order. */
function emitBox(bucket, box, tiles, sky, light, tint = NEUTRAL_TINT) {
  const [x0, y0, z0, x1, y1, z1] = box;
  addFace(bucket, 1, 1, y1, x0, x1, z0, z1, tiles[0], sky, light, tint);
  addFace(bucket, 1, -1, y0, x0, x1, z0, z1, tiles[1], sky, light, tint);
  addFace(bucket, 0, 1, x1, z0, z1, y0, y1, tiles[2], sky, light, tint);
  addFace(bucket, 0, -1, x0, z0, z1, y0, y1, tiles[3], sky, light, tint);
  addFace(bucket, 2, 1, z1, x0, x1, y0, y1, tiles[4], sky, light, tint);
  addFace(bucket, 2, -1, z0, x0, x1, y0, y1, tiles[5], sky, light, tint);
}

/**
 * Emits an axis-aligned box described in the local frame of a horizontal
 * facing. `side` runs across the facing and `forward` along it; local zero is
 * the centre of the cell. Devices such as levers use this so one geometry
 * description works for every rotation.
 */
function emitDirectedBox(bucket, x, y, z, facing, side0, side1, forward0, forward1, y0, y1, tiles, sky, light) {
  const { x: dx, z: dz } = HORIZONTAL_OFFSETS[facing];
  const sx = -dz;
  const sz = dx;
  const cx = x + 0.5;
  const cz = z + 0.5;
  const xs = [
    cx + side0 * sx + forward0 * dx,
    cx + side0 * sx + forward1 * dx,
    cx + side1 * sx + forward0 * dx,
    cx + side1 * sx + forward1 * dx,
  ];
  const zs = [
    cz + side0 * sz + forward0 * dz,
    cz + side0 * sz + forward1 * dz,
    cz + side1 * sz + forward0 * dz,
    cz + side1 * sz + forward1 * dz,
  ];
  emitBox(bucket, [
    Math.min(...xs), y + y0, Math.min(...zs),
    Math.max(...xs), y + y1, Math.max(...zs),
  ], tiles, sky, light);
}

/** A two-sided diagonal billboard, used for flames. */
function emitBillboard(bucket, ax, az, bx, bz, y0, y1, tile, sky, light, tint = NEUTRAL_TINT) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz) || 1;
  const nx = -dz / length;
  const nz = dx / length;
  const points = [
    [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az],
  ];
  const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
  for (const sign of [1, -1]) {
    bucket.addQuad(points, [nx * sign, 0, nz * sign], uvs, tile, 255, sky, 0, 0, sign, light, tint);
  }
}

function emitFlame(bucket, x, y, z, tile, sky, light) {
  const thick = 1 / 16;
  const middle = 0.5;
  const lo = middle - thick;
  const hi = middle + thick;
  emitBillboard(bucket, x + lo, z + lo, x + hi, z + hi, y, y + 0.45, tile, sky, light);
  emitBillboard(bucket, x + lo, z + hi, x + hi, z + lo, y, y + 0.45, tile, sky, light);
}

function emitTorchShape(bucket, x, y, z, block, sky, light) {
  const stick = allTiles(block.stickTile);
  const thin = 1 / 16;
  const centre = 0.5;
  const lo = centre - thin;
  const hi = centre + thin;
  if (block.facing === 5 || block.facing === 4) {
    const base = y + (block.facing === 5 ? 0.0625 : 0.375);
    emitBox(bucket, [x + lo, base, z + lo, x + hi, base + 0.625, z + hi], stick, sky, light);
    emitFlame(bucket, x, base + 0.5, z, block.flameTile, sky, light);
    return;
  }
  const offset = block.facing === 1 ? [0, 0.625]
    : block.facing === 3 ? [0.375, 1]
      : block.facing === 2 ? [0, 0.625]
        : [0.375, 1];
  const cy = y + 0.5;
  if (block.facing === 1 || block.facing === 3) {
    emitBox(bucket, [x + offset[0], cy - thin, z + lo, x + offset[1], cy + thin, z + hi], stick, sky, light);
  } else {
    emitBox(bucket, [x + lo, cy - thin, z + offset[0], x + hi, cy + thin, z + offset[1]], stick, sky, light);
  }
  emitFlame(bucket, x, cy - 0.1, z, block.flameTile, sky, light);
}

const allTiles = (tile) => [tile, tile, tile, tile, tile, tile];

function emitBed(bucket, x, y, z, block, sky, light) {
  const facing = block.facing & 3;
  const wood = allTiles(TILE.oak_planks);
  const mattress = allTiles(TILE.bed_side);
  mattress[0] = TILE.bed_top;
  mattress[1] = TILE.oak_planks;

  // The head is one cell along the facing from the foot. Each half fills its
  // whole cell along that axis, so the frames and mattresses meet exactly at
  // the boundary instead of leaving a gap between two separate-looking beds.
  const outerStart = block.head ? 0.375 : -0.5;
  const outerEnd = block.head ? 0.5 : -0.375;

  // Two legs at the outer end of each half: four for the complete bed.
  for (const side of [-0.4375, 0.3125]) {
    emitDirectedBox(bucket, x, y, z, facing, side, side + 0.125,
      outerStart, outerStart + 0.125, 0.0625, 0.375, wood, sky, light);
  }

  // Continuous frame and thin mattress across the full cell.
  emitDirectedBox(bucket, x, y, z, facing, -0.4375, 0.4375, -0.5, 0.5,
    0.375, 0.4375, wood, sky, light);
  emitDirectedBox(bucket, x, y, z, facing, -0.375, 0.375, -0.5, 0.5,
    0.4375, 0.5625, mattress, sky, light);

  // Only the outer end of the whole bed gets a raised board.
  const boardTop = block.head ? 0.8125 : 0.75;
  emitDirectedBox(bucket, x, y, z, facing, -0.4375, 0.4375,
    outerStart, outerEnd, 0.4375, boardTop, wood, sky, light);

  // Pillow by the headboard, blanket on the foot half.
  if (block.head) {
    emitDirectedBox(bucket, x, y, z, facing, -0.3125, 0.3125,
      0.125, 0.375, 0.5625, 0.625, allTiles(TILE.white_wool), sky, light);
  } else {
    emitDirectedBox(bucket, x, y, z, facing, -0.3125, 0.3125,
      -0.375, 0.125, 0.5625, 0.625, allTiles(TILE.red_wool), sky, light);
  }
}

function emitDoor(bucket, x, y, z, block, sky, light) {
  const alongX = block.facing === 0 || block.facing === 2;
  const panel = allTiles(TILE.door_bottom);
  panel[0] = block.half ? TILE.door_top : TILE.door_bottom;
  // The lower half reaches the cell boundary and the upper half starts there,
  // so the two pieces form one tall panel instead of two square doors.
  const y0 = y + (block.half ? 0 : 0.015625);
  const y1 = y + (block.half ? 0.984375 : 1);
  let box;
  if (alongX) {
    const hingeLow = block.facing === 0 || block.facing === 3;
    if (block.open) {
      const px = hingeLow ? x + 0.0625 : x + 0.8125;
      box = [px, y0, z + 0.0625, px + 0.125, y1, z + 0.9375];
    } else {
      box = [x + 0.0625, y0, z + 0.4375, x + 0.9375, y1, z + 0.5625];
    }
  } else if (block.open) {
    const pz = block.facing === 1 ? z + 0.8125 : z + 0.0625;
    box = [x + 0.0625, y0, pz, x + 0.9375, y1, pz + 0.125];
  } else {
    box = [x + 0.4375, y0, z + 0.0625, x + 0.5625, y1, z + 0.9375];
  }
  emitBox(bucket, box, panel, sky, light);
  if (!block.half) {
    const metal = allTiles(TILE.iron_block);
    if (alongX && !block.open) {
      emitBox(bucket, [x + 0.8125, y + 0.5, z + 0.5625, x + 0.875, y + 0.625, z + 0.625], metal, sky, light);
    } else if (!alongX && !block.open) {
      emitBox(bucket, [x + 0.5625, y + 0.5, z + 0.8125, x + 0.625, y + 0.625, z + 0.875], metal, sky, light);
    }
  }
}

function emitFence(bucket, padded, x, y, z, sky, light) {
  const wood = allTiles(TILE.oak_fence);
  emitBox(bucket, [x + 0.375, y, z + 0.375, x + 0.625, y + 1.5, z + 0.625], wood, sky, light);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of dirs) {
    const nx = x + dx;
    const nz = z + dz;
    const neighbor = BLOCKS[padded[padIndex(nx, y, nz)]];
    if (!neighbor) continue;
    const fence = padded[padIndex(nx, y, nz)] === FENCE_ID;
    const solid = neighbor.solid && neighbor.opaque;
    if (!fence && !solid) continue;
    // Each fence-fence pair is emitted once, even across chunk borders.
    if (fence && nx <= x && nz <= z) continue;
    for (const [h0, h1] of [[0.375, 0.5625], [0.9375, 1.125]]) {
      let box;
      if (dx !== 0) {
        const x0 = dx > 0 ? x + 0.5 : x;
        box = [x0, y + h0, z + 0.4375, x0 + 0.5, y + h1, z + 0.5625];
      } else {
        const z0 = dz > 0 ? z + 0.5 : z;
        box = [x + 0.4375, y + h0, z0, x + 0.5625, y + h1, z0 + 0.5];
      }
      emitBox(bucket, box, wood, sky, light);
    }
  }
}

function emitLever(bucket, padded, x, y, z, block, sky, light) {
  const facing = block.facing & 3;
  const { x: dx, z: dz } = HORIZONTAL_OFFSETS[facing];
  // A wall lever stores the wall's outward normal as its facing, so the wall
  // sits one cell back along -facing. Floor levers have open air there.
  const behind = BLOCKS[padded[padIndex(x - dx, y, z - dz)]];
  const onWall = !!(behind && (behind.solid || behind.opaque));
  const base = allTiles(TILE.cobblestone);
  const stick = allTiles(TILE.oak_planks);
  const tip = allTiles(block.powered ? TILE.lever_on : TILE.lever_off);
  const side0 = -0.0625;
  const side1 = 0.0625;

  if (!onWall) {
    // Low plinth on top of the supporting block.
    emitDirectedBox(bucket, x, y, z, facing,
      -0.1875, 0.1875, -0.1875, 0.1875, 0.0625, 0.1875, base, sky, light);
    const segments = block.powered
      // Powered: flipped down, lying along the facing direction.
      ? [[-0.0625, 0.0625, 0.1875, 0.3125],
        [0.0625, 0.1875, 0.1875, 0.3125],
        [0.1875, 0.3125, 0.1875, 0.3125]]
      // Unpowered: standing up and leaning towards the facing direction.
      : [[-0.0625, 0.0625, 0.1875, 0.3125],
        [0, 0.125, 0.3125, 0.4375],
        [0.0625, 0.1875, 0.4375, 0.5625]];
    for (let i = 0; i < segments.length; i++) {
      const [f0, f1, y0, y1] = segments[i];
      emitDirectedBox(bucket, x, y, z, facing, side0, side1, f0, f1, y0, y1,
        i === segments.length - 1 ? tip : stick, sky, light);
    }
    return;
  }

  // Thin plate bolted to the wall face; forward -0.5 is the wall itself.
  emitDirectedBox(bucket, x, y, z, facing,
    -0.1875, 0.1875, -0.5, -0.375, 0.3125, 0.6875, base, sky, light);
  const segments = block.powered
    ? [[-0.375, -0.25, 0.4375, 0.5625],
      [-0.25, -0.125, 0.3125, 0.4375],
      [-0.125, 0, 0.1875, 0.3125]]
    : [[-0.375, -0.25, 0.5, 0.625],
      [-0.25, -0.125, 0.625, 0.75],
      [-0.125, 0, 0.75, 0.875]];
  for (let i = 0; i < segments.length; i++) {
    const [f0, f1, y0, y1] = segments[i];
    emitDirectedBox(bucket, x, y, z, facing, side0, side1, f0, f1, y0, y1,
      i === segments.length - 1 ? tip : stick, sky, light);
  }
}

function emitButton(bucket, x, y, z, block, sky, light) {
  const tile = block.pressed ? TILE.button_on : TILE.button_off;
  const tiles = allTiles(tile);
  const depth = block.pressed ? 0.0625 : 0.125;
  const alongX = block.facing === 1 || block.facing === 3;
  const low = block.facing === 0 || block.facing === 3;
  if (alongX) {
    const x0 = low ? x + 0.0625 : x + 1 - 0.0625 - depth;
    emitBox(bucket, [x0, y + 0.375, z + 0.375, x0 + depth, y + 0.625, z + 0.625], tiles, sky, light);
  } else {
    const z0 = low ? z + 0.0625 : z + 1 - 0.0625 - depth;
    emitBox(bucket, [x + 0.375, y + 0.375, z0, x + 0.625, y + 0.625, z0 + depth], tiles, sky, light);
  }
}

function emitPlate(bucket, x, y, z, block, sky, light) {
  const tiles = allTiles(block.powered ? TILE.plate_on : TILE.plate_off);
  const bottom = block.powered ? y + 0.015625 : y + 0.0625;
  emitBox(bucket, [x + 0.0625, bottom, z + 0.0625, x + 0.9375, bottom + 0.0625, z + 0.9375], tiles, sky, light);
}

function emitWire(bucket, x, y, z, block, sky, light) {
  const tiles = allTiles(block.powered ? TILE.wire_on : TILE.wire_off);
  const bottom = y + 0.03125;
  emitBox(bucket, [x, bottom, z + 0.4375, x + 1, bottom + 0.0625, z + 0.5625], tiles, sky, light);
  emitBox(bucket, [x + 0.4375, bottom, z, x + 0.5625, bottom + 0.0625, z + 1], tiles, sky, light);
}

function emitRepeater(bucket, x, y, z, block, sky, light) {
  const tiles = allTiles(block.powered ? TILE.repeater_on : TILE.repeater_off);
  emitBox(bucket, [x + 0.0625, y + 0.0625, z + 0.0625, x + 0.9375, y + 0.1875, z + 0.9375], tiles, sky, light);
  const nubs = allTiles(block.powered ? TILE.wire_on : TILE.wire_off);
  const alongX = block.facing === 1 || block.facing === 3;
  if (alongX) {
    emitBox(bucket, [x + 0.1875, y + 0.1875, z + 0.1875, x + 0.3125, y + 0.3125, z + 0.3125], nubs, sky, light);
    emitBox(bucket, [x + 0.6875, y + 0.1875, z + 0.6875, x + 0.8125, y + 0.3125, z + 0.8125], nubs, sky, light);
  } else {
    emitBox(bucket, [x + 0.1875, y + 0.1875, z + 0.6875, x + 0.3125, y + 0.3125, z + 0.8125], nubs, sky, light);
    emitBox(bucket, [x + 0.6875, y + 0.1875, z + 0.1875, x + 0.8125, y + 0.3125, z + 0.3125], nubs, sky, light);
  }
}

function emitCustom(bucket, padded, x, y, z, block, lightMap, tops) {
  const sky = computeSky(tops, x, z, y + 1);
  const light = lightAtIndex(lightMap, x, y, z);
  if (block.torch) emitTorchShape(bucket, x, y, z, block, sky, light);
  else if (block.bed) emitBed(bucket, x, y, z, block, sky, light);
  else if (block.door) emitDoor(bucket, x, y, z, block, sky, light);
  else if (block.id === FENCE_ID) emitFence(bucket, padded, x, y, z, sky, light);
  else if (block.lever) emitLever(bucket, padded, x, y, z, block, sky, light);
  else if (block.button) emitButton(bucket, x, y, z, block, sky, light);
  else if (block.plate) emitPlate(bucket, x, y, z, block, sky, light);
  else if (block.wire) emitWire(bucket, x, y, z, block, sky, light);
  else if (block.repeater) emitRepeater(bucket, x, y, z, block, sky, light);
  else emitBox(bucket, [x, y, z, x + 1, y + 1, z + 1], block.faceTiles, sky, light);
}

/**
 * Plants and fences are flat crossed billboards. Both sides are emitted because
 * the terrain material is front-face only.
 */
function emitCross(bucket, x, y, z, block, lightMap, tops, tint = NEUTRAL_TINT) {
  const tile = block.faceTiles[0];
  const sky = computeSky(tops, x, z, y + 1);
  const light = lightAtIndex(lightMap, x, y, z);
  const height = block.crossHeight ?? 0.9;
  const lo = 0.14;
  const hi = 0.86;
  const planes = [
    [[x + lo, z + lo], [x + hi, z + hi]],
    [[x + lo, z + hi], [x + hi, z + lo]],
  ];
  const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];

  for (const [[ax, az], [bx, bz]] of planes) {
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length;
    const nz = dx / length;
    const points = [
      [ax, y, az],
      [bx, y, bz],
      [bx, y + height, bz],
      [ax, y + height, az],
    ];
    for (const sign of [1, -1]) {
      bucket.addQuad(
        points,
        [nx * sign, 0, nz * sign],
        uvs,
        tile,
        255,
        sky,
        0,
        0,
        sign,
        light,
        tint,
      );
    }
  }
}

function shouldRender(blockId, neighborId) {
  if (!isRenderable(blockId)) return false;
  if (neighborId === blockId) return false;
  const neighbor = BLOCKS[neighborId];
  if (neighbor && neighbor.opaque) return false;
  return true;
}

/**
 * Highest world row (0..WORLD_HEIGHT-1) that still contains a block.
 * Everything above it is sky, so the mesher can skip it entirely.
 */
function findTopRow(padded) {
  let last = padded.length - 1;
  while (last >= 0 && padded[last] === 0) last--;
  if (last < 0) return 0;
  return Math.max(0, Math.min(WORLD_HEIGHT - 1, Math.floor(last / PAD_STRIDE_Y) - 1));
}

function computeAO(padded, x, y, z, axis, sign, uAxis, vAxis) {
  const front = [x, y, z];
  front[axis] += sign;
  const sample = (du, dv) => {
    let sx = front[0];
    let sy = front[1];
    let sz = front[2];
    if (uAxis === 0) sx += du;
    else if (uAxis === 1) sy += du;
    else sz += du;
    if (vAxis === 0) sx += dv;
    else if (vAxis === 1) sy += dv;
    else sz += dv;
    return isOpaqueAt(padded, sx, sy, sz);
  };

  const s00 = sample(-1, 0);
  const s01 = sample(0, -1);
  const c00 = sample(-1, -1);
  const s10 = sample(1, 0);
  const c10 = sample(1, -1);
  const s11 = sample(0, 1);
  const c11 = sample(1, 1);
  const c01 = sample(-1, 1);

  const a0 = s00 && s01 ? 0 : 3 - (s00 + s01 + c00);
  const a1 = s10 && s01 ? 0 : 3 - (s10 + s01 + c10);
  const a2 = s10 && s11 ? 0 : 3 - (s10 + s11 + c11);
  const a3 = s00 && s11 ? 0 : 3 - (s00 + s11 + c01);
  return a0 | (a1 << 2) | (a2 << 4) | (a3 << 6);
}

/**
 * Whether a block cuts the vertical skylight. Opaque blocks always do, and
 * cutout blocks (leaves) do too so tree canopies shade the ground below.
 * Fluids count as well, otherwise lake beds would stay as bright as open
 * terrain. Glass opts out through `skyTransparent`.
 */
function blocksSky(id) {
  const block = BLOCKS[id];
  if (!block || block.skyTransparent) return false;
  return block.opaque === true || block.cutout === true || block.fluid === true;
}

/**
 * Highest sky-cutting row per column, -1 when the column is open all the way
 * down. Covers the padded volume (chunk plus one block) and is only used when
 * the caller does not supply a full 3x3 horizon map.
 */
function computeColumnTops(padded, topRow) {
  const tops = new Int16Array(HORIZON_SIZE * HORIZON_SIZE);
  tops.fill(-1);
  for (let z = -1; z <= CHUNK_SIZE; z++) {
    for (let x = -1; x <= CHUNK_SIZE; x++) {
      for (let y = topRow; y >= 0; y--) {
        if (blocksSky(padded[padIndex(x, y, z)])) {
          tops[(x + HORIZON_PAD) + (z + HORIZON_PAD) * HORIZON_SIZE] = y;
          break;
        }
      }
    }
  }
  return tops;
}

/**
 * Highest sky-cutting row per column of one chunk, in world Y. Returned as
 * 16x16 with the chunk-local (x + z * 16) layout so World can stitch the 3x3
 * neighbourhood into a horizon map. -1 means the column is open to the sky.
 */
export function computeTops(blocks) {
  const tops = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
  tops.fill(-1);
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const base = x + (z << 4);
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        if (blocksSky(blocks[base + (y << 8)])) {
          tops[x + z * CHUNK_SIZE] = y;
          break;
        }
      }
    }
  }
  return tops;
}

const SKY_RING = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Skylight level for one visible face cell: 3 = open sky above, 2 = light
 * wrapping around a single block edge (roof rim, canopy edge), 0 = covered.
 * Light travels straight down like Minecraft's skylight, which is what makes
 * floors under a roof, under a tree or inside a cave read as shadowed while
 * open ground stays fully lit. Returns 3 (open) at the fastest path so the
 * common case costs a single lookup.
 */
function computeSky(tops, colX, colZ, y) {
  if (tops[(colX + HORIZON_PAD) + (colZ + HORIZON_PAD) * HORIZON_SIZE] + 1 <= y) return 3;
  for (let i = 0; i < 4; i++) {
    const cx = colX + SKY_RING[i][0];
    const cz = colZ + SKY_RING[i][1];
    // Columns past the padded halo are unknown; treat them as covered so a
    // chunk border never invents light.
    if (cx < -1 || cx > CHUNK_SIZE || cz < -1 || cz > CHUNK_SIZE) continue;
    if (tops[(cx + HORIZON_PAD) + (cz + HORIZON_PAD) * HORIZON_SIZE] + 1 <= y) return 2;
  }
  return 0;
}

/**
 * Skylight of the cell for block (bx,by,bz) on the given face. Side and top
 * faces sample the row directly above their outward point; a bottom face can
 * only be lit from the side, so it samples its own row and relies on the ring.
 */
function faceSky(tops, bx, by, bz, axis, sign) {
  let colX = bx;
  let colZ = bz;
  if (axis === 0) colX = bx + sign;
  else if (axis === 2) colZ = bz + sign;
  const y = axis === 1 && sign < 0 ? by : by + 1;
  return computeSky(tops, colX, colZ, y);
}

/**
 * Highest elevation (as sin of the angle) that terrain reaches when looking
 * from a face point along one horizontal direction. Marching the column tops
 * is equivalent to casting a shadow ray at the sun: a face is lit whenever the
 * sun sits above this horizon, which is what makes shadows stretch out at dawn
 * and shrink at noon and swap sides between morning and evening.
 */
function horizonAt(tops, colX, colZ, py, dir) {
  let best = 0;
  for (let i = 1; i <= HORIZON_STEPS; i++) {
    const sx = Math.floor(colX + 0.5 + dir * SUN_STEP_X * i);
    const sz = Math.floor(colZ + 0.5 + dir * SUN_STEP_Z * i);
    const top = tops[(sx + HORIZON_PAD) + (sz + HORIZON_PAD) * HORIZON_SIZE];
    const dy = top + 1 - py;
    if (dy <= 0) continue;
    const sinEl = dy / Math.sqrt(dy * dy + i * i);
    if (sinEl > best) best = sinEl;
  }
  return best;
}

/**
 * Baked sun horizons for one visible face: [sunrise direction, sunset
 * direction] as sin(elevation). Both are 0 for open ground and approach 1 for
 * a ceiling directly overhead.
 */
function faceHorizon(tops, bx, by, bz, axis, sign, out) {
  let colX = bx;
  let colZ = bz;
  if (axis === 0) colX = bx + sign;
  else if (axis === 2) colZ = bz + sign;
  const py = by + (axis === 1 && sign > 0 ? 1 : 0.5);
  out[0] = horizonAt(tops, colX, colZ, py, 1);
  out[1] = horizonAt(tops, colX, colZ, py, -1);
}

class Bucket {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.tiles = [];
    this.aos = [];
    this.skies = [];
    this.horizons = [];
    this.lights = [];
    this.tints = [];
    this.indices = [];
    this.vertexCount = 0;
  }

  addQuad(points, normal, uvs, tile, aoPack, skyLevel, hPlus, hMinus, sign, lightLevel = 0, tint = NEUTRAL_TINT) {
    const base = this.vertexCount;
    const sky = skyLevel * 85;
    const light = Math.max(0, Math.min(15, lightLevel)) * 17;
    const tr = Math.max(0, Math.min(255, Math.round((tint[0] ?? 1) * 128)));
    const tg = Math.max(0, Math.min(255, Math.round((tint[1] ?? 1) * 128)));
    const tb = Math.max(0, Math.min(255, Math.round((tint[2] ?? 1) * 128)));
    for (let i = 0; i < 4; i++) {
      const p = points[i];
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.uvs.push(uvs[i][0], uvs[i][1]);
      this.tiles.push(tile);
      this.aos.push(((aoPack >> (i * 2)) & 3) * 85);
      this.skies.push(sky);
      this.horizons.push(hPlus, hMinus);
      this.lights.push(light);
      this.tints.push(tr, tg, tb);
    }
    if (sign > 0) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    this.vertexCount += 4;
  }

  finish() {
    if (this.vertexCount === 0) return null;
    return {
      positions: new Float32Array(this.positions),
      normals: new Int8Array(this.normals),
      uvs: new Float32Array(this.uvs),
      tiles: new Uint8Array(this.tiles),
      aos: new Uint8Array(this.aos),
      skies: new Uint8Array(this.skies),
      horizons: new Uint8Array(this.horizons),
      lights: new Uint8Array(this.lights),
      tints: new Uint8Array(this.tints),
      indices: new Uint32Array(this.indices),
      vertexCount: this.vertexCount,
    };
  }
}

/**
 * Greedy mesher. It receives an 18x258x18 padded volume (one block of padding
 * on every horizontal side) plus a 48x48 column-top map covering the chunk and
 * its eight neighbours, and emits only visible, merged quads.
 *
 * AO and skylight are baked per vertex and are part of the merge key, so quads
 * never merge across a lighting discontinuity. Faces with non-tileable vertical
 * detail (grass sides) are prevented from merging vertically.
 */
export function meshChunk(padded, originX, originZ, extTops, biomes = null) {
  const solid = new Bucket();
  const water = new Bucket();
  const mask = new Uint32Array(WORLD_HEIGHT * CHUNK_SIZE);
  const lightMask = new Uint8Array(WORLD_HEIGHT * CHUNK_SIZE);
  const pos = [0, 0, 0];
  const neighbor = [0, 0, 0];
  const normal = [0, 0, 0];
  const horizon = [0, 0];

  // Extent of every axis: X/Z span one chunk, Y spans 0..topRow. Y is 256
  // blocks tall while X/Z are only 16, so the volume is never a cube.
  const topRow = findTopRow(padded);
  const size = [CHUNK_SIZE, topRow + 1, CHUNK_SIZE];
  const tops = extTops || computeColumnTops(padded, topRow);
  const blockLight = computeBlockLight(padded, topRow);

  for (let axis = 0; axis < 3; axis++) {
    const uAxis = (axis + 1) % 3;
    const vAxis = (axis + 2) % 3;
    const sliceCount = size[axis];
    const uCount = size[uAxis];
    const vCount = size[vAxis];
    const stride = uCount;
    const signList = [1, -1];

    for (const sign of signList) {
      const faceIndex = sign > 0 ? POSITIVE_FACE[axis] : NEGATIVE_FACE[axis];
      for (let slice = 0; slice < sliceCount; slice++) {
        mask.fill(0, 0, uCount * vCount);
        lightMask.fill(0, 0, uCount * vCount);
        for (let v = 0; v < vCount; v++) {
          for (let u = 0; u < uCount; u++) {
            pos[axis] = slice;
            pos[uAxis] = u;
            pos[vAxis] = v;
            const blockId = padded[padIndex(pos[0], pos[1], pos[2])];
            // Non-cube blocks use their own geometry, emitted after the cube pass.
            if (CROSS_IDS.has(blockId) || CUSTOM_IDS.has(blockId)) continue;
            if (!isRenderable(blockId)) continue;

            neighbor[0] = pos[0];
            neighbor[1] = pos[1];
            neighbor[2] = pos[2];
            neighbor[axis] += sign;
            const neighborId = padded[padIndex(neighbor[0], neighbor[1], neighbor[2])];
            if (!shouldRender(blockId, neighborId)) continue;

            const block = BLOCKS[blockId];
            const tile = block.faceTiles[faceIndex];
            const biome = biomes ? (biomes[pos[0] + pos[2] * CHUNK_SIZE] ?? BIOME.PLAINS) : BIOME.PLAINS;
            const aoPack = computeAO(padded, pos[0], pos[1], pos[2], axis, sign, uAxis, vAxis);
            const skyLevel = faceSky(tops, pos[0], pos[1], pos[2], axis, sign);
            faceHorizon(tops, pos[0], pos[1], pos[2], axis, sign, horizon);
            const hPlus = Math.round(horizon[0] * 31);
            const hMinus = Math.round(horizon[1] * 31);
            const canMergeV = block.mergeSides || axis === 1 ? 1 : 0;
            // body = tile * 2048 + aoPack * 8 + skyLevel * 2 + canMergeV
            //      + hPlus * 262144 + hMinus * 8388608 + biome * 268435456
            // Tiles need seven bits: the atlas now has more than 64 layers and
            // truncating them made late tiles (bed, redstone) render as other
            // blocks. Horizons keep five bits each; the lost precision is
            // invisible after the byte conversion in the shader. Four high bits
            // hold the biome so quads never merge across a colour boundary.
            mask[u + v * stride] = 1 + (tile << 11) + (aoPack << 3)
              + (skyLevel << 1) + canMergeV + (hPlus << 18) + (hMinus << 23)
              + (biome << 28);
            const emitted = block.light ?? 0;
            lightMask[u + v * stride] = Math.max(
              emitted,
              lightAtIndex(blockLight, neighbor[0], neighbor[1], neighbor[2]),
            );
          }
        }

        for (let v = 0; v < vCount; v++) {
          for (let u = 0; u < uCount; u++) {
            const key = mask[u + v * stride];
            if (!key) continue;

            const cellLight = lightMask[u + v * stride];
            let width = 1;
            while (u + width < uCount
              && mask[u + width + v * stride] === key
              && lightMask[u + width + v * stride] === cellLight) width++;

            let height = 1;
            // key = 1 + body, so the merge flag is read from body, not key:
            // reading key directly would see the base "1" flipped into bit 0.
            const canMergeV = (key - 1) & 1;
            outer: while (v + height < vCount) {
              if (!canMergeV) break;
              const row = (v + height) * stride;
              for (let i = 0; i < width; i++) {
                if (mask[u + i + row] !== key) break outer;
                if (lightMask[u + i + row] !== cellLight) break outer;
              }
              height++;
            }

            const body = key - 1;
            const skyLevel = (body >>> 1) & 3;
            const aoPack = (body >>> 3) & 255;
            const tile = (body >>> 11) & 127;
            const hPlus = (body >>> 18) & 31;
            const hMinus = (body >>> 23) & 31;
            const tintBiome = (body >>> 28) & 15;
            const hPlusByte = Math.round(hPlus * (255 / 31));
            const hMinusByte = Math.round(hMinus * (255 / 31));
            const faceTint = tintForTile(tile, tintBiome);

            // Recover the actual block at the first cell for bucket selection.
            const first = [0, 0, 0];
            first[axis] = slice;
            first[uAxis] = u;
            first[vAxis] = v;
            const firstId = padded[padIndex(first[0], first[1], first[2])];
            const bucket = BLOCKS[firstId]?.renderLayer === 'water' ? water : solid;

            const plane = slice + (sign > 0 ? 1 : 0);
            const points = [];
            const uvs = [];
            const corners = [
              [u, v],
              [u + width, v],
              [u + width, v + height],
              [u, v + height],
            ];
            for (let i = 0; i < 4; i++) {
              const p = [0, 0, 0];
              p[axis] = plane;
              p[uAxis] = corners[i][0];
              p[vAxis] = corners[i][1];
              points.push(p);
              // The atlas is a DataArrayTexture (flipY = false), so texel row 0
              // is the canvas top and t grows downward. Side faces must sample
              // with -Y so the painter's top edge lands on the top of the face;
              // using raw world Y draws grass/snow fringes upside down.
              if (axis === 0) uvs.push([p[2], -p[1]]);
              else if (axis === 1) uvs.push([p[0], p[2]]);
              else uvs.push([p[0], -p[1]]);
            }

            normal[0] = 0;
            normal[1] = 0;
            normal[2] = 0;
            normal[axis] = sign;
            bucket.addQuad(points, normal, uvs, tile, aoPack, skyLevel, hPlusByte, hMinusByte, sign, cellLight, faceTint);

            for (let yy = 0; yy < height; yy++) {
              for (let xx = 0; xx < width; xx++) {
                mask[u + xx + (v + yy) * stride] = 0;
                lightMask[u + xx + (v + yy) * stride] = 0;
              }
            }
          }
        }
      }
    }
  }

  // Non-cube blocks are emitted after the cube pass so they never interfere
  // with greedy merging. Fences read their neighbours from the padded volume.
  for (let y = 0; y <= topRow; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = padded[padIndex(x, y, z)];
        const biome = biomes ? (biomes[x + z * CHUNK_SIZE] ?? BIOME.PLAINS) : BIOME.PLAINS;
        if (CROSS_IDS.has(id)) {
          emitCross(solid, x, y, z, BLOCKS[id], blockLight, tops, tintForTile(BLOCKS[id].faceTiles[0], biome));
        } else if (CUSTOM_IDS.has(id)) {
          emitCustom(solid, padded, x, y, z, BLOCKS[id], blockLight, tops);
        }
      }
    }
  }

  return {
    solid: solid.finish(),
    water: water.finish(),
  };
}

/**
 * Builds the padded 18x258x18 volume from a chunk and its four cardinal
 * neighbors. Missing diagonal neighbors only affect corner AO, never culling.
 */
export function buildPaddedVolume(blocks, getNeighbor) {
  const padded = new Uint8Array(PAD_X * PAD_Y * PAD_Z);
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    const yBase = y << 8;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const src = yBase + (z << 4);
      const dst = padIndex(0, y, z);
      padded.set(blocks.subarray(src, src + CHUNK_SIZE), dst);
    }
  }
  if (getNeighbor) {
    const west = getNeighbor(-1, 0);
    const east = getNeighbor(1, 0);
    const north = getNeighbor(0, -1);
    const south = getNeighbor(0, 1);
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      const yBase = y << 8;
      for (let i = 0; i < CHUNK_SIZE; i++) {
        if (west) padded[padIndex(-1, y, i)] = west[yBase + 15 + (i << 4)];
        if (east) padded[padIndex(16, y, i)] = east[yBase + (i << 4)];
        if (north) padded[padIndex(i, y, -1)] = north[yBase + 240 + i];
        if (south) padded[padIndex(i, y, 16)] = south[yBase + i];
      }
    }
    // Four diagonal columns for seamless corner AO.
    const corners = [
      [-1, -1, 15, 15],
      [16, -1, 0, 15],
      [-1, 16, 15, 0],
      [16, 16, 0, 0],
    ];
    for (const [px, pz, sx, sz] of corners) {
      const neighborChunk = getNeighbor(px === -1 ? -1 : 1, pz === -1 ? -1 : 1);
      if (!neighborChunk) continue;
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        padded[padIndex(px, y, pz)] = neighborChunk[(y << 8) + (sz << 4) + sx];
      }
    }
  }
  return padded;
}
