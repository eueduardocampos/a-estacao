#!/bin/bash
# Sobe o servidor do escritório (se ainda não estiver no ar) e abre no navegador.
# Se o servidor cair sozinho, ele é religado até 5 vezes (com 2 s de intervalo).
# Desligado pelo parar.sh (sinal), ele não volta.
PASTA="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || echo /opt/homebrew/bin/node)"
URL="http://localhost:4317"
if ! curl -fs -o /dev/null --max-time 1 "$URL/api/estado"; then
  mkdir -p "$PASTA/logs"
  nohup /bin/bash -c '
    for tentativa in 1 2 3 4 5; do
      "$0" "$1"
      codigo=$?
      # 0 = saiu normalmente; 128 ou mais = desligado por sinal (parar.sh): não religa
      if [ "$codigo" -eq 0 ] || [ "$codigo" -ge 128 ]; then break; fi
      if [ "$tentativa" -ge 5 ]; then echo "[iniciar.sh] servidor caiu (código $codigo) e não vou religar de novo"; break; fi
      echo "[iniciar.sh] servidor caiu (código $codigo), religando (tentativa $((tentativa + 1)) de 5)"
      sleep 2
    done
  ' "$NODE" "$PASTA/app/servidor.js" > "$PASTA/logs/servidor.log" 2>&1 &
  for i in $(seq 1 30); do
    curl -fs -o /dev/null --max-time 1 "$URL/api/estado" && break
    sleep 0.2
  done
fi
curl -fs -o /dev/null --max-time 1 "$URL/api/estado" || { echo "O servidor não subiu. Veja $PASTA/logs/servidor.log"; exit 1; }
