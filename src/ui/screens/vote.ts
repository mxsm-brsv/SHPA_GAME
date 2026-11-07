// Голосование для участника: каждой команде — ✅ или ❌, за свою нельзя. Передумать можно, пока открыто.
// Чтобы попасть в команду, человек вписывает ФИО (сверка со списком выезда) и выбирает команду — можно записать
// и товарища без телефона. Вверху — своя команда и её состав.
import { icon } from '../../art/icons';
import { haptic } from '../../core/telegram';
import { isMine, teamColor, voteRank, voteScore, type VoteState, type VoteTeam } from '../../core/vote';
import { esc, fmt, modal, toast } from '../../lib/dom';
import type { App } from '../app';

export function openVote(app: App) {
  let st: VoteState | null = app.vote;
  let showMates = false, joinOpen = false, needGroup = false, lastFio = '';
  const m = modal('<div data-vb class="col" style="gap:10px"><div class="muted">Загрузка…</div></div>', { cls: 'vote-sheet', onClose: () => clearInterval(timer) });
  const box = m.root.querySelector<HTMLElement>('[data-vb]')!;
  const row = (t: VoteTeam, s: VoteState) => {
    const mine = isMine(s, t);
    const v = s.my[t.id];
    const live = s.status === 'open' && (!s.current || s.current === t.id);
    return `<div class="vote-row ${s.current === t.id ? 'now' : ''} ${mine ? 'mine' : ''}" style="--tc:${teamColor(s.teams, t.id)}">
      <div class="grow"><b>${esc(t.name)}</b>${s.current === t.id ? ' <span class="tag vote-now">выступает</span>' : ''}
        <div class="small muted">${mine ? 'твоя команда — голосуют другие' : v === 1 ? 'твой голос: ✅' : v === -1 ? 'твой голос: ❌' : live ? 'оцени' : ''}${s.status !== 'idle' ? ` · ✅ ${t.za} · ❌ ${t.protiv}` : ''}</div></div>
      ${mine ? '' : `<button class="vote-btn za ${v === 1 ? 'on' : ''}" data-v="1" data-t="${esc(t.id)}" ${live ? '' : 'disabled'} aria-label="За">✅</button>
        <button class="vote-btn pr ${v === -1 ? 'on' : ''}" data-v="-1" data-t="${esc(t.id)}" ${live ? '' : 'disabled'} aria-label="Против">❌</button>`}
    </div>`;
  };
  const draw = () => {
    if (!st || !st.teams.length) { box.innerHTML = '<h2>Голосование</h2><div class="muted">Сейчас голосования нет.</div>'; return; }
    const s = st;
    const myTeam = s.myTeam ? s.teams.find((t) => t.id === s.myTeam) : null;
    const head = s.status === 'open'
      ? (s.current ? `Сейчас выступает <b class="gold">${esc(s.teams.find((t) => t.id === s.current)?.name ?? '')}</b> — оцени её проект: ✅ или ❌` : 'Оцени каждую команду: ✅ или ❌. Передумать можно, пока голосование открыто — нажми ещё раз.')
      : s.status === 'closed' ? 'Голосование закрыто — итог на экране в зале.' : 'Голосование ещё не началось — организаторы откроют его на блоке.';
    const list = s.current ? [...s.teams].sort((a, b) => (a.id === s.current ? -1 : b.id === s.current ? 1 : 0)) : s.teams;
    const lead = s.reveal ? voteRank(s.teams)[0] : null;
    box.innerHTML = `<h2>${esc(s.title)}</h2>
      ${myTeam ? `<div class="card col vote-myteam" style="gap:6px;--tc:${teamColor(s.teams, myTeam.id)}"><div class="row"><span class="grow">Твоя команда: <b>${esc(myTeam.name)}</b></span>
          <button class="btn btn-ghost btn-sm" data-mates>${showMates ? 'Скрыть' : `Состав · ${s.mates?.length ?? 0}`}</button></div>
          ${showMates ? `<div class="small">${(s.mates ?? []).map((x) => esc(x)).join('<br>')}</div>` : ''}</div>` : ''}
      ${s.status !== 'closed' && !s.reveal ? joinHtml(s, !!myTeam) : ''}
      <div class="small">${head}</div>
      ${lead ? `<div class="card center" style="border-color:var(--gold)">${icon('trophy', 22, '#ffd76a')} Лучшая команда: <b class="gold">${esc(lead.name)}</b> · ${voteScore(lead) > 0 ? '+' : ''}${fmt(voteScore(lead))}</div>` : ''}
      <div class="col" style="gap:6px">${list.map((t) => row(t, s)).join('')}</div>
      <div class="small muted center">Проголосовали: ${fmt(s.voters)}</div>`;
  };
  // ---------- вписаться в команду ----------
  const joinHtml = (s: VoteState, hasTeam: boolean) => {
    if (hasTeam && !joinOpen) return `<button class="btn btn-ghost btn-sm" data-join-open>${icon('plus', 14)} Записать в команду товарища</button>`;
    return `<div class="card col" style="gap:8px"><b>${hasTeam ? 'Записать товарища в команду' : 'Вступи в свою команду'}</b>
      <div class="small muted">Впиши ФИО, как в списке выезда, и выбери команду. Можно записать и того, у кого нет телефона.</div>
      <input class="input-ans" data-fio placeholder="Фамилия Имя" autocomplete="off" value="${esc(lastFio)}">
      ${needGroup ? '<input class="input-ans" data-grp placeholder="Группа, например ЭР-01-25" autocomplete="off">' : ''}
      <div class="vote-teams">${s.teams.map((t) => `<button class="chip" data-jt="${esc(t.id)}" style="--tc:${teamColor(s.teams, t.id)}">${esc(t.name)}${t.size ? ` · ${t.size}` : ''}</button>`).join('')}</div>
      <div class="small muted">Нажми на свою команду — и готово.</div></div>`;
  };
  const join = async (team: string) => {
    const fio = (box.querySelector('[data-fio]') as HTMLInputElement | null)?.value.trim() ?? '';
    const grp = (box.querySelector('[data-grp]') as HTMLInputElement | null)?.value.trim() ?? '';
    lastFio = fio;
    if (fio.split(/\s+/).length < 2) { toast('Впиши фамилию и имя', 'bad'); return; }
    try {
      const r = await app.backend.voteJoin(fio, team, grp);
      st = r; app.vote = r; joinOpen = false; needGroup = false; lastFio = '';
      haptic('ok');
      toast(`${r.joined ?? fio} — в команде «${r.teams.find((t) => t.id === team)?.name ?? ''}»`, 'ok');
      draw();
    } catch (er) {
      const msg = (er as Error).message;
      if (/группу/.test(msg)) { needGroup = true; draw(); }
      toast(msg, 'bad'); haptic('bad');
    }
  };

  box.addEventListener('click', async (e) => {
    if ((e.target as HTMLElement).closest('[data-mates]')) { showMates = !showMates; draw(); return; }
    if ((e.target as HTMLElement).closest('[data-join-open]')) { joinOpen = true; draw(); return; }
    const jt = (e.target as HTMLElement).closest<HTMLElement>('[data-jt]');
    if (jt) { join(jt.dataset.jt!); return; }
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-v]');
    if (!b || b.disabled || !st) return;
    const team = b.dataset.t!;
    const v = Number(b.dataset.v) as 1 | -1;
    const next = st.my[team] === v ? 0 : v; // повторный тап снимает голос
    try {
      st = await app.backend.voteCast(team, next);
      app.vote = st;
      haptic(next ? 'ok' : 'tap');
      draw();
    } catch (er) { toast((er as Error).message, 'bad'); haptic('bad'); }
  });
  // пока человек печатает ФИО — не перерисовываем (обновление раз в 4 с стёрло бы ввод)
  box.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.matches('[data-fio]')) lastFio = t.value; });
  const load = async () => {
    const s = await app.backend.voteState();
    if (!s) return;
    st = s; app.vote = s;
    if (!(document.activeElement instanceof HTMLInputElement && box.contains(document.activeElement))) draw();
  };
  const timer = window.setInterval(() => { if (!document.hidden && !app.backend.cooling) load(); }, 8000);
  draw(); load();
}
