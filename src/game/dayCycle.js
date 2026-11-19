// One Minecraft-style day is 24 000 ticks: ticks 0..12 000 are daytime,
// 12 000..24 000 are night. `timeOfDay` 0 is sunrise (06:00).
export const TICKS_PER_DAY = 24000;
export const DAY_TICKS = TICKS_PER_DAY / 2;

export const MIN_DAY_MINUTES = 1;
export const MAX_DAY_MINUTES = 60;
export const DEFAULT_DAY_MINUTES = 10;
export const DEFAULT_NIGHT_MINUTES = 10;

export function normalizeDayMinutes(value, fallback = DEFAULT_DAY_MINUTES) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(MIN_DAY_MINUTES, Math.min(MAX_DAY_MINUTES, number));
}

/**
 * A single slider controls both halves of the cycle: daytime and nighttime
 * always keep the same length and therefore change together.
 */
export function cycleDurations(value, fallback = DEFAULT_DAY_MINUTES) {
  const minutes = normalizeDayMinutes(value, fallback);
  return { dayMinutes: minutes, nightMinutes: minutes };
}

export function isDaytime(timeOfDay) {
  const time = ((Number(timeOfDay) || 0) % TICKS_PER_DAY + TICKS_PER_DAY) % TICKS_PER_DAY;
  return time < DAY_TICKS;
}

/**
 * Advances the world clock with independent daytime and nighttime lengths.
 * `dayMinutes`/`nightMinutes` are real minutes for each half of the cycle, so
 * a 10/20 pair gives a 10-minute day followed by a 20-minute night.
 */
export function advanceTimeOfDay(timeOfDay, dt, dayMinutes, nightMinutes) {
  if (!Number.isFinite(dt) || dt <= 0) return timeOfDay;
  const daySeconds = normalizeDayMinutes(dayMinutes, DEFAULT_DAY_MINUTES) * 60;
  const nightSeconds = normalizeDayMinutes(nightMinutes, DEFAULT_NIGHT_MINUTES) * 60;
  const time = ((Number(timeOfDay) || 0) % TICKS_PER_DAY + TICKS_PER_DAY) % TICKS_PER_DAY;
  const rate = time < DAY_TICKS ? DAY_TICKS / daySeconds : DAY_TICKS / nightSeconds;
  return (time + dt * rate) % TICKS_PER_DAY;
}
