import { setSoundEnabled } from '../audio';
import { save, type Settings } from '../save';
import { dialog, h } from './dom';

const LABELS: [keyof Settings, string, string][] = [
  ['sound', '音效', '点击、归位、爆破的声音'],
  ['vibrate', '震动', '手机上的触感反馈'],
  ['needBar', '需求色条', '显示空位需要的颜色'],
  ['colorBlind', '色弱模式', '每种颜色的豆子叠加一个符号'],
];

export function applySettings() {
  setSoundEnabled(save.data.settings.sound);
}

export async function openSettings(extra: { label: string; value: string; cls?: string }[] = []): Promise<string> {
  const rows = LABELS.map(([key, label, desc]) => {
    const input = h('input', { type: 'checkbox', checked: save.data.settings[key] || undefined }) as HTMLInputElement;
    input.addEventListener('change', () => {
      save.update((d) => (d.settings[key] = input.checked));
      applySettings();
    });
    return h('label.setting-row', {}, h('div', {}, h('div.setting-label', {}, label), h('div.setting-desc', {}, desc)), input, h('span.switch'));
  });
  return dialog(
    h('div', {}, h('h2', {}, '设置'), ...rows, h('p.hint', {}, '电脑：滚轮缩放 · 拖动平移 · +/- 缩放 · 0 复位 · Tab 下一个空位 · Esc 暂停')),
    [...extra, { label: '关闭', value: 'close', cls: 'primary' }],
    { dismissValue: 'close' },
  );
}
