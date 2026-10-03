// Fonte dos dados da Estação. Hoje é o servidor local (/api/estado); no futuro
// pode somar uma fonte remota sem mexer na cena.
//
// Modo de ensaio: ?simular=0|1|4|10 troca a leitura por listas sintéticas no
// formato do CONTRATO v0.5, calculadas a partir de t = segundos desde a carga
// da página × velocidade (&x=, padrão 1; &x=5 acelera cinco vezes).
//
// &codex=1 soma, a qualquer cenário, a tripulação do Codex (2 agentes 'openai' na pasta
// Claude, um trabalhando e um com pergunta de vez em quando), provedores.codex = true
// e os medidores do Codex. Sem &codex, provedores.codex = false (a Sala OpenAI não
// aparece) e os testes da estação ficam como antes.
//
// &fila=1 (rodada 6) soma 4 sessões que precisam de você (chegam uma a cada 4 s na
// fila da sala do dono, e as duas primeiras são atendidas aos 70 s) e 3 que
// terminaram com sugestão (fila da revisão), num ciclo de 120 s.
//
// CONTRATO v0.5 do /api/estado (+ rodada 5):
//   { agentes: [...], geradoEm, provedores: { codex }, limites, dono: { nome } | null, erro? }
//   limites = { anthropic: { medidores, atualizadoEm, fonte, aviso? }, openai: { ... } }
//   medidor = { rotulo, pct (0 a 100 | null), reiniciaEm (ms | null), janelaMin }
// Cada agente: id, nome, tipo ('sessao' | 'subagente'), pai (no subagente), pasta,
// pastaCaminho, atividade ('editar' | 'pesquisar' | 'conector' | 'esperar' |
// 'descansar' | 'coordenar'), texto, conector, conectorTipo ('mcp' | 'api' | null),
// ferramenta, pensamentos [{ id, texto }] (últimos 6), paradoHaMs (só em
// 'descansar'), aguardando ('permissao' | 'pergunta' | 'outro' | null),
// terminou (subagente que encerrou), provedor ('anthropic' | 'openai'), contexto
// (% da janela de contexto usada, 0 a 100, ou null) e, na rodada 6, pendencia
// ('precisa_de_voce' | 'entrega_com_sugestao' | null), pendenteHaMs e abrivel.
// atividade 'revisar' = terminou com uma sugestão (fila da revisão).

const parametros = new URLSearchParams(location.search);
const CENARIOS = [0, 1, 4, 10];
const SIMULAR = parametros.has('simular')
  ? (CENARIOS.includes(Number(parametros.get('simular') || 1)) ? Number(parametros.get('simular') || 1) : 1)
  : null;
const VELOCIDADE = Number(parametros.get('x')) > 0 ? Number(parametros.get('x')) : 1;
const COM_CODEX = parametros.get('codex') === '1';
const COM_FILA = parametros.get('fila') === '1';
const INICIO = performance.now();

// Devolve o estado (JSON do contrato) ou lança erro se não conseguir ler
export async function lerEstado() {
  if (SIMULAR !== null) return estadoSimulado(SIMULAR, (performance.now() - INICIO) / 1000 * VELOCIDADE);
  const d = await (await fetch('/api/estado', { cache: 'no-store' })).json();
  // teste de estresse ligado no servidor (ESTACAO_CARGA): soma os astronautas simulados
  const c = d?.cargaTeste;
  if (c && Array.isArray(d.agentes)) {
    const t = (Date.now() - c.inicio) / 1000;
    d.agentes.push(...extras(t, quantosNaCarga(t, { a: c.a, b: c.b, dur: c.min * 60 })));
  }
  return d;
}

// ---------------------------------------------------------------------------
// Simulação
// ---------------------------------------------------------------------------
const BASE = '/exemplo';   // caminho neutro (o projeto é público); a placa mostra só o nome da pasta
const SITE = BASE + '/Projetos/site';
const NOTAS = BASE + '/Projetos/notas';
const EVENTO = BASE + '/Projetos/evento';

const TEXTOS = {
  editar: 'trabalhando na mesa', pesquisar: 'pesquisando na web', esperar: 'esperando sua aprovação',
  descansar: 'descansando', coordenar: 'coordenando os ajudantes', revisar: 'terminou com uma sugestão',
};
const FRASES = {
  editar: ['Lendo o arquivo de configuração', 'Ajustando a função de leitura', 'Rodando os testes',
    'Corrigindo o import quebrado', 'Conferindo o resultado no terminal', 'Atualizando a especificação', 'Revisando o texto do resumo'],
  pesquisar: ['Buscando a documentação', 'Abrindo a página de referência', 'Comparando duas fontes', 'Anotando o que encontrei'],
  conector: ['Listando os projetos', 'Lendo o relatório da semana', 'Conferindo as métricas', 'Buscando os posts agendados'],
  esperar: ['Posso seguir com a mudança?'],
  coordenar: ['Distribuindo as tarefas', 'Juntando os resultados'],
};
const FERRAMENTAS = { editar: 'Edit', pesquisar: 'WebSearch', esperar: 'AskUserQuestion', coordenar: 'Workflow', descansar: null };

const nomeDaPasta = caminho => caminho.split('/').filter(Boolean).pop() || caminho;

// Monta um agente no formato do contrato.
// pensaAte: instante (em t simulado) até onde a sessão gerou pensamentos; um novo a cada 4 a 9 s
// (ritmo e defasagem próprios de cada agente).
function agente({ id, nome, tipo = 'sessao', pai, pastaCaminho, atividade, conector = null, conectorTipo = null,
  t, ciclo = 0, pensaAte = t, paradoHaMs = null, aguardando = null, terminou = false, provedor = 'anthropic',
  pendencia = null, pendenteHaMs = null }) {
  const pensamentos = [];
  if (atividade !== 'descansar') {
    const frases = FRASES[atividade] || FRASES.editar;
    // cada agente tem o próprio ritmo (4 a 9 s) e defasagem: os balões não aparecem todos juntos
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const periodo = 4 + (h % 6), defasagem = (h >>> 8) % periodo;
    const n = Math.floor(Math.max(0, pensaAte + defasagem) / periodo);
    for (let k = Math.max(0, n - 5); k <= n; k++) pensamentos.push({ id: `${id}:c${ciclo}:${k}`, texto: frases[k % frases.length] });
  }
  return {
    id, nome, tipo, ...(tipo === 'subagente' ? { pai } : {}),
    pasta: nomeDaPasta(pastaCaminho), pastaCaminho, atividade,
    texto: atividade === 'conector' ? 'usando ' + conector : TEXTOS[atividade],
    conector, conectorTipo,
    ferramenta: atividade === 'conector' ? (conectorTipo === 'mcp' ? 'mcp__' + conector.toLowerCase().replace(/\W+/g, '_') : 'Bash') : FERRAMENTAS[atividade],
    pensamentos, paradoHaMs: atividade === 'descansar' || atividade === 'revisar' ? paradoHaMs : null,
    aguardando, terminou, provedor,
    pendencia: tipo === 'sessao' ? pendencia : null, pendenteHaMs: pendencia ? pendenteHaMs : null, abrivel: tipo === 'sessao',
    // contexto cresce devagar com o tempo da sessão (só para o hover ter o que mostrar)
    contexto: Math.min(95, 8 + (hashSimples(id) % 30) + Math.floor(Math.max(0, pensaAte) / 6)),
  };
}
function hashSimples(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

// Cenário 1: uma sessão num ciclo de 360 s, com 2 subagentes no meio
function cenario1(t) {
  const ciclo = Math.floor(t / 360), tc = t % 360;
  const lista = [];
  if (tc < 330) {
    let atividade = 'editar', extra = {};
    if (tc < 20) atividade = 'editar';
    else if (tc < 35) atividade = 'pesquisar';
    else if (tc < 55) { atividade = 'conector'; extra = { conector: 'Planilhas', conectorTipo: 'mcp' }; }
    else if (tc < 90) atividade = 'editar';
    else { atividade = 'descansar'; extra = { paradoHaMs: Math.round((tc - 90) * 1000) }; }
    lista.push(agente({ id: 'sim-1-sessao', nome: 'Ajustar o relatório semanal', pastaCaminho: SITE, atividade, t: tc, ciclo, pensaAte: Math.min(tc, 90), ...extra }));
  }
  const subs = [
    { id: 'sim-1-sub-a', nome: 'Explorar o código', entra: 60, atividade: 'editar' },
    { id: 'sim-1-sub-b', nome: 'Revisar os textos', entra: 63, atividade: 'pesquisar' },
  ];
  for (const s of subs) {
    if (tc < s.entra || tc >= 85) continue;
    const terminou = tc >= 80;
    lista.push(agente({ id: s.id, nome: s.nome, tipo: 'subagente', pai: 'sim-1-sessao', pastaCaminho: SITE,
      atividade: terminou ? 'descansar' : s.atividade, t: tc - s.entra, ciclo, terminou,
      paradoHaMs: terminou ? Math.round((tc - 80) * 1000) : null }));
  }
  return lista;
}

// Cenário 4: 3 sessões em 'site' e 1 em 'notas', ciclo de 120 s
function cenario4(t) {
  const ciclo = Math.floor(t / 120), tc = t % 120;
  const lista = [];
  lista.push(agente({ id: 'sim-4-a', nome: 'Refatorar a leitura', pastaCaminho: SITE,
    atividade: tc >= 70 && tc < 90 ? 'pesquisar' : 'editar', t: tc, ciclo }));
  const esperando = tc >= 40 && tc < 60;
  lista.push(agente({ id: 'sim-4-b', nome: 'Montar o roteiro do vídeo', pastaCaminho: SITE,
    atividade: esperando ? 'esperar' : 'editar', aguardando: esperando ? 'pergunta' : null,
    pendencia: esperando ? 'precisa_de_voce' : null, pendenteHaMs: Math.round((tc - 40) * 1000),
    t: tc, ciclo, pensaAte: esperando ? 40 : tc }));
  // aos 100 s termina oferecendo o próximo passo: fila da revisão até o fim do ciclo
  const c = tc >= 30 && tc < 50 ? { atividade: 'conector', conector: 'ChatGPT', conectorTipo: 'api' }
    : tc >= 100 ? { atividade: 'revisar', paradoHaMs: Math.round((tc - 100) * 1000), pendencia: 'entrega_com_sugestao', pendenteHaMs: Math.round((tc - 100) * 1000) }
      : { atividade: 'editar' };
  lista.push(agente({ id: 'sim-4-c', nome: 'Gerar as legendas', pastaCaminho: SITE, t: tc, ciclo, pensaAte: Math.min(tc, 100), ...c }));
  const d = tc < 60 ? { atividade: 'editar' } : tc < 80 ? { atividade: 'pesquisar' }
    : { atividade: 'descansar', paradoHaMs: Math.round((tc - 80) * 1000) };
  lista.push(agente({ id: 'sim-4-d', nome: 'Organizar as notas', pastaCaminho: NOTAS, t: tc, ciclo, pensaAte: Math.min(tc, 80), ...d }));
  return lista;
}

// Cenário 10: 4 sessões em 3 pastas, 3 subagentes fixos e um workflow que solta 6
// subagentes aos 20 s (um a cada 0,3 s) até os 100 s. Até 13 agentes, para o "+N".
function cenario10(t) {
  const ciclo = Math.floor(t / 120), tc = t % 120;
  const lista = [
    agente({ id: 'sim-10-a', nome: 'Revisar a especificação', pastaCaminho: SITE, atividade: 'editar', t: tc, ciclo }),
    agente({ id: 'sim-10-a1', nome: 'Explorar o código', tipo: 'subagente', pai: 'sim-10-a', pastaCaminho: SITE, atividade: 'editar', t: tc, ciclo }),
    agente({ id: 'sim-10-a2', nome: 'Procurar referências', tipo: 'subagente', pai: 'sim-10-a', pastaCaminho: SITE, atividade: 'pesquisar', t: tc, ciclo }),
    agente({ id: 'sim-10-a3', nome: 'Conferir os testes', tipo: 'subagente', pai: 'sim-10-a', pastaCaminho: SITE, atividade: 'descansar',
      terminou: true, paradoHaMs: Math.round(tc * 1000), t: tc, ciclo }),
    agente({ id: 'sim-10-b', nome: 'Relatório de redes', pastaCaminho: SITE, atividade: 'conector', conector: 'Planilhas', conectorTipo: 'mcp', t: tc, ciclo }),
    agente({ id: 'sim-10-c', nome: 'Resumo das reuniões', pastaCaminho: NOTAS, atividade: 'conector', conector: 'ChatGPT', conectorTipo: 'api', t: tc, ciclo }),
    agente({ id: 'sim-10-d', nome: 'Pauta do evento', pastaCaminho: EVENTO, atividade: 'descansar', paradoHaMs: Math.round(tc * 1000), t: tc, ciclo }),
  ];
  ['VIS', 'NAV', 'CAM', 'HUD', 'TXT', 'LUZ'].forEach((sigla, i) => {
    const entra = 20 + i * 0.3;
    if (tc < entra || tc >= 100) return;
    lista.push(agente({ id: 'sim-10-w' + i, nome: 'auditoria:' + sigla, tipo: 'subagente', pai: 'sim-10-b', pastaCaminho: SITE,
      atividade: i % 3 === 2 ? 'pesquisar' : 'editar', t: tc - entra, ciclo }));
  });
  return lista;
}

const GERADORES = { 0: () => [], 1: cenario1, 4: cenario4, 10: cenario10 };

// Filas (&fila=1): ciclo de 120 s. Quatro sessões pedem você aos 5, 9, 13 e 17 s
// (fila da sala do dono, por ordem de chegada); aos 70 s as duas primeiras são
// atendidas e voltam para a mesa, e as de trás andam para a frente. Três sessões
// terminam com sugestão aos 10, 16 e 22 s (fila da revisão) e a primeira volta a
// trabalhar aos 85 s.
function filas(t) {
  const ciclo = Math.floor(t / 120), tc = t % 120;
  const lista = [];
  const precisam = [['Publicar o carrossel', 5], ['Aprovar o orçamento', 9], ['Escolher a capa', 13], ['Revisar o contrato', 17]];
  precisam.forEach(([nome, chega], i) => {
    const atendida = i < 2 && tc >= 70;
    const espera = tc >= chega && !atendida;
    lista.push(agente({ id: 'sim-fila-d' + i, nome, pastaCaminho: i % 2 ? NOTAS : SITE, t: tc, ciclo,
      atividade: espera ? 'esperar' : 'editar', aguardando: espera ? (i % 2 ? 'permissao' : 'pergunta') : null,
      pendencia: espera ? 'precisa_de_voce' : null, pendenteHaMs: Math.round((tc - chega) * 1000), pensaAte: espera ? chega : tc }));
  });
  const sugerem = [['Resumo da reunião', 10], ['Ajustar a planilha', 16], ['Roteiro do episódio', 22]];
  sugerem.forEach(([nome, termina], i) => {
    const voltou = i === 0 && tc >= 85;
    const revisa = tc >= termina && !voltou;
    lista.push(agente({ id: 'sim-fila-r' + i, nome, pastaCaminho: EVENTO, t: tc, ciclo,
      atividade: revisa ? 'revisar' : 'editar', paradoHaMs: revisa ? Math.round((tc - termina) * 1000) : null,
      pendencia: revisa ? 'entrega_com_sugestao' : null, pendenteHaMs: Math.round((tc - termina) * 1000), pensaAte: Math.min(tc, termina) }));
  });
  return lista;
}

// Tripulação do Codex (&codex=1): ciclo de 90 s
function codex(t) {
  const ciclo = Math.floor(t / 90), tc = t % 90;
  const lista = [];
  const pergunta = tc >= 50 && tc < 65;
  lista.push(agente({ id: 'sim-codex-a', nome: 'Revisar o roteiro', pastaCaminho: SITE, provedor: 'openai',
    atividade: pergunta ? 'esperar' : tc < 20 ? 'editar' : tc < 35 ? 'pesquisar' : 'editar',
    aguardando: pergunta ? 'pergunta' : null, pendencia: pergunta ? 'precisa_de_voce' : null, pendenteHaMs: Math.round((tc - 50) * 1000),
    t: tc, ciclo, pensaAte: pergunta ? 50 : tc }));
  const b = tc < 70 ? { atividade: tc >= 25 && tc < 40 ? 'conector' : 'editar', ...(tc >= 25 && tc < 40 ? { conector: 'Magnific', conectorTipo: 'mcp' } : {}) }
    : { atividade: 'descansar', paradoHaMs: Math.round((tc - 70) * 1000) };
  lista.push(agente({ id: 'sim-codex-b', nome: 'Gerar as imagens', pastaCaminho: EVENTO, provedor: 'openai', t: tc, ciclo, pensaAte: Math.min(tc, 70), ...b }));
  return lista;
}

// Medidores sintéticos (os mesmos números da vitrine das salas de controle)
function limitesSimulados(agora, t) {
  const h = 3600e3;
  return {
    anthropic: {
      medidores: [
        { rotulo: 'Sessão · 5 h', pct: Math.min(100, Math.round(11 + t / 30)), reiniciaEm: agora + 3.2 * h, janelaMin: 300 },
        { rotulo: 'Semana · 7 dias', pct: 64, reiniciaEm: agora + 102 * h, janelaMin: 10080 },
        { rotulo: 'Fable · 7 dias', pct: 0, reiniciaEm: agora + 102 * h, janelaMin: 10080 },
      ],
      atualizadoEm: agora, fonte: 'painel',
    },
    openai: COM_CODEX
      ? { medidores: [{ rotulo: 'Codex · 7 dias', pct: 88, reiniciaEm: agora + 149 * h, janelaMin: 10080 }], atualizadoEm: agora, fonte: 'transcricoes' }
      : { medidores: [], atualizadoEm: null, fonte: 'indisponivel', aviso: 'nenhuma sessão do Codex informou os limites ainda' },
  };
}

// Estado sintético do cenário no instante t (segundos simulados)
// Teste de carga: &extra=N acrescenta N astronautas trabalhando (sessões com até 5
// ajudantes cada, em 4 pastas, mistura de mesa, pesquisa e conector)
const EXTRA = Math.min(200, Math.max(0, Number(parametros.get('extra')) || 0));
// Teste de carga variável: &carga=50-120&min=10 vai de 50 a 120 astronautas ao longo de
// 10 minutos, como um dia de verdade: sobe aos poucos, tem rajadas (um workflow que
// abre 10 ajudantes de uma vez), fica um tempo no topo e volta a cair. Repete depois.
const CARGA = (() => {
  const m = String(parametros.get('carga') || '').match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const a = Math.max(1, Math.min(200, +m[1])), b = Math.max(a, Math.min(200, +m[2]));
  return { a, b, dur: Math.max(1, Number(parametros.get('min')) || 10) * 60 };
})();
function quantosNaCarga(t, cfg = CARGA) {
  const { a, b, dur } = cfg;
  const f = (t % dur) / dur;                                    // 0..1 dentro do ciclo
  const base = f < 0.6 ? f / 0.6 : f < 0.8 ? 1 : 1 - (f - 0.8) / 0.2 * 0.7;   // sobe, topo, cai até 30%
  const onda = 0.08 * Math.sin(t / 23) + 0.05 * Math.sin(t / 7.3);            // vaivém de sessões
  const rajada = Math.floor(t / 45) % 3 === 1 && (t % 45) < 30 ? 0.12 : 0;    // workflow abrindo ajudantes
  return Math.round(a + (b - a) * Math.min(1, Math.max(0, base + onda + rajada)));
}

function extras(t, n) {
  const pastas = [SITE, NOTAS, EVENTO, BASE + '/Projetos/video'];
  const lista = [];
  let sessao = null;
  for (let i = 0; i < n; i++) {
    const pastaCaminho = pastas[Math.floor(i / 6) % pastas.length];
    const atividade = i % 7 === 3 ? 'pesquisar' : i % 9 === 5 ? 'conector' : 'editar';
    const conector = atividade === 'conector' ? 'Planilhas' : null;
    if (i % 6 === 0) {
      sessao = 'extra-s' + i;
      lista.push(agente({ id: sessao, nome: 'Sessão de carga ' + (i / 6 + 1), pastaCaminho, atividade: 'coordenar', t, pensaAte: t }));
    } else {
      lista.push(agente({ id: 'extra-' + i, nome: 'Ajudante de carga ' + i, tipo: 'subagente', pai: sessao, pastaCaminho,
        atividade, conector, conectorTipo: conector ? 'mcp' : null, t, pensaAte: t }));
    }
  }
  return lista;
}

export function estadoSimulado(cenario, t) {
  const agentes = (GERADORES[cenario] || cenario1)(t);
  if (COM_CODEX) agentes.push(...codex(t));
  if (COM_FILA) agentes.push(...filas(t));
  if (EXTRA > 0) agentes.push(...extras(t, EXTRA));
  else if (CARGA) agentes.push(...extras(t, quantosNaCarga(t)));
  const agora = Date.now();
  return { agentes, geradoEm: agora, provedores: { codex: COM_CODEX }, limites: limitesSimulados(agora, t), dono: null };
}
