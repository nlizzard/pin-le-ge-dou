import './styles.css';
import { Fx } from './render/fx';
import { COMMON_PROPS } from './core/props';
import { save } from './save';
import { GameScreen } from './ui/game';
import { renderMap } from './ui/map';
import { applySettings } from './ui/settings';

const app = document.getElementById('app')!;
document.getElementById('boot')?.remove();
const fx = new Fx();

const host = {
  toMap() {
    game.close();
    renderMap(app, (id) => host.play(id), fx);
  },
  play(id: number) {
    game.close();
    app.replaceChildren(game.el);
    game.open(id);
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

save.init().then(() => {
  giveStarterGift();
  applySettings();
  if (!app.contains(game.el)) host.toMap();
});
save.onChange(() => applySettings());
