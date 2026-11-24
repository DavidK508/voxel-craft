import { TEXTURE_NAMES, TILE, TEXTURE_SIZE } from '../shared/textures.js';
import { BLOCKS, BLOCK_DEFS } from '../shared/blocks.js';
import { ITEM_LIST, getItem } from '../shared/items.js';
import { mulberry32 } from '../shared/noise.js';

const SIZE = TEXTURE_SIZE;
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

function pixel(ctx, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  ctx.fillStyle = `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${clamp255(a) / 255})`;
  ctx.fillRect(x, y, 1, 1);
}

function clearPixel(ctx, x, y) {
  ctx.clearRect(x, y, 1, 1);
}

/**
 * Crisp 2x2-pixel blocky noise. Each 2x2 cell gets one random shade, so the
 * texture reads as chunky pixel art instead of per-pixel TV static, while
 * staying sharp (no interpolation / blur).
 */
function fillNoise(ctx, base, variance, rng, alpha = 255) {
  const cell = 2;
  for (let cy = 0; cy < SIZE; cy += cell) {
    for (let cx = 0; cx < SIZE; cx += cell) {
      const n = Math.round((rng() - 0.5) * variance * 2);
      for (let dy = 0; dy < cell; dy++) {
        for (let dx = 0; dx < cell; dx++) {
          pixel(ctx, cx + dx, cy + dy, base[0] + n, base[1] + n, base[2] + n, alpha);
        }
      }
    }
  }
}

function sprinkle(ctx, rng, count, color, alpha = 255, size = 1) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * SIZE);
    const y = Math.floor(rng() * SIZE);
    const s = 1 + Math.floor(rng() * size);
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        pixel(ctx, x + dx, y + dy, color[0], color[1], color[2], alpha);
      }
    }
  }
}

function stoneBase(ctx, rng, tint = [122, 122, 122], variance = 24) {
  fillNoise(ctx, tint, variance, rng);
  sprinkle(ctx, rng, 14, [tint[0] - 22, tint[1] - 22, tint[2] - 22], 255, 2);
  sprinkle(ctx, rng, 9, [tint[0] + 22, tint[1] + 22, tint[2] + 22], 255, 1);
  // Jagged dark cracks so stone reads as rock instead of flat grey noise.
  for (let i = 0; i < 3; i++) {
    let x = 1 + Math.floor(rng() * 11);
    let y = 1 + Math.floor(rng() * 12);
    const len = 4 + Math.floor(rng() * 4);
    for (let j = 0; j < len; j++) {
      pixel(ctx, x, y, tint[0] - 46, tint[1] - 46, tint[2] - 46);
      x += 1;
      y += rng() < 0.35 ? 1 : rng() < 0.5 ? -1 : 0;
    }
  }
}

function oreTexture(ctx, rng, oreColor) {
  stoneBase(ctx, rng);
  const spots = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < spots; i++) {
    const x = 2 + Math.floor(rng() * 11);
    const y = 2 + Math.floor(rng() * 11);
    const w = 1 + Math.floor(rng() * 3);
    const h = 1 + Math.floor(rng() * 3);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const highlight = dx === 0 && dy === 0;
        pixel(ctx, x + dx, y + dy,
          oreColor[0] + (highlight ? 40 : 0),
          oreColor[1] + (highlight ? 40 : 0),
          oreColor[2] + (highlight ? 40 : 0));
      }
    }
  }
}

function cobbleTexture(ctx, rng, mossy = false) {
  fillNoise(ctx, [76, 76, 76], 12, rng);
  const cells = [
    [0, 0, 7, 5], [8, 0, 8, 6], [0, 6, 5, 5], [6, 6, 6, 4],
    [13, 7, 3, 4], [0, 12, 7, 4], [8, 11, 8, 5], [6, 11, 2, 3],
  ];
  for (const [x, y, w, h] of cells) {
    const shade = 92 + Math.floor(rng() * 35);
    // One shade per 2x2 sub-cell keeps the cobbles chunky, not grainy.
    for (let dy = 0; dy < h; dy += 2) {
      for (let dx = 0; dx < w; dx += 2) {
        const n = Math.round((rng() - 0.5) * 14);
        for (let sy = 0; sy < 2 && dy + sy < h; sy++) {
          for (let sx = 0; sx < 2 && dx + sx < w; sx++) {
            const edge = dx + sx === 0 || dy + sy === 0 ? -18 : 0;
            const c = shade + n + edge;
            pixel(ctx, x + dx + sx, y + dy + sy, c, c, c);
          }
        }
      }
    }
  }
  if (mossy) {
    sprinkle(ctx, rng, 34, [52, 92, 40], 220, 2);
    sprinkle(ctx, rng, 18, [74, 122, 53], 200, 1);
  }
}

function planksTexture(ctx, rng, base = [164, 116, 66]) {
  fillNoise(ctx, base, 12, rng);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (y % 5 === 0) pixel(ctx, x, y, base[0] - 45, base[1] - 38, base[2] - 28);
      if (x % 7 === 2) pixel(ctx, x, y, base[0] - 22, base[1] - 18, base[2] - 12);
      if (rng() < 0.035) pixel(ctx, x, y, base[0] - 30, base[1] - 24, base[2] - 16);
    }
  }
}

function logSideTexture(ctx, rng, base) {
  fillNoise(ctx, base, 10, rng);
  for (let x = 0; x < SIZE; x++) {
    const dark = x % 4 === 1 || rng() < 0.18;
    if (!dark) continue;
    for (let y = 0; y < SIZE; y++) {
      const n = (rng() - 0.5) * 10;
      pixel(ctx, x, y, base[0] - 25 + n, base[1] - 20 + n, base[2] - 14 + n);
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rng() * 16);
    const y = Math.floor(rng() * 14);
    pixel(ctx, x, y, base[0] + 20, base[1] + 16, base[2] + 10);
    pixel(ctx, x, y + 1, base[0] + 10, base[1] + 8, base[2] + 4);
  }
}

function logTopTexture(ctx, rng, base, ring) {
  fillNoise(ctx, base, 8, rng);
  const cx = 7.5;
  const cy = 7.5;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (Math.floor(d) % 3 === 0) {
        pixel(ctx, x, y, ring[0], ring[1], ring[2]);
      }
    }
  }
  for (let y = 6; y < 10; y++) {
    for (let x = 6; x < 10; x++) pixel(ctx, x, y, base[0] - 30, base[1] - 22, base[2] - 12);
  }
}

function leavesTexture(ctx, rng, base, dark) {
  // 2x2 shade cells keep the canopy chunky; holes and dark clumps stay per-pixel.
  const shades = [];
  for (let cy = 0; cy < SIZE; cy += 2) {
    const row = [];
    for (let cx = 0; cx < SIZE; cx += 2) row.push(Math.round((rng() - 0.5) * 26));
    shades.push(row);
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (rng() < 0.13) {
        clearPixel(ctx, x, y);
        continue;
      }
      const n = shades[y >> 1][x >> 1];
      const d = rng() < 0.26;
      pixel(ctx, x, y,
        (d ? dark[0] : base[0]) + n,
        (d ? dark[1] : base[1]) + n,
        (d ? dark[2] : base[2]) + n);
    }
  }
}

function woolTexture(ctx, rng, base) {
  fillNoise(ctx, base, 10, rng);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if ((x + y) % 4 === 0) pixel(ctx, x, y, base[0] - 18, base[1] - 18, base[2] - 18);
      if (rng() < 0.06) pixel(ctx, x, y, base[0] + 20, base[1] + 20, base[2] + 20);
    }
  }
}

const PAINTERS = {
  stone: (ctx, rng) => stoneBase(ctx, rng),
  dirt: (ctx, rng) => {
    fillNoise(ctx, [133, 96, 67], 22, rng);
    // Chunky pebbles: dark 2x2 clumps with a lighter top edge.
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(rng() * 14);
      const y = Math.floor(rng() * 14);
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          pixel(ctx, x + dx, y + dy, dy === 0 ? 116 : 92, dy === 0 ? 83 : 64, dy === 0 ? 58 : 44);
        }
      }
    }
    sprinkle(ctx, rng, 8, [98, 69, 47], 255, 1);
    sprinkle(ctx, rng, 8, [160, 121, 87], 255, 1);
  },
  grass_top: (ctx, rng) => {
    fillNoise(ctx, [94, 157, 52], 22, rng);
    sprinkle(ctx, rng, 14, [65, 122, 37], 255, 2);
    // Upright grass blades: short bright strokes with a darker root.
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(rng() * 16);
      const y = 1 + Math.floor(rng() * 12);
      pixel(ctx, x, y, 132, 196, 78);
      pixel(ctx, x, y + 1, 110, 176, 62);
      if (rng() < 0.5) pixel(ctx, x, y + 2, 76, 138, 44);
    }
  },
  grass_side: (ctx, rng) => {
    fillNoise(ctx, [133, 96, 67], 20, rng);
    for (let x = 0; x < SIZE; x++) {
      const depth = 3 + Math.floor(rng() * 3);
      for (let y = 0; y < depth; y++) {
        const n = (rng() - 0.5) * 12;
        pixel(ctx, x, y, 94 + n, 157 + n, 52 + n);
      }
      // Ragged turf edge with blades hanging into the dirt.
      if (rng() < 0.45) pixel(ctx, x, depth, 70, 127, 42);
      if (rng() < 0.2) pixel(ctx, x, depth + 1, 62, 112, 38);
    }
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(rng() * 14);
      const y = 7 + Math.floor(rng() * 7);
      pixel(ctx, x, y, 98, 69, 47);
      pixel(ctx, x + 1, y, 98, 69, 47);
      pixel(ctx, x, y + 1, 88, 61, 41);
      pixel(ctx, x + 1, y + 1, 88, 61, 41);
    }
  },
  snow_side: (ctx, rng) => {
    fillNoise(ctx, [133, 96, 67], 18, rng);
    for (let x = 0; x < SIZE; x++) {
      const depth = 3 + Math.floor(rng() * 3);
      for (let y = 0; y < depth; y++) {
        const n = (rng() - 0.5) * 10;
        pixel(ctx, x, y, 235 + n, 242 + n, 248 + n);
      }
    }
  },
  snow: (ctx, rng) => {
    fillNoise(ctx, [236, 243, 249], 7, rng);
    sprinkle(ctx, rng, 10, [205, 222, 238], 255, 2);
    sprinkle(ctx, rng, 6, [255, 255, 255], 255, 1);
  },
  sand: (ctx, rng) => {
    fillNoise(ctx, [218, 206, 158], 16, rng);
    // Speckled 2x2 dot clusters — sand's signature grain pattern.
    for (let i = 0; i < 8; i++) {
      const x = Math.floor(rng() * 14);
      const y = Math.floor(rng() * 14);
      pixel(ctx, x, y, 193, 179, 130);
      pixel(ctx, x + 1, y, 193, 179, 130);
      pixel(ctx, x, y + 1, 203, 190, 143);
      pixel(ctx, x + 1, y + 1, 203, 190, 143);
    }
    sprinkle(ctx, rng, 8, [236, 227, 184], 255, 1);
  },
  red_sand: (ctx, rng) => {
    fillNoise(ctx, [188, 101, 55], 17, rng);
    for (let i = 0; i < 8; i++) {
      const x = Math.floor(rng() * 14);
      const y = Math.floor(rng() * 14);
      pixel(ctx, x, y, 157, 78, 41);
      pixel(ctx, x + 1, y, 157, 78, 41);
      pixel(ctx, x, y + 1, 169, 88, 48);
      pixel(ctx, x + 1, y + 1, 169, 88, 48);
    }
    sprinkle(ctx, rng, 6, [214, 128, 78], 255, 1);
  },
  sandstone_top: (ctx, rng) => {
    fillNoise(ctx, [220, 210, 164], 7, rng);
    sprinkle(ctx, rng, 7, [199, 188, 143], 255, 1);
  },
  sandstone_side: (ctx, rng) => {
    fillNoise(ctx, [214, 202, 154], 8, rng);
    for (let y = 0; y < SIZE; y++) {
      if (y === 0 || y === 4 || y === 10 || y === 15) {
        for (let x = 0; x < SIZE; x++) pixel(ctx, x, y, 184, 171, 125);
      }
    }
  },
  sandstone_bottom: (ctx, rng) => {
    fillNoise(ctx, [207, 196, 150], 9, rng);
    sprinkle(ctx, rng, 8, [181, 169, 125], 255, 2);
  },
  gravel: (ctx, rng) => {
    fillNoise(ctx, [105, 101, 99], 25, rng);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rng() * 14);
      const y = Math.floor(rng() * 14);
      const c = 65 + Math.floor(rng() * 100);
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) pixel(ctx, x + dx, y + dy, c, c - 2, c - 4);
      }
    }
  },
  cobblestone: (ctx, rng) => cobbleTexture(ctx, rng),
  mossy_cobblestone: (ctx, rng) => cobbleTexture(ctx, rng, true),
  stone_bricks: (ctx, rng) => {
    fillNoise(ctx, [113, 113, 113], 15, rng);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (y === 0 || y === 7 || y === 15) pixel(ctx, x, y, 78, 78, 78);
        if ((y < 8 && x === 0) || (y >= 8 && x === 8)) pixel(ctx, x, y, 78, 78, 78);
      }
    }
  },
  deepslate: (ctx, rng) => {
    fillNoise(ctx, [67, 67, 75], 14, rng);
    sprinkle(ctx, rng, 15, [44, 44, 52], 255, 2);
    sprinkle(ctx, rng, 5, [93, 93, 103], 255, 1);
  },
  deepslate_top: (ctx, rng) => {
    fillNoise(ctx, [78, 78, 86], 12, rng);
    sprinkle(ctx, rng, 14, [55, 55, 62], 255, 1);
  },
  bedrock: (ctx, rng) => {
    fillNoise(ctx, [35, 35, 38], 20, rng);
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(rng() * 13);
      const y = Math.floor(rng() * 13);
      const w = 2 + Math.floor(rng() * 3);
      const h = 2 + Math.floor(rng() * 3);
      const c = 18 + Math.floor(rng() * 55);
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) pixel(ctx, x + dx, y + dy, c, c, c + 2);
    }
  },
  coal_ore: (ctx, rng) => oreTexture(ctx, rng, [40, 40, 44]),
  iron_ore: (ctx, rng) => oreTexture(ctx, rng, [205, 170, 140]),
  gold_ore: (ctx, rng) => oreTexture(ctx, rng, [245, 205, 55]),
  diamond_ore: (ctx, rng) => oreTexture(ctx, rng, [75, 225, 215]),
  oak_planks: (ctx, rng) => planksTexture(ctx, rng),
  oak_log_side: (ctx, rng) => logSideTexture(ctx, rng, [102, 73, 43]),
  oak_log_top: (ctx, rng) => logTopTexture(ctx, rng, [154, 117, 70], [102, 73, 43]),
  oak_leaves: (ctx, rng) => leavesTexture(ctx, rng, [66, 132, 42], [42, 95, 28]),
  birch_log_side: (ctx, rng) => {
    fillNoise(ctx, [210, 209, 195], 7, rng);
    for (let i = 0; i < 8; i++) {
      const x = Math.floor(rng() * 13);
      const y = Math.floor(rng() * 15);
      const w = 1 + Math.floor(rng() * 3);
      for (let dx = 0; dx < w; dx++) pixel(ctx, x + dx, y, 62, 60, 53);
    }
  },
  birch_log_top: (ctx, rng) => logTopTexture(ctx, rng, [197, 188, 154], [130, 121, 94]),
  birch_leaves: (ctx, rng) => leavesTexture(ctx, rng, [116, 156, 64], [78, 117, 42]),
  spruce_log_side: (ctx, rng) => logSideTexture(ctx, rng, [72, 54, 34]),
  spruce_log_top: (ctx, rng) => logTopTexture(ctx, rng, [110, 84, 52], [68, 50, 30]),
  spruce_leaves: (ctx, rng) => leavesTexture(ctx, rng, [45, 92, 51], [28, 64, 35]),
  water: (ctx, rng) => {
    // Chunky stepped waves: the sine is quantised into flat bands on a 2x2
    // grid, so the surface reads as pixel art and scrolls without shimmer.
    for (let cy = 0; cy < SIZE; cy += 2) {
      for (let cx = 0; cx < SIZE; cx += 2) {
        const wave = Math.round(Math.sin((cx + cy * 0.8) * 0.9) * 3) * 4;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            pixel(ctx, cx + dx, cy + dy, 45 + wave, 106 + wave, 191 + wave, 205);
          }
        }
      }
    }
    // A few bright glints as short 2px dashes.
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(rng() * 7) * 2;
      const y = Math.floor(rng() * 8) * 2;
      pixel(ctx, x, y, 105, 171, 236, 185);
      pixel(ctx, x + 1, y, 105, 171, 236, 185);
    }
  },
  lava: (ctx, rng) => {
    fillNoise(ctx, [226, 87, 12], 25, rng);
    sprinkle(ctx, rng, 20, [255, 205, 30], 255, 2);
    sprinkle(ctx, rng, 10, [140, 35, 4], 255, 2);
  },
  glass: (ctx, rng) => {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) clearPixel(ctx, x, y);
    for (let i = 0; i < SIZE; i++) {
      pixel(ctx, i, 0, 190, 225, 235, 180);
      pixel(ctx, i, 15, 190, 225, 235, 180);
      pixel(ctx, 0, i, 190, 225, 235, 180);
      pixel(ctx, 15, i, 190, 225, 235, 180);
    }
    for (let i = 3; i < 11; i++) pixel(ctx, i, 13 - i, 235, 250, 255, 130);
    pixel(ctx, 5, 4, 255, 255, 255, 210);
    pixel(ctx, 6, 3, 255, 255, 255, 210);
  },
  ice: (ctx, rng) => {
    fillNoise(ctx, [146, 196, 231], 9, rng, 240);
    for (let i = 0; i < 7; i++) {
      let x = Math.floor(rng() * 16);
      let y = Math.floor(rng() * 16);
      for (let j = 0; j < 5; j++) {
        pixel(ctx, x, y, 198, 231, 250, 230);
        x += rng() < 0.5 ? 1 : 0;
        y += rng() < 0.5 ? 1 : -1;
      }
    }
  },
  cactus_side: (ctx, rng) => {
    fillNoise(ctx, [61, 124, 48], 12, rng);
    for (let x = 1; x < 16; x += 5) {
      for (let y = 0; y < 16; y++) pixel(ctx, x, y, 43, 98, 35);
    }
    for (let i = 0; i < 12; i++) {
      pixel(ctx, Math.floor(rng() * 16), Math.floor(rng() * 16), 205, 225, 160);
    }
  },
  cactus_top: (ctx, rng) => {
    fillNoise(ctx, [71, 139, 54], 10, rng);
    for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) pixel(ctx, x, y, 92, 158, 67);
  },
  crafting_table_top: (ctx, rng) => {
    planksTexture(ctx, rng);
    for (let i = 0; i < 16; i++) {
      pixel(ctx, i, 5, 75, 50, 30);
      pixel(ctx, i, 10, 75, 50, 30);
      pixel(ctx, 5, i, 75, 50, 30);
      pixel(ctx, 10, i, 75, 50, 30);
    }
  },
  crafting_table_side: (ctx, rng) => {
    planksTexture(ctx, rng);
    for (let y = 4; y < 12; y++) {
      for (let x = 2; x < 7; x++) pixel(ctx, x, y, 99, 72, 46);
    }
    for (let x = 9; x < 14; x++) {
      pixel(ctx, x, 6, 60, 42, 28);
      pixel(ctx, x, 9, 60, 42, 28);
    }
  },
  furnace_front: (ctx, rng) => {
    stoneBase(ctx, rng);
    for (let y = 5; y < 14; y++) {
      for (let x = 3; x < 13; x++) {
        if (y === 5 || y === 13 || x === 3 || x === 12) pixel(ctx, x, y, 58, 58, 58);
        else pixel(ctx, x, y, 24, 23, 22);
      }
    }
    for (let x = 5; x < 11; x++) {
      pixel(ctx, x, 11, 226, 95, 18);
      pixel(ctx, x, 10, 255, 160, 22);
    }
    pixel(ctx, 6, 9, 255, 220, 70);
    pixel(ctx, 9, 9, 255, 220, 70);
  },
  furnace_side: (ctx, rng) => {
    stoneBase(ctx, rng);
    for (let y = 3; y < 15; y += 4) {
      for (let x = 0; x < 16; x++) if ((x + y) % 3 === 0) pixel(ctx, x, y, 98, 98, 98);
    }
  },
  bricks: (ctx, rng) => {
    fillNoise(ctx, [142, 65, 50], 10, rng);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const row = Math.floor(y / 4);
        const offset = row % 2 === 0 ? 0 : 4;
        if (y % 4 === 0 || (x + offset) % 8 === 0) pixel(ctx, x, y, 186, 175, 157);
      }
    }
  },
  clay: (ctx, rng) => {
    fillNoise(ctx, [145, 146, 163], 10, rng);
    sprinkle(ctx, rng, 8, [122, 123, 142], 255, 2);
  },
  terracotta: (ctx, rng) => {
    fillNoise(ctx, [151, 90, 67], 12, rng);
    sprinkle(ctx, rng, 10, [124, 70, 52], 255, 2);
  },
  obsidian: (ctx, rng) => {
    fillNoise(ctx, [30, 20, 43], 12, rng);
    sprinkle(ctx, rng, 12, [65, 42, 92], 255, 1);
    sprinkle(ctx, rng, 5, [116, 75, 160], 255, 1);
  },
  glowstone: (ctx, rng) => {
    fillNoise(ctx, [152, 105, 38], 16, rng);
    sprinkle(ctx, rng, 28, [250, 210, 76], 255, 2);
    sprinkle(ctx, rng, 12, [255, 246, 170], 255, 1);
  },
  torch: (ctx) => {
    // Transparent tile with a small wooden stick and a bright flame. The
    // mesher renders it as a slim centred post, so the transparent pixels
    // simply disappear through the alpha test.
    for (let y = 6; y < 15; y++) {
      pixel(ctx, 7, y, 112, 74, 40);
      pixel(ctx, 8, y, 150, 102, 58);
    }
    pixel(ctx, 7, 5, 92, 58, 30);
    pixel(ctx, 8, 5, 112, 74, 40);
    const flame = [
      [7, 2, 255, 238, 140], [8, 2, 255, 220, 90],
      [6, 3, 255, 178, 42], [7, 3, 255, 246, 180], [8, 3, 255, 214, 80], [9, 3, 250, 150, 34],
      [6, 4, 240, 138, 28], [7, 4, 255, 206, 78], [8, 4, 255, 186, 52], [9, 4, 232, 120, 24],
      [7, 5, 214, 96, 20], [8, 5, 236, 132, 30],
    ];
    for (const [x, y, r, g, b] of flame) pixel(ctx, x, y, r, g, b);
  },
  wheat_crop: (ctx, rng) => {
    // A block of ripe wheat. The canvas is transparent except for the stalks,
    // so the cross-shaped mesh looks like a real crop instead of a cube.
    for (const x of [2, 5, 8, 11, 14]) {
      for (let y = 6; y < 16; y++) pixel(ctx, x, y, 77, 132, 43);
      for (let y = 8; y < 14; y += 3) {
        pixel(ctx, x - 1, y, 103, 166, 57);
        pixel(ctx, x + 1, y + 1, 87, 148, 48);
      }
      for (let y = 2; y < 8; y++) {
        pixel(ctx, x, y, 219, 185, 64);
        pixel(ctx, x - 1, y + 1, 186, 151, 43);
        pixel(ctx, x + 1, y + 1, 238, 207, 91);
      }
    }
  },
  carrot_crop: (ctx, rng) => {
    for (const x of [3, 6, 9, 12]) {
      for (let y = 2; y < 9; y++) {
        pixel(ctx, x, y, 62, 139, 47);
        pixel(ctx, x - 1, y + 1, 86, 166, 58);
        pixel(ctx, x + 1, y + 1, 48, 117, 37);
      }
      for (let y = 9; y < 15; y++) {
        const w = y < 11 ? 2 : 1;
        for (let dx = -w; dx <= w; dx++) {
          pixel(ctx, x + dx, y, 232, 126, 34);
        }
      }
      pixel(ctx, x, 15, 184, 86, 22);
    }
  },
  potato_crop: (ctx, rng) => {
    for (const x of [3, 7, 11, 14]) {
      for (let y = 4; y < 14; y++) {
        pixel(ctx, x, y, 55, 124, 41);
        pixel(ctx, x - 1, y + 1, 76, 151, 53);
        pixel(ctx, x + 1, y + 1, 43, 103, 34);
      }
      for (let y = 3; y < 8; y += 2) {
        pixel(ctx, x - 1, y, 138, 174, 70);
        pixel(ctx, x + 1, y + 1, 119, 158, 58);
      }
    }
    for (const [x, y] of [[4, 13], [8, 12], [12, 14]]) {
      pixel(ctx, x, y, 154, 112, 63);
      pixel(ctx, x + 1, y, 124, 86, 47);
    }
  },
  beetroot_crop: (ctx, rng) => {
    for (const x of [4, 8, 12]) {
      for (let y = 2; y < 9; y++) {
        pixel(ctx, x, y, 55, 128, 48);
        pixel(ctx, x - 1, y + 1, 82, 158, 61);
        pixel(ctx, x + 1, y + 1, 42, 106, 39);
      }
      for (let y = 9; y < 14; y++) {
        pixel(ctx, x, y, 132, 34, 57);
        if (y > 10) pixel(ctx, x - 1, y, 102, 24, 44);
      }
      for (let y = 13; y < 16; y++) pixel(ctx, x, y, 178, 54, 79);
    }
    for (const [x, y] of [[6, 5], [10, 7], [14, 4]]) {
      pixel(ctx, x, y, 114, 45, 80);
      pixel(ctx, x + 1, y, 146, 62, 98);
    }
  },
  oak_fence: (ctx, rng) => {
    // Posts and rails on transparent pixels; the mesher draws this as two
    // crossed planes, which reads as a proper fence from every direction.
    for (let y = 0; y < 16; y++) {
      pixel(ctx, 6, y, 108, 74, 43);
      pixel(ctx, 7, y, 159, 115, 67);
      pixel(ctx, 8, y, 150, 106, 61);
      pixel(ctx, 9, y, 92, 61, 35);
    }
    for (const y of [3, 4, 10, 11]) {
      for (let x = 1; x < 15; x++) {
        const color = y % 2 ? [158, 114, 66] : [103, 70, 41];
        pixel(ctx, x, y, color[0], color[1], color[2]);
      }
    }
    for (const [x, y] of [[2, 2], [13, 5], [4, 12], [11, 9]]) {
      pixel(ctx, x, y, 186, 140, 84);
    }
  },
  bed_top: (ctx, rng) => {
    fillNoise(ctx, [158, 42, 42], 10, rng);
    // Wooden frame around the mattress.
    for (let i = 0; i < SIZE; i++) {
      pixel(ctx, i, 0, 104, 67, 37);
      pixel(ctx, i, 15, 88, 55, 30);
      pixel(ctx, 0, i, 104, 67, 37);
      pixel(ctx, 15, i, 88, 55, 30);
    }
    // White pillow at the head of the bed.
    for (let y = 2; y < 6; y++) {
      for (let x = 3; x < 13; x++) {
        const n = (rng() - 0.5) * 8;
        pixel(ctx, x, y, 236 + n, 236 + n, 228 + n);
      }
    }
    // Red blanket with a subtle fold.
    for (let y = 6; y < 14; y++) {
      for (let x = 2; x < 14; x++) {
        const shade = y === 9 ? -18 : 0;
        const n = (rng() - 0.5) * 10;
        pixel(ctx, x, y, 172 + shade + n, 44 + shade + n, 44 + shade + n);
      }
    }
    for (let x = 3; x < 13; x += 4) pixel(ctx, x, 7, 206, 74, 70);
  },
  bed_side: (ctx, rng) => {
    fillNoise(ctx, [124, 78, 44], 10, rng);
    // Red blanket on top of the wooden frame.
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < SIZE; x++) {
        const n = (rng() - 0.5) * 10;
        pixel(ctx, x, y, 168 + n, 42 + n, 42 + n);
      }
    }
    for (let y = 0; y < 6; y++) {
      for (let x = 1; x < 6; x++) {
        const n = (rng() - 0.5) * 8;
        pixel(ctx, x, y, 236 + n, 236 + n, 228 + n);
      }
    }
    // Frame rails and legs.
    for (let x = 0; x < SIZE; x++) pixel(ctx, x, 10, 100, 64, 35);
    for (const x of [1, 2, 13, 14]) {
      for (let y = 11; y < 16; y++) pixel(ctx, x, y, 92, 58, 31);
    }
    for (let x = 3; x < 13; x++) pixel(ctx, x, 12, 78, 49, 27);
  },
  iron_block: (ctx, rng) => {
    fillNoise(ctx, [198, 198, 204], 8, rng);
    for (let i = 0; i < 16; i++) {
      pixel(ctx, i, 0, 230, 230, 236);
      pixel(ctx, 0, i, 230, 230, 236);
      pixel(ctx, i, 15, 145, 145, 152);
      pixel(ctx, 15, i, 145, 145, 152);
    }
    sprinkle(ctx, rng, 7, [174, 174, 182], 255, 2);
  },
  gold_block: (ctx, rng) => {
    fillNoise(ctx, [230, 186, 44], 9, rng);
    for (let i = 0; i < 16; i++) {
      pixel(ctx, i, 0, 255, 224, 103);
      pixel(ctx, 0, i, 255, 224, 103);
      pixel(ctx, i, 15, 170, 128, 22);
      pixel(ctx, 15, i, 170, 128, 22);
    }
    sprinkle(ctx, rng, 8, [251, 212, 75], 255, 2);
  },
  diamond_block: (ctx, rng) => {
    fillNoise(ctx, [77, 212, 199], 10, rng);
    for (let i = 0; i < 16; i++) {
      pixel(ctx, i, 0, 140, 248, 236);
      pixel(ctx, 0, i, 140, 248, 236);
      pixel(ctx, i, 15, 38, 145, 139);
      pixel(ctx, 15, i, 38, 145, 139);
    }
    sprinkle(ctx, rng, 10, [173, 252, 242], 255, 1);
  },
  pumpkin_side: (ctx, rng) => {
    fillNoise(ctx, [214, 126, 30], 10, rng);
    for (let x = 1; x < 16; x += 4) for (let y = 0; y < 16; y++) pixel(ctx, x, y, 172, 92, 17);
    for (let i = 0; i < 6; i++) pixel(ctx, Math.floor(rng() * 16), Math.floor(rng() * 16), 238, 158, 48);
  },
  pumpkin_top: (ctx, rng) => {
    fillNoise(ctx, [211, 126, 32], 9, rng);
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) pixel(ctx, x, y, 102, 122, 44);
  },
  melon_side: (ctx, rng) => {
    fillNoise(ctx, [91, 153, 49], 10, rng);
    for (let x = 1; x < 16; x += 4) for (let y = 0; y < 16; y++) pixel(ctx, x, y, 51, 111, 38);
    for (let i = 0; i < 5; i++) pixel(ctx, Math.floor(rng() * 16), Math.floor(rng() * 16), 130, 185, 66);
  },
  melon_top: (ctx, rng) => {
    fillNoise(ctx, [96, 157, 51], 9, rng);
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(rng() * 12);
      const y = Math.floor(rng() * 12);
      for (let d = 0; d < 4; d++) pixel(ctx, x + d, y + d, 58, 118, 39);
    }
  },
  white_wool: (ctx, rng) => woolTexture(ctx, rng, [224, 224, 224]),
  red_wool: (ctx, rng) => woolTexture(ctx, rng, [176, 58, 55]),
  blue_wool: (ctx, rng) => woolTexture(ctx, rng, [57, 81, 168]),
  green_wool: (ctx, rng) => woolTexture(ctx, rng, [86, 130, 51]),
  yellow_wool: (ctx, rng) => woolTexture(ctx, rng, [214, 184, 55]),
  black_wool: (ctx, rng) => woolTexture(ctx, rng, [43, 43, 47]),
  bookshelf: (ctx, rng) => {
    planksTexture(ctx, rng);
    for (let y = 2; y < 14; y += 6) {
      for (let x = 1; x < 15; x++) pixel(ctx, x, y, 70, 47, 27);
      for (let x = 1; x < 15; x++) pixel(ctx, x, y + 5, 70, 47, 27);
      const colors = [[162, 52, 47], [57, 96, 147], [86, 130, 58], [169, 140, 47]];
      for (let x = 2; x < 15; x += 3) {
        const c = colors[Math.floor(rng() * colors.length)];
        for (let yy = 1; yy <= 4; yy++) {
          for (let xx = 0; xx < 2; xx++) pixel(ctx, x + xx, y + yy, c[0], c[1], c[2]);
        }
      }
    }
  },
  netherrack: (ctx, rng) => {
    fillNoise(ctx, [92, 40, 40], 18, rng);
    sprinkle(ctx, rng, 26, [58, 24, 24], 255, 1);
    sprinkle(ctx, rng, 14, [128, 55, 52], 255, 1);
  },
  soul_sand: (ctx, rng) => {
    fillNoise(ctx, [86, 66, 55], 12, rng);
    sprinkle(ctx, rng, 22, [54, 40, 33], 255, 2);
    sprinkle(ctx, rng, 8, [124, 98, 79], 255, 1);
  },
  nether_bricks: (ctx, rng) => {
    fillNoise(ctx, [58, 30, 34], 8, rng);
    for (let y = 0; y < 16; y += 4) {
      for (let x = 0; x < 16; x++) pixel(ctx, x, y, 30, 15, 18);
      const off = (y / 4) % 2 === 0 ? 0 : 8;
      for (let x = off; x < 16; x += 8) {
        for (let yy = 0; yy < 4; yy++) pixel(ctx, x, y + yy, 30, 15, 18);
      }
    }
    sprinkle(ctx, rng, 12, [80, 43, 47], 255, 1);
  },
  magma: (ctx, rng) => {
    fillNoise(ctx, [48, 26, 22], 10, rng);
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(rng() * 16);
      const y = Math.floor(rng() * 16);
      pixel(ctx, x, y, 210, 110, 26);
      pixel(ctx, (x + 1) % 16, y, 250, 170, 40);
    }
    sprinkle(ctx, rng, 12, [20, 10, 9], 255, 2);
  },
  quartz_ore: (ctx, rng) => {
    fillNoise(ctx, [92, 40, 40], 16, rng);
    for (let i = 0; i < 9; i++) {
      const x = 1 + Math.floor(rng() * 14);
      const y = 1 + Math.floor(rng() * 14);
      pixel(ctx, x, y, 236, 228, 220);
      pixel(ctx, x + 1, y, 200, 190, 184);
      pixel(ctx, x, y + 1, 210, 200, 194);
    }
  },
  nether_portal: (ctx, rng) => {
    fillNoise(ctx, [74, 20, 118], 14, rng);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rng() * 16);
      const y = Math.floor(rng() * 16);
      pixel(ctx, x, y, 150, 84, 220);
      pixel(ctx, (x + 1) % 16, (y + 2) % 16, 108, 48, 178);
    }
    sprinkle(ctx, rng, 10, [206, 154, 255], 255, 1);
  },
  end_stone: (ctx, rng) => {
    fillNoise(ctx, [220, 222, 168], 10, rng);
    sprinkle(ctx, rng, 18, [190, 194, 136], 255, 2);
    sprinkle(ctx, rng, 8, [240, 242, 200], 255, 1);
  },
  end_portal_frame_top: (ctx, rng) => {
    fillNoise(ctx, [88, 106, 88], 10, rng);
    for (let y = 3; y < 13; y++) {
      for (let x = 3; x < 13; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (d < 2.6) pixel(ctx, x, y, 24, 40, 36);
        else if (d < 3.6) pixel(ctx, x, y, 58, 78, 62);
      }
    }
  },
  end_portal_frame_side: (ctx, rng) => {
    fillNoise(ctx, [196, 200, 150], 10, rng);
    for (let x = 0; x < 16; x++) {
      pixel(ctx, x, 5, 128, 142, 110);
      pixel(ctx, x, 6, 168, 178, 132);
    }
  },
  end_portal: (ctx, rng) => {
    fillNoise(ctx, [8, 8, 18], 6, rng);
    for (let i = 0; i < 22; i++) {
      const x = Math.floor(rng() * 16);
      const y = Math.floor(rng() * 16);
      const c = rng() < 0.5 ? [120, 220, 210] : [90, 100, 190];
      pixel(ctx, x, y, c[0], c[1], c[2]);
    }
  },
  purpur_block: (ctx, rng) => {
    fillNoise(ctx, [150, 106, 152], 10, rng);
    sprinkle(ctx, rng, 14, [108, 72, 112], 255, 2);
    sprinkle(ctx, rng, 8, [186, 142, 188], 255, 1);
  },
  hay_block_top: (ctx, rng) => {
    fillNoise(ctx, [196, 170, 56], 10, rng);
    sprinkle(ctx, rng, 20, [150, 124, 34], 255, 1);
  },
  hay_block_side: (ctx, rng) => {
    fillNoise(ctx, [204, 178, 60], 10, rng);
    for (let y = 2; y < 16; y += 5) for (let x = 0; x < 16; x++) pixel(ctx, x, y, 160, 132, 38);
    sprinkle(ctx, rng, 16, [230, 204, 86], 255, 2);
  },
  emerald_ore: (ctx, rng) => {
    fillNoise(ctx, [126, 126, 126], 14, rng);
    for (let i = 0; i < 9; i++) {
      const x = 1 + Math.floor(rng() * 14);
      const y = 1 + Math.floor(rng() * 14);
      pixel(ctx, x, y, 46, 210, 100);
      pixel(ctx, x + 1, y, 24, 160, 74);
      pixel(ctx, x, y + 1, 26, 178, 82);
    }
  },
  emerald_block: (ctx, rng) => {
    fillNoise(ctx, [54, 200, 112], 12, rng);
    sprinkle(ctx, rng, 18, [30, 150, 78], 255, 2);
    sprinkle(ctx, rng, 10, [120, 246, 168], 255, 1);
  },
  torch_stick: (ctx) => {
    for (let y = 5; y < 16; y++) {
      pixel(ctx, 7, y, 104, 68, 38);
      pixel(ctx, 8, y, 142, 98, 55);
    }
  },
  torch_flame: (ctx) => {
    const flame = [
      [7, 1, 255, 244, 176], [8, 1, 255, 226, 120],
      [6, 2, 255, 186, 46], [7, 2, 255, 250, 208], [8, 2, 255, 222, 96], [9, 2, 246, 150, 32],
      [6, 3, 238, 128, 22], [7, 3, 255, 206, 72], [8, 3, 255, 186, 48], [9, 3, 226, 110, 20],
      [7, 4, 208, 84, 16], [8, 4, 236, 128, 26],
    ];
    for (const [x, y, r, g, b] of flame) pixel(ctx, x, y, r, g, b);
  },

  // The two halves share one continuous panel, so neither tile draws a
  // horizontal frame at its own top/bottom edge — that made a 2-block door
  // look like two separate square doors stacked on each other.
  door_top: (ctx, rng) => {
    fillNoise(ctx, [150, 103, 58], 8, rng);
    for (const x of [2, 7, 12]) {
      for (let y = 0; y < SIZE; y++) {
        pixel(ctx, x, y, 96, 62, 34);
        pixel(ctx, x + 1, y, 178, 128, 75);
      }
    }
  },
  door_bottom: (ctx, rng) => {
    fillNoise(ctx, [150, 103, 58], 8, rng);
    for (const x of [2, 7, 12]) {
      for (let y = 0; y < SIZE; y++) {
        pixel(ctx, x, y, 96, 62, 34);
        pixel(ctx, x + 1, y, 178, 128, 75);
      }
    }
    for (let y = 6; y < 10; y++) pixel(ctx, 13, y, 232, 196, 82);
  },

  lever_off: (ctx) => {
    for (let x = 5; x <= 10; x++) {
      for (let y = 11; y <= 14; y++) pixel(ctx, x, y, 96, 96, 102);
    }
    for (let i = 0; i < 7; i++) pixel(ctx, 7 + i, 12 - i, 152, 104, 58);
    pixel(ctx, 6, 12, 206, 58, 48);
  },
  lever_on: (ctx) => {
    for (let x = 5; x <= 10; x++) {
      for (let y = 11; y <= 14; y++) pixel(ctx, x, y, 96, 96, 102);
    }
    for (let i = 0; i < 7; i++) pixel(ctx, 7 + i, 4 + i, 152, 104, 58);
    pixel(ctx, 6, 4, 255, 96, 64);
  },

  button_off: (ctx) => {
    for (let y = 5; y <= 10; y++) {
      for (let x = 5; x <= 10; x++) pixel(ctx, x, y, x === 5 || y === 5 ? 150 : 110, 110, 110);
    }
    pixel(ctx, 7, 7, 196, 62, 52);
  },
  button_on: (ctx) => {
    for (let y = 6; y <= 9; y++) {
      for (let x = 6; x <= 9; x++) pixel(ctx, x, y, 160, 160, 166);
    }
    pixel(ctx, 7, 7, 255, 112, 80);
  },

  plate_off: (ctx) => {
    for (let y = 3; y <= 12; y++) {
      for (let x = 3; x <= 12; x++) {
        const edge = x === 3 || x === 12 || y === 3 || y === 12;
        pixel(ctx, x, y, edge ? 102 : 136, edge ? 102 : 136, edge ? 108 : 142);
      }
    }
  },
  plate_on: (ctx) => {
    for (let y = 4; y <= 11; y++) {
      for (let x = 4; x <= 11; x++) pixel(ctx, x, y, 174, 174, 180);
    }
    pixel(ctx, 7, 7, 255, 108, 72);
  },

  wire_off: (ctx) => {
    for (let i = 0; i < SIZE; i++) {
      for (const d of [7, 8]) {
        pixel(ctx, i, d, 88, 26, 26);
        pixel(ctx, d, i, 88, 26, 26);
      }
    }
    pixel(ctx, 7, 7, 124, 40, 40);
  },
  wire_on: (ctx) => {
    for (let i = 0; i < SIZE; i++) {
      for (const d of [7, 8]) {
        pixel(ctx, i, d, 226, 44, 44);
        pixel(ctx, d, i, 226, 44, 44);
      }
    }
    pixel(ctx, 7, 7, 255, 132, 110);
    pixel(ctx, 8, 8, 255, 96, 80);
  },

  repeater_off: (ctx, rng) => {
    fillNoise(ctx, [86, 82, 88], 8, rng);
    for (let x = 3; x <= 12; x++) {
      for (let y = 4; y <= 11; y++) pixel(ctx, x, y, 118, 114, 120);
    }
    pixel(ctx, 5, 8, 196, 62, 52);
    pixel(ctx, 10, 8, 92, 34, 34);
  },
  repeater_on: (ctx, rng) => {
    fillNoise(ctx, [86, 82, 88], 8, rng);
    for (let x = 3; x <= 12; x++) {
      for (let y = 4; y <= 11; y++) pixel(ctx, x, y, 132, 126, 132);
    }
    pixel(ctx, 5, 8, 255, 116, 78);
    pixel(ctx, 10, 8, 255, 68, 52);
  },

  piston_side: (ctx, rng) => {
    fillNoise(ctx, [126, 92, 58], 8, rng);
    for (let y = 3; y < 13; y++) {
      pixel(ctx, 3, y, 158, 158, 164);
      pixel(ctx, 12, y, 158, 158, 164);
    }
    pixel(ctx, 8, 8, 92, 92, 98);
  },
  piston_top: (ctx, rng) => {
    fillNoise(ctx, [150, 106, 64], 8, rng);
    for (let i = 2; i < 14; i++) pixel(ctx, i, 2, 106, 74, 42);
  },
  piston_front: (ctx, rng) => {
    fillNoise(ctx, [96, 96, 102], 8, rng);
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) pixel(ctx, x, y, 140, 140, 146);
    }
    pixel(ctx, 8, 8, 208, 62, 52);
  },
  piston_head_side: (ctx, rng) => {
    fillNoise(ctx, [142, 142, 148], 8, rng);
    for (let y = 2; y < 14; y++) pixel(ctx, 12, y, 96, 96, 102);
  },
  piston_head_top: (ctx, rng) => {
    fillNoise(ctx, [168, 168, 174], 8, rng);
    for (let i = 2; i < 14; i++) pixel(ctx, i, 8, 192, 68, 56);
  },

  lamp_off: (ctx, rng) => {
    fillNoise(ctx, [82, 82, 88], 8, rng);
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) pixel(ctx, x, y, 126, 120, 72);
    }
  },
  lamp_on: (ctx, rng) => {
    fillNoise(ctx, [92, 92, 98], 8, rng);
    for (let y = 3; y < 13; y++) {
      for (let x = 3; x < 13; x++) pixel(ctx, x, y, 255, 232, 156);
    }
    for (const [x, y] of [[6, 6], [10, 7], [7, 10]]) pixel(ctx, x, y, 255, 255, 226);
  },
  redstone_block: (ctx, rng) => {
    fillNoise(ctx, [178, 34, 34], 10, rng);
    for (let y = 0; y < SIZE; y += 4) {
      for (let x = 0; x < SIZE; x += 4) pixel(ctx, x, y, 226, 66, 60);
    }
    sprinkle(ctx, rng, 24, [255, 108, 92], 255, 1);
  },
  redstone_ore: (ctx, rng) => {
    stoneBase(ctx, rng);
    sprinkle(ctx, rng, 16, [206, 42, 42], 255, 2);
    sprinkle(ctx, rng, 8, [255, 96, 88], 255, 1);
  },
  farmland: (ctx, rng) => {
    fillNoise(ctx, [92, 62, 34], 12, rng);
    // Damp furrows make tilled soil read differently from plain dirt.
    for (let x = 0; x < SIZE; x += 4) {
      for (let y = 0; y < SIZE; y++) {
        pixel(ctx, x, y, 58, 38, 22);
        pixel(ctx, x + 1, y, 74, 48, 26);
      }
    }
    for (let x = 2; x < SIZE; x += 4) {
      for (let y = 0; y < SIZE; y += 5) pixel(ctx, x, y + (rng() > 0.5 ? 1 : 0), 118, 82, 48);
    }
  },
  millet_crop: (ctx, rng) => {
    // Tall golden stalks with drooping grain heads.
    for (const x of [2, 5, 8, 11, 14]) {
      for (let y = 5; y < 16; y++) pixel(ctx, x, y, 96, 148, 48);
      for (let y = 2; y < 8; y++) {
        pixel(ctx, x - 1, y, 226, 190, 72);
        pixel(ctx, x, y, 250, 218, 104);
        pixel(ctx, x + 1, y + 1, 198, 158, 52);
      }
      if (rng() > 0.5) pixel(ctx, x - 2, 7, 244, 208, 86);
    }
  },
  chest_top: (ctx, rng) => {
    planksTexture(ctx, rng, [146, 98, 54]);
    // Dark frame and a bright rim around the lid.
    for (let i = 0; i < SIZE; i++) {
      pixel(ctx, i, 0, 74, 46, 26);
      pixel(ctx, i, 15, 74, 46, 26);
      pixel(ctx, 0, i, 74, 46, 26);
      pixel(ctx, 15, i, 74, 46, 26);
      pixel(ctx, i, 2, 182, 132, 74);
      pixel(ctx, i, 13, 182, 132, 74);
      pixel(ctx, 2, i, 182, 132, 74);
      pixel(ctx, 13, i, 182, 132, 74);
    }
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) pixel(ctx, x, y, 132, 88, 46);
    }
  },
  chest_side: (ctx, rng) => {
    planksTexture(ctx, rng, [146, 98, 54]);
    for (let y = 0; y < SIZE; y++) {
      pixel(ctx, 1, y, 58, 56, 54);
      pixel(ctx, 2, y, 92, 88, 82);
      pixel(ctx, 13, y, 92, 88, 82);
      pixel(ctx, 14, y, 58, 56, 54);
    }
    for (let x = 0; x < SIZE; x++) {
      pixel(ctx, x, 3, 58, 56, 54);
      pixel(ctx, x, 4, 92, 88, 82);
      pixel(ctx, x, 12, 92, 88, 82);
      pixel(ctx, x, 13, 58, 56, 54);
    }
    for (let y = 6; y < 11; y++) {
      pixel(ctx, 7, y, 226, 184, 62);
    }
  },
  chest_front: (ctx, rng) => {
    planksTexture(ctx, rng, [146, 98, 54]);
    for (let y = 0; y < SIZE; y++) {
      pixel(ctx, 1, y, 58, 56, 54);
      pixel(ctx, 2, y, 92, 88, 82);
      pixel(ctx, 13, y, 92, 88, 82);
      pixel(ctx, 14, y, 58, 56, 54);
    }
    for (let x = 0; x < SIZE; x++) {
      pixel(ctx, x, 3, 58, 56, 54);
      pixel(ctx, x, 4, 92, 88, 82);
      pixel(ctx, x, 12, 92, 88, 82);
      pixel(ctx, x, 13, 58, 56, 54);
    }
    // Central iron latch with a golden keyhole.
    for (let y = 5; y < 12; y++) {
      for (let x = 6; x < 10; x++) pixel(ctx, x, y, y === 5 || y === 11 ? 54 : 76, 72, 70);
    }
    pixel(ctx, 7, 7, 236, 196, 72);
    pixel(ctx, 8, 7, 236, 196, 72);
    pixel(ctx, 8, 8, 236, 196, 72);
    pixel(ctx, 8, 9, 236, 196, 72);
  },
  tall_grass: (ctx, rng) => {
    for (const x of [3, 6, 9, 12]) {
      const top = 2 + Math.floor(rng() * 4);
      for (let y = top; y < 16; y++) {
        pixel(ctx, x + (y > 11 ? 1 : 0), y, 82, 146 + Math.floor(rng() * 24), 56);
      }
      pixel(ctx, x - 1, top + 2, 104, 168, 62);
      pixel(ctx, x + 2, top + 3, 68, 132, 48);
    }
  },
  dandelion: (ctx) => {
    for (let y = 9; y < 16; y++) pixel(ctx, 8, y, 74, 136, 52);
    pixel(ctx, 7, 12, 58, 116, 44);
    pixel(ctx, 9, 11, 92, 158, 58);
    for (const [x, y] of [[8, 3], [8, 7], [4, 5], [12, 5], [5, 2], [11, 2], [5, 8], [11, 8]]) {
      pixel(ctx, x, y, 246, 214, 68);
    }
    pixel(ctx, 8, 5, 255, 242, 132);
  },
  poppy: (ctx) => {
    for (let y = 9; y < 16; y++) pixel(ctx, 8, y, 64, 124, 46);
    pixel(ctx, 7, 12, 88, 152, 54);
    pixel(ctx, 6, 10, 54, 112, 40);
    for (const [x, y] of [[8, 3], [8, 7], [4, 5], [12, 5], [5, 2], [11, 2], [5, 8], [11, 8]]) {
      pixel(ctx, x, y, 210, 42, 42);
    }
    pixel(ctx, 8, 5, 36, 34, 28);
  },
  dead_bush: (ctx, rng) => {
    for (const [x0, x1, top] of [[4, 1, 5], [8, 8, 3], [12, 15, 6]]) {
      for (let y = top; y < 16; y++) {
        const x = x0 + Math.round((x1 - x0) * ((y - top) / (16 - top)));
        pixel(ctx, x, y, 112, 82, 48);
        if (rng() > 0.7) pixel(ctx, x + 1, y, 88, 64, 38);
      }
    }
  },
  // Dynamite: red casing with a lighter band, dark straps and a fuse knot.
  tnt: (ctx, rng) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const shade = rng() > 0.8 ? 12 : 0;
        pixel(ctx, x, y, 186 - shade, 44 - shade * 0.4, 36 - shade * 0.4);
      }
    }
    // Paper band across the middle with the dark "TNT" stamp.
    for (let y = 5; y <= 10; y++) {
      for (let x = 0; x < 16; x++) pixel(ctx, x, y, 224, 214, 196);
    }
    for (const x of [3, 8, 12]) for (let y = 6; y <= 9; y++) pixel(ctx, x, y, 40, 34, 30);
    pixel(ctx, 4, 6, 40, 34, 30); pixel(ctx, 4, 9, 40, 34, 30);
    pixel(ctx, 9, 6, 40, 34, 30); pixel(ctx, 11, 6, 40, 34, 30);
    // Dark straps and a shadowed top rim.
    for (const y of [0, 15]) for (let x = 0; x < 16; x++) pixel(ctx, x, y, 120, 26, 22);
    for (const x of [0, 15]) for (let y = 0; y < 16; y++) pixel(ctx, x, y, 132, 30, 24);
    for (let x = 7; x <= 8; x++) pixel(ctx, x, 1, 60, 52, 44);
    pixel(ctx, 8, 2, 46, 40, 34);
  },
};

function makeCanvas(size = SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function buildTileCanvases() {
  const canvases = new Map();
  for (let i = 0; i < TEXTURE_NAMES.length; i++) {
    const name = TEXTURE_NAMES[i];
    const { canvas, ctx } = makeCanvas();
    const painter = PAINTERS[name];
    if (!painter) throw new Error(`Missing texture painter: ${name}`);
    painter(ctx, mulberry32(0x51ed + i * 7919));
    canvases.set(i, canvas);
    canvases.set(name, canvas);
  }
  return canvases;
}

function buildTextureArrayData(tileCanvases) {
  const layerSize = SIZE * SIZE * 4;
  const data = new Uint8Array(layerSize * TEXTURE_NAMES.length);
  for (let layer = 0; layer < TEXTURE_NAMES.length; layer++) {
    const canvas = tileCanvases.get(layer);
    const ctx = canvas.getContext('2d');
    const image = ctx.getImageData(0, 0, SIZE, SIZE).data;
    data.set(image, layer * layerSize);
  }
  return data;
}

function setIconPixel(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function makeItemIconCanvas(item) {
  const { canvas, ctx } = makeCanvas(16);
  const key = item.icon;

  const drawHandle = () => {
    for (let i = 0; i < 11; i++) {
      setIconPixel(ctx, 3 + i, 13 - i, '#6b4325');
      setIconPixel(ctx, 4 + i, 13 - i, '#a06a3d');
    }
  };

  if (item.tool && key === 'bow') {
    for (let y = 2; y <= 13; y++) {
      const x = 6 + Math.round(Math.sin(((y - 2) / 11) * Math.PI) * 2);
      setIconPixel(ctx, x, y, '#6b4325');
      setIconPixel(ctx, x + 1, y, '#a06a3d');
      setIconPixel(ctx, 12, y, '#d8d8d8');
    }
    for (let x = 5; x <= 12; x++) setIconPixel(ctx, x, 8, '#b7b7bd');
    setIconPixel(ctx, 13, 8, '#e8e8ee');
    return canvas;
  }

  if (item.tool) {
    const material = item.iconMaterial;
    const colors = {
      wood: ['#8d5a2f', '#b07a42'],
      stone: ['#6f6f6f', '#a3a3a3'],
      iron: ['#b7b7bd', '#e8e8ee'],
      diamond: ['#2ab8ad', '#7df5e9'],
      gold: ['#d9a928', '#ffe785'],
      netherite: ['#3b3743', '#8a8298'],
    }[material];
    drawHandle();
    if (key === 'pickaxe') {
      for (let x = 7; x <= 14; x++) {
        const y = 2 + Math.round(Math.abs(10 - x) * 0.45);
        setIconPixel(ctx, x, y, colors[0]);
        setIconPixel(ctx, x, y + 1, colors[1]);
      }
      setIconPixel(ctx, 7, 4, colors[0]);
      setIconPixel(ctx, 13, 4, colors[0]);
    } else if (key === 'axe') {
      for (let y = 2; y <= 7; y++) {
        setIconPixel(ctx, 10, y, colors[0]);
        setIconPixel(ctx, 11, y, colors[1]);
        setIconPixel(ctx, 12, y, colors[0]);
      }
      setIconPixel(ctx, 9, 3, colors[1]);
      setIconPixel(ctx, 9, 4, colors[1]);
    } else if (key === 'shovel') {
      for (let y = 2; y <= 6; y++) {
        for (let x = 11; x <= 14; x++) setIconPixel(ctx, x, y, colors[0]);
      }
      setIconPixel(ctx, 12, 3, colors[1]);
      setIconPixel(ctx, 13, 4, colors[1]);
    } else if (key === 'sword') {
      for (let i = 0; i < 11; i++) {
        setIconPixel(ctx, 5 + i, 11 - i, colors[1]);
        setIconPixel(ctx, 4 + i, 11 - i, colors[0]);
      }
      for (let i = 0; i < 5; i++) setIconPixel(ctx, 2 + i, 10 + (i % 2), '#6b4325');
    } else if (key === 'spear') {
      for (let i = 0; i < 10; i++) {
        setIconPixel(ctx, 4 + i, 12 - i, '#6b4325');
        setIconPixel(ctx, 5 + i, 12 - i, '#a06a3d');
      }
      for (let i = 0; i < 4; i++) {
        setIconPixel(ctx, 13 + Math.floor(i / 2), 3 - i, colors[0]);
        setIconPixel(ctx, 14, 2 - Math.floor(i / 2), colors[1]);
      }
      setIconPixel(ctx, 15, 1, colors[1]);
    } else if (key === 'hoe') {
      for (let y = 3; y <= 6; y++) {
        setIconPixel(ctx, 10, y, colors[0]);
        setIconPixel(ctx, 11, y, colors[1]);
      }
      for (let x = 8; x <= 14; x++) setIconPixel(ctx, x, 3, colors[0]);
      setIconPixel(ctx, 14, 2, colors[1]);
      setIconPixel(ctx, 13, 2, colors[1]);
    }
    return canvas;
  }

  if (key === 'stick') {
    for (let i = 0; i < 10; i++) {
      setIconPixel(ctx, 5 + i, 12 - i, '#6b4325');
      setIconPixel(ctx, 6 + i, 12 - i, '#a06a3d');
    }
  } else if (key === 'arrow') {
    for (let x = 2; x <= 13; x++) {
      setIconPixel(ctx, x, 8, '#6b4325');
      setIconPixel(ctx, x, 9, '#a06a3d');
    }
    setIconPixel(ctx, 14, 8, '#b7b7bd');
    setIconPixel(ctx, 14, 9, '#e8e8ee');
    setIconPixel(ctx, 15, 8, '#e8e8ee');
    setIconPixel(ctx, 2, 7, '#d8d8d8');
    setIconPixel(ctx, 2, 10, '#d8d8d8');
  } else if (key === 'coal') {
    const shape = [
      '...1111...',
      '..122221..',
      '.12222221.',
      '1222122221',
      '1222221221',
      '.12222221.',
      '..122221..',
      '...1111...',
    ];
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (shape[y][x] === '1') setIconPixel(ctx, x + 2, y + 4, '#151515');
        if (shape[y][x] === '2') setIconPixel(ctx, x + 2, y + 4, '#353535');
      }
    }
    setIconPixel(ctx, 6, 6, '#6a6a6a');
  } else if (key === 'iron_ingot' || key === 'gold_ingot') {
    const c1 = key === 'iron_ingot' ? '#d8d8de' : '#f4ce47';
    const c2 = key === 'iron_ingot' ? '#9c9ca5' : '#b58b1c';
    for (let y = 6; y < 12; y++) {
      for (let x = 3; x < 13; x++) {
        if (x + y < 12 || x - y > 3) continue;
        setIconPixel(ctx, x, y, y < 8 ? c1 : c2);
      }
    }
  } else if (key === 'diamond') {
    for (let y = 4; y < 12; y++) {
      const w = y < 8 ? y - 3 : 12 - y;
      for (let x = 8 - w; x <= 7 + w; x++) {
        setIconPixel(ctx, x, y, (x + y) % 3 === 0 ? '#c6fff9' : '#39d6c8');
      }
    }
  } else if (key === 'apple' || key === 'golden_apple') {
    const c1 = key === 'apple' ? '#cf3b36' : '#f4ce47';
    const c2 = key === 'apple' ? '#8f211f' : '#b58b1c';
    for (let y = 4; y < 13; y++) {
      const w = y < 6 ? 3 : y < 11 ? 5 : 3;
      for (let x = 8 - w; x <= 7 + w; x++) setIconPixel(ctx, x, y, (x + y) % 4 === 0 ? c2 : c1);
    }
    setIconPixel(ctx, 7, 2, '#5a3a1d');
    setIconPixel(ctx, 8, 3, '#5a3a1d');
    setIconPixel(ctx, 9, 2, '#5b9b36');
    setIconPixel(ctx, 10, 2, '#5b9b36');
    setIconPixel(ctx, 10, 1, '#7cc64c');
  } else if (key === 'flint') {
    const shape = [
      '....11....',
      '...1221...',
      '..122221..',
      '.12222221.',
      '1222222221',
      '1222122221',
      '.12222221.',
      '..111111..',
    ];
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (shape[y][x] === '1') setIconPixel(ctx, x + 3, y + 4, '#2e2e34');
        if (shape[y][x] === '2') setIconPixel(ctx, x + 3, y + 4, '#5f6068');
      }
    }
  }
  drawExtraItemIcon(ctx, key, item);
  return canvas;
}

/** Extra item icons added with the animal/dimension/armor updates. */
function drawExtraItemIcon(ctx, key, item = null) {
  const rect = (x, y, w, h, color) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setIconPixel(ctx, xx, yy, color);
  };
  const armorColors = {
    leather: ['#8a5a2c', '#b07a42', '#5c3a1a'],
    iron: ['#9c9ca5', '#e8e8ee', '#6f6f78'],
    diamond: ['#2ab8ad', '#7df5e9', '#1a7d75'],
    gold: ['#d9a928', '#ffe785', '#8f6914'],
    netherite: ['#3b3743', '#8a8298', '#211e27'],
  }[item?.iconMaterial] ?? ['#9c9ca5', '#e8e8ee', '#6f6f78'];
  if (key === 'helmet') {
    const [base, light, dark] = armorColors;
    rect(4, 4, 8, 6, base);
    rect(3, 6, 10, 3, base);
    rect(4, 4, 8, 1, light);
    rect(3, 6, 10, 1, light);
    rect(4, 9, 8, 1, dark);
    rect(5, 10, 2, 2, dark);
    rect(9, 10, 2, 2, dark);
    setIconPixel(ctx, 6, 6, dark);
    setIconPixel(ctx, 9, 6, dark);
  } else if (key === 'chestplate') {
    const [base, light, dark] = armorColors;
    rect(4, 4, 8, 8, base);
    rect(2, 4, 2, 4, base);
    rect(12, 4, 2, 4, base);
    rect(4, 4, 8, 1, light);
    rect(2, 4, 2, 1, light);
    rect(12, 4, 2, 1, light);
    rect(6, 5, 4, 6, dark);
    rect(6, 5, 4, 1, base);
    rect(4, 11, 8, 1, dark);
  } else if (key === 'leggings') {
    const [base, light, dark] = armorColors;
    rect(4, 4, 8, 3, base);
    rect(4, 4, 8, 1, light);
    rect(4, 7, 3, 6, base);
    rect(9, 7, 3, 6, base);
    rect(4, 7, 1, 6, light);
    rect(9, 7, 1, 6, light);
    rect(4, 12, 3, 1, dark);
    rect(9, 12, 3, 1, dark);
  } else if (key === 'boots') {
    const [base, light, dark] = armorColors;
    rect(3, 7, 4, 5, base);
    rect(9, 7, 4, 5, base);
    rect(3, 7, 4, 1, light);
    rect(9, 7, 4, 1, light);
    rect(2, 11, 6, 2, dark);
    rect(8, 11, 6, 2, dark);
    rect(3, 8, 1, 3, light);
    rect(9, 8, 1, 3, light);
  } else if (key === 'flint_and_steel') {
    rect(3, 8, 8, 4, '#9c9ca5');
    rect(3, 8, 8, 1, '#d8d8de');
    rect(10, 2, 3, 7, '#bfc0c8');
    setIconPixel(ctx, 11, 3, '#f4e27a');
    setIconPixel(ctx, 11, 4, '#e0a326');
    setIconPixel(ctx, 8, 11, '#5f6068');
  } else if (key === 'bucket' || key === 'water_bucket' || key === 'lava_bucket') {
    const fill = key === 'water_bucket' ? '#3b7bd6' : key === 'lava_bucket' ? '#e07a1c' : null;
    for (let y = 5; y < 13; y++) {
      const w = y < 11 ? 8 : 6;
      for (let x = 8 - (w >> 1); x < 8 + (w >> 1); x++) {
        setIconPixel(ctx, x, y, y < 7 && fill ? fill : y < 10 ? '#a8a8b0' : '#7c7c86');
      }
    }
    for (let x = 4; x < 12; x++) setIconPixel(ctx, x, 4, '#d8d8de');
    if (fill) rect(6, 5, 4, 2, fill);
  } else if (key === 'shears') {
    rect(3, 10, 6, 2, '#9ea0a8');
    for (let i = 0; i < 7; i++) setIconPixel(ctx, 5 + i, 9 - i, '#c8cad2');
    for (let i = 0; i < 7; i++) setIconPixel(ctx, 11 - i, 9 - i, '#8a8c96');
  } else if (key === 'saddle') {
    rect(3, 6, 10, 4, '#8a4a24');
    rect(3, 6, 10, 1, '#b26532');
    rect(5, 10, 2, 3, '#5c2f16');
    rect(9, 10, 2, 3, '#5c2f16');
  } else if (key === 'feather') {
    for (let i = 0; i < 8; i++) {
      setIconPixel(ctx, 10 - i, 3 + i, '#e8e8f0');
      setIconPixel(ctx, 11 - i, 3 + i, '#c4c4d2');
      setIconPixel(ctx, 9 - i, 4 + i, '#f4f4fa');
    }
    setIconPixel(ctx, 3, 11, '#8a8a96');
  } else if (key === 'bone') {
    rect(5, 3, 2, 10, '#e8e6da');
    rect(9, 3, 2, 10, '#d4d2c6');
    rect(3, 2, 4, 3, '#f4f2e8');
    rect(10, 2, 4, 3, '#f4f2e8');
    rect(3, 11, 4, 3, '#d4d2c6');
    rect(10, 11, 4, 3, '#d4d2c6');
  } else if (key === 'string') {
    for (let i = 0; i < 12; i++) setIconPixel(ctx, 3 + ((i * 5) % 10), 2 + i, '#e8e8e8');
  } else if (key === 'gunpowder') {
    for (let i = 0; i < 20; i++) {
      const x = 3 + ((i * 7) % 10);
      const y = 5 + ((i * 5) % 8);
      setIconPixel(ctx, x, y, i % 3 ? '#6a6a6a' : '#3a3a3a');
    }
  } else if (key === 'ender_pearl' || key === 'eye_of_ender') {
    for (let y = 3; y < 13; y++) {
      const w = y < 6 ? y - 2 : y < 11 ? 5 : 12 - y;
      for (let x = 8 - w; x <= 7 + w; x++) {
        setIconPixel(ctx, x, y, (x + y) % 3 === 0 ? '#9ff4d0' : '#2a8f72');
      }
    }
    if (key === 'eye_of_ender') rect(7, 6, 2, 4, '#1d3a58');
  } else if (key === 'blaze_powder') {
    for (let i = 0; i < 16; i++) {
      const x = 3 + ((i * 5) % 10);
      const y = 4 + ((i * 7) % 9);
      setIconPixel(ctx, x, y, i % 2 ? '#ffd23c' : '#e08a1c');
    }
  } else if (key === 'egg') {
    for (let y = 4; y < 12; y++) {
      const w = y < 6 ? 2 : y < 10 ? 4 : 3;
      for (let x = 8 - w; x < 8 + w; x++) setIconPixel(ctx, x, y, '#ece6d4');
    }
    setIconPixel(ctx, 6, 6, '#c8b98e');
    setIconPixel(ctx, 9, 8, '#c8b98e');
  } else if (key === 'fish') {
    for (let x = 4; x <= 11; x++) {
      const half = x < 6 || x > 9 ? 2 : 3;
      for (let y = 8 - half; y <= 8 + half; y++) {
        setIconPixel(ctx, x, y, (x + y) % 4 === 0 ? '#7fd8e8' : '#49a8c4');
      }
    }
    for (let i = 0; i < 4; i++) {
      setIconPixel(ctx, 12 + (i < 2 ? 0 : 1), 5 + i, '#3b8fb0');
      setIconPixel(ctx, 12 + (i < 2 ? 0 : 1), 10 + (3 - i), '#3b8fb0');
    }
    setIconPixel(ctx, 5, 7, '#102a38');
    setIconPixel(ctx, 7, 5, '#2f7d99');
  } else if (key === 'honey_bottle') {
    rect(6, 5, 4, 6, '#e8a92a');
    rect(6, 5, 4, 1, '#f6cf62');
    rect(7, 2, 2, 3, '#c8d0d8');
    setIconPixel(ctx, 7, 1, '#8a5a1c');
  } else if (key === 'emerald') {
    for (let y = 3; y < 13; y++) {
      const w = y < 7 ? y - 2 : 13 - y;
      for (let x = 8 - w; x <= 7 + w; x++) setIconPixel(ctx, x, y, (x + y) % 3 === 0 ? '#a8f4be' : '#2ecb6a');
    }
  } else if (key === 'wheat') {
    for (let i = 0; i < 11; i++) setIconPixel(ctx, 8, 2 + i, '#b8a04a');
    for (let y = 3; y < 12; y += 2) {
      setIconPixel(ctx, 7, y, '#e0c860');
      setIconPixel(ctx, 9, y, '#e0c860');
      setIconPixel(ctx, 6, y + 1, '#c8ae4a');
      setIconPixel(ctx, 10, y + 1, '#c8ae4a');
    }
  } else if (key === 'bread') {
    for (let y = 5; y < 12; y++) {
      const w = y < 7 ? 4 : 5;
      for (let x = 8 - w; x < 8 + w; x++) setIconPixel(ctx, x, y, (x + y) % 4 === 0 ? '#c9812e' : '#a8651f');
    }
    setIconPixel(ctx, 5, 7, '#efc27a');
  } else if (key === 'sweet_berries') {
    const spots = [[5, 6], [9, 5], [7, 9], [10, 10], [4, 10]];
    for (const [x, y] of spots) {
      rect(x, y, 2, 2, '#c0283c');
      setIconPixel(ctx, x, y, '#e85a6a');
    }
    setIconPixel(ctx, 7, 3, '#4f9a38');
  } else if (key === 'horse_armor') {
    rect(3, 5, 10, 6, '#b0b2ba');
    rect(4, 6, 2, 4, '#d8dae2');
    rect(10, 6, 2, 4, '#d8dae2');
    rect(3, 5, 10, 1, '#2a6bb0');
    setIconPixel(ctx, 8, 8, '#2a6bb0');
  } else if (key === 'carrot') {
    for (let y = 6; y < 14; y++) {
      const w = y < 12 ? Math.max(1, 4 - Math.floor((y - 6) / 2)) : 1;
      for (let x = 8 - w; x < 8 + w; x++) {
        setIconPixel(ctx, x, y, (x + y) % 3 === 0 ? '#f6a044' : '#dc7624');
      }
    }
    for (let i = 0; i < 5; i++) {
      setIconPixel(ctx, 6 + i, 5 - (i % 2), '#62a83c');
      setIconPixel(ctx, 9 - i, 4 + (i % 2), '#4c8f2f');
    }
  } else if (key === 'potato') {
    for (let y = 5; y < 13; y++) {
      const w = y < 7 || y > 10 ? 3 : 5;
      for (let x = 8 - w; x <= 7 + w; x++) {
        setIconPixel(ctx, x, y, (x + y) % 4 === 0 ? '#8a5a32' : '#b07a44');
      }
    }
    setIconPixel(ctx, 6, 7, '#5c3a1d');
    setIconPixel(ctx, 10, 9, '#5c3a1d');
  } else if (key === 'beetroot') {
    for (let y = 5; y < 13; y++) {
      const w = y < 9 ? 4 : 2;
      for (let x = 8 - w; x <= 7 + w; x++) {
        setIconPixel(ctx, x, y, (x + y) % 3 === 0 ? '#c23a64' : '#8f2547');
      }
    }
    for (let i = 0; i < 5; i++) {
      setIconPixel(ctx, 8, 4 - i, '#4f9a38');
      setIconPixel(ctx, 5 + i, 3 + (i % 2), '#5eaa42');
      setIconPixel(ctx, 11 - i, 2 + (i % 2), '#4b9135');
    }
    setIconPixel(ctx, 8, 13, '#5c1830');
  } else if (key && (key.includes('beef') || key.includes('porkchop')
    || key.includes('mutton') || key.includes('rabbit') || key.includes('chicken'))) {
    const cooked = key.startsWith('cooked');
    const base = cooked ? '#a2622c' : '#d47a86';
    const dark = cooked ? '#6e3d17' : '#a84f60';
    for (let y = 4; y < 12; y++) {
      const w = y < 6 ? 2 : y < 10 ? 4 : 2;
      for (let x = 8 - w; x <= 7 + w; x++) setIconPixel(ctx, x, y, (x + y) % 3 === 0 ? dark : base);
    }
    rect(3, 10, 3, 2, '#efe6d2');
    rect(2, 11, 3, 2, '#d8ceb8');
  } else if (key === 'leather') {
    rect(3, 4, 10, 8, '#8a5a2c');
    rect(4, 5, 8, 2, '#b07a42');
    setIconPixel(ctx, 5, 9, '#5c3a1a');
    setIconPixel(ctx, 10, 9, '#5c3a1a');
  } else if (key === 'redstone') {
    for (let y = 4; y < 13; y++) {
      for (let x = 5; x < 12; x++) {
        if ((x + y) % 3 === 0) continue;
        setIconPixel(ctx, x, y, (x + y) % 2 ? '#c82424' : '#ff6a5c');
      }
    }
  } else if (key === 'slime_ball') {
    for (let y = 5; y < 12; y++) {
      for (let x = 4; x < 13; x++) {
        const edge = x === 4 || x === 12 || y === 5 || y === 11;
        setIconPixel(ctx, x, y, edge ? '#4f9a45' : '#8ed46f');
      }
    }
    setIconPixel(ctx, 6, 7, '#d8f5b0');
  } else if (key === 'netherite_ingot') {
    for (let y = 6; y < 12; y++) {
      for (let x = 3; x < 13; x++) {
        if (x + y < 12 || x - y > 3) continue;
        setIconPixel(ctx, x, y, y < 9 ? '#6a6275' : '#332f3b');
      }
    }
    setIconPixel(ctx, 5, 8, '#a99db8');
  } else if (key === 'ender_scale') {
    for (let y = 3; y < 13; y++) {
      const w = Math.max(1, 6 - Math.abs(y - 8));
      for (let x = 8 - w; x <= 7 + w; x++) {
        setIconPixel(ctx, x, y, (x + y) % 3 === 0 ? '#b78cff' : '#54308c');
      }
    }
  } else if (key === 'spider_fang') {
    for (let y = 3; y < 13; y++) {
      const w = Math.max(1, 5 - Math.floor((y - 3) / 2));
      for (let x = 8 - w; x <= 7 + w; x++) setIconPixel(ctx, x, y, y < 8 ? '#e6e1d0' : '#a89c7d');
    }
  } else if (key === 'wolf_fur') {
    rect(4, 4, 8, 8, '#a9a49a');
    rect(3, 6, 10, 4, '#d2cdc2');
    setIconPixel(ctx, 6, 6, '#625e58');
    setIconPixel(ctx, 10, 9, '#625e58');
  } else if (key === 'camel_hide') {
    rect(3, 4, 10, 8, '#c49a63');
    rect(4, 5, 8, 3, '#e0bc86');
    setIconPixel(ctx, 5, 10, '#8a663a');
    setIconPixel(ctx, 10, 10, '#8a663a');
  } else if (key === 'frying_pan') {
    for (let y = 4; y < 11; y++) {
      for (let x = 3; x < 12; x++) {
        const edge = x === 3 || x === 11 || y === 4 || y === 10;
        setIconPixel(ctx, x, y, edge ? '#3a3b40' : (x + y) % 5 === 0 ? '#5d5f66' : '#25262a');
      }
    }
    for (let i = 0; i < 6; i++) setIconPixel(ctx, 11 + i, 5 + i, '#7a4d2a');
    setIconPixel(ctx, 12, 6, '#b07a42');
  } else if (key === 'millet_seeds' || key === 'wheat_seeds') {
    const color = key === 'millet_seeds' ? '#e6c95e' : '#b8a04a';
    for (const [x, y] of [[5, 6], [8, 5], [11, 7], [6, 10], [10, 11], [7, 8]]) {
      setIconPixel(ctx, x, y, color);
      setIconPixel(ctx, x + 1, y, '#8a722c');
    }
  } else if (key === 'millet') {
    for (let y = 6; y < 12; y++) {
      for (let x = 4; x < 13; x++) {
        if ((x + y) % 3 === 0) continue;
        setIconPixel(ctx, x, y, (x + y) % 2 ? '#f2d66a' : '#c9a83c');
      }
    }
  } else if (key === 'cooked_potato' || key === 'cooked_carrot'
    || key === 'cooked_beetroot' || key === 'cooked_millet'
    || key === 'cooked_fish' || key === 'fried_egg') {
    const palettes = {
      cooked_potato: ['#d99a4b', '#8c5522', '#f2c779'],
      cooked_carrot: ['#f08a2c', '#a94d10', '#ffbf63'],
      cooked_beetroot: ['#a82a4c', '#5c142d', '#d95478'],
      cooked_millet: ['#e8bf52', '#9c7620', '#ffe08c'],
      cooked_fish: ['#d29a4a', '#8a5422', '#f3c776'],
      fried_egg: ['#f4ead0', '#d8b45c', '#fffaf0'],
    };
    const [base, dark, light] = palettes[key];
    for (let y = 5; y < 12; y++) {
      const w = y < 7 || y > 10 ? 3 : 5;
      for (let x = 8 - w; x <= 7 + w; x++) {
        setIconPixel(ctx, x, y, (x + y) % 4 === 0 ? dark : base);
      }
    }
    rect(5, 6, 2, 2, light);
    rect(10, 8, 2, 2, light);
    if (key === 'fried_egg') rect(7, 8, 3, 3, '#f2c744');
  }
}

function makeHeartIcon(kind) {
  const { canvas, ctx } = makeCanvas(9);
  const full = [
    '.11.11...',
    '1221221..',
    '1222221..',
    '1222221..',
    '.12221...',
    '..121....',
    '...1.....',
    '.........',
    '.........',
  ];
  const half = [
    '.11.11...',
    '122.221..',
    '122.221..',
    '122.221..',
    '.122.1...',
    '..12.1...',
    '...1.....',
    '.........',
    '.........',
  ];
  const empty = [
    '.11.11...',
    '1..1..1..',
    '1.....1..',
    '1.....1..',
    '.1...1...',
    '..1.1....',
    '...1.....',
    '.........',
    '.........',
  ];
  const rows = kind === 'full' ? full : kind === 'half' ? half : empty;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '1') setIconPixel(ctx, x, y, kind === 'empty' ? '#4a2020' : '#5a1111');
      if (ch === '2') setIconPixel(ctx, x, y, x < 5 ? '#e33b3b' : kind === 'half' ? '#5a1111' : '#e33b3b');
    }
  }
  return canvas;
}

function makeHungerIcon(kind) {
  const { canvas, ctx } = makeCanvas(9);
  const full = [
    '..1111...',
    '.122221..',
    '.122221..',
    '..12221..',
    '..12221..',
    '...1221..',
    '...111...',
    '..11.....',
    '.11......',
  ];
  const empty = [
    '..1111...',
    '.1....1..',
    '.1....1..',
    '..1...1..',
    '..1...1..',
    '...1..1..',
    '...111...',
    '..11.....',
    '.11......',
  ];
  const rows = kind === 'full' ? full : empty;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '1') setIconPixel(ctx, x, y, '#5b3117');
      if (ch === '2') setIconPixel(ctx, x, y, '#b5672f');
    }
  }
  if (kind === 'full') {
    setIconPixel(ctx, 4, 3, '#e39a54');
    setIconPixel(ctx, 5, 3, '#e39a54');
  }
  return canvas;
}

function makeBubbleIcon() {
  const { canvas, ctx } = makeCanvas(9);
  for (let y = 1; y < 8; y++) {
    for (let x = 1; x < 8; x++) {
      const d = (x - 4) ** 2 + (y - 4) ** 2;
      if (d <= 8) setIconPixel(ctx, x, y, d < 4 ? '#aee9ff' : '#3b9bd6');
    }
  }
  setIconPixel(ctx, 3, 2, '#ffffff');
  return canvas;
}

function drawIsoBlock(block, tileCanvases) {
  const { canvas, ctx } = makeCanvas(48);
  const top = tileCanvases.get(block.faceTiles[0]);
  const side = tileCanvases.get(block.faceTiles[4]);
  const side2 = tileCanvases.get(block.faceTiles[5]);

  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.setTransform(20 / 16, 11 / 16, -20 / 16, 11 / 16, 24, 3);
  ctx.drawImage(top, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.setTransform(20 / 16, 11 / 16, 0, 18 / 16, 4, 14);
  ctx.drawImage(side, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.setTransform(-20 / 16, 11 / 16, 0, 18 / 16, 44, 14);
  ctx.drawImage(side2, 0, 0);
  ctx.restore();

  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.moveTo(4, 14);
  ctx.lineTo(24, 25);
  ctx.lineTo(24, 43);
  ctx.lineTo(4, 32);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.beginPath();
  ctx.moveTo(44, 14);
  ctx.lineTo(24, 25);
  ctx.lineTo(24, 43);
  ctx.lineTo(44, 32);
  ctx.closePath();
  ctx.fill();
  return canvas;
}

export function buildTextureAssets() {
  const tileCanvases = buildTileCanvases();
  const data = buildTextureArrayData(tileCanvases);
  const iconCache = new Map();
  const iconCanvasCache = new Map();
  const blockIconCache = new Map();

  const iconDataUrl = (canvas) => canvas.toDataURL('image/png');

  for (const block of BLOCK_DEFS) {
    if (block.id === 11 || block.id === 30 || block.id === 13) continue;
    const canvas = drawIsoBlock(block, tileCanvases);
    blockIconCache.set(block.id, canvas);
    iconCanvasCache.set(block.id, canvas);
    iconCache.set(block.id, iconDataUrl(canvas));
  }

  for (const item of ITEM_LIST) {
    if (item.icon === 'block') {
      // Items such as the door share a block-state id; reuse its rendered icon.
      const source = iconCache.get(item.blockId ?? item.placeBlock);
      if (source) {
        iconCache.set(item.id, source);
        const canvas = iconCanvasCache.get(item.blockId ?? item.placeBlock);
        if (canvas) iconCanvasCache.set(item.id, canvas);
      }
      continue;
    }
    const canvas = makeItemIconCanvas(item);
    iconCanvasCache.set(item.id, canvas);
    iconCache.set(item.id, iconDataUrl(canvas));
  }

  const hud = {
    heartFull: iconDataUrl(makeHeartIcon('full')),
    heartHalf: iconDataUrl(makeHeartIcon('half')),
    heartEmpty: iconDataUrl(makeHeartIcon('empty')),
    hungerFull: iconDataUrl(makeHungerIcon('full')),
    hungerEmpty: iconDataUrl(makeHungerIcon('empty')),
    bubble: iconDataUrl(makeBubbleIcon()),
  };

  return {
    data,
    width: SIZE,
    height: SIZE,
    layers: TEXTURE_NAMES.length,
    tileCanvases,
    icons: iconCache,
    iconCanvasCache,
    blockIconCache,
    hud,
    getIcon(itemId) {
      if (iconCache.has(itemId)) return iconCache.get(itemId);
      return null;
    },
  };
}
