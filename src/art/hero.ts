// Портреты активистов и врагов. viewBox 64×64.
import { CLASS_INFO, RARITY_INFO, heroDef } from '../config/heroes';
import type { EnemyDef } from '../config/campaign';

export function heroSvg(id: string, size = 64) {
  const d = heroDef(id);
  const { skin, hair, hairStyle, top, extra } = d.look;
  const hairs = [
    // 0 короткая
    `<path d="M19 27 Q18 14 32 13 Q46 14 45 27 Q42 19 32 19 Q22 19 19 27Z" fill="${hair}"/>`,
    // 1 ёжик/чёлка
    `<path d="M18 28 Q17 12 32 12 Q47 12 46 28 L42 22 L38 25 L34 20 L30 25 L26 20 L22 25Z" fill="${hair}"/>`,
    // 2 длинные
    `<path d="M17 44 Q14 14 32 13 Q50 14 47 44 L44 44 Q45 24 32 21 Q19 24 20 44Z" fill="${hair}"/><path d="M19 26 Q24 17 33 18 Q40 18 45 26 Q38 21 32 22 Q25 22 19 26Z" fill="${hair}"/>`,
    // 3 хвостик/пучок
    `<circle cx="32" cy="11" r="5.5" fill="${hair}"/><path d="M19 28 Q18 15 32 15 Q46 15 45 28 Q41 20 32 20 Q23 20 19 28Z" fill="${hair}"/>`,
  ];
  const acc: Record<string, string> = {
    glasses: `<g fill="none" stroke="#1b1d4f" stroke-width="1.6"><circle cx="26.5" cy="30" r="4"/><circle cx="37.5" cy="30" r="4"/><path d="M30.5 30h3"/></g>`,
    cap: `<path d="M18 23 Q19 12 32 12 Q45 12 46 23Z" fill="${top}"/><path d="M30 22 L52 22 Q50 26 44 25Z" fill="${top}"/>`,
    headset: `<path d="M18 30 Q18 13 32 13 Q46 13 46 30" fill="none" stroke="#2b2a63" stroke-width="2.5"/><rect x="15" y="27" width="5" height="8" rx="2" fill="#2b2a63"/><path d="M17 35 Q18 41 25 41" stroke="#2b2a63" stroke-width="1.8" fill="none"/>`,
    tie: `<path d="M32 47 L29.5 50 L32 60 L34.5 50Z" fill="#1b1d4f"/>`,
    badge: `<circle cx="40" cy="53" r="3" fill="#ffc83d"/>`,
    crown: `<path d="M22 15 L25 7 L29 12 L32 5 L35 12 L39 7 L42 15Z" fill="#ffc83d" stroke="#c48a00" stroke-width="1"/>`,
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <path d="M10 64 Q11 47 32 46 Q53 47 54 64Z" fill="${top}"/>
    <path d="M26 46 L32 52 L38 46Z" fill="#fff" opacity=".85"/>
    <rect x="28" y="38" width="8" height="9" fill="${skin}"/>
    <ellipse cx="32" cy="29" rx="13" ry="14" fill="${skin}"/>
    ${hairs[hairStyle]}
    <circle cx="26.5" cy="30" r="1.7" fill="#1b1d4f"/><circle cx="37.5" cy="30" r="1.7" fill="#1b1d4f"/>
    <path d="M27.5 36 Q32 39.5 36.5 36" stroke="#9a4a3a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <circle cx="23" cy="34" r="2" fill="#ff8a8a" opacity=".35"/><circle cx="41" cy="34" r="2" fill="#ff8a8a" opacity=".35"/>
    ${extra ? acc[extra] : ''}
  </svg>`;
}

export function enemySvg(e: EnemyDef, size = 64, boss = false) {
  const c = CLASS_INFO[e.cls].color;
  const glyph: Record<EnemyDef['icon'], string> = {
    cloud: `<path d="M16 40 Q10 40 10 34 Q10 27 18 27 Q20 18 30 18 Q40 18 42 26 Q52 25 53 33 Q54 40 46 40Z" fill="#cfd4ff"/>`,
    paper: `<path d="M18 12 H40 L48 20 V54 H18Z" fill="#f1e3c8"/><path d="M40 12 V20 H48" fill="#d9c7a6"/><path d="M23 30h18M23 36h18M23 42h12" stroke="#8a6b4a" stroke-width="2"/>`,
    clock: `<circle cx="32" cy="34" r="18" fill="#f1e3c8" stroke="#8a6b4a" stroke-width="3"/><path d="M32 34 V24 M32 34 L40 38" stroke="#c8553d" stroke-width="3" stroke-linecap="round"/><circle cx="18" cy="16" r="5" fill="#c8553d"/><circle cx="46" cy="16" r="5" fill="#c8553d"/>`,
    stamp: `<rect x="16" y="38" width="32" height="10" rx="3" fill="#c8553d"/><rect x="26" y="16" width="12" height="22" rx="5" fill="#8a6b4a"/><rect x="12" y="50" width="40" height="5" rx="2" fill="#5b3a28"/>`,
    phone: `<rect x="20" y="10" width="24" height="44" rx="5" fill="#2b2a63" stroke="#cfd4ff" stroke-width="2"/><rect x="24" y="16" width="16" height="28" rx="2" fill="#7ea8ff"/><circle cx="32" cy="49" r="2" fill="#cfd4ff"/>`,
    bed: `<rect x="10" y="34" width="44" height="12" rx="3" fill="#7d6bd1"/><rect x="12" y="26" width="16" height="10" rx="4" fill="#f1e3c8"/><path d="M10 46 V54 M54 46 V54" stroke="#4a3f8f" stroke-width="3"/><text x="40" y="26" font-size="12" fill="#cfd4ff" font-family="Rubik">z z</text>`,
    bus: `<rect x="10" y="18" width="44" height="28" rx="5" fill="#ffc83d"/><rect x="14" y="22" width="36" height="10" rx="2" fill="#7ea8ff"/><circle cx="20" cy="48" r="5" fill="#2b2a63"/><circle cx="44" cy="48" r="5" fill="#2b2a63"/>`,
    boss: `<path d="M14 54 Q12 26 32 20 Q52 26 50 54Z" fill="${c}"/><path d="M20 20 L24 8 L30 16 L34 6 L38 16 L44 8 L46 20Z" fill="#ffc83d"/><circle cx="25" cy="36" r="4" fill="#fff"/><circle cx="39" cy="36" r="4" fill="#fff"/><circle cx="25" cy="37" r="2" fill="#15173d"/><circle cx="39" cy="37" r="2" fill="#15173d"/><path d="M24 46 Q32 42 40 46" stroke="#15173d" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  };
  const eyes = e.icon === 'boss' ? '' : `<circle cx="27" cy="34" r="2.4" fill="#15173d"/><circle cx="37" cy="34" r="2.4" fill="#15173d"/><path d="M26 28 L30 30 M38 28 L34 30" stroke="#15173d" stroke-width="2" stroke-linecap="round"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">${boss ? '<circle cx="32" cy="32" r="31" fill="#ff3d2e" opacity=".18"/>' : ''}${glyph[e.icon]}${eyes}</svg>`;
}

export const rarityColor = (id: string) => RARITY_INFO[heroDef(id).rarity].color;
