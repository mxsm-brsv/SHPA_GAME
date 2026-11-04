#!/usr/bin/env bash
# Локальная проверка SQL: чистая база → заглушки Supabase → все миграции → сценарии.
# PGHOST=/tmp PGPORT=5499 ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${DB:-shpa_test}
psql -U postgres -q -c "drop database if exists $DB" -c "create database $DB"
for f in supabase/tests/stub.sql supabase/migrations/*.sql; do psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q -f "$f" 2>&1 | grep -v NOTICE || true; done
psql -U postgres -d $DB -q -f supabase/tests/v2_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v3_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v4_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v5_test.sql
psql -U postgres -d $DB -q -f supabase/tests/v6_test.sql
