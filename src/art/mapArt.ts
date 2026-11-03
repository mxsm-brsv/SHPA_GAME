// Нарисованная схема Лефортово и кампуса МЭИ (мир 1000×1300). Стиль — карта стратегии:
// тёмная земля, кварталы с объёмными домиками, Яуза, Лефортовский парк, корпуса МЭИ подсвечены.

type Pt = [number, number];

function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

const STREETS: { name: string; pts: Pt[]; w: number; label?: boolean }[] = [
  { name: 'Красноказарменная ул.', pts: [[120, 685], [1000, 870]], w: 30, label: true },
  { name: 'Солдатская ул.', pts: [[130, 440], [1000, 425]], w: 22, label: true },
  { name: 'Энергетический пр.', pts: [[610, 782], [600, 440]], w: 14, label: true },
  { name: 'Энергетическая ул.', pts: [[790, 822], [790, 150]], w: 18, label: true },
  { name: 'Лефортовский Вал', pts: [[430, 750], [440, 440], [460, 120]], w: 18, label: true },
  { name: 'Краснокурсантский пр.', pts: [[215, 700], [215, 440]], w: 12 },
  { name: 'Авиамоторная ул.', pts: [[985, 868], [975, 1300]], w: 26, label: true },
  { name: 'Наличная ул.', pts: [[640, 440], [655, 120]], w: 12 },
  { name: 'Шоссе Энтузиастов', pts: [[760, 1235], [1000, 1225]], w: 30, label: true },
  { name: 'ул. Лапина', pts: [[300, 718], [300, 1180]], w: 12 },
  { name: 'Танковый пр.', pts: [[560, 818], [540, 1200]], w: 12 },
];

/** Особые территории: не застраиваем генерируемыми домиками. */
const RESERVED: [number, number, number, number][] = [
  [130, 40, 300, 380],    // парк
  [230, 520, 200, 150],   // стадион
  [440, 620, 400, 170],   // корпуса МЭИ к северу от улицы
  [580, 840, 230, 130],   // корпус Ж–Л
  [720, 260, 280, 160],   // студгородок
  [860, 680, 140, 120],   // ТЭЦ
  [880, 1110, 120, 110],  // метро Авиамоторная
];

const BLOCKS: [number, number, number, number][] = [
  [450, 140, 140, 280], [665, 140, 110, 270], [805, 140, 190, 110], [805, 440, 190, 200],
  [230, 455, 190, 60], [450, 455, 140, 150], [620, 455, 160, 120],
  [140, 720, 150, 480], [315, 740, 220, 480], [570, 860, 390, 340], [680, 990, 280, 220],
];

function inReserved(x: number, y: number, w: number, h: number) {
  return RESERVED.some(([rx, ry, rw, rh]) => x < rx + rw && x + w > rx && y < ry + rh && y + h > ry);
}

function distToSeg(p: Pt, a: Pt, b: Pt) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function nearStreet(x: number, y: number, w: number, h: number) {
  const c: Pt = [x + w / 2, y + h / 2];
  return STREETS.some((s) => s.pts.slice(1).some((b, i) => distToSeg(c, s.pts[i], b) < s.w / 2 + Math.max(w, h) / 2 + 4));
}

/** Домик в виде «3/4»: крыша + фасад с окнами. */
function house(x: number, y: number, w: number, d: number, h: number, roof: string, wall: string, windows = true) {
  let win = '';
  if (windows && w > 16) {
    for (let wx = x + 4; wx < x + w - 5; wx += 7) for (let wy = y + d - h + 4; wy < y + d - 3; wy += 7)
      win += `<rect x="${wx}" y="${wy}" width="3" height="3" fill="#ffe7a0" opacity="${((wx * 7 + wy * 3) % 5) > 1 ? 0.85 : 0.15}"/>`;
  }
  return `<rect x="${x}" y="${y + d - h}" width="${w}" height="${h}" fill="${wall}"/>${win}<rect x="${x}" y="${y - h * 0.1}" width="${w}" height="${d - h}" rx="2" fill="${roof}"/>`;
}

function trees(x: number, y: number, w: number, h: number, n: number, seed: number) {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const tx = x + r() * w, ty = y + r() * h, rr = 7 + r() * 9;
    s += `<circle cx="${tx}" cy="${ty + 3}" r="${rr}" fill="#0d2a1c" opacity=".5"/><circle cx="${tx}" cy="${ty}" r="${rr}" fill="${r() > 0.5 ? '#2f7a4a' : '#286b41'}"/><circle cx="${tx - rr * 0.3}" cy="${ty - rr * 0.3}" r="${rr * 0.45}" fill="#4f9a5c" opacity=".7"/>`;
  }
  return s;
}

/** Корпус МЭИ: светлый, с оранжевой крышей и буквой. */
function campusBuilding(x: number, y: number, w: number, d: number, letter: string, label?: string) {
  return `<g>${house(x, y, w, d, Math.min(28, d * 0.45), '#d4683f', '#efe1c6')}
    <circle cx="${x + w / 2}" cy="${y + 4}" r="11" fill="#15173d" stroke="#ffc83d" stroke-width="2"/>
    <text x="${x + w / 2}" y="${y + 8.5}" text-anchor="middle" font-size="12" fill="#ffd76a" font-family="Russo One, Rubik, sans-serif">${letter}</text>
    ${label ? `<text x="${x + w / 2}" y="${y + d + 14}" text-anchor="middle" class="ml">${label}</text>` : ''}</g>`;
}

export function mapBaseSvg(): string {
  const r = rng(42);
  // генерируем жилые домики в кварталах
  let houses = '';
  for (const [bx, by, bw, bh] of BLOCKS) {
    for (let i = 0; i < Math.round((bw * bh) / 2300); i++) {
      const w = 18 + r() * 34, d = 16 + r() * 26;
      const x = bx + r() * (bw - w), y = by + r() * (bh - d);
      if (inReserved(x, y, w, d) || nearStreet(x, y, w, d)) continue;
      const tone = 30 + Math.floor(r() * 12);
      houses += house(x, y, w, d, 6 + r() * 12, `hsl(228 25% ${tone}%)`, `hsl(228 22% ${tone - 14}%)`);
    }
  }
  const streetPaths = STREETS.map((s, i) => {
    const d = 'M' + s.pts.map((p) => p.join(' ')).join(' L');
    return `<path id="st${i}" d="${d}" fill="none" stroke="#0f1628" stroke-width="${s.w + 6}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="#3a4a66" stroke-width="${s.w}" stroke-linecap="round" stroke-linejoin="round"/>
      ${s.w >= 22 ? `<path d="${d}" fill="none" stroke="#c9b48e" stroke-width="1.5" stroke-dasharray="10 10" opacity=".55"/>` : ''}`;
  }).join('');
  const streetLabels = STREETS.map((s, i) => s.label ? `<text class="sl" dy="4"><textPath href="#st${i}" startOffset="${s.pts.length > 2 ? '30%' : '55%'}" text-anchor="middle">${s.name}</textPath></text>` : '').join('');

  return `
  <defs>
    <pattern id="grain" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="4" cy="6" r="1" fill="#ffffff08"/><circle cx="16" cy="18" r="1" fill="#ffffff06"/></pattern>
    <linearGradient id="river" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1c5b8f"/><stop offset=".5" stop-color="#2f86c4"/><stop offset="1" stop-color="#1c5b8f"/></linearGradient>
    <radialGradient id="vign" cx="50%" cy="45%" r="75%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
    <style>
      .sl{font:600 13px Rubik,sans-serif;fill:#cfd6ee;letter-spacing:.5px;paint-order:stroke;stroke:#1a2236;stroke-width:3px}
      .ml{font:700 13px Rubik,sans-serif;fill:#fff;paint-order:stroke;stroke:#15173d;stroke-width:4px}
      .big{font:24px 'Russo One',Rubik,sans-serif;fill:#9fd0a8;opacity:.75;letter-spacing:2px}
    </style>
  </defs>
  <rect width="1000" height="1300" fill="#1b2638"/>
  <rect width="1000" height="1300" fill="url(#grain)"/>
  ${BLOCKS.map(([x, y, w, h]) => `<rect x="${x - 6}" y="${y - 6}" width="${w + 12}" height="${h + 12}" rx="14" fill="#223049"/>`).join('')}
  <!-- Лефортовский парк -->
  <path d="M120 40 L440 40 L450 420 L135 425 Q110 300 120 40Z" fill="#1f4f36"/>
  <path d="M120 40 L440 40 L450 420 L135 425 Q110 300 120 40Z" fill="none" stroke="#2f7a4a" stroke-width="3"/>
  <ellipse cx="250" cy="205" rx="70" ry="38" fill="#2f86c4"/><ellipse cx="250" cy="205" rx="70" ry="38" fill="none" stroke="#7fc3ee" stroke-width="2" opacity=".6"/>
  <ellipse cx="360" cy="320" rx="38" ry="22" fill="#2f86c4"/>
  <path d="M150 380 Q250 300 330 260 T430 90" stroke="#c9b48e" stroke-width="4" fill="none" opacity=".5"/>
  ${trees(140, 50, 290, 360, 90, 7)}
  <text x="290" y="120" text-anchor="middle" class="big">ЛЕФОРТОВСКИЙ ПАРК</text>
  <!-- Яуза -->
  <path d="M95 0 C 70 220, 40 420, 85 640 S 120 1000, 60 1300 L 0 1300 L 0 0Z" fill="url(#river)"/>
  <path d="M95 0 C 70 220, 40 420, 85 640 S 120 1000, 60 1300" fill="none" stroke="#9fd6ff" stroke-width="3" opacity=".6"/>
  <text x="42" y="900" class="big" style="font-size:20px;fill:#bfe3ff" transform="rotate(-82 42 900)">р. ЯУЗА</text>
  <!-- Железная дорога (Казанское направление) -->
  <path d="M1000 985 L 620 1300" stroke="#0f1628" stroke-width="18"/>
  <path d="M1000 985 L 620 1300" stroke="#7a6a5a" stroke-width="4" stroke-dasharray="2 8"/>
  <path d="M1000 985 L 620 1300" stroke="#c9b48e" stroke-width="1.5"/>
  ${streetPaths}
  ${houses}
  <!-- Стадион «Энергия» -->
  <g><rect x="235" y="525" width="190" height="135" rx="60" fill="#c8553d"/><rect x="255" y="542" width="150" height="100" rx="46" fill="#2f8f5b"/>
    <rect x="300" y="560" width="60" height="64" fill="none" stroke="#fff" stroke-width="2" opacity=".8"/><line x1="330" y1="560" x2="330" y2="624" stroke="#fff" stroke-width="2" opacity=".8"/></g>
  <!-- Кампус МЭИ: подложка -->
  <path d="M440 625 L860 640 L880 830 L440 750Z" fill="#2c3354" opacity=".9"/>
  ${trees(450, 760, 110, 20, 6, 3)}
  ${campusBuilding(440, 650, 70, 60, 'Е')}
  ${campusBuilding(515, 668, 62, 50, 'М')}
  ${campusBuilding(620, 655, 180, 70, 'А')}
  ${campusBuilding(625, 560, 82, 52, 'ДК')}
  ${campusBuilding(770, 600, 76, 44, 'Ст')}
  ${campusBuilding(880, 700, 90, 66, 'Т')}
  <rect x="940" y="640" width="12" height="70" fill="#9aa3c7"/><rect x="940" y="640" width="12" height="8" fill="#c8553d"/>
  ${campusBuilding(610, 860, 160, 70, 'Ж')}
  <!-- Студгородок -->
  ${[0, 1, 2, 3, 4].map((i) => house(820 + (i % 3) * 58, 270 + Math.floor(i / 3) * 70, 48, 48, 26, '#7a4fb4', '#e2d6f2')).join('')}
  <!-- ВЭИ -->
  <text x="420" y="1080" text-anchor="middle" class="big" style="font-size:18px;fill:#9aa3c7">ВЭИ</text>
  ${streetLabels}
  <!-- Метро -->
  ${[[945, 1170, 'Авиамоторная'], [640, 418, 'Лефортово']].map(([x, y, n]) => `<g><circle cx="${x}" cy="${y}" r="15" fill="#e8453c" stroke="#fff" stroke-width="3"/><text x="${x}" y="${Number(y) + 5}" text-anchor="middle" font-size="15" font-weight="800" fill="#fff" font-family="Rubik">М</text><text x="${x}" y="${Number(y) + 32}" text-anchor="middle" class="ml">${n}</text></g>`).join('')}
  <!-- Роза ветров -->
  <g transform="translate(940 70)" opacity=".85"><circle r="24" fill="#15173d" stroke="#ffc83d" stroke-width="2"/><path d="M0 -18 L6 0 L0 18 L-6 0Z" fill="#ffc83d"/><text y="-28" text-anchor="middle" font-size="12" fill="#ffd76a" font-family="Rubik" font-weight="800">С</text></g>
  <rect width="1000" height="1300" fill="url(#vign)" pointer-events="none"/>`;
}
