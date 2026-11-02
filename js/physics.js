// Simulación compartida por host, invitado y modos locales.
// Unidades: píxeles lógicos del campo (W x H) y segundos.

export const W = 1000;
export const H = 600;
export const PADDLE_W = 14;
export const PADDLE_H = 100;
export const PADDLE_MARGIN = 36;
export const BALL_R = 9;

export const LEFT_FACE = PADDLE_MARGIN + PADDLE_W;   // cara de golpeo pala izquierda
export const RIGHT_FACE = W - PADDLE_MARGIN - PADDLE_W; // cara de golpeo pala derecha

export const BALL_SPEED0 = 540;
export const BALL_SPEED_MAX = 1350;
export const SPEEDUP = 1.06;
export const MAX_ANGLE = (55 * Math.PI) / 180;
export const PADDLE_SPEED = 780;     // teclado
export const PADDLE_MAX_FOLLOW = 1600; // ratón / táctil
export const TICK = 1 / 120;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clampPaddle = (y) => clamp(y, 0, H - PADDLE_H);

export function makeBall() {
  return { x: W / 2, y: H / 2, vx: 0, vy: 0 };
}

/** Avanza la pelota dt segundos rebotando en las bandas. Devuelve true si tocó banda. */
export function moveBall(b, dt) {
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  let wall = false;
  if (b.y < BALL_R) { b.y = 2 * BALL_R - b.y; b.vy = Math.abs(b.vy); wall = true; }
  else if (b.y > H - BALL_R) { b.y = 2 * (H - BALL_R) - b.y; b.vy = -Math.abs(b.vy); wall = true; }
  return wall;
}

/**
 * Detecta si la pelota cruzó el plano de una pala en este paso.
 * Devuelve null si no cruzó; si cruzó, { hit, y } con la y de cruce.
 */
export function crossPaddle(prevX, prevY, b, side, paddleY) {
  let face, crossed;
  if (side === 'L') {
    face = LEFT_FACE;
    crossed = b.vx < 0 && prevX - BALL_R >= face && b.x - BALL_R < face;
  } else {
    face = RIGHT_FACE;
    crossed = b.vx > 0 && prevX + BALL_R <= face && b.x + BALL_R > face;
  }
  if (!crossed) return null;
  const edgePrev = side === 'L' ? prevX - BALL_R : prevX + BALL_R;
  const edgeNow = side === 'L' ? b.x - BALL_R : b.x + BALL_R;
  const t = (face - edgePrev) / (edgeNow - edgePrev || 1);
  const y = prevY + (b.y - prevY) * t;
  const hit = y >= paddleY - BALL_R && y <= paddleY + PADDLE_H + BALL_R;
  return { hit, y };
}

/** Rebota la pelota en una pala: el ángulo depende del punto de impacto (Pong clásico). */
export function bounceOffPaddle(b, side, paddleY, yHit, paddleVel = 0) {
  const offset = clamp((yHit - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2), -1, 1);
  const angle = offset * MAX_ANGLE;
  const speed = Math.min(Math.hypot(b.vx, b.vy) * SPEEDUP, BALL_SPEED_MAX);
  const dir = side === 'L' ? 1 : -1;
  b.vx = dir * speed * Math.cos(angle);
  // Un poco de "efecto" por el movimiento de la pala.
  b.vy = speed * Math.sin(angle) + clamp(paddleVel, -900, 900) * 0.12;
  b.x = side === 'L' ? LEFT_FACE + BALL_R : RIGHT_FACE - BALL_R;
  b.y = clamp(yHit, BALL_R, H - BALL_R);
}

/** Lanza la pelota para el saque. */
export function serveBall(b, server, paddleY) {
  const dir = server === 'L' ? 1 : -1;
  const angle = (Math.random() * 2 - 1) * (25 * Math.PI) / 180;
  b.x = server === 'L' ? LEFT_FACE + BALL_R + 24 : RIGHT_FACE - BALL_R - 24;
  b.y = clamp(paddleY + PADDLE_H / 2, BALL_R, H - BALL_R);
  b.vx = dir * BALL_SPEED0 * Math.cos(angle);
  b.vy = BALL_SPEED0 * Math.sin(angle);
}

/** Coloca la pelota delante de la pala del que saca (durante la cuenta atrás). */
export function placeForServe(b, server, paddleY) {
  b.x = server === 'L' ? LEFT_FACE + BALL_R + 24 : RIGHT_FACE - BALL_R - 24;
  b.y = clamp(paddleY + PADDLE_H / 2, BALL_R, H - BALL_R);
  b.vx = 0; b.vy = 0;
}

/** Extrapola una pelota t segundos sin palas (para compensar latencia). */
export function extrapolate(b, t) {
  const c = { ...b };
  let left = Math.min(t, 0.5);
  while (left > 1e-6) {
    const dt = Math.min(TICK, left);
    moveBall(c, dt);
    left -= dt;
  }
  return c;
}

// ---------- Reglas de tenis de mesa ----------
export const POINTS_TO_WIN = 11;

export function isGameOver(l, r) {
  return (l >= POINTS_TO_WIN || r >= POINTS_TO_WIN) && Math.abs(l - r) >= 2;
}

/** Saque alterno cada 2 puntos; a partir de 10-10, cada punto. */
export function currentServer(l, r, firstServer) {
  const total = l + r;
  const other = firstServer === 'L' ? 'R' : 'L';
  const turns = l >= 10 && r >= 10 ? total : Math.floor(total / 2);
  return turns % 2 === 0 ? firstServer : other;
}
