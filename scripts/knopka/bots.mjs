// Боты-капитаны для проверки и репетиции: занимают свободные команды и жмут через 0,5–6 с после старта.
// Тот же код телефона (public/knopka/core.js). Запуск: bun scripts/knopka/bots.mjs <адрес> <ключ> [сколько] [секунд работы]
import { Api, Clock, TeamLink } from '../../public/knopka/core.js';

const [URL_ = 'http://127.0.0.1:54321', KEY = 'local-anon-key', N = '7', SECS = '600'] = process.argv.slice(2);
const api = new Api(URL_, KEY);
const links = [];
for (let i = 0; i < Number(N); i++) {
  const reg = await api.rpc('bz_register_web', { p_device: `bot-${i}-device-key-000000`, p_name: `Бот ${i + 1}` });
  const clock = new Clock();
  const store = new Map();
  let lastRound = 0;
  const link = new TeamLink({
    api, clock, token: reg.token, app: 'bot',
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) },
    onState: (s) => {
      if (!s.me?.team) {
        const free = s.teams.filter((t) => !t.claimed);
        const t = free[Math.floor(Math.random() * free.length)];
        if (t) api.rpc('bz_claim', { p_token: reg.token, p_team: t.id }).then(() => link.kick());
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
