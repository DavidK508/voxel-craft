import { RECIPES, findRecipe, recipeToPlacement } from '../shared/recipes.js';
import { CharacterPreview } from './CharacterPreview.js';
import {
  ITEM_LIST,
  createItemStack,
  getArmorInfo,
  getItem,
  getMaxStack,
  getToolInfo,
} from '../shared/items.js';

const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'];
const ARMOR_LABELS = { head: 'Шлем', chest: 'Нагрудник', legs: 'Поножи', feet: 'Ботинки' };

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

function toggleHidden(element, hidden) {
  if (element) element.classList.toggle('hidden', hidden);
}

export class InventoryUI {
  constructor({ assets, inventory, onChange, onDropStack, onCloseRequest, audio }) {
    this.assets = assets;
    this.inventory = inventory;
    this.onChange = onChange;
    this.onDropStack = onDropStack;
    this.onCloseRequest = onCloseRequest;
    this.audio = audio;

    this.screen = $('inventory-screen');
    this.titleEl = $('inventory-title');
    this.subtitleEl = $('inventory-subtitle');
    this.gridEl = $('inventory-grid');
    this.armorSlotsEl = $('armor-slots');
    this.hotbarEl = $('inventory-hotbar');
    this.craftGridEl = $('crafting-grid');
    this.resultEl = $('craft-result-slot');
    this.cursorEl = $('cursor-stack');
    this.tooltipEl = $('item-tooltip');
    this.closeButton = $('btn-inventory-close');
    this.recipeListEl = $('recipe-list');
    this.recipeHintEl = $('recipe-hint');
    this.creativePanel = $('creative-panel');
    this.creativeGridEl = $('creative-grid');
    this.creativeHintEl = $('creative-hint');

    this.views = new Map();
    this.recipeCards = new Map();
    this.craftingSize = 2;
    this.craftingSlots = new Array(9).fill(null);
    this.cursorStack = null;
    this.recipe = null;
    this.openState = false;
    this.creative = false;
    this.creativeBuilt = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.lastHoverKey = null;
    this.preview = new CharacterPreview($('character-preview'));

    this.buildPermanentSlots();
    this.buildCursorView();
    this.bindEvents();
  }

  buildPermanentSlots() {
    for (let i = 9; i < 36; i++) {
      const element = this.createSlotElement('inv', i);
      this.gridEl.appendChild(element);
      this.views.set(`inv:${i}`, this.decorateSlot(element));
    }
    for (let i = 0; i < 9; i++) {
      const element = this.createSlotElement('hotbar', i);
      this.hotbarEl.appendChild(element);
      this.views.set(`hotbar:${i}`, this.decorateSlot(element));
    }
    for (let i = 0; i < ARMOR_SLOTS.length; i++) {
      const element = this.createSlotElement('armor', i);
      element.classList.add('armor-slot');
      element.title = ARMOR_LABELS[ARMOR_SLOTS[i]];
      element.dataset.armorSlot = ARMOR_SLOTS[i];
      this.armorSlotsEl?.appendChild(element);
      this.views.set(`armor:${i}`, this.decorateSlot(element));
    }
    this.resultEl.dataset.kind = 'result';
    this.resultEl.dataset.index = '0';
    this.resultView = this.decorateSlot(this.resultEl);
  }

  createSlotElement(kind, index) {
    const element = document.createElement('div');
    element.className = 'slot';
    element.dataset.kind = kind;
    element.dataset.index = String(index);
    element.tabIndex = 0;
    return element;
  }

  decorateSlot(element) {
    const icon = document.createElement('div');
    icon.className = 'item-icon';
    const count = document.createElement('div');
    count.className = 'item-count';
    const durability = document.createElement('div');
    durability.className = 'durability';
    const durabilityFill = document.createElement('i');
    durability.appendChild(durabilityFill);
    element.append(icon, count, durability);
    return { element, icon, count, durability, durabilityFill };
  }

  buildCursorView() {
    const icon = document.createElement('div');
    icon.className = 'item-icon';
    const count = document.createElement('div');
    count.className = 'item-count';
    this.cursorEl.append(icon, count);
    this.cursorView = { icon, count };
  }

  bindEvents() {
    this.screen.addEventListener('mousedown', (event) => {
      const slot = event.target.closest?.('.slot');
      if (!slot) return;
      event.preventDefault();
      const kind = slot.dataset.kind;
      const index = Number(slot.dataset.index);
      if (!kind) return;
      this.handleSlotClick(kind, index, event.button, event.shiftKey);
    });

    this.screen.addEventListener('mousemove', (event) => {
      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
      this.positionCursor();
      this.updateTooltip(event.target.closest?.('.slot') ?? null);
    });

    this.screen.addEventListener('mouseleave', () => {
      this.tooltipEl.classList.add('hidden');
      this.lastHoverKey = null;
    });

    this.closeButton.addEventListener('click', () => {
      this.onCloseRequest?.();
    });

    this.recipeListEl?.addEventListener('click', (event) => {
      const card = event.target.closest?.('.recipe-card');
      if (!card) return;
      event.preventDefault();
      const record = this.recipeCards.get(card.dataset.recipeId);
      if (!record) return;
      this.placeRecipe(record.recipe);
    });

    this.creativeGridEl?.addEventListener('mousedown', (event) => {
      const slot = event.target.closest?.('.creative-slot');
      if (!slot) return;
      event.preventDefault();
      this.giveCreativeItem(Number(slot.dataset.itemId), event.button);
    });
  }

  /** Builds the creative catalog once; it contains every item in the registry. */
  buildCreativeGrid() {
    if (this.creativeBuilt || !this.creativeGridEl) return;
    this.creativeBuilt = true;
    this.creativeGridEl.replaceChildren();

    const items = [...ITEM_LIST].sort((a, b) => {
      const blockA = a.placeBlock ? 0 : 1;
      const blockB = b.placeBlock ? 0 : 1;
      if (blockA !== blockB) return blockA - blockB;
      return a.name.localeCompare(b.name, 'ru');
    });

    for (const item of items) {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'creative-slot';
      slot.dataset.itemId = String(item.id);
      slot.title = `${item.name} · ЛКМ — стак, ПКМ — один`;

      const icon = document.createElement('div');
      icon.className = 'item-icon';
      setBackground(icon, this.assets.getIcon(item.id));

      const name = document.createElement('span');
      name.className = 'creative-slot-name';
      name.textContent = item.name;

      slot.append(icon, name);
      this.creativeGridEl.appendChild(slot);
    }

    if (this.creativeHintEl) {
      this.creativeHintEl.textContent = `${items.length} предметов · ЛКМ — стак, ПКМ — один`;
    }
  }

  giveCreativeItem(id, button) {
    const item = getItem(id);
    if (!item) return;
    const count = button === 2 ? 1 : getMaxStack(id);
    const stack = createItemStack(id, count);
    if (!stack) return;
    const remainder = this.inventory.addStack(stack);
    if (remainder) this.onDropStack?.(remainder);
    this.audio?.playClick();
    this.refresh();
  }

  buildCraftingGrid() {
    this.craftGridEl.replaceChildren();
    for (let i = 0; i < 9; i++) {
      const key = `craft:${i}`;
      const old = this.views.get(key);
      if (old) old.element.remove();
      this.views.delete(key);
    }
    this.craftGridEl.style.gridTemplateColumns = `repeat(${this.craftingSize}, 48px)`;
    for (let i = 0; i < this.craftingSize * this.craftingSize; i++) {
      const element = this.createSlotElement('craft', i);
      this.craftGridEl.appendChild(element);
      this.views.set(`craft:${i}`, this.decorateSlot(element));
    }
  }

  buildRecipeList() {
    if (!this.recipeListEl) return;
    this.recipeListEl.replaceChildren();
    this.recipeCards.clear();

    let visible = 0;
    for (const recipe of RECIPES) {
      const placement = recipeToPlacement(recipe, this.craftingSize);
      if (!placement) continue;
      const card = this.createRecipeCard(recipe, placement);
      this.recipeListEl.appendChild(card.element);
      this.recipeCards.set(recipe.id, card);
      visible++;
    }

    if (visible === 0) {
      const empty = document.createElement('div');
      empty.className = 'recipe-empty';
      empty.textContent = 'Для этой сетки рецептов нет.';
      this.recipeListEl.appendChild(empty);
    }
    if (this.recipeHintEl) {
      this.recipeHintEl.textContent = visible > 0
        ? `${visible} рецептов · нажми, чтобы разложить`
        : 'Открой верстак, чтобы увидеть рецепты 3×3';
    }
  }

  createRecipeCard(recipe, placement) {
    const size = this.craftingSize;
    const resultItem = getItem(recipe.result.id);
    const resultName = resultItem?.name ?? recipe.id;

    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'recipe-card';
    element.dataset.recipeId = recipe.id;

    const top = document.createElement('div');
    top.className = 'recipe-card-top';

    const pattern = document.createElement('div');
    pattern.className = 'recipe-pattern';
    pattern.style.gridTemplateColumns = `repeat(${size}, 18px)`;
    for (let i = 0; i < size * size; i++) {
      const cellEl = document.createElement('div');
      cellEl.className = 'recipe-cell';
      const candidates = placement[i];
      if (candidates) {
        const id = candidates[0];
        setBackground(cellEl, this.assets.getIcon(id));
        cellEl.title = candidates.map((candidate) => getItem(candidate)?.name ?? candidate).join(' / ');
        cellEl.classList.add('filled');
      } else {
        cellEl.classList.add('empty');
      }
      pattern.appendChild(cellEl);
    }

    const arrow = document.createElement('div');
    arrow.className = 'recipe-arrow';
    arrow.textContent = '➜';

    const output = document.createElement('div');
    output.className = 'recipe-output';
    setBackground(output, this.assets.getIcon(recipe.result.id));
    if (recipe.result.count > 1) {
      const amount = document.createElement('span');
      amount.className = 'recipe-output-count';
      amount.textContent = `×${recipe.result.count}`;
      output.appendChild(amount);
    }

    top.append(pattern, arrow, output);

    const name = document.createElement('div');
    name.className = 'recipe-name';
    name.textContent = resultName;

    const need = document.createElement('div');
    need.className = 'recipe-need';
    const groups = new Map();
    for (const candidates of placement) {
      if (!candidates) continue;
      const key = candidates.join(',');
      const group = groups.get(key);
      if (group) group.count += 1;
      else groups.set(key, { candidates, count: 1 });
    }
    need.textContent = [...groups.values()]
      .map(({ candidates, count }) => {
        const label = candidates.length > 1
          ? candidates.map((id) => getItem(id)?.name ?? id).join(' / ')
          : (getItem(candidates[0])?.name ?? candidates[0]);
        return count > 1 ? `${label} ×${count}` : label;
      })
      .join(' · ');
    element.title = `Создать: ${resultName}${recipe.result.count > 1 ? ` ×${recipe.result.count}` : ''}\n${need.textContent}`;

    element.append(top, name, need);
    return { element, recipe, placement };
  }

  countInCrafting(id) {
    let total = 0;
    for (const stack of this.craftingSlots) {
      if (stack && stack.id === id) total += stack.count;
    }
    return total;
  }

  /**
   * Picks a concrete item id for every ingredient cell. Returns null as soon as
   * any cell has no matching item left in the inventory.
   */
  resolvePlacement(placement, includeCrafting = false) {
    const taken = new Map();
    const resolved = new Array(placement.length).fill(null);
    for (let i = 0; i < placement.length; i++) {
      const candidates = placement[i];
      if (!candidates) continue;
      let chosen = null;
      for (const id of candidates) {
        const available = this.inventory.countItem(id)
          + (includeCrafting ? this.countInCrafting(id) : 0);
        if (available > (taken.get(id) ?? 0)) {
          chosen = id;
          break;
        }
      }
      if (chosen == null) return null;
      resolved[i] = chosen;
      taken.set(chosen, (taken.get(chosen) ?? 0) + 1);
    }
    return resolved;
  }

  updateRecipeAvailability() {
    for (const card of this.recipeCards.values()) {
      const available = this.resolvePlacement(card.placement, true) !== null;
      card.available = available;
      card.element.classList.toggle('unavailable', !available);
      card.element.setAttribute('aria-disabled', available ? 'false' : 'true');
    }
  }

  returnCraftingGrid() {
    for (let i = 0; i < this.craftingSlots.length; i++) {
      const stack = this.craftingSlots[i];
      if (!stack) continue;
      this.craftingSlots[i] = null;
      this.returnStack(stack);
    }
  }

  takeOneFromInventory(id) {
    for (let i = 0; i < 36; i++) {
      const stack = this.inventory.slots[i];
      if (stack && stack.id === id) {
        this.inventory.removeFromSlot(i, 1);
        return true;
      }
    }
    return false;
  }

  flashDenied(recipeId) {
    const card = this.recipeCards.get(recipeId);
    if (!card) return;
    card.element.classList.remove('denied');
    // Force a reflow so the animation can restart on a repeated click.
    void card.element.offsetWidth;
    card.element.classList.add('denied');
    setTimeout(() => card.element.classList.remove('denied'), 320);
  }

  /**
   * Puts a recipe into the crafting grid. Existing grid contents are returned
   * to the inventory first, then the required ingredients are taken out of the
   * inventory one item per cell.
   */
  placeRecipe(recipe) {
    if (!this.openState) return false;
    const placement = recipeToPlacement(recipe, this.craftingSize);
    if (!placement) {
      this.flashDenied(recipe.id);
      return false;
    }

    // Check availability together with the items already in the grid, because
    // returnCraftingGrid() puts those back into the inventory below.
    const resolved = this.resolvePlacement(placement, true);
    if (!resolved) {
      this.audio?.playClick();
      this.flashDenied(recipe.id);
      return false;
    }

    this.returnCraftingGrid();
    // Re-resolve against the inventory only: returnCraftingGrid() may have
    // dropped items on the ground when the inventory was full.
    const ready = this.resolvePlacement(placement, false);
    if (!ready) {
      this.flashDenied(recipe.id);
      this.refresh();
      return false;
    }
    for (const id of ready) {
      if (id != null) this.takeOneFromInventory(id);
    }

    this.craftingSlots = new Array(9).fill(null);
    for (let i = 0; i < ready.length; i++) {
      if (ready[i] != null) this.craftingSlots[i] = { id: ready[i], count: 1 };
    }

    this.audio?.playClick();
    this.refresh();
    return true;
  }

  open(size = 2, options = {}) {
    if (this.openState) this.close();
    this.creative = options.creative === true;
    this.craftingSize = size === 3 ? 3 : 2;
    this.craftingSlots = new Array(9).fill(null);
    this.cursorStack = null;
    this.lastHoverKey = null;
    this.screen.classList.toggle('creative-mode', this.creative);
    toggleHidden(this.creativePanel, !this.creative);

    if (this.creative) {
      this.titleEl.textContent = 'Креатив';
      this.subtitleEl.textContent = 'Все блоки и предметы доступны. Нажми на предмет, чтобы добавить его в инвентарь.';
      this.buildCreativeGrid();
    } else {
      this.titleEl.textContent = size === 3 ? 'Верстак' : 'Инвентарь';
      this.subtitleEl.textContent = size === 3
        ? 'Сетка 3×3. Собирай инструменты, блоки и еду.'
        : '2×2 крафт. Открой верстак для сетки 3×3.';
      this.buildCraftingGrid();
      this.buildRecipeList();
    }
    this.openState = true;
    this.screen.classList.remove('hidden');
    this.tooltipEl.classList.add('hidden');
    this.refresh();
    this.preview?.setArmor(this.inventory.armor);
    this.preview?.start();
  }

  close() {
    if (!this.openState) return;
    if (this.cursorStack) {
      this.returnStack(this.cursorStack);
      this.cursorStack = null;
    }
    for (let i = 0; i < this.craftingSlots.length; i++) {
      if (this.craftingSlots[i]) {
        this.returnStack(this.craftingSlots[i]);
        this.craftingSlots[i] = null;
      }
    }
    this.openState = false;
    this.creative = false;
    this.recipe = null;
    this.preview?.stop();
    this.screen.classList.add('hidden');
    this.cursorEl.classList.add('hidden');
    this.tooltipEl.classList.add('hidden');
    this.lastHoverKey = null;
    this.onChange?.();
  }

  isOpen() {
    return this.openState;
  }

  tickPreview(dt) {
    if (this.openState) this.preview?.tick(dt);
  }

  returnStack(stack) {
    if (!stack) return;
    const remainder = this.inventory.addStack(stack);
    if (remainder) this.onDropStack?.(remainder);
  }

  getStack(kind, index) {
    if (kind === 'craft') return this.craftingSlots[index] ?? null;
    if (kind === 'armor') return this.inventory.armor[index] ?? null;
    return this.inventory.slots[index] ?? null;
  }

  setStack(kind, index, stack) {
    if (kind === 'craft') {
      this.craftingSlots[index] = stack;
    } else if (kind === 'armor') {
      this.inventory.setArmorSlot(index, stack);
    } else {
      this.inventory.setSlot(index, stack);
    }
  }

  canEquip(stack, slotIndex) {
    const info = getArmorInfo(stack?.id);
    return !!info && info.slot === ARMOR_SLOTS[slotIndex];
  }

  /** Shift-click support: moves a matching armor piece from a bag slot. */
  tryEquipArmor(kind, index) {
    if (kind === 'craft' || kind === 'armor') return false;
    const stack = this.getStack(kind, index);
    const info = getArmorInfo(stack?.id);
    if (!info) return false;
    const slotIndex = ARMOR_SLOTS.indexOf(info.slot);
    if (slotIndex < 0) return false;
    const current = this.inventory.armor[slotIndex] ?? null;
    this.setStack(kind, index, current);
    this.inventory.setArmorSlot(slotIndex, stack);
    return true;
  }

  updateRecipe() {
    const grid = new Array(this.craftingSize * this.craftingSize).fill(null);
    for (let i = 0; i < grid.length; i++) grid[i] = this.craftingSlots[i]?.id ?? null;
    this.recipe = findRecipe(grid, this.craftingSize);
  }

  getResultStack() {
    if (!this.recipe) return null;
    return { id: this.recipe.result.id, count: this.recipe.result.count };
  }

  refresh() {
    this.updateRecipe();
    this.render();
    this.onChange?.();
  }

  render() {
    for (let i = 0; i < 36; i++) {
      const kind = i < 9 ? 'hotbar' : 'inv';
      const view = this.views.get(`${kind}:${i}`);
      if (!view) continue;
      this.renderSlot(view, this.inventory.slots[i]);
      view.element.classList.toggle('selected', i < 9 && this.inventory.selected === i);
    }

    for (let i = 0; i < this.craftingSize * this.craftingSize; i++) {
      const view = this.views.get(`craft:${i}`);
      if (view) this.renderSlot(view, this.craftingSlots[i]);
    }

    for (let i = 0; i < this.inventory.armor.length; i++) {
      const view = this.views.get(`armor:${i}`);
      if (view) this.renderSlot(view, this.inventory.armor[i]);
    }

    this.renderSlot(this.resultView, this.getResultStack());
    this.renderCursor();
    this.updateRecipeAvailability();
    this.preview?.setArmor(this.inventory.armor);
  }

  renderSlot(view, stack) {
    if (!stack) {
      setBackground(view.icon, null);
      view.count.textContent = '';
      view.durability.classList.add('hidden');
      return;
    }
    const item = getItem(stack.id);
    setBackground(view.icon, this.assets.getIcon(stack.id));
    view.count.textContent = stack.count > 1 ? String(stack.count) : '';
    const meta = item?.tool ?? item?.armor;
    if (meta && stack.durability !== undefined) {
      const ratio = Math.max(0, Math.min(1, stack.durability / meta.durability));
      view.durability.classList.remove('hidden', 'low', 'critical');
      if (ratio <= 0.2) view.durability.classList.add('critical');
      else if (ratio <= 0.5) view.durability.classList.add('low');
      view.durabilityFill.style.width = `${ratio * 100}%`;
    } else {
      view.durability.classList.add('hidden');
    }
  }

  renderCursor() {
    if (!this.cursorStack) {
      this.cursorEl.classList.add('hidden');
      return;
    }
    this.cursorEl.classList.remove('hidden');
    setBackground(this.cursorView.icon, this.assets.getIcon(this.cursorStack.id));
    this.cursorView.count.textContent = this.cursorStack.count > 1 ? String(this.cursorStack.count) : '';
    this.positionCursor();
  }

  positionCursor() {
    if (!this.cursorStack) return;
    this.cursorEl.style.left = `${this.mouseX}px`;
    this.cursorEl.style.top = `${this.mouseY}px`;
  }

  updateTooltip(slot) {
    if (!slot) {
      this.tooltipEl.classList.add('hidden');
      this.lastHoverKey = null;
      return;
    }
    const kind = slot.dataset.kind;
    const index = Number(slot.dataset.index);
    let stack = null;
    if (kind === 'result') stack = this.getResultStack();
    else if (kind) stack = this.getStack(kind, index);

    if (!stack) {
      this.tooltipEl.classList.add('hidden');
      this.lastHoverKey = null;
      return;
    }

    const key = `${kind}:${index}:${stack.id}:${stack.count}`;
    if (key === this.lastHoverKey) {
      this.positionTooltip();
      return;
    }
    this.lastHoverKey = key;

    const item = getItem(stack.id);
    const lines = [];
    lines.push(`<strong>${escapeHtml(item?.name ?? 'Неизвестный предмет')}</strong>`);
    if (item?.tool) {
      const tool = item.tool;
      const durability = stack.durability !== undefined ? stack.durability : tool.durability;
      lines.push(`<span>Инструмент · уровень ${tool.tier} · скорость ×${tool.speed}</span>`);
      lines.push(`<span>Прочность: ${durability} / ${tool.durability}</span>`);
    } else if (item?.armor) {
      const armor = item.armor;
      const durability = stack.durability !== undefined ? stack.durability : armor.durability;
      lines.push(`<span>Броня · ${ARMOR_LABELS[armor.slot] ?? armor.slot} · защита +${armor.defense}</span>`);
      lines.push(`<span>Прочность: ${durability} / ${armor.durability}</span>`);
    } else if (item?.food) {
      lines.push(`<span>Еда · насыщение +${item.food.nutrition}</span>`);
      if (item.food.regeneration) lines.push(`<span>Регенерация +${item.food.regeneration}</span>`);
    } else if (item?.placeBlock) {
      lines.push('<span>Строительный блок</span>');
    }
    if (stack.count > 1) lines.push(`<span>Количество: ${stack.count}</span>`);
    this.tooltipEl.innerHTML = lines.join('');
    this.tooltipEl.classList.remove('hidden');
    this.positionTooltip();
  }

  positionTooltip() {
    if (this.tooltipEl.classList.contains('hidden')) return;
    const width = this.tooltipEl.offsetWidth || 220;
    const height = this.tooltipEl.offsetHeight || 80;
    const left = Math.min(this.mouseX + 16, window.innerWidth - width - 8);
    const top = Math.min(this.mouseY + 16, window.innerHeight - height - 8);
    this.tooltipEl.style.left = `${Math.max(8, left)}px`;
    this.tooltipEl.style.top = `${Math.max(8, top)}px`;
  }

  handleSlotClick(kind, index, button, shift) {
    if (kind === 'result') {
      this.craft(button === 0 && shift);
      return;
    }
    if (button !== 0 && button !== 2) return;

    if (kind === 'armor' && this.cursorStack && !this.canEquip(this.cursorStack, index)) {
      this.audio?.playClick();
      return;
    }

    if (shift && button === 0) {
      if (kind === 'armor') {
        const worn = this.getStack(kind, index);
        if (worn) {
          const remainder = this.inventory.addStack(worn);
          if (!remainder) this.setStack(kind, index, null);
          this.audio?.playClick();
          this.refresh();
        }
        return;
      }
      this.quickMove(kind, index);
      this.audio?.playClick();
      this.refresh();
      return;
    }

    const stack = this.getStack(kind, index);

    if (button === 0) {
      if (!this.cursorStack) {
        if (stack) {
          this.cursorStack = stack;
          this.setStack(kind, index, null);
        }
      } else if (!stack) {
        this.setStack(kind, index, this.cursorStack);
        this.cursorStack = null;
      } else if (stack.id === this.cursorStack.id) {
        const max = getMaxStack(stack.id);
        const move = Math.min(max - stack.count, this.cursorStack.count);
        if (move > 0) {
          stack.count += move;
          this.cursorStack.count -= move;
          if (this.cursorStack.count <= 0) this.cursorStack = null;
        }
      } else {
        this.setStack(kind, index, this.cursorStack);
        this.cursorStack = stack;
      }
    } else if (button === 2) {
      if (!this.cursorStack) {
        if (stack) {
          const take = Math.ceil(stack.count / 2);
          this.cursorStack = { ...stack, count: take };
          stack.count -= take;
          if (stack.count <= 0) this.setStack(kind, index, null);
        }
      } else if (!stack) {
        const one = { ...this.cursorStack, count: 1 };
        this.setStack(kind, index, one);
        this.cursorStack.count -= 1;
        if (this.cursorStack.count <= 0) this.cursorStack = null;
      } else if (stack.id === this.cursorStack.id) {
        const max = getMaxStack(stack.id);
        if (stack.count < max) {
          stack.count += 1;
          this.cursorStack.count -= 1;
          if (this.cursorStack.count <= 0) this.cursorStack = null;
        }
      }
    }

    this.audio?.playClick();
    this.refresh();
  }

  quickMove(kind, index) {
    const stack = this.getStack(kind, index);
    if (!stack) return;

    if (this.tryEquipArmor(kind, index)) return;

    if (kind === 'craft') {
      const remainder = this.inventory.addStack(stack);
      this.craftingSlots[index] = remainder;
      return;
    }

    let remainder = null;
    if (index < 9) {
      remainder = this.inventory.addStackToRange(stack, 9, 36);
      if (remainder) remainder = this.inventory.addStackToRange(remainder, 0, 9, index);
    } else {
      remainder = this.inventory.addStackToRange(stack, 0, 9);
      if (remainder) remainder = this.inventory.addStackToRange(remainder, 9, 36, index);
    }
    this.inventory.setSlot(index, remainder);
  }

  consumeIngredients() {
    const count = this.craftingSize * this.craftingSize;
    for (let i = 0; i < count; i++) {
      const stack = this.craftingSlots[i];
      if (!stack) continue;
      stack.count -= 1;
      if (stack.count <= 0) this.craftingSlots[i] = null;
    }
  }

  craft(all) {
    const recipe = this.recipe;
    if (!recipe) return;
    const result = recipe.result;

    if (all) {
      let crafted = 0;
      while (this.recipe && this.recipe.id === recipe.id && this.inventory.canAdd(result.id, result.count)) {
        this.consumeIngredients();
        this.inventory.add(result.id, result.count);
        crafted++;
        this.updateRecipe();
        if (crafted >= 256) break;
      }
      if (crafted > 0) this.audio?.playCraft();
    } else {
      const max = getMaxStack(result.id);
      if (this.cursorStack) {
        if (this.cursorStack.id !== result.id) return;
        if (this.cursorStack.count + result.count > max) return;
      }
      this.consumeIngredients();
      if (this.cursorStack) {
        this.cursorStack.count += result.count;
      } else {
        this.cursorStack = createItemStack(result.id, result.count) ?? { id: result.id, count: result.count };
      }
      this.audio?.playCraft();
    }
    this.refresh();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
