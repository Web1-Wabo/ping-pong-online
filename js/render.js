import { W, H, PADDLE_W, PADDLE_H, PADDLE_MARGIN, BALL_R } from './physics.js';

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.trail = [];
    this.particles = [];
    this.shake = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.c.getBoundingClientRect();
    this.c.width = Math.round(rect.width * dpr);
    this.c.height = Math.round(rect.height * dpr);
    this.scale = this.c.width / W;
  }

  burst(x, y, color, n = 14) {
    if (reduceMotion) n = 4;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 260;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + Math.random() * 0.25, max: 0.6, color });
    }
  }
  kick(amount = 6) { if (!reduceMotion) this.shake = Math.max(this.shake, amount); }

  draw(view, dt) {
    const g = this.g;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (this.shake > 0.1) {
      g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= Math.pow(0.001, dt);
    }
    this.table(g);

    // Rastro de la pelota
    const b = view.ball;
    if (view.ballVisible) {
      this.trail.push({ x: b.x, y: b.y });
      if (this.trail.length > 10) this.trail.shift();
    } else this.trail.length = 0;

    this.paddle(g, PADDLE_MARGIN, view.ly, '#e63946', view.serving === 'L');
    this.paddle(g, W - PADDLE_MARGIN - PADDLE_W, view.ry, '#1d1d1f', view.serving === 'R');

    if (view.ballVisible) {
      this.trail.forEach((p, i) => {
        const a = (i + 1) / this.trail.length;
        g.fillStyle = `rgba(255, 170, 60, ${a * 0.25})`;
        g.beginPath(); g.arc(p.x, p.y, BALL_R * a, 0, Math.PI * 2); g.fill();
      });
      // Sombra
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.ellipse(b.x + 5, b.y + 7, BALL_R, BALL_R * 0.8, 0, 0, Math.PI * 2); g.fill();
      // Pelota
      const grad = g.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, BALL_R);
      grad.addColorStop(0, '#fffaf0');
      grad.addColorStop(1, '#ff9f1c');
      g.fillStyle = grad;
      g.beginPath(); g.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); g.fill();
    }

    // Partículas
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94;
      g.globalAlpha = Math.max(0, p.life / p.max);
      g.fillStyle = p.color;
      g.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    g.globalAlpha = 1;

    if (view.banner) this.banner(g, view.banner, view.sub);
  }

  table(g) {
    g.fillStyle = '#14508f';
    g.fillRect(-20, -20, W + 40, H + 40);
    // Textura sutil
    const grd = g.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
    grd.addColorStop(0, 'rgba(255,255,255,0.06)');
    grd.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    // Líneas blancas: borde y línea central (dobles)
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, W - 6, H - 6);
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    // Red
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(W / 2 - 1, 0, 8, H);
    g.fillStyle = '#f1f1f1';
    for (let y = 0; y < H; y += 16) g.fillRect(W / 2 - 3, y, 6, 10);
    g.fillStyle = '#222';
    g.fillRect(W / 2 - 6, -4, 12, 10); g.fillRect(W / 2 - 6, H - 6, 12, 10);
  }

  paddle(g, x, y, color, serving) {
    // Mango
    const left = x < W / 2;
    g.fillStyle = '#b07a43';
    g.fillRect(left ? x - 22 : x + PADDLE_W, y + PADDLE_H / 2 - 7, 22, 14);
    // Goma
    g.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(g, x + 3, y + 4, PADDLE_W, PADDLE_H, 7); g.fill();
    g.fillStyle = color;
    roundRect(g, x, y, PADDLE_W, PADDLE_H, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
    roundRect(g, x, y, PADDLE_W, PADDLE_H, 7); g.stroke();
    if (serving) {
      g.fillStyle = '#ffd166';
      g.beginPath(); g.arc(left ? x + PADDLE_W + 14 : x - 14, y - 10, 5, 0, Math.PI * 2); g.fill();
    }
  }

  banner(g, text, sub) {
    g.fillStyle = 'rgba(8, 20, 40, 0.55)';
    g.fillRect(0, H / 2 - 70, W, sub ? 140 : 110);
    g.fillStyle = '#fff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 64px "Segoe UI", system-ui, sans-serif';
    g.fillText(text, W / 2, H / 2 - (sub ? 14 : -15));
    if (sub) {
      g.font = '500 24px "Segoe UI", system-ui, sans-serif';
      g.fillStyle = '#ffd166';
      g.fillText(sub, W / 2, H / 2 + 40);
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
