# Sonda do Windows: faz o papel do ps, do lsof e do ioreg do macOS.
# Fica ligada enquanto o servidor da Estação viver e, a cada -Intervalo segundos,
# escreve UMA linha de JSON na saída:
#   { inicios:   { "<pid>": "<início do processo em FILETIME UTC>" }, de todos os processos
#     escutando: [{ pid, comando, args, pasta, portas, soLocal, cpu, memoriaMB, ligadoHaS }],
#     gpu:       0 a 100 | null }
# Só leitura. A pasta de trabalho de cada processo sai do PEB dele (não existe
# comando pronto no Windows para isso); processo de outro usuário fica sem pasta.
param([int]$Intervalo = 5, [int]$Pai = 0)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class EstacaoCwd {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int acesso, bool herda, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int classe, ref PBI pbi, int tamanho, out int lido);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr endereco, byte[] buf, IntPtr tamanho, out IntPtr lido);
  [StructLayout(LayoutKind.Sequential)] struct PBI { public IntPtr R1; public IntPtr Peb; public IntPtr R2; public IntPtr R3; public IntPtr Pid; public IntPtr R4; }
  // Só 64 bits: PEB+0x20 = ProcessParameters; +0x38 = CurrentDirectory.DosPath (UNICODE_STRING)
  public static string Ler(int pid) {
    if (IntPtr.Size != 8) return null;
    IntPtr h = OpenProcess(0x0410, false, pid);   // QUERY_INFORMATION | VM_READ
    if (h == IntPtr.Zero) return null;
    try {
      PBI pbi = new PBI(); int n; IntPtr lido;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out n) != 0 || pbi.Peb == IntPtr.Zero) return null;
      byte[] p = new byte[8];
      if (!ReadProcessMemory(h, IntPtr.Add(pbi.Peb, 0x20), p, (IntPtr)8, out lido)) return null;
      IntPtr parametros = (IntPtr)BitConverter.ToInt64(p, 0);
      byte[] us = new byte[16];
      if (!ReadProcessMemory(h, IntPtr.Add(parametros, 0x38), us, (IntPtr)16, out lido)) return null;
      int tamanho = BitConverter.ToUInt16(us, 0);
      if (tamanho <= 0 || tamanho > 8192) return null;
      byte[] texto = new byte[tamanho];
      if (!ReadProcessMemory(h, (IntPtr)BitConverter.ToInt64(us, 8), texto, (IntPtr)tamanho, out lido)) return null;
      string pasta = Encoding.Unicode.GetString(texto);
      return pasta.Length > 3 ? pasta.TrimEnd('\\') : pasta;
    } catch { return null; } finally { CloseHandle(h); }
  }
}
'@

$anterior = @{}      # pid -> tempo de CPU acumulado (unidades de 100 ns)
$relogio = [Diagnostics.Stopwatch]::StartNew()
$ultimaVolta = 0.0

while ($true) {
  if ($Pai -gt 0 -and -not (Get-Process -Id $Pai)) { break }

  $agora = [DateTime]::UtcNow
  $volta = $relogio.Elapsed.TotalSeconds
  $decorrido = $volta - $ultimaVolta
  $ultimaVolta = $volta

  $processos = @{}
  $inicios = @{}
  $cpuAgora = @{}
  foreach ($p in (Get-CimInstance Win32_Process -Property ProcessId, Name, CommandLine, CreationDate, KernelModeTime, UserModeTime, WorkingSetSize)) {
    $id = [int]$p.ProcessId
    $processos[$id] = $p
    if ($p.CreationDate) { $inicios["$id"] = "$($p.CreationDate.ToFileTimeUtc())" }
    $cpuAgora[$id] = [double]$p.KernelModeTime + [double]$p.UserModeTime
  }

  $porPid = @{}
  foreach ($c in (Get-NetTCPConnection -State Listen)) {
    $id = [int]$c.OwningProcess
    if ($id -le 4) { continue }   # 0 e 4 são o próprio sistema
    if (-not $porPid.ContainsKey($id)) { $porPid[$id] = @{ portas = @{}; soLocal = $true } }
    $porPid[$id].portas[[int]$c.LocalPort] = $true
    if ($c.LocalAddress -notin @('127.0.0.1', '::1')) { $porPid[$id].soLocal = $false }
  }

  $escutando = @()
  foreach ($id in $porPid.Keys) {
    $p = $processos[$id]
    if (-not $p) { continue }
    $cpu = $null
    if ($anterior.ContainsKey($id) -and $decorrido -gt 0.5) {
      $cpu = [Math]::Round((($cpuAgora[$id] - $anterior[$id]) / 1e7) / $decorrido * 100, 1)
      if ($cpu -lt 0) { $cpu = $null }
    }
    $ligado = $null
    if ($p.CreationDate) { $ligado = [int]($agora - $p.CreationDate.ToUniversalTime()).TotalSeconds }
    $escutando += @{
      pid = $id
      comando = ($p.Name -replace '\.exe$', '')
      args = [string]$p.CommandLine
      pasta = [EstacaoCwd]::Ler($id)
      portas = @($porPid[$id].portas.Keys | Sort-Object)
      soLocal = $porPid[$id].soLocal
      cpu = $cpu
      memoriaMB = [int]([double]$p.WorkingSetSize / 1MB)
      ligadoHaS = $ligado
    }
  }
  $anterior = $cpuAgora

  # GPU: soma dos motores 3D de todos os processos (o mesmo número do Gerenciador de Tarefas)
  $gpu = $null
  $motores = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Property Name, UtilizationPercentage
  if ($motores) {
    $soma = 0
    foreach ($m in $motores) { if ($m.Name -like '*engtype_3D*') { $soma += [double]$m.UtilizationPercentage } }
    $gpu = [int][Math]::Min(100, [Math]::Round($soma))
  }

  $linha = @{ inicios = $inicios; escutando = $escutando; gpu = $gpu } | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.WriteLine($linha)
  [Console]::Out.Flush()
  Start-Sleep -Seconds $Intervalo
}
