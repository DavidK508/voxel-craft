import { Game } from './game/Game.js';

let fatalShown = false;

function showFatal(error) {
  if (fatalShown) return;
  fatalShown = true;
  console.error(error);
  const box = document.getElementById('fatal-error');
  const text = document.getElementById('fatal-error-text');
  if (text) {
    text.textContent = error?.stack ?? (error?.message ?? String(error));
  }
  if (box) box.classList.remove('hidden');
}

window.addEventListener('error', (event) => {
  showFatal(event.error ?? event.message ?? 'Неизвестная ошибка');
});

window.addEventListener('unhandledrejection', (event) => {
  showFatal(event.reason ?? 'Необработанный Promise rejection');
});

try {
  const game = new Game();
  // Exposed for debugging from DevTools (F12 / --dev).
  window.voxelGame = game;
} catch (error) {
  showFatal(error);
}
