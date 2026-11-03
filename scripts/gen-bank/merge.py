# Сборка банка: старые вопросы + ручные + автоматические.
# Дедупликация, равные позиции правильного ответа в choice, отметка auto/review.
#   python3 -I merge.py <old.json> <manual.json> <auto.json> <out.json>
import json, random, re, sys
from collections import Counter

old, manual, auto, out = sys.argv[1:5]
rnd = random.Random(2026)


def norm(q):
    return re.sub(r'[^а-яёa-z0-9]+', ' ', q.lower()).strip()


bank, seen_id, seen_q = [], set(), set()
for src, items in (('old', json.load(open(old))), ('manual', json.load(open(manual))), ('auto', json.load(open(auto)))):
    for q in items:
        k = norm(q['question']) + '|' + str(q.get('answer') or (q['options'][q['correct']] if q['format'] == 'choice' else q['correct']))
        if q['id'] in seen_id or k in seen_q:
            continue
        if q['format'] == 'choice' and len(set(o.strip().lower() for o in q['options'])) != len(q['options']):
            continue
        seen_id.add(q['id']); seen_q.add(k)
        if src == 'auto':
            q['auto'] = True
        elif src == 'manual':
            q['review'] = True
        bank.append(q)

# позиции правильного ответа: по кругу 0..3 в случайном порядке
choices = [q for q in bank if q['format'] == 'choice']
rnd.shuffle(choices)
for i, q in enumerate(choices):
    n = len(q['options'])
    right = q['options'][q['correct']]
    rest = [o for j, o in enumerate(q['options']) if j != q['correct']]
    rnd.shuffle(rest)
    pos = i % n
    q['options'] = rest[:pos] + [right] + rest[pos:]
    q['correct'] = pos

for q in bank:
    if q['format'] == 'input':
        acc = {a.strip().lower() for a in q.get('accepted', [])}
        acc.add(str(q['answer']).strip().lower())
        q['accepted'] = sorted(acc)

json.dump(bank, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
yn = [q for q in bank if q['format'] == 'yesno']
print('всего', len(bank), dict(Counter(q['format'] for q in bank)))
print('да/нет:', sum(q['correct'] for q in yn), '/', sum(not q['correct'] for q in yn))
print('позиции:', dict(Counter(q['correct'] for q in bank if q['format'] == 'choice')))
print('темы:', len(Counter(q['topic'] for q in bank)))
