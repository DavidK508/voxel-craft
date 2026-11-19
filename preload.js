'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gameAPI', {
  listWorlds: () => ipcRenderer.invoke('worlds:list'),
  createWorld: (meta) => ipcRenderer.invoke('worlds:create', meta),
  loadWorld: (id) => ipcRenderer.invoke('world:load', id),
  saveWorld: (id, data) => ipcRenderer.invoke('world:save', id, data),
  deleteWorld: (id) => ipcRenderer.invoke('world:delete', id),
  getInfo: () => ipcRenderer.invoke('app:info'),
  quit: () => ipcRenderer.send('app:quit'),
  lanHost: (port) => ipcRenderer.invoke('lan:host', port),
  lanJoin: (address, port) => ipcRenderer.invoke('lan:join', address, port),
  lanLeave: () => ipcRenderer.send('lan:leave'),
  lanSend: (payload) => ipcRenderer.send('lan:send', payload),
  onLanEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('lan:event', handler);
    return () => ipcRenderer.removeListener('lan:event', handler);
  },
  onBeforeQuit: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:before-quit', handler);
    return () => ipcRenderer.removeListener('app:before-quit', handler);
  },
  saveComplete: () => ipcRenderer.send('app:save-complete'),
});
