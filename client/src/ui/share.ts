import { CARD_STYLES, defaultCardOptions, renderShareCard, type CardOptions, type ShareData } from '../render/shareCard';
import { dialog, h, toast } from './dom';
const CAPTIONS = ['把生活调成喜欢的颜色。', '一颗一颗，把今天的小开心拼完整。', '慢一点也没关系，可爱正在归位。', '给忙碌按下暂停，给自己一点颜色。', '今天也亲手完成了一件小小的美好。'];

export async function openShareStudio(data: ShareData, config: { initial?: CardOptions; onSave?: (options: CardOptions) => Promise<void>; saveLabel?: string; backLabel?: string } = {}) {
  let closed = false, request = 0, captionIndex = 0;
  const options: CardOptions = { ...(config.initial ?? defaultCardOptions()) };
  const preview = h('canvas.share-preview', { 'aria-label': '分享图片实时预览' }) as HTMLCanvasElement;
  const quote = h('textarea.studio-input', { rows: 3, maxlength: 60, 'aria-label': '分享文案' }, options.quote) as HTMLTextAreaElement;
  const attribution = h('a.quote-source', { href: 'https://hitokoto.cn', target: '_blank', rel: 'noopener noreferrer' });
  attribution.textContent = options.source;
  const status = h('p.studio-status', { role: 'status' }, `1080 × ${options.ratio === '9:16' ? 1920 : 1440} PNG · 为你的作品留个纪念`);
  const repaint = () => renderShareCard(preview, data, options);
  const styles = h('div.share-styles');
  for (const t of CARD_STYLES) {
    const button = h('button.share-style', { 'aria-pressed': t.id === options.style ? 'true' : 'false', style: { '--swatch': t.bg, '--swatch-ink': t.ink }, onclick: () => {
      options.style = t.id; styles.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); repaint();
    } }, h('span.style-swatch'), t.name);
    styles.append(button);
  }
  const ratio = h('select.studio-input', { 'aria-label': '分享图片比例' }, h('option', { value: '3:4' }, '小红书 · 3:4 竖图'), h('option', { value: '9:16' }, 'TikTok · 9:16 全屏')) as HTMLSelectElement;
  ratio.value = options.ratio;
  ratio.onchange = () => { options.ratio = ratio.value as CardOptions['ratio']; repaint(); status.textContent = `1080 × ${preview.height} PNG · 为你的作品留个纪念`; };
  quote.oninput = () => { request++; options.quote = quote.value; options.source = ''; attribution.textContent = ''; repaint(); };
  const local = h('button.btn', { onclick: () => { request++; options.quote = CAPTIONS[++captionIndex % CAPTIONS.length]; quote.value = options.quote; options.source = ''; attribution.textContent = ''; repaint(); } }, '换一句灵感');
  const online = h('button.btn', { onclick: async () => {
    const token = ++request; online.disabled = true; status.textContent = '正在找一句灵感…';
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('https://v1.hitokoto.cn/?c=i&c=k&max_length=36', { signal: controller.signal });
      if (!res.ok) throw new Error('unavailable');
      const result = await res.json();
      if (typeof result.hitokoto !== 'string' || !result.hitokoto.trim() || result.hitokoto.length > 60) throw new Error('invalid');
      if (closed || token !== request) return;
      options.quote = result.hitokoto; quote.value = options.quote;
      const from = typeof result.from === 'string' ? result.from.slice(0, 36) : '一言';
      options.source = `— ${from} · 一言 hitokoto.cn`;
      attribution.textContent = options.source; repaint();
      status.textContent = '已获取一言灵感，可直接使用或修改文案';
    } catch {
      if (closed || token !== request) return;
      options.quote = CAPTIONS[++captionIndex % CAPTIONS.length]; quote.value = options.quote; options.source = ''; attribution.textContent = ''; repaint();
      status.textContent = '一言暂时不可用，已为你换上内置文案';
    } finally { clearTimeout(timer); online.disabled = false; }
  } }, '从一言找灵感') as HTMLButtonElement;
  const download = h('button.btn.primary.big', { onclick: () => {
    preview.toBlob(blob => {
      if (!blob) return toast('图片生成失败，请再试一次');
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `拼豆归位-${data.level.name.replace(/[\\/:*?"<>|]/g, '')}-${options.style}.png`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast('图片已生成；手机也可打开图片后长按保存');
    }, 'image/png');
  } }, '↓ 下载高清图片');
  const view = h('button.btn', { onclick: () => {
    const img = h('img', { src: preview.toDataURL('image/png'), alt: '长按保存分享图片', style: { width: '100%', height: 'auto' } });
    void dialog(h('div', {}, h('p.hint', {}, '长按图片保存到相册'), img), [{ label: '返回编辑', value: 'back' }], { cls: 'studio-dialog' });
  } }, '打开图片 / 长按保存');
  const copy = h('button.btn', { onclick: async () => {
    const text = `${options.quote}\n${options.source}\n${data.level.name} · 亲手拼成的小美好\n#拼豆归位 #像素画 #治愈系 #PicturePlay`;
    try { await navigator.clipboard.writeText(text); toast('文案和话题已复制'); } catch { quote.focus(); quote.select(); toast('请长按或按 Ctrl+C 复制文案'); }
  } }, '复制发布文案');
  const saveToWall = config.onSave ? h('button.btn.primary', { onclick: async () => {
    saveToWall!.disabled = true;
    try { await config.onSave!({ ...options }); status.textContent = '已收进小画室的作品墙，可以随时重新布置和更换相框'; toast('作品墙已更新'); }
    catch (e) { status.textContent = e instanceof Error ? `未能保存：${e.message}` : '未能保存，请稍后重试'; }
    finally { saveToWall!.disabled = false; }
  } }, config.saveLabel ?? '保存进小画室') as HTMLButtonElement : null;
  repaint();
  await dialog(h('div.share-studio', {}, h('div.studio-eyebrow', {}, 'MADE BY YOU, SHARED WITH LOVE'), h('h2', {}, '把这份可爱带走'),
    h('p.hint', {}, '挑个相框，写一句心情。今天的作品值得被看见。'),
    h('div.share-layout', {}, h('div.share-preview-wrap', {}, preview), h('div.share-controls', {}, styles, h('label.studio-label', {}, '画面比例', ratio), h('label.studio-label', {}, '今日心情', quote), attribution,
      h('div.studio-actions', {}, local, online), status, saveToWall, download, view, copy))), [{ label: config.backLabel ?? '返回结算', value: 'back' }], { cls: 'share-dialog' });
  closed = true; request++;
}
