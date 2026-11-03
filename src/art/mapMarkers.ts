// Игровые объекты карты: спорные точки, ратуши ПБ, внешние мероприятия.
// Каждая функция рисует объект вокруг точки (0,0) — на схеме его сдвигают transform, на Яндекс Картах вставляют в <svg>.
import { factionById, type FactionId } from '../config/factions';
import type { MapEvent, MapPoint } from '../config/map';
import { MINIGAMES } from '../config/minigames';
import { iconAt } from './icons';
import { totemSvg } from './totems';

const POINT_ICON: Record<MapPoint['icon'], string> = {
  dorm: 'home', food: 'cup', sport: 'run', stadium: 'trophy', culture: 'sparkle', book: 'book', main: 'flag', lab: 'bolt', park: 'tree', metro: 'metro', power: 'factory',
};

export function pointMarker(p: MapPoint, owner: FactionId | null, opts: { shield?: boolean; target?: 'attack' | 'defend' | null; selected?: boolean; label?: boolean } = {}) {
  const f = owner ? factionById(owner) : null;
  const c = f ? f.color : '#6b7190';
  const ring = opts.selected ? '#ffd76a' : '#ffffff';
  return `<g class="mk">
    <ellipse cx="0" cy="22" rx="22" ry="6" fill="#000" opacity=".35"/>
    <line x1="14" y1="-10" x2="14" y2="-44" stroke="#e8e8f5" stroke-width="2.5"/>
    <path d="M15 -44 L40 -39 L31 -33 L40 -27 L15 -29Z" fill="${c}" stroke="#fff" stroke-width="1.2"/>
    <circle r="${opts.selected ? 25 : 22}" fill="${f ? f.colorDark : '#2a2d4a'}" stroke="${ring}" stroke-width="${opts.selected ? 4 : 3}"/>
    <circle r="16" fill="${c}"/>
    ${iconAt(POINT_ICON[p.icon], -10, -10, 20, '#fff', 2.4)}
    ${opts.shield ? `<g transform="translate(-24 -20)"><path d="M0 -9 L8 -6 L8 1 Q8 7 0 10 Q-8 7 -8 1 L-8 -6Z" fill="#4aa8ff" stroke="#fff" stroke-width="1.5"/></g>` : ''}
    ${opts.target ? `<g transform="translate(22 14)"><circle r="11" fill="${opts.target === 'attack' ? '#e8453c' : '#2fbf71'}" stroke="#fff" stroke-width="2"/>${iconAt(opts.target === 'attack' ? 'swords' : 'shield', -7, -7, 14, '#fff', 2.6)}</g>` : ''}
    ${opts.label !== false ? `<text y="44" text-anchor="middle" class="mkl">${p.short}</text>` : ''}
  </g>`;
}

export function ratushaMarker(fid: FactionId, level: number, trophies: number, mine: boolean, room?: string) {
  const f = factionById(fid);
  const s = 0.85 + Math.min(10, level) * 0.04;
  return `<g class="mk" transform="scale(${s})">
    <ellipse cx="0" cy="34" rx="34" ry="8" fill="#000" opacity=".35"/>
    <rect x="-30" y="-6" width="60" height="40" rx="3" fill="#efe1c6"/>
    <rect x="-30" y="26" width="60" height="8" fill="#cbb994"/>
    ${[-26, -14, -2, 10, 22].map((x) => `<rect x="${x}" y="-12" width="6" height="7" fill="#efe1c6"/>`).join('')}
    <rect x="-12" y="-44" width="24" height="40" fill="#e3d2b2"/>
    <path d="M-16 -42 L0 -66 L16 -42Z" fill="${f.color}" stroke="#fff" stroke-width="1.5"/>
    <line x1="0" y1="-66" x2="0" y2="-82" stroke="#e8e8f5" stroke-width="2"/>
    <path d="M1 -82 L18 -78 L11 -74 L18 -70 L1 -72Z" fill="${f.color}"/>
    <rect x="-6" y="16" width="12" height="18" rx="6" fill="#6a3d2a"/>
    <g transform="translate(-14 -36)">${totemSvg(f, 28, false).replace('<svg', '<svg x="0" y="0"')}</g>
    ${mine ? `<circle cx="0" cy="8" r="44" fill="none" stroke="#ffd76a" stroke-width="3" stroke-dasharray="6 5"/>` : ''}
    <g transform="translate(26 -2)"><circle r="11" fill="#ffc83d" stroke="#15173d" stroke-width="2"/><text y="4" text-anchor="middle" font-size="12" font-family="Russo One, Rubik" fill="#3a2a00">${level}</text></g>
    ${trophies ? `<g transform="translate(-28 -2)"><circle r="10" fill="#b26bff" stroke="#fff" stroke-width="1.5"/><text y="4" text-anchor="middle" font-size="11" font-weight="800" font-family="Rubik" fill="#fff">${trophies}</text></g>` : ''}
    <text y="54" text-anchor="middle" class="mkl" style="fill:${f.color === '#0d0d6f' ? '#9aa3ff' : '#fff'}">${f.short}</text>
    ${room ? `<text y="68" text-anchor="middle" class="mkl" style="font-size:11px;fill:#ffd76a">${room}</text>` : ''}
  </g>`;
}

export function eventMarker(e: MapEvent, active: boolean, label: string) {
  const g = MINIGAMES.find((x) => x.id === e.game)!;
  return `<g class="mk ${active ? 'ev-on' : ''}" opacity="${active ? 1 : 0.55}">
    ${active ? '<circle class="pulse" r="30" fill="none" stroke="#ffd76a" stroke-width="4"/>' : ''}
    <circle r="27" fill="#2c2060" stroke="${active ? '#ffd76a' : '#9aa3c7'}" stroke-width="3"/>
    <circle r="20" fill="${g.color}"/>
    ${iconAt(g.icon, -11, -11, 22, '#fff', 2.4)}
    <text y="44" text-anchor="middle" class="mkl">${e.name}</text>
    <text y="59" text-anchor="middle" class="mkl" style="font-size:11px;fill:${active ? '#ffd76a' : '#cfd4ff'}">${label}</text>
  </g>`;
}

export const MARKER_CSS = `
  .mkl{font:700 13px Rubik,sans-serif;fill:#fff;paint-order:stroke;stroke:#0b0e1f;stroke-width:4px}
  .mk{cursor:pointer}
  .pulse{animation:mkpulse 1.6s ease-out infinite;transform-origin:center;transform-box:fill-box}
  @keyframes mkpulse{from{opacity:.9;transform:scale(1)}to{opacity:0;transform:scale(1.7)}}`;
