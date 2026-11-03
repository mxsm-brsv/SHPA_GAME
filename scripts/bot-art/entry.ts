// Картинки бота: баннер /start, картинка описания и аватар. Рисуются из той же графики, что и игра.
import { FACTIONS, PLAYABLE_FACTIONS } from '../../src/config/factions';
import { totemSvg } from '../../src/art/totems';
import { icon } from '../../src/art/icons';
import fontsCss from '../../src/fonts/fonts.css';

const bolt = FACTIONS.find((f) => f.id === 'profkom')!;

const base = (w: number, h: number, body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${fontsCss}
  *{box-sizing:border-box;margin:0} body{width:${w}px;height:${h}px;overflow:hidden;font-family:Rubik,sans-serif;color:#fff;
  background:radial-gradient(circle at 78% 18%,#3b3fae 0,transparent 42%),radial-gradient(circle at 10% 100%,#0a6b8f 0,transparent 45%),linear-gradient(160deg,#1d2056,#11133a)}
  .h{font-family:'Russo One',sans-serif} .chip{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:#ffffff14;border:1px solid #ffffff22;font-weight:700}
  .grid{position:absolute;inset:0;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:40px 40px}
</style></head><body><div class="grid"></div>${body}</body></html>`;

const totems = (size: number) => PLAYABLE_FACTIONS.map((f) => totemSvg(f, size)).join('');

export function banner(w = 1280, h = 720) {
  const k = w / 1280;
  return base(w, h, `
  <div style="position:absolute;left:${70 * k}px;top:${70 * k}px;width:${720 * k}px">
    <div class="chip" style="font-size:${20 * k}px;color:#ffd76a">⚡ Школа профсоюзного актива МЭИ</div>
    <div class="h" style="font-size:${190 * k}px;line-height:1;margin-top:${18 * k}px;letter-spacing:${6 * k}px;text-shadow:0 ${8 * k}px 0 #0a0c2a">ШПА</div>
    <div style="font-size:${34 * k}px;font-weight:700;margin-top:${10 * k}px;color:#cfd4ff">Игра выезда · 7–8 ноября</div>
    <div style="display:flex;flex-wrap:wrap;gap:${12 * k}px;margin-top:${34 * k}px;font-size:${21 * k}px">
      ${[['flag', 'Задания'], ['qr', 'QR-отметки'], ['book', 'Подготовка'], ['swords', 'Битва ПБ'], ['gift', 'Мерч за баллы']].map(([i, t]) => `<span class="chip">${icon(i, 22 * k, '#ffd76a')}${t}</span>`).join('')}
    </div>
  </div>
  <div style="position:absolute;right:${70 * k}px;top:${90 * k}px;filter:drop-shadow(0 ${20 * k}px ${40 * k}px #000a)">${totemSvg(bolt, 330 * k)}</div>
  <div style="position:absolute;left:${70 * k}px;right:${70 * k}px;bottom:${50 * k}px;display:flex;justify-content:space-between">${totems(92 * k)}</div>`);
}

export function avatar(s = 640) {
  return base(s, s, `<div style="position:absolute;inset:0;display:grid;place-items:center">
    <div style="position:relative;width:${s * 0.86}px;height:${s * 0.86}px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#2a8fd6,#004a6b);display:grid;place-items:center;box-shadow:inset 0 0 0 ${s * 0.025}px #7fd0ff">
      <div style="transform:translateY(-${s * 0.06}px)">${totemSvg(bolt, s * 0.52, false)}</div>
      <div class="h" style="position:absolute;bottom:${s * 0.12}px;font-size:${s * 0.15}px;letter-spacing:${s * 0.01}px;text-shadow:0 ${s * 0.012}px 0 #002b40">ШПА</div>
    </div></div>`);
}
