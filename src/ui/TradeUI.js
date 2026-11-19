import { getItem } from '../shared/items.js';
import { countItem, describeOffer } from '../shared/trades.js';

const $ = (id) => document.getElementById(id);

function setBackground(element, url) {
  if (url) element.style.backgroundImage = `url("${url}")`;
  else element.style.backgroundImage = '';
}

/** Villager barter screen. Offers are supplied by Game and resolved there. */
export class TradeUI {
  constructor({ assets, audio, onTrade, onClose }) {
    this.assets = assets;
    this.audio = audio;
    this.onTrade = onTrade;
    this.onClose = onClose;
    this.screen = $('trade-screen');
    this.titleEl = $('trade-title');
    this.subtitleEl = $('trade-subtitle');
    this.listEl = $('trade-offers');
    this.closeButton = $('btn-trade-close');
    this.inventory = null;
    this.offers = [];
    this.openState = false;

    this.closeButton?.addEventListener('click', () => this.onClose?.());
    this.listEl?.addEventListener('click', (event) => {
      const card = event.target.closest?.('.trade-offer');
      if (!card || card.classList.contains('unavailable')) return;
      const index = Number(card.dataset.index);
      const offer = this.offers[index];
      if (offer) this.onTrade?.(offer);
    });
  }

  open(name, offers, inventory) {
    if (!this.screen) return;
    this.offers = offers ?? [];
    this.inventory = inventory;
    if (this.titleEl) this.titleEl.textContent = `Торговля: ${name || 'Житель'}`;
    if (this.subtitleEl) this.subtitleEl.textContent = 'Нажми на предложение, чтобы обменять предметы.';
    this.openState = true;
    this.screen.classList.remove('hidden');
    this.render();
  }

  render() {
    if (!this.listEl) return;
    this.listEl.replaceChildren();
    for (let i = 0; i < this.offers.length; i++) {
      const offer = this.offers[i];
      const canAfford = countItem(this.inventory, offer.give.id) >= offer.give.count;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `trade-offer${canAfford ? '' : ' unavailable'}`;
      card.dataset.index = String(i);
      card.title = describeOffer(offer);

      const give = document.createElement('div');
      give.className = 'trade-side trade-give';
      const giveIcon = document.createElement('div');
      giveIcon.className = 'item-icon';
      setBackground(giveIcon, this.assets?.getIcon(offer.give.id));
      const giveText = document.createElement('span');
      giveText.textContent = `${offer.give.count} × ${getItem(offer.give.id)?.name ?? '?'}`;
      give.append(giveIcon, giveText);

      const arrow = document.createElement('div');
      arrow.className = 'trade-arrow';
      arrow.textContent = '➜';

      const get = document.createElement('div');
      get.className = 'trade-side trade-get';
      const getIcon = document.createElement('div');
      getIcon.className = 'item-icon';
      setBackground(getIcon, this.assets?.getIcon(offer.get.id));
      const getText = document.createElement('span');
      getText.textContent = `${offer.get.count} × ${getItem(offer.get.id)?.name ?? '?'}`;
      get.append(getIcon, getText);

      card.append(give, arrow, get);
      this.listEl.appendChild(card);
    }
  }

  close() {
    this.openState = false;
    this.offers = [];
    this.screen?.classList.add('hidden');
  }

  isOpen() {
    return this.openState;
  }
}
