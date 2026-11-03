#!/usr/bin/env bash
# Шифрует банк вопросов для публичного репозитория. Ключ — тот же, что в секрете SEED_KEY.
# SEED_KEY=... ./scripts/encrypt-questions.sh path/to/bank.json
set -euo pipefail
: "${SEED_KEY:?Задайте SEED_KEY}"
mkdir -p content
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$1" -out content/questions.enc -pass env:SEED_KEY
echo "content/questions.enc обновлён"
