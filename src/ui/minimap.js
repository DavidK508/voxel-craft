export const MAP_SIZE = 176;
export const MAP_RADIUS = 96;

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
