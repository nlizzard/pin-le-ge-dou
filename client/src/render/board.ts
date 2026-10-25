import type { Game } from '../core/engine';
import { luminance, SYMBOLS, type SpriteSet } from './sprites';

interface Cam {
  s: number; // 每格多少 CSS 像素
  x: number; // 网格原点在画布上的位置
  y: number;
}

interface PointerInfo {
  x: number;
  y: number;
  sx: number;
  sy: number;
  type: string;
}

export interface BoardCallbacks {
  onTapCell(i: number): void;
  onZoom?(t: number): void; // 0..1，供缩放滑条同步
  onHover?(i: number): void; // 鼠标悬停的格子（-1 = 无）
  onPick?(i: number): void; // 选格模式（镊子、彩虹炸弹）
  onPaint?(i: number): void; // 画笔模式：划过的格子
}

export type BoardMode = 'normal' | 'pick' | 'paint';

const MAX_CELL = 56;
const TAP_SLOP = 8;

export class BoardView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  private game: Game | null = null;
  private sprites: SpriteSet | null = null;
  cam: Cam = { s: 20, x: 0, y: 0 };
  private camTarget: Cam | null = null;
  private minS = 4;
  private pointers = new Map<number, PointerInfo>();
  private moved = false;
  private pinch: { d: number; cx: number; cy: number; s: number; x: number; y: number } | null = null;
  private lastTap = { t: 0, x: 0, y: 0 };
  /** 正在飞来的豆子：格子 → 落地时间(ms)，落地前不画豆子 */
  readonly arriving = new Map<number, number>();
  /** 提示高亮的格子 → 截止时间 */
  readonly hints = new Map<number, number>();
  colorBlind = false;
  helperImg: HTMLCanvasElement | null = null;
  /** 鼠标悬停时预览会一起移动的那组豆子 */
  private groupPreview = new Set<number>();
  private hoverCell = -1;
  mode: BoardMode = 'normal';
  private painting = false;
  /** 精灵帮帮忙：啵啵在画布上的位置（格子） */
  helperAt = -1;
  private shake = 0;

  constructor(canvas: HTMLCanvasElement, private cb: BoardCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('pointerleave', () => this.setHover(-1));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  setGame(game: Game, sprites: SpriteSet) {
    this.game = game;
    this.sprites = sprites;
    this.arriving.clear();
    this.hints.clear();
    this.resize();
    this.fit(false);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const firstSize = this.vw === 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.vw = r.width;
    this.vh = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.updateMinS();
    if (firstSize) this.fit(false);
    else this.clamp(this.cam);
  }

  private updateMinS() {
    if (!this.game) return;
    const fitS = Math.min(this.vw / (this.game.w + 1), this.vh / (this.game.h + 1));
    this.minS = Math.max(2, Math.min(fitS, MAX_CELL));
  }

  get fitScale() {
    return this.minS;
  }

  /** 复位到整图 */
  fit(animate = true) {
    if (!this.game) return;
    this.updateMinS();
    const s = this.minS;
    const t: Cam = { s, x: (this.vw - this.game.w * s) / 2, y: (this.vh - this.game.h * s) / 2 };
    if (animate) this.camTarget = t;
    else {
      this.cam = t;
      this.camTarget = null;
    }
    this.emitZoom(t.s);
  }

  /** 缩放比例 0..1（滑条） */
  setZoom01(t: number) {
    const s = this.minS * Math.pow(MAX_CELL / this.minS, Math.max(0, Math.min(1, t)));
    this.zoomTo(s, this.vw / 2, this.vh / 2, false);
  }

  zoomBy(f: number, sx = this.vw / 2, sy = this.vh / 2) {
    this.zoomTo((this.camTarget ?? this.cam).s * f, sx, sy, true);
  }

  private zoomTo(s: number, sx: number, sy: number, animate: boolean) {
    const base = this.camTarget ?? this.cam;
    s = Math.max(this.minS, Math.min(MAX_CELL, s));
    const wx = (sx - base.x) / base.s;
    const wy = (sy - base.y) / base.s;
    const t: Cam = { s, x: sx - wx * s, y: sy - wy * s };
    this.clamp(t);
    if (animate) this.camTarget = t;
    else {
      this.cam = t;
      this.camTarget = null;
    }
    this.emitZoom(s);
  }

  panBy(dx: number, dy: number) {
    const base = this.camTarget ?? this.cam;
    const t = { ...base, x: base.x + dx, y: base.y + dy };
    this.clamp(t);
    this.camTarget = t;
  }

  /** 镜头飞到某个格子，放大到便于点击 */
  focusCell(i: number) {
    if (!this.game) return;
    const s = Math.max((this.camTarget ?? this.cam).s, Math.min(MAX_CELL, 32));
    const cx = (i % this.game.w) + 0.5;
    const cy = Math.floor(i / this.game.w) + 0.5;
    const t: Cam = { s, x: this.vw / 2 - cx * s, y: this.vh / 2 - cy * s };
    this.clamp(t);
    this.camTarget = t;
    this.emitZoom(s);
  }

  private emitZoom(s: number) {
    const span = Math.log(MAX_CELL / this.minS);
    this.cb.onZoom?.(span > 0 ? Math.log(s / this.minS) / span : 0);
  }

  private clamp(c: Cam) {
    if (!this.game) return;
    const bw = this.game.w * c.s;
    const bh = this.game.h * c.s;
    const m = 48;
    if (bw <= this.vw) c.x = Math.max(Math.min(c.x, this.vw - bw), 0);
    else c.x = Math.min(m, Math.max(this.vw - bw - m, c.x));
    if (bh <= this.vh) c.y = Math.max(Math.min(c.y, this.vh - bh), 0);
    else c.y = Math.min(m, Math.max(this.vh - bh - m, c.y));
  }

  // ---------- 坐标 ----------

  /** 格子中心的页面坐标（clientX/Y） */
  cellClientCenter(i: number): { x: number; y: number; size: number } {
    const r = this.canvas.getBoundingClientRect();
    const g = this.game!;
    const { s, x, y } = this.cam;
    return { x: r.left + x + ((i % g.w) + 0.5) * s, y: r.top + y + (Math.floor(i / g.w) + 0.5) * s, size: s };
  }

  cellAtLocal(px: number, py: number): number {
    const g = this.game;
    if (!g) return -1;
    const cx = Math.floor((px - this.cam.x) / this.cam.s);
    const cy = Math.floor((py - this.cam.y) / this.cam.s);
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return -1;
    const i = cy * g.w + cx;
    return g.isInside(i) ? i : -1;
  }

  shakeBoard() {
    this.shake = 1;
  }

  // ---------- 输入 ----------

  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, type: e.pointerType });
    if (this.pointers.size === 1) this.moved = false;
    if (this.mode === 'paint' && this.pointers.size === 1) {
      this.painting = true;
      this.paintAt(p.x, p.y);
    }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.camTarget = null;
      this.pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        s: this.cam.s,
        x: this.cam.x,
        y: this.cam.y,
      };
      this.moved = true;
      this.painting = false;
    }
  }

  setMode(m: BoardMode) {
    this.mode = m;
    this.painting = false;
    this.canvas.style.cursor = m === 'pick' ? 'crosshair' : m === 'paint' ? 'cell' : 'pointer';
    this.canvas.classList.toggle('mode-pick', m === 'pick');
    this.canvas.classList.toggle('mode-paint', m === 'paint');
  }

  private paintAt(x: number, y: number) {
    const i = this.cellAtLocal(x, y);
    if (i >= 0) this.cb.onPaint?.(i);
  }

  setGroupPreview(cells: number[]) {
    this.groupPreview = new Set(cells);
  }

  private setHover(i: number) {
    if (i === this.hoverCell) return;
    this.hoverCell = i;
    this.cb.onHover?.(i);
  }

  private onMove(e: PointerEvent) {
    const info = this.pointers.get(e.pointerId);
    if (!info) {
      if (e.pointerType === 'mouse') {
        const p = this.local(e);
        this.setHover(this.cellAtLocal(p.x, p.y));
      }
      return;
    }
    const p = this.local(e);
    const dx = p.x - info.x;
    const dy = p.y - info.y;
    info.x = p.x;
    info.y = p.y;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const P = this.pinch;
      const s = Math.max(this.minS, Math.min(MAX_CELL, (P.s * d) / P.d));
      const wx = (P.cx - P.x) / P.s;
      const wy = (P.cy - P.y) / P.s;
      const c: Cam = { s, x: cx - wx * s, y: cy - wy * s };
      this.clamp(c);
      this.cam = c;
      this.emitZoom(s);
      return;
    }
    if (this.painting) {
      // 两次事件之间插值，快速划过也不漏格
      const steps = Math.ceil(Math.hypot(dx, dy) / Math.max(4, this.cam.s / 2));
      for (let k = 1; k <= steps; k++) this.paintAt(p.x - dx + (dx * k) / steps, p.y - dy + (dy * k) / steps);
      return;
    }
    if (!this.moved && Math.hypot(p.x - info.sx, p.y - info.sy) > TAP_SLOP) this.moved = true;
    if (this.moved) {
      this.camTarget = null;
      const c = { ...this.cam, x: this.cam.x + dx, y: this.cam.y + dy };
      this.clamp(c);
      this.cam = c;
    }
  }

  private onUp(e: PointerEvent, cancel = false) {
    const info = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.painting) {
      this.painting = this.pointers.size > 0;
      return;
    }
    if (!info || cancel || this.moved || this.pointers.size > 0) return;
    this.handleTap(info.sx, info.sy, info.type);
  }

  private handleTap(x: number, y: number, type: string) {
    const now = performance.now();
    const dbl = now - this.lastTap.t < 320 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 24;
    this.lastTap = { t: now, x, y };
    const i = this.cellAtLocal(x, y);
    if (i < 0) {
      // 双击空白：放大 / 复位
      if (dbl) {
        if (this.cam.s > this.minS * 1.3) this.fit();
        else this.zoomBy(2.5, x, y);
      }
      return;
    }
    // 大小完全由用户自己调节（滑条 / 滚轮 / 双指），点击不自动放大
    if (this.mode === 'pick') this.cb.onPick?.(i);
    else if (this.mode === 'normal') this.cb.onTapCell(i);
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const f = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
    this.zoomTo((this.camTarget ?? this.cam).s * f, p.x, p.y, false);
  }

  // ---------- 绘制 ----------

  draw(now: number) {
    const ctx = this.ctx;
    const g = this.game;
    const sp = this.sprites;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!g || !sp) return;

    if (this.camTarget) {
      const t = this.camTarget;
      const k = 0.22;
      this.cam = { s: this.cam.s + (t.s - this.cam.s) * k, x: this.cam.x + (t.x - this.cam.x) * k, y: this.cam.y + (t.y - this.cam.y) * k };
      if (Math.abs(t.s - this.cam.s) < 0.01 && Math.abs(t.x - this.cam.x) < 0.3 && Math.abs(t.y - this.cam.y) < 0.3) {
        this.cam = t;
        this.camTarget = null;
      }
    }

    let ox = 0;
    if (this.shake > 0) {
      ox = Math.sin(now / 18) * 6 * this.shake;
      this.shake = Math.max(0, this.shake - 0.06);
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, ox * this.dpr, 0);
    const { s, x: X, y: Y } = this.cam;
    const x0 = Math.max(0, Math.floor(-X / s));
    const y0 = Math.max(0, Math.floor(-Y / s));
    const x1 = Math.min(g.w - 1, Math.ceil((this.vw - X) / s));
    const y1 = Math.min(g.h - 1, Math.ceil((this.vh - Y) / s));

    // 白色描边底板
    ctx.fillStyle = '#ffffff';
    const pad = Math.max(1.5, s * 0.14);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (g.target[cy * g.w + cx] < 0) continue;
        ctx.fillRect(X + cx * s - pad, Y + cy * s - pad, s + pad * 2, s + pad * 2);
      }
    }
    ctx.fillStyle = '#ece9f7';
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (g.target[cy * g.w + cx] < 0) continue;
        ctx.fillRect(X + cx * s - 0.5, Y + cy * s - 0.5, s + 1, s + 1);
      }
    }

    const lod = s < 9;
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    ctx.imageSmoothingEnabled = true;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * g.w + cx;
        const t = g.target[i];
        if (t < 0) continue;
        const px = X + cx * s;
        const py = Y + cy * s;
        let b: number = g.beads[i];
        const arrive = this.arriving.get(i);
        if (arrive !== undefined) {
          if (now >= arrive) this.arriving.delete(i);
          else b = -1;
        }
        if (lod) {
          ctx.fillStyle = g.fog[i] ? '#c9c6d8' : g.def.colors[t];
          ctx.fillRect(px, py, s + 0.5, s + 0.5);
          if (b >= 0 && b !== t) {
            ctx.drawImage(sp.beads[b], px, py, s, s);
          } else if (b < 0) {
            ctx.fillStyle = `rgba(60,40,120,${0.3 + 0.4 * pulse})`;
            ctx.fillRect(px + s * 0.3, py + s * 0.3, s * 0.4, s * 0.4);
          }
          continue;
        }
        if (g.fog[i]) drawFogTile(ctx, px, py, s, now + i * 37);
        else {
          ctx.fillStyle = g.def.colors[t];
          ctx.fillRect(px, py, s + 0.5, s + 0.5);
        }
        if (b >= 0) {
          // 归位的豆不再融平进底色，保留同色浮雕轮廓（参考图效果）
          ctx.drawImage(b === t ? sp.settled[b] : sp.beads[b], px, py, s, s);
          if (g.ice[i]) drawIce(ctx, px, py, s);
          if (g.locked[i]) drawLock(ctx, px, py, s, g.def.colors[g.lockColor]);
          if (g.star[i]) drawStar(ctx, px + s * 0.8, py + s * 0.2, s * 0.17, pulse);
          if (g.bomb[i] >= 0) drawBomb(ctx, px, py, s, g.bomb[i], pulse);
          if (this.colorBlind && b !== t && s >= 16) {
            ctx.fillStyle = luminance(g.def.colors[b]) > 0.6 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)';
            ctx.font = `${Math.round(s * 0.32)}px sans-serif`;
            ctx.fillText(SYMBOLS[b % SYMBOLS.length], px + s / 2, py + s / 2 + 1);
          }
        } else {
          ctx.drawImage(sp.socket, px, py, s, s);
          // 空位：呼吸描边，提示所需颜色
          ctx.lineWidth = Math.max(1.5, s * 0.08);
          ctx.strokeStyle = `rgba(90,60,200,${0.35 + 0.55 * pulse})`;
          ctx.strokeRect(px + ctx.lineWidth / 2, py + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
          if (this.colorBlind && s >= 16 && !g.fog[i]) {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.font = `${Math.round(s * 0.32)}px sans-serif`;
            ctx.fillText(SYMBOLS[t % SYMBOLS.length], px + s / 2, py + s / 2 + 1);
          }
        }
      }
    }

    // 精灵帮帮忙：画布上的小啵啵
    if (this.helperAt >= 0 && this.helperImg) {
      const hx = X + (this.helperAt % g.w) * s + s / 2;
      const hy = Y + Math.floor(this.helperAt / g.w) * s - s * 0.2 - Math.abs(Math.sin(now / 120)) * s * 0.3;
      const hs = Math.max(24, s * 1.4);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.helperImg, hx - hs / 2, hy - hs, hs, hs);
      ctx.imageSmoothingEnabled = true;
    }

    // 悬停预览：会一起移动的同色错位豆子
    if (this.groupPreview.size > 1) {
      ctx.lineWidth = Math.max(1.5, s * 0.09);
      ctx.strokeStyle = `rgba(255,255,255,${0.75 + 0.25 * pulse})`;
      for (const i of this.groupPreview) {
        const px = X + (i % g.w) * s;
        const py = Y + Math.floor(i / g.w) * s;
        ctx.beginPath();
        ctx.arc(px + s / 2, py + s / 2, s * 0.36, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (this.hoverCell >= 0 && s >= 14) {
        const px = X + (this.hoverCell % g.w) * s + s;
        const py = Y + Math.floor(this.hoverCell / g.w) * s;
        const label = `×${this.groupPreview.size}`;
        ctx.font = `bold ${Math.max(11, Math.round(s * 0.36))}px sans-serif`;
        const tw = ctx.measureText(label).width + 10;
        const th = Math.max(16, s * 0.5);
        ctx.fillStyle = 'rgba(60,40,120,0.85)';
        ctx.beginPath();
        ctx.roundRect(px - tw / 2, py - th / 2, tw, th, th / 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, px, py + 1);
      }
    }

    // 提示高亮
    if (this.hints.size) {
      ctx.lineWidth = Math.max(2, s * 0.12);
      for (const [i, until] of this.hints) {
        if (now > until) {
          this.hints.delete(i);
          continue;
        }
        const px = X + (i % g.w) * s;
        const py = Y + Math.floor(i / g.w) * s;
        ctx.strokeStyle = `rgba(255,200,0,${0.5 + 0.5 * pulse})`;
        ctx.beginPath();
        ctx.arc(px + s / 2, py + s / 2, s * 0.48, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

// ---------- 特殊格子的绘制 ----------

function drawFogTile(ctx: CanvasRenderingContext2D, px: number, py: number, s: number, seed: number) {
  ctx.fillStyle = '#c9c6d8';
  ctx.beginPath();
  ctx.roundRect(px + s * 0.04, py + s * 0.04, s * 0.92, s * 0.92, s * 0.16);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const d = Math.sin(seed / 900) * s * 0.05;
  for (const [ox, oy, r] of [
    [0.3, 0.38, 0.2],
    [0.55, 0.3, 0.22],
    [0.72, 0.5, 0.18],
    [0.4, 0.62, 0.2],
    [0.62, 0.7, 0.16],
  ]) {
    ctx.beginPath();
    ctx.arc(px + s * ox + d, py + s * oy, s * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawIce(ctx: CanvasRenderingContext2D, px: number, py: number, s: number) {
  ctx.fillStyle = 'rgba(190,230,255,0.62)';
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.roundRect(px + s * 0.1, py + s * 0.1, s * 0.8, s * 0.8, s * 0.14);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px + s * 0.25, py + s * 0.3);
  ctx.lineTo(px + s * 0.42, py + s * 0.22);
  ctx.moveTo(px + s * 0.6, py + s * 0.72);
  ctx.lineTo(px + s * 0.75, py + s * 0.6);
  ctx.stroke();
}

function drawLock(ctx: CanvasRenderingContext2D, px: number, py: number, s: number, color: string) {
  ctx.fillStyle = 'rgba(40,30,60,0.35)';
  ctx.fillRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.84);
  // 交叉的锁链
  ctx.strokeStyle = 'rgba(120,110,130,0.95)';
  ctx.lineWidth = Math.max(1.5, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(px + s * 0.12, py + s * 0.12);
  ctx.lineTo(px + s * 0.88, py + s * 0.88);
  ctx.moveTo(px + s * 0.88, py + s * 0.12);
  ctx.lineTo(px + s * 0.12, py + s * 0.88);
  ctx.stroke();
  // 挂锁：锁体是要求的颜色
  const cx = px + s * 0.5;
  const cy = py + s * 0.56;
  const w = s * 0.38;
  ctx.lineWidth = Math.max(1.2, s * 0.06);
  ctx.strokeStyle = '#555';
  ctx.beginPath();
  ctx.arc(cx, cy - w * 0.35, w * 0.3, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - w * 0.35, w, w * 0.75, w * 0.15);
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.stroke();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, pulse: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(pulse * 0.4);
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 ? r * 0.45 : r;
    const a = (k * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffc107';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1, r * 0.25);
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

function drawBomb(ctx: CanvasRenderingContext2D, px: number, py: number, s: number, steps: number, pulse: number) {
  const r = s * 0.2;
  const cx = px + s * 0.76;
  const cy = py + s * 0.76;
  const danger = steps <= 3;
  ctx.fillStyle = danger ? `rgb(${180 + 75 * pulse},40,40)` : '#263238';
  ctx.beginPath();
  ctx.arc(cx, cy, r * (danger ? 1 + 0.12 * pulse : 1), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffb300';
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.6, cy - r * 0.7);
  ctx.quadraticCurveTo(cx + r, cy - r * 1.4, cx + r * 1.3, cy - r * 1.2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(8, Math.round(r * 1.1))}px sans-serif`;
  ctx.fillText(String(steps), cx, cy + 1);
}
