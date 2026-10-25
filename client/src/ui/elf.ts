import { sfx } from '../audio';
import { elfFrame, type ElfPose, type ElfSkin } from '../render/elfSprite';
import type { Fx } from '../render/fx';
import { floatText, h } from './dom';

export type DropResult = 'dropped' | 'none' | 'empty';

export interface ElfHost {
  /** 连点第 k 下（1 起）。宿主决定是否掉落道具（含每局上限） */
  onComboTap?(k: number): DropResult;
  /** 长按：打开许愿池 */
  onWish?(): void;
  /** 长时间没操作：精灵指路 */
  onIdleHint?(): boolean;
}

export type Mood =
  | 'idle'
  | 'happy'
  | 'ecstatic'
  | 'celebrate'
  | 'hurry'
  | 'tense'
  | 'encourage'
  | 'sleepy'
  | 'sad'
  | 'run'
  | 'tired'
  | 'pray'
  | 'startle';

export interface Metrics {
  state: string;
  overtime: boolean;
  timeRatio: number; // 剩余时间 / 限时
  slotRatio: number; // 空槽占用比例
  combo: number; // 当前连击（1.5 秒内）
  progress: number; // 0..1
  chainStreak: number; // 连续开新链次数
  idle: number; // 秒
}

const MOOD_POSES: Record<Mood, ElfPose[]> = {
  idle: ['idle'],
  happy: ['happy', 'idle'],
  ecstatic: ['dance1', 'dance2'],
  celebrate: ['excited', 'happy'],
  hurry: ['worried', 'startle'],
  tense: ['worried'],
  encourage: ['cheer', 'idle'],
  sleepy: ['sleepy'],
  sad: ['sad'],
  run: ['run1', 'run2'],
  tired: ['tired', 'sleepy'],
  pray: ['pray'],
  startle: ['startle'],
};

const LINES: Partial<Record<Mood, string[]>> = {
  happy: ['好耶！', '漂亮！', '就是这样～', '手感不错嘛'],
  ecstatic: ['哇哦哦！手速爆表！', '太强啦！', '停不下来了！', '这就是大师吗！'],
  celebrate: ['画完啦！你是拼豆大师！', '耶！我们做到了！'],
  hurry: ['快快快！还有一丢丢！', '时间不多啦！', '冲鸭！'],
  tense: ['空槽快满啦，先找发光的空位要的颜色哦', '小心爆槽！挑小的一组进槽～'],
  encourage: ['别急，先把空位填上～', '看看空位要什么颜色？', '加油，你可以的！'],
  sleepy: ['……叫我吗？', 'Zzz…', '好困哦……'],
  sad: ['差一点点！再来一次一定行', '没关系，我陪你再来！'],
  run: ['没关系，慢慢来，画完就是胜利！', '加时赛开始！一起冲！'],
};

const TAP_LINES = ['吵到我啦～', '再戳就变红了！', '嘿嘿', '痒痒的！', '你好呀～', '啵～', '要加油哦', '我在看着你哦', '摸摸头～'];
const COMBO_WINDOW_MS = 800;
const LONG_PRESS_MS = 600;
const LINE_COOLDOWN = 4000;

export class Elf {
  readonly el: HTMLElement;
  private img: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bubble: HTMLElement;
  private ring: HTMLElement;
  private zzz: HTMLElement;
  private skin: ElfSkin = 'normal';
  private mood: Mood = 'idle';
  private tempMood: { mood: Mood | ElfPose; until: number } | null = null;
  private frameK = 0;
  private timer = 0;
  private lastLineAt = 0;
  private recentLines = new Map<string, number>();
  private combo = 0;
  private lastTapAt = 0;
  private tiredUntil = 0;
  private pressTimer = 0;
  private longFired = false;
  private lastProgressMark = 0;
  private hintCooldownUntil = 0;

  constructor(private fx: Fx, private host: ElfHost = {}, size = 56) {
    this.img = h('canvas.elf-img') as HTMLCanvasElement;
    this.img.width = 16;
    this.img.height = 16;
    this.ctx = this.img.getContext('2d')!;
    this.bubble = h('div.elf-bubble');
    this.ring = h('div.elf-ring');
    this.zzz = h('div.elf-zzz', {}, 'z', h('span', {}, 'z'), h('span', {}, 'Z'));
    this.el = h('div.elf', { style: { width: size + 'px', height: size + 'px' }, title: '点我互动 · 连点有惊喜 · 长按许愿' }, this.ring, this.img, this.zzz, this.bubble);
    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    this.el.addEventListener('pointerup', () => this.onUp());
    this.el.addEventListener('pointerleave', () => this.cancelPress());
    this.el.addEventListener('pointercancel', () => this.cancelPress());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.render();
    this.timer = window.setInterval(() => this.animate(), 220);
  }

  destroy() {
    clearInterval(this.timer);
    clearTimeout(this.pressTimer);
  }

  setSkin(skin: ElfSkin) {
    this.skin = skin;
    this.render();
  }

  /** 当前帧（给「精灵帮帮忙」画在棋盘上用） */
  frame(): HTMLCanvasElement {
    return elfFrame('run1', this.skin);
  }

  reset() {
    this.combo = 0;
    this.tiredUntil = 0;
    this.tempMood = null;
    this.lastProgressMark = 0;
    this.setMood('idle');
  }

  // ---------- 交互 ----------

  private onDown(e: PointerEvent) {
    e.preventDefault();
    this.longFired = false;
    this.el.classList.add('pressing');
    this.pressTimer = window.setTimeout(() => {
      this.longFired = true;
      this.el.classList.remove('pressing');
      if (this.host.onWish) {
        this.flash('pray', 1500);
        sfx.star(2);
        this.host.onWish();
      } else this.say('进关卡后长按我，可以许愿哦～', 2400, true);
    }, LONG_PRESS_MS);
  }

  private onUp() {
    this.el.classList.remove('pressing');
    clearTimeout(this.pressTimer);
    if (this.longFired) return;
    this.tap();
  }

  private cancelPress() {
    this.el.classList.remove('pressing');
    clearTimeout(this.pressTimer);
  }

  tap() {
    const now = performance.now();
    const r = this.el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 3;
    this.combo = now - this.lastTapAt <= COMBO_WINDOW_MS ? this.combo + 1 : 1;
    this.lastTapAt = now;

    // 随机互动特效
    const fxKind = Math.floor(Math.random() * 6);
    if (fxKind === 0) this.fx.hearts(cx, cy, 5 + this.combo);
    else if (fxKind === 1) this.fx.burst(cx, cy, { n: 10 + this.combo * 3, shape: 'star', speed: 4, size: 5, life: 30 });
    else if (fxKind === 2) floatText(['♪', '♫', '♬'][Math.floor(Math.random() * 3)], cx + (Math.random() - 0.5) * 40, cy, 'note');
    else if (fxKind === 3) this.fx.burst(cx, cy, { n: 16, shape: 'square', speed: 5, size: 5, life: 40, gravity: 0.12 });
    else this.fx.hearts(cx, cy, 3);
    this.bump(['bounce', 'wiggle', 'jump'][Math.floor(Math.random() * 3)]);
    sfx.click();

    // 越连点越激动
    this.el.style.setProperty('--excite', String(Math.min(5, this.combo)));
    this.el.classList.toggle('excited', this.combo >= 2);

    if (now < this.tiredUntil) {
      this.flash('tired', 800);
      this.say('呼…让我歇一会儿', 1600, true);
      return;
    }
    const drop = this.host.onComboTap?.(this.combo) ?? 'none';
    if (drop === 'dropped') {
      this.combo = 0;
      this.tiredUntil = now + 8000;
      this.el.classList.remove('excited');
      this.flash('excited', 1200);
      this.say('送你一个礼物！', 1800, true);
      setTimeout(() => this.flash('tired', 6500), 1300);
      return;
    }
    if (drop === 'empty' && this.combo >= 3) {
      this.say('今天的口袋空啦，下一局再来～', 2000, true);
      return;
    }
    this.flash(this.combo >= 3 ? 'happy' : 'blink', 500);
    if (this.combo === 1 && Math.random() < 0.6) this.say(TAP_LINES[Math.floor(Math.random() * TAP_LINES.length)], 1500, true);
    if (this.combo >= 3) this.say('哇哇哇！'.slice(0, Math.min(4, this.combo - 1)) + '！', 900, true);
  }

  /** 外部事件的即时反应 */
  react(kind: 'startle' | 'clap' | 'gift' | 'wish') {
    if (kind === 'startle') {
      this.flash('startle', 600);
      this.bump('jump');
      setTimeout(() => this.flash('happy', 900), 600);
    } else if (kind === 'clap') {
      this.flash('happy', 900);
      this.bump('bounce');
    } else if (kind === 'gift') {
      this.flash('excited', 1200);
      this.bump('spin');
    } else if (kind === 'wish') {
      this.flash('pray', 1600);
    }
  }

  say(text: string, ms = 2200, force = false) {
    const now = performance.now();
    if (!force && now - this.lastLineAt < LINE_COOLDOWN) return;
    const last = this.recentLines.get(text);
    if (!force && last && now - last < 20000) return;
    this.lastLineAt = now;
    this.recentLines.set(text, now);
    this.bubble.textContent = text;
    this.bubble.classList.remove('show');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('show');
    clearTimeout((this.bubble as any)._t);
    (this.bubble as any)._t = setTimeout(() => this.bubble.classList.remove('show'), ms);
  }

  // ---------- 情绪 ----------

  /** 根据当前表现更新情绪（每 500ms 调用一次） */
  update(m: Metrics) {
    let mood: Mood = 'idle';
    const now = performance.now();
    if (m.state === 'won') mood = 'celebrate';
    else if (m.state === 'burst') mood = 'sad';
    else if (m.overtime) mood = 'run';
    else if (m.timeRatio < 0.2) mood = 'hurry';
    else if (m.slotRatio >= 0.7) mood = 'tense';
    else if (m.combo >= 10) mood = 'ecstatic';
    else if (m.combo >= 3) mood = 'happy';
    else if (m.chainStreak >= 3) mood = 'encourage';
    else if (m.idle > 25 && now > this.hintCooldownUntil && this.host.onIdleHint?.()) {
      this.hintCooldownUntil = now + 20000;
      this.say('这颗看起来不太对劲哦～', 2600, true);
      this.flash('cheer', 2000);
    } else if (m.idle > 15) mood = 'sleepy';

    // 进度里程碑：手舞足蹈 3 秒
    const mark = Math.floor(m.progress * 4);
    if (mark > this.lastProgressMark && mark < 4 && m.state === 'playing') {
      this.lastProgressMark = mark;
      this.flash('ecstatic', 3000);
      this.say(`已经完成 ${mark * 25}% 啦！`, 2000, true);
    }
    this.setMood(mood);
  }

  setMood(mood: Mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    const lines = LINES[mood];
    if (lines) this.say(lines[Math.floor(Math.random() * lines.length)], mood === 'celebrate' ? 3000 : 2200, mood === 'celebrate' || mood === 'sad');
    this.el.dataset.mood = mood;
    this.render();
  }

  /** 临时情绪，到时恢复 */
  private flash(mood: Mood | ElfPose, ms: number) {
    this.tempMood = { mood, until: performance.now() + ms };
    this.el.dataset.mood = mood;
    this.render();
  }

  private bump(cls: string) {
    this.img.classList.remove('bounce', 'spin', 'wiggle', 'jump');
    void this.img.offsetWidth;
    this.img.classList.add(cls);
  }

  private currentMood(): Mood | ElfPose {
    if (this.tempMood && performance.now() < this.tempMood.until) return this.tempMood.mood;
    if (this.tempMood) {
      this.tempMood = null;
      this.el.dataset.mood = this.mood;
    }
    return this.mood;
  }

  private animate() {
    this.frameK++;
    this.render();
  }

  private render() {
    const mood = this.currentMood();
    const poses: ElfPose[] = (MOOD_POSES as Record<string, ElfPose[]>)[mood] ?? [mood as ElfPose];
    let pose = poses[this.frameK % poses.length];
    // 待机时偶尔眨眼
    if (mood === 'idle' && this.frameK % 14 === 0) pose = 'blink';
    this.ctx.clearRect(0, 0, 16, 16);
    this.ctx.drawImage(elfFrame(pose, this.skin), 0, 0);
    this.zzz.classList.toggle('show', mood === 'sleepy' || mood === 'tired');
  }
}
