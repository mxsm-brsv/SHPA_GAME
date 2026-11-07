// «Антистресс»: четыре залипательных занятия — ковры, кинетический песок, слаймы, пупырка.
// Проиграть нельзя. Каждое законченное дело даёт очки спокойствия; из них — обычный бонус профкоинов дня.
import { el } from '../lib/dom';
import type { App } from '../ui/app';
import { carpetScene } from './calm-carpet';
import { buzzer, loadStore, saveStore, sfx, speaker, type CalmCtx, type Scene } from './calm-kit';
import { sandScene } from './calm-sand';
import { slimeScene } from './calm-slime';
import { wrapScene } from './calm-wrap';
import { reportResult, shell, type PlayCtx } from './kit';

type Mode = 'carpet' | 'sand' | 'slime' | 'wrap';
const MODES: Record<Mode, (cc: CalmCtx) => Scene> = { carpet: carpetScene, sand: sandScene, slime: slimeScene, wrap: wrapScene };

const ART: Record<Mode, string> = {
  carpet: `<svg viewBox="0 0 120 84" aria-hidden="true">
    <g stroke="#efe3c8" stroke-width="1.6" stroke-linecap="round">${Array.from({ length: 15 }, (_, i) => `<path d="M${25 + i * 5} 10v-6M${25 + i * 5} 74v6"/>`).join('')}</g>
    <rect x="22" y="10" width="76" height="64" rx="2" fill="#1d2b5a"/><rect x="29" y="17" width="62" height="50" fill="#8e1b2c"/>
    <rect x="29" y="17" width="62" height="50" fill="none" stroke="#e2b65a" stroke-width="1.4"/>
    <path d="M60 24 78 42 60 60 42 42Z" fill="#1d2b5a" stroke="#e2b65a" stroke-width="1.2"/><circle cx="60" cy="42" r="8" fill="#f3e3c3"/><circle cx="60" cy="42" r="3.4" fill="#2e6f9e"/>
    <path d="M22 10h30L30 74h-8z" fill="#7d6a52"/><circle cx="28" cy="52" r="4" fill="#5b3f26"/><circle cx="36" cy="26" r="3" fill="#6a4a2c"/>
    <path d="M52 10h11L41 74H30z" fill="#d8efff" opacity=".45"/></svg>`,
  sand: `<svg viewBox="0 0 120 84" aria-hidden="true">
    <path d="M4 70h100l12-11H16z" fill="#d9b07a"/><rect x="4" y="70" width="100" height="5" fill="#9b6b3a"/>
    <path d="M14 32h42l10-8H24z" fill="#ffd27a"/>
    <rect x="14" y="32" width="42" height="9" fill="#ff8fab"/><rect x="14" y="41" width="42" height="9" fill="#ffc46b"/><rect x="14" y="50" width="42" height="9" fill="#8ef0a7"/><rect x="14" y="59" width="42" height="9" fill="#7cc8ff"/>
    <path d="M56 32l10-8v36l-10 8z" fill="#b79bff"/>
    <g transform="rotate(52 72 68)"><rect x="62" y="32" width="10" height="36" fill="#ff8fab"/><rect x="62" y="41" width="10" height="9" fill="#ffc46b"/><rect x="62" y="50" width="10" height="9" fill="#8ef0a7"/><rect x="62" y="59" width="10" height="9" fill="#7cc8ff"/></g>
    <g fill="#ffc46b">${[[88, 66], [92, 64], [95, 67], [99, 65], [90, 68], [97, 62], [102, 67]].map(([x, y]) => `<rect x="${x}" y="${y}" width="2" height="2"/>`).join('')}</g>
    <path d="M40 4h3v20l-1.5 4-1.5-4z" fill="#e8edf4"/><rect x="38.5" y="-14" width="6" height="18" rx="2" fill="#7a4e2c"/></svg>`,
  slime: `<svg viewBox="0 0 120 84" aria-hidden="true"><defs><linearGradient id="clm-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9f1ff"/><stop offset=".4" stop-color="#4fb8ff"/><stop offset="1" stop-color="#1f5fcf"/></linearGradient></defs>
    <ellipse cx="60" cy="74" rx="40" ry="5" fill="#000" opacity=".25"/>
    <path d="M18 72c-4-18 8-40 30-44 10-12 30-10 38 2 16 6 22 24 16 42z" fill="url(#clm-s)"/>
    <g fill="#fff">${[[40, 50, 1.6], [52, 60, 1.2], [66, 44, 1.4], [78, 58, 1.8], [58, 52, 1], [86, 48, 1.2], [34, 62, 1.3], [70, 66, 1]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
    <ellipse cx="46" cy="40" rx="12" ry="4.5" fill="#fff" opacity=".6" transform="rotate(-24 46 40)"/><circle cx="34" cy="50" r="2" fill="#fff" opacity=".85"/></svg>`,
  wrap: `<svg viewBox="0 0 120 84" aria-hidden="true"><defs><radialGradient id="clm-b" cx=".32" cy=".3" r=".75"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="#fff" stop-opacity=".5"/><stop offset=".8" stop-color="#cde8ff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity=".7"/></radialGradient></defs>
    <rect x="6" y="6" width="108" height="72" rx="6" fill="#cde8ff" opacity=".14" stroke="#cde8ff" stroke-opacity=".4"/>
    ${[0, 1, 2, 3].map((j) => [0, 1, 2, 3, 4].map((i) => {
      const x = 20 + i * 20 + (j % 2) * 10, y = 17 + j * 17;
      if (x > 104) return '';
      const flat = (i + j * 2) % 5 === 1;
      return flat ? `<path d="M${x - 6} ${y}l3-5 6 1 3 4-3 5-6-1z" fill="none" stroke="#fff" stroke-opacity=".35"/>` : `<circle cx="${x}" cy="${y}" r="7.5" fill="url(#clm-b)"/>`;
    }).join('')).join('')}</svg>`,
};

export function openCalm(app: App, ctx?: PlayCtx) {
  const sh = shell(app, 'calm', ctx, { dark: true });
  sh.setSub('Тут нельзя проиграть');
  const store = loadStore();
  sfx.setMuted(store.mute);
  try { void (document as Document & { fonts?: FontFaceSet }).fonts?.load("400 40px 'Russo One'"); } catch { /* шрифт подтянется сам */ }
  const toastBox = el('<div class="calm-toast hidden"></div>');
  sh.node.appendChild(toastBox);
  let toastT = 0;
  const toast = (text: string) => {
    toastBox.textContent = text;
    toastBox.classList.remove('hidden');
    toastBox.classList.remove('in'); void toastBox.offsetWidth; toastBox.classList.add('in');
    clearTimeout(toastT);
    toastT = window.setTimeout(() => toastBox.classList.add('hidden'), 2200);
  };

  let score = 0, reportT = 0, scene: Scene | null = null;
  const report = async () => {
    const got = await reportResult(app, 'calm', score, Math.min(30, Math.floor(score / 2)), ctx).catch(() => 0);
    if (got > 0) toast(`+${got} профкоинов — бонус дня`);
  };
  const cc: CalmCtx = {
    sfx, store,
    save: () => saveStore(store),
    add: (n) => { score += n; sh.setScore(String(score)); clearTimeout(reportT); reportT = window.setTimeout(report, 800); },
    buzz: buzzer(),
    toast,
    back: () => hub(),
  };

  const hub = () => {
    scene?.stop(); scene = null; sfx.hush();
    const cards: [Mode, string, string, string, string][] = [
      ['carpet', 'Ковры', 'Пылесос, щётка, пена и мойка', `отмыто ${store.carpets.length} из 6`, 'linear-gradient(160deg,#6b3a2a,#2b1d3a)'],
      ['sand', 'Кинетический песок', 'Режь ломтиками — внутри сюрпризы', `${store.blocks} блоков`, 'linear-gradient(160deg,#6b5aa8,#2a2f6b)'],
      ['slime', 'Слаймы', 'Мни, тяни, режь и слепляй', '5 видов', 'linear-gradient(160deg,#7d5aa6,#3b2f6e)'],
      ['wrap', 'Пупырка', 'Лопай пузырьки, ищи золотые', `${store.sheets} листов`, 'linear-gradient(160deg,#1f3a7a,#1d2550)'],
    ];
    const node = el(`<div class="calm-hub">
      <div class="calm-intro"><div class="grow">Выдохни. Здесь нельзя проиграть: отмывай, режь, мни и лопай. Законченное дело — очки спокойствия, из них — бонус профкоинов дня.</div>
        <button class="calm-mute" data-mute aria-label="Звук">${speaker(store.mute)}</button></div>
      <div class="calm-grid">${cards.map(([id, name, text, stat, bg]) => `<button class="calm-card" data-mode="${id}">
        <div class="calm-art" style="background:${bg}">${ART[id]}</div>
        <b>${name}</b><span>${text}</span><em>${stat}</em></button>`).join('')}</div>
      <div class="small muted" style="text-align:center">Со звуком приятнее. Вибрация — в Telegram на телефоне.</div>
    </div>`);
    node.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      sfx.wake(); cc.buzz('light');
      scene = MODES[b.dataset.mode as Mode](cc);
      sh.body.replaceChildren(scene.node);
    }));
    const mute = node.querySelector<HTMLElement>('[data-mute]')!;
    mute.addEventListener('click', () => { store.mute = !store.mute; saveStore(store); sfx.setMuted(store.mute); mute.innerHTML = speaker(store.mute); sfx.wake(); });
    sh.body.replaceChildren(node);
  };
  hub();
  sh.onExit(() => { scene?.stop(); scene = null; sfx.hush(); clearTimeout(reportT); clearTimeout(toastT); if (score) void report(); });
}
