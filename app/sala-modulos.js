// Salas novas como módulos da Estação (F1-SALAS-E-VIDA, 03/10): dados, vida e cochilo.
//
// Liga as salas montadas por layout.js (app/sala-*.js, módulos de estacao.js) às rotas
// do servidor e ao laço de desenho do main.js:
// - iniciarSalas(): lê /api/servidores, /api/portaria, /api/despacho, /api/missao,
//   /api/memoria e /api/oficina, cada uma no seu ritmo, só com a aba visível (aba
//   oculta: nada é lido nem roda). Guarda em E.salasDados { servidores, portaria,
//   despacho, missao, memoria, oficina }, que estacao.js usa para acoplar a Missão, a
//   Oficina e a Biblioteca e agentes.js usa para mandar astronautas a elas.
//   Em ?simular, missão, oficina e memória são de ensaio, feitas com os agentes simulados.
// - animarSalas(dt): a cada quadro desenhado. Passa o dado novo a cada sala, anima as
//   salas (NPCs, quadros), diz à Oficina quem está em cada banquinho e decide o cochilo.
//   Devolve true se algum NPC andou (a sombra acompanha, no máximo 8 vezes por segundo).
// - npcsAcordados(): há NPC acordado (ou sala animando um quadro): main.js mantém o
//   regime 'npc' (20 quadros por segundo). Todos cochilando: a estação vazia volta a
//   desenhar 0 quadros por segundo.
// COCHILO: sem nenhum astronauta trabalhando (atividade diferente de descansar) há mais
// de 1 min, todos os NPCs (das salas novas e os operadores das salas de controle) vão
// sentar e param. Quando alguém começa a trabalhar, levantam e voltam à rotina.

import { E } from './estado.js';
import { modulosSalaNova, salasDeControle } from './estacao.js';
import { registrarNpc, removerNpc } from './sala-corpos.js';
import { dadosExemplo as missaoExemplo } from './sala-missao.js';

const ROTAS = {
  servidores: ['/api/servidores', 5000], portaria: ['/api/portaria', 15000], despacho: ['/api/despacho', 10000],
  missao: ['/api/missao', 4000], memoria: ['/api/memoria', 3000], oficina: ['/api/oficina', 3000],
};
const DADO_DO_TIPO = { servidores: 'servidores', portaria: 'portaria', despacho: 'despacho', missao: 'missao', biblioteca: 'memoria', oficina: 'oficina' };
const COCHILO_MS = 60 * 1000;
const SOMBRA_NPC_MS = 125;

E.salasDados ??= {};
const aplicado = new WeakMap();      // sala -> objeto de dados já passado a ela
const operadores = new Map();        // grupo do operador -> corpo registrado
let tempo = 0;                       // relógio das salas (s): só anda quando há quadro
let semTrabalhoDesde = null, dormir = false, ultimaSombra = 0;

const parametros = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const SIMULANDO = parametros.has('simular');
const VELOCIDADE = Number(parametros.get('x')) > 0 ? Number(parametros.get('x')) : 1;
const inicio = Date.now();

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------
let iniciado = false;
export function iniciarSalas() {
  if (iniciado || typeof fetch === 'undefined' || typeof document === 'undefined' || !document.addEventListener) return;
  iniciado = true;
  // rotas ainda sem a primeira resposta (estacao.js guarda a vaga dos servidores crescerem
  // enquanto a primeira leitura de /api/servidores não chega)
  E.salasAguardando = new Set(Object.keys(ROTAS));
  for (const [chave, [rota, ms]] of Object.entries(ROTAS)) {
    const ler = async () => {
      if (!document.hidden) {
        try {
          const r = await fetch(rota, { cache: 'no-store' });
          if (r.ok) { E.salasDados[chave] = r.ok ? await r.json() : null; E.sujo = true; }
        } catch { /* sem a rota (servidor antigo) ou sem conexão: a sala fica como está */ }
        E.salasAguardando.delete(chave);
        if (SIMULANDO) simular(chave);
      }
      setTimeout(ler, document.hidden ? Math.max(ms, 10000) : ms);
    };
    ler();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) E.sujo = true; });
}

// Ensaio (?simular): missão em ciclos de 4 min (2,5 com uma missão em andamento), um
// agente na oficina por 45 s a cada 90 s e um consultando a memória por 25 s a cada 50 s
function simular(chave) {
  const t = (Date.now() - inicio) / 1000 * VELOCIDADE;
  const agentes = (E.dados?.agentes || []).filter(d => d.tipo === 'sessao' && d.atividade !== 'esperar' && !d.pendencia);
  if (chave === 'missao') E.salasDados.missao = t % 240 < 150 ? missaoExemplo('uma') : { geradoEm: Date.now(), missoes: [] };
  if (chave === 'oficina') {
    const d = agentes.length && t % 90 < 45 ? agentes[Math.floor(t / 90) % agentes.length] : null;
    E.salasDados.oficina = { geradoEm: Date.now(), naOficina: d ? [{ id: d.id, nome: d.nome, agencia: 'Claude Code', provedor: d.provedor,
      tipoAgente: 'sessao', pasta: d.pasta, tipo: 'conector', motivo: 'o conector pediu login de novo', desde: Date.now() - 120000, voltaEm: null }] : [] };
  }
  if (chave === 'memoria') {
    const base = E.salasDados.memoria || { prateleiras: [], fichario: { total: 0 } };
    const d = agentes.length > 1 && t % 50 < 25 ? agentes[(Math.floor(t / 50) + 1) % agentes.length] : null;
    const areas = ['projetos', 'skills', 'preferencias', 'indice'];
    const area = areas[Math.floor(t / 50) % areas.length];
    E.salasDados.memoria = { ...base, atividadeAgora: d ? [{ quando: Date.now() - 4000, agenteId: d.id, agente: d.nome, acao: 'consultar', area, titulo: 'Exemplo de consulta', nivel: 1 }] : [] };
  }
}

// ---------------------------------------------------------------------------
// Quadro a quadro
// ---------------------------------------------------------------------------
function alguemTrabalhando() {
  for (const a of E.agentes.values()) {
    if (a.saindo || a.alvo === 'fora' || a.aguardandoEntrada) continue;
    if (a.atividade && a.atividade !== 'descansar') return true;
  }
  return false;
}

function atualizarCochilo() {
  const agora = Date.now();
  if (alguemTrabalhando()) { semTrabalhoDesde = null; dormir = false; }
  else {
    semTrabalhoDesde ??= agora;
    if (agora - semTrabalhoDesde > COCHILO_MS) dormir = true;
  }
}

// Os operadores das salas de controle também são corpos sólidos (e cochilam junto)
function controlesComCorpo() {
  const salas = salasDeControle();
  const vivos = new Set();
  for (const s of salas) {
    const g = s.userData.operador?.grupo;
    if (!g) continue;
    vivos.add(g);
    if (!operadores.has(g)) operadores.set(g, registrarNpc(g, { sala: 'controle-' + s.userData.provedor }));
  }
  for (const [g, c] of operadores) if (!vivos.has(g)) { removerNpc(c); operadores.delete(g); }
  return salas;
}

export function animarSalas(dt) {
  dt = Math.min(0.1, Math.max(0, dt || 0));
  tempo += dt;
  atualizarCochilo();
  for (const s of controlesComCorpo()) s.userData.definirCochilo?.(dormir);
  let andou = false;
  E.oficinaConversando = null;
  for (const m of modulosSalaNova()) {
    const sala = m.salaNova;
    const d = E.salasDados?.[DADO_DO_TIPO[m.tipo]];
    if (d && aplicado.get(sala)?.d !== d) {
      // só redesenha quando o conteúdo mudou; com a estação cochilando, os números da
      // máquina (que mudam a cada leitura) entram no máximo 1 vez por minuto
      const chave = JSON.stringify(d, (k, v) => (k === 'geradoEm' ? undefined : v));
      const ant = aplicado.get(sala);
      const agora = Date.now();
      if (!ant || (ant.chave !== chave && !(dormir && m.tipo === 'servidores' && agora - ant.em < 60000))) {
        aplicado.set(sala, { d, chave, em: agora });
        sala.atualizar(d);
        E.sujo = true;
      } else if (ant.chave === chave) ant.d = d;
    }
    if (m.tipo === 'oficina') {
      sala.definirOcupantes?.(m.vagas.filter(v => v.ocupada).map(v => {
        const a = v.ocupada;
        return { id: a.id, assento: v.ordem, boneco: a.boneco, sentado: a.vaga === v && a.estado !== 'andando' && !a.girando && !!a.sentadoAntes };
      }));
      E.oficinaConversando = sala.conversando?.() ?? null;
    }
    sala.cochilar?.(dormir);
    const antes = sala.npcs?.map(b => b.position.x + b.position.z * 7) ?? [];
    sala.animar(tempo, dt);
    if (sala.npcs?.some((b, i) => Math.abs(b.position.x + b.position.z * 7 - antes[i]) > 1e-5)) andou = true;
  }
  if (andou && performance.now() - ultimaSombra > SOMBRA_NPC_MS) { ultimaSombra = performance.now(); E.sombraSuja = true; }
  return andou;
}

// Algum NPC acordado (ou sala animando): a cena precisa de quadros
export function npcsAcordados() {
  for (const s of salasDeControle()) if (!s.userData.dormindo?.()) return true;
  for (const m of modulosSalaNova()) {
    const sala = m.salaNova;
    if (m.estado !== 'pronto') return true;
    if (!sala.dormindo || !sala.dormindo()) return true;
    if (sala.animando?.() || sala.emCerimonia) return true;
  }
  return false;
}

// Para conferência (console e testes)
export function estadoDasSalas() {
  return {
    dormir, semTrabalhoDesde,
    salas: modulosSalaNova().map(m => ({ tipo: m.tipo, lado: m.lado, vaga: m.vaga, estado: m.estado, dormindo: !!m.salaNova.dormindo?.() })),
    controles: salasDeControle().map(s => ({ provedor: s.userData.provedor, dormindo: !!s.userData.dormindo?.() })),
  };
}
