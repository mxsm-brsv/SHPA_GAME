#!/usr/bin/env bash
# Настройка бота вечерки (кнопка + голосование): описание, команда /start, кнопка меню «Открыть»,
# вебхук на функцию vecherka, аватар (если его ещё нет). Имя бота задаётся в @BotFather.
# Нужны: VECHERKA_BOT_TOKEN, GAME_URL, SUPABASE_URL. Токен в лог не выводится.
set -euo pipefail
: "${VECHERKA_BOT_TOKEN:?нет VECHERKA_BOT_TOKEN}" "${GAME_URL:?нет GAME_URL}"
API="https://api.telegram.org/bot$VECHERKA_BOT_TOKEN"
APP_URL="${GAME_URL%/}/knopka/"
res() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.ok?"ok":"ошибка: "+j.description)}catch{console.log(s.slice(0,200))}})'; }
call() { curl -sS -X POST "$API/$1" -H 'content-type: application/json' -d "$2"; }
js() { SRC="$1" node -e 'process.stdout.write(JSON.stringify(eval("(" + process.env.SRC + ")")))'; }

echo "бот: $(curl -sS "$API/getMe" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s).result;console.log("@"+r.username+" «"+r.first_name+"»"+(r.has_main_web_app?", главное мини-приложение включено":""))}catch{console.log("токен не подошёл")}})')"
echo "короткое описание: $(call setMyShortDescription "$(js '{short_description:"Вечерка ШПА: кнопка для ответов на скорость и голосование за лучший клип ⚡"}')" | res)"
echo "описание: $(call setMyDescription "$(js '{description:"⚡ Вечерка Школы профсоюзного актива МЭИ в стиле «Ты — лидер».\n\n🟡 Кнопка: один человек от профбюро жмёт, когда у команды готов ответ. Кто первый — решают время касания и часы сервера, а не скорость интернета.\n🎬 Голосование: выбери лучший клип — кроме клипа своего профбюро.\n\nНажми «Старт», потом «Открыть»."}')" | res)"
echo "команды: $(call setMyCommands "$(js '{commands:[{command:"start",description:"Открыть кнопку и голосование"}]}')" | res)"
echo "кнопка меню → $APP_URL: $(call setChatMenuButton "$(APP_URL="$APP_URL" js '{menu_button:{type:"web_app",text:"Открыть",web_app:{url:process.env.APP_URL}}}')" | res)"

if [ -n "${SUPABASE_URL:-}" ]; then
  SECRET=$(printf '%s' "$VECHERKA_BOT_TOKEN:webhook" | sha256sum | cut -c1-48)
  HOOK="${SUPABASE_URL%/}/functions/v1/vecherka"
  echo "вебхук → $HOOK: $(HOOK="$HOOK" SECRET="$SECRET" call setWebhook "$(HOOK="$HOOK" SECRET="$SECRET" js '{url:process.env.HOOK,secret_token:process.env.SECRET,allowed_updates:["message","callback_query"],max_connections:40}')" | res)"
  curl -sS "$API/getWebhookInfo" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result||{};console.log("вебхук: ожидают "+(r.pending_update_count??0)+(r.last_error_message?", последняя ошибка: "+r.last_error_message:", ошибок нет"))})'
fi

AV="$(dirname "$0")/../public/knopka/bot-avatar.jpg"
ID=$(curl -sS "$API/getMe" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result.id)}catch{console.log("")}})')
if [ -n "$ID" ] && [ -f "$AV" ]; then
  N=$(curl -sS "$API/getUserProfilePhotos?user_id=$ID&limit=1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result.total_count)}catch{console.log(-1)}})')
  if [ "$N" = "0" ]; then
    echo "аватар: $(curl -sS -X POST "$API/setMyProfilePhoto" -F 'photo={"type":"static","photo":"attach://avatar"}' -F "avatar=@$AV" | res)"
  else echo "аватар: уже есть (фото: $N)"; fi
fi
