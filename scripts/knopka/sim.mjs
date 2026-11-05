// Симуляция вечерки: 10 «телефонов» с разной связью против настоящей базы (через rest-shim).
// Каждый телефон — тот же код, что в мини-приложении (public/knopka/core.js), но fetch идёт через
// «плохую сеть»: задержка туда и обратно отдельно, разброс, потери, обрывы; у части — сбитые часы.
// Истинный момент касания известен, поэтому можно посчитать ошибку метки и сравнить три способа судейства:
//   1) наш — по метке касания с синхронизацией часов;
//   2) «кто первым дошёл до сервера» — по времени прихода;
//   3) «время прихода минус половина пинга» — простая поправка на задержку.
// Запуск локально: bun scripts/knopka/sim.mjs http://127.0.0.1:54321 [вопросов]
// Против живой базы (Actions → Knopka check): KEY=<anon> HOST_TOKEN=<…> node scripts/knopka/sim.mjs <SUPABASE_URL> 8
// CLOSE=1 — «гонка»: все команды жмут в окне 0,3–0,7 с после старта (много почти одновременных нажатий).
import { writeFileSync } from 'node:fs';
import { Api, Clock, TeamLink, syncBurst } from '../../public/knopka/core.js';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:54321';
const ROUNDS = Number(process.argv[3] ?? 30);
const KEY = process.env.KEY ?? 'local-anon-key';
const CODE = process.env.HOST_CODE ?? 'ORG-TEST';
const CLOSE = process.env.CLOSE === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// детерминированный генератор, чтобы прогоны были сравнимы
let seed = 20261107;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const delay = (m, sd) => Math.max(2, m + sd * gauss());

const PROFILES = [
  { name: 'Wi-Fi площадки', up: [12, 4], down: [12, 4] },
  { name: 'LTE хороший', up: [40, 12], down: [35, 10] },
  { name: 'LTE: медленная отдача', up: [140, 40], down: [30, 8] },
  { name: '3G', up: [220, 80], down: [160, 60] },
  { name: 'Очень плохая связь + 10% потерь', up: [600, 250], down: [400, 180], loss: 0.10 },
  { name: 'Скачки задержки (30% по 0,8 с)', up: [45, 10], down: [45, 10], spike: [0.3, 800] },
  { name: 'Часы телефона +2 ч, уход 200 ppm', up: [50, 15], down: [50, 15], skew: 7.2e6, drift: 200e-6 },
  { name: '25% потерь', up: [80, 25], down: [80, 25], loss: 0.25 },
  { name: 'Обрывы связи (2 с из каждых 9 с)', up: [60, 15], down: [60, 15], outage: [9000, 2000] },
  { name: 'Спутник/VPN 300 мс', up: [300, 30], down: [300, 30] },
];

/** fetch через «сеть» профиля. Потеря — запрос висит до таймаута клиента, обрыв — мгновенная ошибка. */
function netFetch(p, t0) {
  return async (url, init) => {
    const now = performance.now() - t0;
    if (p.outage && now % p.outage[0] < p.outage[1]) throw new TypeError('offline');
    const hang = () => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))));
    const d = (a) => delay(a[0], a[1]) + (p.spike && rnd() < p.spike[0] ? p.spike[1] * rnd() : 0);
    if (p.loss && rnd() < p.loss) return hang();
    await sleep(d(p.up));
    const r = await fetch(url, init);
    const body = await r.text();
    if (p.loss && rnd() < p.loss) return hang();
    await sleep(d(p.down));
    return new Response(body, { status: r.status, headers: { 'content-type': 'application/json' } });
  };
}

const local = new Api(URL_, KEY);
const host = process.env.HOST_TOKEN ? { ok: true, token: process.env.HOST_TOKEN } : await local.rpc('bz_host_login', { p_code: CODE, p_key: 'sim' });
if (!host.ok) throw new Error('вход ведущего: ' + JSON.stringify(host));
const H = (act, arg = {}) => local.rpc('bz_host', { p_host: host.token, p_act: act, p_arg: arg });
// на живой базе не обнуляем счёт: вопросы проверки удаляет workflow, капитанов возвращает из снимка
if (process.env.LIVE !== '1') await H('new_game');
await H('release_all');
await H('settings', { countdown_ms: 1500, limit_ms: 0, auto_close: true, lockout_ms: 1000 });
const teams = (await H('lock', { on: false })).teams;

// точная связь «часы этого процесса» ↔ «часы базы» для истины (без сети, ~0,3 мс)
const hostClock = new Clock();
await syncBurst(local, hostClock, 20);
const truthOffset = hostClock.offset; // server = performance.now() + truthOffset
console.log(`истина: часы базы = performance.now() + ${truthOffset.toFixed(1)} (±${hostClock.err.toFixed(2)} мс)`);

const T0 = performance.now();
const phones = [];
for (let i = 0; i < 10; i++) {
  const p = PROFILES[i];
  const reg = await local.rpc('bz_register_web', { p_device: `sim-device-${i}-${Date.now()}`, p_name: `Тест-сим ${i + 1}` });
  const api = new Api(URL_, KEY, netFetch(p, T0));
  const clock = new Clock(() => performance.now() * (1 + (p.drift ?? 0)) + (p.skew ?? 0));
  const store = new Map();
  const link = new TeamLink({ api, clock, token: reg.token, app: 'sim', store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) },
    wallNow: () => Date.now() + (p.skew ?? 0) });
  // кто жмёт — назначает ведущий (сами телефоны входят по ФИО из списка выезда, а у теста ФИО нет)
  const c = await H('captain', { team: teams[i].id, client: reg.id });
  if (c?.error) throw new Error('captain ' + JSON.stringify(c));
  phones.push({ i, p, link, clock, team: teams[i].id, errs: [], seenLag: [], atPress: [] });
}
phones.forEach((ph) => ph.link.start());
console.log('ждём синхронизацию часов…');
for (let k = 0; k < 100 && phones.some((ph) => !ph.clock.ready); k++) await sleep(200);
await sleep(3000);

const stats = { rounds: 0, our: 0, arrival: 0, ping: 0, pairs: { our: [0, 0], arrival: [0, 0], ping: [0, 0] }, surePairs: [0, 0], confirmMs: [], flips: 0, wrongConfirmed: 0, wrongButFlagged: 0, notPressed: 0, ties: 0 };

for (let q = 0; q < ROUNDS; q++) {
  const st = await H('start');
  const opens = st.round.opens_ms;
  const rid = st.round.id;
  // реакция команд: 0,4–4 с после старта; в каждом третьем вопросе две команды «почти одновременно» (5–60 мс)
  const plan = phones.map(() => (CLOSE ? 300 + rnd() * 400 : 400 + rnd() * 3600));
  if (q % 3 === 0) { const a = Math.floor(rnd() * 10); let b = Math.floor(rnd() * 10); if (b === a) b = (a + 1) % 10; plan[b] = plan[a] + 5 + rnd() * 55; }
  const truth = new Map();
  const startLocal = opens - truthOffset; // момент старта по performance.now()
  for (const ph of phones) {
    const at = startLocal + plan[ph.i];
    setTimeout(async () => {
      // телефон мог ещё не узнать о вопросе (плохая связь) — человек жмёт, пока не сработает
      for (let k = 0; k < 400; k++) {
        // телефон ещё не узнал об этом вопросе — ждём; уже идёт следующий — этот вопрос пропущен
        const known = ph.link.round?.id;
        if (known !== undefined && known > rid) return;
        if (known !== rid) { await sleep(15); continue; }
        const tp = performance.now();
        const res = ph.link.press(ph.clock.now());
        if (res === 'pressed') {
          truth.set(ph.team, tp + truthOffset);
          const trueOff = truthOffset - tp * (ph.p.drift ?? 0) - (ph.p.skew ?? 0);
          ph.atPress.push({ offErr: ph.clock.offset - trueOff, err: ph.clock.err, n: ph.clock.count });
          return;
        }
        if (res === 'done') return;
        await sleep(15);
      }
    }, Math.max(0, at - performance.now()));
  }
  // наблюдаем за ведущим каждые 50 мс: когда подтвердился лидер и не поменялся ли он после подтверждения
  let confirmedLeader = null, confirmedAt = null; const tEnd = performance.now() + 4000 + 1500 + 7000;
  let last = null;
  while (performance.now() < tEnd) {
    last = await local.rpc('bz_host_state', { p_host: host.token });
    const pr = last.round?.presses ?? [];
    if (pr[0]?.confirmed && confirmedLeader === null) { confirmedLeader = pr[0].team; confirmedAt = performance.now() + truthOffset; }
    if (confirmedLeader !== null && pr[0] && pr[0].team !== confirmedLeader) { stats.flips++; confirmedLeader = pr[0].team; }
    // все, кто успел нажать, дошли до сервера и места подтверждены
    const plannedEnd = startLocal + Math.max(...plan) + 1500;
    if (last.round.settled && pr.length >= 10) break;
    if (performance.now() > plannedEnd && last.round.settled && pr.length >= truth.size) break;
    await sleep(50);
  }
  await H('stop');
  last = await local.rpc('bz_host_state', { p_host: host.token });
  const pr = last.round.presses;
  stats.rounds++;
  stats.notPressed += 10 - pr.length;
  for (const p of pr) {
    const ph = phones.find((x) => x.team === p.team);
    const tr = truth.get(p.team);
    if (tr !== undefined) ph.errs.push(p.press_ms - tr);
    const tm = last.teams.find((t) => t.id === p.team);
    if (tm?.seen_lag !== undefined && tm.seen_lag !== null) ph.seenLag.push(tm.seen_lag);
  }
  // три способа судейства против истины
  const rows = pr.filter((p) => truth.has(p.team)).map((p) => ({ team: p.team, truth: truth.get(p.team), ours: p.press_ms, err: p.err ?? 0,
    arrival: p.press_ms + p.delivery_ms, ping: p.press_ms + p.delivery_ms - (p.rtt ?? 0) / 2 }));
  const first = (k) => rows.slice().sort((a, b) => a[k] - b[k])[0]?.team;
  const tFirst = first('truth');
  if (first('ours') === tFirst) stats.our++;
  if (first('arrival') === tFirst) stats.arrival++;
  if (first('ping') === tFirst) stats.ping++;
  for (let a = 0; a < rows.length; a++) for (let b = a + 1; b < rows.length; b++) {
    const A = rows[a], B = rows[b];
    if (Math.abs(A.truth - B.truth) < 1) continue;
    // «надёжная» пара: система сама считает порядок гарантированным (разница больше погрешностей)
    if (Math.abs(A.ours - B.ours) >= Math.max(30, A.err + B.err)) {
      stats.surePairs[1]++;
      if (Math.sign(A.ours - B.ours) === Math.sign(A.truth - B.truth)) stats.surePairs[0]++;
    }
    for (const k of ['our', 'arrival', 'ping']) {
      const key = k === 'our' ? 'ours' : k;
      stats.pairs[k][1]++;
      if (Math.sign(A[key] - B[key]) === Math.sign(A.truth - B.truth)) stats.pairs[k][0]++;
    }
  }
  if (confirmedAt !== null) {
    const leaderTruth = Math.min(...rows.map((r) => r.truth));
    stats.confirmMs.push(confirmedAt - leaderTruth);
    if (confirmedLeader !== tFirst) {
      const L = rows.find((x) => x.team === confirmedLeader), T = rows.find((x) => x.team === tFirst);
      const sure = !!L && !!T && Math.abs(L.ours - T.ours) >= Math.max(30, L.err + T.err);
      if (sure) stats.wrongConfirmed++; else stats.wrongButFlagged++;
      if (L && T) console.log(`   ⚠ вопрос ${q + 1}: подтверждён «${teams.find((t) => t.id === confirmedLeader)?.name}», на деле первыми «${teams.find((t) => t.id === tFirst)?.name}»: разница по истине ${(L.truth - T.truth).toFixed(0)} мс, по меткам ${(L.ours - T.ours).toFixed(0)} мс, погрешности ±${L.err}/±${T.err} мс — ${sure ? 'ОШИБКА' : 'ведущий видел «под вопросом»'}`);
    }
  }
  if (pr.some((p) => p.tie)) stats.ties++;
  process.stdout.write(`вопрос ${q + 1}: первыми ${teams.find((t) => t.id === tFirst)?.name}, мы ${first('ours') === tFirst ? '✓' : '✗'}, по приходу ${first('arrival') === tFirst ? '✓' : '✗'}, приход−пинг/2 ${first('ping') === tFirst ? '✓' : '✗'}\n`);
  await sleep(300);
}
phones.forEach((ph) => ph.link.stop());

const q = (arr, p) => { if (!arr.length) return NaN; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
console.log('\nОшибка метки касания по командам (мс, истина = 0):');
console.log('профиль'.padEnd(36), 'медиана', '  95%', '  макс', ' |точн.±|', ' узнал о старте (медиана, мс после)');
for (const ph of phones) {
  const abs = ph.errs.map(Math.abs);
  console.log(ph.p.name.padEnd(36), f(q(ph.errs, 0.5)).padStart(7), f(q(abs, 0.95)).padStart(6), f(Math.max(...abs)).padStart(6),
    f(ph.clock.err).padStart(8), f(q(ph.seenLag, 0.5)).padStart(10));
}
const pct = (a) => `${((a[0] / a[1]) * 100).toFixed(1)}% (${a[0]}/${a[1]})`;
const summary = {
  rounds: stats.rounds,
  firstPlaceCorrect: { ours: stats.our, arrival: stats.arrival, arrivalMinusHalfPing: stats.ping },
  pairOrderCorrect: { ours: pct(stats.pairs.our), arrival: pct(stats.pairs.arrival), arrivalMinusHalfPing: pct(stats.pairs.ping) },
  confirmLatencyMs: { median: Math.round(q(stats.confirmMs, 0.5)), p95: Math.round(q(stats.confirmMs, 0.95)) },
  surePairsCorrect: pct(stats.surePairs),
  leaderChangedAfterConfirm: stats.flips, wrongConfirmedLeader: stats.wrongConfirmed, wrongLeaderButFlaggedUnsure: stats.wrongButFlagged, missedPresses: stats.notPressed,
  roundsWithNearTie: stats.ties,
};
console.log('\nИтог:', JSON.stringify(summary, null, 2));
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ summary, phones: phones.map((ph) => ({ name: ph.p.name, errs: ph.errs, seenLag: ph.seenLag, err: ph.clock.err, atPress: ph.atPress })) }, null, 1));
// провал: лидер сменился после «точно», уверенно подтверждён не тот или ошибка в «надёжных» парах
const surePct = stats.surePairs[0] / Math.max(1, stats.surePairs[1]);
const fail = stats.flips > 0 || stats.wrongConfirmed > 0 || surePct < 0.995;
if (fail) console.log('\n❌ ПРОВАЛ проверки');
else console.log('\n✅ Проверка пройдена');
process.exit(fail ? 1 : 0);
