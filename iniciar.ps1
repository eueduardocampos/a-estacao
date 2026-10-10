# Sobe o servidor da Estação (se ainda não estiver no ar) e abre no navegador.
# Versão para Windows do iniciar.sh. Se o servidor cair sozinho, ele é religado até
# 5 vezes (com 2 s de intervalo). Desligado pelo parar.ps1, ele não volta.
#
# Uso:
#   .\iniciar.ps1              liga (se precisar) e abre a página
#   .\iniciar.ps1 -SemAbrir    só liga (é o que o atalho de início do Windows usa)
param([switch]$SemAbrir, [switch]$Vigia)

$Pasta = $PSScriptRoot
$Url = 'http://localhost:4317'
$Registro = Join-Path $Pasta 'logs\servidor.log'

function NoAr {
  # por 127.0.0.1: com "localhost" o Windows tenta o IPv6 primeiro e estoura o tempo
  try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:4317/api/estado"; return $true } catch { return $false }
}

# Modo vigia: fica em segundo plano, sem janela, cuidando do servidor.
if ($Vigia) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Add-Content -Encoding utf8 $Registro '[iniciar.ps1] não achei o Node.js no PATH'; exit 1 }
  $servidor = Join-Path $Pasta 'app\servidor.js'
  for ($tentativa = 1; $tentativa -le 5; $tentativa++) {
    # pelo cmd: o redirecionamento do PowerShell 5.1 gravaria o registro em UTF-16.
    # Os caminhos vão por variável de ambiente para o cmd não tropeçar em aspas e espaços.
    $env:ESTACAO_NODE = $node; $env:ESTACAO_SERVIDOR = $servidor; $env:ESTACAO_REGISTRO = $Registro
    & $env:ComSpec /d /s /c '"%ESTACAO_NODE%" "%ESTACAO_SERVIDOR%" >> "%ESTACAO_REGISTRO%" 2>&1'
    $codigo = $LASTEXITCODE
    if ($codigo -eq 0) { break }
    if ($tentativa -ge 5) { Add-Content -Encoding utf8 $Registro "[iniciar.ps1] servidor caiu (código $codigo) e não vou religar de novo"; break }
    Add-Content -Encoding utf8 $Registro "[iniciar.ps1] servidor caiu (código $codigo), religando (tentativa $($tentativa + 1) de 5)"
    Start-Sleep -Seconds 2
  }
  exit 0
}

if (-not (NoAr)) {
  $null = New-Item -ItemType Directory -Force (Join-Path $Pasta 'logs')
  Set-Content -Encoding utf8 $Registro ''
  $argumentos = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Vigia' -f $PSCommandPath
  Start-Process -WindowStyle Hidden -WorkingDirectory $Pasta -FilePath 'powershell.exe' -ArgumentList $argumentos
  for ($i = 0; $i -lt 40; $i++) { if (NoAr) { break }; Start-Sleep -Milliseconds 250 }
}
if (-not (NoAr)) { Write-Host "O servidor não subiu. Veja $Registro"; exit 1 }
if (-not $SemAbrir) { Start-Process $Url }
