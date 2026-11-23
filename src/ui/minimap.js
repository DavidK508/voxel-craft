import { SEA_LEVEL } from '../shared/constants.js';
import { WATER_BLOCK_ID, isWaterBlock } from '../shared/water.js';
import { BIOME } from '../world/generator.js';

export const MAP_SIZE = 176;
export const MAP_RADIUS = 96;
export const TERRAIN_SAMPLE_SIZE = 96;
export const TERRAIN_STEP = 2;

const MARKER_COLORS = [
  '#ffcf6b', '#7ac7ff', '#ff94c2', '#9ee08a', '#c9a6ff', '#ffab6b', '#6be0d0',
];

/** Accepts a saved/networked point and returns only the coordinates the map needs. */
export function normalizeMapPoint(point) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.z))) return null;
  return {
    x: Number(point.x),
    y: Number(point.y ?? 0),
    z: Number(point.z),
  };
}

/** Deterministic colour for a player so their markers match the online list. */
export function playerColor(id, index = 0) {
  const text = String(id ?? index);
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  if (hash === 0) hash = index + 1;
  return MARKER_COLORS[Math.abs(hash) % MARKER_COLORS.length];
}

/**
 * Converts a world position to canvas pixels. North (-Z) is up and the player
 * stays in the centre. Markers outside the visible radius are pinned to the
 * edge so their direction is still readable.
 */
export function projectPoint(point, center, size = MAP_SIZE, radius = MAP_RADIUS) {
  const half = size / 2;
  const scale = half / radius;
  let x = half + (point.x - center.x) * scale;
  let y = half + (point.z - center.z) * scale;
  const dx = x - half;
  const dy = y - half;
  const distance = Math.hypot(dx, dy);
  const limit = half - 10;
  const clamped = distance > limit;
  if (clamped) {
    const factor = limit / distance;
    x = half + dx * factor;
    y = half + dy * factor;
  }
  return { x, y, clamped };
}

const BIOME_COLORS = {
  [BIOME.OCEAN]: [40, 92, 136],
  [BIOME.BEACH]: [214, 196, 138],
  [BIOME.PLAINS]: [108, 160, 90],
  [BIOME.FOREST]: [62, 118, 70],
  [BIOME.DESERT]: [220, 192, 122],
  [BIOME.SNOWY]: [226, 234, 238],
  [BIOME.MOUNTAINS]: [132, 130, 126],
  [BIOME.SWAMP]: [84, 110, 80],
  [BIOME.BIRCH_FOREST]: [134, 168, 106],
  [BIOME.TAIGA]: [74, 112, 90],
  [BIOME.NETHER]: [128, 44, 44],
  [BIOME.END]: [122, 92, 156],
};

const clampChannel = (value) => Math.max(0, Math.min(255, value));
const mix = (a, b, t) => a + (b - a) * t;

/** Map colour of one column, shaded by height and water depth. */
export function terrainColorAt(biomeId, height = SEA_LEVEL, surfaceId = 0) {
  if (isWaterBlock(surfaceId)) {
    const depth = Math.max(0, SEA_LEVEL - height);
    const t = Math.min(1, depth / 12);
    return [
      mix(78, 24, t),
      mix(172, 72, t),
      mix(202, 126, t),
    ].map(Math.round);
  }
  const base = BIOME_COLORS[biomeId] ?? BIOME_COLORS[BIOME.PLAINS];
  const shade = 0.86 + Math.max(-0.16, Math.min(0.34, (height - SEA_LEVEL) / 100));
  return base.map((channel) => Math.round(clampChannel(channel * shade)));
}

/**
 * Samples the loaded world into an RGBA buffer. The HUD scales it up without
 * smoothing, so one pixel represents TERRAIN_STEP blocks.
 */
export function sampleTerrain(
  world,
  center,
  size = TERRAIN_SAMPLE_SIZE,
  radius = MAP_RADIUS,
  step = TERRAIN_STEP,
) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) {
    const wz = Math.floor(center.z - radius + py * step);
    for (let px = 0; px < size; px++) {
      const wx = Math.floor(center.x - radius + px * step);
      const height = world?.getHeightAt?.(wx, wz);
      const offset = (py * size + px) * 4;
      if (height == null) {
        pixels[offset] = 10;
        pixels[offset + 1] = 16;
        pixels[offset + 2] = 20;
        pixels[offset + 3] = 255;
        continue;
      }
      const biome = world.getBiomeIdAt?.(wx, wz);
      const top = world.getBlock?.(wx, SEA_LEVEL, wz) ?? 0;
      const justAbove = world.getBlock?.(wx, height + 1, wz) ?? 0;
      const surface = isWaterBlock(top) || isWaterBlock(justAbove)
        ? WATER_BLOCK_ID
        : world.getBlock?.(wx, height, wz) ?? 0;
      const [r, g, b] = terrainColorAt(biome, height, surface);
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

/** Builds the marker list shown on the minimap from the current game state. */
export function mapMarkers(state) {
  const markers = [];
  const spawn = normalizeMapPoint(state?.spawn);
  if (spawn) markers.push({ type: 'spawn', ...spawn, label: 'Спавн', color: '#8be08a' });

  const death = normalizeMapPoint(state?.lastDeath);
  if (death) markers.push({ type: 'death', ...death, label: 'Смерть', color: '#ff6b6b' });

  const players = Array.isArray(state?.players) ? state.players : [];
  players.forEach((player, index) => {
    const color = player.color || playerColor(player.id ?? index, index);
    const name = player.name || 'Игрок';
    const remoteSpawn = normalizeMapPoint(player.spawn);
    if (remoteSpawn) {
      markers.push({ type: 'spawn', ...remoteSpawn, label: name, color, remote: true });
    }
    const remoteDeath = normalizeMapPoint(player.lastDeath);
    if (remoteDeath) {
      markers.push({ type: 'death', ...remoteDeath, label: name, color, remote: true });
    }
    const position = normalizeMapPoint(player);
    if (position) {
      markers.push({ type: 'player', ...position, label: name, color });
    }
  });
  return markers;
}
