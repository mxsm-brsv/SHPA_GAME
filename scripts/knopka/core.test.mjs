// Проверка логики телефона без сети: часы, сон телефона, фальстарт, перезапуск с неотправленным нажатием,
// ответы не по порядку. Запуск: node scripts/knopka/core.test.mjs
import assert from 'node:assert/strict';
import { Clock, TeamLink, roundPhase } from '../../public/knopka/core.js';

let passed = 0;
const ok = (name) => { passed++; console.log('ok ', name); };

// ── часы ──
{
  // сервер опережает телефон на 1 000 000 мс; сеть симметричная 40/40 мс
  let t = 0; const c = new Clock(() => t);
  for (let i = 0; i < 5; i++) { const t0 = t; t += 40; const ts = t + 1e6; t += 40; c.add(t0, t, ts); t += 500; }
  assert.ok(Math.abs(c.offset - 1e6) < 0.5, `offset ${c.offset}`);
  assert.ok(c.err <= 40.1, `err ${c.err}`);
  ok('симметричная сеть: поправка точная, погрешность ≤ половины пинга');
}
{
  // несимметричная: туда 120 мс, обратно 20 мс — ошибка не больше заявленной погрешности
  let t = 0; const c = new Clock(() => t);
  for (let i = 0; i < 8; i++) { const t0 = t; t += 120; const ts = t + 5000; t += 20; c.add(t0, t, ts); t += 300; }
  const real = 5000, err = Math.abs(c.offset - real);
  assert.ok(err <= c.err + 1e-6, `ошибка ${err} > погрешности ${c.err}`);
  ok(`несимметричная сеть: ошибка ${err.toFixed(0)} мс в пределах заявленной ±${c.err.toFixed(0)} мс`);
}
{
  // один быстрый запрос среди медленных сужает погрешность (пересечение интервалов)
  let t = 0; const c = new Clock(() => t);
  const add = (up, down) => { const t0 = t; t += up; const ts = t + 777; t += down; c.add(t0, t, ts); t += 200; };
  add(300, 300); add(250, 400); const wide = c.err; add(10, 10);
  assert.ok(c.err < 11 && c.err < wide, `err ${c.err}`);
  assert.ok(Math.abs(c.offset - 777) < 11);
  ok('быстрый запрос сужает погрешность до ±10 мс');
}
{
  // мусорные ответы игнорируются
  const c = new Clock(() => 0);
  c.add(10, 5, 1); c.add(0, 20000, 1); c.add(0, 10, NaN);
  assert.equal(c.count, 0);
  ok('отрицательный пинг, пинг > 15 с и NaN не учитываются');
}

// ── фазы вопроса ──
{
  const r = { status: 'open', opens_ms: 1000, closes_ms: 5000 };
  assert.equal(roundPhase(r, 999), 'countdown');
  assert.equal(roundPhase(r, 1000), 'open');
  assert.equal(roundPhase(r, 5000), 'closed');
  assert.equal(roundPhase({ ...r, status: 'void' }, 2000), 'void');
  assert.equal(roundPhase(null, 2000), 'idle');
  ok('фазы: отсчёт → идёт → закрыт по лимиту, отмена, нет вопроса');
}

// ── телефон команды на поддельном сервере ──
function fakeApi(handler) { return { rpc: async (fn, args) => handler(fn, args) }; }
function mkLink(opts = {}) {
  let mono = 1000, wall = 1_700_000_000_000;
  const clock = new Clock(() => mono);
  // синхронизация «как будто»: сервер = mono + 5000
  for (let i = 0; i < 4; i++) clock.add(mono - 10, mono, mono + 5000 - 5);
  const store = opts.store ?? new Map();
  const calls = [];
  const api = fakeApi(async (fn, args) => { calls.push({ fn, args }); return opts.reply ? opts.reply(fn, args) : { v: 1 }; });
  const link = new TeamLink({ api, clock, token: 't', store: { get: (k) => store.get(k) ?? null, set: (k, v) => (v === null ? store.delete(k) : store.set(k, v)) }, wallNow: () => wall });
  link.state = { v: 1, me: { team: 7, captain: true }, game: { lockout_ms: 1000 }, teams: [], round: { id: 3, status: 'open', opens_ms: 7000, presses: [] } };
  return { link, clock, calls, store, setMono: (x) => { mono = x; }, setWall: (x) => { wall = x; }, get mono() { return mono; } };
}
{
  const m = mkLink();
  m.link.running = true;
  // старт в 7000 по часам сервера (= 2000 по телефону); нажатие в 1500 — отсчёт
  assert.equal(m.link.press(1500), 'early');
  assert.equal(m.link.press(2100), 'locked', 'блок 1 с после фальстарта');
  assert.equal(m.link.press(2600), 'pressed');
  assert.equal(m.link.pending.ms, 2600 + 5000);
  assert.equal(m.link.press(2700), 'done', 'второе нажатие не принимается');
  ok('фальстарт блокирует на 1 с, потом нажатие идёт с меткой касания');
  m.link.stop();
}
{
  // перезапуск приложения с неотправленным нажатием: новое приложение отправляет его само
  const store = new Map();
  const m1 = mkLink({ store });
  m1.link.running = true;
  m1.link.press(3000);
  m1.link.stop();
  assert.ok(store.get('knopka.pending'));
  const m2 = mkLink({ store, reply: (fn, a) => (fn === 'bz_press' ? { ok: true, code: 'ok', round: a.p_round, press_ms: a.p_ms } : { v: 1 }) });
  assert.equal(m2.link.pending?.ms, 8000, 'нажатие восстановлено из памяти');
  m2.link.running = true;
  m2.link.sendPress();
  await new Promise((r) => setTimeout(r, 20));
  m2.link.stop();
  assert.equal(m2.link.pending, null);
  assert.equal(store.get('knopka.pending'), undefined);
  assert.equal(m2.calls.find((c) => c.fn === 'bz_press')?.args.p_ms, 8000, 'отправлено с исходной меткой');
  ok('после перезапуска неотправленное нажатие уходит с исходным временем касания');
}
{
  // сон телефона: монотонный таймер стоял 30 с, а настоящее время шло — часы сбрасываются
  const m = mkLink();
  m.link.checkSuspend();
  m.setWall(1_700_000_000_000 + 30000);
  assert.equal(m.link.checkSuspend(), true);
  assert.equal(m.clock.count, 0);
  ok('сон телефона замечен — часы синхронизируются заново');
}
{
  // ответы пульса пришли не по порядку: старый не откатывает новое состояние
  let n = 0; const resolvers = [];
  const m = mkLink();
  m.link.api = { rpc: (fn) => new Promise((res) => { resolvers.push(res); n++; }) };
  m.link.running = true;
  const a = m.link.tick(); const b = m.link.tick();
  resolvers[1]({ v: 5, round: { id: 9, status: 'open', opens_ms: 0, presses: [] }, me: { team: 7, captain: true }, teams: [], t0: 1, t: 1 });
  await b;
  resolvers[0]({ v: 4, round: { id: 8, status: 'closed', opens_ms: 0, presses: [] }, me: { team: 7, captain: true }, teams: [], t0: 1, t: 1 });
  await a;
  assert.equal(m.link.state.round.id, 9);
  assert.equal(m.link.v, 5);
  m.link.stop();
  ok('опоздавший ответ пульса не откатывает состояние');
}
{
  // пульс несёт неподтверждённое нажатие и «до этого момента нажатий не было» с запасом 100 мс
  const m = mkLink();
  m.link.running = true;
  m.setMono(2500);
  m.link.press(2400);
  await m.link.tick();
  const tick = m.calls.find((c) => c.fn === 'bz_tick').args;
  assert.equal(tick.p_press.ms, 7400);
  assert.ok(tick.p_asof <= 2500 + 5000 - 100 + 1e-6);
  m.link.stop();
  ok('пульс повторяет неподтверждённое нажатие и отчитывается с запасом 100 мс');
}
console.log(`\nВсего: ${passed} проверок пройдено`);
