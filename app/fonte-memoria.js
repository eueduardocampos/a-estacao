// Fonte da Biblioteca da memória: o conhecimento que fica de uma conversa para
// outra (memórias, skills, regras CLAUDE.md e AGENTS.md, memórias do Codex) e o
// que as sessões do Claude e do Codex estão consultando ou gravando agora.
//
// Só leitura. Nunca escreve em ~/.claude nem em ~/.codex e nunca devolve o
// conteúdo de uma memória: só títulos curtos (o texto do link no MEMORY.md, o
// nome da skill, "CLAUDE.md · pasta"), contagens e horários.
//
// CONTRATO de memoria() (GET /api/memoria), versão 1
//   { versao: 1, geradoEm (ms), prateleiras, fichario, recentes, atividadeAgora,
//     ultimas, totais, pastas }
//   prateleiras: [{ id, nome, total, detalhe, atualizadaEm, ativa, acao, nivel, agentes }]
//     id: 'preferencias' (memória tipo feedback) | 'projetos' (project) |
//         'referencias' (reference) | 'voce' (user) | 'skills' | 'regras' | 'codex'
//     detalhe: { claude, codex } nas skills e nas regras; null nas outras
//     ativa: true se alguém mexeu nela nos últimos 90 s; acao: 'consultar' | 'gravar' |
//       'usar' (skill em uso) | null; nivel: 0 a 3, a prateleira (de baixo para cima)
//       do item mais recente; agentes: ids de /api/estado de quem está mexendo
//   fichario: { total (índices MEMORY.md), ativa, acao, agentes }  o índice das memórias
//   recentes: [{ titulo, area, tipo: 'memoria'|'skill'|'regra', pasta, modificadoEm, ha }]
//     os 8 itens modificados por último (memórias, skills e regras)
//   atividadeAgora: [{ quando, ha, hora, provedor, agente, agenteId, sessaoId, pasta,
//     acao, area, titulo, nivel }] dos últimos 90 s, o mais novo primeiro (até 6).
//     agenteId é o mesmo id de /api/estado: sessionId da sessão, 'agent-…' do
//     subagente, 'codex:<thread>' no Codex. area 'indice' = fichário.
//   ultimas: o mesmo formato, últimos 30 min (até 8), para "última consulta há…"
//   totais: { memorias, skills, regras, codex }
//   pastas: [{ nome, memorias }] memórias por pasta de trabalho
//   hora sempre no horário de Brasília; ha em português ("há 3 min").
//
// Como lê, sem pesar:
//   - memórias: readdir + stat de cada pasta memory/ a cada chamada; o cabeçalho
//     (até 4 KB) de cada arquivo só é relido quando o mtime muda;
//   - skills e regras: refeitas a cada 60 s (mudam pouco);
//   - "agora": só transcrições escritas nos últimos 10 min, lidas do fim e de forma
//     incremental (guarda o deslocamento de cada arquivo); linhas filtradas por texto
//     antes do JSON.parse.
// Respeita CLAUDE_CONFIG_DIR e CODEX_HOME.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const CLAUDE = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(HOME, '.claude');
const ARQUIVO_CONTA = process.env.CLAUDE_CONFIG_DIR ? path.join(CLAUDE, '.claude.json') : path.join(HOME, '.claude.json');
const CODEX = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(HOME, '.codex');
const AGENTES_HOME = path.join(HOME, '.agents');   // skills compartilhadas pelo Codex
const PROJETOS = path.join(CLAUDE, 'projects');

const CACHE_MS = 10_000;
const LENTO_MS = 60_000;              // skills, regras e memórias do Codex
const JANELA_AGORA_MS = 90_000;       // conta como "agora"
const JANELA_LEITURA_MS = 10 * 60_000; // transcrições escritas nesse intervalo
const JANELA_HISTORICO_MS = 30 * 60_000;
const SUBAGENTES_MS = 6 * 3600_000;   // procura subagentes nas sessões ativas nas últimas 6 h
const PRIMEIRA_LEITURA = 256 * 1024;  // primeira vez que vê um arquivo: só o fim
const LEITURA_MAX = 2 * 1024 * 1024;

export const AREAS = [
  { id: 'preferencias', nome: 'Preferências' },
  { id: 'projetos', nome: 'Projetos' },
  { id: 'referencias', nome: 'Referências' },
  { id: 'voce', nome: 'Sobre você' },
  { id: 'skills', nome: 'Skills' },
  { id: 'regras', nome: 'Regras' },
  { id: 'codex', nome: 'Codex' },
];
const AREA_DO_TIPO = { feedback: 'preferencias', project: 'projetos', reference: 'referencias', user: 'voce' };
const ARQ_REGRAS = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENTS.override.md']);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
export function haQuanto(ms, agora = Date.now()) {
  const s = Math.max(0, Math.round((agora - ms) / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  if (s < 2 * 86400) return 'ontem';
  return `há ${Math.round(s / 86400)} dias`;
}

function statSeguro(p) { try { return fs.statSync(p); } catch { return null; } }
function lerDir(p, opc) { try { return fs.readdirSync(p, opc); } catch { return []; } }

// Primeiros bytes de um arquivo (cabeçalho), sem ler o resto
function cabecaDe(arquivo, max = 4096) {
  let fd;
  try {
    fd = fs.openSync(arquivo, 'r');
    const buf = Buffer.alloc(max);
    const n = fs.readSync(fd, buf, 0, max, 0);
    return buf.toString('utf8', 0, n);
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

// Só os campos que servem: name e type (o type pode estar dentro de metadata:)
function frontmatter(texto) {
  if (!texto.startsWith('---')) return {};
  const fim = texto.indexOf('\n---', 3);
  const bloco = fim > 0 ? texto.slice(3, fim) : texto.slice(3, 2000);
  const nome = bloco.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const tipo = bloco.match(/^\s*type:\s*["']?([a-z]+)/m)?.[1];
  return { nome, tipo };
}

// Título curto: corta em palavra inteira, sem travessão
function curto(texto, max = 46) {
  let t = String(texto || '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  t = t.slice(0, max - 1);
  const corte = t.lastIndexOf(' ');
  return (corte > max * 0.6 ? t.slice(0, corte) : t).replace(/[,.;:\s]+$/, '') + '…';
}
function humanizar(slug) {
  const t = String(slug || '').replace(/\.md$/, '').replace(/^(feedback|project|reference|user)[_-]/, '').replace(/[_-]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}
function nivelDe(texto) { let h = 7; for (const c of String(texto)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 4; }

// Pasta de projeto -> nome curto. O Claude troca todo caractere fora de [a-zA-Z0-9]
// por '-' no nome da pasta em projects/; os caminhos de verdade vêm das pastas conhecidas.
const codificar = p => p.replace(/[^a-zA-Z0-9]/g, '-');
function nomeDaPastaCodificada(cod, conhecidas) {
  const real = conhecidas.get(cod);
  if (real) return real === HOME ? 'pasta pessoal' : path.basename(real);
  const partes = cod.split('-').filter(Boolean);
  return partes[partes.length - 1] || cod;
}

// ---------------------------------------------------------------------------
// Pastas de trabalho conhecidas (só as chaves: nada mais desses arquivos é usado)
// ---------------------------------------------------------------------------
let pastasConhecidas = { quando: 0, lista: [], porCodigo: new Map() };
function atualizarPastasConhecidas(agora) {
  if (agora - pastasConhecidas.quando < LENTO_MS && pastasConhecidas.quando) return pastasConhecidas;
  const lista = new Set();
  try {
    const j = JSON.parse(fs.readFileSync(ARQUIVO_CONTA, 'utf8'));
    for (const k of Object.keys(j?.projects || {})) if (path.isAbsolute(k)) lista.add(k);
  } catch {}
  try {
    const toml = fs.readFileSync(path.join(CODEX, 'config.toml'), 'utf8');
    for (const m of toml.matchAll(/^\[projects\."(.+?)"\]/gm)) if (path.isAbsolute(m[1])) lista.add(m[1]);
  } catch {}
  // o Claude codifica o caminho em NFC; o .claude.json pode guardar em NFD (é = e + acento)
  const porCodigo = new Map();
  for (const p of lista) { porCodigo.set(codificar(p.normalize('NFC')), p.normalize('NFC')); porCodigo.set(codificar(p), p.normalize('NFC')); }
  pastasConhecidas = { quando: agora, lista: [...lista], porCodigo };
  return pastasConhecidas;
}

// ---------------------------------------------------------------------------
// Memórias do Claude: projects/*/memory/*.md
// ---------------------------------------------------------------------------
const cacheArquivos = new Map();   // caminho -> { mtimeMs, nome, tipo }
const cacheIndices = new Map();    // pasta memory -> { mtimeMs, titulos: Map(arquivo -> título) }
const porCaminho = new Map();      // caminho -> item (para o "agora" achar área e título)

function titulosDoIndice(dirMem) {
  const arq = path.join(dirMem, 'MEMORY.md');
  const st = statSeguro(arq);
  if (!st) return { existe: false, titulos: new Map() };
  const c = cacheIndices.get(dirMem);
  if (c && c.mtimeMs === st.mtimeMs) return { existe: true, titulos: c.titulos, mtimeMs: st.mtimeMs };
  const titulos = new Map();
  try {
    const texto = fs.readFileSync(arq, 'utf8');
    for (const m of texto.matchAll(/\[([^\]\n]{2,120})\]\(([^)\s]+\.md)\)/g)) titulos.set(path.basename(m[2]), m[1].trim());
  } catch {}
  cacheIndices.set(dirMem, { mtimeMs: st.mtimeMs, titulos });
  return { existe: true, titulos, mtimeMs: st.mtimeMs };
}

function lerMemorias(conhecidas) {
  const itens = [], indices = [];
  for (const proj of lerDir(PROJETOS)) {
    const dirMem = path.join(PROJETOS, proj, 'memory');
    const arquivos = lerDir(dirMem);
    if (!arquivos.length) continue;
    const pasta = nomeDaPastaCodificada(proj, conhecidas);
    const indice = titulosDoIndice(dirMem);
    if (indice.existe) indices.push({ dirMem, pasta, mtimeMs: indice.mtimeMs });
    for (const nome of arquivos) {
      if (!nome.endsWith('.md') || nome === 'MEMORY.md') continue;
      const arq = path.join(dirMem, nome);
      const st = statSeguro(arq);
      if (!st?.isFile()) continue;
      let c = cacheArquivos.get(arq);
      if (!c || c.mtimeMs !== st.mtimeMs) {
        const fm = frontmatter(cabecaDe(arq));
        c = { mtimeMs: st.mtimeMs, nome: fm.nome, tipo: fm.tipo };
        cacheArquivos.set(arq, c);
      }
      const item = {
        titulo: curto(indice.titulos.get(nome) || humanizar(c.nome || nome)),
        area: AREA_DO_TIPO[c.tipo] || 'projetos', tipo: 'memoria', pasta, modificadoEm: Math.round(st.mtimeMs), caminho: arq,
      };
      itens.push(item);
      porCaminho.set(arq, item);
    }
  }
  return { itens, indices };
}

// ---------------------------------------------------------------------------
// Skills, regras e memórias do Codex (refeitas a cada 60 s)
// ---------------------------------------------------------------------------
// Skills de uma pasta skills/<nome>/SKILL.md
function skillsEm(dir, origem, lista) {
  for (const nome of lerDir(dir)) {
    if (nome.startsWith('.')) continue;
    const arq = path.join(dir, nome, 'SKILL.md');
    const st = statSeguro(arq);
    if (!st) continue;
    let c = cacheArquivos.get(arq);
    if (!c || c.mtimeMs !== st.mtimeMs) { c = { mtimeMs: st.mtimeMs, nome: frontmatter(cabecaDe(arq, 2048)).nome }; cacheArquivos.set(arq, c); }
    lista.push({ titulo: curto(c.nome || nome, 40), area: 'skills', tipo: 'skill', pasta: origem.rotulo, origem: origem.provedor,
      modificadoEm: Math.round(st.mtimeMs), chave: (c.nome || nome).toLowerCase() });
  }
}

// cache/<loja>/<plugin>/<versão>/skills: só a versão mais recente de cada plugin
function skillsDePlugins(raiz, origem, lista) {
  for (const loja of lerDir(raiz)) {
    for (const plugin of lerDir(path.join(raiz, loja))) {
      const dirPlugin = path.join(raiz, loja, plugin);
      const versoes = lerDir(dirPlugin).map(v => ({ v, st: statSeguro(path.join(dirPlugin, v, 'skills')) })).filter(x => x.st);
      if (!versoes.length) continue;
      versoes.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
      skillsEm(path.join(dirPlugin, versoes[0].v, 'skills'), { ...origem, rotulo: plugin }, lista);
    }
  }
}

// Plugins instalados no Claude: installed_plugins.json (installPath de cada um)
function skillsDePluginsClaude(lista) {
  let caminhos = [];
  try {
    const j = JSON.parse(fs.readFileSync(path.join(CLAUDE, 'plugins', 'installed_plugins.json'), 'utf8'));
    const coletar = o => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (k === 'installPath' && typeof v === 'string') caminhos.push(v); else coletar(v); } };
    coletar(j);
  } catch {}
  if (caminhos.length) for (const p of new Set(caminhos)) skillsEm(path.join(p, 'skills'), { provedor: 'claude', rotulo: path.basename(path.dirname(p)) }, lista);
  else skillsDePlugins(path.join(CLAUDE, 'plugins', 'cache'), { provedor: 'claude' }, lista);
}

function lerSkills(conhecidas) {
  const lista = [];
  skillsEm(path.join(CLAUDE, 'skills'), { provedor: 'claude', rotulo: 'suas skills' }, lista);
  skillsDePluginsClaude(lista);
  for (const p of conhecidas.lista) skillsEm(path.join(p, '.claude', 'skills'), { provedor: 'claude', rotulo: path.basename(p) }, lista);
  skillsEm(path.join(CODEX, 'skills'), { provedor: 'codex', rotulo: 'Codex' }, lista);
  skillsEm(path.join(AGENTES_HOME, 'skills'), { provedor: 'codex', rotulo: 'Codex' }, lista);
  skillsDePlugins(path.join(CODEX, 'plugins', 'cache'), { provedor: 'codex' }, lista);
  return lista;
}

// stat com prazo: pasta no Google Drive pode demorar; quem passa do prazo fica de fora desta vez
async function statComPrazo(p, ms = 800) {
  return Promise.race([fsp.stat(p).catch(() => null), new Promise(ok => setTimeout(() => ok(null), ms).unref())]);
}

async function lerRegras(conhecidas) {
  const alvos = [
    { arq: path.join(CLAUDE, 'CLAUDE.md'), titulo: 'CLAUDE.md global', origem: 'claude' },
    { arq: path.join(CODEX, 'AGENTS.md'), titulo: 'AGENTS.md do Codex', origem: 'codex' },
    { arq: path.join(CODEX, 'AGENTS.override.md'), titulo: 'AGENTS.override.md do Codex', origem: 'codex' },
  ];
  for (const p of conhecidas.lista) {
    const nome = p === HOME ? 'pasta pessoal' : path.basename(p).normalize('NFC');
    for (const [rel, origem] of [['CLAUDE.md', 'claude'], ['CLAUDE.local.md', 'claude'], [path.join('.claude', 'CLAUDE.md'), 'claude'], ['AGENTS.md', 'codex']]) {
      alvos.push({ arq: path.join(p, rel), titulo: `${path.basename(rel)} · ${nome}`, origem });
    }
  }
  const sts = await Promise.all(alvos.map(a => statComPrazo(a.arq)));
  const lista = [];
  alvos.forEach((a, i) => {
    const st = sts[i];
    if (!st?.isFile()) return;
    const item = { titulo: curto(a.titulo, 40), area: 'regras', tipo: 'regra', pasta: path.basename(path.dirname(a.arq)).normalize('NFC'), origem: a.origem, modificadoEm: Math.round(st.mtimeMs), caminho: a.arq };
    lista.push(item);
    porCaminho.set(a.arq, item);
  });
  return lista;
}

// Memórias do Codex: arquivos em $CODEX_HOME/memories (se houver) e as linhas da
// base memories_1.sqlite, aberta em modo imutável (nem trava nem escreve). Só a
// contagem, o slug e a data saem daqui; o texto da memória nunca é lido.
async function lerMemoriasCodex() {
  const lista = [];
  const dir = path.join(CODEX, 'memories');
  const varrer = (d, prof = 0) => {
    for (const e of lerDir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && prof < 2 && !e.name.startsWith('.')) varrer(p, prof + 1);
      else if (e.isFile() && /\.(md|txt|json)$/.test(e.name)) {
        const st = statSeguro(p);
        if (st) { const item = { titulo: curto(humanizar(e.name.replace(/\.(txt|json)$/, '')), 40), area: 'codex', tipo: 'memoria', pasta: 'Codex', modificadoEm: Math.round(st.mtimeMs), caminho: p }; lista.push(item); porCaminho.set(p, item); }
      }
    }
  };
  varrer(dir);
  const base = path.join(CODEX, 'memories_1.sqlite');
  if (statSeguro(base)) {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync('file:' + encodeURI(base) + '?immutable=1', { readOnly: true });
      try {
        const linhas = db.prepare('SELECT rollout_slug AS slug, generated_at AS em FROM stage1_outputs ORDER BY generated_at DESC LIMIT 500').all();
        for (const l of linhas) {
          const em = Number(l.em) || 0;
          lista.push({ titulo: curto(humanizar(l.slug || 'memória do Codex'), 40), area: 'codex', tipo: 'memoria', pasta: 'Codex', modificadoEm: em < 1e12 ? em * 1000 : em });
        }
      } finally { db.close(); }
    } catch { /* Node sem node:sqlite, ou base em outro formato: só os arquivos contam */ }
  }
  return lista;
}

let lento = { quando: 0, skills: [], regras: [], codex: [], pendente: null };
async function atualizarLento(agora, conhecidas) {
  if (lento.quando && agora - lento.quando < LENTO_MS) return lento;
  if (lento.pendente) return lento.quando ? lento : lento.pendente;   // com dado antigo, não espera
  lento.pendente = (async () => {
    const [regras, codex] = await Promise.all([lerRegras(conhecidas), lerMemoriasCodex()]);
    lento = { quando: Date.now(), skills: lerSkills(conhecidas), regras, codex, pendente: null };
    return lento;
  })().catch(() => { lento.pendente = null; return lento; });
  return lento.quando ? lento : lento.pendente;
}

// ---------------------------------------------------------------------------
// "Agora": o que as sessões estão consultando e gravando
// ---------------------------------------------------------------------------
const MARCAS = ['/memory', '/skills/', 'SKILL.md', 'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENTS.override.md', '/.codex/memories', '"Skill"'];

// Caminho -> { area, titulo, tipo } ou null
function classificarCaminho(bruto) {
  if (!bruto || typeof bruto !== 'string') return null;
  let p = bruto.trim().replace(/^["'`]|["'`;|&)]+$/g, '');
  if (p.startsWith('~/')) p = path.join(HOME, p.slice(2));
  else if (p.startsWith('$HOME/')) p = path.join(HOME, p.slice(6));
  const base = path.basename(p);
  // pasta de memória do Claude (de qualquer projeto)
  const mem = p.match(/[/\\]projects[/\\]([^/\\]+)[/\\]memory(?:[/\\](.*))?$/);
  if (mem) {
    const arq = mem[2] ? path.basename(mem[2]) : '';
    const pasta = nomeDaPastaCodificada(mem[1], pastasConhecidas.porCodigo);
    if (!arq || arq === 'MEMORY.md' || !arq.endsWith('.md')) return { area: 'indice', titulo: `Índice · ${pasta}`, tipo: 'indice' };
    const item = porCaminho.get(p) || porCaminho.get(path.join(PROJETOS, mem[1], 'memory', arq));
    return item ? { area: item.area, titulo: item.titulo, tipo: 'memoria' } : { area: null, titulo: curto(humanizar(arq)), tipo: 'memoria' };
  }
  if (/[/\\]\.codex[/\\]memories/.test(p) || (p.startsWith(path.join(CODEX, 'memories')))) {
    return { area: 'codex', titulo: porCaminho.get(p)?.titulo || 'Memórias do Codex', tipo: 'memoria' };
  }
  const sk = p.match(/[/\\]skills[/\\](?:\.system[/\\])?([^/\\]+)/);
  if (sk && !/^\.|\.(js|mjs|ts|json)$/.test(sk[1])) return { area: 'skills', titulo: curto(sk[1], 40), tipo: 'skill' };
  if (ARQ_REGRAS.has(base)) {
    const dir = path.dirname(p);
    const dono = dir === CLAUDE ? 'global' : dir === CODEX ? 'Codex' : path.basename(dir === '.' ? '' : dir.replace(/[/\\]\.claude$/, '')) || 'pasta';
    return { area: 'regras', titulo: curto(`${base} · ${dono}`, 40), tipo: 'regra' };
  }
  return null;
}

// Linha de comando -> primeiro caminho reconhecido (aceita caminho entre aspas, com espaço)
function caminhoNoComando(cmd) {
  const texto = String(cmd || '');
  if (!MARCAS.some(m => texto.includes(m))) return null;
  for (const m of texto.matchAll(/"([^"\n]+)"|'([^'\n]+)'|([^\s"'`;|&<>()]+)/g)) {
    const t = m[1] ?? m[2] ?? m[3];
    if (!MARCAS.some(k => t.includes(k))) continue;
    const c = classificarCaminho(t);
    if (c) return c;
  }
  return null;
}
// redirecionamento de saída para arquivo (não conta 2>/dev/null, >&2 nem a seta => do JavaScript)
const ESCRITA_NO_COMANDO = /(?:^|[\s;|&(])1?>>?\s*(?!\/dev\/|&)[^\s>=]|\btee\b|\bsed\s+-i|\bcp\b|\bmv\b|\brm\b|\btouch\b|\bmkdir\b|writeFile|apply_patch|\*\*\* (Update|Add|Delete) File/;

function tipoNoConteudo(texto) {
  const m = String(texto || '').slice(0, 800).match(/^\s*type:\s*["']?([a-z]+)/m);
  return m ? AREA_DO_TIPO[m[1]] : null;
}

// Uma chamada de ferramenta do Claude -> evento ou null
function eventoClaude(uso) {
  const nome = uso?.name, e = uso?.input || {};
  if (nome === 'Skill') {
    const s = String(e.skill || e.command || '').trim();
    return s ? { acao: 'usar', area: 'skills', titulo: curto(s.split(':').pop(), 40), tipo: 'skill' } : null;
  }
  if (['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(nome)) {
    const c = classificarCaminho(e.file_path || e.notebook_path);
    if (!c) return null;
    const leitura = nome === 'Read';
    if (!c.area) c.area = (!leitura && tipoNoConteudo(e.content)) || 'projetos';
    return { ...c, acao: leitura ? (c.tipo === 'skill' ? 'usar' : 'consultar') : 'gravar' };
  }
  if (nome === 'Grep' || nome === 'Glob') {
    const c = classificarCaminho(e.path);
    if (!c) return null;
    if (!c.area) c.area = 'projetos';
    return { ...c, acao: 'consultar' };
  }
  if (nome === 'Bash') {
    const c = caminhoNoComando(e.command);
    if (!c) return null;
    if (!c.area) c.area = 'projetos';
    return { ...c, acao: ESCRITA_NO_COMANDO.test(e.command) ? 'gravar' : c.tipo === 'skill' ? 'usar' : 'consultar' };
  }
  return null;
}

// Uma chamada de ferramenta do Codex (response_item) -> evento ou null
function eventoCodex(p) {
  let texto = '';
  if (p.type === 'function_call') texto = typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments || {});
  else if (p.type === 'custom_tool_call') texto = String(p.input || '');
  if (!texto) return null;
  // apply_patch: "*** Update File: caminho"
  const patch = texto.match(/\*\*\* (?:Update|Add|Delete) File: ([^\n\\]+)/);
  if (patch) {
    const c = classificarCaminho(patch[1]);
    return c ? { ...c, area: c.area || 'projetos', acao: 'gravar' } : null;
  }
  let cmd = texto;
  try { const a = JSON.parse(texto); if (a && typeof a === 'object') cmd = [].concat(a.cmd || a.command || texto).join(' '); } catch {}
  cmd = cmd.replace(/\\"/g, '"').replace(/\\n/g, '\n');
  const c = caminhoNoComando(cmd);
  if (!c) return null;
  return { ...c, area: c.area || 'projetos', acao: ESCRITA_NO_COMANDO.test(cmd) ? 'gravar' : c.tipo === 'skill' ? 'usar' : 'consultar' };
}

const leitores = new Map();   // arquivo -> { offset, resto, agenteId, sessaoId, pasta, provedor }
const eventos = [];           // últimos 30 min

function registrar(ev) {
  const igual = eventos.find(x => x.agenteId === ev.agenteId && x.area === ev.area && x.titulo === ev.titulo && x.acao === ev.acao && Math.abs(x.quando - ev.quando) < JANELA_AGORA_MS);
  if (igual) { igual.quando = Math.max(igual.quando, ev.quando); return; }
  eventos.push(ev);
  if (eventos.length > 200) eventos.splice(0, eventos.length - 200);
}

// Lê só o que foi acrescentado desde a última vez (ou o fim, na primeira)
function lerNovidades(arquivo, st, leitor) {
  if (st.size < leitor.offset) { leitor.offset = 0; leitor.resto = ''; }
  if (st.size === leitor.offset) return [];
  let inicio = leitor.offset;
  let pularPrimeira = false;
  if (leitor.offset === 0 && st.size > PRIMEIRA_LEITURA) { inicio = st.size - PRIMEIRA_LEITURA; pularPrimeira = true; }
  if (st.size - inicio > LEITURA_MAX) { inicio = st.size - PRIMEIRA_LEITURA; pularPrimeira = true; leitor.resto = ''; }
  let fd;
  try {
    fd = fs.openSync(arquivo, 'r');
    const buf = Buffer.alloc(st.size - inicio);
    const n = fs.readSync(fd, buf, 0, buf.length, inicio);
    leitor.offset = inicio + n;
    let texto = leitor.resto + buf.toString('utf8', 0, n);
    const linhas = texto.split('\n');
    leitor.resto = linhas.pop() || '';
    if (leitor.resto.length > LEITURA_MAX) leitor.resto = '';
    if (pularPrimeira) linhas.shift();
    return linhas;
  } catch { return []; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

function processarClaude(arquivo, st, leitor, agora) {
  for (const linha of lerNovidades(arquivo, st, leitor)) {
    if (!linha.includes('"tool_use"') || !MARCAS.some(m => linha.includes(m))) continue;
    let d;
    try { d = JSON.parse(linha); } catch { continue; }
    if (d.type !== 'assistant' || !Array.isArray(d.message?.content)) continue;
    const quando = Date.parse(d.timestamp) || st.mtimeMs;
    if (agora - quando > JANELA_HISTORICO_MS) continue;
    if (d.cwd && !leitor.pasta) leitor.pasta = path.basename(d.cwd);
    for (const uso of d.message.content) {
      if (uso?.type !== 'tool_use') continue;
      const ev = eventoClaude(uso);
      if (ev) registrar({ ...ev, quando, provedor: 'anthropic', agente: 'Claude', agenteId: leitor.agenteId, sessaoId: leitor.sessaoId, pasta: leitor.pasta || null });
    }
  }
}

function processarCodex(arquivo, st, leitor, agora) {
  if (!leitor.metaLida) {
    leitor.metaLida = true;
    const primeira = cabecaDe(arquivo, 64 * 1024).split('\n')[0];
    const cwd = primeira.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1];
    if (cwd) leitor.pasta = path.basename(cwd.replace(/\\\//g, '/'));
    const id = primeira.match(/"payload":\{"id":"([^"]+)"/)?.[1] || primeira.match(/"id":"([0-9a-f-]{36})"/)?.[1];
    if (id) leitor.agenteId = leitor.sessaoId = 'codex:' + id;
  }
  for (const linha of lerNovidades(arquivo, st, leitor)) {
    if (!/"(function_call|custom_tool_call)"/.test(linha) || !MARCAS.some(m => linha.includes(m))) continue;
    let d;
    try { d = JSON.parse(linha); } catch { continue; }
    if (d.type !== 'response_item' || !d.payload) continue;
    const quando = Date.parse(d.timestamp) || st.mtimeMs;
    if (agora - quando > JANELA_HISTORICO_MS) continue;
    const ev = eventoCodex(d.payload);
    if (ev) registrar({ ...ev, quando, provedor: 'openai', agente: 'Codex', agenteId: leitor.agenteId, sessaoId: leitor.sessaoId, pasta: leitor.pasta || null });
  }
}

// Transcrições do Claude escritas há pouco (sessões e subagentes)
function transcricoesClaude(agora) {
  const lista = [];
  const recentes = new Set();
  // sessões vivas (mesmo paradas, podem ter subagentes trabalhando)
  for (const arq of lerDir(path.join(CLAUDE, 'sessions'))) {
    if (!arq.endsWith('.json')) continue;
    try { const s = JSON.parse(fs.readFileSync(path.join(CLAUDE, 'sessions', arq), 'utf8')); if (s?.sessionId) recentes.add(s.sessionId); } catch {}
  }
  for (const proj of lerDir(PROJETOS)) {
    const dir = path.join(PROJETOS, proj);
    for (const nome of lerDir(dir)) {
      if (!nome.endsWith('.jsonl')) continue;
      const arq = path.join(dir, nome);
      const st = statSeguro(arq);
      if (!st) continue;
      const id = nome.slice(0, -6);
      if (agora - st.mtimeMs < JANELA_LEITURA_MS) lista.push({ arq, st, agenteId: id, sessaoId: id });
      if (agora - st.mtimeMs < SUBAGENTES_MS || recentes.has(id)) {
        const dirSub = path.join(dir, id, 'subagents');
        const varrer = (d, prof) => {
          for (const e of lerDir(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory() && prof < 2) varrer(p, prof + 1);
            else if (e.isFile() && /^agent-.*\.jsonl$/.test(e.name)) {
              const s2 = statSeguro(p);
              if (s2 && agora - s2.mtimeMs < JANELA_LEITURA_MS) lista.push({ arq: p, st: s2, agenteId: e.name.slice(0, -6), sessaoId: id });
            }
          }
        };
        varrer(dirSub, 0);
      }
    }
  }
  return lista;
}

// Transcrições do Codex dos dois últimos dias com pasta (AAAA/MM/DD)
function transcricoesCodex(agora) {
  const raiz = path.join(CODEX, 'sessions');
  const dias = [];
  for (const a of lerDir(raiz).filter(x => /^\d{4}$/.test(x)).sort().reverse().slice(0, 2)) {
    for (const m of lerDir(path.join(raiz, a)).filter(x => /^\d\d$/.test(x)).sort().reverse().slice(0, 2)) {
      for (const d of lerDir(path.join(raiz, a, m)).filter(x => /^\d\d$/.test(x)).sort().reverse().slice(0, 2)) dias.push(path.join(raiz, a, m, d));
    }
  }
  dias.sort().reverse();
  const lista = [];
  for (const d of dias.slice(0, 2)) {
    for (const nome of lerDir(d)) {
      if (!nome.endsWith('.jsonl')) continue;
      const arq = path.join(d, nome);
      const st = statSeguro(arq);
      if (st && agora - st.mtimeMs < JANELA_LEITURA_MS) lista.push({ arq, st });
    }
  }
  return lista;
}

function lerAgora(agora) {
  for (const t of transcricoesClaude(agora)) {
    let l = leitores.get(t.arq);
    if (!l) { l = { offset: 0, resto: '', agenteId: t.agenteId, sessaoId: t.sessaoId, pasta: null }; leitores.set(t.arq, l); }
    l.visto = agora;
    processarClaude(t.arq, t.st, l, agora);
  }
  for (const t of transcricoesCodex(agora)) {
    let l = leitores.get(t.arq);
    if (!l) { l = { offset: 0, resto: '', agenteId: null, sessaoId: null, pasta: null }; leitores.set(t.arq, l); }
    l.visto = agora;
    processarCodex(t.arq, t.st, l, agora);
  }
  // esquece leitores parados há mais de 30 min e eventos velhos
  for (const [k, l] of leitores) if (agora - (l.visto || 0) > JANELA_HISTORICO_MS) leitores.delete(k);
  while (eventos.length && agora - eventos[0].quando > JANELA_HISTORICO_MS) eventos.shift();
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------
function publicoDoEvento(ev, agora) {
  return {
    quando: ev.quando, ha: haQuanto(ev.quando, agora), hora: HORA.format(ev.quando), provedor: ev.provedor, agente: ev.agente,
    agenteId: ev.agenteId, sessaoId: ev.sessaoId, pasta: ev.pasta, acao: ev.acao, area: ev.area, titulo: ev.titulo, nivel: nivelDe(ev.titulo),
  };
}

let cache = { quando: 0, dados: null, pendente: null };

export async function memoria() {
  const agora = Date.now();
  if (cache.dados && agora - cache.quando < CACHE_MS) return cache.dados;
  if (cache.pendente) return cache.pendente;
  cache.pendente = (async () => {
    const conhecidas = atualizarPastasConhecidas(agora);
    const { itens: memorias, indices } = lerMemorias(conhecidas.porCodigo);
    const l = await atualizarLento(agora, conhecidas);
    lerAgora(agora);

    const ordenados = [...eventos].sort((a, b) => b.quando - a.quando);
    const agoraEv = ordenados.filter(e => agora - e.quando <= JANELA_AGORA_MS);

    // skills: uma por nome (a mesma skill no Claude e no Codex conta uma vez)
    const skillsUnicas = new Map();
    for (const s of l.skills) if (!skillsUnicas.has(s.chave) || skillsUnicas.get(s.chave).modificadoEm < s.modificadoEm) skillsUnicas.set(s.chave, s);
    const skills = [...skillsUnicas.values()];

    const porArea = new Map(AREAS.map(a => [a.id, []]));
    for (const m of memorias) porArea.get(m.area)?.push(m);
    porArea.set('skills', skills);
    porArea.set('regras', l.regras);
    porArea.set('codex', l.codex);

    const contar = (lista, origem) => lista.filter(x => x.origem === origem).length;
    const prateleiras = AREAS.map(a => {
      const lista = porArea.get(a.id) || [];
      const ativos = agoraEv.filter(e => e.area === a.id);
      return {
        id: a.id, nome: a.nome, total: lista.length,
        detalhe: a.id === 'skills' ? { claude: new Set(l.skills.filter(s => s.origem === 'claude').map(s => s.chave)).size, codex: new Set(l.skills.filter(s => s.origem === 'codex').map(s => s.chave)).size }
          : a.id === 'regras' ? { claude: contar(l.regras, 'claude'), codex: contar(l.regras, 'codex') } : null,
        atualizadaEm: lista.reduce((m, x) => Math.max(m, x.modificadoEm || 0), 0) || null,
        ativa: ativos.length > 0,
        acao: ativos[0]?.acao || null,
        nivel: ativos[0] ? nivelDe(ativos[0].titulo) : null,
        agentes: [...new Set(ativos.map(e => e.agenteId).filter(Boolean))],
      };
    });
    const ativosIndice = agoraEv.filter(e => e.area === 'indice');
    const fichario = { total: indices.length, ativa: ativosIndice.length > 0, acao: ativosIndice[0]?.acao || null, agentes: [...new Set(ativosIndice.map(e => e.agenteId).filter(Boolean))] };

    const recentes = [...memorias, ...skills, ...l.regras, ...l.codex]
      .filter(x => x.modificadoEm && x.modificadoEm <= agora + 60_000)
      .sort((a, b) => b.modificadoEm - a.modificadoEm).slice(0, 8)
      .map(x => ({ titulo: x.titulo, area: x.area, tipo: x.tipo, pasta: x.pasta, modificadoEm: x.modificadoEm, ha: haQuanto(x.modificadoEm, agora) }));

    const porPasta = new Map();
    for (const m of memorias) porPasta.set(m.pasta, (porPasta.get(m.pasta) || 0) + 1);

    const dados = {
      versao: 1,
      geradoEm: agora,
      prateleiras,
      fichario,
      recentes,
      atividadeAgora: agoraEv.slice(0, 6).map(e => publicoDoEvento(e, agora)),
      ultimas: ordenados.slice(0, 8).map(e => publicoDoEvento(e, agora)),
      totais: { memorias: memorias.length, skills: skills.length, regras: l.regras.length, codex: l.codex.length },
      pastas: [...porPasta].map(([nome, n]) => ({ nome, memorias: n })).sort((a, b) => b.memorias - a.memorias),
    };
    cache = { quando: Date.now(), dados, pendente: null };
    return dados;
  })().catch(e => { cache.pendente = null; throw e; });
  return cache.pendente;
}
