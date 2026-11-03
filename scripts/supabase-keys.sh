#!/usr/bin/env bash
# Достаёт ключи проекта через Management API по SUPABASE_ACCESS_TOKEN и кладёт в $GITHUB_ENV:
# SERVICE_KEY (service_role или secret) и, если в deploy.env пусто, SUPABASE_ANON_KEY (anon или publishable).
set -euo pipefail
REF="$1"
JSON=$(curl -fsS "https://api.supabase.com/v1/projects/$REF/api-keys?reveal=true" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" || echo '[]')
pick() { node -e '
  const k = JSON.parse(process.argv[1] || "[]"); const want = process.argv[2];
  const ok = (x) => x && x.api_key && !/\*/.test(x.api_key);
  const f = want === "service"
    ? (k.find((x) => x.name === "service_role" && ok(x)) || k.find((x) => (x.type === "secret" || /^sb_secret_/.test(x.api_key || "")) && ok(x)))
    : (k.find((x) => x.name === "anon" && ok(x)) || k.find((x) => (x.type === "publishable" || /^sb_publishable_/.test(x.api_key || "")) && ok(x)));
  process.stdout.write(f ? f.api_key : "");' "$JSON" "$1"; }  # $1 функции — что искать
SERVICE=$(pick service)
ANON=$(pick anon)
if [ -n "$SERVICE" ]; then echo "::add-mask::$SERVICE"; echo "SERVICE_KEY=$SERVICE" >> "$GITHUB_ENV"; fi
if [ -z "${SUPABASE_ANON_KEY:-}" ] && [ -n "$ANON" ]; then echo "SUPABASE_ANON_KEY=$ANON" >> "$GITHUB_ENV"; fi
echo "ключи: service=$([ -n "$SERVICE" ] && echo есть || echo нет), anon=$([ -n "${SUPABASE_ANON_KEY:-$ANON}" ] && echo есть || echo нет)"
