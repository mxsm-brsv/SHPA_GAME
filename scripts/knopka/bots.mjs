// Боты-капитаны для проверки и репетиции: занимают свободные команды и жмут через 0,5–6 с после старта.
// Тот же код телефона (public/knopka/core.js). У ботов нет ФИО из списка выезда, поэтому команду им назначает
// ведущий (код организатора — HOST_CODE, локально ORG-TEST).
// Запуск: bun scripts/knopka/bots.mjs <адрес> <ключ> [сколько] [секунд работы]
import { Api, Clock, TeamLink } from '../../public/knopka/core.js';

const [URL_ = 'http://127.0.0.1:54321', KEY = 'local-anon-key', N = '7', SECS = '600'] = process.argv.slice(2);
const api = new Api(URL_, KEY);
const host = await api.rpc('bz_host_login', { p_code: process.env.HOST_CODE ?? 'ORG-TEST', p_key: 'bots' });
if (!host.ok) throw new Error('вход ведущего: ' + JSON.stringify(host));
let busy = Promise.resolve();
/** Назначить бота на свободную команду (по очереди, чтобы два бота не схватили одну). */
const takeFree = (id) => (busy = busy.then(async () => {
  const s = await api.rpc('bz_host_state', { p_host: host.token });
  const free = (s.teams ?? []).filter((t) => !t.claimed);
  const t = free[Math.floor(Math.random() * free.length)];
  if (t) await api.rpc('bz_host', { p_host: host.token, p_act: 'captain', p_arg: { team: t.id, client: id } });
}));
const links = [];
for (let i = 0; i < Number(N); i++) {
  const reg = await api.rpc('bz_register_web', { p_device: `bot-${i}-device-key-000000`, p_name: `Бот ${i + 1}` });
  const clock = new Clock();
  const store = new Map();
  let lastRound = 0;
  let asked = false;
  const link = new TeamLink({
    api, clock, token: reg.token, app: 'bot',
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) },
    onState: (s) => {
      if (!s.me?.captain) {
        if (!asked) { asked = true; takeFree(reg.id).then(() => link.kick()); }
        return;
      }
      const r = s.round;
      if (r && r.id !== lastRound && (r.status === 'open' || r.status === 'countdown')) {
        lastRound = r.id;
        const wait = Math.max(0, r.opens_ms - clock.server()) + 500 + Math.random() * 5500;
        setTimeout(() => link.press(clock.now()), wait);
      }
    },
  });
  link.start();
  links.push(link);
}
console.log(`ботов: ${links.length}`);
setTimeout(() => { links.forEach((l) => l.stop()); process.exit(0); }, Number(SECS) * 1000);
