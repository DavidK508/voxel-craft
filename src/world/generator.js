import {
  CHUNK_SIZE,
  SEA_LEVEL,
  WORLD_HEIGHT,
} from '../shared/constants.js';
import { NoiseField, clamp, hash2i, hash3i, lerp, smoothstep } from '../shared/noise.js';
import { getDoorId } from '../shared/blocks.js';

export const BIOME = Object.freeze({
  OCEAN: 0,
  BEACH: 1,
  PLAINS: 2,
  FOREST: 3,
  DESERT: 4,
  SNOWY: 5,
  MOUNTAINS: 6,
  SWAMP: 7,
  BIRCH_FOREST: 8,
  TAIGA: 9,
  NETHER: 10,
  END: 11,
});

export const BIOME_INFO = Object.freeze({
  0: { name: 'Океан', tree: null, density: 0, surface: 'sand', subsurface: 'sand' },
  1: { name: 'Пляж', tree: null, density: 0, surface: 'sand', subsurface: 'sand' },
  2: { name: 'Равнины', tree: 'oak', density: 0.004, surface: 'grass', subsurface: 'dirt' },
  3: { name: 'Лес', tree: 'oak', density: 0.021, surface: 'grass', subsurface: 'dirt' },
  4: { name: 'Пустыня', tree: null, density: 0, surface: 'sand', subsurface: 'sandstone' },
  5: { name: 'Снежные поля', tree: 'spruce', density: 0.008, surface: 'snow', subsurface: 'dirt' },
  6: { name: 'Горы', tree: 'spruce', density: 0.002, surface: 'stone', subsurface: 'stone' },
  7: { name: 'Болото', tree: 'oak', density: 0.009, surface: 'grass', subsurface: 'dirt' },
  8: { name: 'Берёзовый лес', tree: 'birch', density: 0.018, surface: 'grass', subsurface: 'dirt' },
  9: { name: 'Тайга', tree: 'spruce', density: 0.014, surface: 'grass', subsurface: 'dirt' },
  10: { name: 'Ад', tree: null, density: 0, surface: 'netherrack', subsurface: 'netherrack' },
  11: { name: 'Край', tree: null, density: 0, surface: 'end_stone', subsurface: 'end_stone' },
});

export const NETHER_THRESHOLD = 900000;
export const END_THRESHOLD = 900000;
export const NETHER_ORIGIN = Object.freeze({ x: 1000000, z: 0 });
export const END_ORIGIN = Object.freeze({ x: 0, z: 1000000 });
export const VILLAGE_CELL = 160;
const VILLAGE_BIOMES = [
  BIOME.PLAINS,
  BIOME.FOREST,
  BIOME.BIRCH_FOREST,
  BIOME.TAIGA,
  BIOME.DESERT,
  BIOME.SNOWY,
];

/** Which dimension a chunk column belongs to. Dimensions live far apart in one
 *  continuous world so saving, meshing and edits stay completely unchanged. */
export function dimensionAt(x, z) {
  if (x >= NETHER_THRESHOLD) return 'nether';
  if (z >= END_THRESHOLD) return 'end';
  return 'overworld';
}

const ID = {
  air: 0,
  stone: 1,
  grass: 2,
  dirt: 3,
  oakPlanks: 5,
  oakLog: 6,
  sand: 8,
  sandstone: 9,
  gravel: 10,
  water: 11,
  bedrock: 13,
  coal: 14,
  iron: 15,
  gold: 16,
  diamond: 17,
  snow: 18,
  ice: 19,
  cactus: 20,
  deepslate: 26,
  redSand: 38,
  snowyGrass: 49,
  netherrack: 50,
  soulSand: 51,
  netherBricks: 52,
  magma: 53,
  quartzOre: 54,
  redstoneOre: 182,
  endStone: 56,
  hay: 60,
  wheatCrop: 64,
  carrotCrop: 65,
  potatoCrop: 66,
  beetrootCrop: 67,
  oakFence: 68,
  craftingTable: 21,
  furnace: 22,
  glass: 12,
  pumpkin: 40,
  lava: 30,
};

const generatorCache = new Map();

export class WorldGenerator {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.noise = new NoiseField(this.seed);
    this.heightCache = new Map();
    this.biomeCache = new Map();
    this.riverCache = new Map();
    this.villageCells = new Map();
  }

  temperatureAt(x, z) {
    return this.noise.temperature.fbm2(x * 0.0011 + 91.7, z * 0.0011 - 27.3, 3, 2, 0.5);
  }

  humidityAt(x, z) {
    return this.noise.humidity.fbm2(x * 0.0013 - 54.1, z * 0.0013 + 13.8, 3, 2, 0.5);
  }

  riverStrengthAt(x, z) {
    // heightAt() samples this field five times per column (centre + four
    // bank neighbours), so caching the noise avoids a large share of world
    // generation work without changing the output.
    const key = `${x},${z}`;
    const cached = this.riverCache.get(key);
    if (cached !== undefined) return cached;

    // Low-frequency domain warp makes winding valleys instead of straight
    // noise contours; several basins keep different regions from repeating.
    const warpX = this.noise.terrain.fbm2(x * 0.00042 - 13.7, z * 0.00042 + 8.2, 3, 2, 0.5) * 180;
    const warpZ = this.noise.hills.fbm2(x * 0.00042 + 31.9, z * 0.00042 - 17.4, 3, 2, 0.5) * 180;
    const wx = x + warpX;
    const wz = z + warpZ;
    const n = this.noise.river.fbm2(wx * 0.00135 + 73.4, wz * 0.00135 - 19.6, 4, 2.05, 0.5);
    const wiggle = this.noise.erosion.noise2(wx * 0.005 + 11.1, wz * 0.005 - 7.4) * 0.014;
    const width = 0.030 + Math.max(0, this.noise.erosion.noise2(wx * 0.0006, wz * 0.0006)) * 0.012;
    const value = 1 - smoothstep(0, width, Math.abs(n + wiggle));
    if (this.riverCache.size > 12000) this.riverCache.clear();
    this.riverCache.set(key, value);
    return value;
  }

  /** Shallow lake basins in flat lowlands; kept away from ocean coastlines. */
  lakeStrengthAt(x, z, continent = this.noise.terrain.fbm2(x * 0.00105, z * 0.00105, 5, 2, 0.5)) {
    if (continent < -0.04 || continent > 0.42) return 0;
    const n = this.noise.hills.noise2(x * 0.0058 + 91.4, z * 0.0058 - 26.7);
    const detail = this.noise.erosion.fbm2(x * 0.013 - 8.6, z * 0.013 + 19.2, 2, 2, 0.5) * 0.08;
    return 1 - smoothstep(-0.72, -0.55, n + detail);
  }

  heightAt(x, z) {
    const key = `${x},${z}`;
    const cached = this.heightCache.get(key);
    if (cached !== undefined) return cached;

    const continent = this.noise.terrain.fbm2(x * 0.00105, z * 0.00105, 5, 2, 0.5);
    const hills = this.noise.hills.fbm2(x * 0.0078, z * 0.0078, 4, 2.05, 0.52);
    const detail = this.noise.erosion.fbm2(x * 0.022, z * 0.022, 3, 2, 0.5);
    const ridge = this.noise.mountains.ridged2(x * 0.0025 + 4.2, z * 0.0025 - 8.6, 5, 2, 0.5);
    const erosion = clamp(this.noise.erosion.fbm2(x * 0.0018 - 40.3, z * 0.0018 + 12.7, 4, 2, 0.5) * 0.5 + 0.5, 0, 1);
    const mountainMask = smoothstep(0.46, 0.82, ridge * 0.68 + continent * 0.32) * (0.45 + erosion * 0.55);

    let h = SEA_LEVEL + 6 + continent * 20 + hills * 7 + detail * 1.8;
    h += Math.pow(Math.max(0, ridge - 0.38), 2.15) * 84 * mountainMask;
    if (continent < -0.34) h -= (-continent - 0.34) * 75;

    // Soft plateaus and rolling lowlands make traversal more readable.
    const plateau = this.noise.terrain.noise2(x * 0.00042 + 12.5, z * 0.00042 - 7.1);
    h += smoothstep(0.32, 0.78, plateau) * 8;

    // Keep ordinary lowlands dry. Only rivers, lakes and oceans may cut below
    // sea level, so the world does not dissolve into shallow wetlands.
    if (continent >= -0.34 && h < SEA_LEVEL + 2) {
      h = SEA_LEVEL + 2 + (h - SEA_LEVEL - 2) * 0.12;
    }

    // Rivers carve winding channels down to sea level on land.
    if (continent > -0.28 && h > SEA_LEVEL - 1) {
      const river = this.riverStrengthAt(x, z);
      if (river > 0) {
        const depth = 3.5 + river * 5 + Math.max(0, continent) * 1.5;
        h = lerp(h, SEA_LEVEL - depth, smoothstep(0.12, 0.75, river));
      }
    }

    // Shallow lakes dot gentle lowlands, with banks that make shore habitat.
    const lake = this.lakeStrengthAt(x, z, continent);
    if (lake > 0 && h > SEA_LEVEL - 1 && h < SEA_LEVEL + 10) {
      h = lerp(h, SEA_LEVEL - 0.6 - lake * 0.7, smoothstep(0.35, 0.9, lake) * 0.75);
    }

    // Raise a soft rim just outside waterways so the shore is visible.
    const neighbor = Math.max(
      this.riverStrengthAt(x + 7, z),
      this.riverStrengthAt(x - 7, z),
      this.riverStrengthAt(x, z + 7),
      this.riverStrengthAt(x, z - 7),
    );
    if (h >= SEA_LEVEL && neighbor > 0.15 && this.riverStrengthAt(x, z) <= 0.02) {
      h += smoothstep(0.15, 0.7, neighbor) * 2.2;
    }

    const height = clamp(Math.floor(h), 6, WORLD_HEIGHT - 18);
    if (this.heightCache.size > 20000) this.heightCache.clear();
    this.heightCache.set(key, height);
    return height;
  }

  biomeAt(x, z, height = this.heightAt(x, z)) {
    const key = `${x},${z}`;
    const cached = this.biomeCache.get(key);
    if (cached !== undefined) return cached;
    const temp = this.temperatureAt(x, z);
    const humidity = this.humidityAt(x, z);
    let biome;
    if (height < SEA_LEVEL - 2) biome = BIOME.OCEAN;
    else if (height <= SEA_LEVEL + 2) biome = temp < -0.22 ? BIOME.SNOWY : BIOME.BEACH;
    else if (height > 112) biome = BIOME.MOUNTAINS;
    else if (temp < -0.3) biome = BIOME.SNOWY;
    else if (temp > 0.24 && humidity < -0.02) biome = BIOME.DESERT;
    else if (humidity > 0.31 && height <= SEA_LEVEL + 4) biome = BIOME.SWAMP;
    else if (humidity > 0.27) biome = BIOME.BIRCH_FOREST;
    else if (humidity > 0.08) biome = BIOME.FOREST;
    else if (temp < -0.08) biome = BIOME.TAIGA;
    else biome = BIOME.PLAINS;

    if (this.biomeCache.size > 20000) this.biomeCache.clear();
    this.biomeCache.set(key, biome);
    return biome;
  }

  findSpawn() {
    // Every new game starts inside a village. Cell (0, 0) is forced to hold
    // one, so this always succeeds on a normal overworld seed.
    const village = this.findSpawnVillage();
    if (village) {
      return {
        x: village.x + 0.5,
        y: village.y + 1.05,
        z: village.z + 4.5,
        biome: village.biome,
        village: { x: village.x, z: village.z },
      };
    }

    // Fallback for pathological seeds where no village site exists.
    for (let radius = 0; radius < 48; radius++) {
      const steps = Math.max(1, radius * 8);
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(angle) * radius * 12);
        const z = Math.round(Math.sin(angle) * radius * 12);
        const h = this.heightAt(x, z);
        const biome = this.biomeAt(x, z, h);
        if (h > SEA_LEVEL + 1 && h < 108 && biome !== BIOME.OCEAN && biome !== BIOME.BEACH) {
          return { x: x + 0.5, y: h + 1.05, z: z + 0.5, biome };
        }
      }
    }
    return { x: 0.5, y: SEA_LEVEL + 8, z: 0.5, biome: BIOME.PLAINS };
  }

  /** Nearest village to the origin, preferring the guaranteed (0, 0) cell. */
  findSpawnVillage() {
    let best = null;
    let bestDistance = Infinity;
    for (let cellZ = -1; cellZ <= 1; cellZ++) {
      for (let cellX = -1; cellX <= 1; cellX++) {
        const village = this.villageAtCell(cellX, cellZ);
        if (!village) continue;
        const distance = Math.hypot(village.x, village.z);
        if (distance < bestDistance) {
          best = village;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  /** Chunk entry point: the region decides which dimension is generated. */
  generateChunk(cx, cz) {
    const dimension = dimensionAt(cx * CHUNK_SIZE, cz * CHUNK_SIZE);
    if (dimension === 'nether') return this.generateNetherChunk(cx, cz);
    if (dimension === 'end') return this.generateEndChunk(cx, cz);
    return this.generateOverworldChunk(cx, cz);
  }

  generateOverworldChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    const heights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    const noise = this.noise;

    const localIndex = (x, y, z) => x + (z << 4) + (y << 8);
    const set = (x, y, z, id) => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
      blocks[localIndex(x, y, z)] = id;
    };
    const get = (x, y, z) => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return 0;
      return blocks[localIndex(x, y, z)];
    };

    // Height + biome pass.
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const height = this.heightAt(wx, wz);
        const biome = this.biomeAt(wx, wz, height);
        heights[x + z * CHUNK_SIZE] = height;
        biomes[x + z * CHUNK_SIZE] = biome;
      }
    }

    // Terrain pass.
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const height = heights[x + z * CHUNK_SIZE];
        const biome = biomes[x + z * CHUNK_SIZE];
        const info = BIOME_INFO[biome];
        const temp = this.temperatureAt(wx, wz);
        const humidity = this.humidityAt(wx, wz);

        let surface = ID.grass;
        let subsurface = ID.dirt;
        if (info.surface === 'sand') {
          surface = ID.sand;
          subsurface = biome === BIOME.DESERT ? ID.sandstone : ID.sand;
          if (biome === BIOME.DESERT && hash2i(wx, wz, this.seed ^ 0x91f2) < 0.18) surface = ID.redSand;
        } else if (info.surface === 'snow') {
          surface = ID.snowyGrass;
          subsurface = ID.dirt;
        } else if (info.surface === 'stone') {
          surface = ID.stone;
          subsurface = ID.stone;
        }
        if (biome === BIOME.SWAMP && hash2i(wx, wz, this.seed ^ 0x4a11) < 0.22) {
          surface = ID.grass;
          subsurface = ID.dirt;
        }

        for (let y = 0; y <= height; y++) {
          let id;
          if (y === 0 || (y <= 2 && hash3i(wx, y, wz, this.seed ^ 0xb00b) < 0.7)) {
            id = ID.bedrock;
          } else if (y === height) {
            id = surface;
            if (biome === BIOME.MOUNTAINS && height > 122) id = ID.snow;
            if (biome === BIOME.MOUNTAINS && height > 100 && height <= 122) id = ID.stone;
          } else if (y >= height - 3) {
            id = subsurface;
          } else if (y < 30) {
            id = ID.deepslate;
          } else {
            id = ID.stone;
          }
          blocks[localIndex(x, y, z)] = id;
        }

        // Beaches, river banks, lake shores and ocean floors.
        const nearWater = height <= SEA_LEVEL + 3 && height >= SEA_LEVEL - 6;
        if (nearWater) {
          for (let y = Math.max(1, height - 3); y <= height; y++) {
            const id = blocks[localIndex(x, y, z)];
            if (id !== ID.bedrock) blocks[localIndex(x, y, z)] = biome === BIOME.OCEAN ? (hash3i(wx, y, wz, this.seed) < 0.5 ? ID.gravel : ID.sand) : ID.sand;
          }
        }

        // Carve caves. Surface is left mostly intact so entrances are rare but real.
        const depth = height - 3;
        if (depth > 5) {
          for (let y = 4; y <= depth; y++) {
            const current = blocks[localIndex(x, y, z)];
            if (current === ID.bedrock) continue;
            const c1 = noise.caveA.noise3(wx * 0.036, y * 0.052, wz * 0.036);
            const c2 = noise.caveB.noise3(wx * 0.036 + 41.7, y * 0.052 - 19.3, wz * 0.036 + 11.1);
            const c3 = noise.caveC.noise3(wx * 0.017 - 22.2, y * 0.028 + 7.4, wz * 0.017 + 33.3);
            const tunnel = Math.abs(c1) < 0.16 && Math.abs(c2) < 0.18;
            const cheese = c3 > 0.33 && y < 82;
            if (tunnel || cheese) {
              if (y <= 9) blocks[localIndex(x, y, z)] = ID.lava;
              else blocks[localIndex(x, y, z)] = ID.air;
            }
          }
        }

        // Ore distribution.
        for (let y = 1; y < height - 1; y++) {
          const id = blocks[localIndex(x, y, z)];
          if (id !== ID.stone && id !== ID.deepslate) continue;
          const r = hash3i(wx, y, wz, this.seed ^ 0xa53f);
          const vein = noise.ore.noise3(wx * 0.14, y * 0.16, wz * 0.14);
          if (y < 16 && r < 0.0011 * (1.2 + vein)) {
            blocks[localIndex(x, y, z)] = ID.diamond;
          } else if (y < 32 && r < 0.0022 * (1.2 + vein)) {
            blocks[localIndex(x, y, z)] = ID.gold;
          } else if (y < 64 && r < 0.0045 * (1.2 + vein)) {
            blocks[localIndex(x, y, z)] = ID.iron;
          } else if (y < 48 && r < 0.006 * (1.2 + vein)) {
            blocks[localIndex(x, y, z)] = ID.redstoneOre;
          } else if (y < 110 && r < 0.0085 * (1.2 + vein)) {
            blocks[localIndex(x, y, z)] = ID.coal;
          }
        }

        // Fill oceans, lakes and rivers.
        if (height < SEA_LEVEL) {
          for (let y = height + 1; y <= SEA_LEVEL; y++) {
            blocks[localIndex(x, y, z)] = ID.water;
          }
          if (biome === BIOME.SNOWY || temp < -0.35) {
            blocks[localIndex(x, SEA_LEVEL, z)] = ID.ice;
          }
        }

        // Small clay patches at the edge of water.
        if (biome === BIOME.SWAMP && height <= SEA_LEVEL + 1 && hash2i(wx, wz, this.seed ^ 0x77aa) < 0.03) {
          blocks[localIndex(x, height, z)] = 24;
        }

        // Cacti in the desert.
        if (biome === BIOME.DESERT && height > SEA_LEVEL && hash2i(wx, wz, this.seed ^ 0xcac7) < 0.0045) {
          const cactusHeight = 1 + Math.floor(hash2i(wx + 7, wz - 3, this.seed) * 3);
          for (let i = 1; i <= cactusHeight && height + i < WORLD_HEIGHT; i++) {
            blocks[localIndex(x, height + i, z)] = ID.cactus;
          }
        }
      }
    }

    // Trees are generated from a 3x3 neighborhood so canopies cross chunk borders
    // deterministically and without any runtime structure stitching.
    for (let ncz = cz - 1; ncz <= cz + 1; ncz++) {
      for (let ncx = cx - 1; ncx <= cx + 1; ncx++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const wx = ncx * CHUNK_SIZE + lx;
            const wz = ncz * CHUNK_SIZE + lz;
            const height = this.heightAt(wx, wz);
            if (height <= SEA_LEVEL + 1) continue;
            const biome = this.biomeAt(wx, wz, height);
            const info = BIOME_INFO[biome];
            if (!info.tree || info.density <= 0) continue;
            if (hash2i(wx, wz, this.seed ^ 0x7ee5) >= info.density) continue;
            this.placeTree(blocks, cx, cz, wx, height, wz, info.tree, set, get);
          }
        }
      }
    }

    // Snow caps on the highest mountains.
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = heights[x + z * CHUNK_SIZE];
        if (h > 128) {
          for (let y = h + 1; y < Math.min(WORLD_HEIGHT, h + 3); y++) {
            if (blocks[localIndex(x, y, z)] === ID.air) blocks[localIndex(x, y, z)] = ID.snow;
          }
        }
      }
    }

    this.placeVillages(blocks, heights, cx, cz, baseX, baseZ);

    return { blocks, heights, biomes };
  }

  /* ------------------------------------------------------------------ */
  /* Villages                                                            */
  /* ------------------------------------------------------------------ */

  /** Deterministic village cell centre, or null when the cell has no village. */
  villageAtCell(cellX, cellZ) {
    const key = `${cellX},${cellZ}`;
    if (this.villageCells.has(key)) return this.villageCells.get(key);

    const seed = this.seed;
    // Cell (0, 0) is always a village so a fresh game can spawn in one. If its
    // exact centre is water or a bad biome, search the cell for the first
    // suitable spot instead of giving up.
    const forced = cellX === 0 && cellZ === 0;
    let site = null;
    if (forced) {
      site = this.findVillageSite(cellX, cellZ);
    } else if (hash2i(cellX, cellZ, seed ^ 0x5a17) <= 0.62) {
      site = {
        x: cellX * VILLAGE_CELL + 40 + Math.floor(hash2i(cellX, cellZ, seed ^ 0x1177) * 80),
        z: cellZ * VILLAGE_CELL + 40 + Math.floor(hash2i(cellX, cellZ, seed ^ 0x2233) * 80),
      };
    }

    let village = null;
    if (site) {
      const h = this.heightAt(site.x, site.z);
      const biome = this.biomeAt(site.x, site.z, h);
      if (h > SEA_LEVEL + 1 && h <= 104 && VILLAGE_BIOMES.includes(biome)) {
        village = {
          x: site.x,
          z: site.z,
          y: h,
          biome,
          // The livestock pen sits east of the houses; the crop garden sits
          // south of them. EntityManager uses these coordinates to populate
          // the farm with animals.
          farm: {
            x: site.x + 18,
            z: site.z + 2,
            minX: site.x + 15,
            maxX: site.x + 21,
            minZ: site.z - 1,
            maxZ: site.z + 6,
          },
          garden: { x: site.x, z: site.z + 16 },
        };
      }
    }

    if (this.villageCells.size > 2048) this.villageCells.clear();
    this.villageCells.set(key, village);
    return village;
  }

  /** First suitable land position inside a village cell, searched from its centre. */
  findVillageSite(cellX, cellZ) {
    // The forced spawn village starts at the world origin so even a tiny
    // island (like the one some seeds have at 0,0) still gets a village.
    const spawnCell = cellX === 0 && cellZ === 0;
    const centerX = spawnCell ? 0 : cellX * VILLAGE_CELL + Math.floor(VILLAGE_CELL / 2);
    const centerZ = spawnCell ? 0 : cellZ * VILLAGE_CELL + Math.floor(VILLAGE_CELL / 2);
    const step = 8;
    const maxRing = spawnCell ? 18 : 9;
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const x = centerX + dx * step;
          const z = centerZ + dz * step;
          if (spawnCell && (x < 0 || z < 0 || x >= VILLAGE_CELL || z >= VILLAGE_CELL)) continue;
          const h = this.heightAt(x, z);
          if (h <= SEA_LEVEL + 1 || h > 104) continue;
          const biome = this.biomeAt(x, z, h);
          if (!VILLAGE_BIOMES.includes(biome)) continue;
          return { x, z };
        }
      }
    }
    return null;
  }

  /** Villages whose footprint touches this chunk. */
  villagesNearChunk(cx, cz) {
    // Villages include a crop garden, livestock farm and houses out to about
    // 28 blocks from the centre, so look a little further than the old plaza.
    const minX = cx * CHUNK_SIZE - 36;
    const maxX = (cx + 1) * CHUNK_SIZE + 36;
    const minZ = cz * CHUNK_SIZE - 36;
    const maxZ = (cz + 1) * CHUNK_SIZE + 36;
    const found = [];
    const firstCellX = Math.floor(minX / VILLAGE_CELL);
    const lastCellX = Math.floor(maxX / VILLAGE_CELL);
    const firstCellZ = Math.floor(minZ / VILLAGE_CELL);
    const lastCellZ = Math.floor(maxZ / VILLAGE_CELL);
    for (let cellZ = firstCellZ; cellZ <= lastCellZ; cellZ++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const village = this.villageAtCell(cellX, cellZ);
        if (!village) continue;
        if (village.x < minX || village.x > maxX || village.z < minZ || village.z > maxZ) continue;
        found.push(village);
      }
    }
    return found;
  }

  placeVillages(blocks, heights, cx, cz, baseX, baseZ) {
    const villages = this.villagesNearChunk(cx, cz);
    if (villages.length === 0) return;
    const setWorld = (wx, y, wz, id) => {
      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
      if (y < 0 || y >= WORLD_HEIGHT) return;
      blocks[lx + (lz << 4) + (y << 8)] = id;
    };
    const getWorld = (wx, y, wz) => {
      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return 0;
      if (y < 0 || y >= WORLD_HEIGHT) return 0;
      return blocks[lx + (lz << 4) + (y << 8)];
    };
    for (const village of villages) this.buildVillage(village, setWorld, getWorld);
    // Village floors are flat, so refresh the column tops that lie in this chunk.
    for (const village of villages) {
      const radius = 28;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dz * dz > radius * radius + 6) continue;
          const wx = village.x + dx;
          const wz = village.z + dz;
          const lx = wx - baseX;
          const lz = wz - baseZ;
          if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
          const index = lx + lz * CHUNK_SIZE;
          heights[index] = Math.max(heights[index], village.y);
        }
      }
    }
  }

  buildVillage(village, set, get) {
    const { x: vx, z: vz, y: base } = village;
    const desert = village.biome === BIOME.DESERT;
    const ground = desert ? ID.sand : ID.grass;
    const sub = desert ? ID.sand : ID.dirt;
    const radius = 28;

    // Flatten a generous plaza so houses never float over uneven ground.
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius + 6) continue;
        const wx = vx + dx;
        const wz = vz + dz;
        for (let y = base - 3; y <= base; y++) set(wx, y, wz, y === base ? ground : sub);
        for (let y = base + 1; y <= base + 12; y++) {
          const existing = get(wx, y, wz);
          if (existing !== ID.air) set(wx, y, wz, ID.air);
        }
      }
    }

    // Seven distinct footprints around the plaza. The previous version used a
    // single hash value for both coordinates, which produced fractional blocks
    // (silently dropped by the Uint8Array) and five houses in the same row.
    const houseStyles = [
      { w: 7, d: 6, style: 0 }, // timber cottage
      { w: 6, d: 6, style: 1 }, // red-roofed home
      { w: 6, d: 7, style: 2 }, // stone house
      { w: 8, d: 5, style: 3 }, // wide hall
      { w: 5, d: 8, style: 4 }, // desert / whitewashed cottage
      { w: 7, d: 7, style: 5 }, // garden cottage
      { w: 6, d: 5, style: 6 }, // brick workshop with a chimney
    ];

    const reserved = [
      { x0: vx - 6, z0: vz - 6, x1: vx + 6, z1: vz + 6 }, // well and street lamps
      { x0: vx - 9, z0: vz + 11, x1: vx + 9, z1: vz + 21 }, // crop garden
      { x0: vx + 12, z0: vz - 9, x1: vx + 24, z1: vz + 9 }, // livestock farm
    ];
    const overlaps = (a, b, margin) => (
      a.x0 - margin <= b.x1 && a.x1 + margin >= b.x0
      && a.z0 - margin <= b.z1 && a.z1 + margin >= b.z0
    );
    const inside = (rect) => (
      rect.x0 >= vx - radius + 2 && rect.x1 <= vx + radius - 2
      && rect.z0 >= vz - radius + 2 && rect.z1 <= vz + radius - 2
    );

    // Candidate top-left offsets form a loose ring around the plaza. Sorting by
    // distance plus deterministic jitter keeps the layout stable for a seed.
    const candidates = [];
    for (let oz = -20; oz <= 9; oz += 5) {
      for (let ox = -23; ox <= 9; ox += 5) candidates.push({ ox, oz });
    }
    for (let ox = -20; ox <= 8; ox += 7) {
      candidates.push({ ox, oz: -26 }, { ox, oz: -21 }, { ox, oz: 23 }, { ox, oz: 26 });
    }
    candidates.sort((a, b) => {
      const score = (c, salt) => Math.hypot(c.ox + 3, c.oz + 3)
        + hash2i(vx + c.ox, vz + c.oz, this.seed ^ salt) * 9;
      return score(a, 0x9e8c) - score(b, 0x9e8c);
    });

    const doorTowardsPlaza = (ox, oz, w, d) => {
      const cx = ox + (w - 1) / 2;
      const cz = oz + (d - 1) / 2;
      if (Math.abs(cx) > Math.abs(cz)) return cx > 0 ? 3 : 1;
      return cz > 0 ? 0 : 2;
    };

    const placedHouses = [];
    for (let i = 0; i < houseStyles.length; i++) {
      const def = houseStyles[i];
      for (let n = 0; n < candidates.length; n++) {
        const cand = candidates[(n + i * 3) % candidates.length];
        const rect = {
          x0: vx + cand.ox,
          z0: vz + cand.oz,
          x1: vx + cand.ox + def.w - 1,
          z1: vz + cand.oz + def.d - 1,
        };
        if (!inside(rect)) continue;
        if (reserved.some((zone) => overlaps(rect, zone, 1))) continue;
        if (placedHouses.some((house) => overlaps(rect, house.rect, 1))) continue;
        placedHouses.push({
          ...def,
          ox: cand.ox,
          oz: cand.oz,
          door: doorTowardsPlaza(cand.ox, cand.oz, def.w, def.d),
          rect,
        });
        break;
      }
    }

    for (const house of placedHouses) {
      this.buildHouse(
        vx + house.ox, vz + house.oz, base,
        house.w, house.d, house.door, set, desert, house.style,
      );
    }

    // Well in the middle of the plaza, with a wooden rim above the cobble.
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const wx = vx + dx;
        const wz = vz + dz;
        const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        if (edge) {
          set(wx, base + 1, wz, 4);
          if ((Math.abs(dx) === 2 && Math.abs(dz) <= 1)
            || (Math.abs(dz) === 2 && Math.abs(dx) <= 1)) set(wx, base + 2, wz, 5);
        } else {
          set(wx, base, wz, 11);
          set(wx, base + 1, wz, 0);
        }
      }
    }

    // Street lamps: cobblestone post + glowstone on top.
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      const wx = vx + dx;
      const wz = vz + dz;
      set(wx, base + 1, wz, 4);
      set(wx, base + 2, wz, 4);
      set(wx, base + 3, wz, 29);
    }

    this.buildGarden(vx, vz, base, set, desert);
    this.buildFarm(vx, vz, base, set, desert);
    this.buildVillagePaths(vx, vz, base, set, desert, placedHouses);
  }

  /** Gravel/sandstone lanes from the well to every house, the garden and the farm. */
  buildVillagePaths(vx, vz, base, set, desert, houses) {
    const paving = desert ? ID.sandstone : ID.gravel;
    const pave = (x, z) => {
      const dx = x - vx;
      const dz = z - vz;
      if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2) return; // keep the well clear
      if (dx >= 14 && dx <= 22 && dz >= -7 && dz <= 7) return; // leave the paddock alone
      if (dz >= 14 && dz <= 18 && dx >= -6 && dx <= 6) return; // leave the crops alone
      if (houses.some((h) => x >= vx + h.ox && x <= vx + h.ox + h.w - 1
        && z >= vz + h.oz && z <= vz + h.oz + h.d - 1)) return;
      set(x, base, z, paving);
    };
    const lane = (x0, z0, x1, z1) => {
      let x = x0;
      let z = z0;
      const dx = Math.abs(x1 - x0);
      const dz = Math.abs(z1 - z0);
      const sx = x0 < x1 ? 1 : -1;
      const sz = z0 < z1 ? 1 : -1;
      let error = dx - dz;
      for (let guard = 0; guard < 128; guard++) {
        pave(x, z);
        pave(x + 1, z);
        if (x === x1 && z === z1) break;
        const twice = error * 2;
        if (twice > -dz) { error -= dz; x += sx; }
        if (twice < dx) { error += dx; z += sz; }
      }
    };

    for (const house of houses) {
      const doorX = house.door === 1 ? house.w - 1 : house.door === 3 ? 0 : Math.floor(house.w / 2);
      const doorZ = house.door === 0 ? 0 : house.door === 2 ? house.d - 1 : Math.floor(house.d / 2);
      const dx = house.door === 1 ? 1 : house.door === 3 ? -1 : 0;
      const dz = house.door === 2 ? 1 : house.door === 0 ? -1 : 0;
      lane(vx, vz, vx + house.ox + doorX + dx * 2, vz + house.oz + doorZ + dz * 2);
    }
    lane(vx, vz, vx, vz + 13); // garden gate
    lane(vx, vz, vx + 14, vz + 2); // livestock gate
  }

  /** Fenced crop garden south of the plaza with four different crops. */
  buildGarden(vx, vz, base, set, desert) {
    const x0 = vx - 6;
    const x1 = vx + 6;
    const z0 = vz + 14;
    const z1 = vz + 18;
    const soil = desert ? ID.sand : ID.dirt;

    // A low fence around the plot, with a gate facing the village.
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const edge = x === x0 - 1 || x === x1 + 1 || z === z0 - 1 || z === z1 + 1;
        if (!edge) continue;
        const gate = z === z0 - 1 && (x === vx - 1 || x === vx || x === vx + 1);
        if (gate) continue;
        set(x, base + 1, z, ID.oakFence);
      }
    }

    // Rows of crops separated by a central water channel.
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        set(x, base, z, soil);
        const dx = x - vx;
        if (dx === 0) {
          set(x, base, z, ID.water);
          set(x, base + 1, z, ID.air);
          continue;
        }
        let crop = ID.wheatCrop;
        if (dx >= -3 && dx <= -1) crop = ID.carrotCrop;
        else if (dx >= 1 && dx <= 3) crop = ID.potatoCrop;
        else if (dx >= 4) crop = ID.beetrootCrop;
        set(x, base + 1, z, crop);
      }
    }

    // Scarecrow made from a hay bale and a pumpkin.
    set(x0, base + 1, z1, ID.hay);
    set(x0, base + 2, z1, ID.pumpkin);

    // Hay storage beside the garden.
    for (let i = 0; i < 3; i++) {
      set(x1 + 2, base + 1, z0 + i, ID.hay);
    }
  }

  /**
   * Livestock farm east of the plaza: a fenced paddock, a trough, hay, and a
   * small slaughterhouse shed with a crafting table and a furnace.
   */
  buildFarm(vx, vz, base, set, desert) {
    const x0 = vx + 14;
    const x1 = vx + 22;
    const z0 = vz - 7;
    const z1 = vz + 7;
    const ground = desert ? ID.sand : ID.grass;

    // Level the paddock and clear anything the flattening pass may have left.
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        set(x, base, z, ground);
        for (let y = base + 1; y <= base + 7; y++) set(x, y, z, ID.air);
      }
    }

    // Two-block-high fence with gates on the village side and the south side.
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1;
        if (!edge) continue;
        const westGate = x === x0 && (z === vz + 2 || z === vz + 3);
        const southGate = z === z1 && (x === vx + 18 || x === vx + 19);
        if (westGate || southGate) continue;
        set(x, base + 1, z, ID.oakFence);
        set(x, base + 2, z, ID.oakFence);
      }
    }

    // The slaughterhouse shed occupies the northern part of the paddock.
    this.buildBarn(x0 + 1, z0 + 1, base, 7, 5, set);

    // Water trough in the southern part of the paddock.
    for (let i = 0; i < 3; i++) {
      set(vx + 17 + i, base, z1 - 3, ID.water);
    }
    for (let i = 0; i < 3; i++) {
      set(vx + 16, base + 1, z1 - 3, ID.oakFence);
      set(vx + 20, base + 1, z1 - 3, ID.oakFence);
    }

    // Hay bales in the corners.
    for (const [bx, bz] of [[x0 + 1, z1 - 1], [x1 - 1, z1 - 1], [x0 + 1, z0 + 6]]) {
      set(bx, base + 1, bz, ID.hay);
    }
  }

  /** Small wooden slaughterhouse/barn with a door on its south wall. */
  buildBarn(x0, z0, base, width, depth, set) {
    const wall = ID.oakPlanks;
    const corner = ID.oakLog;
    const height = 3;
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const wx = x0 + x;
        const wz = z0 + z;
        const borderX = x === 0 || x === width - 1;
        const borderZ = z === 0 || z === depth - 1;
        const isCorner = borderX && borderZ;
        for (let y = 0; y < height; y++) {
          if (!borderX && !borderZ) {
            set(wx, base + 1 + y, wz, ID.air);
          } else {
            let id = isCorner ? corner : wall;
            if (y < 2 && z === depth - 1 && x === Math.floor(width / 2)) id = ID.air;
            set(wx, base + 1 + y, wz, id);
          }
        }
        set(wx, base + 1 + height, wz, wall);
        if (borderX || borderZ) set(wx, base + 2 + height, wz, corner);
      }
    }

    // Butcher's work area and storage.
    set(x0 + 1, base + 1, z0 + 1, ID.craftingTable);
    set(x0 + width - 2, base + 1, z0 + 1, ID.furnace);
    set(x0 + width - 2, base + 1, z0 + depth - 2, ID.hay);
    set(x0 + 1, base + 1, z0 + depth - 2, ID.hay);
  }

  /**
   * Small village house. `door` is the wall index: 0 north, 1 east, 2 south, 3 west.
   * The style changes the palette, roof silhouette and interior so a village
   * reads as a cluster of different buildings instead of five identical boxes.
   */
  buildHouse(x0, z0, base, width, depth, door, set, desert, style = 0) {
    const styleIndex = style % 7;
    const walls = [5, 5, 28, 6, desert ? 9 : 42, 5, 23];
    const corners = [4, 4, 28, 6, desert ? 9 : 42, 34, 23];
    const roofs = [5, 43, 4, 6, desert ? 9 : 42, 45, 23];
    const trims = [4, 42, 27, 5, 44, 6, 4];
    const wall = walls[styleIndex];
    const corner = corners[styleIndex];
    const roof = roofs[styleIndex];
    const trim = trims[styleIndex];
    const height = styleIndex === 5 ? 4 : 3;
    const isPitched = styleIndex === 1 || styleIndex === 4 || styleIndex === 5;
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const wx = x0 + x;
        const wz = z0 + z;
        const borderX = x === 0 || x === width - 1;
        const borderZ = z === 0 || z === depth - 1;
        const isCorner = borderX && borderZ;
        for (let y = 0; y < height; y++) {
          const isWall = borderX || borderZ;
          if (!isWall) {
            set(wx, base + 1 + y, wz, ID.air);
          } else {
            let id = isCorner ? corner : wall;
            const isDoor = y < 2 && (
              (door === 0 && z === 0 && x === Math.floor(width / 2))
              || (door === 2 && z === depth - 1 && x === Math.floor(width / 2))
              || (door === 1 && x === width - 1 && z === Math.floor(depth / 2))
              || (door === 3 && x === 0 && z === Math.floor(depth / 2))
            );
            if (isDoor) id = getDoorId(door, false, y);
            // Windows on the upper row, skipping the doorway column.
            const window = y === 1 && (
              (z === 0 && x > 0 && x < width - 1 && x !== Math.floor(width / 2))
              || (z === depth - 1 && x > 0 && x < width - 1 && x !== Math.floor(width / 2))
              || (x === 0 && z > 0 && z < depth - 1)
              || (x === width - 1 && z > 0 && z < depth - 1)
            );
            if (window && !isDoor) id = ID.glass;
            set(wx, base + 1 + y, wz, id);
          }
        }
        set(wx, base + 1 + height, wz, roof);
        // A trim course around the eaves, with a stepped ridge for pitched roofs.
        if (borderX || borderZ) set(wx, base + 2 + height, wz, trim);
        else if (isPitched) set(wx, base + 2 + height, wz, roof);
        if (isPitched && x > 0 && x < width - 1 && z > 0 && z < depth - 1) {
          set(wx, base + 3 + height, wz, roof);
        }
      }
    }
    // Interior furnishing varies with the style.
    set(x0 + 1, base + 1, z0 + 1, styleIndex === 0 || styleIndex === 3 ? 21 : 22);
    if (styleIndex !== 1 && styleIndex !== 4) set(x0 + width - 2, base + 1, z0 + depth - 2, 48);
    if (styleIndex === 4 || styleIndex === 5) {
      set(x0 + 2, base + 1, z0 + 1, 42);
      set(x0 + 2, base + 1, z0 + 2, 44); // a cosy two-tone bed
    }
    set(x0 + Math.floor(width / 2), base + 1, z0 + Math.floor(depth / 2), 29);
    if (styleIndex === 6) {
      // Brick workshop chimney rising through the roof.
      const cx = x0 + width - 2;
      const cz = z0 + 1;
      for (let y = base + 2 + height; y <= base + 5 + height; y++) set(cx, y, cz, 4);
      set(cx, base + 6 + height, cz, 29);
    }
  }
  /* ------------------------------------------------------------------ */
  /* Nether                                                              */
  /* ------------------------------------------------------------------ */

  generateNetherChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    const heights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(BIOME.NETHER);
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    const noise = this.noise;
    const set = (x, y, z, id) => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
      blocks[x + (z << 4) + (y << 8)] = id;
    };

    const plazaChunk = baseX <= NETHER_ORIGIN.x + 24 && baseX + CHUNK_SIZE >= NETHER_ORIGIN.x - 24
      && baseZ <= NETHER_ORIGIN.z + 24 && baseZ + CHUNK_SIZE >= NETHER_ORIGIN.z - 24;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const inPlaza = plazaChunk
          && Math.abs(wx - NETHER_ORIGIN.x) <= 12 && Math.abs(wz - NETHER_ORIGIN.z) <= 12;

        let floor = 34 + Math.floor((noise.hills.fbm2(wx * 0.035 + 9.1, wz * 0.035 - 3.7, 4, 2, 0.5) + 1) * 5);
        floor += Math.floor((noise.terrain.fbm2(wx * 0.011, wz * 0.011, 3, 2, 0.5) + 1) * 3);
        floor = clamp(floor, 27, 46);
        let ceiling = floor + 32 + Math.floor((noise.mountains.fbm2(wx * 0.02 - 4.4, wz * 0.02 + 8.2, 3, 2, 0.5) + 1) * 12);
        ceiling = clamp(ceiling, floor + 20, 108);
        if (inPlaza) {
          floor = 39;
          ceiling = 70;
        }
        heights[x + z * CHUNK_SIZE] = floor;

        for (let y = 0; y <= floor; y++) {
          let id = ID.netherrack;
          if (y === 0 || (y <= 2 && hash3i(wx, y, wz, this.seed ^ 0xb00b) < 0.6)) id = ID.bedrock;
          else if (y >= floor && hash3i(wx, y, wz, this.seed ^ 0x5311) < 0.055) id = 51; // soul sand
          else if (y >= floor - 2 && hash3i(wx, y, wz, this.seed ^ 0x9f31) < 0.02) id = 53; // magma
          else if (y < floor - 2 && hash3i(wx, y, wz, this.seed ^ 0x2ac1) < 0.006) id = 54; // quartz
          else if (y < floor - 4 && hash3i(wx, y, wz, this.seed ^ 0x77c3) < 0.0035) id = 16; // gold
          set(x, y, z, id);
        }

        // Lava sea fills the low parts of the cavern.
        const lavaLevel = 32;
        if (floor < lavaLevel) {
          for (let y = floor + 1; y <= lavaLevel; y++) set(x, y, z, ID.lava);
        } else if (!inPlaza && hash2i(wx, wz, this.seed ^ 0x4499) < 0.008) {
          set(x, floor, z, ID.lava);
        }

        // Roof: solid netherrack above the cavern ceiling.
        for (let y = ceiling; y < WORLD_HEIGHT; y++) {
          set(x, y, z, y === WORLD_HEIGHT - 1 ? ID.bedrock : ID.netherrack);
        }
        // Glowstone clusters hanging from the ceiling.
        if (!inPlaza && hash2i(wx, wz, this.seed ^ 0x6611) < 0.012) {
          const size = 1 + Math.floor(hash2i(wx + 3, wz - 5, this.seed) * 3);
          for (let i = 0; i < size; i++) set(x, ceiling - 1 - i, z, 29);
        }
        // Soul sand shores next to lava.
        if (floor <= lavaLevel + 1 && hash2i(wx, wz, this.seed ^ 0x1188) < 0.18) {
          set(x, floor, z, 51);
        }
      }
    }

    if (plazaChunk) this.buildNetherPlaza(blocks, baseX, baseZ);
    return { blocks, heights, biomes };
  }

  buildNetherPlaza(blocks, baseX, baseZ) {
    const setWorld = (wx, y, wz, id) => {
      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
      blocks[lx + (lz << 4) + (y << 8)] = id;
    };
    const ox = NETHER_ORIGIN.x;
    const oz = NETHER_ORIGIN.z;
    // Brick platform and ceiling clearance.
    for (let dz = -9; dz <= 9; dz++) {
      for (let dx = -9; dx <= 9; dx++) {
        const wx = ox + dx;
        const wz = oz + dz;
        setWorld(wx, 39, wz, Math.abs(dx) <= 2 && Math.abs(dz) <= 2 ? 52 : 50);
        for (let y = 40; y <= 70; y++) setWorld(wx, y, wz, 0);
        setWorld(wx, 71, wz, 50);
      }
    }
    // Nether brick arches.
    for (const dz of [-7, 7]) {
      for (let dx = -7; dx <= 7; dx++) {
        setWorld(ox + dx, 46, oz + dz, 52);
        setWorld(ox + dx, 47, oz + dz, 52);
      }
      for (const dx of [-7, 7]) {
        for (let y = 40; y <= 46; y++) setWorld(ox + dx, y, oz + dz, 52);
      }
    }
    // Portal frame on the x axis, plane normal along z.
    const px = ox - 1;
    const py = 40;
    for (let x = px - 1; x <= px + 2; x++) {
      setWorld(x, py - 1, oz, 25);
      setWorld(x, py + 3, oz, 25);
    }
    for (let y = py; y <= py + 2; y++) {
      setWorld(px - 1, y, oz, 25);
      setWorld(px + 2, y, oz, 25);
    }
    for (let x = px; x <= px + 1; x++) {
      for (let y = py; y <= py + 2; y++) setWorld(x, y, oz, 55);
    }
    // Boss dais in the south-east corner: a chequered brick floor with four
    // glowstone inlays that marks where the Nether lord wakes up.
    for (let dx = 5; dx <= 9; dx++) {
      for (let dz = -9; dz <= -5; dz++) {
        setWorld(ox + dx, 39, oz + dz, (dx + dz) % 2 === 0 ? 52 : 50);
      }
    }
    for (const [dx, dz] of [[5, -5], [9, -5], [5, -9], [9, -9]]) {
      setWorld(ox + dx, 39, oz + dz, 29);
    }
    // Glowstone lanterns around the platform.
    for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) {
      setWorld(ox + dx, 40, oz + dz, 25);
      setWorld(ox + dx, 41, oz + dz, 29);
    }
  }

  /* ------------------------------------------------------------------ */
  /* End                                                                 */
  /* ------------------------------------------------------------------ */

  generateEndChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    const heights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(BIOME.END);
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    const noise = this.noise;
    const set = (x, y, z, id) => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
      blocks[x + (z << 4) + (y << 8)] = id;
    };

    const plazaChunk = baseX <= END_ORIGIN.x + 24 && baseX + CHUNK_SIZE >= END_ORIGIN.x - 24
      && baseZ <= END_ORIGIN.z + 24 && baseZ + CHUNK_SIZE >= END_ORIGIN.z - 24;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const dx = wx - END_ORIGIN.x;
        const dz = wz - END_ORIGIN.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        let surface = -1;
        if (dist <= 74) {
          // Main island: gently rolling end stone with a flat central plaza.
          surface = 63 + Math.round((noise.hills.fbm2(wx * 0.03, wz * 0.03, 3, 2, 0.5)) * 3);
          surface -= Math.round(Math.max(0, dist - 48) * 0.35);
        } else {
          // Sparse outer islands in 48-block cells.
          const cellX = Math.floor(wx / 48);
          const cellZ = Math.floor(wz / 48);
          if (hash2i(cellX, cellZ, this.seed ^ 0xe4d1) < 0.22) {
            const centerX = cellX * 48 + 24;
            const centerZ = cellZ * 48 + 24;
            const r = Math.hypot(wx - centerX, wz - centerZ);
            if (r < 9) surface = 58 + Math.round((9 - r) * 0.5);
          }
        }

        const inPlaza = plazaChunk
          && Math.abs(wx - END_ORIGIN.x) <= 13 && Math.abs(wz - END_ORIGIN.z) <= 13;
        if (inPlaza) surface = 63;
        if (surface < 0) continue;
        heights[x + z * CHUNK_SIZE] = surface;

        const bottom = surface - 7;
        for (let y = bottom; y <= surface; y++) {
          let id = 56; // end stone
          if (y === surface && hash3i(wx, y, wz, this.seed ^ 0x51ee) < 0.03) id = 59; // purpur
          set(x, y, z, id);
        }
        // Purpur pillars on the main island.
        if (dist > 20 && dist < 70 && hash2i(wx, wz, this.seed ^ 0x9a11) < 0.004) {
          const height = 3 + Math.floor(hash2i(wx + 5, wz - 2, this.seed) * 5);
          for (let i = 1; i <= height; i++) set(x, surface + i, z, 59);
        }
      }
    }

    if (plazaChunk) this.buildEndPlaza(blocks, baseX, baseZ);
    return { blocks, heights, biomes };
  }

  buildEndPlaza(blocks, baseX, baseZ) {
    const setWorld = (wx, y, wz, id) => {
      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
      blocks[lx + (lz << 4) + (y << 8)] = id;
    };
    const ox = END_ORIGIN.x;
    const oz = END_ORIGIN.z;
    for (let dz = -12; dz <= 12; dz++) {
      for (let dx = -12; dx <= 12; dx++) {
        const wx = ox + dx;
        const wz = oz + dz;
        setWorld(wx, 63, wz, 56);
        for (let y = 64; y <= 80; y++) setWorld(wx, y, wz, 0);
      }
    }
    // Purple pillars marking the gateway.
    for (const [dx, dz] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) {
      for (let y = 64; y <= 70; y++) setWorld(ox + dx, y, oz + dz, 59);
      setWorld(ox + dx, 71, oz + dz, 58);
    }
    // Return portal: end frame ring with an active portal surface.
    const px = ox - 1;
    const py = 64;
    for (let x = px - 1; x <= px + 2; x++) {
      setWorld(x, py - 1, oz, 57);
      setWorld(x, py + 3, oz, 57);
    }
    for (let y = py; y <= py + 2; y++) {
      setWorld(px - 1, y, oz, 57);
      setWorld(px + 2, y, oz, 57);
    }
    for (let x = px; x <= px + 1; x++) {
      for (let y = py; y <= py + 2; y++) setWorld(x, y, oz, 58);
    }
  }

  placeTree(blocks, cx, cz, wx, height, wz, type, set, get) {
    const localX = wx - cx * CHUNK_SIZE;
    const localZ = wz - cz * CHUNK_SIZE;
    const inChunk = localX >= 0 && localX < CHUNK_SIZE && localZ >= 0 && localZ < CHUNK_SIZE;
    const seed = this.seed;
    const random = hash2i(wx, wz, seed ^ 0x51a3);
    let trunkHeight = 4 + Math.floor(random * 3);
    if (type === 'birch') trunkHeight = 5 + Math.floor(random * 3);
    if (type === 'spruce') trunkHeight = 6 + Math.floor(random * 4);

    const trunk = type === 'birch' ? 34 : type === 'spruce' ? 36 : 6;
    const leaves = type === 'birch' ? 35 : type === 'spruce' ? 37 : 7;

    if (inChunk) {
      const base = get(localX, height, localZ);
      if (base === ID.air || base === ID.water || base === ID.ice) return;
    }

    for (let y = 1; y <= trunkHeight; y++) {
      if (inChunk) {
        const existing = get(localX, height + y, localZ);
        if (existing === 0 || existing === leaves) set(localX, height + y, localZ, trunk);
      }
    }

    if (type === 'spruce') {
      // Tiered pine: the lower trunk stays bare and the crown narrows upward.
      // Wide 5x5 tiers alternate with narrow 3x3 tiers; near the tip only the
      // narrow ones remain, so the silhouette reads as a layered cone.
      const crownStart = Math.max(3, trunkHeight - 4);
      const crownEnd = trunkHeight + 1;
      const span = Math.max(1, crownEnd - crownStart);
      for (let layer = crownStart; layer <= crownEnd; layer++) {
        const y = height + layer;
        const tier = layer - crownStart;
        const radius = tier % 2 === 0 && tier / span < 0.6 ? 2 : 1;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) {
              if (hash3i(wx + dx, y, wz + dz, seed ^ 0x991) < 0.45) continue;
            }
            if (dx === 0 && dz === 0 && layer <= trunkHeight) continue;
            this.setIfAirOrLeaves(blocks, cx, cz, wx + dx, y, wz + dz, leaves);
          }
        }
      }
    } else {
      // Oak and birch: a compact crown near the top of the trunk. Two wide
      // 5x5 layers sit below two 3x3 layers, so short trees keep a visible
      // trunk instead of turning into a leaf box on the ground.
      const top = height + trunkHeight;
      for (let layer = -2; layer <= 1; layer++) {
        const y = top + layer;
        const radius = layer >= 0 ? 1 : 2;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (Math.abs(dx) === radius && Math.abs(dz) === radius) {
              if (hash3i(wx + dx, y, wz + dz, seed ^ 0x443) < 0.55) continue;
            }
            if (dx === 0 && dz === 0 && layer < 1) continue;
            this.setIfAirOrLeaves(blocks, cx, cz, wx + dx, y, wz + dz, leaves);
          }
        }
      }
      this.setIfAirOrLeaves(blocks, cx, cz, wx, top + 1, wz, leaves);
    }
  }

  setIfAirOrLeaves(blocks, cx, cz, wx, y, wz, id) {
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    const index = lx + (lz << 4) + (y << 8);
    const existing = blocks[index];
    if (existing === 0 || existing === 7 || existing === 35 || existing === 37) blocks[index] = id;
  }
}

export function getGenerator(seed) {
  const key = seed >>> 0;
  let generator = generatorCache.get(key);
  if (!generator) {
    generator = new WorldGenerator(key);
    if (generatorCache.size > 8) generatorCache.clear();
    generatorCache.set(key, generator);
  }
  return generator;
}

export function generateChunk(cx, cz, seed) {
  return getGenerator(seed).generateChunk(cx, cz);
}

export function findSpawn(seed) {
  return getGenerator(seed).findSpawn();
}

/** Village centres near a world position, used to place villagers. */
export function nearbyVillages(x, z, seed) {
  const generator = getGenerator(seed);
  const cellX = Math.floor(x / VILLAGE_CELL);
  const cellZ = Math.floor(z / VILLAGE_CELL);
  const result = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const village = generator.villageAtCell(cellX + dx, cellZ + dz);
      if (!village) continue;
      if (Math.abs(village.x - x) > 220 || Math.abs(village.z - z) > 220) continue;
      result.push(village);
    }
  }
  return result;
}
