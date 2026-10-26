import { sfx, vibrate } from '../audio';
import { defaultLockedSlots, Game, TIMER_TAP_LIMIT, type Events, type Move, type TapResult } from '../core/engine';
import { ELEMENT_INFO, LEVEL_COUNT, loadLevelDef, OBJECTIVE_ICON, OBJECTIVE_TEXT, type ElementType, type Objective } from '../core/level';
import { COMMON_PROPS, ELF_DROP_CHANCE, ELF_DROPS_PER_GAME, HIDDEN_PROPS, PROP_MAP, PROPS, rollCommon, rollHidden, WISHES_PER_GAME, type PropId } from '../core/props';
import { BoardView } from '../render/board';
import { Fx } from '../render/fx';
import { buildSprites, separateColors, type SpriteSet } from '../render/sprites';
import { addProp, propCount, save } from '../save';
import { recordLevelWin } from '../levelProgress';
import { beadStyle, dialog, floatText, fmtTime, h, starRow, toast } from './dom';
import { Elf, type DropResult } from './elf';
import { openLottery } from './lottery';
import { openSettings } from './settings';
import { openWishPool } from './wish';
import type { LevelDef } from '../core/level';
import { openShareStudio } from './share';
import { customRecords, recordCustom } from '../customRecords';
import { bindPropPress } from './propPress';
import { loadWallWork, rememberArtwork } from '../artWallStore';
import { clearCheckpoint, loadCheckpoint, saveCheckpoint, type LevelCheckpoint } from '../checkpoint';

const FLIGHT_MS = 320;
const STAGGER_MS = 110;

export interface GameScreenHost {
  toMap(): void;
  play(id: number): void;
  playCustom(def: LevelDef): void;
  toStudio(): void;
}

type PickAction = 'tweezers' | 'rainbowBomb' | null;

/** 给获得的道具记账（隐藏道具进图鉴，集齐换皮肤） */
export function grantProp(id: PropId, n = 1): { isNew: boolean } {
  const p = PROP_MAP[id];
  let isNew = false;
  addProp(id, n);
  if (p.hidden && !save.data.collected.includes(id)) {
    isNew = true;
    save.update((d) => {
      d.collected.push(id);
      if (HIDDEN_PROPS.every((x) => d.collected.includes(x.id))) d.elfSkin = 'gold';
    });
  }
  return { isNew };
}

export class GameScreen {
  readonly el: HTMLElement;
  private board: BoardView;
  private fx: Fx;
  private elf: Elf;
  private game!: Game;
  private sprites!: SpriteSet;
  private levelId = 1;
  private paused = false;
  private lastFrame = 0;
  private raf = 0;
  private trayHidden = new Set<number>();
  private locateIdx = 0;
  private lastLocate = 0;
  private finishing = false;
  private active = false;
  private fixes: { game: Game; cell: number; at: number; before?: (c: number) => void }[] = [];
  /** 当前浮起的豆子：棋盘上的一组，或空槽里的某种颜色 */
  private sel: { kind: 'board'; cells: number[]; color: number } | { kind: 'tray'; color: number } | null = null;
  /** 同色连通区域（拼完时闪一下） */
  private regions: number[][] = [];
  private regionDone = new Set<number>();
  private tipTimer = 0;

  // 本局状态
  private elfDrops = 0;
  private wished = new Set<PropId>();
  private hintsUsed = 0;
  private lastActionAt = 0;
  private lastPlaceAt = 0;
  private chainStreak = 0;
  private noPropsWarned = false;
  private pickAction: PickAction = null;
  private tweezersLeft = 0;
  private brushLeft = 0;
  private brushUntil = 0;
  private brushed = new Set<number>();
  private helperTimer = 0;
  private metricsTimer = 0;
  private meteorImg: HTMLCanvasElement;

  // DOM 引用
  private elTitle: HTMLElement;
  private elTimer: HTMLButtonElement;
  private elTimerText: HTMLElement;
  private elTaps: HTMLElement;
  private elProgress: HTMLElement;
  private elProgressText: HTMLElement;
  private elObjectives: HTMLElement;
  private elNeed: HTMLElement;
  private elNeedContent: HTMLElement;
  private elNeedToggle: HTMLButtonElement;
  private needUntil = 0;
  private needTimer = 0;
  private needPinned = false;
  private needPressTimer = 0;
  private needPressFired = false;
  // 关卡中断存档
  private ckptTimer = 0;
  private ckptId = '';
  private ckptSavedPlacements = -1;
  private lastChipsAt = 0;
  private elTray: HTMLElement;
  private elTrayInfo: HTMLElement;
  private elZoom: HTMLInputElement;
  private elCombo: HTMLElement;
  private elProps: HTMLElement;
  private cancelPropPress: () => void;
  private elBanner: HTMLElement;
  private elBuffs: HTMLElement;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private visHandler = () => document.hidden && this.pause();

  constructor(private host: GameScreenHost, fx: Fx) {
    this.fx = fx;
    const canvas = h('canvas.board') as HTMLCanvasElement;
    this.board = new BoardView(canvas, {
      onTapCell: (i) => this.onTapCell(i),
      onHover: (i) => this.onHover(i),
      onPick: (i) => this.onPick(i),
      onPaint: (i) => this.onPaint(i),
      onZoom: (t) => this.elZoom && (this.elZoom.value = String(Math.round(t * 100))),
    });
    this.elf = new Elf(fx, {
      onComboTap: (k) => this.onElfCombo(k),
      onWish: () => this.onWish(),
      onIdleHint: () => this.onIdleHint(),
    });
    this.meteorImg = makeMeteor();
    this.elTitle = h('div.level-title');
    this.elTimerText = h('span.timer-text', {}, '00:00');
    this.elTimer = h('button.timer', { onclick: () => this.onTimerTap(), title: '点我加时！' }, h('span.clock', {}, '⏰'), this.elTimerText) as HTMLButtonElement;
    this.elTaps = h('div.timer-taps');
    this.elProgress = h('div.progress-fill');
    this.elProgressText = h('div.progress-text');
    this.elObjectives = h('div.objectives');
    this.elNeedContent = h('div.need-content', { 'aria-live': 'polite', hidden: true });
    this.elNeedToggle = h('button.need-toggle', {
      onclick: () => this.showNeedHint(),
      onpointerdown: () => this.beginNeedPress(),
      onpointerup: () => this.cancelNeedPress(),
      onpointerleave: () => this.cancelNeedPress(),
      onpointercancel: () => this.cancelNeedPress(),
      'aria-expanded': 'false',
      title: '点按显示 2 秒 · 长按常驻 / 再长按收起',
    }, '💡 提示') as HTMLButtonElement;
    this.elNeed = h('div.need-bar', {}, this.elNeedToggle, this.elNeedContent);
    this.elTray = h('div.tray');
    this.elTrayInfo = h('div.tray-info');
    this.elCombo = h('div.combo');
    this.elProps = h('div.props-bar', { 'aria-label': '道具栏：单点使用，长按查看作用' });
    this.cancelPropPress = bindPropPress(this.elProps,
      () => this.active && !this.paused && this.game?.state === 'playing',
      id => void this.useProp(id), id => void this.showPropInfo(id));
    this.elBanner = h('div.mode-banner.hidden');
    this.elBuffs = h('div.buffs');
    this.elZoom = h('input.zoom-range', { type: 'range', min: 0, max: 100, value: 0, 'aria-label': '缩放' }) as HTMLInputElement;
    this.elZoom.addEventListener('input', () => this.board.setZoom01(+this.elZoom.value / 100));

    this.el = h(
      'div.game-screen',
      {},
      h(
        'header.hud',
        {},
        h('button.icon-btn', { onclick: () => this.pause(), title: '暂停 (Esc)' }, '⏸'),
        h('div.hud-center', {}, this.elTitle, h('div.timer-wrap', {}, this.elTimer, this.elTaps, this.elBuffs)),
        h('div.elf-slot', {}, this.elf.el),
      ),
      h('div.subbar', {}, h('div.progress', {}, this.elProgress, this.elProgressText), this.elObjectives),
      this.elNeed,
      h(
        'div.board-wrap',
        {},
        canvas,
        this.elCombo,
        this.elBanner,
        h(
          'div.zoom-ctrl',
          {},
          h('button.icon-btn.small', { onclick: () => this.onLocate(), title: '复位 / 下一个空位 (0 / Tab)' }, '⌖'),
          h('button.icon-btn.small', { onclick: () => this.board.zoomBy(1.4), title: '放大 (+)' }, '+'),
          this.elZoom,
          h('button.icon-btn.small', { onclick: () => this.board.zoomBy(1 / 1.4), title: '缩小 (-)' }, '−'),
        ),
      ),
      h('div.side', {}, h('div.tray-panel', { onclick: () => void this.onTapTray(-1) }, this.elTrayInfo, this.elTray), this.elProps, h('p.props-help', {}, '单点使用 · 长按查看作用')),
    );
  }

  // ---------- 生命周期 ----------

  async open(id: number, custom?: LevelDef) {
    clearTimeout(this.needTimer); this.needUntil = 0;
    this.needPinned = false;
    clearTimeout(this.needPressTimer);
    this.active = true;
    this.fixes = [];
    this.levelId = id;
    this.ckptId = custom ? custom.key : String(id); // 存档键：普通关卡用编号，自定义作品用图片哈希
    (window as any).__pp = this; // 调试 / 自动化测试用
    (window as any).__grant = grantProp;
    const def = custom ?? (await loadLevelDef(id));
    def.colors = separateColors(def.colors); // 相近色拉开，减轻眼疲劳
    this.game = new Game(def);
    // 闯关锁 2 个空槽：玩家可点开，但开了就拿不到第三颗星；自由创作没有星级，不锁
    if (def.mode !== 'custom') this.game.lockedSlots = defaultLockedSlots(this.game.capacity);
    this.sel = null;
    this.sprites = buildSprites(def.colors);
    this.board.colorBlind = save.data.settings.colorBlind;
    this.board.helperAt = -1;
    this.board.setMode('normal');
    this.trayHidden.clear();
    this.finishing = false;
    this.paused = false;
    this.elfDrops = 0;
    this.wished = new Set();
    this.hintsUsed = 0;
    this.chainStreak = 0;
    this.noPropsWarned = false;
    this.pickAction = null;
    this.tweezersLeft = 0;
    this.brushLeft = 0;
    this.brushUntil = 0;
    clearInterval(this.helperTimer);
    this.elf.reset();
    this.elf.setSkin(save.data.elfSkin);
    this.elTitle.textContent = custom ? `自由创作 · ${def.name}` : `第${id}关 · ${def.name}`;
    this.elTimer.title = custom ? '实际游玩时间（暂停不计时）' : '点我加时！';
    this.board.setGame(this.game, this.sprites);
    this.buildRegions();
    this.renderAll();
    this.setBanner(null);
    addEventListener('keydown', this.keyHandler);
    document.addEventListener('visibilitychange', this.visHandler);
    this.lastFrame = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((t) => this.frame(t));
    clearInterval(this.metricsTimer);
    this.metricsTimer = window.setInterval(() => this.updateElf(), 500);
    // 普通关卡每 10 秒自动存一次进度
    clearInterval(this.ckptTimer);
    this.ckptSavedPlacements = -1;
    this.ckptTimer = window.setInterval(() => this.autoSaveCheckpoint(), 10000);
    requestAnimationFrame(() => this.board.resize());
    await this.showStartCard(await loadCheckpoint(this.ckptId));
  }

  close() {
    clearTimeout(this.needTimer); this.needUntil = 0;
    this.needPinned = false;
    clearTimeout(this.needPressTimer);
    clearInterval(this.ckptTimer);
    this.cancelPropPress();
    this.active = false;
    this.fixes = [];
    cancelAnimationFrame(this.raf);
    clearInterval(this.metricsTimer);
    clearInterval(this.helperTimer);
    removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('visibilitychange', this.visHandler);
  }

  private frame(now: number) {
    const dt = Math.max(0, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused && this.game.tick(dt)) this.onOvertime();
    if (!this.paused && this.game.state === 'playing') {
      const ready = this.fixes.filter(f => f.game === this.game && f.at <= this.game.playedSeconds);
      this.fixes = this.fixes.filter(f => f.game === this.game && f.at > this.game.playedSeconds);
      for (const f of ready) {
        if (this.game.state !== 'playing') break;
        f.before?.(f.cell); this.fixOne(f.cell);
      }
    }
    if (this.paused && this.brushUntil) this.brushUntil += dt * 1000;
    if (!this.paused && this.brushUntil && now > this.brushUntil) this.endBrush();
    // 星级要求状态每秒刷新一次（时间类要求不点棋盘也会变化）
    if (!this.paused && now - this.lastChipsAt > 1000) {
      this.lastChipsAt = now;
      this.renderObjectives();
    }
    this.renderTimer();
    this.board.draw(now);
    this.fx.draw(now);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- 弹窗 ----------

  private async showStartCard(resume: LevelCheckpoint | null = null) {
    const def = this.game.def;
    if (def.mode === 'custom') {
      this.paused = true;
      const resumeInfo = resume
        ? h('div.ckpt-resume', {},
            h('div.obj-head', {}, '💾 发现上次的进度'),
            h('p.hint', {}, `已拼 ${Math.round(resume.progress * 100)}% · ${new Date(resume.savedAt).toLocaleString()} 保存`))
        : null;
      const buttons = resume
        ? [{ label: '▶ 从上次的进度继续', value: 'resume', cls: 'primary big' }, { label: '↻ 重新开始', value: 'fresh', cls: 'big' }]
        : [{ label: '开始我的创作', value: 'go', cls: 'primary big' }];
      const v = await dialog(h('div.start-card', {}, h('h2', {}, def.name), h('p', {}, `${def.w} × ${def.h} 格 · ${def.colors.length} 色 · ${def.wrongCount} 颗等待归位`),
        resumeInfo,
        h('p.hint', {}, '这里没有倒计时，所有道具（含隐藏道具）免费畅用。计时器记录实际游玩时间，暂停不计时。进度每 10 秒自动保存。'),
        h('p.hint', {}, '点击凸起的方豆，找到它需要的底色；归位后它会融入画面。')),
        buttons);
      if (v === 'fresh') clearCheckpoint(this.ckptId);
      if (v === 'resume' && this.game.restoreCheckpoint(resume!.game)) {
        this.elfDrops = resume!.screen?.elfDrops ?? 0;
        this.wished = new Set((resume!.screen?.wished ?? []) as PropId[]);
        this.ckptSavedPlacements = this.game.stats.placements;
        this.board.setGame(this.game, this.sprites);
        this.syncRegions();
        this.renderAll();
      }
      this.resume(); this.game.start(); return;
    }
    const tutorial = !save.data.seenTutorial;
    this.paused = true;
    const el = def.elements;
    const types: ElementType[] = [];
    if (el.ice.length) types.push('ice');
    if (el.star.length) types.push('star');
    if (el.fog.length) types.push('fog');
    if (el.lock) types.push('lock');
    if (el.bombs.length) types.push('bomb');
    const resumeInfo = resume
      ? h('div.ckpt-resume', {},
          h('div.obj-head', {}, '💾 发现上次的进度'),
          h('p.hint', {}, `已完成 ${Math.round(resume.progress * 100)}% · 剩余时间 ${fmtTime(resume.remaining)} · ${new Date(resume.savedAt).toLocaleString()} 自动保存`))
      : null;
    const body = h(
      'div.start-card',
      {},
      h('h2', {}, `第${def.id}关 · ${def.name}`),
      h('div.tag.diff-' + def.difficulty, {}, def.difficulty),
      resumeInfo,
      h(
        'div.facts',
        {},
        h('div', {}, h('b', {}, String(def.wrongCount)), h('span', {}, '颗放错')),
        h('div', {}, h('b', {}, String(this.game.usableCapacity)), h('span', {}, this.game.lockedSlots ? `个空槽 +🔒${this.game.lockedSlots}` : '个空槽')),
        h('div', {}, h('b', {}, fmtTime(def.timeLimit)), h('span', {}, '限时')),
      ),
      h('div.obj-list', {}, h('div.obj-head', {}, '★ 倒计时内通关'), ...def.objectives.map((o) => h('div', {}, `★ ${OBJECTIVE_ICON[o.type]} ${OBJECTIVE_TEXT[o.type](o.value)}`)),
        this.game.lockedSlots ? h('div', {}, `🔒 另有 ${this.game.lockedSlots} 个锁住的空槽，点它可以开启，但开启后本关最多 2 颗星`) : null, h('p.hint', {}, '游戏进行中，顶部的三颗星要求会实时点亮 ✓ / ✗；进度每 10 秒自动保存一次，也可以在暂停菜单手动保存。')),
      types.length
        ? h(
            'div.elements-intro',
            {},
            h('div.obj-head', {}, '本关特殊格子'),
            ...types.map((t) => h('div.element-row' + (save.data.seenElements.includes(t) ? '' : '.new'), {}, h('span.el-icon', {}, ELEMENT_INFO[t].icon), h('b', {}, ELEMENT_INFO[t].name), ' ', ELEMENT_INFO[t].desc)),
          )
        : null,
      tutorial
        ? h(
            'ol.howto',
            {},
            h('li', {}, '连续色块是正确底色，凸起的方豆就是放错了；归位后会融入底色。'),
            h('li', {}, '点一颗放错的豆子，它和连着的同色错位豆子会一起浮起来；再点一个同色的空孔，它们就填进去。'),
            h('li', {}, '没有同色空孔时，点下方的空槽把浮起的豆子先放进去；之后点空槽里的豆子、再点同色空孔，就能把它们拿出来。'),
            h('li', {}, '设置里的「自动填豆」：点到的豆子已经有同色空孔时，直接飞过去，不用再点空孔（进空槽仍由你决定）。'),
            h('li', {}, '空槽满了再放会爆槽失败；带 🔒 的空槽点开就能用，但本关最多 2 颗星。时间用完还能继续，但只能拿半星。'),
            h('li', {}, '右上角的啵啵：点它有惊喜，连点可能掉道具（每局 3 个），长按可以许愿（每局 3 次）。'),
          )
        : null,
    );
    const buttons = resume
      ? [{ label: '▶ 从上次的进度继续', value: 'resume', cls: 'primary big' }, { label: '↻ 重新开始', value: 'fresh', cls: 'big' }]
      : [{ label: '开始', value: 'go', cls: 'primary big' }];
    const v = await dialog(body, buttons);
    save.update((d) => {
      d.seenTutorial = true;
      for (const t of types) if (!d.seenElements.includes(t)) d.seenElements.push(t);
    });
    if (v === 'fresh') clearCheckpoint(this.ckptId);
    if (v === 'resume' && this.game.restoreCheckpoint(resume!.game)) {
      this.elfDrops = resume!.screen?.elfDrops ?? 0;
      this.wished = new Set((resume!.screen?.wished ?? []) as PropId[]);
      this.ckptSavedPlacements = this.game.stats.placements;
      this.board.setGame(this.game, this.sprites);
      this.syncRegions();
      this.renderAll();
    }
    this.paused = false;
    this.game.start();
    this.lastFrame = performance.now();
    this.lastActionAt = performance.now();
    this.elf.say(['开始啦，加油！', '一起把画拼好吧～', '我会在旁边给你打气！'][Math.floor(Math.random() * 3)], 2200, true);
  }

  // ---------- 关卡存档 ----------

  private buildCheckpoint(): LevelCheckpoint {
    const def = this.game.def;
    return {
      levelId: this.ckptId,
      savedAt: Date.now(),
      progress: this.game.progress,
      remaining: def.mode === 'custom' ? 0 : Math.max(0, this.game.timeLeft),
      game: this.game.saveCheckpoint(),
      screen: { elfDrops: this.elfDrops, wished: [...this.wished] },
      // 自定义作品带上关卡快照：小画室的「未完成的创作」入口可凭它直接续拼，无需重新上传图片
      ...(def.mode === 'custom'
        ? { name: def.name, def: { key: def.key, name: def.name, w: def.w, h: def.h, colors: [...def.colors], target: Array.from(def.target), beads: Array.from(def.beads) } }
        : {}),
    };
  }

  /** 自动保存：只在棋盘有新变化时写，避免空转 */
  private autoSaveCheckpoint() {
    if (!this.active || this.game.state !== 'playing' || this.finishing) return;
    if (this.game.stats.placements <= 0 && this.game.stats.newChains <= 0) return; // 只是倒计时在走、一颗豆都没动过（归位或开新链都算动过），不存
    if (this.game.stats.placements === this.ckptSavedPlacements) return;
    this.ckptSavedPlacements = this.game.stats.placements;
    saveCheckpoint(this.buildCheckpoint());
  }

  /** 手动保存（暂停菜单里点）；返回是否成功保存 */
  private manualSaveCheckpoint(): boolean {
    if (this.game.state !== 'playing') return false;
    if (this.game.stats.placements <= 0 && this.game.stats.newChains <= 0) return false; // 没有实际操作就没有可存的进度
    this.ckptSavedPlacements = this.game.stats.placements;
    saveCheckpoint(this.buildCheckpoint());
    return true;
  }

  private async pause() {
    if (this.paused || this.game.state !== 'playing') return;
    this.paused = true;
    const buttons: { label: string; value: string }[] = [];
    if (this.game.progress > 0) buttons.push({ label: '💾 保存进度', value: 'save' });
    buttons.push({ label: '重新开始', value: 'restart' }, { label: '关卡地图', value: 'map' });
    const v = await openSettings(buttons);
    this.board.colorBlind = save.data.settings.colorBlind;
    this.renderNeed();
    if (v === 'save') {
      if (this.manualSaveCheckpoint()) toast('💾 进度已保存，下次进入本关可以继续');
      else toast('还没有可保存的进度');
      this.resume();
      return;
    }
    if (v === 'restart') {
      clearCheckpoint(this.ckptId);
      return this.replay();
    }
    if (v === 'map') {
      // 离开关卡前把进度存一份，下次进来可以接着拼
      if (this.game.state === 'playing' && this.game.progress > 0) this.manualSaveCheckpoint();
      return this.host.toMap();
    }
    this.resume();
  }

  private resume() {
    this.paused = false;
    this.lastFrame = performance.now();
    this.lastActionAt = performance.now();
  }

  private replay() {
    if (this.game.def.mode === 'custom') this.host.playCustom(this.game.def);
    else this.host.play(this.levelId);
  }

  private stock(id: PropId) { return this.game.def.mode === 'custom' ? Infinity : propCount(id); }
  private availableUses(id: PropId) { return this.game.def.mode === 'custom' ? Infinity : PROP_MAP[id].perGame - this.game.uses(id); }
  private spend(id: PropId) { if (this.game.def.mode !== 'custom') addProp(id, -1); }
  private shareButton() {
    const g = this.game;
    return h('button.btn.primary.share-cta', { onclick: async () => {
      const data = { level: g.def, seconds: g.playedSeconds, propsUsed: g.stats.propsUsed };
      const existing = g.def.mode === 'custom' ? await loadWallWork(g.def.key).catch(() => undefined) : undefined;
      await openShareStudio(data, g.def.mode === 'custom' ? { initial: existing?.options, onSave: async options => { await rememberArtwork(data, options); } } : {});
    } }, '✧ 制作我的分享卡');
  }

  private async onBurst(cell: number) {
    this.paused = true;
    sfx.error();
    this.haptic([60, 40, 120]);
    this.board.shakeBoard();
    this.updateElf();
    clearCheckpoint(this.ckptId); // 爆槽即失败：这局 10 秒自动存的进度作废；选择复活后立刻重建
    const c = this.board.cellClientCenter(cell);
    this.fx.burst(c.x, c.y, { n: 20, colors: ['#ff5252', '#ff8a80'], speed: 6 });
    await new Promise((r) => setTimeout(r, 500));
    const g = this.game;
    const buttons: { label: string; value: string; cls?: string }[] = [];
    if (this.stock('phoenix') > 0 && this.availableUses('phoenix') > 0) buttons.push({ label: '🪶 凤凰羽毛复活', value: 'phoenix', cls: 'primary gold' });
    if (g.canRevive) {
      if (this.stock('expand') > 0 && this.availableUses('expand') > 0) buttons.push({ label: `📦 扩槽箱 +4（${g.def.mode === 'custom' ? '免费' : '×' + propCount('expand')}）`, value: 'expand', cls: 'primary' });
      if (this.stock('broom') > 0 && this.availableUses('broom') > 0) buttons.push({ label: `🧹 扫把洗牌（${g.def.mode === 'custom' ? '免费' : '×' + propCount('broom')}）`, value: 'broom', cls: 'primary' });
    }
    buttons.push({ label: '关卡地图', value: 'map' }, { label: '再来一次', value: 'retry' });
    const canSave = buttons.length > 2;
    const v = await dialog(
      h(
        'div.result.fail',
        {},
        h('h2', {}, '爆槽啦！'),
        h('p', {}, '空槽已满，这颗豆子没地方放了。'),
        canSave ? h('p.hint', {}, g.def.mode === 'custom' ? '自由创作可无限次免费续命，慢慢来。' : `可以用道具续命（本局还能续命 ${2 - g.stats.revives} 次，凤凰羽毛不占次数）`) : h('p.hint', {}, '小技巧：先点闪烁空位需要的颜色，不占空槽；必须进槽时挑小的一组。'),
      ),
      buttons,
    );
    if (v === 'phoenix') {
      g.consumeProp('phoenix', 1);
      this.spend('phoenix');
      const cells = g.phoenix(Math.random);
      this.fx.burst(innerWidth / 2, innerHeight / 2, { n: 60, colors: ['#ff7043', '#ffd54f', '#ff5252'], speed: 9, size: 7, life: 60, shape: 'spark' });
      sfx.win();
      this.popCells(cells);
      toast(g.def.mode === 'custom' ? '凤凰涅槃！空槽清空，继续创作' : '凤凰涅槃！空槽清空，+30 秒');
    } else if (v === 'expand') {
      g.consumeProp('expand', PROP_MAP.expand.perGame);
      this.spend('expand');
      g.revive(4);
      toast('空槽 +4，继续加油！');
    } else if (v === 'broom') {
      g.consumeProp('broom', PROP_MAP.broom.perGame);
      this.spend('broom');
      const changed = g.reviveWithBroom(Math.random) ?? [];
      this.popCells(changed);
      toast('洗牌完成，空槽清空！');
    } else if (v === 'retry') {
      return this.replay();
    } else return this.host.toMap();
    this.manualSaveCheckpoint(); // 复活成功：马上重建中断存档，续命后的进度不丢
    this.trayHidden.clear();
    this.renderAll();
    this.elf.react('clap');
    this.resume();
    if ((g.state as string) === 'won') this.onWin();
  }

  private async onWin() {
    if (this.finishing || !this.active || this.game.state !== 'won') return;
    this.finishing = true;
    this.endModes();
    const g = this.game;
    clearCheckpoint(this.ckptId); // 通关后清掉中断存档
    if (g.def.mode === 'custom') {
      const best = customRecords().filter(r => r.key === g.def.key).reduce((n, r) => Math.min(n, r.seconds), Infinity);
      const stored = recordCustom({ key: g.def.key, name: g.def.name, seconds: g.playedSeconds, propsUsed: g.stats.propsUsed, completedAt: Date.now() });
      const collected = await rememberArtwork({ level: g.def, seconds: g.playedSeconds, propsUsed: g.stats.propsUsed }).then(() => true, () => false);
      if (!this.active || this.game !== g) return;
      this.board.fit(); this.fx.confetti(); sfx.win();
      const v = await dialog(h('div.result', {}, h('div.studio-eyebrow', {}, 'A LITTLE MASTERPIECE'), h('h2', {}, '喜欢的画，亲手完成了'),
        h('p', {}, g.def.name), h('div.custom-finish-time', {}, fmtTime(g.playedSeconds)), h('p.hint', {}, `实际游玩时间 · ${g.stats.propsUsed ? `使用道具 ${g.stats.propsUsed} 次` : '纯手作完成'}`),
        h('p.hint', {}, stored ? (g.playedSeconds < best ? '本图近期最佳记录，已保存在此设备' : `本图近期最佳 ${fmtTime(best)} · 记录已保存在此设备`) : '浏览器暂时无法保存记录，可下载分享卡留念'),
        h('p.hint', {}, collected ? '已收进小画室的作品墙，随时回来换相框、重新布置。' : '作品墙暂时无法保存，仍可下载分享卡留念。'),
        this.shareButton()), [{ label: '返回地图', value: 'map' }, { label: '再拼一次', value: 'retry' }, { label: '回小画室布置', value: 'wall', cls: 'primary' }]);
      if (v === 'retry') this.replay(); else if (v === 'wall') this.host.toStudio(); else this.host.toMap();
      return;
    }
    const stars = g.stars();
    const id = this.levelId;
    const prevBest = save.data.best[id] ?? 0;
    save.update((d) => {
      recordLevelWin(d, id, stars);
      d.unlocked = Math.max(d.unlocked, Math.min(LEVEL_COUNT, id + 1));
    });
    this.updateElf();
    await new Promise((r) => setTimeout(r, 450));
    this.fx.confetti();
    sfx.win();
    this.board.fit();
    await new Promise((r) => setTimeout(r, 900));
    const row = starRow(0, 3, 'big');
    const objRows = g.def.objectives.map((o) => h('div.obj' + (!g.overtime && g.objectiveMet(o) ? '.ok' : '.no'), {}, `${OBJECTIVE_ICON[o.type]} ${OBJECTIVE_TEXT[o.type](o.value)}`));
    const s = g.stats;
    const draws = stars >= 3 ? 1 + (g.cloverActive ? 1 : 0) : 0;
    const body = h(
      'div.result',
      {},
      h('h2', {}, g.overtime ? '加时通关！' : stars >= 3 ? '完美通关！' : '通关！'),
      row,
      g.overtime ? h('p.hint', {}, '超时后通关只能得半星，下次试试在倒计时内完成～') : null,
      !g.overtime && g.slotsUnlocked ? h('p.hint', {}, '本局开启了锁住的空槽，最多 2 颗星；下次试试不开锁槽通关～') : null,
      draws ? h('p.hint.gold', {}, `三星奖励：扭蛋 ${draws} 次${g.cloverActive ? '（四叶草加成）' : ''}`) : null,
      h(
        'div.stats',
        {},
        h('div', {}, h('span', {}, '用时'), h('b', {}, fmtTime(g.elapsed))),
        h('div', {}, h('span', {}, '得分'), h('b', {}, String(g.finalScore()))),
        h('div', {}, h('span', {}, '最大连击'), h('b', {}, String(s.maxCombo))),
        h('div', {}, h('span', {}, '开新链'), h('b', {}, String(s.newChains))),
        h('div', {}, h('span', {}, '空槽峰值'), h('b', {}, String(s.slotPeak))),
        h('div', {}, h('span', {}, '历史最佳'), h('b', {}, '★'.repeat(Math.floor(Math.max(prevBest, stars))) + (Math.max(prevBest, stars) % 1 ? '½' : ''))),
      ),
      h('div.obj-list', {}, ...objRows),
      this.shareButton(),
    );
    const fillStars = async () => {
      const spans = row.querySelectorAll('.star');
      for (let k = 0; k < 3; k++) {
        await new Promise((r) => setTimeout(r, 380));
        const kind = stars >= k + 1 ? 'full' : stars >= k + 0.5 ? 'half' : '';
        if (!kind) break;
        spans[k].className = 'star pop ' + kind;
        sfx.star(k);
      }
    };
    const after = [
      { label: '关卡地图', value: 'map' },
      { label: '重玩', value: 'retry' },
    ];
    if (id < LEVEL_COUNT) after.push({ label: '下一关', value: 'next', cls: 'primary' } as any);
    const p = dialog(body, draws ? [{ label: `🎁 去扭蛋 ×${draws}`, value: 'lottery', cls: 'primary gold big' }] : after);
    fillStars();
    let v = await p;
    if (v === 'lottery') {
      const prizes = await openLottery(draws, g.cloverActive);
      for (const pr of prizes) if (pr.rarity !== 'common' && HIDDEN_PROPS.every((x) => save.data.collected.includes(x.id)) && save.data.elfSkin !== 'gold') save.update((d) => (d.elfSkin = 'gold'));
      this.elf.setSkin(save.data.elfSkin);
      this.renderProps();
      v = await dialog(h('div.result', {}, h('h2', {}, '奖励已放进背包'), starRow(stars, 3, 'big')), after);
    }
    if (v === 'retry') this.host.play(id);
    else if (v === 'next') this.host.play(id + 1);
    else this.host.toMap();
  }

  // ---------- 点击棋盘 ----------

  private onTapCell(i: number) {
    if (this.paused || this.game.state !== 'playing') return;
    this.lastActionAt = performance.now();
    const g = this.game;
    const b = g.beads[i];
    const t = g.target[i];
    // 冰封 / 锁链：沿用原来的点击反馈（敲冰、提示解锁）
    if (b >= 0 && b !== t && (g.ice[i] || g.locked[i])) {
      this.clearSel();
      this.handleResult(g.tap(i));
      return;
    }
    const sel = this.sel;
    if (sel) {
      if (sel.kind === 'board' && sel.cells.includes(i)) {
        // 再点一下浮起的豆子：放回去
        this.clearSel();
        sfx.drop();
        return;
      }
      if (b < 0) {
        if (t !== sel.color) return this.wrongHole();
        const res = sel.kind === 'board' ? g.placeGroup(sel.cells, i) : g.trayToHoles(sel.color, i);
        const from = sel.kind === 'board' ? sel.cells : [];
        this.clearSel();
        this.handleResult(res, from, sel.kind === 'tray');
        return;
      }
      if (g.movable(i)) return this.lift(i); // 换一组
      return this.wrongHole(); // 点到了已归位的豆子
    }
    if (b < 0) {
      sfx.pick();
      this.showTip(g.slots.includes(t) ? '点下方空槽里的豆子，再点这个孔' : '先点一颗放错的豆子，再点同色的孔');
      return;
    }
    if (b === t) {
      sfx.locked();
      return;
    }
    this.lift(i);
  }

  // ---------- 浮起 / 放下 ----------

  private get autoFill() {
    return save.data.settings.autoFill;
  }

  /** 点一颗错位豆子：有同色空孔且开了自动填豆就直接飞过去，否则整组浮起等玩家点目的地 */
  private lift(i: number) {
    const g = this.game;
    const cells = g.groupAt(i);
    if (!cells.length) return;
    const color = g.beads[i];
    if (this.autoFill && g.holesFor(color) > 0) {
      this.clearSel();
      this.handleResult(g.placeGroup(cells));
      return;
    }
    this.sel = { kind: 'board', cells, color };
    this.board.setLifted(cells);
    this.board.setGroupPreview([]);
    sfx.pick();
    this.haptic(8);
    if (cells.length > 1) {
      const c = this.board.cellClientCenter(i);
      floatText(`×${cells.length}`, c.x, c.y - 14);
    }
    this.renderTray();
  }

  private clearSel() {
    if (!this.sel) return;
    this.sel = null;
    this.board.setLifted([]);
    this.renderTray();
  }

  /** 棋盘变了（道具、撤回、洗牌）之后，浮起的豆子不再成立就放下 */
  private validateSel() {
    const g = this.game;
    const sel = this.sel;
    if (!sel) return;
    const ok = sel.kind === 'board'
      ? sel.cells.every((c) => g.movable(c) && g.beads[c] === sel.color)
      : g.slots.includes(sel.color);
    if (!ok) {
      this.sel = null;
      this.board.setLifted([]);
    }
  }

  private wrongHole() {
    sfx.wrongHole();
    this.haptic(15);
    this.showTip('要放在相同颜色孔上哦');
  }

  /** 录屏里那条从左侧滑入的紫色提示条 */
  private showTip(text: string) {
    this.setBanner(h('div.tray-tip', {}, text));
    this.elBanner.classList.add('tip');
    clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => {
      this.elBanner.classList.remove('tip');
      this.updateBanner();
    }, 1400);
  }

  /** 点空槽（k = 点到的格子，-1 = 空白处） */
  private async onTapTray(k: number) {
    const g = this.game;
    if (this.paused || g.state !== 'playing') return;
    this.lastActionAt = performance.now();
    if (k >= g.usableCapacity && k < g.capacity && g.lockedSlots > 0) {
      await this.promptUnlock();
      return;
    }
    const sel = this.sel;
    // An occupied slot is a selection target, even while board beads are lifted.
    // Only an empty slot / panel background means "put this group in the tray".
    const clickedBead = k >= 0 && k < g.slots.length;
    if (sel?.kind === 'board' && !clickedBead) {
      if (g.freeSlots <= 0 && g.lockedSlots > 0) {
        if (!(await this.promptUnlock('空槽满了'))) return;
        if (this.sel !== sel) return;
      }
      const res = g.groupToTray(sel.cells);
      this.clearSel();
      this.handleResult(res, sel.cells);
      return;
    }
    // 空槽里的豆子：点到哪颗算哪种颜色；点空白处取第一种有空孔的颜色
    if (!g.slots.length) {
      sfx.pick();
      this.showTip('先点一颗放错的豆子');
      return;
    }
    const color = k >= 0 && k < g.slots.length ? g.slots[k] : (g.slots.find((c) => g.holesFor(c) > 0) ?? g.slots[0]);
    if (sel?.kind === 'tray' && sel.color === color) {
      this.clearSel();
      sfx.drop();
      return;
    }
    const hasHoles = g.holesFor(color) > 0;
    if (this.autoFill && hasHoles && sel?.kind !== 'board') {
      this.clearSel();
      this.handleResult(g.trayToHoles(color));
      return;
    }
    this.sel = { kind: 'tray', color };
    this.board.setLifted([]);
    sfx.pick();
    this.haptic(8);
    this.renderTray();
    if (!hasHoles) this.showTip('还没有空孔需要这个颜色，先移开棋盘上的豆子');
  }

  /** 开启锁住的空槽（开启后本关最多 2 星） */
  private async promptUnlock(reason = ''): Promise<boolean> {
    const g = this.game;
    if (g.lockedSlots <= 0) return false;
    this.paused = true;
    const v = await dialog(
      h('div', {}, h('h2', {}, `🔒 开启 ${g.lockedSlots} 个锁住的空槽？`),
        reason ? h('p', {}, reason + '，开启后可以继续放豆子。') : null,
        h('p', {}, '开启后本关最多只能获得 2 颗星，无法拿到第三颗星。')),
      [{ label: '先不开', value: 'no' }, { label: '开启（放弃第三颗星）', value: 'yes', cls: 'primary' }],
    );
    this.resume();
    if (v !== 'yes' || !g.unlockSlots()) return false;
    sfx.star(0);
    this.elTray.parentElement!.classList.add('grow');
    setTimeout(() => this.elTray.parentElement!.classList.remove('grow'), 600);
    toast('空槽已开启，本关最多 2 颗星');
    this.renderAll();
    return true;
  }

  private handleResult(res: TapResult, liftedFrom: number[] = [], liftedTray = false) {
    switch (res.type) {
      case 'ignored':
        return;
      case 'locked':
        sfx.locked();
        return;
      case 'blocked': {
        sfx.error();
        this.board.shakeBoard();
        toast('锁链格：先把锁上那种颜色的格子全部归位');
        const now = performance.now();
        for (const c of this.game.magnetTargets(res.lockColor, 999)) this.board.hints.set(c, now + 1800);
        return;
      }
      case 'ice': {
        const c = this.board.cellClientCenter(res.cell);
        this.fx.burst(c.x, c.y, { n: 14, colors: ['#e1f5fe', '#b3e5fc', '#ffffff'], shape: 'square', speed: 4, size: Math.max(3, c.size * 0.12), life: 30, gravity: 0.15 });
        sfx.pick();
        this.handleEvents(res.events);
        this.renderAll();
        return;
      }
      case 'burst':
        this.onBurst(res.cell);
        return;
      case 'moved':
        this.animateMoves(res.moves, liftedFrom, liftedTray);
        sfx.pick();
        this.haptic(10);
        this.board.setGroupPreview([]);
        if (res.newChain) this.chainStreak++;
        else if (res.placed) this.chainStreak = 0;
        if (res.placed) this.lastPlaceAt = performance.now();
        if (res.moved > 1) {
          const c = this.board.cellClientCenter(res.moves[0].kind === 'slotToCell' ? res.moves[0].to : res.moves[0].from);
          floatText(`×${res.moved}`, c.x, c.y - 10, res.newChain ? '' : 'gold');
        }
        this.handleEvents(res.events);
        this.renderAll();
        if (res.won) this.scheduleWin(res.moves.length);
    }
  }

  private scheduleWin(nMoves: number) {
    const delay = nMoves * this.stagger(nMoves) + FLIGHT_MS + 50;
    const game = this.game;
    setTimeout(() => { if (this.active && this.game === game) void this.onWin(); }, delay);
  }

  /** 特殊格子事件的反馈 */
  private handleEvents(ev: Events) {
    for (const c of ev.stars) {
      const p = this.board.cellClientCenter(c);
      this.fx.burst(p.x, p.y, { n: 16, colors: ['#ffd54f', '#fff'], shape: 'star', speed: 5, size: 6, life: 36 });
      floatText('+3秒', p.x, p.y - 10, 'gold');
      sfx.star(1);
    }
    if (ev.unlocked.length) {
      for (const c of ev.unlocked) {
        const p = this.board.cellClientCenter(c);
        this.fx.burst(p.x, p.y, { n: 10, colors: ['#9e9e9e', '#ffd54f'], shape: 'square', speed: 4, size: 4, life: 30, gravity: 0.2 });
      }
      toast('🔓 锁链解开了！');
      sfx.win();
    }
    for (const b of ev.bombs) {
      const p = this.board.cellClientCenter(b.cell);
      this.fx.explosion(p.x, p.y, 2);
      sfx.boom(2);
      this.board.shakeBoard();
      this.haptic([50, 30, 100]);
      toast(b.scrambled.length ? `💣 炸弹爆炸！周围 ${b.scrambled.length} 颗被打乱` : '💣 炸弹爆炸了，还好周围没什么损失');
      this.elf.react('startle');
    }
    for (const c of ev.defused) {
      if (ev.bombs.some((b) => b.cell === c)) continue;
      const p = this.board.cellClientCenter(c);
      floatText('拆除！', p.x, p.y - 10, 'gold');
    }
    for (const c of ev.fogCleared) {
      const p = this.board.cellClientCenter(c);
      this.fx.burst(p.x, p.y, { n: 5, colors: ['rgba(255,255,255,0.9)'], speed: 2, size: Math.max(4, p.size * 0.3), life: 30 });
    }
  }

  private animateMoves(moves: Move[], liftedFrom: number[] = [], liftedTray = false) {
    const lifted = new Set(liftedFrom);
    const now = performance.now();
    const stagger = this.stagger(moves.length);
    // 进槽的豆子在最终托盘里占的位置：该颜色区间的最后几格，落地前隐藏
    const toSlot = moves.filter((m) => m.kind === 'cellToSlot');
    const slotTargets: number[] = [];
    if (toSlot.length) {
      const c = toSlot[0].color;
      const last = this.game.slots.lastIndexOf(c);
      for (let k = toSlot.length - 1; k >= 0; k--) slotTargets.push(last - k);
      slotTargets.forEach((t) => this.trayHidden.add(t));
    }
    this.renderTray();

    let slotK = 0;
    moves.forEach((m, k) => {
      const delay = k * stagger;
      const img = this.sprites.beads[m.color];
      if (m.kind === 'cellToCell' || m.kind === 'slotToCell') {
        const to = m.to;
        this.board.arriving.set(to, now + delay + FLIGHT_MS);
        const from = m.kind === 'cellToCell' ? this.cellPt(m.from, lifted.has(m.from)) : this.slotPt(m.slot, liftedTray);
        this.fx.fly(img, from, this.cellPt(to), FLIGHT_MS, delay, () => this.onLand(to, m.color));
      } else {
        const slot = slotTargets[slotK++];
        this.fx.fly(img, this.cellPt(m.from, lifted.has(m.from)), this.slotPt(slot), FLIGHT_MS, delay, () => {
          this.trayHidden.delete(slot);
          this.renderTray();
          sfx.slot();
        });
      }
    });
  }

  /** 一次移动多颗时缩短间隔，整组大约 0.6 秒内飞完 */
  private stagger(n: number) {
    return n <= 3 ? STAGGER_MS : Math.max(30, Math.round(600 / n));
  }

  private onHover(i: number) {
    const group = i >= 0 && !this.sel && this.game.state === 'playing' && !this.paused && this.board.mode === 'normal' ? this.game.groupAt(i) : [];
    this.board.setGroupPreview(group);
  }

  private onLand(cell: number, color: number) {
    const s = this.game.stats;
    sfx.place(s.combo);
    const c = this.board.cellClientCenter(cell);
    if (this.game.isCorrect(cell)) this.fx.burst(c.x, c.y, { n: 8, colors: [this.game.def.colors[color], '#ffffff'], speed: 3, size: Math.max(3, c.size * 0.15), life: 22, shape: 'star' });
    if (s.combo >= 3) {
      this.elCombo.textContent = `连击 ×${s.combo}`;
      this.elCombo.classList.remove('pop');
      void this.elCombo.offsetWidth;
      this.elCombo.classList.add('pop');
    }
  }

  /** raised = 从浮起的位置起飞 */
  private cellPt(i: number, raised = false) {
    const lift = raised ? this.board.cam.s * 0.26 : 0;
    return () => {
      const c = this.board.cellClientCenter(i);
      return { x: c.x, y: c.y - lift, size: c.size * (raised ? 1.1 : 1) };
    };
  }

  private slotPt(k: number, raised = false) {
    return () => {
      const el = this.elTray.children[k] as HTMLElement | undefined;
      const r = (el ?? this.elTray).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 - (raised ? 7 : 0), size: r.width * 1.3 * (raised ? 1.12 : 1) };
    };
  }

  /** 格子内容整体变化（洗牌、复活）时的出现动画 */
  private popCells(cells: number[]) {
    const now = performance.now();
    cells.forEach((c, k) => {
      this.board.arriving.set(c, now + 80 + (k % 30) * 15);
      if (k % 4 === 0) {
        const p = this.board.cellClientCenter(c);
        this.fx.burst(p.x, p.y, { n: 4, colors: ['rgba(255,255,255,0.95)', '#d1c4e9'], speed: 2, size: Math.max(3, p.size * 0.25), life: 24 });
      }
    });
  }

  // ---------- 同色区域拼完的高光 ----------

  private buildRegions() {
    const g = this.game;
    const n = g.target.length;
    const of = new Int32Array(n).fill(-1);
    const regions: number[][] = [];
    for (let i = 0; i < n; i++) {
      if (g.target[i] < 0 || of[i] >= 0) continue;
      const id = regions.length;
      const cells = [i];
      of[i] = id;
      for (let q = 0; q < cells.length; q++) {
        const c = cells[q];
        const x = c % g.w;
        for (const nb of [x > 0 ? c - 1 : -1, x < g.w - 1 ? c + 1 : -1, c - g.w, c + g.w]) {
          if (nb < 0 || nb >= n || of[nb] >= 0 || g.target[nb] !== g.target[i]) continue;
          of[nb] = id;
          cells.push(nb);
        }
      }
      regions.push(cells);
    }
    this.regions = regions;
    this.syncRegions();
  }

  /** 静默同步已完成的区域（开局 / 读档时不放特效） */
  private syncRegions() {
    this.regionDone = new Set();
    this.regions.forEach((cells, id) => cells.every((c) => this.game.isCorrect(c)) && this.regionDone.add(id));
  }

  /** 新拼完的区域：等豆子落地后扫一道高光并「叮」一声 */
  private checkRegions() {
    const g = this.game;
    if (!g || !this.regions.length) return;
    const now = performance.now();
    let latest = -1;
    this.regions.forEach((cells, id) => {
      const done = cells.every((c) => g.isCorrect(c));
      if (!done) {
        this.regionDone.delete(id);
        return;
      }
      if (this.regionDone.has(id)) return;
      this.regionDone.add(id);
      let start = now;
      for (const c of cells) start = Math.max(start, this.board.arriving.get(c) ?? now);
      start += 40;
      this.board.shine(cells, start);
      if (cells.length >= 3) latest = Math.max(latest, start);
    });
    if (latest >= 0) {
      const game = g;
      setTimeout(() => this.active && this.game === game && sfx.complete(), latest - now);
    }
  }

  // ---------- 计时器 ----------

  private onTimerTap() {
    if (this.game.def.mode === 'custom') { toast('正在记录实际游玩时间，慢慢拼就好'); return; }
    const g = this.game;
    const r = this.elTimer.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (this.paused || g.state !== 'playing') return;
    this.elf.react('startle');
    if (g.tapTimer()) {
      const level = g.timerTaps;
      this.fx.explosion(x, y, level);
      sfx.boom(level);
      this.haptic(level >= 3 ? [40, 30, 80] : 30);
      floatText('+10秒', x, y + 30, 'gold');
      this.bumpTimer();
      this.renderTaps();
    } else {
      this.fx.explosion(x, y, 1);
      sfx.boom(1);
      toast(g.overtime ? '已经超时啦，加油画完它！' : '本局加时次数用完啦');
    }
  }

  private bumpTimer() {
    this.elTimer.classList.remove('boom');
    void this.elTimer.offsetWidth;
    this.elTimer.classList.add('boom');
  }

  private onOvertime() {
    sfx.overtime();
    this.haptic([80, 50, 80]);
    toast('时间到！可以继续，但通关只能得半星', 2600);
    this.renderTaps();
    this.renderProps();
  }

  // ---------- 小精灵 ----------

  private onElfCombo(k: number): DropResult {
    if (this.game.def.mode === 'custom') { this.elf.say('全部道具已为你准备好啦！', 1800, true); return 'none'; }
    if (this.paused || this.game.state !== 'playing') return 'none';
    if (this.elfDrops >= ELF_DROPS_PER_GAME) return 'empty';
    const chance = ELF_DROP_CHANCE[Math.min(k, ELF_DROP_CHANCE.length) - 1];
    if (Math.random() >= chance) return 'none';
    this.elfDrops++;
    let id: PropId;
    const r = Math.random();
    if (this.levelId >= 3 && r < 0.1) id = rollHidden(Math.random, r < 0.03 ? 'epic' : 'rare', new Set(save.data.collected as PropId[]));
    else id = rollCommon(Math.random);
    const { isNew } = grantProp(id);
    this.giftAnimation(id, isNew);
    return 'dropped';
  }

  private async onWish() {
    if (this.game.def.mode === 'custom') { toast('自由创作中，全部隐藏道具都能直接使用'); return; }
    if (this.game.state !== 'playing' || this.paused) {
      this.elf.say('开始游戏后再许愿吧～', 1800, true);
      return;
    }
    this.paused = true;
    const id = await openWishPool(this.wished, WISHES_PER_GAME - this.wished.size);
    this.resume();
    if (!id) return;
    this.wished.add(id);
    grantProp(id);
    this.elf.react('gift');
    this.elf.say(`愿望实现啦：${PROP_MAP[id].name}！`, 2200, true);
    this.giftAnimation(id, false);
  }

  private onIdleHint(): boolean {
    if (this.hintsUsed >= 3 || this.paused || this.game.state !== 'playing') return false;
    const cells = this.game.hintCells();
    if (!cells.length) return false;
    this.hintsUsed++;
    const now = performance.now();
    cells.slice(0, 3).forEach((c) => this.board.hints.set(c, now + 3000));
    this.lastActionAt = now;
    return true;
  }

  private updateElf() {
    if (!this.game) return;
    const g = this.game;
    const now = performance.now();
    this.elf.update({
      state: g.state,
      overtime: g.overtime,
      timeRatio: g.def.mode === 'custom' ? 1 : Math.max(0, g.timeLeft) / g.def.timeLimit,
      slotRatio: g.slots.length / Math.max(1, g.usableCapacity),
      combo: now - this.lastPlaceAt < 1500 ? g.stats.combo : 0,
      progress: g.progress,
      chainStreak: this.chainStreak,
      idle: this.paused ? 0 : (now - this.lastActionAt) / 1000,
    });
  }

  /** 精灵吐出礼物盒，道具图标飞进道具栏 */
  private giftAnimation(id: PropId, isNew: boolean) {
    const p = PROP_MAP[id];
    const r = this.elf.el.getBoundingClientRect();
    const box = h('div.gift-box' + (p.hidden ? '.golden' : ''), { style: { left: r.left + r.width / 2 + 'px', top: r.top + r.height + 'px' } }, '🎁');
    document.body.append(box);
    sfx.star(2);
    setTimeout(() => {
      box.textContent = p.icon;
      box.classList.add('open');
      if (p.hidden) this.fx.burst(r.left + r.width / 2, r.top + r.height + 30, { n: 40, colors: ['#ffd54f', '#fff', '#ffb300'], shape: 'star', speed: 7, size: 6, life: 50 });
      floatText(p.name + (isNew ? ' · 新图鉴！' : ''), r.left + r.width / 2 - 40, r.top + r.height + 60, p.hidden ? 'gold' : '');
    }, 500);
    setTimeout(() => {
      this.renderProps();
      const btn = this.elProps.querySelector<HTMLElement>(`[data-prop="${id}"]`);
      const t = (btn ?? this.elProps).getBoundingClientRect();
      box.style.transition = 'left .5s ease-in, top .5s ease-in, transform .5s, opacity .5s';
      box.style.left = t.left + t.width / 2 + 'px';
      box.style.top = t.top + t.height / 2 + 'px';
      box.style.transform = 'translate(-50%,-50%) scale(.5)';
      box.style.opacity = '0.3';
      setTimeout(() => {
        box.remove();
        btn?.classList.add('got');
        setTimeout(() => btn?.classList.remove('got'), 600);
      }, 520);
    }, 1300);
    if (isNew) toast(`✨ 发现隐藏道具：${p.name}！`, 2600);
  }

  // ---------- 道具 ----------

  private async showPropInfo(id: PropId) {
    if (this.paused || !this.active || this.game.state !== 'playing') return;
    const g = this.game, p = PROP_MAP[id];
    const custom = g.def.mode === 'custom';
    const descriptions: Partial<Record<PropId, string>> = {
      hourglass: '闯关时可增加 30 秒倒计时。自由创作本来就不限时，使用不会改变完成用时。',
      amber: '闯关时可冻结倒计时 20 秒。自由创作仍会记录实际游玩时间，不会扣掉这 20 秒。',
      phoenix: '被动道具：爆槽后可选择凤凰羽毛，清空空槽并继续创作。可重复使用，不改变完成用时。',
      clover: '闯关时可增加三星扭蛋奖励。自由创作可以激活幸运陪伴，但不发放扭蛋奖励。',
    };
    this.paused = true;
    await dialog(h('div.prop-info', {}, h('div.prop-info-icon', { 'aria-hidden': 'true' }, p.icon), h('h2', {}, p.name),
      h('p.prop-info-description', {}, custom ? descriptions[id] ?? p.desc : p.desc),
      h('p.hint', {}, custom ? '自由创作 · 免费无限使用' : `背包剩余 ${this.stock(id)} 个 · 本局还可用 ${Math.max(0, this.availableUses(id))} 次`),
      h('p.hint', {}, '查看说明不会消耗道具，阅读期间游戏已暂停。')),
      [{ label: '知道了', value: 'close', cls: 'primary' }]);
    if (this.active && this.game === g) this.resume();
  }

  private renderProps() {
    const g = this.game;
    if (!g) return;
    const list = PROPS.filter((p) => g.def.mode === 'custom' || !p.hidden || propCount(p.id) > 0 || g.uses(p.id) > 0);
    this.elProps.replaceChildren(
      ...list.map((p, k) => {
        const n = this.stock(p.id);
        const left = this.availableUses(p.id);
        const usable = n > 0 && left > 0 && this.propAvailable(p.id);
        return h(
          'button.prop-btn' + (p.hidden ? '.hidden-prop.' + p.rarity : '') + (usable ? '' : '.off') + (p.id === 'clover' && g.cloverActive ? '.active' : ''),
          { 'data-prop': p.id, 'aria-label': `${p.name}，单点使用，长按查看作用`, title: `${p.name}：${p.desc}\n${g.def.mode === 'custom' ? '免费无限使用；计时类道具不改变完成用时，四叶草不发放闯关奖励' : `本局还能用 ${left} 次`}${k < 7 ? `\n快捷键 ${k + 1}` : ''}` },
          h('span.prop-icon', {}, p.icon),
          h('span.prop-name', {}, p.name),
          h('span.prop-count' + (n ? '' : '.zero'), {}, n === Infinity ? '∞' : n ? String(n) : '+'),
        );
      }),
    );
  }

  private propAvailable(id: PropId): boolean {
    const g = this.game;
    switch (id) {
      case 'hourglass':
        return !g.overtime;
      case 'undo':
        return g.canUndo;
      case 'clover':
        return !g.cloverActive;
      case 'phoenix':
        return false; // 被动，爆槽时询问
      case 'amber':
        return g.freezeLeft <= 0;
      default:
        return true;
    }
  }

  private async useProp(id: PropId) {
    const g = this.game;
    const p = PROP_MAP[id];
    if (this.paused || g.state !== 'playing') return;
    if (this.stock(id) <= 0) {
      toast(`背包里没有${p.name}了：连点或长按右上角的啵啵试试`);
      this.elf.say('来找我呀～', 1500, true);
      return;
    }
    if (this.availableUses(id) <= 0) return toast(`${p.name}本局最多用 ${p.perGame} 次`);
    if (id === 'phoenix') return toast('凤凰羽毛是被动道具：爆槽时会问你要不要复活');
    if (!this.propAvailable(id)) {
      if (id === 'hourglass') return toast('已经超时，沙漏救不回来啦');
      if (id === 'undo') return toast('现在没有可以撤回的点击（道具操作不能撤回）');
      return toast(`${p.name}已经在生效中`);
    }
    if (this.pickAction || this.brushUntil) return toast('先完成当前的道具操作');
    // 纯手艺提醒
    if (!this.noPropsWarned && g.stats.propsUsed === 0 && g.def.objectives.some((o) => o.type === 'noProps')) {
      this.paused = true;
      const v = await dialog(h('div', {}, h('h2', {}, '确定使用道具？'), h('p', {}, '本关有「纯手艺」加星目标，用道具就拿不到这颗星了。')), [
        { label: '先不用', value: 'no' },
        { label: '用吧', value: 'yes', cls: 'primary' },
      ]);
      this.resume();
      if (v !== 'yes') return;
      this.noPropsWarned = true;
    }

    // 需要先选择的道具：选好后才扣次数
    let magnetColor = -1;
    if (id === 'magnet') {
      magnetColor = await this.pickColor();
      if (magnetColor < 0) return;
    }

    g.consumeProp(id, p.perGame);
    this.spend(id);
    sfx.star(1);
    this.lastActionAt = performance.now();
    const btn = this.elProps.querySelector<HTMLElement>(`[data-prop="${id}"]`)?.getBoundingClientRect();
    if (btn) this.fx.burst(btn.left + btn.width / 2, btn.top + btn.height / 2, { n: 12, shape: 'star', speed: 4, size: 5, life: 28 });

    switch (id) {
      case 'magnet': {
        const targets = g.magnetTargets(magnetColor, 20);
        toast(`🧲 吸附 ${targets.length} 颗！`);
        this.runFixes(targets, 70);
        break;
      }
      case 'broom': {
        const changed = g.broom(Math.random);
        this.trayHidden.clear();
        this.popCells(changed);
        sfx.boom(1);
        toast('🧹 洗牌完成，空槽清空！');
        if ((g.state as string) === 'won') this.onWin();
        break;
      }
      case 'hourglass': {
        g.addTime(30);
        const r = this.elTimer.getBoundingClientRect();
        this.fx.burst(r.left + r.width / 2, r.top + r.height / 2, { n: 24, colors: ['#ffe082', '#80deea', '#fff'], shape: 'star', speed: 5, size: 5, life: 40 });
        floatText(g.def.mode === 'custom' ? '不限时，安心拼' : '+30秒', r.left + r.width / 2, r.top + r.height + 20, 'gold');
        this.bumpTimer();
        break;
      }
      case 'expand':
        g.capacity += 4;
        this.elTray.parentElement!.classList.add('grow');
        setTimeout(() => this.elTray.parentElement!.classList.remove('grow'), 600);
        toast('📦 空槽 +4');
        break;
      case 'tweezers':
        this.tweezersLeft += 3;
        this.startPick('tweezers');
        break;
      case 'magnifier': {
        const cells = g.hintCells();
        const until = performance.now() + 10000;
        cells.forEach((c) => this.board.hints.set(c, until));
        toast(g.emptyCells().length ? `🔍 高亮了 ${cells.length} 颗能直接归位的豆子` : '🔍 现在没有空位，高亮的是最适合开新链的一组');
        break;
      }
      case 'undo':
        g.undo();
        this.trayHidden.clear();
        this.board.arriving.clear();
        this.chainStreak = 0;
        toast('↩️ 回到了 3 步之前');
        sfx.slot();
        break;
      case 'meteor':
        this.meteorShower();
        break;
      case 'rainbowBomb':
        this.startPick('rainbowBomb');
        break;
      case 'amber':
        g.freeze(20);
        this.elTimer.classList.add('frozen');
        toast(g.def.mode === 'custom' ? '🧊 琥珀已生效，实际游玩时间继续记录' : '🧊 时间冻结 20 秒');
        setTimeout(() => this.elTimer.classList.remove('frozen'), 100);
        break;
      case 'brush':
        this.brushLeft = 30;
        this.brushUntil = performance.now() + 15000;
        this.brushed.clear();
        this.board.setMode('paint');
        this.updateBanner();
        break;
      case 'helper':
        this.startHelper();
        break;
      case 'clover':
        g.cloverActive = true;
        toast(g.def.mode === 'custom' ? '🍀 幸运陪伴已开启，自由创作不发放扭蛋奖励' : '🍀 四叶草生效：三星通关时扭蛋 +1 次，隐藏道具概率翻倍');
        break;
    }
    this.elf.react('clap');
    this.renderAll();
  }

  /** 依次修正一批格子（带动画） */
  private runFixes(cells: number[], interval: number, before?: (c: number) => void) {
    cells.forEach((c, k) => {
      this.fixes.push({ game: this.game, cell: c, at: this.game.playedSeconds + k * interval / 1000, before });
    });
  }

  private fixOne(c: number) {
    const g = this.game;
    if (!this.active) return;
    if (this.paused) { this.fixes.push({ game: g, cell: c, at: g.playedSeconds }); return; }
    if (g.state !== 'playing' || g.isCorrect(c)) return;
    const res = g.fixCell(c);
    this.animateMoves(res.moves);
    this.handleEvents(res.events);
    this.lastPlaceAt = performance.now();
    this.renderAll();
    if ((g.state as string) === 'won') this.scheduleWin(res.moves.length);
  }

  private pickColor(): Promise<number> {
    const g = this.game;
    const colors = g.magnetColors();
    this.paused = true;
    return new Promise((resolve) => {
      const done = (c: number) => {
        overlay.remove();
        this.resume();
        resolve(c);
      };
      const overlay = h(
        'div.overlay',
        { onpointerdown: (e: Event) => e.target === overlay && done(-1) },
        h(
          'div.dialog',
          {},
          h('h2', {}, '🧲 选一种颜色'),
          h('p.hint', {}, '这种颜色的错位豆子会一次归位（最多 20 颗）'),
          h(
            'div.color-pick',
            {},
            ...colors.map((c) =>
              h('button.color-chip', { onclick: () => done(c) }, h('span.bead-dot.big', { style: { background: beadStyle(g.def.colors[c]) } }), h('span', {}, `${g.magnetTargets(c, 999).length} 格`)),
            ),
          ),
          h('div.dialog-buttons', {}, h('button.btn', { onclick: () => done(-1) }, '取消')),
        ),
      );
      document.body.append(overlay);
    });
  }

  // ---------- 选格 / 画笔 / 帮手 ----------

  private startPick(action: Exclude<PickAction, null>) {
    this.pickAction = action;
    this.board.setMode('pick');
    this.updateBanner();
  }

  private onPick(i: number) {
    const g = this.game;
    if (this.paused || g.state !== 'playing') return;
    this.lastActionAt = performance.now();
    if (this.pickAction === 'tweezers') {
      if (g.isCorrect(i)) return toast('这一格已经是对的啦');
      this.fixOne(i);
      const p = this.board.cellClientCenter(i);
      this.fx.burst(p.x, p.y, { n: 10, shape: 'star', colors: ['#ffd54f', '#fff'], speed: 3, size: 5, life: 26 });
      this.tweezersLeft--;
      if (this.tweezersLeft <= 0 || g.state !== 'playing') this.endPick();
      else this.updateBanner();
    } else if (this.pickAction === 'rainbowBomb') {
      const x0 = i % g.w;
      const y0 = Math.floor(i / g.w);
      const cells: number[] = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = x0 + dx;
          const y = y0 + dy;
          if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
          const c = y * g.w + x;
          if (g.isInside(c) && !g.isCorrect(c)) cells.push(c);
        }
      }
      const p = this.board.cellClientCenter(i);
      this.fx.explosion(p.x, p.y, 3);
      this.fx.burst(p.x, p.y, { n: 60, colors: ['#ef5350', '#ffa726', '#ffee58', '#66bb6a', '#42a5f5', '#ab47bc'], speed: 8, size: 6, life: 50 });
      sfx.boom(3);
      this.board.shakeBoard();
      this.endPick();
      this.runFixes(cells, 40);
      toast(`🌈 彩虹炸弹！修好了 ${cells.length} 格`);
    }
  }

  private endPick() {
    this.pickAction = null;
    this.tweezersLeft = 0;
    this.board.setMode('normal');
    this.updateBanner();
  }

  private onPaint(i: number) {
    const g = this.game;
    if (!this.brushUntil || this.brushLeft <= 0 || g.state !== 'playing') return;
    if (this.brushed.has(i)) return;
    this.brushed.add(i);
    const p = this.board.cellClientCenter(i);
    this.fx.burst(p.x, p.y, { n: 4, colors: ['#ce93d8', '#fff', '#80deea'], shape: 'star', speed: 2, size: 4, life: 20 });
    if (g.isCorrect(i)) return;
    this.brushLeft--;
    this.fixOne(i);
    this.updateBanner();
    if (this.brushLeft <= 0) this.endBrush();
  }

  private endBrush() {
    if (!this.brushUntil) return;
    this.brushUntil = 0;
    this.brushLeft = 0;
    this.board.setMode('normal');
    this.updateBanner();
  }

  private startHelper() {
    let left = 40;
    this.board.helperImg = this.elf.frame();
    this.elf.say('我来帮忙！', 2000, true);
    this.elf.react('gift');
    clearInterval(this.helperTimer);
    this.helperTimer = window.setInterval(() => {
      const g = this.game;
      if (g.state !== 'playing' || left <= 0) {
        clearInterval(this.helperTimer);
        this.board.helperAt = -1;
        if (left <= 0) this.elf.say('呼～帮完啦！', 2000, true);
        return;
      }
      if (this.paused) return;
      const cells = g.unfixedCells();
      if (!cells.length) return;
      // 优先修离上一格近的，看起来像在画布上走动
      const from = this.board.helperAt;
      let pick = cells[Math.floor(Math.random() * cells.length)];
      if (from >= 0) {
        let best = Infinity;
        for (const c of cells) {
          const d = Math.abs((c % g.w) - (from % g.w)) + Math.abs(Math.floor(c / g.w) - Math.floor(from / g.w)) + Math.random() * 2;
          if (d < best) {
            best = d;
            pick = c;
          }
        }
      }
      this.board.helperAt = pick;
      this.fixOne(pick);
      left--;
    }, 500);
  }

  private meteorShower() {
    const g = this.game;
    const cells = g.unfixedCells();
    for (let k = cells.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [cells[k], cells[j]] = [cells[j], cells[k]];
    }
    const pickCells = cells.slice(0, 12);
    toast('🌠 流星雨来啦！');
    pickCells.forEach((c, k) => {
      const start = { x: -60 + Math.random() * innerWidth * 0.6, y: -60, size: 36 };
      this.fx.fly(this.meteorImg, () => start, this.cellPt(c), 600, k * 220, () => {
        if (!this.active || this.game !== g) return;
        const p = this.board.cellClientCenter(c);
        this.fx.burst(p.x, p.y, { n: 14, colors: ['#fff59d', '#ffd54f', '#fff'], shape: 'star', speed: 5, size: 5, life: 30 });
        sfx.star(k % 3);
        this.fixOne(c);
      });
    });
  }

  private setBanner(content: Node | null) {
    this.elBanner.classList.toggle('hidden', !content);
    if (content) this.elBanner.replaceChildren(content);
  }

  private updateBanner() {
    if (this.pickAction === 'tweezers') {
      this.setBanner(h('div', {}, `🥢 镊子：点一个格子让它归位（还剩 ${this.tweezersLeft} 次）`, h('button.btn.small', { onclick: () => this.endPick() }, '完成')));
    } else if (this.pickAction === 'rainbowBomb') {
      this.setBanner(h('div', {}, '🌈 点选一个位置，5×5 范围全部归位'));
    } else if (this.brushUntil) {
      this.setBanner(h('div', {}, `🖌️ 画笔：划过的格子自动归位（还剩 ${this.brushLeft} 格）`, h('button.btn.small', { onclick: () => this.endBrush() }, '完成')));
    } else this.setBanner(null);
  }

  private endModes() {
    if (this.pickAction) this.endPick();
    this.endBrush();
    clearInterval(this.helperTimer);
    this.board.helperAt = -1;
  }

  // ---------- 定位 / 键盘 ----------

  private onLocate() {
    const empties = this.game.emptyCells();
    const now = performance.now();
    if (empties.length && now - this.lastLocate < 4000) {
      this.locateIdx = (this.locateIdx + 1) % empties.length;
      this.focusAndHint(empties[this.locateIdx]);
    } else {
      this.locateIdx = -1;
      this.board.fit();
    }
    this.lastLocate = now;
  }

  private focusAndHint(cell: number) {
    this.board.focusCell(cell);
    this.board.hints.set(cell, performance.now() + 1500);
  }

  private onKey(e: KeyboardEvent) {
    if (document.querySelector('.overlay')) return;
    const step = 60;
    if (/^[1-7]$/.test(e.key)) {
      this.useProp(COMMON_PROPS[+e.key - 1].id);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case '+':
      case '=':
        this.board.zoomBy(1.4);
        break;
      case '-':
      case '_':
        this.board.zoomBy(1 / 1.4);
        break;
      case '0':
        this.board.fit();
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        this.board.panBy(step, 0);
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        this.board.panBy(-step, 0);
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        this.board.panBy(0, step);
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        this.board.panBy(0, -step);
        break;
      case 'Tab': {
        const empties = this.game.emptyCells();
        if (empties.length) {
          this.locateIdx = (this.locateIdx + 1) % empties.length;
          this.focusAndHint(empties[this.locateIdx]);
        }
        break;
      }
      case 't':
      case 'T':
        this.onTimerTap();
        break;
      case 'Escape':
        if (this.pickAction) this.endPick();
        else if (this.brushUntil) this.endBrush();
        else if (this.sel) this.clearSel();
        else this.pause();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  private haptic(p: number | number[]) {
    if (save.data.settings.vibrate) vibrate(p);
  }

  // ---------- 渲染 HUD ----------

  private renderAll() {
    this.validateSel();
    this.checkRegions();
    this.renderTray();
    this.renderNeed();
    this.renderProgress();
    this.renderTaps();
    this.renderTimer();
    this.renderProps();
  }

  private renderTimer() {
    const g = this.game;
    const left = g.timeLeft;
    if (g.def.mode === 'custom') {
      this.elTimerText.textContent = fmtTime(g.playedSeconds);
      this.elTimer.classList.remove('over', 'low', 'frozen');
      this.elBuffs.textContent = '自由计时';
      return;
    }
    const over = g.overtime;
    this.elTimerText.textContent = over ? '+' + fmtTime(-left) : fmtTime(Math.ceil(left));
    this.elTimer.classList.toggle('over', over);
    this.elTimer.classList.toggle('low', !over && left < g.def.timeLimit * 0.2);
    this.elTimer.classList.toggle('frozen', g.freezeLeft > 0);
    const buffs: string[] = [];
    if (g.freezeLeft > 0) buffs.push(`🧊${Math.ceil(g.freezeLeft)}`);
    if (g.cloverActive) buffs.push('🍀');
    const txt = buffs.join(' ');
    if (this.elBuffs.textContent !== txt) this.elBuffs.textContent = txt;
    this.elObjectives.querySelectorAll<HTMLElement>('[data-obj="timeLeft"]').forEach((el) => {
      const o = g.def.objectives.find((x) => x.type === 'timeLeft')!;
      el.classList.toggle('ok', g.objectiveMet(o));
    });
  }

  private renderTaps() {
    const g = this.game;
    if (g.def.mode === 'custom') { this.elTaps.replaceChildren(); this.elTaps.title = ''; return; }
    const left = g.overtime ? 0 : TIMER_TAP_LIMIT - g.timerTaps;
    this.elTaps.replaceChildren(...Array.from({ length: TIMER_TAP_LIMIT }, (_, k) => h('span.tap-dot' + (k < left ? '.on' : ''))));
    this.elTaps.title = `点击计时器加时，还剩 ${left} 次`;
  }

  private renderProgress() {
    const g = this.game;
    this.elProgress.style.width = `${(g.progress * 100).toFixed(1)}%`;
    this.elProgressText.textContent = `${g.correct} / ${g.total}`;
    this.renderObjectives();
  }

  /** 三个星级要求的实时达成状态：✓ 绿 = 当前已达成，✗ 红 = 未达成/已失败 */
  private renderObjectives() {
    const g = this.game;
    if (g.def.mode === 'custom') {
      this.elObjectives.replaceChildren();
      return;
    }
    const chip = (met: boolean, title: string, icon: string, label: string, extra = '', type = '') =>
      h('span.obj-chip' + (met ? '.ok' : '.no'), { 'data-obj': type || undefined, title },
        h('span.mark', {}, met ? '✓' : '✗'), ` ${icon} ${label}${extra}`);
    const baseMet = !g.overtime;
    this.elObjectives.replaceChildren(
      chip(baseMet, '一星：倒计时内通关；超时后通关只得半星', '⏱', '限时通关'),
      ...g.def.objectives.map((o: Objective) => {
        const met = !g.overtime && g.objectiveMet(o);
        let extra = '';
        if (o.type === 'maxCombo') extra = ` ${g.stats.maxCombo}/${o.value}`;
        if (o.type === 'slotPeak') extra = ` ${g.stats.slotPeak}/${o.value}`;
        if (o.type === 'newChains') extra = ` ${g.stats.newChains}/${o.value}`;
        const name = OBJECTIVE_TEXT[o.type](o.value).split('：')[0];
        return chip(met, OBJECTIVE_TEXT[o.type](o.value), OBJECTIVE_ICON[o.type], name, extra, o.type);
      }),
      ...(g.lockedSlots > 0 || g.slotsUnlocked
        ? [chip(!g.slotsUnlocked, '不开启锁住的空槽；开启后本关最多 2 颗星', '🔒', g.slotsUnlocked ? '已开锁槽·最多2星' : '不开锁槽')]
        : []),
    );
  }

  /** 长按「提示」约半秒：切换空位提示的常驻显示 */
  private beginNeedPress() {
    this.needPressFired = false;
    if (!this.active || this.paused || this.game.state !== 'playing' || !save.data.settings.needBar) return;
    clearTimeout(this.needPressTimer);
    this.needPressTimer = window.setTimeout(() => {
      this.needPressFired = true;
      this.needPinned = !this.needPinned;
      clearTimeout(this.needTimer);
      this.needUntil = 0;
      this.renderNeed();
      toast(this.needPinned ? '空位提示已常驻，再长按收起' : '已收起常驻提示');
    }, 450);
  }

  private cancelNeedPress() {
    clearTimeout(this.needPressTimer);
  }

  private showNeedHint() {
    if (this.needPressFired) { this.needPressFired = false; return; } // 长按后松手附带的 click，忽略
    if (!this.active || this.paused || this.game.state !== 'playing' || !save.data.settings.needBar) return;
    if (this.needPinned) return; // 已常驻，无需再计时
    this.needUntil = performance.now() + 2000;
    clearTimeout(this.needTimer);
    this.renderNeed();
    this.needTimer = window.setTimeout(() => { this.needUntil = 0; this.renderNeed(); }, 2000);
  }

  private renderNeed() {
    const show = save.data.settings.needBar;
    this.elNeed.classList.toggle('hidden', !show);
    if (!show) { clearTimeout(this.needTimer); this.needUntil = 0; this.needPinned = false; }
    const expanded = show && this.game.state === 'playing' && (this.needPinned || performance.now() < this.needUntil);
    this.elNeedContent.hidden = !expanded;
    this.elNeedToggle.setAttribute('aria-expanded', String(expanded));
    this.elNeedToggle.classList.toggle('pinned', show && this.needPinned);
    if (!expanded) { this.elNeedContent.replaceChildren(); return; }
    const need = this.game.neededColors();
    if (!need.length) {
      this.elNeedContent.replaceChildren(h('span.need-empty', {}, '点一颗放错的豆子开始'));
      return;
    }
    this.elNeedContent.replaceChildren(
      h('span.need-label', {}, '空位需要'),
      ...need.map(({ color, count }) =>
        h(
          'button.need-chip',
          {
            title: '定位到这个颜色的空位',
            onclick: () => {
              const cells = [...(this.game.emptyByColor.get(color) ?? [])];
              if (cells.length) this.focusAndHint(cells[0]);
            },
          },
          h('span.bead-dot', { style: { background: beadStyle(this.game.def.colors[color]) } }),
          `×${count}`,
        ),
      ),
    );
  }

  private renderTray() {
    const g = this.game;
    const cap = g.capacity;
    const usable = g.usableCapacity;
    const sel = this.sel;
    // Keep slot/bead nodes alive: rebuilding them restarts animations and can
    // remove a pressed button before pointerup, losing its click and sound.
    while (this.elTray.children.length > cap) this.elTray.lastElementChild!.remove();
    for (let k = 0; k < cap; k++) {
      const color = g.slots[k];
      const filled = color !== undefined && !this.trayHidden.has(k);
      const locked = k >= usable && color === undefined;
      const lifted = filled && sel?.kind === 'tray' && sel.color === color;
      let el = this.elTray.children[k] as HTMLButtonElement | undefined;
      if (!el) {
        el = h('button.slot', {
          type: 'button',
          onclick: (e: Event) => { e.stopPropagation(); void this.onTapTray(k); },
        }) as HTMLButtonElement;
        this.elTray.append(el);
      }
      el.classList.toggle('filled', filled);
      el.classList.toggle('locked', locked);
      el.classList.toggle('lifted', !!lifted);
      el.setAttribute('aria-pressed', String(!!lifted));
      el.setAttribute('aria-label', locked ? '锁住的空槽：点击开启' : filled ? `空槽 ${k + 1} 的豆子` : `空槽 ${k + 1}`);
      el.title = locked ? '锁住的空槽：点击开启（开启后本关最多 2 颗星）' : '';
      const content = filled ? `bead:${color}:${g.def.colors[color]}` : locked ? 'locked' : 'empty';
      if (el.dataset.content !== content) {
        el.dataset.content = content;
        if (filled) el.replaceChildren(h('span.bead-dot', { style: { background: beadStyle(g.def.colors[color]) } }));
        else if (locked) el.replaceChildren(h('span.slot-lock', {}, '🔒'));
        else el.replaceChildren();
      }
    }
    const used = g.slots.length;
    const ratio = used / Math.max(1, usable);
    const panel = this.elTray.parentElement!;
    panel.classList.toggle('warn', ratio >= 0.7 && ratio < 0.9);
    panel.classList.toggle('danger', ratio >= 0.9);
    panel.classList.toggle('drop-target', sel?.kind === 'board');
    this.elTrayInfo.textContent = sel?.kind === 'board'
      ? `点这里把浮起的 ${sel.cells.length} 颗放进空槽 · ${used} / ${usable}`
      : `空槽 ${used} / ${usable}` + (g.lockedSlots ? ` · 🔒${g.lockedSlots}` : '');
  }
}

/** 流星贴图 */
function makeMeteor(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(40, 40, 2, 40, 40, 24);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, '#fff59d');
  g.addColorStop(1, 'rgba(255,193,7,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(40, 40, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,236,179,0.7)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(8, 8);
  ctx.lineTo(32, 32);
  ctx.stroke();
  return c;
}
