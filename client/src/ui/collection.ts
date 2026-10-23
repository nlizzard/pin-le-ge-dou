import { COMMON_PROPS, HIDDEN_PROPS } from '../core/props';
import { ELEMENT_INFO } from '../core/level';
import { EXTRA_PATTERNS } from '../core/patterns';
import { propCount, save } from '../save';
import { dialog, h } from './dom';

/** 背包 / 道具图鉴：集齐 7 种隐藏道具解锁啵啵的金色皮肤 */
export async function openCollection(): Promise<void> {
  const collected = new Set(save.data.collected);
  const row = (p: (typeof COMMON_PROPS)[number], known: boolean) =>
    h(
      'div.book-item' + (known ? '' : '.unknown') + (p.hidden ? '.' + p.rarity : ''),
      {},
      h('div.book-icon', {}, known ? p.icon : '？'),
      h(
        'div.book-text',
        {},
        h('div.book-name', {}, known ? p.name : '未知的宝贝', p.hidden && known ? h('span.tag.rarity', {}, p.rarity === 'epic' ? '史诗' : '稀有') : null),
        h('div.book-desc', {}, known ? p.desc : `谜语：${p.riddle}`),
      ),
      h('div.book-count', {}, known ? `×${propCount(p.id)}` : ''),
    );
  const got = HIDDEN_PROPS.filter((p) => collected.has(p.id)).length;
  const all = got === HIDDEN_PROPS.length;
  if (all && save.data.elfSkin !== 'gold') save.update((d) => (d.elfSkin = 'gold'));
  await dialog(
    h(
      'div.book',
      {},
      h('h2', {}, '背包 · 道具图鉴'),
      h('h3', {}, '常驻道具'),
      h('p.hint', {}, '来源：开局赠送、连点啵啵、长按啵啵许愿、三星扭蛋'),
      ...COMMON_PROPS.map((p) => row(p, true)),
      h('h3', {}, `隐藏道具 ${got} / ${HIDDEN_PROPS.length}`),
      h('p.hint', {}, all ? '集齐啦！啵啵换上了金色皮肤 ✨' : '只能靠连点啵啵或三星扭蛋获得。集齐全部解锁啵啵的金色皮肤'),
      ...HIDDEN_PROPS.map((p) => row(p, collected.has(p.id))),
      h('h3', {}, '特殊格子'),
      ...Object.values(ELEMENT_INFO).map((e) => h('div.book-item', {}, h('div.book-icon', {}, e.icon), h('div.book-text', {}, h('div.book-name', {}, e.name), h('div.book-desc', {}, e.desc)))),
      h('h3', {}, '图案来源'),
      h('p.hint', {}, `前 16 张为原创手绘；之后的 ${EXTRA_PATTERNS.length} 张来自开放许可素材，经像素化处理。`),
      ...EXTRA_PATTERNS.filter((p) => p.source).map((p) =>
        h(
          'div.book-desc.credit',
          {},
          `${p.name} — ${p.source!.author ?? '未知作者'} · ${p.source!.license ?? ''} · `,
          p.source!.url ? h('a', { href: p.source!.url, target: '_blank', rel: 'noopener' }, '来源') : '',
        ),
      ),
    ),
    [{ label: '关闭', value: 'close', cls: 'primary' }],
    { dismissValue: 'close', cls: 'wide' },
  );
}
