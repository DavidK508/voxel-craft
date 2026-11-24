import * as THREE from 'three';
import {
  CHUNK_SIZE,
  WORLD_HEIGHT,
  chunkKey,
} from '../shared/constants.js';
import { getBlock } from '../shared/blocks.js';
import { BIOME_INFO } from './generator.js';
import { buildPaddedVolume, computeTops, HORIZON_PAD, HORIZON_SIZE } from './mesher.js';
import { WorkerPool } from './WorkerPool.js';

const WORKER_COUNT = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));

const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NEIGHBORHOOD = [
  ...CARDINAL,
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
    this.blocks = null;
    this.tops = null;
    this.heights = null;
    this.biomes = null;
    this.state = 'queued';
    this.meshes = [];
    this.remeshAfter = false;
    this.distance = 0;
  }
}

function buildGeometry(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute('aTile', new THREE.BufferAttribute(data.tiles, 1));
  geometry.setAttribute('aAO', new THREE.BufferAttribute(data.aos, 1, true));
  geometry.setAttribute('aSky', new THREE.BufferAttribute(data.skies, 1, true));
  geometry.setAttribute('aHorizon', new THREE.BufferAttribute(data.horizons, 2, true));
  geometry.setAttribute('aLight', new THREE.BufferAttribute(data.lights, 1, true));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(data.tints ?? new Uint8Array(data.positions.length / 3 * 3).fill(128), 3, true));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export class World {
  constructor({ scene, seed, renderDistance, materials, onProgress }) {
    this.scene = scene;
    this.seed = seed >>> 0;
    this.renderDistance = renderDistance;
    this.materials = materials;
    this.onProgress = onProgress;
    this.pool = new WorkerPool(WORKER_COUNT);
    this.chunks = new Map();
    this.genQueue = [];
    this.meshQueue = [];
    this.genInFlight = 0;
    this.meshInFlight = 0;
    this.maxGenInFlight = WORKER_COUNT * 2;
    this.maxMeshInFlight = WORKER_COUNT;
    this.edits = new Map();
    this.editsByChunk = new Map();
    this.playerX = 0;
    this.playerZ = 0;
    this.lastCenterX = null;
    this.lastCenterZ = null;
    this.lastSort = 0;
    this.readyChunks = 0;
    this.totalTriangles = 0;
    this.disposed = false;
  }

  loadEdits(entries) {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 4) continue;
      const [x, y, z, id] = entry;
      if (x === undefined || y === undefined || z === undefined || id === undefined) continue;
      if (y < 0 || y >= WORLD_HEIGHT) continue;
      this.edits.set(`${x},${y},${z}`, id);
      const cx = x >> 4;
      const cz = z >> 4;
      const key = chunkKey(cx, cz);
      let map = this.editsByChunk.get(key);
      if (!map) {
        map = new Map();
        this.editsByChunk.set(key, map);
      }
      const lx = x & 15;
      const lz = z & 15;
      map.set(lx + (lz << 4) + (y << 8), id);
    }
  }

  serializeEdits() {
    const result = [];
    for (const [key, id] of this.edits) {
      const [x, y, z] = key.split(',').map(Number);
      result.push([x, y, z, id]);
    }
    return result;
  }

  applyEdits(chunk) {
    const map = this.editsByChunk.get(chunk.key);
    if (!map) return;
    for (const [index, id] of map) chunk.blocks[index] = id;
    // Saved edits are applied after generation, so the worker's column tops are
    // stale; refresh them before any neighbour uses this chunk for shadows.
    if (map.size) chunk.tops = computeTops(chunk.blocks);
  }

  setRenderDistance(distance) {
    this.renderDistance = distance;
    this.materials.setRenderDistance(distance);
    this.lastCenterX = null;
    this.lastCenterZ = null;
  }

  update(dt, playerPosition) {
    if (this.disposed) return;
    this.playerX = playerPosition.x;
    this.playerZ = playerPosition.z;
    const pcx = Math.floor(playerPosition.x / CHUNK_SIZE);
    const pcz = Math.floor(playerPosition.z / CHUNK_SIZE);
    if (pcx !== this.lastCenterX || pcz !== this.lastCenterZ) {
      this.lastCenterX = pcx;
      this.lastCenterZ = pcz;
      this.updateDesired(pcx, pcz);
    }
    this.pump();
    this.evict(pcx, pcz);
  }

  updateDesired(pcx, pcz) {
    const radius = this.renderDistance;
    const wanted = new Set();
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz <= (radius + 0.4) ** 2) wanted.add(chunkKey(pcx + dx, pcz + dz));
      }
    }
    this.wanted = wanted;

    // Generate one extra ring so every visible chunk has all eight neighbours
    // available for seamless corner AO. The extra ring is also meshed, which
    // pushes any remaining holes safely beyond the fog wall.
    const genRadius = radius + 1;
    for (let dz = -genRadius; dz <= genRadius; dz++) {
      for (let dx = -genRadius; dx <= genRadius; dx++) {
        if (dx * dx + dz * dz > (genRadius + 0.4) ** 2) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = chunkKey(cx, cz);
        if (!this.chunks.has(key)) {
          const chunk = new Chunk(cx, cz);
          this.chunks.set(key, chunk);
          this.genQueue.push(chunk);
        }
      }
    }
    this.sortQueues();
    this.onProgress?.();
  }

  sortQueues() {
    const px = this.playerX;
    const pz = this.playerZ;
    for (const chunk of this.genQueue) {
      const dx = chunk.cx * CHUNK_SIZE + 8 - px;
      const dz = chunk.cz * CHUNK_SIZE + 8 - pz;
      chunk.distance = dx * dx + dz * dz;
    }
    this.genQueue.sort((a, b) => a.distance - b.distance);
    for (const chunk of this.meshQueue) {
      const dx = chunk.cx * CHUNK_SIZE + 8 - px;
      const dz = chunk.cz * CHUNK_SIZE + 8 - pz;
      chunk.distance = dx * dx + dz * dz;
    }
    this.meshQueue.sort((a, b) => a.distance - b.distance);
    this.lastSort = performance.now();
  }

  pump() {
    if (this.genInFlight < this.maxGenInFlight && this.genQueue.length) {
      while (this.genInFlight < this.maxGenInFlight && this.genQueue.length) {
        const chunk = this.genQueue.shift();
        if (!chunk || chunk.state !== 'queued' || this.chunks.get(chunk.key) !== chunk) continue;
        chunk.state = 'generating';
        this.genInFlight++;
        this.pool.run('generate', { cx: chunk.cx, cz: chunk.cz, seed: this.seed }).then((result) => {
          this.genInFlight--;
          if (this.disposed || this.chunks.get(chunk.key) !== chunk) {
            this.pump();
            return;
          }
          chunk.blocks = result.blocks;
          chunk.tops = result.tops ?? computeTops(result.blocks);
          chunk.heights = result.heights;
          chunk.biomes = result.biomes;
          chunk.state = 'generated';
          this.applyEdits(chunk);
          // AO needs the full 3x3 neighborhood, so a chunk can only be meshed
          // once all eight neighbours exist. Every completed generation wakes
          // up the chunks around it, including diagonal ones.
          for (const [dx, dz] of NEIGHBORHOOD) {
            const neighbor = this.chunks.get(chunkKey(chunk.cx + dx, chunk.cz + dz));
            if (neighbor) this.tryQueueMesh(neighbor);
          }
          this.tryQueueMesh(chunk);
          this.onProgress?.();
          this.pump();
        }).catch((error) => {
          this.genInFlight--;
          console.error('Chunk generation failed', chunk.cx, chunk.cz, error);
          if (this.chunks.get(chunk.key) === chunk) chunk.state = 'error';
          this.onProgress?.();
          this.pump();
        });
      }
    }

    if (this.meshInFlight < this.maxMeshInFlight && this.meshQueue.length) {
      while (this.meshInFlight < this.maxMeshInFlight && this.meshQueue.length) {
        const chunk = this.meshQueue.shift();
        if (!chunk || chunk.state !== 'queued-mesh' || this.chunks.get(chunk.key) !== chunk) continue;
        if (!this.neighborsGenerated(chunk)) {
          chunk.state = 'awaiting';
          continue;
        }
        const padded = buildPaddedVolume(chunk.blocks, (dx, dz) => {
          const neighbor = this.chunks.get(chunkKey(chunk.cx + dx, chunk.cz + dz));
          return neighbor?.blocks ?? null;
        });
        const tops = this.buildHorizonMap(chunk);
        chunk.state = 'meshing';
        this.meshInFlight++;
        this.pool.run('mesh', {
          padded,
          tops,
          biomes: chunk.biomes,
          originX: chunk.cx * CHUNK_SIZE,
          originZ: chunk.cz * CHUNK_SIZE,
        }, [padded.buffer]).then((result) => {
          this.meshInFlight--;
          if (this.disposed || this.chunks.get(chunk.key) !== chunk) {
            this.pump();
            return;
          }
          this.applyMesh(chunk, result);
          chunk.state = 'ready';
          if (chunk.remeshAfter) {
            chunk.remeshAfter = false;
            this.markDirty(chunk);
          }
          this.recountStats();
          this.onProgress?.();
          this.pump();
        }).catch((error) => {
          this.meshInFlight--;
          console.error('Chunk mesh failed', chunk.cx, chunk.cz, error);
          if (this.chunks.get(chunk.key) === chunk) chunk.state = 'error';
          this.onProgress?.();
          this.pump();
        });
      }
    }
  }

  neighborsGenerated(chunk) {
    for (const [dx, dz] of NEIGHBORHOOD) {
      const neighbor = this.chunks.get(chunkKey(chunk.cx + dx, chunk.cz + dz));
      if (!neighbor || !neighbor.blocks) return false;
    }
    return true;
  }

  /**
   * Stitch the 3x3 neighbourhood's column tops into the 48x48 map the mesher
   * uses for baked sun horizons. Index (x + 16) + (z + 16) * 48, with local
   * block coordinates running -16..31.
   */
  buildHorizonMap(chunk) {
    const tops = new Int16Array(HORIZON_SIZE * HORIZON_SIZE);
    tops.fill(-1);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const neighbor = this.chunks.get(chunkKey(chunk.cx + dx, chunk.cz + dz));
        if (!neighbor?.tops) continue;
        const ox = (dx + 1) * HORIZON_PAD;
        const oz = (dz + 1) * HORIZON_PAD;
        for (let z = 0; z < CHUNK_SIZE; z++) {
          const srcRow = z * CHUNK_SIZE;
          const dstRow = (oz + z) * HORIZON_SIZE + ox;
          for (let x = 0; x < CHUNK_SIZE; x++) {
            tops[dstRow + x] = neighbor.tops[srcRow + x];
          }
        }
      }
    }
    return tops;
  }

  tryQueueMesh(chunk) {
    if (!chunk || !chunk.blocks) return;
    if (chunk.state === 'queued-mesh' || chunk.state === 'meshing') return;
    if (chunk.state === 'ready') return;
    if (!this.neighborsGenerated(chunk)) {
      chunk.state = 'awaiting';
      return;
    }
    chunk.state = 'queued-mesh';
    this.meshQueue.push(chunk);
    if (performance.now() - this.lastSort > 400) this.sortQueues();
  }

  markDirty(chunk) {
    if (!chunk || !chunk.blocks) return;
    if (chunk.state === 'meshing' || chunk.state === 'queued-mesh') {
      chunk.remeshAfter = true;
      return;
    }
    chunk.state = 'generated';
    this.tryQueueMesh(chunk);
  }

  applyMesh(chunk, result) {
    this.disposeMeshes(chunk);
    if (result.solid) {
      const geometry = buildGeometry(result.solid);
      const mesh = new THREE.Mesh(geometry, this.materials.solid);
      mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.chunkKey = chunk.key;
      this.scene.add(mesh);
      chunk.meshes.push(mesh);
    }
    if (result.water) {
      const geometry = buildGeometry(result.water);
      const mesh = new THREE.Mesh(geometry, this.materials.water);
      mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
      mesh.renderOrder = 3;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.chunkKey = chunk.key;
      this.scene.add(mesh);
      chunk.meshes.push(mesh);
    }
  }

  disposeMeshes(chunk) {
    for (const mesh of chunk.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    chunk.meshes.length = 0;
  }

  evict(pcx, pcz) {
    const limit = this.renderDistance + 3;
    const limitSq = limit * limit;
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (dx * dx + dz * dz <= limitSq) continue;
      this.disposeMeshes(chunk);
      this.chunks.delete(key);
      this.genQueue = this.genQueue.filter((item) => item !== chunk);
      this.meshQueue = this.meshQueue.filter((item) => item !== chunk);
      this.recountStats();
    }
  }

  recountStats() {
    let ready = 0;
    let triangles = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.state === 'ready') ready++;
      for (const mesh of chunk.meshes) {
        const index = mesh.geometry.getIndex();
        if (index) triangles += index.count / 3;
      }
    }
    this.readyChunks = ready;
    this.totalTriangles = triangles;
  }

  getChunk(x, z) {
    return this.chunks.get(chunkKey(x >> 4, z >> 4));
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const cx = x >> 4;
    const cz = z >> 4;
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk || !chunk.blocks) return 0;
    const lx = x & 15;
    const lz = z & 15;
    return chunk.blocks[lx + (lz << 4) + (y << 8)];
  }

  isSolidAt(x, y, z) {
    if (y < 0) return true;
    if (y >= WORLD_HEIGHT) return false;
    return getBlock(this.getBlock(x, y, z)).solid === true;
  }

  isChunkLoadedAt(x, z) {
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return !!chunk?.blocks;
  }

  isChunkReadyAt(x, z) {
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return chunk?.state === 'ready';
  }

  getBiomeIdAt(x, z) {
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk?.biomes) return null;
    const lx = x & 15;
    const lz = z & 15;
    return chunk.biomes[lx + lz * CHUNK_SIZE];
  }

  getBiomeAt(x, z) {
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk?.biomes) return null;
    const lx = x & 15;
    const lz = z & 15;
    const id = chunk.biomes[lx + lz * CHUNK_SIZE];
    return BIOME_INFO[id]?.name ?? null;
  }

  getHeightAt(x, z) {
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk?.heights) return null;
    const lx = x & 15;
    const lz = z & 15;
    return chunk.heights[lx + lz * CHUNK_SIZE];
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk || !chunk.blocks) return false;
    const lx = x & 15;
    const lz = z & 15;
    const index = lx + (lz << 4) + (y << 8);
    if (chunk.blocks[index] === id) return false;
    chunk.blocks[index] = id;
    this.edits.set(`${x},${y},${z}`, id);
    let map = this.editsByChunk.get(key);
    if (!map) {
      map = new Map();
      this.editsByChunk.set(key, map);
    }
    map.set(index, id);
    // Column tops drive both skylight and sun horizons, so refresh them before
    // any affected neighbour is remeshed.
    chunk.tops = computeTops(chunk.blocks);
    // Shadows reach 16 blocks, so an edit can change lighting in every one of
    // the eight surrounding chunks, not only the ones sharing a face/corner.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.markDirty(this.chunks.get(chunkKey(cx + dx, cz + dz)));
      }
    }
    return true;
  }

  countReadyWithin(radius, centerX, centerZ) {
    const pcx = Math.floor(centerX / CHUNK_SIZE);
    const pcz = Math.floor(centerZ / CHUNK_SIZE);
    let ready = 0;
    let total = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        total++;
        const chunk = this.chunks.get(chunkKey(pcx + dx, pcz + dz));
        if (chunk?.state === 'ready') ready++;
      }
    }
    return { ready, total };
  }

  getStats() {
    return {
      readyChunks: this.readyChunks,
      loadedChunks: this.chunks.size,
      triangles: this.totalTriangles,
      genInFlight: this.genInFlight,
      meshInFlight: this.meshInFlight,
      genQueue: this.genQueue.length,
      meshQueue: this.meshQueue.length,
      workers: this.pool.size,
    };
  }

  dispose() {
    this.disposed = true;
    this.pool.terminate();
    for (const chunk of this.chunks.values()) this.disposeMeshes(chunk);
    this.chunks.clear();
    this.genQueue.length = 0;
    this.meshQueue.length = 0;
  }
}
