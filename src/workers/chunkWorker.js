import { generateChunk } from '../world/generator.js';
import { computeTops, meshChunk } from '../world/mesher.js';

self.onmessage = (event) => {
  const data = event.data;
  try {
    if (data.type === 'generate') {
      const result = generateChunk(data.cx, data.cz, data.seed);
      const tops = computeTops(result.blocks);
      self.postMessage({
        taskId: data.taskId,
        type: 'generated',
        cx: data.cx,
        cz: data.cz,
        blocks: result.blocks,
        tops,
        heights: result.heights,
        biomes: result.biomes,
      }, [result.blocks.buffer, tops.buffer, result.heights.buffer, result.biomes.buffer]);
    } else if (data.type === 'mesh') {
      const result = meshChunk(data.padded, data.originX, data.originZ, data.tops, data.biomes ?? null);
      const transfer = [];
      if (result.solid) {
        transfer.push(
          result.solid.positions.buffer,
          result.solid.normals.buffer,
          result.solid.uvs.buffer,
          result.solid.tiles.buffer,
          result.solid.aos.buffer,
          result.solid.skies.buffer,
          result.solid.horizons.buffer,
          result.solid.lights.buffer,
          result.solid.tints.buffer,
          result.solid.indices.buffer,
        );
      }
      if (result.water) {
        transfer.push(
          result.water.positions.buffer,
          result.water.normals.buffer,
          result.water.uvs.buffer,
          result.water.tiles.buffer,
          result.water.aos.buffer,
          result.water.skies.buffer,
          result.water.horizons.buffer,
          result.water.lights.buffer,
          result.water.tints.buffer,
          result.water.indices.buffer,
        );
      }
      self.postMessage({
        taskId: data.taskId,
        type: 'meshed',
        cx: data.cx,
        cz: data.cz,
        solid: result.solid,
        water: result.water,
      }, transfer);
    }
  } catch (error) {
    self.postMessage({
      taskId: data.taskId,
      type: 'error',
      message: error && error.stack ? error.stack : String(error),
    });
  }
};
