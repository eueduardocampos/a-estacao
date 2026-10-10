# Instalador de A Estação no Windows (o do macOS é o instalar.sh).
#
# O que faz, nesta ordem:
#   1. confere Windows 10 ou 11, Node 20 ou mais novo e npm;
#   2. baixa as dependências do app (Three.js) se ainda não estiverem em app\node_modules;
#   3. prepara o ícone (icone.ico, feito a partir do icone-1024.png se faltar);
#   4. cria o atalho "A Estação" na Área de Trabalho, apontando para ESTA pasta.
#
# Pode rodar quantas vezes quiser. Se mudar a pasta de lugar, rode de novo
# (o atalho guarda o caminho da pasta).
#
# Uso (no PowerShell, de dentro da pasta), ou dois cliques em instalar.cmd:
#   .\instalar.ps1                 instala e cria o atalho na Área de Trabalho
#   .\instalar.ps1 -SemAtalho      instala sem criar atalho
#   .\instalar.ps1 -ComInicio      também liga A Estação quando você entra no Windows
#   .\instalar.ps1 -SemInicio      desfaz o -ComInicio
param([switch]$SemAtalho, [switch]$ComInicio, [switch]$SemInicio)

$ErrorActionPreference = 'Stop'
$Pasta = $PSScriptRoot
$Nome = 'A Estação'
$PortaPadrao = 4317

function Passo($texto) { Write-Host "`n> $texto" }
function Falha($texto) { Write-Host "`nNão deu para instalar: $texto" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------
# 1. Requisitos
# ---------------------------------------------------------------------------
Passo 'Conferindo os requisitos'
if ($env:OS -ne 'Windows_NT') { Falha 'este instalador é o do Windows. No macOS, use ./instalar.sh.' }
foreach ($arquivo in 'app\servidor.js', 'app\index.html', 'app\package.json', 'app\sonda-windows.ps1', 'iniciar.ps1') {
  if (-not (Test-Path (Join-Path $Pasta $arquivo))) { Falha "não achei $arquivo. Rode o instalar.ps1 de dentro da pasta do repositório." }
}
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Falha 'não achei o Node.js. Instale o Node 20 ou mais novo (https://nodejs.org) e rode de novo.' }
$versaoNode = (& $node -p 'process.versions.node')
if ([int]($versaoNode -split '\.')[0] -lt 20) { Falha "o Node encontrado é o $versaoNode; A Estação precisa do 20 ou mais novo." }
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { Falha 'não achei o npm (ele vem junto com o Node).' }
Write-Host "  Windows $([Environment]::OSVersion.Version), Node $versaoNode em $node"

$claude = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$codex = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
if (-not (Test-Path $claude) -and -not (Test-Path $codex)) {
  Write-Host '  Aviso: não achei sessões do Claude Code nem do Codex nesta conta. A Estação abre, mas fica vazia'
  Write-Host '  até você usar um dos dois.'
}

# ---------------------------------------------------------------------------
# 2. Dependências (só o Three.js)
# ---------------------------------------------------------------------------
Passo 'Conferindo as dependências'
$three = Join-Path $Pasta 'app\node_modules\three\build\three.module.js'
if (Test-Path $three) {
  Write-Host '  Three.js já está instalado.'
} else {
  Write-Host '  Baixando o Three.js (só na primeira vez)...'
  Push-Location (Join-Path $Pasta 'app')
  try {
    if (Test-Path 'package-lock.json') { & $npm ci --no-audit --no-fund --loglevel=error } else { & $npm install --no-audit --no-fund --loglevel=error }
  } finally { Pop-Location }
  if (-not (Test-Path $three)) { Falha 'o npm terminou, mas o Three.js não apareceu em app\node_modules.' }
}

# ---------------------------------------------------------------------------
# 3. Ícone (.ico): usa icone.ico; senão gera a partir do icone-1024.png
# ---------------------------------------------------------------------------
Passo 'Preparando o ícone'
$ico = Join-Path $Pasta 'icone.ico'
if (Test-Path $ico) {
  Write-Host '  Usando icone.ico.'
} else {
  $png = Join-Path $Pasta 'icone-1024.png'
  if (Test-Path $png) {
    try {
      Add-Type -AssemblyName System.Drawing
      $origem = [System.Drawing.Image]::FromFile($png)
      $imagens = @()
      foreach ($lado in 256, 64, 48, 32, 16) {
        $bmp = New-Object System.Drawing.Bitmap $lado, $lado
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
        $g.DrawImage($origem, 0, 0, $lado, $lado)
        $g.Dispose()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        $imagens += , @($lado, $ms.ToArray())
      }
      $origem.Dispose()
      # .ico = cabeçalho + uma entrada de 16 bytes por tamanho + os PNG em sequência
      $saida = New-Object System.IO.MemoryStream
      $w = New-Object System.IO.BinaryWriter $saida
      $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$imagens.Count)
      $deslocamento = 6 + 16 * $imagens.Count
      foreach ($i in $imagens) {
        $lado = $i[0]; $bytes = $i[1]
        $w.Write([byte]($lado % 256)); $w.Write([byte]($lado % 256)); $w.Write([byte]0); $w.Write([byte]0)
        $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$bytes.Length); $w.Write([uint32]$deslocamento)
        $deslocamento += $bytes.Length
      }
      foreach ($i in $imagens) { $w.Write([byte[]]$i[1]) }
      $w.Flush()
      [System.IO.File]::WriteAllBytes($ico, $saida.ToArray())
      Write-Host '  Ícone gerado a partir de icone-1024.png.'
    } catch {
      Write-Host "  Não consegui gerar o .ico ($($_.Exception.Message)); o atalho fica com o ícone padrão."
    }
  } else {
    Write-Host '  Nenhum ícone encontrado; o atalho fica com o ícone padrão.'
  }
}

# ---------------------------------------------------------------------------
# 4. Atalhos (Área de Trabalho e, se pedido, início do Windows)
# ---------------------------------------------------------------------------
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function CriarAtalho($destino, $argumentosExtras, $descricao) {
  $shell = New-Object -ComObject WScript.Shell
  $atalho = $shell.CreateShortcut($destino)
  $atalho.TargetPath = $powershell
  $atalho.Arguments = ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"{1}' -f (Join-Path $Pasta 'iniciar.ps1'), $argumentosExtras)
  $atalho.WorkingDirectory = $Pasta
  $atalho.WindowStyle = 7   # minimizado: a janela do PowerShell não pisca na frente
  $atalho.Description = $descricao
  if (Test-Path $ico) { $atalho.IconLocation = "$ico,0" }
  $atalho.Save()
}

if (-not $SemAtalho) {
  Passo 'Criando o atalho na Área de Trabalho'
  $mesa = [Environment]::GetFolderPath('Desktop')
  $destino = Join-Path $mesa "$Nome.lnk"
  CriarAtalho $destino '' 'Abre A Estação no navegador'
  Write-Host "  Atalho criado: $destino"
}

$inicio = Join-Path ([Environment]::GetFolderPath('Startup')) "$Nome.lnk"
if ($ComInicio) {
  Passo 'Ligando junto com o Windows'
  CriarAtalho $inicio ' -SemAbrir' 'Liga o servidor de A Estação ao entrar no Windows'
  Write-Host "  Atalho criado: $inicio"
} elseif ($SemInicio -and (Test-Path $inicio)) {
  Remove-Item $inicio
  Write-Host "`n> A Estação não liga mais junto com o Windows."
}

Write-Host @"

Tudo pronto. Para abrir A Estação:
  - dois cliques em "$Nome" na Área de Trabalho, ou
  - no terminal: npm start   (e abra http://localhost:$PortaPadrao)
Para desligar: dois cliques em parar.cmd (ou .\parar.ps1)
"@
