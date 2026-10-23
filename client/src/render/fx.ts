/** 全屏特效层：飞行的豆子、粒子、冲击波。坐标都是页面坐标（clientX/Y）。 */

type Pt = { x: number; y: number; size: number };

interface Flight {
  img: HTMLCanvasElement;
  from: () => Pt;
  to: () => Pt;
  t0: number;
  dur: number;
  lift: number;
  done?: () => void;
}

type Shape = 'circle' | 'star' | 'heart' | 'square' | 'spark';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  size: number;
  color: string;
  shape: Shape;
  rot: number;
  vr: number;
}

interface Ring {
  x: number;
  y: number;
  t0: number;
  dur: number;
  r: number;
  color: string;
}

const CONFETTI = ['#ff5f7e', '#ffd54f', '#66bb6a', '#42a5f5', '#ab47bc', '#ffa726'];

export class Fx {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private flights: Flight[] = [];
  private parts: Particle[] = [];
  private rings: Ring[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx-layer';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    const resize = () => {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = innerWidth * this.dpr;
      this.canvas.height = innerHeight * this.dpr;
    };
    addEventListener('resize', resize);
    resize();
  }

  get busy() {
    return this.flights.length > 0;
  }

  fly(img: HTMLCanvasElement, from: () => Pt, to: () => Pt, dur = 300, delay = 0, done?: () => void) {
    this.flights.push({ img, from, to, t0: performance.now() + delay, dur, lift: 30 + Math.random() * 30, done });
  }

  burst(x: number, y: number, opts: { n?: number; colors?: string[]; shape?: Shape; speed?: number; size?: number; gravity?: number; life?: number } = {}) {
    const n = opts.n ?? 14;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 4) * (0.4 + Math.random() * 0.8);
      const max = (opts.life ?? 40) * (0.7 + Math.random() * 0.6);
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (opts.gravity ? 2 : 0),
        g: opts.gravity ?? 0,
        life: max,
        max,
        size: (opts.size ?? 5) * (0.6 + Math.random() * 0.8),
        color: (opts.colors ?? CONFETTI)[k % (opts.colors ?? CONFETTI).length],
        shape: opts.shape ?? 'circle',
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  ring(x: number, y: number, r = 80, color = '#ffb300', dur = 450) {
    this.rings.push({ x, y, r, color, dur, t0: performance.now() });
  }

  /** 点击计时器的爆破，level 1..3 逐级升级 */
  explosion(x: number, y: number, level: number) {
    if (level <= 1) {
      this.burst(x, y, { n: 18, shape: 'spark', colors: ['#ffd54f', '#ffb300', '#fff59d'], speed: 6, size: 4, life: 28 });
      this.ring(x, y, 60);
    } else if (level === 2) {
      this.burst(x, y, { n: 34, shape: 'spark', colors: ['#ff7043', '#ffd54f', '#ff5252', '#fff'], speed: 9, size: 6, life: 36 });
      this.burst(x, y, { n: 10, shape: 'circle', colors: ['rgba(120,110,130,0.5)'], speed: 2, size: 14, life: 50 });
      this.ring(x, y, 110, '#ff7043');
    } else {
      this.burst(x, y, { n: 50, shape: 'spark', colors: ['#ff5252', '#ffd54f', '#fff'], speed: 11, size: 6, life: 40 });
      this.ring(x, y, 150, '#ff5252', 550);
      // 烟花：延迟几朵
      for (let k = 0; k < 4; k++) {
        setTimeout(() => {
          const fx = x + (Math.random() - 0.5) * 260;
          const fy = y + 60 + Math.random() * 180;
          this.burst(fx, fy, { n: 28, shape: 'star', speed: 5, size: 6, life: 50, gravity: 0.08 });
        }, 150 + k * 160);
      }
    }
  }

  confetti() {
    for (let k = 0; k < 5; k++) {
      setTimeout(() => {
        this.burst(innerWidth * (0.15 + Math.random() * 0.7), innerHeight * (0.2 + Math.random() * 0.3), {
          n: 40,
          shape: Math.random() < 0.5 ? 'square' : 'star',
          speed: 7,
          size: 7,
          life: 90,
          gravity: 0.15,
        });
      }, k * 220);
    }
  }

  hearts(x: number, y: number, n = 6) {
    for (let k = 0; k < n; k++) {
      this.parts.push({
        x: x + (Math.random() - 0.5) * 30,
        y,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -1.5 - Math.random() * 1.5,
        g: 0,
        life: 60,
        max: 60,
        size: 7 + Math.random() * 5,
        color: ['#ff5f7e', '#ff8fab', '#ffc2d1'][k % 3],
        shape: 'heart',
        rot: 0,
        vr: 0,
      });
    }
  }

  draw(now: number) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    for (const r of this.rings) {
      const t = (now - r.t0) / r.dur;
      if (t < 0) continue;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.strokeStyle = r.color;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * Math.sqrt(t), 0, Math.PI * 2);
      ctx.stroke();
    }
    this.rings = this.rings.filter((r) => now - r.t0 < r.dur);
    ctx.globalAlpha = 1;

    for (const p of this.parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.g;
      p.vx *= 0.97;
      if (!p.g) p.vy *= 0.97;
      p.rot += p.vr;
      p.life--;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / (p.max * 0.4)));
      ctx.fillStyle = p.color;
      drawShape(ctx, p);
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    ctx.globalAlpha = 1;

    const remaining: Flight[] = [];
    for (const f of this.flights) {
      const t = (now - f.t0) / f.dur;
      if (t < 0) {
        remaining.push(f);
        continue;
      }
      const a = f.from();
      const b = f.to();
      const k = Math.min(1, t);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = a.x + (b.x - a.x) * e;
      const y = a.y + (b.y - a.y) * e - Math.sin(Math.PI * k) * f.lift;
      const size = (a.size + (b.size - a.size) * e) * (1 + 0.25 * Math.sin(Math.PI * k));
      ctx.drawImage(f.img, x - size / 2, y - size / 2, size, size);
      if (t >= 1) f.done?.();
      else remaining.push(f);
    }
    this.flights = remaining;
  }
}

function drawShape(ctx: CanvasRenderingContext2D, p: Particle) {
  const s = p.size;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.beginPath();
  switch (p.shape) {
    case 'circle':
      ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(-s / 2, -s / 3, s, (s * 2) / 3);
      break;
    case 'spark':
      ctx.rect(-s, -s / 5, s * 2, (s * 2) / 5);
      break;
    case 'star':
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? s * 0.45 : s;
        const a = (k * Math.PI) / 5 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      break;
    case 'heart':
      ctx.moveTo(0, s * 0.35);
      ctx.bezierCurveTo(-s, -s * 0.3, -s * 0.45, -s, 0, -s * 0.45);
      ctx.bezierCurveTo(s * 0.45, -s, s, -s * 0.3, 0, s * 0.35);
      break;
  }
  ctx.fill();
  ctx.restore();
}
