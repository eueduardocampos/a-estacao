// Fonte Codex: lê, só leitura, as sessões do Codex em $CODEX_HOME/sessions
// (padrão ~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl) e devolve agentes no mesmo
// formato dos do Claude, com provedor 'openai'.
//
// Como o Codex registra o trabalho (visto em 03/10/2026, Codex Desktop 0.158):
// - 1ª linha: session_meta (id, cwd, thread_source, parent_thread_id e
//   source.subagent.thread_spawn nos subagentes, com agent_nickname)
// - event_msg task_started / task_complete / turn_aborted marcam começo e fim de cada
//   tarefa (turno). Não existe arquivo de status como ~/.claude/sessions/<pid>.json.
// - response_item function_call (name, namespace), custom_tool_call ('exec' roda um
//   script com tools.<ferramenta>(...) dentro; 'apply_patch') e web_search_call são as
//   ferramentas; *_output é a resposta de cada uma (call_id)
// - event_msg item_completed traz o resultado estruturado: McpToolCall (server, tool),
//   CommandExecution (command), WebSearch, UserMessage...
// - response_item message (role assistant) são as falas
// - event_msg token_count traz last_token_usage, model_context_window e rate_limits
// - request_user_input (espera a resposta) e request_user_input_async (segue
//   trabalhando) são as perguntas ao usuário; a resposta chega como user_message
// - $CODEX_HOME/session_index.jsonl traz o título de cada conversa (thread_name)
//
// Regras de vida (as mesmas do Claude, adaptadas ao que o arquivo mostra):
// - Trabalhando: o task_started mais recente é mais novo que o último task_complete e
//   turn_aborted, e o arquivo foi escrito nos últimos 10 min (Codex fechado no meio da
//   tarefa deixa um task_started sem fim; aí conta como parado desde o último registro).
// - Esperando você ('esperar', aguardando 'pergunta'): pergunta (request_user_input*)
//   sem resposta e sem tarefa nova depois; vale por até 30 min, depois vira parado.
//   Pedido de aprovação não aparece no arquivo (no Codex Desktop quem revisa é o
//   "guardian", automático), então o Codex nunca fica 'permissao'.
// - Parado: fica até 4 min (60 s de relógio + 3 min de descanso no cliente) e some.
// - Filas (rodada 6, só sessões): pergunta aberta = pendencia 'precisa_de_voce'
//   (fila da sala do dono); tarefa encerrada cuja última fala fecha com pergunta ou
//   oferta (pendencia.js, heurística) = atividade 'revisar' e pendencia
//   'entrega_com_sugestao' por até 30 min (fila da revisão). abrivel: sempre, pela
//   URL codex://threads/<id> que o servidor monta.
// - Ficam de fora: o revisor automático de aprovações (thread_source 'guardian_review')
//   e as conversas importadas de outro agente (turnos 'external-import-*').
// - Atividade pela última ferramenta, como no Claude: MCP (mcp__<servidor>, apps do
//   ChatGPT em mcp__codex_apps__<app>) e API pelo host do comando valem por 15 s depois
//   da chamada ('conector'); busca na web e navegador vão para 'pesquisar'; ferramenta
//   respondida há mais de 20 s sem nova: 'pensando na resposta'.
//
// Leitura incremental: a primeira leitura pega o fim do arquivo (512 KB, 4 MB ou
// 16 MB, até achar o começo ou o fim de uma tarefa); depois só o que foi acrescentado.
// Linha gigante (imagem em base64, histórico compactado) não passa por JSON.parse.
//
// EXPORTS
//   configurarCodex({ apiDoComando, nomeCurto, ehPortugues, limparMarca }) dicionários
//     do servidor (para os nomes de serviço e as APIs serem os mesmos do Claude)
//   agentesCodex(agora)  lista de agentes (contrato v0.5 + contexto)
//   limitesCodex()       último rate_limits visto (primary/secondary, visto_em) ou null;
//                        sem sessão recente, procura no arquivo mais novo dos últimos 7 dias


import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), '.codex');
const SESSOES = path.join(BASE, 'sessions');
const INDICE = path.join(BASE, 'session_index.jsonl');
const JANELA_VIDA_MS = 4 * 60 * 1000;     // 60 s de relógio + 3 min de descanso
const PERGUNTA_MS = 30 * 60 * 1000;       // pergunta sem resposta: esperando você por até isto
const TRAVADO_MS = 10 * 60 * 1000;        // tarefa aberta sem escrever há mais que isso: parou
const JANELA_SERVICO_MS = 15 * 1000;      // MCP e API valem por 15 s depois da chamada
const PENSANDO_MS = 20 * 1000;
const LINHA_GRANDE = 256 * 1024;
const JANELAS_INICIAIS = [512 * 1024, 4 * 1024 * 1024, 16 * 1024 * 1024];
const MAX_POR_LEITURA = 8 * 1024 * 1024;

// Dicionários do servidor (configurarCodex); sem eles, versões simples
const cfg = {
  apiDoComando: () => null,
  nomeCurto: s => String(s || '').replace(/[-_]+/g, ' ').trim().replace(/^./, c => c.toUpperCase()),
  ehPortugues: () => true,
  limparMarca: s => s,
  terminaComOferta: () => false,   // pendencia.js (rodada 6): fala que fecha com pergunta ou oferta
  mascararSegredos: s => String(s ?? '').replace(/\b(?:sk|ghp|gho|xox[abpr])[-_][A-Za-z0-9_-]{12,}/g, '••••').replace(/\b[0-9a-f]{32,}\b/gi, '••••'),
};
export function configurarCodex(c = {}) {
  for (const k of Object.keys(cfg)) if (typeof c[k] === 'function') cfg[k] = c[k];
}

const estados = new Map();                 // arquivo -> estado da leitura
let titulos = new Map();
let titulosLidosEm = 0;
let ultimosLimites = null;                 // { primary, secondary, visto_em }

function lerTitulos() {
  if (Date.now() - titulosLidosEm < 30 * 1000) return;
  titulosLidosEm = Date.now();
  try {
    const novos = new Map();
    for (const l of fs.readFileSync(INDICE, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const d = JSON.parse(l); if (d.id && d.thread_name) novos.set(d.id, d.thread_name); } catch { /* linha ruim */ }
    }
    titulos = novos;
  } catch { /* sem índice */ }
}

// Pastas de hoje e de ontem (uma sessão pode virar a meia-noite)
function pastasRecentes(agora) {
  const dias = [new Date(agora), new Date(agora - 24 * 3600 * 1000)];
  return dias.map(d => path.join(SESSOES, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')));
}

// ---------------------------------------------------------------------------
// session_meta (1ª linha). Pode passar de 64 KB (instruções embutidas): sem JSON
// completo, os campos saem por regex.
// ---------------------------------------------------------------------------
function lerMeta(arquivo) {
  let texto = '';
  try {
    const fd = fs.openSync(arquivo, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    texto = buf.toString('utf8', 0, n);
  } catch { return null; }
  const fim = texto.indexOf('\n');
  const linha = fim >= 0 ? texto.slice(0, fim) : texto;
  if (!linha.includes('"session_meta"')) return null;
  let p = null;
  try { p = JSON.parse(linha).payload; } catch { /* linha longa ou ainda sendo escrita */ }
  const campo = k => (linha.match(new RegExp(`"${k}":"([^"]*)"`)) || [])[1];
  const meta = p ? {
    id: p.id, cwd: p.cwd, origem: p.thread_source || null,
    pai: p.parent_thread_id || p.source?.subagent?.thread_spawn?.parent_thread_id || null,
    apelido: p.source?.subagent?.thread_spawn?.agent_nickname || null,
    guardiao: p.thread_source === 'guardian_review' || p.source?.subagent?.other === 'guardian',
  } : {
    id: campo('id'), cwd: campo('cwd'), origem: campo('thread_source') || null,
    pai: campo('parent_thread_id') || null, apelido: campo('agent_nickname') || null,
    guardiao: /"thread_source":"guardian_review"|"other":"guardian"/.test(linha),
  };
  return meta.id ? meta : null;
}

// ---------------------------------------------------------------------------
// Ferramentas: atividade e rótulo do balão
// ---------------------------------------------------------------------------
const APPS = ['chatgpt_ads_manager', 'plugin_management', 'google_drive', 'google_calendar', 'github', 'sites', 'figma',
  'gmail', 'slack', 'notion', 'linear', 'canva', 'hubspot', 'dropbox', 'box', 'sharepoint', 'teams', 'outlook'];
const INTERNOS = /^(codex_app|plugin_management|node_repl|clock|computer_use)$/i;
const NOMES = new Map([['chatgpt_ads_manager', 'ChatGPT Ads'], ['github', 'GitHub'], ['google_drive', 'Google Drive'],
  ['google_calendar', 'Google Agenda'], ['magnific', 'Magnific'], ['21st', '21st'], ['figma', 'Figma'], ['sites', 'Sites']]);

// 'mcp__magnific__creations_get' ou namespace 'mcp__codex_apps__github' -> servidor
function servidorMcp(nomeCompleto) {
  const resto = String(nomeCompleto || '').replace(/^mcp__/, '');
  if (resto.startsWith('codex_apps__')) {
    const app = resto.slice('codex_apps__'.length);
    return APPS.find(a => app === a || app.startsWith(a + '_') || app.startsWith(a + '__')) || app.split('_')[0];
  }
  return resto.split('__')[0];
}
const nomeServico = servidor => NOMES.get(servidor) || cfg.nomeCurto(servidor);

// Serviço de trabalho (MCP) a partir do servidor; null para os internos e o navegador
function servicoMcp(servidor) {
  if (!servidor || INTERNOS.test(servidor) || /cua|browser|chrome/i.test(servidor)) return null;
  return { nome: nomeServico(servidor), tipo: 'mcp' };
}

// Comando dentro de um script 'exec' (tools.exec_command({ cmd: "..." }))
function comandosDoScript(texto) {
  const lista = [];
  for (const m of String(texto || '').matchAll(/exec_command\(\s*\{\s*cmd\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g)) {
    const bruto = m[1];
    try { lista.push(bruto[0] === '"' ? JSON.parse(bruto) : bruto.slice(1, -1).replace(/\\n/g, '\n')); } catch { lista.push(bruto.slice(1, -1)); }
  }
  return lista;
}

function argumentos(p) {
  if (typeof p.arguments !== 'string') return p.arguments || {};
  try { return JSON.parse(p.arguments); } catch { return {}; }
}

const EDITAR = rotulo => ({ atividade: 'editar', rotulo });

// Uma chamada de ferramenta (response_item) -> { atividade, rotulo, servico? }
function classificar(p) {
  const nome = p.name || '';
  const ns = p.namespace || '';
  if (p.type === 'web_search_call') return { atividade: 'pesquisar', rotulo: 'Buscando na web' };
  if (/^request_user_input/.test(nome)) return { atividade: 'esperar', rotulo: 'Fazendo uma pergunta' };
  if (/cua|browser|chrome/i.test(ns + ' ' + nome)) return { atividade: 'pesquisar', rotulo: 'Mexendo no navegador' };
  if (p.type === 'custom_tool_call' && nome === 'exec') return classificarScript(p.input);
  if (nome === 'apply_patch') return EDITAR('Editando arquivos');
  if (nome === 'view_image') return EDITAR('Olhando uma imagem');
  if (nome === 'exec_command' || nome === 'write_stdin') {
    const api = cfg.apiDoComando(argumentos(p).cmd);
    return api ? { atividade: 'conector', rotulo: `Chamando ${api} pela API`, servico: { nome: api, tipo: 'api' } } : EDITAR('Rodando um comando');
  }
  if (/collaboration|multi_agent/.test(ns) || /spawn_agent|send_message|wait_agent/.test(nome)) return { atividade: 'coordenar', rotulo: 'Falando com os ajudantes' };
  if (ns.startsWith('mcp__') || nome.startsWith('mcp__')) {
    const s = servicoMcp(servidorMcp(ns || nome));
    return s ? { atividade: 'conector', rotulo: 'Usando ' + s.nome, servico: s } : EDITAR('Usando uma ferramenta');
  }
  if (/sleep|wait/.test(ns + nome)) return EDITAR('Esperando um processo');
  return EDITAR('Trabalhando');
}

// Script 'exec': vale a chamada mais significativa (serviço > busca > API > edição > comando)
function classificarScript(texto) {
  const t = String(texto || '');
  const chamadas = [...t.matchAll(/tools\.([\w$]+)\s*\(/g)].map(m => m[1]);
  for (const c of chamadas) {
    if (!c.startsWith('mcp__')) continue;
    const servidor = servidorMcp(c);
    if (/cua|browser|chrome/i.test(servidor)) return { atividade: 'pesquisar', rotulo: 'Mexendo no navegador' };
    const s = servicoMcp(servidor);
    if (s) return { atividade: 'conector', rotulo: 'Usando ' + s.nome, servico: s };
  }
  if (chamadas.some(c => /^web__/.test(c))) return { atividade: 'pesquisar', rotulo: 'Buscando na web' };
  for (const cmd of comandosDoScript(t)) {
    const api = cfg.apiDoComando(cmd);
    if (api) return { atividade: 'conector', rotulo: `Chamando ${api} pela API`, servico: { nome: api, tipo: 'api' } };
  }
  if (chamadas.some(c => /multi_agent|collaboration/.test(c))) return { atividade: 'coordenar', rotulo: 'Falando com os ajudantes' };
  if (chamadas.includes('apply_patch')) return EDITAR('Editando arquivos');
  if (chamadas.includes('view_image')) return EDITAR('Olhando uma imagem');
  if (chamadas.includes('exec_command') || chamadas.includes('write_stdin')) return EDITAR('Rodando um comando');
  return EDITAR('Rodando um script');
}

// mesma máscara de chaves e tokens do servidor (revisão M-8, verificação v0.6): o balão
// do Codex também nunca mostra nada com cara de segredo
function curto(texto, max = 48) {
  const t = cfg.mascararSegredos(String(texto || '')).replace(/[*_`#>]/g, '').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

// ---------------------------------------------------------------------------
// Estado de cada arquivo
// ---------------------------------------------------------------------------
function novoEstado() {
  return {
    offset: 0, resto: Buffer.alloc(0), iniciado: false, usadoEm: 0, meta: null, tamanho: 0,
    iniciou: 0, terminou: 0, turnoReal: false,
    ultima: null,                  // { atividade, rotulo, servico?, quando, callId }
    respondidas: new Map(),        // call_id -> quando chegou a resposta (últimas 200)
    servicos: [],                  // [{ nome, tipo, quando }] (últimos 10)
    pensamentos: [],               // [{ id, texto }] (últimos 6)
    contexto: null,
    pergunta: null,                // { quando, callId, sincrona } sem resposta
    ultimaFala: null,              // { quando, texto } fim da última fala do assistente (rodada 6)
    ultimoQuando: 0,
  };
}

function lembrarServico(st, s, quando) {
  if (!s) return;
  st.servicos.push({ ...s, quando });
  if (st.servicos.length > 10) st.servicos.shift();
}
function pensar(st, id, texto) {
  if (!texto) return;
  st.pensamentos.push({ id: String(id), texto });
  if (st.pensamentos.length > 6) st.pensamentos.shift();
}

// Linha gigante: só tipo, subtipo e horário por regex
function linhaPorRegex(texto) {
  const cabeca = texto.slice(0, 2048);
  const tipo = (cabeca.match(/"type":"(\w+)"/) || [])[1];
  const sub = (cabeca.match(/"payload":\{"type":"(\w+)"/) || [])[1];
  const ts = (cabeca.match(/"timestamp":"([^"]+)"/) || [])[1];
  return tipo ? { type: tipo, timestamp: ts, payload: { type: sub } } : null;
}

function registrar(st, d) {
  if (!d) return;
  const p = d.payload || {};
  const quando = Date.parse(d.timestamp || '') || 0;
  if (quando > st.ultimoQuando) st.ultimoQuando = quando;

  if (d.type === 'event_msg') {
    switch (p.type) {
      case 'task_started':
        if (String(p.turn_id || '').startsWith('external-import')) return;   // conversa importada
        st.iniciou = quando; st.turnoReal = true; st.pergunta = null;
        return;
      case 'task_complete':
      case 'turn_aborted':
        if (String(p.turn_id || '').startsWith('external-import')) return;
        st.terminou = Math.max(st.terminou, quando);
        st.turnoReal = true;
        if (st.pergunta?.sincrona) st.pergunta.sincrona = false;   // a tarefa acabou: a pergunta segue aberta
        return;
      case 'user_message':
        st.pergunta = null;
        return;
      case 'token_count': {
        const info = p.info || {};
        const rl = p.rate_limits || info.rate_limits;
        if (rl && (rl.primary || rl.secondary) && (!ultimosLimites || quando >= ultimosLimites.visto_em)) {
          ultimosLimites = { primary: rl.primary || null, secondary: rl.secondary || null, visto_em: quando };
        }
        const usado = info.last_token_usage?.total_tokens;
        const janela = info.model_context_window;
        if (usado && janela) st.contexto = Math.min(100, Math.round((usado / janela) * 100));
        return;
      }
      case 'item_completed': {
        const it = p.item || {};
        if (it.type === 'UserMessage') st.pergunta = null;
        else if (it.type === 'McpToolCall') lembrarServico(st, servicoMcp(String(it.server || '')), quando);
        else if (it.type === 'CommandExecution') {
          const cmd = Array.isArray(it.command) ? it.command[it.command.length - 1] : it.command;
          const api = cfg.apiDoComando(cmd);
          if (api) lembrarServico(st, { nome: api, tipo: 'api' }, quando);
        }
        return;
      }
      default: return;
    }
  }

  if (d.type !== 'response_item') return;
  if (['function_call', 'custom_tool_call', 'web_search_call'].includes(p.type)) {
    const c = classificar(p);
    const callId = p.call_id || p.id || String(quando);
    st.ultima = { ...c, quando, callId };
    if (c.servico) lembrarServico(st, c.servico, quando);
    if (c.atividade === 'esperar') st.pergunta = { quando, callId, sincrona: p.name === 'request_user_input' };
    pensar(st, callId, curto(c.rotulo));
  } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
    if (p.call_id) {
      st.respondidas.set(p.call_id, quando);
      if (st.respondidas.size > 200) st.respondidas.delete(st.respondidas.keys().next().value);
      // pergunta síncrona respondida
      if (st.pergunta?.sincrona && st.pergunta.callId === p.call_id) st.pergunta = null;
    }
  } else if (p.type === 'message' && p.role === 'assistant') {
    const texto = (p.content || []).map(c => c.text || '').join(' ').trim();
    if (!texto || texto.startsWith('[external_agent')) return;
    st.ultimaFala = { quando, texto: texto.slice(-400) };
    const frase = texto.split(/(?<=[.!?:])\s/)[0];
    if (!cfg.ehPortugues(frase)) return;
    pensar(st, p.id || quando, curto(cfg.limparMarca(frase), 60));
  }
}

function processarLinhas(st, buf) {
  let inicio = 0;
  for (;;) {
    const fim = buf.indexOf(10, inicio);
    if (fim < 0) break;
    const linha = buf.subarray(inicio, fim);
    inicio = fim + 1;
    if (!linha.length) continue;
    if (linha.length > LINHA_GRANDE) { registrar(st, linhaPorRegex(linha.toString('utf8'))); continue; }
    try { registrar(st, JSON.parse(linha.toString('utf8'))); } catch { /* linha ruim */ }
  }
  return buf.subarray(inicio);
}

function ler(fd, de, ate) {
  const buf = Buffer.alloc(Math.max(0, ate - de));
  let lido = 0;
  while (lido < buf.length) {
    const n = fs.readSync(fd, buf, lido, buf.length - lido, de + lido);
    if (!n) break;
    lido += n;
  }
  return buf.subarray(0, lido);
}

// Lê o que falta do arquivo (incremental); arquivo encolheu: recomeça
function avancar(arquivo, st, tamanho) {
  if (tamanho < st.offset) Object.assign(st, novoEstado(), { meta: st.meta });
  if (st.iniciado && tamanho === st.offset) return;
  let fd;
  try { fd = fs.openSync(arquivo, 'r'); } catch { return; }
  try {
    if (!st.iniciado) {
      // primeira leitura: o fim do arquivo, até achar começo ou fim de tarefa
      let escolhido = null;
      for (const janela of JANELAS_INICIAIS) {
        const de = Math.max(0, tamanho - janela);
        const buf = ler(fd, de, tamanho);
        escolhido = { de, buf };
        if (de === 0 || buf.includes('"task_started"') || buf.includes('"task_complete"')) break;
      }
      let buf = escolhido.buf;
      if (escolhido.de > 0) { const nl = buf.indexOf(10); buf = nl >= 0 ? buf.subarray(nl + 1) : Buffer.alloc(0); }
      st.resto = Buffer.from(processarLinhas(st, buf));
      st.offset = escolhido.de + escolhido.buf.length;
      st.iniciado = true;
      return;
    }
    const ate = Math.min(tamanho, st.offset + MAX_POR_LEITURA);
    const novo = ler(fd, st.offset, ate);
    st.offset += novo.length;
    st.resto = Buffer.from(processarLinhas(st, Buffer.concat([st.resto, novo])));
  } finally { fs.closeSync(fd); }
}

// ---------------------------------------------------------------------------
// Agentes
// ---------------------------------------------------------------------------
function servicoRecente(st, agora) {
  for (let i = st.servicos.length - 1; i >= 0; i--) {
    const s = st.servicos[i];
    if (agora - s.quando <= JANELA_SERVICO_MS) return s;
  }
  return null;
}

function derivar(st, agora) {
  const u = st.ultima;
  const s = servicoRecente(st, agora);
  if (s) return { atividade: 'conector', texto: s.tipo === 'api' ? `usando ${s.nome} pela API` : 'usando ' + s.nome, conector: s.nome, conectorTipo: s.tipo };
  if (!u || u.quando < st.iniciou) return { atividade: 'editar', texto: 'lendo seu pedido', conector: null, conectorTipo: null };
  const respondida = st.respondidas.get(u.callId);
  if (respondida && agora - respondida > PENSANDO_MS) return { atividade: 'editar', texto: 'pensando na resposta', conector: null, conectorTipo: null };
  const atividade = u.atividade === 'conector' || u.atividade === 'esperar' ? 'editar' : u.atividade;
  const textos = { pesquisar: u.rotulo === 'Mexendo no navegador' ? 'usando o navegador' : 'pesquisando na web',
    coordenar: 'acompanhando os ajudantes', editar: 'trabalhando na mesa' };
  return { atividade, texto: textos[atividade] || 'trabalhando na mesa', conector: null, conectorTipo: null };
}

export function agentesCodex(agora = Date.now()) {
  lerTitulos();
  const agentes = [];
  const vistos = new Set();
  for (const dir of pastasRecentes(agora)) {
    let arquivos = [];
    try { arquivos = fs.readdirSync(dir).filter(a => a.endsWith('.jsonl')); } catch { continue; }
    for (const a of arquivos) {
      const arquivo = path.join(dir, a);
      let stat;
      try { stat = fs.statSync(arquivo); } catch { continue; }
      if (agora - stat.mtimeMs > PERGUNTA_MS) continue;
      let st = estados.get(arquivo);
      if (!st) { st = novoEstado(); estados.set(arquivo, st); }
      st.usadoEm = agora;
      vistos.add(arquivo);
      if (!st.meta) st.meta = lerMeta(arquivo);
      const meta = st.meta;
      if (!meta || meta.guardiao) continue;
      avancar(arquivo, st, stat.size);
      if (!st.turnoReal) continue;   // só conversa importada, sem trabalho no Codex

      const ultimaEscrita = Math.max(stat.mtimeMs, st.ultimoQuando);
      const travou = st.iniciou > st.terminou && agora - ultimaEscrita > TRAVADO_MS;
      const trabalhando = st.iniciou > st.terminou && !travou;
      const perguntaAberta = st.pergunta && agora - st.pergunta.quando <= PERGUNTA_MS
        && (!trabalhando || (st.pergunta.sincrona && st.ultima?.callId === st.pergunta.callId));
      const subagente = Boolean(meta.pai);
      let d;
      let paradoHaMs = null;
      let pendencia = null, pendenteHaMs = null;
      if (perguntaAberta) {
        d = { atividade: 'esperar', texto: 'tem uma pergunta para você', conector: null, conectorTipo: null };
        if (!subagente) { pendencia = 'precisa_de_voce'; pendenteHaMs = Math.max(0, agora - st.pergunta.quando); }
      } else if (trabalhando) {
        d = derivar(st, agora);
      } else {
        paradoHaMs = Math.max(0, agora - (travou ? ultimaEscrita : (st.terminou || ultimaEscrita)));
        // terminou a tarefa com uma fala que oferece o próximo passo (heurística):
        // fila da revisão por até 30 min (a mesma janela da pergunta)
        const fala = st.ultimaFala;
        if (!subagente && !travou && st.terminou && fala && fala.quando >= st.iniciou
          && paradoHaMs <= PERGUNTA_MS && cfg.terminaComOferta(fala.texto)) {
          d = { atividade: 'revisar', texto: 'terminou com uma sugestão', conector: null, conectorTipo: null };
          pendencia = 'entrega_com_sugestao';
          pendenteHaMs = paradoHaMs;
        } else {
          if (paradoHaMs > JANELA_VIDA_MS) continue;
          d = { atividade: 'descansar', texto: 'descansando', conector: null, conectorTipo: null };
        }
      }
      const pasta = path.basename(meta.cwd || '') || 'Codex';
      const titulo = titulos.get(meta.id);
      agentes.push({
        id: 'codex:' + meta.id,
        nome: cfg.limparMarca(titulo || (subagente ? (meta.apelido || 'Ajudante') : pasta)) || pasta,
        tipo: subagente ? 'subagente' : 'sessao',
        ...(subagente ? { pai: 'codex:' + meta.pai } : {}),
        pasta, pastaCaminho: meta.cwd || '',
        atividade: d.atividade, texto: d.texto, conector: d.conector, conectorTipo: d.conectorTipo,
        ferramenta: st.ultima?.rotulo || null,
        pensamentos: d.atividade === 'descansar' ? [] : st.pensamentos.slice(-6),
        paradoHaMs,
        aguardando: d.atividade === 'esperar' ? 'pergunta' : null,
        terminou: subagente && d.atividade === 'descansar',
        provedor: 'openai',
        contexto: st.contexto,
        // rodada 6: filas da sala do dono e da revisão; o Codex abre por codex://threads/<id>
        pendencia, pendenteHaMs, abrivel: !subagente,
      });
    }
  }
  // esquece arquivos que saíram da janela
  for (const k of [...estados.keys()]) if (!vistos.has(k) && agora - estados.get(k).usadoEm > 10 * 60 * 1000) estados.delete(k);
  // subagente sem a mãe na lista nasce pela porta (agentes.js); a mãe parada continua
  return agentes;
}

// ---------------------------------------------------------------------------
// Limites (rate_limits). Sem sessão recente lida, procura no arquivo mais novo dos
// últimos 7 dias (só o fim dele, 2 MB). Cache de 60 s.
// ---------------------------------------------------------------------------
let limitesProcuradosEm = 0;
function procurarLimites(agora) {
  if (agora - limitesProcuradosEm < 60 * 1000) return;
  limitesProcuradosEm = agora;
  let melhor = null;
  for (let k = 0; k < 7 && !melhor; k++) {
    const d = new Date(agora - k * 24 * 3600 * 1000);
    const dir = path.join(SESSOES, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    let nomes = [];
    try { nomes = fs.readdirSync(dir).filter(a => a.endsWith('.jsonl')); } catch { continue; }
    for (const n of nomes) {
      try { const m = fs.statSync(path.join(dir, n)).mtimeMs; if (!melhor || m > melhor.m) melhor = { arq: path.join(dir, n), m }; } catch { /* sumiu */ }
    }
  }
  if (!melhor) return;
  try {
    const fd = fs.openSync(melhor.arq, 'r');
    const { size } = fs.fstatSync(fd);
    const buf = ler(fd, Math.max(0, size - 2 * 1024 * 1024), size);
    fs.closeSync(fd);
    const texto = buf.toString('utf8');
    const i = texto.lastIndexOf('"rate_limits":{');
    if (i < 0) return;
    const ini = texto.lastIndexOf('\n', i) + 1, fim = texto.indexOf('\n', i);
    const d = JSON.parse(texto.slice(ini, fim < 0 ? undefined : fim));
    const rl = d.payload?.rate_limits || d.payload?.info?.rate_limits;
    const quando = Date.parse(d.timestamp || '') || melhor.m;
    if (rl && (!ultimosLimites || quando > ultimosLimites.visto_em)) ultimosLimites = { primary: rl.primary || null, secondary: rl.secondary || null, visto_em: quando };
  } catch { /* arquivo sendo escrito */ }
}

export function limitesCodex(agora = Date.now()) {
  if (!ultimosLimites) procurarLimites(agora);
  return ultimosLimites;
}
