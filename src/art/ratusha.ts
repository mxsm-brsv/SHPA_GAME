// Ратуша ПБ для кликера: растёт вместе со зданиями (касса слева, штаб справа, медиацентр — антенна на башне).
import type { Faction } from '../config/factions';

export function ratushaSvg(f: Faction, lv: { ratusha: number; kassa: number; shtab: number; media: number }) {
  const lit = Math.min(4, Math.ceil(lv.ratusha / 2.5));
  const win = (x: number, y: number, on: boolean) => `<rect x="${x}" y="${y}" width="10" height="12" rx="2" fill="${on ? '#ffe08a' : '#5b5470'}"/>`;
  const kassa = lv.kassa > 0 ? `<g>
      <rect x="64" y="${452 - Math.min(lv.kassa, 10) * 3}" width="58" height="${50 + Math.min(lv.kassa, 10) * 3}" rx="3" fill="#ead9b8"/>
      <path d="M58 ${454 - Math.min(lv.kassa, 10) * 3} L93 ${432 - Math.min(lv.kassa, 10) * 3} L128 ${454 - Math.min(lv.kassa, 10) * 3}Z" fill="#e0a100"/>
      <circle cx="93" cy="${474}" r="11" fill="#ffc83d" stroke="#a87200" stroke-width="2"/><path d="M93 467v14M89.5 470.5h5a2 2 0 0 1 0 4h-3a2 2 0 0 0 0 4h5" stroke="#7a5200" stroke-width="1.6" fill="none"/>
      ${lv.kassa >= 5 ? '<path d="M64 452 H122" stroke="#ffd76a" stroke-width="3"/>' : ''}</g>` : '';
  const shtab = lv.shtab > 0 ? `<g>
      <rect x="268" y="${452 - Math.min(lv.shtab, 10) * 3}" width="58" height="${50 + Math.min(lv.shtab, 10) * 3}" rx="3" fill="#ead9b8"/>
      <path d="M262 ${454 - Math.min(lv.shtab, 10) * 3} L297 ${432 - Math.min(lv.shtab, 10) * 3} L332 ${454 - Math.min(lv.shtab, 10) * 3}Z" fill="#c8553d"/>
      <path d="M287 466 l20 20 M307 466 l-20 20" stroke="#7a2a1a" stroke-width="3" stroke-linecap="round"/>
      <line x1="320" y1="${432 - Math.min(lv.shtab, 10) * 3}" x2="320" y2="${404 - Math.min(lv.shtab, 10) * 3}" stroke="#eee" stroke-width="2"/>
      <path d="M321 ${406 - Math.min(lv.shtab, 10) * 3} l18 5 -18 6z" fill="${f.color}"/></g>` : '';
  const media = lv.media > 0 ? `<g stroke="#e8e8f5" stroke-width="2" fill="none">
      <path d="M212 300 V${284 - Math.min(lv.media, 10) * 2}"/><path d="M204 ${292 - Math.min(lv.media, 10) * 2} Q212 ${284 - Math.min(lv.media, 10) * 2} 220 ${292 - Math.min(lv.media, 10) * 2}"/>
      ${lv.media >= 4 ? `<path d="M198 ${288 - Math.min(lv.media, 10) * 2} Q212 ${274 - Math.min(lv.media, 10) * 2} 226 ${288 - Math.min(lv.media, 10) * 2}"/>` : ''}</g>` : '';
  return `<svg viewBox="52 214 286 300" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <ellipse cx="195" cy="505" rx="150" ry="12" fill="#0b2a18" opacity=".45"/>
    ${kassa}${shtab}
    <g>
      <rect x="128" y="392" width="134" height="110" rx="4" fill="#f1e3c8"/>
      <path d="M118 396 L195 352 L272 396Z" fill="${lv.ratusha >= 5 ? '#d9822b' : '#c8553d'}"/>
      ${lv.ratusha >= 5 ? '<path d="M118 396 L195 352 L272 396" stroke="#ffd76a" stroke-width="3" fill="none"/>' : ''}
      <rect x="183" y="308" width="24" height="56" fill="#f1e3c8"/>
      <path d="M178 312 L195 288 L212 312Z" fill="#c8553d"/>
      <circle cx="195" cy="332" r="7" fill="#2b2a63"/><path d="M195 332 V327 M195 332 L198.5 333.5" stroke="#ffd76a" stroke-width="1.6"/>
      <g fill="#d9c7a6"><rect x="140" y="412" width="10" height="80"/><rect x="164" y="412" width="10" height="80"/><rect x="216" y="412" width="10" height="80"/><rect x="240" y="412" width="10" height="80"/></g>
      ${win(152, 372, lit >= 1)}${win(228, 372, lit >= 2)}${win(176, 372, lit >= 3)}${win(204, 372, lit >= 4)}
      <rect x="183" y="440" width="24" height="62" rx="12" fill="#6a3d2a"/>
      <line x1="195" y1="288" x2="195" y2="250" stroke="#e8e8f5" stroke-width="2.5"/>
      <path class="flag" d="M196 252 L234 258 L222 268 L234 278 L196 274Z" fill="${f.color}" stroke="#fff" stroke-width="1"/>
      ${lv.ratusha >= 8 ? '<path d="M195 238 l3 6 6 1 -4.5 4 1 6 -5.5-3 -5.5 3 1-6 -4.5-4 6-1z" fill="#ffc83d"/>' : ''}
      ${media}
    </g>
  </svg>`;
}
