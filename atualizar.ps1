# Atualiza A Estação para a versão mais nova publicada no GitHub, com segurança
# (versão para Windows do atualizar.sh):
#   1. confere que esta pasta é um clone do git;
#   2. se houver alterações suas em arquivos do projeto, MOSTRA quais e para, sem
#      mexer em nada (guarde ou desfaça antes e rode de novo);
#   3. baixa a versão nova só se der para avançar direto (git pull --ff-only);
#   4. atualiza as dependências (npm install em app\).
# Antes de rodar, feche A Estação (parar.cmd); depois, abra de novo pelo atalho.
# A página da Estação nunca roda este script sozinha.
Set-Location $PSScriptRoot

function Falhar($texto) { Write-Host "`nNada foi atualizado: $texto"; exit 1 }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Falhar 'o git não está instalado (https://git-scm.com/download/win).' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Falhar 'o npm não foi encontrado (instale o Node.js 20 ou mais novo em nodejs.org).' }
if (-not (Test-Path .git)) { Falhar 'esta pasta não veio de um git clone. Baixe a versão nova no GitHub ou clone o repositório de novo.' }

function Versao { try { (Get-Content -Raw -Encoding utf8 app\package.json | ConvertFrom-Json).version } catch { '?' } }
$antesVersao = Versao
$antesCommit = git rev-parse --short HEAD 2>$null

# Alterações em arquivos que o git acompanha (arquivos novos seus não atrapalham).
# package-lock.json é reescrito pelo próprio npm install (não é trabalho seu): só ele
# mudado, volta ao do repositório para o git pull não travar
$alteracoes = @(git status --porcelain --untracked-files=no)
$travas = @($alteracoes | Where-Object { $_ -match '^ M (app/)?package-lock\.json$' } | ForEach-Object { $_.Substring(3) })
$outras = @($alteracoes | Where-Object { $_ -and $_ -notmatch '^ M (app/)?package-lock\.json$' })
if ($travas.Count -and -not $outras.Count) {
  Write-Host "Voltando $($travas -join ' ') ao do repositório (o npm reescreve esse arquivo sozinho)."
  git checkout -- $travas
  if ($LASTEXITCODE -ne 0) { Falhar "não deu para restaurar $($travas -join ' ')." }
}
if ($outras.Count) {
  Write-Host 'Há alterações locais nestes arquivos:'
  $alteracoes | ForEach-Object { Write-Host "  $_" }
  Write-Host "`nPara não sobrescrever nada seu, a atualização parou aqui."
  Write-Host 'Guarde as mudanças (git stash) ou desfaça (git checkout -- <arquivo>) e rode .\atualizar.ps1 de novo.'
  exit 1
}

git rev-parse --abbrev-ref --symbolic-full-name '@{u}' *> $null
if ($LASTEXITCODE -ne 0) { Falhar 'o ramo atual não acompanha um ramo do GitHub (git branch --set-upstream-to=origin/main).' }

Write-Host 'Baixando a versão nova (git pull --ff-only)…'
git pull --ff-only
if ($LASTEXITCODE -ne 0) { Falhar 'o git não conseguiu avançar direto (sem internet ou o histórico local divergiu). Veja a mensagem acima.' }

Write-Host "`nAtualizando as dependências (npm install em app\)…"
Push-Location app
npm.cmd install --no-audit --no-fund
$codigo = $LASTEXITCODE
Pop-Location
if ($codigo -ne 0) { Falhar 'o npm install falhou. Veja a mensagem acima e rode de novo.' }

$depoisVersao = Versao
$depoisCommit = git rev-parse --short HEAD 2>$null
Write-Host ''
if ($antesCommit -eq $depoisCommit) {
  Write-Host "Você já estava na versão mais recente ($depoisVersao, $depoisCommit)."
} else {
  Write-Host "Pronto: de $antesVersao ($antesCommit) para $depoisVersao ($depoisCommit)."
}
Write-Host 'Se A Estação estiver aberta, feche e abra de novo: parar.cmd e depois o atalho da Área de Trabalho.'
