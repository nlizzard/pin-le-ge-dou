import { sfx } from '../audio';
import { COMMON_PROPS, HIDDEN_PROPS, type PropId } from '../core/props';
import { propCount, save } from '../save';
import { h } from './dom';

/** 许愿池：每局 3 次，只能许常驻道具，且同一局不能重复。返回许到的道具，取消返回 null */
export function openWishPool(wished: Set<PropId>, left: number): Promise<PropId | null> {
  return new Promise((resolve) => {
    const overlay = h('div.overlay.wish-overlay');
    const close = (v: PropId | null) => {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 180);
      resolve(v);
    };
    const pond = h('div.pond', {}, h('div.pond-water'), h('div.coin'));
    const grid = h('div.wish-grid');
    for (const p of COMMON_PROPS) {
      const used = wished.has(p.id);
      const card = h(
        'button.wish-card' + (used ? '.used' : ''),
        { disabled: used || left <= 0 || undefined, title: p.desc },
        h('div.wish-icon', {}, p.icon),
        h('div.wish-name', {}, p.name),
        h('div.wish-count', {}, used ? '本局已许' : `背包 ×${propCount(p.id)}`),
      );
      card.addEventListener('click', () => {
        grid.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
        card.classList.add('chosen');
        pond.classList.add('wishing');
        sfx.star(0);
        setTimeout(() => sfx.star(1), 500);
        setTimeout(() => sfx.star(2), 900);
        setTimeout(() => close(p.id), 1500);
      });
      grid.append(card);
    }
    const hidden = h(
      'div.wish-hidden',
      {},
      ...HIDDEN_PROPS.map((p) => h('div.silhouette', { title: '这些宝贝只能靠缘分——连点我或三星抽奖' }, save.data.collected.includes(p.id) ? p.icon : '？')),
    );
    overlay.append(
      h(
        'div.dialog.wish-dialog',
        {},
        h('h2', {}, '许愿池'),
        h('p.hint', {}, left > 0 ? `本局还能许愿 ${left} 次 · 每次许不同的道具` : '本局的愿望用完啦，下一局再来～'),
        pond,
        grid,
        h('p.hint', {}, '这些宝贝只能靠缘分——连点我或三星抽奖'),
        hidden,
        h('div.dialog-buttons', {}, h('button.btn', { onclick: () => close(null) }, '算了')),
      ),
    );
    overlay.addEventListener('pointerdown', (e) => e.target === overlay && close(null));
    document.body.append(overlay);
  });
}
