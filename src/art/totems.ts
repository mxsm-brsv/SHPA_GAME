// Тотемы ПБ в едином стиле: круглый жетон, животное цветом фракции. viewBox 64×64.
import type { Faction, Totem } from '../config/factions';

const EYE = '#15173d';

function body(t: Totem, c: string, light: string): string {
  switch (t) {
    case 'fox':
      return `<path d="M15 28 L18 10 L28 22 Z" fill="${c}"/><path d="M49 28 L46 10 L36 22 Z" fill="${c}"/>
        <path d="M19 16 L21 24 L25 21Z" fill="${light}" opacity=".6"/><path d="M45 16 L43 24 L39 21Z" fill="${light}" opacity=".6"/>
        <circle cx="32" cy="34" r="17" fill="${c}"/>
        <path d="M16 37 Q32 56 48 37 Q40 45 32 45 Q24 45 16 37Z" fill="#fff"/>
        <circle cx="25.5" cy="31" r="2.6" fill="${EYE}"/><circle cx="38.5" cy="31" r="2.6" fill="${EYE}"/><circle cx="32" cy="40" r="2.4" fill="${EYE}"/>`;
    case 'raccoon':
      return `<circle cx="18" cy="17" r="7" fill="${c}"/><circle cx="46" cy="17" r="7" fill="${c}"/><circle cx="18" cy="17" r="3.5" fill="${light}"/><circle cx="46" cy="17" r="3.5" fill="${light}"/>
        <ellipse cx="32" cy="35" rx="19" ry="17" fill="${c}"/>
        <path d="M13 32 Q22 24 32 31 Q42 24 51 32 Q46 40 38 37 L32 35 L26 37 Q18 40 13 32Z" fill="#2b1f3a"/>
        <circle cx="24.5" cy="32" r="3" fill="#fff"/><circle cx="39.5" cy="32" r="3" fill="#fff"/><circle cx="24.5" cy="32" r="1.6" fill="${EYE}"/><circle cx="39.5" cy="32" r="1.6" fill="${EYE}"/>
        <ellipse cx="32" cy="44" rx="8" ry="5.5" fill="#f3e9f7"/><ellipse cx="32" cy="41.5" rx="2.6" ry="1.9" fill="${EYE}"/>`;
    case 'tigers':
      return `<circle cx="17" cy="18" r="6" fill="${c}"/><circle cx="47" cy="18" r="6" fill="${c}"/>
        <circle cx="32" cy="34" r="18" fill="${c}"/>
        <path d="M32 16 L29 24 L35 24Z M16 30 L23 31 L16 34Z M48 30 L41 31 L48 34Z M18 40 L24 39 L19 43Z M46 40 L40 39 L45 43Z" fill="#0b2b22"/>
        <ellipse cx="32" cy="43" rx="9" ry="6.5" fill="#fff"/>
        <circle cx="25" cy="32" r="2.6" fill="#ffd76a"/><circle cx="39" cy="32" r="2.6" fill="#ffd76a"/><circle cx="25" cy="32" r="1.2" fill="${EYE}"/><circle cx="39" cy="32" r="1.2" fill="${EYE}"/>
        <path d="M29 40 L35 40 L32 43Z" fill="#e8453c"/>`;
    case 'panther':
      return `<path d="M15 26 L17 11 L27 20Z" fill="${c}"/><path d="M49 26 L47 11 L37 20Z" fill="${c}"/>
        <ellipse cx="32" cy="35" rx="18" ry="17" fill="${c}"/>
        <ellipse cx="32" cy="24" rx="3" ry="2.2" fill="#fff"/><circle cx="32" cy="24" r="1.3" fill="${EYE}"/>
        <ellipse cx="24.5" cy="32" rx="3.4" ry="2.5" fill="#fff"/><ellipse cx="39.5" cy="32" rx="3.4" ry="2.5" fill="#fff"/>
        <circle cx="24.5" cy="32" r="1.5" fill="${EYE}"/><circle cx="39.5" cy="32" r="1.5" fill="${EYE}"/>
        <path d="M28.5 40 L35.5 40 L32 43.5Z" fill="#6b2f55"/><path d="M32 43.5 Q29 47 26 45 M32 43.5 Q35 47 38 45" stroke="#6b2f55" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
    case 'otter':
      return `<circle cx="19" cy="22" r="5" fill="${c}"/><circle cx="45" cy="22" r="5" fill="${c}"/>
        <ellipse cx="32" cy="35" rx="18" ry="16" fill="${c}"/>
        <ellipse cx="32" cy="42" rx="12" ry="8" fill="#e9dcc0"/>
        <circle cx="25" cy="31" r="2.6" fill="${EYE}"/><circle cx="39" cy="31" r="2.6" fill="${EYE}"/>
        <ellipse cx="32" cy="38.5" rx="3.4" ry="2.4" fill="${EYE}"/>
        <path d="M22 41 L13 39 M22 43 L13 44 M42 41 L51 39 M42 43 L51 44" stroke="#e9dcc0" stroke-width="1.3" stroke-linecap="round"/>`;
    case 'eagle':
      return `<path d="M14 40 Q12 20 30 14 Q46 10 50 24 Q52 34 44 40 Q38 46 30 46 Q18 46 14 40Z" fill="${c}"/>
        <path d="M18 26 Q30 18 46 22 Q40 28 30 28Z" fill="#fff" opacity=".9"/>
        <path d="M40 30 Q54 30 54 38 Q50 36 46 38 Q44 34 40 34Z" fill="#ffc83d"/>
        <circle cx="38" cy="29" r="2.8" fill="#ffc83d"/><circle cx="38" cy="29" r="1.4" fill="${EYE}"/>
        <path d="M20 36 Q26 40 34 38" stroke="${light}" stroke-width="2" fill="none" opacity=".5"/>`;
    case 'wolf':
      return `<path d="M15 30 L16 9 L28 21Z" fill="${c}"/><path d="M49 30 L48 9 L36 21Z" fill="${c}"/>
        <path d="M14 32 Q16 18 32 18 Q48 18 50 32 L44 44 Q38 52 32 52 Q26 52 20 44Z" fill="${c}"/>
        <path d="M24 40 Q32 34 40 40 L36 48 Q32 51 28 48Z" fill="#fff6e0"/>
        <path d="M20 30 L28 33 M44 30 L36 33" stroke="${EYE}" stroke-width="2.6" stroke-linecap="round"/>
        <ellipse cx="32" cy="42" rx="3" ry="2.2" fill="${EYE}"/>`;
    case 'manul':
      return `<path d="M13 28 L16 19 L23 24Z" fill="${c}"/><path d="M51 28 L48 19 L41 24Z" fill="${c}"/>
        <path d="M10 36 Q10 20 32 20 Q54 20 54 36 Q54 50 32 50 Q10 50 10 36Z" fill="${c}"/>
        <path d="M10 38 L16 36 L11 42 M54 38 L48 36 L53 42" fill="${light}"/>
        <circle cx="24" cy="33" r="3.6" fill="#ffd76a"/><circle cx="40" cy="33" r="3.6" fill="#ffd76a"/>
        <circle cx="24" cy="33" r="1.6" fill="${EYE}"/><circle cx="40" cy="33" r="1.6" fill="${EYE}"/>
        <path d="M26 26 L28 23 M32 25 L32 22 M38 26 L36 23" stroke="${EYE}" stroke-width="1.6" stroke-linecap="round"/>
        <ellipse cx="32" cy="42" rx="7" ry="4.5" fill="#f6e3ee"/><path d="M30 40 L34 40 L32 42Z" fill="${EYE}"/>`;
    case 'fire':
      return `<path d="M32 8 C38 18 48 22 46 38 C45 48 38 54 32 54 C24 54 17 48 18 38 C19 30 24 28 25 20 C29 24 30 28 30 32 C34 26 34 18 32 8Z" fill="#fff"/>
        <path d="M32 26 C36 32 41 35 40 43 C39 49 35 51 32 51 C28 51 24 48 25 43 C26 38 30 37 32 26Z" fill="${c}"/>
        <ellipse cx="32" cy="34" rx="22" ry="7" fill="none" stroke="#fff" stroke-width="2" opacity=".7" transform="rotate(-18 32 34)"/>`;
    case 'wave':
      return `<path d="M8 38 Q16 22 28 28 Q22 30 24 36 Q30 30 38 36 Q44 40 50 34 Q54 30 56 34 L56 48 L8 48Z" fill="${c}"/>
        <path d="M8 44 Q20 38 32 44 Q44 50 56 44 L56 52 L8 52Z" fill="${light}" opacity=".85"/>
        <circle cx="20" cy="16" r="1.6" fill="#fff"/><circle cx="44" cy="14" r="1.2" fill="#fff"/><circle cx="50" cy="22" r="1.4" fill="#fff"/><circle cx="34" cy="12" r="1" fill="#fff"/>`;
    case 'bolt':
      return `<path d="M36 6 L16 36 L29 36 L25 58 L48 26 L34 26Z" fill="#fff"/>`;
  }
}

function lighten(hex: string, k = 0.45) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (x: number) => Math.round(x + (255 - x) * k);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

export function totemSvg(f: Faction, size = 56, ring = true) {
  const bg = f.totem === 'fire' || f.totem === 'bolt' || f.totem === 'wave' ? f.color : f.colorDark;
  const fg = f.totem === 'fire' || f.totem === 'bolt' ? f.colorDark : f.color;
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${f.totemName} · ${f.short}">
    <circle cx="32" cy="32" r="30" fill="${bg}" ${ring ? `stroke="${lighten(f.color, 0.3)}" stroke-width="3"` : ''}/>
    <g>${body(f.totem, fg, lighten(f.color))}</g></svg>`;
}
