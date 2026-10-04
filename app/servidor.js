// Servidor local de A Estação.
// Serve a página e expõe /api/estado, montado só com LEITURA dos arquivos que o
// Claude já grava: ~/.claude/sessions/<pid>.json (sessões abertas e status) e
// ~/.claude/projects/**/<sessionId>.jsonl (o que cada sessão está fazendo).
// Não escreve nada fora desta pasta e escuta só em 127.0.0.1.
// Única ação (rodada 6): POST /api/abrir { id } abre no app a sessão de quem está
// numa fila (sala do dono ou revisão), com origem, token e URL conferidos aqui.
// GET /api/versao: versão local (package.json + commit) e novidades do GitHub (no
// máximo 1 consulta a cada 6 h; ESTACAO_NOVIDADES=nao desliga). É a única chamada
// que sai da máquina; a fonte Figtree é servida daqui (node_modules/@fontsource).
//
// CONTRATO v0.5 de /api/estado
//   { agentes, geradoEm, provedores, limitesCodex, limites, dono, erro? }
//   provedores = { codex: boolean }: true se há arquivo em ~/.codex/sessions (ou
//     $CODEX_HOME/sessions) modificado nos últimos 7 dias (só stat/readdir, sem ler conteúdo).
//   limitesCodex = último rate_limits visto nas sessões do Codex (app/fonte-codex.js) | null
//   limites = medidores de janela de uso por provedor (também em GET /api/limites):
//     { anthropic: { medidores, atualizadoEm, fonte, aviso? }, openai: { ... } }
//     medidor = { rotulo, pct (0 a 100 | null), reiniciaEm (ms | null), janelaMin }
//     Claude: só do painel claude-usage (http://127.0.0.1:8090/api/state, campo quotas),
//       lido em segundo plano a cada 60 s com timeout de 1,5 s; sem painel, medidores
//       vazios, fonte 'indisponivel' e um aviso. Credenciais OAuth nunca são lidas.
//       PAINEL_USO_URL troca o endereço; PAINEL_USO_URL=nao desliga.
//     Codex: rate_limits das próprias transcrições (primary e secondary); o painel,
//       quando tem um valor mais novo, ganha.
//   dono = { nome } | null: só oauthAccount.displayName de ~/.claude.json (ou
//     $CLAUDE_CONFIG_DIR/.claude.json). Nenhum outro campo desse arquivo sai daqui.
//   erro só aparece em falha geral; aí agentes é a última lista boa.
// Cada agente:
//   id, nome, tipo ('sessao' | 'subagente'), pai (só subagente), pasta, pastaCaminho,
//   nome do subagente: description do .meta.json se for português (rótulo de workflow
//     'auditoria:VIS' vira 'Auditoria VIS'); inglês ou 'general-purpose' vira 'Ajudante'.
//   atividade: 'editar' | 'pesquisar' | 'conector' | 'esperar' | 'descansar' | 'coordenar' | 'revisar'
//   texto: frase curta para o hover, sempre em português
//   conector: nome curto do serviço (string, sem sufixo de conta, nunca com marca) ou null
//   conectorTipo: 'mcp' (conector MCP de trabalho) | 'api' (API chamada por comando no
//     terminal, reconhecida pelo host: ChatGPT, Claude API, Meta, RD Station, Google,
//     Gemini, ElevenLabs, Runway) | null. Os dois valem por 15 s depois da última chamada.
//   Navegador por destino: localhost/127.0.0.1/file: = 'editar' ('testando no navegador');
//     host de produto (Reportei Flux, RD Station, Figma, Supabase, Google Cloud) = 'pesquisar'
//     ('usando <Serviço> no navegador'); outro host = 'pesquisar' ('navegando em <host>').
//   ferramenta: nome da última ferramenta ou null
//   pensamentos: [{ id, texto }] (últimas ações, para o balão), sempre em português, sem
//     travessão; frases do assistente em inglês e mensagens de erro da API ficam de fora
//   paradoHaMs: ms desde que parou, só quando atividade = 'descansar', senão null
//   aguardando: 'permissao' | 'pergunta' | 'outro' | null (só com atividade 'esperar')
//   terminou: true para subagente que já entregou (fica até 4 min descansando)
//   provedor: 'anthropic' (Claude) | 'openai' (Codex, montado em app/fonte-codex.js)
//   pendencia (rodada 6): 'precisa_de_voce' (status waiting, ou AskUserQuestion sem
//     resposta; no Codex, pergunta request_user_input aberta) | 'entrega_com_sugestao'
//     (parada, último texto fecha com pergunta ou oferta; heurística de pendencia.js;
//     atividade 'revisar', por até 30 min) | null. Só sessões; ajudante é sempre null.
//   pendenteHaMs: ms desde que a pendência começou (ordem de chegada na fila) ou null
//   abrivel: true quando o servidor sabe abrir a sessão no app (POST /api/abrir)
//   contexto: % da janela de contexto usada na última resposta (0 a 100) ou null.
//     Claude: message.usage (input + cache + output) da última resposta da transcrição
//     contra a janela do modelo (1M nos modelos atuais; 200 mil no Haiku e nos antigos).
//     Codex: last_token_usage.total_tokens / model_context_window.
//
// Regras de vida
//   Sessão: some quando o processo morre, ou quando está parada há mais de 4 min
//   (60 s de relógio + 3 min de descanso no cliente), a não ser que ainda tenha
//   ajudante ativo; nesse caso fica como 'coordenar'.
//   Subagente de workflow: ativo enquanto o journal.jsonl do run tem 'started' sem 'result'.
//   Subagente comum: ativo enquanto a última mensagem dele não fecha o turno (end_turn
//   sem ferramenta). Terminou: fica 'descansar' com terminou = true por até 4 min.
//   Teto de segurança: 15 min sem escrever no arquivo, sai.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentesCodex, limitesCodex, configurarCodex } from './fonte-codex.js';
import { salaDosServidores } from './fonte-servidores.js';
import { terminaComOferta } from './pendencia.js';
import crypto from 'node:crypto';

const PORTA = Number(process.env.PORTA || 4317);
const PASTA_APP = path.dirname(fileURLToPath(import.meta.url));
const PASTA_APP_REAL = (() => { try { return fs.realpathSync(PASTA_APP); } catch { return PASTA_APP; } })();
// CLAUDE_CONFIG_DIR e CODEX_HOME mudam onde o Claude e o Codex gravam (versão pública)
const CLAUDE = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
const ARQUIVO_CONTA = process.env.CLAUDE_CONFIG_DIR ? path.join(CLAUDE, '.claude.json') : path.join(os.homedir(), '.claude.json');
const CODEX = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), '.codex');
const SESSOES = path.join(CLAUDE, 'sessions');
const PROJETOS = path.join(CLAUDE, 'projects');

const DESCANSO_MAX_MS = 4 * 60 * 1000;     // parado há mais que isso: vai embora (60 s de relógio + 3 min de descanso)
const SUBAGENTE_TETO_MS = 15 * 60 * 1000;  // subagente sem escrever há mais que isso: saiu, seja como for
const PENSANDO_MS = 20 * 1000;             // ferramenta respondida há mais que isso sem nova: "pensando na resposta"
const CACHE_ESTADO_MS = 1000;              // várias abas abertas leem a mesma resposta
const ULTIMO_BOM_MS = 10 * 1000;           // em erro de leitura, segura o último estado bom por este tempo

process.on('uncaughtException', e => console.error('[erro não tratado]', e));

// ---------------------------------------------------------------------------
// Utilidades de leitura
// ---------------------------------------------------------------------------
function processoVivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function lerJson(arquivo) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return null; }
}

function listar(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

// Confere se o PID ainda é do mesmo processo que abriu a sessão (o macOS reaproveita
// PIDs). O Claude grava procStart no formato do `ps -o lstart=`, em UTC
// (ex.: 'Fri Oct  2 23:16:55 2026'); comparamos com espaços normalizados, aceitando
// também o horário local por garantia. Um `ps` só para todos os PIDs, fora do caminho
// da resposta (assíncrono), renovado a cada 30 s ou quando aparece PID novo.
const normalizar = t => String(t || '').replace(/\s+/g, ' ').trim();
const inicioPorPid = new Map();   // pid -> { utc, local }
let psRodando = false;
let psRodouEm = 0;
function lerInicios(pids, tz) {
  return new Promise(ok => {
    execFile('ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')], {
      encoding: 'utf8', timeout: 2000, env: { ...process.env, TZ: tz },
    }, (erro, saida) => {
      const mapa = new Map();
      for (const linha of String(saida || '').split('\n')) {
        const m = linha.trim().match(/^(\d+)\s+(.+)$/);
        if (m) mapa.set(Number(m[1]), normalizar(m[2]));
      }
      ok(mapa);
    });
  });
}
function atualizarInicios(pids) {
  const faltando = pids.some(p => !inicioPorPid.has(p));
  if (psRodando || !pids.length || (!faltando && Date.now() - psRodouEm < 30 * 1000)) return;
  psRodando = true;
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || '';
  Promise.all([lerInicios(pids, 'UTC'), lerInicios(pids, local)]).then(([utc, loc]) => {
    inicioPorPid.clear();
    for (const p of pids) inicioPorPid.set(p, { utc: utc.get(p) || null, local: loc.get(p) || null });
    psRodouEm = Date.now();
    cacheEstado.quando = 0;   // próxima leitura já usa o resultado
  }).finally(() => { psRodando = false; });
}
function mesmoProcesso(s) {
  if (!s.procStart) return true;
  const inicio = inicioPorPid.get(s.pid);
  if (!inicio || (!inicio.utc && !inicio.local)) return true;   // ainda sem resposta do ps: não esconder por isso
  const alvo = normalizar(s.procStart);
  return alvo === inicio.utc || alvo === inicio.local;
}

const cacheTranscricao = new Map();   // sessionId -> caminho do .jsonl
function acharTranscricao(sessionId) {
  const conhecido = cacheTranscricao.get(sessionId);
  if (conhecido && fs.existsSync(conhecido)) return conhecido;
  for (const dir of listar(PROJETOS)) {
    const p = path.join(PROJETOS, dir, sessionId + '.jsonl');
    if (fs.existsSync(p)) { cacheTranscricao.set(sessionId, p); return p; }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Leitor incremental de arquivos .jsonl
// Guarda por arquivo onde parou (offset) e a linha partida do fim (resto), e a
// cada chamada lê só os bytes novos. As transcrições têm dezenas de MB e linhas
// de até alguns MB (prints e imagens em base64).
// ---------------------------------------------------------------------------
const MAX_LEITURA = 8 * 1024 * 1024;     // no máximo isto por chamada
const LINHA_GRANDE = 200 * 1024;          // acima disto, nada de JSON.parse (é imagem)

// Lê de [inicio, fim) e devolve o Buffer
function lerTrecho(fd, inicio, fim) {
  const buf = Buffer.alloc(Math.max(0, fim - inicio));
  let lidos = 0;
  while (lidos < buf.length) {
    const n = fs.readSync(fd, buf, lidos, buf.length - lidos, inicio + lidos);
    if (!n) break;
    lidos += n;
  }
  return lidos < buf.length ? buf.subarray(0, lidos) : buf;
}

// Separa um Buffer em linhas completas; devolve { linhas: [Buffer], resto: Buffer }
function separarLinhas(buf) {
  const linhas = [];
  let ini = 0;
  for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, ini)) {
    if (i > ini) linhas.push(buf.subarray(ini, i));
    ini = i + 1;
  }
  return { linhas, resto: Buffer.from(buf.subarray(ini)) };
}

// Avança o leitor `l` ({ offset, resto, iniciado }) e chama aoLer(linhaBuffer) para
// cada linha completa nova. Na primeira vez, `primeira(fd, size)` decide de onde
// começar (devolve o offset inicial). Devolve false se o arquivo não pôde ser lido.
function avancar(caminho, l, aoLer, primeira) {
  let fd;
  try {
    fd = fs.openSync(caminho, 'r');
    const { size, mtimeMs } = fs.fstatSync(fd);
    l.mtime = mtimeMs;
    if (size < l.offset) { l.offset = 0; l.resto = Buffer.alloc(0); l.iniciado = false; l.reiniciar?.(); }
    if (!l.iniciado) {
      l.iniciado = true;
      if (primeira) { primeira(fd, size); return true; }
    }
    if (size <= l.offset) return true;
    let inicio = l.offset;
    let descartarPrimeira = false;
    if (size - inicio > MAX_LEITURA) { inicio = size - MAX_LEITURA; descartarPrimeira = true; l.resto = Buffer.alloc(0); }
    const novo = lerTrecho(fd, inicio, size);
    l.offset = inicio + novo.length;
    const { linhas, resto } = separarLinhas(l.resto.length ? Buffer.concat([l.resto, novo]) : novo);
    if (descartarPrimeira) linhas.shift();
    l.resto = resto;
    for (const b of linhas) aoLer(b);
    return true;
  } catch { return false; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

// ---------------------------------------------------------------------------
// Transcrição: versão enxuta de cada linha e estado derivado
// ---------------------------------------------------------------------------
const MAX_LINHAS = 200;

function reduzirEntrada(e) {
  if (!e || typeof e !== 'object') return {};
  const r = {};
  const corta = (v, max) => typeof v === 'string' ? v.slice(0, max) : undefined;
  // command vai até 2.000 caracteres: o host de uma API costuma vir depois dos cabeçalhos
  for (const [k, max] of [['description', 300], ['command', 2000], ['url', 300], ['file_path', 300], ['pattern', 300],
    ['query', 300], ['q', 300], ['notebook_path', 300], ['action', 60], ['action_summary', 300]]) {
    const v = corta(e[k], max);
    if (v !== undefined) r[k] = v;
  }
  return r;
}

// Texto de um conteúdo de mensagem (string, ou lista de itens de texto), até 4 KB
function textoDoResultado(c) {
  if (typeof c === 'string') return c.slice(0, 4096);
  if (!Array.isArray(c)) return '';
  let r = '';
  for (const x of c) {
    if (typeof x?.text === 'string') r += x.text.slice(0, 4096) + '\n';
    else if (Array.isArray(x?.content) || typeof x?.content === 'string') r += textoDoResultado(x.content) + '\n';
    if (r.length > 8192) break;
  }
  return r;
}

// Linha normal: parse completo e versão enxuta
function enxugar(d) {
  const c = d.message?.content;
  const conteudo = Array.isArray(c) ? c.map(x => {
    if (!x || typeof x !== 'object') return { type: 'outro' };
    const item = { type: x.type };
    if (x.type === 'tool_use') { item.name = String(x.name || ''); item.id = x.id; item.input = reduzirEntrada(x.input); }
    else if (x.type === 'tool_result') {
      item.tool_use_id = x.tool_use_id;
      const txt = textoDoResultado(x.content);
      const m = txt.match(/running in background with ID: (\w+)/);
      if (m) item.fundo = m[1];
      // Workflow em segundo plano: "Task ID: X", "Summary: ..." e "Run ID: wf_..."
      const w = txt.match(/Workflow launched in background\. Task ID: (\w+)/);
      if (w) {
        item.fundo = w[1];
        item.resumo = ((txt.match(/Summary: ([^\n]+)/) || [])[1] || '').slice(0, 300);
        item.runId = (txt.match(/Run ID: (wf_[\w-]+)/) || [])[1] || null;
      }
    }
    else if (x.type === 'text') {
      const texto = String(x.text || '');
      item.texto = texto.slice(0, 200);
      // o fim da fala decide se ela fecha com uma oferta ou pergunta (entrega_com_sugestao)
      if (texto.length > 200) item.fim = texto.slice(-400);
    }
    return item;
  }) : (typeof c === 'string' ? [{ type: 'text', texto: c.slice(0, 200) }] : []);
  // aviso de tarefa em segundo plano que terminou (<task-notification><task-id>X</task-id>)
  const fimTarefas = d.type === 'user' ? [...textoDoResultado(c).matchAll(/<task-id>(\w+)<\/task-id>/g)].map(m => m[1]) : [];
  const u = d.type === 'assistant' ? d.message?.usage : null;
  const tokens = u ? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0) : 0;
  return {
    type: d.type, timestamp: d.timestamp, uuid: d.uuid, isApiErrorMessage: !!d.isApiErrorMessage, isMeta: !!d.isMeta,
    stop_reason: d.message?.stop_reason ?? null, content: conteudo,
    ...(fimTarefas.length ? { fimTarefas } : {}),
    ...(tokens > 0 ? { tokens, modelo: String(d.message?.model || '') } : {}),
  };
}

// Linha gigante (imagem em base64): só o essencial por regex, sem JSON.parse
function enxugarPorRegex(texto) {
  const cabeca = texto.slice(0, 4096);
  const tipo = (cabeca.match(/"role":"(user|assistant)"/) || cabeca.match(/"type":"(user|assistant|attachment|system)"/) || [])[1] || 'outro';
  // no assistant o timestamp do topo vem depois do conteúdo; no user, antes do toolUseResult
  const datas = [...texto.matchAll(/"timestamp":"(\d{4}-\d\d-\d\dT[^"]+)"/g)].map(m => m[1]);
  const timestamp = tipo === 'assistant' ? datas[datas.length - 1] : datas[0];
  const uuids = texto.match(/"uuid":"([0-9a-f-]{36})"/g);
  const uuid = uuids ? uuids[uuids.length - 1].slice(8, -1) : undefined;
  const conteudo = [];
  if (tipo === 'assistant') {
    for (const m of texto.matchAll(/"type":"tool_use","id":"([^"]+)","name":"([^"]+)"/g)) conteudo.push({ type: 'tool_use', id: m[1], name: m[2], input: {} });
  } else if (tipo === 'user') {
    for (const m of texto.matchAll(/"tool_use_id":"([^"]+)"/g)) conteudo.push({ type: 'tool_result', tool_use_id: m[1] });
  }
  return {
    type: tipo, timestamp, uuid, isApiErrorMessage: /"isApiErrorMessage":true/.test(cabeca), isMeta: /"isMeta":true/.test(cabeca),
    stop_reason: (texto.match(/"stop_reason":"(\w+)"/) || [])[1] || null, content: conteudo,
  };
}

function linhaEnxuta(buf) {
  const texto = buf.toString('utf8');
  if (buf.length > LINHA_GRANDE) return enxugarPorRegex(texto);
  try { return enxugar(JSON.parse(texto)); } catch { return null; }
}

function novaTranscricao() {
  return {
    offset: 0, resto: Buffer.alloc(0), iniciado: false, mtime: 0, usadoEm: 0,
    linhas: [],                    // últimas MAX_LINHAS versões enxutas (só user e assistant)
    pendentes: new Map(),          // tool_use_id -> { nome, id, quando, entrada } ainda sem tool_result
    respondidas: new Map(),        // tool_use_id -> quando chegou o tool_result (últimas 500)
    ultimaFerramenta: null,        // { nome, id, quando, entrada }
    ultimoPromptQuando: 0,         // último pedido do usuário (ou aviso de tarefa)
    ultimoAssistant: null,         // { stop_reason, quando, temToolUse }
    ultimaRelevante: null,         // { tipo, quando, fimDeTurno } última linha user/assistant
    ultimoHost: null,              // último destino do navegador (navigate, tabs_create, preview_start); 'file:' para arquivo local
    conectoresRecentes: [],        // [{ servidor, tipo: 'mcp' | 'api', quando }] (últimos 10)
    ultimoQuando: 0,               // timestamp mais novo visto
    contexto: null,                // { tokens, modelo } da última resposta com uso
    ultimaFala: null,              // { quando, texto } fim do último texto do assistente
    tarefasFundo: new Map(),       // id da tarefa em segundo plano -> { descricao, ferramenta, quando } (sem aviso de fim)
  };
}

function registrarLinha(t, e) {
  if (!e) return;
  const quando = Date.parse(e.timestamp || '') || 0;
  if (quando > t.ultimoQuando) t.ultimoQuando = quando;
  if (e.type !== 'user' && e.type !== 'assistant') return;
  t.linhas.push(e);
  if (t.linhas.length > MAX_LINHAS) t.linhas.splice(0, t.linhas.length - MAX_LINHAS);

  if (e.type === 'assistant') {
    if (e.tokens && !e.isApiErrorMessage && e.modelo !== '<synthetic>') t.contexto = { tokens: e.tokens, modelo: e.modelo };
    const usos = e.content.filter(c => c.type === 'tool_use');
    for (const u of usos) {
      const f = { nome: u.name, id: u.id, quando, entrada: u.input || {} };
      t.pendentes.set(u.id, f);
      t.ultimaFerramenta = f;
      const n = u.name.split('__').pop();
      if (['navigate', 'tabs_create', 'preview_start'].includes(n) && u.input?.url) {
        const d = destino(u.input.url);
        if (d) t.ultimoHost = d;
      }
      const api = u.name === 'Bash' ? apiDoComando(u.input?.command) : null;
      if (u.name.startsWith('mcp__') || api) {
        t.conectoresRecentes.push({ servidor: api || u.name.split('__')[1] || '', tipo: api ? 'api' : 'mcp', quando });
        if (t.conectoresRecentes.length > 10) t.conectoresRecentes.shift();
      }
    }
    const falas = e.isApiErrorMessage ? [] : e.content.filter(c => c.type === 'text' && c.texto?.trim());
    if (falas.length) { const u = falas[falas.length - 1]; t.ultimaFala = { quando, texto: u.fim || u.texto }; }
    const temToolUse = usos.length > 0 || e.stop_reason === 'tool_use';
    t.ultimoAssistant = { stop_reason: e.stop_reason, quando, temToolUse };
    const fimDeTurno = e.stop_reason === 'end_turn' && !temToolUse;
    if (fimDeTurno) t.pendentes.clear();
    t.ultimaRelevante = { tipo: 'assistant', quando, fimDeTurno };
    return;
  }

  // user: resposta de ferramenta ou pedido novo
  for (const id of e.fimTarefas || []) t.tarefasFundo.delete(id);
  const resultados = e.content.filter(c => c.type === 'tool_result');
  if (resultados.length) {
    for (const r of resultados) {
      if (r.fundo) {
        const f = t.pendentes.get(r.tool_use_id);
        t.tarefasFundo.set(r.fundo, { descricao: r.resumo || f?.entrada?.description || '', ferramenta: f?.nome || 'Bash', quando, runId: r.runId || null });
      }
      t.pendentes.delete(r.tool_use_id);
      t.respondidas.set(r.tool_use_id, quando);
    }
    if (t.respondidas.size > 500) for (const k of [...t.respondidas.keys()].slice(0, t.respondidas.size - 500)) t.respondidas.delete(k);
  } else if (!e.isMeta) {
    t.ultimoPromptQuando = quando;
  }
  t.ultimaRelevante = { tipo: 'user', quando, fimDeTurno: false };
}

// Primeira leitura: últimos 256 KB; sem nenhuma linha assistant completa, tenta 1 MB
// e 4 MB (até 8 MB no total e cerca de 200 ms)
function primeiraLeitura(t, fd, size) {
  const comeco = Date.now();
  let lidoTotal = 0;
  let escolhido = null;
  for (const janela of [256 * 1024, 1024 * 1024, 4 * 1024 * 1024]) {
    const inicio = Math.max(0, size - janela);
    const buf = lerTrecho(fd, inicio, size);
    lidoTotal += buf.length;
    const { linhas, resto } = separarLinhas(buf);
    if (inicio > 0) linhas.shift();
    const enxutas = linhas.map(linhaEnxuta);
    escolhido = { enxutas, resto, fim: inicio + buf.length };
    const temAssistant = enxutas.some(e => e?.type === 'assistant');
    if (temAssistant || inicio === 0 || lidoTotal >= MAX_LEITURA || Date.now() - comeco > 200) break;
  }
  for (const e of escolhido.enxutas) registrarLinha(t, e);
  t.resto = escolhido.resto;
  t.offset = escolhido.fim;
}

const transcricoes = new Map();   // caminho -> estado da transcrição
function lerTranscricao(caminho) {
  let t = transcricoes.get(caminho);
  if (!t) {
    t = novaTranscricao();
    t.reiniciar = () => Object.assign(t, novaTranscricao(), { usadoEm: Date.now() });
    transcricoes.set(caminho, t);
  }
  t.usadoEm = Date.now();
  avancar(caminho, t, b => registrarLinha(t, linhaEnxuta(b)), (fd, size) => primeiraLeitura(t, fd, size));
  return t;
}

// Esquece leitores que ninguém consulta há 10 min (subagentes antigos, sessões fechadas)
function limparLeitores() {
  const limite = Date.now() - 10 * 60 * 1000;
  for (const [k, t] of transcricoes) if (t.usadoEm < limite) transcricoes.delete(k);
  for (const [k, j] of journals) if (j.usadoEm < limite) journals.delete(k);
}

// ---------------------------------------------------------------------------
// journal.jsonl dos workflows: quem começou e quem já entregou
// Linhas {"type":"started","agentId","label"} e {"type":"result","agentId",...}; as de
// result podem ser enormes, então tipo e agentId saem por regex do começo da linha.
// ---------------------------------------------------------------------------
const journals = new Map();   // caminho -> { offset, resto, iniciados: Map, resultados: Map }
function lerJournal(caminho) {
  let j = journals.get(caminho);
  if (!j) {
    j = { offset: 0, resto: Buffer.alloc(0), iniciado: true, usadoEm: 0, iniciados: new Map(), resultados: new Map() };
    j.reiniciar = () => { j.iniciados.clear(); j.resultados.clear(); j.iniciado = true; };
    journals.set(caminho, j);
  }
  j.usadoEm = Date.now();
  avancar(caminho, j, b => {
    const cabeca = b.subarray(0, 600).toString('utf8');
    const tipo = (cabeca.match(/"type":"(\w+)"/) || [])[1];
    const agentId = (cabeca.match(/"agentId":"([^"]+)"/) || [])[1];
    if (!agentId) return;
    if (tipo === 'started') j.iniciados.set(agentId, (cabeca.match(/"label":"([^"]*)"/) || [])[1] || '');
    else if (tipo === 'result') j.resultados.set(agentId, Date.now());
  });
  return j;
}

// ---------------------------------------------------------------------------
// Nome dos conectores. Os da claude.ai aparecem nas ferramentas só pelo código
// (mcp__85109015-...__get_screenshot); o app desktop guarda código -> nome em
// ~/Library/Application Support/Claude/claude-code-sessions/**.json
// (remoteMcpServersConfig). A varredura roda em segundo plano (fs.promises), nunca no
// caminho de /api/estado: no início, a cada 10 min e quando aparece um código
// desconhecido (no máximo 1 vez a cada 30 s). Cache por arquivo com mtime: só relê o
// que mudou. Do arquivo, só a lista remoteMcpServersConfig passa por JSON.parse.
// ---------------------------------------------------------------------------
const SESSOES_DESKTOP = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
let nomesConectores = new Map();               // código -> nome como veio da claude.ai
const nomesPorArquivo = new Map();             // arquivo -> { mtime, tamanho, pares: [[código, nome]] }
let varrendoNomes = false;
let nomesVarridosEm = 0;
const CABECA_NOMES = 512 * 1024;               // remoteMcpServersConfig vem no começo do arquivo (visto até 112 KB)

// Recorta o array JSON que começa no primeiro '[' depois de `de` (respeitando strings)
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
  return null;   // o array não terminou dentro do trecho lido
}

// Lê só o começo do arquivo; o arquivo inteiro só se o começo tiver remoteMcpServersConfig
// e a lista não couber nele
async function paresDoArquivo(arquivo, tamanho) {
  const fh = await fsp.open(arquivo, 'r');
  try {
    const cabeca = Buffer.alloc(Math.min(tamanho, CABECA_NOMES));
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
    const pares = [];
    for (const c of JSON.parse(lista)) if (c?.uuid && c?.name) pares.push([String(c.uuid), String(c.name)]);
    return pares;
  } finally { await fh.close(); }
}

async function varrerNomes() {
  const vistos = new Set();
  const visitar = async (dir, profundidade) => {
    let itens = [];
    try { itens = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory() && profundidade < 3) await visitar(p, profundidade + 1);
      else if (it.isFile() && it.name.endsWith('.json')) {
        vistos.add(p);
        let st;
        try { st = await fsp.stat(p); } catch { continue; }
        const c = nomesPorArquivo.get(p);
        if (c && c.mtime === st.mtimeMs && c.tamanho === st.size) continue;
        let pares = [];
        try { pares = await paresDoArquivo(p, st.size); } catch {}
        nomesPorArquivo.set(p, { mtime: st.mtimeMs, tamanho: st.size, pares });
      }
    }
  };
  await visitar(SESSOES_DESKTOP, 0);
  for (const k of [...nomesPorArquivo.keys()]) if (!vistos.has(k)) nomesPorArquivo.delete(k);
  // do mais antigo para o mais novo: se o nome mudou, vale o mais recente
  const novos = new Map();
  for (const c of [...nomesPorArquivo.values()].sort((a, b) => a.mtime - b.mtime)) for (const [u, n] of c.pares) novos.set(u, n);
  if (novos.size) { nomesConectores = novos; cacheEstado.quando = 0; }
}

// Devolve a promessa da varredura (ou null se já há uma rodando ou rodou há menos de 30 s)
function pedirVarreduraNomes(forcar = false) {
  if (varrendoNomes || (!forcar && Date.now() - nomesVarridosEm < 30 * 1000)) return null;
  varrendoNomes = true;
  nomesVarridosEm = Date.now();
  return varrerNomes().catch(e => console.error('[conectores]', e?.message || e)).finally(() => { varrendoNomes = false; });
}

// ---------------------------------------------------------------------------
// Sessão do app (rodada 6): o registro (~/.claude/sessions) traz o id da conversa
// (sessionId, o mesmo do .jsonl); o app desktop abre a conversa pelo id local
// (local_...). O mapa sai de claude-code-sessions/**/local_*.json, que tem os dois
// campos (sessionId e cliSessionId) logo no começo: lê só os primeiros 4 KB.
// Cache por arquivo (o par não muda depois de completo); varredura em segundo
// plano a cada 15 s, ou na hora quando o clique pede um id que ainda não está no mapa.
// ---------------------------------------------------------------------------
const locaisPorConversa = new Map();   // cliSessionId -> sessionId local (local_...)
const locaisPorArquivo = new Map();    // arquivo -> { mtime, conversa, local }
const ID_LOCAL = /^local_[0-9a-f-]{36}$/i;
let varrendoLocais = null;
let locaisVarridosEm = 0;

async function varrerLocais() {
  const vistos = new Set();
  const visitar = async (dir, profundidade) => {
    let itens = [];
    try { itens = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory() && profundidade < 3) { await visitar(p, profundidade + 1); continue; }
      if (!it.isFile() || !/^local_.*\.json$/.test(it.name)) continue;
      vistos.add(p);
      const c = locaisPorArquivo.get(p);
      if (c?.conversa && c.local) continue;                 // par completo: não muda mais
      let st;
      try { st = await fsp.stat(p); } catch { continue; }
      if (c && c.mtime === st.mtimeMs) continue;
      let cabeca = '';
      try {
        const fh = await fsp.open(p, 'r');
        try {
          const buf = Buffer.alloc(4096);
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
          cabeca = buf.toString('utf8', 0, bytesRead);
        } finally { await fh.close(); }
      } catch { continue; }
      const local = (cabeca.match(/"sessionId"\s*:\s*"(local_[0-9a-f-]{36})"/i) || [])[1] || null;
      const conversa = (cabeca.match(/"cliSessionId"\s*:\s*"([0-9a-f-]{36})"/i) || [])[1] || null;
      locaisPorArquivo.set(p, { mtime: st.mtimeMs, conversa, local });
    }
  };
  await visitar(SESSOES_DESKTOP, 0);
  for (const k of [...locaisPorArquivo.keys()]) if (!vistos.has(k)) locaisPorArquivo.delete(k);
  locaisPorConversa.clear();
  for (const c of locaisPorArquivo.values()) if (c.conversa && c.local) locaisPorConversa.set(c.conversa, c.local);
}

function pedirLocais(forcar = false) {
  if (varrendoLocais) return varrendoLocais;
  if (!forcar && Date.now() - locaisVarridosEm < 15 * 1000) return null;
  locaisVarridosEm = Date.now();
  varrendoLocais = varrerLocais().catch(e => console.error('[sessões do app]', e?.message || e))
    .finally(() => { varrendoLocais = null; });
  return varrendoLocais;
}

// Id local da sessão: pelo mapa dos arquivos do app; enquanto a varredura não pegou
// uma sessão nova, vale o hostSessionId do próprio registro (mesmo formato local_...)
function idLocalDe(s) {
  pedirLocais();
  const doMapa = locaisPorConversa.get(s.sessionId);
  if (doMapa) return doMapa;
  return ID_LOCAL.test(String(s.hostSessionId || '')) ? s.hostSessionId : null;
}

// ---------------------------------------------------------------------------
// Pendências (rodada 6): 'precisa_de_voce' e 'entrega_com_sugestao'
// - precisa_de_voce (confiável): status 'waiting' (aprovação ou pergunta) ou
//   AskUserQuestion sem tool_result com a sessão trabalhando.
// - entrega_com_sugestao (heurística, pode errar): sessão parada, sem ajudante
//   ativo, cujo último texto do assistente fecha o turno com uma pergunta ('?' no
//   fim) ou uma oferta no último parágrafo ('quer que eu', 'posso seguir', 'sigo
//   com', 'want me to'...; app/pendencia.js). Vale por até 30 min; depois some
//   como quem descansou.
// ---------------------------------------------------------------------------
const SUGESTAO_MAX_MS = 30 * 60 * 1000;

// AskUserQuestion ainda sem resposta (o mais recente), ou null
function perguntaPendente(t) {
  let f = null;
  if (t) for (const p of t.pendentes.values()) if (p.nome === 'AskUserQuestion' && (!f || p.quando > f.quando)) f = p;
  return f;
}

// O turno fechou com uma fala que oferece um próximo passo?
function fechouComSugestao(t) {
  const u = t?.ultimaRelevante, f = t?.ultimaFala;
  return !!(u && u.tipo === 'assistant' && u.fimDeTurno && f && f.quando >= u.quando && terminaComOferta(f.texto));
}

// ---------------------------------------------------------------------------
// Nome curto do serviço (DADOS-09/ID-09): sem sufixo de conta (' da Astronauta',
// ' da Empresa X'), sem 'mcp', Title Case por palavra e apelidos de até 14 caracteres.
// Nunca devolve texto com a marca; código sem nome conhecido vira 'Conector externo'.
// ---------------------------------------------------------------------------
// Com maiúscula é a marca; 'astronauta' minúsculo é o personagem e pode aparecer.
// Em host e nome de conector vale qualquer caixa (MARCA_I).
const MARCA = /\bAstronauta\b/;
const MARCA_I = /astronauta/i;
const APELIDOS = new Map([     // chave: nome em minúsculas e sem espaços
  ['rdstationmarketing', 'RD Marketing'], ['rdmarketing', 'RD Marketing'],
  ['rdstationcrm', 'RD CRM'], ['rdcrm', 'RD CRM'],
  ['rdstationconversas', 'RD Conversas'], ['rdconversas', 'RD Conversas'],
  ['reporteiflux', 'Reportei Flux'], ['googleads', 'Google Ads'],
  ['21st', '21st'], ['getlayers', 'GetLayers'], ['llmpulse', 'LLM Pulse'],
  ['supermetricsmarketinganalytics', 'Supermetrics'], ['cloudflaredeveloperplatform', 'Cloudflare'],
  ['elevenlabs', 'ElevenLabs'], ['chatgptads', 'ChatGPT Ads'], ['metaads', 'Meta Ads'],
]);
function nomeCurto(bruto) {
  let t = String(bruto || '')
    .replace(/^plugin[_:][^_:]+[_:]/i, '')            // plugin_<pacote>_<servidor>
    .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) t = t.replace(/\s+(da|do|de)\s+[A-ZÀ-Ú][\wÀ-ú]*$/u, '').trim();
  t = t.replace(/\s*\bmcp$/i, '').replace(/^mcp\s+/i, '').trim();
  if (!t || /^[0-9a-f]{8}( [0-9a-f]{4}){3} [0-9a-f]{12}$/i.test(t)) return 'Conector externo';
  const apelido = APELIDOS.get(t.toLowerCase().replace(/\s+/g, ''));
  if (apelido) t = apelido;
  else t = t.split(' ').map(p => p === p.toLowerCase() ? p.charAt(0).toUpperCase() + p.slice(1) : p).join(' ');
  return MARCA_I.test(t) ? 'Conector externo' : t;
}

// Servidores que não são "conector de trabalho"
//   NAVEGADOR: navegador e controle da tela (computer-use segue a mesma regra), por destino
//   SIMULADOR: simulador e prévia do app desktop, na mesa ('testando o app')
//   INTERNOS: ferramentas do próprio Claude e do app desktop, na mesa
//   BUSCA_WEB: busca na web, sempre Pesquisa
// INTERNOS e BUSCA_WEB testam o código do servidor E o nome resolvido.
const NAVEGADOR = /claude-in-chrome|claude.browser|claude_browser|^computer-use$/i;
const SIMULADOR = /^(Claude_Code_iOS_Simulator|Claude_Preview)$/i;
const INTERNOS = /^(ccd_|scheduled-tasks|mcp-registry|visualize|terminal$|plugin:|Claude_Code_iOS_Simulator|Claude_Preview|Claude_Browser|computer-use|Framebuffer|Window_Halo|session_info|skills$|dispatch$|cowork$)/i;
const BUSCA_WEB = /firecrawl|brightdata|bright data|semrush|websearch/i;
const CODIGO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const servidorDe = nomeFerramenta => String(nomeFerramenta || '').startsWith('mcp__') ? String(nomeFerramenta).split('__')[1] || '' : '';
function nomeResolvido(servidor) {
  const nome = nomesConectores.get(servidor);
  if (!nome && CODIGO.test(servidor)) pedirVarreduraNomes();   // código novo: relê os nomes em segundo plano
  return nome || servidor;
}
function ehInterno(servidor) { return INTERNOS.test(servidor) || INTERNOS.test(nomeResolvido(servidor)); }
function ehBuscaWeb(servidor) { return BUSCA_WEB.test(servidor) || BUSCA_WEB.test(nomeResolvido(servidor)); }

// Nome curto do conector MCP de trabalho, ou null
function conectorDe(nomeFerramenta) {
  const servidor = servidorDe(nomeFerramenta);
  if (!servidor || NAVEGADOR.test(servidor) || SIMULADOR.test(servidor) || ehInterno(servidor) || ehBuscaWeb(servidor)) return null;
  return nomeCurto(nomeResolvido(servidor));
}

// ---------------------------------------------------------------------------
// API chamada pelo terminal: não existe ferramenta "API"; vem do comando do Bash.
// Reconhece pelo host; o que não estiver na tabela não vai para a sala API.
// Só conta quando algum trecho do comando roda um cliente de rede ou um script
// (curl, wget, python, node...), para um grep pelo endereço não virar chamada.
// ---------------------------------------------------------------------------
const APIS = [   // a ordem importa: o mais específico primeiro
  ['generativelanguage.googleapis.com', 'Gemini'],
  ['api.openai.com', 'ChatGPT'],
  ['api.anthropic.com', 'Claude API'],
  ['graph.facebook.com', 'Meta'],
  ['api.rd.services', 'RD Station'],
  ['api.elevenlabs.io', 'ElevenLabs'],
  ['api.runwayml.com', 'Runway'],
  ['api.dev.runwayml.com', 'Runway'],
  ['*.googleapis.com', 'Google'],
];
const CLIENTES_REDE = new Set(['curl', 'wget', 'http', 'https', 'xh', 'python', 'python3', 'node', 'deno', 'bun', 'npx', 'ruby', 'php', 'bash', 'sh', 'zsh']);
function casaHost(h, padrao) {
  return padrao.startsWith('*.') ? h.endsWith(padrao.slice(1)) : h === padrao;
}
function apiDoHost(h) {
  for (const [padrao, nome] of APIS) if (casaHost(h, padrao)) return nome;
  return null;
}
function apiDoComando(comando) {
  const c = String(comando || '');
  if (!c || !binarios(c).some(b => CLIENTES_REDE.has(b))) return null;
  for (const m of c.toLowerCase().matchAll(/(?<![\w.-])(?:[a-z][a-z0-9+.-]*:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?![\w-])/g)) {
    const nome = apiDoHost(m[1]);
    if (nome) return nome;
  }
  return null;
}

// Binários de cada trecho do comando (separados por &&, ||, ;, | e quebra de linha),
// pulando atribuições de variável e prefixos como sudo, env, time e nohup
const PREFIXOS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command', 'builtin', 'caffeinate']);
const IGNORADOS = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'unset', 'source', '.', 'true', 'false', 'sleep', 'echo',
  'printf', 'trap', 'wait', 'then', 'do', 'if', 'for', 'while', 'fi', 'done', 'else', '[', '[[', 'test', '{', '}', 'local', 'ulimit']);
function binarios(comando) {
  const lista = [];
  for (const trecho of String(comando || '').split(/&&|\|\||[;|\n]/)) {
    for (const bruto of trecho.trim().replace(/^[({]\s*/, '').split(/\s+/)) {
      const p = bruto.replace(/^['"]|['"]$/g, '');
      if (!p || /^[A-Za-z_]\w*=/.test(p) || PREFIXOS.has(p)) continue;
      lista.push(path.basename(p));
      break;
    }
  }
  return lista;
}
function primeiroBinario(comando) {
  const todos = binarios(comando);
  return todos.find(b => !IGNORADOS.has(b)) || todos[0] || '';
}

// Serviço externo que a ferramenta usa: { nome, tipo: 'mcp' | 'api' } ou null
function servicoDe(nomeFerramenta, entrada) {
  if (nomeFerramenta === 'Bash') {
    const api = apiDoComando(entrada?.command);
    return api ? { nome: api, tipo: 'api' } : null;
  }
  const mcp = conectorDe(nomeFerramenta);
  return mcp ? { nome: mcp, tipo: 'mcp' } : null;
}

// ---------------------------------------------------------------------------
// Navegador por destino (DADOS-08). Host de produto é uso de um serviço pela tela,
// não conector MCP nem API: por isso fica na Pesquisa ('pesquisar') e não abre a
// sala MCP nem a sala API. localhost e arquivo local são teste do que ele está
// construindo, então ficam na mesa ('editar').
// ---------------------------------------------------------------------------
const HOSTS_PRODUTO = [
  ['flux.reportei.com', 'Reportei Flux'], ['app.reportei.com', 'Reportei'],
  ['app.rdstation.com.br', 'RD Station'], ['app.rdstation.com', 'RD Station'], ['crm.rdstation.com', 'RD CRM'],
  ['figma.com', 'Figma'], ['*.figma.com', 'Figma'],
  ['supabase.com', 'Supabase'], ['*.supabase.com', 'Supabase'],
  ['console.cloud.google.com', 'Google Cloud'], ['ads.google.com', 'Google Ads'],
  ['business.facebook.com', 'Meta'], ['adsmanager.facebook.com', 'Meta'],
  ['canva.com', 'Canva'], ['*.canva.com', 'Canva'], ['lovable.dev', 'Lovable'], ['tella.tv', 'Tella'], ['*.tella.tv', 'Tella'],
  ['github.com', 'GitHub'], ['docs.google.com', 'Google Docs'], ['drive.google.com', 'Google Drive'],
];
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|[\w.-]+\.localhost|[\w.-]+\.test)(:\d+)?$/i;
function produtoDoHost(h) {
  const semPorta = String(h || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
  for (const [padrao, nome] of HOSTS_PRODUTO) if (casaHost(semPorta, padrao)) return nome;
  return null;
}
// Host para mostrar: sem www., encurtado para os dois últimos nomes quando é longo;
// null se tiver a marca (aí o texto fala só "um site")
function hostCurto(h) {
  let t = String(h || '').toLowerCase().replace(/^www\./, '');
  if (!t || t === 'uma página') return null;
  if (t.length > 24 && !LOCAL.test(t)) {
    const partes = t.replace(/:\d+$/, '').split('.');
    const n = /\.(com|org|net|gov|edu)\.[a-z]{2}$/.test(t) ? 3 : 2;
    t = partes.slice(-n).join('.');
  }
  return MARCA_I.test(t) ? null : t;
}
function navegadorPorDestino(h) {
  const sem = { conector: null, conectorTipo: null };
  if (!h) return { atividade: 'pesquisar', texto: 'usando o navegador', ...sem };
  if (h === 'file:' || LOCAL.test(h)) return { atividade: 'editar', texto: 'testando no navegador', ...sem };
  const produto = produtoDoHost(h);
  if (produto) return { atividade: 'pesquisar', texto: `usando ${produto} no navegador`, ...sem };
  const curtoHost = hostCurto(h);
  return { atividade: 'pesquisar', texto: curtoHost ? 'navegando em ' + curtoHost : 'navegando num site', ...sem };
}
// Destino de uma URL para guardar em ultimoHost ('file:' para arquivo local)
function destino(url) {
  const u = String(url || '').trim();
  if (!u || /^(back|forward)$/i.test(u)) return null;
  if (/^file:/i.test(u)) return 'file:';
  const h = host(u);
  return h === 'uma página' ? null : h.toLowerCase();
}

// ---------------------------------------------------------------------------
// Ferramenta -> { atividade, texto, conector, conectorTipo }
// ---------------------------------------------------------------------------
const TEXTOS = {
  editar: 'trabalhando na mesa', pesquisar: 'pesquisando na web', conector: 'usando um conector',
  esperar: 'esperando você', descansar: 'descansando', coordenar: 'acompanhando os ajudantes',
};
const textoServico = s => s.tipo === 'api' ? `usando ${s.nome} pela API` : 'usando ' + s.nome;

function avaliarFerramenta(f, t) {
  const sem = { conector: null, conectorTipo: null };
  if (!f) return { atividade: 'editar', texto: TEXTOS.editar, ...sem };
  const n = f.nome;
  const servidor = servidorDe(n);
  if (n === 'WebSearch' || n === 'WebFetch' || (servidor && ehBuscaWeb(servidor))) return { atividade: 'pesquisar', texto: TEXTOS.pesquisar, ...sem };
  if (servidor && SIMULADOR.test(servidor)) return { atividade: 'editar', texto: 'testando o app', ...sem };
  if (servidor && NAVEGADOR.test(servidor)) return navegadorPorDestino(t?.ultimoHost);
  const s = servicoDe(n, f.entrada);
  if (s) return { atividade: 'conector', texto: textoServico(s), conector: s.nome, conectorTipo: s.tipo };
  return { atividade: 'editar', texto: TEXTOS.editar, ...sem };
}

// ---------------------------------------------------------------------------
// Português (DADOS-04/ID-03/PERS-09): as descrições que o Claude escreve para si
// costumam vir em inglês. Teste simples: acentos e palavras comuns contra palavras
// e verbos ingleses. Descrição curta em português sem acento pode cair como inglês;
// aí entra o rótulo pelo comando, que continua em português.
// ---------------------------------------------------------------------------
const ACENTOS = /[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÇ]/;
const PALAVRAS_PT = new Set(('de do da dos das para pra pro com o os as no na nos nas em um uma uns umas que e é ao aos ' +
  'pelo pela pelos pelas sem por mais já não sim isso isto esse essa este esta aqui agora vou vamos está estão foi ficou tem ' +
  'pronto pronta também como onde quando depois antes ainda só cada todo toda todos todas entre sobre até mas ou seu sua ' +
  'meu minha nosso nossa ele ela eles elas você eu nós deu certo feito tudo nada falta faltam').split(' '));
const PALAVRAS_EN = new Set(('the and for with from into to of on in is are was were be been this that these those all ' +
  'current new it its by at an your you my our we let i will now then here there not yes after before which what ' +
  'have has had should would could can just still also each every any some only both about via using against code ' +
  'reviewer agent helper worker explorer planner general purpose task research').split(' '));
const VERBOS_EN = new Set(('add apply back backup build bump check clean clear commit compare compile confirm convert copy count ' +
  'create debug delete deploy diff download dump edit ensure extract fetch find fix format gather generate get grab inspect ' +
  'install kill launch list load look make measure merge move open print probe pull push read rebuild record reload remove ' +
  'rename render replace restart restore retry review run save scan search see serve set show start stop sync tail test ' +
  'touch trigger try update upload validate verify view wait watch write filter enter register order answer cover discover ' +
  'recover deliver consider wonder take capture query compute resize crop take kick spawn launch close boot attach').split(' '));
function primeiraPalavraInglesa(p) {
  if (!p) return false;
  if (VERBOS_EN.has(p)) return true;
  if (p.endsWith('s') && VERBOS_EN.has(p.slice(0, -1))) return true;
  if (p.endsWith('es') && VERBOS_EN.has(p.slice(0, -2))) return true;
  if (p.endsWith('ing') && (VERBOS_EN.has(p.slice(0, -3)) || VERBOS_EN.has(p.slice(0, -3) + 'e'))) return true;
  return false;
}
function ehPortugues(texto) {
  const t = String(texto || '');
  const palavras = t.toLowerCase().match(/[a-zà-úç']+/g) || [];
  if (!palavras.length) return false;
  let pt = ACENTOS.test(t) ? 2 : 0;
  let en = 0;
  for (const p of palavras) { if (PALAVRAS_PT.has(p)) pt++; if (PALAVRAS_EN.has(p)) en++; }
  if (primeiraPalavraInglesa(palavras[0])) en += 2;
  else if (palavras[0].length >= 4 && /(ar|er|ir|ando|endo|indo)$/.test(palavras[0])) pt++;   // infinitivo ou gerúndio
  return pt > 0 && pt > en;
}

// Marca: tira ' da Astronauta' do fim de nomes; o que ainda tiver a marca não aparece
const tirarSufixoMarca = texto => String(texto || '').replace(/\s+(da|do|de)\s+Astronauta(\s+(Martech|Digital))?\b/gi, '');
function limparMarca(texto) {
  return tirarSufixoMarca(texto).replace(/\bAstronauta(\s+(Martech|Digital))?\b/g, '').replace(/\s{2,}/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Rótulos do balão de pensamento
// ---------------------------------------------------------------------------
const ACOES_TELA = {
  screenshot: 'Olhando a tela', left_click: 'Clicando', double_click: 'Clicando', triple_click: 'Clicando',
  right_click: 'Abrindo um menu', type: 'Digitando', key: 'Apertando uma tecla', scroll: 'Rolando a página',
  scroll_to: 'Rolando a página', wait: 'Esperando a página', zoom: 'Olhando de perto', hover: 'Passando o mouse',
  left_click_drag: 'Arrastando', mouse_move: 'Mexendo o mouse',
};
// Cara de chave ou token (revisão M-8): o balão repete frases do assistente e o
// projeto é público, então o que parece segredo vira "••••" antes de sair daqui.
const SEGREDOS = [
  /\b(?:sk|pk|rk)-(?:[a-z]+-)?[A-Za-z0-9_-]{16,}/g,          // OpenAI, Anthropic (sk-ant-...), Stripe
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,             // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,                         // Slack
  /\beyJ[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]+){0,2}/g,        // JWT
  /\bAKIA[0-9A-Z]{16}\b/g,                                   // AWS
  /\bAIza[0-9A-Za-z_-]{30,}/g,                               // Google
  /\b(?:Bearer|token[=:])\s*[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b[0-9a-f]{32,}\b/gi,                                     // hex longo
];
function mascararSegredos(texto) {
  let t = String(texto ?? '');
  for (const r of SEGREDOS) t = t.replace(r, '••••');
  return t;
}

// Frase curta: sem markdown, sem travessão nem meia-risca, caminho longo vira nome do
// arquivo, e nada com cara de chave ou token
function curto(texto, max = 48) {
  let t = mascararSegredos(texto)
    .replace(/`+/g, '')
    .replace(/\[([^\]]+)\]\([^)\s]*\)?/g, '$1')             // [texto](link) vira texto
    .replace(/\*\*|__/g, '')
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1 a $2')
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/(?<![\w.~:/-])(?:~|\.{1,2})?(?:\/[^\s/,;:'"()]+)+\/([^\s/,;:'"()]+)/g, '$1')
    .replace(/^[#>*\s-]+/, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/^,\s*/, '').replace(/\s*,$/, '');
  if (t.length > max) t = t.slice(0, max - 1).replace(/[\s,;:]+$/, '') + '…';
  return t;
}
function host(url) { try { return new URL(String(url).startsWith('http') ? url : 'https://' + url).host; } catch { return 'uma página'; } }
const arquivoCurto = p => {
  const b = path.basename(String(p || '').replace(/['"]/g, ''));
  return b.length > 24 ? b.slice(0, 23) + '…' : b;
};

// Bash: a description só vale se for português; senão, pelo primeiro binário do comando
function rotuloBash(e) {
  if (e.description && ehPortugues(e.description)) return e.description;
  const comando = String(e.command || '');
  const api = apiDoComando(comando);
  if (api) return `Consultando ${api} pela API`;
  const bin = primeiroBinario(comando);
  const trecho = comando.split(/&&|\|\||[;|\n]/).find(s => binarios(s)[0] === bin) || comando;
  // argumentos soltos: sem opções, textos entre aspas, variáveis ($J), números, redirecionamentos e o alvo deles
  const palavras = trecho.trim().split(/\s+/).slice(1);
  const args = palavras.filter((a, i) => a && !a.startsWith('-') && !/^['"$]/.test(a) && !/^\d+$/.test(a)
    && !/^[<>&|]/.test(a) && !/^[<>]/.test(palavras[i - 1] || ''));
  const alvo = (trecho.match(/>{1,2}\s*([^\s<>&|;]+)/) || [])[1];   // cat > arquivo <<EOF escreve, não lê
  switch (bin) {
    case 'git': return 'Mexendo no git';
    case 'node': case 'npm': case 'npx': case 'python': case 'python3': case 'bun': case 'deno': case 'pnpm': case 'yarn':
    case 'bash': case 'sh': case 'zsh': return 'Rodando um script';
    case 'curl': case 'wget': {
      const h = (trecho.match(/https?:\/\/([^\s/'"?#]+)/i) || [])[1];
      const c = h && hostCurto(h);
      return c ? 'Consultando ' + c : 'Consultando um endereço';
    }
    case 'ls': case 'find': case 'tree': case 'du': return 'Olhando a pasta';
    case 'cat': case 'sed': case 'head': case 'tail': case 'less': case 'wc': {
      if (bin === 'cat' && alvo) return 'Criando ' + arquivoCurto(alvo);
      const a = [...args].reverse().find(x => /\/|\.[A-Za-z0-9]{1,6}$/.test(x) && !/[()]/.test(x)) || (bin === 'sed' ? null : args[args.length - 1]);
      if (bin === 'sed' && /\s-i\b/.test(trecho)) return a ? 'Editando ' + arquivoCurto(a) : 'Editando um arquivo';
      return a ? 'Lendo ' + arquivoCurto(a) : 'Lendo um arquivo';
    }
    case 'grep': case 'rg': case 'ag': return 'Procurando no código';
    case 'cp': case 'mv': case 'mkdir': case 'rsync': case 'ln': case 'touch': return 'Organizando arquivos';
    case 'rm': return 'Apagando arquivos';
    case 'ffmpeg': case 'ffprobe': return 'Editando vídeo';
    case 'osascript': case 'open': return 'Mexendo no Mac';
    case 'sips': case 'magick': case 'convert': return 'Ajustando imagem';
    case 'gh': return 'Mexendo no GitHub';
    case 'ps': case 'lsof': case 'kill': case 'pkill': return 'Conferindo os processos';
    case 'jq': return 'Lendo dados';
    case 'tar': case 'zip': case 'unzip': return 'Empacotando arquivos';
  }
  return 'Rodando um comando';
}

// MCP: verbo do nome da ferramenta em português, prefixado pelo nome curto do conector
const VERBOS_MCP = new Map([
  ['get', 'lendo'], ['read', 'lendo'], ['fetch', 'lendo'], ['list', 'listando'], ['search', 'buscando'], ['find', 'buscando'],
  ['query', 'consultando'], ['create', 'criando'], ['add', 'criando'], ['update', 'atualizando'], ['patch', 'atualizando'],
  ['edit', 'atualizando'], ['send', 'enviando'], ['post', 'enviando'], ['publish', 'enviando'], ['delete', 'apagando'],
  ['remove', 'apagando'], ['generate', 'gerando'], ['upload', 'enviando'], ['download', 'baixando'], ['export', 'exportando'],
  ['import', 'importando'], ['run', 'rodando'], ['execute', 'rodando'], ['analyze', 'analisando'], ['schedule', 'agendando'],
]);
const OBJETOS_MCP = new Map([
  ['post', 'post'], ['posts', 'posts'], ['report', 'relatório'], ['reports', 'relatórios'], ['data', 'dados'],
  ['file', 'arquivo'], ['files', 'arquivos'], ['event', 'evento'], ['events', 'eventos'], ['message', 'mensagem'],
  ['messages', 'mensagens'], ['contact', 'contato'], ['contacts', 'contatos'], ['campaign', 'campanha'], ['campaigns', 'campanhas'],
  ['deal', 'negociação'], ['deals', 'negociações'], ['task', 'tarefa'], ['tasks', 'tarefas'], ['page', 'página'], ['pages', 'páginas'],
  ['project', 'projeto'], ['projects', 'projetos'], ['metrics', 'métricas'], ['user', 'usuário'], ['users', 'usuários'],
  ['channel', 'canal'], ['channels', 'canais'], ['thread', 'conversa'], ['threads', 'conversas'], ['image', 'imagem'],
  ['images', 'imagens'], ['video', 'vídeo'], ['videos', 'vídeos'], ['table', 'tabela'], ['tables', 'tabelas'],
  ['screenshot', 'print'], ['comment', 'comentário'], ['comments', 'comentários'], ['email', 'e-mail'], ['emails', 'e-mails'],
  ['document', 'documento'], ['documents', 'documentos'], ['doc', 'documento'], ['docs', 'documentos'], ['segment', 'segmento'],
  ['segments', 'segmentos'], ['workflow', 'fluxo'], ['workflows', 'fluxos'], ['transcript', 'transcrição'],
  ['transcripts', 'transcrições'], ['meeting', 'reunião'], ['meetings', 'reuniões'], ['account', 'conta'], ['accounts', 'contas'],
  ['audience', 'público'], ['keyword', 'palavra-chave'], ['keywords', 'palavras-chave'], ['design', 'design'],
  ['designs', 'designs'], ['funnel', 'funil'], ['analytics', 'métricas'], ['playlist', 'playlist'], ['note', 'nota'],
  ['notes', 'notas'], ['draft', 'rascunho'], ['drafts', 'rascunhos'], ['label', 'etiqueta'], ['labels', 'etiquetas'],
  ['ad', 'anúncio'], ['ads', 'anúncios'], ['form', 'formulário'], ['forms', 'formulários'], ['lead', 'lead'], ['leads', 'leads'],
  ['sql', 'SQL'], ['logs', 'logs'], ['calendar', 'agenda'], ['calendars', 'agendas'], ['folder', 'pasta'], ['folders', 'pastas'],
  ['audio', 'áudio'], ['clip', 'trecho'], ['clips', 'trechos'], ['summary', 'resumo'], ['prompts', 'prompts'],
]);
function rotuloMcp(nomeServico, ferramenta) {
  const partes = String(ferramenta || '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[_\-\s]+/).filter(Boolean);
  const i = partes.findIndex(p => VERBOS_MCP.has(p));
  if (i < 0) {   // sem verbo conhecido: 'funnel_analytics' vira 'consultando funil'
    const objeto = partes.map(p => OBJETOS_MCP.get(p)).find(Boolean);
    return objeto ? `${nomeServico}: consultando ${objeto}` : 'Usando ' + nomeServico;
  }
  const resto = [...partes.slice(i + 1), ...partes.slice(0, i)];
  const objeto = resto.map(p => OBJETOS_MCP.get(p)).find(Boolean);
  return `${nomeServico}: ${VERBOS_MCP.get(partes[i])}${objeto ? ' ' + objeto : ''}`;
}

function rotular(nome, e = {}) {
  const n = String(nome || '').split('__').pop();
  switch (nome) {
    case 'Read': return 'Lendo ' + (arquivoCurto(e.file_path) || 'um arquivo');
    case 'Edit': case 'MultiEdit': return 'Editando ' + (arquivoCurto(e.file_path) || 'um arquivo');
    case 'Write': return 'Criando ' + (arquivoCurto(e.file_path) || 'um arquivo');
    case 'NotebookEdit': return 'Editando ' + (arquivoCurto(e.notebook_path) || 'um caderno');
    case 'Bash': return rotuloBash(e);
    case 'Grep': return e.pattern ? `Procurando "${e.pattern}"` : 'Procurando no código';
    case 'Glob': return 'Procurando arquivos';
    case 'WebSearch': return e.query && ehPortugues(e.query) ? 'Buscando: ' + e.query : 'Buscando na web';
    case 'WebFetch': { const h = hostCurto(host(e.url)); return h ? 'Abrindo ' + h : 'Abrindo um site'; }
    case 'Agent': case 'Task': return e.description && ehPortugues(e.description) ? 'Chamando ajuda: ' + e.description : 'Chamando ajuda';
    case 'Workflow': return 'Chamando a equipe';
    case 'StructuredOutput': return 'Entregando o resultado';
    case 'Skill': return 'Seguindo um roteiro';
    case 'Monitor': return 'Acompanhando um processo';
    case 'TaskStop': return 'Encerrando uma tarefa';
    case 'Artifact': return 'Publicando uma página';
    case 'SendMessage': return 'Mandando recado a outro agente';
    case 'ScheduleWakeup': return 'Marcando para voltar depois';
    case 'ToolSearch': return 'Procurando uma ferramenta';
    case 'AskUserQuestion': return 'Perguntando para você';
    case 'SendUserFile': return 'Mandando um arquivo para você';
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return 'Organizando as tarefas';
    case 'ExitPlanMode': return 'Mostrando o plano';
    case 'PushNotification': return 'Avisando você';
  }
  const servidor = servidorDe(nome);
  if (!servidor) return 'Usando uma ferramenta';
  if (NAVEGADOR.test(servidor)) {
    if (n === 'computer') return ACOES_TELA[e.action] || 'Mexendo no navegador';
    if (ACOES_TELA[n]) return ACOES_TELA[n];
    if (n === 'navigate' || n === 'tabs_create') {
      if (/^(back|forward)$/i.test(String(e.url || ''))) return 'Voltando uma página';
      const d = destino(e.url);
      if (d === 'file:') return 'Abrindo um arquivo local';
      const h = d && hostCurto(d);
      return h ? 'Abrindo ' + h : 'Abrindo uma página';
    }
    if (n === 'browser_batch') return 'Fazendo uma sequência no navegador';
    if (n === 'javascript_tool') return 'Rodando script na página';
    if (/get_page_text|read_page/.test(n)) return 'Lendo a página';
    if (n === 'find') return 'Procurando na página';
    if (n === 'form_input') return 'Preenchendo um campo';
    return servidor === 'computer-use' ? 'Mexendo no Mac' : 'Mexendo no navegador';
  }
  if (SIMULADOR.test(servidor)) return 'Testando o app';
  if (ehBuscaWeb(servidor)) {
    const q = e.query || e.q;
    if (/search/.test(n)) return q && ehPortugues(q) ? 'Buscando: ' + q : 'Buscando na web';
    if (/scrape|crawl|extract/.test(n) && e.url) { const h = hostCurto(host(e.url)); return h ? 'Lendo ' + h : 'Lendo um site'; }
    return 'Pesquisando na web';
  }
  const c = conectorDe(nome);
  if (c) return rotuloMcp(c, n);
  if (/^visualize$/i.test(servidor) || /^visualize$/i.test(nomeResolvido(servidor))) return 'Desenhando um visual';
  if (/^terminal$/i.test(servidor)) return 'Olhando o terminal';
  return 'Usando uma ferramenta';
}

// Últimas coisas que a sessão fez, em frases curtas, para o balão de pensamento.
// Fica de fora: erro sintético da API, 'No response requested.', frase em inglês
// e qualquer coisa que ainda cite a marca.
function pensamentos(linhas, max = 6) {
  const lista = [];
  const pode = texto => texto && !MARCA.test(texto);
  for (const d of linhas) {
    if (d.type !== 'assistant' || !Array.isArray(d.content) || d.isApiErrorMessage) continue;
    d.content.forEach((c, i) => {
      if (c.type === 'tool_use') {
        const texto = curto(tirarSufixoMarca(rotular(c.name, c.input || {})));
        if (pode(texto)) lista.push({ id: c.id, texto });
      } else if (c.type === 'text' && c.texto?.trim()) {
        const bruto = c.texto.trim();
        if (/^No response requested\.?$/i.test(bruto) || /^API Error\b/i.test(bruto)) return;
        const frase = bruto.split(/(?<=[.!?:])\s/)[0];
        if (!ehPortugues(frase)) return;
        const texto = curto(tirarSufixoMarca(frase), 60);
        if (pode(texto)) lista.push({ id: d.uuid + ':' + i, texto });
      }
    });
  }
  return lista.slice(-max);
}

// Nome do subagente: description em português (rótulo de workflow humanizado) ou 'Ajudante'
function nomeDoSubagente(meta) {
  const d = String(meta?.description || '').trim();
  if (!d || d === 'general-purpose') return 'Ajudante';
  if (/^[\p{L}\d]+(?:[:_-]+[\p{L}\d]+)+$/u.test(d)) {        // rótulo: 'auditoria:VIS', 'R2-HUD-TEXTOS'
    const partes = d.split(/[:_-]+/);
    const ingles = partes.some(p => VERBOS_EN.has(p.toLowerCase()) || PALAVRAS_EN.has(p.toLowerCase()));
    if (!ingles) {
      const nome = partes.map((p, i) => i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p).join(' ');
      return MARCA.test(nome) ? 'Ajudante' : nome;
    }
    return 'Ajudante';
  }
  if (!ehPortugues(d)) return 'Ajudante';
  const nome = curto(tirarSufixoMarca(d), 48);
  return MARCA.test(nome) ? 'Ajudante' : nome;
}

// Serviço (MCP ou API) usado nos últimos segundos. As chamadas costumam ser rápidas
// e intercaladas com outras ações; sem isso o astronauta nem chegaria à sala.
const JANELA_CONECTOR_MS = 15 * 1000;
function conectorRecente(linhas, agora) {
  for (let i = linhas.length - 1; i >= 0; i--) {
    const d = linhas[i];
    const quando = Date.parse(d.timestamp || '');
    if (quando && agora - quando > JANELA_CONECTOR_MS) return null;
    if (d.type !== 'assistant' || !Array.isArray(d.content)) continue;
    for (const c of d.content) {
      if (c.type === 'tool_use') { const s = servicoDe(c.name, c.input); if (s) return s; }
    }
  }
  return null;
}

const textoAjudantes = n => n === 1 ? 'acompanhando 1 ajudante' : `acompanhando ${n} ajudantes`;

// ---------------------------------------------------------------------------
// Janela de contexto: % usado na última resposta. Os modelos atuais (Opus, Sonnet e
// Fable 5.x, Opus e Sonnet 4.6 em diante) têm 1M; Haiku e os anteriores, 200 mil.
// Se o uso passou da janela suposta, a janela é a maior.
// ---------------------------------------------------------------------------
const JANELA_PEQUENA = /haiku|claude-3|(opus|sonnet)-4($|-[0-5]($|-)|-\d{8})/i;
function contextoDe(t) {
  const c = t?.contexto;
  if (!c?.tokens) return null;
  let janela = JANELA_PEQUENA.test(c.modelo) ? 200_000 : 1_000_000;
  if (c.tokens > janela) janela = 1_000_000;
  return Math.min(100, Math.round(c.tokens / janela * 100));
}

// ---------------------------------------------------------------------------
// O que o agente está fazendo agora, pelo conteúdo da transcrição (DADOS-07)
// Devolve { atividade, texto, conector, conectorTipo, ferramenta }
// ---------------------------------------------------------------------------
function derivarAtividade(t, agora, ajudantesAtivos = 0) {
  const ultima = t.ultimaFerramenta;
  const ferramenta = ultima?.nome || null;
  const simples = (atividade, texto, nomeFerramenta = ferramenta) => ({ atividade, texto, conector: null, conectorTipo: null, ferramenta: nomeFerramenta });
  const doServico = (s, nomeFerramenta = ferramenta) => ({ atividade: 'conector', texto: textoServico(s), conector: s.nome, conectorTipo: s.tipo, ferramenta: nomeFerramenta });
  const pelaFerramenta = f => {
    const r = avaliarFerramenta(f, t);
    if (r.atividade === 'editar') {
      const s = conectorRecente(t.linhas, agora);
      if (s) return doServico(s, f.nome);
    }
    return { ...r, ferramenta: f.nome };
  };

  // (a) ferramenta ainda sem resposta: a atividade é a dela
  let pendente = null;
  for (const f of t.pendentes.values()) if (!pendente || f.quando >= pendente.quando) pendente = f;
  if (pendente) {
    if (ajudantesAtivos > 0 && ['Agent', 'Task'].includes(pendente.nome)) {
      return simples('coordenar', textoAjudantes(ajudantesAtivos), pendente.nome);
    }
    return pelaFerramenta(pendente);
  }

  // (d) turno encerrado (end_turn) mas a sessão segue ocupada com ajudantes trabalhando
  const turnoFechado = t.ultimaRelevante?.fimDeTurno;
  if (turnoFechado && ajudantesAtivos > 0) return simples('coordenar', textoAjudantes(ajudantesAtivos));
  if (turnoFechado) return simples('editar', TEXTOS.editar);

  // (b) pedido novo do usuário depois da última ferramenta
  if (t.ultimoPromptQuando && t.ultimoPromptQuando > (ultima?.quando || 0)) return simples('editar', 'lendo seu pedido');

  // nenhuma ferramenta à vista (mesmo depois da janela maior da primeira leitura)
  if (!ultima) return simples('editar', TEXTOS.editar, null);

  // (c) ferramenta já respondida: serviço (MCP ou API) vale por 15 s; o resto, por 20 s
  const s = conectorRecente(t.linhas, agora);
  if (s) return doServico(s);
  const respondidaEm = t.respondidas.get(ultima.id) || ultima.quando || 0;
  if (agora - respondidaEm > PENSANDO_MS) return simples('editar', 'pensando na resposta');
  const r = pelaFerramenta(ultima);
  if (r.atividade === 'conector') return simples('editar', TEXTOS.editar);   // serviço fora da janela de 15 s
  return r;
}

// ---------------------------------------------------------------------------
// Subagentes de uma sessão
// ---------------------------------------------------------------------------
// subagentes comuns ficam em subagents/agent-*.jsonl; os de workflow em subagents/workflows/<run>/agent-*.jsonl
function arquivosDeSubagentes(dirSub) {
  const arquivos = [];
  const varrer = (dir, nivel) => {
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory() && nivel < 2) varrer(p, nivel + 1);
      else if (it.isFile() && it.name.startsWith('agent-') && it.name.endsWith('.jsonl')) arquivos.push(p);
    }
  };
  varrer(dirSub, 0);
  return arquivos;
}

// ---------------------------------------------------------------------------
// Tarefas em segundo plano (Bash/Monitor com run_in_background): o Claude Code grava
// a saída em /private/tmp/claude-<uid>/<projeto>/<sessão>/tasks/<id>.output e o
// processo da tarefa mantém esse arquivo aberto enquanto roda. Um lsof a cada 5 s,
// em segundo plano, diz quais estão abertos; a transcrição diz quais são de fundo
// (o tool_result traz "running in background with ID: X") e a descrição de cada uma.
// Comando em primeiro plano também abre um arquivo desses: fica de fora quando há
// Bash pendente que começou junto (até 5 s) com o arquivo.
// ---------------------------------------------------------------------------
let tarefasAbertas = new Map();   // sessionId -> Map(id -> criadoEm ms)
let lendoTarefas = false, tarefasLidasEm = 0;
function atualizarTarefasAbertas() {
  if (lendoTarefas || Date.now() - tarefasLidasEm < 5000) return;
  lendoTarefas = true;
  execFile('lsof', ['-a', '-u', String(process.getuid()), '-d', '1', '-Fn'], { timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (erro, saida) => {
    lendoTarefas = false; tarefasLidasEm = Date.now();
    if (erro && !saida) return;
    const novo = new Map();
    for (const m of String(saida).matchAll(/^n(\/(?:private\/)?tmp\/claude-\d+\/[^/\n]+\/([0-9a-f-]{36})\/tasks\/(\w+)\.output)$/gm)) {
      if (!novo.has(m[2])) novo.set(m[2], new Map());
      if (novo.get(m[2]).has(m[3])) continue;
      let criado = 0;
      try { const st = fs.statSync(m[1]); criado = st.birthtimeMs || st.ctimeMs; } catch { continue; }
      novo.get(m[2]).set(m[3], criado);
    }
    tarefasAbertas = novo;
  });
}

function tarefasDaSessao(s, t, pasta, raiz, agora) {
  atualizarTarefasAbertas();
  const abertas = tarefasAbertas.get(s.sessionId);
  if (!abertas?.size) return [];
  const bashPendentes = t ? [...t.pendentes.values()].filter(f => f.nome === 'Bash' || f.nome === 'Monitor') : [];
  const lista = [];
  for (const [id, criado] of abertas) {
    const conhecida = t?.tarefasFundo.get(id);
    if (conhecida?.ferramenta === 'Workflow') continue;   // workflow vira astronauta em subagentesDa
    if (!conhecida && bashPendentes.some(f => Math.abs(f.quando - criado) < 5000)) continue;   // comando em primeiro plano
    const desc = String(conhecida?.descricao || '').trim();
    lista.push({
      id: 'tarefa-' + id, nome: desc && ehPortugues(desc) ? desc : 'Tarefa em segundo plano', tipo: 'subagente', pai: s.sessionId,
      pasta, pastaCaminho: raiz, provedor: 'anthropic', contexto: null,
      pendencia: null, pendenteHaMs: null, abrivel: false,
      atividade: 'editar', texto: 'rodando em segundo plano', conector: null, conectorTipo: null,
      ferramenta: conhecida?.ferramenta || 'Bash', pensamentos: [], paradoHaMs: null, aguardando: null, terminou: false,
      tarefaFundo: true,
    });
  }
  return lista;
}

// Workflow lançado há muito tempo (fora dos últimos 256 KB lidos da transcrição): o
// nome e o "ainda rodando" saem de um grep em segundo plano na transcrição da mãe,
// guardado por execução e refeito a cada 20 s (só enquanto o workflow aparece).
const wfAntigos = new Map();   // runId -> { taskId, resumo, terminou, lidoEm, lendo }
function workflowAntigo(transcricao, runId) {
  let w = wfAntigos.get(runId);
  if (!w) { w = { taskId: null, resumo: '', terminou: false, lidoEm: 0, lendo: false }; wfAntigos.set(runId, w); }
  if (!w.lendo && Date.now() - w.lidoEm > 20000) {
    w.lendo = true;
    execFile('grep', ['-F', '-m', '1', 'Run ID: ' + runId, transcricao], { timeout: 5000, maxBuffer: 64 * 1024 * 1024 }, (e1, linha) => {
      const m = String(linha || '').match(/Task ID: (\w+)\\nSummary: (.*?)\\n/);
      if (m) { w.taskId = m[1]; w.resumo = m[2].slice(0, 300); }
      if (!w.taskId) { w.lendo = false; w.lidoEm = Date.now(); return; }
      execFile('grep', ['-F', '-c', '<task-id>' + w.taskId + '</task-id>', transcricao], { timeout: 5000 }, (e2, n) => {
        w.terminou = Number(String(n || '0').trim()) > 0;
        w.lendo = false; w.lidoEm = Date.now();
        cacheEstado.quando = 0;
      });
    });
  }
  return w;
}

// Monta os subagentes vivos (ativos ou recém-terminados) de uma sessão.
// Devolve { lista, ativos, ultimoFim }
function subagentesDa(s, transcricaoMae, tMae, pasta, raiz, agora) {
  const lista = [];
  let ativos = 0;
  let ultimoFim = 0;
  if (!transcricaoMae) return { lista, ativos, ultimoFim };
  const dirSub = path.join(path.dirname(transcricaoMae), s.sessionId, 'subagents');
  const runs = new Map();   // runId do workflow -> { ativos: [{ t, rotulo, quando }], ultimoFim }
  for (const p of arquivosDeSubagentes(dirSub)) {
    const id = path.basename(p).replace(/\.jsonl$/, '');
    try {
      let mtime = 0;
      try { mtime = fs.statSync(p).mtimeMs; } catch { continue; }
      if (agora - mtime > SUBAGENTE_TETO_MS) continue;     // teto de segurança
      const meta = lerJson(p.replace(/\.jsonl$/, '.meta.json')) || {};
      const t = lerTranscricao(p);
      const agentId = id.replace(/^agent-/, '');

      // terminou?
      let terminou;
      const dirRun = path.dirname(p);
      const journal = path.join(dirRun, 'journal.jsonl');
      if (path.basename(path.dirname(dirRun)) === 'workflows' && fs.existsSync(journal)) {
        const j = lerJournal(journal);
        terminou = j.resultados.has(agentId) || !j.iniciados.has(agentId) && t.ultimaRelevante?.fimDeTurno === true;
      } else {
        terminou = t.ultimaRelevante?.fimDeTurno === true;
        // cruzamento com a mãe: o tool_result do Agent chegou depois da última linha do ajudante
        const respostaMae = meta.toolUseId && tMae ? tMae.respondidas.get(meta.toolUseId) : 0;
        if (!terminou && respostaMae && respostaMae >= (t.ultimaRelevante?.quando || 0) - 1000) terminou = true;
      }

      // agente de workflow: o workflow inteiro é UM astronauta (pedido do Eduardo, 03/10:
      // "o astronauta que vai estar sentado com ele é o que hoje está sendo chamado de
      // revisão final"); aqui só junta o estado de cada agente por execução
      if (path.basename(path.dirname(dirRun)) === 'workflows') {
        const runId = path.basename(dirRun);
        if (!runs.has(runId)) runs.set(runId, { ativos: [], ultimoFim: 0 });
        const r = runs.get(runId);
        if (terminou) r.ultimoFim = Math.max(r.ultimoFim, t.ultimoQuando || mtime);
        else r.ativos.push({ t, rotulo: nomeDoSubagente(meta), quando: t.ultimoQuando || mtime });
        continue;
      }

      const base = {
        id, nome: nomeDoSubagente(meta), tipo: 'subagente', pai: s.sessionId,
        pasta, pastaCaminho: raiz, provedor: 'anthropic', contexto: contextoDe(t),
        pendencia: null, pendenteHaMs: null, abrivel: false,   // ajudante não entra nas filas
      };
      if (terminou) {
        const fim = t.ultimoQuando || mtime;
        if (agora - fim > DESCANSO_MAX_MS) continue;
        if (fim > ultimoFim) ultimoFim = fim;
        lista.push({
          ...base, atividade: 'descansar', texto: 'terminou a tarefa', conector: null, conectorTipo: null,
          ferramenta: t.ultimaFerramenta?.nome || null, pensamentos: [], paradoHaMs: Math.max(0, agora - fim),
          aguardando: null, terminou: true,
        });
      } else {
        ativos++;
        const d = derivarAtividade(t, agora, 0);
        lista.push({
          ...base, atividade: d.atividade, texto: d.texto, conector: d.conector, conectorTipo: d.conectorTipo,
          ferramenta: d.ferramenta, pensamentos: pensamentos(t.linhas), paradoHaMs: null, aguardando: null, terminou: false,
        });
      }
    } catch (e) {
      lista.push(...falhaDeAgente(id, e, agora));
    }
  }
  // um astronauta por workflow: nome = resumo da tarefa (até os dois-pontos), como no
  // painel de tarefas do app; atividade = a do agente dele que mexeu por último
  const tarefasWf = new Map();
  for (const [, tf] of tMae?.tarefasFundo || []) if (tf.ferramenta === 'Workflow' && tf.runId) tarefasWf.set(tf.runId, tf);
  for (const runId of new Set([...runs.keys(), ...tarefasWf.keys()])) {
    const r = runs.get(runId) || { ativos: [], ultimoFim: 0 };
    let tf = tarefasWf.get(runId);
    if (!tf) {
      const w = workflowAntigo(transcricaoMae, runId);
      if (w.resumo && !w.terminou) tf = { descricao: w.resumo };
      else if (w.resumo) r.resumo = w.resumo;
    }
    const resumo = String(tf?.descricao || r.resumo || '').split(/:\s/)[0].trim();
    const base = {
      id: 'workflow-' + runId, nome: resumo || 'Workflow', tipo: 'subagente', pai: s.sessionId,
      pasta, pastaCaminho: raiz, provedor: 'anthropic', contexto: null, tarefaFundo: true,
      pendencia: null, pendenteHaMs: null, abrivel: false,
    };
    if (r.ativos.length) {
      ativos++;
      const mais = r.ativos.sort((a, b) => b.quando - a.quando)[0];
      const d = derivarAtividade(mais.t, agora, 0);
      lista.push({
        ...base, contexto: contextoDe(mais.t), atividade: d.atividade, texto: d.texto, conector: d.conector, conectorTipo: d.conectorTipo,
        ferramenta: d.ferramenta, pensamentos: pensamentos(mais.t.linhas), paradoHaMs: null, aguardando: null, terminou: false,
        etapa: mais.rotulo, agentesAtivos: r.ativos.length,
      });
    } else if (tf) {
      // ainda rodando, entre uma etapa e outra
      ativos++;
      lista.push({ ...base, atividade: 'editar', texto: 'passando para a próxima etapa', conector: null, conectorTipo: null,
        ferramenta: 'Workflow', pensamentos: [], paradoHaMs: null, aguardando: null, terminou: false, agentesAtivos: 0 });
    } else if (r.ultimoFim && agora - r.ultimoFim <= DESCANSO_MAX_MS) {
      if (r.ultimoFim > ultimoFim) ultimoFim = r.ultimoFim;
      lista.push({ ...base, atividade: 'descansar', texto: 'terminou a tarefa', conector: null, conectorTipo: null,
        ferramenta: null, pensamentos: [], paradoHaMs: Math.max(0, agora - r.ultimoFim), aguardando: null, terminou: true });
    }
  }
  return { lista, ativos, ultimoFim };
}

// ---------------------------------------------------------------------------
// Robustez: último estado bom por id (até 10 s) e log de erro uma vez por id
// ---------------------------------------------------------------------------
const ultimoBomPorId = new Map();   // id -> { agente, quando }
const restaurados = new WeakSet();  // agentes devolvidos do "último bom" (não renovam o prazo)
const errosLogados = new Set();
function falhaDeAgente(id, e, agora, comFilhos = false) {
  if (!errosLogados.has(id)) { errosLogados.add(id); console.error(`[leitura] erro em ${id}:`, e); }
  const volta = [];
  for (const [k, v] of ultimoBomPorId) {
    if (agora - v.quando > ULTIMO_BOM_MS) continue;
    if (k === id || (comFilhos && v.agente.pai === id)) { restaurados.add(v.agente); volta.push(v.agente); }
  }
  return volta;
}

// ---------------------------------------------------------------------------
// Montagem do estado
// ---------------------------------------------------------------------------
function statusDaSessao(s) {
  if (s.status === 'busy') return { tipo: 'trabalho' };
  if (s.status === 'shell') return { tipo: 'shell' };
  if (s.status === 'waiting') {
    if (s.waitingFor === 'permission prompt') return { tipo: 'esperar', aguardando: 'permissao', texto: 'esperando sua aprovação' };
    if (s.waitingFor === 'input needed') return { tipo: 'esperar', aguardando: 'pergunta', texto: 'tem uma pergunta para você' };
    return { tipo: 'esperar', aguardando: 'outro', texto: 'esperando você' };
  }
  return { tipo: 'parado' };   // idle, ausente ou desconhecido: nunca 'esperar'
}

function sessoesAbertas() {
  const vivas = [];
  for (const arq of listar(SESSOES)) {
    if (!arq.endsWith('.json')) continue;
    const s = lerJson(path.join(SESSOES, arq));
    if (!s?.sessionId || !s.cwd || !s.pid) continue;
    if (s.spare === true || s.parkedJobId) continue;    // pré-aquecida ou estacionada
    if (!processoVivo(s.pid)) continue;
    vivas.push(s);
  }
  atualizarInicios(vivas.map(s => s.pid));
  return vivas.filter(mesmoProcesso);                   // descarta PID reaproveitado
}

function agentesDaSessao(s, agora) {
  const raiz = s.cwd;
  const pasta = path.basename(raiz) || raiz;
  const transcricao = acharTranscricao(s.sessionId);
  const t = transcricao ? lerTranscricao(transcricao) : null;
  const subs = subagentesDa(s, transcricao, t, pasta, raiz, agora);
  // tarefas em segundo plano contam como ajudantes trabalhando (um astronauta cada)
  const tarefas = tarefasDaSessao(s, t, pasta, raiz, agora);
  subs.lista.push(...tarefas);
  subs.ativos += tarefas.length;
  const st = statusDaSessao(s);

  const sessao = {
    id: s.sessionId, nome: limparMarca(s.name) || pasta, tipo: 'sessao', pasta, pastaCaminho: raiz, provedor: 'anthropic', contexto: contextoDe(t),
    atividade: 'descansar', texto: TEXTOS.descansar, conector: null, conectorTipo: null,
    ferramenta: t?.ultimaFerramenta?.nome || null, pensamentos: [], paradoHaMs: null, aguardando: null, terminou: false,
    // rodada 6: fila na sala do dono e na revisão; abrivel = o servidor sabe abrir no app
    pendencia: null, pendenteHaMs: null, abrivel: !!idLocalDe(s),
  };
  // AskUserQuestion sem resposta com a sessão trabalhando também é esperar você
  const pergunta = st.tipo === 'trabalho' || st.tipo === 'shell' ? perguntaPendente(t) : null;

  if (st.tipo === 'parado') {
    const paradoDesde = Math.max(s.statusUpdatedAt || s.updatedAt || s.startedAt || 0, subs.ultimoFim);
    const parado = Math.max(0, agora - paradoDesde);
    if (subs.ativos > 0) {
      Object.assign(sessao, { atividade: 'coordenar', texto: textoAjudantes(subs.ativos) });
    } else if (parado <= SUGESTAO_MAX_MS && fechouComSugestao(t)) {
      // terminou oferecendo um próximo passo: vai para a fila da revisão (sem relógio)
      Object.assign(sessao, { atividade: 'revisar', texto: 'terminou com uma sugestão', paradoHaMs: parado,
        pendencia: 'entrega_com_sugestao', pendenteHaMs: parado });
    } else {
      if (parado > DESCANSO_MAX_MS) return [];   // foi embora (e os ajudantes terminados com ela)
      sessao.paradoHaMs = parado;
    }
  } else if (st.tipo === 'esperar' || pergunta) {
    const desde = st.tipo === 'esperar' ? (s.statusUpdatedAt || s.updatedAt || agora) : pergunta.quando;
    Object.assign(sessao, {
      atividade: 'esperar', texto: st.texto || 'tem uma pergunta para você', aguardando: st.aguardando || 'pergunta',
      pensamentos: t ? pensamentos(t.linhas) : [], pendencia: 'precisa_de_voce', pendenteHaMs: Math.max(0, agora - desde),
    });
  } else if (st.tipo === 'shell') {
    Object.assign(sessao, { atividade: 'editar', texto: 'rodando um comando', pensamentos: t ? pensamentos(t.linhas) : [] });
  } else {
    const d = t ? derivarAtividade(t, agora, subs.ativos) : { atividade: 'editar', texto: TEXTOS.editar, conector: null, conectorTipo: null, ferramenta: null };
    Object.assign(sessao, {
      atividade: d.atividade, texto: d.texto, conector: d.conector, conectorTipo: d.conectorTipo,
      ferramenta: d.ferramenta, pensamentos: t ? pensamentos(t.linhas) : [],
    });
  }
  return [sessao, ...subs.lista];
}

// ---------------------------------------------------------------------------
// Dono da conta: só oauthAccount.displayName de ~/.claude.json (ou
// $CLAUDE_CONFIG_DIR/.claude.json). Nenhum outro campo é guardado, logado ou enviado.
// Lido em segundo plano, cache de 10 min; null se não houver.
// ---------------------------------------------------------------------------
let dono = null;
let donoLidoEm = 0;
let lendoDono = false;
const DONO_MS = 10 * 60 * 1000;
function pedirDono() {
  if (lendoDono || Date.now() - donoLidoEm < DONO_MS) return;
  lendoDono = true;
  fsp.readFile(ARQUIVO_CONTA, 'utf8').then(texto => {
    const nome = JSON.parse(texto)?.oauthAccount?.displayName;
    const limpo = typeof nome === 'string' ? limparMarca(nome).slice(0, 40) : '';
    dono = limpo ? { nome: limpo } : null;
    donoLidoEm = Date.now();
  }).catch(e => {
    if (e?.code === 'ENOENT') { dono = null; donoLidoEm = Date.now(); }
    else donoLidoEm = Date.now() - DONO_MS + 60 * 1000;   // arquivo sendo regravado: tenta de novo em 1 min (sem logar conteúdo)
  }).finally(() => { lendoDono = false; cacheEstado.quando = 0; });
}

// ---------------------------------------------------------------------------
// Codex por perto: algum arquivo em ~/.codex/sessions/AAAA/MM/DD (ou
// $CODEX_HOME/sessions) modificado nos últimos 7 dias. Só readdir e stat, limitados
// aos dias mais recentes; nada de ler conteúdo. Cache de 5 min.
// ---------------------------------------------------------------------------
let codexAtivo = false;
let codexLidoEm = 0;
let lendoCodex = false;
async function haCodexRecente() {
  const base = path.join(CODEX, 'sessions');
  const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const listarDesc = async dir => { try { return (await fsp.readdir(dir)).filter(n => !n.startsWith('.')).sort().reverse(); } catch { return []; } };
  const recente = async arquivo => { try { const st = await fsp.stat(arquivo); return st.isFile() && st.mtimeMs > limite; } catch { return false; } };
  let dias = 0, stats = 0;
  for (const ano of (await listarDesc(base)).slice(0, 2)) {
    if (!/^\d{4}$/.test(ano)) { if (++stats <= 300 && await recente(path.join(base, ano))) return true; continue; }
    for (const mes of (await listarDesc(path.join(base, ano))).slice(0, 3)) {
      for (const dia of await listarDesc(path.join(base, ano, mes))) {
        if (++dias > 10) return false;
        const dirDia = path.join(base, ano, mes, dia);
        for (const arq of (await listarDesc(dirDia)).slice(0, 50)) {
          if (++stats > 300) return false;
          if (await recente(path.join(dirDia, arq))) return true;
        }
      }
    }
  }
  return false;
}
function pedirCodex() {
  if (lendoCodex || Date.now() - codexLidoEm < 5 * 60 * 1000) return;
  lendoCodex = true;
  haCodexRecente().then(v => { codexAtivo = v === true; }).catch(() => {})
    .finally(() => { codexLidoEm = Date.now(); lendoCodex = false; cacheEstado.quando = 0; });
}

// ---------------------------------------------------------------------------
// Medidores de janela de uso (Sala Anthropic e Sala OpenAI)
// Claude: painel claude-usage local (quotas), lido em segundo plano; sem ele, nada
// (a Estação não lê credencial OAuth). Codex: rate_limits das transcrições, ou o
// painel quando ele tem um valor mais novo.
// ---------------------------------------------------------------------------
const PAINEL_USO = process.env.PAINEL_USO_URL === 'nao' ? null : (process.env.PAINEL_USO_URL || 'http://127.0.0.1:8090/api/state');
const PAINEL_MS = 60 * 1000;
const PAINEL_TIMEOUT_MS = 1500;
let painelUso = null;          // { quotas, lidoEm } da última leitura boa
let painelLidoEm = 0;
let lendoPainel = false;

function pedirPainelUso() {
  if (!PAINEL_USO || lendoPainel || Date.now() - painelLidoEm < PAINEL_MS) return;
  lendoPainel = true;
  let url;
  try { url = new URL(PAINEL_USO); } catch { lendoPainel = false; painelLidoEm = Date.now(); return; }
  // só endereço local: o painel roda nesta máquina
  if (!/^(127\.0\.0\.1|localhost|\[::1\])$/i.test(url.hostname) || url.protocol !== 'http:') { lendoPainel = false; painelLidoEm = Date.now(); return; }
  const fim = ok => { lendoPainel = false; painelLidoEm = Date.now(); if (!ok && painelUso && Date.now() - painelUso.lidoEm > 10 * PAINEL_MS) painelUso = null; cacheEstado.quando = 0; };
  const req = http.get(url, { timeout: PAINEL_TIMEOUT_MS }, res => {
    if (res.statusCode !== 200) { res.resume(); return fim(false); }
    let corpo = '', tamanho = 0;
    res.setEncoding('utf8');
    res.on('data', c => { tamanho += c.length; if (tamanho > 2 * 1024 * 1024) { req.destroy(); return; } corpo += c; });
    res.on('end', () => {
      try {
        const j = JSON.parse(corpo);
        if (!Array.isArray(j?.quotas)) return fim(false);
        // só o que os medidores usam; nada de plano, conta ou histórico
        painelUso = {
          lidoEm: Date.now(),
          quotas: j.quotas.map(q => ({ provider: q.provider, label: q.label, key: q.key, utilization: q.utilization,
            resets_at: q.resets_at, window_hours: q.window_hours, snapshot_ts: q.snapshot_ts })),
        };
        fim(true);
      } catch { fim(false); }
    });
    res.on('error', () => fim(false));
  });
  req.on('timeout', () => req.destroy());
  req.on('error', () => fim(false));
}

const msDe = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
const rotuloCurto = r => String(r || '').replace(/(\d+)\s*horas?\b/i, '$1 h').replace(/\s*[\u2014\u2013]\s*/g, ' · ').trim();
const pctDe = v => (v == null || v === '' || !Number.isFinite(+v) ? null : Math.max(0, Math.min(100, +v)));

function medidoresDoPainel(provider) {
  const qs = (painelUso?.quotas || []).filter(q => q.provider === provider);
  return qs.map(q => ({
    rotulo: rotuloCurto(q.label || q.key) || 'Uso',
    pct: pctDe(q.utilization),
    reiniciaEm: msDe(q.resets_at),
    janelaMin: q.window_hours ? Math.round(q.window_hours * 60) : null,
    visto: msDe(q.snapshot_ts) || painelUso.lidoEm,
  }));
}

function medidoresDoCodex(rl) {
  if (!rl) return [];
  const janela = j => {
    if (!j) return null;
    const min = Number(j.window_minutes) || null;
    const reinicia = j.resets_at != null ? msDe(j.resets_at)
      : j.resets_in_seconds != null ? rl.visto_em + j.resets_in_seconds * 1000 : null;
    const rot = !min ? 'Codex' : min >= 1440 ? `Codex · ${Math.round(min / 1440)} dias` : `Codex · ${Math.round(min / 60)} h`;
    return { rotulo: rot, pct: pctDe(j.used_percent), reiniciaEm: reinicia, janelaMin: min, visto: rl.visto_em };
  };
  return [janela(rl.primary), janela(rl.secondary)].filter(Boolean);
}

// Janela que já reiniciou desde a leitura: o uso voltou a zero
function atualizarMedidor(m, agora) {
  const vencido = m.reiniciaEm && m.reiniciaEm <= agora && m.visto < m.reiniciaEm;
  return { rotulo: m.rotulo, pct: vencido ? 0 : m.pct, reiniciaEm: vencido ? null : m.reiniciaEm, janelaMin: m.janelaMin };
}

function limitesAtuais(agora = Date.now()) {
  pedirPainelUso();
  const doPainel = medidoresDoPainel('claude');
  const anthropic = doPainel.length
    ? { medidores: doPainel.map(m => atualizarMedidor(m, agora)), atualizadoEm: Math.min(...doPainel.map(m => m.visto)), fonte: 'painel' }
    : { medidores: [], atualizadoEm: null, fonte: 'indisponivel', aviso: 'esta instalação não tem acesso aos limites do plano' };
  let rl = null;
  try { rl = limitesCodex(agora); } catch { /* sem Codex */ }
  const daTranscricao = medidoresDoCodex(rl);
  const codexPainel = medidoresDoPainel('codex');
  const usarPainel = codexPainel.length && (!daTranscricao.length || Math.max(...codexPainel.map(m => m.visto)) > (rl?.visto_em || 0));
  const lista = usarPainel ? codexPainel : daTranscricao;
  const openai = lista.length
    ? { medidores: lista.map(m => atualizarMedidor(m, agora)).sort((a, b) => (a.janelaMin ?? 0) - (b.janelaMin ?? 0)),
      atualizadoEm: Math.min(...lista.map(m => m.visto)), fonte: usarPainel ? 'painel' : 'transcricoes' }
    : { medidores: [], atualizadoEm: null, fonte: 'indisponivel', aviso: 'nenhuma sessão do Codex informou os limites ainda' };
  return { anthropic, openai };
}

let ultimoBom = [];
function estado() {
  const agora = Date.now();
  pedirDono();
  pedirCodex();
  const agentes = [];
  for (const s of sessoesAbertas()) {
    try {
      agentes.push(...agentesDaSessao(s, agora));
    } catch (e) {
      agentes.push(...falhaDeAgente(s.sessionId, e, agora, true));
    }
  }
  // tripulação do Codex (app/fonte-codex.js), convivendo com a do Claude
  try { agentes.push(...agentesCodex(agora)); } catch (e) { console.error('[codex] falha ao ler sessões:', e); }
  for (const a of agentes) if (!restaurados.has(a)) ultimoBomPorId.set(a.id, { agente: a, quando: agora });
  for (const [k, v] of ultimoBomPorId) if (agora - v.quando > 60 * 1000) ultimoBomPorId.delete(k);
  limparLeitores();
  ultimoBom = agentes;
  return { agentes, geradoEm: agora, provedores: { codex: codexAtivo }, limitesCodex: limitesCodex(), limites: limitesAtuais(agora), dono,
    ...(CARGA_TESTE && agora - CARGA_TESTE.inicio < CARGA_TESTE.min * 60000 ? { cargaTeste: CARGA_TESTE } : {}) };
}

let cacheEstado = { corpo: null, quando: 0 };
// Teste de estresse na própria tela: ESTACAO_CARGA=50-120:10 faz a página somar à leitura
// real astronautas simulados de 50 a 120 por 10 min (fonte.js gera os bonecos)
const CARGA_TESTE = (() => {
  const m = String(process.env.ESTACAO_CARGA || '').match(/^(\d+)-(\d+)(?::(\d+))?$/);
  return m ? { a: +m[1], b: +m[2], min: +(m[3] || 10), inicio: Date.now() } : null;
})();
function corpoDoEstado() {
  const agora = Date.now();
  if (cacheEstado.corpo && agora - cacheEstado.quando < CACHE_ESTADO_MS) return cacheEstado.corpo;
  let corpo;
  try { corpo = JSON.stringify(estado()); }
  catch (e) {
    console.error('[estado] falha geral:', e);
    let limites = null, medidores = null;
    try { limites = limitesCodex(); } catch {}
    try { medidores = limitesAtuais(agora); } catch {}
    corpo = JSON.stringify({ erro: String(e?.message || e), agentes: ultimoBom, geradoEm: agora, provedores: { codex: codexAtivo }, limitesCodex: limites, limites: medidores, dono });
  }
  cacheEstado = { corpo, quando: agora };
  return corpo;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png',
  // fonte Figtree servida daqui mesmo (node_modules/@fontsource/figtree): nada de Google Fonts
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};
const HOSTS_OK = new Set([`localhost:${PORTA}`, `127.0.0.1:${PORTA}`]);
const ORIGENS_OK = new Set([`http://localhost:${PORTA}`, `http://127.0.0.1:${PORTA}`]);

function responder(res, codigo, texto) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(codigo, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(texto);
}

function responderJson(res, codigo, obj) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(codigo, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Abrir a sessão (rodada 6): a ÚNICA ação que a página pode pedir. Clicar na
// notinha de um astronauta na fila (sala do dono ou revisão) abre aquela conversa
// no app certo. A Estação continua sem comandar agentes.
// Segurança (condição do Eduardo):
// - só POST /api/abrir, com Host e Origin da própria página (127.0.0.1 ou
//   localhost na porta do servidor) e o token aleatório gerado na inicialização,
//   que vai embutido na página servida (meta estacao-token) e volta no cabeçalho
//   X-Estacao-Token. Outro site não lê a página (mesma origem) nem acerta o token;
// - o corpo traz só { id } de um agente que está AGORA na lista com pendência; o
//   servidor monta a URL ele mesmo (nunca aceita URL do navegador):
//     Claude: claude://code/needs-input?session=<id local>&source=a_estacao
//     Codex:  codex://threads/<id da conversa>
//   e chama execFile('/usr/bin/open', [url]), sem shell;
// - qualquer outra coisa: 400 (pedido malformado), 403 (origem ou token), 404 (id
//   fora da fila), 409 (sessão que o app não sabe abrir), 429 (cliques seguidos).
// - ESTACAO_ENSAIO=1: modo de ensaio, registra a URL no log e devolve no corpo em
//   vez de chamar o open (para testar sem trocar a tela de ninguém).
// ---------------------------------------------------------------------------
const TOKEN = crypto.randomBytes(24).toString('hex');
const ENSAIO = process.env.ESTACAO_ENSAIO === '1';
const ID_CONVERSA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ABRIR_INTERVALO_MS = 800;
let ultimaAbertura = 0;

function tokenConfere(recebido) {
  const a = Buffer.from(String(recebido || ''), 'utf8'), b = Buffer.from(TOKEN, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Lê o corpo (no máximo 2 KB) e devolve o JSON, ou null
function lerCorpoJson(req, max = 2048) {
  return new Promise(ok => {
    let corpo = '', tamanho = 0, fim = false;
    const acabar = v => { if (!fim) { fim = true; ok(v); } };
    req.setEncoding('utf8');
    req.on('data', c => {
      if (fim) return;   // passou do limite: só esvazia o resto, sem guardar
      tamanho += Buffer.byteLength(c);
      if (tamanho > max) { corpo = ''; acabar(null); return; }
      corpo += c;
    });
    req.on('end', () => { try { acabar(JSON.parse(corpo)); } catch { acabar(null); } });
    req.on('error', () => acabar(null));
    setTimeout(() => acabar(null), 3000).unref();
  });
}

// URL do app para um agente da lista (montada aqui, só a partir de ids conferidos)
async function urlDaSessao(agente) {
  if (agente.provedor === 'openai') {
    const conversa = String(agente.id).replace(/^codex:/, '');
    return ID_CONVERSA.test(conversa) ? 'codex://threads/' + conversa : null;
  }
  if (!ID_CONVERSA.test(agente.id)) return null;
  let local = locaisPorConversa.get(agente.id);
  if (!local) {
    // sessão nova: varre os arquivos do app agora (no máximo cerca de 1,5 s)
    await Promise.race([pedirLocais(true), new Promise(ok => setTimeout(ok, 1500))]);
    local = locaisPorConversa.get(agente.id);
  }
  if (!local) {
    const reg = sessoesAbertas().find(s => s.sessionId === agente.id);
    if (reg && ID_LOCAL.test(String(reg.hostSessionId || ''))) local = reg.hostSessionId;
  }
  return local && ID_LOCAL.test(local) ? `claude://code/needs-input?session=${encodeURIComponent(local)}&source=a_estacao` : null;
}

async function abrirSessao(req, res) {
  if (req.method !== 'POST') return responderJson(res, 405, { ok: false, erro: 'só POST' });
  // Origin obrigatório e da própria página (o Host já foi conferido)
  const origem = String(req.headers.origin || '').toLowerCase();
  if (!ORIGENS_OK.has(origem)) return responderJson(res, 403, { ok: false, erro: 'origem não permitida' });
  if (!tokenConfere(req.headers['x-estacao-token'])) return responderJson(res, 403, { ok: false, erro: 'token inválido' });
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return responderJson(res, 400, { ok: false, erro: 'corpo deve ser JSON' });
  const corpo = await lerCorpoJson(req);
  const id = corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? corpo.id : null;
  if (typeof id !== 'string' || !id || id.length > 120 || Object.keys(corpo).some(k => k !== 'id')) {
    return responderJson(res, 400, { ok: false, erro: 'pedido inválido' });
  }
  // só quem está agora numa fila (sessão com pendência)
  corpoDoEstado();
  const agente = ultimoBom.find(a => a.id === id && a.tipo === 'sessao' && a.pendencia);
  if (!agente) return responderJson(res, 404, { ok: false, erro: 'sessão não está na fila' });
  const url = await urlDaSessao(agente);
  if (!url) return responderJson(res, 409, { ok: false, erro: 'o app não sabe abrir esta sessão' });
  const agora = Date.now();
  if (agora - ultimaAbertura < ABRIR_INTERVALO_MS) return responderJson(res, 429, { ok: false, erro: 'aguarde um instante' });
  ultimaAbertura = agora;
  if (ENSAIO) {
    console.log('[ensaio] abriria', url);
    return responderJson(res, 200, { ok: true, ensaio: true, url });
  }
  execFile('/usr/bin/open', [url], { timeout: 5000 }, erro => {
    if (erro) { console.error('[abrir]', erro.message); return responderJson(res, 500, { ok: false, erro: 'não deu para abrir' }); }
    responderJson(res, 200, { ok: true });
  });
}

// ---------------------------------------------------------------------------
// Versão e novidades: GET /api/versao
// A Estação sabe a própria versão (app/package.json) e, quando a pasta é um clone
// do git, o commit (git rev-parse). As novidades vêm da última release pública do
// repositório no GitHub, consultada no máximo 1 vez a cada 6 h (contando também as
// tentativas que falham), com timeout curto, sem credencial e só quando a página
// pede. Repositório que ainda não existe (404), sem internet ou sem resposta: o
// estado fica neutro ('sem-releases' ou 'sem-resposta'), nunca erro na tela.
// A página só MOSTRA como atualizar; nada aqui executa a atualização.
//   ESTACAO_NOVIDADES=nao   não consulta o GitHub (nada sai da máquina)
//   ESTACAO_REPO=dono/repo  outro repositório (padrão eueduardocampos/a-estacao)
// Resposta: { versao, commit, clone, repo, urlRepo, pasta, comando,
//   novidades: { estado, consultadoEm, ultima, releases }, temVersaoNova, versaoNova }
//   estado: 'ok' | 'sem-releases' | 'sem-resposta' | 'desligado' | 'nao-consultado'
//   release: { versao, nome, publicadaEm, url, notas } (notas em texto, até 4 mil caracteres)
// ---------------------------------------------------------------------------
const RAIZ_PROJETO = path.dirname(PASTA_APP);
const REPO_NOVIDADES = /^[\w.-]+\/[\w.-]+$/.test(process.env.ESTACAO_REPO || '') ? process.env.ESTACAO_REPO : 'eueduardocampos/a-estacao';
const NOVIDADES_LIGADAS = process.env.ESTACAO_NOVIDADES !== 'nao';
const NOVIDADES_MS = 6 * 60 * 60 * 1000;
const NOVIDADES_TIMEOUT_MS = 4000;
const NOVIDADES_MAX_BYTES = 512 * 1024;
const NOTAS_MAX = 4000;
const RELEASES_MAX = 5;
const COMMIT_MS = 10 * 60 * 1000;

function versaoDoPacote() {
  try { return String(JSON.parse(fs.readFileSync(path.join(PASTA_APP, 'package.json'), 'utf8')).version || ''); }
  catch { return ''; }
}
const VERSAO = versaoDoPacote() || '0.0.0';

// '0.6.0' contra 'v0.7.0': 1 se a > b, -1 se a < b, 0 se iguais ou ilegíveis
const partesDaVersao = v => (String(v || '').trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/) || []).slice(1, 4).map(n => Number(n || 0));
function compararVersoes(a, b) {
  const pa = partesDaVersao(a), pb = partesDaVersao(b);
  if (pa.length !== 3 || pb.length !== 3) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  return 0;
}

// Commit local: só quando a pasta do projeto é um clone (tem .git), para nunca
// chamar o git de um Mac sem as ferramentas de linha de comando
const ehClone = () => fs.existsSync(path.join(RAIZ_PROJETO, '.git'));
let commitLocal = { valor: null, lidoEm: 0 };
let lendoCommit = null;
function lerCommit() {
  if (Date.now() - commitLocal.lidoEm < COMMIT_MS) return Promise.resolve(commitLocal.valor);
  if (lendoCommit) return lendoCommit;
  if (!ehClone()) { commitLocal = { valor: null, lidoEm: Date.now() }; return Promise.resolve(null); }
  lendoCommit = new Promise(ok => {
    execFile('git', ['-C', RAIZ_PROJETO, 'rev-parse', '--short', 'HEAD'], { timeout: 2000 }, (erro, saida) => {
      const valor = !erro && /^[0-9a-f]{4,40}$/i.test(String(saida).trim()) ? String(saida).trim() : null;
      commitLocal = { valor, lidoEm: Date.now() };
      lendoCommit = null;
      ok(valor);
    });
  });
  return lendoCommit;
}

let novidades = { estado: NOVIDADES_LIGADAS ? 'nao-consultado' : 'desligado', consultadoEm: 0, ultima: null, releases: [] };
let consultandoNovidades = null;

async function buscarNoGithub(url) {
  const r = await fetch(url, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'a-estacao/' + VERSAO, 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(NOVIDADES_TIMEOUT_MS),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub respondeu ' + r.status);
  const texto = await r.text();
  if (texto.length > NOVIDADES_MAX_BYTES) throw new Error('resposta grande demais');
  return JSON.parse(texto);
}

// Só os campos que a página mostra, em texto puro (a página nunca usa innerHTML)
function releaseLimpa(r) {
  if (!r || typeof r !== 'object' || r.draft) return null;
  const tag = String(r.tag_name || '').trim();
  if (!partesDaVersao(tag).length) return null;
  const url = String(r.html_url || '');
  return {
    versao: tag.replace(/^v/i, ''),
    nome: String(r.name || '').slice(0, 120),
    publicadaEm: Date.parse(r.published_at || r.created_at || '') || null,
    url: url.startsWith('https://github.com/') ? url : null,
    notas: String(r.body || '').replace(/\r\n?/g, '\n').slice(0, NOTAS_MAX),
    previa: !!r.prerelease,
  };
}

// forcar: botão "Verificar agora" (no máximo 1 consulta por minuto)
function consultarNovidades(forcar = false) {
  if (!NOVIDADES_LIGADAS) return Promise.resolve();
  if (consultandoNovidades) return consultandoNovidades;
  if (Date.now() - novidades.consultadoEm < (forcar ? 60 * 1000 : NOVIDADES_MS)) return Promise.resolve();
  const consultadoEm = Date.now();   // a tentativa conta, mesmo sem resposta
  novidades = { ...novidades, consultadoEm };
  const base = `https://api.github.com/repos/${REPO_NOVIDADES}/releases`;
  consultandoNovidades = (async () => {
    try {
      const ultima = releaseLimpa(await buscarNoGithub(base + '/latest'));
      if (!ultima) { novidades = { estado: 'sem-releases', consultadoEm, ultima: null, releases: [] }; return; }
      // as anteriores, para o histórico do painel (se falhar, fica só a última)
      let lista = [];
      try { lista = (await buscarNoGithub(base + '?per_page=' + (RELEASES_MAX + 3))) || []; } catch { /* segue com a última */ }
      const releases = (Array.isArray(lista) ? lista : []).map(releaseLimpa).filter(r => r && !r.previa);
      if (!releases.some(r => r.versao === ultima.versao)) releases.unshift(ultima);
      releases.sort((a, b) => compararVersoes(b.versao, a.versao));
      novidades = { estado: 'ok', consultadoEm, ultima, releases: releases.slice(0, RELEASES_MAX) };
    } catch (e) {
      // sem internet ou sem resposta: neutro; se já havia uma leitura boa, ela continua valendo
      if (novidades.ultima) novidades = { ...novidades, consultadoEm };
      else novidades = { estado: 'sem-resposta', consultadoEm, ultima: null, releases: [] };
      console.log('[novidades] sem resposta do GitHub:', e?.name === 'TimeoutError' ? 'tempo esgotado' : (e?.message || e));
    } finally {
      consultandoNovidades = null;
    }
  })();
  return consultandoNovidades;
}

// Texto para copiar (só mostrado; a página não executa nada)
const entreAspas = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

async function responderVersao(res, forcar = false) {
  const espera = ms => new Promise(ok => setTimeout(ok, ms).unref());
  const [commit] = await Promise.all([lerCommit(), Promise.race([consultarNovidades(forcar), espera(NOVIDADES_TIMEOUT_MS + 500)])]);
  const ultima = novidades.ultima;
  const temVersaoNova = !!ultima && compararVersoes(ultima.versao, VERSAO) > 0;
  responderJson(res, 200, {
    versao: VERSAO,
    commit,
    clone: ehClone(),
    repo: REPO_NOVIDADES,
    urlRepo: 'https://github.com/' + REPO_NOVIDADES,
    pasta: RAIZ_PROJETO,
    comando: `cd ${entreAspas(RAIZ_PROJETO)} && ./atualizar.sh`,
    novidades,
    temVersaoNova,
    versaoNova: temVersaoNova ? ultima.versao : null,
  });
}

// index.html sai com o token embutido (meta estacao-token), sem cache: a cada
// inicialização do servidor o token muda
function servirPagina(res, arquivo) {
  fs.readFile(arquivo, 'utf8', (erro, html) => {
    if (erro) return responder(res, 404, 'não encontrado');
    const meta = `<meta name="estacao-token" content="${TOKEN}">`;
    const comToken = html.includes('<meta charset="utf-8">')
      ? html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  ' + meta)
      : html.replace(/<head>/i, '<head>\n  ' + meta);
    res.writeHead(200, { 'Content-Type': TIPOS['.html'], 'Cache-Control': 'no-store' });
    res.end(comToken);
  });
}

const servidor = http.createServer((req, res) => {
  try {
    // o navegador não adivinha tipo de arquivo nem manda o endereço da página adiante (revisão M-11)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // só a própria página: nada de DNS rebinding nem pedido vindo de outro site
    if (!HOSTS_OK.has(String(req.headers.host || '').toLowerCase())) return responder(res, 403, 'proibido');
    const origem = req.headers.origin;
    if (origem !== undefined && !ORIGENS_OK.has(String(origem).toLowerCase())) return responder(res, 403, 'proibido');

    const url = new URL(req.url, 'http://localhost');
    // a única ação da página: abrir a sessão de quem está numa fila (rodada 6)
    if (url.pathname === '/api/abrir') {
      abrirSessao(req, res).catch(e => { console.error('[abrir]', e?.message || e); responderJson(res, 500, { ok: false, erro: 'falha interna' }); });
      return;
    }
    // sala de missão (workflows) e despacho (tarefas agendadas): módulos opcionais,
    // carregados sob demanda; se o arquivo ainda não existir, responde 503 sem derrubar nada
    const fontesOpcionais = {
      '/api/missao': ['./fonte-missao.js', 'missao'], '/api/despacho': ['./fonte-despacho.js', 'despacho'],
      '/api/memoria': ['./fonte-memoria.js', 'memoria'], '/api/oficina': ['./fonte-oficina.js', 'oficina'],
      '/api/portaria': ['./fonte-portaria.js', 'portaria'],
    };
    if (fontesOpcionais[url.pathname]) {
      const [arquivo, funcao] = fontesOpcionais[url.pathname];
      import(arquivo)
        .then(m => m[funcao]())
        .then(d => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(d)); })
        .catch(e => responder(res, 503, 'indisponível: ' + (e?.message || e)));
      return;
    }
    if (url.pathname === '/api/servidores') {
      // sala dos servidores: o que está ligado nesta máquina e quanto ela está usando (app/fonte-servidores.js)
      salaDosServidores(PORTA)
        .then(d => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(d)); })
        .catch(e => responder(res, 500, 'falha ao ler os servidores: ' + (e?.message || e)));
      return;
    }
    if (url.pathname === '/api/estado') {
      const corpo = corpoDoEstado();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(corpo);
    }
    if (url.pathname === '/api/versao') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return responder(res, 405, 'só GET');
      responderVersao(res, url.searchParams.get('verificar') === '1').catch(e => { console.error('[versao]', e?.message || e); responderJson(res, 500, { erro: 'falha interna' }); });
      return;
    }
    if (url.pathname === '/api/limites') {
      let corpo;
      try { corpo = JSON.stringify(limitesAtuais()); } catch (e) { corpo = JSON.stringify({ erro: String(e?.message || e) }); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(corpo);
    }
    const relativo = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const arquivo = path.resolve(PASTA_APP, relativo);
    if (!arquivo.startsWith(PASTA_APP + path.sep) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
      return responder(res, 404, 'não encontrado');
    }
    // link simbólico que aponta para fora de app/ não sai (revisão M-11)
    let real;
    try { real = fs.realpathSync(arquivo); } catch { return responder(res, 404, 'não encontrado'); }
    if (!real.startsWith(PASTA_APP_REAL + path.sep)) return responder(res, 404, 'não encontrado');
    if (relativo === 'index.html') return servirPagina(res, arquivo);
    // no-cache: a cada recarga o navegador confere se o arquivo mudou (módulos .js
    // antigos em cache faziam a página rodar código de uma rodada anterior)
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(arquivo).on('error', () => res.destroy()).pipe(res);
  } catch (e) {
    responder(res, 400, 'pedido inválido');
  }
});
// porta ocupada ou outro erro ao escutar: sai com código 1 para o iniciar.sh tentar de novo
servidor.on('error', e => { console.error('[servidor]', e.message); process.exit(1); });

// Antes de escutar: espera a primeira varredura dos nomes dos conectores (no máximo
// 1,5 s; o iniciar.sh espera até 6 s), para a TV não mostrar 'Conector externo' no
// primeiro instante, e monta o estado uma vez (as primeiras leituras das transcrições
// são as mais caras), para a primeira requisição já sair rápida. Dono e Codex
// começam a ser lidos aí, em segundo plano.
// a fonte do Codex usa os mesmos dicionários (APIs pelo host, nomes curtos, português)
configurarCodex({ apiDoComando, nomeCurto, ehPortugues, limparMarca, terminaComOferta, mascararSegredos });
pedirPainelUso();
pedirLocais(true);   // mapa conversa -> sessão local do app (para abrir pela notinha)
if (ENSAIO) console.log('[ensaio] /api/abrir em modo de ensaio: registra a URL, não abre nada');
setInterval(() => pedirVarreduraNomes(true), 10 * 60 * 1000).unref();
Promise.race([pedirVarreduraNomes(true), new Promise(ok => setTimeout(ok, 1500))]).then(() => {
  try { corpoDoEstado(); } catch (e) { console.error('[aquecimento]', e?.message || e); }
  servidor.listen(PORTA, '127.0.0.1', () => console.log(`A Estação em http://localhost:${PORTA}`));
});
