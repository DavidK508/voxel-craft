import {
  CHUNK_SIZE,
  PAD_X,
  PAD_Y,
  PAD_Z,
  SUN_AXIS_X,
  SUN_AXIS_Z,
  WORLD_HEIGHT,
} from '../shared/constants.js';
import { BLOCKS, isRenderable } from '../shared/blocks.js';

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

const TORCH_ID = 63;
// Crops and fences are drawn as two crossed planes instead of a cube.
const CROSS_IDS = new Set([64, 65, 66, 67, 68]);

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

/**
 * A torch is a thin centred post rather than a full cube. Emitting its five
 * visible quads directly keeps the normal greedy pass free of special cases.
 */
function emitTorch(bucket, x, y, z, lightMap, tops) {
  const block = BLOCKS[TORCH_ID];
  const tile = block.faceTiles[0];
  const sky = computeSky(tops, x, z, y + 1);
  const light = lightAtIndex(lightMap, x, y, z);
  const half = 1 / 16;
  const cx = x + 0.5;
  const cz = z + 0.5;
  const bottom = y + 0.0625;
  const top = y + 0.625;
  const normal = [0, 0, 0];
  const pos = [0, 0, 0];

  const addFace = (axis, sign, fixed, u0, u1, v0, v1) => {
    const uAxis = (axis + 1) % 3;
    const vAxis = (axis + 2) % 3;
    const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const points = corners.map(([u, v]) => {
      pos[axis] = fixed;
      pos[uAxis] = u;
      pos[vAxis] = v;
      return [pos[0], pos[1], pos[2]];
    });
    // Texture V runs downward: put V=0 on the top of the post so the flame
    // stays upright on every side face.
    const faceUvs = axis === 1
      ? [[0, 0], [1, 0], [1, 1], [0, 1]]
      : axis === 0
        ? [[0, 1], [0, 0], [1, 0], [1, 1]]
        : [[0, 1], [1, 1], [1, 0], [0, 0]];
    normal[0] = 0;
    normal[1] = 0;
    normal[2] = 0;
    normal[axis] = sign;
    bucket.addQuad(points, normal, faceUvs, tile, 255, sky, 0, 0, sign, light);
  };

  addFace(0, 1, cx + half, bottom, top, cz - half, cz + half);
  addFace(0, -1, cx - half, bottom, top, cz - half, cz + half);
  addFace(2, 1, cz + half, cx - half, cx + half, bottom, top);
  addFace(2, -1, cz - half, cx - half, cx + half, bottom, top);
  addFace(1, 1, top, cx - half, cx + half, cz - half, cz + half);
}

/**
 * Plants and fences are flat crossed billboards. Both sides are emitted because
 * the terrain material is front-face only.
 */
function emitCross(bucket, x, y, z, block, lightMap, tops) {
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
    this.indices = [];
    this.vertexCount = 0;
  }

  addQuad(points, normal, uvs, tile, aoPack, skyLevel, hPlus, hMinus, sign, lightLevel = 0) {
    const base = this.vertexCount;
    const sky = skyLevel * 85;
    const light = Math.max(0, Math.min(15, lightLevel)) * 17;
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
export function meshChunk(padded, originX, originZ, extTops) {
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
            // Torches, crops and fences use their own geometry, emitted after
            // the cube pass.
            if (blockId === TORCH_ID || CROSS_IDS.has(blockId)) continue;
            if (!isRenderable(blockId)) continue;

            neighbor[0] = pos[0];
            neighbor[1] = pos[1];
            neighbor[2] = pos[2];
            neighbor[axis] += sign;
            const neighborId = padded[padIndex(neighbor[0], neighbor[1], neighbor[2])];
            if (!shouldRender(blockId, neighborId)) continue;

            const block = BLOCKS[blockId];
            const tile = block.faceTiles[faceIndex];
            const aoPack = computeAO(padded, pos[0], pos[1], pos[2], axis, sign, uAxis, vAxis);
            const skyLevel = faceSky(tops, pos[0], pos[1], pos[2], axis, sign);
            faceHorizon(tops, pos[0], pos[1], pos[2], axis, sign, horizon);
            const hPlus = Math.round(horizon[0] * 63);
            const hMinus = Math.round(horizon[1] * 63);
            const canMergeV = block.mergeSides || axis === 1 ? 1 : 0;
            // body = tile * 2048 + aoPack * 8 + skyLevel * 2 + canMergeV
            //      + hPlus * 131072 + hMinus * 8388608
            // AO, skylight and sun horizons all join the key so quads never
            // merge across a lighting or shadow discontinuity; a merged quad
            // therefore keeps one uniform light value. Block light is stored
            // alongside in lightMask (the 32-bit key is already full).
            mask[u + v * stride] = 1 + (tile << 11) + (aoPack << 3)
              + (skyLevel << 1) + canMergeV + (hPlus << 17) + (hMinus << 23);
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
            const skyLevel = (body >> 1) & 3;
            const aoPack = (body >> 3) & 255;
            const tile = (body >> 11) & 63;
            const hPlus = (body >> 17) & 63;
            const hMinus = (body >> 23) & 63;
            const hPlusByte = Math.round(hPlus * (255 / 63));
            const hMinusByte = Math.round(hMinus * (255 / 63));

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
            bucket.addQuad(points, normal, uvs, tile, aoPack, skyLevel, hPlusByte, hMinusByte, sign, cellLight);

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

  // Torches and cross-shaped blocks are not cubes; emit their custom quads now
  // that the cube pass has finished so they never interfere with merging.
  for (let y = 0; y <= topRow; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = padded[padIndex(x, y, z)];
        if (id === TORCH_ID) emitTorch(solid, x, y, z, blockLight, tops);
        else if (CROSS_IDS.has(id)) emitCross(solid, x, y, z, BLOCKS[id], blockLight, tops);
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
