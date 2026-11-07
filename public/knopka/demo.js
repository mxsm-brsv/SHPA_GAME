// @ts-check
// Демо «Кнопки» без сервера (?demo): те же правила, что в базе (bz_* в миграциях v8–v9), но в памяти браузера.
// Вход — по ФИО и группе из выдуманного списка выезда. Восемь команд жмут ботами, в каждой команде есть
// зрители-боты, которые голосуют за клипы (кроме своего ПБ).

const NAMES = ['ГПИ', 'ИВТИ', 'ИГВИЭ', 'ИнЭИ', 'ИРЭ', 'ИТАЭ', 'ИЭВТ', 'ИЭТЭ', 'ИЭЭ', 'ЭнМИ'];
const CODES = ['gpi', 'ivti', 'igvie', 'inei', 'ire', 'itae', 'ievt', 'iete', 'iee', 'enmi'];
const FIRST = [['Анна', 'f'], ['Борис', 'm'], ['Виктория', 'f'], ['Глеб', 'm'], ['Дарья', 'f'], ['Егор', 'm'], ['Евгения', 'f'], ['Илья', 'm'],
  ['Екатерина', 'f'], ['Алексей', 'm'], ['Мария', 'f'], ['Никита', 'm'], ['Ольга', 'f'], ['Павел', 'm'], ['Маргарита', 'f'], ['Роман', 'm'],
  ['Татьяна', 'f'], ['Фёдор', 'm'], ['Юлия', 'f'], ['Артём', 'm'], ['Вера', 'f'], ['Дмитрий', 'm'], ['Ксения', 'f'], ['Михаил', 'm'], ['Анастасия', 'f'], ['Семён', 'm']];
const LAST = ['Соколов', 'Попов', 'Лебедев', 'Козлов', 'Новиков', 'Морозов', 'Волков', 'Зайцев', 'Павлов', 'Семёнов', 'Голубев', 'Виноградов',
  'Богданов', 'Воробьёв', 'Фёдоров', 'Михайлов', 'Беляев', 'Тарасов', 'Белов', 'Комаров', 'Киселёв', 'Макаров', 'Андреев', 'Ковалёв'];
const FREE_TEAMS = [5, 9]; // ИРЭ и ИЭЭ — без бота у кнопки: можно взять себе
/** Люди, под которыми можно войти в демо (подсказки на экране входа). */
const HINTS = [['Смирнова Анна Олеговна', 'ИРЭ-01-24', 'ire'], ['Орлов Павел Ильич', 'ИЭЭ-03-24', 'iee'], ['Белова Ксения Игоревна', 'ГПИ-02-24', 'gpi']];
/** Код организатора в демо (на живой базе — свой, хранится только отпечатком). */
const DEMO_ORG_CODE = 'МОЛНИЯ НА ЛОГОТИПЕ';
const normCode = (t) => String(t ?? '').toUpperCase().replace(/Ё/g, 'Е').replace(/[^0-9A-ZА-Я]+/g, ' ').replace(/\s+/g, ' ').trim();

const normFio = (t) => String(t ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я ]/g, ' ').replace(/\s+/g, ' ').trim();
const normGroup = (t) => String(t ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9а-яa-z]/g, '');
const digits = (t) => t.replace(/\D/g, '');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const tol = (w) => (w.length >= 6 ? 1 : 0);

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const tok = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

export class DemoServer {
  constructor() {
    this.v = 1;
    this.g = { title: 'Вечерка ШПА', round_id: null, teams_locked: false, countdown_ms: 3000, limit_ms: 0, lockout_ms: 1000,
      pts_ok: 1, pts_bad: 1, auto_close: true, vote_status: 'off', vote_title: 'Лучший клип' };
    this.teams = NAMES.map((name, i) => ({ id: i + 1, num: i + 1, name, code: CODES[i], captain: null, active: true }));
    /** @type {{id:number, fio:string, grp:string, faction:string|null}[]} */
    this.roster = [];
    const addPerson = (fio, grp, faction) => { const r = { id: this.roster.length + 1, fio, grp, faction }; this.roster.push(r); return r; };
    for (const [f, g, fa] of HINTS) addPerson(f, g, fa);
    this.clips = this.teams.map((t) => ({ id: t.id, num: t.num, title: '', team_id: t.id, active: true }));
    /** @type {Map<number, any>} */ this.clients = new Map();
    this.byToken = new Map();
    this.rounds = []; this.presses = []; this.adjust = []; this.votes = new Map(); this.hosts = new Set();
    this.seq = 1;
    this.timers = [];
    // боты: капитан и 3–6 зрителей в каждой команде, все — из «списка выезда»
    let p = 0;
    for (const t of this.teams) {
      const n = 3 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++, p++) {
        const [first, sex] = FIRST[p % FIRST.length], last = LAST[(p * 7) % LAST.length] + (sex === 'f' ? 'а' : '');
        const r = addPerson(`${last} ${first}`, `${t.name.toUpperCase()}-0${1 + (p % 6)}-24`, t.code);
        const c = this.newClient(first, 'tg', true);
        this.bind(c, r);
        if (k === 0 && !FREE_TEAMS.includes(t.num)) { t.captain = c.id; c.captainBot = true; }
      }
    }
    setInterval(() => this.botTick(), 250);
  }

  now() { return performance.timeOrigin + performance.now(); }
  bump() { this.v++; }
  newClient(name, kind, bot = false) {
    const c = { id: this.seq++, token: tok(), kind, name, fio: null, grp: null, roster_id: null, org: false, team_id: null, team_src: null, team_at: 0, last_seen_ms: bot ? this.now() : null,
      as_of_ms: null, rtt: bot ? Math.round(rnd(20, 90)) : null, err: bot ? Math.round(rnd(2, 15)) : null, seen_round: null, seen_lag: null, bot };
    this.clients.set(c.id, c); this.byToken.set(c.token, c);
    return c;
  }
  client(token) { return this.byToken.get(token) ?? null; }
  round() { return this.rounds.find((r) => r.id === this.g.round_id) ?? null; }
  captainOf(c) { return this.teams.find((t) => t.active && t.captain === c.id) ?? null; }

  // ── боты ──
  botTick() {
    const t = this.now();
    for (const c of this.clients.values()) if (c.bot) { c.last_seen_ms = t; c.as_of_ms = t - 120; }
  }
  onRoundStart(r) {
    for (const tm of this.teams) {
      const c = this.clients.get(tm.captain);
      if (!c?.bot) continue;
      const at = r.opens_ms + rnd(1200, 9000);
      this.timers.push(setTimeout(() => { if (this.g.round_id === r.id) this.press(c, r.id, at - rnd(0, 40), c.rtt, c.err, 1); }, at - this.now() + rnd(30, 200)));
    }
  }
  onVoteOpen() {
    const favs = [pick(this.clips), pick(this.clips)];
    for (const c of this.clients.values()) {
      if (!c.bot || this.votes.has(c.id)) continue;
      this.timers.push(setTimeout(() => {
        if (this.g.vote_status !== 'open') return;
        const ok = this.clips.filter((k) => k.active && k.team_id !== c.team_id);
        const choice = Math.random() < 0.55 ? favs.find((k) => k.team_id !== c.team_id) ?? pick(ok) : pick(ok);
        if (choice) this.votes.set(c.id, { clip_id: choice.id, team_id: c.team_id, src: c.team_src, kind: c.kind });
      }, rnd(1500, 25000)));
    }
  }

  // ── нажатие ──
  press(c, roundId, ms, rtt, err, n) {
    const t = this.now(), tm = this.captainOf(c);
    if (!tm) return { ok: false, code: 'no_team', round: roundId };
    const r = this.rounds.find((x) => x.id === roundId);
    if (!r || r.status === 'void') return { ok: false, code: 'void', round: roundId };
    const ex = this.presses.find((p) => p.round_id === r.id && p.team_id === tm.id);
    if (ex) return { ok: true, code: 'dup', round: r.id, press_ms: ex.press_ms };
    const fl = [];
    if (ms > t + 150) { fl.push('future'); ms = t; }
    if (ms < r.opens_ms - 25) return { ok: false, code: 'early', round: r.id };
    ms = Math.max(ms, r.opens_ms);
    if (r.closed_ms != null && ms > r.closed_ms) return { ok: false, code: 'closed', round: r.id };
    if (r.closes_ms != null && ms > r.closes_ms) return { ok: false, code: 'timeout', round: r.id };
    if (t - ms > Math.max(3000, 4 * (rtt ?? 0))) fl.push('late');
    this.presses.push({ round_id: r.id, team_id: tm.id, client_id: c.id, press_ms: ms, arrival_ms: t, rtt, err, attempts: n || 1, flags: fl, verdict: null, points: 0 });
    this.bump();
    if (r.status === 'open' && this.g.auto_close && r.id === this.g.round_id) {
      const nTeams = this.teams.filter((x) => x.active && x.captain).length;
      if (this.presses.filter((p) => p.round_id === r.id).length >= nTeams) Object.assign(r, { status: 'closed', closed_ms: t, closed_by: 'all' });
    }
    return { ok: true, code: 'ok', round: r.id, press_ms: ms, flags: fl };
  }

  // ── вход по ФИО ──
  teamFor(faction) { return this.teams.find((t) => t.active && t.code === faction)?.id ?? null; }
  bind(c, r) {
    const parts = r.fio.split(' ');
    Object.assign(c, { roster_id: r.id, fio: r.fio, grp: r.grp || null, name: `${parts[1] ?? ''} ${parts[0]}`.trim(), team_id: this.teamFor(r.faction), team_src: 'roster', team_at: Date.now() });
    for (const t of this.teams) if (t.captain === c.id && t.id !== c.team_id) t.captain = null;
  }
  /** Как _bz_roster_find: фамилия и имя в любом порядке, опечатка в длинных словах, цифры группы совпадают. */
  find(fio, grp, anyGroup = false) {
    const t = normFio(fio).split(' ').filter(Boolean), g = normGroup(grp);
    if (t.length < 2) return [];
    const found = this.roster.filter((r) => {
      const rt = normFio(r.fio).split(' ');
      const ok = t.some((a, i) => t.some((b, j) => i !== j && lev(a, rt[0]) <= tol(rt[0]) && lev(b, rt[1] ?? '') <= tol(rt[1] ?? '')));
      if (!ok) return false;
      return anyGroup || !r.grp || (g !== '' && digits(g) === digits(normGroup(r.grp)) && lev(g, normGroup(r.grp)) <= 3);
    });
    const by3 = found.filter((r) => { const p = normFio(r.fio).split(' ')[2]; return t.length >= 3 && p && t.some((w) => lev(w, p) <= tol(p)); });
    return found.length > 1 && by3.length ? by3 : found;
  }
  /** Подсказки: как bz_suggest. */
  suggest(kind, q) {
    if (kind === 'fio') {
      const t = normFio(q).split(' ').filter(Boolean);
      if (t.join('').length < 2) return [];
      return this.roster.filter((r) => { const w = normFio(r.fio).split(' '); return t.every((p) => w.some((x) => x.startsWith(p))); })
        .sort((a, b) => Number(normFio(b.fio).startsWith(t[0])) - Number(normFio(a.fio).startsWith(t[0])) || a.fio.localeCompare(b.fio)).slice(0, 8).map((r) => r.fio);
    }
    const g = normGroup(q);
    if (!g) return [];
    return [...new Set(this.roster.filter((r) => r.grp && normGroup(r.grp).startsWith(g)).map((r) => r.grp))].sort().slice(0, 8);
  }
  login(c, fio, grp, code) {
    const staff = String(code ?? '').trim() !== '';
    if (normFio(fio).split(' ').filter(Boolean).length < 2) return 'Напиши фамилию и имя';
    if ((c.roster_id != null || c.org) && this.votes.has(c.id)) return 'Ты уже проголосовал(а) — сменить вход может только ведущий.';
    c.fails = (c.fails ?? []).filter((x) => Date.now() - x < 900000);
    if (c.fails.length >= 8) return 'Слишком много попыток. Подожди 15 минут или подойди к ведущему.';
    if (staff) {
      if (normCode(code) !== DEMO_ORG_CODE) { c.fails.push(Date.now()); return 'Неверный код организатора (в демо — «молния на логотипе»)'; }
      const nm = String(fio).trim().replace(/\s+/g, ' ').replace(/(^|\s)\S/g, (x) => x.toUpperCase());
      for (const t of this.teams) if (t.captain === c.id) t.captain = null;
      Object.assign(c, { roster_id: null, org: true, fio: nm, grp: null, team_id: null, team_src: null, name: nm.slice(0, 40) });
      return null;
    }
    if (!String(grp ?? '').trim() && this.find(fio, '', true).some((r) => r.grp)) return 'Напиши группу — как в списке выезда, например ЭР-01-24';
    const found = this.find(fio, grp);
    if (!found.length) { c.fails.push(Date.now()); return 'Не нашли тебя в списке выезда. Проверь ФИО и группу. Если всё верно — подойди к ведущему.'; }
    if (found.length > 1) return 'Нашли несколько похожих — напиши ФИО полностью, с отчеством.';
    const r = found[0];
    if (c.roster_id === r.id) return null;
    const other = [...this.clients.values()].find((x) => x.roster_id === r.id);
    if (other) { c.fails.push(Date.now()); return 'Под этим ФИО уже вошли с другого телефона. Если это не ты — подойди к ведущему, он сбросит вход.'; }
    c.org = false;
    this.bind(c, r);
    const v = this.votes.get(c.id); if (v && this.clips.find((k) => k.id === v.clip_id)?.team_id === c.team_id) this.votes.delete(c.id);
    return null;
  }
  needTeam(c) {
    if (c.org) return 'Организаторы не жмут кнопку за команды';
    if (c.roster_id == null && c.team_id == null) return 'Сначала войди по ФИО и группе';
    if (c.team_id == null) return 'Твоего профбюро нет среди команд — подойди к ведущему';
    return null;
  }
  /** Загрузка списка: как _bz_roster_load. */
  loadRoster(rows, replace) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 400) return { error: 'Нужно от 1 до 400 строк' };
    let added = 0, updated = 0, removed = 0, bad = 0; const seen = new Set();
    for (const [pb, fio0, grp0] of rows) {
      const fio = String(fio0 ?? '').trim().replace(/\s+/g, ' '), fn = normFio(fio);
      if (fn.split(' ').filter(Boolean).length < 2) { bad++; continue; }
      if (seen.has(fn)) continue; seen.add(fn);
      const faction = CODES[NAMES.findIndex((x) => ` ${String(pb ?? '').toUpperCase().replace(/Ё/g, 'Е').replace(/[^А-ЯA-Z0-9]+/g, ' ')} `.includes(` ${x.toUpperCase()} `))] ?? null;
      const ex = this.roster.find((r) => normFio(r.fio) === fn);
      if (ex) { Object.assign(ex, { fio, grp: String(grp0 ?? '').trim(), faction }); updated++; }
      else { this.roster.push({ id: Math.max(0, ...this.roster.map((r) => r.id)) + 1, fio, grp: String(grp0 ?? '').trim(), faction }); added++; }
    }
    if (replace) {
      const gone = this.roster.filter((r) => !seen.has(normFio(r.fio)));
      removed = gone.length;
      for (const r of gone) for (const m of this.clients.values()) if (m.roster_id === r.id) { this.votes.delete(m.id); Object.assign(m, { roster_id: null, fio: null, grp: null, team_id: null, team_src: null }); }
      this.roster = this.roster.filter((r) => seen.has(normFio(r.fio)));
    }
    for (const m of this.clients.values()) if (m.roster_id != null && m.team_src === 'roster') { const r = this.roster.find((x) => x.id === m.roster_id); if (r) Object.assign(m, { fio: r.fio, grp: r.grp || null, team_id: this.teamFor(r.faction) }); }
    for (const tm of this.teams) if (tm.captain && this.clients.get(tm.captain)?.team_id !== tm.id) tm.captain = null;
    return { loaded: { added, updated, removed, bad, total: this.roster.length } };
  }

  // ── состояние ──
  score(tm) {
    const voids = new Set(this.rounds.filter((r) => r.status === 'void').map((r) => r.id));
    return this.presses.filter((p) => p.team_id === tm.id && !voids.has(p.round_id)).reduce((s, p) => s + p.points, 0)
      + this.adjust.filter((a) => a.team_id === tm.id).reduce((s, a) => s + a.delta, 0);
  }

  view(host, my) {
    const t = this.now(), g = this.g, off = 3500;
    const online = (c) => !!c && c.last_seen_ms != null && t - c.last_seen_ms < off;
    const teams = this.teams.filter((x) => x.active).map((tm) => {
      const c = this.clients.get(tm.captain);
      const j = { id: tm.id, num: tm.num, name: tm.name, score: this.score(tm), claimed: tm.captain != null, online: online(c),
        mine: !!my && my.team_id === tm.id, members: [...this.clients.values()].filter((m) => m.team_id === tm.id).length };
      if (my && my.team_id === tm.id && c) Object.assign(j, { captain_name: c.name, captain_me: c.id === my.id });
      if (host && c) Object.assign(j, { captain: { id: c.id, name: c.name, kind: c.kind, fio: c.fio }, ago_ms: Math.round(t - c.last_seen_ms), rtt: c.rtt, err: c.err,
        seen_lag: c.seen_round === g.round_id ? c.seen_lag : null });
      return j;
    });
    let rj = null;
    const r = this.round();
    if (r) {
      let st = r.status, cl = r.closed_ms, by = r.closed_by;
      if (st === 'open' && r.closes_ms != null && t >= r.closes_ms) { st = 'closed'; cl = r.closes_ms; by = 'limit'; }
      if (st === 'open' && t < r.opens_ms) st = 'countdown';
      const pressed = new Set(this.presses.filter((p) => p.round_id === r.id).map((p) => p.team_id));
      const caps = this.teams.filter((x) => x.active && x.captain && !pressed.has(x.id));
      const live = caps.filter((x) => online(this.clients.get(x.captain)));
      const w = live.length ? Math.min(...live.map((x) => this.clients.get(x.captain).as_of_ms ?? 0)) : Infinity;
      const ps = this.presses.filter((p) => p.round_id === r.id).sort((a, b) => a.press_ms - b.press_ms || a.arrival_ms - b.arrival_ms);
      const presses = ps.map((p, i) => {
        const prev = ps[i - 1], gap = prev ? p.press_ms - prev.press_ms : null;
        const j = { team: p.team_id, place: i + 1, press_ms: p.press_ms, rel_ms: Math.round((p.press_ms - r.opens_ms) * 10) / 10, gap_ms: gap,
          tie: gap != null && gap < 30, unsure: gap != null && gap < (p.err ?? 0) + (prev?.err ?? 0),
          confirmed: live.length === 0 || w >= Math.min(p.press_ms + 30, cl ?? Infinity), verdict: p.verdict, points: p.points };
        if (host) Object.assign(j, { delivery_ms: Math.round(p.arrival_ms - p.press_ms), rtt: p.rtt, err: p.err, attempts: p.attempts, flags: p.flags });
        return j;
      });
      const settled = presses.every((p) => p.confirmed) && (st === 'closed' || st === 'void' || live.length === 0);
      rj = { id: r.id, n: r.n, status: st, opens_ms: r.opens_ms, closes_ms: r.closes_ms, closed_ms: cl, closed_by: by, presses,
        waiting: live.map((x) => x.id), offline: caps.filter((x) => !online(this.clients.get(x.captain))).map((x) => x.id), settled };
    }
    const count = (k, f = (/** @type {any} */ _v) => true) => [...this.votes.values()].filter((v) => v.clip_id === k.id && f(v)).length;
    const clips = this.clips.filter((k) => k.active).map((k) => {
      const j = { id: k.id, num: k.num, title: k.title, team: k.team_id };
      if (host || g.vote_status === 'shown') j.votes = count(k);
      return j;
    });
    const out = {
      v: this.v,
      game: { title: g.title, locked: g.teams_locked, countdown_ms: g.countdown_ms, limit_ms: g.limit_ms, lockout_ms: g.lockout_ms,
        pts_ok: g.pts_ok, pts_bad: g.pts_bad, auto_close: g.auto_close, own_code: false },
      teams, round: rj, clips,
      vote: { status: g.vote_status, title: g.vote_title, total: this.votes.size },
    };
    if (my) {
      out.me = { id: my.id, name: my.name, fio: my.fio, grp: my.grp, kind: my.kind, team: my.team_id, team_src: my.team_src,
        in: my.roster_id != null || my.org, org: my.org,
        mates: my.team_id == null ? [] : [...this.clients.values()].filter((m) => m.team_id === my.team_id)
          .map((m) => ({ id: m.id, name: m.name, captain: !!this.captainOf(m) })).sort((a, b) => a.name.localeCompare(b.name)),
        captain: !!this.captainOf(my), vote: this.votes.get(my.id)?.clip_id ?? null };
    }
    if (host) {
      out.history = this.rounds.filter((x) => x.id !== g.round_id).slice(-30).reverse().map((x) => ({ id: x.id, n: x.n, status: x.status,
        order: this.presses.filter((p) => p.round_id === x.id).sort((a, b) => a.press_ms - b.press_ms)
          .map((p) => ({ team: p.team_id, verdict: p.verdict, points: p.points, rel_ms: Math.round(p.press_ms - x.opens_ms) })) }));
      out.members = [...this.clients.values()].map((m) => [m.id, m.name, m.fio, m.team_id, m.team_src, m.kind,
        m.last_seen_ms != null && t - m.last_seen_ms < 10000, this.votes.has(m.id), m.grp, m.org]);
      const bound = [...this.clients.values()].filter((m) => m.roster_id != null).length;
      out.roster = { total: this.roster.length, in: bound, no_team: this.roster.filter((r) => this.teamFor(r.faction) == null).length };
    }
    return out;
  }

  // ── вызовы как у REST ──
  call(fn, a) {
    const t0 = this.now();
    const wrap = (o) => ({ ...o, t0, t: this.now() });
    const c = a?.p_token ? this.client(a.p_token) : null;
    switch (fn) {
      case 'bz_time': return this.now();
      case 'bz_register_web': {
        const nc = this.newClient(String(a.p_name || 'Вы').slice(0, 40), 'tg');
        return { ok: true, token: nc.token, id: nc.id, name: nc.name };
      }
      case 'bz_tick': {
        if (!c) return wrap({ error: 'auth' });
        let pr = null;
        if (a.p_press) pr = this.press(c, a.p_press.round, a.p_press.ms, a.p_press.rtt, a.p_press.err, a.p_press.n);
        const r = this.round();
        Object.assign(c, { last_seen_ms: t0, rtt: a.p_rtt ?? c.rtt, err: a.p_err ?? c.err });
        if (a.p_asof != null) c.as_of_ms = Math.max(c.as_of_ms ?? 0, Math.min(a.p_asof, t0 + 100));
        if (a.p_round != null && r && a.p_round === r.id && c.seen_round !== r.id) { c.seen_round = r.id; c.seen_lag = Math.round((a.p_seen ?? t0) - r.opens_ms); }
        const live = !!this.captainOf(c) && !!r && r.status !== 'void' && (r.status === 'open' || (r.closed_ms ?? 0) > t0 - 15000);
        const res = a.p_v !== this.v || live || pr ? this.view(false, c) : { v: this.v };
        return wrap({ ...res, press: pr });
      }
      case 'bz_press': return c ? wrap(this.press(c, a.p_round, a.p_ms, a.p_rtt, a.p_err, a.p_attempts)) : { ok: false, code: 'auth' };
      case 'bz_login': {
        if (!c) return { ok: false, code: 'auth' };
        const e = this.login(c, a.p_fio, a.p_group, a.p_code); if (e) return { ok: false, error: e };
        this.bump(); return { ok: true, ...this.view(false, c) };
      }
      case 'bz_logout': {
        if (!c) return { ok: false, code: 'auth' };
        if (this.votes.has(c.id)) return { ok: false, error: 'Ты уже проголосовал(а) — сменить вход может только ведущий.' };
        for (const x of this.teams) if (x.captain === c.id) x.captain = null;
        Object.assign(c, { roster_id: null, org: false, fio: null, grp: null, team_id: null, team_src: null });
        this.bump(); return { ok: true, ...this.view(false, c) };
      }
      case 'bz_suggest': return c ? { items: this.suggest(a.p_kind, a.p_q) } : { code: 'auth' };
      case 'bz_host_enter': {
        if (!c) return { ok: false, code: 'auth' };
        if (!c.org) return { ok: false, error: 'Ведущим может стать только организатор — войди с кодом организатора' };
        const h = tok(); this.hosts.add(h); return { ok: true, token: h };
      }
      case 'bz_claim': {
        if (!c) return { ok: false, code: 'auth' };
        const tm = this.teams.find((x) => x.id === a.p_team && x.active);
        if (!tm) return { ok: false, error: 'Такой команды нет' };
        if (tm.captain === c.id) return { ok: true };
        const e = this.needTeam(c); if (e) return { ok: false, error: e };
        if (c.team_id !== tm.id) return { ok: false, error: `Ты в профбюро «${this.teams.find((x) => x.id === c.team_id)?.name}» — жать кнопку можно только за свою команду.` };
        if (this.g.teams_locked) return { ok: false, error: 'Ведущий закрыл выбор, кто жмёт кнопку. Подойди к ведущему.' };
        if (tm.captain) return { ok: false, error: `За команду «${tm.name}» уже жмёт ${this.clients.get(tm.captain)?.name}.` };
        for (const x of this.teams) if (x.captain === c.id) x.captain = null;
        tm.captain = c.id; this.bump(); return { ok: true };
      }
      case 'bz_unclaim': {
        if (!c) return { ok: false, code: 'auth' };
        for (const x of this.teams) if (x.captain === c.id) x.captain = null;
        this.bump(); return { ok: true };
      }
      case 'bz_assign': {
        if (!c) return { ok: false, code: 'auth' };
        const e = this.needTeam(c); if (e) return { ok: false, error: e };
        const tm = this.teams.find((x) => x.id === c.team_id);
        if (!tm) return { ok: false, error: 'Твоей команды нет в игре' };
        if (this.g.teams_locked) return { ok: false, error: 'Ведущий закрыл выбор, кто жмёт кнопку.' };
        if (tm.captain && tm.captain !== c.id) return { ok: false, error: `Кнопку жмёт ${this.clients.get(tm.captain)?.name} — передать её может только он или ведущий.` };
        const target = this.clients.get(Number(a.p_client));
        if (!target || target.team_id !== tm.id) return { ok: false, error: 'Этот человек не из твоего профбюро' };
        tm.captain = target.id; this.bump(); return { ok: true };
      }
      case 'bz_vote': {
        if (!c) return { ok: false, code: 'auth' };
        if (this.g.vote_status !== 'open') return { ok: false, error: 'Голосование сейчас закрыто' };
        if (c.roster_id == null && !c.org) return { ok: false, error: 'Сначала войди по ФИО и группе — голосуют участники выезда' };
        if (a.p_clip == null) this.votes.delete(c.id);
        else {
          const k = this.clips.find((x) => x.id === a.p_clip && x.active);
          if (!k) return { ok: false, error: 'Такого клипа нет' };
          if (k.team_id != null && k.team_id === c.team_id) return { ok: false, error: `Это клип твоего профбюро («${this.teams.find((x) => x.id === k.team_id)?.name}») — за него голосовать нельзя` };
          this.votes.set(c.id, { clip_id: k.id, team_id: c.team_id, src: c.team_src, kind: c.kind });
        }
        return { ok: true, ...this.view(false, c) };
      }
      case 'bz_host_login': {
        if (!String(a.p_code || '').trim()) return { ok: false, error: 'Введите любой код — это демо' };
        const h = tok(); this.hosts.add(h); return { ok: true, token: h };
      }
      case 'bz_host_state': return this.hosts.has(a.p_host) ? wrap(this.view(true, null)) : { error: 'auth' };
      case 'bz_screen': return wrap(this.view(false, null));
      case 'bz_host': {
        if (!this.hosts.has(a.p_host)) return { error: 'auth' };
        if (a.p_act === 'roster') {
          const r = this.loadRoster(a.p_arg?.rows, !!a.p_arg?.replace);
          if (r.error) return r;
          this.bump(); return { ...this.view(true, null), ...r, t: this.now() };
        }
        const e = this.hostAct(a.p_act, a.p_arg || {});
        if (e) return { error: e };
        this.bump(); return { ...this.view(true, null), t: this.now() };
      }
    }
    return { error: `нет функции ${fn}` };
  }

  hostAct(act, a) {
    const t = this.now(), g = this.g, r = this.round();
    const closeOpen = (by) => { if (r && r.status === 'open') Object.assign(r, { status: 'closed', closed_ms: Math.min(t, r.closes_ms ?? t), closed_by: by }); };
    switch (act) {
      case 'start': {
        closeOpen('next');
        const n = Math.max(0, ...this.rounds.filter((x) => x.status !== 'void').map((x) => x.n)) + 1;
        const nr = { id: this.rounds.length + 1, n, status: 'open', created_ms: t, opens_ms: t + g.countdown_ms,
          closes_ms: g.limit_ms > 0 ? t + g.countdown_ms + g.limit_ms : null, closed_ms: null, closed_by: null };
        this.rounds.push(nr); g.round_id = nr.id; this.onRoundStart(nr); return null;
      }
      case 'stop': closeOpen('host'); return null;
      case 'void': if (r) Object.assign(r, { status: 'void', closed_ms: r.closed_ms ?? t }); return null;
      case 'verdict': {
        const rid = a.round ?? g.round_id, p = this.presses.find((x) => x.round_id === rid && x.team_id === a.team);
        if (!p) return 'Эта команда не нажимала';
        p.verdict = a.v ?? null; p.points = a.v === 'ok' ? g.pts_ok : a.v === 'bad' ? -g.pts_bad : 0;
        if (a.v === 'ok') { const rr = this.rounds.find((x) => x.id === rid); if (rr?.status === 'open') Object.assign(rr, { status: 'closed', closed_ms: t, closed_by: 'ok' }); }
        return null;
      }
      case 'adjust': this.adjust.push({ team_id: a.team, delta: Number(a.delta) || 0 }); return null;
      case 'teams': {
        const names = (a.names || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
        if (!names.length) return 'Нужно от 1 до 20 команд';
        const code = (n) => CODES[NAMES.findIndex((x) => ` ${n.toUpperCase().replace(/Ё/g, 'Е').replace(/[^А-ЯA-Z0-9]+/g, ' ')} `.includes(` ${x.toUpperCase()} `))] ?? null;
        names.forEach((name, i) => { const tm = this.teams.find((x) => x.num === i + 1); if (tm) Object.assign(tm, { name, active: true, code: code(name) }); else this.teams.push({ id: this.teams.length + 1, num: i + 1, name, code: code(name), captain: null, active: true }); });
        for (const tm of this.teams) if (tm.num > names.length) Object.assign(tm, { active: false, captain: null });
        for (const m of this.clients.values()) {
          if (m.team_src === 'roster') m.team_id = this.teamFor(this.roster.find((r) => r.id === m.roster_id)?.faction);
          if (m.team_id != null && !this.teams.find((x) => x.id === m.team_id && x.active)) m.team_id = null;
        }
        for (const tm of this.teams) if (tm.captain && this.clients.get(tm.captain)?.team_id !== tm.id) tm.captain = null;
        return null;
      }
      case 'release': { const tm = this.teams.find((x) => x.id === a.team); if (tm) tm.captain = null; return null; }
      case 'release_all': this.teams.forEach((x) => { x.captain = null; }); return null;
      case 'lock': g.teams_locked = a.on ?? !g.teams_locked; return null;
      case 'settings':
        for (const k of ['title', 'countdown_ms', 'limit_ms', 'lockout_ms', 'pts_ok', 'pts_bad', 'auto_close', 'vote_title']) if (k in a) g[k] = a[k];
        return null;
      case 'new_game': g.round_id = null; this.rounds = []; this.presses = []; this.adjust = []; return null;
      case 'host_code': case 'logout_others': return null;
      case 'vote':
        if (!['off', 'open', 'closed', 'shown'].includes(a.status)) return 'bad status';
        g.vote_status = a.status; if (a.status === 'open') this.onVoteOpen(); return null;
      case 'vote_reset': this.votes.clear(); g.vote_status = 'off'; return null;
      case 'clips':
        if (this.votes.size) return 'Уже есть голоса — сначала «Сбросить голоса»';
        this.clips = (a.items || []).map((it, i) => ({ id: 100 + i + Math.floor(Math.random() * 1e6), num: i + 1, title: String(it.title || '').slice(0, 80), team_id: it.team ? Number(it.team) : null, active: true }));
        return null;
      case 'member': {
        const m = this.clients.get(Number(a.client)); if (!m) return 'Нет такого человека';
        m.team_id = a.team ? Number(a.team) : null; m.team_src = 'host'; m.team_at = Date.now();
        for (const x of this.teams) if (x.captain === m.id && x.id !== m.team_id) x.captain = null;
        const v = this.votes.get(m.id); if (v && this.clips.find((k) => k.id === v.clip_id)?.team_id === m.team_id) this.votes.delete(m.id);
        return null;
      }
      case 'captain': {
        const m = this.clients.get(Number(a.client)), tm = this.teams.find((x) => x.id === Number(a.team));
        if (!m || !tm) return 'Нет такого человека или команды';
        for (const x of this.teams) if (x.captain === m.id) x.captain = null;
        if (m.team_id !== tm.id) { m.team_id = tm.id; m.team_src = 'host'; }
        tm.captain = m.id; return null;
      }
      case 'unbind': {
        const m = this.clients.get(Number(a.client)); if (!m) return 'Нет такого человека';
        for (const x of this.teams) if (x.captain === m.id) x.captain = null;
        this.votes.delete(m.id);
        Object.assign(m, { roster_id: null, org: false, fio: null, grp: null, team_id: null, team_src: null });
        return null;
      }
      case 'kick': { const id = Number(a.client); for (const x of this.teams) if (x.captain === id) x.captain = null; this.votes.delete(id); this.clients.delete(id); return null; }
    }
    return 'Неизвестное действие';
  }
}

/** Заменитель Api для демо: те же вызовы, задержка «сети» 25–70 мс. */
export class DemoApi {
  /** @param {DemoServer} server */
  constructor(server) { this.server = server; this.url = 'demo'; this.headers = {}; }
  async rpc(fn, args = {}, _timeout = 0, hooks) {
    await new Promise((r) => setTimeout(r, rnd(12, 35)));
    const res = this.server.call(fn, JSON.parse(JSON.stringify(args)));
    await new Promise((r) => setTimeout(r, rnd(12, 35)));
    hooks?.onHeaders?.();
    return JSON.parse(JSON.stringify(res));
  }
}
