// Fonte da Portaria dos conectores: cada conector MCP que o Claude e o Codex
// conhecem nesta máquina e o estado dele (conectado, precisa autorizar, falhou,
// desativado ou desconhecido), mais quando foi usado pela última vez.
// Só leitura. Nada aqui lê, guarda ou devolve token, chave, senha ou URL com
// parâmetros: dos endereços sai no máximo o host.
//
// CONTRATO de GET /api/portaria
//   { conectores, fonteDoEstado, geradoEm, janelaUsoHoras, resumo }
//   conector = { id, nome, conta, origem, estado, detalhe, usadoEm, estadoVistoEm }
//     id: 'claude.ai:<uuid>' | 'local:<nome>' | 'plugin:<pacote>:<nome>' | 'codex:<nome>'
//     nome: nome escrito do serviço (sem sufixo de conta, sem logo, sem a marca da casa)
//     conta: sufixo de conta quando ajuda a distinguir ('Unifacha') ou null
//     origem: 'claude.ai' | 'local' | 'plugin' | 'codex'
//     estado: 'conectado' | 'precisa-autorizar' | 'falhou' | 'desativado' | 'desconhecido'
//     detalhe: frase curta em português, sem travessão
//     usadoEm: ISO (UTC) da última chamada vista nas transcrições da janela de uso, ou null
//     estadoVistoEm: ISO (UTC) do aviso que deu o estado, ou null
//   fonteDoEstado: frase que diz de onde veio o estado e de quando (horário de Brasília)
//   resumo: { conectado, precisa-autorizar, falhou, desativado, desconhecido, usadosNaJanela }
//
// DE ONDE VEM O ESTADO
// 1. Avisos estruturados nas transcrições do Claude Code
//    (~/.claude/projects/<pasta>/<sessão>.jsonl): linhas
//    { type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames,
//      removedNames, readdedNames, needsAuthMcpServers, pendingMcpServers,
//      failedMcpServers: [{ name, errorCode, error }] } }.
//    O app grava um no começo de cada sessão e outro sempre que a lista de ferramentas
//    muda. É o mesmo aviso que a sessão recebe ("require authentication", "failed to
//    connect"). Ferramentas acumuladas (adicionadas menos removidas) = conectado.
//    Vale o aviso mais recente de cada servidor entre as sessões das últimas 48 h.
// 2. Catálogo dos conectores da claude.ai: remoteMcpServersConfig (uuid, nome, url)
//    em ~/Library/Application Support/Claude/claude-code-sessions/**/local_*.json.
//    O arquivo mais novo da conta mais recente dá a lista atual da conta.
// 3. Desligados: ~/Library/Application Support/Claude/mcp-user-tool-toggles.json
//    (ferramentas desligadas por conta). Todas as ferramentas desligadas = desativado.
// 4. Servidores locais: nomes em mcpServers (global e por pasta) de ~/.claude.json
//    (só os nomes; nunca url, headers ou env) e disabledMcpServers por pasta.
// 5. Codex: [mcp_servers.<nome>] e enabled = false de ~/.codex/config.toml (só o nome
//    da seção e a chave enabled). O Codex não grava o estado da conexão; quem respondeu
//    numa sessão recente (mcp_attribution nas transcrições) conta como conectado.
// Respeita CLAUDE_CONFIG_DIR e CODEX_HOME.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PASTA_DESKTOP } from './plataforma.js';

const HOME = os.homedir();
const CLAUDE = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(HOME, '.claude');
const ARQUIVO_CONTA = process.env.CLAUDE_CONFIG_DIR ? path.join(CLAUDE, '.claude.json') : path.join(HOME, '.claude.json');
const CODEX = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(HOME, '.codex');
const DESKTOP = PASTA_DESKTOP;
const SESSOES_DESKTOP = path.join(DESKTOP, 'claude-code-sessions');
const TOGGLES = path.join(DESKTOP, 'mcp-user-tool-toggles.json');

const CACHE_MS = 30 * 1000;
const JANELA_ESTADO_MS = 48 * 3600 * 1000;    // avisos de estado: sessões das últimas 48 h
const JANELA_USO_MS = 48 * 3600 * 1000;       // "usado recentemente": últimas 48 h
const CABECA_CATALOGO = 512 * 1024;
const BLOCO = 8 * 1024 * 1024;
const FUSO = 'America/Sao_Paulo';

// ---------------------------------------------------------------------------
// Nomes
// ---------------------------------------------------------------------------
const CODIGO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ferramentas do próprio app, do navegador e do terminal: não são conectores de trabalho
const INTERNOS = /^(ccd_|scheduled-tasks|mcp-registry|visualize$|terminal$|claude[_-]|computer-use|Framebuffer|Window_Halo|session_info|skills$|dispatch$|cowork$|node_repl$|codex_apps?$|cua_repl$)/i;
const MARCA = /astronauta/i;
const APELIDOS = new Map([
  ['rdstationmarketing', 'RD Marketing'], ['rdmarketing', 'RD Marketing'],
  ['rdstationcrm', 'RD CRM'], ['rdcrm', 'RD CRM'],
  ['rdstationconversas', 'RD Conversas'], ['rdconversas', 'RD Conversas'],
  ['reporteiflux', 'Reportei Flux'], ['googleads', 'Google Ads'], ['21st', '21st'],
  ['getlayers', 'GetLayers'], ['llmpulse', 'LLM Pulse'], ['contasimples', 'Conta Simples'],
  ['supermetricsmarketinganalytics', 'Supermetrics'], ['cloudflaredeveloperplatform', 'Cloudflare'],
  ['elevenlabs', 'ElevenLabs'], ['chatgptads', 'ChatGPT Ads'], ['metaads', 'Meta Ads'],
  ['bigquery', 'BigQuery'], ['googlecloudbigquery', 'BigQuery'], ['amplitudeeu', 'Amplitude EU'],
]);

// 'RD CRM da Unifacha' -> { nome: 'RD CRM', conta: 'Unifacha' }; a marca da casa nunca sai
function separarNome(bruto) {
  let t = String(bruto || '')
    .replace(/^claude\.ai\s+/i, '')
    .replace(/^plugin[_:][^_:]+[_:]/i, '')
    .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  let conta = null;
  const m = t.match(/^(.+?)\s+(?:da|do|de)\s+([^\s]+)$/i);
  if (m && m[1].length >= 2) { t = m[1]; conta = m[2]; }
  t = t.replace(/\s*\bmcp$/i, '').replace(/^mcp\s+/i, '').trim();
  if (!t || CODIGO.test(t.replace(/ /g, '-'))) return { nome: 'Conector sem nome', conta: null };
  const apelido = APELIDOS.get(t.toLowerCase().replace(/\s+/g, ''));
  if (apelido) t = apelido;
  else t = t.split(' ').map(p => (p === p.toLowerCase() ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(' ');
  if (MARCA.test(t)) t = 'Conector sem nome';
  if (conta && MARCA.test(conta)) conta = null;
  else if (conta) conta = conta.charAt(0).toUpperCase() + conta.slice(1);
  return { nome: t, conta };
}

const chaveNome = n => separarNome(n).nome.toLowerCase() + '|' + (separarNome(n).conta || '').toLowerCase();
const servidorDe = ferramenta => (String(ferramenta).startsWith('mcp__') ? String(ferramenta).split('__')[1] || '' : '');
// 'plugin_data_definite' (nome de ferramenta) e 'plugin:data:definite' (aviso) são o mesmo
const normalizarServidor = s => String(s || '').replace(/^plugin_([^_]+)_/, 'plugin:$1:');

// tira parâmetros de qualquer URL que apareça em mensagem de erro
const semSegredos = texto => String(texto || '').replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1').slice(0, 200);

const quando = ms => new Date(ms).toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');

// ---------------------------------------------------------------------------
// Catálogo da claude.ai (remoteMcpServersConfig), com cache por arquivo
// ---------------------------------------------------------------------------
const catalogoPorArquivo = new Map();   // arquivo -> { mtime, tamanho, conta, itens: [{ uuid, nome, host, nFerr }] }

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

async function itensDoArquivo(arquivo, tamanho) {
  const fh = await fsp.open(arquivo, 'r');
  try {
    const cabeca = Buffer.alloc(Math.min(tamanho, CABECA_CATALOGO));
    const { bytesRead } = await fh.read(cabeca, 0, cabeca.length, 0);
    let texto = cabeca.subarray(0, bytesRead).toString('utf8');
    const chave = '"remoteMcpServersConfig"';
    let i = texto.indexOf(chave);
    if (i < 0) return [];
    let lista = recortarArray(texto, i + chave.length);
    if (!lista && tamanho > bytesRead) {
      texto = await fsp.readFile(arquivo, 'utf8');
      i = texto.indexOf(chave);
      lista = i < 0 ? null : recortarArray(texto, i + chave.length);
    }
    if (!lista) return [];
    const itens = [];
    for (const c of JSON.parse(lista)) {
      if (!c?.uuid || !c?.name) continue;
      let host = null;
      try { host = new URL(String(c.url)).host; } catch {}
      itens.push({ uuid: String(c.uuid), nome: String(c.name), host, nFerr: Array.isArray(c.tools) ? c.tools.length : null });
    }
    return itens;
  } finally { await fh.close(); }
}

async function lerCatalogo() {
  const vistos = new Set();
  const visitar = async (dir, prof, conta) => {
    let itens = [];
    try { itens = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory() && prof < 3) await visitar(p, prof + 1, conta ?? it.name);
      else if (it.isFile() && /^local_.*\.json$/.test(it.name)) {
        vistos.add(p);
        let st;
        try { st = await fsp.stat(p); } catch { continue; }
        const c = catalogoPorArquivo.get(p);
        if (c && c.mtime === st.mtimeMs && c.tamanho === st.size) continue;
        let lista = [];
        try { lista = await itensDoArquivo(p, st.size); } catch {}
        catalogoPorArquivo.set(p, { mtime: st.mtimeMs, tamanho: st.size, conta, itens: lista });
      }
    }
  };
  await visitar(SESSOES_DESKTOP, 0, null);
  for (const k of [...catalogoPorArquivo.keys()]) if (!vistos.has(k)) catalogoPorArquivo.delete(k);

  const arquivos = [...catalogoPorArquivo.values()].filter(c => c.itens.length).sort((a, b) => a.mtime - b.mtime);
  const porUuid = new Map();
  for (const c of arquivos) for (const it of c.itens) porUuid.set(it.uuid, { ...it, conta: c.conta });
  const maisNovo = arquivos[arquivos.length - 1] || null;
  return { porUuid, lista: maisNovo ? maisNovo.itens : [], conta: maisNovo?.conta || null, atualizadoEm: maisNovo?.mtime || null };
}

// Ferramentas desligadas por conta: { conta: Map(uuid -> quantas) }
function lerDesligadas(conta) {
  const porServidor = new Map();
  try {
    const d = JSON.parse(fs.readFileSync(TOGGLES, 'utf8'));
    const lista = d?.owners?.[conta];
    if (Array.isArray(lista)) for (const x of lista) {
      const s = String(x).split(':')[0];
      porServidor.set(s, (porServidor.get(s) || 0) + 1);
    }
  } catch {}
  return porServidor;
}

// ---------------------------------------------------------------------------
// Varredura das transcrições (Claude e Codex), incremental por arquivo
// ---------------------------------------------------------------------------
// Cache por arquivo: offset lido até a última quebra de linha e o que foi achado.
const transcricoes = new Map();   // arquivo -> { tamanho, offset, usos: Map(servidor -> ms), avisos: [] , ferramentas: Set }

const B_USO_CLAUDE = Buffer.from('"type":"tool_use","id":"');
const B_DELTA = Buffer.from('"type":"deferred_tools_delta"');
const B_USO_CODEX = Buffer.from('"mcp_attribution":{"status":"complete","sources":[');
const B_TS = Buffer.from('"timestamp":"');
const NL = 0x0a;

function tsDaLinha(buf, ini, fim) {
  const i = buf.indexOf(B_TS, ini);
  if (i < 0 || i > fim) return null;
  const a = i + B_TS.length, b = buf.indexOf(0x22, a);
  if (b < 0 || b > fim) return null;
  const ms = Date.parse(buf.toString('latin1', a, b));
  return Number.isFinite(ms) ? ms : null;
}

// Procura os padrões no trecho [0, fim) de buf (fim = depois da última quebra de linha)
function varrerTrecho(buf, fim, reg, codex) {
  const anotarUso = (servidor, ms) => {
    if (!servidor || ms == null) return;
    if ((reg.usos.get(servidor) || 0) < ms) reg.usos.set(servidor, ms);
  };
  if (codex) {
    let i = 0;
    while ((i = buf.indexOf(B_USO_CODEX, i)) >= 0 && i < fim) {
      const ini = buf.lastIndexOf(NL, i) + 1, fl = buf.indexOf(NL, i);
      const fimLinha = fl < 0 || fl > fim ? fim : fl;
      const ms = tsDaLinha(buf, ini, fimLinha);
      const trecho = buf.toString('utf8', i, Math.min(fimLinha, i + 4000));
      for (const m of trecho.matchAll(/"server_name":"([^"]+)"/g)) anotarUso(m[1], ms);
      i = fimLinha;
    }
    return;
  }
  let i = 0;
  while ((i = buf.indexOf(B_USO_CLAUDE, i)) >= 0 && i < fim) {
    // "type":"tool_use","id":"toolu_...","name":"mcp__<servidor>__<ferramenta>"
    const trecho = buf.toString('latin1', i, Math.min(fim, i + 400));
    const m = trecho.match(/^"type":"tool_use","id":"[^"]*","name":"mcp__([^"]+?)__/);
    if (m) {
      const ini = buf.lastIndexOf(NL, i) + 1, fl = buf.indexOf(NL, i);
      anotarUso(normalizarServidor(m[1]), tsDaLinha(buf, ini, fl < 0 || fl > fim ? fim : fl));
    }
    i += B_USO_CLAUDE.length;
  }
  i = 0;
  while ((i = buf.indexOf(B_DELTA, i)) >= 0 && i < fim) {
    const ini = buf.lastIndexOf(NL, i) + 1, fl = buf.indexOf(NL, i);
    const fimLinha = fl < 0 || fl > fim ? fim : fl;
    try {
      const d = JSON.parse(buf.toString('utf8', ini, fimLinha));
      const a = d.attachment || {};
      for (const n of a.removedNames || []) reg.ferramentas.delete(n);
      for (const n of [...(a.addedNames || []), ...(a.readdedNames || [])]) reg.ferramentas.add(n);
      reg.aviso = {
        ms: Date.parse(d.timestamp) || null,
        cwd: typeof d.cwd === 'string' ? d.cwd : null,
        precisaAutorizar: (a.needsAuthMcpServers || []).map(String),
        pendentes: (a.pendingMcpServers || []).map(String),
        falharam: (a.failedMcpServers || []).map(f => ({ nome: String(f?.name || ''), codigo: String(f?.errorCode || ''), erro: semSegredos(f?.error) })),
      };
    } catch {}
    i = fimLinha;
  }
}

async function varrerArquivo(arquivo, st, codex) {
  let reg = transcricoes.get(arquivo);
  if (!reg || st.size < reg.offset) {   // novo ou reescrito
    reg = { tamanho: 0, offset: 0, usos: new Map(), ferramentas: new Set(), aviso: null };
    transcricoes.set(arquivo, reg);
  }
  reg.mtime = st.mtimeMs;
  if (st.size === reg.offset) return reg;
  const fh = await fsp.open(arquivo, 'r');
  try {
    let pos = reg.offset, resto = Buffer.alloc(0);
    while (pos < st.size) {
      const n = Math.min(BLOCO, st.size - pos);
      const bloco = Buffer.alloc(n);
      const { bytesRead } = await fh.read(bloco, 0, n, pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const buf = resto.length ? Buffer.concat([resto, bloco.subarray(0, bytesRead)]) : bloco.subarray(0, bytesRead);
      const ultimaNl = buf.lastIndexOf(NL);
      if (ultimaNl < 0) { resto = buf; continue; }
      varrerTrecho(buf, ultimaNl + 1, reg, codex);
      resto = buf.subarray(ultimaNl + 1);
      reg.offset = pos - resto.length;
    }
  } finally { await fh.close(); }
  reg.tamanho = st.size;
  return reg;
}

async function listarRecentes(raiz, filtro, desde, maxProf) {
  const achados = [];
  const visitar = async (dir, prof) => {
    let itens = [];
    try { itens = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory() && prof < maxProf) await visitar(p, prof + 1);
      else if (it.isFile() && filtro(it.name, prof)) {
        try { const st = await fsp.stat(p); if (st.mtimeMs >= desde) achados.push({ p, st, prof }); } catch {}
      }
    }
  };
  await visitar(raiz, 0);
  return achados;
}

async function lerTranscricoes(agora) {
  const desde = agora - Math.max(JANELA_ESTADO_MS, JANELA_USO_MS);
  const claude = await listarRecentes(path.join(CLAUDE, 'projects'), n => n.endsWith('.jsonl'), desde, 5);
  // Codex: sessions/AAAA/MM/DD/rollout-*.jsonl
  const codex = await listarRecentes(path.join(CODEX, 'sessions'), n => n.startsWith('rollout-') && n.endsWith('.jsonl'), desde, 3);
  const vivos = new Set([...claude, ...codex].map(x => x.p));
  for (const k of [...transcricoes.keys()]) if (!vivos.has(k)) transcricoes.delete(k);
  const sessoes = [];
  for (const { p, st, prof } of claude) {
    const reg = await varrerArquivo(p, st, false);
    // avisos de estado só nas sessões principais (projects/<pasta>/<sessão>.jsonl)
    if (prof === 1 && reg.aviso) sessoes.push({ arquivo: p, ...reg.aviso, ferramentas: reg.ferramentas });
  }
  for (const { p, st } of codex) await varrerArquivo(p, st, true);
  const usosClaude = new Map(), usosCodex = new Map();
  for (const [arq, reg] of transcricoes) {
    const alvo = arq.startsWith(path.join(CODEX, 'sessions')) ? usosCodex : usosClaude;
    for (const [s, ms] of reg.usos) if (ms >= agora - JANELA_USO_MS && (alvo.get(s) || 0) < ms) alvo.set(s, ms);
  }
  sessoes.sort((a, b) => (b.ms || 0) - (a.ms || 0));
  return { sessoes: sessoes.filter(s => s.ms && s.ms >= agora - JANELA_ESTADO_MS), usosClaude, usosCodex };
}

// ---------------------------------------------------------------------------
// Configuração local (Claude Code) e Codex: só nomes e chaves de liga/desliga
// ---------------------------------------------------------------------------
function lerLocais() {
  const locais = new Map();   // nome -> { pastas: [], global, desativadoEm: [] }
  try {
    const d = JSON.parse(fs.readFileSync(ARQUIVO_CONTA, 'utf8'));
    const anotar = (nome, pasta) => {
      const r = locais.get(nome) || { pastas: [], global: false, desativadoEm: [] };
      if (pasta) r.pastas.push(pasta); else r.global = true;
      locais.set(nome, r);
    };
    for (const nome of Object.keys(d?.mcpServers || {})) anotar(nome, null);
    for (const [pasta, cfg] of Object.entries(d?.projects || {})) {
      for (const nome of Object.keys(cfg?.mcpServers || {})) anotar(nome, pasta);
      for (const nome of Array.isArray(cfg?.disabledMcpServers) ? cfg.disabledMcpServers : []) {
        const r = locais.get(nome);
        if (r) r.desativadoEm.push(pasta);
      }
    }
  } catch {}
  return locais;
}

function lerCodex() {
  const servidores = new Map();   // nome -> { ativo }
  let texto = '';
  try { texto = fs.readFileSync(path.join(CODEX, 'config.toml'), 'utf8'); } catch { return servidores; }
  let atual = null;
  for (const linha of texto.split('\n')) {
    const sec = linha.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sec) {
      const m = sec[1].match(/^mcp_servers\.("?)([^".]+)\1$/);
      atual = m ? m[2] : null;
      if (atual && !servidores.has(atual)) servidores.set(atual, { ativo: true });
      continue;
    }
    if (atual) {
      const en = linha.match(/^\s*enabled\s*=\s*(true|false)\b/);
      if (en) servidores.get(atual).ativo = en[1] === 'true';
    }
  }
  return servidores;
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------
const ERROS = {
  ENDPOINT_NOT_FOUND: 'endereço do servidor não encontrado',
  CONNECTION_REFUSED: 'servidor recusou a conexão',
  TIMEOUT: 'servidor não respondeu a tempo',
  UNAUTHORIZED: 'acesso negado',
};
const pastaCurta = p => (p ? path.basename(p) || p : '');

async function montar() {
  const agora = Date.now();
  const [catalogo, transc] = await Promise.all([lerCatalogo(), lerTranscricoes(agora)]);
  const desligadas = lerDesligadas(catalogo.conta);
  const locais = lerLocais();
  const codexCfg = lerCodex();

  // estado por servidor: vale a sessão mais recente que fala dele
  const estadoDe = new Map();   // chave do servidor -> { estado, detalhe, ms, cwd }
  const porNomeClaudeAi = new Map(catalogo.lista.map(c => [chaveNome(c.nome), c.uuid]));
  const chaveDoServidor = s => {
    s = normalizarServidor(s);
    if (/^claude\.ai\s+/i.test(s)) return porNomeClaudeAi.get(chaveNome(s)) || 'claude.ai:' + chaveNome(s);
    return s;
  };
  for (const ses of transc.sessoes) {   // da mais nova para a mais antiga
    const anotar = (s, estado, detalhe) => {
      const k = chaveDoServidor(s);
      if (!k || estadoDe.has(k)) return;
      estadoDe.set(k, { estado, detalhe, ms: ses.ms, cwd: ses.cwd });
    };
    for (const f of ses.falharam) anotar(f.nome, 'falhou', ERROS[f.codigo] ? `${ERROS[f.codigo]} (${f.codigo})` : (f.codigo || f.erro || 'falhou ao conectar'));
    for (const s of ses.precisaAutorizar) anotar(s, 'precisa-autorizar', null);
    for (const s of ses.pendentes) anotar(s, 'pendente', null);
    const nFerr = new Map();
    for (const n of ses.ferramentas) { const s = normalizarServidor(servidorDe(n)); if (s) nFerr.set(s, (nFerr.get(s) || 0) + 1); }
    for (const [s, n] of nFerr) anotar(s, 'conectado', `${n} ${n === 1 ? 'ferramenta' : 'ferramentas'}`);
  }

  const conectores = [];
  const iso = ms => (ms ? new Date(ms).toISOString() : null);

  // 1. claude.ai: lista atual da conta
  for (const c of catalogo.lista) {
    const { nome, conta } = separarNome(c.nome);
    if (INTERNOS.test(c.nome)) continue;
    const e = estadoDe.get(c.uuid) || estadoDe.get('claude.ai:' + chaveNome(c.nome));
    const off = desligadas.get(c.uuid) || 0;
    let estado, detalhe;
    if (c.nFerr && off >= c.nFerr) { estado = 'desativado'; detalhe = 'todas as ferramentas desligadas no app'; }
    else if (e?.estado === 'falhou') { estado = 'falhou'; detalhe = e.detalhe; }
    else if (e?.estado === 'precisa-autorizar') { estado = 'precisa-autorizar'; detalhe = 'pede login em claude.ai, Configurações, Conectores'; }
    else if (e?.estado === 'conectado') { estado = 'conectado'; detalhe = e.detalhe + (off ? `, ${off} desligadas` : ''); }
    else if (e?.estado === 'pendente') { estado = 'desconhecido'; detalhe = 'ainda conectando no último aviso'; }
    else { estado = 'desconhecido'; detalhe = 'não apareceu nas sessões das últimas 48 h'; }
    const usado = transc.usosClaude.get(c.uuid) || null;
    conectores.push({ id: 'claude.ai:' + c.uuid, nome, conta, origem: 'claude.ai', estado, detalhe, usadoEm: iso(usado), estadoVistoEm: iso(e?.ms) });
  }

  // 2. servidores locais e de plugin que apareceram nas sessões ou estão configurados
  const nomesLocais = new Set([...locais.keys()]);
  for (const k of estadoDe.keys()) if (!CODIGO.test(k) && !k.startsWith('claude.ai:')) nomesLocais.add(k);
  for (const s of transc.usosClaude.keys()) if (!CODIGO.test(s)) nomesLocais.add(s);
  for (const s of nomesLocais) {
    if (INTERNOS.test(s)) continue;
    const plugin = s.startsWith('plugin:');
    const cfg = locais.get(s);
    const e = estadoDe.get(s);
    const { nome, conta } = separarNome(s);
    let estado, detalhe;
    const ondeCfg = cfg ? (cfg.global ? 'todas as pastas' : cfg.pastas.map(pastaCurta).join(', ')) : null;
    if (cfg && cfg.desativadoEm.length && !cfg.global && cfg.desativadoEm.length >= cfg.pastas.length) { estado = 'desativado'; detalhe = 'desligado na configuração da pasta'; }
    else if (e?.estado === 'falhou') { estado = 'falhou'; detalhe = e.detalhe; }
    else if (e?.estado === 'precisa-autorizar') { estado = 'precisa-autorizar'; detalhe = 'pede login: /mcp no Claude Code'; }
    else if (e?.estado === 'conectado') { estado = 'conectado'; detalhe = e.detalhe; }
    else if (e?.estado === 'pendente') { estado = 'desconhecido'; detalhe = 'ainda conectando no último aviso'; }
    else { estado = 'desconhecido'; detalhe = ondeCfg ? `configurado em ${ondeCfg}, sem sessão recente lá` : 'sem aviso recente'; }
    if (plugin) detalhe += `, plugin ${s.split(':')[1]}`;
    else if (cfg && !cfg.global && estado !== 'desconhecido') detalhe += `, só em ${ondeCfg}`;
    conectores.push({ id: plugin ? s : 'local:' + s, nome, conta, origem: plugin ? 'plugin' : 'local', estado, detalhe,
      usadoEm: iso(transc.usosClaude.get(s)), estadoVistoEm: iso(e?.ms) });
  }

  // 3. Codex
  for (const [s, cfg] of codexCfg) {
    if (INTERNOS.test(s)) continue;
    const { nome, conta } = separarNome(s);
    const usado = transc.usosCodex.get(s) || null;
    let estado, detalhe;
    if (!cfg.ativo) { estado = 'desativado'; detalhe = 'enabled = false no config.toml do Codex'; }
    else if (usado) { estado = 'conectado'; detalhe = 'respondeu numa sessão recente do Codex'; }
    else { estado = 'desconhecido'; detalhe = 'configurado no Codex, que não grava o estado da conexão'; }
    conectores.push({ id: 'codex:' + s, nome, conta, origem: 'codex', estado, detalhe, usadoEm: iso(usado), estadoVistoEm: iso(usado) });
  }

  const ORDEM = { 'falhou': 0, 'precisa-autorizar': 1, 'conectado': 2, 'desconhecido': 3, 'desativado': 4 };
  conectores.sort((a, b) => ORDEM[a.estado] - ORDEM[b.estado] || a.nome.localeCompare(b.nome, 'pt-BR') || a.origem.localeCompare(b.origem));

  const resumo = { 'conectado': 0, 'precisa-autorizar': 0, 'falhou': 0, 'desativado': 0, 'desconhecido': 0, usadosNaJanela: 0 };
  for (const c of conectores) { resumo[c.estado]++; if (c.usadoEm) resumo.usadosNaJanela++; }

  const ultima = transc.sessoes[0];
  const fonteDoEstado = ultima
    ? `Avisos de conexão gravados nas transcrições do Claude Code (${transc.sessoes.length} ${transc.sessoes.length === 1 ? 'sessão' : 'sessões'} nas últimas 48 h; o mais recente em ${quando(ultima.ms)}, pasta ${pastaCurta(ultima.cwd)}). Codex: só configuração e uso.`
    : 'Nenhuma sessão do Claude Code nas últimas 48 h: só configuração e uso, estado desconhecido.';
  return { conectores, fonteDoEstado, geradoEm: new Date(agora).toISOString(), janelaUsoHoras: JANELA_USO_MS / 3600000, resumo };
}

let cache = { quando: 0, dados: null, promessa: null };
export async function portaria() {
  const agora = Date.now();
  if (cache.dados && agora - cache.quando < CACHE_MS) return cache.dados;
  if (!cache.promessa) {
    cache.promessa = montar()
      .then(d => { cache = { quando: Date.now(), dados: d, promessa: null }; return d; })
      .catch(e => { cache.promessa = null; throw e; });
  }
  return cache.promessa;
}
