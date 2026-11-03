// Сцена базы ПБ: небо, ратуша с флагом фракции, домики, тотем у входа.
// Чем дальше глава кампании, тем больше построек вокруг ратуши.
import type { Faction } from '../config/factions';
import { totemSvg } from './totems';

export function baseSceneSvg(f: Faction, chapter: number, ratusha = true) {
  const extra = (n: number, s: string) => (chapter >= n ? s : '');
  const stars = Array.from({ length: 14 }, (_, i) => {
    const x = (i * 97) % 390, y = 70 + ((i * 53) % 150);
    return `<circle cx="${x}" cy="${y}" r="${(i % 3) * 0.4 + 0.8}" fill="#fff" opacity=".8"/>`;
  }).join('');
  return `<svg viewBox="0 0 390 700" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1d4f"/><stop offset=".55" stop-color="#4a3f8f"/><stop offset="1" stop-color="#e98a5f"/></linearGradient>
    <linearGradient id="lawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f9a5c"/><stop offset="1" stop-color="#2f6b44"/></linearGradient>
  </defs>
  <rect width="390" height="700" fill="url(#sky)"/>
  ${stars}
  <circle cx="272" cy="300" r="18" fill="#ffe3a8" opacity=".85"/>
  <path d="M0 420 L30 380 L60 400 L95 358 L130 390 L170 370 L210 392 L250 362 L290 388 L330 366 L390 392 L390 520 L0 520Z" fill="#2b2a63"/>
  <path d="M0 510 Q195 450 390 510 L390 700 L0 700Z" fill="url(#lawn)"/>
  <path d="M150 700 L172 510 L218 510 L240 700Z" fill="#c9b48e"/>
  ${extra(3, `<g><rect x="2" y="430" width="40" height="70" fill="#d9c7a6"/><path d="M0 432 L22 412 L44 432Z" fill="#5a4a9a"/><rect x="12" y="448" width="8" height="10" fill="#ffe08a"/><rect x="24" y="448" width="8" height="10" fill="#ffe08a"/></g>`)}
  ${extra(4, `<g><rect x="350" y="424" width="40" height="76" fill="#d9c7a6"/><path d="M346 426 L370 404 L394 426Z" fill="#3f6fb0"/><rect x="360" y="444" width="8" height="10" fill="#ffe08a"/><rect x="372" y="444" width="8" height="10" fill="#ffe08a"/></g>`)}
  ${ratusha ? `  <g>
    <rect x="128" y="392" width="134" height="110" rx="4" fill="#f1e3c8"/>
    <path d="M118 396 L195 352 L272 396Z" fill="#c8553d"/>
    <rect x="183" y="308" width="24" height="56" fill="#f1e3c8"/>
    <path d="M178 312 L195 288 L212 312Z" fill="#c8553d"/>
    <circle cx="195" cy="332" r="7" fill="#2b2a63"/><path d="M195 332 V327 M195 332 L198.5 333.5" stroke="#ffd76a" stroke-width="1.6"/>
    <g fill="#d9c7a6"><rect x="140" y="412" width="10" height="80"/><rect x="164" y="412" width="10" height="80"/><rect x="216" y="412" width="10" height="80"/><rect x="240" y="412" width="10" height="80"/></g>
    <rect x="183" y="440" width="24" height="62" rx="12" fill="#6a3d2a"/>
    <line x1="195" y1="288" x2="195" y2="250" stroke="#e8e8f5" stroke-width="2.5"/>
    <path d="M196 252 L234 258 L222 268 L234 278 L196 274Z" fill="${f.color}" stroke="#fff" stroke-width="1"/>
    ${extra(2, `<rect x="146" y="372" width="10" height="10" rx="2" fill="#ffe08a"/><rect x="234" y="372" width="10" height="10" rx="2" fill="#ffe08a"/>`)}
    ${extra(5, `<path d="M128 392 H262" stroke="#ffc83d" stroke-width="4"/><circle cx="195" cy="246" r="5" fill="#ffc83d"/>`)}
  </g>` : ''}
  <g><rect x="34" y="460" width="70" height="56" rx="4" fill="#e8d7b8"/><path d="M28 464 L69 438 L110 464Z" fill="#3f6fb0"/><rect x="60" y="486" width="18" height="30" rx="3" fill="#6a3d2a"/></g>
  <g><rect x="290" y="454" width="66" height="62" rx="4" fill="#e8d7b8"/><path d="M284 458 L323 434 L362 458Z" fill="#7a4fb4"/>
    <path d="M340 436 V406 M330 412 Q340 404 350 412 M326 406 Q340 394 354 406" stroke="#e8e8f5" stroke-width="2" fill="none"/>
    <rect x="312" y="484" width="18" height="32" rx="3" fill="#6a3d2a"/></g>
  <g fill="#2e7a45"><circle cx="18" cy="528" r="20"/><circle cx="124" cy="534" r="16"/><circle cx="270" cy="534" r="16"/><circle cx="378" cy="526" r="20"/></g>
  ${ratusha ? `<ellipse cx="195" cy="582" rx="28" ry="7" fill="#1f4a30" opacity=".6"/>
  <g transform="translate(167 528)">${totemSvg(f, 56, false).replace('<svg', '<svg x="0" y="0"')}</g>` : ''}
</svg>`;
}
