export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 256;
export const SEA_LEVEL = 62;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

export const PAD_X = CHUNK_SIZE + 2;
export const PAD_Z = CHUNK_SIZE + 2;
export const PAD_Y = WORLD_HEIGHT + 2;
export const PAD_VOLUME = PAD_X * PAD_Y * PAD_Z;

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;
export const PLAYER_REACH = 6;
export const GRAVITY = 32;
export const TERMINAL_VELOCITY = 78.4;
export const JUMP_VELOCITY = 9.0;
export const WALK_SPEED = 4.317;
export const SPRINT_SPEED = 5.8;
export const SNEAK_SPEED = 1.35;
export const SWIM_SPEED = 2.2;
export const FLY_SPEED = 10.9;
export const WATER_LEVEL = SEA_LEVEL;

// The sun travels in the vertical plane spanned by (SUN_AXIS_X, Y, SUN_AXIS_Z),
// so its horizontal direction is always either +axis or -axis. The mesher bakes
// one terrain horizon per direction, which is all the shader needs to know
// whether terrain blocks the sun at the current time.
export const SUN_AXIS_X = 0.55;
export const SUN_AXIS_Z = 0.35;

export const DAY_LENGTH = 1200; // legacy full-cycle length; new saves use dayCycle.js
export const DEFAULT_RENDER_DISTANCE = 5;
export const MAX_RENDER_DISTANCE = 12;

export const SAVE_VERSION = 3;

export const blockKey = (x, y, z) => `${x},${y},${z}`;
export const chunkKey = (cx, cz) => `${cx},${cz}`;
