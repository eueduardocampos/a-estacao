// Fonte da Oficina: quem travou por motivo TÉCNICO (não por pergunta ou aprovação,
// que são da fila do dono). Só leitura, e só o fim de cada transcrição (até 256 KB).
//
// Como os travamentos aparecem nos arquivos (levantado em 03/10/2026 nos arquivos reais):
// Claude (~/.claude/projects/<pasta>/<sessão>.jsonl e <sessão>/subagents/**/agent-*.jsonl)
//   - erro de ferramenta: linha 'user' com message.content [{ type: 'tool_result',
//     is_error: true, content }]; o tool_use de origem está numa linha 'assistant'
//     (message.id igual para chamadas paralelas, que contam como UMA rodada)
//   - conector que pede login: texto "This connector requires authentication..."
//   - conector fora do ar: "The connector's server isn't responding", "MCP error -32..."
//   - limite de serviço: "Rate limit exceeded", JSON com "category": "rate_limit"
//   - API do Claude caindo: linha 'system' subtype 'api_error' (error.status, error.formatted,
//     retryAttempt de maxRetries) enquanto tenta de novo; quando desiste, linha 'assistant'
//     com model '<synthetic>', isApiErrorMessage true e error 'server_error' | 'invalid_request'
//   - limite de uso do plano: mensagem '<synthetic>' com error 'rate_limit' e texto
//     "Claude AI usage limit reached|<epoch>" (antigo) ou "5-hour limit reached ∙ resets 4pm"
//     / "You've hit your limit · resets 4pm (America/Sao_Paulo)" (atual). NÃO houve nenhum
//     caso nos arquivos desta máquina: o leitor aceita as duas formas e foi testado com
//     casos sintéticos.
//   - sessões abertas: ~/.claude/sessions/<pid>.json (sessionId, cwd, name, status)
// Codex (~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl)
//   - event_msg item_completed: CommandExecution / McpToolCall / FileChange com
//     status 'failed' (exit_code, result.isError, error.message) ou 'completed'
//   - event_msg token_count: rate_limits { primary, secondary: { used_percent,
//     window_minutes, resets_at (s) }, rate_limit_reached_type }
//   - event_msg error / stream_error (message): limite de uso, login, queda de conexão
//
// Critérios (conservadores: 1 erro normal não manda ninguém para a oficina)
//   - erro-repetido: 3 ou mais RODADAS seguidas com erro, a última há até 5 min, sem
//     nenhum acerto nem fala sua depois
//   - conector: 1 pedido de login (não se resolve sozinho) ou 2 rodadas de conector fora do ar
//   - limite: aviso de limite do plano ainda vigente (até voltaEm; sem horário, 5 h), ou
//     2 rodadas seguidas de limite de um serviço, ou a API pedindo pausa (429) em 3+ tentativas
//   - api: 3+ tentativas seguidas da API sem resposta (últimos 2 min) ou desistência final
//     (mensagem de erro da API) há até 5 min, sem resposta boa depois
//   - tempo: 2 rodadas seguidas que passaram do tempo
// Recusa sua (negou permissão, interrompeu) e mensagem sua nova zeram a contagem.
//
// Nada do conteúdo sai daqui: só o motivo resumido (tipo de problema + nome do serviço).
//
// EXPORTS
//   oficina()                       { naOficina: [...], geradoEm } (cache 5 s)
//   analisarClaude(entradas, agora, nomeConector?)   diagnóstico de uma transcrição (teste)
//   analisarCodex(entradas, agora, mtime?)            idem para o Codex (teste)
//   formatarHora(ms, agora)          'às 16:10' | 'dia 07/10 às 16:10' (horário de Brasília)

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PASTA_DESKTOP } from './plataforma.js';

const CLAUDE = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
const CODEX = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), '.codex');
const PROJETOS = path.join(CLAUDE, 'projects');
const SESSOES = path.join(CLAUDE, 'sessions');
const SESSOES_CODEX = path.join(CODEX, 'sessions');
const INDICE_CODEX = path.join(CODEX, 'session_index.jsonl');
const SESSOES_DESKTOP = path.join(PASTA_DESKTOP, 'claude-code-sessions');

const FUSO = process.env.ESTACAO_FUSO || 'America/Sao_Paulo';   // horários sempre de Brasília
const CACHE_MS = 5000;
const FIM_BYTES = 256 * 1024;
const JANELA_ERRO_MS = 5 * 60 * 1000;
const JANELA_RETENTATIVA_MS = 2 * 60 * 1000;
const LIMITE_SEM_HORA_MS = 5 * 3600 * 1000;
const ARQUIVO_RECENTE_MS = 6 * 3600 * 1000;    // só olha transcrições escritas nas últimas 6 h
const SUBAGENTE_RECENTE_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Horário de Brasília
// ---------------------------------------------------------------------------
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtDia = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
export function formatarHora(ms, agora = Date.now()) {
  if (!ms) return '';
  const hora = fmtHora.format(ms);
  return fmtDia.format(ms) === fmtDia.format(agora) ? `às ${hora}` : `dia ${fmtDia.format(ms)} às ${hora}`;
}

// Diferença (ms) entre o relógio do fuso e o UTC num instante
function deslocamento(fuso, instante) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(instante).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(instante / 1000) * 1000;
  } catch { return null; }
}
// Próxima vez que o relógio do fuso marca h:m (a partir de 'base'); com mês/dia, aquele dia
function proximaHora(h, m, fuso, base, mes = null, dia = null) {
  const desl0 = deslocamento(fuso, base);
  if (desl0 == null) return null;
  const local = new Date(base + desl0);
  let alvo = Date.UTC(local.getUTCFullYear(), mes ?? local.getUTCMonth(), dia ?? local.getUTCDate(), h, m);
  if (mes == null && alvo <= local.getTime() - 60 * 1000) alvo += 24 * 3600 * 1000;
  if (mes != null && alvo < local.getTime() - 180 * 864e5) alvo = Date.UTC(local.getUTCFullYear() + 1, mes, dia, h, m);
  const instante = alvo - (deslocamento(fuso, alvo - desl0) ?? desl0);
  return instante;
}
const MESES = { jan: 0, feb: 1, fev: 1, mar: 2, apr: 3, abr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, ago: 7, sep: 8, set: 8, oct: 9, out: 9, nov: 10, dec: 11, dez: 11 };

// Horário de volta escrito no aviso de limite (Claude ou Codex), em ms, ou null
function horaDeVolta(texto, base) {
  const t = String(texto || '');
  let m = t.match(/\|(\d{10})(?:\D|$)/);                                    // "...reached|1759510200"
  if (m) return +m[1] * 1000;
  m = t.match(/resets?\s+(?:at\s+|on\s+)?(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i);
  if (m) {
    let h = +m[3]; const min = +(m[4] || 0);
    if (m[5]) { const pm = m[5].toLowerCase() === 'pm'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    const fuso = m[6] && /\//.test(m[6]) ? m[6].trim() : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const mes = m[1] ? MESES[m[1].toLowerCase()] : null;
    return h < 24 ? proximaHora(h, min, fuso, base, mes ?? null, mes != null ? +m[2] : null) : null;
  }
  m = t.match(/try again at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i);              // Codex: "try again at 4:10 PM"
  if (m) {
    let h = +m[1]; const pm = (m[3] || '').toLowerCase() === 'pm';
    if (m[3]) { if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return proximaHora(h, +m[2], Intl.DateTimeFormat().resolvedOptions().timeZone, base);
  }
  m = t.match(/(?:try again|resets?)\s+in\s+((?:\d+\s*(?:days?|d|hours?|h|minutes?|mins?|m)\s*,?\s*(?:and\s+)?)+)/i);
  if (m) {
    let ms = 0;
    for (const [, n, u] of m[1].matchAll(/(\d+)\s*(days?|d|hours?|h|minutes?|mins?|m)/gi)) ms += +n * (/^d/i.test(u) ? 864e5 : /^h/i.test(u) ? 36e5 : 6e4);
    return ms ? base + ms : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Nomes de conector (os da claude.ai aparecem só pelo código; o app desktop guarda
// código -> nome em remoteMcpServersConfig). Varredura em segundo plano a cada 10 min.
// ---------------------------------------------------------------------------
let nomesConectores = new Map();
let nomesLidosEm = 0;
let varrendo = null;
const CODIGO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function recortarArray(texto, de) {
  const ini = texto.indexOf('[', de);
  if (ini < 0) return null;
  let nivel = 0, emTexto = false, escape = false;
  for (let i = ini; i < texto.length; i++) {
    const c = texto[i];
    if (emTexto) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') emTexto = false; continue; }
    if (c === '"') emTexto = true;
    else if (c === '[') nivel++;
    else if (c === ']' && --nivel === 0) return texto.slice(ini, i + 1);
  }
  return null;
}
async function varrerNomes() {
  const pares = [];
  const visitar = async (dir, prof) => {
    let itens = [];
    try { itens = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory() && prof < 3) await visitar(p, prof + 1);
      else if (it.isFile() && it.name.endsWith('.json')) {
        try {
          const fh = await fsp.open(p, 'r');
          try {
            const buf = Buffer.alloc(512 * 1024);
            const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
            const texto = buf.subarray(0, bytesRead).toString('utf8');
            const i = texto.indexOf('"remoteMcpServersConfig"');
            const lista = i < 0 ? null : recortarArray(texto, i + 24);
            const st = await fh.stat();
            if (lista) for (const c of JSON.parse(lista)) if (c?.uuid && c?.name) pares.push([st.mtimeMs, String(c.uuid), String(c.name)]);
          } finally { await fh.close(); }
        } catch { /* arquivo sendo escrito */ }
      }
    }
  };
  await visitar(SESSOES_DESKTOP, 0);
  if (pares.length) nomesConectores = new Map(pares.sort((a, b) => a[0] - b[0]).map(([, u, n]) => [u, n]));
}
function pedirNomes() {
  if (varrendo || Date.now() - nomesLidosEm < 10 * 60 * 1000) return varrendo;
  nomesLidosEm = Date.now();
  varrendo = varrerNomes().catch(() => {}).finally(() => { varrendo = null; });
  return varrendo;
}

const APELIDOS = new Map([
  ['rdstationmarketing', 'RD Marketing'], ['rdmarketing', 'RD Marketing'], ['rdstationcrm', 'RD CRM'],
  ['rdstationconversas', 'RD Conversas'], ['reporteiflux', 'Reportei Flux'], ['googleads', 'Google Ads'],
  ['llmpulse', 'LLM Pulse'], ['elevenlabs', 'ElevenLabs'], ['chatgptads', 'ChatGPT Ads'], ['metaads', 'Meta Ads'],
  ['firecrawl', 'Firecrawl'], ['brightdata', 'Bright Data'], ['github', 'GitHub'], ['codexapps', 'apps do ChatGPT'],
]);
function nomeCurto(bruto) {
  let t = String(bruto || '').replace(/^plugin[_:][^_:]+[_:]/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) t = t.replace(/\s+(da|do|de)\s+[A-ZÀ-Ú][\wÀ-ú]*$/u, '').trim();
  t = t.replace(/\s*\bmcp$/i, '').replace(/^mcp\s+/i, '').trim();
  if (!t || CODIGO.test(t.replace(/ /g, '-'))) return null;
  const apelido = APELIDOS.get(t.toLowerCase().replace(/\s+/g, ''));
  if (apelido) return apelido;
  t = t.split(' ').map(p => p === p.toLowerCase() ? p.charAt(0).toUpperCase() + p.slice(1) : p).join(' ');
  return /astronauta/i.test(t) ? null : t;
}
const NAVEGADOR = /claude-in-chrome|claude.browser|claude_browser|computer-use|cua_repl|browser/i;
function nomeDoServidorMcp(servidor) {
  if (!servidor) return null;
  if (NAVEGADOR.test(servidor)) return 'navegador';
  return nomeCurto(nomesConectores.get(servidor) || servidor);
}

// Serviço por trás de um comando de terminal (login e limites costumam vir de CLIs)
const CLIS = [
  [/\bgh\s/, 'GitHub'], [/\bgit\s+(push|pull|fetch|clone)\b/, 'GitHub'], [/\bgcloud\b|\bbq\s/, 'Google Cloud'],
  [/\bsupabase\b/, 'Supabase'], [/\bvercel\b/, 'Vercel'], [/\bnetlify\b/, 'Netlify'], [/\baws\s/, 'AWS'],
  [/\bfirebase\b/, 'Firebase'], [/\bnpm\s+(publish|login)\b/, 'npm'], [/\bwrangler\b/, 'Cloudflare'],
  [/api\.openai\.com/, 'ChatGPT'], [/api\.anthropic\.com/, 'Claude API'], [/graph\.facebook\.com/, 'Meta'],
  [/api\.rd\.services/, 'RD Station'], [/googleapis\.com/, 'Google'], [/elevenlabs/, 'ElevenLabs'],
];
function servicoDoComando(cmd) {
  const c = String(cmd || '');
  for (const [re, nome] of CLIS) if (re.test(c)) return nome;
  return null;
}

// ---------------------------------------------------------------------------
// Classe do erro, pelo texto (que nunca sai daqui)
// ---------------------------------------------------------------------------
const RECUSA = /doesn't want to proceed|was rejected|user (rejected|denied)|Permission for this action was denied|permission (was )?denied by|interrupted by user|Request interrupted/i;
const NEUTRO = /^\s*Blocked:|<tool_use_error>\s*Blocked|Concurrent subagent limit/i;
function classeDoErro(texto) {
  const t = String(texto || '').slice(0, 4000);
  if (RECUSA.test(t)) return 'recusa';
  if (NEUTRO.test(t)) return 'neutro';
  if (/(connector|server|mcp) requires authentication|needs to connect it|authentication required for|not authenticated|unauthori[sz]ed|\b401\b|please (log ?in|sign in|re-?authenticate)|token (has )?expired|access token could not be refreshed|invalid_grant|re-?authenticate|login required|auth(entication)? (failed|required)|gh auth login|not logged in|sign in again|reconnect (the|this) connector/i.test(t)) return 'login';
  if (/rate.?limit|too many requests|\b429\b|quota (exceeded|exhausted)|usage limit|limit (reached|exceeded)|insufficient (credits|quota)|out of credits|Consume[d]? all/i.test(t)) return 'limite';
  if (/server isn't responding|not responding|isn't responding|ECONNREFUSED|connection refused|server disconnected|extension disconnected|is not connected|not connected to|failed to connect|MCP error -32000|did not respond within|no such server/i.test(t)) return 'fora';
  if (/timed? ?out|timeout|ETIMEDOUT|deadline exceeded|took too long/i.test(t)) return 'tempo';
  if (/Internal Server Error|Service Unavailable|Bad Gateway|Gateway Timeout|\b50[0234]\b|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network error|overloaded/i.test(t)) return 'api';
  return 'comum';
}

// No navegador e na leitura de página, "login" e "limite" falam do site aberto, não do conector
const ajustarClasse = (classe, alvo) => (alvo.servico === 'navegador' || /página|busca na web/.test(alvo.rotulo)) && (classe === 'login' || classe === 'limite') ? 'comum' : classe;

const ROTULOS = {
  Bash: 'comando', Read: 'leitura de arquivo', Write: 'gravação de arquivo', Edit: 'edição de arquivo', MultiEdit: 'edição de arquivo',
  NotebookEdit: 'edição de caderno', Glob: 'busca de arquivos', Grep: 'busca nos arquivos', WebFetch: 'leitura de página',
  WebSearch: 'busca na web', Agent: 'ajudante', Task: 'ajudante', Skill: 'skill', exec: 'comando', exec_command: 'comando',
  shell: 'comando', apply_patch: 'edição de arquivo', CommandExecution: 'comando', FileChange: 'edição de arquivo',
};
// Quem foi chamado: { servico, rotulo, chave } (chave = mesma chamada de novo?)
function alvoDaChamada(nome, entrada) {
  if (String(nome).startsWith('mcp__')) {
    const servidor = String(nome).split('__')[1] || '';
    const s = nomeDoServidorMcp(servidor);
    return { mcp: true, servico: s, rotulo: s === 'navegador' ? 'navegador' : (s ? `chamada ao ${s}` : 'conector'), chave: nome + JSON.stringify(entrada || {}).slice(0, 400) };
  }
  const cmd = entrada?.command || entrada?.cmd || '';
  return { servico: cmd ? servicoDoComando(cmd) : null, rotulo: ROTULOS[nome] || 'ferramenta', chave: nome + JSON.stringify(entrada || {}).slice(0, 400), comando: nome === 'Bash' || !!cmd };
}

const com = s => s === 'navegador' ? 'o navegador' : `o ${s}`;
const Com = s => { const t = com(s); return t.charAt(0).toUpperCase() + t.slice(1); };

// Diagnóstico de uma sequência de erros de ferramenta (do fim para trás, sem acerto no meio)
// erros: [{ quando, rodada, classe, alvo }] em ordem cronológica
function diagnosticoDosErros(erros, agora) {
  if (!erros.length) return null;
  const ultimo = erros[erros.length - 1];
  if (agora - ultimo.quando > JANELA_ERRO_MS) return null;
  const rodadas = classe => new Set(erros.filter(e => !classe || e.classe === classe).map(e => e.rodada)).size;
  const desde = erros[0].quando;
  const servico = cl => { const e = [...erros].reverse().find(x => x.classe === cl && x.alvo.servico); return e?.alvo.servico || null; };

  // conector pedindo login não se resolve sozinho: 1 basta; em comando, 2 rodadas
  if (ultimo.classe === 'login' && (ultimo.alvo.mcp || rodadas('login') >= 2)) {
    const s = ultimo.alvo.servico || servico('login');
    return { tipo: 'conector', motivo: s ? `${com(s)} pediu login de novo` : 'um serviço pediu login de novo', desde: ultimo.quando, voltaEm: null };
  }
  if (rodadas('fora') >= 2) {
    const s = servico('fora');
    return { tipo: 'conector', motivo: s ? `${com(s)} não está respondendo` : 'um conector não está respondendo', desde, voltaEm: null };
  }
  if (rodadas('limite') >= 2) {
    const s = servico('limite');
    return { tipo: 'limite', motivo: s ? `${com(s)} atingiu o limite de uso` : 'um serviço atingiu o limite de pedidos', desde, voltaEm: null };
  }
  if (rodadas('tempo') >= 2) {
    const n = rodadas('tempo');
    const s = servico('tempo');
    const oQue = s ? `${com(s)} demorou demais` : ultimo.alvo.comando ? 'o comando passou do tempo' : `a ${ultimo.alvo.rotulo} passou do tempo`;
    return { tipo: 'tempo', motivo: `${oQue} ${n} vezes seguidas`, desde, voltaEm: null };
  }
  if (rodadas('api') >= 2) {
    const s = servico('api');
    return { tipo: 'api', motivo: s ? `${com(s)} está com erro no servidor` : `a conexão falhou ${rodadas('api')} vezes seguidas`, desde, voltaEm: null };
  }
  const n = rodadas();
  if (n < 3) return null;
  const mesma = erros.every(e => e.alvo.chave === ultimo.alvo.chave);
  const rotulos = new Set(erros.map(e => e.alvo.rotulo));
  let motivo;
  if (mesma && ultimo.alvo.comando) motivo = `o mesmo comando falhou ${erros.length} vezes`;
  else if (mesma) motivo = `a mesma ${ultimo.alvo.rotulo} falhou ${erros.length} vezes`;
  else motivo = `${n} tentativas seguidas deram erro` + (rotulos.size === 1 ? ` (${[...rotulos][0]})` : '');
  return { tipo: 'erro-repetido', motivo, desde, voltaEm: null };
}

// ---------------------------------------------------------------------------
// Claude: diagnóstico de uma transcrição (entradas = linhas já em JSON, em ordem)
// ---------------------------------------------------------------------------
const quandoDe = d => Date.parse(d?.timestamp || '') || 0;
const textoDe = c => Array.isArray(c) ? c.map(x => typeof x === 'string' ? x : (x?.text || '')).join(' ') : String(c ?? '');
const LIMITE_PLANO = /usage limit|limit reached|hit your limit|out of (extra )?usage|weekly limit|session limit/i;

function falaDoUsuario(d) {
  if (d.type !== 'user' || d.isMeta || d.isCompactSummary) return false;
  const c = d.message?.content;
  if (typeof c === 'string') return !/^\s*<(local-command|command-|task-notification|system-reminder)/.test(c);
  if (!Array.isArray(c) || c.some(x => x?.type === 'tool_result')) return false;
  return c.some(x => x?.type === 'text' && !/^\s*<(local-command|command-|task-notification|system-reminder)/.test(x.text || ''));
}

function motivoDoLimiteClaude(texto, voltaEm, agora) {
  let qual = 'limite de uso do Claude atingido';
  if (/5.?hour|session/i.test(texto)) qual = 'limite da sessão de 5 h atingido';
  else if (/opus/i.test(texto) && /week/i.test(texto)) qual = 'limite semanal do Opus atingido';
  else if (/sonnet/i.test(texto) && /week/i.test(texto)) qual = 'limite semanal do Sonnet atingido';
  else if (/week/i.test(texto)) qual = 'limite da semana atingido';
  return voltaEm ? `${qual}, volta ${formatarHora(voltaEm, agora)}` : qual;
}

function motivoDaApi(e) {
  const err = e.error || {};
  const status = err.status;
  const f = `${err.formatted || ''} ${err.message || ''} ${e.texto || ''}`;
  if (/went to sleep/i.test(f)) return 'a resposta parou quando o Mac dormiu';
  if (/prompt is too long|context.*(too long|exceed)/i.test(f)) return 'a conversa ficou longa demais para o modelo';
  if (err.isNetworkDown || /ENOTFOUND|EAI_AGAIN|internet|DNS/i.test(f)) return 'sem internet para falar com a API';
  if (status === 529 || /overloaded/i.test(f)) return 'a API do Claude está sobrecarregada';
  if (status >= 500) return `a API do Claude respondeu com erro ${status}`;
  if (/ECONNRESET|Connection (lost|dropped|error)|stopped arriving/i.test(f)) return 'a conexão com a API caiu no meio da resposta';
  return 'a API do Claude não está respondendo';
}

export function analisarClaude(entradas, agora = Date.now()) {
  // 1. Último ponto "bom": resposta normal do modelo ou fala sua
  let iBom = -1, iFala = -1;
  for (let i = entradas.length - 1; i >= 0; i--) {
    const d = entradas[i];
    if (iFala < 0 && falaDoUsuario(d)) iFala = i;
    if (iBom < 0 && d.type === 'assistant' && !d.isApiErrorMessage && d.message?.model !== '<synthetic>') iBom = i;
    if (iBom >= 0 && iFala >= 0) break;
  }

  // 2. Limite do plano e falha da API depois da última resposta boa
  let limite = null, apiFinal = null;
  const tentativas = [];
  for (let i = iBom + 1; i < entradas.length; i++) {
    const d = entradas[i];
    if (d.type === 'assistant' && (d.isApiErrorMessage || d.message?.model === '<synthetic>')) {
      const texto = textoDe(d.message?.content);
      if (d.error === 'rate_limit' || LIMITE_PLANO.test(texto)) {
        if (!limite) limite = { primeiro: quandoDe(d) };
        limite.texto = texto; limite.quando = quandoDe(d);
      } else if (d.isApiErrorMessage && i > iFala) {
        apiFinal = { quando: quandoDe(d), texto, error: { formatted: texto } };
      }
    } else if (d.type === 'system' && d.subtype === 'api_error' && i > iFala) {
      tentativas.push({ quando: quandoDe(d), tentativa: d.retryAttempt || 0, max: d.maxRetries || 0, error: d.error || {} });
    }
  }
  if (limite) {
    const voltaEm = horaDeVolta(limite.texto, limite.quando);
    const vigente = voltaEm ? voltaEm > agora : agora - limite.quando < LIMITE_SEM_HORA_MS;
    if (vigente) return { tipo: 'limite', motivo: motivoDoLimiteClaude(limite.texto, voltaEm, agora), desde: limite.primeiro, voltaEm: voltaEm || null };
  }
  if (apiFinal && agora - apiFinal.quando <= JANELA_ERRO_MS) {
    const desde = tentativas.length ? Math.min(tentativas[0].quando, apiFinal.quando) : apiFinal.quando;
    return { tipo: 'api', motivo: motivoDaApi(apiFinal), desde, voltaEm: null };
  }
  if (tentativas.length) {
    const ult = tentativas[tentativas.length - 1];
    const maxTentativa = Math.max(...tentativas.map(t => t.tentativa));
    if (agora - ult.quando <= JANELA_RETENTATIVA_MS && maxTentativa >= 3) {
      const e = ult.error;
      const contagem = ult.max ? ` (tentativa ${ult.tentativa} de ${ult.max})` : '';
      if (e.status === 429 || /rate_limit/i.test(e.message || '')) {
        return { tipo: 'limite', motivo: `a API pediu uma pausa por excesso de pedidos${contagem}`, desde: tentativas[0].quando, voltaEm: null };
      }
      return { tipo: 'api', motivo: motivoDaApi({ error: e }) + contagem, desde: tentativas[0].quando, voltaEm: null };
    }
  }

  // 3. Erros de ferramenta seguidos, do fim para trás
  const chamadas = new Map();      // tool_use_id -> { nome, entrada, rodada }
  for (const d of entradas) {
    if (d.type !== 'assistant' || !Array.isArray(d.message?.content)) continue;
    for (const c of d.message.content) if (c?.type === 'tool_use') chamadas.set(c.id, { nome: c.name, entrada: c.input, rodada: d.message.id || d.uuid });
  }
  const erros = [];
  fim: for (let i = entradas.length - 1; i > iFala; i--) {
    const d = entradas[i];
    if (d.type !== 'user' || !Array.isArray(d.message?.content)) continue;
    const resultados = d.message.content.filter(c => c?.type === 'tool_result');
    for (let k = resultados.length - 1; k >= 0; k--) {
      const r = resultados[k];
      if (!r.is_error) break fim;                   // um acerto encerra a sequência
      const classe = classeDoErro(textoDe(r.content));
      if (classe === 'recusa') break fim;            // você interveio: não é travamento técnico
      if (classe === 'neutro') continue;
      const ch = chamadas.get(r.tool_use_id) || { nome: 'ferramenta', entrada: {}, rodada: r.tool_use_id };
      const alvo = alvoDaChamada(ch.nome, ch.entrada);
      erros.unshift({ quando: quandoDe(d), rodada: ch.rodada, classe: ajustarClasse(classe, alvo), alvo });
    }
  }
  return diagnosticoDosErros(erros, agora);
}

// ---------------------------------------------------------------------------
// Codex: diagnóstico de um rollout
// ---------------------------------------------------------------------------
function motivoDoLimiteCodex(janelaMin, voltaEm, agora) {
  const qual = janelaMin && janelaMin <= 300 ? 'limite de 5 h do Codex atingido'
    : janelaMin >= 10080 ? 'limite semanal do Codex atingido' : 'limite de uso do Codex atingido';
  return voltaEm ? `${qual}, volta ${formatarHora(voltaEm, agora)}` : qual;
}

export function analisarCodex(entradas, agora = Date.now(), mtime = agora) {
  let iFala = -1, ultimoLimite = null, ultimoErro = null;
  const streams = [];
  for (let i = 0; i < entradas.length; i++) {
    const d = entradas[i];
    const p = d.payload || {};
    if (d.type !== 'event_msg') continue;
    if (p.type === 'user_message') { iFala = i; streams.length = 0; ultimoErro = null; }
    else if (p.type === 'task_complete') { streams.length = 0; }
    else if (p.type === 'token_count' && p.rate_limits) {
      const rl = p.rate_limits;
      const cheias = [rl.primary, rl.secondary].filter(w => w && w.used_percent >= 100);
      ultimoLimite = (cheias.length || rl.rate_limit_reached_type) ? { quando: quandoDe(d), janelas: cheias, i } : null;
    } else if (p.type === 'error') ultimoErro = { quando: quandoDe(d), texto: String(p.message || ''), i };
    else if (p.type === 'stream_error') streams.push({ quando: quandoDe(d), texto: String(p.message || '') });
  }

  // limite: aviso de erro com "usage limit" ou rate_limits cheio, com uso recente do Codex
  if (ultimoErro && classeDoErro(ultimoErro.texto) === 'limite' && ultimoErro.i > iFala) {
    const rl = ultimoLimite?.janelas?.sort((a, b) => (b.resets_at || 0) - (a.resets_at || 0))[0];
    const voltaEm = horaDeVolta(ultimoErro.texto, ultimoErro.quando) || (rl?.resets_at ? rl.resets_at * 1000 : null);
    const vigente = voltaEm ? voltaEm > agora : agora - ultimoErro.quando < LIMITE_SEM_HORA_MS;
    if (vigente) return { tipo: 'limite', motivo: motivoDoLimiteCodex(rl?.window_minutes, voltaEm, agora), desde: ultimoErro.quando, voltaEm: voltaEm || null };
  }
  if (ultimoLimite && agora - mtime < 30 * 60 * 1000) {
    const rl = [...ultimoLimite.janelas].sort((a, b) => (b.resets_at || 0) - (a.resets_at || 0))[0];
    const voltaEm = rl?.resets_at ? rl.resets_at * 1000 : null;
    if (voltaEm ? voltaEm > agora : agora - ultimoLimite.quando < LIMITE_SEM_HORA_MS) {
      return { tipo: 'limite', motivo: motivoDoLimiteCodex(rl?.window_minutes, voltaEm, agora), desde: ultimoLimite.quando, voltaEm };
    }
  }
  if (ultimoErro && ultimoErro.i > iFala && agora - ultimoErro.quando <= JANELA_ERRO_MS) {
    const classe = classeDoErro(ultimoErro.texto);
    if (classe === 'login') return { tipo: 'conector', motivo: 'o Codex pediu login de novo', desde: ultimoErro.quando, voltaEm: null };
    if (classe !== 'recusa' && classe !== 'neutro') {
      const motivo = classe === 'tempo' ? 'a resposta do Codex passou do tempo' : 'a API do Codex respondeu com erro';
      return { tipo: classe === 'tempo' ? 'tempo' : 'api', motivo, desde: ultimoErro.quando, voltaEm: null };
    }
  }
  if (streams.length >= 3 && agora - streams[streams.length - 1].quando <= JANELA_RETENTATIVA_MS) {
    return { tipo: 'api', motivo: `a conexão com o Codex caiu ${streams.length} vezes seguidas`, desde: streams[0].quando, voltaEm: null };
  }

  // erros de ferramenta seguidos (item_completed com status failed)
  const erros = [];
  for (let i = entradas.length - 1; i > iFala; i--) {
    const d = entradas[i];
    const it = d.type === 'event_msg' && d.payload?.type === 'item_completed' ? d.payload.item : null;
    if (!it || !['CommandExecution', 'McpToolCall', 'FileChange'].includes(it.type) || !it.status) continue;
    if (it.status !== 'failed') break;
    // comando: só o stderr (a saída normal pode citar qualquer coisa)
    const texto = it.type === 'CommandExecution' ? `${it.error?.message || ''} ${it.stderr || ''}` : `${it.error?.message || ''} ${textoDe(it.result?.content)} ${it.stderr || ''}`;
    const classe = classeDoErro(texto);
    if (classe === 'recusa') break;
    if (classe === 'neutro') continue;
    let alvo;
    if (it.type === 'McpToolCall') {
      const s = it.appName ? nomeCurto(it.appName) : nomeDoServidorMcp(it.server);
      alvo = { mcp: true, servico: s, rotulo: s === 'navegador' ? 'navegador' : (s ? `chamada ao ${s}` : 'conector'), chave: `${it.server}/${it.tool}${JSON.stringify(it.arguments || {}).slice(0, 400)}` };
    } else {
      const cmd = Array.isArray(it.command) ? it.command.join(' ') : String(it.command || '');
      alvo = { servico: it.type === 'CommandExecution' ? servicoDoComando(cmd) : null, rotulo: ROTULOS[it.type], chave: it.type + cmd, comando: it.type === 'CommandExecution' };
    }
    erros.unshift({ quando: quandoDe(d), rodada: it.id || i, classe: ajustarClasse(classe, alvo), alvo });
  }
  return diagnosticoDosErros(erros, agora);
}

// ---------------------------------------------------------------------------
// Leitura do fim dos arquivos (cache por tamanho e mtime)
// ---------------------------------------------------------------------------
const cacheArquivos = new Map();   // caminho -> { tamanho, mtime, entradas }
function entradasDoFim(arquivo, st) {
  const c = cacheArquivos.get(arquivo);
  if (c && c.tamanho === st.size && c.mtime === st.mtimeMs) { c.usadoEm = Date.now(); return c.entradas; }
  let texto = '';
  const ini = Math.max(0, st.size - FIM_BYTES);
  try {
    const fd = fs.openSync(arquivo, 'r');
    try {
      const buf = Buffer.alloc(st.size - ini);
      const n = fs.readSync(fd, buf, 0, buf.length, ini);
      texto = buf.toString('utf8', 0, n);
    } finally { fs.closeSync(fd); }
  } catch { return []; }
  const linhas = texto.split('\n');
  if (ini > 0) linhas.shift();                       // primeira linha veio cortada
  const entradas = [];
  for (const l of linhas) { if (l.length > 2) { try { entradas.push(JSON.parse(l)); } catch { /* linha incompleta */ } } }
  cacheArquivos.set(arquivo, { tamanho: st.size, mtime: st.mtimeMs, entradas, usadoEm: Date.now() });
  return entradas;
}

function lerJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function listar(dir) { try { return fs.readdirSync(dir); } catch { return []; } }
function vivo(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
const limparNome = t => String(t || '').replace(/\s+(da|do)\s+Astronauta(\s+(Martech|Digital))?$/i, '').replace(/\bAstronauta(\s+(Martech|Digital))?\b/g, '').replace(/\s{2,}/g, ' ').trim();

const cacheTranscricao = new Map();
function acharTranscricao(sessionId, cwd) {
  const c = cacheTranscricao.get(sessionId);
  if (c && fs.existsSync(c)) return c;
  const direto = path.join(PROJETOS, String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-'), sessionId + '.jsonl');
  if (fs.existsSync(direto)) { cacheTranscricao.set(sessionId, direto); return direto; }
  for (const dir of listar(PROJETOS)) {
    const p = path.join(PROJETOS, dir, sessionId + '.jsonl');
    if (fs.existsSync(p)) { cacheTranscricao.set(sessionId, p); return p; }
  }
  return null;
}

function subagentesDe(transcricao, sessionId, agora) {
  const base = path.join(path.dirname(transcricao), sessionId, 'subagents');
  const achados = [];
  const visitar = (dir, prof) => {
    for (const nome of listar(dir)) {
      const p = path.join(dir, nome);
      if (nome.endsWith('.jsonl') && nome.startsWith('agent-')) {
        try { const st = fs.statSync(p); if (agora - st.mtimeMs < SUBAGENTE_RECENTE_MS) achados.push({ p, st }); } catch {}
      } else if (prof < 2 && !nome.includes('.')) visitar(p, prof + 1);
    }
  };
  visitar(base, 0);
  return achados;
}

function nomeDoSubagente(metaArquivo) {
  const d = String(lerJson(metaArquivo)?.description || '').trim();
  if (!d || d === 'general-purpose') return 'Ajudante';
  return limparNome(d).slice(0, 48) || 'Ajudante';
}

function doClaude(agora) {
  const lista = [];
  for (const arq of listar(SESSOES)) {
    if (!arq.endsWith('.json')) continue;            // os .key ao lado nunca são lidos
    const s = lerJson(path.join(SESSOES, arq));
    if (!s?.sessionId || !s.pid || s.spare === true || s.parkedJobId || !vivo(s.pid)) continue;
    const transcricao = acharTranscricao(s.sessionId, s.cwd);
    if (!transcricao) continue;
    const pasta = path.basename(s.cwd || '') || 'Claude';
    let st;
    try { st = fs.statSync(transcricao); } catch { continue; }
    if (agora - st.mtimeMs < ARQUIVO_RECENTE_MS) {
      const diag = analisarClaude(entradasDoFim(transcricao, st), agora);
      if (diag) lista.push({ id: s.sessionId, nome: limparNome(s.name) || pasta, agencia: 'Claude Code', provedor: 'anthropic', tipoAgente: 'sessao', pasta, ...diag });
    }
    for (const { p, st: sst } of subagentesDe(transcricao, s.sessionId, agora)) {
      const diag = analisarClaude(entradasDoFim(p, sst), agora);
      if (diag) lista.push({ id: path.basename(p, '.jsonl'), nome: nomeDoSubagente(p.replace(/\.jsonl$/, '.meta.json')), agencia: 'Claude Code', provedor: 'anthropic', tipoAgente: 'subagente', pai: s.sessionId, pasta, ...diag });
    }
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------
let titulosCodex = new Map(), titulosLidosEm = 0;
function lerTitulosCodex() {
  if (Date.now() - titulosLidosEm < 30 * 1000) return;
  titulosLidosEm = Date.now();
  try {
    const novos = new Map();
    for (const l of fs.readFileSync(INDICE_CODEX, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const d = JSON.parse(l); if (d.id && d.thread_name) novos.set(d.id, d.thread_name); } catch {}
    }
    titulosCodex = novos;
  } catch {}
}
const metasCodex = new Map();
function metaCodex(arquivo) {
  if (metasCodex.has(arquivo)) return metasCodex.get(arquivo);
  let meta = null;
  try {
    const fd = fs.openSync(arquivo, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const linha = buf.toString('utf8', 0, n).split('\n')[0];
    const campo = k => (linha.match(new RegExp(`"${k}":"([^"]*)"`)) || [])[1];
    if (linha.includes('"session_meta"')) meta = {
      id: campo('id'), cwd: campo('cwd'), pai: campo('parent_thread_id') || null, apelido: campo('agent_nickname') || null,
      guardiao: /"thread_source":"guardian_review"|"other":"guardian"/.test(linha),
    };
  } catch {}
  if (meta?.id) metasCodex.set(arquivo, meta);
  return meta?.id ? meta : null;
}
function doCodex(agora) {
  lerTitulosCodex();
  const lista = [];
  const dias = [new Date(agora), new Date(agora - 864e5)];
  for (const d of dias) {
    const dir = path.join(SESSOES_CODEX, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    for (const a of listar(dir)) {
      if (!a.endsWith('.jsonl')) continue;
      const arquivo = path.join(dir, a);
      let st;
      try { st = fs.statSync(arquivo); } catch { continue; }
      if (agora - st.mtimeMs > ARQUIVO_RECENTE_MS) continue;
      const meta = metaCodex(arquivo);
      if (!meta || meta.guardiao) continue;
      const diag = analisarCodex(entradasDoFim(arquivo, st), agora, st.mtimeMs);
      if (!diag) continue;
      const pasta = path.basename(meta.cwd || '') || 'Codex';
      const sub = Boolean(meta.pai);
      lista.push({
        id: 'codex:' + meta.id, nome: limparNome(titulosCodex.get(meta.id) || (sub ? meta.apelido || 'Ajudante' : pasta)) || pasta,
        agencia: 'Codex', provedor: 'openai', tipoAgente: sub ? 'subagente' : 'sessao', ...(sub ? { pai: 'codex:' + meta.pai } : {}), pasta, ...diag,
      });
    }
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------
let cache = null;
export async function oficina() {
  const agora = Date.now();
  if (cache && agora - cache.geradoEm < CACHE_MS) return cache;
  const pedido = pedirNomes();
  if (pedido && !nomesConectores.size) await Promise.race([pedido, new Promise(ok => setTimeout(ok, 1500))]);
  const naOficina = [];
  try { naOficina.push(...doClaude(agora)); } catch (e) { console.error('[oficina claude]', e?.message || e); }
  try { naOficina.push(...doCodex(agora)); } catch (e) { console.error('[oficina codex]', e?.message || e); }
  naOficina.sort((a, b) => a.desde - b.desde);
  // limpa o cache de arquivos que não aparecem há 10 min
  for (const [k, v] of cacheArquivos) if (agora - v.usadoEm > 10 * 60 * 1000) cacheArquivos.delete(k);
  cache = { naOficina, geradoEm: agora };
  return cache;
}
