export const GAME_MODE_SURVIVAL = 'survival';
export const GAME_MODE_CREATIVE = 'creative';

export const GAME_MODES = Object.freeze([GAME_MODE_SURVIVAL, GAME_MODE_CREATIVE]);

export const GAME_MODE_LABELS = Object.freeze({
  [GAME_MODE_SURVIVAL]: 'Выживание',
  [GAME_MODE_CREATIVE]: 'Креатив',
});

export function normalizeGameMode(value) {
  return value === GAME_MODE_CREATIVE ? GAME_MODE_CREATIVE : GAME_MODE_SURVIVAL;
}
