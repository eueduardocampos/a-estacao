#!/bin/bash
# Atualiza A Estação para a versão mais nova publicada no GitHub, com segurança:
#   1. confere que esta pasta é um clone do git;
#   2. se houver alterações suas em arquivos do projeto, MOSTRA quais e para, sem
#      mexer em nada (guarde ou desfaça antes e rode de novo);
#   3. baixa a versão nova só se der para avançar direto (git pull --ff-only);
#   4. atualiza as dependências (npm install em app/).
# Antes de rodar, feche A Estação (./parar.sh); depois, abra de novo (./iniciar.sh
# ou dois cliques no app). A página da Estação nunca roda este script sozinha.
set -u

PASTA="$(cd "$(dirname "$0")" && pwd)"
cd "$PASTA" || exit 1

falhar() { echo; echo "Nada foi atualizado: $1"; exit 1; }

command -v git >/dev/null 2>&1 || falhar "o git não está instalado (no Mac: xcode-select --install)."
command -v npm >/dev/null 2>&1 || falhar "o npm não foi encontrado (instale o Node.js 20 ou mais novo em nodejs.org)."
[ -d .git ] || falhar "esta pasta não veio de um git clone. Baixe a versão nova no GitHub ou clone o repositório de novo."

versao() { node -p "require('./app/package.json').version" 2>/dev/null || echo "?"; }
ANTES_VERSAO="$(versao)"
ANTES_COMMIT="$(git rev-parse --short HEAD 2>/dev/null)"

# Alterações em arquivos que o git acompanha (arquivos novos seus não atrapalham;
# se algum deles bater com um arquivo da versão nova, o próprio git recusa e avisa)
ALTERACOES="$(git status --porcelain --untracked-files=no)"
# package-lock.json é reescrito pelo próprio npm install (não é trabalho seu): só ele
# mudado, volta ao do repositório para o git pull não travar
TRAVAS="$(echo "$ALTERACOES" | grep -E '^ M (app/)?package-lock\.json$' | cut -c4-)"
if [ -n "$ALTERACOES" ] && [ -z "$(echo "$ALTERACOES" | grep -vE '^ M (app/)?package-lock\.json$')" ]; then
  echo "Voltando $(echo $TRAVAS) ao do repositório (o npm reescreve esse arquivo sozinho)."
  git checkout -- $TRAVAS || falhar "não deu para restaurar $(echo $TRAVAS)."
  ALTERACOES=""
fi
if [ -n "$ALTERACOES" ]; then
  echo "Há alterações locais nestes arquivos:"
  echo "$ALTERACOES" | sed 's/^/  /'
  echo
  echo "Para não sobrescrever nada seu, a atualização parou aqui."
  echo "Guarde as mudanças (git stash) ou desfaça (git checkout -- <arquivo>) e rode ./atualizar.sh de novo."
  exit 1
fi

git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 \
  || falhar "o ramo atual não acompanha um ramo do GitHub (git branch --set-upstream-to=origin/main)."

echo "Baixando a versão nova (git pull --ff-only)…"
git pull --ff-only || falhar "o git não conseguiu avançar direto (sem internet ou o histórico local divergiu). Veja a mensagem acima."

echo
echo "Atualizando as dependências (npm install em app/)…"
( cd app && npm install --no-audit --no-fund ) || falhar "o npm install falhou. Veja a mensagem acima e rode de novo."

DEPOIS_VERSAO="$(versao)"
DEPOIS_COMMIT="$(git rev-parse --short HEAD 2>/dev/null)"
echo
if [ "$ANTES_COMMIT" = "$DEPOIS_COMMIT" ]; then
  echo "Você já estava na versão mais recente ($DEPOIS_VERSAO, $DEPOIS_COMMIT)."
else
  echo "Pronto: de $ANTES_VERSAO ($ANTES_COMMIT) para $DEPOIS_VERSAO ($DEPOIS_COMMIT)."
fi
echo "Se A Estação estiver aberta, feche e abra de novo: ./parar.sh e depois ./iniciar.sh (ou dois cliques no app)."
