import {
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFITS,
  SKIN_TONES,
  hexColor,
  normalizeAppearance,
} from '../shared/appearance.js';
import { CharacterPreview } from './CharacterPreview.js';

const $ = (id) => document.getElementById(id);

/** The screen shown before a world loads: name, clothes, skin and hairstyle. */
export class CharacterCreator {
  constructor({ onStart, onBack } = {}) {
    this.onStart = onStart;
    this.onBack = onBack;
    this.buttons = new Map();
    this.values = {};
    this.preview = null;
    this.built = false;
  }

  build() {
    if (this.built) return;
    this.built = true;
    this.nameInput = $('character-name');

    this.buildSwatches('character-outfits', 'outfit', OUTFITS, (option) => ({
      name: option.name, color: option.shirt,
    }));
    this.buildSwatches('character-skins', 'skin', SKIN_TONES, (option) => ({
      name: option.name, color: option.color,
    }));
    this.buildChips('character-hairstyles', 'hairStyle', HAIR_STYLES);
    this.buildSwatches('character-hair-colors', 'hairColor', HAIR_COLORS, (option) => ({
      name: option.name, color: option.color,
    }));

    this.nameInput?.addEventListener('input', () => {
      this.preview?.model?.setName(this.nameInput.value.trim());
    });
    this.nameInput?.addEventListener('keydown', (event) => {
      if (event.code === 'Enter') this.onStart?.();
    });
    $('btn-character-continue')?.addEventListener('click', () => this.onStart?.());
    $('btn-character-back')?.addEventListener('click', () => this.onBack?.());
  }

  buildSwatches(containerId, key, options, describe) {
    const container = $(containerId);
    if (!container) return;
    const buttons = [];
    for (const option of options) {
      const info = describe(option);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'appearance-swatch';
      button.dataset.value = option.id;
      button.title = info.name;
      button.setAttribute('aria-label', `${info.name}`);
      const color = document.createElement('span');
      color.className = 'appearance-swatch-color';
      color.style.background = hexColor(info.color);
      const label = document.createElement('span');
      label.className = 'appearance-swatch-label';
      label.textContent = info.name;
      button.append(color, label);
      button.addEventListener('click', () => this.select(key, option.id));
      container.appendChild(button);
      buttons.push(button);
      if (!this.values[key]) this.values[key] = option.id;
    }
    this.buttons.set(key, buttons);
  }

  buildChips(containerId, key, options) {
    const container = $(containerId);
    if (!container) return;
    const buttons = [];
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'appearance-chip';
      button.dataset.value = option.id;
      button.textContent = option.name;
      button.addEventListener('click', () => this.select(key, option.id));
      container.appendChild(button);
      buttons.push(button);
      if (!this.values[key]) this.values[key] = option.id;
    }
    this.buttons.set(key, buttons);
  }

  select(key, id) {
    this.values[key] = id;
    for (const button of this.buttons.get(key) ?? []) {
      button.classList.toggle('selected', button.dataset.value === id);
    }
    this.refreshPreview();
  }

  current() {
    return normalizeAppearance({
      name: this.nameInput?.value ?? '',
      outfit: this.values.outfit,
      skin: this.values.skin,
      hairStyle: this.values.hairStyle,
      hairColor: this.values.hairColor,
    });
  }

  refreshPreview() {
    if (!this.preview) return;
    this.preview.setAppearance(this.current());
  }

  open(appearance) {
    this.build();
    const value = normalizeAppearance(appearance);
    this.values = {
      outfit: value.outfit,
      skin: value.skin,
      hairStyle: value.hairStyle,
      hairColor: value.hairColor,
    };
    if (this.nameInput) this.nameInput.value = value.name;
    for (const [key, id] of Object.entries(this.values)) this.select(key, id);

    if (!this.preview) {
      this.preview = new CharacterPreview($('character-create-preview'), this.current());
      if (this.preview.model) {
        this.preview.model.nameTag.position.y = 1.98;
        this.preview.model.setName(value.name);
      }
    }
    this.preview.start();
  }

  close() {
    this.preview?.dispose();
    this.preview = null;
  }
}
