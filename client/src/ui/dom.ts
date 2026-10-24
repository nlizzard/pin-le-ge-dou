type Attrs = Record<string, any>;

/** 轻量 DOM 构造：h('div.card#x', {onclick}, ...children) */
export function h<K extends keyof HTMLElementTagNameMap>(sel: string, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const m = sel.match(/^([a-z0-9]+)?(.*)$/i);
  const tag = (m?.[1] || 'div') as K;
  const el = document.createElement(tag);
  for (const part of (m?.[2] ?? '').match(/[.#][^.#\s]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [name, value] of Object.entries(v)) {
        if (name.startsWith('--')) el.style.setProperty(name, String(value));
        else Object.assign(el.style, { [name]: value });
      }
    }
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 星级显示（支持半星） */
export function starRow(stars: number, max = 3, cls = ''): HTMLElement {
  const row = h('div.stars' + (cls ? '.' + cls : ''));
  for (let k = 1; k <= max; k++) {
    const kind = stars >= k ? 'full' : stars >= k - 0.5 ? 'half' : 'empty';
    row.append(h('span.star.' + kind, {}, '★'));
  }
  return row;
}

/** CSS 豆子样式（空槽托盘、需求色条用） */
export function beadStyle(hex: string): string {
  return `conic-gradient(from 45deg, color-mix(in srgb, ${hex} 90%, #000) 0 25%, color-mix(in srgb, ${hex} 75%, #000) 0 50%, ${hex} 0 75%, color-mix(in srgb, ${hex} 65%, #fff) 0)`;
}

export interface DialogButton {
  label: string;
  cls?: string;
  value: string;
}

/** 模态弹窗，返回被点击按钮的 value */
export function dialog(content: Node, buttons: DialogButton[], opts: { cls?: string; dismissValue?: string } = {}): Promise<string> {
  return new Promise((resolve) => {
    const overlay = h('div.overlay');
    const close = (v: string) => {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 180);
      resolve(v);
    };
    const card = h(
      'div.dialog' + (opts.cls ? '.' + opts.cls : ''),
      {},
      content,
      buttons.length ? h('div.dialog-buttons', {}, ...buttons.map((b) => h('button.btn' + (b.cls ? '.' + b.cls.split(' ').join('.') : ''), { onclick: () => close(b.value) }, b.label))) : null,
    );
    if (opts.dismissValue) overlay.addEventListener('pointerdown', (e) => e.target === overlay && close(opts.dismissValue!));
    overlay.append(card);
    document.body.append(overlay);
  });
}

let toastTimer: number | undefined;
export function toast(text: string, ms = 1800) {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = h('div.toast');
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), ms);
}

/** 在页面坐标处弹出一个上浮文字 */
export function floatText(text: string, x: number, y: number, cls = '') {
  const el = h('div.float-text' + (cls ? '.' + cls : ''), { style: { left: x + 'px', top: y + 'px' } }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 1100);
}
