/** Presets for the character creator. Colors are plain hex numbers so Three.js
 *  and the DOM swatches can share the same definitions. */

export const SKIN_TONES = [
  { id: 'light', name: 'Светлая', color: 0xf2c9a4 },
  { id: 'fair', name: 'Естественная', color: 0xd9a178 },
  { id: 'tan', name: 'Смуглая', color: 0xb77a4e },
  { id: 'dark', name: 'Тёмная', color: 0x7b4a2c },
];

export const OUTFITS = [
  { id: 'blue', name: 'Синий', shirt: 0x3f8fd0, pants: 0x354789, accent: 0x9fd0ec },
  { id: 'green', name: 'Лесной', shirt: 0x4f9154, pants: 0x4c4436, accent: 0xb8d28d },
  { id: 'red', name: 'Красный', shirt: 0xb4443e, pants: 0x3a3540, accent: 0xe8b36a },
  { id: 'purple', name: 'Фиолетовый', shirt: 0x7755a8, pants: 0x3b3154, accent: 0xc2a5e8 },
  { id: 'sand', name: 'Песочный', shirt: 0xc7a66b, pants: 0x6d5b3f, accent: 0xf0dcaf },
  { id: 'charcoal', name: 'Угольный', shirt: 0x4b5560, pants: 0x2c3138, accent: 0x8c99a6 },
];

export const HAIR_STYLES = [
  { id: 'short', name: 'Короткая' },
  { id: 'buzz', name: 'Ёжик' },
  { id: 'long', name: 'Длинная' },
  { id: 'ponytail', name: 'Хвост' },
  { id: 'bald', name: 'Лысый' },
];

export const HAIR_COLORS = [
  { id: 'black', name: 'Чёрный', color: 0x241b16 },
  { id: 'brown', name: 'Каштановый', color: 0x3a2a1e },
  { id: 'blond', name: 'Русый', color: 0xb99052 },
  { id: 'red', name: 'Рыжий', color: 0x9c4f28 },
  { id: 'gray', name: 'Седой', color: 0x9aa1a8 },
];

export const DEFAULT_APPEARANCE = Object.freeze({
  name: 'Игрок',
  outfit: 'blue',
  skin: 'fair',
  hairStyle: 'short',
  hairColor: 'brown',
});

const APPEARANCE_KEY = 'voxelcraft:character';

function pick(list, id, fallback) {
  return list.find((entry) => entry.id === id) ?? fallback;
}

/** Turns a saved/networked appearance into a complete, safe preset. */
export function normalizeAppearance(value = {}) {
  const outfit = pick(OUTFITS, value?.outfit, OUTFITS[0]);
  const skin = pick(SKIN_TONES, value?.skin, SKIN_TONES[1]);
  const style = pick(HAIR_STYLES, value?.hairStyle, HAIR_STYLES[0]);
  const hair = pick(HAIR_COLORS, value?.hairColor, HAIR_COLORS[2]);
  const rawName = typeof value?.name === 'string' ? value.name.trim() : '';
  return {
    name: rawName ? rawName.slice(0, 32) : DEFAULT_APPEARANCE.name,
    outfit: outfit.id,
    skin: skin.id,
    hairStyle: style.id,
    hairColor: hair.id,
    shirt: outfit.shirt,
    pants: outfit.pants,
    accent: outfit.accent,
    skinTone: skin.color,
    hairTint: hair.color,
  };
}

export function loadAppearance() {
  if (typeof localStorage === 'undefined') return normalizeAppearance(DEFAULT_APPEARANCE);
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) || 'null'));
  } catch {
    return normalizeAppearance(DEFAULT_APPEARANCE);
  }
}

export function saveAppearance(appearance) {
  const value = normalizeAppearance(appearance);
  if (typeof localStorage === 'undefined') return value;
  const stored = {
    name: value.name,
    outfit: value.outfit,
    skin: value.skin,
    hairStyle: value.hairStyle,
    hairColor: value.hairColor,
  };
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(stored));
  } catch {
    // Storage can be unavailable in private mode; the in-memory value still applies.
  }
  return value;
}

export function hexColor(color) {
  return `#${Number(color).toString(16).padStart(6, '0')}`;
}
