#!/usr/bin/env bash
# Строка подключения к базе через пулер Supabase (IPv4). Прямой адрес db.<ref>.supabase.co — только IPv6,
# а раннеры GitHub его не умеют. Регион берём из Management API, иначе перебираем регионы.
# Результат: DB_URL в $GITHUB_ENV (замаскирован в логах).
set -uo pipefail
REF="$1"
command -v psql >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client >/dev/null; }
ENC=$(node -e 'process.stdout.write(encodeURIComponent(process.env.SUPABASE_DB_PASSWORD || ""))')
REGION=$(curl -fsS "https://api.supabase.com/v1/projects/$REF" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).region||"")}catch{}})')
REGIONS="$REGION eu-central-1 eu-central-2 eu-west-1 eu-west-2 eu-west-3 eu-north-1 us-east-1 us-east-2 us-west-1 us-west-2 ap-southeast-1 ap-southeast-2 ap-northeast-1 ap-northeast-2 ap-south-1 ca-central-1 sa-east-1"
echo "регион проекта: ${REGION:-не удалось узнать, перебираю}"
for r in $REGIONS; do
  for p in aws-0 aws-1; do
    URL="postgresql://postgres.$REF:$ENC@$p-$r.pooler.supabase.com:5432/postgres"
    if PGCONNECT_TIMEOUT=6 psql "$URL" -qtAc 'select 1' >/dev/null 2>&1; then
      echo "::add-mask::$URL"
      echo "DB_URL=$URL" >> "$GITHUB_ENV"
      echo "подключение: $p-$r.pooler.supabase.com"
      exit 0
    fi
  done
done
echo "::error::Не получилось подключиться к базе. Проверьте секрет SUPABASE_DB_PASSWORD — это пароль базы, заданный при создании проекта (сбросить: Supabase → Project Settings → Database → Reset database password)"
exit 1
