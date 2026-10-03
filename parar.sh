#!/bin/bash
# Desliga o servidor da Estação: só o processo que escuta na porta 4317 (as cópias de
# teste em outras portas continuam no ar). Sem nada na porta, procura pelo caminho do app.
PASTA="$(cd "$(dirname "$0")" && pwd)"
PIDS="$(lsof -nP -tiTCP:4317 -sTCP:LISTEN 2>/dev/null)"
if [ -n "$PIDS" ]; then
  kill $PIDS
else
  pkill -f "$PASTA/app/servidor.js" || true
fi
echo "A Estação foi desligada."
