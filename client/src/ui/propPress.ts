import { PROP_MAP, type PropId } from '../core/props';

/** 绑定在稳定的道具栏上，按钮刷新时也不会丢失正在进行的手势。 */
export function bindPropPress(root: HTMLElement, canInteract: () => boolean, tap: (id: PropId) => void, hold: (id: PropId) => void) {
  type Press = { pointer: number; prop: PropId; x: number; y: number; cancelled: boolean; held: boolean };
  let press: Press | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const propAt = (target: EventTarget | null): PropId | null => {
    const button = target instanceof Element ? target.closest<HTMLElement>('[data-prop]') : null;
    const id = button?.dataset.prop;
    return button && root.contains(button) && id && Object.hasOwn(PROP_MAP, id) ? id as PropId : null;
  };
  const cancel = () => {
    clearTimeout(timer);
    const pointer = press?.pointer;
    press = null;
    if (pointer !== undefined && root.hasPointerCapture(pointer)) root.releasePointerCapture(pointer);
  };
  root.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0) { cancel(); return; }
    const prop = propAt(e.target);
    if (!prop || !canInteract()) return;
    cancel();
    const current: Press = { pointer: e.pointerId, prop, x: e.clientX, y: e.clientY, cancelled: false, held: false };
    press = current;
    root.setPointerCapture(e.pointerId);
    timer = setTimeout(() => {
      if (press !== current || current.cancelled || !root.isConnected || !canInteract()) return;
      current.held = true;
      hold(current.prop);
    }, 500);
  });
  root.addEventListener('pointermove', e => {
    if (!press || press.pointer !== e.pointerId) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
      press.cancelled = true;
      clearTimeout(timer);
    }
  });
  root.addEventListener('pointerup', e => {
    if (!press || press.pointer !== e.pointerId) return;
    const current = press;
    cancel();
    if (!current.cancelled && !current.held && canInteract()) tap(current.prop);
  });
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('lostpointercapture', cancel);
  root.addEventListener('scroll', cancel, { passive: true });
  root.addEventListener('contextmenu', e => e.preventDefault());
  root.addEventListener('click', e => {
    // 触屏和鼠标已在 pointerup 处理；拦截长按松手后的兼容 click。
    e.preventDefault(); e.stopPropagation();
    if (e.detail === 0 && canInteract()) {
      const prop = propAt(e.target);
      if (prop) tap(prop); // 保留键盘 Enter / Space 与辅助技术激活。
    }
  });
  root.addEventListener('keydown', e => {
    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
    const prop = propAt(e.target);
    if (prop && canInteract()) { e.preventDefault(); hold(prop); }
  });
  return cancel;
}
