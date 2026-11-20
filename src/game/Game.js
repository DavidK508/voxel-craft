import * as THREE from 'three';
import {
  DEFAULT_RENDER_DISTANCE,
  MAX_RENDER_DISTANCE,
  SAVE_VERSION,
  WORLD_HEIGHT,
} from '../shared/constants.js';
import { getBlock } from '../shared/blocks.js';
import { loadAppearance, saveAppearance } from '../shared/appearance.js';
import { createItemStack, getFoodInfo, getItem, getToolInfo } from '../shared/items.js';
import { offersForVillager, performTrade } from '../shared/trades.js';
import {
  GAME_MODE_CREATIVE,
  GAME_MODE_LABELS,
  GAME_MODE_SURVIVAL,
  normalizeGameMode,
} from '../shared/gameModes.js';
import {
  advanceTimeOfDay,
  cycleDurations,
  DEFAULT_DAY_MINUTES,
  DEFAULT_NIGHT_MINUTES,
  isDaytime,
} from './dayCycle.js';
import { EntityManager } from '../entities/EntityManager.js';
import { preloadModels } from '../entities/modelLoader.js';
import { Inventory } from './Inventory.js';
import { ItemDrops } from './ItemDrops.js';
import { Input } from '../player/Input.js';
import { Player } from '../player/Player.js';
import { PlayerModel } from '../player/PlayerModel.js';
import { buildTextureAssets } from '../render/TextureAtlas.js';
import { createTextureArray, TerrainMaterials } from '../render/TerrainMaterials.js';
import { Sky } from '../render/Sky.js';
import { HUD } from '../ui/HUD.js';
import { InventoryUI } from '../ui/InventoryUI.js';
import { TradeUI } from '../ui/TradeUI.js';
import { CharacterCreator } from '../ui/CharacterCreator.js';
import { World } from '../world/World.js';
import { FluidSimulation } from '../world/Fluids.js';
import {
  END_ORIGIN,
  NETHER_ORIGIN,
  dimensionAt,
  findSpawn,
} from '../world/generator.js';
import { AudioManager } from '../audio/AudioManager.js';
import { QUALITY } from '../shared/quality.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'voxelcraft.settings.v2';
const SAVE_INDEX_KEY = 'voxelcraft.worlds.v2';
const SAVE_PREFIX = 'voxelcraft.save.v2.';
// Pre-multi-world slot, migrated into the index on first boot.
const LEGACY_SAVE_KEY = 'voxelcraft.save.v2';

const DIMENSION_LABELS = Object.freeze({
  overworld: 'Верхний мир',
  nether: 'Ад',
  end: 'Край',
});

const DEFAULT_SETTINGS = Object.freeze({
  renderDistance: DEFAULT_RENDER_DISTANCE,
  fov: 75,
  sensitivity: 1,
  volume: 0.65,
  debug: false,
  dayMinutes: DEFAULT_DAY_MINUTES,
  nightMinutes: DEFAULT_NIGHT_MINUTES,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function toggleHidden(element, hidden) {
  if (element) element.classList.toggle('hidden', hidden);
}

function parseSeed(label) {
  const text = String(label ?? '').trim();
  if (!text) {
    return { seed: (Math.random() * 0xffffffff) >>> 0, label: '' };
  }
  if (/^-?\d+$/.test(text)) {
    return { seed: Number(text) >>> 0, label: text };
  }
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return { seed: hash >>> 0, label: text };
}

function formatClock(timeOfDay) {
  const totalMinutes = Math.floor(((timeOfDay / 24000) * 24 * 60 + 6 * 60) % (24 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatDate(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return '—';
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pluralWorlds(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} мир`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} мира`;
  return `${count} миров`;
}

function makeWorldId() {
  return `world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function readLocalWorlds() {
  try {
    const raw = localStorage.getItem(SAVE_INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && entry.id) : [];
  } catch (error) {
    console.error('Failed to read world list', error);
    return [];
  }
}

function writeLocalWorlds(list) {
  try {
    localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(list));
  } catch (error) {
    console.error('Failed to write world list', error);
  }
}

function formatNumber(value) {
  return Math.round(value).toLocaleString('ru-RU');
}

export class Game {
  constructor() {
    this.canvas = $('game-canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: QUALITY.antialias,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.setClearColor(0x9fc8e0, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.08,
      1200,
    );
    this.camera.rotation.order = 'YXZ';

    this.gameAPI = window.gameAPI ?? null;
    this.settings = this.loadLocalSettings();
    this.debugVisible = this.settings.debug;

    this.audio = new AudioManager();
    this.audio.setVolume(this.settings.volume);

    this.assets = buildTextureAssets();
    this.hud = new HUD(this.assets);
    this.inventoryUI = new InventoryUI({
      assets: this.assets,
      inventory: new Inventory(),
      onChange: () => this.onInventoryChanged(),
      onDropStack: (stack) => this.dropStackFromInventory(stack),
      onCloseRequest: () => this.closeInventory(),
      audio: this.audio,
    });
    this.tradeUI = new TradeUI({
      assets: this.assets,
      audio: this.audio,
      onTrade: (offer) => this.executeTrade(offer),
      onClose: () => this.closeTrade(),
    });
    this.characterCreator = new CharacterCreator({
      onStart: () => this.confirmCharacter(),
      onBack: () => this.cancelCharacter(),
    });
    this.pendingWorldStart = null;
    this.characterReturnState = 'menu';
    this.input = new Input(this.canvas);

    this.appearance = loadAppearance();
    this.playerModel = new PlayerModel('', this.appearance);
    this.playerModel.group.visible = false;
    this.scene.add(this.playerModel.group);

    // Models load in the background; the procedural versions cover the gap.
    preloadModels().then(() => {
      this.playerModel?.refreshModel();
      this.inventoryUI?.preview?.refreshModel();
      this.characterCreator?.preview?.refreshModel();
    });
    // 0 = first person, 1 = third person behind, 2 = third person in front.
    this.cameraMode = 0;

    this.state = 'menu';
    this.world = null;
    this.player = null;
    this.inventory = null;
    this.drops = null;
    this.entities = null;
    this.materials = null;
    this.sky = null;
    this.selection = null;
    this.dimension = 'overworld';
    this.returnPoint = null;
    this.teleportCooldown = 0;
    this.attackCooldown = 0;
    this.riding = null;
    this.spawn = { x: 0.5, y: 80, z: 0.5 };
    this.seedLabel = '';
    this.timeOfDay = 6000;
    this.gameMode = GAME_MODE_SURVIVAL;
    this.lastJumpTap = 0;
    this.worldList = [];
    this.selectedWorldId = null;
    this.currentWorldId = null;
    this.currentWorldName = '';
    this.loadingInfo = null;
    this.settingsReturn = 'menu';

    this.mining = null;
    this.useTimer = 0;
    this.eatCooldown = 0;
    this.stepAccum = 0;
    this.hudAccum = 0;
    this.debugAccum = 0;
    this.autosaveTimer = 0;
    this.lastHealth = 20;
    this.lastHeldId = null;
    this.lastDebugVisible = null;
    this.lastLoadingStatus = '';
    this.lastTime = 0;
    this.fps = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    // Dynamic resolution: drop the internal render size on slow GPUs instead
    // of dropping frames. 1 = native, 0.6 = 60% of the window resolution.
    this.renderScale = 1;
    this.renderScaleTimer = 0;
    this.renderScaleCooldown = 0;
    this.saving = false;
    this.quitting = false;
    this.disposingWorld = false;
    this.lockHintTimer = 0;
    this.startedAt = performance.now();

    // LAN multiplayer state. `net.role` is either "host" or "client".
    this.net = null;
    this.remotePlayers = new Map();
    this.remoteModels = new Map();
    this.netSendTimer = 0;
    this.networkClock = 0;
    this.dropsClock = 0;
    this.netName = this.appearance.name;
    this.pendingNetworkState = null;
    this.tradeEntity = null;
    this.tradeOffers = [];

    this.screens = {
      menu: $('main-menu'),
      newWorld: $('new-world'),
      loading: $('loading-screen'),
      hud: $('hud'),
      inventory: $('inventory-screen'),
      pause: $('pause-screen'),
      settings: $('settings-screen'),
      network: $('network-screen'),
      character: $('character-screen'),
      trade: $('trade-screen'),
      death: $('death-screen'),
    };
    this.loadingTitle = document.querySelector('.loading-title');
    this.loadingProgress = $('loading-progress');
    this.loadingStatus = $('loading-status');

    this.bindEvents();
    this.syncSettingsInputs();
    this.applySettings(false);
    this.setState('menu');
    this.refreshWorldList();
    this.loadAppInfo();
    this.updateCanvasSize();

    this.gameAPI?.onLanEvent?.((payload) => this.handleLanEvent(payload));

    this.animate = (now) => this.frame(now);
    requestAnimationFrame(this.animate);
  }

  /* ------------------------------------------------------------------ */
  /* Boot / UI wiring                                                    */
  /* ------------------------------------------------------------------ */

  bindEvents() {
    $('btn-new').addEventListener('click', () => this.openNewWorld());
    $('btn-network').addEventListener('click', () => this.openNetworkScreen());
    $('btn-character').addEventListener('click', () => this.openCharacterOnly());
    $('btn-menu-settings').addEventListener('click', () => this.openSettings('menu'));
    $('btn-quit').addEventListener('click', () => this.quitApp());

    $('btn-lan-host').addEventListener('click', () => this.requestCharacter(() => this.hostLanWorld()));
    $('btn-lan-join').addEventListener('click', () => this.requestCharacter(() => this.joinLanWorld()));
    $('btn-lan-back').addEventListener('click', () => this.setState('menu'));

    $('btn-play-world').addEventListener('click', () => this.requestCharacter(() => this.playSelectedWorld()));
    $('btn-delete-world').addEventListener('click', () => this.runSafely(this.deleteSelectedWorld()));

    const worldListEl = $('world-list');
    worldListEl?.addEventListener('click', (event) => {
      const row = event.target.closest?.('.world-row');
      if (!row) return;
      this.selectWorld(row.dataset.id);
    });
    worldListEl?.addEventListener('dblclick', (event) => {
      const row = event.target.closest?.('.world-row');
      if (!row) return;
      this.selectWorld(row.dataset.id);
      this.requestCharacter(() => this.playSelectedWorld());
    });

    $('btn-create').addEventListener('click', () => this.requestCharacter(() => this.createWorldFromDialog()));
    $('btn-new-cancel').addEventListener('click', () => this.setState('menu'));
    $('seed-input').addEventListener('keydown', (event) => {
      if (event.code === 'Enter') this.requestCharacter(() => this.createWorldFromDialog());
    });
    $('world-name-input').addEventListener('keydown', (event) => {
      if (event.code === 'Enter') this.requestCharacter(() => this.createWorldFromDialog());
    });

    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-save').addEventListener('click', () => this.saveFromPause());
    $('btn-pause-settings').addEventListener('click', () => this.openSettings('paused'));
    $('btn-main-menu').addEventListener('click', () => this.exitToMainMenu());
    $('btn-pause-quit').addEventListener('click', () => this.quitApp());

    $('btn-settings-close').addEventListener('click', () => this.closeSettings());

    $('btn-respawn').addEventListener('click', () => this.startRespawn());

    $('render-distance').addEventListener('input', () => {
      $('render-distance-value').textContent = `${$('render-distance').value} чанков`;
    });
    $('sensitivity').addEventListener('input', () => {
      $('sensitivity-value').textContent = `${Number($('sensitivity').value).toFixed(1)}×`;
    });

    this.bindSettingRange('settings-render-distance', 'settings-render-distance-value', (value) => {
      this.settings.renderDistance = value;
      this.applySettings(true);
    }, (value) => `${value} чанков`);
    this.bindSettingRange('settings-fov', 'settings-fov-value', (value) => {
      this.settings.fov = value;
      this.applySettings(true);
    }, (value) => `${value}°`);
    this.bindSettingRange('settings-sensitivity', 'settings-sensitivity-value', (value) => {
      this.settings.sensitivity = value;
      this.applySettings(true);
    }, (value) => `${value.toFixed(1)}×`);
    this.bindSettingRange('settings-volume', 'settings-volume-value', (value) => {
      this.settings.volume = value;
      this.applySettings(true);
    }, (value) => `${Math.round(value * 100)}%`);
    this.bindSettingRange('settings-cycle-length', 'settings-cycle-length-value', (value) => {
      const { dayMinutes, nightMinutes } = cycleDurations(value, DEFAULT_DAY_MINUTES);
      this.settings.dayMinutes = dayMinutes;
      this.settings.nightMinutes = nightMinutes;
      this.applySettings(true);
    }, (value) => `${value} мин день · ${value} мин ночь`);

    $('settings-debug').addEventListener('change', () => {
      this.settings.debug = $('settings-debug').checked;
      this.debugVisible = this.settings.debug;
      this.saveLocalSettings();
      this.updateDebug(true);
    });

    window.addEventListener('keydown', (event) => this.handleKeyDown(event));
    window.addEventListener('resize', () => this.updateCanvasSize());
    document.addEventListener('visibilitychange', () => {
      // A LAN host must keep simulating while its window is in the background,
      // otherwise every guest freezes with it.
      if (document.hidden && this.state === 'playing' && !this.net) this.pause();
    });
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.net) this.pause();
    };
    this.input.onWheel = (direction) => {
      if (this.state !== 'playing' || !this.inventory) return;
      this.selectHotbar((this.inventory.selected + direction + 9) % 9);
    };

    const initAudio = () => this.audio.init();
    window.addEventListener('pointerdown', initAudio, { once: true });
    window.addEventListener('keydown', initAudio, { once: true });

    if (this.gameAPI?.onBeforeQuit) {
      this.gameAPI.onBeforeQuit(() => this.handleBeforeQuit());
    }
  }

  bindSettingRange(inputId, outputId, onInput, formatter) {
    const input = $(inputId);
    const output = $(outputId);
    if (!input || !output) return;
    input.addEventListener('input', () => {
      const value = Number(input.value);
      output.textContent = formatter(value);
      onInput(value);
    });
  }

  /** Keeps async UI handlers from turning into unhandled rejections. */
  runSafely(promise) {
    Promise.resolve(promise).catch((error) => {
      console.error('UI action failed', error);
      const message = `Ошибка: ${error?.message ?? error}`;
      // The HUD is hidden behind the menu, so surface menu errors as a dialog.
      if (this.state === 'menu' || this.state === 'new-world' || this.state === 'network') window.alert(message);
      else this.hud?.toast?.(message, 3200);
    });
  }

  setState(state) {
    this.state = state;
    this.syncScreens();
  }

  isCreative() {
    return this.gameMode === GAME_MODE_CREATIVE;
  }

  syncScreens() {
    const state = this.state;
    const inWorld = !!this.world;
    const menuVisible = state === 'menu'
      || ((state === 'new-world' || state === 'network' || state === 'settings') && !inWorld);
    toggleHidden(this.screens.menu, !menuVisible);
    toggleHidden(this.screens.newWorld, state !== 'new-world');
    toggleHidden(this.screens.network, state !== 'network');
    toggleHidden(this.screens.character, state !== 'character');
    toggleHidden(this.screens.loading, state !== 'loading');
    toggleHidden(this.screens.inventory, state !== 'inventory');
    toggleHidden(this.screens.trade, state !== 'trade');
    toggleHidden(this.screens.pause, state !== 'paused');
    toggleHidden(this.screens.settings, state !== 'settings');
    toggleHidden(this.screens.death, state !== 'dead');
    toggleHidden(
      this.screens.hud,
      !(inWorld && ['playing', 'inventory', 'trade', 'paused', 'settings', 'dead'].includes(state)),
    );
  }

  updateCanvasSize() {
    const width = window.innerWidth;
    const height = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * this.renderScale);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Keeps the frame rate playable on weak integrated GPUs by trading a little
   * sharpness for smoothness. Terrain shading is fill-rate bound, so rendering
   * fewer pixels is by far the cheapest win. The UI stays crisp because it is
   * DOM, not part of the WebGL canvas.
   */
  updateRenderScale(dt) {
    if (this.state !== 'playing' || this.renderScaleCooldown > 0) {
      this.renderScaleCooldown = Math.max(0, this.renderScaleCooldown - dt);
      return;
    }
    this.renderScaleTimer += dt;
    if (this.renderScaleTimer < 1.2) return;
    this.renderScaleTimer = 0;

    let next = this.renderScale;
    if (this.fps < 42 && next > 0.6) next = Math.max(0.6, next - 0.1);
    else if (this.fps > 57 && next < 1) next = Math.min(1, next + 0.05);
    if (Math.abs(next - this.renderScale) < 0.001) return;

    this.renderScale = next;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * next);
    this.renderer.setSize(window.innerWidth, Math.max(1, window.innerHeight), false);
    this.renderScaleCooldown = 1.5;
  }

  loadAppInfo() {
    if (!this.gameAPI?.getInfo) return;
    this.gameAPI.getInfo().then((info) => {
      const label = $('version-label');
      if (label && info) label.textContent = `VoxelCraft ${info.version} · Electron ${info.electron}`;
    }).catch(() => {});
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  loadLocalSettings() {
    let raw = null;
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) raw = JSON.parse(stored);
    } catch {
      raw = null;
    }
    return this.sanitizeSettings(raw, DEFAULT_SETTINGS);
  }

  sanitizeSettings(raw, base) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const fallback = base ?? DEFAULT_SETTINGS;
    const cycle = cycleDurations(
      source.dayMinutes ?? source.nightMinutes ?? fallback.dayMinutes,
      DEFAULT_DAY_MINUTES,
    );
    return {
      renderDistance: clamp(
        Math.round(Number(source.renderDistance ?? fallback.renderDistance)),
        3,
        MAX_RENDER_DISTANCE,
      ),
      fov: clamp(Math.round(Number(source.fov ?? fallback.fov)), 60, 110),
      sensitivity: clamp(Number(source.sensitivity ?? fallback.sensitivity), 0.3, 2.5),
      volume: clamp(Number(source.volume ?? fallback.volume), 0, 1),
      debug: Boolean(source.debug ?? fallback.debug),
      dayMinutes: cycle.dayMinutes,
      nightMinutes: cycle.nightMinutes,
    };
  }

  saveLocalSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* localStorage can be unavailable; settings still apply for this session. */
    }
  }

  applySettings(persist) {
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.audio.setVolume(this.settings.volume);
    if (this.world) this.world.setRenderDistance(this.settings.renderDistance);
    this.syncSettingsInputs();
    if (persist) this.saveLocalSettings();
  }

  syncSettingsInputs() {
    const values = [
      ['settings-render-distance', 'settings-render-distance-value', this.settings.renderDistance, `${this.settings.renderDistance} чанков`],
      ['settings-fov', 'settings-fov-value', this.settings.fov, `${this.settings.fov}°`],
      ['settings-sensitivity', 'settings-sensitivity-value', this.settings.sensitivity, `${this.settings.sensitivity.toFixed(1)}×`],
      ['settings-volume', 'settings-volume-value', this.settings.volume, `${Math.round(this.settings.volume * 100)}%`],
      ['settings-cycle-length', 'settings-cycle-length-value', this.settings.dayMinutes, `${this.settings.dayMinutes} мин день · ${this.settings.nightMinutes} мин ночь`],
    ];
    for (const [inputId, outputId, value, text] of values) {
      const input = $(inputId);
      const output = $(outputId);
      if (input) input.value = String(value);
      if (output) output.textContent = text;
    }
    const debug = $('settings-debug');
    if (debug) debug.checked = this.settings.debug;
  }

  openSettings(returnState) {
    this.settingsReturn = returnState === 'paused' ? 'paused' : 'menu';
    this.syncSettingsInputs();
    this.setState('settings');
  }

  closeSettings() {
    this.setState(this.settingsReturn === 'paused' && this.world ? 'paused' : 'menu');
  }

  /* ------------------------------------------------------------------ */
  /* Saves                                                               */
  /* ------------------------------------------------------------------ */

  async readSave(worldId = null) {
    const id = worldId ?? this.currentWorldId;
    try {
      if (this.gameAPI?.loadWorld && id) return await this.gameAPI.loadWorld(id);
      if (id) {
        const raw = localStorage.getItem(SAVE_PREFIX + id);
        return raw ? JSON.parse(raw) : null;
      }
      // No world selected yet: fall back to the pre-multi-world single slot.
      const legacy = localStorage.getItem(LEGACY_SAVE_KEY);
      return legacy ? JSON.parse(legacy) : null;
    } catch (error) {
      console.error('Failed to read save', error);
      return null;
    }
  }

  isValidSave(save) {
    if (!save || typeof save !== 'object') return false;
    if (!Number.isFinite(Number(save.seed))) return false;
    return true;
  }

  /**
   * The localStorage fallback used to keep exactly one save under a single key.
   * Move it into the multi-world index so it still shows up in the list.
   */
  migrateLocalLegacy() {
    const list = readLocalWorlds();
    if (list.length > 0) return list;
    const legacy = localStorage.getItem(LEGACY_SAVE_KEY);
    if (!legacy) return list;

    let save = null;
    try {
      save = JSON.parse(legacy);
    } catch (error) {
      console.error('Legacy save is not valid JSON', error);
    }
    const id = 'world-1';
    const now = Number(save?.savedAt) || Date.now();
    localStorage.setItem(SAVE_PREFIX + id, legacy);
    localStorage.removeItem(LEGACY_SAVE_KEY);
    list.push({
      id,
      name: save?.name || (save?.seedLabel ? `Мир ${save.seedLabel}` : 'Мир 1'),
      seed: Number.isFinite(Number(save?.seed)) ? Number(save.seed) >>> 0 : 0,
      seedLabel: String(save?.seedLabel ?? save?.seed ?? ''),
      gameMode: normalizeGameMode(save?.gameMode),
      created: now,
      updated: now,
    });
    writeLocalWorlds(list);
    return list;
  }

  async refreshWorldList() {
    let list = [];
    try {
      list = this.gameAPI?.listWorlds
        ? await this.gameAPI.listWorlds()
        : this.migrateLocalLegacy();
    } catch (error) {
      console.error('Failed to list worlds', error);
    }
    this.worldList = (Array.isArray(list) ? list : [])
      .filter((entry) => entry && entry.id)
      .sort((a, b) => Number(b.updated ?? 0) - Number(a.updated ?? 0));

    if (!this.worldList.some((entry) => entry.id === this.selectedWorldId)) {
      this.selectedWorldId = this.worldList[0]?.id ?? null;
    }
    this.renderWorldList();
  }

  renderWorldList() {
    const container = $('world-list');
    const hint = $('world-list-hint');
    if (!container) return;
    container.replaceChildren();

    if (this.worldList.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'world-empty';
      empty.textContent = 'Пока нет миров. Нажми «Создать новый мир».';
      container.appendChild(empty);
      if (hint) hint.textContent = 'Создай первый мир';
      this.updateWorldActions();
      return;
    }

    for (const entry of this.worldList) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'world-row';
      row.dataset.id = entry.id;
      row.classList.toggle('selected', entry.id === this.selectedWorldId);

      const name = document.createElement('span');
      name.className = 'world-row-name';
      name.textContent = entry.name || entry.id;

      const date = document.createElement('span');
      date.className = 'world-row-date';
      date.textContent = formatDate(entry.updated);

      const meta = document.createElement('span');
      meta.className = 'world-row-meta';
      const seed = entry.seedLabel || (entry.seed != null ? String(entry.seed) : '—');
      const mode = GAME_MODE_LABELS[normalizeGameMode(entry.gameMode)];
      meta.textContent = `${mode} · Сид ${seed} · создан ${formatDate(entry.created)}`;

      row.append(name, date, meta);
      row.title = `${name.textContent}\n${meta.textContent}`;
      container.appendChild(row);
    }

    if (hint) hint.textContent = `${pluralWorlds(this.worldList.length)} · выбери и нажми «Играть»`;
    this.updateWorldActions();
  }

  updateWorldActions() {
    const hasSelection = !!this.getSelectedWorld();
    const play = $('btn-play-world');
    const remove = $('btn-delete-world');
    if (play) play.disabled = !hasSelection;
    if (remove) remove.disabled = !hasSelection;
  }

  getSelectedWorld() {
    return this.worldList.find((entry) => entry.id === this.selectedWorldId) ?? null;
  }

  selectWorld(id) {
    if (!id || !this.worldList.some((entry) => entry.id === id)) return;
    this.selectedWorldId = id;
    for (const row of $('world-list')?.querySelectorAll('.world-row') ?? []) {
      row.classList.toggle('selected', row.dataset.id === id);
    }
    this.updateWorldActions();
  }

  async playSelectedWorld() {
    const entry = this.getSelectedWorld();
    if (!entry) return;

    const save = await this.readSave(entry.id);
    const worldName = entry.name || entry.id;
    if (this.isValidSave(save)) {
      await this.beginWorld({ world: entry.id, worldName, save });
      return;
    }
    // The folder exists but the payload is missing or damaged: start over with
    // the seed we know about instead of silently refusing to launch.
    console.warn('World save is missing or invalid, starting fresh:', entry.id);
    await this.beginWorld({
      world: entry.id,
      worldName,
      seed: Number(entry.seed) >>> 0,
      seedLabel: String(entry.seedLabel ?? entry.seed ?? ''),
      gameMode: normalizeGameMode(entry.gameMode),
    });
  }

  async deleteSelectedWorld() {
    const entry = this.getSelectedWorld();
    if (!entry) return;
    const name = entry.name || entry.id;
    const confirmed = window.confirm(`Удалить мир «${name}»? Это действие нельзя отменить.`);
    if (!confirmed) return;
    try {
      if (this.gameAPI?.deleteWorld) await this.gameAPI.deleteWorld(entry.id);
      else {
        localStorage.removeItem(SAVE_PREFIX + entry.id);
        writeLocalWorlds(readLocalWorlds().filter((item) => item.id !== entry.id));
      }
      this.selectedWorldId = null;
      await this.refreshWorldList();
    } catch (error) {
      console.error('Failed to delete world', error);
    }
  }

  buildSaveData() {
    return {
      version: SAVE_VERSION,
      name: this.currentWorldName || undefined,
      seed: this.world.seed >>> 0,
      seedLabel: this.seedLabel,
      spawn: {
        x: this.spawn.x,
        y: this.spawn.y,
        z: this.spawn.z,
      },
      player: this.player.serialize(),
      inventory: this.inventory.serialize(),
      time: this.timeOfDay,
      gameMode: this.gameMode,
      dimension: this.dimension,
      returnPoint: this.returnPoint,
      entities: this.entities ? this.entities.serialize() : [],
      edits: this.world.serializeEdits(),
      fluids: this.fluids ? this.fluids.serialize() : [],
      renderDistance: this.world.renderDistance,
      settings: { ...this.settings, renderDistance: this.world.renderDistance },
      savedAt: Date.now(),
    };
  }

  /** Makes sure the running world has an id to be stored under. */
  async ensureWorldId() {
    if (this.currentWorldId) return this.currentWorldId;
    try {
      if (this.gameAPI?.createWorld) {
        const entry = await this.gameAPI.createWorld({ name: this.currentWorldName, gameMode: this.gameMode });
        this.currentWorldId = entry.id;
        this.currentWorldName = entry.name ?? this.currentWorldName;
        return this.currentWorldId;
      }
    } catch (error) {
      console.error('Failed to create world entry', error);
    }
    const id = makeWorldId();
    this.currentWorldId = id;
    return id;
  }

  async saveWorld(showToast = false, force = false) {
    if (!this.world || !this.player || !this.inventory) return true;
    // Guests stream the host's world and never write a local save.
    if (this.net?.role === 'client') return true;
    if (this.saving && !force) return false;
    this.saving = true;
    try {
      const data = this.buildSaveData();
      const id = await this.ensureWorldId();
      data.name = this.currentWorldName || data.name;
      if (this.gameAPI?.saveWorld) await this.gameAPI.saveWorld(id, data);
      else {
        localStorage.setItem(SAVE_PREFIX + id, JSON.stringify(data));
        const list = readLocalWorlds();
        let entry = list.find((item) => item.id === id);
        if (!entry) {
          entry = { id, name: data.name || id, created: Date.now() };
          list.push(entry);
        }
        entry.name = data.name || entry.name;
        entry.seed = data.seed;
        entry.seedLabel = data.seedLabel;
        entry.gameMode = data.gameMode;
        entry.updated = Date.now();
        writeLocalWorlds(list);
      }
      if (showToast) this.hud.toast('Мир сохранён');
      return true;
    } catch (error) {
      console.error('Failed to save world', error);
      if (showToast) this.hud.toast('Не удалось сохранить мир');
      return false;
    } finally {
      this.saving = false;
    }
  }

  async saveFromPause() {
    const button = $('btn-save');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Сохранение…';
    const ok = await this.saveWorld(false, true);
    button.disabled = false;
    button.textContent = ok ? 'Сохранено!' : 'Ошибка сохранения';
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  }

  async handleBeforeQuit() {
    if (this.quitting) return;
    this.quitting = true;
    try {
      if (this.inventoryUI.isOpen()) this.inventoryUI.close();
      if (this.world && this.player && this.inventory) {
        await this.saveWorld(false, true);
      }
    } catch (error) {
      console.error('Save before quit failed', error);
    } finally {
      this.gameAPI?.saveComplete?.();
    }
  }

  async quitApp() {
    this.input.enabled = false;
    this.input.exitLock();
    await this.saveWorld(false, true);
    this.leaveNetwork();
    if (this.gameAPI?.quit) this.gameAPI.quit();
    else window.close();
  }

  /* ------------------------------------------------------------------ */
  /* World lifecycle                                                     */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* LAN multiplayer                                                     */
  /* ------------------------------------------------------------------ */

  openNetworkScreen() {
    if (this.world) return;
    const nameInput = $('lan-name');
    if (nameInput) nameInput.value = this.netName;
    const portInput = $('lan-port');
    if (portInput) portInput.value = String(localStorage.getItem('voxelcraft:lanPort') || 25565);
    const addressInput = $('lan-address');
    if (addressInput) addressInput.value = localStorage.getItem('voxelcraft:lanAddress') || '';
    this.setLanStatus('Сервер ещё не запущен.');
    this.setState('network');
  }

  readNetName() {
    const name = ($('lan-name')?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 32) || 'Игрок';
    this.netName = name;
    this.appearance = { ...this.appearance, name };
    localStorage.setItem('voxelcraft:netName', name);
    return name;
  }

  setLanStatus(text, error = false) {
    const element = $('lan-status');
    if (!element) return;
    element.textContent = text;
    element.classList.toggle('error', Boolean(error));
  }

  async hostLanWorld() {
    if (this.world || this.state === 'loading') return;
    if (!this.gameAPI?.lanHost) {
      this.setLanStatus('Сетевой режим доступен только в Electron-приложении.', true);
      return;
    }
    const name = this.readNetName();
    const port = clamp(Number($('lan-port')?.value) || 25565, 1024, 65535);
    localStorage.setItem('voxelcraft:lanPort', String(port));

    this.net = { role: 'host', id: 'host', name, port };
    this.remotePlayers.clear();
    this.clearRemotePlayers();
    this.setLanStatus('Запуск сервера…');

    try {
      const info = await this.gameAPI.lanHost(port);
      this.net.port = info?.port ?? port;
      const addresses = (info.addresses?.length ? info.addresses : ['127.0.0.1'])
        .map((address) => `${address}:${info.port}`)
        .join(', ');
      this.setLanStatus(`Сервер запущен. Адрес для друзей: ${addresses}`);
      const seed = (Math.random() * 0xffffffff) >>> 0;
      await this.beginWorld({
        worldName: `${name} · LAN`,
        seed,
        seedLabel: String(seed),
        gameMode: GAME_MODE_SURVIVAL,
      });
    } catch (error) {
      this.net = null;
      this.setLanStatus(`Не удалось запустить сервер: ${error.message}`, true);
    }
  }

  async joinLanWorld() {
    if (this.world || this.state === 'loading') return;
    if (!this.gameAPI?.lanJoin) {
      this.setLanStatus('Сетевой режим доступен только в Electron-приложении.', true);
      return;
    }
    const name = this.readNetName();
    const address = ($('lan-address')?.value ?? '').trim();
    const port = clamp(Number($('lan-port')?.value) || 25565, 1024, 65535);
    if (!address) {
      this.setLanStatus('Введите адрес сервера, например 192.168.1.10.', true);
      return;
    }
    localStorage.setItem('voxelcraft:lanAddress', address);
    localStorage.setItem('voxelcraft:lanPort', String(port));

    this.net = { role: 'client', id: null, name };
    this.remotePlayers.clear();
    this.clearRemotePlayers();
    this.setLanStatus(`Подключение к ${address}:${port}…`);

    try {
      await this.gameAPI.lanJoin(address, port);
      // The server answers with `welcome`; the handler replies with `hello`.
      this.setLanStatus('Подключено. Ожидание мира от хоста…');
    } catch (error) {
      this.net = null;
      this.setLanStatus(`Не удалось подключиться: ${error.message}`, true);
    }
  }

  leaveNetwork() {
    this.gameAPI?.lanLeave?.();
    this.net = null;
    this.pendingNetworkState = null;
    this.remotePlayers.clear();
    this.clearRemotePlayers();
    this.hud?.setPlayerList?.([], 'Онлайн');
  }

  handleLanEvent(message) {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'welcome':
        if (this.net) {
          this.net.id = message.id;
          this.gameAPI?.lanSend?.({ type: 'hello', name: this.net.name });
        }
        break;
      case 'client-joined':
        if (this.net?.role === 'host') {
          this.setLanStatus(`${message.name || 'Игрок'} подключился`);
          this.ensureRemotePlayer(message.id, message.name);
          this.rememberRemotePlayer(message.id, message.name);
          if (this.world) this.broadcastNetworkState();
        }
        break;
      case 'player-joined':
        if (this.net && message.id !== this.net.id) {
          this.ensureRemotePlayer(message.id, message.name);
          this.rememberRemotePlayer(message.id, message.name);
        }
        break;
      case 'peer-left':
        this.removeRemotePlayer(message.id);
        if (this.net?.role === 'host' && message.name) {
          this.hud?.toast?.(`${message.name} вышел из игры`, 2600);
        }
        break;
      case 'state':
        if (this.net?.role === 'client') this.joinNetworkWorld(message);
        break;
      case 'player':
        this.updateRemotePlayer(message);
        break;
      case 'edit':
        this.applyNetworkEdit(message);
        break;
      case 'time':
        if (this.net?.role === 'client') {
          this.timeOfDay = clamp(Number(message.time) || 0, 0, 24000);
        }
        break;
      case 'drop':
        if (!this.drops) break;
        if (this.net?.role === 'host' && !Number.isFinite(Number(message.uid))) {
          // A guest announced a drop; the host owns it from now on.
          this.drops.spawn(
            Number(message.id), Number(message.count),
            Number(message.x) || 0, Number(message.y) || 0, Number(message.z) || 0,
            new THREE.Vector3(Number(message.vx) || 0, Number(message.vy) || 0, Number(message.vz) || 0),
            Number(message.pickupDelay) || 0.55,
          );
        } else if (this.net?.role === 'client' && Number.isFinite(Number(message.uid))) {
          const drop = this.drops.spawnRemote(
            Number(message.id), Number(message.count),
            Number(message.x) || 0, Number(message.y) || 0, Number(message.z) || 0,
            new THREE.Vector3(Number(message.vx) || 0, Number(message.vy) || 0, Number(message.vz) || 0),
            0.25, Number(message.uid),
          );
          if (drop && Number.isFinite(Number(message.age))) drop.age = Number(message.age);
        }
        break;
      case 'drop-remove':
        this.drops?.removeByUid(Number(message.uid));
        break;
      case 'drops':
        if (this.net?.role === 'client') this.drops?.applyState(message.items);
        break;
      case 'pickup': {
        if (this.net?.role !== 'host') break;
        const drop = this.drops?.findByUid(Number(message.uid));
        const remote = this.remotePlayers.get(message.id);
        if (!drop || !remote) break;
        const dx = drop.position.x - remote.x;
        const dy = drop.position.y - (remote.y + 0.85);
        const dz = drop.position.z - remote.z;
        if (dx * dx + dy * dy + dz * dz <= 4) this.grantNetworkDrop(message.id, drop);
        break;
      }
      case 'give': {
        if (this.net?.role !== 'client' || !message.stack) break;
        const remainder = this.inventory?.addStack({
          id: Number(message.stack.id), count: Number(message.stack.count),
        });
        this.audio?.playPickup();
        if (remainder && this.player) {
          this.drops?.spawnStack(remainder, this.player.position.x, this.player.position.y + 1, this.player.position.z, 0.4);
        }
        this.onInventoryChanged();
        if (this.inventoryUI.isOpen()) this.inventoryUI.render();
        break;
      }
      case 'attack':
        if (this.net?.role !== 'host') break;
        this.applyPlayerHit(
          message.target,
          message.damage,
          message.id,
          this.remotePlayers.get(message.id)?.name || 'Игрок',
        );
        break;
      case 'player-hit':
        if (message.target === this.net?.id || this.remotePlayers.has(message.target)) {
          this.applyPlayerHit(message.target, message.damage, message.attacker, message.attackerName);
        }
        break;
      case 'player-death': {
        const victim = this.remotePlayers.get(message.target);
        if (message.target === this.net?.id) {
          this.hud?.toast(`${message.killer || 'Игрок'} убил вас`, 3600);
        } else {
          if (victim) victim.health = 0;
          this.hud?.toast(`${message.killer || 'Игрок'} убил ${victim?.name || 'игрока'}`, 3200);
        }
        this.updatePlayerList();
        break;
      }
      case 'error':
        this.setLanStatus(`Ошибка сети: ${message.message}`, true);
        break;
      case 'disconnected':
        if (this.net?.role === 'client') {
          this.net = null;
          this.remotePlayers.clear();
          this.clearRemotePlayers();
          this.hud?.setPlayerList?.([], 'Онлайн');
          if (this.world) {
            this.hud?.toast?.('Соединение с сервером потеряно', 3200);
            this.exitToMainMenu();
          } else {
            this.setLanStatus('Соединение потеряно.', true);
          }
        }
        break;
      default:
        break;
    }
  }

  async joinNetworkWorld(state) {
    if (this.net?.role !== 'client' || this.world || this.state === 'loading') return;
    const spawn = state.spawn ?? { x: 0.5, y: 80, z: 0.5 };
    const angle = Math.random() * Math.PI * 2;
    const distance = 1 + Math.random() * 2.5;
    const save = {
      version: SAVE_VERSION,
      name: state.name || 'LAN-мир',
      seed: Number(state.seed) >>> 0,
      seedLabel: state.seedLabel ?? '',
      spawn,
      player: {
        x: spawn.x + Math.cos(angle) * distance,
        y: spawn.y,
        z: spawn.z + Math.sin(angle) * distance,
        yaw: 0,
        pitch: 0,
      },
      inventory: null,
      time: state.time ?? 6000,
      gameMode: normalizeGameMode(state.gameMode),
      dimension: state.dimension ?? 'overworld',
      edits: Array.isArray(state.edits) ? state.edits : [],
      fluids: Array.isArray(state.fluids) ? state.fluids : [],
      drops: Array.isArray(state.drops) ? state.drops : [],
      entities: [],
      renderDistance: state.renderDistance ?? this.settings.renderDistance,
      settings: { ...this.settings, ...(state.settings ?? {}) },
    };
    this.pendingNetworkState = state;
    await this.beginWorld({ worldName: save.name, save });
  }

  afterNetworkReady() {
    if (!this.net || !this.world || !this.player) return;
    if (this.net.role === 'host') {
      this.broadcastNetworkState();
      const port = localStorage.getItem('voxelcraft:lanPort') || '25565';
      this.hud?.toast?.(`LAN-сервер запущен · порт ${port}`, 3600);
      return;
    }

    const state = this.pendingNetworkState;
    if (state) {
      for (const player of state.players ?? []) {
        if (!player?.id || player.id === this.net.id) continue;
        this.ensureRemotePlayer(player.id, player.name);
        if (Number.isFinite(Number(player.x))) {
          this.updateRemotePlayer({ ...player, type: 'player' });
        }
      }
    }
    if (Array.isArray(state?.drops)) this.drops?.applyState(state.drops);
    this.pendingNetworkState = null;
    this.hud?.toast?.('Подключено к LAN-миру', 3000);
    this.sendNetworkPlayer();
    this.updatePlayerList();
  }

  networkPlayerPayload() {
    if (!this.player) return null;
    return {
      id: this.net?.id ?? 'pending',
      name: this.net?.name ?? 'Игрок',
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      health: Math.max(0, Math.round(this.player.health)),
      armor: (this.inventory?.armor ?? []).map((stack) => stack?.id ?? 0),
      appearance: this.appearance,
    };
  }

  networkPlayerList() {
    const list = [];
    const own = this.networkPlayerPayload();
    if (own) list.push(own);
    for (const [id, player] of this.remotePlayers) list.push({ id, ...player });
    return list;
  }

  broadcastNetworkState() {
    if (this.net?.role !== 'host' || !this.world || !this.player) return;
    this.gameAPI?.lanSend?.({
      type: 'state',
      name: this.currentWorldName || 'LAN-мир',
      seed: this.world.seed >>> 0,
      seedLabel: this.seedLabel,
      spawn: { x: this.spawn.x, y: this.spawn.y, z: this.spawn.z },
      time: this.timeOfDay,
      gameMode: this.gameMode,
      dimension: this.dimension,
      edits: this.world.serializeEdits(),
      fluids: this.fluids ? this.fluids.serialize() : [],
      drops: this.drops ? this.drops.serialize() : [],
      renderDistance: this.world.renderDistance,
      settings: { ...this.settings, renderDistance: this.world.renderDistance },
      player: this.player.serialize(),
      players: this.networkPlayerList(),
    });
  }

  sendNetworkPlayer() {
    if (!this.net || !this.player) return;
    const payload = this.networkPlayerPayload();
    if (payload) this.gameAPI?.lanSend?.({ type: 'player', ...payload });
  }

  sendNetworkEdit(x, y, z, id) {
    if (!this.net) return;
    this.gameAPI?.lanSend?.({ type: 'edit', x, y, z, id });
  }

  updateNetwork(dt) {
    if (!this.net || !this.player) return;
    this.netSendTimer += dt;
    if (this.netSendTimer < 0.15) return;
    this.netSendTimer = 0;
    this.sendNetworkPlayer();
    this.updatePlayerList();
    if (this.net.role === 'host') {
      this.networkClock += 0.15;
      if (this.networkClock >= 1.5) {
        this.networkClock = 0;
        this.gameAPI?.lanSend?.({ type: 'time', time: this.timeOfDay });
      }
      this.dropsClock += 0.15;
      if (this.dropsClock >= 0.75) {
        this.dropsClock = 0;
        this.gameAPI?.lanSend?.({ type: 'drops', items: this.drops?.serialize() ?? [] });
      }
    }
  }

  ensureRemotePlayer(id, name = 'Игрок') {
    if (!id || id === this.net?.id) return null;
    let model = this.remoteModels.get(id);
    if (!model) {
      model = new PlayerModel(name);
      model.setName(name);
      model.setVisible(false);
      this.scene.add(model.group);
      this.remoteModels.set(id, model);
    } else if (name) {
      model.setName(name);
    }
    return model;
  }

  /** Adds a placeholder so the online list shows a player before their first move. */
  rememberRemotePlayer(id, name = 'Игрок') {
    if (!id || id === this.net?.id || this.remotePlayers.has(id)) return;
    const at = this.player?.position ?? this.spawn ?? { x: 0, y: 0, z: 0 };
    this.remotePlayers.set(id, {
      name: name || 'Игрок',
      x: at.x, y: at.y, z: at.z,
      yaw: 0, pitch: 0, speed: 0, health: 20,
    });
  }

  updateRemotePlayer(message) {
    if (!message?.id || !this.net) return;
    if (message.id === this.net.id) return;
    const previous = this.remotePlayers.get(message.id);
    const speed = previous
      ? Math.hypot((Number(message.x) || 0) - previous.x, (Number(message.z) || 0) - previous.z) / 0.15
      : 0;
    const player = {
      name: message.name || previous?.name || 'Игрок',
      appearance: message.appearance ?? previous?.appearance ?? null,
      x: Number(message.x) || 0,
      y: Number(message.y) || 0,
      z: Number(message.z) || 0,
      yaw: Number(message.yaw) || 0,
      pitch: Number(message.pitch) || 0,
      speed,
      health: Number.isFinite(Number(message.health))
        ? Number(message.health)
        : (previous?.health ?? 20),
    };
    this.remotePlayers.set(message.id, player);
    const model = this.ensureRemotePlayer(message.id, player.name);
    if (!model) return;
    if (player.appearance) model.setAppearance(player.appearance);
    if (Array.isArray(message.armor)) {
      model.setArmor(message.armor.map((id) => (
        id ? { material: getItem(Number(id))?.iconMaterial } : null
      )));
    }
    model.setVisible(player.health > 0);
    model.update({
      position: new THREE.Vector3(player.x, player.y, player.z),
      yaw: player.yaw,
      pitch: player.pitch,
      velocity: { x: speed, z: 0 },
      onGround: true,
      sneaking: false,
    }, 0.15);
  }

  removeRemotePlayer(id) {
    if (!id) return;
    this.remotePlayers.delete(id);
    const model = this.remoteModels.get(id);
    if (model) {
      this.scene.remove(model.group);
      model.dispose();
      this.remoteModels.delete(id);
    }
  }

  clearRemotePlayers() {
    for (const id of [...this.remoteModels.keys()]) this.removeRemotePlayer(id);
    this.remotePlayers.clear();
  }

  applyNetworkEdit(message) {
    if (!this.world) return;
    const x = Math.floor(Number(message.x));
    const y = Math.floor(Number(message.y));
    const z = Math.floor(Number(message.z));
    const id = Number(message.id) || 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    if (y < 0 || y >= WORLD_HEIGHT || !this.world.isChunkLoadedAt(x, z)) return;
    if (!this.world.setBlock(x, y, z, id)) return;
    if (id === 0) {
      this.fluids?.remove(x, y, z);
      this.fluids?.wake(x, y, z);
    } else if (getBlock(id).fluid) {
      this.fluids?.setSource(x, y, z, id);
      this.fluids?.wake(x, y, z);
    } else {
      this.fluids?.remove(x, y, z);
      this.fluids?.wake(x, y, z);
    }
  }

  /* ---------- Shared drops, online list and PvP ---------- */

  configureDropsNetwork() {
    if (!this.drops) return;
    this.drops.networkSink = null;
    this.drops.onSpawn = null;
    this.drops.pickupHandler = null;
    if (this.net?.role === 'host') {
      this.drops.onSpawn = (drop) => this.broadcastDropSpawn(drop);
    } else if (this.net?.role === 'client') {
      this.drops.networkSink = (info) => this.sendDropSpawn(info);
      this.drops.pickupHandler = (drop) => this.requestDropPickup(drop);
    }
  }

  broadcastDropSpawn(drop) {
    if (this.net?.role !== 'host') return;
    this.gameAPI?.lanSend?.({
      type: 'drop',
      uid: drop.uid,
      id: drop.id,
      count: drop.count,
      x: drop.position.x,
      y: drop.position.y,
      z: drop.position.z,
      vx: drop.velocity.x,
      vy: drop.velocity.y,
      vz: drop.velocity.z,
      age: drop.age,
    });
  }

  sendDropSpawn(info) {
    if (this.net?.role !== 'client') return;
    this.gameAPI?.lanSend?.({ type: 'drop', ...info });
  }

  requestDropPickup(drop) {
    if (this.net?.role !== 'client') return false;
    this.gameAPI?.lanSend?.({ type: 'pickup', uid: drop.uid });
    return true;
  }

  grantNetworkDrop(clientId, drop) {
    if (!drop || !clientId) return;
    this.drops.removeByUid(drop.uid);
    this.gameAPI?.lanSend?.({ type: 'drop-remove', uid: drop.uid });
    this.gameAPI?.lanSendTo?.(clientId, {
      type: 'give', stack: { id: drop.id, count: drop.count },
    });
  }

  /** The host also picks up drops lying near connected players. */
  updateNetworkDrops() {
    if (this.net?.role !== 'host' || !this.drops) return;
    for (const drop of [...this.drops.drops]) {
      if (drop.age < 0.6) continue;
      for (const [id, player] of this.remotePlayers) {
        if ((player.health ?? 20) <= 0) continue;
        const dx = drop.position.x - player.x;
        const dy = drop.position.y - (player.y + 0.85);
        const dz = drop.position.z - player.z;
        if (dx * dx + dy * dy + dz * dz < 3.24) {
          this.grantNetworkDrop(id, drop);
          break;
        }
      }
    }
  }

  async autoHostCurrentWorld() {
    if (!this.gameAPI?.lanHost || this.net || !this.world) return;
    const port = clamp(Number(localStorage.getItem('voxelcraft:lanPort')) || 25565, 1024, 65535);
    this.net = { role: 'host', id: 'host', name: this.netName, port };
    this.remotePlayers.clear();
    this.clearRemotePlayers();
    this.configureDropsNetwork();
    try {
      const info = await this.gameAPI.lanHost(port);
      this.net.port = info?.port ?? port;
      this.broadcastNetworkState();
      this.hud.toast(`Онлайн · подключайтесь на порт ${this.net.port}`, 4200);
    } catch (error) {
      this.net = null;
      this.configureDropsNetwork();
      this.hud.toast(`Не удалось включить сеть: ${error.message}`, 4200);
    }
    this.updatePlayerList();
  }

  updatePlayerList() {
    if (!this.hud || !this.player) return;
    const entries = [{
      name: this.net?.name ?? this.netName,
      health: Math.max(0, Math.round(this.player.health)),
      self: true,
    }];
    for (const player of this.remotePlayers.values()) {
      entries.push({
        name: player.name || 'Игрок',
        health: Math.max(0, Math.round(player.health ?? 20)),
        self: false,
      });
    }
    const header = this.net?.role === 'host'
      ? `Онлайн · порт ${this.net.port ?? '—'}`
      : this.net?.role === 'client' ? 'Онлайн · LAN' : 'Онлайн';
    this.hud.setPlayerList(entries, header);
  }

  getAttackDamage() {
    const heldId = this.inventory?.selectedStack?.id ?? null;
    const tool = getToolInfo(heldId);
    let damage = 1;
    if (tool?.type === 'sword') damage = 3 + (tool.tier ?? 1);
    else if (tool?.type === 'axe') damage = 2 + (tool.tier ?? 1) * 0.6;
    else if (tool) damage = 1 + (tool.tier ?? 1) * 0.25;
    if (this.isCreative()) damage = Math.max(damage, 10);
    return damage;
  }

  pickRemotePlayer() {
    if (!this.net || !this.player || !this.remotePlayers.size) return null;
    const eye = this.player.eyePosition;
    const direction = this.player.getDirection();
    const ray = new THREE.Ray(eye, direction);
    let best = null;
    let bestDistance = 4.5;
    for (const [id, player] of this.remotePlayers) {
      if ((player.health ?? 20) <= 0) continue;
      const center = new THREE.Vector3(player.x, player.y + 1.02, player.z);
      const along = center.clone().sub(eye).dot(direction);
      if (along <= 0 || along > bestDistance) continue;
      if (ray.distanceSqToPoint(center) > 0.55 * 0.55) continue;
      best = { id, player, distance: along };
      bestDistance = along;
    }
    if (!best) return null;
    const block = this.player.raycast(this.world);
    if (block && block.distance < best.distance) return null;
    return best;
  }

  tryAttackPlayer() {
    const hit = this.pickRemotePlayer();
    if (!hit) return false;
    this.attackCooldown = 0.45;
    const damage = this.getAttackDamage();
    if (this.net.role === 'host') {
      this.applyPlayerHit(hit.id, damage, this.net.id, this.net.name);
    } else {
      this.gameAPI?.lanSend?.({ type: 'attack', target: hit.id, damage });
    }
    this.audio.playClick();
    return true;
  }

  applyPlayerHit(targetId, damage, attackerId, attackerName) {
    if (!this.net || !targetId) return;
    const amount = clamp(Number(damage) || 1, 0, 100);
    const message = {
      type: 'player-hit',
      target: targetId,
      damage: amount,
      attacker: attackerId,
      attackerName: attackerName || 'Игрок',
    };
    if (targetId === this.net.id) {
      if (attackerId !== this.net.id && this.player && !this.player.dead) {
        this.player.damage(amount, `игрок ${message.attackerName}`, true);
        this.hud.flashDamage();
        this.audio.playHurt();
      }
    } else {
      const remote = this.remotePlayers.get(targetId);
      if (remote) remote.health = Math.max(0, (remote.health ?? 20) - amount);
    }
    if (this.net.role === 'host') {
      this.gameAPI?.lanSend?.(message);
      const remote = this.remotePlayers.get(targetId);
      if ((targetId === this.net.id && this.player?.dead)
        || (remote && (remote.health ?? 20) <= 0)) {
        this.gameAPI?.lanSend?.({
          type: 'player-death', target: targetId, killer: message.attackerName,
        });
      }
    }
    this.updatePlayerList();
  }

  /** Opens the character editor from the menu without starting a world. */
  openCharacterOnly() {
    if (this.world) return;
    this.pendingWorldStart = null;
    this.characterReturnState = 'menu';
    if ($('btn-character-continue')) $('btn-character-continue').textContent = 'Сохранить';
    this.characterCreator.open(this.appearance);
    this.setState('character');
  }

  /** Every world/LAN start goes through the character screen first. */
  requestCharacter(start) {
    if (this.state === 'loading') return;
    this.pendingWorldStart = start;
    this.characterReturnState = ['new-world', 'network'].includes(this.state) ? this.state : 'menu';
    if ($('btn-character-continue')) $('btn-character-continue').textContent = 'В мир';
    this.characterCreator.open(this.appearance);
    this.setState('character');
  }

  confirmCharacter() {
    const appearance = saveAppearance(this.characterCreator.current());
    this.appearance = appearance;
    this.netName = appearance.name;
    if ($('lan-name')) $('lan-name').value = this.netName;
    this.playerModel.setAppearance(appearance);
    this.inventoryUI?.preview?.setAppearance(appearance);
    this.characterCreator.close();

    const start = this.pendingWorldStart;
    this.pendingWorldStart = null;
    if (start) this.runSafely(start());
    else this.setState(this.characterReturnState);
  }

  cancelCharacter() {
    this.characterCreator.close();
    this.pendingWorldStart = null;
    this.setState(this.characterReturnState);
  }

  openNewWorld() {
    $('seed-input').value = '';
    $('world-name-input').value = '';
    $('world-name-input').placeholder = `Мир ${this.worldList.length + 1}`;
    this.setRangeValue('render-distance', 'render-distance-value', this.settings.renderDistance, `${this.settings.renderDistance} чанков`);
    this.setRangeValue('sensitivity', 'sensitivity-value', this.settings.sensitivity, `${this.settings.sensitivity.toFixed(1)}×`);
    this.setGameModeInput(this.gameMode);
    this.setState('new-world');
    setTimeout(() => $('world-name-input')?.focus(), 30);
  }

  setGameModeInput(mode) {
    const value = normalizeGameMode(mode);
    for (const input of document.querySelectorAll('input[name="game-mode"]')) {
      input.checked = input.value === value;
    }
  }

  getGameModeInput() {
    const checked = document.querySelector('input[name="game-mode"]:checked');
    return normalizeGameMode(checked?.value);
  }

  setRangeValue(inputId, outputId, value, text) {
    const input = $(inputId);
    const output = $(outputId);
    if (input) input.value = String(value);
    if (output) output.textContent = text;
  }

  async createWorldFromDialog() {
    if (this.state === 'loading') return;
    const parsed = parseSeed($('seed-input').value);
    const renderDistance = clamp(Number($('render-distance').value) || DEFAULT_RENDER_DISTANCE, 3, MAX_RENDER_DISTANCE);
    const sensitivity = clamp(Number($('sensitivity').value) || 1, 0.3, 2.5);
    const gameMode = this.getGameModeInput();
    const seedLabel = parsed.label || String(parsed.seed);
    const name = $('world-name-input').value.trim() || `Мир ${this.worldList.length + 1}`;

    this.settings.renderDistance = renderDistance;
    this.settings.sensitivity = sensitivity;
    this.saveLocalSettings();

    // Register the world before generating it, so it already shows up in the
    // list even if the player quits during the first load.
    let entry = null;
    try {
      if (this.gameAPI?.createWorld) {
        entry = await this.gameAPI.createWorld({ name, seed: parsed.seed, seedLabel, gameMode });
      } else {
        const list = readLocalWorlds();
        entry = {
          id: makeWorldId(),
          name,
          seed: parsed.seed,
          seedLabel,
          gameMode,
          created: Date.now(),
          updated: Date.now(),
        };
        list.push(entry);
        writeLocalWorlds(list);
      }
    } catch (error) {
      console.error('Failed to create world', error);
    }

    await this.beginWorld({
      world: entry?.id ?? null,
      worldName: entry?.name ?? name,
      seed: parsed.seed,
      seedLabel,
      renderDistance,
      gameMode,
    });
  }

  async beginWorld({
    world = null,
    worldName = '',
    save = null,
    seed = null,
    seedLabel = '',
    renderDistance = null,
    gameMode = null,
  } = {}) {
    if (this.state === 'loading') return;

    // Mob spawning must see the loaded GLBs, not the procedural fallback.
    await preloadModels();

    this.disposeWorld();
    this.currentWorldId = world ?? null;
    this.currentWorldName = worldName || save?.name || '';
    this.loadingInfo = null;
    this.lastHeldId = null;
    this.lastHealth = 20;
    this.lastJumpTap = 0;
    this.mining = null;
    this.useTimer = 0;
    this.eatCooldown = 0;
    this.stepAccum = 0;
    this.hudAccum = 0;
    this.debugAccum = 0;
    this.autosaveTimer = 0;

    let worldSeed;
    let worldSeedLabel;
    let distance;
    let loadedSave = null;

    if (save && this.isValidSave(save)) {
      loadedSave = save;
      worldSeed = Number(save.seed) >>> 0;
      worldSeedLabel = String(save.seedLabel ?? worldSeed);
      distance = clamp(
        Math.round(Number(save.renderDistance ?? save.settings?.renderDistance ?? this.settings.renderDistance)),
        3,
        MAX_RENDER_DISTANCE,
      );
      this.settings = this.sanitizeSettings(
        { ...this.settings, ...(save.settings ?? {}), renderDistance: distance },
        this.settings,
      );
      this.debugVisible = this.settings.debug;
    } else {
      worldSeed = Number.isFinite(seed) ? (seed >>> 0) : parseSeed('').seed;
      worldSeedLabel = seedLabel || String(worldSeed);
      distance = clamp(
        Math.round(Number(renderDistance ?? this.settings.renderDistance)),
        3,
        MAX_RENDER_DISTANCE,
      );
      this.settings.renderDistance = distance;
    }

    this.gameMode = save && this.isValidSave(save)
      ? normalizeGameMode(save.gameMode)
      : normalizeGameMode(gameMode ?? this.gameMode);

    this.applySettings(true);
    this.setState('loading');
    if (this.loadingTitle) {
      this.loadingTitle.textContent = this.currentWorldName
        ? `${this.currentWorldName} · ${loadedSave ? 'загрузка' : 'генерация'}`
        : (loadedSave ? 'Загрузка мира' : 'Генерация мира');
    }
    this.setLoadingStatus('Подготовка чанков…', true);
    if (this.loadingProgress) this.loadingProgress.style.width = '0%';

    // Let the loading screen paint before the synchronous texture/material work.
    await this.nextFrame();
    await this.nextFrame();

    try {
      this.seedLabel = worldSeedLabel;
      this.world = new World({
        scene: this.scene,
        seed: worldSeed,
        renderDistance: distance,
        materials: this.createMaterials(distance),
        onProgress: () => {},
      });
      if (loadedSave?.edits) this.world.loadEdits(loadedSave.edits);
      this.fluids = new FluidSimulation(this.world);
      // Fluid levels reference blocks inside chunks that may not be loaded yet,
      // so the saved state is applied when the initial area is ready.
      this.pendingFluids = Array.isArray(loadedSave?.fluids) ? loadedSave.fluids : null;
      this.pendingDrops = Array.isArray(loadedSave?.drops) ? loadedSave.drops : null;

      this.sky = new Sky(this.scene);
      this.drops = new ItemDrops(this.scene, this.world, this.assets, this.audio);
      this.configureDropsNetwork();
      this.entities = new EntityManager({
        scene: this.scene,
        world: this.world,
        drops: this.drops,
        seed: worldSeed,
        audio: this.audio,
      });
      this.selection = this.createSelectionBox();

      if (loadedSave) {
        this.spawn = this.normalizeSpawn(loadedSave.spawn);
        this.timeOfDay = clamp(Number(loadedSave.time ?? 6000), 0, 24000);
        this.player = new Player(loadedSave.player ?? this.spawn);
        this.player.deserialize(loadedSave.player);
        this.inventory = Inventory.fromSerialized(loadedSave.inventory);
        if (this.net?.role === 'client' && this.isCreative() && this.inventory.isEmpty()) {
          this.inventory.fillCreativeKit();
        }
        this.returnPoint = this.normalizeReturnPoint(loadedSave.returnPoint);
      } else {
        const found = findSpawn(worldSeed);
        this.spawn = {
          x: found.x,
          y: found.y,
          z: found.z,
          biome: found.biome,
        };
        this.timeOfDay = 6000;
        this.player = new Player(this.spawn);
        // Survival starts empty, like a fresh Minecraft world. Creative gets
        // a convenient hotbar, while its catalog still provides infinite items.
        this.inventory = this.isCreative() ? Inventory.createCreative() : new Inventory();
      }
      this.player.setCreative(this.isCreative());
      this.player.armorPoints = this.inventory.armorPoints();
      this.updatePlayerModelArmor();
      this.dimension = dimensionAt(this.player.position.x, this.player.position.z);
      this.riding = null;
      this.teleportCooldown = 0;
      this.attackCooldown = 0;
      if (loadedSave?.entities) this.entities.load(loadedSave.entities, this.player.position);

      this.inventoryUI.inventory = this.inventory;
      this.inventoryUI.craftingSlots = new Array(9).fill(null);
      this.inventoryUI.cursorStack = null;
      this.lastHealth = this.player.health;
      this.loadingInfo = {
        mode: 'initial',
        isSave: !!loadedSave,
        center: {
          x: this.player.position.x,
          y: this.player.position.y,
          z: this.player.position.z,
        },
        startedAt: performance.now(),
        timeoutToast: false,
      };
      this.world.update(0, this.player.position);
      this.syncScreens();
      this.setLoadingStatus('Генерация рельефа…', true);
    } catch (error) {
      console.error('Failed to start world', error);
      this.showFatal(error);
    }
  }

  createMaterials(renderDistance) {
    this.materials = new TerrainMaterials(createTextureArray(this.assets), renderDistance);
    return this.materials;
  }

  createSelectionBox() {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    const material = new THREE.LineBasicMaterial({
      color: 0x101010,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.visible = false;
    lines.renderOrder = 6;
    lines.frustumCulled = false;
    this.scene.add(lines);
    return lines;
  }

  nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  normalizeSpawn(spawn) {
    if (!spawn || !Number.isFinite(Number(spawn.x)) || !Number.isFinite(Number(spawn.z))) {
      return { x: 0.5, y: 80, z: 0.5 };
    }
    return {
      x: Number(spawn.x),
      y: Number(spawn.y ?? 80),
      z: Number(spawn.z),
    };
  }

  normalizeReturnPoint(point) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.z))) return null;
    return { x: Number(point.x), y: Number(point.y ?? 80), z: Number(point.z) };
  }

  setLoadingStatus(text, force = false) {
    if (!force && text === this.lastLoadingStatus) return;
    this.lastLoadingStatus = text;
    if (this.loadingStatus) this.loadingStatus.textContent = text;
  }

  updateLoading(now) {
    const info = this.loadingInfo;
    if (!info || !this.world) return;

    const radius = info.mode === 'respawn' ? 1 : 2;
    const { ready, total } = this.world.countReadyWithin(radius, info.center.x, info.center.z);
    const stats = this.world.getStats();
    const elapsed = (now - info.startedAt) / 1000;
    const progress = total > 0 ? ready / total : 0;

    if (this.loadingProgress) {
      this.loadingProgress.style.width = `${Math.round(progress * 100)}%`;
    }

    if (info.mode === 'respawn') {
      this.setLoadingStatus(`Поиск безопасного места · ${ready}/${total} чанков`);
    } else if (info.mode === 'travel') {
      this.setLoadingStatus(`Переход между измерениями · ${ready}/${total} чанков`);
    } else {
      this.setLoadingStatus(
        `Чанки ${ready}/${total} · генерация ${stats.genQueue + stats.genInFlight}`
        + ` · меши ${stats.meshQueue + stats.meshInFlight}`,
      );
    }

    const minimum = info.mode === 'respawn' ? 1 : 9;
    if (ready >= total || (elapsed > 30 && ready >= minimum)) {
      if (elapsed > 30 && ready < total && !info.timeoutToast) {
        info.timeoutToast = true;
        console.warn('World loading is taking longer than expected; continuing with loaded chunks.');
      }
      this.finishLoading(info);
    }
  }

  finishLoading(info) {
    if (!this.world || !this.player || !this.inventory) return;

    if (info.mode === 'travel') {
      const safeY = this.safeSurfaceY(
        this.player.position.x,
        this.player.position.z,
        this.player.position.y,
      );
      this.player.position.y = safeY;
      this.player.velocity.set(0, 0, 0);
      this.player.fallDistance = 0;
      this.player.damageCooldown = 0.6;
      this.dimension = dimensionAt(this.player.position.x, this.player.position.z);
    } else if (info.mode === 'respawn') {
      const safeY = this.safeSurfaceY(this.spawn.x, this.spawn.z, this.spawn.y);
      this.spawn.y = safeY;
      this.player.position.set(this.spawn.x, safeY, this.spawn.z);
      this.player.velocity.set(0, 0, 0);
      this.player.dead = false;
      this.player.damageCooldown = 0.5;
      this.lastHealth = this.player.health;
      this.hud.toast('Возрождение');
    } else if (info.isSave) {
      this.player.position.y = this.safeLoadedY(
        this.player.position.x,
        this.player.position.y,
        this.player.position.z,
      );
      this.player.velocity.set(0, 0, 0);
      this.spawn = this.normalizeSpawn(this.spawn);
      this.spawn.y = this.safeSurfaceY(this.spawn.x, this.spawn.z, this.spawn.y);
    } else {
      const safeY = this.safeSurfaceY(this.spawn.x, this.spawn.z, this.spawn.y);
      this.spawn.y = safeY;
      this.player.position.set(this.spawn.x, safeY, this.spawn.z);
      this.player.velocity.set(0, 0, 0);
    }

    if (info.mode === 'initial' && this.pendingFluids) {
      this.fluids?.load(this.pendingFluids);
      this.pendingFluids = null;
    }
    if (info.mode === 'initial' && this.pendingDrops) {
      this.drops?.applyState(this.pendingDrops);
      this.pendingDrops = null;
    }

    this.loadingInfo = null;
    this.lastHealth = this.player.health;
    this.lastHeldId = null;
    this.hudAccum = 0;
    this.debugAccum = 0;
    this.autosaveTimer = 0;
    this.stepAccum = 0;

    if (this.player.dead) {
      this.setState('dead');
      this.input.enabled = false;
      this.input.exitLock();
      $('death-cause').textContent = 'Вы не пережили прошлую встречу с этим миром.';
      this.hud.updateStats(this.player);
      this.hud.updateHotbar(this.inventory);
      return;
    }

    this.setState('playing');
    this.input.enabled = true;
    this.refreshHeld(true);
    this.hud.updateStats(this.player);
    this.hud.updateHotbar(this.inventory);
    this.hud.setUnderwater(this.player.headInWater);
    this.updateHud(1, true);
    this.requestLockWithHint();
    this.afterNetworkReady();
    if (!this.net && info.mode === 'initial' && this.gameAPI?.lanHost) {
      // Every world is online: a fresh singleplayer world also hosts a LAN server.
      this.runSafely(this.autoHostCurrentWorld());
    }
    this.updatePlayerList();

    if (info.mode === 'respawn') {
      this.hud.setBreakProgress(0);
    } else if (info.mode === 'travel') {
      const names = { overworld: 'Верхний мир', nether: 'Ад', end: 'Край' };
      this.hud.toast(names[this.dimension] ?? 'Новое измерение', 2400);
    } else if (info.isSave) {
      this.hud.toast(`${this.currentWorldName || 'Мир'} загружен · ${GAME_MODE_LABELS[this.gameMode]} · сид ${this.seedLabel}`, 2400);
    } else {
      this.hud.toast(`${this.currentWorldName || 'Новый мир'} · ${GAME_MODE_LABELS[this.gameMode]} · сид ${this.seedLabel}`, 2400);
    }
  }

  requestLockWithHint() {
    try {
      this.input.requestLock();
    } catch (error) {
      // Pointer lock must never be able to take the whole game down; when it
      // is unavailable the "click to capture the mouse" hint below is enough.
      console.warn('Pointer lock unavailable', error);
    }
    clearTimeout(this.lockHintTimer);
    this.lockHintTimer = setTimeout(() => {
      if (this.state === 'playing' && !this.input.locked) {
        this.hud.toast('Нажмите на мир, чтобы захватить мышь', 3200);
      }
    }, 900);
  }

  disposeWorld() {
    this.disposingWorld = true;
    this.resetMining();
    if (this.inventoryUI?.isOpen()) this.inventoryUI.close();
    if (this.fluids) {
      this.fluids.dispose();
      this.fluids = null;
    }
    this.pendingFluids = null;
    this.pendingDrops = null;
    if (this.world) {
      this.world.dispose();
      this.world = null;
    }
    if (this.entities) {
      this.entities.dispose();
      this.entities = null;
    }
    if (this.drops) {
      this.drops.dispose();
      this.drops = null;
    }
    if (this.sky) {
      this.scene.remove(this.sky.mesh);
      this.scene.remove(this.sky.clouds);
      this.sky.dispose();
      this.sky = null;
    }
    if (this.materials) {
      this.materials.dispose();
      this.materials = null;
    }
    if (this.selection) {
      this.scene.remove(this.selection);
      this.selection.geometry.dispose();
      this.selection.material.dispose();
      this.selection = null;
    }
    this.player = null;
    this.inventory = null;
    this.playerModel.setVisible(false);
    this.playerModel.setArmor([]);
    this.clearRemotePlayers();
    this.loadingInfo = null;
    this.dimension = 'overworld';
    this.returnPoint = null;
    this.teleportCooldown = 0;
    this.attackCooldown = 0;
    this.riding = null;
    this.hud.setBreakProgress(0);
    this.hud.setUnderwater(false);
    this.hud.setDebug(false);
    this.lastDebugVisible = false;
    this.disposingWorld = false;
  }

  async exitToMainMenu() {
    this.input.enabled = false;
    this.input.clearMouseButtons();
    this.input.exitLock();
    if (this.world && this.player && this.inventory) {
      await this.saveWorld(false, true);
    }
    this.leaveNetwork();
    const previousWorld = this.currentWorldId;
    this.disposeWorld();
    this.setState('menu');
    await this.refreshWorldList();
    if (previousWorld && this.worldList.some((entry) => entry.id === previousWorld)) {
      this.selectWorld(previousWorld);
    }
    this.currentWorldId = null;
    this.currentWorldName = '';
  }

  showFatal(error) {
    const box = $('fatal-error');
    const text = $('fatal-error-text');
    if (text) text.textContent = error?.stack ?? String(error);
    if (box) box.classList.remove('hidden');
    this.setState('fatal');
  }

  /* ------------------------------------------------------------------ */
  /* Spawn safety                                                        */
  /* ------------------------------------------------------------------ */

  isSpaceFree(x, y, z) {
    return !this.world.isSolidAt(x, y, z) && !this.world.isSolidAt(x, y + 1, z);
  }

  safeSurfaceY(x, z, fallback = 80) {
    if (!this.world) return fallback;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const height = this.world.getHeightAt(bx, bz);
    let start = height != null ? height + 1 : Math.floor(fallback);
    start = clamp(start, 1, WORLD_HEIGHT - 3);
    for (let y = start; y < Math.min(WORLD_HEIGHT - 2, start + 48); y++) {
      if (this.isSpaceFree(bx, y, bz)) return y + 0.05;
    }
    return clamp(start + 0.05, 1, WORLD_HEIGHT - 2);
  }

  safeLoadedY(x, y, z) {
    if (!this.world) return y;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    let start = clamp(Math.floor(y), 1, WORLD_HEIGHT - 3);
    for (let offset = 0; offset < 24; offset++) {
      const candidate = start + offset;
      if (candidate >= WORLD_HEIGHT - 2) break;
      if (this.isSpaceFree(bx, candidate, bz)) return candidate + 0.05;
    }
    return this.safeSurfaceY(x, z, y);
  }

  /* ------------------------------------------------------------------ */
  /* State transitions                                                   */
  /* ------------------------------------------------------------------ */

  pause() {
    if (this.state !== 'playing' || !this.world) return;
    this.resetMining();
    this.input.enabled = false;
    this.input.clearMouseButtons();
    this.input.exitLock();
    this.setState('paused');
    this.updatePauseStats();
    this.saveWorld(false);
  }

  resume() {
    if (this.state !== 'paused' || !this.world) return;
    this.setState('playing');
    this.input.enabled = true;
    this.input.clearMouseButtons();
    this.requestLockWithHint();
  }

  updatePauseStats() {
    const container = $('pause-stats');
    if (!container || !this.world || !this.player) return;
    container.replaceChildren();
    const stats = this.world.getStats();
    const entries = [
      ['Режим', GAME_MODE_LABELS[this.gameMode]],
      ['Сид', this.seedLabel],
      ['Сеть', this.net ? (this.net.role === 'host' ? 'LAN-сервер' : 'LAN-клиент') : 'Локальная игра'],
      ['Позиция', `${Math.floor(this.player.position.x)} ${Math.floor(this.player.position.y)} ${Math.floor(this.player.position.z)}`],
      ['Время', `${formatClock(this.timeOfDay)} · день ${this.settings.dayMinutes}м / ночь ${this.settings.nightMinutes}м`],
      ['Чанки', `${stats.readyChunks} готово / ${stats.loadedChunks} загружено`],
      ['Треугольники', formatNumber(stats.triangles)],
      ['Дальность', `${this.world.renderDistance} чанков`],
    ];
    for (const [label, value] of entries) {
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const valueEl = document.createElement('strong');
      valueEl.textContent = value;
      container.append(labelEl, valueEl);
    }
  }

  openInventory(size) {
    if (this.state !== 'playing' || !this.world || !this.inventory) return;
    this.resetMining();
    this.input.enabled = false;
    this.input.clearMouseButtons();
    this.setState('inventory');
    this.input.exitLock();
    this.inventoryUI.inventory = this.inventory;
    this.inventoryUI.open(size, { creative: this.isCreative() });
  }

  closeInventory() {
    if (this.state !== 'inventory') return;
    this.inventoryUI.close();
    this.setState('playing');
    this.input.enabled = true;
    this.input.clearMouseButtons();
    this.requestLockWithHint();
  }

  openTrade(entity) {
    if (this.state !== 'playing' || !entity || !this.inventory) return;
    this.resetMining();
    this.input.enabled = false;
    this.input.clearMouseButtons();
    this.input.exitLock();
    this.tradeEntity = entity;
    this.tradeOffers = offersForVillager(entity);
    this.setState('trade');
    this.tradeUI.open(entity.name || 'Житель', this.tradeOffers, this.inventory);
    this.audio.playClick();
  }

  closeTrade() {
    if (this.state !== 'trade') return;
    this.tradeUI.close();
    this.tradeEntity = null;
    this.tradeOffers = [];
    this.setState('playing');
    this.input.enabled = true;
    this.input.clearMouseButtons();
    this.requestLockWithHint();
  }

  executeTrade(offer) {
    if (!this.inventory || !this.tradeEntity || this.state !== 'trade') return false;
    const result = performTrade(this.inventory, offer);
    if (result === false) {
      this.hud.toast('Не хватает предметов для обмена');
      return false;
    }
    if (result) {
      const p = this.player.position;
      this.drops?.spawnStack(result, p.x, p.y + 1, p.z, 0.6);
    }
    this.audio.playClick();
    this.hud.toast('Обмен выполнен');
    this.onInventoryChanged();
    this.tradeUI.render();
    return true;
  }

  enterDeathState(dropItems) {
    if (this.state === 'dead' || !this.world || !this.player) return;
    this.resetMining();
    this.input.enabled = false;
    this.input.clearMouseButtons();
    this.input.exitLock();

    if (dropItems && this.inventory && this.drops) {
      const p = this.player.position;
      for (const stack of this.inventory.slots) {
        if (!stack) continue;
        this.drops.spawnStack(stack, p.x, p.y + 1.2, p.z, 1.5);
      }
      this.inventory.clear();
      this.onInventoryChanged();
    }

    const cause = this.player.lastDamageCause || 'неизвестная причина';
    $('death-cause').textContent = `Причина: ${cause}. Инвентарь остался на месте гибели.`;
    this.setState('dead');
  }

  startRespawn() {
    if (!this.world || !this.player || this.state !== 'dead') return;
    this.player.respawn(this.spawn);
    this.lastHealth = this.player.health;
    this.loadingInfo = {
      mode: 'respawn',
      isSave: false,
      center: { x: this.spawn.x, y: this.spawn.y, z: this.spawn.z },
      startedAt: performance.now(),
      timeoutToast: false,
    };
    if (this.loadingTitle) this.loadingTitle.textContent = 'Возрождение';
    this.setLoadingStatus('Поиск безопасного места…', true);
    if (this.loadingProgress) this.loadingProgress.style.width = '0%';
    this.setState('loading');
    this.world.update(0, this.player.position);
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  handleKeyDown(event) {
    if (event.repeat) return;
    const code = event.code;

    if (code === 'F3') {
      event.preventDefault();
      this.debugVisible = !this.debugVisible;
      this.updateDebug(true);
      return;
    }

    if (code === 'F5') {
      event.preventDefault();
      this.cycleCameraMode();
      return;
    }

    if (this.state === 'trade') {
      if (code === 'KeyE' || code === 'Escape') {
        event.preventDefault();
        this.closeTrade();
      }
      return;
    }

    if (this.state === 'inventory') {
      if (code === 'KeyE' || code === 'Escape') {
        event.preventDefault();
        this.closeInventory();
      }
      return;
    }

    if (this.state === 'paused') {
      if (code === 'Escape') {
        event.preventDefault();
        this.resume();
      }
      return;
    }

    if (this.state === 'settings') {
      if (code === 'Escape') {
        event.preventDefault();
        this.closeSettings();
      }
      return;
    }

    if (this.state === 'character') {
      if (code === 'Escape') {
        event.preventDefault();
        this.cancelCharacter();
      }
      return;
    }

    if (this.state === 'new-world' || this.state === 'network') {
      if (code === 'Escape') {
        event.preventDefault();
        this.setState('menu');
      }
      return;
    }

    if (this.state === 'dead') {
      if (code === 'Enter' || code === 'Space') {
        event.preventDefault();
        this.startRespawn();
      }
      return;
    }

    if (this.state !== 'playing') return;

    if (this.isCreative() && code === 'Space' && !event.repeat) {
      const now = performance.now();
      if (now - this.lastJumpTap < 320) {
        this.lastJumpTap = 0;
        if (this.player) {
          this.player.flying = !this.player.flying;
          this.player.velocity.y = 0;
          this.hud.toast(this.player.flying ? 'Полёт включён' : 'Полёт выключен');
        }
        event.preventDefault();
        return;
      }
      this.lastJumpTap = now;
    }

    if (code === 'KeyE') {
      event.preventDefault();
      this.openInventory(2);
    } else if (code === 'Escape') {
      event.preventDefault();
      this.pause();
    } else if (code.startsWith('Digit')) {
      const index = Number(code.slice(5));
      if (index >= 1 && index <= 9) {
        event.preventDefault();
        this.selectHotbar(index - 1);
      }
    } else if (code === 'KeyQ') {
      event.preventDefault();
      this.dropSelected();
    }
  }

  selectHotbar(index) {
    if (!this.inventory) return;
    this.inventory.setSelected(index);
    this.refreshHeld(false);
  }

  cycleCameraMode() {
    if (!this.player) return;
    this.cameraMode = (this.cameraMode + 1) % 3;
    const labels = ['Вид от первого лица', 'Вид от третьего лица', 'Вид спереди'];
    this.hud.toast(labels[this.cameraMode]);
  }

  /* ------------------------------------------------------------------ */
  /* Gameplay                                                            */
  /* ------------------------------------------------------------------ */

  frame(now) {
    requestAnimationFrame(this.animate);
    if (!this.lastTime) this.lastTime = now;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    this.updateRenderScale(dt);

    if (!this.world || !this.player || !this.inventory) return;

    if (this.state === 'playing' || this.state === 'inventory' || this.state === 'trade' || this.state === 'loading') {
      this.world.update(dt, this.player.position);
    }

    if (this.state === 'loading') {
      this.updateLoading(now);
    } else if (this.state === 'playing') {
      this.updatePlaying(dt);
    } else if (this.state === 'inventory') {
      this.updateHud(dt);
      this.inventoryUI.tickPreview(dt);
    } else if (this.state === 'trade') {
      this.updateHud(dt);
    }

    const active = this.state === 'playing' || this.state === 'inventory' || this.state === 'trade' || this.state === 'loading';
    this.updateEnvironment(active ? dt : 0);
    this.renderer.render(this.scene, this.camera);
  }

  updatePlaying(dt) {
    if (!this.world || !this.player || !this.inventory) return;
    if (this.player.dead) {
      this.enterDeathState(true);
      return;
    }

    this.eatCooldown = Math.max(0, this.eatCooldown - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.teleportCooldown = Math.max(0, this.teleportCooldown - dt);

    const look = this.input.consumeMouseDelta();
    if (this.input.locked) {
      this.player.look(look.x, look.y, this.settings.sensitivity);
    }

    const previousHealth = this.player.health;
    if (this.riding && !this.riding.dead) {
      this.updateRiding(dt);
    } else {
      this.riding = null;
      this.player.update(dt, this.input, this.world, true);
    }
    if (this.player.health < previousHealth - 0.001) {
      this.hud.flashDamage();
      this.audio.playHurt();
      if (!this.isCreative() && this.inventory.damageArmor(1)) {
        this.player.armorPoints = this.inventory.armorPoints();
        this.updatePlayerModelArmor();
        if (this.inventoryUI.isOpen()) this.inventoryUI.render();
      }
    }
    if (this.player.dead) {
      this.enterDeathState(true);
      return;
    }

    this.checkDimensionTravel();
    if (this.state !== 'playing') return;

    this.fluids?.update(dt);

    this.entities?.update(dt, this.player, {
      timeOfDay: this.timeOfDay,
      creative: this.isCreative(),
      day: isDaytime(this.timeOfDay),
    });

    this.timeOfDay = advanceTimeOfDay(
      this.timeOfDay,
      dt,
      this.settings.dayMinutes,
      this.settings.nightMinutes,
    );
    this.updateFootsteps(dt);

    const pickedUp = this.drops.update(dt, this.player, this.inventory);
    if (pickedUp) {
      this.onInventoryChanged();
      if (this.inventoryUI.isOpen()) this.inventoryUI.render();
    }
    this.updateNetworkDrops();

    if (this.riding) {
      // Mounted players steer the animal instead of mining or placing blocks.
      if (this.selection) this.selection.visible = false;
      this.resetMining();
    } else {
      this.updateTarget();
      this.updateMining(dt);
      this.updateUse(dt);
    }
    this.updateHud(dt);
    this.updateNetwork(dt);

    this.autosaveTimer += dt;
    if (this.autosaveTimer >= 60) {
      this.autosaveTimer = 0;
      this.saveWorld(false);
    }
  }

  updateFootsteps(dt) {
    if (!this.player.onGround || this.player.inWater) {
      this.stepAccum = 0;
      return;
    }
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    if (speed < 0.4) {
      this.stepAccum = 0;
      return;
    }
    this.stepAccum += speed * dt;
    const stride = this.player.sprinting ? 1.65 : 2.15;
    if (this.stepAccum >= stride) {
      this.stepAccum = 0;
      const below = this.world.getBlock(
        Math.floor(this.player.position.x),
        Math.floor(this.player.position.y - 0.2),
        Math.floor(this.player.position.z),
      );
      this.audio.playStep(getBlock(below));
    }
  }

  updateTarget() {
    if (!this.selection) return;
    const target = this.player.raycast(this.world);
    if (!target) {
      this.selection.visible = false;
      return;
    }
    this.selection.visible = true;
    this.selection.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  }

  resetMining() {
    this.mining = null;
    this.hud.setBreakProgress(0);
  }

  updateMining(dt) {
    if (!this.input.isMouseDown(0) || !this.input.locked) {
      this.resetMining();
      return;
    }

    if (this.tryAttack()) {
      this.resetMining();
      return;
    }

    const blockTarget = this.player.raycast(this.world);
    if (!blockTarget) {
      this.resetMining();
      return;
    }

    const block = getBlock(blockTarget.id);
    if (!block || (block.hardness < 0 && !this.isCreative())) {
      this.resetMining();
      return;
    }

    const heldId = this.inventory.selectedStack?.id ?? null;
    const key = `${blockTarget.x},${blockTarget.y},${blockTarget.z}`;
    if (!this.mining || this.mining.key !== key || this.mining.heldId !== heldId) {
      this.mining = {
        key,
        x: blockTarget.x,
        y: blockTarget.y,
        z: blockTarget.z,
        heldId,
        time: 0,
        progress: 0,
        breakTime: this.isCreative() ? 0.05 : this.player.getBreakTime(block, heldId),
        soundTimer: 0,
      };
    }

    const mining = this.mining;
    mining.time += dt;
    mining.progress = Math.min(1, mining.time / mining.breakTime);
    mining.soundTimer -= dt;
    if (mining.soundTimer <= 0) {
      mining.soundTimer = 0.23;
      this.audio.playStep(block);
    }
    this.hud.setBreakProgress(mining.progress);

    if (mining.progress >= 1) {
      this.breakBlock(mining, block);
      this.resetMining();
    }
  }

  breakBlock(mining, block) {
    const heldId = this.inventory.selectedStack?.id ?? null;
    if (!this.world.setBlock(mining.x, mining.y, mining.z, 0)) return;
    this.fluids?.wake(mining.x, mining.y, mining.z);
    this.sendNetworkEdit(mining.x, mining.y, mining.z, 0);
    this.audio.playBreak(block);
    if (!this.isCreative()) {
      this.drops.spawnBlockDrops(block, mining.x, mining.y, mining.z, this.player, heldId);
      if (this.inventory.damageSelected(1)) {
        this.hud.toast('Инструмент сломан');
      }
    }
    this.onInventoryChanged();
  }

  updateUse(dt) {
    const down = this.input.isMouseDown(2);
    if (!down) {
      this.useTimer = 0;
      return;
    }
    this.useTimer = Math.max(0, this.useTimer - dt);
    if (this.useTimer > 0) return;
    this.useTimer = 0.22;
    this.useItem();
  }

  useItem() {
    if (!this.world || !this.player || !this.inventory) return;
    const target = this.player.raycast(this.world);

    if (target && !this.player.sneaking) {
      const targetBlock = getBlock(target.id);
      if (targetBlock.interactive === 'crafting') {
        this.openInventory(3);
        return;
      }
      if (targetBlock.interactive === 'bed') {
        this.sleepInBed(target);
        return;
      }
    }

    if (!this.player.sneaking) {
      const villager = this.entities?.pick(
        this.player.eyePosition,
        this.player.getDirection(),
        4.5,
      )?.entity;
      if (villager?.kind === 'villager') {
        this.openTrade(villager);
        return;
      }
    }

    const stack = this.inventory.selectedStack;
    if (!stack) return;
    const item = getItem(stack.id);
    if (!item) return;

    if (item.use && this.useSpecialItem(item, target)) return;

    if (item.food) {
      this.eatHeld(item);
      return;
    }
    if (item.placeBlock) {
      this.placeBlock(target, item.placeBlock);
    }
  }

  /** Handles flint and steel, buckets, saddles, shears and ender eyes. */
  useSpecialItem(item, target) {
    if (item.use === 'ignite') {
      return this.ignitePortal(target);
    }

    if (item.use === 'bucket' || item.use === 'bucket_water' || item.use === 'bucket_lava') {
      return this.useBucket(item);
    }

    if (item.use === 'shears') {
      const picked = this.entities?.pick(
        this.player.eyePosition,
        this.player.getDirection(),
        4.6,
      )?.entity;
      if (!picked || picked.type !== 'sheep' || picked.sheared) return false;
      picked.sheared = true;
      const count = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        this.drops?.spawn(42, 1, picked.position.x, picked.position.y + 0.6, picked.position.z);
      }
      if (!this.isCreative() && this.inventory.damageSelected(1)) this.hud.toast('Ножницы сломаны');
      this.audio.playClick();
      this.hud.toast('Шерсть сострижена');
      this.onInventoryChanged();
      return true;
    }

    if (item.use === 'saddle') {
      const entity = this.findRideable();
      if (!entity) return false;
      if (entity.saddled) {
        this.mount(entity);
        return true;
      }
      entity.tamed = true;
      entity.saddled = true;
      if (!this.isCreative()) this.inventory.consumeSelected(1);
      this.audio.playClick();
      this.hud.toast(`${entity.name} оседлан`);
      this.onInventoryChanged();
      return true;
    }

    if (item.use === 'horse_armor') {
      const entity = this.findRideable();
      if (!entity) return false;
      entity.tamed = true;
      entity.armored = true;
      if (!this.isCreative()) this.inventory.consumeSelected(1);
      this.audio.playClick();
      this.hud.toast(`Конская броня надета на ${entity.name.toLowerCase()}`);
      this.onInventoryChanged();
      return true;
    }

    return false;
  }

  findRideable() {
    if (!this.entities) return null;
    const picked = this.entities.pick(this.player.eyePosition, this.player.getDirection(), 5)?.entity;
    if (picked?.mob?.rideable) return picked;
    const near = this.entities.findAllNear(this.player.position.x, this.player.position.z, 4.5);
    return near.find((entity) => entity.mob?.rideable) ?? null;
  }

  useBucket(item) {
    if (item.use === 'bucket') {
      const fluid = this.player.raycast(this.world, 6, true);
      if (!fluid) return false;
      let filled = null;
      if (fluid.id === 11) filled = 416;
      else if (fluid.id === 30) filled = 417;
      if (!filled) return false;
      this.world.setBlock(fluid.x, fluid.y, fluid.z, 0);
      this.sendNetworkEdit(fluid.x, fluid.y, fluid.z, 0);
      this.fluids?.remove(fluid.x, fluid.y, fluid.z);
      this.fluids?.wake(fluid.x, fluid.y, fluid.z);
      if (!this.isCreative()) {
        this.inventory.setSlot(this.inventory.selected, createItemStack(filled, 1));
      }
      this.audio.playClick();
      this.onInventoryChanged();
      return true;
    }

    const placedId = item.use === 'bucket_lava' ? 30 : 11;
    const blockTarget = this.player.raycast(this.world);
    if (!blockTarget) return false;
    const x = blockTarget.x + blockTarget.normal.x;
    const y = blockTarget.y + blockTarget.normal.y;
    const z = blockTarget.z + blockTarget.normal.z;
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    if (!this.world.isChunkLoadedAt(x, z)) return false;
    const existingId = this.world.getBlock(x, y, z);
    if (existingId !== 0 && !getBlock(existingId).fluid) return false;
    if (this.player.intersectsBlock(x, y, z)) {
      this.hud.toast('Здесь стоите вы');
      return false;
    }
    if (!this.world.setBlock(x, y, z, placedId)) return false;
    this.sendNetworkEdit(x, y, z, placedId);
    this.fluids?.setSource(x, y, z, placedId);
    this.fluids?.wake(x, y, z);
    if (!this.isCreative()) {
      this.inventory.setSlot(this.inventory.selected, createItemStack(415, 1));
    }
    this.audio.playPlace(getBlock(placedId));
    this.onInventoryChanged();
    return true;
  }

  /**
   * Sends the player to sleep in a bed: night is skipped, health is restored a
   * little and the bed becomes the new respawn point, like in Minecraft.
   */
  sleepInBed(bed) {
    if (!this.world || !this.player) return;
    if (isDaytime(this.timeOfDay)) {
      this.hud.toast('Спать можно только ночью');
      return;
    }
    this.timeOfDay = 0;
    this.player.heal(4);
    this.spawn = {
      x: bed.x + 0.5,
      y: bed.y + 1,
      z: bed.z + 0.5,
    };
    this.audio.playClick();
    this.hud.toast('Вы проспали ночь. Точка возрождения — у кровати.', 3000);
  }

  /**
   * Looks for a 4x5 obsidian frame around the clicked block. Both portal
   * orientations (plane along X or along Z) are checked.
   */
  ignitePortal(target) {
    if (!target || !this.world) return false;
    if (target.id !== 25) return false;
    for (const axis of ['x', 'z']) {
      for (let dy = -3; dy <= 1; dy++) {
        for (let di = -3; di <= 1; di++) {
          const ox = axis === 'x' ? target.x + di : target.x;
          const oz = axis === 'z' ? target.z + di : target.z;
          const oy = target.y + dy;
          if (this.tryPortalAt(ox, oy, oz, axis)) return true;
        }
      }
    }
    return false;
  }

  tryPortalAt(ox, oy, oz, axis) {
    const frame = (x, y, z) => this.world.getBlock(x, y, z) === 25;
    const air = (x, y, z) => this.world.getBlock(x, y, z) === 0;
    const point = (i) => (axis === 'x' ? { x: ox + i, z: oz } : { x: ox, z: oz + i });

    for (let y = oy; y <= oy + 2; y++) {
      for (let i = 0; i <= 1; i++) {
        const p = point(i);
        if (!air(p.x, y, p.z)) return false;
      }
    }
    for (let i = -1; i <= 2; i++) {
      const p = point(i);
      if (!frame(p.x, oy - 1, p.z) || !frame(p.x, oy + 3, p.z)) return false;
    }
    for (let y = oy; y <= oy + 2; y++) {
      const left = point(-1);
      const right = point(2);
      if (!frame(left.x, y, left.z) || !frame(right.x, y, right.z)) return false;
    }

    for (let y = oy; y <= oy + 2; y++) {
      for (let i = 0; i <= 1; i++) {
        const p = point(i);
        this.world.setBlock(p.x, y, p.z, 55);
      }
    }
    this.audio.playPlace(getBlock(55));
    this.hud.toast('Портал в Ад зажжён');
    return true;
  }

  mount(entity) {
    if (!entity) return;
    this.riding = entity;
    entity.ridden = true;
    entity.fleeTimer = 0;
    this.player.velocity.set(0, 0, 0);
    this.player.fallDistance = 0;
    this.audio.playClick();
    this.hud.toast(`Вы оседлали ${entity.name.toLowerCase()} · Shift — слезть`);
  }

  dismount() {
    if (!this.riding) return;
    this.riding.ridden = false;
    const seat = this.riding.position;
    this.player.position.set(seat.x + 1.2, seat.y + 0.2, seat.z);
    this.player.velocity.set(0, 0, 0);
    this.riding = null;
  }

  updateRiding(dt) {
    const entity = this.riding;
    entity.yaw = this.player.yaw;
    const forward = (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0);
    const strafe = (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);
    const jump = this.input.isDown('Space');
    entity.rideUpdate(dt, this.world, { forward, strafe, jump });
    this.player.position.set(
      entity.position.x,
      entity.position.y + entity.height * 0.62,
      entity.position.z,
    );
    this.player.velocity.set(0, 0, 0);
    this.player.onGround = entity.onGround;
    this.player.fallDistance = 0;
    if (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')) this.dismount();
  }

  tryAttack() {
    if (!this.entities || this.attackCooldown > 0 || this.riding) return false;
    if (this.tryAttackPlayer()) return true;
    const hit = this.entities.pick(this.player.eyePosition, this.player.getDirection(), 4.5);
    if (!hit) return false;
    const block = this.player.raycast(this.world);
    if (block && block.distance < hit.distance) return false;
    this.attackCooldown = 0.45;

    const heldId = this.inventory.selectedStack?.id ?? null;
    const tool = getToolInfo(heldId);
    const damage = this.getAttackDamage();

    const died = this.entities.attack(hit.entity, damage, this.player, tool);
    this.audio.playClick();
    if (died) this.hud.toast(`${hit.entity.name} побеждён`);
    if (hit.entity.kind === 'villager') this.hud.toast('Железный голем разъярён!');
    return true;
  }

  checkDimensionTravel() {
    if (!this.world || !this.player || this.teleportCooldown > 0) return;
    const p = this.player.position;
    const bx = Math.floor(p.x);
    const bz = Math.floor(p.z);
    const feet = this.world.getBlock(bx, Math.floor(p.y + 0.1), bz);
    const head = this.world.getBlock(bx, Math.floor(p.y + 1.2), bz);
    const inNetherPortal = feet === 55 || head === 55;
    const inEndPortal = feet === 58 || head === 58;
    if (!inNetherPortal && !inEndPortal) return;
    const current = dimensionAt(p.x, p.z);
    if (inNetherPortal) {
      this.travelTo(current === 'nether' ? 'overworld' : 'nether');
    } else {
      this.travelTo(current === 'end' ? 'overworld' : 'end');
    }
  }

  travelTo(target) {
    if (!this.world || !this.player) return false;
    const current = dimensionAt(this.player.position.x, this.player.position.z);
    if (current === target) return false;

    if (current === 'overworld') {
      this.returnPoint = {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
      };
    }

    let dest;
    if (target === 'nether') {
      dest = { x: NETHER_ORIGIN.x + 0.5, y: 41, z: NETHER_ORIGIN.z - 3.5 };
    } else if (target === 'end') {
      dest = { x: END_ORIGIN.x + 0.5, y: 65, z: END_ORIGIN.z - 3.5 };
    } else {
      const point = this.returnPoint ?? this.spawn;
      dest = { x: point.x, y: point.y + 0.2, z: point.z };
      this.returnPoint = null;
    }

    if (this.riding) {
      this.riding.ridden = false;
      this.riding = null;
    }

    this.player.position.set(dest.x, dest.y, dest.z);
    this.player.velocity.set(0, 0, 0);
    this.player.fallDistance = 0;
    this.player.yaw = 0;
    this.player.pitch = 0;
    this.dimension = target;
    this.teleportCooldown = 2.5;
    this.entities?.clear();
    this.mining = null;
    this.hud.setBreakProgress(0);

    this.loadingInfo = {
      mode: 'travel',
      isSave: false,
      center: { ...dest },
      startedAt: performance.now(),
      timeoutToast: false,
    };
    this.setLoadingStatus('Переход между измерениями…', true);
    if (this.loadingProgress) this.loadingProgress.style.width = '0%';
    this.setState('loading');
    this.world.update(0, this.player.position);
    return true;
  }

  placeBlock(target, blockId) {
    if (!target) return;
    const x = target.x + target.normal.x;
    const y = target.y + target.normal.y;
    const z = target.z + target.normal.z;
    if (y < 0 || y >= WORLD_HEIGHT) return;

    const existingId = this.world.getBlock(x, y, z);
    const existing = getBlock(existingId);
    if (existingId !== 0 && !existing.fluid) return;
    if (!this.world.isChunkLoadedAt(x, z)) return;
    if (this.player.intersectsBlock(x, y, z)) {
      this.hud.toast('Здесь стоите вы');
      return;
    }

    const block = getBlock(blockId);
    if (!this.world.setBlock(x, y, z, blockId)) return;
    this.sendNetworkEdit(x, y, z, blockId);
    if (block.fluid) {
      this.fluids?.setSource(x, y, z, blockId);
      this.fluids?.wake(x, y, z);
    } else {
      this.fluids?.remove(x, y, z);
      this.fluids?.wake(x, y, z);
    }
    if (!this.isCreative()) this.inventory.consumeSelected(1);
    this.audio.playPlace(block);
    this.onInventoryChanged();
  }

  eatHeld(item) {
    if (this.eatCooldown > 0) return;
    const food = item.food;
    if (!food) return;
    if (this.player.hunger >= 20 && !food.regeneration && this.player.health >= this.player.maxHealth) {
      this.hud.toast('Вы не голодны');
      this.eatCooldown = 0.8;
      return;
    }
    this.eatCooldown = 0.55;
    if (!this.isCreative()) this.inventory.consumeSelected(1);
    this.player.eat(food.nutrition ?? 0, food.saturation ?? 0, food.regeneration ?? 0);
    this.audio.playEat();
    this.onInventoryChanged();
  }

  dropSelected() {
    if (!this.inventory || !this.drops || !this.player) return;
    const index = this.inventory.selected;
    const stack = this.inventory.slots[index];
    if (!stack) return;
    const one = this.inventory.removeFromSlot(index, 1);
    if (!one) return;
    const eye = this.player.eyePosition;
    const direction = this.player.getDirection();
    this.drops.spawn(
      one.id,
      1,
      eye.x + direction.x * 0.7,
      eye.y - 0.15,
      eye.z + direction.z * 0.7,
      new THREE.Vector3(direction.x * 5, direction.y * 5 + 1.6, direction.z * 5),
      1.2,
    );
    this.audio.playClick();
    this.onInventoryChanged();
  }

  onInventoryChanged() {
    if (!this.inventory) return;
    if (this.player) this.player.armorPoints = this.inventory.armorPoints();
    this.updatePlayerModelArmor();
    this.hud.updateHotbar(this.inventory);
    const id = this.inventory.selectedStack?.id ?? null;
    if (id !== this.lastHeldId) {
      this.lastHeldId = id;
      const item = id != null ? getItem(id) : null;
      this.hud.setHeldName(item?.name ?? null);
      this.hud.setHeldTool(id, this.isCreative());
    }
    this.hud.setSelected(this.inventory.selected);
  }

  refreshHeld(announce) {
    if (!this.inventory) return;
    this.hud.updateHotbar(this.inventory);
    this.hud.setSelected(this.inventory.selected);
    const id = this.inventory.selectedStack?.id ?? null;
    if (announce || id !== this.lastHeldId) {
      this.lastHeldId = id;
      const item = id != null ? getItem(id) : null;
      this.hud.setHeldName(item?.name ?? null);
      this.hud.setHeldTool(id, this.isCreative());
    }
  }

  dropStackFromInventory(stack) {
    if (!stack || !this.drops || !this.player || this.disposingWorld) return;
    const direction = this.player.getDirection();
    const eye = this.player.eyePosition;
    this.drops.spawnStack(
      stack,
      eye.x + direction.x * 0.6,
      this.player.position.y + 1.0,
      eye.z + direction.z * 0.6,
      1.2,
    );
  }

  /* ------------------------------------------------------------------ */
  /* HUD / environment                                                   */
  /* ------------------------------------------------------------------ */

  updateHud(dt, force = false) {
    this.hudAccum += dt;
    if (!force && this.hudAccum < 0.1) return;
    this.hudAccum = 0;
    this.hud.updateStats(this.player);
    const biome = this.world.getBiomeAt(
      Math.floor(this.player.position.x),
      Math.floor(this.player.position.z),
    ) ?? '—';
    this.hud.updateLocation(biome, this.player.position);
    this.hud.setUnderwater(this.player.headInWater);
    this.updateDebug();
  }

  updateDebug(force = false) {
    if (!this.debugVisible) {
      if (this.lastDebugVisible !== false) {
        this.hud.setDebug(false, []);
        this.lastDebugVisible = false;
      }
      return;
    }
    this.debugAccum += 1;
    if (!force && this.debugAccum < 4) return;
    this.debugAccum = 0;
    this.lastDebugVisible = true;

    const p = this.player;
    const stats = this.world.getStats();
    const biome = this.world.getBiomeAt(Math.floor(p.position.x), Math.floor(p.position.z)) ?? '—';
    const facing = this.facingLabel();
    const held = this.inventory.selectedStack;
    const heldItem = held ? getItem(held.id) : null;
    const tool = getToolInfo(held?.id);
    const lines = [
      `VoxelCraft · ${this.fps.toFixed(0)} FPS · ${GAME_MODE_LABELS[this.gameMode]}`,
      `XYZ: ${p.position.x.toFixed(2)} / ${p.position.y.toFixed(2)} / ${p.position.z.toFixed(2)}`,
      `Chunk: ${Math.floor(p.position.x / 16)} ${Math.floor(p.position.z / 16)} · ${biome} · ${facing}`,
      `Измерение: ${DIMENSION_LABELS[this.dimension] ?? this.dimension} · существ: ${this.entities?.entities.length ?? 0}`,
      `Seed: ${this.seedLabel}`,
      `Time: ${formatClock(this.timeOfDay)} · ${this.state} · день ${this.settings.dayMinutes}м / ночь ${this.settings.nightMinutes}м`,
      `Chunks: ${stats.readyChunks} ready / ${stats.loadedChunks} loaded`,
      `Triangles: ${formatNumber(stats.triangles)}`,
      `Queues: gen ${stats.genQueue + stats.genInFlight} · mesh ${stats.meshQueue + stats.meshInFlight} · workers ${stats.workers}`,
      `Held: ${heldItem?.name ?? '—'}${held ? ` ×${held.count}` : ''}${tool ? ` · ${tool.type} T${tool.tier}` : ''}`,
      `Motion: ${p.flying ? 'fly' : p.onGround ? 'ground' : 'air'}${p.inWater ? ' · water' : ''}${p.sprinting ? ' · sprint' : ''}${p.sneaking ? ' · sneak' : ''}`,
    ];
    this.hud.setDebug(true, lines);
  }

  facingLabel() {
    const direction = this.player.getDirection();
    if (Math.abs(direction.x) > Math.abs(direction.z)) {
      return direction.x > 0 ? 'восток' : 'запад';
    }
    return direction.z > 0 ? 'юг' : 'север';
  }

  updateCamera(dt) {
    const player = this.player;
    const eye = player.eyePosition;
    this.camera.rotation.order = 'YXZ';

    if (this.cameraMode === 0 || this.riding) {
      this.camera.position.copy(eye);
      this.camera.rotation.set(player.pitch, player.yaw, 0);
      this.playerModel.setVisible(false);
      return;
    }

    const direction = player.getDirection();
    const front = this.cameraMode === 2;
    const distance = 3.9;
    const sign = front ? 1 : -1;
    const target = new THREE.Vector3(
      eye.x + direction.x * distance * sign,
      eye.y + direction.y * distance * sign + 0.25,
      eye.z + direction.z * distance * sign,
    );

    // Pull the camera in when a wall is in the way, like Minecraft does.
    const toTarget = target.clone().sub(eye);
    const length = toTarget.length();
    if (length > 0.001) toTarget.divideScalar(length);
    let allowed = length;
    const steps = Math.max(1, Math.ceil(length / 0.08));
    for (let i = 1; i <= steps; i++) {
      const travelled = (i / steps) * length;
      const x = Math.floor(eye.x + toTarget.x * travelled);
      const y = Math.floor(eye.y + toTarget.y * travelled);
      const z = Math.floor(eye.z + toTarget.z * travelled);
      if (this.world.isSolidAt(x, y, z)) {
        allowed = Math.max(0.55, travelled - 0.28);
        break;
      }
    }

    this.camera.position.copy(eye).addScaledVector(toTarget, allowed);
    if (front) {
      this.camera.rotation.set(-player.pitch, player.yaw + Math.PI, 0);
    } else {
      this.camera.rotation.set(player.pitch, player.yaw, 0);
    }

    this.playerModel.setVisible(true);
    this.playerModel.update(player, dt);
    this.playerModel.group.position.y += 0.02;
  }

  updatePlayerModelArmor() {
    if (!this.inventory) {
      this.playerModel.setArmor([]);
      return;
    }
    const stacks = this.inventory.armor.map((stack) => {
      if (!stack) return null;
      const item = getItem(stack.id);
      return item?.armor ? { material: item.iconMaterial } : null;
    });
    this.playerModel.setArmor(stacks);
  }

  updateEnvironment(dt) {
    this.updateCamera(dt);
    this.playerModel.setVisible(this.cameraMode !== 0 && !this.riding && !!this.player);

    const environment = this.sky.update(this.camera, this.timeOfDay, dt);
    const dimension = dimensionAt(this.player.position.x, this.player.position.z);
    this.dimension = dimension;
    if (dimension === 'overworld') {
      this.sky.clouds.visible = true;
    } else {
      // The Nether and the End have no weather or sun; tint the sky and fog.
      const nether = dimension === 'nether';
      this.sky.clouds.visible = false;
      this.sky.uniforms.uTop.value.setHex(nether ? 0x2b0a06 : 0x120820);
      this.sky.uniforms.uHorizon.value.setHex(nether ? 0x6b1d0e : 0x2a1640);
      this.sky.uniforms.uBottom.value.setHex(nether ? 0x180503 : 0x080410);
      this.sky.uniforms.uStars.value = nether ? 0 : 1;
      this.sky.uniforms.uDaylight.value = nether ? 0.5 : 0.65;
      environment.fogColor.setHex(nether ? 0x57150a : 0x241236);
      environment.daylight = nether ? 0.5 : 0.65;
    }
    this.materials.update({
      fogColor: environment.fogColor,
      sunDir: environment.sunDir,
      daylight: environment.daylight,
      time: this.sky.time,
    });
    this.renderer.setClearColor(environment.fogColor, 1);
  }
}
