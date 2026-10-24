import './styles.css';
import { Fx } from './render/fx';
import { COMMON_PROPS } from './core/props';
import { save } from './save';
import { GameScreen } from './ui/game';
import { renderMap } from './ui/map';
import { applySettings } from './ui/settings';
import { openCustomStudio } from './ui/custom';
import type { LevelDef } from './core/level';
import { initLevels } from './core/level';
import { renderArtWall } from './ui/artWall';
import { initCustomRecords } from './customRecords';

const app = document.getElementById('app')!;
document.getElementById('boot')?.remove();
const fx = new Fx();
let screen: 'map' | 'game' | 'studio' = 'map';
let closeStudio: (() => void) | undefined;

const host = {
  toMap() {
    closeStudio?.(); closeStudio = undefined; screen = 'map';
    game.close();
    renderMap(app, (id) => host.play(id), fx, () => host.toStudio());
  },
  create() {
    void openCustomStudio(def => host.playCustom(def), () => host.toStudio(), screen === 'studio' ? '返回小画室' : '返回地图');
  },
  toStudio() {
    closeStudio?.(); game.close(); screen = 'studio';
    closeStudio = renderArtWall(app, { toMap: () => host.toMap(), create: () => host.create() });
  },
  play(id: number) {
    closeStudio?.(); closeStudio = undefined; screen = 'game';
    game.close();
    app.replaceChildren(game.el);
    void game.open(id);
  },
  playCustom(def: LevelDef) {
    closeStudio?.(); closeStudio = undefined; screen = 'game';
    game.close();
    app.replaceChildren(game.el);
    void game.open(0, def);
  },
};

const game = new GameScreen(host, fx);

// 地图页也让特效层持续绘制（结算后的彩纸等）
function idle(t: number) {
  if (!app.contains(game.el)) fx.draw(t);
  requestAnimationFrame(idle);
}
requestAnimationFrame(idle);

applySettings();
host.toMap();
function giveStarterGift() {
  if (save.data.giftGiven) return;
  save.update((d) => {
    for (const p of COMMON_PROPS) d.inventory[p.id] = (d.inventory[p.id] ?? 0) + 2;
    d.giftGiven = true;
  });
}

// 存档与关卡、创作记录都从本地 SQLite（服务端）取；连不上时各模块自动本地兜底
save.init().then(async () => {
  giveStarterGift();
  await Promise.all([initLevels(), initCustomRecords()]);
  applySettings();
  if (screen === 'map') host.toMap();
});
save.onChange(() => applySettings());
