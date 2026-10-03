// A Estação: escritório isométrico dos agentes.
// Cena 3D em diorama (Three.js, câmera ortográfica). Os agentes são as sessões
// reais do Claude, lidas pelo servidor local em /api/estado (fonte.js).
//
// Este arquivo só inicializa e roda os dois ciclos:
//   leitura a cada 1,5 s (fonte -> planta -> agentes -> resumo), 10 s com a aba oculta;
//   animação sob demanda (agentes -> tweens -> câmera -> luz -> desenho).
//
// Desenho sob demanda (PERF-01), em três regimes:
//   'movimento'  alguém anda, há tween, a câmera ainda não assentou ou os controles
//                têm inércia: até 60 quadros por segundo, mesmo em monitor de 100 ou 120 Hz;
//   'ambiente'   há astronautas, todos sentados (ou a luz mudando): 24 por segundo;
//   'npc'        ninguém se mexendo, mas há NPC acordado (operadores das salas de
//                controle e os NPCs das salas novas): 20 por segundo; a sombra deles é
//                refeita no máximo 8 vezes por segundo;
//   'vazio'      ninguém se mexendo e todos os NPCs cochilando (sem ninguém trabalhando
//                há mais de 1 min, F1): 0 por segundo, a não ser com E.sujo
//                (resize, hover, dado novo, TV ou placa trocada, balão novo).
// A sombra só é recalculada quando alguém anda ou um tween mexe na mobília (E.sombraSuja).
//
// Módulos:
//   estado.js   estado compartilhado (E)
//   cena.js     renderer, câmera, controles, luzes, sombra e expediente
//   pecas.js    paleta, móveis, placas e TVs
//   layout.js   planta, salas e mapa de caminhos
//   agentes.js  astronautas, rotas, vagas e balões
//   camera.js   câmera diretor (seguir quem trabalha), roda, pinça e arrasto
//   hud.js      resumo, "+N" na porta e hover
//   fonte.js    leitura do estado (e o modo ?simular)
//   controle.js salas de controle (medidores, console e operador NPC)
//   monitoramento.js  liga as salas de controle aos dados e anima os operadores
//   sala-modulos.js   salas novas (servidores, portaria, despacho, missão, oficina,
//               biblioteca): dados das rotas, vida dos NPCs e cochilo
//   tween.js    animações curtas de valores
//   testes.js   ?teste=caminhos, ?teste=multidao, ?teste=estacao, __metricas e __estacao

import { E } from './estado.js';
import * as Cena from './cena.js';
import { construir } from './layout.js';
import * as Ag from './agentes.js';
import * as Cam from './camera.js';
import * as Hud from './hud.js';
import { lerEstado } from './fonte.js';
import * as Mon from './monitoramento.js';
import * as Salas from './sala-modulos.js';
import { atualizarTweens, haTweens } from './tween.js';
import { iniciarDepuracao, aposConstruir, contarQuadro } from './testes.js';

const INTERVALO_LEITURA = 1500;
const INTERVALO_LEITURA_OCULTA = 10000;
const FPS = { movimento: 60, ambiente: 24, npc: 20, vazio: 0 };

Cena.iniciarCena(document.getElementById('cena'));
Cam.iniciarCamera();
Hud.iniciarHover?.();
Hud.iniciarHud?.();
iniciarDepuracao();
instalarMetricas();

// ---------------------------------------------------------------------------
// Leitura do estado
// ---------------------------------------------------------------------------
let assinaturaDados = '';

function semConexao(falhou) {
  if (falhou) E.semConexaoDesde ??= Date.now();
  else if (E.semConexaoDesde == null) return;
  else E.semConexaoDesde = null;
  if (Hud.atualizarSemConexao) Hud.atualizarSemConexao();
  else if (falhou) document.getElementById('resumo').textContent = 'sem conexão com o servidor local';
  E.sujo = true;
}

async function ler() {
  let dados;
  try {
    dados = await lerEstado();
  } catch {
    semConexao(true);
    return;
  }
  semConexao(false);
  if (!E.construido) {
    E.dados = dados;
    construir();
    E.construido = true;
    depoisDeConstruir();
    aposConstruir();
  }
  // resposta com erro do servidor: mantém o último estado em cena (BUG-08)
  if (dados?.erro) return;
  // ?teste=multidao: o teste dirige os agentes (testes.js); a leitura não mexe na cena
  if (E.teste) {
    // sem isso o cabeçalho fica em "carregando…" durante todo o ensaio
    const resumo = document.getElementById('resumo');
    const texto = E.teste === 'estacao' ? 'ensaio da estação' : 'ensaio da multidão';
    if (resumo && resumo.textContent !== texto) resumo.textContent = texto;
    return;
  }
  E.dados = dados;
  // "Só as sessões": os ajudantes e as tarefas em segundo plano não viram astronautas
  // (o cabeçalho continua contando todos, com o volume real)
  Ag.aplicarEstado(Hud.modoVisao?.() === 'sessoes' ? { ...dados, agentes: (dados.agentes || []).filter(a => a.tipo !== 'subagente') } : dados);
  Hud.atualizarResumo?.(dados);
  Mon.aplicarMonitoramento(dados);
  // só pede quadro novo se os dados mudaram (com a estação vazia, a cena fica parada)
  const assinatura = JSON.stringify(dados.agentes ?? []);
  if (assinatura !== assinaturaDados) { assinaturaDados = assinatura; E.sujo = true; }
}

// Depois da planta montada: sol e sombra pela pegada, peças pequenas sem sombra
function depoisDeConstruir() {
  Salas.iniciarSalas();
  Cena.ajustarSombra(Cam.pegadaAtual());
  Cena.podarSombras();
  E.sombraSuja = true;
  E.sujo = true;
}

let timerLeitura = null, lendo = false;
function agendarLeitura(ms) {
  clearTimeout(timerLeitura);
  timerLeitura = setTimeout(cicloLeitura, ms);
}
async function cicloLeitura() {
  if (lendo) return;   // a leitura em andamento agenda a próxima
  lendo = true;
  try { await ler(); } catch (erro) { registrarErro(erro); } finally { lendo = false; }
  agendarLeitura(document.hidden ? INTERVALO_LEITURA_OCULTA : INTERVALO_LEITURA);
}
// Aba oculta: lê a cada 10 s. Ao voltar, lê na hora e redesenha.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) agendarLeitura(INTERVALO_LEITURA_OCULTA);
  else { agendarLeitura(0); E.sujo = true; }
});

// ---------------------------------------------------------------------------
// Animação sob demanda
// ---------------------------------------------------------------------------
let ultimoProcessado = performance.now();
let proximoQuadro = 0;
let controlesMexendo = false;    // entre 'start' e 'end' dos controles (arrasto)
let controlesComInercia = false; // o último controles.update() mexeu na câmera
E.controles.addEventListener('start', () => { controlesMexendo = true; E.sujo = true; });
E.controles.addEventListener('end', () => { controlesMexendo = false; E.sujo = true; });

// Regime dos agentes: agentes.js exporta regimeAgentes(); enquanto não exportar, calcula aqui
function regimeDosAgentes() {
  const r = Ag.regimeAgentes?.();
  if (r) return r;
  if (!E.agentes.size) return 'vazio';
  for (const a of E.agentes.values()) {
    if (a.estado === 'andando' || a.estado === 'entrando' || (a.fade ?? 1) < 1) return 'movimento';
  }
  return 'ambiente';
}

// A sombra só precisa ser refeita quando alguém muda de lugar ou de pose: anda, entra
// ou sai (fade), gira ou senta e levanta. Digitar, respirar e o relógio não contam.
function alguemSeMexe(agoraMs) {
  for (const a of E.agentes.values()) {
    if (a.estado === 'andando' || a.estado === 'entrando' || a.saindo || a.girando || (a.fade ?? 1) < 1
      || agoraMs < (a.transicaoAte ?? 0)) return true;
  }
  return false;
}

function regimeAtual(regimeAgentes) {
  if (regimeAgentes === 'movimento' || haTweens() || !Cam.cameraAssentada() || controlesMexendo || controlesComInercia) return 'movimento';
  if (regimeAgentes === 'ambiente' || Cena.luzEmTransicao()) return 'ambiente';
  if (Salas.npcsAcordados()) return 'npc';
  return 'vazio';
}

let ultimoErro = 0;
function registrarErro(erro) {
  const agora = performance.now();
  if (agora - ultimoErro < 5000) return;   // no máximo 1 a cada 5 s
  ultimoErro = agora;
  console.error('A Estação: erro no quadro (a cena segue rodando)', erro);
}

let regime = 'vazio';
function animar() {
  requestAnimationFrame(animar);   // primeiro agenda: um erro no quadro não congela a cena
  const agoraMs = performance.now();
  let desenhou = false;
  try {
    const regimeAgentes = regimeDosAgentes();
    regime = regimeAtual(regimeAgentes);
    // E.sujo acorda a cena parada, mas nunca passa do teto de 60 por segundo
    const fps = FPS[regime] || (E.sujo ? FPS.movimento : 0);
    if (!fps) return;
    if (agoraMs < proximoQuadro - 1) return;
    // próximo quadro no ritmo do regime, sem acumular atraso nem adiantar
    const intervalo = 1000 / fps;
    proximoQuadro = (agoraMs - proximoQuadro > intervalo || proximoQuadro > agoraMs + intervalo)
      ? agoraMs + intervalo : proximoQuadro + intervalo;
    E.sujo = false;

    const dt = Math.min((agoraMs - ultimoProcessado) / 1000, 0.05);
    ultimoProcessado = agoraMs;
    if (!E.teste) {   // nos ensaios (?teste=multidao, ?teste=estacao), quem anima é o próprio teste
      Ag.animarAgentes(dt, agoraMs);
      atualizarTweens(agoraMs);
    }
    Mon.animarMonitoramento(dt, agoraMs);
    Salas.animarSalas(dt);
    Cam.enquadrar(dt, agoraMs);
    Cena.atualizarLuz(dt);
    // a sombra acompanha quem anda (e os tweens, que tween.js já marca)
    if (alguemSeMexe(agoraMs) || haTweens()) E.sombraSuja = true;
    Hud.atualizarHover?.(agoraMs);
    controlesComInercia = Cena.renderizar();
    desenhou = true;
  } catch (erro) {
    registrarErro(erro);
    // um quadro com erro não vira laço quente: espera um pouco antes de tentar de novo
    E.sujo = false;
    proximoQuadro = agoraMs + 100;
  } finally {
    if (desenhou) { contarQuadro(agoraMs); anotarQuadro(agoraMs); }
  }
}

// ---------------------------------------------------------------------------
// Métricas: quadros e sombras por segundo de verdade (o contador de testes.js só
// anda quando há quadro; com a cena parada ele ficaria preso no último valor)
// ---------------------------------------------------------------------------
const quadrosRecentes = [];
const sombrasRecentes = [];
let sombrasAntes = 0;
function anotarQuadro(agoraMs) {
  quadrosRecentes.push(agoraMs);
  const sombras = Cena.contagemSombras();
  if (sombras !== sombrasAntes) { sombrasRecentes.push(agoraMs); sombrasAntes = sombras; }
  while (quadrosRecentes.length && agoraMs - quadrosRecentes[0] > 1000) quadrosRecentes.shift();
  while (sombrasRecentes.length && agoraMs - sombrasRecentes[0] > 1000) sombrasRecentes.shift();
}
function porSegundo(lista) {
  const agora = performance.now();
  return lista.filter(t => agora - t <= 1000).length;
}
function instalarMetricas() {
  const original = window.__metricas;
  window.__metricas = () => ({
    ...(original ? original() : {}),
    quadrosUltimoSegundo: porSegundo(quadrosRecentes),
    sombrasUltimoSegundo: porSegundo(sombrasRecentes),
    sombrasTotal: Cena.contagemSombras(),
    regime,
    camera: Cam.estadoDaCamera(),
  });
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------
// Espera as três espessuras da Figtree usadas nas placas (600, 700 e 800), no máximo 2 s
// para não travar sem internet (BUG-09)
async function esperarFontes() {
  try {
    await Promise.race([
      Promise.all(['600', '700', '800'].map(p => document.fonts.load(p + ' 40px Figtree', 'Áa'))),
      new Promise(resolver => setTimeout(resolver, 2000)),
    ]);
  } catch { /* sem internet: usa a fonte do sistema */ }
}

await esperarFontes();
await cicloLeitura();
requestAnimationFrame(animar);
