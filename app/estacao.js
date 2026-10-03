// A Estação sob medida (rodada 3): um NÚCLEO fixo colado à porta e módulos que
// ACOPLAM à espinha do corredor, crescendo para a esquerda, só quando a demanda
// passa do que o núcleo atende, e desacoplam vazios e sem pressa.
//
// Três regras:
// (1) não existe cadeira vazia à mostra (mesa de apoio, pecas.js; e os conjuntos de
//     mesas só existem enquanto alguma sessão precisa deles);
// (2) o espaço é do tamanho da demanda: a porta fica sempre em X1 e a estação
//     cresce para a esquerda em vagas de VAGA_L = 4,6 m de cada lado do corredor;
// (3) câmera e números contam só o que existe: E.pegada é a pegada construída.
//
// PLANTA (F2, 03/10: planta por pasta)
// - A vaga k de cada lado ocupa x de X1 - (k + 1) × 4,6 até X1 - k × 4,6.
//   VAGAS_POR_LADO = 14: 0 a 3 são do núcleo; 4 a 13 recebem até 10 módulos por lado.
// - Núcleo (nunca sai). Norte: a Portaria (vaga 0, na entrada) e o Despacho (vaga 1,
//   com a porta de embarque) e o Estúdio (vagas 2 e 3: mesa da janela, mesa do
//   comandante, fila de quem precisa de você e a SALA DA PRIMEIRA PASTA). O Estúdio
//   foi para as vagas 2 e 3 (antes 0 e 1) para a sala da pasta dele poder crescer
//   para a vaga vizinha (4) sem divisória no meio. Sul: o Descanso (0), a Sala
//   Anthropic (1), a vaga 2 da Sala OpenAI (ou um jardim) e os Servidores (3).
// - Sala OpenAI: módulo 'controle-openai' (só na vaga s2) pedido enquanto houver
//   sessões do Codex na máquina; sem pedido, desacopla depois de 180 s.
// - Salas de controle e salas só de NPC (m.semAcesso): ninguém entra; o cômodo
//   inteiro vira bloco no mapa.
// - Módulos: 'missao', 'oficina' e 'biblioteca' só cabem no norte (quadro e estantes
//   na parede alta); 'ilha' (sala de pasta), 'pesquisa', 'revisao', 'mcp', 'api' e
//   'descanso' preferem o sul, deixando o norte para a sala do Estúdio crescer. Cada
//   lado ocupa primeiro a vaga livre (ou jardim) perto da porta, pulando as vagas
//   guardadas para uma sala de pasta crescer.
// - Um módulo novo nunca reordena os outros; buracos são fechados pela compactação
//   (compactar), um módulo vazio por vez.
// - Sala dos servidores MODULAR (F2, 03/10): a base é do núcleo (s3) e cresce para fora
//   (s4, s5) com extensões 'servidores' (m.extensao, chave 'servidores:2' e ':3') quando
//   os racks não cabem; sala-servidores.js diz quantas (extensoesNecessarias) e recebe
//   quantas estão prontas (informarServidores). Base e extensões se fundem (sem
//   divisória, piso único); a extensão de fora sai 60 s depois de ficar sem rack.
//
// UMA SALA POR PASTA (decidido pelo Eduardo em 03/10)
// - Cada pasta de trabalho tem UMA sala: o Estúdio (a primeira pasta que chega) ou um
//   módulo 'ilha'. Precisando de mais mesas, a sala CRESCE para a vaga vizinha
//   (primeiro a de fora, depois a de dentro): os módulos da mesma pasta se fundem num
//   cômodo só (some a divisória entre eles, piso contínuo, uma placa com o nome da
//   pasta). Duas salas lado a lado só quando são pastas diferentes.
// - Esvaziando, os módulos extras saem primeiro (sempre uma ponta da sala, nunca o
//   do meio) e a sala encolhe; a base sai por último.
//
// CONJUNTOS DE MESAS POR SESSÃO ("coworking modulado", 03/10)
// - Cada módulo de sala (e o Estúdio) tem DUAS colunas fixas; cada coluna são 2 mesas
//   frente a frente com a divisória sálvia. Cada SESSÃO (com os ajudantes e as
//   tarefas em segundo plano dela) ganha as suas colunas: ceil(equipe / 2), ou seja,
//   do tamanho da equipe mais no máximo 1 mesa de folga. Duas colunas da mesma
//   sessão no mesmo módulo viram um conjunto só (ponte de divisória no vão).
// - Agência visível pelo lado: conjuntos do Claude Code a partir do lado da porta, do
//   Codex a partir do outro lado (e pela cor dos olhinhos). A plaquinha de cada
//   conjunto mostra o NOME DA SESSÃO dona dele (decidido em 03/10).
// - A coluna brota (0,5 s) quando a sessão precisa e encolhe (0,4 s) quando fica
//   sem ninguém (sentado, com a casa, a caminho) e sem uso por COLUNA_FOLGA_MS. Sessão
//   que termina leva o conjunto embora depois do relógio e do descanso.
//
// QUANDO ACOPLA (planejarEstacao, a cada leitura, com os agentes que estão dentro)
// (a) salas de pasta: o Estúdio é da primeira pasta que chega e só troca de dono
//     quando fica livre por RESERVA_MS (30 s); cada outra pasta pede 'ilha:' + pasta
//     e, sem coluna livre para alguma sessão, a sala pede mais um módulo
//     ('ilha:' + pasta + ':' + k), sempre colado nela;
// (b) conector MCP pede 'mcp' e API pede 'api' (sem conectorTipo, MCP);
// (c) 2 ou mais pesquisando há mais de 5 s pedem 'pesquisa';
// (d) 6 ou mais descansando pedem 'descanso';
// (f) sessão com pendencia 'entrega_com_sugestao' pede 'revisao' (rodada 6);
// (g) salas novas (F1): missão, oficina e biblioteca pelos dados de cada uma.
// Cada pedido marca ultimoUso; os que faltam entram em filaAcoplar.
//
// TETO (revisão I-1). Sem vaga para MCP ou API, o pedido sai da fila até algum módulo
// desacoplar (semVagaPara), e o astronauta usa a própria mesa com o nome do serviço
// no monitor (agentes.js). Pasta sem vaga para a sala: é recebida na sala com mais
// colunas livres (a placa mostra ' +N').
//
// QUANDO DESACOPLA. Ninguém sentado, a caminho, com a casa ou parado nele, todas as
// colunas recolhidas, e agora - ultimoUso acima de 90 s (ilha, pesquisa, descanso)
// ou 180 s (mcp, api). Primeiro os da ponta (revisão I-3); no meio vira jardim.
// Jardim na ponta sai.
//
// CADÊNCIA. No máximo um acoplamento a cada 0,6 s; no máximo um desacoplamento a
// cada 3 s, e nunca com acoplamento pendente. Acoplar: 1,4 s; desacoplar: 1,8 s.
//
// MAPA. O Mapa (navegacao.js) é criado uma vez com a largura máxima. Os
// obstáculos de cada módulo são medidos uma vez, em escala 1 e com as mesas como
// posto: os fixos (m.obstaculos), a divisória da esquerda (m.rectsDivisoria, fora do
// mapa quando o módulo se funde com o vizinho) e cada coluna (c.rects, só com a
// coluna à mostra). reconstruirMapa (1 quadro depois de cada mudança) remonta tudo,
// refaz as salas lógicas de E.salas e faz todo astronauta que anda recalcular a rota.
//
// SALAS LÓGICAS (E.salas, usadas por agentes.js): 'coworking' (todas as salas de
// pasta: colunas à mostra em s.colunas, cada mesa com v.coluna), 'pesquisa' (mesa da
// janela + módulo), 'descanso' (núcleo + módulo), 'mcp' e 'api' (quando acoplados),
// 'dono' (fila em frente à mesa do comandante, no Estúdio), 'revisao', 'oficina' e
// 'biblioteca'. As duas filas não têm vagas: trazem filaDef { olharAlvo, pontos }.
// E.ilhaPorPasta guarda o id do módulo-base da sala de cada pasta.
//
// EXPORTS: iniciarEstacao, planejarEstacao, atualizarEstacao, posVaga,
// pegadaAtual, estacaoOcupada, aguardandoSala, semVagaPara, luzesDaEstacao,
// definirGanchos, estatisticasEstacao, vagasMundo, relogioEstacao,
// definirRelogioEstacao, acoplarEm, salasDeControle, modulosSalaNova,
// sessaoDoAgente, partesDaPasta, mostrarTodasAsColunas, reservarEstudio, paredeNaFrente,
// vistaEm, oQueHaEm, TIPOS_SALA_NOVA
// (testes e console) e as constantes da planta.
//
// Teste: em ?simular, o relógio das folgas anda na velocidade da simulação (&x=).
// &folga=0.2 encurta as folgas (só para conferir o desacoplar sem esperar).

import * as THREE from 'three';
import { E } from './estado.js';
import * as Cena from './cena.js';
import { tween, cancelarTweens } from './tween.js';
import { medirObstaculos } from './navegacao.js';
import { liberarObjeto, mostrarNaPlaca, mostrarNaTv, plaquinhaNome, definirSemente, hash } from './pecas.js';
// Montadores dos cômodos. layout.js também importa este arquivo (import circular):
// as funções de lá só são usadas dentro das funções daqui, nunca no carregamento.
import * as Lay from './layout.js';

// ---------------------------------------------------------------------------
// Constantes da planta
// ---------------------------------------------------------------------------
export const CORR = 1.2, PROF = 6.8, VAO = 1.6, ALT_DIVISORIA = 0.9;
const ALTURA_PAREDE = 2.8;
export const VAGA_L = 4.6;                 // largura de uma vaga ao longo da espinha
// v0.7 (03/10, formato em U): o corredor é reto até a vaga K_DOBRA - 1; dali em diante
// ele faz a curva na ponta (o conector) e volta em paralelo, mais ao sul. A vaga k >=
// K_DOBRA de um lado fica na perna de volta: o norte de lá vira o sul da perna B e o
// sul vira o norte da perna B (de costas para as salas do sul da perna A). Na perna B
// só entram salas de pasta e enchimento (as outras precisam da parede alta ou ficam
// perto da porta). Decisão do Eduardo: reto até uns 50 astronautas, U depois; a dobra
// acontece sozinha quando a estação passa de 9 vagas num lado.
export const VAGAS_POR_LADO = 18;          // 0 a 3 do núcleo, 4 a 8 na perna A, 9 a 17 na perna B
export const K_DOBRA = 9;
export const VAGAS_NUCLEO = 2;             // vagas 0 e 1: nunca recebem módulo
export const X1 = 4.0;                     // porta (fixa)
export const ZN = -CORR - PROF, ZS = CORR + PROF;
export const ZB = ZS - ZN;                         // centro do corredor da perna B
export const ZS2 = ZB + CORR + PROF;               // borda da frente da perna B
export const DOBRA_X = X1 - K_DOBRA * VAGA_L;      // ponta oeste da perna A (começo da B)
export const XMIN_MAX = DOBRA_X - 2 * CORR;        // com o conector, a estação não passa daqui
// Os dois trechos são a mesma perna? (a curva separa k < K_DOBRA de k >= K_DOBRA: salas
// de lá e de cá nunca são vizinhas, nem se fundem, nem crescem uma para a outra)
export const mesmaPerna = (a, b) => (a < K_DOBRA) === (b < K_DOBRA);
// No lado sul a sequência continua pela curva: a sala s(K-1) da perna A fica de costas
// com a s(K) da perna B (mesmo x), então a sala de uma pasta pode crescer "para trás"
// (eixo Y, pedido do Eduardo) e seguir pela perna B. No norte, não (n(K-1) e n(K) ficam
// em pontas opostas do U).
export const contiguas = (lado, a, b) => lado === 's' || mesmaPerna(a, b);
const DOBRA_OK = new Set(['ilha', 'jardim']);      // tipos que vão para a perna B
// Geometria de uma vaga: x de cada lado, z do lado físico, se está dobrada (perna B)
export function geoVaga(lado, vaga, nVagas = 1) {
  if (vaga < K_DOBRA) {
    return { x0: X1 - (vaga + nVagas) * VAGA_L, x1: X1 - vaga * VAGA_L, ladoFisico: lado, dz: 0,
      z0: lado === 'n' ? ZN : CORR, z1: lado === 'n' ? -CORR : ZS };
  }
  const kk = vaga - K_DOBRA;
  const ladoFisico = lado === 'n' ? 's' : 'n';
  return { x0: DOBRA_X + kk * VAGA_L, x1: DOBRA_X + (kk + nVagas) * VAGA_L, ladoFisico, dz: ZB,
    z0: (ladoFisico === 'n' ? ZN : CORR) + ZB, z1: (ladoFisico === 'n' ? -CORR : ZS) + ZB };
}
export const XMIN_NUCLEO = X1 - VAGAS_NUCLEO * VAGA_L;
const VAGA_ESTUDIO = 2;                    // o Estúdio ocupa as vagas 2 e 3 do norte

const RESERVA_MS = 30 * 1000;              // sala do Estúdio: reservada depois do último uso
const PESQUISA_MIN_MS = 5 * 1000;          // pesquisando há mais que isso conta para o módulo
const DESCANSO_MIN = 6;                    // no descanso para acoplar o descanso extra
const COLUNA_FOLGA_MS = 20 * 1000;         // coluna vazia e sem uso: recolhe depois disso
const PODA_MS = 60 * 60 * 1000;            // pastas e conectores sem uso há 1 h saem dos mapas (M-10)
const FOLGA_MS = { ilha: 90e3, pesquisa: 90e3, descanso: 90e3, revisao: 90e3, mcp: 180e3, api: 180e3, 'controle-openai': 180e3,
  // extensão da sala dos servidores (F2): sai 60 s depois de vazia (um servidor que
  // reinicia não faz a sala crescer e encolher)
  servidores: 60e3,
  // salas novas (F1): a missão fica reservada uns 3 min depois de acabar; a oficina sai
  // 90 s depois de vazia; a biblioteca fica 10 min depois da última consulta (memória e
  // skill são lidas em rajadas: sem essa folga ela acoplaria e sairia a toda hora)
  missao: 180e3, oficina: 90e3, biblioteca: 600e3 };
const CADENCIA_ACOPLAR_MS = 600;
const CADENCIA_DESACOPLAR_MS = 3000;
const DUR_ACOPLAR = 1.4, DUR_DESACOPLAR = 1.8;
const DUR_COLUNA_SOBE = 0.5, DUR_COLUNA_DESCE = 0.4;
const Y_FUNDO = -1.2;                      // a laje sobe daqui
const LADO_PREFERIDO = { ilha: 's', pesquisa: 's', mcp: 's', api: 's', descanso: 's', jardim: 'n', 'controle-openai': 's', revisao: 's',
  missao: 'n', oficina: 'n', biblioteca: 'n', servidores: 's', portaria: 'n', despacho: 'n' };
// Salas que só existem no norte: o quadro e as estantes precisam da parede alta do
// fundo (no sul o fundo é a divisória baixa do corredor). Norte cheio: esperam vaga.
const SO_NO_NORTE = new Set(['missao', 'oficina', 'biblioteca']);
const SALA_DO_TIPO = { estudio: 'coworking', ilha: 'coworking', pesquisa: 'pesquisa', mcp: 'mcp', api: 'api', revisao: 'revisao',
  descanso: 'descanso', 'descanso-nucleo': 'descanso', jardim: null, 'controle-anthropic': null, 'controle-openai': null,
  // salas novas (F1): só a oficina e a biblioteca recebem astronautas das sessões
  oficina: 'oficina', biblioteca: 'biblioteca', missao: null, servidores: null, portaria: null, despacho: null };
// Tipos das salas novas (F1), montadas por layout.js com as peças de app/sala-*.js
export const TIPOS_SALA_NOVA = ['servidores', 'portaria', 'despacho', 'missao', 'oficina', 'biblioteca'];
// Plaquinha de cada conjunto: o nome da sessão dona dele (decisão de 03/10: o nome
// exato da sessão, e não a agência; a agência aparece pelo lado da sala e pela cor)
const NOME_PLAQUINHA_MAX = 24;
const nomeDaPlaquinha = nome => {
  const t = String(nome || 'Sessão').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\s+/g, ' ').trim() || 'Sessão';
  return t.length > NOME_PLAQUINHA_MAX ? t.slice(0, NOME_PLAQUINHA_MAX - 1).trimEnd() + '…' : t;
};

// ---------------------------------------------------------------------------
// Relógio das folgas: Date.now(); em ?simular, na velocidade da simulação
// ---------------------------------------------------------------------------
const parametros = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const SIMULANDO = parametros.has('simular');
const VELOCIDADE_SIM = SIMULANDO && Number(parametros.get('x')) > 0 ? Number(parametros.get('x')) : 1;
const FATOR_FOLGA = Number(parametros.get('folga')) > 0 ? Number(parametros.get('folga')) : 1;
const DEPURAR_MAPA = parametros.has('mapa');
const inicioRelogio = Date.now();
// Teste da estação (testes.js, ?teste=estacao): o relógio das folgas segue o relógio do teste
let relogioDeTeste = null;
export function relogioEstacao() {
  return relogioDeTeste ? relogioDeTeste() : inicioRelogio + (Date.now() - inicioRelogio) * VELOCIDADE_SIM;
}
export function definirRelogioEstacao(fn) { relogioDeTeste = typeof fn === 'function' ? fn : null; }
const agoraQuadro = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const modulos = new Map();         // id -> módulo (inclusive os que estão desacoplando)
const porChave = new Map();        // chave do pedido -> módulo
const filaAcoplar = [];            // pedidos { chave, tipo, pasta, extensao, lugar }
const removendo = new Set();       // jardins afundando para dar lugar a um módulo
const registro = [];               // últimos acoplar e desacoplar (conferência)
const ganchos = {};                // agentes.js: plantaMudou, replanejarAndando, atualizarPendentes
const inicioPesquisa = new Map();  // id do agente -> quando começou a pesquisar
const usoPasta = new Map();        // pasta -> último instante com agente ativo
const primeiraVezPasta = new Map();// pasta -> quando apareceu (ordem de chegada)
const convidados = new Map();      // pasta sem sala própria (teto) -> id do módulo-base que a recebe
const semVaga = new Map();         // chave do pedido -> versão da planta quando não coube (teto)
const raizes = new Map();          // id do agente -> id da sessão dona do conjunto dele
let candidatos = [];               // módulos que podem desacoplar (calculado a cada leitura)
let guardadasAtivas = new Set();   // vagas guardadas para uma sala de pasta ativa crescer
let contadorModulo = 0, contadorColuna = 0;
let ultimoAcoplar = -Infinity, ultimoDesacoplar = -Infinity;
let mapaSujo = false;
let versaoPlanta = 0;              // sobe a cada módulo que sai (o teto pode ter aberto)
let violacoes = 0, recusados = 0;
let estudio = null, descansoNucleo = null;
let espinha = null;
let xMinAtual = XMIN_NUCLEO;
let donoAtual;
let todasAsColunas = false;        // teste: mostra todas as colunas das salas de pasta

export function definirGanchos(g) { Object.assign(ganchos, g); }

const nomeDaPasta = caminho => String(caminho).split('/').filter(Boolean).pop() || String(caminho);

// ---------------------------------------------------------------------------
// Módulo: grupo na posição final (x do centro da vaga, z = 0), filhos em
// coordenadas locais em x e de mundo em z
// ---------------------------------------------------------------------------
function novoModulo(tipo, lado, vaga, extra = {}) {
  const nVagas = tipo === 'estudio' ? 2 : 1;
  const geo = geoVaga(lado, vaga, nVagas);
  const { x0, x1 } = geo;
  // a montagem (layout.js) usa as medidas da perna A; criarModulo desloca a perna B
  const z0 = geo.z0 - geo.dz, z1 = geo.z1 - geo.dz;
  const grupo = new THREE.Group();
  grupo.position.set((x0 + x1) / 2, 0, 0);
  grupo.name = 'modulo:' + tipo;
  return {
    id: `${tipo}:${lado}${vaga}#${++contadorModulo}`, tipo, lado, vaga, nVagas,
    ladoFisico: geo.ladoFisico, dz: geo.dz, dobrado: geo.dz !== 0,
    chave: extra.chave ?? null, pasta: extra.pasta ?? null, extensao: !!extra.extensao,
    nucleo: !!extra.nucleo, fixo: !!extra.fixo, grupo,
    x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2,
    sala: SALA_DO_TIPO[tipo] ?? null, obstaculos: [], rectsDivisoria: [], ultimoUso: relogioEstacao(),
    estado: 'acoplando', registrado: false,
    laje: [], paredes: [], moveis: [], vagas: [], mesasExtras: [], luzes: [], pontosEmPe: [], colunas: [],
    porta: null, tv: null, luminaria: null, divisoriaEsq: null, placaSala: null, ponte: null, fundido: false,
  };
}

function montar(m) {
  switch (m.tipo) {
    case 'estudio': return Lay.montarEstudio(m);
    case 'descanso-nucleo': return Lay.montarDescansoNucleo(m);
    case 'jardim': return Lay.montarJardim(m);
    case 'ilha': return Lay.montarIlhaModulo(m);
    case 'mcp': case 'api': return Lay.montarSalaServico(m, m.tipo);
    case 'pesquisa': return Lay.montarPesquisaModulo(m);
    case 'descanso': return Lay.montarDescansoModulo(m);
    case 'revisao': return Lay.montarRevisaoModulo(m);
    case 'controle-anthropic': return Lay.montarSalaControleModulo(m, 'anthropic');
    case 'controle-openai': return Lay.montarSalaControleModulo(m, 'openai');
    case 'servidores': case 'portaria': case 'despacho': case 'missao': case 'oficina': case 'biblioteca':
      return Lay.montarSalaNova(m);
    default: throw new Error('A Estação: tipo de módulo desconhecido ' + m.tipo);
  }
}

const dentroDe = (o, g) => { for (let p = o; p; p = p.parent) if (p === g) return true; return false; };

// Monta, mede os obstáculos (mesas como posto) e deixa as mesas como apoio. Os
// obstáculos ficam separados em três: fixos, a divisória da esquerda e cada coluna.
function criarModulo(tipo, lado, vaga, extra = {}) {
  const m = novoModulo(tipo, lado, vaga, extra);
  // decoração estável por módulo (mesma chave e vaga, mesma decoração)
  definirSemente(1 + (hash((m.chave || tipo) + ':' + lado + vaga) % 2147483000));
  E.cena.add(m.grupo);
  montar(m);
  if (m.dz) deslocarParaPernaB(m);
  classificar(m);
  Cena.podarSombras?.(m.grupo);
  const mesas = [...m.vagas, ...m.mesasExtras].filter(v => v.definirPosto);
  for (const v of mesas) v.definirPosto(true, { instantaneo: true });
  const emColuna = o => m.colunas.some(c => dentroDe(o, c.grupo));
  const naDivisoria = o => !!m.divisoriaEsq && dentroDe(o, m.divisoriaEsq);
  const nasCostas = o => !!m.costas && dentroDe(o, m.costas);
  m.obstaculos = medirObstaculos(m.grupo, o => emColuna(o) || naDivisoria(o) || nasCostas(o));
  m.rectsDivisoria = m.divisoriaEsq ? medirObstaculos(m.grupo, o => !naDivisoria(o)) : [];
  m.rectsCostas = m.costas ? medirObstaculos(m.grupo, o => !nasCostas(o)) : [];
  for (const c of m.colunas) c.rects = medirObstaculos(m.grupo, o => !dentroDe(o, c.grupo));
  for (const v of mesas) v.definirPosto(false, { instantaneo: true });
  m.vagas.forEach((v, i) => {
    v.modulo = m;
    v.localModulo = new THREE.Vector3(v.pos.x - m.grupo.position.x, 0, v.pos.z - m.grupo.position.z);
    v.ocupada = null;
    v.ordem ??= i;
  });
  // colunas nascem recolhidas: só brotam quando uma sessão precisa delas
  for (const c of m.colunas) {
    c.id = 'coluna#' + (++contadorColuna);
    c.modulo = m;
    c.estado = 'vazia';
    c.grupo.visible = false;
    c.grupo.scale.set(1, 0.001, 1);
    for (const v of c.vagas) { v.coluna = c; v.removida = true; }
  }
  modulos.set(m.id, m);
  if (m.chave) porChave.set(m.chave, m);
  return m;
}

// Perna B: o módulo foi montado com as medidas da perna A; desce o grupo e tudo que
// guarda posição de mundo (vagas, colunas, pontos em pé) pelo deslocamento dz
function deslocarParaPernaB(m) {
  const dz = m.dz;
  m.grupo.position.z += dz;
  m.z0 += dz; m.z1 += dz; m.cz += dz;
  const vistos = new Set();
  const mover = v => { if (v?.pos && !vistos.has(v)) { vistos.add(v); v.pos.z += dz; } };
  [...m.vagas, ...m.mesasExtras].forEach(mover);
  for (const c of m.colunas) { c.zc += dz; c.vagas.forEach(mover); }
  for (const pt of m.pontosEmPe) if (pt.pos) pt.pos.z += dz;
  for (const c of m.cantos || []) c.atualizarLugares?.();
}

// Separa o que cresce do chão (paredes e o que está preso nelas) do que brota
// (móveis); guarda a escala e a altura de cada um para as animações. As colunas, a
// ponte entre elas e a divisória da esquerda têm animação própria (estacao.js).
function classificar(m) {
  const fixos = new Set([...m.laje, ...m.paredes]);
  const proprios = new Set([...m.colunas.map(c => c.grupo), m.ponte, m.divisoriaEsq, m.costas].filter(Boolean));
  m.paredes = m.paredes.filter(o => o !== m.divisoriaEsq && o !== m.costas);
  for (const o of m.grupo.children) {
    if (fixos.has(o) || proprios.has(o)) continue;
    if (o.userData.parede) m.paredes.push(o); else m.moveis.push(o);
  }
  for (const o of [...m.paredes, ...m.moveis]) o.userData.base = { s: o.scale.clone(), py: o.position.y };
  if (m.divisoriaEsq) m.divisoriaEsq.userData.base = { s: m.divisoriaEsq.scale.clone(), py: m.divisoriaEsq.position.y };
  if (m.costas) m.costas.userData.base = { s: m.costas.scale.clone(), py: m.costas.position.y };
}

// Posição da vaga no mundo (y = 0): pelo grupo do módulo, ou v.pos
export function posVaga(v) {
  if (!v) return null;
  if (v.modulo && v.localModulo) {
    v.modulo.grupo.updateWorldMatrix(true, false);
    const p = v.modulo.grupo.localToWorld(v.localModulo.clone());
    p.y = 0;
    return p;
  }
  return v.pos ? v.pos.clone() : null;
}

// ---------------------------------------------------------------------------
// Núcleo
// ---------------------------------------------------------------------------
export function iniciarEstacao() {
  modulos.clear(); porChave.clear(); filaAcoplar.length = 0; candidatos = [];
  semVaga.clear(); convidados.clear();
  for (const k of Object.keys(E.salas)) delete E.salas[k];
  E.ilhaPorPasta.clear();
  E.salaPorConector.clear();
  espinha = Lay.montarEspinha();
  // Ala técnica na entrada (F2): Portaria e Despacho nas vagas 0 e 1 do norte; o Estúdio
  // logo depois (2 e 3), com a vaga 4 livre para a sala da pasta dele crescer.
  criarModulo('portaria', 'n', 0, { nucleo: true, fixo: true, chave: 'nucleo:portaria' });
  criarModulo('despacho', 'n', 1, { nucleo: true, fixo: true, chave: 'nucleo:despacho' });
  estudio = criarModulo('estudio', 'n', VAGA_ESTUDIO, { nucleo: true, chave: 'nucleo:estudio' });
  descansoNucleo = criarModulo('descanso-nucleo', 's', 0, { nucleo: true, chave: 'nucleo:descanso' });
  criarModulo('controle-anthropic', 's', 1, { nucleo: true, fixo: true, chave: 'nucleo:controle' });
  // Servidores no sul, perto das salas de controle, na vaga 3: a 2 fica para a Sala
  // OpenAI (ao lado da Anthropic) ou, sem Codex, um jardim.
  criarModulo('servidores', 's', 3, { nucleo: true, fixo: true, chave: 'nucleo:servidores' });
  if (!(E.dados?.provedores?.codex || E.dados?.agentes?.some?.(d => d.provedor === 'openai'))) criarModulo('jardim', 's', 2, { chave: 'jardim:s2' });
  for (const m of modulos.values()) { m.estado = 'pronto'; m.registrado = true; }
  xMinAtual = calcularXMin();
  Lay.esticarEspinha(espinha, xMinAtual, { instantaneo: true });
  E.X0 = xMinAtual;
  donoAtual = undefined;
  atualizarDono(E.dados?.dono?.nome ?? null);
  atualizarFusoes(true);
  reconstruirMapa();
  atualizarPegada();
  E.vagas = vagasMundo;
  E.estacao = { estatisticas: estatisticasEstacao, modulos, registro };
}

// Plaquinha com o nome do dono na mesa do comandante (sem nome, sem plaquinha)
function atualizarDono(nome) {
  nome = nome ? String(nome).replace(/[—–]/g, '-').trim().slice(0, 22) : null;
  if (nome === donoAtual) return;
  donoAtual = nome;
  const c = estudio?.comandante;
  if (!c) return;
  if (c.plaquinha) { estudio.grupo.remove(c.plaquinha); liberarObjeto(c.plaquinha); c.plaquinha = null; }
  if (nome) c.plaquinha = plaquinhaNome(nome, c.x, c.y, c.z, estudio.grupo);
  E.sombraSuja = true;
  E.sujo = true;
}

// ---------------------------------------------------------------------------
// Extensão, pegada e espinha
// ---------------------------------------------------------------------------
export const emU = () => [...modulos.values()].some(m => m.dobrado);
// A perna A está sem vaga livre nos dois lados (a próxima sala vai para a perna B)
function ocupacaoCheiaA() {
  for (const lado of ['n', 's']) {
    const ocup = ocupacaoDoLado(lado);
    for (let k = VAGAS_NUCLEO; k < K_DOBRA; k++) if (!(lado === 's' && k === VAGA_OPENAI) && vagaTomavel(ocup, k)) return false;
  }
  return true;
}
function calcularXMin() {
  let x = XMIN_NUCLEO;
  for (const m of modulos.values()) x = Math.min(x, m.x0);
  if (emU()) x = Math.min(x, DOBRA_X - 2 * CORR);   // o conector fica além da ponta da perna A
  return x;
}
// Ponta leste da perna B (até onde vão os módulos de lá)
function xMaxPernaB() {
  let x = DOBRA_X;
  for (const m of modulos.values()) if (m.dobrado) x = Math.max(x, m.x1);
  return x;
}

function atualizarPegada() {
  E.pegada ??= new THREE.Box3();
  E.pegada.min.set(xMinAtual, 0, ZN);
  E.pegada.max.set(X1 + 1.2, ALTURA_PAREDE, emU() ? ZS2 : ZS);
}

export function pegadaAtual() {
  if (!E.pegada) atualizarPegada();
  return E.pegada;
}

// Recalcula a ponta da estação: estica ou encolhe a espinha (0,9 s), pegada e sol
function atualizarExtensao() {
  const x = calcularXMin();
  Lay.atualizarDobra?.(espinha, { ativo: emU(), xMin: x, xMaxB: xMaxPernaB() });
  if (x !== xMinAtual) {
    xMinAtual = x;
    if (espinha) Lay.esticarEspinha(espinha, x);
  }
  E.X0 = xMinAtual;
  atualizarPegada();
  Cena.ajustarSombra?.(E.pegada);
  E.sujo = true;
}

// Módulos de um lado por índice de vaga (o Estúdio ocupa 2 e 3)
function ocupacaoDoLado(lado) {
  const ocup = [];
  for (const m of modulos.values()) {
    if (m.lado !== lado) continue;
    for (let i = 0; i < m.nVagas; i++) ocup[m.vaga + i] = m;
  }
  return ocup;
}

// Pode ser tomada por um módulo novo: vaga vazia ou jardim de enfeite pronto
const vagaTomavel = (ocup, k) => !ocup[k] || (ocup[k].tipo === 'jardim' && !ocup[k].fixo && ocup[k].estado === 'pronto');

// Lugares que um módulo pode tomar num lado: vaga vazia ou jardim de enfeite pronto.
// A vaga s2 é da Sala OpenAI (ao lado da Anthropic) ou de um jardim: outro módulo não
// entra nela (antes o MCP ocupava e a Sala OpenAI ia parar longe).
const VAGA_OPENAI = 2;
function lugaresLivres(lado, tipo) {
  const ocup = ocupacaoDoLado(lado);
  const livres = [];
  for (let k = VAGAS_NUCLEO; k < VAGAS_POR_LADO; k++) {
    if (lado === 's' && k === VAGA_OPENAI && tipo !== 'controle-openai') continue;
    if (k >= K_DOBRA && !DOBRA_OK.has(tipo)) continue;
    if (!vagaTomavel(ocup, k)) continue;
    livres.push({ lado, vaga: k, jardim: ocup[k] || null });
  }
  return livres;
}

// Vagas guardadas para uma sala de pasta crescer: as vagas logo depois da ponta de fora
// de cada sala de pasta (duas para a sala do Estúdio, a da primeira pasta, que é a que
// mais cresce; uma para as outras). Sala de pasta nova evita entrar nelas; os outros
// módulos entram em vez de deixar um buraco (escolherVaga) e dão passagem depois.
function vagasGuardadas() {
  const guardadas = new Set(vagasDosServidores());
  for (const p of pastasComSala()) {
    const run = trechoDaSala(p);
    if (!run) continue;
    const ocup = ocupacaoDoLado(run.lado);
    const n = estudio?.pasta === p ? 2 : 1;
    for (let k = run.kMax + 1; k <= run.kMax + n && k < VAGAS_POR_LADO; k++) {
      if (!vagaTomavel(ocup, k) || !contiguas(run.lado, k, run.kMax)) break;
      guardadas.add(run.lado + k);
    }
  }
  return guardadas;
}

// ---------------------------------------------------------------------------
// Sala dos servidores modular (F2, 03/10): a base é do núcleo (s3) e as extensões
// ('servidores:2', 'servidores:3', m.extensao) acoplam coladas nela, para fora, quando
// os racks não cabem (sala-servidores.js decide quantas)
// ---------------------------------------------------------------------------
const baseServidores = () => porChave.get('nucleo:servidores') || null;
// extensões vivas, da base para fora (vaga base+1, base+2...)
function extensoesServidores() {
  const base = baseServidores();
  if (!base) return [];
  const ocup = ocupacaoDoLado(base.lado), lista = [];
  for (let k = base.vaga + 1; k < VAGAS_POR_LADO; k++) {
    const m = ocup[k];
    if (!m || m.tipo !== 'servidores' || !m.extensao || !vivo(m)) break;
    lista.push(m);
  }
  return lista;
}
const extensoesPedidasServidores = () => Math.max(0, baseServidores()?.salaNova?.extensoesNecessarias?.() ?? 0);
// Vagas que a sala dos servidores vai tomar para crescer (outro módulo não entra nelas)
// Enquanto a primeira leitura de /api/servidores não chega, a vaga colada na base fica
// guardada (verificação v0.6: no ?simular=10 o MCP acoplava na s4 na primeira leitura e
// os racks ficavam espremidos a 30% enquanto ele tivesse gente)
function vagasDosServidores() {
  const base = baseServidores();
  if (!base) return [];
  const exts = extensoesServidores();
  const provisoria = E.salasAguardando?.has?.('servidores') && !E.salasDados?.servidores ? 1 : 0;
  const faltam = Math.max(provisoria, extensoesPedidasServidores()) - exts.length;
  const ocup = ocupacaoDoLado(base.lado), vagas = [];
  for (let k = base.vaga + 1 + exts.length, n = 0; n < faltam && k < VAGAS_POR_LADO; k++, n++) {
    if (!vagaTomavel(ocup, k)) break;
    vagas.push(base.lado + k);
  }
  return vagas;
}
// Vaga colada na ponta de fora da sala dos servidores
function vagaColadaServidores() {
  const base = baseServidores();
  if (!base) return null;
  const k = base.vaga + 1 + extensoesServidores().length;
  if (k >= VAGAS_POR_LADO) return null;
  const ocup = ocupacaoDoLado(base.lado);
  return vagaTomavel(ocup, k) ? { lado: base.lado, vaga: k, jardim: ocup[k] || null } : null;
}
// Diz à base quantas extensões estão prontas e se ela está travada (precisa crescer e
// não tem vaga): os racks se arrumam (ou encolhem) para caber
function informarServidores() {
  const base = baseServidores();
  if (!base?.salaNova?.definirExtensoes) return;
  let prontas = 0;
  for (const m of extensoesServidores()) { if (m.estado !== 'pronto') break; prontas++; }
  const pedidas = extensoesPedidasServidores();
  const travado = prontas < pedidas && [...semVaga.keys()].some(c => String(c).startsWith('servidores:'));
  base.salaNova.definirExtensoes(prontas, travado);
}
// A sala dos servidores precisa crescer e a vaga colada nela está com outro módulo (que
// acoplou antes de os racks pedirem, por exemplo uma sala de pasta na primeira leitura):
// esse módulo, quando estiver vazio, muda de vaga como na compactação (desacopla e acopla
// noutra, com a animação de sempre) e a extensão entra no lugar dele. Enquanto ele tem
// gente, os racks esperam encolhidos. Pedido do Eduardo (03/10): a sala cresce conforme
// os servidores, em vez de espremer os racks.
function abrirCaminhoServidores(agoraMs) {
  const base = baseServidores();
  if (!base || filaAcoplar.length) return false;
  const exts = extensoesServidores();
  const pedidas = extensoesPedidasServidores();
  if (pedidas <= exts.length) return false;
  const k = base.vaga + 1 + exts.length;
  if (k >= VAGAS_POR_LADO) return false;
  const o = ocupacaoDoLado(base.lado)[k];
  if (!o || o.tipo === 'jardim' || o.estado !== 'pronto' || !o.chave || o.fixo || o.nucleo || o.vaga !== k) return false;
  if (o.tipo === 'servidores' || (ehSala(o) && modulosDaPasta(o.pasta).length > 1)) return false;
  if (!moduloVazio(o)) return false;
  // o destino não pode ser uma das vagas que a sala dos servidores vai tomar
  const evitar = new Set();
  for (let j = k; j <= base.vaga + pedidas && j < VAGAS_POR_LADO; j++) evitar.add(base.lado + j);
  const destino = escolherVaga(o.tipo, evitar);
  if (!destino) return false;
  o.mudarPara = { lado: destino.lado, vaga: destino.vaga };
  registrar('dar-passagem', o, agoraMs);
  iniciarDesacoplar(o, agoraMs);
  return true;
}
// Vagas coladas na ponta de fora das salas de pasta que querem crescer agora (o pedido da
// extensão ficou sem vaga nesta versão da planta): ninguém novo entra nelas
function vagasQueSalasQuerem() {
  const vagas = new Set();
  for (const p of pastasComSala()) {
    if (convidados.has(p) || ![...semVaga].some(([c, v]) => v === versaoPlanta && String(c).startsWith('ilha:' + p + ':'))) continue;
    const run = trechoDaSala(p);
    if (run.kMax + 1 < VAGAS_POR_LADO && contiguas(run.lado, run.kMax + 1, run.kMax)) vagas.add(run.lado + (run.kMax + 1));
  }
  return vagas;
}

// Sala de pasta que precisa crescer (o pedido da extensão ficou sem vaga) e a vaga
// colada na ponta de fora dela está com um módulo que não é sala de pasta (Missão,
// Oficina, MCP...): como nos servidores, esse módulo, vazio, muda de vaga com a animação
// de sempre e a extensão entra no lugar dele (verificação v0.6, par da regra do buraco
// em escolherVaga: a vaga guardada não fica mais como jardim esperando a sala crescer).
function abrirCaminhoSalas(agoraMs) {
  if (filaAcoplar.length) return false;
  for (const vk of vagasQueSalasQuerem()) {
    const lado = vk[0], k = Number(vk.slice(1));
    if (lado === 's' && k === VAGA_OPENAI) continue;
    const o = ocupacaoDoLado(lado)[k];
    if (!o || o.tipo === 'jardim' || o.estado !== 'pronto' || !o.chave || o.fixo || o.nucleo || o.vaga !== k) continue;
    if (o.tipo === 'servidores' || ehSala(o) || !moduloVazio(o)) continue;
    const destino = escolherVaga(o.tipo, new Set([vk]));
    if (!destino) continue;
    o.mudarPara = { lado: destino.lado, vaga: destino.vaga };
    registrar('dar-passagem', o, agoraMs);
    iniciarDesacoplar(o, agoraMs);
    return true;
  }
  return false;
}

// Extensão que pode sair: a de fora, sem rack e sem o técnico dentro
function podeSairServidores(m) {
  const exts = extensoesServidores();
  const i = exts.indexOf(m);
  if (i < 0 || i !== exts.length - 1) return false;
  return !!baseServidores()?.salaNova?.extensaoVazia?.(i + 1);
}

// Primeiro jardim ou vaga livre perto da porta, no lado preferido e depois no outro,
// pulando as vagas guardadas para uma sala crescer. Sala de pasta nova prefere uma vaga
// com a vizinha de fora livre (para crescer) e que não encoste noutra sala de pasta.
// Missão, Oficina e Biblioteca só cabem no norte (com o norte cheio, esperam vaga).
// Verificação v0.6 (03/10, "enchimento só quando precisa", OBRIGATÓRIO): ir além de uma
// vaga livre do mesmo lado deixa um buraco que vira jardim (era o caso da Missão na n6
// com jardins na n4 e na n5, guardadas para o Estúdio crescer). Por isso o buraco pesa
// mais que a guarda da sala de pasta: o módulo que não é sala de pasta toma a vaga
// guardada e, quando a sala precisar crescer, dá passagem (abrirCaminhoSalas). As vagas
// da sala dos servidores continuam fora de alcance, salvo sem alternativa nenhuma.
function escolherVaga(tipo, evitar = null) {
  const pref = LADO_PREFERIDO[tipo] || 'n';
  const guardadas = vagasGuardadas();
  const dosServidores = new Set([...vagasDosServidores(), ...vagasQueSalasQuerem()]);
  // sala de pasta nova segue as preferências próprias (vizinha livre para crescer); um
  // buraco que ela deixa vira jardim só até a compactação
  const pesoBuraco = tipo === 'ilha' ? 0 : 60;
  let melhor = null, nota = Infinity;
  const lados = SO_NO_NORTE.has(tipo) ? ['n'] : [pref, pref === 'n' ? 's' : 'n'];
  lados.forEach((lado, iLado) => {
    const ocup = ocupacaoDoLado(lado);
    const livres = lugaresLivres(lado, tipo);
    for (const l of livres) {
      if (evitar?.has(lado + l.vaga)) continue;
      // os dois lados enchem por igual (03/10: com 120 astronautas o sul ia até a ponta e o
      // norte virava uma fileira de jardins); o lado preferido só desempata
      let n = l.vaga + iLado * 1.5;
      if (dosServidores.has(lado + l.vaga)) n += 200;
      else if (guardadas.has(lado + l.vaga)) n += 40;
      if (livres.some(o => o.vaga < l.vaga && !dosServidores.has(lado + o.vaga) && !evitar?.has(lado + o.vaga))) n += pesoBuraco;
      if (tipo === 'ilha') {
        if (!(l.vaga + 1 < VAGAS_POR_LADO && vagaTomavel(ocup, l.vaga + 1))) n += 6;
        if (ehSala(ocup[l.vaga - 1])) n += 4;
      }
      if (n < nota) { nota = n; melhor = l; }
    }
  });
  return melhor;
}

function naPonta(m) {
  for (const o of modulos.values()) if (o !== m && o.lado === m.lado && o.vaga > m.vaga) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Salas de pasta
// ---------------------------------------------------------------------------
const ehSala = m => !!m && (m.tipo === 'estudio' || m.tipo === 'ilha');
const pastaDe = m => (ehSala(m) ? m.pasta : null);
const vivo = m => m.estado !== 'desacoplando' && m.estado !== 'removido';

// Módulos da sala da pasta (Estúdio e módulos 'ilha' com essa pasta)
function modulosDaPasta(p) {
  const lista = [];
  for (const m of modulos.values()) if (ehSala(m) && m.pasta === p && vivo(m)) lista.push(m);
  return lista.sort((a, b) => a.vaga - b.vaga);
}

function pastasComSala() {
  const s = new Set();
  for (const m of modulos.values()) if (ehSala(m) && m.pasta && vivo(m)) s.add(m.pasta);
  return s;
}

// Trecho contíguo da sala no lado: { lado, kMin, kMax } (null sem sala)
function trechoDaSala(p) {
  const ms = modulosDaPasta(p);
  if (!ms.length) return null;
  return { lado: ms[0].lado, kMin: Math.min(...ms.map(m => m.vaga)), kMax: Math.max(...ms.map(m => m.vaga + m.nVagas - 1)) };
}

// Vaga colada na sala para ela crescer: primeiro a de fora (esquerda), depois a de dentro
function vagaColada(p) {
  const run = trechoDaSala(p);
  if (!run) return null;
  const ocup = ocupacaoDoLado(run.lado);
  const opcoes = [run.kMax + 1, run.kMin - 1];
  for (const k of opcoes) {
    if (k < VAGAS_NUCLEO || k >= VAGAS_POR_LADO) continue;
    if (!contiguas(run.lado, k, k === run.kMax + 1 ? run.kMax : run.kMin)) continue;
    if (run.lado === 's' && k === VAGA_OPENAI) continue;
    if (vagaTomavel(ocup, k)) return { lado: run.lado, vaga: k, jardim: ocup[k] || null };
  }
  return null;
}

// Grupo de fusão: os módulos da mesma pasta (sala de pasta) ou os da sala dos
// servidores (base e extensões) são um cômodo só
const grupoDeFusao = m => (!m ? null : ehSala(m) ? (m.pasta ? 'pasta:' + m.pasta : null) : m.tipo === 'servidores' ? 'servidores' : null);

// Funde o módulo com o vizinho de fora (esquerda) quando os dois são do mesmo grupo:
// a divisória entre eles some (cai no chão em 0,4 s) e sai do mapa
function atualizarFusoes(instantaneo = false) {
  let mudou = false;
  for (const m of modulos.values()) {
    if (!m.divisoriaEsq) continue;
    // vizinho do lado oeste (onde fica a divisória da esquerda): na perna A é a vaga
    // seguinte; na perna B (que volta para leste) é a anterior; na curva, ninguém
    const kViz = m.dobrado ? m.vaga - 1 : m.vaga + m.nVagas;
    const viz = mesmaPerna(kViz, m.vaga) ? ocupacaoDoLado(m.lado)[kViz] : null;
    const g = grupoDeFusao(m);
    const fundir = !!g && vivo(m) && !!viz && vivo(viz) && grupoDeFusao(viz) === g;
    if (fundir === m.fundido) continue;
    m.fundido = fundir;
    mudou = true;
    animarDivisoria(m, fundir, instantaneo);
  }
  // pela curva (lado sul): a primeira sala da perna B some com as costas quando é da
  // mesma sala que a última da perna A
  for (const m of modulos.values()) {
    if (!m.costas) continue;
    const viz = m.lado === 's' && m.vaga === K_DOBRA ? ocupacaoDoLado('s')[K_DOBRA - 1] : null;
    const g = grupoDeFusao(m);
    const fundir = !!g && vivo(m) && !!viz && vivo(viz) && grupoDeFusao(viz) === g;
    if (fundir === !!m.fundidoCostas) continue;
    m.fundidoCostas = fundir;
    mudou = true;
    animarParede(m.costas, 'mod:' + m.id + ':costas', fundir, instantaneo || m.estado !== 'pronto');
  }
  if (mudou) { mapaSujo = true; E.sombraSuja = true; E.sujo = true; }
}

function animarParede(d, k, esconder, instantaneo) {
  const b = d.userData.base;
  cancelarTweens(k);
  if (instantaneo) { d.visible = !esconder; d.scale.y = esconder ? 0.02 : b.s.y; return; }
  d.visible = true;
  tween({ obj: d, prop: 'scale.y', para: esconder ? 0.02 : b.s.y, dur: 0.4, ease: esconder ? 'easeInCubic' : 'easeOutCubic', chave: k,
    aoFim: esconder ? () => { d.visible = false; } : undefined });
}

function animarDivisoria(m, esconder, instantaneo) {
  const d = m.divisoriaEsq, b = d.userData.base;
  const k = 'mod:' + m.id + ':divisoria';
  cancelarTweens(k);
  if (instantaneo || m.estado !== 'pronto') {
    d.visible = !esconder;
    d.scale.y = esconder ? 0.02 : b.s.y;
    return;
  }
  d.visible = true;
  tween({ obj: d, prop: 'scale.y', para: esconder ? 0.02 : b.s.y, dur: 0.4, ease: esconder ? 'easeInCubic' : 'easeOutCubic', chave: k,
    aoFim: esconder ? () => { d.visible = false; } : undefined });
}

// Placa com o nome da pasta (uma por sala, no módulo-base) e plaquinhas das agências
function atualizarPlacas(agora = relogioEstacao()) {
  const conv = new Map();
  for (const id of convidados.values()) conv.set(id, (conv.get(id) || 0) + 1);
  for (const m of modulos.values()) {
    if (!ehSala(m) || !m.placaSala) continue;
    const p = m.pasta;
    // a base e a cabeça de cada pedaço separado da sala (anexo): uma placa por pedaço
    const kAnt = m.dobrado ? m.vaga + m.nVagas : m.vaga - 1;
    const antes = contiguas(m.lado, kAnt, m.vaga) ? ocupacaoDoLado(m.lado)[kAnt] : null;
    const cabeca = !m.fundidoCostas && !(antes && antes.pasta === p && ehSala(antes));
    const base = p && (baseDaPasta(p) === m || cabeca);
    const ativa = base && m.estado === 'pronto' && (agora - (usoPasta.get(p) ?? -Infinity) <= RESERVA_MS || m.colunas.some(c => c.estado !== 'vazia'));
    const n = conv.get(m.id) || 0;
    m.placaSala.definir(ativa ? nomeDaPasta(p) + (n ? ' +' + n : '') : null);
  }
}

function baseDaPasta(p) {
  if (estudio?.pasta === p) return estudio;
  const m = porChave.get('ilha:' + p);
  return m && vivo(m) ? m : null;
}

// Plaquinha com o nome da sessão no primeiro (lado da porta) de cada conjunto e ponte
// de divisória quando as duas colunas do módulo são da mesma sessão
function atualizarConjuntos(m) {
  const [c0, c1] = m.colunas;
  if (!c0 || !c1) return;
  const viva = c => c.estado === 'acoplando' || c.estado === 'pronta';
  const mesma = viva(c0) && viva(c1) && c0.sessao && c0.sessao === c1.sessao;
  if (m.ponte && m.ponte.visible !== mesma) { m.ponte.visible = mesma; E.sombraSuja = true; }
  // c1 fica do lado da porta (x maior): é a primeira do conjunto quando as duas são dele
  for (const c of m.colunas) {
    const primeira = viva(c) && !(mesma && c === c0);
    mostrarNaPlaca(c.placa, primeira ? nomeDaPlaquinha(c.nome) : null);
  }
  E.sujo = true;
}

// ---------------------------------------------------------------------------
// Colunas (conjuntos de mesas por sessão)
// ---------------------------------------------------------------------------
const colunaViva = c => c.estado === 'acoplando' || c.estado === 'pronta';

// Alguém sentado, a caminho ou levantando de uma mesa da coluna (e, com contarCasa,
// quem tem a casa nela e está em outra sala)
function colunaOcupada(c, contarCasa = true) {
  for (const v of c.vagas) if (v.ocupada || (contarCasa && v.casaDe)) return true;
  for (const a of E.agentes.values()) {
    if ([a.vaga, a.vagaRota, a.assento, a.saindoDe, contarCasa ? a.casa : null].some(v => v && v.coluna === c)) return true;
  }
  return false;
}

// Algum astronauta em cima do lugar da coluna (os móveis dela, com o raio do corpo e
// uma sobra)? A coluna não brota em cima de ninguém: espera ele passar.
function alguemNaColuna(c) {
  const dx = c.modulo.grupo.position.x, dz = c.modulo.grupo.position.z, m = 0.38;
  for (const a of E.agentes.values()) {
    if (a.aguardandoEntrada || !a.boneco) continue;
    const p = a.boneco.position;
    for (const r of c.rects) {
      if (p.x > r.xa + dx - m && p.x < r.xb + dx + m && p.z > r.za + dz - m && p.z < r.zb + dz + m) return true;
    }
  }
  return false;
}

function ativarColuna(c, sessao, agencia, agora, nome = null) {
  c.sessao = sessao;
  c.agencia = agencia;
  c.nome = nome;
  c.sobra = false;
  c.livreDesde = agora;
  if (colunaViva(c)) { atualizarConjuntos(c.modulo); return; }
  if (c.estado === 'desacoplando') return;   // ainda recolhendo: a próxima leitura tenta de novo
  c.estado = 'acoplando';
  for (const v of c.vagas) v.removida = false;
  const g = c.grupo, k = 'coluna:' + c.id;
  g.visible = true;
  tween({ obj: g, prop: 'scale.y', de: 0.001, para: 1, dur: DUR_COLUNA_SOBE, ease: 'easeOutBack', chave: k,
    aoFim: () => { if (c.estado === 'acoplando') { c.estado = 'pronta'; E.sombraSuja = true; E.sujo = true; } } });
  mapaSujo = true;
  atualizarConjuntos(c.modulo);
}

function desativarColuna(c) {
  if (!colunaViva(c)) return;
  c.estado = 'desacoplando';
  for (const v of c.vagas) {
    v.removida = true;
    if (v.timerApoio) { clearTimeout(v.timerApoio); v.timerApoio = null; }
  }
  const g = c.grupo, k = 'coluna:' + c.id;
  mapaSujo = true;   // as mesas saem das salas já agora (os móveis ainda bloqueiam)
  atualizarConjuntos(c.modulo);
  tween({ obj: g, prop: 'scale.y', para: 0.001, dur: DUR_COLUNA_DESCE, ease: 'easeInCubic', chave: k,
    aoFim: () => {
      if (c.estado !== 'desacoplando') return;
      c.estado = 'vazia';
      c.sessao = null;
      c.agencia = null;
      c.nome = null;
      g.visible = false;
      for (const v of c.vagas) if (v._posto) { v._posto = false; v.definirPosto?.(false, { instantaneo: true }); }
      mapaSujo = true;
      E.sombraSuja = true;
      E.sujo = true;
    } });
}

// Colunas de uma lista de módulos, do lado da porta (x maior) para o fundo
function colunasDe(ms) {
  return ms.flatMap(m => m.colunas).sort((a, b) => (b.modulo.grupo.position.x + b.x) - (a.modulo.grupo.position.x + a.x));
}
const xColuna = c => c.modulo.grupo.position.x + c.x;

// A melhor coluna livre para a sessão: colada nas que ela já tem (mesmo módulo
// primeiro), senão a primeira do lado da agência (Claude Code do lado da porta,
// Codex do fundo), preferindo um módulo sem ninguém
function escolherColuna(livres, minhas, agencia, todas) {
  if (!livres.length) return null;
  if (minhas.length) {
    const doModulo = livres.find(c => minhas.some(o => o.modulo === c.modulo));
    if (doModulo) return doModulo;
    let melhor = null, d = Infinity;
    for (const c of livres) {
      const dc = Math.min(...minhas.map(o => Math.abs(xColuna(o) - xColuna(c))));
      if (dc < d) { d = dc; melhor = c; }
    }
    return melhor;
  }
  const ordem = agencia === 'openai' ? [...livres].reverse() : livres;
  // módulo inteiro livre primeiro (conjunto separado das outras sessões)
  const moduloLivre = c => todas.filter(o => o.modulo === c.modulo).every(o => o.estado === 'vazia' || o === c || (!o.sessao && o.estado !== 'desacoplando'));
  return ordem.find(moduloLivre) || ordem[0];
}

// Distribui as colunas da pasta entre as sessões. sessoes: Map id -> { n, agencia }.
// Devolve quantas colunas faltaram (sem lugar na sala).
function distribuirColunas(ms, sessoes, agora) {
  const todas = colunasDe(ms);
  // ocupação e folga de cada coluna (a casa de quem está em outra sala não segura a
  // coluna: item 6, o conjunto só existe enquanto alguém dele precisa de mesa)
  for (const c of todas) if (colunaViva(c) && colunaOcupada(c, false)) c.livreDesde = agora;
  // colunas que sobram: sessão que acabou ou equipe que encolheu
  const porSessao = new Map();
  for (const c of todas) {
    if (!colunaViva(c) || !c.sessao) continue;
    if (!sessoes.has(c.sessao)) { c.sobra = true; continue; }
    if (!porSessao.has(c.sessao)) porSessao.set(c.sessao, []);
    porSessao.get(c.sessao).push(c);
  }
  let faltam = 0;
  const pedidosNovos = [];
  for (const [sessao, info] of sessoes) {
    const minhas = porSessao.get(sessao) || [];
    for (const c of minhas) if (info.nome && c.nome !== info.nome) c.nome = info.nome;   // a sessão mudou de nome
    const quero = todasAsColunas ? 0 : Math.ceil(info.n / 2);
    // equipe encolheu: as colunas sem ninguém (as de fora primeiro) viram sobra
    const ativas = minhas.filter(c => !c.sobra);
    if (ativas.length > quero) {
      const sobrando = ativas.filter(c => !colunaOcupada(c)).sort((a, b) => xColuna(a) - xColuna(b));
      for (const c of sobrando.slice(0, ativas.length - quero)) c.sobra = true;
    }
    let tenho = minhas.filter(c => !c.sobra).length;
    // voltou a precisar: a sobra da própria sessão volta a valer
    for (const c of minhas) { if (tenho >= quero) break; if (c.sobra) { c.sobra = false; c.livreDesde = agora; tenho++; } }
    if (tenho < quero) pedidosNovos.push({ sessao, info, falta: quero - tenho, minhas: minhas.filter(c => !c.sobra) });
  }
  // colunas novas: sessões mais antigas (maior equipe) primeiro
  pedidosNovos.sort((a, b) => b.info.n - a.info.n || String(a.sessao).localeCompare(String(b.sessao)));
  for (const p of pedidosNovos) {
    for (let k = 0; k < p.falta; k++) {
      const livres = todas.filter(c => c.estado === 'vazia' && c.modulo.registrado && vivo(c.modulo) && !alguemNaColuna(c));
      const c = escolherColuna(livres, p.minhas, p.info.agencia, todas);
      if (!c) { faltam += p.falta - k; break; }
      ativarColuna(c, p.sessao, p.info.agencia, agora, p.info.nome);
      p.minhas.push(c);
    }
  }
  // recolhe a sobra sem ninguém e sem uso há COLUNA_FOLGA_MS; a casa de quem está em
  // outra sala é devolvida (quando ele voltar, o conjunto da sessão brota de novo)
  for (const c of todas) {
    if (!colunaViva(c) || todasAsColunas) continue;
    if (!c.sobra && c.sessao) continue;
    if (colunaOcupada(c, false)) continue;
    if (agora - c.livreDesde <= COLUNA_FOLGA_MS * FATOR_FOLGA) continue;
    for (const v of c.vagas) if (v.casaDe) ganchos.soltarCasa?.(v.casaDe);
    if (!colunaOcupada(c)) desativarColuna(c);
  }
  for (const m of ms) atualizarConjuntos(m);
  return faltam;
}

// Para os testes (bateria de caminhos com as salas cheias): mostra todas as colunas
// das salas de pasta (true) ou volta ao normal (false)
export function mostrarTodasAsColunas(ligar = true) {
  todasAsColunas = !!ligar;
  const agora = relogioEstacao();
  for (const m of modulos.values()) {
    if (!ehSala(m) || !vivo(m) || !m.registrado) continue;
    for (const c of m.colunas) {
      if (ligar && c.estado === 'vazia' && !alguemNaColuna(c)) ativarColuna(c, '__teste:' + c.id, 'anthropic', agora, 'Sessão de teste');
      else if (!ligar && String(c.sessao).startsWith('__teste:') && !colunaOcupada(c)) desativarColuna(c);
    }
  }
}

// Para os testes: o Estúdio passa a ser da pasta (como se ela tivesse chegado agora),
// para conferir a sala do Estúdio fundida com os módulos dela
export function reservarEstudio(pasta) {
  if (!estudio || !pasta) return;
  estudio.pasta = pasta;
  E.ilhaPorPasta.set(pasta, estudio.id);
  usoPasta.set(pasta, relogioEstacao());
  primeiraVezPasta.set(pasta, relogioEstacao());
  atualizarFusoes();
  mapaSujo = true;
}

// Sessão dona do conjunto do agente (a própria sessão, ou a mãe do subagente)
export function sessaoDoAgente(id) { return raizes.get(id) ?? id; }

// Limites dos módulos da sala da pasta (agentes.js: lugar em pé perto do conjunto)
export function partesDaPasta(p) {
  const ms = modulosDaPasta(p);
  return (ms.length ? ms : estudio ? [estudio] : []).map(limites);
}

// ---------------------------------------------------------------------------
// Quem está num módulo (ninguém pode estar quando ele desacopla)
// ---------------------------------------------------------------------------
function dentroDoModulo(m, p) {
  if (!p) return false;
  if (p.x < m.x0 - 0.05 || p.x > m.x1 + 0.05) return false;
  if (m.lado === 'n' ? p.z < -CORR + 0.05 : p.z > CORR - 0.05) return true;
  // na soleira da porta, do lado do corredor (entrando ou saindo): ainda conta
  return !!m.porta && Math.abs(p.x - m.porta.x) < VAO / 2 + 0.3 && (m.lado === 'n' ? p.z < -CORR + 0.6 : p.z > CORR - 0.6);
}

function ocupantes(m) {
  const quem = new Set();
  for (const v of m.vagas) {
    if (v.ocupada) quem.add(v.ocupada);
    if (v.casaDe) quem.add(v.casaDe);
  }
  for (const a of E.agentes.values()) {
    if ([a.vaga, a.vagaRota, a.casa, a.assento, a.saindoDe].some(v => v?.modulo === m)) { quem.add(a); continue; }
    if (['mcp', 'api', 'revisao', 'oficina', 'biblioteca'].includes(m.sala) && (a.alvo === m.sala || a.salaDestino === m.sala)) { quem.add(a); continue; }
    if (!a.aguardandoEntrada && dentroDoModulo(m, a.boneco?.position)) { quem.add(a); continue; }
    if (a.alvo !== 'fora' && dentroDoModulo(m, a.destinoFinal)) { quem.add(a); continue; }
    if (a.vaga && !a.vaga.modulo && dentroDoModulo(m, a.vaga.pos)) quem.add(a);   // em pé (extra, ponto, conversa)
  }
  return [...quem];
}
const moduloVazio = m => ocupantes(m).length === 0 && m.colunas.every(c => c.estado === 'vazia');

// ---------------------------------------------------------------------------
// Planejamento: chamado a cada leitura com os agentes que estão dentro
// ---------------------------------------------------------------------------
export function planejarEstacao(lista, agora = relogioEstacao()) {
  if (!estudio) return;
  atualizarDono(E.dados?.dono?.nome ?? null);
  const pedidos = new Set();
  const pedir = (chave, tipo, extra = {}) => {
    pedidos.add(chave);
    const m = porChave.get(chave);
    if (m && m.estado !== 'desacoplando') { m.ultimoUso = agora; return; }
    // teto: o pedido que não coube só volta depois que algum módulo sair
    if (semVaga.has(chave) && semVaga.get(chave) === versaoPlanta) return;
    semVaga.delete(chave);
    if (!filaAcoplar.some(p => p.chave === chave)) filaAcoplar.push({ chave, tipo, ...extra });
  };
  const ids = new Set(lista.map(d => d.id));
  const porId = new Map(lista.map(d => [d.id, d]));
  // ativo: trabalhando, esperando ou ainda no relógio de 60 s na mesa
  const ativo = d => d.atividade !== 'descansar' || !!E.agentes.get(d.id)?.relogioAtivo;

  // sessão dona de cada agente (a mãe do subagente, subindo até a sessão)
  raizes.clear();
  for (const d of lista) {
    let r = d, passos = 0;
    while (r.tipo === 'subagente' && r.pai && passos++ < 8) {
      const pai = porId.get(r.pai);
      if (!pai) { r = { id: r.pai }; break; }
      r = pai;
    }
    raizes.set(d.id, r.id);
  }

  // (e) Sala OpenAI: enquanto houver Codex na máquina
  if (E.dados?.provedores?.codex || lista.some(d => d.provedor === 'openai')) pedir('controle:openai', 'controle-openai');

  // (a) salas de pasta e conjuntos por sessão. Na equipe da sessão (as mesas do
  // conjunto) conta só quem precisa de mesa agora (item 6 de 03/10): quem está na
  // pesquisa, no MCP, na API, na oficina, na biblioteca, numa fila ou no descanso não
  // deixa mesa vazia à mostra (nem a sala de uma pasta sem ninguém na mesa). A casa
  // dele aguenta COLUNA_FOLGA_MS (uma chamada rápida de conector volta para a mesma mesa)
  if (todasAsColunas) mostrarTodasAsColunas(true);
  const precisaMesa = d => {
    const a = E.agentes.get(d.id);
    if (d.pendencia) return false;
    if (d.atividade === 'conector') return semVagaPara(d.conectorTipo === 'api' ? 'api' : 'mcp');
    return ['editar', 'coordenar', 'esperar'].includes(d.atividade) || (d.atividade === 'descansar' && !!a?.relogioAtivo);
  };
  const equipes = new Map();   // pasta -> Map(sessão -> { n, agencia })
  const pastasAtivas = new Set();
  for (const d of lista) {
    const p = d.pastaCaminho;
    if (!p || !ativo(d)) continue;
    if (!primeiraVezPasta.has(p)) primeiraVezPasta.set(p, agora);
    usoPasta.set(p, agora);
    pastasAtivas.add(p);
    if (!precisaMesa(d)) continue;
    if (!equipes.has(p)) equipes.set(p, new Map());
    const sid = raizes.get(d.id) ?? d.id;
    const eq = equipes.get(p);
    if (!eq.has(sid)) {
      const raiz = porId.get(sid);
      eq.set(sid, { n: 0, agencia: (raiz || d).provedor === 'openai' ? 'openai' : 'anthropic', nome: raiz?.nome || (d.tipo === 'sessao' ? d.nome : null) });
    }
    eq.get(sid).n++;
  }
  const pastas = [...equipes.keys()].sort((a, b) => primeiraVezPasta.get(a) - primeiraVezPasta.get(b));
  // o Estúdio fica livre 30 s depois do último uso da pasta dele, com as colunas recolhidas
  if (estudio.pasta && !pastasAtivas.has(estudio.pasta) && agora - (usoPasta.get(estudio.pasta) ?? -Infinity) > RESERVA_MS
    && estudio.colunas.every(c => c.estado === 'vazia') && !ocupantes(estudio).some(a => a.vaga?.coluna || a.casa?.coluna)) {
    if (E.ilhaPorPasta.get(estudio.pasta) === estudio.id) E.ilhaPorPasta.delete(estudio.pasta);
    estudio.pasta = null;
    atualizarFusoes();
  }
  if (!estudio.pasta) {
    // a próxima pasta nova (sem sala própria) fica com o Estúdio
    const nova = pastas.find(p => !salaPropria(p));
    if (nova) {
      estudio.pasta = nova;
      E.ilhaPorPasta.set(nova, estudio.id);
      convidados.delete(nova);
      const i = filaAcoplar.findIndex(q => q.chave === 'ilha:' + nova);
      if (i >= 0) filaAcoplar.splice(i, 1);   // ia acoplar um módulo: o Estúdio vem antes
      atualizarFusoes();
    }
  }
  const pastasDasSalas = new Set([...pastas, ...pastasComSala()]);
  for (const p of pastasDasSalas) {
    const eq = equipes.get(p) || new Map();
    const ativa = equipes.has(p);
    if (ativa && estudio.pasta !== p) {
      const conv = convidados.get(p);
      if (conv && modulos.get(conv)) modulos.get(conv).ultimoUso = agora;
      pedir('ilha:' + p, 'ilha', { pasta: p });
    }
    // a sala (ou a que a recebe, no teto) e as colunas de cada sessão
    let ms = modulosDaPasta(p).filter(m => m.registrado);
    const conv = convidados.get(p) && modulos.get(convidados.get(p));
    if (!ms.length && conv) ms = [conv];
    const faltam = ms.length ? distribuirColunas(ms, eq, agora) : 0;
    // módulos da sala que seguram colunas continuam pedidos (a sala não encolhe com gente)
    for (const m of modulosDaPasta(p)) {
      if (m.chave && (m.colunas.some(c => c.estado !== 'vazia') || (m.chave === 'ilha:' + p && ativa))) pedir(m.chave, 'ilha', { pasta: p });
    }
    // sem coluna livre para alguma sessão: a sala cresce um módulo, colado nela
    if (faltam > 0 && ativa && ms.length && !convidados.has(p)) {
      const ks = modulosDaPasta(p).map(m => Number(String(m.chave).split(':').pop()) || 1);
      const proximo = Math.max(1, ...ks.map(k => (Number.isFinite(k) ? k : 1))) + 1;
      const pendente = filaAcoplar.find(q => q.tipo === 'ilha' && q.pasta === p && q.extensao);
      pedir(pendente ? pendente.chave : 'ilha:' + p + ':' + proximo, 'ilha', { pasta: p, extensao: true });
    }
  }
  // pastas que saíram: as do Estúdio e as convidadas não seguram nada
  for (const p of [...convidados.keys()]) if (!equipes.has(p) && agora - (usoPasta.get(p) ?? -Infinity) > RESERVA_MS) convidados.delete(p);

  // (b) conectores: MCP e API
  let mcp = false, api = false;
  for (const d of lista) {
    if (d.atividade !== 'conector' || !d.conector) continue;
    const tipo = d.conectorTipo === 'api' ? 'api' : 'mcp';
    E.salaPorConector.set(d.conector, { tipo, uso: agora });
    if (tipo === 'api') api = true; else mcp = true;
  }
  if (mcp) pedir('mcp', 'mcp');
  if (api) pedir('api', 'api');

  // (c) pesquisa: 2 ou mais pesquisando há mais de 5 s
  for (const d of lista) {
    if (d.atividade === 'pesquisar') { if (!inicioPesquisa.has(d.id)) inicioPesquisa.set(d.id, agora); }
    else inicioPesquisa.delete(d.id);
  }
  for (const id of [...inicioPesquisa.keys()]) if (!ids.has(id)) inicioPesquisa.delete(id);
  let pesquisando = 0;
  for (const t of inicioPesquisa.values()) if (agora - t > PESQUISA_MIN_MS) pesquisando++;
  if (pesquisando >= 2) pedir('pesquisa', 'pesquisa');

  // (d) descanso: 6 ou mais descansando (fora do relógio)
  // (quem espera na mesa porque o descanso lotou também conta: é para ele que o módulo vem)
  const descansando = lista.filter(d => d.atividade === 'descansar' && (!E.agentes.get(d.id)?.relogioAtivo || E.agentes.get(d.id)?.esperaDescanso)).length;
  if (descansando >= DESCANSO_MIN) pedir('descanso', 'descanso');

  // (f) revisão (rodada 6): alguma sessão terminou com uma sugestão
  if (lista.some(d => d.pendencia === 'entrega_com_sugestao' && d.tipo !== 'subagente')) pedir('revisao', 'revisao');

  // (g) salas novas (F1), pelos dados das rotas /api/missao, /api/oficina e /api/memoria
  // (sala-modulos.js guarda em E.salasDados): missão com workflow em andamento, oficina
  // com alguém travado, biblioteca com alguém mexendo em memória ou skill agora
  const sd = E.salasDados || {};
  if (sd.missao?.missoes?.some(x => x.ativa)) pedir('missao', 'missao');
  if (sd.oficina?.naOficina?.length) pedir('oficina', 'oficina');
  if (sd.memoria?.atividadeAgora?.length) pedir('biblioteca', 'biblioteca');
  // sala dos servidores: as extensões que os racks pedem (as que ainda seguram rack
  // continuam pedidas até esvaziar)
  const extPedidas = extensoesPedidasServidores();
  extensoesServidores().forEach((m, i) => { if (i < extPedidas || !podeSairServidores(m)) pedir(m.chave, 'servidores', { extensao: true }); });
  for (let k = extensoesServidores().length + 1; k <= extPedidas; k++) pedir('servidores:' + (k + 1), 'servidores', { extensao: true });
  informarServidores();

  // (h) jardins: as vagas vazias de cada lado, até onde vai o lado mais comprido,
  // viram jardim (sem isso, sobra piso vazio, inclusive buracos no meio). Não aumentam a
  // estação. A vaga guardada para uma sala crescer também vira jardim (ela toma o jardim).
  const fim = { n: VAGAS_NUCLEO - 1, s: VAGAS_NUCLEO - 1 };
  for (const m of modulos.values()) {
    if (m.tipo === 'jardim' || !vivo(m)) continue;
    fim[m.lado] = Math.max(fim[m.lado], m.vaga + m.nVagas - 1);
  }
  const ate = Math.max(fim.n, fim.s);
  for (const lado of ['n', 's']) {
    const ocup = ocupacaoDoLado(lado);
    for (let k = VAGAS_NUCLEO; k <= ate; k++) {
      if (ocup[k] && ocup[k].tipo !== 'jardim') continue;
      if (filaAcoplar.some(p => p.lugar?.lado === lado && p.lugar?.vaga === k) && !ocup[k]) { pedidos.add('jardim:' + lado + k); continue; }
      pedir('jardim:' + lado + k, 'jardim', { lugar: { lado, vaga: k } });
    }
  }

  // candidatos a desacoplar: sem pedido, folga vencida e vazios; jardim na ponta;
  // módulo de sala de pasta só numa ponta da sala (nunca o do meio) e a base por último
  candidatos = [];
  for (const m of modulos.values()) {
    if (m.nucleo || m.estado !== 'pronto' || (m.chave && pedidos.has(m.chave))) continue;
    if (m.tipo === 'jardim') { if (naPonta(m)) candidatos.push(m); continue; }
    if (agora - m.ultimoUso <= (FOLGA_MS[m.tipo] ?? 90e3) * FATOR_FOLGA) continue;
    if (ehSala(m) && !podeSairDaSala(m)) continue;
    if (m.tipo === 'servidores' && m.extensao && !podeSairServidores(m)) continue;
    if (moduloVazio(m)) candidatos.push(m);
  }
  guardadasAtivas = new Set(vagasDosServidores());
  for (const p of equipes.keys()) {
    const run = trechoDaSala(p);
    if (!run) continue;
    const ocup = ocupacaoDoLado(run.lado);
    for (let k = run.kMax + 1; k <= run.kMax + (estudio.pasta === p ? 2 : 1) && k < VAGAS_POR_LADO; k++) {
      if (!vagaTomavel(ocup, k) || !contiguas(run.lado, k, run.kMax)) break;
      guardadasAtivas.add(run.lado + k);
    }
  }
  podarMapas(agora);
  atualizarPlacas(agora);
  // colunas que brotaram ou saíram nesta leitura: o mapa e as salas já valem para as
  // decisões dos agentes logo em seguida (aplicarEstado)
  if (mapaSujo) reconstruirMapa();
}

// Módulo de sala de pasta pode sair: está numa ponta do trecho da sala e, se for a
// base, a sala é só ela
function podeSairDaSala(m) {
  if (!m.pasta) return true;
  const run = trechoDaSala(m.pasta);
  if (!run) return true;
  const ponta = m.vaga === run.kMin || m.vaga + m.nVagas - 1 === run.kMax;
  if (!ponta) return false;
  if (m.chave === 'ilha:' + m.pasta && modulosDaPasta(m.pasta).length > 1) return false;
  return true;
}

function salaPropria(p) {
  const id = E.ilhaPorPasta.get(p);
  return !!(id && !convidados.has(p) && modulos.get(id));
}

// Pastas e conectores sem uso há mais de 1 h saem dos mapas (revisão M-10)
function podarMapas(agora) {
  for (const [p, t] of usoPasta) {
    if (agora - t < PODA_MS || pastasComSala().has(p)) continue;
    usoPasta.delete(p);
    primeiraVezPasta.delete(p);
  }
  for (const [nome, info] of E.salaPorConector) if (agora - (info?.uso ?? 0) > PODA_MS) E.salaPorConector.delete(nome);
}

// Pasta sem lugar para sala própria: é recebida na sala com mais colunas livres
function receberConvidada(pasta) {
  if (E.ilhaPorPasta.has(pasta) && modulos.get(E.ilhaPorPasta.get(pasta))) return;
  let melhor = null, livres = -1;
  for (const m of modulos.values()) {
    if (!ehSala(m) || !vivo(m) || !m.registrado) continue;
    const n = m.colunas.filter(c => c.estado === 'vazia').length;
    if (n > livres) { melhor = m; livres = n; }
  }
  if (!melhor) return;
  E.ilhaPorPasta.set(pasta, melhor.id);
  convidados.set(pasta, melhor.id);
  atualizarPlacas();
}

// ---------------------------------------------------------------------------
// A cada quadro: mapa pendente, fila de acoplar e de desacoplar
// ---------------------------------------------------------------------------
export function atualizarEstacao(agoraMs = agoraQuadro()) {
  if (!estudio) return;
  if (mapaSujo) reconstruirMapa();
  let acoplando = false, desacoplando = false;
  for (const m of modulos.values()) {
    if (m.estado === 'acoplando') acoplando = true;
    else if (m.estado === 'desacoplando') desacoplando = true;
  }
  if (filaAcoplar.length) {
    // espera o desacoplamento em curso terminar (a vaga dele ainda está ocupada)
    if (desacoplando || agoraMs - ultimoAcoplar < CADENCIA_ACOPLAR_MS) return;
    // salas de verdade antes dos jardins de enfeite
    const iReal = filaAcoplar.findIndex(p => p.tipo !== 'jardim');
    const pedido = filaAcoplar.splice(iReal >= 0 ? iReal : 0, 1)[0];
    const m = porChave.get(pedido.chave);
    if (m) { m.ultimoUso = relogioEstacao(); return; }
    iniciarAcoplar(pedido, agoraMs);
    return;
  }
  // nunca desacopla com acoplamento pendente
  if (acoplando || desacoplando || agoraMs - ultimoDesacoplar < CADENCIA_DESACOPLAR_MS) return;
  if (!candidatos.length) { if (!abrirCaminhoServidores(agoraMs) && !abrirCaminhoSalas(agoraMs)) compactar(agoraMs); return; }
  candidatos = candidatos.filter(m => modulos.get(m.id) === m && m.estado === 'pronto');
  // os da ponta primeiro (revisão I-3: sair do meio cria jardins que logo saem também);
  // depois o que está sem uso há mais tempo; empate: o mais longe da porta
  candidatos.sort((a, b) => (naPonta(b) - naPonta(a)) || (a.ultimoUso - b.ultimoUso) || (b.vaga - a.vaga));
  while (candidatos.length) {
    const m = candidatos.shift();
    if (m.tipo === 'jardim' && !naPonta(m)) continue;
    // reconferência na hora: alguém pode ter escolhido o módulo depois da leitura
    if (!moduloVazio(m) || (ehSala(m) && !podeSairDaSala(m)) || (m.tipo === 'servidores' && m.extensao && !podeSairServidores(m))) {
      recusados++; m.ultimoUso = relogioEstacao(); continue;
    }
    iniciarDesacoplar(m, agoraMs);
    break;
  }
}

// Compactação (03/10, OBRIGATÓRIO: "a estação se compacta"): com um buraco (vaga vazia
// ou jardim) num lado e um módulo de verdade mais para fora no mesmo lado, o mais de
// fora desacopla e acopla de novo no buraco mais perto do núcleo, com a animação de
// sempre, um por vez, só quando está vazio (ninguém dentro, a caminho ou com a casa
// nele). A ponta que sobra sai sem virar jardim e a espinha encolhe. Não entram na
// conta as vagas que a sala dos servidores ou uma sala de pasta querem agora, a vaga
// s2 (só da Sala OpenAI) e salas de pasta de mais de um módulo (andariam aos pedaços).
// A vaga só guardada para uma sala de pasta crescer recebe um módulo que não é sala de
// pasta (verificação v0.6): ele dá passagem quando a sala crescer (abrirCaminhoSalas). Módulo que
// ninguém pede mais também vem para dentro enquanto espera a folga para sair (a
// biblioteca fica 10 min): nada de jardins no meio com uma sala lá no fim.
function compactar(agoraMs) {
  if (filaAcoplar.length) return;
  const travadas = new Set([...vagasDosServidores(), ...vagasQueSalasQuerem()]);
  for (const lado of ['n', 's']) {
    const ocup = ocupacaoDoLado(lado);
    const reais = [...modulos.values()].filter(m => m.lado === lado && m.tipo !== 'jardim' && !m.nucleo && vivo(m));
    if (!reais.length) continue;
    const kMaxReal = Math.max(...reais.map(m => m.vaga + m.nVagas - 1));
    for (let k = VAGAS_NUCLEO; k < kMaxReal; k++) {
      // vaga guardada para uma sala de pasta crescer: só um módulo que não é sala de pasta
      // entra nela (e dá passagem quando a sala crescer); a que a sala quer agora e a dos
      // servidores ficam livres
      if (!vagaTomavel(ocup, k) || travadas.has(lado + k)) continue;
      const guardaDeSala = guardadasAtivas.has(lado + k);
      // o de fora que pode ir para o buraco k (do mais de fora para dentro)
      const moveis = reais.filter(m => m.vaga > k && m.estado === 'pronto' && m.chave
        && !(lado === 's' && k === VAGA_OPENAI && m.tipo !== 'controle-openai')
        && !(ehSala(m) && (guardaDeSala || modulosDaPasta(m.pasta).length > 1))
        && m.tipo !== 'servidores'   // a extensão dos servidores fica colada na base
        && !(m.fixo)).sort((a, b) => b.vaga - a.vaga);
      if (guardaDeSala && !moveis.length) continue;   // só salas de pasta lá fora: o próximo buraco
      for (const m of moveis) {
        if (!moduloVazio(m)) continue;
        m.mudarPara = { lado, vaga: k };
        registrar('compactar', m, agoraMs);
        iniciarDesacoplar(m, agoraMs);
        return;
      }
      break;   // o buraco mais de dentro espera o módulo de fora esvaziar
    }
  }
}

// Há algo da estação para animar ou decidir (main.js mantém os quadros rodando)
export function estacaoOcupada() {
  if (mapaSujo || filaAcoplar.length || candidatos.length || removendo.size) return true;
  for (const m of modulos.values()) {
    if (m.estado === 'acoplando' || m.estado === 'desacoplando') return true;
    for (const c of m.colunas) if (c.estado === 'acoplando' || c.estado === 'desacoplando') return true;
  }
  return false;
}

// A sala lógica ainda vai existir (pedido na fila, módulo ou coluna acoplando antes do
// mapa)? agentes.js usa para não mandar ninguém para o lugar errado no meio tempo.
// No coworking, 'sessao' é a sessão dona do conjunto do agente.
export function aguardandoSala(idSala, pasta, sessao) {
  if (idSala === 'coworking') {
    if (!pasta) return false;
    const ms = modulosDaPasta(pasta);
    const conv = convidados.get(pasta) && modulos.get(convidados.get(pasta));
    const sala = ms.length ? ms : conv ? [conv] : [];
    if (!sala.length) return filaAcoplar.some(p => p.chave === 'ilha:' + pasta);
    if (sala.some(m => !m.registrado)) return true;
    // o conjunto da sessão: coluna brotando que ainda não entrou no mapa
    const minhas = sala.flatMap(m => m.colunas).filter(c => c.sessao === sessao);
    if (minhas.some(c => c.estado === 'acoplando' && mapaSujo)) return true;
    // a sala vai crescer e a sessão ainda não tem mesa livre: espera o módulo novo
    const livre = minhas.some(c => colunaViva(c) && c.vagas.some(v => !v.ocupada && !v.casaDe));
    const cresce = filaAcoplar.some(p => p.tipo === 'ilha' && p.pasta === pasta && p.extensao);
    return !livre && cresce && !minhas.length;
  }
  if (['mcp', 'api', 'revisao', 'oficina', 'biblioteca'].includes(idSala)) {
    if (E.salas[idSala]) return false;
    if (filaAcoplar.some(p => p.chave === idSala)) return true;
    const m = porChave.get(idSala);
    return !!(m && m.estado !== 'desacoplando');
  }
  return false;
}

// MCP ou API no teto: a sala não coube e o pedido espera algum módulo sair (I-1)
export function semVagaPara(idSala) {
  return !E.salas[idSala] && semVaga.has(idSala) && semVaga.get(idSala) === versaoPlanta;
}

// ---------------------------------------------------------------------------
// Acoplar
// ---------------------------------------------------------------------------
function registrar(acao, m, agoraMs) {
  registro.push({ t: Math.round(agoraMs), relogio: relogioEstacao(), acao, id: m.id, tipo: m.tipo, lado: m.lado, vaga: m.vaga, pasta: m.pasta });
  if (registro.length > 200) registro.shift();
}

// Para testes e console: acopla um módulo de um tipo numa vaga livre (ou jardim)
// escolhida, sem passar pelo planejamento. Ex.: (await import('./estacao.js'))
// .acoplarEm('mcp', 'n', 4). Devolve o id do módulo ou null. MCP e API são salas
// únicas: um segundo do mesmo tipo é recusado (revisão M-9).
export function acoplarEm(tipo, lado, vaga, extra = {}) {
  if (!estudio || !LADO_PREFERIDO[tipo] || vaga < VAGAS_NUCLEO || vaga >= VAGAS_POR_LADO) return null;
  if (['mcp', 'api'].includes(tipo) && [...modulos.values()].some(m => m.tipo === tipo && vivo(m))) return null;
  const atual = ocupacaoDoLado(lado)[vaga];
  if (atual && !(atual.tipo === 'jardim' && !atual.fixo && atual.estado === 'pronto')) return null;
  const chave = extra.chave ?? tipo + ':' + lado + vaga;
  return iniciarAcoplar({ chave, tipo, ...extra }, agoraQuadro(), { lado, vaga, jardim: atual || null }) ? porChave.get(chave)?.id : null;
}

function iniciarAcoplar(pedido, agoraMs, lugarFixo = null) {
  // jardim: só na vaga pedida e se ela ainda estiver vazia; módulo extra de sala de
  // pasta: só colado na sala
  let lugar = lugarFixo;
  if (!lugar && pedido.lugar) {
    // jardim: só na vaga vazia; módulo que muda de lugar (compactação): vaga vazia ou jardim
    const ocup = ocupacaoDoLado(pedido.lugar.lado), o = ocup[pedido.lugar.vaga];
    lugar = !o ? { ...pedido.lugar } : pedido.tipo !== 'jardim' && vagaTomavel(ocup, pedido.lugar.vaga) ? { ...pedido.lugar, jardim: o } : null;
  }
  else if (!lugar && pedido.tipo === 'ilha' && pedido.extensao) {
    // sem vaga colada (a sala chegou na curva do U ou encostou noutra): um ANEXO da
    // mesma pasta onde houver lugar, com a placa da pasta (v0.7: sem isso, 100
    // astronautas em 4 pastas paravam em ~60 na tela)
    lugar = vagaColada(pedido.pasta) || (emU() || ocupacaoCheiaA() ? escolherVaga('ilha') : null);
  }
  else if (!lugar && pedido.tipo === 'servidores' && pedido.extensao) lugar = vagaColadaServidores();
  else if (!lugar) lugar = escolherVaga(pedido.tipo);
  if (!lugar) {
    // teto: a pasta sem sala senta na sala com mais colunas livres; MCP e API saem da
    // fila até algum módulo sair (a mesa da sessão faz as vezes, agentes.js)
    if (pedido.tipo === 'ilha' && !pedido.extensao) receberConvidada(pedido.pasta);
    if (pedido.tipo !== 'jardim') semVaga.set(pedido.chave, versaoPlanta);
    const ult = registro[registro.length - 1];
    if (!(ult?.acao === 'sem-vaga' && ult.chave === pedido.chave)) registro.push({ t: Math.round(agoraMs), acao: 'sem-vaga', chave: pedido.chave });
    return false;
  }
  if (lugar.jardim) afundarJardim(lugar.jardim);
  const m = criarModulo(pedido.tipo, lugar.lado, lugar.vaga, { chave: pedido.chave, pasta: pedido.pasta, extensao: pedido.extensao });
  m.estado = 'acoplando';
  m.ultimoUso = relogioEstacao();
  if (m.tipo === 'ilha' && m.pasta && !m.extensao && (!salaPropria(m.pasta) || convidados.has(m.pasta))) {
    E.ilhaPorPasta.set(m.pasta, m.id);
    convidados.delete(m.pasta);
  }
  ultimoAcoplar = agoraMs;
  registrar('acoplar', m, agoraMs);
  mapaSujo = true;
  atualizarExtensao();
  atualizarFusoes();
  animarAcoplar(m);
  return true;
}

// Proxies para as animações: v de 0 a 1 em cima da escala original
function crescerDoChao(o) {
  const b = o.userData.base;
  let v = 1;
  return { get v() { return v; }, set v(t) { v = t; o.scale.y = b.s.y * t; o.position.y = b.py * t; } };
}
function brotar(o) {
  const b = o.userData.base;
  let v = 1;
  return { get v() { return v; }, set v(t) { v = t; const k = Math.max(0.001, t); o.scale.set(b.s.x * k, b.s.y * k, b.s.z * k); } };
}

function animarAcoplar(m) {
  const k = 'mod:' + m.id;
  m.grupo.position.y = Y_FUNDO;
  // a divisória da esquerda cresce com as paredes, a não ser que o módulo já nasça fundido
  const paredesAnim = m.divisoriaEsq && !m.fundido ? [...m.paredes, m.divisoriaEsq] : m.paredes;
  if (m.divisoriaEsq) m.divisoriaEsq.visible = !m.fundido;
  const paredes = paredesAnim.map(crescerDoChao);
  const moveis = m.moveis.map(brotar);
  paredes.forEach(p => { p.v = 0.02; });
  moveis.forEach(p => { p.v = 0.001; });
  // laje sobe em 0,9 s junto com a espinha; paredes crescem; móveis brotam em cascata
  tween({ obj: m.grupo, prop: 'position.y', para: 0, dur: 0.9, ease: 'easeOutCubic', chave: k + ':laje' });
  paredes.forEach((p, i) => tween({ obj: p, prop: 'v', para: 1, dur: 0.5, atraso: 0.45, ease: 'easeOutCubic', chave: k + ':p' + i }));
  // cascata de 60 ms entre um móvel e o próximo (mais curta com muitos móveis, para caber em 1,4 s)
  const passo = Math.min(0.06, 0.45 / Math.max(1, moveis.length));
  moveis.forEach((p, i) => tween({ obj: p, prop: 'v', para: 1, dur: 0.5, atraso: 0.45 + i * passo, ease: 'easeOutBack', chave: k + ':m' + i }));
  const fim = Math.max(DUR_ACOPLAR, 0.45 + moveis.length * passo + 0.5);
  m._t = 0;
  tween({ obj: m, prop: '_t', de: 0, para: 1, dur: fim, ease: 'linear', chave: k + ':fim', aoFim: () => terminarAcoplar(m) });
  E.sujo = true;
}

function terminarAcoplar(m) {
  if (m.estado !== 'acoplando') return;
  m.estado = 'pronto';
  m.grupo.position.y = 0;
  if (m.tv) mostrarNaTv(m, m.tipo === 'api' ? 'API' : 'MCP');
  atualizarFusoes();
  atualizarPlacas();
  if (m.tipo === 'servidores') informarServidores();
  ganchos.atualizarPendentes?.();
  atualizarPegada();
  Cena.ajustarSombra?.(E.pegada);
  registrar('pronto', m, agoraQuadro());
  E.sujo = true;
}

// Jardim que dá lugar a um módulo: sai do mapa na hora e afunda em 0,4 s
function afundarJardim(j) {
  modulos.delete(j.id);
  if (porChave.get(j.chave) === j) porChave.delete(j.chave);
  j.estado = 'removido';
  removendo.add(j);
  registrar('jardim-substituido', j, agoraQuadro());
  tween({ obj: j.grupo, prop: 'position.y', para: Y_FUNDO, dur: 0.4, ease: 'easeInCubic', chave: 'mod:' + j.id + ':laje',
    aoFim: () => { E.cena.remove(j.grupo); liberarObjeto(j.grupo); removendo.delete(j); } });
}

// ---------------------------------------------------------------------------
// Desacoplar
// ---------------------------------------------------------------------------
function iniciarDesacoplar(m, agoraMs) {
  m.estado = 'desacoplando';
  ultimoDesacoplar = agoraMs;
  registrar('desacoplar', m, agoraMs);
  for (const v of m.vagas) {
    v.removida = true;
    if (v.timerApoio) { clearTimeout(v.timerApoio); v.timerApoio = null; }
  }
  // a pasta deixa de apontar para este módulo
  for (const [p, id] of [...E.ilhaPorPasta]) if (id === m.id) E.ilhaPorPasta.delete(p);
  for (const [p, id] of [...convidados]) if (id === m.id) convidados.delete(p);
  // sinais apagam primeiro
  if (m.tv) mostrarNaTv(m, null);
  m.placaSala?.definir(null);
  for (const c of m.colunas) mostrarNaPlaca(c.placa, null);
  for (const l of m.luzes) { l._nivel = 0; l.pendente?.definirNivel?.(0); }
  atualizarFusoes();   // o vizinho da direita volta a ter a divisória dele
  if (m.tipo === 'servidores') informarServidores();
  // sai das salas e vira bloco no mapa já agora (e não no próximo quadro: uma leitura
  // que chegasse no meio podia escolher um lugar nele)
  reconstruirMapa();
  animarDesacoplar(m);
}

function animarDesacoplar(m) {
  const k = 'mod:' + m.id;
  const paredes = (m.divisoriaEsq?.visible ? [...m.paredes, m.divisoriaEsq] : m.paredes).map(crescerDoChao);
  const moveis = m.moveis.map(brotar);
  const passo = Math.min(0.06, 0.5 / Math.max(1, moveis.length));
  moveis.forEach((p, i) => tween({ obj: p, prop: 'v', de: 1, para: 0.001, dur: 0.4, atraso: 0.25 + (moveis.length - 1 - i) * passo, ease: 'easeInCubic', chave: k + ':m' + i }));
  paredes.forEach((p, i) => tween({ obj: p, prop: 'v', de: 1, para: 0.02, dur: 0.4, atraso: 0.9, ease: 'easeInCubic', chave: k + ':p' + i }));
  tween({ obj: m.grupo, prop: 'position.y', para: Y_FUNDO, dur: 0.6, atraso: 1.2, ease: 'easeInCubic', chave: k + ':laje' });
  m._t = 0;
  tween({ obj: m, prop: '_t', de: 0, para: 1, dur: DUR_DESACOPLAR, ease: 'linear', chave: k + ':fim', aoFim: () => terminarDesacoplar(m) });
  E.sujo = true;
}

function terminarDesacoplar(m) {
  if (m.estado !== 'desacoplando') return;
  // asserção: ninguém sentado, a caminho, com a casa ou parado nele
  const quem = ocupantes(m);
  if (quem.length) {
    violacoes++;
    console.error('A Estação: módulo desacoplou com alguém dentro', m.id, quem.map(a => a.id));
  }
  for (let i = 0; i < m.moveis.length; i++) cancelarTweens('mod:' + m.id + ':m' + i);
  for (const c of m.colunas) cancelarTweens('coluna:' + c.id);
  cancelarTweens('mod:' + m.id + ':divisoria');
  m.controle?.userData.liberar?.();
  m.salaNova?.liberar?.();
  E.cena.remove(m.grupo);
  liberarObjeto(m.grupo);
  modulos.delete(m.id);
  if (porChave.get(m.chave) === m) porChave.delete(m.chave);
  m.estado = 'removido';
  versaoPlanta++;
  registrar('removido', m, agoraQuadro());
  // compactação: o módulo volta logo, na vaga mais perto do núcleo (primeiro da fila)
  if (m.mudarPara) {
    for (let i = filaAcoplar.length - 1; i >= 0; i--) if (filaAcoplar[i].chave === m.chave) filaAcoplar.splice(i, 1);
    filaAcoplar.unshift({ chave: m.chave, tipo: m.tipo, pasta: m.pasta, extensao: m.extensao, lugar: m.mudarPara, mudanca: true });
    ultimoAcoplar = -Infinity;
  }
  // buraco no meio vira jardim (o próximo módulo do lado ocupa ele primeiro)
  else if (m.tipo !== 'jardim' && !naPonta(m)) {
    const j = criarModulo('jardim', m.lado, m.vaga, { chave: 'jardim:' + m.lado + m.vaga });
    j.estado = 'acoplando';
    registrar('jardim', j, agoraQuadro());
    animarAcoplar(j);
  }
  mapaSujo = true;
  atualizarFusoes();
  atualizarExtensao();
  if (m.tipo === 'servidores') informarServidores();
}

// ---------------------------------------------------------------------------
// Parede na frente (F2, correção obrigatória: ninguém parado de cara para a parede)
// ---------------------------------------------------------------------------
// O que há no ponto: 'livre', 'movel' (mesa, sofá, estante, máquina: algo com sentido
// para olhar) ou 'parede' (parede do fundo, divisória do corredor, divisória entre
// vagas, parede da ponta, borda e parapeito da frente, sala fechada, lado de fora).
// Pelas caixas cruas do mapa: uma caixa fina deitada sobre uma dessas linhas é parede;
// bloco do fundo inteiro (sala fechada, vaga vazia) também; o resto é móvel.
function ehParede(r) {
  const w = r.xb - r.xa, d = r.zb - r.za;
  if (d > 5 || w > 9.5) return true;                       // sala fechada, vaga vazia, lado de fora
  if (d <= 0.3) {                                          // deitada ao longo de x
    const zc0 = (r.za + r.zb) / 2;
    const zc = zc0 > ZS + 0.5 ? zc0 - ZB : zc0;               // perna B: mesma regra deslocada
    return Math.abs(Math.abs(zc) - CORR) < 0.15 || zc < ZN + 0.12 || zc > ZS - 0.25;
  }
  if (w <= 0.3 && d >= 2) {                                // em pé ao longo de z: divisória entre vagas
    const k = (X1 - (r.xa + r.xb) / 2) / VAGA_L;   // as divisas da perna B caem nas mesmas linhas
    return Math.abs(k - Math.round(k)) * VAGA_L < 0.15;
  }
  return false;
}
export function oQueHaEm(x, z) {
  const mapa = E.mapa;
  if (!mapa?.obstaculosEm) return 'livre';
  if (x < xMinAtual + 0.1 || x > X1 + 1.4 || z < ZN + 0.02 || z > (emU() ? ZS2 : ZS)) return 'parede';
  const rs = mapa.obstaculosEm(x, z);
  if (!rs.length) return 'livre';
  return rs.every(ehParede) ? 'parede' : 'movel';
}
// Olhando de (x, z) no ângulo 'ang' (0 = +z), a primeira coisa a menos de 'dist' é
// parede (sem móvel antes dela)?
export function paredeNaFrente(x, z, ang, dist = 0.8) {
  const sx = Math.sin(ang), sz = Math.cos(ang);
  for (let d = 0.05; d <= dist + 1e-6; d += 0.05) {
    const o = oQueHaEm(x + sx * d, z + sz * d);
    if (o === 'movel') return false;
    if (o === 'parede') return true;
  }
  return false;
}
// Quanto dá para olhar livre (até 'max') de (x, z) no ângulo 'ang', parando no
// primeiro obstáculo; móvel conta como algo para olhar (devolve a distância e o que é)
export function vistaEm(x, z, ang, max = 3) {
  const sx = Math.sin(ang), sz = Math.cos(ang);
  for (let d = 0.05; d <= max + 1e-6; d += 0.05) {
    const o = oQueHaEm(x + sx * d, z + sz * d);
    if (o !== 'livre') return { dist: d, oque: o };
  }
  return { dist: max, oque: 'livre' };
}

// ---------------------------------------------------------------------------
// Mapa de caminhos e salas lógicas
// ---------------------------------------------------------------------------
function reconstruirMapa() {
  mapaSujo = false;
  const mapa = E.mapa;
  if (!mapa) return;
  // o Mapa é o mesmo objeto a vida toda: quem guarda algo calculado nele (acessos das
  // vagas, lugares em pé) confere esta versão
  E.versaoMapa = (E.versaoMapa || 0) + 1;
  const xMin = calcularXMin();
  mapa.limpar();
  const u = emU();
  // retângulo da vaga (o cômodo inteiro) no mapa, do lado físico dela (perna A ou B)
  const blocoDaVaga = (lado, k, nVagas = 1) => {
    const g = geoVaga(lado, k, nVagas);
    if (g.ladoFisico === 'n') mapa.bloquearRetangulo(g.x0, g.z0 - (g.dz ? 0.05 : 1), g.x1, g.z1 + 0.07);
    else mapa.bloquearRetangulo(g.x0, g.z0 - 0.07, g.x1, g.z1 + (g.dz ? 1 : 0.05));
  };
  // à esquerda da parede da ponta (a própria parede e o lado de fora)
  mapa.bloquearRetangulo(mapa.x0 - 1, ZN - 1, xMin, ZS2 + 1);
  // bordas abertas do diorama (leste fora do corredor e sul), como na planta fixa
  mapa.bloquearRetangulo(X1, ZN - 1, X1 + 2, -CORR);
  mapa.bloquearRetangulo(X1, CORR, X1 + 2, ZS2 + 1);
  // costas com costas (no U, o conector passa; e a sala que cresceu pela curva também)
  const curvaAberta = [...modulos.values()].some(m => m.fundidoCostas);
  mapa.bloquearRetangulo(u ? DOBRA_X + (curvaAberta ? VAGA_L : 0) : xMin, ZS, X1 + 2, ZS + 0.05);
  if (u) {
    // conector na ponta oeste: livre de -CORR a ZB + CORR; acima e abaixo, fechado
    mapa.bloquearRetangulo(xMin, ZN - 1, DOBRA_X, -CORR);
    mapa.bloquearRetangulo(xMin, ZB + CORR, DOBRA_X, ZS2 + 1);
    // leste da perna B, depois do último módulo de lá: fechado (inclusive o corredor B)
    mapa.bloquearRetangulo(xMaxPernaB(), ZS, X1 + 2, ZS2 + 1);
    mapa.bloquearRetangulo(xMin, ZS2, X1 + 2, ZS2 + 1);
  } else {
    // sem a perna B, tudo ao sul da perna A é fechado
    mapa.bloquearRetangulo(xMin, ZS, X1 + 2, ZS2 + 1);
  }
  // vagas sem módulo no lado mais curto: fechadas, como se houvesse divisória
  for (const lado of ['n', 's']) {
    const ocup = ocupacaoDoLado(lado);
    for (let k = 0; k < VAGAS_POR_LADO; k++) {
      const g = geoVaga(lado, k);
      if (ocup[k] || (!g.dz && g.x0 < xMin - 1e-6) || (g.dz && !u)) continue;
      blocoDaVaga(lado, k);
    }
  }
  // módulos: os retângulos medidos; quem está desacoplando (ou é sala de controle,
  // onde ninguém entra) vira um bloco só. A divisória da esquerda fica de fora quando o
  // módulo se funde com o vizinho; cada coluna entra só enquanto está à mostra.
  for (const m of modulos.values()) {
    if (m.estado === 'desacoplando' || m.semAcesso) {
      blocoDaVaga(m.lado, m.vaga, m.nVagas);
      continue;
    }
    const dx = m.grupo.position.x, dz = m.grupo.position.z;
    mapa.bloquearRetangulos(m.obstaculos, dx, dz);
    if (!m.fundido) mapa.bloquearRetangulos(m.rectsDivisoria, dx, dz);
    if (m.rectsCostas?.length && !m.fundidoCostas) mapa.bloquearRetangulos(m.rectsCostas, dx, dz);
    for (const c of m.colunas) if (c.estado !== 'vazia') mapa.bloquearRetangulos(c.rects, dx, dz);
  }
  // fila indiana: mão direita no corredor e portas de um por vez
  mapa.definirCorredor({ xa: xMin, xb: X1 + 1.5, za: -CORR, zb: CORR });
  if (u) mapa.definirCorredor({ xa: DOBRA_X, xb: xMaxPernaB(), za: ZB - CORR, zb: ZB + CORR });
  for (const m of modulos.values()) {
    if (!m.porta || m.semAcesso || m.estado === 'desacoplando') continue;
    mapa.definirPorta({ x: m.porta.x, z: (m.ladoFisico === 'n' ? -CORR : CORR) + (m.dz || 0), larg: VAO, eixo: 'z', sala: m.sala });
  }
  mapa.definirPorta({ x: X1, z: 0, larg: 1.0, eixo: 'x', sala: 'fora' });
  mapa.calcularAlcance(new THREE.Vector3(X1 - 1, 0, 0));   // junto da porta
  atualizarSalas();
  if (DEPURAR_MAPA) {
    mapa.desenhar(E.cena);
    if (typeof window !== 'undefined') window.__escritorio = { mapa, salas: E.salas, agentes: E.agentes, THREE, modulos };
  }
  ganchos.plantaMudou?.();
  ganchos.replanejarAndando?.();
  E.sujo = true;
}

const limites = m => ({ x0: m.x0, x1: m.x1, z0: m.z0, z1: m.z1, cx: m.cx, cz: m.cz });

// Refaz E.salas a partir dos módulos (mantém o mesmo objeto E.salas)
function atualizarSalas() {
  const ativos = [...modulos.values()].filter(m => m.estado !== 'desacoplando');
  for (const m of ativos) m.registrado = true;
  const doTipo = t => ativos.filter(m => m.tipo === t).sort((a, b) => a.vaga - b.vaga);
  const salas = {};
  const portaZ = lado => (lado === 'n' ? -CORR - 0.7 : CORR + 0.7);

  // coworking: todas as salas de pasta, com as colunas à mostra (as mesas de cada uma
  // sabem a coluna, v.coluna, e a coluna sabe a sessão e a pasta)
  const salasPasta = [estudio, ...doTipo('ilha')];
  const colunas = salasPasta.flatMap(m => m.colunas).filter(colunaViva);
  for (const c of colunas) c.pasta = c.modulo.pasta;
  salas.coworking = { id: 'coworking', nome: 'Salas das pastas', tipo: 'ilha', fila: 'n', ...limites(estudio),
    portaX: estudio.porta.x, portaZ: portaZ('n'), colunas, vagas: colunas.flatMap(c => c.vagas),
    modulo: estudio, partes: salasPasta.map(limites) };

  const pm = doTipo('pesquisa')[0];
  const refP = pm || estudio;
  salas.pesquisa = { id: 'pesquisa', nome: 'Pesquisa', tipo: 'pesquisa', fila: refP.lado, ...limites(refP),
    portaX: refP.porta.x, portaZ: portaZ(refP.lado), vagas: [estudio.vagaPesquisa, ...(pm ? pm.vagas : [])],
    pendente: pm?.luzes[0]?.pendente ?? null, modulo: pm ?? estudio, partes: [estudio, pm].filter(Boolean).map(limites) };

  const dm = doTipo('descanso')[0];
  salas.descanso = { id: 'descanso', nome: 'Descanso', tipo: 'descanso', fila: 's', ...limites(descansoNucleo),
    portaX: descansoNucleo.porta.x, portaZ: portaZ('s'), vagas: [...descansoNucleo.vagas, ...(dm ? dm.vagas : [])],
    pontosEmPe: [...descansoNucleo.pontosEmPe, ...(dm ? dm.pontosEmPe : [])], luminaria: descansoNucleo.luminaria,
    modulo: descansoNucleo, partes: [descansoNucleo, dm].filter(Boolean).map(limites) };

  for (const t of ['mcp', 'api']) {
    const m = doTipo(t)[0];
    if (!m) continue;
    salas[t] = { id: t, nome: t.toUpperCase(), tipo: t, fila: m.lado, ...limites(m), portaX: m.porta.x, portaZ: portaZ(m.lado),
      vagas: m.vagas, tv: m.tv, pendente: m.luzes[0]?.pendente ?? null, modulo: m, partes: [limites(m)] };
  }

  // Filas (rodada 6): sala do dono (o Estúdio, em frente à mesa do comandante) e
  // revisão (módulo). Sem vagas: os lugares da fila vêm de filaDef em coordenadas
  // de mundo, e agentes.js confere cada um no mapa.
  const filaNoMundo = m => m.filaDef && {
    olharAlvo: { x: m.grupo.position.x + m.filaDef.olharAlvo.x, z: m.filaDef.olharAlvo.z },
    pontos: m.filaDef.pontos.map(([lx, z]) => ({ x: m.grupo.position.x + lx, z })),
  };
  salas.dono = { id: 'dono', nome: 'Sala do dono', tipo: 'dono', fila: 'n', ...limites(estudio),
    portaX: estudio.porta.x, portaZ: portaZ('n'), vagas: [], filaDef: filaNoMundo(estudio), modulo: estudio, partes: [limites(estudio)] };
  const rv = doTipo('revisao')[0];
  if (rv) {
    salas.revisao = { id: 'revisao', nome: 'Revisão', tipo: 'revisao', fila: rv.lado, ...limites(rv), portaX: rv.porta.x, portaZ: portaZ(rv.lado),
      vagas: [], filaDef: filaNoMundo(rv), modulo: rv, partes: [limites(rv)] };
  }
  // salas novas com astronautas (F1): oficina (banquinhos da fila de atendimento) e
  // biblioteca (lugares em pé de frente para as estantes)
  for (const t of ['oficina', 'biblioteca']) {
    const m = doTipo(t)[0];
    if (!m) continue;
    salas[t] = { id: t, nome: t === 'oficina' ? 'Oficina' : 'Biblioteca', tipo: t, fila: m.lado, ...limites(m), portaX: m.porta.x, portaZ: portaZ(m.lado),
      vagas: m.vagas, modulo: m, partes: [limites(m)] };
  }
  for (const k of Object.keys(E.salas)) if (!(k in salas)) delete E.salas[k];
  Object.assign(E.salas, salas);
}

// Salas de controle em cena (grupos de controle.js), para monitoramento.js
export function salasDeControle() {
  const lista = [];
  for (const m of modulos.values()) if (m.controle && m.estado !== 'removido') lista.push(m.controle);
  return lista;
}

// Salas novas em cena (F1): os módulos com m.salaNova (sala-modulos.js anima e
// passa os dados). Inclui quem está acoplando e desacoplando (ainda aparece).
export function modulosSalaNova() {
  const lista = [];
  for (const m of modulos.values()) if (m.salaNova && m.estado !== 'removido') lista.push(m);
  return lista;
}

// Luminárias dos módulos prontos com as mesas de cada uma (agentes.js acende
// a pendente quando alguma mesa dela é posto)
export function luzesDaEstacao() {
  const lista = [];
  for (const m of modulos.values()) if (m.estado === 'pronto') lista.push(...m.luzes);
  return lista;
}

// Todas as vagas em coordenadas de mundo (window.__estacao.vagas(), para testes)
export function vagasMundo() {
  return Object.values(E.salas).flatMap(s => s.vagas.map((v, n) => ({ nome: `${s.id}#${n}`, sala: s.id, pos: posVaga(v), pose: v.pose })));
}

// Para conferência (console e testes)
export function estatisticasEstacao() {
  const lista = [...modulos.values()].sort((a, b) => (a.lado.localeCompare(b.lado)) || (a.vaga - b.vaga));
  return {
    comprimento: +(X1 - xMinAtual).toFixed(2), xMin: xMinAtual,
    modulos: lista.map(m => ({ id: m.id, tipo: m.tipo, lado: m.lado, vaga: m.vaga, estado: m.estado, pasta: m.pasta, nucleo: m.nucleo, extensao: m.extensao,
      fundido: m.fundido, colunas: m.colunas.map(c => ({ estado: c.estado, sessao: c.sessao, agencia: c.agencia })) })),
    fila: filaAcoplar.map(p => p.chave), candidatos: candidatos.map(m => m.id), semVaga: [...semVaga.keys()],
    violacoes, recusados, convidados: [...convidados.entries()], registro: [...registro],
  };
}
