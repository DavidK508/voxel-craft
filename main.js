'use strict';

const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const {
  setLanSenders,
  startLanServer,
  joinLanServer,
  sendLan,
  sendLanTo,
  stopLan,
} = require('./src/main/lan.js');

const ROOT = __dirname;
const SAVE_DIR = path.join(app.getPath('userData'), 'saves');
const INDEX_FILE = path.join(SAVE_DIR, 'index.json');
// Pre-multi-world layout: a single file sitting directly in saves/.
const LEGACY_FILE = path.join(SAVE_DIR, 'world.json');
const WORLD_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_NAME = 48;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'voxel',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow = null;
let forceClose = false;
let saveAckTimer = null;

function lanToWindow(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lan:event', payload);
  }
}

setLanSenders(lanToWindow, lanToWindow);

function registerAppProtocol() {
  protocol.handle('voxel', async (request) => {
    try {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (!pathname || pathname === '/') pathname = '/index.html';
      const resolved = path.resolve(ROOT, `.${pathname}`);
      if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }
      return net.fetch(pathToFileURL(resolved).toString());
    } catch (error) {
      console.error('[protocol]', error);
      return new Response('Not found', { status: 404 });
    }
  });
}

function worldDir(id) {
  return path.join(SAVE_DIR, id);
}

function worldFile(id) {
  return path.join(worldDir(id), 'world.json');
}

function assertWorldId(id) {
  if (typeof id !== 'string' || !WORLD_ID.test(id)) {
    throw new Error(`Invalid world id: ${String(id).slice(0, 64)}`);
  }
  return id;
}

function sanitizeName(name, fallback) {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return text || fallback;
}

function sanitizeGameMode(value) {
  return value === 'creative' ? 'creative' : 'survival';
}

function sortWorlds(list) {
  return list.slice().sort((a, b) => Number(b.updated ?? 0) - Number(a.updated ?? 0));
}

async function readIndex() {
  try {
    const raw = await fs.readFile(INDEX_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && WORLD_ID.test(String(entry.id)));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[worlds] index read failed', error);
    return [];
  }
}

async function writeIndex(list) {
  const tmp = `${INDEX_FILE}.tmp`;
  const payload = JSON.stringify(list);
  await fs.mkdir(SAVE_DIR, { recursive: true });
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, INDEX_FILE);
}

async function readSave(id) {
  try {
    const raw = await fs.readFile(worldFile(assertWorldId(id)), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[save] read failed', error);
    return null;
  }
}

async function writeSave(id, data) {
  assertWorldId(id);
  const dir = worldDir(id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'world.json');
  const tmp = `${file}.tmp`;
  const payload = JSON.stringify(data);
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, file);

  const list = await readIndex();
  let entry = list.find((item) => item.id === id);
  if (!entry) {
    entry = { id, name: sanitizeName(data?.name, id), created: Date.now() };
    list.push(entry);
  }
  entry.name = sanitizeName(data?.name, entry.name ?? id);
  if (Number.isFinite(Number(data?.seed))) entry.seed = Number(data.seed) >>> 0;
  if (data?.seedLabel != null) entry.seedLabel = String(data.seedLabel);
  if (data?.gameMode != null) entry.gameMode = sanitizeGameMode(data.gameMode);
  entry.updated = Date.now();
  await writeIndex(list);

  return { ok: true, bytes: Buffer.byteLength(payload) };
}

async function createWorld(meta = {}) {
  const list = await readIndex();
  let id;
  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = `world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    if (!list.some((item) => item.id === candidate)) {
      id = candidate;
      break;
    }
  }
  if (!id) throw new Error('Could not allocate a world id');

  const now = Date.now();
  const entry = {
    id,
    name: sanitizeName(meta.name, `Мир ${list.length + 1}`),
    seed: Number.isFinite(Number(meta.seed)) ? Number(meta.seed) >>> 0 : 0,
    seedLabel: String(meta.seedLabel ?? meta.seed ?? ''),
    gameMode: sanitizeGameMode(meta.gameMode),
    created: now,
    updated: now,
  };
  await fs.mkdir(worldDir(id), { recursive: true });
  list.push(entry);
  await writeIndex(list);
  return entry;
}

async function deleteWorld(id) {
  assertWorldId(id);
  await fs.rm(worldDir(id), { recursive: true, force: true });
  const list = await readIndex();
  const next = list.filter((item) => item.id !== id);
  if (next.length !== list.length) await writeIndex(next);
  return { ok: true };
}

async function listWorlds() {
  return sortWorlds(await readIndex());
}

/**
 * Lifts the original single-file save into the multi-world layout so that an
 * existing playthrough keeps showing up in the list.
 */
async function migrateLegacySave() {
  let raw;
  try {
    raw = await fs.readFile(LEGACY_FILE, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[worlds] legacy read failed', error);
    return;
  }

  const list = await readIndex();
  let save = null;
  try {
    save = JSON.parse(raw);
  } catch (error) {
    console.error('[worlds] legacy save is not valid JSON', error);
  }

  const id = list.length > 0 ? `world-${Date.now().toString(36)}` : 'world-1';
  await fs.mkdir(worldDir(id), { recursive: true });
  await fs.rename(LEGACY_FILE, worldFile(id));

  const now = save?.savedAt ?? Date.now();
  list.push({
    id,
    name: sanitizeName(save?.name, save?.seedLabel ? `Мир ${save.seedLabel}` : 'Мир 1'),
    seed: Number.isFinite(Number(save?.seed)) ? Number(save.seed) >>> 0 : 0,
    seedLabel: String(save?.seedLabel ?? save?.seed ?? ''),
    gameMode: sanitizeGameMode(save?.gameMode),
    created: now,
    updated: now,
  });
  await writeIndex(list);
  console.log('[worlds] migrated legacy save to', id);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d1117',
    title: 'VoxelCraft',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      webgl: true,
      spellcheck: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  const query = [];
  if (process.env.VOXELCRAFT_ANTIALIAS) query.push('antialias=1');
  if (process.env.VOXELCRAFT_MIPMAPS) query.push('mipmaps=1');
  if (process.env.VOXELCRAFT_NO_ANTIALIAS) query.push('antialias=0');
  if (process.env.VOXELCRAFT_NO_MIPMAPS) query.push('mipmaps=0');
  const gameUrl = `voxel://game/index.html${query.length ? `?${query.join('&')}` : ''}`;

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Diagnostics: VOXELCRAFT_AUTOSHOT=/tmp/shot.png starts a fresh world,
  // waits for chunks to stream in, saves a PNG and quits. Handy on machines
  // where compositor screenshots come out black.
  if (process.env.VOXELCRAFT_AUTOSHOT) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      try {
        await wait(1200);
        const lanMode = process.env.VOXELCRAFT_AUTOSHOT_LAN || '';
        if (lanMode === 'host' || lanMode === 'join') {
          const lanName = process.env.VOXELCRAFT_AUTOSHOT_LAN_NAME
            || (lanMode === 'host' ? 'Хост' : 'Гость');
          const lanAddress = process.env.VOXELCRAFT_AUTOSHOT_LAN_ADDRESS || '127.0.0.1';
          const lanPort = Number(process.env.VOXELCRAFT_AUTOSHOT_LAN_PORT) || 25565;
          await mainWindow.webContents.executeJavaScript(`
            (async () => {
              const g = window.voxelGame;
              if (!g) throw new Error('voxelGame is not available');
              g.openNetworkScreen();
              window.__lanLog = [];
              const originalLanHandler = g.handleLanEvent.bind(g);
              g.handleLanEvent = (message) => {
                window.__lanLog.push(message?.type + (message?.id ? ':' + String(message.id).slice(0, 8) : ''));
                if (window.__lanLog.length > 400) window.__lanLog.shift();
                originalLanHandler(message);
              };
              g.netName = ${JSON.stringify(lanName)};
              const nameInput = document.getElementById('lan-name');
              if (nameInput) nameInput.value = ${JSON.stringify(lanName)};
              const portInput = document.getElementById('lan-port');
              if (portInput) portInput.value = '${lanPort}';
              const addressInput = document.getElementById('lan-address');
              if (addressInput) addressInput.value = ${JSON.stringify(lanAddress)};
              if (${JSON.stringify(lanMode)} === 'host') await g.hostLanWorld();
              else await g.joinLanWorld();
            })();
          `);
        } else {
          await mainWindow.webContents.executeJavaScript(`
            (async () => {
              const g = window.voxelGame;
              if (!g) throw new Error('voxelGame is not available');
              await g.beginWorld({
                worldName: 'Diagnostics',
                seed: 1337,
                seedLabel: '1337',
                renderDistance: 6,
                gameMode: 'creative',
              });
            })();
          `);
        }
        // Wait for chunk generation and the first frames to settle.
        const deadline = Date.now() + 90000;
        let state = 'loading';
        while (Date.now() < deadline) {
          await wait(750);
          state = await mainWindow.webContents.executeJavaScript('window.voxelGame?.state ?? "none"');
          if (state === 'playing') break;
        }
        const evalScript = process.env.VOXELCRAFT_AUTOSHOT_EVAL;
        if (evalScript) {
          const result = await mainWindow.webContents.executeJavaScript(`
            (async () => {
              const g = window.voxelGame;
              try {
                return { ok: true, value: await (${evalScript}) };
              } catch (error) {
                return { ok: false, error: String(error?.stack || error) };
              }
            })();
          `);
          console.log('[autoshot] eval', JSON.stringify(result));
        }
        const hold = Number(process.env.VOXELCRAFT_AUTOSHOT_HOLD) || 0;
        if (hold > 0) {
          const edit = process.env.VOXELCRAFT_AUTOSHOT_EDIT;
          if (edit) {
            // Give the other side time to connect before mutating the world.
            if (hold > 6000) await wait(Math.floor(hold / 2));
            await mainWindow.webContents.executeJavaScript(`
              (() => {
                const g = window.voxelGame;
                if (!g?.world) return false;
                const [x, y, z, id] = ${JSON.stringify(edit)}.split(',').map(Number);
                if (![x, y, z, id].every(Number.isFinite)) return false;
                g.world.setBlock(x, y, z, id);
                g.sendNetworkEdit(x, y, z, id);
                return true;
              })();
            `);
          }
          await wait(hold > 6000 ? hold - Math.floor(hold / 2) : hold);
        }
        const look = process.env.VOXELCRAFT_AUTOSHOT_LOOK || '';
        if (look) {
          await mainWindow.webContents.executeJavaScript(`
            (() => {
              const g = window.voxelGame;
              const look = ${JSON.stringify(look)};
              if (!g?.player) return;
              if (look === 'down') { g.player.yaw = 0.7; g.player.pitch = -1.15; }
              if (look === 'horizon') { g.player.yaw = 0.7; g.player.pitch = 0.0; }
            })();
          `);
        }
        const cameraMode = Number(process.env.VOXELCRAFT_AUTOSHOT_CAMERA);
        if (Number.isFinite(cameraMode)) {
          await mainWindow.webContents.executeJavaScript(`
            (() => {
              const g = window.voxelGame;
              if (!g) return;
              if (g.state === 'inventory') g.closeInventory();
              g.cameraMode = ${cameraMode};
            })();
          `);
        }
        await wait(Number(process.env.VOXELCRAFT_AUTOSHOT_DELAY) || 2500);
        const settle = Number(process.env.VOXELCRAFT_AUTOSHOT_SETTLE) || 0;
        if (settle > 0) {
          await wait(settle);
        }
        const samples = [];
        for (let i = 0; i < 3; i++) {
          samples.push(await mainWindow.webContents.executeJavaScript(`
            (() => {
              const g = window.voxelGame;
              return {
                fps: g?.fps,
                chunks: g?.world?.chunks?.size ?? null,
                ready: g?.world?.readyChunks ?? null,
                genQueue: g?.world?.genQueue?.length ?? null,
                meshQueue: g?.world?.meshQueue?.length ?? null,
                triangles: g?.renderer?.info?.render?.triangles ?? null,
                calls: g?.renderer?.info?.render?.calls ?? null,
                blockUnder: (() => {
                  const p = g?.player?.position;
                  if (!p || !g?.world) return null;
                  const bx = Math.floor(p.x), bz = Math.floor(p.z);
                  const out = [];
                  for (let dy = -4; dy <= 1; dy++) {
                    out.push([Math.floor(p.y) + dy, g.world.getBlock(bx, Math.floor(p.y) + dy, bz)]);
                  }
                  return out;
                })(),
              };
            })();
          `));
          await wait(2000);
        }
        console.log('[autoshot] samples', JSON.stringify(samples));
        const info = await mainWindow.webContents.executeJavaScript(`
          (() => {
            const g = window.voxelGame;
            return {
              state: g?.state,
              fps: g?.fps,
              chunks: g?.world?.chunks?.size ?? null,
              loaded: g?.world?.loadedChunks?.size ?? null,
              player: g?.player ? [g.player.position.x, g.player.position.y, g.player.position.z] : null,
              yaw: g?.player?.yaw,
              pitch: g?.player?.pitch,
              gpu: (() => {
                const gl = g?.renderer?.getContext?.();
                if (!gl) return null;
                const ext = gl.getExtension('WEBGL_debug_renderer_info');
                return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
              })(),
              drawCalls: g?.renderer?.info?.render?.calls ?? null,
              triangles: g?.renderer?.info?.render?.triangles ?? null,
              pixelRatio: g?.renderer?.getPixelRatio?.() ?? null,
              size: g?.renderer ? [g.renderer.domElement.width, g.renderer.domElement.height] : null,
              cameraMode: g?.cameraMode ?? null,
              playerModelVisible: g?.playerModel?.group?.visible ?? null,
              playerModelChildren: g?.playerModel?.group?.children?.length ?? null,
              remotePlayers: g?.remotePlayers?.size ?? null,
              remoteNames: g?.remotePlayers ? [...g.remotePlayers.values()].map((p) => p.name) : null,
              editSample: (() => {
                const edit = ${JSON.stringify(process.env.VOXELCRAFT_AUTOSHOT_EDIT || '')};
                if (!edit || !g?.world) return null;
                const [x, y, z] = edit.split(',').map(Number);
                if (![x, y, z].every(Number.isFinite)) return null;
                return g.world.getBlock(x, y, z);
              })(),
              fluidCells: g?.fluids?.levels?.size ?? null,
              netRole: g?.net?.role ?? null,
              lanStatus: document.getElementById('lan-status')?.textContent ?? null,
              lanLog: window.__lanLog?.slice(-24) ?? null,
              inventoryOpen: g?.inventoryUI?.isOpen?.() ?? null,
              previewVisible: Boolean(document.querySelector('#character-preview canvas')),
              tradeOpen: g?.tradeUI?.isOpen?.() ?? null,
              tradeOffers: g?.tradeOffers?.length ?? null,
              drops: g?.drops?.drops?.length ?? null,
              emeralds: g?.inventory?.slots?.filter((s) => s?.id === 440)
                .reduce((sum, s) => sum + s.count, 0) ?? null,
              dropHooks: g?.drops ? {
                sink: Boolean(g.drops.networkSink),
                onSpawn: Boolean(g.drops.onSpawn),
                pickup: Boolean(g.drops.pickupHandler),
              } : null,
              netPort: g?.net?.port ?? null,
              playerList: document.getElementById('player-list-items')?.children?.length ?? null,
              playerNames: g?.remotePlayers ? [...g.remotePlayers.values()].map((p) => p.name + ':' + (p.health ?? 20)) : null,
              errors: document.getElementById('fatal-error-text')?.textContent ?? null,
            };
          })();
        `);
        console.log('[autoshot] state', JSON.stringify(info));
        const image = await mainWindow.webContents.capturePage();
        await fs.writeFile(process.env.VOXELCRAFT_AUTOSHOT, image.toPNG());
        console.log('[autoshot] saved', process.env.VOXELCRAFT_AUTOSHOT);
      } catch (error) {
        console.error('[autoshot] failed', error);
      } finally {
        forceClose = true;
        app.quit();
      }
    });
  }

  // Start loading only after every did-finish-load listener is attached:
  // a cached page can finish before a later listener is registered.
  mainWindow.loadURL(gameUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (forceClose) return;
    event.preventDefault();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('app:before-quit');
    clearTimeout(saveAckTimer);
    saveAckTimer = setTimeout(() => {
      forceClose = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      app.quit();
    }, 4000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(async () => {
  registerAppProtocol();
  await fs.mkdir(SAVE_DIR, { recursive: true });
  await migrateLegacySave();

  ipcMain.handle('worlds:list', () => listWorlds());
  ipcMain.handle('worlds:create', (_event, meta) => createWorld(meta));
  ipcMain.handle('world:load', (_event, id) => readSave(id));
  ipcMain.handle('world:save', (_event, id, data) => writeSave(id, data));
  ipcMain.handle('world:delete', (_event, id) => deleteWorld(id));
  ipcMain.handle('lan:host', (_event, port) => startLanServer(port));
  ipcMain.handle('lan:join', (_event, address, port) => joinLanServer(address, port));
  ipcMain.on('lan:leave', () => stopLan());
  ipcMain.on('lan:send', (_event, payload) => sendLan(payload));
  ipcMain.on('lan:send-to', (_event, clientId, payload) => sendLanTo(clientId, payload));
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    savePath: SAVE_DIR,
  }));
  ipcMain.on('app:save-complete', () => {
    clearTimeout(saveAckTimer);
    forceClose = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    app.quit();
  });
  ipcMain.on('app:quit', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    else app.quit();
  });

  createWindow();
});

app.on('window-all-closed', () => {
  stopLan();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => stopLan());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
