#!/usr/bin/env bash
# Настройка бота «ШПА»: имя, описание, команды, кнопка «Играть», вебхук на функцию bot, аватар (если его ещё нет).
# Нужны: BOT_TOKEN, GAME_URL; для вебхука — SUPABASE_URL. Токен в лог не выводится.
set -euo pipefail
: "${BOT_TOKEN:?нет BOT_TOKEN}" "${GAME_URL:?нет GAME_URL}"
API="https://api.telegram.org/bot$BOT_TOKEN"
res() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.ok?"ok":"ошибка: "+j.description)}catch{console.log(s.slice(0,200))}})'; }
call() { curl -sS -X POST "$API/$1" -H 'content-type: application/json' -d "$2"; }
# JSON из JS-литерала (строки с кириллицей и \n собирает node, а не bash)
js() { SRC="$1" node -e 'process.stdout.write(JSON.stringify(eval("(" + process.env.SRC + ")")))'; }

NAME=$(curl -sS "$API/getMyName" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result.name)}catch{console.log("")}})')
if [ "$NAME" != "ШПА" ]; then echo "имя «ШПА»: $(call setMyName "$(js '{name:"ШПА"}')" | res)"; else echo "имя: уже «ШПА»"; fi

echo "короткое описание: $(call setMyShortDescription "$(js '{short_description:"Игра Школы профсоюзного актива МЭИ. Задания, отметки на блоках, подготовка к конкурсу, битва профбюро и мерч за баллы."}')" | res)"
echo "описание: $(call setMyDescription "$(js '{description:"ШПА — игра выезда Школы профсоюзного актива МЭИ.\n\n— Задания и отметки на блоках\n— Больше 1000 вопросов к правовому конкурсу\n— Битва профбюро за настоящий кампус МЭИ\n— Мини-игры и штурм профкома\n— Мерч ППО за баллы\n\nНажми «Старт», затем «Играть». Вход — по ФИО и группе."}')" | res)"
echo "команды: $(call setMyCommands "$(js '{commands:[{command:"start",description:"Меню и кнопка «Играть»"},{command:"me",description:"Мои баллы и место"},{command:"help",description:"Как играть"},{command:"channel",description:"Канал профкома"}]}')" | res)"
echo "кнопка меню → $GAME_URL: $(call setChatMenuButton "$(GAME_URL="$GAME_URL" js '{menu_button:{type:"web_app",text:"Играть",web_app:{url:process.env.GAME_URL}}}')" | res)"

if [ -n "${SUPABASE_URL:-}" ]; then
  SECRET=$(printf '%s' "$BOT_TOKEN:webhook" | sha256sum | cut -c1-48)
  HOOK="${SUPABASE_URL%/}/functions/v1/bot"
  echo "вебхук → $HOOK: $(HOOK="$HOOK" SECRET="$SECRET" call setWebhook "$(HOOK="$HOOK" SECRET="$SECRET" js '{url:process.env.HOOK,secret_token:process.env.SECRET,allowed_updates:["message","callback_query"],max_connections:20}')" | res)"
  curl -sS "$API/getWebhookInfo" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result||{};console.log("вебхук: ожидают "+(r.pending_update_count??0)+(r.last_error_message?", последняя ошибка: "+r.last_error_message:", ошибок нет"))})'
fi

# Аватар ставим, только если у бота ещё нет фото (каждая установка — новое фото в профиле)
AV="$(dirname "$0")/../public/bot/avatar.jpg"
ID=$(curl -sS "$API/getMe" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result.id)}catch{console.log("")}})')
if [ -n "$ID" ] && [ -f "$AV" ]; then
  N=$(curl -sS "$API/getUserProfilePhotos?user_id=$ID&limit=1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result.total_count)}catch{console.log(-1)}})')
  if [ "$N" = "0" ]; then
    echo "аватар: $(curl -sS -X POST "$API/setMyProfilePhoto" -F 'photo={"type":"static","photo":"attach://avatar"}' -F "avatar=@$AV" | res)"
  else echo "аватар: уже есть (фото: $N)"; fi
fi
