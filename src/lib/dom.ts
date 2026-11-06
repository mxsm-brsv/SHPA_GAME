// Мини-хелперы DOM без фреймворка.
export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => Array.from(root.querySelectorAll(sel)) as T[];

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ');

export const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

export function hm(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h} ч ${m % 60} мин` : `${m} мин`;
}

export function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Делегирование кликов по data-act. */
export function onAct(root: HTMLElement, handlers: Record<string, (target: HTMLElement, e: Event) => void>) {
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || !root.contains(t)) return;
    const fn = handlers[t.dataset.act!];
    if (fn) { e.preventDefault(); fn(t, e); }
  });
}

let toastTimer = 0;
export function toast(text: string, kind: 'ok' | 'bad' | 'info' = 'info') {
  let t = document.getElementById('toast');
  if (!t) { t = el('<div id="toast" class="toast" role="status" aria-live="polite"></div>'); document.body.appendChild(t); }
  t.className = `toast show ${kind}`;
  t.textContent = text;
  clearTimeout(toastTimer);
  // длинное сообщение висит дольше; тап по плашке убирает её сразу
  toastTimer = window.setTimeout(() => t!.classList.remove('show'), Math.min(5000, 2200 + text.length * 25));
  t.onclick = () => { clearTimeout(toastTimer); t!.classList.remove('show'); };
}

/** Модальное окно поверх экрана. Возвращает функцию закрытия. */
export function modal(inner: string, opts: { onClose?: () => void; cls?: string } = {}) {
  const m = el(`<div class="modal-back"><div class="modal ${opts.cls ?? ''}" role="dialog" aria-modal="true">
    <button class="modal-x" data-close aria-label="Закрыть">✕</button>${inner}</div></div>`);
  const close = () => { m.classList.add('hide'); setTimeout(() => m.remove(), 180); opts.onClose?.(); };
  m.addEventListener('click', (e) => {
    if (e.target === m || (e.target as HTMLElement).closest('[data-close]')) close();
  });
  document.body.appendChild(m);
  return { root: m.querySelector('.modal') as HTMLElement, close };
}

/** Всплывающее число над элементом (+340). */
export function floatText(anchor: HTMLElement, text: string, color = '#ffd76a') {
  const r = anchor.getBoundingClientRect();
  const f = el(`<div class="float-num" style="left:${r.left + r.width / 2}px;top:${r.top}px;color:${color}">${esc(text)}</div>`);
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1200);
}
