# Генератор вопросов «Правовухи» из текстов документов проекта.
# Три вида вопросов, каждый строится из дословной нормы, поэтому верный ответ проверяем по тексту:
#   1) число в норме → «вставь пропущенное» (выбор из 4 или ввод) или «верно ли» с изменённым числом;
#   2) модальность нормы («вправе / не вправе», «допускается / не допускается») → «верно ли»;
#   3) определения понятий → «какое понятие определено так».
# Неверные варианты чисел берутся того же грамматического класса (1 / 2–4 / 5–20), чтобы фраза оставалась грамотной.
# Запуск: python3 -I generate.py <папка_с_текстами> <выход.json>
import os, hashlib, json, random, re, sys
from collections import defaultdict

SRC = sys.argv[1]
OUT = sys.argv[2]
rnd = random.Random(20261103)

# файл → (короткое имя для вопроса, полное имя для пояснения, тема или функция темы, квота, стиль нумерации)
def t273(art):
    a = int(float(art or 0))
    if a in (36,): return 'Стипендии'
    if a in (39,): return 'Общежития'
    if a in (43, 45): return 'Дисциплина'
    if a in (58, 59, 60): return 'Учёба и аттестация'
    if a in (61, 62): return 'Перевод и восстановление'
    if a in (53, 54, 55, 56, 57): return 'Учёба и аттестация'
    if a in (33, 34, 35, 37, 38, 40, 41, 42, 44): return 'Права обучающихся'
    return 'Закон об образовании'

DOCS = [
    ('fz273.txt', 'Закон об образовании', 'Федерального закона № 273-ФЗ «Об образовании в РФ»', t273, 260, 'law'),
    ('raw/30a94b07-____10.txt', 'Закон о профсоюзах', 'Федерального закона № 10-ФЗ «О профессиональных союзах, их правах и гарантиях деятельности»', 'Профсоюз: закон', 60, 'law'),
    ('ustav.txt', 'Устав Профсоюза', 'Устава Общероссийского Профсоюза образования', 'Устав Профсоюза', 140, 'ustav'),
    ('fz53.txt', 'Закон о воинской обязанности', 'Федерального закона № 53-ФЗ «О воинской обязанности и военной службе»', 'Армия', 75, 'law'),
    ('zhk.txt', 'Жилищный кодекс', 'Жилищного кодекса РФ', 'Общежития', 30, 'law'),
    ('raw/715a2362-___152.txt', 'Закон о персональных данных', 'Федерального закона № 152-ФЗ «О персональных данных»', 'Персональные данные', 75, 'law'),
    ('raw/5bf7451b-___82.txt', 'Закон об общественных объединениях', 'Федерального закона № 82-ФЗ «Об общественных объединениях»', 'Молодёжная политика и НКО', 55, 'law'),
    ('raw/9df41e0f-___135.txt', 'Закон о благотворительности и волонтёрстве', 'Федерального закона № 135-ФЗ «О благотворительной деятельности и добровольчестве (волонтёрстве)»', 'Молодёжная политика и НКО', 50, 'law'),
    ('raw/6524b2c7-___489.txt', 'Закон о молодёжной политике', 'Федерального закона № 489-ФЗ «О молодёжной политике в РФ»', 'Молодёжная политика и НКО', 30, 'law'),
    ('raw/2edf6a40-___555.txt', 'Положение о целевом обучении', 'Положения о целевом обучении (Постановление Правительства РФ № 555)', 'Целевое и практика', 60, 'order'),
    ('raw/edcf625e-___1390.txt', 'Правила формирования стипендиального фонда', 'Правил формирования стипендиального фонда (Постановление Правительства РФ № 1390)', 'Стипендии', 20, 'order'),
    ('raw/fe22110b-___245.txt', 'Порядок обучения в вузе', 'Порядка организации образовательной деятельности по программам ВО (Приказ Минобрнауки № 245)', 'Учёба и аттестация', 45, 'order'),
    ('raw/57ea76b4-___284.txt', 'Порядок дисциплинарных взысканий', 'Порядка применения мер дисциплинарного взыскания (Приказ Минобрнауки № 284)', 'Дисциплина', 22, 'order'),
    ('raw/dea3d6c3-___303.txt', 'Порядок академического отпуска', 'Порядка предоставления академического отпуска (Приказ Минобрнауки № 303)', 'Академический отпуск', 22, 'order'),
    ('raw/581e1f67-___606.txt', 'Порядок перевода внутри системы ВО', 'Порядка перевода обучающихся по программам ВО (Приказ Минобрнауки № 606)', 'Перевод и восстановление', 20, 'order'),
    ('raw/8fd9974e-___607.txt', 'Порядок перевода в другой вуз', 'Порядка перевода в другую образовательную организацию (Приказ Минобрнауки № 607)', 'Перевод и восстановление', 25, 'order'),
    ('raw/7a6d383d-___822.txt', 'Порядок перехода с платного на бюджет', 'Порядка перехода с платного обучения на бесплатное (Приказ Минобрнауки № 822)', 'Перевод и восстановление', 22, 'order'),
    ('raw/b3b0ea1b-___807.txt', 'Рекомендации по поддержке студенческих семей', 'Рекомендаций по поддержке студенческих семей (Приказ Минобрнауки № 807)', 'Общежития', 28, 'order'),
    ('raw/a321358c-___885__________390.txt', 'Положение о практической подготовке', 'Положения о практической подготовке (Приказ № 885/390)', 'Целевое и практика', 25, 'order'),
    ('raw/b1df4ac6-___1010.txt', 'Приказ о плате за общежитие', 'Приказа Минобрнауки № 1010 о максимальном размере платы за наём жилья в общежитии', 'Общежития', 4, 'order'),
    ('raw/dd59818b-___1663.txt', 'Порядок назначения стипендий', 'Порядка назначения стипендий (Приказ Минобрнауки № 1663)', 'Стипендии', 38, 'order'),
    ('raw/6d5d5cac-___309.txt', 'Указ о национальных целях', 'Указа Президента РФ № 309 «О национальных целях развития»', 'Государственная политика', 28, 'order'),
    ('raw/2461e50b-___809.txt', 'Основы традиционных ценностей', 'Основ государственной политики по сохранению традиционных ценностей (Указ Президента РФ № 809)', 'Государственная политика', 16, 'order'),
    ('raw/a1d4e56c-_____________.txt', 'Положение о СКС', 'Положения о СКС Профсоюза', 'СКС Профсоюза', 34, 'dotted'),
    ('raw/340007c7-_______________.txt', 'Положение о КРК', 'Положения о контрольно-ревизионной комиссии Профсоюза', 'Профсоюз: устройство и учёт', 26, 'dotted'),
    ('raw/3807051b-________________________________________________.txt', 'Положение о членских взносах', 'Положения о размере и порядке уплаты членских профсоюзных взносов', 'Профсоюз: устройство и учёт', 22, 'dotted'),
    ('raw/63d42af1-___________________________________.txt', 'Положение об учёте членов Профсоюза', 'Положения об учёте членов Профсоюза и членском профсоюзном билете', 'Профсоюз: устройство и учёт', 26, 'dotted'),
    ('raw/eebe1ab3-_____________________________________.txt', 'Положение о конфиденциальной информации', 'Положения о конфиденциальной информации Профсоюза', 'Персональные данные', 14, 'dotted'),
    ('raw/953f6316-______________2025-2030.txt', 'Приоритеты Профсоюза 2025–2030', 'Приоритетных направлений деятельности Профсоюза на 2025–2030 годы', 'Профсоюз: устройство и учёт', 10, 'dotted'),
    ('raw/52a3f1b4-______________________.txt', 'Генеральное соглашение', 'Генерального соглашения на 2024–2026 годы', 'Соглашения', 30, 'dotted'),
    ('raw/32be7fbc-_________________________________________.txt', 'Отраслевое соглашение', 'Отраслевого соглашения по вузам Минобрнауки на 2024–2026 годы', 'Соглашения', 70, 'dotted'),
]

NOISE = re.compile(r'(КонсультантПлюс|consultant\.ru|Документ предоставлен|Дата сохранения|Страница \d+ из \d+|надежная правовая поддержка|Список изменяющих документов|Информация об изменениях|См\. текст|ГАРАНТ|garant\.ru)', re.I)
REDAKT = re.compile(r'\((?:в ред\.|введен|введена|введено|п\. \d+|часть \d+|абзац|пп\. |подп\.|утратил|в редакции)[^()]*(?:\([^()]*\)[^()]*)*\)', re.I)
NEWPARA = re.compile(r'^(Статья \d+|Глава [IVXLC\d]+|[IVXLC]+\.\s|\d+(?:\.\d+)*\.\s|\d+\)\s|[а-я]\)\s|-\s|•)')

def paragraphs(text):
    lines = [l.strip() for l in text.replace('\r', '').split('\n')]
    # колонтитулы: строки, которые повторяются на каждой странице
    freq = defaultdict(int)
    for l in lines:
        if len(l) > 15: freq[l] += 1
    header = {l for l, n in freq.items() if n >= 3}
    out, cur = [], ''
    for l in lines:
        l = re.sub(r'<\d+>', '', l).strip()
        if l in header or re.match(r'^-{5,}', l) or re.match(r'^(?:Приказ|Постановление|Указ|Федеральный закон) .{0,60}от \d{2}\.\d{2}\.\d{4} N \d+.*(?:ред\.|\.\.\.)', l):
            continue
        if not l or NOISE.search(l):
            if cur: out.append(cur); cur = ''
            continue
        if cur and (NEWPARA.match(l) or (cur.endswith(('.', ';', ':')) and l[:1].isupper())):
            out.append(cur); cur = l
        else:
            if cur.endswith('-') and not cur.endswith(' -'):
                cur = cur[:-1] + l
            else:
                cur = (cur + ' ' + l).strip()
    if cur: out.append(cur)
    res = []
    for p in out:
        p = REDAKT.sub('', p)
        p = re.sub(r'\s+', ' ', p).strip()
        if len(p) > 3: res.append(p)
    return res

ABBR = re.compile(r'(?:\b(?:ст|ч|п|пп|г|гг|т|д|др|руб|коп|см|рис|абз|подп|N|№|им|ул|тыс|млн|т\.д|т\.п|т\.е|И|О|Ф)\.)$')

def sentences(p):
    parts, cur = [], ''
    for tok in re.split(r'(?<=[.;])\s+', p):
        cur = (cur + ' ' + tok).strip() if cur else tok
        if ABBR.search(cur) or re.search(r'\b[А-ЯЁ]\.$', cur):
            continue
        parts.append(cur); cur = ''
    if cur: parts.append(cur)
    return parts

UNIT = r'(?:(?:календарн|рабоч|учебн|академическ|последовательн|полн)\w*\s+)?(?:дн(?:я|ей)|день|месяц\w*|лет|года?|годам?|недел\w+|час\w*|раз(?:а)?|процент\w*|человек|член\w*|минут\w*|сут(?:ок|ки)|смен\w*|семестр\w*|курс\w*|мест\w*)\b'
NUMW_GEN = ['двух', 'трех', 'четырех', 'пяти', 'шести', 'семи', 'восьми', 'девяти', 'десяти']
NUMW_NOM_B = ['два', 'три', 'четыре']
NUMW_NOM_C = ['пять', 'шесть', 'семь', 'восемь', 'девять', 'десять']
NUM_RE = re.compile(r'(?<![\w./№-])(?P<num>\d{1,4}(?:,\d+)?|' + '|'.join(NUMW_GEN + ['трёх', 'четырёх'] + NUMW_NOM_B + NUMW_NOM_C) + r')(?P<sp>\s*(?:%|' + UNIT + r'))', re.I)
BAD_BEFORE = re.compile(r'(?:N|№|ст\.|стать\w*|част\w*|ч\.|пункт\w*|п\.|подпункт\w*|пп\.|глав\w*|от|абзац\w*|приложени\w*|разд\w*|номер\w*|код\w*)\s*$', re.I)
CONTEXT_BAD = re.compile(r'(настоящ\w+ (?:пункт|част|стать|подпункт|абзац)|указанн\w+ в (?:пункт|част|подпункт|абзац)|предусмотренн\w+ (?:пункт|част|подпункт|абзац)\w* \d|в соответствии с (?:пункт|част|подпункт)\w* \d|абзац\w* (?:перв|втор|трет)|утратил|Утвердить|прилагаем|Собрание законодательства|ред\.)', re.I)

def num_class(n):
    if n % 10 == 1 and n % 100 != 11: return 'A'
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14: return 'B'
    return 'C'

def alt_numbers(n):
    """Три правдоподобных неверных числа того же грамматического класса."""
    cls = num_class(n)
    pool = set()
    for k in [n * 2, n * 3, n // 2, n + 1, n - 1, n + 2, n - 2, n + 5, n - 5, n + 10, n - 10, n * 10, n + 20, n + 30, 15, 30, 45, 60, 90, 6, 7, 10, 12, 14, 20, 25, 40, 50, 100, 3, 2, 4, 5]:
        if k > 0 and k != n and num_class(k) == cls and k < 10000:
            pool.add(k)
    pool = sorted(pool, key=lambda k: (abs(k - n) / max(n, 1), k))
    near = pool[:8]
    rnd.shuffle(near)
    return near[:3]

def alt_words(w):
    lw = w.lower().replace('ё', 'е')
    for group in (NUMW_GEN, NUMW_NOM_B, NUMW_NOM_C):
        if lw in group:
            others = [x for x in group if x != lw]
            rnd.shuffle(others)
            return others[:3]
    return []

MODAL_PAIRS = [
    (r'\bне допускается\b', 'допускается'), (r'\bдопускается\b', 'не допускается'),
    (r'\bне вправе\b', 'вправе'), (r'\bвправе\b', 'не вправе'),
    (r'\bне может\b', 'может'), (r'\bможет\b', 'не может'),
    (r'\bне могут\b', 'могут'), (r'\bмогут\b', 'не могут'),
    (r'\bобязан\b', 'не обязан'), (r'\bобязаны\b', 'не обязаны'), (r'\bобязана\b', 'не обязана'),
    (r'\bзапрещается\b', 'разрешается'), (r'\bне подлежит\b', 'подлежит'), (r'\bподлежит\b', 'не подлежит'),
]
KEYWORDS = re.compile(r'(обучающ|студент|стипенд|общежит|член\w* Профсоюза|профсоюз|первичн|отчисл|академическ|аттестац|экзамен|перевод|восстанов|взнос|молод|доброволь|волонт|персональн|целев|практик|каникул|отпуск|стаж|выбор|собрани|конференц|съезд|председател|СКС|отсрочк|призыв|семь|ребен|беремен|сирот|инвалид|плат)', re.I)

def label_for(style, art, point):
    if style == 'ustav':
        if art and point: return f'п. {point} ст. {art}'
        if art: return f'ст. {art}'
        return ''
    if style == 'law':
        if art and point: return f'ч. {point} ст. {art}'
        if art: return f'ст. {art}'
        return ''
    if point: return f'п. {point}'
    return ''

def clean_quote(s):
    s = re.sub(r'^\s*(?:\d+(?:\.\d+)*\.|\d+\)|[а-я]\))\s*', '', s).strip()
    s = s.rstrip(';:,')
    if not s.endswith('.'): s += '.'
    return s[0].upper() + s[1:] if s else s

def make_id(q): return 'q_' + hashlib.sha1(q.encode()).hexdigest()[:8]

VERB = re.compile(r'\b(?:\w+(?:ется|ются|ится|ятся|ает|яет|ует|ит|ет|ут|ют|ат|ят|ено|ена|ены|ан|ано|аны|ался|алась|алось|ались)|вправе|обязан\w*|долж\w+|является|являются|составляет|составляют|может|могут|допускается|подлежит|не)\b')
def ok_sentence(s, lo=60, hi=360):
    if not (lo <= len(s) <= hi): return False
    if not re.match(r'^[А-ЯЁ]', s): return False
    if not VERB.search(s): return False
    last = re.findall(r'(\w+)\.$', s)
    if last and re.search(r'(?:ой|ый|ий|ая|ые|ых|ого|ему)$', last[0]) and len(last[0]) >= 6 and last[0] not in ('Федеральной', 'Российской'): return False
    if re.search(r'\b(?:могут|может|вправе|обязаны?|являются|является|составляет)\.$', s): return False
    if re.search(r':\s', s): return False
    if CONTEXT_BAD.search(s): return False
    if s.count('"') % 2 or s.count('«') != s.count('»') or s.count('(') != s.count(')'): return False
    if re.match(r'^[а-яё]', s) and not re.match(r'^(?:\d+\)|[а-я]\))', s): return False
    if re.search(r'\b(?:следующ\w+|ниже|нижеследующ\w+):?\s*$', s): return False
    if s.endswith(':'): return False
    return True

cands = defaultdict(list)
defs = defaultdict(list)
lists = defaultdict(list)   # перечни: вступление «…:» + пункты «1) …»

for fname, short, full, topic, quota, style in DOCS:
    try:
        text = re.sub(r'[\x00-\x01\x03-\x08\x0b\x0c\x0e-\x1f]', ' ', open(f'{SRC}/{fname}', encoding='utf-8').read().replace('\x02', '-'))  # \x02 в PDF — дефис
    except FileNotFoundError:
        print('нет файла', fname); continue
    art, point = None, None
    cur_list = None
    for p in paragraphs(text):
        mi = re.match(r'^(?:\d+|[а-я])\)\s*(.+)$', p)
        if cur_list is not None and mi:
            item = mi.group(1).strip().rstrip(';.,')
            if 12 <= len(item) <= 170 and not CONTEXT_BAD.search(item) and 'утратил' not in item:
                cur_list['items'].append(item[:1].upper() + item[1:])
            continue
        if cur_list is not None:
            if len(cur_list['items']) >= 4: lists[fname].append(cur_list)
            cur_list = None
        if p.endswith(':') and 25 <= len(p) <= 240 and not CONTEXT_BAD.search(p) and not re.search(r'следующ|настоящ|ниже', p):
            intro = re.sub(r'^\s*(?:\d+(?:\.\d+)*\.)\s*', '', p).rstrip(':').strip()
            tp0 = topic(art) if callable(topic) else topic
            cur_list = dict(intro=intro, items=[], art=art, lab=label_for(style, art, point), topic=tp0)
        m = re.match(r'^Статья (\d+(?:\.\d+)?)\.?', p)
        if m:
            art, point = m.group(1), None
            continue
        if style in ('law', 'ustav'):
            m = re.match(r'^(\d+)\.\s', p)
            if m and art: point = m.group(1)
        else:
            m = re.match(r'^(\d+(?:\.\d+)*)\.\s', p)
            if m: point = m.group(1)
        tp = topic(art) if callable(topic) else topic
        lab = label_for(style, art, point)
        # определения: «1) термин - определение» или «"термин" - определение» или «Термин – это …»
        md = None if (fname == 'fz273.txt' and art != '2') or (style in ('law', 'ustav') and art and float(art) > 6) else re.match(r'^(?:\d+\)\s*)?["«]?([А-ЯЁа-яё][а-яё\- (),]{2,70}?)["»]?\s+[-–—]\s+(?:это\s+)?(.{40,320})$', p)
        if md and len(md.group(1).split()) <= 6 and not re.search(r'\d', md.group(1)) and re.fullmatch(r'[А-ЯЁа-яё][а-яё]+(?:[ -][а-яё(),]+){0,5}', md.group(1).strip().strip('"«»')) and len(md.group(1)) >= 6:
            term = md.group(1).strip().strip('"«»')
            df = md.group(2).strip().rstrip(';.')
            if not CONTEXT_BAD.search(df) and re.match(r'^[а-яё]', df) and len(df) >= 50:
                defs[fname].append((term, df, lab, tp))
        for s in sentences(p):
            sq = clean_quote(s)
            if not ok_sentence(sq): continue
            score = len(KEYWORDS.findall(sq)) * 2 + (1 if 90 <= len(sq) <= 200 else 0)
            # числа
            nums = [m for m in NUM_RE.finditer(sq) if not BAD_BEFORE.search(sq[:m.start()]) and not re.match(r'\d{4}$', m.group('num'))]
            if len(nums) >= 1:
                m = nums[0]
                cands[fname].append(dict(kind='num', s=sq, m=(m.start('num'), m.end('num')), num=m.group('num'), lab=lab, topic=tp, score=score + 2, art=art))
            # модальность (одна, без оговорок)
            if not re.search(r'за исключением|кроме случа|если иное|, если |при условии', sq):
                hits = [(pat, rep) for pat, rep in MODAL_PAIRS if re.search(pat, sq)]
                pos = [m.start() for pat, _ in hits for m in re.finditer(pat, sq)]
                if len(set(pos)) == 1 or (len(hits) == 2 and hits[0][1] != hits[1][1] and len(set(pos)) <= 2 and 'не ' in hits[0][0]):
                    pat, rep = hits[0]
                    cands[fname].append(dict(kind='modal', s=sq, pat=pat, rep=rep, lab=lab, topic=tp, score=score, art=art))

def phrase_src(full, lab):
    return f'{lab} {full}'.strip() if lab else full

bank = []
used = set()
per_art = defaultdict(int)
QM = float(os.environ.get('QUOTA_MULT', '1'))
for fname, short, full, topic, quota, style in DOCS:
    quota = int(quota * QM)
    pool = cands.get(fname, [])
    rnd.shuffle(pool)
    pool.sort(key=lambda c: -c['score'])
    taken = 0
    modal_taken = 0
    dlist = defs.get(fname, [])
    # определения: до трети квоты
    terms = list({d[0].lower(): d for d in dlist}.values())
    for term, df, lab, tp in terms[: max(0, quota // 3)]:
        others = [t[0] for t in terms if t[0].lower() != term.lower()]
        if len(others) < 3: break
        opts = rnd.sample(others, 3) + [term]
        rnd.shuffle(opts)
        q = f'{short}: какое понятие определено так — «{df[:230]}{"…" if len(df) > 230 else ""}»?'
        if q in used: continue
        used.add(q)
        bank.append(dict(id=make_id(q), format='choice', topic=tp, level=2, question=q, options=[o[:1].upper() + o[1:] for o in opts], correct=opts.index(term),
                         explanation=f'{term[:1].upper() + term[1:]} — так определено в {phrase_src(full, lab)}: «{term} — {df}».', source=short, auto=True))
        taken += 1
    # перечни: до четверти квоты
    lst = lists.get(fname, [])
    for L in lst:
        if taken >= quota or taken >= quota // 4 + (quota // 3 if len(pool) < quota // 2 else 0): break
        others = [it for M in lst if M['art'] != L['art'] or M['intro'] != L['intro'] for it in M['items'] if it not in L['items']]
        if len(others) < 3: continue
        for correct in rnd.sample(L['items'], min(2, len(L['items']))):
            dist = [o for o in others if abs(len(o) - len(correct)) < 90]
            if len(dist) < 3: dist = others
            opts = rnd.sample(dist, 3) + [correct]
            rnd.shuffle(opts)
            src_full = phrase_src(full, L['lab'])
            q = f'{short}: какой пункт входит в перечень «{L["intro"]}…»?'
            q_id = q + correct
            if q_id in used: continue
            used.add(q_id)
            bank.append(dict(id=make_id(q_id), format='choice', topic=L['topic'], level=2, question=q, options=opts, correct=opts.index(correct),
                             explanation=f'«{correct}» — это пункт перечня из {src_full}. Остальные варианты взяты из других норм этого же документа.', source=short, auto=True))
            taken += 1
    for c in pool:
        if taken >= quota: break
        key = (fname, c['art'] or '', c.get('lab'))
        if per_art[key] >= 4: continue
        s, lab, tp = c['s'], c['lab'], c['topic']
        src_full = phrase_src(full, lab)
        if c['kind'] == 'num':
            a, b = c['m']
            num = c['num']
            if num.isdigit():
                n = int(num)
                alts = [str(x) for x in alt_numbers(n)]
            else:
                alts = alt_words(num)
            if len(alts) < 3: continue
            mode = rnd.random()
            if mode < 0.3:
                # верно ли (с изменённым числом в половине случаев)
                truth = rnd.random() < 0.5
                stmt = s if truth else s[:a] + (alts[0] if num.isdigit() or num.islower() else alts[0].capitalize()) + s[b:]
                q = f'{short}: {stmt}'
                fmt = 'yesno'
                item = dict(format='yesno', correct=truth, level=1,
                            explanation=(f'Да — {src_full}: «{s}»' if truth else f'Нет — в норме {num}, а не {alts[0]}. {src_full[:1].upper() + src_full[1:]}: «{s}»'))
            elif mode < 0.78:
                blank = s[:a] + '___' + s[b:]
                opts = [num] + alts[:3]
                rnd.shuffle(opts)
                q = f'{short}. Вставь пропущенное: «{blank}»'
                fmt = 'choice'
                item = dict(format='choice', options=opts, correct=opts.index(num), level=2, explanation=f'{num} — {src_full}: «{s}»')
            else:
                if not num.isdigit(): continue
                blank = s[:a] + '___' + s[b:]
                q = f'{short}. Впиши число вместо пропуска: «{blank}»'
                fmt = 'input'
                item = dict(format='input', answer=num, level=3, explanation=f'{num} — {src_full}: «{s}»')
        else:
            if modal_taken >= quota // 2: continue
            modal_taken += 1
            truth = rnd.random() < 0.5
            stmt = s if truth else re.sub(c['pat'], c['rep'], s, count=1)
            if stmt == s and not truth: continue
            q = f'{short}: {stmt}'
            item = dict(format='yesno', correct=truth, level=1,
                        explanation=(f'Да — {src_full}: «{s}»' if truth else f'Нет — {src_full}: «{s}»'))
        if q in used: continue
        used.add(q)
        per_art[key] += 1
        item.update(id=make_id(q), topic=tp, question=q, source=short, auto=True)
        bank.append(item)
        taken += 1
    print(f'{short:45s} кандидатов {len(pool):4d}, определений {len(dlist):3d} → взято {taken}')

json.dump(bank, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('всего', len(bank))
