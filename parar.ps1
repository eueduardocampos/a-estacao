# Desliga o servidor da Estação: só o processo que escuta na porta 4317 (as cópias de
# teste em outras portas continuam no ar) e o vigia que o religaria (iniciar.ps1 -Vigia).
$achou = $false
$donos = Get-NetTCPConnection -State Listen -LocalPort 4317 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($id in $donos) {
  $servidor = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
  if (-not $servidor -or $servidor.CommandLine -notmatch 'servidor\.js') { continue }   # outra coisa na porta: não é nossa
  # o vigia é avô do servidor (powershell -> cmd -> node): sai primeiro, para não religar
  $acima = $servidor
  for ($i = 0; $i -lt 3 -and $acima; $i++) {
    $acima = Get-CimInstance Win32_Process -Filter "ProcessId=$($acima.ParentProcessId)"
    if ($acima -and $acima.CommandLine -match 'iniciar\.ps1' -and $acima.CommandLine -match '-Vigia') {
      Stop-Process -Id $acima.ProcessId -Force -ErrorAction SilentlyContinue
      break
    }
  }
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  $achou = $true
}
if ($achou) { Write-Host 'A Estação foi desligada.' } else { Write-Host 'A Estação não estava ligada.' }
