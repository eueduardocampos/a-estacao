// Fonte da sala de missão: os workflows (orquestrações de vários subagentes do
// Claude Code) que estão rodando agora ou terminaram por último. Só leitura.
//
// De onde vem cada coisa (em $CLAUDE_CONFIG_DIR ou ~/.claude):
//   projects/<projeto>/<sessão>/subagents/workflows/<runId>/journal.jsonl
//       linhas { type: 'launched' | 'started' | 'result', key, agentId, label, phase, result }
//       (um runId por workflow; o journal só cresce, então é lido aos pedaços,
//       continuando de onde parou na leitura anterior)
//   projects/<qualquer projeto>/<sessão>/workflows/scripts/<nome>-<runId>.js
//       o script do workflow; o `export const meta = { name, description, phases }`
//       do começo é lido como TEXTO e interpretado como literal, nunca executado
//   projects/<qualquer projeto>/<sessão>/workflows/<runId>.json
//       gravado quando o workflow termina (status, startTime, timestamp); se o
//       journal continuou depois dele (workflow retomado), vale o journal
//   projects/<projeto>/<sessão>.jsonl
//       só os primeiros KB, para saber a pasta (cwd) da sessão
//
// Ativa = tem agente que começou e não devolveu resultado e que ainda escreve
// (transcrição do agente ou journal mexidos nos últimos 10 min), ou o journal
// mexeu nos últimos 3 min (entre uma fase e outra). Concluída = tudo devolvido,
// o .json final foi gravado depois do journal, ou parada há mais de 10 min.
//
// missao() devolve:
// { geradoEm, missoes: [{
//     id, nome, descricao, sessao, projeto, pasta, inicio, fim | null, ativa,
//     situacao: 'andamento' | 'entre-fases' | 'concluida' | 'parada',
//     faseAtual: título | null,
//     agentes: { total, rodando, concluidos },
//     fases: [{ titulo, detalhe, estado: 'feita' | 'rodando' | 'falta', volta,
//               agentes: { rodando, concluidos, parados, rotulos: [labels rodando] } }]
// }] }
// Ativas primeiro (a mais recente antes); depois até 3 concluídas, a mais recente antes.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const fsp = fs.promises;
const CLAUDE = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
const PROJETOS = path.join(CLAUDE, 'projects');

const CACHE_MS = 5000;
const ATIVO_MS = 10 * 60 * 1000;          // agente que não escreve há mais que isso parou
const ENTRE_FASES_MS = 3 * 60 * 1000;     // journal mexido há pouco: o script está entre uma fase e outra
const JANELA_LEITURA_MS = 48 * 3600 * 1000; // journals mais velhos só entram se não houver nenhum mais novo
const MAX_CONCLUIDAS = 3;
const FIM_DE_JSON = new Set(['completed', 'failed', 'killed', 'error', 'cancelled', 'canceled', 'aborted']);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
async function listar(dir) {
  try { return await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
}
async function stat(arq) {
  try { return await fsp.stat(arq); } catch { return null; }
}

// Cache de arquivos pequenos lidos inteiros, por caminho + mtime + tamanho
const cacheArquivos = new Map();
async function lerTexto(arq, st, limite = 2 * 1024 * 1024) {
  const chave = `${st.mtimeMs}|${st.size}`;
  const c = cacheArquivos.get(arq);
  if (c && c.chave === chave) return c.valor;
  let valor = null;
  try {
    if (st.size <= limite) valor = await fsp.readFile(arq, 'utf8');
  } catch { /* sumiu entre o stat e a leitura */ }
  cacheArquivos.set(arq, { chave, valor });
  return valor;
}
async function lerJson(arq, st) {
  const chave = `json|${st.mtimeMs}|${st.size}`;
  const c = cacheArquivos.get(arq + '#json');
  if (c && c.chave === chave) return c.valor;
  let valor = null;
  try { valor = JSON.parse(await fsp.readFile(arq, 'utf8')); } catch { valor = null; }
  cacheArquivos.set(arq + '#json', { chave, valor });
  return valor;
}

// ---------------------------------------------------------------------------
// meta do script: literal de objeto JS lido à mão (sem eval, sem import)
// ---------------------------------------------------------------------------
function lerLiteral(s, i) {
  const pular = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith('//', i)) { const f = s.indexOf('\n', i); i = f < 0 ? s.length : f + 1; continue; }
      if (s.startsWith('/*', i)) { const f = s.indexOf('*/', i + 2); i = f < 0 ? s.length : f + 2; continue; }
      return;
    }
  };
  const texto = () => {
    const q = s[i++];
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\') {
        const e = s[i + 1];
        const mapa = { n: '\n', t: '\t', r: '\r', '0': '\0', b: '\b', f: '\f', v: '\v' };
        if (e === 'u') {
          if (s[i + 2] === '{') { const f = s.indexOf('}', i); out += String.fromCodePoint(parseInt(s.slice(i + 3, f), 16)); i = f + 1; continue; }
          out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 6; continue;
        }
        if (e === 'x') { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16)); i += 4; continue; }
        if (e === '\n') { i += 2; continue; }
        out += e in mapa ? mapa[e] : e; i += 2; continue;
      }
      if (q === '`' && s[i] === '$' && s[i + 1] === '{') throw new Error('template com expressão');
      out += s[i++];
    }
    if (s[i] !== q) throw new Error('texto sem fim');
    i++;
    return out;
  };
  const valor = () => {
    pular();
    const c = s[i];
    if (c === '{') {
      i++;
      const o = {};
      for (;;) {
        pular();
        if (s[i] === '}') { i++; return o; }
        let chave;
        if (s[i] === '"' || s[i] === "'" || s[i] === '`') chave = texto();
        else {
          const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 200));
          if (!m) throw new Error('chave inválida');
          chave = m[0]; i += chave.length;
        }
        pular();
        if (s[i] !== ':') throw new Error('esperava ":"');
        i++;
        o[chave] = valor();
        pular();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return o; }
        throw new Error('esperava "," ou "}"');
      }
    }
    if (c === '[') {
      i++;
      const a = [];
      for (;;) {
        pular();
        if (s[i] === ']') { i++; return a; }
        a.push(valor());
        pular();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return a; }
        throw new Error('esperava "," ou "]"');
      }
    }
    if (c === '"' || c === "'" || c === '`') return texto();
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null|undefined)/.exec(s.slice(i, i + 40));
    if (!m) throw new Error('valor não literal');
    i += m[0].length;
    const especiais = { true: true, false: false, null: null, undefined: undefined };
    return m[0] in especiais ? especiais[m[0]] : Number(m[0]);
  };
  const v = valor();
  return v;
}

function textoDe(v) { return typeof v === 'string' ? v : ''; }

export function extrairMeta(fonte) {
  if (!fonte) return null;
  const m = /(?:export\s+)?const\s+meta\s*=\s*\{/.exec(fonte);
  if (!m) return null;
  const inicio = m.index + m[0].length - 1;
  try {
    const o = lerLiteral(fonte, inicio);
    if (o && typeof o === 'object') {
      return {
        name: textoDe(o.name), description: textoDe(o.description),
        phases: Array.isArray(o.phases) ? o.phases.map(p => typeof p === 'string' ? { title: p, detail: '' } : { title: textoDe(p?.title), detail: textoDe(p?.detail) }).filter(p => p.title) : [],
      };
    }
  } catch { /* cai para o plano B */ }
  // plano B: expressões regulares, só no trecho do meta
  const trecho = fonte.slice(inicio, inicio + 20000);
  const str = '([\'"`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1';
  const campo = nome => new RegExp(`${nome}\\s*:\\s*${str}`).exec(trecho)?.[2] || '';
  const fases = [];
  const bloco = /phases\s*:\s*\[([\s\S]*?)\]\s*,?\s*\}/.exec(trecho)?.[1] || '';
  for (const obj of bloco.match(/\{[^{}]*\}/g) || []) {
    const t = new RegExp(`title\\s*:\\s*${str}`).exec(obj)?.[2];
    if (t) fases.push({ title: t, detail: new RegExp(`detail\\s*:\\s*${str}`).exec(obj)?.[2] || '' });
  }
  return { name: campo('name'), description: campo('description'), phases: fases };
}

// ---------------------------------------------------------------------------
// Journal: leitura incremental (o arquivo só cresce)
// ---------------------------------------------------------------------------
const journals = new Map();

function novoJournal(ino) {
  return { ino, pos: 0, resto: Buffer.alloc(0), iniciados: new Map(), resultados: new Set(), ordemFases: [], lancado: false };
}

function processarLinha(j, linha) {
  if (!linha.trim()) return;
  let o;
  try { o = JSON.parse(linha); } catch { return; }
  if (o.type === 'launched') j.lancado = true;
  else if (o.type === 'started' && o.key) {
    j.iniciados.set(o.key, { label: String(o.label || ''), fase: String(o.phase || ''), agentId: String(o.agentId || ''), ordem: j.iniciados.size });
    if (o.phase && !j.ordemFases.includes(o.phase)) j.ordemFases.push(o.phase);
  } else if (o.type === 'result' && o.key) j.resultados.add(o.key);
}

async function lerJournal(arq, st) {
  let j = journals.get(arq);
  if (!j || j.ino !== st.ino || st.size < j.pos) { j = novoJournal(st.ino); journals.set(arq, j); }
  if (st.size === j.pos) return j;
  let fh;
  try {
    fh = await fsp.open(arq, 'r');
    const PEDACO = 256 * 1024;
    while (j.pos < st.size) {
      const tam = Math.min(PEDACO, st.size - j.pos);
      const buf = Buffer.alloc(tam);
      const { bytesRead } = await fh.read(buf, 0, tam, j.pos);
      if (!bytesRead) break;
      j.pos += bytesRead;
      const junto = j.resto.length ? Buffer.concat([j.resto, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      const fim = junto.lastIndexOf(0x0a);
      if (fim < 0) { j.resto = Buffer.from(junto); continue; }
      for (const l of junto.subarray(0, fim).toString('utf8').split('\n')) processarLinha(j, l);
      j.resto = Buffer.from(junto.subarray(fim + 1));
    }
  } catch { /* leitura parcial: continua na próxima */ } finally {
    await fh?.close().catch(() => {});
  }
  return j;
}

// ---------------------------------------------------------------------------
// Varredura: onde estão os runs, os scripts e os .json finais
// ---------------------------------------------------------------------------
async function varrer() {
  const runs = [];                  // { runId, sessao, projetoDir, dir }
  const arquivosSessao = new Map(); // sessão -> { scripts: [caminho], jsons: Map(runId -> caminho) }
  for (const p of await listar(PROJETOS)) {
    if (!p.isDirectory()) continue;
    const projetoDir = path.join(PROJETOS, p.name);
    const sessoes = (await listar(projetoDir)).filter(s => s.isDirectory());
    await Promise.all(sessoes.map(async s => {
      const dirSessao = path.join(projetoDir, s.name);
      const [wfs, proprios, scripts] = await Promise.all([
        listar(path.join(dirSessao, 'subagents', 'workflows')),
        listar(path.join(dirSessao, 'workflows')),
        listar(path.join(dirSessao, 'workflows', 'scripts')),
      ]);
      for (const w of wfs) if (w.isDirectory() && w.name.startsWith('wf_')) {
        runs.push({ runId: w.name, sessao: s.name, projetoDir, dir: path.join(dirSessao, 'subagents', 'workflows', w.name) });
      }
      if (proprios.length || scripts.length) {
        const a = arquivosSessao.get(s.name) || { scripts: [], jsons: new Map() };
        for (const f of proprios) if (f.isFile() && /^wf_.*\.json$/.test(f.name)) a.jsons.set(f.name.slice(0, -5), path.join(dirSessao, 'workflows', f.name));
        for (const f of scripts) if (f.isFile() && f.name.endsWith('.js')) a.scripts.push(path.join(dirSessao, 'workflows', 'scripts', f.name));
        arquivosSessao.set(s.name, a);
      }
    }));
  }
  return { runs, arquivosSessao };
}

// pasta (cwd) da sessão: primeiros KB da transcrição principal
const pastas = new Map();
async function pastaDaSessao(projetoDir, sessao) {
  const chave = projetoDir + '|' + sessao;
  if (pastas.has(chave)) return pastas.get(chave);
  let pasta = null;
  let fh;
  try {
    fh = await fsp.open(path.join(projetoDir, sessao + '.jsonl'), 'r');
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const m = /"cwd"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(buf.subarray(0, bytesRead).toString('utf8'));
    if (m) pasta = JSON.parse(`"${m[1]}"`);
  } catch { /* sem transcrição principal */ } finally {
    await fh?.close().catch(() => {});
  }
  if (!pasta) {
    // plano B: o nome da pasta do projeto ("-Users-fulano-Claude" -> "Claude")
    const nome = path.basename(projetoDir).replace(/^-Users-[^-]+-?/, '');
    pasta = nome ? '~/' + nome : '~';
  }
  pastas.set(chave, pasta);
  return pasta;
}

function nomeDoProjeto(pasta) {
  const casa = os.homedir();
  if (pasta === casa) return 'pasta pessoal';
  return path.basename(pasta) || pasta;
}

// ---------------------------------------------------------------------------
// Monta uma missão a partir de journal + script + .json final
// ---------------------------------------------------------------------------
async function montarMissao(run, stJournal, j, arquivos, agora) {
  // script: o mais novo com o runId no nome, em qualquer projeto da mesma sessão
  let meta = null;
  const candidatos = (arquivos?.scripts || []).filter(s => s.endsWith(`-${run.runId}.js`) || path.basename(s) === `${run.runId}.js`);
  const comStat = (await Promise.all(candidatos.map(async c => ({ c, st: await stat(c) })))).filter(x => x.st).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  for (const { c, st } of comStat) {
    meta = extrairMeta(await lerTexto(c, st));
    if (meta) break;
  }
  // .json final (status e horários; e o script embutido, se o arquivo .js sumiu)
  let final = null, stFinal = null;
  const arqFinal = arquivos?.jsons.get(run.runId);
  if (arqFinal && (stFinal = await stat(arqFinal))) final = await lerJson(arqFinal, stFinal);
  if (!meta && final?.script) meta = extrairMeta(final.script);
  if (!meta && final) meta = { name: final.workflowName || '', description: final.summary || '', phases: (final.phases || []).map(p => ({ title: p.title || '', detail: p.detail || '' })) };
  meta ||= { name: '', description: '', phases: [] };

  // agentes: quem devolveu e quem ainda está (ou estava) rodando
  const pendentes = [];
  let concluidos = 0;
  const porFase = new Map();
  const daFase = f => {
    if (!porFase.has(f)) porFase.set(f, { rodando: 0, concluidos: 0, parados: 0, rotulos: [] });
    return porFase.get(f);
  };
  for (const [key, a] of j.iniciados) {
    if (j.resultados.has(key)) { concluidos++; daFase(a.fase).concluidos++; } else pendentes.push(a);
  }
  // pendente vivo = a transcrição do agente mexeu há pouco (o journal só muda no começo e no fim)
  let ultimaAtividade = stJournal.mtimeMs;
  const vivos = [];
  await Promise.all(pendentes.map(async a => {
    // sem transcrição ainda (acabou de começar): vale o journal
    const st = a.agentId ? await stat(path.join(run.dir, `agent-${a.agentId}.jsonl`)) : null;
    const quando = st ? st.mtimeMs : stJournal.mtimeMs;
    ultimaAtividade = Math.max(ultimaAtividade, st?.mtimeMs || 0);
    if (agora - quando < ATIVO_MS) vivos.push(a);
  }));
  vivos.sort((a, b) => a.ordem - b.ordem);
  for (const a of pendentes) {
    const f = daFase(a.fase);
    if (vivos.includes(a)) { f.rodando++; if (f.rotulos.length < 4) f.rotulos.push(a.label); } else f.parados++;
  }

  const encerradoPeloJson = final && FIM_DE_JSON.has(String(final.status || '').toLowerCase())
    && Date.parse(final.timestamp || 0) >= stJournal.mtimeMs - 5000;
  const recente = agora - stJournal.mtimeMs;
  const ativa = !encerradoPeloJson && (vivos.length > 0 || recente < ENTRE_FASES_MS);
  const situacao = ativa ? (vivos.length ? 'andamento' : 'entre-fases') : (pendentes.length && !encerradoPeloJson ? 'parada' : 'concluida');

  // fases: na ordem do meta; as que só aparecem no journal vão no fim
  const titulos = meta.phases.map(p => p.title);
  const fases = meta.phases.map(p => ({ titulo: p.title, detalhe: p.detail || '' }));
  for (const f of j.ordemFases) if (!titulos.includes(f)) fases.push({ titulo: f, detalhe: '' });
  for (const f of fases) {
    const c = porFase.get(f.titulo) || { rodando: 0, concluidos: 0, parados: 0, rotulos: [] };
    f.agentes = c;
    f.estado = c.rodando > 0 ? 'rodando' : c.concluidos > 0 ? 'feita' : 'falta';
    f.volta = false;
  }
  // fase que já rodou mas fica depois de uma que ainda roda ou falta (ex.: integração
  // a cada rodada): só marca "volta" enquanto a missão está ativa
  if (ativa) {
    const primeiraAberta = fases.findIndex(f => f.estado !== 'feita');
    if (primeiraAberta >= 0) fases.forEach((f, i) => { if (i > primeiraAberta && f.estado === 'feita') f.volta = true; });
  }
  const ultimoVivo = vivos.length ? vivos.reduce((a, b) => (b.ordem > a.ordem ? b : a)) : null;

  const inicio = Number(final?.startTime) || stJournal.birthtimeMs || stJournal.ctimeMs;
  let fim = null;
  if (!ativa) fim = encerradoPeloJson ? Date.parse(final.timestamp) : ultimaAtividade;
  const pasta = await pastaDaSessao(run.projetoDir, run.sessao);

  return {
    id: run.runId,
    nome: meta.name || final?.workflowName || run.runId,
    descricao: meta.description || final?.summary || '',
    sessao: run.sessao,
    projeto: nomeDoProjeto(pasta),
    pasta,
    inicio: Math.round(inicio),
    fim: fim == null ? null : Math.round(fim),
    ativa,
    situacao,
    faseAtual: ultimoVivo?.fase || null,
    agentes: { total: j.iniciados.size, rodando: vivos.length, concluidos },
    fases,
    ultimaAtividade: Math.round(ultimaAtividade),
  };
}

// ---------------------------------------------------------------------------
let cache = { quando: 0, dados: null, pendente: null };

export async function missao() {
  const agora = Date.now();
  if (cache.dados && agora - cache.quando < CACHE_MS) return cache.dados;
  if (cache.pendente) return cache.pendente;
  cache.pendente = (async () => {
    const { runs, arquivosSessao } = await varrer();
    const comStat = (await Promise.all(runs.map(async r => ({ r, st: await stat(path.join(r.dir, 'journal.jsonl')) })))).filter(x => x.st);
    comStat.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    // lê os journals das últimas 48 h; se não houver nenhum, só o mais recente
    const ler = comStat.filter((x, i) => i === 0 || agora - x.st.mtimeMs < JANELA_LEITURA_MS);
    const missoes = [];
    for (const { r, st } of ler) {
      const j = await lerJournal(path.join(r.dir, 'journal.jsonl'), st);
      missoes.push(await montarMissao(r, st, j, arquivosSessao.get(r.sessao), agora));
    }
    // esquece journals que saíram da janela (memória não cresce sem fim)
    const lidos = new Set(ler.map(x => path.join(x.r.dir, 'journal.jsonl')));
    for (const k of journals.keys()) if (!lidos.has(k)) journals.delete(k);
    if (cacheArquivos.size > 200) cacheArquivos.clear();

    const ativas = missoes.filter(m => m.ativa).sort((a, b) => b.inicio - a.inicio);
    const concluidas = missoes.filter(m => !m.ativa).sort((a, b) => b.fim - a.fim).slice(0, MAX_CONCLUIDAS);
    const dados = { geradoEm: Date.now(), missoes: [...ativas, ...concluidas] };
    cache = { quando: Date.now(), dados, pendente: null };
    return dados;
  })().catch(e => { cache.pendente = null; throw e; });
  return cache.pendente;
}
