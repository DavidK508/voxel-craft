import { WORLD_HEIGHT } from '../shared/constants.js';
import {
  FACING_OFFSETS,
  decodeState,
  getBlock,
  getBlockItemId,
  getDoorId,
  getLampId,
  getRepeaterId,
} from '../shared/blocks.js';

const key = (x, y, z) => `${x},${y},${z}`;
const SCAN_INTERVAL = 0.4;
const SCAN_CHUNKS = 2;
const SCAN_Y_BELOW = 10;
const SCAN_Y_ABOVE = 26;
const BUTTON_PULSE = 1.4;

/**
 * Host-side Redstone simulation.
 *
 * Signal sources are searched in the loaded chunks near the player. Redstone
 * wire carries a strength that decays by one per block, repeaters restore it
 * to 15 after a configurable delay, and doors, lamps and pistons consume the
 * signal. All device states live in the block ids, so no extra save migration
 * is needed: only timers and moved piston blocks are serialized.
 */
export class RedstoneSimulation {
  constructor(world, options = {}) {
    this.world = world;
    this.setBlock = options.setBlock ?? ((x, y, z, id) => world.setBlock(x, y, z, id));
    this.isHost = options.isHost ?? (() => true);
    this.getPlayer = options.getPlayer ?? (() => null);
    this.getEntities = options.getEntities ?? (() => []);
    this.onStateChange = options.onStateChange ?? null;

    this.sources = [];
    this.wires = [];
    this.consumers = [];
    this.wirePower = new Map();
    this.lastPower = new Map();
    this.pulses = new Map();
    this.repeaterTimers = new Map();
    this.pistonMoves = new Map();
    this.scanTimer = 0;
    this.dirty = true;
  }

  /** Called whenever a block changes so the next update recomputes immediately. */
  notify(x, y, z) {
    this.scanTimer = SCAN_INTERVAL;
    this.dirty = true;
    void x; void y; void z;
  }

  /* ------------------------------------------------------------------ */
  /* Discovery                                                           */
  /* ------------------------------------------------------------------ */

  scan() {
    this.sources = [];
    this.wires = [];
    this.consumers = [];
    this.dirty = false;

    const player = this.getPlayer();
    if (!player) return;
    const cx = Math.floor(player.position.x / 16);
    const cz = Math.floor(player.position.z / 16);
    const py = Math.floor(player.position.y);
    const minY = Math.max(0, py - SCAN_Y_BELOW);
    const maxY = Math.min(WORLD_HEIGHT - 1, py + SCAN_Y_ABOVE);

    for (let dz = -SCAN_CHUNKS; dz <= SCAN_CHUNKS; dz++) {
      for (let dx = -SCAN_CHUNKS; dx <= SCAN_CHUNKS; dx++) {
        const chunk = this.world.chunks.get(`${cx + dx},${cz + dz}`);
        if (!chunk?.blocks) continue;
        for (let y = minY; y <= maxY; y++) {
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              const wx = chunk.cx * 16 + x;
              const wz = chunk.cz * 16 + z;
              const id = chunk.blocks[x + (z << 4) + (y << 8)];
              if (!id) continue;
              const state = decodeState(id);
              const block = getBlock(id);
              const pos = { x: wx, y, z: wz };
              if (block.redstoneSource || state?.type === 'lever'
                || state?.type === 'button' || state?.type === 'plate') {
                this.sources.push(pos);
              } else if (state?.type === 'repeater') {
                this.consumers.push(pos);
                if (state.powered) this.sources.push(pos);
              } else if (state?.type === 'wire') {
                this.wires.push(pos);
              } else if (state?.type === 'door' || state?.type === 'lamp'
                || state?.type === 'piston') {
                this.consumers.push(pos);
              }
            }
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Signal propagation                                                  */
  /* ------------------------------------------------------------------ */

  isWire(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    return decodeState(this.world.getBlock(x, y, z))?.type === 'wire';
  }

  computeWirePower() {
    const power = new Map();
    const queue = [];
    const seed = (x, y, z, strength) => {
      const k = key(x, y, z);
      if ((power.get(k) ?? 0) >= strength) return;
      power.set(k, strength);
      queue.push({ x, y, z });
    };

    for (const source of this.sources) {
      let strength = 15;
      const state = decodeState(this.world.getBlock(source.x, source.y, source.z));
      if (state?.type === 'lever' && !state.powered) continue;
      if (state?.type === 'button' && !state.pressed) continue;
      if (state?.type === 'plate' && !state.powered) continue;
      if (state?.type === 'repeater' && !state.powered) continue;
      for (const d of FACING_OFFSETS) {
        const nx = source.x + d.x;
        const ny = source.y + d.y;
        const nz = source.z + d.z;
        if (this.isWire(nx, ny, nz)) seed(nx, ny, nz, strength);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const value = power.get(key(cur.x, cur.y, cur.z));
      if (value <= 1) continue;
      for (const d of FACING_OFFSETS) {
        const nx = cur.x + d.x;
        const ny = cur.y + d.y;
        const nz = cur.z + d.z;
        if (!this.isWire(nx, ny, nz)) continue;
        if (value - 1 > (power.get(key(nx, ny, nz)) ?? 0)) seed(nx, ny, nz, value - 1);
      }
    }
    this.wirePower = power;
  }

  /** Returns the strongest signal reaching a block from an adjacent cell. */
  powerAt(x, y, z) {
    let best = 0;
    for (const d of FACING_OFFSETS) {
      const nx = x + d.x;
      const ny = y + d.y;
      const nz = z + d.z;
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      const id = this.world.getBlock(nx, ny, nz);
      const state = decodeState(id);
      const block = getBlock(id);
      if (block.redstoneSource) return 15;
      if (state?.type === 'wire') {
        best = Math.max(best, this.wirePower.get(key(nx, ny, nz)) ?? 0);
      } else if (state?.type === 'lever' && state.powered) {
        best = Math.max(best, 15);
      } else if (state?.type === 'button' && state.pressed) {
        best = Math.max(best, 15);
      } else if (state?.type === 'plate' && state.powered) {
        best = Math.max(best, 15);
      } else if (state?.type === 'repeater' && state.powered) {
        best = Math.max(best, 15);
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* Timed devices                                                       */
  /* ------------------------------------------------------------------ */

  updateTimers(dt) {
    for (const [k, timer] of [...this.pulses]) {
      timer.remaining -= dt;
      if (timer.remaining > 0) continue;
      this.pulses.delete(k);
      const { x, y, z, facing } = timer;
      const current = decodeState(this.world.getBlock(x, y, z));
      if (current?.type === 'button') this.setBlock(x, y, z, 105 + facing * 2);
    }

    for (const [k, timer] of [...this.repeaterTimers]) {
      timer.remaining -= dt;
      if (timer.remaining > 0) continue;
      this.repeaterTimers.delete(k);
      const { x, y, z, facing, delay } = timer;
      const current = decodeState(this.world.getBlock(x, y, z));
      if (current?.type !== 'repeater') continue;
      const next = getRepeaterId(facing, true, delay);
      if (this.world.getBlock(x, y, z) !== next) {
        this.setBlock(x, y, z, next);
        this.notify(x, y, z);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Pressure plates                                                     */
  /* ------------------------------------------------------------------ */

  updatePlates() {
    const actors = [];
    const player = this.getPlayer();
    if (player && !player.dead) actors.push(player);
    for (const entity of this.getEntities()) {
      if (entity?.position) actors.push(entity);
    }

    for (const pos of this.sources) {
      const state = decodeState(this.world.getBlock(pos.x, pos.y, pos.z));
      if (state?.type !== 'plate') continue;
      let pressed = false;
      for (const actor of actors) {
        const p = actor.position;
        if (!p) continue;
        if (Math.floor(p.x) === pos.x && Math.floor(p.z) === pos.z
          && Math.floor(p.y + 0.05) >= pos.y && Math.floor(p.y + 0.05) <= pos.y + 1) {
          pressed = true;
          break;
        }
      }
      const currentId = this.world.getBlock(pos.x, pos.y, pos.z);
      const nextId = 113 + (pressed ? 1 : 0);
      if (currentId !== nextId) {
        this.setBlock(pos.x, pos.y, pos.z, nextId);
        this.notify(pos.x, pos.y, pos.z);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Consumers                                                           */
  /* ------------------------------------------------------------------ */

  updateConsumers() {
    for (const pos of this.consumers) {
      const currentId = this.world.getBlock(pos.x, pos.y, pos.z);
      const state = decodeState(currentId);
      if (!state) continue;
      if (state.type === 'repeater') {
        this.updateRepeater(pos, state);
      } else if (state.type === 'door') {
        this.updateDoor(pos, state, currentId);
      } else if (state.type === 'lamp') {
        const lit = this.powerAt(pos.x, pos.y, pos.z) > 0;
        const nextId = getLampId(lit);
        if (currentId !== nextId) this.setBlock(pos.x, pos.y, pos.z, nextId);
      } else if (state.type === 'piston') {
        this.updatePiston(pos, state, currentId);
      }
    }
  }

  updateRepeater(pos, state) {
    const k = key(pos.x, pos.y, pos.z);
    // Input is on the side opposite the facing direction.
    const d = FACING_OFFSETS[state.facing];
    const powered = this.powerAt(pos.x - d.x, pos.y - d.y, pos.z - d.z) > 0;
    if (!powered) {
      this.repeaterTimers.delete(k);
      if (state.powered) {
        this.setBlock(pos.x, pos.y, pos.z, getRepeaterId(state.facing, false, state.delay));
        this.notify(pos.x, pos.y, pos.z);
      }
      return;
    }
    if (state.powered) {
      this.repeaterTimers.delete(k);
      return;
    }
    if (!this.repeaterTimers.has(k)) {
      this.repeaterTimers.set(k, {
        x: pos.x, y: pos.y, z: pos.z,
        facing: state.facing,
        delay: state.delay,
        remaining: state.delay * 0.1,
      });
    }
  }

  updateDoor(pos, state) {
    // Both halves belong to one door: a signal reaching either half controls
    // the whole panel. The pair is tracked under the bottom half's key.
    const baseY = state.half ? pos.y - 1 : pos.y;
    const k = key(pos.x, baseY, pos.z);
    const powered = Math.max(
      this.powerAt(pos.x, baseY, pos.z),
      this.powerAt(pos.x, baseY + 1, pos.z),
    ) > 0;
    const previous = this.lastPower.get(k);
    this.lastPower.set(k, powered);
    if (previous === undefined || previous === powered) return;
    for (const half of [0, 1]) {
      const y = baseY + half;
      const id = this.world.getBlock(pos.x, y, pos.z);
      const halfState = decodeState(id);
      if (halfState?.type !== 'door') continue;
      const nextId = getDoorId(halfState.facing, powered, halfState.half);
      if (id !== nextId) this.setBlock(pos.x, y, pos.z, nextId);
    }
  }

  updatePiston(pos, state, currentId) {
    const k = key(pos.x, pos.y, pos.z);
    const powered = this.powerAt(pos.x, pos.y, pos.z) > 0;
    const previous = this.lastPower.get(k);
    this.lastPower.set(k, powered);
    if (previous === undefined || previous === powered) return;
    if (powered) this.extendPiston(pos, state, currentId);
    else this.retractPiston(pos, state, currentId);
  }

  frontOf(pos, facing) {
    const d = FACING_OFFSETS[facing];
    return { x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z };
  }

  extendPiston(pos, state, currentId) {
    const headPos = this.frontOf(pos, state.facing);
    const target = this.frontOf(headPos, state.facing);
    if (!this.world.isChunkLoadedAt(headPos.x, headPos.z)) return;
    if (!this.world.isChunkLoadedAt(target.x, target.z)) return;

    const headId = this.world.getBlock(headPos.x, headPos.y, headPos.z);
    if (headId !== 0) return;
    const movedId = this.world.getBlock(target.x, target.y, target.z);
    const movedBlock = getBlock(movedId);
    if (movedId !== 0 && (!movedBlock.pushable || movedBlock.fluid)) return;

    this.setBlock(headPos.x, headPos.y, headPos.z, 163 + state.facing);
    if (movedId !== 0) {
      const beyond = this.frontOf(target, state.facing);
      if (this.world.isChunkLoadedAt(beyond.x, beyond.z)
        && this.world.getBlock(beyond.x, beyond.y, beyond.z) === 0) {
        this.setBlock(beyond.x, beyond.y, beyond.z, movedId);
        this.setBlock(target.x, target.y, target.z, 0);
        this.pistonMoves.set(key(pos.x, pos.y, pos.z), {
          id: movedId,
          from: { ...target },
          to: { ...beyond },
        });
      } else {
        this.setBlock(headPos.x, headPos.y, headPos.z, 0);
        return;
      }
    }
    this.setBlock(pos.x, pos.y, pos.z, currentId + 1);
    this.notify(pos.x, pos.y, pos.z);
  }

  retractPiston(pos, state, currentId) {
    const headPos = this.frontOf(pos, state.facing);
    const move = this.pistonMoves.get(key(pos.x, pos.y, pos.z));
    if (move) {
      if (this.world.getBlock(move.to.x, move.to.y, move.to.z) === getBlockItemId(move.id)
        || this.world.getBlock(move.to.x, move.to.y, move.to.z) === move.id) {
        this.setBlock(move.to.x, move.to.y, move.to.z, 0);
        this.setBlock(move.from.x, move.from.y, move.from.z, move.id);
      }
      this.pistonMoves.delete(key(pos.x, pos.y, pos.z));
    }
    if (decodeState(this.world.getBlock(headPos.x, headPos.y, headPos.z))?.type === 'piston_head') {
      this.setBlock(headPos.x, headPos.y, headPos.z, 0);
    }
    const retracted = currentId - 1;
    if (this.world.getBlock(pos.x, pos.y, pos.z) === retracted + 1) {
      this.setBlock(pos.x, pos.y, pos.z, retracted);
    }
    this.notify(pos.x, pos.y, pos.z);
  }

  /* ------------------------------------------------------------------ */
  /* Interaction                                                         */
  /* ------------------------------------------------------------------ */

  /** Returns true when the block was handled by a Redstone device. */
  interact(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    const state = decodeState(id);
    if (!state) return false;
    if (state.type === 'lever') {
      this.setBlock(x, y, z, 97 + state.facing * 2 + (state.powered ? 0 : 1));
      this.notify(x, y, z);
      return true;
    }
    if (state.type === 'button') {
      if (state.pressed) return true;
      this.setBlock(x, y, z, 105 + state.facing * 2 + 1);
      this.pulses.set(key(x, y, z), {
        x, y, z, facing: state.facing, remaining: BUTTON_PULSE,
      });
      this.notify(x, y, z);
      return true;
    }
    if (state.type === 'repeater') {
      const delay = state.delay === 4 ? 1 : state.delay + 1;
      this.setBlock(x, y, z, getRepeaterId(state.facing, state.powered, delay));
      this.notify(x, y, z);
      return true;
    }
    return false;
  }

  /** Called when a powered device block is removed, so linked parts follow. */
  onBlockRemoved(x, y, z, id) {
    const state = decodeState(id);
    if (!state) return;
    if (state.type === 'door') {
      const partner = getDoorId(state.facing, state.open, state.half ? 0 : 1);
      if (this.world.getBlock(x, y + (state.half ? -1 : 1), z) === partner) {
        this.setBlock(x, y + (state.half ? -1 : 1), z, 0);
      }
    } else if (state.type === 'bed') {
      const dx = state.facing === 1 ? 1 : state.facing === 3 ? -1 : 0;
      const dz = state.facing === 2 ? 1 : state.facing === 0 ? -1 : 0;
      // The head lies along the facing direction from the foot; from the head
      // the foot is one step back.
      const px = x + (state.head ? -dx : dx);
      const pz = z + (state.head ? -dz : dz);
      if (decodeState(this.world.getBlock(px, y, pz))?.type === 'bed') {
        this.setBlock(px, y, pz, 0);
      }
    } else if (state.type === 'piston') {
      this.retractPiston({ x, y, z }, state, id + 1);
    } else if (state.type === 'piston_head') {
      const d = FACING_OFFSETS[state.facing];
      const base = { x: x - d.x, y: y - d.y, z: z - d.z };
      const baseState = decodeState(this.world.getBlock(base.x, base.y, base.z));
      if (baseState?.type === 'piston') {
        const retracted = this.world.getBlock(base.x, base.y, base.z) & ~1;
        this.setBlock(base.x, base.y, base.z, retracted);
        this.retractPiston(base, { ...baseState, extended: true }, retracted + 1);
      }
    }
    this.notify(x, y, z);
  }

  /* ------------------------------------------------------------------ */
  /* Main update                                                         */
  /* ------------------------------------------------------------------ */

  update(dt) {
    if (!this.isHost()) return;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0 || this.dirty) {
      this.scanTimer = SCAN_INTERVAL;
      this.scan();
    }
    this.updateTimers(dt);
    this.updatePlates();
    this.computeWirePower();
    this.updateConsumers();
  }

  /* ------------------------------------------------------------------ */
  /* Save / load                                                         */
  /* ------------------------------------------------------------------ */

  serialize() {
    return {
      pulses: [...this.pulses.values()].map(({ x, y, z, facing, remaining }) => ({ x, y, z, facing, remaining })),
      repeaters: [...this.repeaterTimers.values()].map(({ x, y, z, facing, delay, remaining }) => ({ x, y, z, facing, delay, remaining })),
      pistons: [...this.pistonMoves.entries()].map(([k, move]) => ({ k, ...move })),
    };
  }

  load(data) {
    if (!data) return;
    this.pulses.clear();
    this.repeaterTimers.clear();
    this.pistonMoves.clear();
    for (const p of data.pulses ?? []) {
      this.pulses.set(key(p.x, p.y, p.z), { x: p.x, y: p.y, z: p.z, facing: p.facing, remaining: p.remaining });
    }
    for (const r of data.repeaters ?? []) {
      this.repeaterTimers.set(key(r.x, r.y, r.z), {
        x: r.x, y: r.y, z: r.z, facing: r.facing, delay: r.delay, remaining: r.remaining,
      });
    }
    for (const p of data.pistons ?? []) {
      this.pistonMoves.set(p.k ?? key(p.from?.x, p.from?.y, p.from?.z), {
        id: p.id, from: p.from, to: p.to,
      });
    }
    this.notify(0, 0, 0);
  }

  dispose() {
    this.sources = [];
    this.wires = [];
    this.consumers = [];
    this.wirePower.clear();
    this.lastPower.clear();
    this.pulses.clear();
    this.repeaterTimers.clear();
    this.pistonMoves.clear();
  }
}
