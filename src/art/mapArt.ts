// Схема Лефортово и кампуса МЭИ по настоящей карте (OpenStreetMap): реальные улицы, корпуса и дворы.
// Стиль — карта стратегии: тёмная земля, объёмные дома, корпуса МЭИ подсвечены, общежития — фиолетовые.
import { CAMPUS } from '../map/campusData';

/** Объёмный слой зданий: тень, стена (сдвиг вниз) и крыша из одного пути. */
function extruded(id: string, d: string, roof: string, wall: string, h: number, stroke = '#ffffff14') {
  if (!d) return '';
  // путь лежит в defs без заливки — копии берут цвет из <use>
  return `<defs><path id="${id}" d="${d}"/></defs>
    <use href="#${id}" fill="#05070f" opacity=".45" transform="translate(${h + 2} ${h + 4})"/>
    <use href="#${id}" fill="${wall}" transform="translate(0 ${h})"/>
    <use href="#${id}" fill="${roof}" stroke="${stroke}" stroke-width="1"/>`;
}

const METRO: [number, number, string][] = [
  [993, 74, 'Лефортово'],
  [1622, 1395, 'Авиамоторная'],
];

export function mapBaseSvg(): string {
  const C = CAMPUS;
  const roads = C.roads.map(([w, d]) => `<path d="${d}" stroke="#0e1426" stroke-width="${w + 5}"/>`).join('')
    + C.roads.map(([w, d]) => `<path d="${d}" stroke="${w >= 17 ? '#4a5878' : w >= 12 ? '#425070' : '#36425e'}" stroke-width="${w}"/>`).join('')
    + C.roads.filter(([w]) => w >= 17).map(([, d]) => `<path d="${d}" stroke="#d9c49a" stroke-width="1.4" stroke-dasharray="9 11" opacity=".5"/>`).join('');
  const labels = C.labels.map(([name, d], i) => `<path id="sl${i}" d="${d}" fill="none"/><text class="sl" dy="4.5"><textPath href="#sl${i}" startOffset="50%" text-anchor="middle">${name}</textPath></text>`).join('');
  const letters = C.letters.map(([x, y, t]) => `<g transform="translate(${x} ${y - 4})"><circle r="10.5" fill="#15173d" stroke="#ffc83d" stroke-width="2"/><text y="4.6" text-anchor="middle" class="lt">${t}</text></g>`).join('');
  const places = C.places.map(([x, y, t]) => `<text x="${x}" y="${y}" text-anchor="middle" class="ml">${t}</text>`).join('');
  const metro = METRO.map(([x, y, n]) => `<g transform="translate(${x} ${y})"><circle r="15" fill="#e8453c" stroke="#fff" stroke-width="3"/><text y="5.5" text-anchor="middle" font-size="16" font-weight="800" fill="#fff" font-family="Rubik">М</text><text y="34" text-anchor="middle" class="ml">${n}</text></g>`).join('');

  return `
  <defs>
    <pattern id="grain" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="4" cy="6" r="1" fill="#ffffff08"/><circle cx="16" cy="18" r="1" fill="#ffffff06"/></pattern>
    <pattern id="trees" width="34" height="30" patternUnits="userSpaceOnUse">
      <circle cx="8" cy="9" r="7" fill="#2f7a4a"/><circle cx="6" cy="7" r="3" fill="#4f9a5c" opacity=".7"/>
      <circle cx="25" cy="23" r="8" fill="#286b41"/><circle cx="23" cy="20" r="3.4" fill="#4f9a5c" opacity=".7"/>
    </pattern>
    <radialGradient id="vign" cx="50%" cy="50%" r="75%"><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
    <style>
      .sl{font:600 14px Rubik,sans-serif;fill:#d4dbf2;letter-spacing:.4px;paint-order:stroke;stroke:#141c30;stroke-width:3.5px}
      .ml{font:700 13px Rubik,sans-serif;fill:#fff;paint-order:stroke;stroke:#15173d;stroke-width:4px}
      .lt{font:12px 'Russo One',Rubik,sans-serif;fill:#ffd76a}
      .big{font:26px 'Russo One',Rubik,sans-serif;fill:#9fd0a8;opacity:.8;letter-spacing:2px;paint-order:stroke;stroke:#163a28;stroke-width:4px}
    </style>
  </defs>
  <rect x="-200" y="-200" width="${C.W + 400}" height="${C.H + 400}" fill="#1b2638"/>
  <rect x="-200" y="-200" width="${C.W + 400}" height="${C.H + 400}" fill="url(#grain)"/>
  <!-- зелень, вода, спорт -->
  <path d="${C.green}" fill="#1f4f36" stroke="#2f7a4a" stroke-width="2"/>
  <path d="${C.green}" fill="url(#trees)" opacity=".55"/>
  <path d="${C.stadium}" fill="#3a3550" stroke="#c8553d" stroke-width="3"/>
  <path d="${C.pitch}" fill="#2f8f5b" stroke="#e8f5ea" stroke-width="1.6" stroke-opacity=".7"/>
  <path d="${C.water}" fill="#2f86c4" stroke="#7fc3ee" stroke-width="2"/>
  <!-- дороги и трамвай -->
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">${roads}
    <path d="${C.tram}" stroke="#9a8a78" stroke-width="1.6" stroke-dasharray="3 3" opacity=".75"/>
    <path d="${C.rail}" stroke="#0e1426" stroke-width="9"/><path d="${C.rail}" stroke="#8a7a68" stroke-width="3" stroke-dasharray="2 7"/>
  </g>
  <!-- дома: обычные, общежития, корпуса МЭИ -->
  ${extruded('mb', C.bld, '#3b4566', '#232a44', 5)}
  ${extruded('md', C.dorm, '#8a63c4', '#4a2f78', 6, '#ffffff30')}
  ${extruded('mm', C.mpei, '#e8824f', '#8a3f22', 6, '#ffe2c6')}
  ${labels}
  ${letters}
  ${places}
  <text x="130" y="470" text-anchor="middle" class="big">ЛЕФОРТОВСКИЙ</text><text x="130" y="502" text-anchor="middle" class="big">ПАРК</text>
  ${metro}
  <!-- роза ветров и атрибуция -->
  <g transform="translate(${C.W - 50} 60)" opacity=".9"><circle r="24" fill="#15173d" stroke="#ffc83d" stroke-width="2"/><path d="M0 -18 L6 0 L0 18 L-6 0Z" fill="#ffc83d"/><text y="-28" text-anchor="middle" font-size="12" fill="#ffd76a" font-family="Rubik" font-weight="800">С</text></g>
  <text x="${C.W - 8}" y="${C.H - 8}" text-anchor="end" font-size="11" fill="#cfd6ee" opacity=".7" font-family="Rubik">© участники OpenStreetMap</text>
  <rect x="-200" y="-200" width="${C.W + 400}" height="${C.H + 400}" fill="url(#vign)" pointer-events="none"/>`;
}
