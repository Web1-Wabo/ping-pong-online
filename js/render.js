import { HL, HW, TABLE_H, NET_H, NET_OVER, REACH, onTable, dirOf } from './physics.js';

export const VIEW_W = 1000;
export const VIEW_H = 600;
export const S = 188;          // píxeles por metro
export const CX = VIEW_W / 2;
export const CY = VIEW_H / 2 + 12;
const LIFT = 0.55;             // cuánto "sube" en pantalla un metro de altura

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const toScreen = (x, y, z = 0) => ({ x: CX + x * S, y: CY + y * S - z * S * LIFT });
export const toWorld = (sx, sy) => ({ x: (sx - CX) / S, y: (sy - CY) / S });

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.trail = [];
    this.particles = [];
    this.marks = [];
    this.shake = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.c.getBoundingClientRect();
    if (!rect.width) return;
    this.c.width = Math.round(rect.width * dpr);
    this.c.height = Math.round(rect.height * dpr);
    this.scale = this.c.width / VIEW_W;
  }

  mark(x, y, color = 'rgba(255,255,255,0.9)') { this.marks.push({ x, y, life: 1.1, color }); }
  burst(x, y, z, color, n = 12) {
    if (reduceMotion) n = 4;
    const p = toScreen(x, y, z);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 220;
      this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.25, max: 0.55, color });
    }
  }
  kick(a = 5) { if (!reduceMotion) this.shake = Math.max(this.shake, a); }

  draw(v, dt) {
    const g = this.g;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (this.shake > 0.1) {
      g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= Math.pow(0.001, dt);
    }
    this.floor(g);
    this.table(g);

    // Marcas de bote
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.life -= dt;
      if (m.life <= 0) { this.marks.splice(i, 1); continue; }
      const p = toScreen(m.x, m.y, 0);
      g.strokeStyle = m.color;
      g.globalAlpha = Math.min(1, m.life);
      g.lineWidth = 2;
      g.beginPath(); g.ellipse(p.x, p.y, 6 + (1.1 - m.life) * 10, (6 + (1.1 - m.life) * 10) * 0.7, 0, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }

    if (v.aim) this.aim(g, v.aim);

    const b = v.ball;
    this.paddle(g, v.pads.L, 'L', '#e63946', v.serving === 'L');
    this.paddle(g, v.pads.R, 'R', '#18181b', v.serving === 'R');

    if (v.ballVisible) this.ball(g, b);
    else this.trail.length = 0;

    if (v.charge != null) this.chargeBar(g, v.chargePad, v.charge);

    // Partículas
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93;
      g.globalAlpha = Math.max(0, p.life / p.max);
      g.fillStyle = p.color;
      g.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    g.globalAlpha = 1;

    if (v.banner) this.banner(g, v.banner, v.sub);
    if (v.hint) this.hint(g, v.hint);
  }

  floor(g) {
    g.fillStyle = '#2a1f2d';
    g.fillRect(-20, -20, VIEW_W + 40, VIEW_H + 40);
    // Suelo de pista (sintético) con vallas
    g.fillStyle = '#7a2e3a';
    g.fillRect(14, 14, VIEW_W - 28, VIEW_H - 28);
    const grd = g.createRadialGradient(CX, CY, 80, CX, CY, 620);
    grd.addColorStop(0, 'rgba(255,255,255,0.08)');
    grd.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = grd;
    g.fillRect(14, 14, VIEW_W - 28, VIEW_H - 28);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    for (let x = 14; x < VIEW_W; x += 47) { g.beginPath(); g.moveTo(x, 14); g.lineTo(x, VIEW_H - 14); g.stroke(); }
    // Vallas separadoras
    g.fillStyle = '#123a6b';
    g.fillRect(0, 0, VIEW_W, 14); g.fillRect(0, VIEW_H - 14, VIEW_W, 14);
    g.fillRect(0, 0, 14, VIEW_H); g.fillRect(VIEW_W - 14, 0, 14, VIEW_H);
  }

  table(g) {
    const a = toScreen(-HL, -HW), bb = toScreen(HL, HW);
    const w = bb.x - a.x, h = bb.y - a.y;
    const drop = TABLE_H * S * LIFT;
    // Sombra en el suelo y patas
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(a.x + 8, a.y + drop * 0.55, w, h);
    g.fillStyle = '#111';
    [[0.08, 0.15], [0.92, 0.15], [0.08, 0.85], [0.92, 0.85]].forEach(([fx]) => {
      g.fillRect(a.x + w * fx - 4, bb.y, 8, drop * 0.5);
    });
    // Canto frontal
    g.fillStyle = '#0b2c55';
    g.fillRect(a.x, bb.y, w, 9);
    // Superficie
    g.fillStyle = '#1d4f91';
    g.fillRect(a.x, a.y, w, h);
    const sh = g.createLinearGradient(a.x, a.y, a.x, bb.y);
    sh.addColorStop(0, 'rgba(255,255,255,0.10)');
    sh.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = sh; g.fillRect(a.x, a.y, w, h);
    // Líneas: bandas laterales y de fondo de 2 cm, línea central de 3 mm
    g.strokeStyle = '#f5f5f5';
    g.lineWidth = Math.max(2, 0.02 * S);
    g.strokeRect(a.x + 1.5, a.y + 1.5, w - 3, h - 3);
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(a.x, CY); g.lineTo(bb.x, CY); g.stroke();

    // Red con postes
    const n1 = toScreen(0, -HW - NET_OVER), n2 = toScreen(0, HW + NET_OVER);
    const lift = NET_H * S * LIFT;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(n1.x + 2, n1.y, 6, n2.y - n1.y);
    g.fillStyle = 'rgba(20,20,30,0.75)';
    g.fillRect(n1.x - 2, n1.y - lift, 4, n2.y - n1.y + lift);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 1;
    for (let y = n1.y - lift; y < n2.y; y += 5) { g.beginPath(); g.moveTo(n1.x - 2, y); g.lineTo(n1.x + 2, y); g.stroke(); }
    g.fillStyle = '#fff';
    g.fillRect(n1.x - 2.5, n1.y - lift, 5, 3);
    g.fillStyle = '#333';
    g.fillRect(n1.x - 4, n1.y - lift - 4, 8, 8);
    g.fillRect(n2.x - 4, n2.y - 4, 8, 8);
  }

  paddle(g, p, side, color, serving) {
    const s = toScreen(p.x, p.y, 0.02);
    const d = dirOf(side);
    // Zona de alcance
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1;
    g.beginPath(); g.ellipse(s.x, s.y, 14, REACH * S, 0, 0, Math.PI * 2); g.stroke();
    // Sombra
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(s.x - d * 4 + 3, s.y + 7, 20, 16, 0, 0, Math.PI * 2); g.fill();
    // Mango (hacia atrás, lejos de la red)
    g.fillStyle = '#b5834a';
    g.save(); g.translate(s.x, s.y);
    g.fillRect(d > 0 ? -34 : 14, -5, 20, 10);
    g.fillStyle = '#8a5e30'; g.fillRect(d > 0 ? -34 : 30, -5, 4, 10);
    // Pala: madera + goma
    g.fillStyle = '#c99a5b';
    g.beginPath(); g.ellipse(0, 0, 19, 21, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.ellipse(0, 0, 17, 19, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.ellipse(-4, -6, 7, 9, -0.4, 0, Math.PI * 2); g.fill();
    g.restore();
    if (serving) {
      g.fillStyle = '#ffd166';
      g.font = '700 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('SACA', s.x, s.y - 30);
    }
  }

  ball(g, b) {
    const ground = onTable(b.x, b.y) && b.z >= 0 ? 0 : -TABLE_H;
    const sh = toScreen(b.x, b.y, ground);
    const p = toScreen(b.x, b.y, b.z);
    const hAbove = Math.max(0, b.z - ground);
    // Sombra: más pequeña y difusa cuanto más alta
    g.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.45 - hAbove * 0.35)})`;
    g.beginPath(); g.ellipse(sh.x, sh.y, 6 + hAbove * 2, 4 + hAbove * 1.5, 0, 0, Math.PI * 2); g.fill();

    this.trail.push({ x: p.x, y: p.y });
    if (this.trail.length > 8) this.trail.shift();
    this.trail.forEach((t, i) => {
      const a = (i + 1) / this.trail.length;
      g.fillStyle = `rgba(255, 190, 90, ${a * 0.22})`;
      g.beginPath(); g.arc(t.x, t.y, 5 * a, 0, Math.PI * 2); g.fill();
    });
    const r = 6 + Math.max(-0.5, b.z) * 2.2;
    const grad = g.createRadialGradient(p.x - 2, p.y - 2, 1, p.x, p.y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#ff9f1c');
    g.fillStyle = grad;
    g.beginPath(); g.arc(p.x, p.y, Math.max(3.5, r), 0, Math.PI * 2); g.fill();
  }

  aim(g, aim) {
    const t = toScreen(aim.target.x, aim.target.y);
    const b1 = toScreen(aim.bounce1.x, aim.bounce1.y);
    g.strokeStyle = 'rgba(255, 209, 102, 0.85)';
    g.lineWidth = 2;
    g.setLineDash([5, 6]);
    g.beginPath(); g.moveTo(b1.x, b1.y); g.lineTo(t.x, t.y); g.stroke();
    g.setLineDash([]);
    g.beginPath(); g.arc(b1.x, b1.y, 4, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(t.x - 7, t.y - 7); g.lineTo(t.x + 7, t.y + 7); g.moveTo(t.x + 7, t.y - 7); g.lineTo(t.x - 7, t.y + 7); g.stroke();
  }

  chargeBar(g, pad, c) {
    const s = toScreen(pad.x, pad.y);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(s.x - 28, s.y + 28, 56, 8);
    g.fillStyle = c < 0.4 ? '#4ade80' : c < 0.75 ? '#ffd166' : '#ff6b6b';
    g.fillRect(s.x - 27, s.y + 29, 54 * c, 6);
  }

  banner(g, text, sub) {
    g.fillStyle = 'rgba(8, 20, 40, 0.6)';
    g.fillRect(0, VIEW_H / 2 - 62, VIEW_W, sub ? 124 : 96);
    g.fillStyle = '#fff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 52px "Segoe UI", system-ui, sans-serif';
    g.fillText(text, VIEW_W / 2, VIEW_H / 2 - (sub ? 16 : -14));
    if (sub) {
      g.font = '600 22px "Segoe UI", system-ui, sans-serif';
      g.fillStyle = '#ffd166';
      g.fillText(sub, VIEW_W / 2, VIEW_H / 2 + 34);
    }
  }

  hint(g, text) {
    g.font = '600 17px "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(text).width + 28;
    g.fillStyle = 'rgba(8, 20, 40, 0.7)';
    g.fillRect(VIEW_W / 2 - w / 2, 26, w, 32);
    g.fillStyle = '#fff';
    g.fillText(text, VIEW_W / 2, 42);
  }
}
