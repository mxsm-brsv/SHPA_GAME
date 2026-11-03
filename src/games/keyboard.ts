// Экранная русская клавиатура для «Профвордла» и «Профкроссворда».
const ROWS = ['ЙЦУКЕНГШЩЗХЪ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ'];

export interface Keyboard { el: HTMLElement; mark(letter: string, cls: 'ok' | 'near' | 'no'): void; reset(): void }

export function keyboard(onKey: (k: string) => void, opts: { enter?: string } = {}): Keyboard {
  const el = document.createElement('div');
  el.className = 'kb';
  el.innerHTML = ROWS.map((r, i) => `<div class="kb-row">${i === 2 ? '<button class="kb-k kb-w" data-k="⌫" aria-label="Стереть">⌫</button>' : ''}${[...r].map((c) => `<button class="kb-k" data-k="${c}">${c}</button>`).join('')}${i === 2 ? `<button class="kb-k kb-w kb-enter" data-k="↵">${opts.enter ?? 'OK'}</button>` : ''}</div>`).join('');
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
    if (b) onKey(b.dataset.k!);
  });
  const onDoc = (e: KeyboardEvent) => {
    if (!el.isConnected) { document.removeEventListener('keydown', onDoc); return; }
    if (e.key === 'Backspace') onKey('⌫');
    else if (e.key === 'Enter') onKey('↵');
    else if (/^[а-яё]$/i.test(e.key)) onKey(e.key.toUpperCase() === 'Ё' ? 'Е' : e.key.toUpperCase());
  };
  document.addEventListener('keydown', onDoc);
  const rank = { no: 0, near: 1, ok: 2 } as const;
  return {
    el,
    mark(letter, cls) {
      const b = el.querySelector<HTMLElement>(`[data-k="${letter}"]`);
      if (!b) return;
      const cur = (['ok', 'near', 'no'] as const).find((c) => b.classList.contains(c));
      if (cur && rank[cur] >= rank[cls]) return;
      b.classList.remove('ok', 'near', 'no');
      b.classList.add(cls);
    },
    reset() { el.querySelectorAll('.kb-k').forEach((b) => b.classList.remove('ok', 'near', 'no')); },
  };
}
