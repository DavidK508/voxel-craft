export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.65;
    this.noiseBuffer = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.ctx = new AudioContextClass();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.createNoiseBuffer(1);
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  createNoiseBuffer(seconds) {
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, rate * seconds, rate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.86 + white * 0.14;
      data[i] = last;
    }
    return buffer;
  }

  burst({ duration = 0.12, frequency = 800, q = 1, gain = 0.2, type = 'bandpass', delay = 0 }) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(gain, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  tone({ frequency = 440, duration = 0.1, gain = 0.08, type = 'sine', delay = 0 }) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(gain, now + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(envelope);
    envelope.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  materialForBlock(block) {
    if (!block) return 'stone';
    const key = block.key;
    if (key.includes('planks') || key.includes('log') || key.includes('bookshelf') || key === 'crafting_table' || key === 'furnace') return 'wood';
    if (key.includes('grass') || key.includes('leaves') || key.includes('wool')) return 'grass';
    if (key.includes('sand') || key === 'gravel') return 'sand';
    if (key === 'glass' || key === 'ice') return 'glass';
    if (key === 'snow_block') return 'snow';
    return 'stone';
  }

  playBreak(block) {
    const material = this.materialForBlock(block);
    if (material === 'wood') {
      this.burst({ frequency: 520, duration: 0.16, gain: 0.22, q: 0.7 });
      this.tone({ frequency: 130, duration: 0.08, gain: 0.05, type: 'triangle' });
    } else if (material === 'grass') {
      this.burst({ frequency: 1600, duration: 0.12, gain: 0.13, q: 0.4 });
    } else if (material === 'sand') {
      this.burst({ frequency: 1100, duration: 0.15, gain: 0.14, q: 0.5 });
    } else if (material === 'glass') {
      this.burst({ frequency: 3200, duration: 0.22, gain: 0.18, q: 2.5 });
      this.tone({ frequency: 1800, duration: 0.12, gain: 0.04, type: 'triangle' });
    } else if (material === 'snow') {
      this.burst({ frequency: 900, duration: 0.1, gain: 0.09, q: 0.4 });
    } else {
      this.burst({ frequency: 380, duration: 0.18, gain: 0.25, q: 0.8 });
      this.tone({ frequency: 90, duration: 0.1, gain: 0.06, type: 'square' });
    }
  }

  playPlace(block) {
    const material = this.materialForBlock(block);
    if (material === 'wood') this.burst({ frequency: 420, duration: 0.1, gain: 0.18, q: 0.6 });
    else if (material === 'grass') this.burst({ frequency: 1300, duration: 0.08, gain: 0.1, q: 0.4 });
    else if (material === 'sand') this.burst({ frequency: 850, duration: 0.09, gain: 0.12, q: 0.5 });
    else if (material === 'glass') this.tone({ frequency: 1400, duration: 0.08, gain: 0.06, type: 'triangle' });
    else this.burst({ frequency: 520, duration: 0.09, gain: 0.16, q: 0.7 });
  }

  playStep(block) {
    const material = this.materialForBlock(block);
    if (material === 'grass') this.burst({ frequency: 1200, duration: 0.06, gain: 0.035, q: 0.4 });
    else if (material === 'sand') this.burst({ frequency: 1000, duration: 0.07, gain: 0.04, q: 0.4 });
    else if (material === 'wood') this.burst({ frequency: 360, duration: 0.07, gain: 0.05, q: 0.6 });
    else if (material === 'snow') this.burst({ frequency: 700, duration: 0.06, gain: 0.03, q: 0.3 });
    else this.burst({ frequency: 320, duration: 0.06, gain: 0.045, q: 0.6 });
  }

  playHurt() {
    this.tone({ frequency: 180, duration: 0.18, gain: 0.1, type: 'sawtooth' });
    this.burst({ frequency: 500, duration: 0.12, gain: 0.08, q: 0.5 });
  }

  playEat() {
    this.burst({ frequency: 900, duration: 0.08, gain: 0.08, q: 0.5 });
    this.burst({ frequency: 700, duration: 0.08, gain: 0.06, q: 0.5, delay: 0.12 });
  }

  playPickup() {
    this.tone({ frequency: 660, duration: 0.06, gain: 0.04, type: 'sine' });
    this.tone({ frequency: 880, duration: 0.08, gain: 0.035, type: 'sine', delay: 0.05 });
  }

  playCraft() {
    this.tone({ frequency: 440, duration: 0.07, gain: 0.05, type: 'triangle' });
    this.tone({ frequency: 660, duration: 0.1, gain: 0.05, type: 'triangle', delay: 0.06 });
  }

  playClick() {
    this.tone({ frequency: 520, duration: 0.035, gain: 0.03, type: 'square' });
  }

  playSplash() {
    this.burst({ frequency: 500, duration: 0.35, gain: 0.14, q: 0.3, type: 'lowpass' });
  }
}
