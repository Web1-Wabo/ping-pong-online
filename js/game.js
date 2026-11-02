import {
  HL, HW, TICK, SIM_DT, TIME_SCALE, REACH, REACH_Z_MIN, REACH_Z_MAX, PADDLE_SPEED, PADDLE_FOLLOW,
  clamp, other, dirOf, makeBall, stepBall, extrapolate, clampToZone,
  humanIntent, applyShot, solveServe, serveAim, isGameWon, currentServer, gauss,
} from './physics.js';
import { hostRoom, joinRoom, normalizeCode, errorText } from './net.js';
import { sfx } from './audio.js';
import { Renderer, toWorld, VIEW_W, VIEW_H } from './render.js';

// ============================================================
//  Utilidades de interfaz
// ============================================================
const $ = (id) => document.getElementById(id);
const screens = ['menu', 'lobby', 'game'];
const show = (id) => screens.forEach((s) => $(s).classList.toggle('active', s === id));

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function overlay({ title, text = '', primary, onPrimary, secondary = 'Menú', onSecondary = backToMenu }) {
  $('ov-title').textContent = title;
  $('ov-text').textContent = text;
  const p = $('ov-primary');
  p.hidden = !primary;
  p.textContent = primary || '';
  p.disabled = false;
  p.classList.remove('pulse');
  p.onclick = onPrimary;
  $('ov-secondary').textContent = secondary;
  $('ov-secondary').onclick = onSecondary;
  $('overlay').hidden = false;
  (primary ? p : $('ov-secondary')).focus();
}
const hideOverlay = () => { $('overlay').hidden = true; };
const playerName = () => ($('name').value.trim() || 'Jugador').slice(0, 14);
const bestOfLabel = (n) => (n === 1 ? 'a 1 juego' : `al mejor de ${n} juegos`);

// ============================================================
//  Entrada
// ============================================================
const keys = new Set();
const mouse = { left: false, right: false };
let touchActive = false;
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Enter'];

const KEYMAPS = {
  // Un jugador (online / CPU): WASD o flechas; espacio/clic = golpe fuerte y saque; C/clic derecho = cortado.
  single: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], power: ['Space', 'ShiftLeft', 'ShiftRight'], chop: ['KeyC', 'ControlLeft'], mouse: true },
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], power: ['Space'], chop: ['KeyQ'], mouse: true },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], power: ['Enter', 'Numpad0'], chop: ['ShiftRight', 'Period'], mouse: false },
};
const anyKey = (list) => list.some((k) => keys.has(k));

/** Pala controlada por una persona (teclado, ratón o dedo). Coordenadas en metros. */
class PaddleControl {
  constructor(side, map) {
    this.side = side; this.map = map;
    this.reset();
  }
  reset() {
    this.x = -dirOf(this.side) * (HL + 0.45);
    this.y = 0; this.px = this.x; this.py = 0; this.vx = 0; this.vy = 0;
    this.pointer = null;
  }
  get powerHeld() { return anyKey(this.map.power) || (this.map.mouse && (mouse.left || touchActive)); }
  get mods() { return { power: anyKey(this.map.power) || (this.map.mouse && mouse.left), chop: anyKey(this.map.chop) || (this.map.mouse && mouse.right) }; }
  update(dt, serving) {
    this.px = this.x; this.py = this.y;
    const lat = (anyKey(this.map.down) ? 1 : 0) - (anyKey(this.map.up) ? 1 : 0);
    const fwd = (anyKey(this.map.right) ? 1 : 0) - (anyKey(this.map.left) ? 1 : 0); // derecha en pantalla = +x
    if (lat || fwd) {
      this.pointer = null;
      const n = Math.hypot(lat, fwd);
      this.x += (fwd / n) * PADDLE_SPEED * dt;
      this.y += (lat / n) * PADDLE_SPEED * dt;
    } else if (this.pointer) {
      const dx = this.pointer.x - this.x, dy = this.pointer.y - this.y;
      const dist = Math.hypot(dx, dy);
      const step = PADDLE_FOLLOW * dt;
      if (dist > step) { this.x += (dx / dist) * step; this.y += (dy / dist) * step; }
      else { this.x = this.pointer.x; this.y = this.pointer.y; }
    }
    clampToZone(this, this.side, serving);
    this.vx = (this.x - this.px) / dt;
    this.vy = (this.y - this.py) / dt;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys.add(e.code);
  if (mode && GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.code === 'KeyM') toggleMute();
  if ((e.code === 'KeyP' || e.code === 'Escape') && mode?.togglePause) mode.togglePause();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouse.left = mouse.right = false; touchActive = false; });

const canvas = $('canvas');
function toLogical(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return toWorld(((clientX - r.left) / r.width) * VIEW_W, ((clientY - r.top) / r.height) * VIEW_H);
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || !mode) return;
  mode.pointer?.(toLogical(e.clientX, e.clientY));
});
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) mouse.left = true; if (e.button === 2) mouse.right = true; sfx.unlock(); });
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function onTouch(e) {
  if (!mode) return;
  e.preventDefault();
  touchActive = e.touches.length > 0;
  for (const t of e.touches) mode.pointer?.(toLogical(t.clientX, t.clientY), true);
}
canvas.addEventListener('touchstart', onTouch, { passive: false });
canvas.addEventListener('touchmove', onTouch, { passive: false });
canvas.addEventListener('touchend', (e) => { touchActive = e.touches.length > 0; }, { passive: false });

/** Gestiona la carga del saque (mantener pulsado, soltar para sacar). */
class ServeCharger {
  constructor() { this.charge = null; }
  update(dtReal, held, canServe, onRelease) {
    if (!canServe) { this.charge = null; return; }
    if (held) {
      if (this.charge == null) this.charge = 0;
      this.charge = Math.min(1, this.charge + dtReal / 0.9);
    } else if (this.charge != null) {
      const p = this.charge;
      this.charge = null;
      onRelease(p);
    }
  }
}

// ============================================================
//  Partida autoritativa con el reglamento (host online y modos locales)
// ============================================================
const CALLS = {
  serveOwn: 'Saque nulo: debe botar en tu campo',
  serveFail: 'Saque nulo',
  ownSide: 'Bote en su propio campo',
  net: '¡Red!',
  out: '¡Fuera!',
  double: 'Doble bote',
  noReturn: 'No la devuelve',
  volley: 'Volea: hay que dejarla botar',
  let: 'Let: se repite el saque',
};

class Match {
  constructor(hooks, { remoteRight = false, bestOf = 1 } = {}) {
    this.hooks = hooks;
    this.remoteRight = remoteRight;
    this.bestOf = bestOf;
    this.matchFirst = Math.random() < 0.5 ? 'L' : 'R';
    this.pads = { L: padState('L'), R: padState('R') };
    this.localSides = remoteRight ? ['L'] : ['L', 'R'];
    this.intentFor = null; // (side, ball, pad) => intent
    this.rtt = 0.1;
    this.newMatch();
  }

  newMatch() {
    this.games = { L: 0, R: 0 };
    this.gameNo = 0;
    this.winner = null;
    this.startGame();
  }

  startGame() {
    this.score = { L: 0, R: 0 };
    // Quien sacó primero en un juego recibe primero en el siguiente (ITTF 2.13.2).
    this.gameFirst = this.gameNo % 2 === 0 ? this.matchFirst : other(this.matchFirst);
    this.ball = makeBall();
    this.hits = 0;
    this.toServe();
  }

  toServe() {
    this.phase = 'serve';
    this.timer = 0;
    this.rally = { hitter: null, serve: false, bounces: [], netTouch: false, netHit: false };
    this.pendingEnd = null;
    this.call = '';
    this.lastScorer = null;
  }

  get server() { return currentServer(this.score.L, this.score.R, this.gameFirst); }

  requestServe(side, power) {
    if (this.phase !== 'serve' || side !== this.server) return;
    this.phase = 'toss';
    this.tossPower = clamp(+power || 0.5, 0, 1);
    this.ball.vz = 1.9; // lanzamiento vertical de más de 16 cm (ITTF 2.6.2)
    this.hooks.toss?.();
  }

  tick(dt) {
    this.timer += dt;
    const b = this.ball;
    const srv = this.server;
    const sp = this.pads[srv];

    if (this.phase === 'serve') {
      Object.assign(b, { x: sp.x + dirOf(srv) * 0.13, y: sp.y + 0.06, z: 0.12, vx: 0, vy: 0, vz: 0, top: 0, side: 0 });
      if (this.timer > 9) this.requestServe(srv, 0.4); // evita que la partida se quede parada
      return;
    }

    if (this.phase === 'toss') {
      b.vz -= 9.81 * dt; b.z += b.vz * dt;
      if (b.vz < 0 && b.z <= 0.16) this.strikeServe();
      return;
    }

    if (this.phase === 'point' || this.phase === 'gamebreak') {
      if (this.phase === 'point') {
        const ev = [];
        stepBall(b, dt, ev); // la pelota sigue cayendo de forma natural
      }
      if (this.timer >= (this.phase === 'point' ? 0.85 : 1.6)) this.afterPoint();
      return;
    }

    if (this.phase !== 'playing') return;

    const prev = { x: b.x, y: b.y, z: b.z };
    const ev = [];
    stepBall(b, dt, ev);
    for (const e of ev) { this.rule(e); if (this.phase !== 'playing') return; }

    if (this.pendingEnd && this.timer - this.pendingEnd.at > Math.min(0.25, 0.06 + this.rtt * 0.6)) {
      const p = this.pendingEnd;
      this.pendingEnd = null;
      return this.pointTo(p.winner, p.call);
    }
    for (const s of this.localSides) this.tryHit(s, prev);
  }

  strikeServe() {
    const srv = this.server, b = this.ball, pad = this.pads[srv];
    let sol = solveServe(b, srv, this.tossPower, serveAim(pad.y));
    if (!sol) sol = solveServe(b, srv, 0.4, 0);
    if (sol) { b.vx = sol.vx; b.vy = sol.vy; b.vz = sol.vz; }
    b.top = -0.15; b.side = clamp(pad.vy / 6, -0.3, 0.3);
    this.phase = 'playing';
    this.timer = 0;
    this.registerHit(srv, { serve: true });
    this.rally.serve = true;
  }

  registerHit(side, it = {}) {
    this.rally = { hitter: side, serve: false, bounces: [], netTouch: false, netHit: false };
    this.hits++;
    this.pendingEnd = null;
    this.hooks.paddle?.(side, this.ball, it);
  }

  /** Aplica las reglas a cada evento físico. */
  rule(e) {
    if (this.pendingEnd) return;
    const r = this.rally;
    const A = r.hitter, B = other(A);
    if (e.type === 'net') {
      if (e.cord && r.serve) r.netTouch = true;
      if (!e.cord) r.netHit = true;
      this.hooks.net?.(e.cord);
      return;
    }
    if (e.type === 'table') {
      this.hooks.bounce?.(e.side, this.ball);
      r.bounces.push(e.side);
      const n = r.bounces.length;
      if (r.serve) {
        if (n === 1 && e.side !== A) return this.end(B, CALLS.serveOwn);
        if (n === 2) {
          if (e.side !== B) return this.end(B, r.netHit ? CALLS.net : CALLS.serveFail);
          if (r.netTouch) return this.letServe();
          r.serve = false;
          r.bounces = [B];
        }
        return;
      }
      if (n === 1 && e.side !== B) return this.end(B, r.netHit ? CALLS.net : CALLS.ownSide);
      if (n >= 2) return this.end(A, CALLS.double);
      return;
    }
    if (e.type === 'floor') {
      if (!r.serve && r.bounces[0] === B) return this.end(A, CALLS.noReturn);
      return this.end(B, r.netHit ? CALLS.net : CALLS.out);
    }
  }

  end(winner, call) {
    // En online, si el punto es para el anfitrión porque el invitado "no llegó",
    // esperamos un instante por si su golpe viene de camino por la red.
    if (this.remoteRight && winner === 'L' && this.rally.hitter === 'L' && !this.rally.serve && this.rally.bounces[0] === 'R') {
      this.pendingEnd = { winner, call, at: this.timer };
      return;
    }
    this.pointTo(winner, call);
  }

  tryHit(P, prev) {
    const r = this.rally, b = this.ball, pad = this.pads[P];
    if (r.hitter === P) return;
    const d = dirOf(P);
    if (b.vx * d >= 0) return; // no viene hacia él
    const prevRel = (prev.x - pad.px) * d, rel = (b.x - pad.x) * d;
    if (!(prevRel > 0 && rel <= 0)) return;
    if (Math.abs(b.y - pad.y) > REACH || b.z < REACH_Z_MIN || b.z > REACH_Z_MAX) return;
    const bounced = !r.serve && r.bounces[0] === P;
    if (!bounced) {
      if (Math.abs(b.x) > HL) return; // ya ha pasado la mesa sin botar: la deja ir (será fuera)
      return this.pointTo(other(P), CALLS.volley);
    }
    const it = this.intentFor(P, b, pad);
    applyShot(b, it, P);
    this.registerHit(P, it);
  }

  /** Golpe del invitado (online). */
  applyRemoteHit(m) {
    if (this.phase !== 'playing' || m.h !== this.hits + 1 || this.rally.hitter === 'R') return;
    const [x, y, z, vx, vy, vz, top, side] = m.b;
    if (![x, y, z, vx, vy, vz].every(Number.isFinite) || vx >= 0 || Math.hypot(vx, vy, vz) > 40) return;
    Object.assign(this.ball, extrapolate({ x, y, z, vx, vy, vz, top: clamp(top, -1, 1), side: clamp(side, -1, 1) }, clamp(this.rtt / 2, 0, 0.2)));
    this.registerHit('R', { smash: m.sm, chop: m.ch });
  }
  applyRemoteVolley(m) {
    if (this.phase === 'playing' && m.h === this.hits + 1 && this.rally.hitter === 'L') this.pointTo('L', CALLS.volley);
  }

  pointTo(side, call) {
    this.score[side]++;
    this.lastScorer = side;
    this.call = call;
    this.phase = 'point';
    this.timer = 0;
    this.pendingEnd = null;
    this.hooks.score?.(side, call);
  }

  letServe() {
    this.lastScorer = null;
    this.call = CALLS.let;
    this.phase = 'point';
    this.timer = 0;
    this.hooks.let?.();
  }

  afterPoint() {
    const { L, R } = this.score;
    if (this.phase === 'point' && isGameWon(L, R)) {
      const w = L > R ? 'L' : 'R';
      this.games[w]++;
      const need = Math.ceil(this.bestOf / 2);
      if (this.games[w] >= need) {
        this.phase = 'over';
        this.winner = w;
        this.hooks.over?.(w);
        return;
      }
      this.phase = 'gamebreak';
      this.timer = 0;
      this.call = 'game';
      this.lastScorer = w;
      this.hooks.game?.(w);
      return;
    }
    if (this.phase === 'gamebreak') { this.gameNo++; this.startGame(); return; }
    this.toServe();
  }

  rematch() {
    this.matchFirst = other(this.matchFirst);
    this.newMatch();
  }

  snapshot(seq) {
    const b = this.ball;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      t: 's', q: seq, ph: this.phase, tm: r3(this.timer),
      b: [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.top, b.side].map(r3),
      l: [r3(this.pads.L.x), r3(this.pads.L.y)],
      sc: [this.score.L, this.score.R], g: [this.games.L, this.games.R], bo: this.bestOf,
      h: this.hits, lh: this.rally.hitter, sv: this.server, w: this.winner, c: this.call, ls: this.lastScorer,
    };
  }
}

function padState(side) {
  const x = -dirOf(side) * (HL + 0.45);
  return { x, y: 0, px: x, py: 0, vx: 0, vy: 0 };
}

// ============================================================
//  Vista del invitado: predicción local + corrección con el host
// ============================================================
class GuestView {
  constructor(hooks, send) {
    this.hooks = hooks;
    this.send = send;
    this.ball = makeBall();
    this.hostPad = padState('L');
    this.hostTarget = { x: this.hostPad.x, y: 0 };
    this.score = { L: 0, R: 0 };
    this.games = { L: 0, R: 0 };
    this.bestOf = 1;
    this.phase = 'waiting';
    this.timer = 0;
    this.server = 'L';
    this.winner = null;
    this.call = '';
    this.lastScorer = null;
    this.hits = 0;
    this.expected = 0;
    this.hostHitter = null;
    this.bouncedR = false;
    this.lastSeq = -1;
    this.offset = { x: 0, y: 0, z: 0 };
    this.rtt = 0.1;
  }

  get hitter() { return this.expected > this.hits ? 'R' : this.hostHitter; }

  onSnapshot(s) {
    if (s.q <= this.lastSeq) return; // canal no ordenado: descartar antiguos
    this.lastSeq = s.q;
    const prevPhase = this.phase, prevScore = this.score, prevGames = this.games;
    this.hostTarget = { x: s.l[0], y: s.l[1] };
    this.score = { L: s.sc[0], R: s.sc[1] };
    this.games = { L: s.g[0], R: s.g[1] };
    this.bestOf = s.bo;
    this.phase = s.ph; this.timer = s.tm; this.server = s.sv; this.winner = s.w;
    this.call = s.c; this.lastScorer = s.ls;

    if (this.score.L > prevScore.L) this.hooks.score?.('L', s.c);
    else if (this.score.R > prevScore.R) this.hooks.score?.('R', s.c);
    if (this.phase === 'point' && prevPhase !== 'point' && !s.ls) this.hooks.let?.();
    if (this.phase === 'gamebreak' && prevPhase !== 'gamebreak' && (this.games.L !== prevGames.L || this.games.R !== prevGames.R)) this.hooks.game?.(s.ls);
    if (this.phase === 'toss' && prevPhase === 'serve') this.hooks.toss?.();
    if (this.phase === 'over' && prevPhase !== 'over') this.hooks.over?.(this.winner);
    if (prevPhase === 'over' && this.phase !== 'over') this.hooks.restart?.();

    const sb = { x: s.b[0], y: s.b[1], z: s.b[2], vx: s.b[3], vy: s.b[4], vz: s.b[5], top: s.b[6], side: s.b[7] };
    if (this.phase !== 'playing') {
      if (this.phase !== 'point' || prevPhase !== 'playing') this.ball = sb;
      this.hits = this.expected = s.h;
      this.hostHitter = s.lh;
      this.bouncedR = false;
      this.offset.x = this.offset.y = this.offset.z = 0;
      return;
    }
    if (s.h < this.expected) return; // el host aún no ha procesado nuestro golpe
    if (s.h > this.expected) {
      // Nuevo golpe del anfitrión (o saque): empieza una jugada nueva para nosotros.
      this.bouncedR = false;
      this.volleySent = false;
      if (s.lh === 'L') this.hooks.paddle?.('L', sb, {});
    }
    this.hits = this.expected = s.h;
    this.hostHitter = s.lh;

    const t = extrapolate(sb, clamp(this.rtt / 2, 0, 0.2));
    const b = this.ball;
    const dx = t.x - b.x, dy = t.y - b.y, dz = t.z - b.z;
    if (Math.sign(t.vx) !== Math.sign(b.vx) || dx * dx + dy * dy + dz * dz > 0.12 * 0.12) {
      this.offset.x += b.x - t.x; this.offset.y += b.y - t.y; this.offset.z += b.z - t.z;
      Object.assign(b, t);
    } else {
      b.x += dx * 0.25; b.y += dy * 0.25; b.z += dz * 0.25;
      b.vx = t.vx; b.vy = t.vy; b.vz = t.vz; b.top = t.top; b.side = t.side;
    }
  }

  tick(dt, pad, mods) {
    const k = Math.min(1, dt * 40);
    this.hostPad.px = this.hostPad.x; this.hostPad.py = this.hostPad.y;
    this.hostPad.x += (this.hostTarget.x - this.hostPad.x) * k;
    this.hostPad.y += (this.hostTarget.y - this.hostPad.y) * k;
    const dk = Math.exp(-dt * 18);
    this.offset.x *= dk; this.offset.y *= dk; this.offset.z *= dk;

    const b = this.ball;
    if (this.phase === 'serve' && this.server === 'R') {
      Object.assign(b, { x: pad.x - 0.13, y: pad.y + 0.06, z: 0.12, vx: 0, vy: 0, vz: 0 });
      return;
    }
    if (this.phase === 'point') { stepBall(b, dt); return; }
    if (this.phase !== 'playing') return;

    const prev = { x: b.x, y: b.y, z: b.z };
    const ev = [];
    stepBall(b, dt, ev);
    for (const e of ev) {
      if (e.type === 'table') { this.hooks.bounce?.(e.side, b); if (e.side === 'R' && this.hitter === 'L') this.bouncedR = true; }
      if (e.type === 'net') this.hooks.net?.(e.cord);
    }

    // Nuestra pala: decidimos nosotros y lo comunicamos al anfitrión.
    if (this.hitter === 'R' || b.vx <= 0) return;
    const prevRel = -(prev.x - pad.px), rel = -(b.x - pad.x);
    if (!(prevRel > 0 && rel <= 0)) return;
    if (Math.abs(b.y - pad.y) > REACH || b.z < REACH_Z_MIN || b.z > REACH_Z_MAX) return;
    if (!this.bouncedR) {
      if (Math.abs(b.x) > HL || this.volleySent) return;
      this.volleySent = true;
      this.send({ t: 'volley', h: this.expected + 1 });
      return;
    }
    const it = humanIntent(b, pad, 'R', mods);
    applyShot(b, it, 'R');
    this.expected++;
    this.send({ t: 'hit', h: this.expected, b: [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.top, b.side], sm: it.smash ? 1 : 0, ch: it.chop ? 1 : 0 });
    this.hooks.paddle?.('R', b, it);
  }

  get renderBall() { const b = this.ball; return { x: b.x + this.offset.x, y: b.y + this.offset.y, z: b.z + this.offset.z }; }
}

// ============================================================
//  CPU: predice la trayectoria (con botes y efecto) y elige golpe
// ============================================================
const CPU_LEVELS = {
  easy: { speed: 2.6, err: 0.11, react: 0.22, power: [0.1, 0.45], noise: 0.07, smash: 0.25, aim: 0.45 },
  normal: { speed: 3.8, err: 0.06, react: 0.13, power: [0.25, 0.7], noise: 0.045, smash: 0.6, aim: 0.58 },
  hard: { speed: 5.2, err: 0.025, react: 0.06, power: [0.45, 0.95], noise: 0.028, smash: 0.95, aim: 0.66 },
};

class CpuBrain {
  constructor(level, side = 'R') {
    this.cfg = CPU_LEVELS[level] || CPU_LEVELS.normal;
    this.side = side;
    this.plan = null; this.lastHits = -1; this.wait = 0; this.serveDelay = 1.2; this.serveY = 0;
  }
  predict(ball, alreadyBounced = false) {
    const d = dirOf(this.side);
    const c = { ...ball };
    let bounced = alreadyBounced;
    for (let i = 0; i < 600; i++) {
      const ev = [];
      stepBall(c, SIM_DT, ev);
      for (const e of ev) {
        if (e.type === 'table' && e.side === this.side) bounced = true;
        if (e.type === 'floor') return null;
      }
      if (bounced) {
        const behind = -d * c.x > HL + 0.08;
        const late = c.vz < 0 && c.z < 0.1 && -d * c.x > HL - 0.35;
        if (behind || late) return { x: c.x, y: c.y };
      }
    }
    return null;
  }
  update(dt, m, pad) {
    const d = dirOf(this.side);
    pad.px = pad.x; pad.py = pad.y;
    let goal;
    if (m.phase === 'serve' && m.server === this.side) {
      goal = { x: -d * (HL + 0.25), y: this.serveY };
      this.serveDelay -= dt;
      if (this.serveDelay <= 0) {
        const [a, b] = this.cfg.power;
        m.requestServe(this.side, a * 0.6 + Math.random() * (b - a * 0.6));
      }
    } else {
      this.serveDelay = 0.9 + Math.random() * 0.8;
      this.serveY = (Math.random() * 2 - 1) * 0.45;
      const incoming = m.phase === 'playing' && m.rally.hitter === other(this.side) && m.ball.vx * d < 0;
      if (incoming) {
        if (m.hits !== this.lastHits) { this.lastHits = m.hits; this.wait = this.cfg.react; this.plan = null; this.err = gauss() * this.cfg.err; }
        this.wait -= dt;
        const bounced = !m.rally.serve && m.rally.bounces?.[0] === this.side;
        if (this.wait <= 0 && (!this.plan || Math.random() < 0.04)) this.plan = this.predict(m.ball, bounced) || { x: -d * (HL + 0.6), y: m.ball.y > 0 ? -0.4 : 0.4, dodge: true };
        goal = this.plan ? { x: this.plan.x - d * 0.02, y: this.plan.y + (this.plan.dodge ? 0 : this.err) } : { x: pad.x, y: pad.y };
      } else {
        goal = { x: -d * (HL + 0.5), y: m.ball.y * 0.3 };
      }
    }
    const dx = goal.x - pad.x, dy = goal.y - pad.y, dist = Math.hypot(dx, dy);
    const step = this.cfg.speed * dt;
    if (dist > step) { pad.x += (dx / dist) * step; pad.y += (dy / dist) * step; } else { pad.x = goal.x; pad.y = goal.y; }
    clampToZone(pad, this.side, m.phase === 'serve');
    pad.vx = (pad.x - pad.px) / dt; pad.vy = (pad.y - pad.py) / dt;
  }
  intent(b, pad, opp) {
    const c = this.cfg;
    const [pa, pb] = c.power;
    const smash = b.z > 0.3 && Math.random() < c.smash;
    const chop = !smash && b.z < 0.08 && Math.random() < 0.35;
    let power = smash ? 1 : pa + Math.random() * (pb - pa);
    if (chop) power = Math.min(power, 0.35);
    // Apunta lejos del rival
    const away = opp.y > 0 ? -1 : 1;
    const aimY = clamp(away * (0.15 + Math.random() * c.aim) + gauss() * 0.1, -0.7, 0.7);
    const top = chop ? -0.7 : smash ? 0.15 : 0.25 + power * 0.6;
    return {
      speed: chop ? 3.8 + power * 3 : 5.2 + power * 8 + (smash ? 4 : 0), top,
      side: gauss() * 0.15, aimY, depth: chop ? 0.6 + power * 0.4 : 0.8 + power * 0.33,
      noise: c.noise + power * 0.04, smash, chop,
    };
  }
}

// ============================================================
//  Efectos compartidos
// ============================================================
let renderer;
function fxHooks(extra = {}) {
  return {
    paddle: (side, b, it = {}) => {
      const sp = Math.min(1, Math.hypot(b.vx, b.vy) / 18);
      sfx.paddle(sp);
      renderer.burst(b.x, b.y, b.z, side === 'L' ? '#ff6b6b' : '#e9ecef', it.smash ? 22 : 9);
      if (it.smash) renderer.kick(6);
    },
    bounce: (side, b) => { sfx.bounce(); renderer.mark(b.x, b.y); },
    net: (cord) => sfx.net(cord),
    toss: () => sfx.toss(),
    let: () => sfx.let(),
    ...extra,
  };
}

function viewText(st, names) {
  const sc = `${st.score.L} – ${st.score.R}`;
  switch (st.phase) {
    case 'point':
      if (!st.lastScorer) return { banner: 'Let', sub: 'El saque tocó la red: se repite' };
      return { banner: st.call, sub: `Punto para ${names[st.lastScorer]} · ${sc}` };
    case 'gamebreak':
      return { banner: `Juego para ${names[st.lastScorer]}`, sub: `Juegos ${st.games.L} – ${st.games.R} · siguiente juego` };
    case 'waiting': return { banner: 'Conectando…' };
    default: return {};
  }
}

function setHud(names, st, info) {
  $('name-l').textContent = names.L;
  $('name-r').textContent = names.R;
  $('score-l').textContent = st.score.L;
  $('score-r').textContent = st.score.R;
  const showGames = st.bestOf > 1;
  $('games-l').textContent = showGames ? `Juegos ${st.games.L}` : '';
  $('games-r').textContent = showGames ? `Juegos ${st.games.R}` : '';
  if (info !== undefined) $('hud-info').textContent = info;
}

function serveHint(st, side, isTouch) {
  if (st.phase !== 'serve') return '';
  if (st.server === side) return isTouch ? 'Tu saque: mantén el dedo para cargar y suelta' : 'Tu saque: mantén ESPACIO o el clic para cargar la fuerza y suelta';
  return '';
}
const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;

// ============================================================
//  Modos de juego
// ============================================================
let mode = null;

class LocalMode {
  constructor(kind, level, bestOf) {
    this.kind = kind;
    this.paused = false;
    this.left = new PaddleControl('L', kind === 'cpu' ? KEYMAPS.single : KEYMAPS.p1);
    this.right = new PaddleControl('R', KEYMAPS.p2);
    this.cpu = kind === 'cpu' ? new CpuBrain(level, 'R') : null;
    this.chargeL = new ServeCharger();
    this.chargeR = new ServeCharger();
    this.names = kind === 'cpu'
      ? { L: playerName(), R: `CPU (${{ easy: 'fácil', normal: 'normal', hard: 'difícil' }[level]})` }
      : { L: 'Jugador 1', R: 'Jugador 2' };
    this.match = new Match(fxHooks({
      score: (side) => { sfx.score(kind !== 'cpu' || side === 'L'); },
      game: () => sfx.game(),
      over: (w) => this.onOver(w),
    }), { bestOf });
    this.match.intentFor = (side, b, pad) => {
      if (side === 'R' && this.cpu) return this.cpu.intent(b, pad, this.match.pads.L);
      return humanIntent(b, pad, side, (side === 'L' ? this.left : this.right).mods);
    };
    $('you-hint').textContent = kind === 'cpu'
      ? 'Pala roja. Mueve la pala hacia la red al golpear para dar potencia; hacia atrás o C para cortar.'
      : 'Izq.: WASD, Espacio (fuerte/saque), Q (cortado) · Der.: flechas, Intro (fuerte/saque), Mayús dcha. (cortado)';
  }
  pointer(p) {
    if (this.kind === 'cpu' || p.x < 0) this.left.pointer = p;
    else this.right.pointer = p;
  }
  togglePause() {
    if (this.match.phase === 'over') return;
    this.paused = !this.paused;
    if (this.paused) overlay({ title: 'Pausa', text: 'Pulsa P o Esc para continuar.', primary: 'Continuar', onPrimary: () => this.togglePause() });
    else hideOverlay();
  }
  tick(dtReal) {
    if (this.paused) return;
    const dt = dtReal * TIME_SCALE;
    const m = this.match;
    const serving = m.phase === 'serve';
    this.left.update(dt, serving && m.server === 'L');
    copyPad(this.left, m.pads.L);
    if (this.cpu) this.cpu.update(dt, m, m.pads.R);
    else { this.right.update(dt, serving && m.server === 'R'); copyPad(this.right, m.pads.R); }
    this.chargeL.update(dtReal, this.left.powerHeld, serving && m.server === 'L', (p) => m.requestServe('L', p));
    if (!this.cpu) this.chargeR.update(dtReal, this.right.powerHeld || touchActive, serving && m.server === 'R', (p) => m.requestServe('R', p));
    m.tick(dt);
  }
  view() {
    const m = this.match;
    setHud(this.names, m, this.kind === 'cpu' ? `vs CPU · ${bestOfLabel(m.bestOf)}` : `Local · ${bestOfLabel(m.bestOf)}`);
    const humanServer = m.phase === 'serve' && (m.server === 'L' || !this.cpu);
    const charger = m.server === 'L' ? this.chargeL : this.chargeR;
    return {
      ball: m.ball, pads: m.pads,
      serving: m.phase === 'serve' || m.phase === 'toss' ? m.server : null,
      ballVisible: m.phase !== 'gamebreak' && m.phase !== 'over',
      aim: humanServer ? solveServe(m.ball, m.server, charger.charge ?? 0.35, serveAim(m.pads[m.server].y)) : null,
      charge: humanServer ? charger.charge : null, chargePad: m.pads[m.server],
      hint: this.cpu ? serveHint(m, 'L', isTouchDevice()) : (m.phase === 'serve' ? `Saca ${this.names[m.server]}` : ''),
      ...viewText(m, this.names),
    };
  }
  onOver(w) {
    const youWin = this.kind === 'cpu' && w === 'L';
    (this.kind !== 'cpu' || youWin ? sfx.win : sfx.lose)();
    const g = this.match.games, s = this.match.score;
    const res = this.match.bestOf > 1 ? `Juegos ${g.L} – ${g.R} (último juego ${s.L} – ${s.R})` : `Resultado: ${s.L} – ${s.R}`;
    overlay({
      title: this.kind === 'cpu' ? (youWin ? '¡Has ganado el partido! 🏆' : 'Gana la CPU') : `¡Gana ${this.names[w]}! 🏆`,
      text: res,
      primary: 'Revancha',
      onPrimary: () => { hideOverlay(); this.match.rematch(); },
    });
  }
  destroy() {}
}

function copyPad(ctrl, pad) {
  pad.px = ctrl.px; pad.py = ctrl.py; pad.x = ctrl.x; pad.y = ctrl.y; pad.vx = ctrl.vx; pad.vy = ctrl.vy;
}

class OnlineMode {
  constructor(session, isHost, myName, bestOf) {
    this.s = session;
    this.isHost = isHost;
    this.side = isHost ? 'L' : 'R';
    this.names = isHost ? { L: myName, R: 'Rival' } : { L: 'Rival', R: myName };
    this.ctrl = new PaddleControl(this.side, KEYMAPS.single);
    this.charger = new ServeCharger();
    this.remote = { x: dirOf(this.side) * (HL + 0.45), y: 0 };
    this.remoteShown = { ...this.remote };
    this.seq = 0;
    this.sendAcc = 0;
    this.pingAcc = 0;
    this.rtt = 0.1;
    this.meReady = this.rivalReady = false;
    this.ended = false;

    const base = {
      score: (side) => sfx.score(side === this.side),
      game: () => sfx.game(),
      over: (w) => this.onOver(w),
    };
    if (isHost) {
      this.match = new Match(fxHooks(base), { remoteRight: true, bestOf });
      this.match.intentFor = (side, b, pad) => humanIntent(b, pad, side, this.ctrl.mods);
    } else {
      this.view_ = new GuestView(fxHooks({
        ...base,
        restart: () => { hideOverlay(); this.meReady = this.rivalReady = false; },
      }), (m) => this.s.send(m));
    }

    session.on('message', (m) => this.onMessage(m));
    session.on('disconnected', () => this.onDisconnect());
    session.on('error', () => {});
    session.send({ t: 'hello', name: myName, v: 2 });

    $('you-hint').textContent = (isHost ? 'Eres la pala roja (izquierda). ' : 'Eres la pala negra (derecha). ')
      + 'Mueve la pala hacia la red al golpear para dar potencia; hacia atrás o C para cortar.';
  }

  get state() { return this.isHost ? this.match : this.view_; }
  pointer(p) { this.ctrl.pointer = p; }

  onMessage(m) {
    switch (m.t) {
      case 'hello':
      case 'welcome':
        if (m.v !== 2) { toast('Tu rival usa otra versión del juego: recargad los dos la página.'); }
        this.names[this.isHost ? 'R' : 'L'] = String(m.name || 'Rival').slice(0, 14);
        if (m.t === 'hello') this.s.send({ t: 'welcome', name: this.names[this.side], v: 2 });
        toast(`${this.names[other(this.side)]} se ha unido`);
        break;
      case 'p':
        if (Number.isFinite(m.x) && Number.isFinite(m.y)) this.remote = { x: m.x, y: m.y };
        break;
      case 's': if (!this.isHost) this.view_.onSnapshot(m); break;
      case 'hit': if (this.isHost) this.match.applyRemoteHit(m); break;
      case 'volley': if (this.isHost) this.match.applyRemoteVolley(m); break;
      case 'serve': if (this.isHost) this.match.requestServe('R', m.p); break;
      case 'ping': this.s.send({ t: 'pong', ts: m.ts }); if (m.rtt) this.setRtt(m.rtt); break;
      case 'pong': this.setRtt((performance.now() - m.ts) / 1000, true); break;
      case 'rematch':
        this.rivalReady = true;
        if (!this.meReady) { toast('Tu rival quiere la revancha'); $('ov-primary').classList.add('pulse'); }
        this.tryRematch();
        break;
      case 'bye': this.onDisconnect(true); break;
    }
  }

  setRtt(v, measured = false) {
    if (!(v >= 0 && v < 5)) return;
    this.rtt = measured ? this.rtt * 0.7 + v * 0.3 : v;
    if (this.match) this.match.rtt = this.rtt;
    if (this.view_) this.view_.rtt = this.rtt;
  }

  tick(dtReal) {
    const dt = dtReal * TIME_SCALE;
    const st = this.state;
    const myServe = st.phase === 'serve' && st.server === this.side;
    this.ctrl.update(dt, myServe);
    const k = Math.min(1, dt * 40);
    this.remoteShown.x += (this.remote.x - this.remoteShown.x) * k;
    this.remoteShown.y += (this.remote.y - this.remoteShown.y) * k;

    this.charger.update(dtReal, this.ctrl.powerHeld, myServe, (p) => {
      if (this.isHost) this.match.requestServe('L', p);
      else this.s.send({ t: 'serve', p });
    });

    if (this.isHost) {
      const m = this.match;
      copyPad(this.ctrl, m.pads.L);
      const R = m.pads.R;
      R.px = R.x; R.py = R.y; R.x = this.remoteShown.x; R.y = this.remoteShown.y;
      m.tick(dt);
    } else {
      this.view_.tick(dt, this.ctrl, this.ctrl.mods);
    }

    this.sendAcc += dtReal;
    if (this.sendAcc >= 1 / 60) {
      this.sendAcc = 0;
      if (this.isHost) this.s.sendState(this.match.snapshot(++this.seq));
      else this.s.sendState({ t: 'p', x: Math.round(this.ctrl.x * 1000) / 1000, y: Math.round(this.ctrl.y * 1000) / 1000 });
    }
    this.pingAcc += dtReal;
    if (this.pingAcc >= 1) {
      this.pingAcc = 0;
      this.s.send({ t: 'ping', ts: performance.now(), rtt: this.isHost ? 0 : this.rtt });
    }
  }

  view() {
    const st = this.state;
    setHud(this.names, st, `Sala ${this.s.code} · ${Math.round(this.rtt * 1000)} ms · ${bestOfLabel(st.bestOf)}`);
    const myServe = st.phase === 'serve' && st.server === this.side;
    const pads = this.isHost
      ? this.match.pads
      : { L: this.view_.hostPad, R: { x: this.ctrl.x, y: this.ctrl.y } };
    const ball = this.isHost ? this.match.ball : this.view_.renderBall;
    return {
      ball, pads,
      serving: st.phase === 'serve' || st.phase === 'toss' ? st.server : null,
      ballVisible: st.phase !== 'gamebreak' && st.phase !== 'over' && st.phase !== 'waiting',
      aim: myServe ? solveServe(ball, this.side, this.charger.charge ?? 0.35, serveAim(this.ctrl.y)) : null,
      charge: myServe ? this.charger.charge : null, chargePad: this.ctrl,
      hint: myServe ? serveHint(st, this.side, isTouchDevice()) : (st.phase === 'serve' ? `Saca ${this.names[st.server]}` : ''),
      ...viewText(st, this.names),
    };
  }

  onOver(w) {
    const won = w === this.side;
    (won ? sfx.win : sfx.lose)();
    const st = this.state;
    this.meReady = false;
    const res = st.bestOf > 1 ? `Juegos ${st.games.L} – ${st.games.R} (último juego ${st.score.L} – ${st.score.R})` : `Resultado: ${st.score.L} – ${st.score.R}`;
    overlay({
      title: won ? '¡Has ganado el partido! 🏆' : `Gana ${this.names[w]}`,
      text: res,
      primary: 'Revancha',
      onPrimary: () => {
        this.meReady = true;
        this.s.send({ t: 'rematch' });
        $('ov-primary').disabled = true;
        $('ov-primary').textContent = this.rivalReady ? 'Empezando…' : 'Esperando al rival…';
        this.tryRematch();
      },
    });
  }

  tryRematch() {
    if (!(this.meReady && this.rivalReady)) return;
    if (this.isHost) {
      this.match.rematch();
      this.meReady = this.rivalReady = false;
      hideOverlay();
    }
  }

  onDisconnect(byRival = false) {
    if (this.ended) return;
    this.ended = true;
    overlay({
      title: 'Partida terminada',
      text: byRival ? 'Tu rival ha salido de la sala.' : 'Se ha perdido la conexión con tu rival.',
      primary: null,
      secondary: 'Volver al menú',
    });
  }

  destroy() {
    this.ended = true;
    try { this.s.send({ t: 'bye' }); } catch {}
    setTimeout(() => this.s.destroy(), 150);
  }
}

// ============================================================
//  Bucle principal: simulación a paso fijo (120 Hz) + render en rAF
// ============================================================
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode) {
    acc += dt;
    while (acc >= TICK) { mode.tick(TICK); acc -= TICK; }
    renderer.draw(mode.view(), dt);
  }
  requestAnimationFrame(frame);
}

function startMode(m) {
  mode = m;
  hideOverlay();
  show('game');
  renderer.resize();
  acc = 0;
  last = performance.now();
}

// ============================================================
//  Menú y salas
// ============================================================
let pendingSession = null;
const selectedBestOf = () => +$('best-of').value || 1;

function backToMenu() {
  hideOverlay();
  if (mode) { mode.destroy(); mode = null; }
  if (pendingSession) { pendingSession.destroy(); pendingSession = null; }
  setJoinBusy(false);
  show('menu');
  history.replaceState(null, '', location.pathname + devParams());
}

function devParams() {
  const sig = new URLSearchParams(location.search).get('signal');
  return sig ? `?signal=${sig}` : '';
}

function setJoinBusy(busy) {
  $('btn-join').disabled = busy;
  $('btn-host').disabled = busy;
  $('btn-join').textContent = busy ? 'Conectando…' : 'Unirse';
}

const shareUrl = (code) => `${location.origin}${location.pathname}?sala=${code}`;

function createRoom() {
  sfx.unlock();
  saveName();
  $('menu-error').textContent = '';
  $('lobby-error').textContent = '';
  $('lobby-title').textContent = 'Creando sala…';
  $('lobby-code').textContent = '·····';
  $('lobby-format').textContent = `Partido ${bestOfLabel(selectedBestOf())}`;
  show('lobby');
  const name = playerName();
  const bestOf = selectedBestOf();
  const s = hostRoom((code) => {
    $('lobby-title').textContent = 'Sala creada';
    $('lobby-code').textContent = code;
  });
  pendingSession = s;
  s.on('connected', () => {
    pendingSession = null;
    startMode(new OnlineMode(s, true, name, bestOf));
  });
  s.on('error', (err) => { $('lobby-error').textContent = errorText(err); });
}

function joinByCode(raw) {
  sfx.unlock();
  saveName();
  const code = normalizeCode(raw);
  if (code.length !== 5) { $('menu-error').textContent = 'El código de sala tiene 5 caracteres.'; return; }
  $('menu-error').textContent = '';
  setJoinBusy(true);
  const name = playerName();
  const s = joinRoom(code);
  pendingSession = s;
  s.on('connected', () => {
    pendingSession = null;
    setJoinBusy(false);
    startMode(new OnlineMode(s, false, name, 1));
  });
  s.on('error', (err) => {
    s.destroy();
    pendingSession = null;
    setJoinBusy(false);
    $('menu-error').textContent = errorText(err);
  });
}

function saveName() { try { localStorage.setItem('pp-name', $('name').value.trim()); } catch {} }

function toggleMute() {
  const m = sfx.toggle();
  $('btn-mute').textContent = m ? '🔇' : '🔊';
  toast(m ? 'Sonido desactivado' : 'Sonido activado');
}

async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch { prompt('Copia esto:', text); }
}

function init() {
  renderer = new Renderer(canvas);
  try {
    $('name').value = localStorage.getItem('pp-name') || '';
    const bo = localStorage.getItem('pp-bestof'); if (bo) $('best-of').value = bo;
  } catch {}
  $('best-of').addEventListener('change', () => { try { localStorage.setItem('pp-bestof', $('best-of').value); } catch {} });
  $('btn-mute').textContent = sfx.muted ? '🔇' : '🔊';

  $('btn-host').onclick = createRoom;
  $('btn-join').onclick = () => joinByCode($('join-code').value);
  $('join-code').addEventListener('input', (e) => { e.target.value = normalizeCode(e.target.value); });
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(e.target.value); });
  $('btn-cpu').onclick = () => { sfx.unlock(); saveName(); startMode(new LocalMode('cpu', $('cpu-level').value, selectedBestOf())); };
  $('btn-local').onclick = () => { sfx.unlock(); saveName(); startMode(new LocalMode('local', null, selectedBestOf())); };
  $('btn-lobby-cancel').onclick = backToMenu;
  $('btn-leave').onclick = backToMenu;
  $('btn-mute').onclick = toggleMute;
  $('btn-copy-code').onclick = () => copy($('lobby-code').textContent, 'Código copiado');
  $('btn-copy-link').onclick = async () => {
    const url = shareUrl($('lobby-code').textContent);
    if (navigator.share) {
      try { await navigator.share({ title: 'Ping Pong Online', text: '¿Echamos un partido de ping pong? Únete a mi sala:', url }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    copy(url, 'Enlace copiado');
  };

  const params = new URLSearchParams(location.search);
  const code = normalizeCode(params.get('sala'));
  if (code.length === 5) {
    $('join-code').value = code;
    $('btn-join').classList.add('primary', 'pulse');
    $('name').focus();
    toast(`Te han invitado a la sala ${code}. Escribe tu nombre y pulsa «Unirse».`);
  }

  if (typeof Peer === 'undefined') {
    $('btn-host').disabled = $('btn-join').disabled = true;
    $('menu-error').textContent = 'No se pudo cargar la librería de red. El modo online no está disponible.';
  }

  window.addEventListener('beforeunload', () => { if (mode?.s) mode.s.send({ t: 'bye' }); });
  requestAnimationFrame(frame);
}

init();

// Acceso de depuración desde la consola (y para pruebas automáticas).
window.__pingpong = { get mode() { return mode; } };
window.__pingpong.CpuBrain = CpuBrain;
