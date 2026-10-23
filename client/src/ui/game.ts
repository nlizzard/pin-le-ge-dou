import { sfx, vibrate } from '../audio';
import { Game, TIMER_TAP_LIMIT, type Events, type Move, type TapResult } from '../core/engine';
import { buildLevel, ELEMENT_INFO, LEVEL_COUNT, OBJECTIVE_ICON, OBJECTIVE_TEXT, type ElementType, type Objective } from '../core/level';
import { COMMON_PROPS, ELF_DROP_CHANCE, ELF_DROPS_PER_GAME, HIDDEN_PROPS, PROP_MAP, PROPS, rollCommon, rollHidden, WISHES_PER_GAME, type PropId } from '../core/props';
import { BoardView } from '../render/board';
import { Fx } from '../render/fx';
import { buildSprites, type SpriteSet } from '../render/sprites';
import { addProp, propCount, save } from '../save';
import { beadStyle, dialog, floatText, fmtTime, h, starRow, toast } from './dom';
import { Elf, type DropResult } from './elf';
import { openLottery } from './lottery';
import { openSettings } from './settings';
import { openWishPool } from './wish';

const FLIGHT_MS = 320;
const STAGGER_MS = 110;

export interface GameScreenHost {
  toMap(): void;
  play(id: number): void;
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
  private elTray: HTMLElement;
  private elTrayInfo: HTMLElement;
  private elZoom: HTMLInputElement;
  private elCombo: HTMLElement;
  private elProps: HTMLElement;
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
    this.elNeed = h('div.need-bar');
    this.elTray = h('div.tray');
    this.elTrayInfo = h('div.tray-info');
    this.elCombo = h('div.combo');
    this.elProps = h('div.props-bar');
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
      h('div.side', {}, h('div.tray-panel', {}, this.elTrayInfo, this.elTray), this.elProps),
    );
  }

  // ---------- 生命周期 ----------

  async open(id: number) {
    this.levelId = id;
    (window as any).__pp = this; // 调试 / 自动化测试用
    (window as any).__grant = grantProp;
    const def = buildLevel(id);
    this.game = new Game(def);
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
    this.elTitle.textContent = `第${id}关 · ${def.name}`;
    this.board.setGame(this.game, this.sprites);
    this.renderAll();
    this.setBanner(null);
    addEventListener('keydown', this.keyHandler);
    document.addEventListener('visibilitychange', this.visHandler);
    this.lastFrame = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((t) => this.frame(t));
    clearInterval(this.metricsTimer);
    this.metricsTimer = window.setInterval(() => this.updateElf(), 500);
    requestAnimationFrame(() => this.board.resize());
    await this.showStartCard();
  }

  close() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.metricsTimer);
    clearInterval(this.helperTimer);
    removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('visibilitychange', this.visHandler);
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused && this.game.tick(dt)) this.onOvertime();
    if (this.brushUntil && now > this.brushUntil) this.endBrush();
    this.renderTimer();
    this.board.draw(now);
    this.fx.draw(now);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- 弹窗 ----------

  private async showStartCard() {
    const def = this.game.def;
    const tutorial = !save.data.seenTutorial;
    this.paused = true;
    const el = def.elements;
    const types: ElementType[] = [];
    if (el.ice.length) types.push('ice');
    if (el.star.length) types.push('star');
    if (el.fog.length) types.push('fog');
    if (el.lock) types.push('lock');
    if (el.bombs.length) types.push('bomb');
    const body = h(
      'div.start-card',
      {},
      h('h2', {}, `第${def.id}关 · ${def.name}`),
      h('div.tag.diff-' + def.difficulty, {}, def.difficulty),
      h(
        'div.facts',
        {},
        h('div', {}, h('b', {}, String(def.wrongCount)), h('span', {}, '颗放错')),
        h('div', {}, h('b', {}, String(def.capacity)), h('span', {}, '个空槽')),
        h('div', {}, h('b', {}, fmtTime(def.timeLimit)), h('span', {}, '限时')),
      ),
      h('div.obj-list', {}, h('div.obj-head', {}, '★ 倒计时内通关'), ...def.objectives.map((o) => h('div', {}, `★ ${OBJECTIVE_ICON[o.type]} ${OBJECTIVE_TEXT[o.type](o.value)}`))),
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
            h('li', {}, '方块底色是正确颜色，圆豆子颜色不对就是放错了。'),
            h('li', {}, '点一颗放错的豆子，和它连着的同色错位豆子会一起移动：有空位需要这个颜色就飞去空位（空位不够时只飞够用的几颗），没有就整组进下方空槽。'),
            h('li', {}, '它原来的格子会变成闪烁的空位，去点空位需要的颜色，就能连锁归位。'),
            h('li', {}, '空槽满了会爆槽失败；时间用完还能继续，但只能拿半星。点计时器可以加时（每局 3 次）。'),
            h('li', {}, '右上角的啵啵：点它有惊喜，连点可能掉道具（每局 3 个），长按可以许愿（每局 3 次）。'),
          )
        : null,
    );
    await dialog(body, [{ label: '开始', value: 'go', cls: 'primary big' }]);
    save.update((d) => {
      d.seenTutorial = true;
      for (const t of types) if (!d.seenElements.includes(t)) d.seenElements.push(t);
    });
    this.paused = false;
    this.game.start();
    this.lastFrame = performance.now();
    this.lastActionAt = performance.now();
    this.elf.say(['开始啦，加油！', '一起把画拼好吧～', '我会在旁边给你打气！'][Math.floor(Math.random() * 3)], 2200, true);
  }

  private async pause() {
    if (this.paused || this.game.state !== 'playing') return;
    this.paused = true;
    const v = await openSettings([
      { label: '重新开始', value: 'restart' },
      { label: '关卡地图', value: 'map' },
    ]);
    this.board.colorBlind = save.data.settings.colorBlind;
    this.renderNeed();
    if (v === 'restart') return this.host.play(this.levelId);
    if (v === 'map') return this.host.toMap();
    this.resume();
  }

  private resume() {
    this.paused = false;
    this.lastFrame = performance.now();
    this.lastActionAt = performance.now();
  }

  private async onBurst(cell: number, groupSize = 1) {
    this.paused = true;
    sfx.error();
    this.haptic([60, 40, 120]);
    this.board.shakeBoard();
    this.updateElf();
    const c = this.board.cellClientCenter(cell);
    this.fx.burst(c.x, c.y, { n: 20, colors: ['#ff5252', '#ff8a80'], speed: 6 });
    await new Promise((r) => setTimeout(r, 500));
    const g = this.game;
    const buttons: { label: string; value: string; cls?: string }[] = [];
    if (propCount('phoenix') > 0 && g.uses('phoenix') < PROP_MAP.phoenix.perGame) buttons.push({ label: '🪶 凤凰羽毛复活', value: 'phoenix', cls: 'primary gold' });
    if (g.canRevive) {
      if (propCount('expand') > 0 && g.uses('expand') < PROP_MAP.expand.perGame) buttons.push({ label: `📦 扩槽箱 +4（×${propCount('expand')}）`, value: 'expand', cls: 'primary' });
      if (propCount('broom') > 0 && g.uses('broom') < PROP_MAP.broom.perGame) buttons.push({ label: `🧹 扫把洗牌（×${propCount('broom')}）`, value: 'broom', cls: 'primary' });
    }
    buttons.push({ label: '关卡地图', value: 'map' }, { label: '再来一次', value: 'retry' });
    const canSave = buttons.length > 2;
    const v = await dialog(
      h(
        'div.result.fail',
        {},
        h('h2', {}, '爆槽啦！'),
        h('p', {}, groupSize > 1 ? `这一组 ${groupSize} 颗连着的豆子要一起进空槽，但只剩 ${g.freeSlots} 格。` : '空槽已满，这颗豆子没地方放了。'),
        canSave ? h('p.hint', {}, `可以用道具续命（本局还能续命 ${2 - g.stats.revives} 次，凤凰羽毛不占次数）`) : h('p.hint', {}, '小技巧：先点闪烁空位需要的颜色，不占空槽；必须进槽时挑小的一组。'),
      ),
      buttons,
    );
    if (v === 'phoenix') {
      g.consumeProp('phoenix', 1);
      addProp('phoenix', -1);
      const cells = g.phoenix(Math.random);
      this.fx.burst(innerWidth / 2, innerHeight / 2, { n: 60, colors: ['#ff7043', '#ffd54f', '#ff5252'], speed: 9, size: 7, life: 60, shape: 'spark' });
      sfx.win();
      this.popCells(cells);
      toast('凤凰涅槃！空槽清空，+30 秒');
    } else if (v === 'expand') {
      g.consumeProp('expand', PROP_MAP.expand.perGame);
      addProp('expand', -1);
      g.revive(4);
      toast('空槽 +4，继续加油！');
    } else if (v === 'broom') {
      g.consumeProp('broom', PROP_MAP.broom.perGame);
      addProp('broom', -1);
      const changed = g.reviveWithBroom(Math.random) ?? [];
      this.popCells(changed);
      toast('洗牌完成，空槽清空！');
    } else if (v === 'retry') return this.host.play(this.levelId);
    else return this.host.toMap();
    this.trayHidden.clear();
    this.renderAll();
    this.elf.react('clap');
    this.resume();
    if ((g.state as string) === 'won') this.onWin();
  }

  private async onWin() {
    if (this.finishing) return;
    this.finishing = true;
    this.endModes();
    const g = this.game;
    const stars = g.stars();
    const id = this.levelId;
    const prevBest = save.data.best[id] ?? 0;
    save.update((d) => {
      d.best[id] = Math.max(prevBest, stars);
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
    const res = this.game.tap(i);
    this.handleResult(res);
  }

  private onTapSlot(k: number) {
    if (this.paused || this.game.state !== 'playing') return;
    const res = this.game.tapSlot(k);
    if (res.type === 'ignored') {
      toast('还没有空位需要这个颜色');
      sfx.locked();
      return;
    }
    this.handleResult(res);
  }

  private handleResult(res: TapResult) {
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
        this.onBurst(res.cell, res.group.length);
        return;
      case 'moved':
        this.animateMoves(res.moves);
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
    setTimeout(() => this.onWin(), delay);
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

  private animateMoves(moves: Move[]) {
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
        const from = m.kind === 'cellToCell' ? this.cellPt(m.from) : this.slotPt(m.slot);
        this.fx.fly(img, from, this.cellPt(to), FLIGHT_MS, delay, () => this.onLand(to, m.color));
      } else {
        const slot = slotTargets[slotK++];
        this.fx.fly(img, this.cellPt(m.from), this.slotPt(slot), FLIGHT_MS, delay, () => {
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
    const group = i >= 0 && this.game.state === 'playing' && !this.paused && this.board.mode === 'normal' ? this.game.groupAt(i) : [];
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

  private cellPt(i: number) {
    return () => {
      const c = this.board.cellClientCenter(i);
      return { x: c.x, y: c.y, size: c.size };
    };
  }

  private slotPt(k: number) {
    return () => {
      const el = this.elTray.children[k] as HTMLElement | undefined;
      const r = (el ?? this.elTray).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width * 1.3 };
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

  // ---------- 计时器 ----------

  private onTimerTap() {
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
      timeRatio: Math.max(0, g.timeLeft) / g.def.timeLimit,
      slotRatio: g.slots.length / g.capacity,
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

  private renderProps() {
    const g = this.game;
    if (!g) return;
    const list = PROPS.filter((p) => !p.hidden || propCount(p.id) > 0 || g.uses(p.id) > 0);
    this.elProps.replaceChildren(
      ...list.map((p, k) => {
        const n = propCount(p.id);
        const left = p.perGame - g.uses(p.id);
        const usable = n > 0 && left > 0 && this.propAvailable(p.id);
        return h(
          'button.prop-btn' + (p.hidden ? '.hidden-prop.' + p.rarity : '') + (usable ? '' : '.off') + (p.id === 'clover' && g.cloverActive ? '.active' : ''),
          { 'data-prop': p.id, title: `${p.name}：${p.desc}\n本局还能用 ${left} 次${k < 7 ? `\n快捷键 ${k + 1}` : ''}`, onclick: () => this.useProp(p.id) },
          h('span.prop-icon', {}, p.icon),
          h('span.prop-name', {}, p.name),
          h('span.prop-count' + (n ? '' : '.zero'), {}, n ? String(n) : '+'),
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
    if (propCount(id) <= 0) {
      toast(`背包里没有${p.name}了：连点或长按右上角的啵啵试试`);
      this.elf.say('来找我呀～', 1500, true);
      return;
    }
    if (g.uses(id) >= p.perGame) return toast(`${p.name}本局最多用 ${p.perGame} 次`);
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
    addProp(id, -1);
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
        floatText('+30秒', r.left + r.width / 2, r.top + r.height + 20, 'gold');
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
        toast('🧊 时间冻结 20 秒');
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
        toast('🍀 四叶草生效：三星通关时扭蛋 +1 次，隐藏道具概率翻倍');
        break;
    }
    this.elf.react('clap');
    this.renderAll();
  }

  /** 依次修正一批格子（带动画） */
  private runFixes(cells: number[], interval: number, before?: (c: number) => void) {
    cells.forEach((c, k) => {
      setTimeout(() => {
        if (this.game.state !== 'playing') return;
        before?.(c);
        this.fixOne(c);
      }, k * interval);
    });
  }

  private fixOne(c: number) {
    const g = this.game;
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

  private renderObjectives() {
    const g = this.game;
    this.elObjectives.replaceChildren(
      ...g.def.objectives.map((o: Objective) => {
        const met = g.objectiveMet(o) && !g.overtime;
        let extra = '';
        if (o.type === 'maxCombo') extra = ` ${g.stats.maxCombo}/${o.value}`;
        if (o.type === 'slotPeak') extra = ` ${g.stats.slotPeak}/${o.value}`;
        if (o.type === 'newChains') extra = ` ${g.stats.newChains}/${o.value}`;
        return h('span.obj-chip' + (met ? '.ok' : ''), { 'data-obj': o.type, title: OBJECTIVE_TEXT[o.type](o.value) }, OBJECTIVE_ICON[o.type] + extra);
      }),
    );
  }

  private renderNeed() {
    const show = save.data.settings.needBar;
    this.elNeed.classList.toggle('hidden', !show);
    if (!show) return;
    const need = this.game.neededColors();
    if (!need.length) {
      this.elNeed.replaceChildren(h('span.need-empty', {}, '点一颗放错的豆子开始'));
      return;
    }
    this.elNeed.replaceChildren(
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
    const children: HTMLElement[] = [];
    for (let k = 0; k < cap; k++) {
      const color = g.slots[k];
      const filled = color !== undefined && !this.trayHidden.has(k);
      const el = h('button.slot' + (filled ? '.filled' : ''), { onclick: () => filled && this.onTapSlot(k), tabindex: filled ? 0 : -1 });
      if (filled) el.append(h('span.bead-dot', { style: { background: beadStyle(g.def.colors[color]) } }));
      children.push(el);
    }
    this.elTray.replaceChildren(...children);
    const used = g.slots.length;
    const ratio = used / cap;
    this.elTray.parentElement!.classList.toggle('warn', ratio >= 0.7 && ratio < 0.9);
    this.elTray.parentElement!.classList.toggle('danger', ratio >= 0.9);
    this.elTrayInfo.textContent = `空槽 ${used} / ${cap}`;
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
