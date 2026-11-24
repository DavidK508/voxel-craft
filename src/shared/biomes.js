/**
 * Shared biome data.
 *
 * Generation used to own the biome table, but the renderer and the mob AI also
 * need to know what a biome looks and feels like. Keeping one frozen registry
 * here avoids circular imports between the generator, mesher and game loop.
 *
 * Colours are linear multipliers applied to the matching atlas tiles, not
 * replacements for the textures. `fog`/`sky` are sRGB hex values.
 */
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

const DEFAULT_TINT = [1, 1, 1];

const info = {
  0: {
    name: 'Океан', category: 'ocean', tree: null, density: 0,
    surface: 'sand', subsurface: 'sand', weather: 'rain',
    grassTint: [0.55, 0.85, 0.75], leavesTint: [0.55, 0.85, 0.8], waterTint: [0.6, 0.85, 1.12],
    fog: 0x8ab8d2, skyTop: 0x3a7fb4, skyHorizon: 0xa4c9dd,
    groundCover: [],
  },
  1: {
    name: 'Пляж', category: 'beach', tree: null, density: 0,
    surface: 'sand', subsurface: 'sand', weather: 'rain',
    grassTint: [0.95, 1.02, 0.62], leavesTint: [0.8, 1, 0.65], waterTint: [0.82, 0.98, 1.08],
    fog: 0xb6d7dc, skyTop: 0x4690c6, skyHorizon: 0xb9dce3,
    groundCover: [],
  },
  2: {
    name: 'Равнины', category: 'plains', tree: 'oak', density: 0.004,
    surface: 'grass', subsurface: 'dirt', weather: 'rain',
    grassTint: [0.78, 1.1, 0.52], leavesTint: [0.68, 1.05, 0.5], waterTint: [0.88, 0.97, 1.05],
    fog: 0xa9d5ea, skyTop: 0x3a83c7, skyHorizon: 0xa9d5ea,
    groundCover: [[201, 0.07], [202, 0.012], [203, 0.008]],
  },
  3: {
    name: 'Лес', category: 'forest', tree: 'oak', density: 0.021,
    surface: 'grass', subsurface: 'dirt', weather: 'rain',
    grassTint: [0.56, 0.95, 0.42], leavesTint: [0.48, 0.92, 0.38], waterTint: [0.75, 0.92, 1],
    fog: 0x8fb9ad, skyTop: 0x3676ad, skyHorizon: 0x9dc7c4,
    groundCover: [[201, 0.04], [203, 0.009], [202, 0.004]],
  },
  4: {
    name: 'Пустыня', category: 'desert', tree: null, density: 0,
    surface: 'sand', subsurface: 'sandstone', weather: 'none',
    grassTint: [1.08, 0.95, 0.52], leavesTint: [1, 0.87, 0.45], waterTint: [0.95, 0.9, 0.8],
    fog: 0xe8cf8f, skyTop: 0x6ba9d1, skyHorizon: 0xe8d7a6,
    groundCover: [[204, 0.014]],
  },
  5: {
    name: 'Снежные поля', category: 'snowy', tree: 'spruce', density: 0.008,
    surface: 'snow', subsurface: 'dirt', weather: 'snow',
    grassTint: [0.76, 0.88, 0.82], leavesTint: [0.55, 0.8, 0.72], waterTint: [0.78, 0.92, 1.1],
    fog: 0xd4e5ee, skyTop: 0x5a8cb5, skyHorizon: 0xd6e6ee,
    groundCover: [[204, 0.008]],
  },
  6: {
    name: 'Горы', category: 'mountains', tree: 'spruce', density: 0.002,
    surface: 'stone', subsurface: 'stone', weather: 'snow',
    grassTint: [0.65, 0.9, 0.6], leavesTint: [0.52, 0.78, 0.6], waterTint: [0.75, 0.9, 1.08],
    fog: 0xb7c8d3, skyTop: 0x4a80b0, skyHorizon: 0xb8cbd8,
    groundCover: [[201, 0.012], [204, 0.006]],
  },
  7: {
    name: 'Болото', category: 'swamp', tree: 'oak', density: 0.009,
    surface: 'grass', subsurface: 'dirt', weather: 'rain',
    grassTint: [0.54, 0.78, 0.38], leavesTint: [0.42, 0.68, 0.34], waterTint: [0.48, 0.68, 0.48],
    fog: 0x94a886, skyTop: 0x4a6f78, skyHorizon: 0xa4b48f,
    groundCover: [[201, 0.06], [204, 0.014]],
  },
  8: {
    name: 'Берёзовый лес', category: 'birch', tree: 'birch', density: 0.018,
    surface: 'grass', subsurface: 'dirt', weather: 'rain',
    grassTint: [0.8, 1.08, 0.5], leavesTint: [0.72, 1.1, 0.44], waterTint: [0.86, 0.98, 1.02],
    fog: 0xb2d3c2, skyTop: 0x3f88bb, skyHorizon: 0xb3d8ca,
    groundCover: [[201, 0.05], [202, 0.018], [203, 0.005]],
  },
  9: {
    name: 'Тайга', category: 'taiga', tree: 'spruce', density: 0.014,
    surface: 'grass', subsurface: 'dirt', weather: 'snow',
    grassTint: [0.5, 0.84, 0.48], leavesTint: [0.4, 0.72, 0.48], waterTint: [0.7, 0.86, 1.05],
    fog: 0xa7c0bd, skyTop: 0x43799f, skyHorizon: 0xa9c3bd,
    groundCover: [[201, 0.025], [204, 0.01]],
  },
  10: {
    name: 'Ад', category: 'nether', tree: null, density: 0,
    surface: 'netherrack', subsurface: 'netherrack', weather: 'none',
    grassTint: DEFAULT_TINT, leavesTint: DEFAULT_TINT, waterTint: [1.2, 0.6, 0.5],
    fog: 0x57150a, skyTop: 0x2b0a06, skyHorizon: 0x6b1d0e,
    groundCover: [],
  },
  11: {
    name: 'Край', category: 'end', tree: null, density: 0,
    surface: 'end_stone', subsurface: 'end_stone', weather: 'none',
    grassTint: DEFAULT_TINT, leavesTint: DEFAULT_TINT, waterTint: [0.9, 0.7, 1.2],
    fog: 0x241236, skyTop: 0x120820, skyHorizon: 0x2a1640,
    groundCover: [],
  },
};

/** Frozen biome registry with stable numeric keys. */
export const BIOME_INFO = Object.freeze(Object.fromEntries(
  Object.entries(info).map(([id, value]) => [id, Object.freeze({
    ...value,
    grassTint: Object.freeze(value.grassTint),
    leavesTint: Object.freeze(value.leavesTint),
    waterTint: Object.freeze(value.waterTint),
    groundCover: Object.freeze(value.groundCover.map((entry) => Object.freeze(entry))),
  })]),
));

/** Returns biome info, falling back to plains for unknown/corrupt ids. */
export function getBiomeInfo(id) {
  return BIOME_INFO[id] ?? BIOME_INFO[BIOME.PLAINS];
}

/** Weathers that actually place particles in the world. */
export function biomeWeather(id) {
  return getBiomeInfo(id).weather;
}
