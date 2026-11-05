"""Проверка: ни одна функция в схеме public не делает UPDATE/DELETE без WHERE.
В Supabase запросы из приложения идут через safeupdate, и такой запрос падает с «UPDATE requires a WHERE clause».
Запуск: python3 supabase/tests/check_where.py <база> (PGHOST/PGPORT из окружения). Код выхода 1 — нашлись нарушения."""
import json, re, subprocess, sys
db = sys.argv[1]
out = subprocess.run(["psql","-U","postgres","-d",db,"-Atc",
  "select coalesce(json_agg(json_build_object('n',p.proname,'a',pg_get_function_identity_arguments(p.oid),'s',p.prosrc)),'[]') from pg_proc p where p.pronamespace='public'::regnamespace and p.prolang in (select oid from pg_language where lanname in ('plpgsql','sql'))"],
  capture_output=True, text=True, check=True).stdout
bad = []
for f in json.loads(out):
    src = re.sub(r"--[^\n]*", "", f["s"])
    src = re.sub(r"'(?:[^']|'')*'", "''", src)
    for stmt in src.split(";"):
        s = " ".join(stmt.split())
        for m in re.finditer(r"\b(update|delete\s+from)\s+([a-z_][a-z0-9_.]*)", s, re.I):
            pre = s[:m.start()].lower()
            if re.search(r"(for|do|no key|share)\s*$", pre):   # FOR UPDATE, ON CONFLICT DO UPDATE
                continue
            rest = s[m.end():].lower()
            prev = None
            while prev != rest:
                prev = rest
                rest = re.sub(r"\([^()]*\)", " ", rest)
            if not re.search(r"\bwhere\b", rest):
                bad.append(f"{f['n']}({f['a']}): {m.group(0)} … {s[m.start():m.start()+90]}")
if bad:
    print("UPDATE/DELETE без WHERE (в Supabase упадут из приложения):\n  " + "\n  ".join(bad))
    sys.exit(1)
print("UPDATE/DELETE без WHERE в функциях: нет")
