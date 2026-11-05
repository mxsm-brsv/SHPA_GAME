// Плашка голосования для экрана в зале: «за» и «против» по командам растут вживую, места переставляются,
// в конце — лучшая команда. Открывается из панели организатора («Голосование» → «На экран»). Обновляется каждые 2 с.
import { factionById } from '../../config/factions';
import { icon } from '../../art/icons';
import { voteRank, voteScore, type VoteState } from '../../core/vote';
import { $, el, esc, fmt } from '../../lib/dom';
import type { App } from '../app';

/** Число плавно «добегает» до нового значения. */
function countTo(node: HTMLElement, to: number, signed = false) {
  const from = Number(node.dataset.n ?? '0');
  node.dataset.n = String(to);
  if (from === to) { node.textContent = (signed && to > 0 ? '+' : '') + fmt(to); return; }
  const t0 = performance.now(), dur = 700;
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    node.textContent = (signed && v > 0 ? '+' : '') + fmt(v);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  node.classList.remove('bump'); void node.offsetWidth; node.classList.add('bump');
}

export function openVoteBoard(app: App) {
  const node = el(`<div class="screen full voteboard">
    <div class="vb-top"><div><div class="vb-kicker">Голосование</div><div class="vb-title" data-title></div></div>
      <div class="row" style="gap:14px"><div class="vb-status" data-status></div><button class="btn btn-ghost btn-sm" data-x aria-label="Закрыть">${icon('x', 18)}</button></div></div>
    <div class="vb-hero hidden" data-hero></div>
    <div class="vb-list" data-list></div>
    <div class="vb-foot"><span data-voters></span><span class="muted">Голосуй в игре: кнопка «Голосование» на базе · за свою команду нельзя</span></div>
    <div class="vb-fx" data-fx></div>
  </div>`);
  const list = $(node, '[data-list]');
  const hero = $(node, '[data-hero]');
  const rows = new Map<string, HTMLElement>();
  let revealed = false;

  const confetti = () => {
    const fx = $(node, '[data-fx]');
    for (let i = 0; i < 120; i++) {
      const p = el(`<i class="vb-conf" style="left:${Math.random() * 100}%;--d:${(Math.random() * 1.2).toFixed(2)}s;--x:${(Math.random() * 2 - 1) * 120}px;--r:${Math.random() * 900}deg;background:${['#ffc83d', '#4fd1a5', '#ff5fa2', '#7ea8ff', '#fff'][i % 5]}"></i>`);
      fx.appendChild(p);
      setTimeout(() => p.remove(), 4200);
    }
  };

  const draw = (s: VoteState) => {
    $(node, '[data-title]').textContent = s.title;
    const st = $(node, '[data-status]');
    st.className = `vb-status ${s.reveal ? 'win' : s.status}`;
    st.innerHTML = s.reveal ? `${icon('trophy', 18)} Итоги` : s.status === 'open' ? '<i class="vb-dot"></i> Голосование идёт' : s.status === 'closed' ? 'Голосование закрыто' : 'Скоро начнём';
    $(node, '[data-voters]').innerHTML = `Проголосовали: <b>${fmt(s.voters)}</b>`;
    const ranked = voteRank(s.teams);
    const max = Math.max(1, ...s.teams.map((t) => Math.max(t.za, t.protiv)));
    // команда на сцене — крупно сверху
    const cur = s.current ? s.teams.find((t) => t.id === s.current) : null;
    hero.classList.toggle('hidden', !cur);
    if (cur) {
      if (hero.dataset.id !== cur.id) {
        hero.dataset.id = cur.id;
        const f = cur.faction ? factionById(cur.faction) : null;
        hero.innerHTML = `<div class="vb-hname" style="--tc:${f?.color ?? '#ffc83d'}">${esc(cur.name)}</div>
          <div class="vb-hnums"><div class="vb-hz"><span>За</span><b data-hz>0</b></div><div class="vb-hp"><span>Против</span><b data-hp>0</b></div></div>
          <div class="vb-split"><i data-sz></i><i data-sp></i></div>`;
      }
      countTo($(hero, '[data-hz]'), cur.za);
      countTo($(hero, '[data-hp]'), cur.protiv);
      const sum = Math.max(1, cur.za + cur.protiv);
      $(hero, '[data-sz]').style.width = `${(cur.za / sum) * 100}%`;
      $(hero, '[data-sp]').style.width = `${(cur.protiv / sum) * 100}%`;
    } else hero.dataset.id = '';
    // список: места переставляются плавно (строки сдвигаются по top)
    list.style.setProperty('--n', String(ranked.length));
    ranked.forEach((t, i) => {
      let r = rows.get(t.id);
      if (!r) {
        const f = t.faction ? factionById(t.faction) : null;
        r = el(`<div class="vb-row" style="--tc:${f?.color ?? '#7ea8ff'}"><b class="vb-n"></b><div class="vb-name">${esc(t.name)}</div>
          <div class="vb-bars"><div class="vb-bp"><i></i><span data-p>0</span></div><div class="vb-bz"><i></i><span data-z>0</span></div></div>
          <b class="vb-score" data-s>0</b></div>`);
        rows.set(t.id, r);
        list.appendChild(r);
      }
      r.style.top = `calc(${i} * var(--rh))`;
      r.querySelector<HTMLElement>('.vb-n')!.textContent = String(i + 1);
      r.classList.toggle('now', s.current === t.id);
      r.classList.toggle('lead', s.reveal && i === 0);
      r.classList.toggle('dim', s.reveal && i > 2);
      (r.querySelector('.vb-bz i') as HTMLElement).style.width = `${(t.za / max) * 100}%`;
      (r.querySelector('.vb-bp i') as HTMLElement).style.width = `${(t.protiv / max) * 100}%`;
      countTo(r.querySelector<HTMLElement>('[data-z]')!, t.za);
      countTo(r.querySelector<HTMLElement>('[data-p]')!, t.protiv);
      countTo(r.querySelector<HTMLElement>('[data-s]')!, voteScore(t), true);
    });
    for (const [id, r] of rows) if (!s.teams.some((t) => t.id === id)) { r.remove(); rows.delete(id); }
    if (s.reveal && !revealed && ranked[0]) {
      revealed = true;
      const w = el(`<div class="vb-winner"><div class="vb-kicker">Лучшая команда</div><div class="vb-wname">${esc(ranked[0].name)}</div><div class="vb-wsc">за ${fmt(ranked[0].za)} · против ${fmt(ranked[0].protiv)}</div></div>`);
      $(node, '[data-fx]').appendChild(w);
      setTimeout(() => w.classList.add('out'), 6500);
      setTimeout(() => w.remove(), 7300);
      confetti();
    }
    if (!s.reveal) revealed = false;
  };

  const load = async () => { const s = await app.backend.voteState().catch(() => null); if (s) { app.vote = s; draw(s); } };
  const timer = window.setInterval(load, 2000);
  const close = () => { clearInterval(timer); node.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  $(node, '[data-x]').addEventListener('click', close);
  app.root.appendChild(node);
  try { node.requestFullscreen?.().catch(() => {}); } catch { /* браузер не дал */ }
  if (app.vote) draw(app.vote);
  load();
}
