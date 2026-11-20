import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Every GLB produced by tools/generate_models.py. */
export const MODEL_KEYS = [
  'cow', 'pig', 'sheep', 'chicken', 'rabbit', 'horse', 'camel', 'wolf', 'fox',
  'bee', 'bird', 'villager', 'iron_golem', 'zombie', 'skeleton', 'spider',
  'creeper', 'enderman', 'blaze', 'player',
];

const scenes = new Map();
let loadPromise = null;

/**
 * Loads all models once. Failures are non-fatal: the procedural models remain
 * as a fallback, so a missing or broken GLB never stops the game from starting.
 */
export function preloadModels() {
  if (loadPromise) return loadPromise;
  const loader = new GLTFLoader();
  loadPromise = Promise.all(MODEL_KEYS.map(async (key) => {
    try {
      const gltf = await loader.loadAsync(`/assets/models/${key}.glb`);
      gltf.scene.name = key;
      scenes.set(key, gltf.scene);
    } catch (error) {
      console.warn(`[models] ${key}.glb unavailable, using procedural fallback`, error);
    }
  })).then(() => scenes);
  return loadPromise;
}

export function hasModel(key) {
  return scenes.has(key);
}

export function getModelScene(key) {
  return scenes.get(key) ?? null;
}

/** The scene uses unlit materials everywhere; GLB's PBR would render black. */
function toUnlit(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    const converted = list.map((mat) => new THREE.MeshBasicMaterial({
      color: mat?.color?.clone?.() ?? new THREE.Color(0xffffff),
      fog: true,
      transparent: Boolean(mat?.transparent),
      opacity: mat?.opacity ?? 1,
    }));
    object.material = Array.isArray(object.material) ? converted : converted[0];
    // Cloned scenes share geometry with the cached original; never dispose it.
    object.userData.sharedGeometry = true;
  });
}

function detachRoot(scene) {
  const copy = scene.clone(true);
  toUnlit(copy);
  const group = new THREE.Group();
  while (copy.children.length) group.add(copy.children[0]);
  return group;
}

function pickParts(group) {
  const legs = [];
  const wings = [];
  const rods = [];
  const arms = [];
  let head = null;
  group.traverse((node) => {
    const name = node.name || '';
    if (name === 'head') head = node;
    else if (name.startsWith('leg_')) legs.push(node);
    else if (name.startsWith('wing_')) wings.push(node);
    else if (name.startsWith('rod_')) rods.push(node);
    else if (name.startsWith('arm_')) arms.push(node);
  });
  const byIndex = (a, b) => Number(a.name.split('_')[1]) - Number(b.name.split('_')[1]);
  legs.sort(byIndex);
  wings.sort(byIndex);
  rods.sort(byIndex);
  arms.sort(byIndex);
  return { group, legs, wings, rods, arms, head };
}

/** Mob model with the same animation handles as the procedural builders. */
export function createMobModel(key) {
  const scene = scenes.get(key);
  if (!scene) return null;
  return pickParts(detachRoot(scene));
}

export function hasPlayerModel() {
  return scenes.has('player');
}

/** Player model with named pivots and material-role groups for the editor. */
export function createPlayerModel() {
  const scene = scenes.get('player');
  if (!scene) return null;
  const group = detachRoot(scene);
  const roles = { shirt: [], pants: [], skin: [], accent: [], brow: [] };
  group.traverse((object) => {
    if (!object.isMesh) return;
    for (const role of Object.keys(roles)) {
      if (object.name.startsWith(`${role}_`)) roles[role].push(object);
    }
  });
  return {
    group,
    body: group.getObjectByName('body'),
    head: group.getObjectByName('head'),
    leftArm: group.getObjectByName('leftArm'),
    rightArm: group.getObjectByName('rightArm'),
    leftLeg: group.getObjectByName('leftLeg'),
    rightLeg: group.getObjectByName('rightLeg'),
    roles,
  };
}
