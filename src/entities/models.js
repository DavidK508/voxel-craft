import * as THREE from 'three';
import { createMobModel } from './modelLoader.js';

const materialCache = new Map();
const geometryCache = new Map();

function material(color) {
  let mat = materialCache.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, fog: true });
    materialCache.set(color, mat);
  }
  return mat;
}

function geometry(w, h, d) {
  const key = `${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`;
  let geo = geometryCache.get(key);
  if (!geo) {
    geo = new THREE.BoxGeometry(w, h, d);
    geometryCache.set(key, geo);
  }
  return geo;
}

function box(parent, w, h, d, color, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry(w, h, d), material(color));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function leg(parent, x, y, z, w, h, d, color) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  box(pivot, w, h, d, color, 0, -h / 2, 0);
  parent.add(pivot);
  return pivot;
}

function quadruped({
  bodyColor, headColor, legColor = bodyColor, bodySize, legHeight, headSize,
  bodyY, headZ, snout, ears, tail, mane, extra,
}) {
  const group = new THREE.Group();
  const [bw, bh, bd] = bodySize;
  const [hw, hh, hd] = headSize;
  box(group, bw, bh, bd, bodyColor, 0, bodyY, 0);
  const head = new THREE.Group();
  head.position.set(0, bodyY + bh / 2 + hh * 0.15, headZ);
  box(head, hw, hh, hd, headColor);
  if (snout) box(head, snout[0], snout[1], snout[2], snout[3], 0, -hh * 0.18, -hd * 0.62);
  if (ears) {
    box(head, 0.11, 0.22, 0.1, ears, -hw * 0.3, hh * 0.62, 0);
    box(head, 0.11, 0.22, 0.1, ears, hw * 0.3, hh * 0.62, 0);
  }
  group.add(head);
  const legs = [];
  const sx = bw * 0.34;
  const sz = bd * 0.34;
  for (const x of [-sx, sx]) {
    for (const z of [-sz, sz]) legs.push(leg(group, x, bodyY - bh / 2 + legHeight, z, 0.2, legHeight, 0.2, legColor));
  }
  if (tail) box(group, tail[0], tail[1], tail[2], tail[3], 0, bodyY + bh * 0.1, bd * 0.55);
  if (mane) box(group, 0.16, 0.3, bd * 0.5, mane, 0, bodyY + bh / 2, headZ * 0.4);
  extra?.(group, head, bodyY, bh);
  return { group, legs, head };
}

const builders = {
  cow() {
    return quadruped({
      bodyColor: 0x5a3b25, headColor: 0x6b4a2f, legColor: 0x4b3220,
      bodySize: [0.9, 0.78, 1.4], legHeight: 0.5, headSize: [0.55, 0.55, 0.55],
      bodyY: 0.92, headZ: -0.92,
      snout: [0.36, 0.26, 0.22, 0xd9c4b0], ears: 0x6b4a2f, tail: [0.09, 0.55, 0.09, 0x4b3220],
      extra(group, head, bodyY, bh) {
        box(group, 0.55, 0.5, 0.55, 0xe8e0d0, 0.16, bodyY + 0.12, 0.18);
        box(group, 0.36, 0.34, 0.4, 0xe8e0d0, -0.2, bodyY - 0.15, -0.28);
        box(head, 0.08, 0.12, 0.08, 0xe8e0d0, -0.18, 0.3, 0);
        box(head, 0.08, 0.12, 0.08, 0xe8e0d0, 0.18, 0.3, 0);
      },
    });
  },
  pig() {
    return quadruped({
      bodyColor: 0xe89aa8, headColor: 0xf0aab8, legColor: 0xd88a98,
      bodySize: [0.78, 0.6, 1.05], legHeight: 0.34, headSize: [0.5, 0.5, 0.5],
      bodyY: 0.65, headZ: -0.7,
      snout: [0.24, 0.2, 0.18, 0xd97f92], ears: 0xe89aa8, tail: [0.08, 0.08, 0.08, 0xd88a98],
    });
  },
  nether_pig() {
    const model = quadruped({
      bodyColor: 0x7a1e1e, headColor: 0x942727, legColor: 0x5c1414,
      bodySize: [0.86, 0.66, 1.12], legHeight: 0.36, headSize: [0.54, 0.52, 0.54],
      bodyY: 0.68, headZ: -0.76,
      snout: [0.28, 0.22, 0.2, 0x4a1010], ears: 0x942727, tail: [0.08, 0.12, 0.08, 0x5c1414],
      extra(group, head, bodyY, bh) {
        box(head, 0.1, 0.09, 0.03, 0xffb02e, -0.16, 0.08, -0.28);
        box(head, 0.1, 0.09, 0.03, 0xffb02e, 0.16, 0.08, -0.28);
        for (let i = -1; i <= 1; i++) {
          box(group, 0.09, 0.22, 0.09, 0xff6a1e, 0, bodyY + bh / 2 + 0.08, i * 0.28);
        }
      },
    });
    return model;
  },
  sheep() {
    const model = quadruped({
      bodyColor: 0xf2f0e6, headColor: 0xd8cab4, legColor: 0xc8bca8,
      bodySize: [0.95, 0.8, 1.15], legHeight: 0.42, headSize: [0.44, 0.46, 0.46],
      bodyY: 0.9, headZ: -0.66, ears: 0xd8cab4, tail: [0.12, 0.16, 0.12, 0xf2f0e6],
    });
    // Fluffy outline: a few extra wool lumps.
    box(model.group, 0.5, 0.34, 0.7, 0xf8f6ee, -0.3, 1.24, 0.16);
    box(model.group, 0.5, 0.34, 0.7, 0xf8f6ee, 0.3, 1.24, -0.16);
    return model;
  },
  chicken() {
    const group = new THREE.Group();
    box(group, 0.42, 0.4, 0.5, 0xf4f0e8, 0, 0.55, 0.05);
    const head = new THREE.Group();
    head.position.set(0, 0.86, -0.2);
    box(head, 0.26, 0.26, 0.26, 0xf4f0e8);
    box(head, 0.12, 0.1, 0.14, 0xe8a92a, 0, -0.02, -0.2);
    box(head, 0.08, 0.14, 0.08, 0xd23a2e, 0, 0.18, 0);
    box(head, 0.06, 0.1, 0.05, 0xd23a2e, 0, -0.1, -0.12);
    group.add(head);
    const wings = [];
    const left = box(group, 0.08, 0.3, 0.4, 0xe8e0d4, -0.25, 0.62, 0.02);
    const right = box(group, 0.08, 0.3, 0.4, 0xe8e0d4, 0.25, 0.62, 0.02);
    wings.push(left, right);
    const legs = [];
    legs.push(leg(group, -0.1, 0.37, 0.05, 0.06, 0.34, 0.06, 0xe8a92a));
    legs.push(leg(group, 0.1, 0.37, 0.05, 0.06, 0.34, 0.06, 0xe8a92a));
    return { group, legs, wings, head };
  },
  rabbit() {
    const model = quadruped({
      bodyColor: 0xd8cbb8, headColor: 0xe4d8c6, legColor: 0xc4b6a2,
      bodySize: [0.36, 0.34, 0.5], legHeight: 0.16, headSize: [0.3, 0.3, 0.3],
      bodyY: 0.34, headZ: -0.32, tail: [0.1, 0.1, 0.1, 0xf4efe6],
    });
    box(model.head, 0.08, 0.42, 0.06, 0xd8cbb8, -0.08, 0.3, 0.02);
    box(model.head, 0.08, 0.42, 0.06, 0xd8cbb8, 0.08, 0.3, 0.02);
    return model;
  },
  horse() {
    const model = quadruped({
      bodyColor: 0x7a4b2a, headColor: 0x87552f, legColor: 0x5c3820,
      bodySize: [0.85, 0.8, 1.55], legHeight: 0.72, headSize: [0.46, 0.52, 0.95],
      bodyY: 1.12, headZ: -1.02, mane: 0x2e1d12,
      tail: [0.12, 0.6, 0.12, 0x2e1d12],
    });
    box(model.group, 0.32, 0.4, 0.7, 0x7a4b2a, 0, 1.55, -0.6);
    box(model.head, 0.3, 0.22, 0.3, 0x2e1d12, 0, 0.28, 0.1);
    return model;
  },
  camel() {
    const model = quadruped({
      bodyColor: 0xc9a15f, headColor: 0xd4ac6b, legColor: 0xb08a4c,
      bodySize: [0.95, 0.85, 1.75], legHeight: 0.9, headSize: [0.48, 0.5, 0.85],
      bodyY: 1.35, headZ: -1.12,
      tail: [0.1, 0.45, 0.1, 0xb08a4c],
    });
    box(model.group, 0.6, 0.42, 0.8, 0xc9a15f, 0, 1.9, 0.05);
    box(model.group, 0.34, 0.5, 0.65, 0xc9a15f, 0, 1.45, -0.75);
    return model;
  },
  wolf() {
    return quadruped({
      bodyColor: 0x8b8d94, headColor: 0x9a9ca3, legColor: 0x74767c,
      bodySize: [0.5, 0.42, 0.85], legHeight: 0.34, headSize: [0.36, 0.34, 0.42],
      bodyY: 0.56, headZ: -0.52, snout: [0.2, 0.16, 0.2, 0x6e7076],
      ears: 0x74767c, tail: [0.12, 0.16, 0.4, 0x8b8d94],
    });
  },
  fox() {
    return quadruped({
      bodyColor: 0xc96a28, headColor: 0xd8772f, legColor: 0x4a3324,
      bodySize: [0.42, 0.36, 0.72], legHeight: 0.28, headSize: [0.34, 0.3, 0.4],
      bodyY: 0.48, headZ: -0.45, snout: [0.16, 0.13, 0.18, 0xf4efe6],
      ears: 0xb85e22, tail: [0.2, 0.2, 0.45, 0xc96a28],
    });
  },
  bee() {
    const group = new THREE.Group();
    box(group, 0.34, 0.28, 0.46, 0xf2c22e, 0, 0.4, 0);
    box(group, 0.36, 0.29, 0.09, 0x2c2114, 0, 0.4, -0.1);
    box(group, 0.36, 0.29, 0.09, 0x2c2114, 0, 0.4, 0.13);
    box(group, 0.22, 0.22, 0.22, 0x2c2114, 0, 0.42, -0.3);
    box(group, 0.08, 0.08, 0.05, 0xf2c22e, 0, 0.42, -0.44);
    const wings = [];
    for (const x of [-0.24, 0.24]) {
      const wing = new THREE.Mesh(
        geometry(0.34, 0.03, 0.22),
        new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.55, fog: true }),
      );
      wing.position.set(x, 0.6, 0.02);
      group.add(wing);
      wings.push(wing);
    }
    return { group, legs: [], wings, head: null };
  },
  bird() {
    const group = new THREE.Group();
    box(group, 0.26, 0.26, 0.4, 0x4a8fd4, 0, 0.42, 0);
    box(group, 0.24, 0.24, 0.24, 0x5aa0e0, 0, 0.66, -0.22);
    box(group, 0.1, 0.08, 0.16, 0xe8a92a, 0, 0.64, -0.4);
    const wings = [];
    const left = box(group, 0.34, 0.05, 0.26, 0x3b78b8, -0.28, 0.46, -0.02);
    const right = box(group, 0.34, 0.05, 0.26, 0x3b78b8, 0.28, 0.46, -0.02);
    wings.push(left, right);
    const legs = [leg(group, -0.07, 0.3, 0.02, 0.05, 0.26, 0.05, 0xe8a92a), leg(group, 0.07, 0.3, 0.02, 0.05, 0.26, 0.05, 0xe8a92a)];
    return { group, legs, wings, head: null };
  },
  villager() {
    const group = new THREE.Group();
    const legs = [];
    legs.push(leg(group, -0.13, 0.72, 0, 0.18, 0.72, 0.21, 0x4a3b2a));
    legs.push(leg(group, 0.13, 0.72, 0, 0.18, 0.72, 0.21, 0x4a3b2a));
    // Long robe with a lighter apron and a belt sash.
    box(group, 0.58, 0.72, 0.34, 0x6a4a2c, 0, 1.06, 0);
    box(group, 0.34, 0.56, 0.36, 0x9b7a4b, 0, 0.98, -0.02);
    box(group, 0.6, 0.08, 0.36, 0x3f2f20, 0, 0.78, 0);
    box(group, 0.16, 0.5, 0.04, 0xb08a5c, 0, 1.05, -0.19);

    const head = new THREE.Group();
    head.position.set(0, 1.58, 0);
    box(head, 0.42, 0.42, 0.42, 0xc79a6b);
    // Large villager nose, heavy unibrow and a white beard.
    box(head, 0.13, 0.18, 0.16, 0xb08a5c, 0, -0.03, -0.27);
    box(head, 0.44, 0.08, 0.44, 0x3a2a1a, 0, 0.22, 0);
    box(head, 0.36, 0.2, 0.16, 0xe8e2d2, 0, -0.25, -0.14);
    box(head, 0.1, 0.07, 0.02, 0x2b211a, -0.11, 0.04, -0.22);
    box(head, 0.1, 0.07, 0.02, 0x2b211a, 0.11, 0.04, -0.22);
    box(head, 0.12, 0.05, 0.02, 0x5a3b24, -0.11, 0.11, -0.22);
    box(head, 0.12, 0.05, 0.02, 0x5a3b24, 0.11, 0.11, -0.22);
    box(head, 0.06, 0.06, 0.02, 0xf5f1e6, -0.11, 0.04, -0.235);
    box(head, 0.06, 0.06, 0.02, 0xf5f1e6, 0.11, 0.04, -0.235);
    group.add(head);

    const arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.37, 1.35, 0);
      box(arm, 0.16, 0.42, 0.2, 0x7a5a3a, 0, -0.2, 0);
      box(arm, 0.14, 0.16, 0.18, 0xc79a6b, 0, -0.48, 0);
      group.add(arm);
      arms.push(arm);
    }
    return { group, legs, arms, head };
  },
  iron_golem() {
    const group = new THREE.Group();
    const legs = [];
    legs.push(leg(group, -0.28, 0.95, 0, 0.34, 0.95, 0.36, 0x9aa09b));
    legs.push(leg(group, 0.28, 0.95, 0, 0.34, 0.95, 0.36, 0x9aa09b));
    box(group, 1.0, 0.9, 0.6, 0xb8beb8, 0, 1.55, 0);
    box(group, 0.72, 0.3, 0.5, 0xa8aea8, 0, 1.18, 0);
    const head = new THREE.Group();
    head.position.set(0, 2.18, 0);
    box(head, 0.46, 0.5, 0.46, 0xc2c8c0);
    box(head, 0.16, 0.2, 0.14, 0x8f958d, 0, -0.02, -0.3);
    box(head, 0.08, 0.06, 0.02, 0x373d3b, -0.11, 0.08, -0.24);
    box(head, 0.08, 0.06, 0.02, 0x373d3b, 0.11, 0.08, -0.24);
    group.add(head);
    box(group, 0.3, 1.3, 0.32, 0xadb3ad, -0.68, 1.4, 0);
    box(group, 0.3, 1.3, 0.32, 0xadb3ad, 0.68, 1.4, 0);
    // A few mossy vines to sell the "iron golem" look.
    box(group, 0.12, 0.5, 0.02, 0x4a7a3a, -0.2, 1.4, -0.31);
    box(group, 0.1, 0.3, 0.02, 0x4a7a3a, 0.25, 1.7, -0.31);
    return { group, legs, head };
  },
  zombie() {
    const group = new THREE.Group();
    const legs = [];
    legs.push(leg(group, -0.13, 0.72, 0, 0.2, 0.72, 0.22, 0x2c3d6b));
    legs.push(leg(group, 0.13, 0.72, 0, 0.2, 0.72, 0.22, 0x2c3d6b));
    box(group, 0.52, 0.72, 0.28, 0x2f8f6a, 0, 1.08, 0);
    const head = new THREE.Group();
    head.position.set(0, 1.6, 0);
    box(head, 0.44, 0.44, 0.44, 0x3f9a72);
    box(head, 0.08, 0.06, 0.02, 0x101010, -0.1, 0.06, -0.23);
    box(head, 0.08, 0.06, 0.02, 0x101010, 0.1, 0.06, -0.23);
    box(head, 0.22, 0.06, 0.02, 0x1a3a2a, 0, -0.12, -0.23);
    group.add(head);
    box(group, 0.16, 0.62, 0.18, 0x2f8f6a, -0.33, 1.18, -0.3);
    box(group, 0.16, 0.62, 0.18, 0x2f8f6a, 0.33, 1.18, -0.3);
    return { group, legs, head };
  },
  skeleton() {
    const group = new THREE.Group();
    const legs = [];
    legs.push(leg(group, -0.12, 0.74, 0, 0.1, 0.74, 0.1, 0xd8d8d0));
    legs.push(leg(group, 0.12, 0.74, 0, 0.1, 0.74, 0.1, 0xd8d8d0));
    box(group, 0.36, 0.66, 0.16, 0xd8d8d0, 0, 1.1, 0);
    box(group, 0.44, 0.1, 0.12, 0xc8c8c0, 0, 1.32, 0);
    const head = new THREE.Group();
    head.position.set(0, 1.62, 0);
    box(head, 0.36, 0.36, 0.36, 0xe4e4dc);
    box(head, 0.09, 0.09, 0.02, 0x1a1a1a, -0.09, 0.04, -0.19);
    box(head, 0.09, 0.09, 0.02, 0x1a1a1a, 0.09, 0.04, -0.19);
    group.add(head);
    box(group, 0.08, 0.62, 0.08, 0xd8d8d0, -0.28, 1.12, 0);
    box(group, 0.08, 0.62, 0.08, 0xd8d8d0, 0.28, 1.12, 0);
    return { group, legs, head };
  },
  spider() {
    const group = new THREE.Group();
    box(group, 0.8, 0.42, 0.7, 0x2a2224, 0, 0.6, 0.1);
    box(group, 0.42, 0.34, 0.4, 0x3a3034, 0, 0.6, -0.42);
    box(group, 0.08, 0.08, 0.04, 0xd23a2e, -0.1, 0.67, -0.63);
    box(group, 0.08, 0.08, 0.04, 0xd23a2e, 0.1, 0.67, -0.63);
    const legs = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.34, 0.5, -0.3 + i * 0.22);
        const segment = box(pivot, 0.06, 0.06, 0.7, 0x2a2224, side * 0.22, -0.1, 0.14);
        segment.rotation.y = side * (0.5 + i * 0.12);
        group.add(pivot);
        legs.push(pivot);
      }
    }
    return { group, legs, head: null };
  },
  creeper() {
    const group = new THREE.Group();
    const legs = [];
    legs.push(leg(group, -0.14, 0.4, 0, 0.22, 0.4, 0.22, 0x3a8f3a));
    legs.push(leg(group, 0.14, 0.4, 0, 0.22, 0.4, 0.22, 0x3a8f3a));
    legs.push(leg(group, -0.14, 0.4, 0.36, 0.22, 0.4, 0.22, 0x3a8f3a));
    legs.push(leg(group, 0.14, 0.4, 0.36, 0.22, 0.4, 0.22, 0x3a8f3a));
    box(group, 0.5, 0.85, 0.34, 0x3a9f3a, 0, 0.9, 0);
    const head = new THREE.Group();
    head.position.set(0, 1.55, 0);
    box(head, 0.46, 0.46, 0.46, 0x45aa45);
    box(head, 0.1, 0.1, 0.02, 0x101010, -0.1, 0.05, -0.24);
    box(head, 0.1, 0.1, 0.02, 0x101010, 0.1, 0.05, -0.24);
    box(head, 0.12, 0.2, 0.02, 0x101010, 0, -0.12, -0.24);
    group.add(head);
    return { group, legs, head };
  },
  enderman() {
    const group = new THREE.Group();
    const legs = [];
    legs.push(leg(group, -0.13, 1.35, 0, 0.13, 1.35, 0.13, 0x14121a));
    legs.push(leg(group, 0.13, 1.35, 0, 0.13, 1.35, 0.13, 0x14121a));
    box(group, 0.4, 0.8, 0.22, 0x14121a, 0, 1.75, 0);
    const head = new THREE.Group();
    head.position.set(0, 2.35, 0);
    box(head, 0.42, 0.42, 0.42, 0x1a1722);
    box(head, 0.28, 0.07, 0.02, 0xb74af0, 0, 0.06, -0.22);
    group.add(head);
    box(group, 0.1, 1.15, 0.1, 0x14121a, -0.3, 1.7, 0);
    box(group, 0.1, 1.15, 0.1, 0x14121a, 0.3, 1.7, 0);
    return { group, legs, head };
  },
  blaze() {
    const group = new THREE.Group();
    box(group, 0.42, 0.42, 0.42, 0xf2c22e, 0, 1.1, 0);
    box(group, 0.24, 0.24, 0.24, 0xffe36a, 0, 1.42, 0);
    const rods = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(0, 1.05, 0);
      const rod = box(pivot, 0.1, 0.5, 0.1, 0xf0a01c, Math.cos(angle) * 0.34, 0, Math.sin(angle) * 0.34);
      rod.rotation.z = angle;
      group.add(pivot);
      rods.push(pivot);
    }
    return { group, legs: [], rods, head: null };
  },
  hell_lord() {
    const group = new THREE.Group();
    const legs = [];
    for (const side of [-1, 1]) {
      legs.push(leg(group, side * 0.42, 1.15, 0, 0.42, 1.15, 0.5, 0x4a0e12));
    }
    box(group, 1.7, 1.25, 1.0, 0x7d1a1c, 0, 1.85, 0);
    box(group, 1.2, 0.45, 0.8, 0x9c2420, 0, 1.3, 0);

    const arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 1.05, 2.28, 0);
      box(arm, 0.42, 1.25, 0.48, 0x6d1518, 0, -0.62, 0);
      box(arm, 0.5, 0.4, 0.56, 0x9c2420, 0, -1.25, 0);
      group.add(arm);
      arms.push(arm);
    }

    const head = new THREE.Group();
    head.position.set(0, 2.75, 0);
    box(head, 0.95, 0.9, 0.9, 0x9c2420);
    box(head, 0.55, 0.34, 0.3, 0x521014, 0, -0.16, -0.55);
    box(head, 0.14, 0.11, 0.04, 0xffd257, -0.24, 0.12, -0.47);
    box(head, 0.14, 0.11, 0.04, 0xffd257, 0.24, 0.12, -0.47);
    box(head, 0.18, 0.6, 0.18, 0xe8c98a, -0.42, 0.62, 0);
    box(head, 0.18, 0.6, 0.18, 0xe8c98a, 0.42, 0.62, 0);
    box(head, 0.9, 0.18, 0.9, 0xf0b429, 0, 0.56, 0);
    for (let i = -1; i <= 1; i++) {
      box(head, 0.14, 0.3, 0.14, 0xf0b429, i * 0.3, 0.78, 0);
    }
    group.add(head);

    for (let i = -2; i <= 2; i++) {
      box(group, 0.16, 0.5, 0.16, 0xff6a1e, i * 0.28, 2.5, 0.45);
    }
    return { group, legs, arms, head };
  },
};

export function buildMobModel(key) {
  // Blender GLB first; procedural boxes stay as the fallback.
  return createMobModel(key) ?? (builders[key] ?? builders.pig)();
}

export function disposeMobModel(model) {
  if (!model) return;
  // Geometries and materials are shared caches, so only detach the hierarchy.
  model.group.removeFromParent();
}
