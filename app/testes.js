// Ferramentas de conferência, usadas pelo console do navegador:
// - ?teste=caminhos roda testarCaminhos() logo depois da construção;
// - window.__testarCaminhos() roda de novo a qualquer momento;
// - ?teste=multidao roda testarMultidao() (fila indiana e corpo sólido: 50
//   astronautas trocando de sala por 60 s e 10 descansando juntos por 3 min;
//   &agentes=, &segundos= e &semente= mudam o ensaio);
//   o resultado vai para window.__testeMultidao. No terminal:
//   node app/teste-multidao.mjs (mesma função, com DOM e relógio de teste);
// - ?teste=estacao roda testarEstacao() (estação elástica: o ?simular=10 acelerado
//   &x=10, depois a estação esvaziando, cheia e 30 entradas e saídas; bateria de
//   caminhos em cada configuração estável de módulos). Resultado em
//   window.__testeEstacao. No terminal: node app/teste-estacao.mjs;
// - window.__metricas() devolve custo de desenho e quadros por segundo;
// - window.__estacao é o estado compartilhado (E), para depuração.

import { E } from './estado.js';
import * as Ag from './agentes.js';
import * as Est from './estacao.js';
import { atualizarTweens } from './tween.js';
import { estadoSimulado } from './fonte.js';
import { animarSalas } from './sala-modulos.js';
import { corposNpc } from './sala-corpos.js';

const { pontoDaPorta, acessoDaVaga } = Ag;

const PASSO_AMOSTRA = 0.05;   // metros entre as amostras de cada trecho

// Primeiro ponto do trecho que passa por célula bloqueada (ou fora do mapa), ou null
function trechoBloqueado(mapa, a, b) {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const passos = Math.max(1, Math.ceil(dist / PASSO_AMOSTRA));
  for (let s = 0; s <= passos; s++) {
    const x = a.x + (b.x - a.x) * s / passos, z = a.z + (b.z - a.z) * s / passos;
    const [i, j] = mapa.celula(x, z);
    if (!mapa.dentro(i, j) || mapa.bloq[j * mapa.nx + i]) return { x: +x.toFixed(2), z: +z.toFixed(2) };
  }
  return null;
}

// Confere um caminho. O caminho começa na célula livre mais próxima da origem e
// termina no destino exato; quando o destino é uma vaga (cadeira, sofá), o último
// trecho entra de propósito na área bloqueada da mobília e não é conferido.
function conferir(mapa, de, para, destinoEhVaga) {
  let aviso = false;
  const avisoOriginal = console.warn;
  console.warn = () => { aviso = true; };
  let pts;
  try { pts = mapa.caminho(de, para); } finally { console.warn = avisoOriginal; }
  if (!pts || pts.length < 2 || aviso) return 'sem caminho';
  const ultimo = destinoEhVaga ? pts.length - 2 : pts.length - 1;
  for (let k = 0; k < ultimo; k++) {
    const ponto = trechoBloqueado(mapa, pts[k], pts[k + 1]);
    if (ponto) return `trecho ${k} passa por célula bloqueada em (${ponto.x}, ${ponto.z})`;
  }
  return null;
}

// Todas as vagas de todas as salas (mesas das ilhas, sofás, lugar em pé) contra
// todas as outras, nos dois sentidos, e cada vaga de e para a porta. As vagas vêm
// de window.__estacao.vagas() (estacao.js, posição de mundo pelo módulo); sem ela,
// de E.salas. { silencioso: true } não escreve tabela no console (teste da estação).
export function testarCaminhos({ silencioso = false } = {}) {
  const mapa = E.mapa;
  if (!mapa) throw new Error('a planta ainda não foi construída');
  const daEstacao = (typeof window !== 'undefined' && window.__estacao?.vagas) || E.vagas;
  let vagas = typeof daEstacao === 'function' ? daEstacao().filter(v => v.pos) : null;
  if (!vagas) {
    vagas = [];
    for (const [idSala, s] of Object.entries(E.salas)) s.vagas.forEach((v, n) => vagas.push({ nome: `${idSala}#${n}`, pos: v.pos }));
  }
  // lugares das filas da sala do dono e da revisão (rodada 6): também de e para a porta e as vagas
  const filas = Ag.lugaresDasFilas?.() || {};
  for (const [id, lista] of Object.entries(filas)) lista.forEach((l, n) => vagas.push({ nome: `${id}#fila${n}`, pos: l.pos, pose: 'em-pe' }));
  const porta = pontoDaPorta();
  let total = 0, falhas = 0;
  const exemplos = [];
  const registrar = (de, para, motivo) => {
    total++;
    if (!motivo) return;
    falhas++;
    if (exemplos.length < 20) exemplos.push({ de, para, motivo });
  };
  for (let i = 0; i < vagas.length; i++) {
    for (let j = i + 1; j < vagas.length; j++) {
      // A* não é simétrico: cada par não ordenado é testado nos dois sentidos
      registrar(vagas[i].nome, vagas[j].nome, conferir(mapa, vagas[i].pos, vagas[j].pos, true));
      registrar(vagas[j].nome, vagas[i].nome, conferir(mapa, vagas[j].pos, vagas[i].pos, true));
    }
    registrar('porta', vagas[i].nome, conferir(mapa, porta, vagas[i].pos, true));
    registrar(vagas[i].nome, 'porta', conferir(mapa, vagas[i].pos, porta, false));
  }
  // A rota termina na célula livre mais próxima do assento e o último trecho não é
  // conferido; por isso cada assento também precisa de um acesso (lugar em pé de
  // onde ele senta) a até 1,25 m e dentro do próprio módulo (integração R3).
  let acessosRuins = 0;
  for (const [idSala, s] of Object.entries(E.salas)) s.vagas.forEach((v, n) => {
    if (v.pose !== 'sentado' && !v.encostado) return;   // assentos e lugares encostados (fliperama)
    const ac = acessoDaVaga(v);
    const d = ac ? Math.hypot(ac.x - v.pos.x, ac.z - v.pos.z) : Infinity;
    const m = v.modulo;
    const dentro = !m || !ac || (ac.x > m.x0 && ac.x < m.x1 && (m.lado === 'n' ? ac.z < 0 : ac.z > 0));
    const motivo = !ac ? 'sem acesso' : d > 1.25 ? `acesso a ${d.toFixed(2)} m` : !dentro ? 'acesso fora do módulo' : null;
    if (motivo) acessosRuins++;
    registrar(`${idSala}#${n}`, 'acesso', motivo);
  });
  const resultado = { total, falhas, exemplos, vagas: vagas.length, acessosRuins };
  if (silencioso) return resultado;
  if (typeof window !== 'undefined') window.__testeCaminhos = resultado;
  console.table({ total, falhas, vagas: vagas.length });
  if (exemplos.length) console.table(exemplos);
  return resultado;
}

// ---------------------------------------------------------------------------
// Métricas de desenho e contador de quadros
// ---------------------------------------------------------------------------
let quadros = 0, inicioJanela = 0, quadrosUltimoSegundo = 0;

// Chamada uma vez por quadro pelo laço principal
export function contarQuadro(agoraMs) {
  quadros++;
  if (agoraMs - inicioJanela >= 1000) {
    quadrosUltimoSegundo = quadros;
    quadros = 0;
    inicioJanela = agoraMs;
  }
}

export function iniciarDepuracao() {
  window.__estacao = E;
  window.__testarCaminhos = testarCaminhos;
  window.__metricas = () => ({
    chamadas: E.renderer.info.render.calls,
    triangulos: E.renderer.info.render.triangles,
    geometrias: E.renderer.info.memory.geometries,
    texturas: E.renderer.info.memory.textures,
    quadrosUltimoSegundo,
  });
}

// Depois da construção: roda os testes pedidos na URL (?teste=caminhos, ?teste=multidao)
export function aposConstruir() {
  const teste = new URLSearchParams(location.search).get('teste');
  if (teste === 'caminhos') testarCaminhos();
  if (teste === 'multidao') {
    // a leitura do servidor e a animação normal dos agentes param enquanto o teste
    // dirige a cena (main.js olha E.teste); o desenho continua, para dar para ver
    E.teste = 'multidao';
    const q = new URLSearchParams(location.search), n = k => (Number(q.get(k)) > 0 ? Number(q.get(k)) : undefined);
    testarMultidao({ agentes: n('agentes'), segundos: n('segundos'), semente: n('semente'), pausa: () => new Promise(r => setTimeout(r, 0)) })
      .catch(erro => console.error('teste da multidão falhou', erro));
  }
  if (teste === 'estacao') {
    E.teste = 'estacao';
    const q = new URLSearchParams(location.search), n = k => (Number(q.get(k)) > 0 ? Number(q.get(k)) : undefined);
    testarEstacao({ x: n('x'), pausa: () => new Promise(r => setTimeout(r, 0)) })
      .catch(erro => console.error('teste da estação falhou', erro));
  }
}

// ---------------------------------------------------------------------------
// Teste da multidão (requisito obrigatório de 03/10: fila indiana e corpo sólido)
// ---------------------------------------------------------------------------
// Dirige a cena de verdade (agentes.js, estacao.js, navegacao.js) com um relógio
// próprio, mais rápido que o real, e confere em todo quadro:
// - sobreposição: dois astronautas com os centros a menos de 0,85 m (também
//   conta abaixo de 0,6, dois raios);
// - invasão: quem anda ou está em pé com o corpo (raio 0,3) dentro de parede,
//   divisória ou móvel; no trecho entre o acesso e o assento só os móveis do
//   próprio lugar (banqueta, mesa, sofá) podem encostar;
// - preso: andando sem sair de um raio de 0,1 m por mais de 10 s;
// - lado a lado: dois andando no mesmo sentido (até 30°) quase na mesma altura
//   ('estrito': menos de 0,3 na frente e 0,8 de lado; 'largo': menos de 0,7 na
//   frente e de 0,45 a 1,6 de lado);
// - porta: dois na passagem lado a lado ou em sentidos opostos (portaComDois);
//   um atrás do outro no mesmo sentido é fila indiana (portaEmFila, só contado);
// - contramão no corredor (mão direita);
// - de cara para a parede (F2, correção obrigatória de 03/10): astronauta parado (em
//   pé, ou andando mas parado na fila ou na porta há mais de 1 s) com a frente a menos
//   de 0,8 m de parede, divisória ou borda, sem móvel de trabalho na frente antes dela
//   (Est.paredeNaFrente), por 1 s seguido ou mais, conta uma violação por episódio.
//   Quem está sentado não conta (a mesa, o sofá ou o assento estão na frente dele).
// Fase 1: 'agentes' astronautas trocando de sala por 'segundos'.
// Fase 2: 'descansando' astronautas no descanso juntos por 'segundosDescanso'.
// Fase 3 (F1): 'salas', 12 astronautas indo e voltando da oficina e da biblioteca, com
// a missão acoplada, por 'segundosSalas'.
// Os NPCs das salas (técnico, porteiro, despachante, coordenador, bibliotecário,
// mecânico e operadores) andam junto (animarSalas) e entram na conta do corpo sólido:
// nenhum astronauta a menos de 0,85 de um NPC, nem NPC de NPC (npcSobreposicoes).
// Opções de relógio (Node): aoAvancar(ms) a cada quadro, para timers falsos.
// SOBREPOSICAO (03/10, "o capacete é o corpo"): dois centros a menos de 0,85 contam
// como sobreposição (o capacete tem 0,84 m); RAIO_TESTE é a folga contra parede e móvel
const RAIO_TESTE = 0.3, SOBREPOSICAO = 0.85 - 1e-3, PRESO_MS = 10000;

export async function testarMultidao({ agentes = 50, segundos = 60, semente = 1, descansando = 10, segundosDescanso = 180,
  segundosSalas = 120, dt = 1 / 60, aoAvancar = null, pausa = null, quadrosPorPausa = 60 } = {}) {
  if (!E.mapa || !E.construido) throw new Error('a planta ainda não foi construída');
  const inicioReal = typeof performance !== 'undefined' ? performance.now() : Date.now();
  // o relógio do teste começa à frente do real e anda mais rápido (agentes.js usa o maior)
  const relogioTeste = { ms: inicioReal + 1000 };
  const limpar = () => { for (const a of [...E.agentes.values()]) Ag.removerAgente(a); };
  limpar();
  const salasAntes = E.salasDados;
  E.salasDados = {};
  const fases = [];
  try {
    Ag.definirLotacao(agentes);
    fases.push(await rodarFase('multidao', { segundos, dados: geradorMultidao(agentes, semente) }));
    limpar();
    Ag.definirLotacao(Math.max(10, descansando));
    if (descansando > 0) fases.push(await rodarFase('descanso', { segundos: segundosDescanso + 25, dados: geradorDescanso(descansando), medirDescanso: true }));
    limpar();
    if (segundosSalas > 0) {
      Ag.definirLotacao(12);
      fases.push(await rodarFase('salas', { segundos: segundosSalas, dados: geradorSalas(12, semente) }));
    }
  } finally {
    Ag.definirLotacao();
    limpar();
    E.salasDados = salasAntes;
  }
  const resultado = { passou: fases.every(f => f.passou), fases, tempoReal_s: +(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - inicioReal) / 1000).toFixed(1) };
  if (typeof window !== 'undefined') window.__testeMultidao = resultado;
  console.table?.(fases.map(f => ({ fase: f.fase, agentes: f.maxNaCena, segundos: f.segundos, sobreposicoes: f.sobreposicoes, menorDistancia: f.menorDistancia,
    invasoes: f.invasoes, menorFolga: f.menorFolga, presos: f.presos, maiorParadaAndando_s: f.maiorParadaAndando_s, ladoALadoEstrito: f.ladoALadoEstrito,
    ladoALadoLargo: f.ladoALadoLargo, portaComDois: f.portaComDois, deCaraParaParede: f.deCaraParaParede, resgates: f.resgates, passou: f.passou })));
  return resultado;

  async function rodarFase(fase, { segundos: dur, dados, medirDescanso = false }) {
    const m = E.mapa;
    const resgatesAntes = Ag.estatisticasFila().resgates;
    const r = { fase, segundos: dur, quadros: 0, maxNaCena: 0, sobreposicoes: 0, abaixoDeDoisRaios: 0, menorDistancia: Infinity, exemplosSobreposicao: [],
      invasoes: 0, menorFolga: Infinity, exemplosInvasao: [], invasoesAssento: 0, presos: 0, maiorParadaAndando_s: 0, exemplosPreso: [],
      ladoALadoEstrito: 0, ladoALadoLargo: 0, paresLadoALado: 0, exemplosLadoALado: [], portaComDois: 0, portaEmFila: 0, contramao: 0, noCorredor: 0,
      npcs: 0, npcSobreposicoes: 0, menorDistanciaNpc: Infinity, exemplosNpc: [], naOficina: 0, naBiblioteca: 0, salasNovas: [],
      menorDistanciaDescansando: Infinity, quadrosDescansando: 0, maxDescansando: 0 };
    const anterior = new Map(), marco = new Map(), paresLargo = new Set(), presosVistos = new Set();
    const deCaraDesde = new Map(), deCaraContado = new Set();
    r.deCaraParaParede = 0; r.exemplosParede = [];
    let t = 0, proxLeitura = 0;
    while (t < dur) {
      if (t >= proxLeitura) {
        const d = dados(t);
        E.salasDados = d.salasDados || {};
        Ag.aplicarEstado(d);
        proxLeitura += 1.5;
      }
      relogioTeste.ms += dt * 1000;
      aoAvancar?.(relogioTeste.ms);
      Ag.animarAgentes(dt, relogioTeste.ms);
      atualizarTweens(relogioTeste.ms);
      animarSalas(dt);   // os NPCs andam junto
      t += dt;
      r.quadros++;
      medirQuadro(t);
      if (pausa && r.quadros % quadrosPorPausa === 0) { E.sujo = true; await pausa(); }
    }
    const fila = Ag.estatisticasFila();
    r.resgates = fila.resgates - resgatesAntes;
    r.exemplosResgate = r.resgates ? fila.ultimosResgates.slice(-Math.min(8, r.resgates)) : [];
    r.menorDistancia = +r.menorDistancia.toFixed(3);
    r.menorFolga = +r.menorFolga.toFixed(3);
    r.maiorParadaAndando_s = +r.maiorParadaAndando_s.toFixed(1);
    r.contramao = `${r.contramao}/${r.noCorredor}`;
    delete r.noCorredor;
    if (medirDescanso) r.menorDistanciaDescansando = +r.menorDistanciaDescansando.toFixed(3);
    else { delete r.menorDistanciaDescansando; delete r.quadrosDescansando; delete r.maxDescansando; }
    r.menorDistanciaNpc = Number.isFinite(r.menorDistanciaNpc) ? +r.menorDistanciaNpc.toFixed(3) : null;
    r.salasNovas = Est.estatisticasEstacao().modulos.filter(m => ['missao', 'oficina', 'biblioteca', 'servidores', 'portaria', 'despacho'].includes(m.tipo)).map(m => m.tipo + '@' + m.lado + m.vaga);
    r.passou = r.sobreposicoes === 0 && r.invasoes === 0 && r.invasoesAssento === 0 && r.presos === 0 && r.npcSobreposicoes === 0
      && r.deCaraParaParede === 0;
    return r;

    function medirQuadro(t) {
      const corpos = [...E.agentes.values()].filter(a => !a.aguardandoEntrada && a.boneco.visible && a.fade > 0.15);
      r.maxNaCena = Math.max(r.maxNaCena, corpos.length);
      // 1) corpo contra corpo
      for (let i = 0; i < corpos.length; i++) for (let j = i + 1; j < corpos.length; j++) {
        const p = corpos[i].boneco.position, q = corpos[j].boneco.position;
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < r.menorDistancia) r.menorDistancia = d;
        if (d < 2 * RAIO_TESTE - 1e-3) r.abaixoDeDoisRaios++;
        if (d < SOBREPOSICAO) {
          r.sobreposicoes++;
          if (r.exemplosSobreposicao.length < 8) r.exemplosSobreposicao.push({ t: +t.toFixed(2), a: corpos[i].id, b: corpos[j].id, d: +d.toFixed(3), x: +p.x.toFixed(2), z: +p.z.toFixed(2) });
        }
      }
      // 1b) NPCs: astronauta contra NPC e NPC contra NPC (corpo sólido)
      const npcs = corposNpc();
      r.npcs = Math.max(r.npcs, npcs.length);
      const pontosNpc = [...corpos.map(a => ({ id: a.id, x: a.boneco.position.x, z: a.boneco.position.z, npc: false })),
        ...npcs.map((n, k) => ({ id: 'npc:' + (n.corpo.sala || k), x: n.x, z: n.z, npc: true }))];
      for (let i = 0; i < pontosNpc.length; i++) for (let j = i + 1; j < pontosNpc.length; j++) {
        const p = pontosNpc[i], q = pontosNpc[j];
        if (!p.npc && !q.npc) continue;
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < r.menorDistanciaNpc) r.menorDistanciaNpc = d;
        if (d < SOBREPOSICAO) {
          r.npcSobreposicoes++;
          if (r.exemplosNpc.length < 8) r.exemplosNpc.push({ t: +t.toFixed(2), a: p.id, b: q.id, d: +d.toFixed(3), x: +p.x.toFixed(2), z: +p.z.toFixed(2) });
        }
      }
      for (const a of corpos) {
        if (a.estado === 'andando') continue;
        if (a.vaga?.sala === 'oficina') r.naOficina++;
        if (a.vaga?.sala === 'biblioteca') r.naBiblioteca++;
      }
      // 2) corpo contra parede, divisória e móvel (sentado fica de propósito no assento)
      for (const a of corpos) {
        const p = a.boneco.position;
        if (a.estado !== 'andando' && (a.vaga?.pose === 'sentado' || a.sentadoAntes || a.girando)) continue;
        // no trecho do assento (andando, ou parado sumindo ali mesmo: ajudante que vai
        // embora sem passar pelo descanso some no lugar) só conta o que não é a própria mesa
        if (a.trechoAssento && (a.estado === 'andando' || a.saindo)) {
          const v = a.rota[0]?.saidaAssento ? a.saindoDe : a.vaga;
          if (!v || !m.obstaculos) continue;
          const dist = (o, x, z) => Math.hypot(Math.max(o.xa - x, 0, x - o.xb), Math.max(o.za - z, 0, z - o.zb));
          let menor = Infinity;
          for (const o of m.obstaculos) if (dist(o, v.pos.x, v.pos.z) >= 0.35) menor = Math.min(menor, dist(o, p.x, p.z));
          if (menor < RAIO_TESTE - 1e-6) r.invasoesAssento++;
          continue;
        }
        const folga = m.folgaEm(p.x, p.z);
        if (folga < r.menorFolga) r.menorFolga = folga;
        if (folga < RAIO_TESTE - 1e-6) {
          r.invasoes++;
          if (r.exemplosInvasao.length < 8) r.exemplosInvasao.push({ t: +t.toFixed(2), id: a.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2), folga: +folga.toFixed(3), estado: a.estado });
        }
      }
      // 3) preso: andando sem sair de 0,1 m por mais de 10 s
      for (const a of corpos) {
        const p = a.boneco.position;
        if (a.estado !== 'andando' || a.saindo) { marco.delete(a.id); continue; }
        let mk = marco.get(a.id);
        if (!mk || Math.hypot(p.x - mk.x, p.z - mk.z) > 0.1) { mk = { x: p.x, z: p.z, ms: relogioTeste.ms }; marco.set(a.id, mk); }
        const parado = relogioTeste.ms - mk.ms;
        r.maiorParadaAndando_s = Math.max(r.maiorParadaAndando_s, parado / 1000);
        if (parado > PRESO_MS && !presosVistos.has(a.id + '@' + mk.ms)) {
          presosVistos.add(a.id + '@' + mk.ms);
          r.presos++;
          if (r.exemplosPreso.length < 8) r.exemplosPreso.push({ t: +t.toFixed(2), id: a.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2), motivo: a.motivo, destino: a.salaDestino });
        }
      }
      // 4) lado a lado: os dois andando no mesmo sentido, quase na mesma altura
      const mexeu = new Map();
      for (const a of corpos) {
        const p = a.boneco.position, q = anterior.get(a.id);
        if (a.estado === 'andando' && q) {
          const dx = p.x - q.x, dz = p.z - q.z, l = Math.hypot(dx, dz);
          if (l > 1e-4) mexeu.set(a, [dx / l, dz / l]);
        }
      }
      anterior.clear();
      for (const a of corpos) anterior.set(a.id, { x: a.boneco.position.x, z: a.boneco.position.z });
      const mov = [...mexeu.keys()];
      for (let i = 0; i < mov.length; i++) for (let j = i + 1; j < mov.length; j++) {
        const [ax, az] = mexeu.get(mov[i]), [bx, bz] = mexeu.get(mov[j]);
        if (ax * bx + az * bz < 0.866) continue;
        let mx = ax + bx, mz = az + bz;
        const ml = Math.hypot(mx, mz); mx /= ml; mz /= ml;
        const pa = mov[i].boneco.position, pb = mov[j].boneco.position;
        const rx = pb.x - pa.x, rz = pb.z - pa.z, fr = Math.abs(rx * mx + rz * mz), la = Math.abs(rx * mz - rz * mx);
        if (fr < 0.3 && la < 0.8) r.ladoALadoEstrito++;
        if (fr < 0.7 && la >= 0.45 && la < 1.6) {   // com menos de 0,45 de lado é fila (um atrás do outro)
          r.ladoALadoLargo++;
          paresLargo.add(mov[i].id + '|' + mov[j].id);
          if (r.exemplosLadoALado.length < 8) r.exemplosLadoALado.push({ t: +t.toFixed(2), a: mov[i].id, b: mov[j].id, x: +pa.x.toFixed(2), z: +pa.z.toFixed(2), frente: +fr.toFixed(2), lado: +la.toFixed(2) });
        }
      }
      r.paresLadoALado = paresLargo.size;
      // 5) porta: dois na passagem ao mesmo tempo lado a lado ou em sentidos opostos
      //    (um atrás do outro no mesmo sentido, a um passo, é a fila indiana e só é contado)
      if (m.portaEm) {
        const naPorta = new Map();
        for (const a of corpos) {
          const po = m.portaEm(a.boneco.position.x, a.boneco.position.z, 0.45);
          if (po) { if (!naPorta.has(po)) naPorta.set(po, []); naPorta.get(po).push(a); }
        }
        for (const [po, lista] of naPorta) for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
          const pa = lista[i].boneco.position, pb = lista[j].boneco.position;
          const lado = po.eixo === 'z' ? Math.abs(pa.x - pb.x) : Math.abs(pa.z - pb.z);
          const da = mexeu.get(lista[i]), db = mexeu.get(lista[j]);
          const opostos = da && db && da[0] * db[0] + da[1] * db[1] < 0;
          if (lado >= 0.45 || opostos) r.portaComDois++;
          else r.portaEmFila++;
        }
      }
      // 6) mão direita no corredor (quem anda ao longo de x, fora das portas)
      for (const [a, [dx]] of mexeu) {
        const p = a.boneco.position;
        const c = m.corredorEm?.(p.x, p.z);
        if (!c || Math.abs(dx) < 0.9 || m.portaEm?.(p.x, p.z, 0.9)) continue;
        r.noCorredor++;
        if ((p.z - c.zc) * Math.sign(dx) < -0.05) r.contramao++;
      }
      // 8) ninguém parado de cara para a parede (1 s seguido conta um episódio)
      for (const a of corpos) {
        const sentado = a.estado !== 'andando' && (a.vaga?.pose === 'sentado' || a.sentadoAntes || a.girando);
        const paradoAndando = a.estado === 'andando' && a.parouDesde && relogioTeste.ms - a.parouDesde > 1000;
        const quieto = a.estado !== 'andando' && !a.saindo && !a.girando && a.fade > 0.5;
        if (sentado || !(quieto || paradoAndando) || a.resgatando) { deCaraDesde.delete(a.id); continue; }
        const p = a.boneco.position;
        if (!Est.paredeNaFrente?.(p.x, p.z, a.boneco.rotation.y, 0.8)) { deCaraDesde.delete(a.id); continue; }
        if (!deCaraDesde.has(a.id)) deCaraDesde.set(a.id, relogioTeste.ms);
        const chave = a.id + '@' + deCaraDesde.get(a.id);
        if (relogioTeste.ms - deCaraDesde.get(a.id) >= 1000 && !deCaraContado.has(chave)) {
          deCaraContado.add(chave);
          r.deCaraParaParede++;
          if (r.exemplosParede.length < 8) r.exemplosParede.push({ t: +t.toFixed(2), id: a.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2),
            olhar: +a.boneco.rotation.y.toFixed(2), estado: a.estado, motivo: a.motivo, vaga: a.vaga ? (a.vaga.fila ? 'fila' : a.vaga.extra ? 'extra' : a.vaga.ponto ? 'ponto' : a.vaga.conversa ? 'conversa' : a.vaga.cantoObj ? 'canto' : a.vaga.pose) : null,
            sala: a.vaga?.sala ?? a.alvo });
        }
      }
      // 7) descanso: ninguém em cima de ninguém
      if (medirDescanso) {
        const quietos = corpos.filter(a => a.sala === 'descanso' && a.alvo === 'descanso' && a.estado !== 'andando');
        r.maxDescansando = Math.max(r.maxDescansando, quietos.length);
        if (quietos.length) r.quadrosDescansando++;
        for (let i = 0; i < quietos.length; i++) for (let j = i + 1; j < quietos.length; j++) {
          const p = quietos[i].boneco.position, q = quietos[j].boneco.position;
          r.menorDistanciaDescansando = Math.min(r.menorDistanciaDescansando, Math.hypot(p.x - q.x, p.z - q.z));
        }
      }
    }
  }
}

// Dados de /api/servidores para o teste da sala modular: n servidores seus (os 2
// primeiros são A Estação) com memória de 20, 120 e 400 MB (racks pequeno, médio e
// grande) e um app do Mac
function servidoresFalsos(n) {
  return { geradoEm: Date.now(), maquina: { nome: 'teste', cpu: 20, cpuPico: 30, gpu: 10, memoria: { pct: 50, usadoGB: 8, totalGB: 16 },
    disco: { pct: 40, livreGB: 100, totalGB: 500 }, nucleos: 8 },
    servidores: [...Array.from({ length: n }, (_, i) => ({ pid: 1000 + i, categoria: i < 2 ? 'estacao' : 'projeto', nome: i < 2 ? 'A Estação ' + i : 'Projeto ' + i,
      portas: [5000 + i], soLocal: true, cpu: 1, memoriaMB: [20, 120, 400][i % 3], ligadoHaS: 600 })),
    { pid: 9, categoria: 'app', nome: 'App do Mac', portas: [7000], soLocal: true, cpu: 0, memoriaMB: 10, ligadoHaS: 600 }] };
}

// Gerador pseudoaleatório estável (o teste dá sempre o mesmo resultado)
function sorteador(semente) {
  let s = (semente * 9301 + 49297) % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

// 'n' astronautas (sessões e subagentes em 4 pastas) trocando de atividade a cada
// 6 a 22 s: mesa, pesquisa, MCP, API, descanso, espera; a cada 25 s, 3 vão embora
// e 3 chegam
function geradorMultidao(n, semente) {
  const rnd = sorteador(semente);
  const PASTAS = ['/teste/site', '/teste/notas', '/teste/evento', '/teste/sites'];
  const CONECTORES = [['Figma', 'mcp'], ['Reportei Flux', 'mcp'], ['RD Station', 'api'], ['ChatGPT', 'api'], ['Notion', 'mcp']];
  const ATIVIDADES = ['editar', 'editar', 'pesquisar', 'conector', 'descansar', 'esperar', 'coordenar'];
  const vivos = [];
  let geracao = 0;
  const novo = i => {
    const sessoes = vivos.filter(v => v.tipo === 'sessao');
    const sub = i % 5 >= 3 && sessoes.length > 0;
    const pai = sub ? sessoes[Math.floor(rnd() * sessoes.length)] : null;
    return { id: 'multidao-' + geracao++, tipo: sub ? 'subagente' : 'sessao', pai: pai?.id || null,
      pasta: pai?.pasta || PASTAS[Math.floor(rnd() * PASTAS.length)], atividade: 'editar', conector: null, paradoDesde: null, troca: rnd() * 10 };
  };
  for (let i = 0; i < n; i++) vivos.push(novo(i));
  let ultimaRodada = 0;
  return t => {
    for (const v of vivos) {
      if (t < v.troca) continue;
      v.atividade = ATIVIDADES[Math.floor(rnd() * ATIVIDADES.length)];
      v.conector = v.atividade === 'conector' ? CONECTORES[Math.floor(rnd() * CONECTORES.length)] : null;
      v.paradoDesde = v.atividade === 'descansar' ? t - rnd() * 50 : null;
      v.troca = t + 6 + rnd() * 16;
    }
    if (Math.floor(t / 25) > ultimaRodada) {
      ultimaRodada = Math.floor(t / 25);
      for (let k = 0; k < 3; k++) { vivos.splice(Math.floor(rnd() * vivos.length), 1); vivos.push(novo(k)); }
      for (const v of vivos) if (v.pai && !vivos.some(o => o.id === v.pai)) { v.pai = null; v.tipo = 'sessao'; }
    }
    return { agentes: vivos.map(v => ({ id: v.id, nome: v.id, tipo: v.tipo, pai: v.pai, pasta: v.pasta.split('/').pop(), pastaCaminho: v.pasta,
      atividade: v.atividade, conector: v.conector?.[0] ?? null, conectorTipo: v.conector?.[1] ?? null, texto: v.atividade, pensamentos: [],
      paradoHaMs: v.paradoDesde != null ? (t - v.paradoDesde) * 1000 : undefined, provedor: 'anthropic' })) };
  };
}

// Fase das salas novas (F1): 'n' sessões numa pasta só; a cada 8 a 20 s cada uma muda
// entre mesa, oficina (travou), biblioteca (consultou memória ou skill) e descanso; a
// missão fica ativa o tempo todo (o módulo acopla e o coordenador anda junto)
function geradorSalas(n, semente) {
  const rnd = sorteador(semente + 17);
  const AREAS = ['preferencias', 'projetos', 'skills', 'regras', 'indice', 'codex'];
  const vivos = Array.from({ length: n }, (_, i) => ({ id: 'salas-' + i, atividade: 'editar', troca: 2 + rnd() * 8, area: AREAS[i % AREAS.length] }));
  return t => {
    for (const v of vivos) {
      if (t < v.troca) continue;
      const r = rnd();
      v.atividade = r < 0.3 ? 'oficina' : r < 0.65 ? 'biblioteca' : r < 0.9 ? 'editar' : 'descansar';
      v.area = AREAS[Math.floor(rnd() * AREAS.length)];
      v.desde = t;
      v.troca = t + 8 + rnd() * 12;
    }
    const agora = Date.now();
    const salasDados = {
      missao: { missoes: [{ id: 'wf_teste', nome: 'teste', ativa: true, fases: [], agentes: { total: 1, rodando: 1, concluidos: 0 } }] },
      oficina: { naOficina: vivos.filter(v => v.atividade === 'oficina').map(v => ({ id: v.id, nome: v.id, tipo: 'conector', motivo: 'teste', desde: agora })) },
      memoria: { prateleiras: [], fichario: { total: 0 }, atividadeAgora: vivos.filter(v => v.atividade === 'biblioteca').map(v => ({ quando: agora - 2000, agenteId: v.id, acao: 'consultar', area: v.area, titulo: 'teste', nivel: 1 })) },
    };
    return { salasDados, agentes: vivos.map(v => ({ id: v.id, nome: v.id, tipo: 'sessao', pai: null, pasta: 'Claude', pastaCaminho: '/teste/Claude',
      atividade: v.atividade === 'descansar' ? 'descansar' : 'editar', texto: '', pensamentos: [],
      paradoHaMs: v.atividade === 'descansar' ? (t - v.desde + 60) * 1000 : undefined, provedor: 'anthropic' })) };
  };
}

// 'n' sessões que entram, trabalham 15 s e depois ficam paradas: vão juntas ao
// descanso (já passaram do relógio de 60 s) e ficam lá até o fim
function geradorDescanso(n) {
  return t => ({ agentes: Array.from({ length: n }, (_, i) => ({ id: 'descanso-' + i, nome: 'descanso-' + i, tipo: 'sessao', pai: null,
    pasta: 'Claude', pastaCaminho: '/teste/Claude', atividade: t < 15 ? 'editar' : 'descansar', texto: '', pensamentos: [],
    paradoHaMs: t < 15 ? undefined : (t - 15 + 60) * 1000, provedor: 'anthropic' })) });
}

// ---------------------------------------------------------------------------
// Teste da estação elástica (rodada 4): caminhos em cada configuração estável
// ---------------------------------------------------------------------------
// Dirige a cena de verdade com um relógio próprio (como o teste da multidão), em
// quatro fases seguidas:
// - 'cenario10': o ?simular=10 acelerado (&x=10) por 4 min de cena;
// - 'vazio': 2 min sem ninguém, para os módulos desacoplarem um por um;
// - 'cheia' e 'cheia2' (F2): as vagas de módulo ocupadas de uma vez, com todas as
//   colunas de mesas das salas de pasta à mostra; na 'cheia2', a sala do Estúdio
//   fundida com dois módulos da pasta dele e uma sala de pasta de três módulos no sul;
//   cada uma seguida de uma fase vazia até voltar ao núcleo;
// - 'vaivem': 30 entradas e saídas em 3 levas de 10 (mesa, MCP e outra pasta),
//   contando geometrias, materiais e texturas vivas depois de cada leva.
// O relógio das folgas (estacao.js) anda x vezes mais rápido que a cena, como no
// ?simular com &x=. Em cada configuração estável de módulos (nada acoplando,
// desacoplando, na fila ou para desacoplar) roda testarCaminhos e guarda
// { configuracao, total, falhas }. Violações contadas em todo quadro:
// - desacoplouComOcupante: módulo que desacoplou com alguém dentro (estacao.js);
// - rotaCruzaObstaculo: rota de quem anda passando por célula bloqueada do mapa
//   atual (fora o trecho do assento);
// - sobreposicoes (< 0,85 m entre centros) e invasoes (corpo de quem anda ou está
//   em pé a menos de 0,3 de parede, divisória ou móvel);
// - ladoALado: o mesmo par andando no mesmo sentido quase na mesma altura (menos
//   de 0,3 na frente e 0,8 de lado) por 0,3 s seguidos ou mais, o que a fila indiana
//   proíbe (um quadro solto, quando dois se cruzam numa curva, não aparece na tela;
//   esses quadros vão para quadrosLadoALado, só como informação).
// Opções de relógio (Node): aoAvancar(ms) a cada quadro, para timers falsos.
export async function testarEstacao({ x = 10, segundosCenario = 240, segundosVazio = 120, segundosCheia = 150, levas = 3, porLeva = 10,
  dt = 1 / 60, aoAvancar = null, pausa = null, quadrosPorPausa = 60 } = {}) {
  if (!E.mapa || !E.construido) throw new Error('a planta ainda não foi construída');
  const agoraReal = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const inicioReal = agoraReal();
  const relogioTeste = { ms: inicioReal + 1000 };
  let tCena = 0;
  // as folgas (90 s e 180 s) andam no relógio da estação, x vezes mais rápido que a cena
  const baseEstacao = Est.relogioEstacao();
  Est.definirRelogioEstacao(() => baseEstacao + tCena * 1000 * x);
  const limpar = () => { for (const a of [...E.agentes.values()]) Ag.removerAgente(a); };
  limpar();

  const configuracoes = [];
  let compactacao = null;              // resultado da fase 'compacta' (F2)
  let servidores = null;               // resultado das fases 'servidores' (F2, sala modular)
  const testadas = new Map();          // assinatura -> registro (a mesma planta não é testada de novo)
  let estavelAntes = null;             // assinatura da última configuração estável vista
  const v = { desacoplouComOcupante: 0, rotaCruzaObstaculo: 0, sobreposicoes: 0, invasoes: 0, ladoALado: 0 };
  const exemplos = { rota: [], sobreposicao: [], invasao: [], ladoALado: [] };
  let menorDistancia = Infinity, menorFolga = Infinity, quadros = 0, maxModulos = 0, maxComprimento = 0, trechosConferidos = 0;
  const violacoesAntes = Est.estatisticasEstacao().violacoes;
  const resgatesAntes = Ag.estatisticasFila().resgates;
  const rotasRuins = new WeakSet();    // cada rota ruim conta uma vez só
  const anterior = new Map(), seguidosLado = new Map();
  let quadrosLadoALado = 0;
  const recursos = rastrearRecursos();
  const fases = [];
  try {
    await fase('cenario10', segundosCenario, t => estadoSimulado(10, t * x));
    await fase('vazio', segundosVazio, () => ({ agentes: [] }));
    if (segundosCheia > 0) {
      // F2: a ala técnica ocupa n0, n1 (portaria, despacho) e s3; o Estúdio, n2 e n3; as
      // salas novas com astronautas (oficina, biblioteca) e a missão só existem no norte.
      // Todas as colunas de mesas das salas de pasta à mostra (mostrarTodasAsColunas),
      // com uma sala de pasta de dois módulos fundidos no sul (s6 e s7, sem divisória).
      Est.mostrarTodasAsColunas(true);
      const lugares = [['ilha', 'n', 4], ['oficina', 'n', 5], ['biblioteca', 'n', 6], ['missao', 'n', 7],
        ['mcp', 's', 2], ['api', 's', 4], ['descanso', 's', 5], ['ilha', 's', 6], ['ilha', 's', 7]];
      const acoplados = lugares.map(([tipo, lado, vaga]) => Est.acoplarEm(tipo, lado, vaga, { pasta: tipo === 'ilha' ? '/exemplo/cheia-' + lado : undefined }));
      await fase('cheia', 25, () => ({ agentes: [] }), { acoplados: acoplados.filter(Boolean).length });
      Est.mostrarTodasAsColunas(false);
      await fase('cheia-esvazia', segundosCheia, () => ({ agentes: [] }));
      // a sala do Estúdio fundida com os dois módulos da mesma pasta (n4 e n5) e a
      // pesquisa extra ao lado; no sul, uma sala de pasta de três módulos (s4 a s6)
      Est.mostrarTodasAsColunas(true);
      Est.reservarEstudio('/exemplo/cheia-estudio');
      const lugares2 = [['ilha', 'n', 4], ['ilha', 'n', 5], ['pesquisa', 'n', 6], ['revisao', 'n', 7],
        ['ilha', 's', 4], ['ilha', 's', 5], ['ilha', 's', 6], ['mcp', 's', 7]];
      const acoplados2 = lugares2.map(([tipo, lado, vaga]) => Est.acoplarEm(tipo, lado, vaga,
        { pasta: tipo !== 'ilha' ? undefined : lado === 'n' ? '/exemplo/cheia-estudio' : '/exemplo/cheia-sul', extensao: tipo === 'ilha' && (lado === 'n' || vaga > 4) }));
      await fase('cheia2', 25, () => ({ agentes: [] }), { acoplados: acoplados2.filter(Boolean).length });
      Est.mostrarTodasAsColunas(false);
      await fase('cheia2-esvazia', segundosCheia, () => ({ agentes: [] }));
      // compactação (03/10): 3 salas de pasta e a Missão (em andamento) no fim do norte;
      // as salas esvaziam e saem, a Missão vem para perto do núcleo e não sobra jardim
      // além do que completa o retângulo
      const lugares3 = [['ilha', 'n', 4], ['ilha', 'n', 5], ['ilha', 'n', 6], ['missao', 'n', 7]];
      lugares3.forEach(([tipo, lado, vaga], i) => Est.acoplarEm(tipo, lado, vaga, { pasta: tipo === 'ilha' ? '/exemplo/compacta-' + i : undefined, chave: tipo === 'missao' ? 'missao' : undefined }));
      const salasAntes = E.salasDados;
      E.salasDados = { missao: { missoes: [{ id: 'wf_teste', nome: 'teste', ativa: true, fases: [], agentes: { total: 1, rodando: 1, concluidos: 0 } }] } };
      await fase('compacta', segundosCheia + 60, () => ({ agentes: [] }));
      const mods = Est.estatisticasEstacao().modulos;
      const missao = mods.find(m => m.tipo === 'missao');
      const ate = l => Math.max(1, ...mods.filter(m => m.lado === l && m.tipo !== 'jardim').map(m => m.vaga + (m.tipo === 'estudio' ? 1 : 0)));
      const jardins = mods.filter(m => m.tipo === 'jardim' && !(m.lado === 's' && m.vaga === 2)).length;
      compactacao = { missao: missao ? missao.lado + missao.vaga : null, jardins, jardinsPermitidos: Math.abs(ate('n') - ate('s')),
        planta: mods.map(m => m.tipo + '@' + m.lado + m.vaga).join(' ') };
      // a Missão sem buraco antes dela no norte (com x = 1 a Biblioteca, que fica 10 min,
      // ainda pode estar na n4 e a Missão vem logo depois)
      const kMissao = missao && missao.lado === 'n' ? missao.vaga : -1;
      const semBuraco = kMissao >= 4 && [...Array(kMissao - 4).keys()].every(i => mods.some(m => m.lado === 'n' && m.vaga === 4 + i && m.tipo !== 'jardim'));
      compactacao.ok = semBuraco && jardins <= compactacao.jardinsPermitidos;
      E.salasDados = salasAntes;
      await fase('compacta-esvazia', segundosCheia, () => ({ agentes: [] }));
      // sala dos servidores modular (F2): 12 servidores (racks pequenos, médios e grandes)
      // pedem duas extensões coladas na base, fundidas e sem divisória; com 3, a sala volta
      // a 1 vaga
      // a vaga de crescer (s4) começa com outro módulo (o MCP, vazio): ele dá passagem
      // (muda de vaga, como na compactação) e a extensão entra no lugar dele (integração
      // da etapa 2: antes os racks ficavam espremidos a 45% para sempre)
      const naVagaDeCrescer = Est.acoplarEm('mcp', 's', 4);
      await fase('servidores-mcp', 5, () => ({ agentes: [] }));
      E.salasDados = { servidores: servidoresFalsos(12) };
      await fase('servidores', 60, () => ({ agentes: [] }), { animarSalas: true });
      const medir = () => {
        const mods = Est.estatisticasEstacao().modulos;
        const base = mods.find(m => m.tipo === 'servidores' && !m.extensao);
        const ext = mods.filter(m => m.tipo === 'servidores' && m.extensao);
        const sala = Est.modulosSalaNova().find(m => m.tipo === 'servidores' && !m.extensao)?.salaNova;
        return { base: base ? base.lado + base.vaga : null, extensoes: ext.map(m => m.lado + m.vaga + (m.estado === 'pronto' ? '' : ':' + m.estado)),
          fundida: !!base?.fundido, racks: sala?.racks?.().length ?? 0, tamanhos: [...new Set((sala?.racks?.() || []).map(r => r.tam))].sort().join(',') };
      };
      servidores = { com12: medir() };
      const mcpDepois = Est.estatisticasEstacao().modulos.find(m => m.tipo === 'mcp');
      servidores.passagem = !naVagaDeCrescer ? 'vaga s4 ocupada antes (sem MCP de teste)'
        : (E.estacao?.registro || []).some(r => r.acao === 'dar-passagem' && r.tipo === 'mcp') ? 'mcp deu passagem' + (mcpDepois ? ' (' + mcpDepois.lado + mcpDepois.vaga + ')' : '') : 'mcp não deu passagem';
      servidores.escala = Math.min(1, ...(Est.modulosSalaNova().find(m => m.tipo === 'servidores' && !m.extensao)?.salaNova?.racks?.() || []).map(r => r.escala));
      E.salasDados = { servidores: servidoresFalsos(3) };
      await fase('servidores-encolhe', segundosCheia, () => ({ agentes: [] }), { animarSalas: true });
      servidores.com3 = medir();
      servidores.ok = servidores.com12.extensoes.length === 2 && servidores.com12.fundida && servidores.com12.racks === 12
        && servidores.escala === 1 && !/não deu/.test(servidores.passagem)
        && servidores.com3.extensoes.length === 0 && servidores.com3.racks === 3;
      E.salasDados = salasAntes;
    }
    if (levas > 0) {
      recursos.amostrar();
      const medidas = [{ leva: 0, ...recursos.contar() }];
      for (let k = 1; k <= levas; k++) {
        await fase('vaivem' + k, 30, geradorVaivem(k, porLeva));
        // espera todos saírem e a estação voltar ao núcleo (no máximo 3 min de cena)
        await fase('vaivem' + k + '-saida', 180, () => ({ agentes: [] }), { ate: () => !E.agentes.size && soNucleo() && !Est.estacaoOcupada() });
        recursos.amostrar();
        medidas.push({ leva: k, entradasESaidas: k * porLeva, ...recursos.contar() });
      }
      fases.push({ fase: 'recursos', medidas, estaveis: medidas.slice(1).every(m => m.geometrias === medidas[1].geometrias && m.texturas === medidas[1].texturas) });
    }
  } finally {
    Est.definirRelogioEstacao(null);
    limpar();
  }
  v.desacoplouComOcupante = Est.estatisticasEstacao().violacoes - violacoesAntes;
  const falhasCaminho = configuracoes.reduce((n, c) => n + c.falhas, 0);
  const totalViolacoes = Object.values(v).reduce((n, k) => n + k, 0);
  const resultado = {
    passou: configuracoes.length > 0 && falhasCaminho === 0 && totalViolacoes === 0 && (!compactacao || compactacao.ok) && (!servidores || servidores.ok),
    compactacao, servidores,
    x, quadros, segundosDeCena: +tCena.toFixed(1), configuracoesEstaveis: configuracoes.length, falhasCaminho, violacoes: v,
    trechosConferidos, quadrosLadoALado, menorDistancia: +menorDistancia.toFixed(3), menorFolga: +menorFolga.toFixed(3), resgates: Ag.estatisticasFila().resgates - resgatesAntes,
    maxModulos, maxComprimento: +maxComprimento.toFixed(2), configuracoes, fases, exemplos,
    tempoReal_s: +((agoraReal() - inicioReal) / 1000).toFixed(1),
  };
  if (typeof window !== 'undefined') window.__testeEstacao = resultado;
  console.table?.(configuracoes.map(c => ({ fase: c.fase, configuracao: c.configuracao, total: c.total, falhas: c.falhas, acessosRuins: c.acessosRuins })));
  console.table?.(v);
  return resultado;

  function soNucleo() { return Est.estatisticasEstacao().modulos.every(m => m.nucleo); }

  // Uma fase: lê os dados a cada 1,5 s de cena, anima e confere quadro a quadro
  async function fase(nome, segundos, dados, { ate = null, animarSalas: comSalas = false, ...extra } = {}) {
    const inicio = tCena;
    let proxLeitura = tCena, n = 0;
    while (tCena - inicio < segundos) {
      if (tCena >= proxLeitura) {
        const d = dados(tCena);
        E.dados = { ...d, dono: null };
        Ag.aplicarEstado(E.dados);
        proxLeitura += 1.5;
      }
      relogioTeste.ms += dt * 1000;
      tCena += dt;
      aoAvancar?.(relogioTeste.ms);
      Ag.animarAgentes(dt, relogioTeste.ms);
      atualizarTweens(relogioTeste.ms);
      if (comSalas) animarSalas(dt);   // as salas recebem os dados (servidores) e os NPCs andam
      quadros++; n++;
      conferirQuadro(nome);
      if (n % 6 === 0) { conferirPlanta(nome); conferirRotas(); }
      if (n % 30 === 0) recursos.amostrar();
      if (pausa && n % quadrosPorPausa === 0) { E.sujo = true; await pausa(); }
      if (ate && n % 30 === 0 && ate()) break;
    }
    fases.push({ fase: nome, segundos: +(tCena - inicio).toFixed(1), ...extra });
  }

  // Configuração estável e nova: roda a bateria de caminhos
  function conferirPlanta(nome) {
    const est = Est.estatisticasEstacao();
    maxModulos = Math.max(maxModulos, est.modulos.length);
    maxComprimento = Math.max(maxComprimento, est.comprimento);
    if (Est.estacaoOcupada() || est.modulos.some(m => m.estado !== 'pronto')) return;
    const assinatura = est.modulos.map(m => `${m.tipo}@${m.lado}${m.vaga}`).join(' ');
    if (assinatura === estavelAntes) return;
    estavelAntes = assinatura;
    const ja = testadas.get(assinatura);
    if (ja) { ja.vezes++; return; }
    const c = testarCaminhos({ silencioso: true });
    const reg = { fase: nome, t: +tCena.toFixed(1), configuracao: assinatura, comprimento: est.comprimento, total: c.total, falhas: c.falhas,
      vagas: c.vagas, acessosRuins: c.acessosRuins, vezes: 1, exemplos: c.exemplos.slice(0, 3) };
    testadas.set(assinatura, reg);
    configuracoes.push(reg);
  }

  // Rota de quem anda (do ponto atual em diante) sem célula bloqueada no mapa atual
  function conferirRotas() {
    const m = E.mapa;
    for (const a of E.agentes.values()) {
      if (a.estado !== 'andando' || a.resgatando || a.aguardandoEntrada || !a.rota?.length || rotasRuins.has(a.rota)) continue;
      for (let k = 0; k + 1 < a.rota.length; k++) {
        const p = a.rota[k], q = a.rota[k + 1];
        if (p.assento || p.saidaAssento || q.assento || q.saidaAssento) continue;   // trecho do assento entra na mobília de propósito
        trechosConferidos++;
        const ponto = trechoBloqueado(m, p, q);
        if (!ponto) continue;
        rotasRuins.add(a.rota);
        v.rotaCruzaObstaculo++;
        if (exemplos.rota.length < 8) exemplos.rota.push({ t: +tCena.toFixed(2), id: a.id, trecho: k, de: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) },
          para: { x: +q.x.toFixed(2), z: +q.z.toFixed(2) }, ponto, destino: a.salaDestino ?? a.alvo });
        break;
      }
    }
  }

  // Corpo sólido e fila indiana, como no teste da multidão
  function conferirQuadro(nome) {
    const m = E.mapa;
    const corpos = [...E.agentes.values()].filter(a => !a.aguardandoEntrada && a.boneco.visible && a.fade > 0.15);
    for (let i = 0; i < corpos.length; i++) for (let j = i + 1; j < corpos.length; j++) {
      const p = corpos[i].boneco.position, q = corpos[j].boneco.position;
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < menorDistancia) menorDistancia = d;
      if (d < SOBREPOSICAO) {
        v.sobreposicoes++;
        if (exemplos.sobreposicao.length < 8) exemplos.sobreposicao.push({ fase: nome, t: +tCena.toFixed(2), a: corpos[i].id, b: corpos[j].id, d: +d.toFixed(3) });
      }
    }
    for (const a of corpos) {
      if (a.estado !== 'andando' && (a.vaga?.pose === 'sentado' || a.sentadoAntes || a.girando)) continue;
      if (a.trechoAssento || !m.folgaEm) continue;
      const p = a.boneco.position, folga = m.folgaEm(p.x, p.z);
      if (folga < menorFolga) menorFolga = folga;
      if (folga < RAIO_TESTE - 1e-6) {
        v.invasoes++;
        if (exemplos.invasao.length < 8) exemplos.invasao.push({ fase: nome, t: +tCena.toFixed(2), id: a.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2), folga: +folga.toFixed(3), estado: a.estado });
      }
    }
    const mexeu = new Map();
    for (const a of corpos) {
      const p = a.boneco.position, q = anterior.get(a.id);
      if (a.estado === 'andando' && q) {
        const dx = p.x - q.x, dz = p.z - q.z, l = Math.hypot(dx, dz);
        if (l > 1e-4) mexeu.set(a, [dx / l, dz / l]);
      }
    }
    anterior.clear();
    for (const a of corpos) anterior.set(a.id, { x: a.boneco.position.x, z: a.boneco.position.z });
    const mov = [...mexeu.keys()], ladoAgora = new Set();
    for (let i = 0; i < mov.length; i++) for (let j = i + 1; j < mov.length; j++) {
      const [ax, az] = mexeu.get(mov[i]), [bx, bz] = mexeu.get(mov[j]);
      if (ax * bx + az * bz < 0.866) continue;
      let mx = ax + bx, mz = az + bz;
      const ml = Math.hypot(mx, mz); mx /= ml; mz /= ml;
      const pa = mov[i].boneco.position, pb = mov[j].boneco.position;
      const rx = pb.x - pa.x, rz = pb.z - pa.z;
      if (Math.abs(rx * mx + rz * mz) >= 0.3 || Math.abs(rx * mz - rz * mx) >= 0.8) continue;
      quadrosLadoALado++;
      const par = mov[i].id + '|' + mov[j].id, seguidos = (seguidosLado.get(par) || 0) + 1;
      ladoAgora.add(par);
      seguidosLado.set(par, seguidos);
      if (seguidos === Math.round(0.3 / dt)) {
        v.ladoALado++;
        if (exemplos.ladoALado.length < 8) exemplos.ladoALado.push({ fase: nome, t: +tCena.toFixed(2), a: mov[i].id, b: mov[j].id, x: +pa.x.toFixed(2), z: +pa.z.toFixed(2) });
      }
    }
    for (const par of [...seguidosLado.keys()]) if (!ladoAgora.has(par)) seguidosLado.delete(par);
  }
}

// Leva k de entradas e saídas: 'n' sessões entram uma a cada 0,6 s, trabalham
// (mesa da pasta, MCP ou outra pasta, para acoplar e desacoplar módulos) e somem
// da lista aos 20 s da leva
function geradorVaivem(k, n) {
  let inicio = null;
  return t => {
    inicio ??= t;
    const tl = t - inicio;
    if (tl >= 20) return { agentes: [] };
    const lista = [];
    for (let i = 0; i < n && tl >= i * 0.6; i++) {
      const outra = i % 5 === 4, mcp = i % 5 === 3;
      lista.push({ id: `vaivem-${k}-${i}`, nome: `Leva ${k} número ${i + 1}`, tipo: 'sessao', pai: null,
        pasta: outra ? 'notas' : 'Claude', pastaCaminho: outra ? '/exemplo/notas' : '/exemplo/Claude',
        atividade: mcp ? 'conector' : 'editar', conector: mcp ? 'Reportei Flux' : null, conectorTipo: mcp ? 'mcp' : null,
        texto: mcp ? 'usando Reportei Flux' : 'trabalhando na mesa', pensamentos: [], provedor: 'anthropic' });
    }
    return { agentes: lista };
  };
}

// Geometrias, materiais e texturas vivos, como o renderer.info.memory conta: tudo
// que já apareceu na cena e ainda não recebeu dispose (no navegador, também o
// próprio renderer.info.memory)
function rastrearRecursos() {
  const vivos = { geometrias: new Set(), materiais: new Set(), texturas: new Set() };
  const seguir = (conjunto, r) => {
    if (!r || conjunto.has(r)) return;
    conjunto.add(r);
    r.addEventListener?.('dispose', () => conjunto.delete(r));
  };
  return {
    amostrar() {
      E.cena.traverse(o => {
        seguir(vivos.geometrias, o.geometry);
        for (const m of [].concat(o.material || [])) {
          seguir(vivos.materiais, m);
          for (const k of ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap']) if (m[k]?.isTexture) seguir(vivos.texturas, m[k]);
        }
      });
    },
    contar() {
      const info = E.renderer?.info?.memory;
      return { geometrias: vivos.geometrias.size, materiais: vivos.materiais.size, texturas: vivos.texturas.size, objetosNaCena: contarObjetos(),
        ...(info?.geometries ? { rendererGeometrias: info.geometries, rendererTexturas: info.textures } : {}) };
    },
  };
}
function contarObjetos() { let n = 0; E.cena.traverse(() => { n++; }); return n; }
