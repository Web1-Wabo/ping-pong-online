// =====================================================================
//  Física de tenis de mesa en 3D (vista cenital) con medidas reglamentarias.
//  Ejes: x a lo largo de la mesa (red en x = 0, jugador L en x < 0),
//        y a lo ancho, z altura sobre la superficie de juego (metros).
//  Fuente de medidas: ITTF Laws 2.1–2.3 (mesa 2,74 x 1,525 m, altura 0,76 m,
//  red 15,25 cm que sobresale 15,25 cm por cada lado, pelota de 40 mm).
// =====================================================================

export const TABLE_L = 2.74;
export const TABLE_W = 1.525;
export const HL = TABLE_L / 2;     // 1.37
export const HW = TABLE_W / 2;     // 0.7625
export const TABLE_H = 0.76;       // altura de la mesa: el suelo está en z = -0.76
export const NET_H = 0.1525;
export const NET_OVER = 0.1525;
export const BALL_R = 0.02;

export const G = 9.81;
export const RESTITUTION = 0.89;   // bote real de una pelota de 40+ sobre la mesa
export const TOP_K = 5.5;          // aceleración extra hacia abajo por liftado (efecto Magnus)
export const SIDE_K = 2.4;         // curva lateral por efecto lateral

// El juego corre a cámara lenta respecto a la realidad para que sea jugable con ratón.
export const TIME_SCALE = 0.5;
export const TICK = 1 / 120;          // paso de simulación en tiempo real
export const SIM_DT = TICK * TIME_SCALE;

// Zonas de los jugadores (pueden meter el brazo un poco sobre la mesa).
export const ZONE_BACK = 2.3;
export const ZONE_FRONT = HL - 0.4;   // 0.97: hasta 40 cm sobre la mesa
export const ZONE_SIDE = 1.35;
export const REACH = 0.2;             // alcance lateral de la pala
export const REACH_Z_MIN = -0.62;     // puede golpear bolas bajas lejos de la mesa
export const REACH_Z_MAX = 1.1;

export const PADDLE_SPEED = 3.4;      // m/s (tiempo de simulación) con teclado
export const PADDLE_FOLLOW = 7.5;     // m/s máximo siguiendo al ratón/dedo

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const other = (s) => (s === 'L' ? 'R' : 'L');
export const dirOf = (s) => (s === 'L' ? 1 : -1); // hacia dónde golpea cada jugador

export function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function makeBall() {
  return { x: 0, y: 0, z: 0.3, vx: 0, vy: 0, vz: 0, top: 0, side: 0 };
}

export function clampToZone(p, side, serving = false) {
  const d = dirOf(side);
  // En el saque la pelota se golpea por detrás de la línea de fondo (ITTF 2.6.4).
  const front = serving ? HL + 0.08 : ZONE_FRONT;
  const ax = clamp(-d * p.x, front, ZONE_BACK); // distancia a la red hacia su lado
  p.x = -d * ax;
  p.y = clamp(p.y, -ZONE_SIDE, ZONE_SIDE);
}

export const onTable = (x, y) => Math.abs(x) <= HL && Math.abs(y) <= HW;

/**
 * Avanza la pelota dt segundos. Devuelve eventos físicos:
 *  {type:'table', side}, {type:'net', cord}, {type:'floor'}
 */
export function stepBall(b, dt, ev = null) {
  const px = b.x, pz = b.z;
  b.vz -= (G + b.top * TOP_K) * dt;
  b.vy += b.side * SIDE_K * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;

  // Red
  if ((px < 0) !== (b.x < 0) && Math.abs(b.y) <= HW + NET_OVER) {
    const t = (0 - px) / (b.x - px);
    const zc = pz + (b.z - pz) * t;
    if (zc > -0.02 && zc < NET_H - BALL_R * 0.4) {
      // Choca contra la red y cae en el campo del que golpeó.
      b.x = px < 0 ? -BALL_R * 1.5 : BALL_R * 1.5;
      b.vx = -b.vx * 0.12;
      b.vy *= 0.3;
      b.vz = Math.min(b.vz, 0) * 0.3;
      b.top = 0; b.side = 0;
      ev?.push({ type: 'net', cord: false });
    } else if (zc >= NET_H - BALL_R * 0.4 && zc < NET_H + BALL_R) {
      // Toca la cinta y pasa (o se queda corta).
      b.vx *= 0.45;
      b.vz = Math.abs(b.vz) * 0.25 + 0.45;
      b.z = Math.max(b.z, NET_H + BALL_R);
      ev?.push({ type: 'net', cord: true });
    }
  }

  // Mesa
  if (b.z <= BALL_R && b.vz < 0) {
    if (onTable(b.x, b.y)) {
      if (pz >= BALL_R - 0.005) {
        b.z = BALL_R;
        const backspin = b.top < 0;
        b.vz = -b.vz * RESTITUTION * (backspin ? 1 + 0.18 * b.top : 1);
        const k = backspin ? 1 + 0.33 * b.top : 1 + 0.08 * b.top; // el cortado frena, el liftado acelera
        b.vx *= k; b.vy *= k;
        b.vy += b.side * 0.35;
        b.top *= 0.55; b.side *= 0.75;
        ev?.push({ type: 'table', side: b.x < 0 ? 'L' : 'R' });
      } else {
        // Llega desde debajo del plano de la mesa: golpea el lateral, bola muerta.
        b.vx *= -0.2; b.vy *= 0.2; b.vz = -0.5;
        ev?.push({ type: 'floor' });
      }
    }
  }

  // Suelo
  if (b.z <= -TABLE_H + BALL_R && b.vz < 0) {
    b.z = -TABLE_H + BALL_R;
    b.vz = -b.vz * 0.6;
    b.vx *= 0.8; b.vy *= 0.8;
    b.top = 0; b.side = 0;
    ev?.push({ type: 'floor' });
  }
  if (Math.abs(b.x) > 5 || Math.abs(b.y) > 3.5) ev?.push({ type: 'floor' });
}

/** Simula sin eventos de reglas (para compensar latencia o predecir). */
export function extrapolate(b, t) {
  const c = { ...b };
  let left = Math.min(t, 0.4) * TIME_SCALE;
  while (left > 1e-6) {
    const dt = Math.min(SIM_DT, left);
    stepBall(c, dt);
    left -= dt;
  }
  return c;
}

// ---------------------------------------------------------------------
//  Golpes
// ---------------------------------------------------------------------

/**
 * Convierte el gesto del jugador en una intención de golpe.
 * - Mover la pala hacia la red al golpear = potencia y liftado.
 * - Moverla hacia atrás (o tecla de cortado) = golpe cortado (backspin), corto y lento.
 * - Bola alta + golpe fuerte = remate.
 * - Dónde toca la pala la pelota y el movimiento lateral deciden la dirección.
 */
export function humanIntent(b, pad, side, mods = {}) {
  const d = dirOf(side);
  const f = clamp((pad.vx * d) / 4, -1, 1);       // velocidad hacia la red
  const offset = clamp((b.y - pad.y) / REACH, -1, 1);
  const incoming = Math.hypot(b.vx, b.vy);
  const high = b.z > 0.28;

  let power = clamp(0.3 + 0.6 * Math.max(f, 0) + (mods.power ? 0.4 : 0), 0, 1);
  let top = clamp(0.3 + 0.7 * f, -0.2, 1);
  let chop = !!mods.chop || f < -0.3;
  const smash = high && !chop && (mods.power || f > 0.45);
  if (chop) { top = -0.75; power = Math.min(power, 0.35); }
  if (smash) { power = 1; top = 0.15; }

  const sideSpin = clamp(pad.vy / 4, -1, 1) * 0.7;
  const aimY = clamp(offset * 0.6 + b.y * 0.22 + pad.vy * 0.04, -0.95, 0.95);
  const depth = chop ? 0.55 + power * 0.45 : 0.82 + power * 0.33;
  const speed = chop ? 3.8 + power * 3 : 5.2 + power * 8 + (smash ? 4 : 0);
  let noise = 0.018 + power * 0.05;
  if (Math.abs(offset) > 0.8) noise += 0.08;             // golpe con el borde de la pala
  if (incoming > 11) noise += 0.03;                       // bola muy rápida
  if (b.z < -0.25) noise += 0.04;                         // bola muy baja
  return { speed, top, side: sideSpin, aimY, depth, noise, smash, chop };
}

/** Aplica un golpe: calcula una trayectoria que pase la red y bote en el objetivo, con error. */
export function applyShot(b, it, side) {
  const d = dirOf(side);
  const tx = d * clamp(it.depth + gauss() * it.noise * 1.1, 0.15, 2);
  const ty = it.aimY + gauss() * it.noise;
  const dx = tx - b.x, dy = ty - b.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist;
  const g = G + it.top * TOP_K;
  const dNet = Math.abs(ux) > 1e-3 ? (0 - b.x) / ux : dist / 2;
  const dEnd = Math.abs(ux) > 1e-3 ? (-d * HL - b.x) / ux : -1; // borde de su propia mesa
  const z0 = b.z;

  let s = Math.max(2.5, it.speed);
  let vz = 0, T = 1;
  for (let i = 0; i < 40; i++) {
    T = dist / s;
    vz = (BALL_R - z0 + 0.5 * g * T * T) / T;
    const hAt = (dd) => { const t = dd / s; return z0 + vz * t - 0.5 * g * t * t; };
    const clearNet = dNet <= 0 || hAt(dNet) > NET_H + BALL_R + 0.018;
    const clearEdge = dEnd <= 0 || hAt(dEnd) > BALL_R + 0.02;
    if (clearNet && clearEdge) break;
    s *= 0.93;
    if (s < 2.5) break;
  }
  b.vx = ux * s;
  b.vy = uy * s - 0.5 * it.side * SIDE_K * T;
  b.vz = vz + gauss() * it.noise * 2.4;
  b.top = it.top;
  b.side = it.side;
  // Saca la pelota de la pala para que no vuelva a detectarse el golpe.
  b.x += b.vx * 0.004;
}

// ---------------------------------------------------------------------
//  Saque: bota primero en el campo propio y después en el del rival (ITTF 2.6.3)
// ---------------------------------------------------------------------

/**
 * Busca (velocidad, primer bote) para que el saque caiga a `depth` metros de la red
 * en el campo rival, en la línea lateral `ty`. Solución analítica, sin efecto.
 */
export function solveServe(b, side, power, ty) {
  const d = dirOf(side);
  const depth = 0.3 + clamp(power, 0, 1) * 0.95;
  const tx = d * depth;
  const dx = tx - b.x, dy = ty - b.y;
  const dist = Math.hypot(dx, dy);
  const ux = dx / dist, uy = dy / dist;
  const dNet = (0 - b.x) / ux;
  const dTable = (-d * HL - b.x) / ux; // distancia hasta su línea de fondo
  let best = null;
  for (let s = 2.4; s <= 9; s += 0.15) {
    for (let db = Math.max(0.05, dTable + 0.08); db < dNet - 0.1; db += 0.04) {
      const t1 = db / s;
      const vz0 = (BALL_R - b.z + 0.5 * G * t1 * t1) / t1;
      const vImpact = vz0 - G * t1;
      if (vImpact >= 0) continue;
      const vz1 = -vImpact * RESTITUTION;
      const t2 = (2 * vz1) / G;
      const land = db + s * t2;
      const tn = (dNet - db) / s;
      if (tn > t2) continue;
      const hNet = BALL_R + vz1 * tn - 0.5 * G * tn * tn;
      if (hNet < NET_H + BALL_R + 0.02) continue;
      const err = Math.abs(land - dist) + Math.max(0, hNet - 0.32) * 0.5;
      if (!best || err < best.err) best = { err, s, vz0, t: t1 + t2, db };
    }
  }
  if (!best) return null;
  return {
    vx: ux * best.s, vy: uy * best.s, vz: best.vz0,
    target: { x: tx, y: ty },
    bounce1: { x: b.x + ux * best.db, y: b.y + uy * best.db },
  };
}

export function serveAim(padY) { return clamp(-padY * 0.8, -0.62, 0.62); }

// ---------------------------------------------------------------------
//  Reglas de puntuación (ITTF 2.11–2.13)
// ---------------------------------------------------------------------
export const POINTS_TO_WIN = 11;

export function isGameWon(a, b) {
  return (a >= POINTS_TO_WIN || b >= POINTS_TO_WIN) && Math.abs(a - b) >= 2;
}

/** Saque alterno cada 2 puntos; desde 10-10, cada punto (ITTF 2.13.3). */
export function currentServer(l, r, firstServer) {
  const total = l + r;
  const turns = l >= 10 && r >= 10 ? total : Math.floor(total / 2);
  return turns % 2 === 0 ? firstServer : other(firstServer);
}
