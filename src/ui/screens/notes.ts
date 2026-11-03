// Ответы организаторов: «принято», «не принято», начисления. Как бот, только внутри игры.
import { $, esc, modal } from '../../lib/dom';
import type { App } from '../app';

export async function openNotes(app: App) {
  await app.refreshNotes(true);
  const list = app.notes;
  const m = modal(`<h2 style="font-size:22px">Ответы организаторов</h2>
    <div class="small muted" style="margin:4px 0 10px">Здесь — проверка заданий и начисления.${app.backend.mode === 'online' ? ' В Telegram дублирует бот.' : ''}</div>
    <div class="list" data-l>${list.length ? list.map((n) => `<div class="li" style="display:block;${n.read ? 'opacity:.7' : ''}">
      <div style="color:${n.kind === 'ok' ? '#6dffb0' : n.kind === 'bad' ? '#ff8a8a' : 'inherit'}">${esc(n.text)}</div>
      <div class="small muted">${new Date(n.at + 3 * 3600_000).toISOString().slice(5, 16).replace('T', ' ').replace(/^(\d\d)-(\d\d)/, '$2.$1')}</div></div>`).join('') : '<div class="muted center">Пока пусто. Сдай задание — ответ придёт сюда.</div>'}</div>`);
  void $(m.root, '[data-l]');
  const unread = list.filter((n) => !n.read).map((n) => n.id);
  if (unread.length) {
    await app.backend.notesRead(unread).catch(() => {});
    list.forEach((n) => { n.read = true; });
    app.root.querySelectorAll<HTMLElement>('[data-notes]').forEach((n) => n.dispatchEvent(new CustomEvent('notes')));
  }
}
