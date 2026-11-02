import {
  W, H, PADDLE_H, BALL_R, TICK, PADDLE_SPEED, PADDLE_MAX_FOLLOW, RIGHT_FACE, BALL_SPEED_MAX,
  clamp, clampPaddle, makeBall, moveBall, crossPaddle, bounceOffPaddle, serveBall,
  placeForServe, extrapolate, isGameOver, currentServer,
} from './physics.js';
import { hostRoom, joinRoom, normalizeCode, errorText } from './net.js';
import { sfx } from './audio.js';
import { Renderer } from './render.js';

// ============================================================
//  Utilidades de interfaz
// ============================================================
const $ = (id) => document.getElementById(id);
const screens = ['menu', 'lobby', 'game'];
function show(id) { screens.forEach((s) => $(s).classList.toggle('active', s === id)); }

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
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

// ============================================================
//  Entrada: teclado, ratón y táctil
// ============================================================
const keys = new Set();
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'Space'];

class PaddleControl {
  constructor(up, down) {
    this.up = up; this.down = down;
    this.y = (H - PADDLE_H) / 2;
    this.vel = 0;
    this.pointer = null; // y lógica objetivo (centro de la pala) o null
  }
  reset() { this.y = (H - PADDLE_H) / 2; this.vel = 0; this.pointer = null; }
  update(dt) {
    let dir = 0;
    if (this.up.some((k) => keys.has(k))) dir -= 1;
    if (this.down.some((k) => keys.has(k))) dir += 1;
    let ny = this.y;
    if (dir) {
      this.pointer = null;
      ny += dir * PADDLE_SPEED * dt;
    } else if (this.pointer != null) {
      const target = this.pointer - PADDLE_H / 2;
      const step = PADDLE_MAX_FOLLOW * dt;
      ny += clamp(target - ny, -step, step);
    }
    ny = clampPaddle(ny);
    this.vel = (ny - this.y) / dt;
    this.y = ny;
  }
}

const ALL_UP = ['KeyW', 'ArrowUp'];
const ALL_DOWN = ['KeyS', 'ArrowDown'];

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (mode && GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.code === 'KeyM') toggleMute();
  if ((e.code === 'KeyP' || e.code === 'Escape') && mode?.togglePause) mode.togglePause();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const canvas = $('canvas');
function toLogical(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || !mode) return;
  const p = toLogical(e.clientX, e.clientY);
  mode.pointer?.(p.x, p.y);
});
function onTouch(e) {
  if (!mode) return;
  e.preventDefault();
  for (const t of e.touches) {
    const p = toLogical(t.clientX, t.clientY);
    mode.pointer?.(p.x, p.y, true);
  }
}
canvas.addEventListener('touchstart', onTouch, { passive: false });
canvas.addEventListener('touchmove', onTouch, { passive: false });

// ============================================================
//  Partida autoritativa (host online y modos locales)
// ============================================================
class Match {
  constructor(hooks, { remoteRight = false } = {}) {
    this.hooks = hooks;
    this.remoteRight = remoteRight; // en online el invitado decide los golpes de su pala
    this.firstServer = Math.random() < 0.5 ? 'L' : 'R';
    this.ly = this.ry = (H - PADDLE_H) / 2;
    this.lvel = this.rvel = 0;
    this.rtt = 0.1;
    this.reset();
  }

  reset() {
    this.ball = makeBall();
    this.score = { L: 0, R: 0 };
    this.hits = 0;
    this.phase = 'countdown';
    this.timer = 3;
    this.winner = null;
    this.pending = null;
    this.time = 0;
    this.lastScorer = null;
  }

  rematch() {
    this.firstServer = this.firstServer === 'L' ? 'R' : 'L';
    this.reset();
  }

  get server() { return currentServer(this.score.L, this.score.R, this.firstServer); }

  tick(dt) {
    this.time += dt;
    const b = this.ball;

    if (this.phase === 'countdown') {
      const prev = Math.ceil(this.timer);
      this.timer -= dt;
      const sec = Math.ceil(this.timer);
      if (sec !== prev && sec > 0) this.hooks.tick?.(sec);
      const srv = this.server;
      placeForServe(b, srv, srv === 'L' ? this.ly : this.ry);
      if (this.timer <= 0) {
        serveBall(b, srv, srv === 'L' ? this.ly : this.ry);
        this.phase = 'playing';
        this.hooks.go?.();
      }
      return;
    }

    if (this.phase === 'point') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (isGameOver(this.score.L, this.score.R)) {
          this.phase = 'over';
          this.winner = this.score.L > this.score.R ? 'L' : 'R';
          this.hooks.over?.(this.winner);
        } else {
          this.phase = 'countdown';
          this.timer = 1.2;
        }
      }
      return;
    }

    if (this.phase !== 'playing') return;

    const px = b.x, py = b.y;
    if (moveBall(b, dt)) this.hooks.wall?.();

    const cl = crossPaddle(px, py, b, 'L', this.ly);
    if (cl?.hit) {
      bounceOffPaddle(b, 'L', this.ly, cl.y, this.lvel);
      this.hits++;
      this.hooks.paddle?.('L', b);
    }

    const cr = crossPaddle(px, py, b, 'R', this.ry);
    if (cr) {
      if (this.remoteRight) {
        // Esperamos el veredicto del invitado, pero guardamos el nuestro por si no llega.
        this.pending = { at: this.time, hostHit: cr.hit, y: cr.y, ry: this.ry, h: this.hits };
      } else if (cr.hit) {
        bounceOffPaddle(b, 'R', this.ry, cr.y, this.rvel);
        this.hits++;
        this.hooks.paddle?.('R', b);
      }
    }

    if (b.x < -BALL_R * 3) return this.pointTo('R');
    if (b.x > W + BALL_R * 3) {
      if (this.remoteRight && this.pending && this.pending.h === this.hits) {
        const wait = Math.min(0.45, 0.12 + this.rtt);
        if (this.time - this.pending.at < wait) { b.x = W + BALL_R * 3; return; } // en espera
        if (this.pending.hostHit) { // sin respuesta: usamos nuestra propia detección
          bounceOffPaddle(b, 'R', this.pending.ry, this.pending.y, 0);
          this.pending = null;
          this.hits++;
          this.hooks.paddle?.('R', b);
          return;
        }
      }
      return this.pointTo('L');
    }
  }

  pointTo(side) {
    this.score[side]++;
    this.lastScorer = side;
    this.phase = 'point';
    this.timer = 1.1;
    this.pending = null;
    this.hooks.score?.(side);
  }

  /** El invitado informa de que su pala golpeó la pelota. */
  applyRemoteHit(m) {
    const b = this.ball;
    if (this.phase !== 'playing' || m.h !== this.hits + 1) return;
    if (b.vx <= 0 && b.x < W / 2) return; // incoherente: la pelota no iba hacia él
    const nb = { x: m.b[0], y: m.b[1], vx: m.b[2], vy: m.b[3] };
    const sp = Math.hypot(nb.vx, nb.vy);
    if (!(sp > 0) || sp > BALL_SPEED_MAX * 1.2 || nb.vx >= 0) return; // validación básica
    Object.assign(b, extrapolate(nb, clamp(this.rtt / 2, 0, 0.25)));
    this.hits++;
    this.pending = null;
    this.hooks.paddle?.('R', b);
  }

  /** El invitado informa de que falló. */
  applyRemoteMiss(m) {
    if (this.phase !== 'playing' || m.h !== this.hits + 1) return;
    if (this.ball.vx > 0 && this.ball.x > W * 0.55) this.pointTo('L');
  }

  snapshot(seq) {
    const b = this.ball;
    const r = (v) => Math.round(v * 10) / 10;
    return {
      t: 's', q: seq, ph: this.phase, tm: r(this.timer),
      b: [r(b.x), r(b.y), r(b.vx), r(b.vy)], l: r(this.ly),
      sc: [this.score.L, this.score.R], h: this.hits, sv: this.server, w: this.winner,
    };
  }
}

// ============================================================
//  Vista del invitado: predicción local + corrección con el host
// ============================================================
class GuestView {
  constructor(hooks, send) {
    this.hooks = hooks;
    this.send = send;
    this.ball = makeBall();
    this.ly = this.lyTarget = (H - PADDLE_H) / 2;
    this.score = { L: 0, R: 0 };
    this.phase = 'waiting';
    this.timer = 0;
    this.server = 'L';
    this.winner = null;
    this.hits = 0;       // golpes confirmados por el host
    this.expected = 0;   // golpes incluyendo los predichos localmente
    this.sounded = 0;
    this.missFor = -1;
    this.lastSeq = -1;
    this.offset = { x: 0, y: 0 }; // suavizado visual de correcciones
    this.rtt = 0.1;
    this.sec = 0;
  }

  onSnapshot(s) {
    if (s.q <= this.lastSeq) return; // canal no ordenado: descartar antiguos
    this.lastSeq = s.q;
    const prevPhase = this.phase;
    const prevScore = this.score;
    this.lyTarget = s.l;
    this.score = { L: s.sc[0], R: s.sc[1] };
    this.phase = s.ph;
    this.timer = s.tm;
    this.server = s.sv;
    this.winner = s.w;

    if (this.score.L > prevScore.L) { this.lastScorer = 'L'; this.hooks.score?.('L'); }
    else if (this.score.R > prevScore.R) { this.lastScorer = 'R'; this.hooks.score?.('R'); }
    if (this.phase === 'countdown') {
      const sec = Math.ceil(this.timer);
      if (sec !== this.sec && sec > 0) this.hooks.tick?.(sec);
      this.sec = sec;
    } else this.sec = 0;
    if (prevPhase === 'countdown' && this.phase === 'playing') this.hooks.go?.();
    if (this.phase === 'over' && prevPhase !== 'over') this.hooks.over?.(this.winner);
    if (prevPhase === 'over' && this.phase !== 'over') this.hooks.restart?.();

    const sb = { x: s.b[0], y: s.b[1], vx: s.b[2], vy: s.b[3] };
    if (this.phase !== 'playing') {
      this.ball = sb;
      this.hits = this.expected = this.sounded = s.h;
      this.missFor = -1;
      this.offset.x = this.offset.y = 0;
      return;
    }
    if (s.h < this.expected) return; // el host aún no ha procesado nuestro golpe

    if (s.h > this.sounded) { this.sounded = s.h; this.hooks.paddle?.(sb.vx > 0 ? 'L' : 'R', sb); }
    this.hits = this.expected = s.h;

    const t = extrapolate(sb, clamp(this.rtt / 2, 0, 0.25));
    const b = this.ball;
    const dx = t.x - b.x, dy = t.y - b.y;
    if (Math.sign(t.vx) !== Math.sign(b.vx) || dx * dx + dy * dy > 70 * 70) {
      this.offset.x += b.x - t.x;
      this.offset.y += b.y - t.y;
      Object.assign(b, t);
    } else {
      b.x += dx * 0.2; b.y += dy * 0.2;
      b.vx = t.vx; b.vy = t.vy;
    }
  }

  tick(dt, ry, rvel) {
    this.ly += (this.lyTarget - this.ly) * Math.min(1, dt * 25);
    const k = Math.exp(-dt * 10);
    this.offset.x *= k; this.offset.y *= k;

    if (this.phase === 'countdown' && this.server === 'R') placeForServe(this.ball, 'R', ry);
    if (this.phase !== 'playing') return;

    const b = this.ball;
    const px = b.x, py = b.y;
    if (moveBall(b, dt)) this.hooks.wall?.();

    // Predicción del golpe del rival (el host confirmará o corregirá).
    const cl = crossPaddle(px, py, b, 'L', this.ly);
    if (cl?.hit) {
      bounceOffPaddle(b, 'L', this.ly, cl.y, 0);
      this.expected++;
      this.sounded = this.expected;
      this.hooks.paddle?.('L', b);
    }

    // Nuestra pala: aquí decidimos nosotros y se lo comunicamos al host.
    const cr = crossPaddle(px, py, b, 'R', ry);
    if (cr) {
      if (cr.hit) {
        bounceOffPaddle(b, 'R', ry, cr.y, rvel);
        this.expected++;
        this.sounded = this.expected;
        this.send({ t: 'hit', h: this.expected, b: [b.x, b.y, b.vx, b.vy] });
        this.hooks.paddle?.('R', b);
      } else if (this.missFor !== this.expected) {
        this.missFor = this.expected;
        this.send({ t: 'miss', h: this.expected + 1 });
      }
    }
    b.x = clamp(b.x, -BALL_R * 4, W + BALL_R * 4);
  }

  get renderBall() { return { x: this.ball.x + this.offset.x, y: this.ball.y + this.offset.y }; }
}

// ============================================================
//  CPU
// ============================================================
const CPU_LEVELS = {
  easy: { speed: 360, error: 70, reaction: 0.28 },
  normal: { speed: 560, error: 38, reaction: 0.16 },
  hard: { speed: 820, error: 14, reaction: 0.07 },
};
class CpuBrain {
  constructor(level) { this.cfg = CPU_LEVELS[level] || CPU_LEVELS.normal; this.err = 0; this.lastHits = -1; this.wait = 0; this.target = H / 2; }
  update(dt, match, ctrl) {
    const b = match.ball;
    if (match.hits !== this.lastHits) {
      this.lastHits = match.hits;
      this.err = (Math.random() * 2 - 1) * this.cfg.error;
      this.wait = this.cfg.reaction;
    }
    this.wait -= dt;
    if (this.wait <= 0) {
      if (match.phase === 'playing' && b.vx > 0) {
        // Predice dónde cruzará la pelota su línea, contando rebotes en bandas.
        const t = (RIGHT_FACE - b.x) / b.vx;
        this.target = extrapolate(b, Math.max(0, t)).y + this.err;
      } else if (match.phase === 'countdown' && match.server === 'R') {
        this.target = H / 2 + Math.sin(match.time * 2) * 60;
      } else {
        this.target = H / 2 + (b.y - H / 2) * 0.3;
      }
    }
    const goal = clampPaddle(this.target - PADDLE_H / 2);
    const step = this.cfg.speed * dt;
    const ny = clampPaddle(ctrl.y + clamp(goal - ctrl.y, -step, step));
    ctrl.vel = (ny - ctrl.y) / dt;
    ctrl.y = ny;
  }
}

// ============================================================
//  Efectos compartidos
// ============================================================
let renderer;
function fxHooks(extra = {}) {
  return {
    paddle: (side, b) => {
      const sp = Math.hypot(b.vx, b.vy) / BALL_SPEED_MAX;
      sfx.paddle(sp);
      renderer.burst(b.x, b.y, side === 'L' ? '#ff6b6b' : '#e9ecef', 10 + Math.round(sp * 10));
      if (sp > 0.75) renderer.kick(4);
    },
    wall: () => sfx.wall(),
    tick: () => sfx.tick(),
    go: () => sfx.go(),
    ...extra,
  };
}

function bannerFor(state, names) {
  if (state.phase === 'countdown') {
    return { banner: String(Math.ceil(state.timer)), sub: `Saca ${names[state.server]}` };
  }
  if (state.phase === 'point' && state.lastScorer) return { banner: `Punto para ${names[state.lastScorer]}`, sub: '' };
  if (state.phase === 'waiting') return { banner: 'Conectando…', sub: '' };
  return {};
}

function setHud(names, score, info) {
  $('name-l').textContent = names.L;
  $('name-r').textContent = names.R;
  $('score-l').textContent = score.L;
  $('score-r').textContent = score.R;
  if (info !== undefined) $('hud-info').textContent = info;
}

// ============================================================
//  Modos de juego
// ============================================================
let mode = null;

/** Modo local: contra CPU o 2 jugadores en el mismo dispositivo. */
class LocalMode {
  constructor(kind, level) {
    this.kind = kind;
    this.paused = false;
    this.left = new PaddleControl(kind === 'cpu' ? ALL_UP : ['KeyW'], kind === 'cpu' ? ALL_DOWN : ['KeyS']);
    this.right = new PaddleControl(['ArrowUp'], ['ArrowDown']);
    this.cpu = kind === 'cpu' ? new CpuBrain(level) : null;
    const me = playerName();
    this.names = kind === 'cpu'
      ? { L: me, R: `CPU (${{ easy: 'fácil', normal: 'normal', hard: 'difícil' }[level]})` }
      : { L: 'Jugador 1', R: 'Jugador 2' };
    this.match = new Match(fxHooks({
      score: (side) => { sfx.score(kind !== 'cpu' || side === 'L'); renderer.kick(8); },
      over: (w) => this.onOver(w),
    }));
    $('you-hint').textContent = kind === 'cpu'
      ? 'Tú eres la pala roja (izquierda). Ratón, dedo, W/S o flechas.'
      : 'Izquierda: W/S · Derecha: ↑/↓ · En táctil, cada uno en su mitad.';
    setHud(this.names, this.match.score, kind === 'cpu' ? 'vs CPU' : 'Local');
  }
  pointer(x, y, touch) {
    if (this.kind === 'cpu' || x < W / 2) this.left.pointer = y;
    else this.right.pointer = y;
  }
  togglePause() {
    if (this.match.phase === 'over') return;
    this.paused = !this.paused;
    if (this.paused) overlay({ title: 'Pausa', text: 'Pulsa P o Esc para continuar.', primary: 'Continuar', onPrimary: () => this.togglePause() });
    else hideOverlay();
  }
  tick(dt) {
    if (this.paused) return;
    this.left.update(dt);
    if (this.cpu) this.cpu.update(dt, this.match, this.right); else this.right.update(dt);
    const m = this.match;
    m.ly = this.left.y; m.lvel = this.left.vel;
    m.ry = this.right.y; m.rvel = this.right.vel;
    m.tick(dt);
  }
  view() {
    const m = this.match;
    setHud(this.names, m.score);
    return {
      ball: m.ball, ly: m.ly, ry: m.ry, serving: m.phase === 'countdown' ? m.server : null,
      ballVisible: m.phase === 'playing' || m.phase === 'countdown',
      ...bannerFor(m, this.names),
    };
  }
  onOver(w) {
    const youWin = this.kind === 'cpu' && w === 'L';
    if (this.kind === 'cpu') (youWin ? sfx.win : sfx.lose)(); else sfx.win();
    const s = this.match.score;
    overlay({
      title: this.kind === 'cpu' ? (youWin ? '¡Has ganado! 🏆' : 'Gana la CPU') : `¡Gana ${this.names[w]}! 🏆`,
      text: `Resultado final: ${s.L} – ${s.R}`,
      primary: 'Revancha',
      onPrimary: () => { hideOverlay(); this.match.rematch(); },
    });
  }
  destroy() {}
}

/** Modo online: el host simula, el invitado predice. */
class OnlineMode {
  constructor(session, isHost, myName) {
    this.s = session;
    this.isHost = isHost;
    this.side = isHost ? 'L' : 'R';
    this.names = isHost ? { L: myName, R: 'Rival' } : { L: 'Rival', R: myName };
    this.ctrl = new PaddleControl(ALL_UP, ALL_DOWN);
    this.remoteY = (H - PADDLE_H) / 2;
    this.remoteShown = this.remoteY;
    this.seq = 0;
    this.sendAcc = 0;
    this.pingAcc = 0;
    this.rtt = 0.1;
    this.meReady = false;
    this.rivalReady = false;
    this.ended = false;

    const scoreHook = (side) => { sfx.score(side === this.side); renderer.kick(8); };
    if (isHost) {
      this.match = new Match(fxHooks({ score: scoreHook, over: (w) => this.onOver(w) }), { remoteRight: true });
    } else {
      this.view_ = new GuestView(fxHooks({
        score: scoreHook,
        over: (w) => this.onOver(w),
        restart: () => { hideOverlay(); this.meReady = this.rivalReady = false; },
      }), (m) => this.s.send(m));
      this.ctrl.y = (H - PADDLE_H) / 2;
    }

    session.on('message', (m) => this.onMessage(m));
    session.on('disconnected', () => this.onDisconnect());
    session.on('error', () => {}); // errores tardíos de señalización: no afectan a la partida
    session.send({ t: 'hello', name: myName, v: 1 });

    $('you-hint').textContent = isHost
      ? 'Tú eres la pala roja (izquierda). Ratón, dedo, W/S o flechas.'
      : 'Tú eres la pala negra (derecha). Ratón, dedo, W/S o flechas.';
    setHud(this.names, { L: 0, R: 0 }, `Sala ${session.code}`);
  }

  pointer(x, y) { this.ctrl.pointer = y; }

  onMessage(m) {
    switch (m.t) {
      case 'hello':
      case 'welcome':
        this.names[this.isHost ? 'R' : 'L'] = (String(m.name || 'Rival')).slice(0, 14);
        if (m.t === 'hello') this.s.send({ t: 'welcome', name: this.names[this.side] });
        toast(`${this.names[this.isHost ? 'R' : 'L']} se ha unido`);
        break;
      case 'p': this.remoteY = clampPaddle(+m.y || 0); break;
      case 's': if (!this.isHost) this.view_.onSnapshot(m); break;
      case 'hit': if (this.isHost) this.match.applyRemoteHit(m); break;
      case 'miss': if (this.isHost) this.match.applyRemoteMiss(m); break;
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

  tick(dt) {
    this.ctrl.update(dt);
    // Suavizado de la pala remota (llega a ~60 Hz por red).
    this.remoteShown += (this.remoteY - this.remoteShown) * Math.min(1, dt * 30);

    if (this.isHost) {
      const m = this.match;
      m.ly = this.ctrl.y; m.lvel = this.ctrl.vel;
      m.ry = this.remoteShown;
      m.tick(dt);
    } else {
      this.view_.tick(dt, this.ctrl.y, this.ctrl.vel);
    }

    // Envío de red a 60 Hz
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / 60) {
      this.sendAcc = 0;
      if (this.isHost) this.s.sendState(this.match.snapshot(++this.seq));
      else this.s.sendState({ t: 'p', y: Math.round(this.ctrl.y * 10) / 10 });
    }
    this.pingAcc += dt;
    if (this.pingAcc >= 1) {
      this.pingAcc = 0;
      this.s.send({ t: 'ping', ts: performance.now(), rtt: this.isHost ? 0 : this.rtt });
    }
  }

  view() {
    const info = `Sala ${this.s.code} · ${Math.round(this.rtt * 1000)} ms`;
    if (this.isHost) {
      const m = this.match;
      setHud(this.names, m.score, info);
      return {
        ball: m.ball, ly: m.ly, ry: m.ry, serving: m.phase === 'countdown' ? m.server : null,
        ballVisible: m.phase === 'playing' || m.phase === 'countdown',
        ...bannerFor(m, this.names),
      };
    }
    const v = this.view_;
    setHud(this.names, v.score, info);
    return {
      ball: v.renderBall, ly: v.ly, ry: this.ctrl.y, serving: v.phase === 'countdown' ? v.server : null,
      ballVisible: v.phase === 'playing' || v.phase === 'countdown',
      ...bannerFor(v, this.names),
    };
  }

  onOver(w) {
    const won = w === this.side;
    (won ? sfx.win : sfx.lose)();
    const s = this.isHost ? this.match.score : this.view_.score;
    this.meReady = false;
    overlay({
      title: won ? '¡Has ganado! 🏆' : `Gana ${this.names[w]}`,
      text: `Resultado final: ${s.L} – ${s.R}`,
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
    // El invitado cierra el overlay al recibir la nueva instantánea (hook restart).
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
//  Bucle principal (paso fijo de 120 Hz + render en rAF)
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
//  Flujo de menú / salas
// ============================================================
let pendingSession = null;

function backToMenu() {
  hideOverlay();
  if (mode) { mode.destroy(); mode = null; }
  if (pendingSession) { pendingSession.destroy(); pendingSession = null; }
  setJoinBusy(false);
  show('menu');
  history.replaceState(null, '', location.pathname);
}

function setJoinBusy(busy) {
  $('btn-join').disabled = busy;
  $('btn-host').disabled = busy;
  $('btn-join').textContent = busy ? 'Conectando…' : 'Unirse';
}

function shareUrl(code) { return `${location.origin}${location.pathname}?sala=${code}`; }

function createRoom() {
  sfx.unlock();
  saveName();
  $('menu-error').textContent = '';
  $('lobby-error').textContent = '';
  $('lobby-title').textContent = 'Creando sala…';
  $('lobby-code').textContent = '·····';
  show('lobby');
  const name = playerName();
  const s = hostRoom((code) => {
    $('lobby-title').textContent = 'Sala creada';
    $('lobby-code').textContent = code;
    history.replaceState(null, '', `?sala=${code}&host=1`);
  });
  pendingSession = s;
  s.on('connected', () => {
    pendingSession = null;
    startMode(new OnlineMode(s, true, name));
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
    history.replaceState(null, '', `?sala=${code}`);
    startMode(new OnlineMode(s, false, name));
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

// ============================================================
//  Arranque
// ============================================================
function init() {
  renderer = new Renderer(canvas);
  try { $('name').value = localStorage.getItem('pp-name') || ''; } catch {}
  $('btn-mute').textContent = sfx.muted ? '🔇' : '🔊';

  $('btn-host').onclick = createRoom;
  $('btn-join').onclick = () => joinByCode($('join-code').value);
  $('join-code').addEventListener('input', (e) => { e.target.value = normalizeCode(e.target.value); });
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(e.target.value); });
  $('btn-cpu').onclick = () => { sfx.unlock(); saveName(); startMode(new LocalMode('cpu', $('cpu-level').value)); };
  $('btn-local').onclick = () => { sfx.unlock(); saveName(); startMode(new LocalMode('local')); };
  $('btn-lobby-cancel').onclick = backToMenu;
  $('btn-leave').onclick = backToMenu;
  $('btn-mute').onclick = toggleMute;
  $('btn-copy-code').onclick = () => copy($('lobby-code').textContent, 'Código copiado');
  $('btn-copy-link').onclick = async () => {
    const url = shareUrl($('lobby-code').textContent);
    if (navigator.share) {
      try { await navigator.share({ title: 'Ping Pong Online', text: '¿Echamos un ping pong? Únete a mi sala:', url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    copy(url, 'Enlace copiado');
  };

  // Enlace de invitación: ?sala=CODIGO
  const params = new URLSearchParams(location.search);
  const code = normalizeCode(params.get('sala'));
  if (code.length === 5 && !params.has('host')) {
    $('join-code').value = code;
    $('btn-join').textContent = 'Unirse';
    $('btn-join').classList.add('primary', 'pulse');
    $('menu-error').textContent = '';
    $('name').focus();
    toast(`Te han invitado a la sala ${code}. Escribe tu nombre y pulsa «Unirse».`);
  } else if (params.has('host')) {
    history.replaceState(null, '', location.pathname);
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
