#!/bin/bash
# Instalador de A Estação (só macOS).
#
# O que faz, nesta ordem:
#   1. confere macOS, Node 20 ou mais novo e npm;
#   2. baixa as dependências do app (Three.js) se ainda não estiverem em app/node_modules;
#   3. cria "A Estação.app" (app de dois cliques) na pasta onde o repositório foi clonado,
#      com o ícone do astronauta, apontando para ESTA pasta;
#   4. cria um atalho "A Estação" na Mesa (a não ser que use --sem-atalho).
#
# Pode rodar quantas vezes quiser: refaz o app do zero. Se mudar a pasta de lugar,
# rode de novo (o app guarda o caminho da pasta).
#
# Uso:
#   ./instalar.sh                 instala e cria o atalho na Mesa
#   ./instalar.sh --sem-atalho    instala sem criar atalho
#   ./instalar.sh --sem-registro  não avisa o LaunchServices (útil em testes)
#   ./instalar.sh --ajuda
set -euo pipefail

PASTA="$(cd "$(dirname "$0")" && pwd -P)"
NOME="A Estação"
APP="$PASTA/$NOME.app"
PORTA_PADRAO=4317
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

COM_ATALHO=1
COM_REGISTRO=1
for opcao in "$@"; do
  case "$opcao" in
    --sem-atalho) COM_ATALHO=0 ;;
    --sem-registro) COM_REGISTRO=0 ;;
    -h|--ajuda|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opção desconhecida: $opcao (use --ajuda)"; exit 2 ;;
  esac
done

passo() { printf '\n> %s\n' "$1"; }
falha() { printf '\nNão deu para instalar: %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Requisitos
# ---------------------------------------------------------------------------
passo "Conferindo os requisitos"
[ "$(uname)" = "Darwin" ] || falha "A Estação só funciona no macOS por enquanto."
for arquivo in app/servidor.js app/index.html app/package.json iniciar.sh; do
  [ -f "$PASTA/$arquivo" ] || falha "não achei $arquivo. Rode o instalar.sh de dentro da pasta do repositório."
done

NODE="$(command -v node || true)"
[ -n "$NODE" ] || falha "não achei o Node.js. Instale o Node 20 ou mais novo (https://nodejs.org) e rode de novo."
VERSAO_NODE="$("$NODE" -p 'process.versions.node' 2>/dev/null || echo 0)"
MAIOR="${VERSAO_NODE%%.*}"
[ "${MAIOR:-0}" -ge 20 ] 2>/dev/null || falha "o Node encontrado é o $VERSAO_NODE; A Estação precisa do 20 ou mais novo."
NPM="$(command -v npm || true)"
[ -n "$NPM" ] || falha "não achei o npm (ele vem junto com o Node)."
echo "  macOS $(sw_vers -productVersion 2>/dev/null || echo '?'), Node $VERSAO_NODE em $NODE"

if [ ! -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" ] && [ ! -d "${CODEX_HOME:-$HOME/.codex}" ]; then
  echo "  Aviso: não achei sessões do Claude Code nem do Codex nesta conta. A Estação abre, mas fica vazia"
  echo "  até você usar um dos dois."
fi

# ---------------------------------------------------------------------------
# 2. Dependências (só o Three.js)
# ---------------------------------------------------------------------------
passo "Conferindo as dependências"
if [ -f "$PASTA/app/node_modules/three/build/three.module.js" ]; then
  echo "  Three.js já está instalado."
else
  echo "  Baixando o Three.js (só na primeira vez)..."
  if [ -f "$PASTA/app/package-lock.json" ]; then
    (cd "$PASTA/app" && "$NPM" ci --no-audit --no-fund --loglevel=error)
  else
    (cd "$PASTA/app" && "$NPM" install --no-audit --no-fund --loglevel=error)
  fi
  [ -f "$PASTA/app/node_modules/three/build/three.module.js" ] || falha "o npm terminou, mas o Three.js não apareceu em app/node_modules."
fi

# ---------------------------------------------------------------------------
# 3. Ícone (.icns): usa icone.icns; senão gera a partir de um png do projeto
# ---------------------------------------------------------------------------
passo "Preparando o ícone"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
ICNS=""
if [ -f "$PASTA/icone.icns" ]; then
  ICNS="$PASTA/icone.icns"
  echo "  Usando icone.icns."
else
  PNG=""
  for candidato in "$PASTA/icone-1024.png" "$PASTA/app/icone-1024.png" "$PASTA/app/icone-180.png"; do
    [ -f "$candidato" ] && { PNG="$candidato"; break; }
  done
  if [ -n "$PNG" ]; then
    echo "  Gerando o ícone a partir de ${PNG#$PASTA/}."
    CONJUNTO="$TEMP/icone.iconset"
    mkdir -p "$CONJUNTO"
    for tamanho in 16 32 128 256 512; do
      sips -z "$tamanho" "$tamanho" "$PNG" --out "$CONJUNTO/icon_${tamanho}x${tamanho}.png" >/dev/null
      dobro=$((tamanho * 2))
      sips -z "$dobro" "$dobro" "$PNG" --out "$CONJUNTO/icon_${tamanho}x${tamanho}@2x.png" >/dev/null
    done
    if iconutil -c icns "$CONJUNTO" -o "$TEMP/icone.icns" 2>/dev/null; then
      ICNS="$TEMP/icone.icns"
    else
      echo "  Não consegui gerar o .icns; o app fica com o ícone padrão."
    fi
  else
    echo "  Nenhum ícone encontrado; o app fica com o ícone padrão."
  fi
fi

# ---------------------------------------------------------------------------
# 4. App de dois cliques
# ---------------------------------------------------------------------------
passo "Criando \"$NOME.app\""
# Apps abertos pelo Finder não herdam o PATH do terminal (nvm, Homebrew, Volta...):
# guardamos a pasta do Node encontrado agora e somamos as pastas comuns.
PASTA_NODE="$(dirname "$NODE")"
CAMINHOS="$PASTA_NODE"
for comum in /opt/homebrew/bin /usr/local/bin /usr/bin /bin; do
  case ":$CAMINHOS:" in *":$comum:"*) ;; *) CAMINHOS="$CAMINHOS:$comum" ;; esac
done

# Escapa para dentro de uma string AppleScript (barra invertida e aspas).
escapar() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
INICIAR_AS="$(escapar "$PASTA/iniciar.sh")"
CAMINHOS_AS="$(escapar "$CAMINHOS")"

cat > "$TEMP/estacao.applescript" <<EOF
-- A Estação: liga o servidor local (se precisar) e abre a página no navegador.
-- Gerado pelo instalar.sh. Pasta do projeto: $(escapar "$PASTA")
try
	do shell script "export PATH=" & quoted form of "$CAMINHOS_AS" & ":\$PATH; bash " & quoted form of "$INICIAR_AS"
	open location "http://localhost:$PORTA_PADRAO"
on error mensagem
	display alert "Não consegui abrir A Estação" message mensagem & return & return & "Se você mudou a pasta do projeto de lugar, rode o instalar.sh de novo." as warning
end try
EOF

rm -rf "$APP"
if ! osacompile -o "$APP" "$TEMP/estacao.applescript" 2>"$TEMP/erro.txt"; then
  cat "$TEMP/erro.txt" >&2
  falha "o osacompile não conseguiu criar o app."
fi

# Ícone: sem Assets.car e sem CFBundleIconName, o macOS usa o applet.icns.
if [ -n "$ICNS" ]; then
  rm -f "$APP/Contents/Resources/Assets.car"
  plutil -remove CFBundleIconName "$APP/Contents/Info.plist" 2>/dev/null || true
  cp "$ICNS" "$APP/Contents/Resources/applet.icns"
fi
plutil -replace CFBundleDevelopmentRegion -string pt-BR "$APP/Contents/Info.plist"
plutil -replace CFBundleName -string "$NOME" "$APP/Contents/Info.plist"

# Assina de novo (o pacote mudou) e avisa o Finder.
codesign --force --deep -s - "$APP" 2>/dev/null || echo "  Aviso: não consegui assinar o app (ele deve abrir mesmo assim)."
touch "$APP"
if [ "$COM_REGISTRO" = 1 ] && [ -x "$LSREGISTER" ]; then "$LSREGISTER" -f "$APP" || true; fi
echo "  Pronto: $APP"

# ---------------------------------------------------------------------------
# 5. Atalho na Mesa (não mexe em atalho que já existe)
# ---------------------------------------------------------------------------
if [ "$COM_ATALHO" = 1 ]; then
  passo "Criando o atalho na Mesa"
  if [ -e "$HOME/Desktop/$NOME" ]; then
    echo "  Já existe um \"$NOME\" na Mesa; deixei como está."
  else
    if osascript - "$APP" "$NOME" >/dev/null 2>&1 <<'APPLESCRIPT'
on run argv
	set alvo to POSIX file (item 1 of argv) as alias
	tell application "Finder"
		set atalho to make alias file to alvo at (path to desktop folder)
		set name of atalho to (item 2 of argv)
	end tell
end run
APPLESCRIPT
    then echo "  Atalho criado: ~/Desktop/$NOME"
    else echo "  Não consegui criar o atalho (o macOS pode ter pedido permissão ao Finder). O app está em: $APP"
    fi
  fi
fi

cat <<EOF

Tudo pronto. Para abrir A Estação:
  - dois cliques em "$NOME" (na Mesa ou nesta pasta), ou
  - no terminal: npm start   (e abra http://localhost:$PORTA_PADRAO)
Para desligar: ./parar.sh
EOF
