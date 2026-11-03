#!/usr/bin/env python3
"""Собирает src/map/campusData.ts из выгрузки OpenStreetMap (osm.json).

osm.json — здания, дороги и территории вокруг МЭИ в метрах: x — на восток от 37.6869°, y — на юг от 55.7654°.
Мир игры — тот же масштаб (1 единица = 1 метр), сдвинутый на X0 метров к востоку, чтобы кампус был в центре.
Данные карты © участники OpenStreetMap (ODbL). osm.json выгружен через https://www.openstreetmap.org/api/0.6/map
(bbox 37.6869,55.7510 — 37.7178,55.7654), здания упрощены до ~1.5 м. Запуск: python3 scripts/map-osm/build.py
"""
import json, math, re, sys
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE.parent.parent / 'src' / 'map' / 'campusData.ts'
X0, W, H = 250, 1690, 1610
LON0, LAT0, MLON, MLAT = 37.6869, 55.7654, 62640, 111200

d = json.loads((HERE / 'osm.json').read_text())


def pts_of(s):
    return [(float(a) - X0, float(b)) for a, b in (p.split(',') for p in s.split())]


def visible(p, pad=40):
    return any(-pad <= x <= W + pad and -pad <= y <= H + pad for x, y in p)


def path(p, close=True):
    """Короткий путь: первая точка абсолютно, дальше — относительные смещения."""
    q = [(round(x), round(y)) for x, y in p]
    out = [f'M{q[0][0]} {q[0][1]}']
    rel = []
    for (ax, ay), (bx, by) in zip(q, q[1:]):
        if (bx, by) == (ax, ay):
            continue
        rel.append(f'{bx - ax} {by - ay}')
    if rel:
        out.append('l' + ' '.join(rel))
    if close:
        out.append('z')
    return re.sub(r' -', '-', ''.join(out))


def centroid(p):
    a = cx = cy = 0.0
    n = len(p)
    for i in range(n):
        x1, y1 = p[i]
        x2, y2 = p[(i + 1) % n]
        f = x1 * y2 - x2 * y1
        a += f
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    if abs(a) < 1e-6:
        return sum(x for x, _ in p) / n, sum(y for _, y in p) / n
    return cx / (3 * a), cy / (3 * a)


# ---------- здания ----------
def is_mpei(name, ad):
    if 'МЭИ' in name and 'Общежитие' not in name and 'Студенческий' not in name:
        return True
    m = re.match(r'Красноказарменная (\d+)(\S*)', ad)
    if m:
        num, suf = m.group(1), m.group(2)
        if num == '13':
            return True
        if num == '14' and not suf.startswith('А'):
            return True
        if num == '17' and not suf.startswith('А'):
            return True
    return bool(re.match(r'Энергетический пр\. (3|6)\b', ad))


def is_dorm(name, ad):
    if 'Общежитие' in name and 'МЭИ' in name:
        return True
    if 'Студенческий центр МЭИ' in name or 'Санаторий-профилакторий НИУ МЭИ' in name:
        return True
    return bool(re.match(r'Энергетическая (14 к[134]|6|18)$', ad))


bld, mp, dm = [], [], []
letters = []
for s, name, ad, lv in d['b']:
    p = pts_of(s)
    if not visible(p, 0):
        continue
    pp = path(p)
    if is_mpei(name, ad):
        mp.append(pp)
        m = re.match(r'Корпус (\S)$', name)
        if m:
            cx, cy = centroid(p)
            letters.append((round(cx), round(cy), m.group(1)))
    elif is_dorm(name, ad):
        dm.append(pp)
    else:
        bld.append(pp)

# ---------- территории ----------
green, water, pitch, stadium, rail, tram = [], [], [], [], [], []
for s, kind, name in d['a']:
    p = pts_of(s)
    if not visible(p):
        continue
    if kind in ('R:rail',):
        rail.append(path(p, False))
    elif kind == 'R:tram':
        tram.append(path(p, False))
    elif kind in ('N:water', 'W:riverbank'):
        water.append(path(p))
    elif kind in ('L:pitch', 'L:track'):
        pitch.append(path(p))
    elif kind in ('L:stadium', 'L:sports_centre'):
        stadium.append(path(p))
    elif kind.startswith(('L:', 'U:', 'N:')):
        green.append(path(p))

# ---------- дороги ----------
WIDTH = {'primary': 24, 'primary_link': 10, 'secondary': 17, 'secondary_link': 9, 'tertiary': 13, 'tertiary_link': 8,
         'residential': 9, 'unclassified': 9, 'living_street': 7, 'pedestrian': 6, 'service': 5}
roads: dict[int, list[str]] = {}
by_name: dict[str, list[list[tuple[float, float]]]] = {}
for s, hw, name, _ in d['r']:
    p = pts_of(s)
    if not visible(p):
        continue
    w = WIDTH.get(hw, 6)
    roads.setdefault(w, []).append(path(p, False))
    if name and hw != 'service':
        by_name.setdefault(name, []).append(p)

SHORT = {
    'Красноказарменная улица': 'Красноказарменная ул.', 'Энергетическая улица': 'Энергетическая ул.',
    'Энергетический проезд': 'Энергетический пр.', 'улица Лапина': 'ул. Лапина', 'улица Лефортовский Вал': 'Лефортовский Вал',
    'Авиамоторная улица': 'Авиамоторная ул.', 'Солдатская улица': 'Солдатская ул.', '2-я улица Синичкина': '2-я Синичкина ул.',
    'Наличная улица': 'Наличная ул.', 'шоссе Энтузиастов': 'ш. Энтузиастов', 'Красноказарменный проезд': 'Красноказарменный пр.',
    'проезд Завода Серп и Молот': 'пр. Завода Серп и Молот', '1-й Краснокурсантский проезд': '1-й Краснокурсантский пр.',
    '2-й Краснокурсантский проезд': '2-й Краснокурсантский пр.', 'Третье транспортное кольцо': 'ТТК', 'Танковый проезд': 'Танковый пр.',
    'улица Золоторожский Вал': 'Золоторожский Вал', 'Юрьевский переулок': 'Юрьевский пер.', 'Авиамоторный проезд': 'Авиамоторный пр.',
}


def length(p):
    return sum(math.dist(a, b) for a, b in zip(p, p[1:]))


def clip(p):
    """Оставляем часть линии внутри мира, чтобы подпись не уехала за край."""
    q = [pt for pt in p if 10 <= pt[0] <= W - 10 and 10 <= pt[1] <= H - 10]
    return q if len(q) >= 2 else []


labels = []
for name, parts in by_name.items():
    if name not in SHORT:
        continue
    best = max((clip(p) for p in parts), key=length)
    if length(best) < 140:
        continue
    if best[-1][0] < best[0][0]:  # подпись читается слева направо
        best = best[::-1]
    # участок вокруг середины длиной ~ под надпись
    labels.append((SHORT[name], path(best, False)))

# ---------- особые подписи (по центрам объектов OSM) ----------
named = {}
for s, name, ad, lv in d['b']:
    if name:
        named.setdefault(name, centroid(pts_of(s)))
for s, kind, name in d['a']:
    if name:
        p = pts_of(s)
        c = centroid(p)
        if name not in named or kind.startswith('L:stadium'):
            named[name] = c


def at(name, dx=0, dy=0):
    x, y = named[name]
    return round(x + dx), round(y + dy)


places = [
    (*at('Главный учебный корпус', 0, 34), 'ГУК'),
    (*at('Дом культуры МЭИ', 0, 46), 'ДК МЭИ'),
    (*at('Бассейн спорткомплекса НИУ МЭИ', -8, 36), 'Бассейн'),
    (*at('Научно-техническая библиотека НИУ МЭИ', 0, 44), 'НТБ'),
    (*at('Учебно-экспериментальная теплоэлектроцентраль НИУ МЭИ', 0, -36), 'ТЭЦ МЭИ'),
    (*at('Столовая №10', 0, 34), 'Столовая №10'),
    (*at('НИУ МЭИ. Общежитие №14', 10, 58), 'Общежитие №14'),
    (*at('Общежитие №6 МЭИ', 0, -44), 'Общежитие №6'),
    (*at('Санаторий-профилакторий НИУ МЭИ', 0, -38), 'Профилакторий'),
    (*at('Екатерининский дворец'), 'Екатерининский дворец'),
    (*at('Кадетский Плац'), 'Кадетский плац'),
    (*at('Бизнес-центр "Интеграл"'), 'БЦ «Интеграл»'),
    (*at('Москино Спутник', 0, 40), 'Кинотеатр «Спутник»'),
    (*at('Объединенный институт высоких температур РАН', 6, 52), 'ОИВТ РАН'),
]

data = {
    'W': W, 'H': H,
    'bld': ''.join(bld), 'mpei': ''.join(mp), 'dorm': ''.join(dm),
    'green': ''.join(green), 'water': ''.join(water), 'pitch': ''.join(pitch), 'stadium': ''.join(stadium),
    'rail': ''.join(rail), 'tram': ''.join(tram),
    'roads': [[w, ''.join(v)] for w, v in sorted(roads.items())],
    'labels': labels, 'letters': letters, 'places': places,
}

head = '''// Схема Лефортово и кампуса МЭИ по данным OpenStreetMap (© участники OpenStreetMap, ODbL).
// Сгенерировано scripts/map-osm/build.py — руками не править. 1 единица = 1 метр, север сверху.
'''
body = f'''export const CAMPUS = {json.dumps(data, ensure_ascii=False, separators=(',', ':'))} as const;
/** Мировые координаты (метры) → [широта, долгота]. */
export const toGeo = (x: number, y: number): [number, number] => [+({LAT0} - y / {MLAT}).toFixed(6), +({LON0} + (x + {X0}) / {MLON}).toFixed(6)];
'''
OUT.write_text(head + body)
print('written', OUT, len(body), 'bytes;', 'bld', len(bld), 'mpei', len(mp), 'dorm', len(dm), 'letters', sorted(l[2] for l in letters), 'labels', [l[0] for l in labels])
print({k: named[k] for k in ['Главный учебный корпус', 'Корпус М', 'Корпус К', 'Корпус Б', 'Корпус Г', 'Корпус Д']})
