import { getItem, getToolInfo } from '../shared/items.js';
import { getPlantableCrop, isHoe } from '../shared/farming.js';
import {
  MAP_RADIUS,
  MAP_SIZE,
  TERRAIN_SAMPLE_SIZE,
  mapMarkers,
  projectPoint,
  sampleTerrain,
} from './minimap.js';

const $ = (id) => document.getElementById(id);

function setBackground(element, url) {
  if (!url) {
    if (element.dataset.icon) {
      element.style.backgroundImage = '';
      delete element.dataset.icon;
    }
    return;
  }
  if (element.dataset.icon === url) return;
  element.dataset.icon = url;
  element.style.backgroundImage = `url("${url}")`;
}

export class HUD {
  constructor(assets) {
    this.assets = assets;
    this.root = $('hud');
    this.debugEl = $('debug');
    this.biomeEl = $('biome-label');
    this.coordsEl = $('coords-label');
    this.toastEl = $('toast');
    this.underwaterEl = $('underwater-overlay');
    this.damageEl = $('damage-overlay');
    this.healthBar = $('health-bar');
    this.airBar = $('air-bar');
    this.hungerBar = $('hunger-bar');
    this.heldItemEl = $('held-item-name');
    this.hotbarEl = $('hotbar');
    this.breakEl = $('break-progress');
    this.breakFillEl = $('break-progress-fill');
    this.hintEl = $('hint-label');
    this.playerListEl = $('player-list');
    this.playerListHeaderEl = $('player-list-header');
    this.playerListItemsEl = $('player-list-items');
    this.bossBar = $('boss-bar');
    this.bossNameEl = $('boss-name');
    this.bossFillEl = $('boss-fill');
    this.mapCanvas = $('minimap-canvas');
    this.mapCtx = this.mapCanvas?.getContext?.('2d') ?? null;
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = TERRAIN_SAMPLE_SIZE;
    this.terrainCanvas.height = TERRAIN_SAMPLE_SIZE;
    this.terrainCtx = this.terrainCanvas.getContext?.('2d') ?? null;
    this.terrainImage = this.terrainCtx?.createImageData?.(TERRAIN_SAMPLE_SIZE, TERRAIN_SAMPLE_SIZE) ?? null;

    this.healthIcons = [];
    this.airIcons = [];
    this.hungerIcons = [];
    this.hotbarSlots = [];
    this.toastTimer = 0;
    this.heldTimer = 0;
    this.damageTimer = 0;
    this.lastBiome = '';
    this.lastCoords = '';
    this.lastDebug = '';
    this.lastBreak = -1;
    this.lastPlayerList = '';
    this.lastBoss = '';

    this.buildStats();
    this.buildHotbar();
  }

  buildStats() {
    for (let i = 0; i < 10; i++) {
      const icon = document.createElement('div');
      icon.className = 'stat-icon';
      this.healthBar.appendChild(icon);
      this.healthIcons.push(icon);
    }
    for (let i = 0; i < 10; i++) {
      const icon = document.createElement('div');
      icon.className = 'stat-icon';
      this.airBar.appendChild(icon);
      this.airIcons.push(icon);
    }
    for (let i = 0; i < 10; i++) {
      const icon = document.createElement('div');
      icon.className = 'stat-icon';
      this.hungerBar.appendChild(icon);
      this.hungerIcons.push(icon);
    }
  }

  buildHotbar() {
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.index = String(i);

      const icon = document.createElement('div');
      icon.className = 'item-icon';

      const count = document.createElement('div');
      count.className = 'item-count';

      const durability = document.createElement('div');
      durability.className = 'durability';
      const durabilityFill = document.createElement('i');
      durability.appendChild(durabilityFill);

      slot.append(icon, count, durability);
      this.hotbarEl.appendChild(slot);
      this.hotbarSlots.push({ slot, icon, count, durability, durabilityFill });
    }
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  updateHotbar(inventory) {
    for (let i = 0; i < this.hotbarSlots.length; i++) {
      const view = this.hotbarSlots[i];
      const stack = inventory.slots[i];
      view.slot.classList.toggle('selected', inventory.selected === i);

      if (!stack) {
        setBackground(view.icon, null);
        view.count.textContent = '';
        view.durability.classList.add('hidden');
        continue;
      }

      const item = getItem(stack.id);
      setBackground(view.icon, this.assets.getIcon(stack.id));
      view.count.textContent = stack.count > 1 ? String(stack.count) : '';

      const tool = item?.tool;
      if (tool && stack.durability !== undefined) {
        const ratio = Math.max(0, Math.min(1, stack.durability / tool.durability));
        view.durability.classList.remove('hidden', 'low', 'critical');
        if (ratio <= 0.2) view.durability.classList.add('critical');
        else if (ratio <= 0.5) view.durability.classList.add('low');
        view.durabilityFill.style.width = `${ratio * 100}%`;
      } else {
        view.durability.classList.add('hidden');
      }
    }
  }

  setSelected(index) {
    for (let i = 0; i < this.hotbarSlots.length; i++) {
      this.hotbarSlots[i].slot.classList.toggle('selected', i === index);
    }
  }

  /** Shows everybody currently in the world, including the local player. */
  setPlayerList(entries, header = 'Онлайн') {
    if (!this.playerListEl) return;
    const list = Array.isArray(entries) ? entries : [];
    this.playerListEl.classList.toggle('hidden', list.length === 0);
    if (!list.length) return;
    if (this.playerListHeaderEl) this.playerListHeaderEl.textContent = header;
    const signature = `${header}|${list.map((p) => `${p.name}:${Math.round(p.health ?? 0)}:${p.self ? 1 : 0}`).join(',')}`;
    if (signature === this.lastPlayerList) return;
    this.lastPlayerList = signature;
    this.playerListItemsEl.replaceChildren();
    for (const player of list) {
      const row = document.createElement('div');
      row.className = `player-list-row${player.self ? ' self' : ''}${player.health <= 0 ? ' dead' : ''}`;
      const name = document.createElement('span');
      name.textContent = player.self ? `${player.name} (вы)` : player.name;
      const health = document.createElement('span');
      health.className = 'player-health';
      health.textContent = `♥ ${Math.max(0, Math.round(player.health ?? 0))}`;
      row.append(name, health);
      this.playerListItemsEl.appendChild(row);
    }
  }

  updateStats(player) {
    const health = Math.max(0, Math.min(player.maxHealth, player.health));
    for (let i = 0; i < 10; i++) {
      const value = health - i * 2;
      const src = value >= 2
        ? this.assets.hud.heartFull
        : value >= 1
          ? this.assets.hud.heartHalf
          : this.assets.hud.heartEmpty;
      setBackground(this.healthIcons[i], src);
    }

    const hunger = Math.max(0, Math.min(20, player.hunger));
    for (let i = 0; i < 10; i++) {
      const src = hunger > i * 2 ? this.assets.hud.hungerFull : this.assets.hud.hungerEmpty;
      setBackground(this.hungerIcons[i], src);
    }

    const showAir = player.headInWater || player.air < player.maxAir - 0.01;
    this.airBar.classList.toggle('hidden', !showAir);
    if (showAir) {
      const air = Math.max(0, Math.min(player.maxAir, player.air));
      for (let i = 0; i < 10; i++) {
        const src = air > i * (player.maxAir / 10) ? this.assets.hud.bubble : null;
        setBackground(this.airIcons[i], src);
      }
    }
  }

  updateLocation(biome, position) {
    if (biome && biome !== this.lastBiome) {
      this.lastBiome = biome;
      this.biomeEl.textContent = biome;
    }
    const coords = `X ${Math.floor(position.x)}  Y ${Math.floor(position.y)}  Z ${Math.floor(position.z)}`;
    if (coords !== this.lastCoords) {
      this.lastCoords = coords;
      this.coordsEl.textContent = coords;
    }
  }

  /** Small north-up overview of respawn points, other players and the last death. */
  updateMap(state) {
    const ctx = this.mapCtx;
    if (!ctx || !state?.position) return;
    const size = MAP_SIZE;
    const half = size / 2;
    const scale = half / MAP_RADIUS;
    const center = state.position;
    ctx.clearRect(0, 0, size, size);
    if (state.world && this.terrainCtx && this.terrainImage) {
      this.terrainImage.data.set(sampleTerrain(state.world, center));
      this.terrainCtx.putImageData(this.terrainImage, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.terrainCanvas, 0, 0, size, size);
    } else {
      ctx.fillStyle = 'rgba(8, 14, 18, 0.82)';
      ctx.fillRect(0, 0, size, size);
    }

    // Chunk-aligned grid makes distances easy to read at a glance.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.lineWidth = 1;
    const gridX = Math.floor(center.x / 16) * 16;
    const gridZ = Math.floor(center.z / 16) * 16;
    for (let wx = gridX - MAP_RADIUS; wx <= gridX + MAP_RADIUS; wx += 16) {
      const x = half + (wx - center.x) * scale;
      if (x < 0 || x > size) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let wz = gridZ - MAP_RADIUS; wz <= gridZ + MAP_RADIUS; wz += 16) {
      const y = half + (wz - center.z) * scale;
      if (y < 0 || y > size) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(230, 240, 235, 0.65)';
    ctx.font = '10px monospace';
    ctx.fillText('С', half - 3, 12);

    for (const marker of mapMarkers(state)) {
      const point = projectPoint(marker, center, size);
      ctx.globalAlpha = point.clamped ? 0.72 : 1;
      const radius = point.clamped ? 3 : 4.5;
      if (marker.type === 'spawn') {
        ctx.fillStyle = marker.color;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y - radius);
        ctx.lineTo(point.x + radius, point.y);
        ctx.lineTo(point.x, point.y + radius);
        ctx.lineTo(point.x - radius, point.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (marker.type === 'death') {
        ctx.strokeStyle = marker.color;
        ctx.lineWidth = point.clamped ? 1.5 : 2.5;
        ctx.beginPath();
        ctx.moveTo(point.x - radius, point.y - radius);
        ctx.lineTo(point.x + radius, point.y + radius);
        ctx.moveTo(point.x + radius, point.y - radius);
        ctx.lineTo(point.x - radius, point.y + radius);
        ctx.stroke();
      } else {
        ctx.fillStyle = marker.color;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Local player: white arrow pointing where the camera faces (yaw 0 = north).
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(-(state.yaw || 0));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  setHeldName(name) {
    if (!name) {
      this.heldItemEl.classList.add('hidden');
      return;
    }
    this.heldItemEl.textContent = name;
    this.heldItemEl.classList.remove('hidden');
    clearTimeout(this.heldTimer);
    this.heldTimer = setTimeout(() => {
      this.heldItemEl.classList.add('hidden');
    }, 1800);
  }

  /** Full-width health bar for the Nether boss; hidden whenever no boss is near. */
  setBoss(boss) {
    if (!this.bossBar) return;
    if (!boss) {
      if (this.lastBoss !== '') {
        this.bossBar.classList.add('hidden');
        this.lastBoss = '';
      }
      return;
    }
    const name = boss.name ?? 'Босс';
    const maxHealth = Math.max(1, boss.maxHealth ?? 1);
    const ratio = Math.max(0, Math.min(1, (boss.health ?? 0) / maxHealth));
    const signature = `${name}|${ratio.toFixed(3)}`;
    if (signature === this.lastBoss) return;
    this.lastBoss = signature;
    this.bossNameEl.textContent = name;
    this.bossFillEl.style.width = `${ratio * 100}%`;
    this.bossBar.classList.remove('hidden');
  }

  clearBoss() {
    this.setBoss(null);
  }

  toast(message, duration = 1900) {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.add('hidden');
    }, duration);
  }

  setBreakProgress(value) {
    const clamped = Math.max(0, Math.min(1, value));
    if (Math.abs(clamped - this.lastBreak) < 0.01 && clamped !== 0 && clamped !== 1) return;
    this.lastBreak = clamped;
    if (clamped <= 0 || clamped >= 1) {
      this.breakEl.classList.add('hidden');
      this.breakFillEl.style.width = '0%';
    } else {
      this.breakEl.classList.remove('hidden');
      this.breakFillEl.style.width = `${clamped * 100}%`;
    }
  }

  flashDamage() {
    this.damageEl.classList.add('active');
    clearTimeout(this.damageTimer);
    this.damageTimer = setTimeout(() => this.damageEl.classList.remove('active'), 180);
  }

  setUnderwater(active) {
    this.underwaterEl.classList.toggle('hidden', !active);
  }

  setDebug(visible, lines) {
    if (!visible) {
      this.debugEl.classList.add('hidden');
      return;
    }
    this.debugEl.classList.remove('hidden');
    const text = lines.join('\n');
    if (text !== this.lastDebug) {
      this.lastDebug = text;
      this.debugEl.textContent = text;
    }
  }

  setHint(text) {
    if (this.hintEl.textContent !== text) this.hintEl.textContent = text;
  }

  setHeldTool(heldId, creative = false) {
    if (creative) {
      this.setHint('Креатив · ЛКМ — мгновенно ломать · ПКМ — ставить · двойной Space — полёт · E — каталог');
      return;
    }
    const held = getItem(heldId);
    if (held?.use === 'cook') {
      this.setHint('ПКМ — открыть сковороду и готовить · E — инвентарь');
      return;
    }
    if (isHoe(heldId)) {
      this.setHint('ПКМ — вспахать землю · семена сажаются на пашню · E — инвентарь');
      return;
    }
    const crop = getPlantableCrop(heldId);
    if (crop) {
      this.setHint(`ПКМ — посадить ${crop.name.toLowerCase()} на пашню · E — инвентарь`);
      return;
    }
    const tool = getToolInfo(heldId);
    if (tool) {
      this.setHint(`ЛКМ — ломать (${tool.type}) · ПКМ — ставить · E — инвентарь`);
    } else {
      this.setHint('ЛКМ — ломать · ПКМ — ставить · E — инвентарь');
    }
  }

  dispose() {
    clearTimeout(this.toastTimer);
    clearTimeout(this.heldTimer);
    clearTimeout(this.damageTimer);
  }
}
