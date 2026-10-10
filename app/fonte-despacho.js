// Fonte do Despacho de tarefas agendadas: as rotinas programadas do Claude e do
// Codex, com quando rodam, a próxima e a última execução. Só leitura.
//
// Onde cada coisa mora (investigado em 03/10):
// - Claude (app desktop, aba Code):
//   · o texto da rotina fica em $CLAUDE_CONFIG_DIR/scheduled-tasks/<id>/SKILL.md
//     (frontmatter com name e description);
//   · o horário NÃO fica no SKILL.md: o app guarda em
//     ~/Library/Application Support/Claude/claude-code-sessions/<conta>/<org>/scheduled-tasks.json
//     ({ scheduledTasks: [{ id, cronExpression | fireAt, enabled, lastRunAt, title? }] }).
//     Cron em horário LOCAL da máquina; rotina sem cron e sem fireAt é "só na mão";
//   · cada execução vira uma sessão em .../claude-code-sessions/<conta>/<org>/local_*.json
//     com scheduledTaskId, createdAt (início), lastActivityAt e cliSessionId;
//   · "rodando agora": sessão viva em $CLAUDE_CONFIG_DIR/sessions/<pid>.json com
//     hostSessionId = local_... e status busy, waiting ou shell;
//   · "deu certo": a transcrição $CLAUDE_CONFIG_DIR/projects/*/<cliSessionId>.jsonl
//     não termina em mensagem de erro da API (isApiErrorMessage).
// - Codex (app desktop):
//   · $CODEX_HOME/automations/<id>/automation.toml (name, status ACTIVE/PAUSED, rrule
//     no formato iCalendar, kind cron/heartbeat, created_at em ms);
//   · $CODEX_HOME/sqlite/codex-dev.db: tabelas automations (next_run_at, last_run_at)
//     e automation_runs (uma linha por execução, com status). Lido de uma CÓPIA em
//     pasta temporária (o banco está em modo WAL; abrir o original mexeria no -shm).
//
// Horários sempre em horário de Brasília (America/Sao_Paulo). Sem dependências.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { PASTA_DESKTOP } from './plataforma.js';

const CLAUDE = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
const CODEX = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), '.codex');
const APP_CLAUDE = path.join(PASTA_DESKTOP, 'claude-code-sessions');
export const FUSO = 'America/Sao_Paulo';
const CACHE_MS = 10_000;

// ---------------------------------------------------------------------------
// Relógio de Brasília: campos de parede e conversão de volta para instante
// ---------------------------------------------------------------------------
const fmtParede = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function parede(ms) {
  const p = {};
  for (const { type, value } of fmtParede.formatToParts(new Date(ms))) p[type] = value;
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour % 24, min: +p.minute, seg: +p.second };
}
// "pseudo": o horário de parede escrito como se fosse UTC (para fazer conta de calendário)
function pseudoDe(ms) { const p = parede(ms); return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.min, p.seg); }
function deslocamento(ms) { return pseudoDe(ms) - Math.floor(ms / 1000) * 1000; }
function msDePseudo(pseudo) {
  let ms = pseudo - deslocamento(pseudo);
  ms = pseudo - deslocamento(ms);
  return ms;
}

// ---------------------------------------------------------------------------
// Textos em português (sem travessão)
// ---------------------------------------------------------------------------
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const dois = n => String(n).padStart(2, '0');
const hhmm = p => `${dois(p.hora)}:${dois(p.min)}`;
const horario = (h, m) => (m ? `${h}h${dois(m)}` : `${h}h`);
function listaPt(itens) {
  if (itens.length <= 1) return itens.join('');
  return itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1];
}
export function semTravessao(texto) {
  return String(texto ?? '').replace(/\s*[\u2014\u2013]\s*/g, ' · ').replace(/\s+/g, ' ').trim();
}
function diaDoPseudo(pseudo) { return Math.floor(pseudo / 86_400_000); }

export function textoFuturo(ms, agora = Date.now()) {
  if (ms == null) return null;
  const dif = ms - agora;
  if (dif < 60_000) return 'agora';
  const min = Math.round(dif / 60_000);
  if (min < 60) return `em ${min} min`;
  if (dif < 12 * 3_600_000) {
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `em ${h} h ${m} min` : `em ${h} h`;
  }
  const p = parede(ms), dias = diaDoPseudo(pseudoDe(ms)) - diaDoPseudo(pseudoDe(agora));
  if (dias === 0) return `hoje ${hhmm(p)}`;
  if (dias === 1) return `amanhã ${hhmm(p)}`;
  if (dias < 7) return `${DIAS_CURTOS[new Date(pseudoDe(ms)).getUTCDay()]} ${hhmm(p)}`;
  return `${dois(p.dia)}/${dois(p.mes)} ${hhmm(p)}`;
}
export function textoPassado(ms, agora = Date.now()) {
  if (ms == null) return null;
  const dif = agora - ms;
  if (dif < 60_000) return 'agora há pouco';
  if (dif < 3_600_000) return `há ${Math.round(dif / 60_000)} min`;
  const p = parede(ms), dias = diaDoPseudo(pseudoDe(agora)) - diaDoPseudo(pseudoDe(ms));
  if (dias === 0) return `hoje ${hhmm(p)}`;
  if (dias === 1) return `ontem ${hhmm(p)}`;
  if (dias < 7) return `${DIAS_CURTOS[new Date(pseudoDe(ms)).getUTCDay()]} ${hhmm(p)}`;
  return `${dois(p.dia)}/${dois(p.mes)} ${hhmm(p)}`;
}

// ---------------------------------------------------------------------------
// Cron de 5 campos (minuto hora dia-do-mês mês dia-da-semana), em horário local
// ---------------------------------------------------------------------------
const NOMES_MES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const NOMES_SEM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function lerCampo(txt, min, max, nomes) {
  const valor = v => {
    const k = String(v).toLowerCase();
    if (nomes && k in nomes) return nomes[k];
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error(`valor inválido: ${v}`);
    return n;
  };
  const conjunto = new Set();
  for (const parte of String(txt).split(',')) {
    const [faixa, passoTxt] = parte.split('/');
    const passo = passoTxt == null ? 1 : Number(passoTxt);
    if (!Number.isInteger(passo) || passo < 1) throw new Error(`passo inválido: ${parte}`);
    let a, b;
    if (faixa === '*' || faixa === '?') { a = min; b = max; }
    else if (faixa.includes('-')) { const [x, y] = faixa.split('-'); a = valor(x); b = valor(y); }
    else { a = valor(faixa); b = passoTxt == null ? a : max; }
    for (let v = a; v <= b; v += passo) conjunto.add(v);
  }
  return conjunto;
}

export function lerCron(expr) {
  const campos = String(expr || '').trim().split(/\s+/);
  if (campos.length !== 5) throw new Error('cron precisa de 5 campos');
  const sem = lerCampo(campos[4], 0, 7, NOMES_SEM);
  if (sem.has(7)) { sem.delete(7); sem.add(0); }
  return {
    min: lerCampo(campos[0], 0, 59), hora: lerCampo(campos[1], 0, 23),
    dia: lerCampo(campos[2], 1, 31), mes: lerCampo(campos[3], 1, 12, NOMES_MES), sem,
    minLivre: campos[0] === '*', horaLivre: campos[1] === '*',
    diaLivre: campos[2] === '*' || campos[2] === '?', mesLivre: campos[3] === '*', semLivre: campos[4] === '*' || campos[4] === '?',
    campos,
  };
}

function diaCronOk(c, d) {
  const okDia = c.dia.has(d.getUTCDate()), okSem = c.sem.has(d.getUTCDay());
  if (c.diaLivre && c.semLivre) return true;
  if (c.diaLivre) return okSem;
  if (c.semLivre) return okDia;
  return okDia || okSem;   // os dois restritos: vale um ou outro (como o cron clássico)
}

export function proximaCron(c, depois = Date.now()) {
  let t = Math.floor(pseudoDe(depois) / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < 300_000; i++) {
    const d = new Date(t);
    const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), h = d.getUTCHours();
    if (!c.mes.has(M + 1)) { t = Date.UTC(Y, M + 1, 1); continue; }
    if (!diaCronOk(c, d)) { t = Date.UTC(Y, M, D + 1); continue; }
    if (!c.hora.has(h)) { t = Date.UTC(Y, M, D, h + 1); continue; }
    if (!c.min.has(d.getUTCMinutes())) { t += 60_000; continue; }
    return msDePseudo(t);
  }
  return null;
}

function ordenado(s) { return [...s].sort((a, b) => a - b); }
function contigua(v) { return v.length >= 3 && v.every((x, i) => i === 0 || x === v[i - 1] + 1); }
function passoUniforme(v, de, total) {
  if (v.length < 2 || v[0] !== de) return null;
  const p = v[1] - v[0];
  if (!v.every((x, i) => x === de + i * p)) return null;
  return v[v.length - 1] + p >= total ? p : null;
}

function descreverDiasSemana(sem) {
  const v = ordenado(sem);
  if (v.length === 7) return 'todo dia';
  if (v.join() === '1,2,3,4,5') return 'dias úteis';
  if (v.join() === '0,6') return 'fins de semana';
  const seq = v.includes(0) ? [...v.filter(x => x), 0] : v;   // segunda primeiro, domingo no fim
  return listaPt(seq.map(x => DIAS_PLURAL[x]));
}

function descreverHoras(minutos, horas, horaLivre) {
  if (minutos.length === 60 && horaLivre) return 'a cada minuto';
  const passoMin = passoUniforme(minutos, 0, 60);
  if (passoMin && passoMin > 1 && horaLivre) return `a cada ${passoMin} min`;
  if (minutos.length === 1) {
    const m = minutos[0];
    if (horaLivre) return m ? `de hora em hora, aos ${m} min` : 'de hora em hora';
    const passoH = passoUniforme(horas, horas[0], 24);
    if (passoH && passoH > 1 && horas[0] === 0) return `a cada ${passoH} h${m ? `, aos ${m} min` : ''}`;
    if (contigua(horas)) return `de hora em hora${m ? ` (aos ${m} min)` : ''}, das ${horario(horas[0], m)} às ${horario(horas[horas.length - 1], m)}`;
    if (horas.length <= 6) return 'às ' + listaPt(horas.map(h => horario(h, m)));
  }
  if (horas.length === 1 && minutos.length <= 4) return 'às ' + listaPt(minutos.map(m => horario(horas[0], m)));
  return null;
}

function juntar(dias, tempo) {
  if (!tempo) return null;
  if (tempo.startsWith('às ')) return `${dias} ${tempo}`;
  return dias === 'todo dia' ? tempo : `${dias}, ${tempo}`;
}

export function descreverCron(expr) {
  let c;
  try { c = lerCron(expr); } catch { return `cron ${expr}`; }
  let dias;
  if (c.diaLivre) dias = descreverDiasSemana(c.semLivre ? new Set([0, 1, 2, 3, 4, 5, 6]) : c.sem);
  else if (c.semLivre) {
    const v = ordenado(c.dia);
    dias = v.length === 1 ? `todo dia ${v[0]}` : `dias ${listaPt(v.map(String))}`;
  } else dias = null;
  const tempo = descreverHoras(ordenado(c.min), ordenado(c.hora), c.horaLivre);
  let texto = dias && juntar(dias, tempo);
  if (!texto) return `cron ${expr}`;
  if (!c.mesLivre) texto += ` (só em ${listaPt(ordenado(c.mes).map(m => MESES[m - 1]))})`;
  return texto;
}

// ---------------------------------------------------------------------------
// RRULE (iCalendar), o formato das automações do Codex
// ---------------------------------------------------------------------------
const SEM_RRULE = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function lerDataIcal(txt) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(txt).trim());
  if (!m) return null;
  const [, Y, Mo, D, h = '0', mi = '0', s = '0', z] = m;
  const pseudo = Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +s);
  return z ? pseudo : msDePseudo(pseudo);
}

export function lerRrule(texto, criadoEm = Date.now()) {
  let inicio = null;
  const regras = {};
  for (const linha of String(texto || '').split(/\r?\n/)) {
    const l = linha.trim();
    if (!l) continue;
    if (/^DTSTART/i.test(l)) { inicio = lerDataIcal(l.split(':').pop()); continue; }
    for (const par of l.replace(/^RRULE:/i, '').split(';')) {
      const [k, v] = par.split('=');
      if (k && v != null) regras[k.trim().toUpperCase()] = v.trim();
    }
  }
  const freq = (regras.FREQ || '').toUpperCase();
  if (!['MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'].includes(freq)) throw new Error(`FREQ não suportada: ${freq || 'vazia'}`);
  const ancora = new Date(Math.floor(pseudoDe(inicio ?? criadoEm) / 60_000) * 60_000);
  const nums = v => (v == null ? null : new Set(v.split(',').map(Number).filter(Number.isFinite)));
  const r = {
    freq, intervalo: Math.max(1, Number(regras.INTERVAL) || 1), ancora: ancora.getTime(),
    min: nums(regras.BYMINUTE), hora: nums(regras.BYHOUR), mesDia: nums(regras.BYMONTHDAY), mes: nums(regras.BYMONTH),
    sem: regras.BYDAY ? new Set(regras.BYDAY.split(',').map(d => SEM_RRULE[d.trim().slice(-2).toUpperCase()]).filter(x => x != null)) : null,
    ate: regras.UNTIL ? lerDataIcal(regras.UNTIL) : null,
  };
  // padrões do iCalendar: o que não vem na regra herda da âncora
  if (!r.min && freq !== 'MINUTELY') r.min = new Set([ancora.getUTCMinutes()]);
  if (!r.hora && ['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq)) r.hora = new Set([ancora.getUTCHours()]);
  if (!r.sem && freq === 'WEEKLY') r.sem = new Set([ancora.getUTCDay()]);
  if (!r.mesDia && !r.sem && freq === 'MONTHLY') r.mesDia = new Set([ancora.getUTCDate()]);
  return r;
}

const SEMANA_MS = 7 * 86_400_000;
function inicioSemana(t) { const d = new Date(t); const dow = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow); }

export function proximaRrule(r, depois = Date.now()) {
  let t = Math.max(Math.floor(pseudoDe(depois) / 60_000) * 60_000 + 60_000, r.ancora);
  const A = new Date(r.ancora), I = r.intervalo;
  const diaA = diaDoPseudo(r.ancora);
  for (let i = 0; i < 300_000; i++) {
    const d = new Date(t);
    const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), h = d.getUTCHours();
    const proxDia = () => { t = Date.UTC(Y, M, D + 1); };
    if (r.mes && !r.mes.has(M + 1)) { t = Date.UTC(Y, M + 1, 1); continue; }
    if (r.freq === 'MONTHLY' && ((Y - A.getUTCFullYear()) * 12 + M - A.getUTCMonth()) % I) { t = Date.UTC(Y, M + 1, 1); continue; }
    if (r.freq === 'WEEKLY' && Math.round((inicioSemana(t) - inicioSemana(r.ancora)) / SEMANA_MS) % I) { proxDia(); continue; }
    if (r.freq === 'DAILY' && (diaDoPseudo(t) - diaA) % I) { proxDia(); continue; }
    if (r.sem && !r.sem.has(d.getUTCDay())) { proxDia(); continue; }
    if (r.mesDia && !r.mesDia.has(D)) { proxDia(); continue; }
    if (r.hora && !r.hora.has(h)) { t = Date.UTC(Y, M, D, h + 1); continue; }
    // conta horas cheias desde a hora da âncora
    if (r.freq === 'HOURLY' && (Math.floor(t / 3_600_000) - Math.floor(r.ancora / 3_600_000)) % I) { t = Date.UTC(Y, M, D, h + 1); continue; }
    if (r.min && !r.min.has(d.getUTCMinutes())) { t += 60_000; continue; }
    if (r.freq === 'MINUTELY' && Math.round((t - r.ancora) / 60_000) % I) { t += 60_000; continue; }
    const ms = msDePseudo(t);
    return r.ate != null && ms > r.ate ? null : ms;
  }
  return null;
}

export function descreverRrule(texto, criadoEm) {
  let r;
  try { r = lerRrule(texto, criadoEm); } catch { return `regra ${texto}`; }
  const I = r.intervalo, A = new Date(r.ancora);
  const minutos = r.min ? ordenado(r.min) : null;
  const m0 = minutos?.length === 1 ? minutos[0] : 0;
  if (r.freq === 'MINUTELY') return I === 1 ? 'a cada minuto' : `a cada ${I} min`;
  if (r.freq === 'HOURLY') {
    if (I % 24 === 0) {
      const h = (A.getUTCHours()) % 24;
      return I === 24 ? `todo dia às ${horario(h, m0)}` : `a cada ${I / 24} dias às ${horario(h, m0)}`;
    }
    if (I === 1) {
      if (r.hora) return descreverHoras(minutos, ordenado(r.hora), false) || 'de hora em hora';
      return m0 ? `de hora em hora, aos ${m0} min` : 'de hora em hora';
    }
    return `a cada ${I} h${m0 ? `, aos ${m0} min` : ''}`;
  }
  const tempo = descreverHoras(minutos, ordenado(r.hora), false);
  let dias;
  if (r.freq === 'DAILY') dias = r.sem ? descreverDiasSemana(r.sem) : I === 1 ? 'todo dia' : `a cada ${I} dias`;
  else if (r.freq === 'WEEKLY') dias = (I > 1 ? `a cada ${I} semanas, ` : '') + descreverDiasSemana(r.sem);
  else {
    const v = r.mesDia ? ordenado(r.mesDia) : [];
    dias = r.sem ? `${descreverDiasSemana(r.sem)} do mês` : v.length === 1 ? `todo dia ${v[0]} do mês` : `dias ${listaPt(v.map(String))} do mês`;
    if (I > 1) dias = `a cada ${I} meses, ${dias}`;
  }
  return juntar(dias, tempo) || `regra ${texto}`;
}

// ---------------------------------------------------------------------------
// Leituras auxiliares
// ---------------------------------------------------------------------------
function lerJson(arquivo) { try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return null; } }
function listar(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } }

function frontmatter(texto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto || '');
  const campos = {};
  if (!m) return campos;
  for (const linha of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(linha);
    if (k) campos[k[1]] = k[2].replace(/^["']|["']$/g, '').trim();
  }
  return campos;
}

// "rotina-checagem-mencoes" vira "Rotina checagem mencoes" (como o app mostra)
function nomeDoId(id) {
  const t = String(id).replace(/[-_]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// TOML mínimo: chave = valor (strings básicas e literais, multilinha, números,
// booleanos e listas simples). Tabelas [x] viram prefixo "x.".
export function lerToml(texto) {
  const saida = {};
  let prefixo = '', i = 0;
  const s = String(texto || '');
  const pularEspaco = () => { while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++; };
  const pularLinha = () => { while (i < s.length && s[i] !== '\n') i++; i++; };
  function lerString() {
    if (s.startsWith('"""', i) || s.startsWith("'''", i)) {
      const q = s.slice(i, i + 3); i += 3;
      if (s[i] === '\n') i++;
      const fim = s.indexOf(q, i);
      const bruto = s.slice(i, fim < 0 ? s.length : fim);
      i = fim < 0 ? s.length : fim + 3;
      return q === '"""' ? escapes(bruto.replace(/\\\r?\n\s*/g, '')) : bruto;
    }
    const q = s[i++];
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (q === '"' && s[i] === '\\') { out += s.slice(i, i + 2); i += 2; continue; }
      out += s[i++];
    }
    i++;
    return q === '"' ? escapes(out) : out;
  }
  function escapes(t) {
    return t.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, e) => {
      if (e[0] === 'u' || e[0] === 'U') return String.fromCodePoint(parseInt(e.slice(1), 16));
      return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\' }[e] ?? e;
    });
  }
  function lerValor() {
    pularEspaco();
    const c = s[i];
    if (c === '"' || c === "'") return lerString();
    if (c === '[') {
      i++;
      const lista = [];
      for (;;) {
        while (i < s.length && /[\s,]/.test(s[i])) i++;
        if (s[i] === '#') { pularLinha(); continue; }
        if (s[i] === ']' || i >= s.length) { i++; break; }
        lista.push(lerValor());
      }
      return lista;
    }
    let j = i;
    while (j < s.length && !/[\n,\]#]/.test(s[j])) j++;
    const bruto = s.slice(i, j).trim();
    i = j;
    if (bruto === 'true') return true;
    if (bruto === 'false') return false;
    const n = Number(bruto.replace(/_/g, ''));
    return Number.isFinite(n) && bruto !== '' ? n : bruto;
  }
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '#') { pularLinha(); continue; }
    if (s[i] === '[') {
      const fim = s.indexOf(']', i);
      prefixo = s.slice(i, fim).replace(/^\[+/, '').trim() + '.';
      i = fim + 1; while (s[i] === ']') i++;
      continue;
    }
    const igual = s.indexOf('=', i);
    if (igual < 0) break;
    const chave = s.slice(i, igual).trim().replace(/^["']|["']$/g, '');
    i = igual + 1;
    saida[prefixo + chave] = lerValor();
    pularEspaco();
    if (s[i] === '#') pularLinha();
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Claude: rotinas, horários e execuções
// ---------------------------------------------------------------------------
const cacheSessoesApp = new Map();   // arquivo -> { mtime, dados|null }

function pastasDoApp() {
  // claude-code-sessions/<conta>/<org>/
  const saida = [];
  for (const conta of listar(APP_CLAUDE)) {
    if (!conta.isDirectory()) continue;
    for (const org of listar(path.join(APP_CLAUDE, conta.name))) if (org.isDirectory()) saida.push(path.join(APP_CLAUDE, conta.name, org.name));
  }
  return saida;
}

function execucoesDoApp(pastas) {
  const vistos = new Set(), saida = [];
  for (const pasta of pastas) {
    for (const e of listar(pasta)) {
      if (!e.isFile() || !/^local_.*\.json$/.test(e.name)) continue;
      const arq = path.join(pasta, e.name);
      vistos.add(arq);
      let st;
      try { st = fs.statSync(arq); } catch { continue; }
      let c = cacheSessoesApp.get(arq);
      if (!c || c.mtime !== st.mtimeMs) {
        let dados = null;
        try {
          const bruto = fs.readFileSync(arq, 'utf8');
          if (bruto.includes('"scheduledTaskId"')) {
            const j = JSON.parse(bruto);
            if (j.scheduledTaskId) {
              dados = {
                tarefa: j.scheduledTaskId, sessao: j.sessionId, cli: j.cliSessionId,
                inicio: Number(j.createdAt) || null, fim: Number(j.lastActivityAt) || null,
                turnos: Number(j.completedTurns) || 0, arquivada: !!j.isArchived,
              };
            }
          }
        } catch { dados = null; }
        c = { mtime: st.mtimeMs, dados };
        cacheSessoesApp.set(arq, c);
      }
      if (c.dados) saida.push(c.dados);
    }
  }
  for (const k of cacheSessoesApp.keys()) if (!vistos.has(k)) cacheSessoesApp.delete(k);
  return saida;
}

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// sessões abertas agora: hostSessionId (local_...) e sessionId -> status
function sessoesVivas() {
  const mapa = new Map();
  const dir = path.join(CLAUDE, 'sessions');
  for (const e of listar(dir)) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const j = lerJson(path.join(dir, e.name));
    if (!j?.pid || !vivo(j.pid)) continue;
    const info = { status: j.status || null, desde: j.statusUpdatedAt || j.updatedAt || j.startedAt || null };
    if (j.hostSessionId) mapa.set(j.hostSessionId, info);
    if (j.sessionId) mapa.set(j.sessionId, info);
  }
  return mapa;
}

const cacheTranscricao = new Map();   // cliSessionId -> { caminho, mtime, ok }
function transcricaoDeuCerto(cli) {
  if (!cli) return null;
  let c = cacheTranscricao.get(cli);
  let caminho = c?.caminho;
  if (!caminho || !fs.existsSync(caminho)) {
    caminho = null;
    const projetos = path.join(CLAUDE, 'projects');
    for (const d of listar(projetos)) {
      if (!d.isDirectory()) continue;
      const p = path.join(projetos, d.name, cli + '.jsonl');
      if (fs.existsSync(p)) { caminho = p; break; }
    }
    if (!caminho) return null;
  }
  let st;
  try { st = fs.statSync(caminho); } catch { return null; }
  if (c && c.caminho === caminho && c.mtime === st.mtimeMs) return c.ok;
  // lê só o fim: a última mensagem do assistente diz se terminou em erro da API
  let ok = true;
  try {
    const tam = Math.min(st.size, 256 * 1024);
    const buf = Buffer.alloc(tam);
    const fd = fs.openSync(caminho, 'r');
    try { fs.readSync(fd, buf, 0, tam, st.size - tam); } finally { fs.closeSync(fd); }
    const linhas = buf.toString('utf8').split('\n').reverse();
    for (const l of linhas) {
      if (!l.includes('"type":"assistant"')) continue;
      try {
        const j = JSON.parse(l);
        if (j.type !== 'assistant') continue;
        ok = !(j.isApiErrorMessage || j.error);
        break;
      } catch { /* linha cortada no começo do pedaço */ }
    }
  } catch { ok = null; }
  cacheTranscricao.set(cli, { caminho, mtime: st.mtimeMs, ok });
  return ok;
}

function rotinasClaude(agora, avisos) {
  const pastas = pastasDoApp();
  // horários: o registro mais recente de cada id (pode haver mais de uma conta/org)
  const config = new Map();
  for (const pasta of pastas) {
    const j = lerJson(path.join(pasta, 'scheduled-tasks.json'));
    for (const t of j?.scheduledTasks || []) {
      if (!t?.id) continue;
      const anterior = config.get(t.id);
      const marca = Date.parse(t.lastRunAt || '') || Number(t.createdAt) || 0;
      if (!anterior || marca >= anterior.marca) config.set(t.id, { ...t, marca });
    }
  }
  // textos das rotinas
  const textos = new Map();
  const dirTarefas = path.join(CLAUDE, 'scheduled-tasks');
  for (const e of listar(dirTarefas)) {
    if (!e.isDirectory()) continue;
    let fm = {};
    try { fm = frontmatter(fs.readFileSync(path.join(dirTarefas, e.name, 'SKILL.md'), 'utf8')); } catch { continue; }
    textos.set(e.name, fm);
  }
  if (!pastas.length) avisos.push('Claude: pasta do app desktop não encontrada; horários das rotinas indisponíveis');

  const execs = execucoesDoApp(pastas);
  const vivas = sessoesVivas();
  const ids = new Set([...textos.keys(), ...config.keys()]);
  const rotinas = [];
  for (const id of ids) {
    const cfg = config.get(id), fm = textos.get(id) || {};
    let tipoAgenda = 'manual', expressao = null, descricaoHorario = 'sem horário, dispara na mão', proxima = null, estado = 'manual';
    if (cfg?.cronExpression) {
      tipoAgenda = 'cron'; expressao = cfg.cronExpression;
      descricaoHorario = descreverCron(expressao);
      estado = cfg.enabled === false ? 'pausada' : 'ativa';
      if (estado === 'ativa') { try { proxima = proximaCron(lerCron(expressao), agora); } catch (e) { avisos.push(`Claude ${id}: cron inválido (${e.message})`); } }
    } else if (cfg?.fireAt) {
      tipoAgenda = 'uma-vez'; expressao = cfg.fireAt;
      const quando = Date.parse(cfg.fireAt);
      const p = Number.isFinite(quando) ? parede(quando) : null;
      descricaoHorario = p ? `uma vez, ${dois(p.dia)}/${dois(p.mes)} às ${horario(p.hora, p.min)}` : 'uma vez';
      estado = cfg.enabled === false ? (quando <= agora ? 'concluida' : 'pausada') : 'ativa';
      if (estado === 'ativa' && quando > agora) proxima = quando;
    }
    const minhas = execs.filter(x => x.tarefa === id).sort((a, b) => (b.inicio || 0) - (a.inicio || 0));
    const historico = minhas.slice(0, 5).map(x => {
      const viva = vivas.get(x.sessao) || vivas.get(x.cli);
      const rodando = !!viva && ['busy', 'waiting', 'shell'].includes(viva.status);
      return {
        quando: x.inicio ? new Date(x.inicio).toISOString() : null, ms: x.inicio,
        duracaoMin: x.inicio && x.fim ? Math.max(0, Math.round((x.fim - x.inicio) / 60_000)) : null,
        rodando, ok: rodando ? null : (transcricaoDeuCerto(x.cli) ?? (x.turnos > 0 ? true : null)),
      };
    });
    // a última execução: a do histórico, ou só a data do registro do app
    let ultima = historico[0] || null;
    const doRegistro = Date.parse(cfg?.lastRunAt || '');
    if (Number.isFinite(doRegistro) && (!ultima || doRegistro > (ultima.ms || 0) + 60_000)) {
      ultima = { quando: new Date(doRegistro).toISOString(), ms: doRegistro, duracaoMin: null, rodando: false, ok: null };
    }
    rotinas.push({
      id: 'claude:' + id, chave: id, agencia: 'claude',
      nome: semTravessao(cfg?.title || nomeDoId(id)),
      descricao: semTravessao(fm.description || ''),
      tipoAgenda, expressao, descricaoHorario, estado, ativa: estado === 'ativa',
      proxima, ultima, rodandoAgora: historico.some(h => h.rodando),
      execucoes: minhas.length, historico,
    });
  }
  return rotinas;
}

// ---------------------------------------------------------------------------
// Codex: automações (TOML) + banco do app (próxima, última e execuções)
// ---------------------------------------------------------------------------
let pastaCopia = null;
const marcaCopia = { chave: null, linhas: null };

// sqlite3 de linha de comando (vem no macOS); sem ele (Windows), o SQLite que vem
// dentro do Node 22.5 ou mais novo. `banco` é sempre a cópia temporária.
async function sqliteJson(banco, sql) {
  const peloComando = await new Promise(resolve => {
    execFile('sqlite3', ['-json', banco, sql], { timeout: 4000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (erro, saida) => {
      if (erro) return resolve(null);
      try { resolve(saida.trim() ? JSON.parse(saida) : []); } catch { resolve(null); }
    });
  });
  if (peloComando) return peloComando;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(banco);
    try { return db.prepare(sql).all(); } finally { db.close(); }
  } catch { return null; }
}

async function bancoCodex(avisos) {
  const banco = path.join(CODEX, 'sqlite', 'codex-dev.db');
  let stDb, stWal = null;
  try { stDb = fs.statSync(banco); } catch { return null; }
  try { stWal = fs.statSync(banco + '-wal'); } catch { /* sem WAL */ }
  const chave = [stDb.mtimeMs, stDb.size, stWal?.mtimeMs, stWal?.size].join('|');
  if (chave === marcaCopia.chave) return marcaCopia.linhas;
  try {
    if (!pastaCopia) {
      pastaCopia = fs.mkdtempSync(path.join(os.tmpdir(), 'a-estacao-despacho-'));
      const pasta = pastaCopia;
      process.once('exit', () => { try { fs.rmSync(pasta, { recursive: true, force: true }); } catch { /* nada */ } });
    }
    const copia = path.join(pastaCopia, 'codex.db');
    for (const suf of ['', '-wal', '-shm']) { try { fs.rmSync(copia + suf, { force: true }); } catch { /* nada */ } }
    fs.copyFileSync(banco, copia);
    if (stWal) fs.copyFileSync(banco + '-wal', copia + '-wal');
    const [autos, runs] = await Promise.all([
      sqliteJson(copia, 'SELECT id, name, status, next_run_at, last_run_at, rrule, kind, created_at, updated_at FROM automations'),
      sqliteJson(copia, 'SELECT automation_id, status, created_at, updated_at, thread_title FROM automation_runs ORDER BY created_at DESC LIMIT 300'),
    ]);
    if (!autos && !runs) { avisos.push('Codex: não deu para ler o banco do app (sqlite3 ausente?)'); return null; }
    marcaCopia.chave = chave;
    marcaCopia.linhas = { autos: autos || [], runs: runs || [] };
    return marcaCopia.linhas;
  } catch (e) {
    avisos.push('Codex: cópia do banco falhou (' + (e?.message || e) + ')');
    return null;
  }
}

const msDe = v => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return null; return n < 1e12 ? n * 1000 : n; };

async function rotinasCodex(agora, avisos) {
  const lidas = new Map();
  const dir = path.join(CODEX, 'automations');
  for (const e of listar(dir)) {
    if (!e.isDirectory()) continue;
    try {
      const t = lerToml(fs.readFileSync(path.join(dir, e.name, 'automation.toml'), 'utf8'));
      lidas.set(String(t.id || e.name), t);
    } catch { /* pasta sem automation.toml */ }
  }
  const db = await bancoCodex(avisos);
  const doBanco = new Map((db?.autos || []).map(a => [a.id, a]));
  const ids = new Set([...lidas.keys(), ...doBanco.keys()]);
  const rotinas = [];
  for (const id of ids) {
    const t = lidas.get(id) || {}, b = doBanco.get(id) || {};
    const rrule = t.rrule || b.rrule || null;
    const criado = msDe(t.created_at ?? b.created_at) ?? agora;
    const status = String(t.status || b.status || 'ACTIVE').toUpperCase();
    const estado = status === 'ACTIVE' ? 'ativa' : status === 'PAUSED' ? 'pausada' : status === 'COMPLETED' ? 'concluida' : 'pausada';
    let proxima = null;
    if (estado === 'ativa') {
      const doApp = msDe(b.next_run_at);
      if (doApp && doApp > agora) proxima = doApp;
      else if (rrule) { try { proxima = proximaRrule(lerRrule(rrule, criado), agora); } catch (e) { avisos.push(`Codex ${id}: regra inválida (${e.message})`); } }
    }
    const runs = (db?.runs || []).filter(r => r.automation_id === id);
    const historico = runs.slice(0, 5).map(r => {
      const st = String(r.status || '').toLowerCase();
      const ini = msDe(r.created_at), fim = msDe(r.updated_at);
      const rodando = /run|progress|pending|start|queue|active/.test(st) && fim != null && agora - fim < 6 * 3_600_000;
      return {
        quando: ini ? new Date(ini).toISOString() : null, ms: ini,
        duracaoMin: ini && fim ? Math.max(0, Math.round((fim - ini) / 60_000)) : null,
        rodando, ok: rodando ? null : /fail|error|erro|cancel/.test(st) ? false : st ? true : null,
      };
    });
    let ultima = historico[0] || null;
    const doRegistro = msDe(b.last_run_at);
    if (doRegistro && (!ultima || doRegistro > (ultima.ms || 0) + 60_000)) {
      ultima = { quando: new Date(doRegistro).toISOString(), ms: doRegistro, duracaoMin: null, rodando: false, ok: null };
    }
    rotinas.push({
      id: 'codex:' + id, chave: id, agencia: 'codex',
      nome: semTravessao(t.name || b.name || nomeDoId(id)),
      descricao: t.kind === 'heartbeat' || b.kind === 'heartbeat' ? 'lembrete numa conversa do Codex' : 'automação do Codex',
      tipoAgenda: rrule ? 'rrule' : 'manual', expressao: rrule,
      descricaoHorario: rrule ? descreverRrule(rrule, criado) : 'sem horário, dispara na mão',
      estado, ativa: estado === 'ativa', proxima, ultima,
      rodandoAgora: historico.some(h => h.rodando), execucoes: runs.length, historico,
    });
  }
  return rotinas;
}

// ---------------------------------------------------------------------------
// Resposta de /api/despacho (cache de 10 s)
// ---------------------------------------------------------------------------
let cache = { em: 0, dados: null, promessa: null };

function finalizar(r, agora) {
  r.proxima = r.proxima != null ? { quando: new Date(r.proxima).toISOString(), ms: r.proxima, texto: textoFuturo(r.proxima, agora) } : null;
  if (r.ultima) r.ultima = { quando: r.ultima.quando, ms: r.ultima.ms, texto: textoPassado(r.ultima.ms, agora), ok: r.ultima.ok, duracaoMin: r.ultima.duracaoMin };
  r.historico = r.historico.map(h => ({ quando: h.quando, ms: h.ms, texto: textoPassado(h.ms, agora), ok: h.ok, duracaoMin: h.duracaoMin, rodando: h.rodando }));
  return r;
}

const PESO_ESTADO = { ativa: 0, manual: 1, pausada: 2, concluida: 3 };

async function montar() {
  const agora = Date.now();
  const avisos = [];
  let claude = [], codex = [];
  try { claude = rotinasClaude(agora, avisos); } catch (e) { avisos.push('Claude: ' + (e?.message || e)); }
  try { codex = await rotinasCodex(agora, avisos); } catch (e) { avisos.push('Codex: ' + (e?.message || e)); }
  const rotinas = [...claude, ...codex].map(r => finalizar(r, agora)).sort((a, b) =>
    (b.rodandoAgora - a.rodandoAgora) || (PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado])
    || ((a.proxima?.ms ?? Infinity) - (b.proxima?.ms ?? Infinity)) || ((b.ultima?.ms ?? 0) - (a.ultima?.ms ?? 0))
    || a.nome.localeCompare(b.nome, 'pt-BR'));
  const p = parede(agora);
  return {
    rotinas,
    geradoEm: new Date(agora).toISOString(),
    fuso: FUSO,
    agoraTexto: hhmm(p),
    resumo: {
      total: rotinas.length,
      ativas: rotinas.filter(r => r.estado === 'ativa').length,
      pausadas: rotinas.filter(r => r.estado === 'pausada').length,
      manuais: rotinas.filter(r => r.estado === 'manual').length,
      rodando: rotinas.filter(r => r.rodandoAgora).length,
      claude: claude.length, codex: codex.length,
    },
    avisos,
  };
}

export async function despacho() {
  const agora = Date.now();
  if (cache.dados && agora - cache.em < CACHE_MS) return cache.dados;
  if (cache.promessa) return cache.promessa;
  cache.promessa = montar()
    .then(d => { cache = { em: Date.now(), dados: d, promessa: null }; return d; })
    .catch(e => { cache.promessa = null; throw e; });
  return cache.promessa;
}
