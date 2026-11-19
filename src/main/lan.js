'use strict';

const os = require('node:os');
const crypto = require('node:crypto');
const tcp = require('node:net');

const LAN_MAX_MESSAGE = 2 * 1024 * 1024;
const LAN_MAX_CLIENTS = 8;

let hostSender = () => {};
let clientSender = () => {};

let lanServer = null;
let lanServerPort = 0;
let lanStateCache = null;
const lanClients = new Map();
let lanClient = null;

/** Wires the two IPC senders. In the app both point at the same window. */
function setLanSenders(host, client) {
  hostSender = typeof host === 'function' ? host : () => {};
  clientSender = typeof client === 'function' ? client : () => {};
}

function lanAddresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
    }
  }
  return addresses;
}

function lanWrite(socket, payload) {
  if (!socket || socket.destroyed) return;
  try {
    socket.write(`${JSON.stringify(payload)}\n`);
  } catch (error) {
    console.error('[lan] write failed', error);
  }
}

function lanBroadcast(payload, exceptId = null) {
  for (const [id, client] of lanClients) {
    if (id === exceptId) continue;
    lanWrite(client.socket, payload);
  }
}

function lanHandleClientMessage(client, message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'hello') {
    client.name = String(message.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 32) || 'Игрок';
    hostSender({ type: 'client-joined', id: client.id, name: client.name });
    lanBroadcast({ type: 'player-joined', id: client.id, name: client.name }, client.id);
    return;
  }
  if (message.type === 'state') {
    lanStateCache = message;
    lanBroadcast(message);
    return;
  }
  // Movement, block edits and clock updates are relayed to the host renderer
  // and to every other guest. The sender already applied its own copy.
  hostSender({ ...message, from: 'client', id: message.id ?? client.id });
  lanBroadcast(message, client.id);
}

function stopLanServer() {
  if (!lanServer) return;
  for (const client of lanClients.values()) {
    try { client.socket.destroy(); } catch { /* already gone */ }
  }
  lanClients.clear();
  try { lanServer.close(); } catch { /* already closed */ }
  lanServer = null;
  lanServerPort = 0;
  lanStateCache = null;
}

function startLanServer(port = 25565) {
  return new Promise((resolve, reject) => {
    stopLanServer();
    const requested = Number(port);
    const listenPort = Number.isInteger(requested) && requested >= 0 && requested <= 65535
      ? requested
      : 25565;

    const server = tcp.createServer((socket) => {
      if (lanClients.size >= LAN_MAX_CLIENTS) {
        lanWrite(socket, { type: 'error', message: 'Сервер заполнен' });
        socket.destroy();
        return;
      }
      const id = crypto.randomUUID();
      const client = { id, socket, name: 'Игрок' };
      lanClients.set(id, client);
      socket.setNoDelay(true);
      let buffer = '';

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        if (buffer.length > LAN_MAX_MESSAGE) {
          socket.destroy();
          return;
        }
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;
          try {
            lanHandleClientMessage(client, JSON.parse(line));
          } catch (error) {
            console.warn('[lan] bad message', error.message);
          }
        }
      });
      socket.on('error', () => {});
      socket.on('close', () => {
        lanClients.delete(id);
        lanBroadcast({ type: 'peer-left', id, name: client.name });
        hostSender({ type: 'peer-left', id, name: client.name });
      });

      lanWrite(socket, { type: 'welcome', id, port: lanServerPort });
      if (lanStateCache) lanWrite(socket, lanStateCache);
    });

    server.on('error', (error) => {
      if (lanServer === server) lanServer = null;
      reject(error);
    });
    server.listen(listenPort, '0.0.0.0', () => {
      lanServer = server;
      lanServerPort = server.address().port;
      resolve({ ok: true, port: lanServerPort, addresses: lanAddresses() });
    });
  });
}

function stopLanClient() {
  if (!lanClient) return;
  try { lanClient.socket.destroy(); } catch { /* already gone */ }
  lanClient = null;
}

function joinLanServer(address, port) {
  return new Promise((resolve, reject) => {
    stopLanClient();
    const socket = tcp.createConnection({
      host: String(address || '127.0.0.1').trim(),
      port: Math.max(1, Math.min(65535, Number(port) || 25565)),
    });
    let settled = false;
    let buffer = '';
    socket.setNoDelay(true);

    socket.once('connect', () => {
      lanClient = { socket, id: null };
      settled = true;
      resolve({ ok: true });
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > LAN_MAX_MESSAGE) {
        socket.destroy();
        return;
      }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message?.type === 'welcome' && lanClient) lanClient.id = message.id;
          clientSender(message);
        } catch (error) {
          console.warn('[lan] bad server message', error.message);
        }
      }
    });
    socket.on('error', (error) => {
      if (!settled) {
        settled = true;
        lanClient = null;
        reject(error);
      } else {
        clientSender({ type: 'error', message: error.message });
      }
    });
    socket.on('close', () => {
      if (lanClient?.socket === socket) lanClient = null;
      clientSender({ type: 'disconnected' });
    });
  });
}

/** Sends from the host renderer (broadcast) or the guest renderer (to server). */
function sendLan(payload, role = 'auto') {
  if (!payload || typeof payload !== 'object') return;
  const asClient = role === 'client' || (role === 'auto' && !lanServer && lanClient);
  if (asClient) {
    if (lanClient) lanWrite(lanClient.socket, payload);
    return;
  }
  if (lanServer) {
    if (payload.type === 'state') lanStateCache = payload;
    lanBroadcast(payload);
  }
}

/** Sends a private message from the host to one guest (items, damage, etc.). */
function sendLanTo(clientId, payload, role = 'auto') {
  if (!clientId || !payload || typeof payload !== 'object') return;
  if (role === 'client' || (!lanServer && lanClient)) return;
  const client = lanClients.get(String(clientId));
  if (client) lanWrite(client.socket, payload);
}

function stopLan() {
  stopLanClient();
  stopLanServer();
}

function lanStatus() {
  return {
    hosting: Boolean(lanServer),
    port: lanServerPort,
    clients: lanClients.size,
    connected: Boolean(lanClient),
    clientId: lanClient?.id ?? null,
  };
}

module.exports = {
  setLanSenders,
  startLanServer,
  joinLanServer,
  sendLan,
  sendLanTo,
  stopLan,
  lanAddresses,
  lanStatus,
};
