// Efectos de sonido sintetizados con Web Audio (sin archivos externos).
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('pp-muted') === '1'; } catch {}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'square', vol = 0.15, slide = 0) {
  if (muted) return;
  const a = ac(); if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  unlock() { ac(); },
  paddle(speedRatio = 0) { tone(420 + speedRatio * 380, 0.07, 'square', 0.14); },
  wall() { tone(260, 0.05, 'triangle', 0.12); },
  score(good = true) { good ? (tone(523, 0.12, 'triangle', 0.15), setTimeout(() => tone(784, 0.18, 'triangle', 0.15), 110)) : tone(220, 0.3, 'sawtooth', 0.1, -120); },
  tick() { tone(880, 0.05, 'sine', 0.1); },
  go() { tone(1320, 0.12, 'sine', 0.12); },
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.14), i * 120)); },
  lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'sawtooth', 0.08), i * 160)); },
  get muted() { return muted; },
  toggle() { muted = !muted; try { localStorage.setItem('pp-muted', muted ? '1' : '0'); } catch {} return muted; },
};
