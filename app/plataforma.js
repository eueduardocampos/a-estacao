// O que muda entre macOS e Windows, num lugar só: onde o app desktop do Claude
// guarda os arquivos, como abrir um endereço claude:// ou codex://, e a sonda
// que no Windows faz o papel do ps, do lsof e do ioreg (sonda-windows.ps1).

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WINDOWS = process.platform === 'win32';
const PASTA_APP = path.dirname(fileURLToPath(import.meta.url));

// Pasta de dados do app desktop do Claude. No Windows a versão da loja (MSIX) grava
// dentro do pacote; a pasta comum (%APPDATA%\Claude) vale quando existe.
function pastaDoDesktop() {
  if (!WINDOWS) return path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const comum = path.join(roaming, 'Claude');
  if (fs.existsSync(comum)) return comum;
  const pacotes = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Packages');
  try {
    for (const nome of fs.readdirSync(pacotes)) {
      if (!/^Claude_/i.test(nome)) continue;
      const p = path.join(pacotes, nome, 'LocalCache', 'Roaming', 'Claude');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* sem pasta de pacotes */ }
  return comum;
}
export const PASTA_DESKTOP = pastaDoDesktop();

// Abre um endereço no app dono do protocolo, sem shell
export function abrirUrl(url, pronto) {
  if (WINDOWS) {
    const rundll = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe');
    return execFile(rundll, ['url.dll,FileProtocolHandler', url], { timeout: 5000, windowsHide: true }, pronto);
  }
  return execFile('/usr/bin/open', [url], { timeout: 5000 }, pronto);
}

// ---------------------------------------------------------------------------
// Sonda do Windows: um PowerShell ligado enquanto o servidor vive, escrevendo uma
// linha de JSON a cada 5 s. Ligada na primeira chamada; se cair, volta em 10 s.
// ---------------------------------------------------------------------------
const INTERVALO_S = 5;
let ultima = { quando: 0, inicios: new Map(), escutando: [], gpu: null };
let processo = null;
let religarEm = 0;
const aoChegar = new Set();

function ligarSonda() {
  if (!WINDOWS || processo || Date.now() < religarEm) return;
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    processo = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(PASTA_APP, 'sonda-windows.ps1'),
      '-Intervalo', String(INTERVALO_S), '-Pai', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { console.error('[sonda]', e?.message || e); religarEm = Date.now() + 10000; return; }
  const meu = processo;
  let resto = '';
  meu.stdout.setEncoding('utf8');
  meu.stdout.on('data', pedaco => {
    resto += pedaco;
    let fim;
    while ((fim = resto.indexOf('\n')) >= 0) {
      const linha = resto.slice(0, fim).trim();
      resto = resto.slice(fim + 1);
      if (!linha.startsWith('{')) continue;
      try {
        const d = JSON.parse(linha);
        ultima = {
          quando: Date.now(),
          inicios: new Map(Object.entries(d.inicios || {}).map(([pid, t]) => [Number(pid), String(t)])),
          escutando: [].concat(d.escutando || []).map(p => ({ ...p, portas: [].concat(p.portas ?? []) })),
          gpu: d.gpu ?? null,
        };
        for (const f of aoChegar) { try { f(ultima); } catch { /* quem ouve cuida do próprio erro */ } }
      } catch { /* linha partida */ }
    }
  });
  const caiu = () => { if (processo === meu) { processo = null; religarEm = Date.now() + 10000; } };
  meu.on('error', caiu);
  meu.on('exit', caiu);
  meu.unref();
  meu.stdout.unref?.();
}
process.on('exit', () => { try { processo?.kill(); } catch { /* já saiu */ } });

// Última leitura da sonda (vazia até a primeira linha chegar, uns 2 s depois de ligar)
export function sonda() {
  ligarSonda();
  return ultima;
}
export function aoLerSonda(f) { aoChegar.add(f); }
