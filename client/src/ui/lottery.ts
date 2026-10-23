import { sfx } from '../audio';
import { PROP_MAP, rollCommon, rollHidden, type PropId } from '../core/props';
import { addProp, save } from '../save';
import { h } from './dom';

export interface Prize {
  id: PropId;
  n: number;
  rarity: 'common' | 'rare' | 'epic';
}

/** 抽一次：常驻×1 45% · 常驻×2 25% · 稀有隐藏 22% · 史诗隐藏 8%；四叶草隐藏概率翻倍；连续 5 次没出隐藏，第 6 次必出 */
export function drawPrize(rand: () => number, clover: boolean): Prize {
  const owned = new Set(save.data.collected as PropId[]);
  let rare = 0.22;
  let epic = 0.08;
  if (clover) {
    rare *= 2;
    epic *= 2;
  }
  const pity = save.data.lotteryPity >= 5;
  const r = rand();
  let prize: Prize;
  if (pity || r < epic + rare) {
    const rarity = pity ? (rand() < 0.3 ? 'epic' : 'rare') : r < epic ? 'epic' : 'rare';
    prize = { id: rollHidden(rand, rarity, owned), n: 1, rarity };
  } else {
    prize = { id: rollCommon(rand), n: r < epic + rare + (1 - epic - rare) * 0.36 ? 2 : 1, rarity: 'common' };
  }
  save.update((d) => {
    d.lotteryPity = prize.rarity === 'common' ? d.lotteryPity + 1 : 0;
    if (prize.rarity !== 'common' && !d.collected.includes(prize.id)) d.collected.push(prize.id);
  });
  addProp(prize.id, prize.n);
  return prize;
}

/** 三星扭蛋机：draws 次 */
export function openLottery(draws: number, clover: boolean): Promise<Prize[]> {
  return new Promise((resolve) => {
    const prizes: Prize[] = [];
    let left = draws;
    const overlay = h('div.overlay.lottery-overlay');
    const machine = h('div.gacha', {}, h('div.gacha-dome', {}, ...Array.from({ length: 9 }, (_, k) => h('span.gacha-ball.b' + (k % 5)))), h('div.gacha-body', {}, h('div.gacha-knob'), h('div.gacha-slot')));
    const result = h('div.gacha-result');
    const btn = h('button.btn.primary.big', {}, `扭一下（${left}）`) as HTMLButtonElement;
    const done = h('button.btn', {}, '收下') as HTMLButtonElement;
    done.style.display = 'none';
    btn.addEventListener('click', () => {
      if (left <= 0) return;
      left--;
      btn.disabled = true;
      machine.classList.remove('shake');
      void machine.offsetWidth;
      machine.classList.add('shake');
      sfx.click();
      setTimeout(() => {
        const prize = drawPrize(Math.random, clover);
        prizes.push(prize);
        const p = PROP_MAP[prize.id];
        const egg = h('button.egg.' + prize.rarity, { title: '点开它' }, h('span.egg-top'), h('span.egg-bottom'));
        result.replaceChildren(egg, h('div.egg-tip', {}, '点开扭蛋！'));
        egg.addEventListener(
          'click',
          () => {
            egg.classList.add('open');
            prize.rarity === 'common' ? sfx.star(0) : sfx.win();
            setTimeout(() => {
              result.replaceChildren(
                h(
                  'div.prize.' + prize.rarity,
                  {},
                  h('div.prize-icon', {}, p.icon),
                  h('div.prize-name', {}, `${p.name}${prize.n > 1 ? ` ×${prize.n}` : ''}`),
                  h('div.prize-tag', {}, prize.rarity === 'epic' ? '史诗 · 隐藏道具！' : prize.rarity === 'rare' ? '稀有 · 隐藏道具！' : '常驻道具'),
                  h('div.hint', {}, p.desc),
                ),
              );
              btn.textContent = left > 0 ? `再扭一下（${left}）` : '没有次数啦';
              btn.disabled = left <= 0;
              done.style.display = '';
            }, 400);
          },
          { once: true },
        );
      }, 700);
    });
    done.addEventListener('click', () => {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 180);
      resolve(prizes);
    });
    overlay.append(
      h(
        'div.dialog.lottery-dialog',
        {},
        h('h2', {}, '三星扭蛋机'),
        h('p.hint', {}, clover ? '四叶草生效：多一次机会，隐藏道具概率翻倍！' : '三星奖励：必出道具，还可能是隐藏道具'),
        machine,
        result,
        h('div.dialog-buttons', {}, done, btn),
      ),
    );
    document.body.append(overlay);
  });
}
