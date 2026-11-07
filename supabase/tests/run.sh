#!/usr/bin/env bash
# Локальная проверка SQL: чистая база → заглушки Supabase → все миграции → сценарии.
# PGHOST=/tmp PGPORT=5499 ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${DB:-shpa_test}
psql -U postgres -q -c "drop database if exists $DB" -c "create database $DB"
for f in supabase/tests/stub.sql supabase/migrations/*.sql; do psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q -f "$f" 2>&1 | grep -v NOTICE || true; done
# Сценарии — как запросы из приложения в Supabase: с защитой safeupdate (UPDATE/DELETE только с WHERE).
# Библиотеку можно собрать из github.com/eradman/pg-safeupdate; без неё сценарии идут без защиты.
if psql -U postgres -d $DB -qAtc "load 'safeupdate'" >/dev/null 2>&1; then export PGOPTIONS="-c session_preload_libraries=safeupdate"
else echo "ВНИМАНИЕ: safeupdate не установлен — сценарии без защиты от UPDATE/DELETE без WHERE"; fi
python3 supabase/tests/check_where.py $DB
psql -U postgres -d $DB -q -f supabase/tests/v2_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v3_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v4_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v5_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v6_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v7_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v8_knopka_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v10_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v11_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v12_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v13_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v14_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v15_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v16_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v9_vote_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v17_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v20_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v21_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v22_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v23_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v25_test.sql
