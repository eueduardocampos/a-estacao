// Fonte da sala dos servidores: o que está ligado nesta máquina, mantendo algo
// de pé (processos escutando numa porta TCP), e quanto a máquina está usando de
// CPU, GPU, memória e disco. Só leitura, com comandos do próprio macOS
// (lsof, ps, ioreg, vm_stat, df), chamados por execFile, sem shell.

import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const PASTA_APP = path.dirname(new URL(import.meta.url).pathname);
const CACHE_MS = 5000;

function rodar(cmd, args, timeout = 4000) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (erro, saida) => resolve(erro ? '' : String(saida)));
  });
}

// ---------------------------------------------------------------------------
// Servidores: lsof -F (campos p=pid, c=comando, n=endereço)
// ---------------------------------------------------------------------------
async function escutando() {
  const saida = await rodar('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']);
  const porPid = new Map();
  let atual = null;
  for (const l of saida.split('\n')) {
    const tipo = l[0], valor = l.slice(1);
    if (tipo === 'p') { atual = porPid.get(+valor) || { pid: +valor, comando: '', portas: new Set(), soLocal: true }; porPid.set(+valor, atual); }
    else if (tipo === 'c' && atual) atual.comando = valor;
    else if (tipo === 'n' && atual) {
      const m = valor.match(/:(\d+)$/);
      if (m) atual.portas.add(+m[1]);
      if (!/^(127\.0\.0\.1|\[::1\]|localhost)/.test(valor)) atual.soLocal = false;
    }
  }
  return [...porPid.values()];
}

async function detalhes(pids) {
  if (!pids.length) return new Map();
  const saida = await rodar('ps', ['-o', 'pid=,%cpu=,rss=,etime=,args=', '-p', pids.join(',')]);
  const mapa = new Map();
  for (const l of saida.split('\n')) {
    const m = l.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (m) mapa.set(+m[1], { cpu: +m[2], memoriaMB: Math.round(+m[3] / 1024), ligadoHa: m[4], args: m[5] });
  }
  const cwds = await rodar('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids.join(',')]);
  let pid = null;
  for (const l of cwds.split('\n')) {
    if (l[0] === 'p') pid = +l.slice(1);
    else if (l[0] === 'n' && pid && mapa.has(pid)) mapa.get(pid).pasta = l.slice(1);
  }
  return mapa;
}

// "1-02:03:04" | "02:03:04" | "03:04" -> segundos
function segundosDe(etime = '') {
  const [dias, resto] = etime.includes('-') ? etime.split('-') : ['0', etime];
  const p = resto.split(':').map(Number);
  while (p.length < 3) p.unshift(0);
  return (+dias) * 86400 + p[0] * 3600 + p[1] * 60 + p[2];
}

function nomeDoProjeto(pasta = '') {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pasta, 'package.json'), 'utf8'));
    if (pkg.name) return pkg.name;
  } catch { /* sem package.json */ }
  return path.basename(pasta);
}

// Dá nome e categoria: 'estacao' (esta ferramenta), 'projeto' (seu, rodando de
// uma pasta sua), 'app' (aplicativo do Mac ou do sistema)
function classificar(p, d, portaPropria) {
  const args = d?.args || p.comando;
  const pasta = d?.pasta || '';
  const home = os.homedir();
  const daEstacao = pasta === PASTA_APP || pasta.startsWith(PASTA_APP + path.sep);
  if (daEstacao) {
    const portas = [...p.portas];
    const oficial = portas.includes(4317);
    const essa = portas.includes(portaPropria);
    return { categoria: 'estacao', nome: oficial ? 'A Estação (oficial)' : essa ? 'A Estação (esta janela)' : 'A Estação (teste)' };
  }
  if (/claude-science/.test(args)) return { categoria: 'projeto', nome: 'Claude Science' };
  // rodando de uma pasta sua vale mais que o executável (ex.: Python de dentro do Xcode)
  if (pasta.startsWith(home + path.sep)) {
    const conhecido = { 'ai-usage': 'Consumo de IA', 'claude-usage': 'Consumo de IA' }[path.basename(pasta)];
    const nome = nomeDoProjeto(pasta);
    const generico = nome === path.basename(pasta);
    return { categoria: 'projeto', nome: conhecido || (generico ? `${path.basename(path.dirname(pasta))} · ${nome}` : nome), detalhe: path.relative(home, pasta) };
  }
  if (/\/Applications\/|\/System\/|\/Library\/|\/usr\/libexec\//.test(args) || pasta === '/') {
    const app = args.match(/\/([^/]+)\.app\//);
    return { categoria: 'app', nome: app ? app[1] : p.comando };
  }
  return { categoria: 'app', nome: p.comando };
}

// ---------------------------------------------------------------------------
// Máquina: CPU (média do último minuto e pico), GPU (ioreg), memória (vm_stat), disco (df)
// ---------------------------------------------------------------------------
// CPU: amostra os tempos acumulados de todos os núcleos a cada 5 s, em segundo plano,
// e guarda 75 s. O anel mostra a MÉDIA do último minuto da máquina inteira (100% = os
// 10 núcleos ocupados); o pico é o maior trecho de 5 s nesse minuto (pedido do Eduardo,
// 03/10: um pico de segundos aparecia como "100%" e assustava).
const amostrasCpu = [];
function amostrarCpu() {
  let ocupado = 0, total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    const soma = t.user + t.nice + t.sys + t.idle + t.irq;
    total += soma;
    ocupado += soma - t.idle;
  }
  amostrasCpu.push({ quando: Date.now(), ocupado, total });
  while (amostrasCpu.length && Date.now() - amostrasCpu[0].quando > 75000) amostrasCpu.shift();
}
amostrarCpu();
setInterval(amostrarCpu, 5000).unref();
const pct = (a, b) => (b.total > a.total ? Math.round(((b.ocupado - a.ocupado) / (b.total - a.total)) * 100) : null);
function usoCpu() {
  amostrarCpu();
  const fim = amostrasCpu[amostrasCpu.length - 1];
  const inicio = amostrasCpu.find(a => fim.quando - a.quando <= 61000) || amostrasCpu[0];
  if (!inicio || inicio === fim) return { media: null, pico: null };
  let pico = null;
  for (let i = amostrasCpu.indexOf(inicio) + 1; i < amostrasCpu.length; i++) {
    if (amostrasCpu[i].quando - amostrasCpu[i - 1].quando < 2000) continue;   // trecho curto demais
    const v = pct(amostrasCpu[i - 1], amostrasCpu[i]);
    if (v != null && (pico == null || v > pico)) pico = v;
  }
  return { media: pct(inicio, fim), pico };
}

async function usoGpu() {
  const saida = await rodar('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']);
  const m = saida.match(/"Device Utilization %"=(\d+)/);
  return m ? +m[1] : null;
}

async function usoMemoria() {
  const saida = await rodar('vm_stat', []);
  const pagina = +(saida.match(/page size of (\d+)/)?.[1] || 16384);
  const v = nome => +(saida.match(new RegExp(`${nome}:\\s+(\\d+)`))?.[1] || 0);
  const usado = (v('Pages active') + v('Pages wired down') + v('Pages occupied by compressor')) * pagina;
  const total = os.totalmem();
  return { pct: Math.round((usado / total) * 100), usadoGB: +(usado / 2 ** 30).toFixed(1), totalGB: Math.round(total / 2 ** 30) };
}

async function usoDisco() {
  // no macOS os dados ficam no volume Data; "/" é o volume do sistema, só leitura
  for (const alvo of ['/System/Volumes/Data', '/']) {
    const saida = await rodar('df', ['-k', alvo]);
    const l = saida.trim().split('\n')[1];
    if (!l) continue;
    const c = l.split(/\s+/);
    const total = +c[1] * 1024, livre = +c[3] * 1024;
    if (!total) continue;
    return { pct: Math.round(((total - livre) / total) * 100), livreGB: Math.round(livre / 1e9), totalGB: Math.round(total / 1e9) };
  }
  return null;
}

// ---------------------------------------------------------------------------
let cache = { quando: 0, dados: null, pendente: null };

export async function salaDosServidores(portaPropria) {
  const agora = Date.now();
  if (cache.dados && agora - cache.quando < CACHE_MS) return cache.dados;
  if (cache.pendente) return cache.pendente;
  cache.pendente = (async () => {
    const lista = await escutando();
    const det = await detalhes(lista.map(p => p.pid));
    const servidores = lista.map(p => {
      const d = det.get(p.pid);
      const c = classificar(p, d, portaPropria);
      return {
        pid: p.pid, ...c, portas: [...p.portas].sort((a, b) => a - b), soLocal: p.soLocal,
        cpu: d?.cpu ?? null, memoriaMB: d?.memoriaMB ?? null, ligadoHaS: segundosDe(d?.ligadoHa),
      };
    }).sort((a, b) => ({ estacao: 0, projeto: 1, app: 2 }[a.categoria] - { estacao: 0, projeto: 1, app: 2 }[b.categoria]) || a.portas[0] - b.portas[0]);
    const [gpu, memoria, disco] = await Promise.all([usoGpu(), usoMemoria(), usoDisco()]);
    const cpu = usoCpu();
    const dados = {
      geradoEm: Date.now(),
      maquina: { nome: os.hostname().replace(/\.local$/, ''), cpu: cpu.media, cpuPico: cpu.pico, gpu, memoria, disco, nucleos: os.cpus().length },
      servidores,
    };
    cache = { quando: Date.now(), dados, pendente: null };
    return dados;
  })().catch(e => { cache.pendente = null; throw e; });
  return cache.pendente;
}
