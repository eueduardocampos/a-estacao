// Agentes: cada sessão (e subagente) vira um astronauta que entra pela porta,
// anda até a sala da atividade, senta, mostra balões de pensamento, termina o
// trabalho com um relógio de 60 s no lugar, descansa e vai embora.
//
// CONTRATO (rodada 2 da reforma, v0.5)
// - aplicarEstado(dados): aplica uma leitura de /api/estado. Com dados.erro não
//   mexe em ninguém. Quem some da lista só sai depois de 3 leituras seguidas.
// - animarAgentes(dt, agoraMs): chamada a cada quadro (agoraMs = performance.now()).
// - regimeAgentes(): 'movimento' (alguém anda, está em fade, trocando de pose ou
//   no relógio), 'ambiente' (há agentes, todos quietos) ou 'vazio'.
// - pontoDaPorta(): ponto da porta usado nas rotas (testes.js usa o mesmo).
// - removerAgente(a): tira o astronauta da cena e limpa tudo o que é dele.
// - estatisticasFila(): resgates, quem espera para entrar e as portas (conferência).
// - definirLotacao(n): lotação da cena (teste da multidão); sem valor, volta ao padrão.
// - plantaMudou(): chamar depois de remontar a planta no mesmo mapa (esquece acessos
//   das vagas e lugares em pé guardados).
// - lugaresDasFilas() e membrosDasFilas(): filas da sala do dono e da revisão
//   (rodada 6), para os testes e o console.
//
// FILAS E NOTINHA (rodada 6): sessão com pendencia 'precisa_de_voce' entra na fila
// em frente à mesa do comandante (E.salas.dono); 'entrega_com_sugestao', na fila do
// módulo de revisão (E.salas.revisao). Ordem de chegada, um atrás do outro, uma
// partida por vez. Cada um na fila mostra uma notinha clicável (a única ação da
// Estação): POST /api/abrir { id } com o token da página; o servidor abre a sessão.
// PARTIDA ESCALONADA GERAL (rodada 6): quem está parado e recebe destino novo espera
// a vez se um vizinho (até 2,2 m) partiu há menos de 0,9 s; nada de dupla saindo
// junto e andando lado a lado.
// Campos de cada agente que outros módulos leem:
//   a.boneco, a.div (placa do hover), a.alvo (sala de destino ou 'fora'),
//   a.provedor ('anthropic' | 'openai': cor dos olhinhos e da antena, personagens.js),
//   a.fade (0 a 1), a.pasta, a.atividade, a.tipo, a.vaga (com v.sala),
//   a.casa (mesa-casa no coworking), a.balao (CSS2DObject do balão, na cena),
//   a.ultimaAcao (performance.now() do último pensamento novo) e
//   a.estado: 'andando' | 'parado' | 'relogio' | 'descanso'.
//
// Peças (pecas.js) usadas só com optional chaining, porque podem não existir:
//   v.definirPosto(ligado), v.acenderTela(nivel), v.rolarTela(dt),
//   v.definirCaneca(cor | null), v.ordem, v.sala, v.topoAssento,
//   s.ilhas[i].pendente.definirNivel(n), s.pendente.definirNivel(n), s.pontosEmPe.
//
// FILA INDIANA E CORPO SÓLIDO (requisito obrigatório de 03/10; rodada 3B)
// - Corpo sólido: cada astronauta é um disco de raio RAIO (0,3). Um passo só é
//   aceito se não deixa ninguém a menos de 2 × RAIO de outro (quem já está perto
//   só pode se afastar). Quem nasce, nasce num lugar livre; ninguém atravessa ninguém.
//   Quem anda ou está em pé fica a 0,3 ou mais de parede, divisória e móvel; só o
//   trecho entre o acesso e o assento encosta na banqueta, mesa ou sofá dele.
// - Fila indiana: quem anda no mesmo sentido e está na frente (até 0,8 de lado)
//   puxa a fila; quem vem atrás desacelera e para a cerca de um passo (0,75 entre
//   centros). Escalonar: de 0,8 a 1,6 de lado (saindo juntos de mesas vizinhas,
//   indo juntos ao descanso), o de trás (ou o de menor prioridade, se nivelados)
//   espera o outro abrir 0,7 e só anda solto com 1,0 de vantagem. Lado a lado não existe.
// - Mão direita: as rotas vêm do mapa (navegacao.js), que puxa cada sentido para
//   a sua faixa do corredor. Quem nasce entra pela faixa de quem vai para -x e quem
//   sai vai pela faixa de +x. Dois que se encontram de frente desviam pela direita.
// - Portas (E.mapa.portas / portaEm): passa um por vez, e só conta porta que a rota
//   atravessa de verdade (quem passa rente à boca, pelo corredor, não entra na vez).
//   Com a porta ocupada, quem chega espera num LUGAR DE ESPERA fora da passagem (de
//   lado, ou na própria faixa do corredor), nunca no caminho de quem sai. A vez é
//   de quem espera há mais tempo; quando o dono já cruzou o vão e se afasta, o
//   próximo do mesmo lado sai do lugar de espera e entra logo atrás dele (ondas de
//   até 3 no mesmo sentido, fechadas quando o outro lado espera há mais de 4 s).
//   Dono que trava antes de entrar perde a vez e volta para o fim da espera.
// - Assentos: cada vaga sentada tem um acesso próprio (por trás da banqueta, pela
//   frente do sofá), a 0,65 ou mais dos outros acessos; senta e levanta por ele.
// - Lugares em pé (sala cheia, descanso, conversa, nascimento do subagente): só em
//   células andáveis, longe de divisória, da frente das portas, de mesa e de outros
//   astronautas (e dos lugares reservados por quem ainda está a caminho). Sala com
//   as mesas ocupadas e 3 em pé: quem já tem lugar fica onde está até vagar.
// - Desempate (nada trava para sempre): parado por quem está em pé no caminho, este
//   DÁ PASSAGEM (vai para um lugar ao lado, fora da rota); dois andando que se
//   travam, o de menor prioridade ABRE CAMINHO (sai de lado, espera 0,9 s, refaz a
//   rota); quem espera a vez de uma porta no caminho de outro troca de lugar de
//   espera; no descanso, travado 2 s, desiste da ação (fica onde está, se é um bom
//   lugar, ou vai a outro ponto livre do mesmo cômodo); sem sair de 0,15 m por 4 s,
//   refaz a rota desviando de quem está parado; por 9 s, some e reaparece no
//   destino (resgate, contado em estatisticasFila()).
// - Teste: testes.js, testarMultidao (?teste=multidao ou node app/teste-multidao.mjs).
// - Sem as funções novas do mapa (portaEm, folgaEm, corredores), continua sem
//   sobrepor ninguém; só deixa de controlar porta e faixa.
//
// SALAS NOVAS E NPCs (F1-SALAS-E-VIDA, 03/10)
// - Oficina: sessão em /api/oficina.naOficina (E.salasDados.oficina, sala-modulos.js)
//   ganha a atividade 'oficina' e vai para um banquinho da fila de atendimento (a fila
//   do dono vence: quem precisa de você fica na fila dele). Biblioteca: quem mexeu em
//   memória ou skill há menos de 60 s (/api/memoria.atividadeAgora, por agenteId) e
//   está na mesa ganha 'biblioteca' (abaixo de 'esperar' e das filas) e fica em pé no
//   lugar mais perto da estante da área. Quando o dado some, volta para a mesa.
// - NPCs (técnico, porteiro, despachante, coordenador, bibliotecário, mecânico,
//   operadores) ficam fora do hover, da lotação e do mapa, mas o corpo é sólido:
//   corposNpc() (sala-corpos.js) entra em quemBloqueia, lugarValido e nos desvios.
//   NPC nunca dá passagem nem abre caminho (ele espera; a rotina dele desiste em 2,5 s).
//
// ESTAÇÃO ELÁSTICA (rodada 3, estacao.js)
// - aplicarEstado chama estacao.planejarEstacao com quem está dentro (no lugar
//   de distribuirSalas); animarAgentes chama estacao.atualizarEstacao a cada quadro.
// - E.salas é o registro lógico: 'coworking' (as salas de pasta, com as colunas de
//   mesas à mostra em s.colunas), 'pesquisa', 'descanso', 'mcp' e 'api'.
// - pegarVaga (F2, uma sala por pasta e um conjunto de mesas por sessão): no coworking,
//   a casa; depois uma mesa livre do conjunto da sessão dele (Est.sessaoDoAgente: a
//   própria sessão, ou a mãe do subagente), ao lado da mãe; depois a mesa de que ele se
//   lembra; e, sem nada disso (sala no teto), a folga de outro conjunto da mesma pasta.
//   MCP e API por tipo, com o nome do serviço no monitor enquanto ele está sentado
//   (v.mostrarServico); no teto (sem vaga para a sala, Est.semVagaPara), fica na mesa
//   dele com o nome do serviço no monitor (revisão I-1).
// - Em pé, ninguém fica de cara para a parede (correção obrigatória de 03/10):
//   olharEmPe escolhe a mesa, o lugar de trabalho ou o colega mais perto que não esteja
//   atrás de uma parede a menos de 0,8 m (Est.paredeNaFrente); sem nenhum, o lado com
//   mais vista livre.
// - Posição da vaga: estacao.posVaga(v) (pelo grupo do módulo).
// - Quem chega com a sala ainda acoplando espera do lado de fora, sem destino.
// - Quando o mapa é remontado, plantaMudou() esquece acessos, lugares em pé e
//   portas, e todo astronauta que anda refaz a rota (replanejarAndando).

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { criarAstronauta, definirProvedor } from './personagens.js';
import { E } from './estado.js';
import { hash } from './pecas.js';
import { CORR } from './layout.js';
import { atualizarContador } from './hud.js';
import * as Nav from './navegacao.js';
import * as Est from './estacao.js';
import { corposNpc } from './sala-corpos.js';

// ---------------------------------------------------------------------------
// Personagens: astronautinhas com olhinhos de luz (personagens.js)
// ---------------------------------------------------------------------------
const ESCALA_BONECO = 1.45;
// O laranja #ee4c01 fica de fora: é reservado para o sinal de "esperando você"
const CORES_AGENTE = [0x0038ef, 0x3f7d5a, 0x7a4b8c, 0x5b7fb5, 0xc0503a, 0x2a8c8c, 0xb5852b];
const criarBoneco = (cor, h) => criarAstronauta(cor, h, 'olhinhos');

// ---------------------------------------------------------------------------
// Constantes de comportamento
// ---------------------------------------------------------------------------
const SALA_DA_ATIVIDADE = { pesquisar: 'pesquisa', descansar: 'descanso', oficina: 'oficina', biblioteca: 'biblioteca' };
const BIBLIOTECA_MS = 60 * 1000;        // consulta de memória ou skill mais recente que isso leva à biblioteca
const VELOCIDADE = 2.6;                 // unidades por segundo (±8% por agente)
const PASSADA = 0.39;                   // comprimento útil da passada na escala 1,45
const AUSENCIAS_PARA_SAIR = 3;          // leituras seguidas sem o agente
const RELOGIO_MS = 60 * 1000;           // fim de trabalho: espera no lugar
const ENTREGAR_MS = 1600;               // espreguiçar ao terminar
const APOIO_MS = 20 * 1000;             // mesa vazia volta a ser mesa de apoio
const FADE_SAIDA_S = 0.4;
const SEM_CONEXAO_MS = 10 * 1000;
const MEMORIA_MS = 15 * 60 * 1000;      // quanto tempo lembra a mesa e a cor de quem saiu
const ALTURA_BALAO = 1.78;              // × fator de tamanho (1 na sessão, 0,8 no subagente)
const ALTURA_RELOGIO = 1.86;
const BALAO_MIN_PX = 70;

// Fila indiana e corpo sólido
const RAIO = Nav.RAIO_CORPO ?? 0.3;     // raio do corpo do astronauta
// dois centros nunca ficam mais perto que isso. O capacete é o corpo (03/10,
// OBRIGATÓRIO): ele tem 0,84 m de diâmetro na escala 1,45, então 0,6 (dois raios de
// parede) deixava dois bonecos sobrepostos na tela; agora 0,85, como os NPCs
// (sala-corpos.js). O raio contra parede e móvel continua RAIO (0,3).
const DMIN = 0.85;
const SEGUIR_PARA = DMIN + 0.15;        // quem vai atrás para a 1,0 (cerca de um passo)
const SEGUIR_SOLTA = SEGUIR_PARA + 0.35;// a partir de 1,10 anda na velocidade toda
const LADO_FILA = 0.8;                  // até essa distância de lado conta como mesma fila
// Escalonar (03/10, visto no navegador): dois andando no mesmo sentido a até 1,6
// de lado, quase na mesma altura, parecem um grupo lado a lado mesmo sem se tocar
// (saindo juntos de mesas vizinhas, indo juntos ao descanso). O de trás (ou o de
// menor prioridade, se estão nivelados) espera o outro abrir 0,7 e só volta à
// velocidade toda com 1,0 de vantagem: um atrás do outro, com cerca de um passo.
const LADO_LARGO = 1.6;
const ESCALONAR_PARA = 0.7, ESCALONAR_SOLTA = 1.0;
const NIVEL_FILA = 0.3;                 // "lado a lado": nenhum dos dois está na frente
const COS_MESMO_SENTIDO = 0.866;        // até 30° de diferença é o mesmo sentido
const ESPACO_LUGAR = Math.max(Nav.PASSO_FILA ?? 0.7, DMIN + 0.15);   // entre lugares em pé
const MARGEM_PORTA = 0.45;              // a passagem conta até 0,45 antes e depois do vão (fora da faixa do corredor)
const ESPERA_ANTES_PORTA = 0.7;         // a porta passa a ser dele a um passo da passagem
const LIBERA_PORTA_MS = 4000;           // dono que não entrou nesse tempo perde a vez
const OLHAR_PORTA = 1.6;                // olha a rota até 1,6 à frente procurando porta
const DIST_BOCA = 1.05;                 // com a porta ocupada, espera a essa distância da boca
const REPLANEJAR_MS = 600;              // parado por um corpo: refaz a rota desviando
const RESGATE_MS = 10 * 1000;           // travado (corpo, parede): some e reaparece no destino
const RESGATE_FILA_MS = 25 * 1000;      // esperando a vez na fila ou na porta: espera mais
const DESISTIR_DESCANSO_MS = 2000;      // descanso vivo travado: muda de ideia
const DAR_PASSAGEM_MS = 1000;           // parado por quem está em pé no caminho: pede passagem
const RECUO_PAUSA_MS = 900;             // quem abriu caminho espera isso ao lado antes de seguir
const SEM_PROGRESSO_MS = 4000;          // sem sair de 0,15 m nesse tempo: rota nova
const RESGATE_PROGRESSO_MS = 9000;      // sem sair de 0,15 m nesse tempo (fora da espera da porta): resgate
const ESPERA_PORTA_MAX_MS = 20000;      // esperando a vez num lugar de espera: no máximo isso
const LOTE_PORTA = 3;                   // na porta disputada, até 3 seguidos no mesmo sentido
// Saída escalonada (03/10, pedido do Eduardo: "andar em fila"): quem termina junto
// (ajudantes de um workflow, sessões que param na mesma leitura) não levanta todo
// mundo no mesmo quadro. Aos 60 s do relógio, cada um espera PARTIDA_MS depois da
// última partida para o descanso que começou a até PARTIDA_RAIO dele; assim saem um
// atrás do outro, em vez de um bloco andando junto por rotas paralelas.
const PARTIDA_MS = 1100;
const PARTIDA_RAIO = 9;

// Partida escalonada geral (rodada 6, de novo o pedido do Eduardo: "eles estão
// todos andando lado a lado"). Visto na simulação das filas: dois atendidos na
// mesma leitura saíam juntos de lugares vizinhos (0,8 m) e andavam lado a lado até
// a mesa. A regra do descanso (acima) só valia para quem ia descansar. Agora toda
// partida de quem está parado (sentado ou em pé) para outro lugar passa pela vez:
// a até PARTIDA_PERTO_RAIO de outra partida que começou há menos de
// PARTIDA_PERTO_MS, espera (parado, sem rota) e sai depois, um de cada vez, na
// ordem em que pediu. O raio é curto (vizinhos de mesa, de fila e de sofá) para a
// estação cheia não criar fila de espera longe dali.
const PARTIDA_PERTO_MS = 900;
const PARTIDA_PERTO_RAIO = 2.2;
const partidasRecentes = [];   // { ms, x, z }

function registrarPartida(a, agoraMs) {
  const p = P(a);
  partidasRecentes.push({ ms: agoraMs, x: p.x, z: p.z });
  while (partidasRecentes.length && (agoraMs - partidasRecentes[0].ms > 3000 || partidasRecentes[0].ms > agoraMs + 1)) partidasRecentes.shift();
  if (partidasRecentes.length > 60) partidasRecentes.shift();
}

function partidaPertoRecente(a, agoraMs) {
  const p = P(a);
  for (const q of partidasRecentes) {
    if (agoraMs >= q.ms && agoraMs - q.ms < PARTIDA_PERTO_MS && Math.hypot(p.x - q.x, p.z - q.z) < PARTIDA_PERTO_RAIO) return true;
  }
  return false;
}

// Última partida para o descanso (saída escalonada)
let ultimaPartida = null;
function vezDePartir(a, agoraMs) {
  const p = P(a), u = ultimaPartida;
  if (u && agoraMs - u.ms < PARTIDA_MS && agoraMs >= u.ms && Math.hypot(p.x - u.x, p.z - u.z) < PARTIDA_RAIO) return false;
  if (partidaPertoRecente(a, agoraMs)) return false;
  ultimaPartida = { ms: agoraMs, x: p.x, z: p.z };
  return true;
}

// Relógio comum: performance.now() ou o último agoraMs recebido, o que for maior
let ultimoAgoraMs = 0;
const relogio = () => Math.max(typeof performance !== 'undefined' ? performance.now() : 0, ultimoAgoraMs);
// Date.now() que acompanha o relógio da cena: no uso normal é o próprio Date.now();
// no teste acelerado (testes.js), anda junto com o tempo simulado
const agoraParede = () => Date.now() + Math.max(0, ultimoAgoraMs - (typeof performance !== 'undefined' ? performance.now() : 0));

// Número pseudoaleatório estável entre 0 e 1 a partir da semente e de um contador
function aleat(semente, n) {
  const x = Math.sin((semente % 100003) * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Diferença de ângulo entre -π e π
function difAngulo(alvo, atual) {
  const d = (alvo - atual) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
}

function semConexaoLonga() {
  const desde = E.semConexaoDesde;
  if (!desde) return false;
  const agora = desde > 1e11 ? Date.now() : relogio();   // aceita Date.now() ou performance.now()
  return agora - desde > SEM_CONEXAO_MS;
}

// ---------------------------------------------------------------------------
// Cores: distribuídas por ordem de chegada, pulando as que estão em uso.
// O subagente usa a cor da sessão que o criou (mesma chave no Map).
// ---------------------------------------------------------------------------
const cores = new Map();            // chave (id da sessão) -> { indice, refs }
const coresLembradas = new Map();   // chave -> índice, para quem volta
let proximaCor = 0;

function pegarCor(dado) {
  const chave = dado.tipo === 'subagente' && dado.pai ? dado.pai : dado.id;
  let c = cores.get(chave);
  if (!c) {
    const usados = new Set([...cores.values()].map(x => x.indice));
    let indice = coresLembradas.get(chave);
    if (indice == null || usados.has(indice)) {
      indice = -1;
      for (let k = 0; k < CORES_AGENTE.length; k++) {
        const i = (proximaCor + k) % CORES_AGENTE.length;
        if (!usados.has(i)) { indice = i; break; }
      }
      if (indice < 0) indice = hash(chave) % CORES_AGENTE.length;   // mais sessões que cores
      proximaCor = (indice + 1) % CORES_AGENTE.length;
    }
    c = { indice, refs: 0 };
    cores.set(chave, c);
  }
  c.refs++;
  return { chave, cor: CORES_AGENTE[c.indice] };
}

function soltarCor(a) {
  const c = cores.get(a.chaveCor);
  if (!c) return;
  if (--c.refs <= 0) {
    cores.delete(a.chaveCor);
    coresLembradas.set(a.chaveCor, c.indice);
  }
}

// Mesa de quem saiu, para reocupar a mesma se ele voltar
const memoria = new Map();   // id -> { vaga, ate }

// ---------------------------------------------------------------------------
// Criar e remover astronautas
// ---------------------------------------------------------------------------
let contadorChegada = 0;

function novoAgente(dado) {
  const h = hash(dado.id);
  const { chave, cor } = pegarCor(dado);
  const boneco = criarBoneco(cor, h);
  // olhinhos e luz da antena na cor do provedor (Claude coral, Codex verde); traje na cor do agente
  const provedor = dado.provedor === 'openai' ? 'openai' : 'anthropic';
  definirProvedor(boneco, provedor);
  boneco.scale.setScalar(0.01);
  if (dado.tipo === 'subagente') boneco.userData.miniatura = 0.8;
  const fator = boneco.userData.miniatura || 1;

  // subagente nasce ao lado da sessão que o criou, num lugar livre (corpo sólido:
  // a 0,8 ou mais dela e de todo mundo). Sessão entra pela porta, um por vez: até a
  // entrada ficar livre, espera invisível do lado de fora (aguardandoEntrada).
  const mae = dado.tipo === 'subagente' && dado.pai ? E.agentes.get(dado.pai) : null;
  let sala = 'fora', aguardandoEntrada = false;
  const perto = mae && !mae.saindo && !mae.aguardandoEntrada && mae.alvo !== 'fora' && mae.sala !== 'fora'
    ? lugarPertoDaMae(mae) : null;
  if (perto) {
    boneco.position.copy(perto);
    boneco.rotation.y = mae.boneco.rotation.y;
    sala = mae.sala || 'corredor';
  } else {
    boneco.position.copy(pontoDeEntrada());
    boneco.rotation.y = -Math.PI / 2;   // olhando para dentro (-x)
    boneco.visible = false;
    aguardandoEntrada = true;
  }
  E.cena.add(boneco);

  // placa do hover (nome e ação), presa ao boneco
  const div = document.createElement('div');
  div.className = 'placa-agente' + (dado.tipo === 'subagente' ? ' sub' : '');
  const spanNome = document.createElement('span');
  spanNome.className = 'nome';
  spanNome.style.background = '#' + new THREE.Color(cor).getHexString();
  const spanAcao = document.createElement('span');
  spanAcao.className = 'acao';
  div.append(spanNome, spanAcao);
  const placa = new CSS2DObject(div);
  placa.position.set(0, 1.35, 0);
  boneco.add(placa);
  boneco.userData.agenteId = dado.id;

  // balão de pensamento: objeto da cena que só copia a posição do boneco
  // (não gira com ele); o deslocamento para a direita é o translate do CSS
  const divBalao = document.createElement('div');
  divBalao.className = 'balao' + (dado.tipo === 'subagente' ? ' sub' : '');
  const balao = new CSS2DObject(divBalao);
  E.cena.add(balao);

  const lembrado = memoria.get(dado.id);
  memoria.delete(dado.id);

  const a = {
    id: dado.id, tipo: dado.tipo, pai: dado.pai || null, h, cor, chaveCor: chave, fator, provedor,
    boneco, div, spanNome, spanAcao, placa, divBalao, balao, objRelogio: null,
    vistos: new Set((dado.pensamentos || []).map(p => p.id)),
    filaBalao: [], balaoAte: 0, balaoDesde: 0, balaoAtivo: false, baloesAgendados: [],
    sala, alvo: null, salaDestino: null, vaga: null, casa: null, ultimaVaga: lembrado?.vaga || null, mesaPorSala: {},
    rota: [], estado: 'parado', fade: 0, saindo: false, girando: false, girandoDesde: 0,
    // fila indiana e corpo sólido
    aguardandoEntrada, ordemChegada: ++contadorChegada, assento: null, vagaRota: null, destinoFinal: null,
    dirx: undefined, dirz: undefined, parouDesde: 0, corpoDesde: 0, ultimoReplano: 0, ultimoAvanco: 0,
    esperandoPorta: null, proxPorta: null, espera: null, progresso: null, pausaAte: 0, replanejarDepois: false, trechoAssento: false, resgatando: false, saindoDe: null, desviou: false, motivo: null, ladoDesvio: null, desvioDesde: 0,
    ausente: 0, atividade: null, passouDescanso: false,
    relogioAtivo: false, relogioVisivel: false, paradoHaMs: 0, paradoRecebidoEm: 0, entregarAte: 0,
    proxAcao: 0, nAcao: 0, conversaCom: null, ultimaAcao: 0,
    fase: (h % 997) / 997 * Math.PI * 2,
    passo: 0,
    velocidade: VELOCIDADE * (0.92 + 0.16 * aleat(h, 5)),
    modo: null, sentadoAntes: false, transicaoAte: 0, led: null,
    // filas da sala do dono e da revisão (rodada 6)
    filaId: null, chegadaFila: 0, posFila: -1, pendencia: null, abrivel: false, nota: null, filaPendente: null,
    partidaPendente: null,   // { destino, desde }: esperando a vez de partir (partida escalonada geral)
  };
  E.agentes.set(dado.id, a);
  return a;
}

// Tira o astronauta da cena: divs CSS2D, materiais exclusivos, foco do hover e cor
export function removerAgente(a) {
  if (a.animDescanso) { a.animDescanso.encerrar(); a.animDescanso = null; }
  desligarRelogio(a);
  encerrarConversa(a);
  if (a.alvo !== 'fora') lembrarMesa(a);
  soltarCasa(a);
  liberarVaga(a);
  a.boneco.traverse(o => { if (o.isCSS2DObject) o.element?.remove?.(); });
  for (const obj of [a.balao, a.objRelogio, a.nota]) {
    if (!obj) continue;
    obj.element?.remove?.();
    E.cena.remove(obj);
  }
  E.cena.remove(a.boneco);
  a.boneco.userData.liberar?.();   // geometrias são compartilhadas: sem dispose
  E.agentes.delete(a.id);
  if (a.filaId) filasSujas = true;
  for (const st of portas.values()) {
    if (st.dono === a) st.dono = null;
    if (st.proximo === a) st.proximo = null;
    st.espera.delete(a);
  }
  if (E.emFoco === a) { a.div.classList.remove('visivel'); E.emFoco = null; }
  soltarCor(a);
  E.sujo = true;
}

function lembrarMesa(a) {
  // a mesa do coworking vale mais que o sofá: é para ela que ele volta
  const v = a.casa || a.mesaPorSala.coworking || (vagaReal(a.vaga) ? a.vaga : null) || a.ultimaVaga;
  if (v) a.ultimaVaga = v;
  memoria.set(a.id, { vaga: a.ultimaVaga, ate: Date.now() + MEMORIA_MS });
}

// Célula livre do mapa mais perto de (x, z), como ponto do mundo
function pontoLivre(x, z) {
  const m = E.mapa;
  if (!m) return null;
  const c = m.livreMaisProxima(...m.celula(x, z));
  return c ? m.centro(c[0], c[1]) : null;
}

function andavelEm(x, z) {
  const m = E.mapa;
  if (!m) return false;
  const [i, j] = m.celula(x, z);
  return m.dentro(i, j) && m.andavel(j * m.nx + i);
}

// ---------------------------------------------------------------------------
// Corpo sólido: quem conta como corpo e lugares em pé válidos
// ---------------------------------------------------------------------------
const P = a => a.boneco.position;

// Conta como corpo quem está na cena: desde o primeiro quadro em que aparece (ele
// só aparece num lugar livre) até quase sumir no fade de saída ou do resgate.
// Quem espera invisível para entrar não conta.
function solido(o) {
  if (o.aguardandoEntrada || E.agentes.get(o.id) !== o) return false;
  return o.fade > 0.15 || (!o.saindo && !o.resgatando);
}

// O corpo inteiro cabe em (x, z): célula andável e, com folgaEm, a 0,3 ou mais de
// qualquer parede, divisória ou móvel
function corpoCabe(x, z) {
  if (!andavelEm(x, z)) return false;
  return !E.mapa.folgaEm || E.mapa.folgaEm(x, z) >= RAIO;
}

// Distância até o obstáculo mais perto: E.mapa.folgaEm (navegacao.js) ou, sem ela,
// confere que as células num raio de 0,3 em volta são andáveis
function folgaBoa(x, z, minimo) {
  const m = E.mapa;
  if (m.folgaEm) return m.folgaEm(x, z) >= minimo;
  for (const [dx, dz] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) if (!andavelEm(x + dx, z + dz)) return false;
  return true;
}

const portaEm = (x, z, margem = MARGEM_PORTA) => E.mapa?.portaEm?.(x, z, margem) ?? null;

// Na passagem de uma porta ou no corredor de chegada dela (até 1,8 antes e depois
// do vão, com 0,2 de sobra de cada lado): ninguém fica parado ali
function naFrenteDaPorta(x, z) {
  for (const p of E.mapa?.portas || []) {
    const ao = p.eixo === 'x' ? x - p.x : z - p.z;
    const la = p.eixo === 'x' ? z - p.z : x - p.x;
    if (Math.abs(ao) < 1.8 && Math.abs(la) < p.larg / 2 + 0.2) return true;
  }
  return !!portaEm(x, z, MARGEM_PORTA + 0.45);
}

// A planta pode ser remontada (rodada 3): os guardados abaixo valem para o mapa e
// as vagas de agora (mesmo mapa, mesma primeira vaga, mesmo total de vagas)
function chavePlanta() {
  let n = 0, v0 = null;
  for (const s of Object.values(E.salas)) { if (!v0 && s.vagas[0]) v0 = s.vagas[0]; n += s.vagas.length; }
  return { mapa: E.mapa, v0, n, versao: E.versaoMapa };
}
// a versão do mapa (estacao.js) muda a cada remontagem: uma coluna de mesas que some e
// outra que aparece deixam o total de vagas igual, mas os acessos mudam
const mesmaPlanta = (k1, k2) => !!(k1 && k2 && k1.mapa === k2.mapa && k1.v0 === k2.v0 && k1.n === k2.n && k1.versao === k2.versao);

// Para quem remonta a planta no mesmo mapa (mapa.limpar() e marcar de novo):
// esquece acessos, lugares em pé e pontos do descanso calculados antes
export function plantaMudou() {
  vagasFixas.chave = null;
  for (const v of Object.values(E.salas).flatMap(s => s.vagas)) { v._acesso = null; v._caixasAlheias = null; }
  candidatosCache.clear();
  acessosDados.chave = null;
  acessosDados.lista = [];
  cachePontos = { mapa: null, sala: null, pontos: [] };
  // as portas do mapa são objetos novos: esquece donos e esperas das antigas
  portas.clear();
  for (const a of E.agentes.values()) { a.esperandoPorta = null; a.proxPorta = null; }
}

// Mapa remontado (módulo acoplou ou desacoplou): quem anda refaz a rota a partir
// de onde está, para a mesma vaga ou o mesmo lugar
function replanejarAndando() {
  const agoraMs = relogio();
  for (const a of E.agentes.values()) {
    if (a.estado !== 'andando' || a.saindo || a.resgatando || !a.salaDestino) continue;
    if (a.salaDestino === 'fora') rotaAte(a, 'fora');
    else {
      const v = a.vagaRota;
      const destino = v ? posDaVaga(a, v) : a.destinoFinal;
      if (!destino) continue;
      rotaAte(a, a.salaDestino, destino, { vaga: v });
    }
    a.ultimoReplano = agoraMs;
  }
}

let vagasFixas = { chave: null, lista: [] };
function todasAsVagas() {
  const chave = chavePlanta();
  if (!mesmaPlanta(vagasFixas.chave, chave)) {
    vagasFixas = { chave, lista: Object.values(E.salas).flatMap(s => s.vagas) };
    candidatosCache.clear();
    acessosDados.chave = null;
  }
  return vagasFixas.lista;
}

// Lugar em pé que não depende de quem está na cena: andável, longe de divisória e
// móvel (nunca encostado), fora da passagem das portas, longe das cadeiras, do sofá
// e do caminho de quem senta (acesso)
function lugarFixoValido(x, z) {
  if (!andavelEm(x, z) || !folgaBoa(x, z, RAIO + 0.08)) return false;
  if (naFrenteDaPorta(x, z)) return false;
  for (const v of todasAsVagas()) {
    if (Math.hypot(v.pos.x - x, v.pos.z - z) < 0.7) return false;
    if (v.pose === 'sentado') {
      const ac = acessoDe(v);
      if (Math.hypot(ac.x - x, ac.z - z) < 0.45) return false;
    }
  }
  return true;
}

// Livre também de quem está na cena: longe da posição e do destino de cada um
function lugarValido(x, z, a, espaco = ESPACO_LUGAR, fixoJaConferido = false) {
  if (!fixoJaConferido && !lugarFixoValido(x, z)) return false;
  if (!a?.filaId && pertoDeLugarDeFila(x, z)) return false;   // lugares da fila são de quem está nela
  for (const n of npcsQuadro) if (Math.hypot(n.boneco.position.x - x, n.boneco.position.z - z) < espaco) return false;
  for (const o of E.agentes.values()) {
    if (o === a) continue;
    const q = P(o);
    if (!o.aguardandoEntrada && Math.hypot(q.x - x, q.z - z) < espaco) return false;
    const d = o.destinoFinal;   // quem ainda espera para entrar já tem o lugar reservado
    if (d && !o.saindo && Math.hypot(d.x - x, d.z - z) < espaco) return false;
  }
  return true;
}

// Pontos fixos válidos de uma sala, numa grade de 0,35 (guardados por mapa)
const candidatosCache = new Map();   // limpo quando a planta muda (todasAsVagas)
function candidatosDaSala(id, s) {
  todasAsVagas();
  const c = candidatosCache.get(id);
  if (c && c.mapa === E.mapa && c.sala === s) return c.pontos;
  const pontos = [];
  for (let x = s.x0 + 0.45; x <= s.x1 - 0.45; x += 0.35) {
    for (let z = s.z0 + 0.45; z <= s.z1 - 0.45; z += 0.35) if (lugarFixoValido(x, z)) pontos.push({ x, z });
  }
  candidatosCache.set(id, { mapa: E.mapa, sala: s, pontos });
  return pontos;
}

// Lugar livre a 0,8 a 1,25 da mãe, para o subagente nascer
function lugarPertoDaMae(mae) {
  const c = P(mae);
  for (const r of [0.95, 1.1, 1.3]) {
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2 + (mae.h % 7) * 0.3;
      const x = c.x + Math.sin(ang) * r, z = c.z + Math.cos(ang) * r;
      if (lugarValido(x, z, null)) return new THREE.Vector3(x, 0, z);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vagas: mesa posto/apoio, mesa-casa e ordem fixa
// ---------------------------------------------------------------------------
const ehMesa = v => !!(v && (v.tela || v.definirPosto));
const vagaReal = v => !!(v && !v.extra && !v.ponto && !v.conversa && !v.fila);
const livrePara = (v, a) => !v.ocupada && (!v.casaDe || v.casaDe === a);
const ordemDe = v => v.ordem ?? v._ordem ?? 0;
const deFrente = v => Math.cos(v.olhar - Math.PI / 4) > 0;   // olha para a câmera

function acender(v, nivel) {
  if (!ehMesa(v)) return;
  if (v.acenderTela) v.acenderTela(nivel);
  else if (v.tela) v.tela.emissiveIntensity = nivel;
  E.sujo = true;
}

function ligarPosto(v, ligado) {
  if (!ehMesa(v) || v._posto === ligado) return;
  v._posto = ligado;
  v.definirPosto?.(ligado);
  E.sujo = true;
  atualizarPendentes();
}

function agendarApoio(v) {
  if (!ehMesa(v)) return;
  if (v.timerApoio) clearTimeout(v.timerApoio);
  v.timerApoio = setTimeout(() => {
    v.timerApoio = null;
    if (!v.ocupada && !v.casaDe) ligarPosto(v, false);
  }, APOIO_MS);
}

// Pendente acesa por ilha (e por sala com pendente) enquanto alguma mesa dela é posto
function atualizarPendentes() {
  // cada luminária dos módulos prontos acende se alguma mesa dela é posto
  for (const l of Est.luzesDaEstacao()) {
    const n = l.vagas.some(v => v._posto) ? 1 : 0;
    if (l._nivel === n) continue;
    l._nivel = n;
    l.pendente?.definirNivel?.(n);
  }
}

// Ordem fixa das vagas, quando a planta não traz v.ordem:
// nas colunas de mesas, primeiro a de frente para a câmera; nas outras salas,
// primeiro os assentos e depois a mais perto da porta (lado do corredor).
function prepararSala(id, s) {
  if (s._preparada === s.vagas) return;
  s._preparada = s.vagas;
  for (const v of s.vagas) v.sala ??= id;
  const grupos = s.colunas ? s.colunas.map(c => c.vagas) : [s.vagas];
  for (const g of grupos) {
    g.map((v, i) => ({ v, k: s.colunas ? (deFrente(v) ? 0 : 100) + i
      : (v.pose === 'sentado' ? 0 : 100) + Math.hypot(v.pos.x - s.portaX, v.pos.z - s.portaZ) }))
      .sort((x, y) => x.k - y.k)
      .forEach((o, n) => { o.v._ordem = n; });
  }
}

function primeiraPorOrdem(vagas) {
  let melhor = null;
  for (const v of vagas) if (!melhor || ordemDe(v) < ordemDe(melhor)) melhor = v;
  return melhor;
}

// A vaga da lista mais perto de algum dos pontos (empate: menor ordem)
function maisPerto(vagas, pontos) {
  let melhor = null, dMelhor = Infinity;
  for (const v of vagas) {
    let d = Infinity;
    for (const p of pontos) d = Math.min(d, Math.hypot(v.pos.x - p.x, v.pos.z - p.z));
    if (d < dMelhor - 1e-6 || (Math.abs(d - dMelhor) <= 1e-6 && ordemDe(v) < ordemDe(melhor))) { melhor = v; dMelhor = d; }
  }
  return melhor;
}

// Sessão dona do conjunto de mesas do agente (a própria sessão, ou a mãe do subagente)
const sessaoDe = a => Est.sessaoDoAgente?.(a.id) ?? (a.tipo === 'subagente' && a.pai ? a.pai : a.id);

// A vaga ainda existe nesta sala (o módulo ou a coluna dela pode ter saído) e, se for
// uma mesa de sala de pasta, é da pasta dele
function vagaValida(s, v, a) {
  if (!v || v.removida || !s.vagas.includes(v)) return false;
  if (!s.colunas) return true;
  return !!v.coluna && (v.coluna.sessao === sessaoDe(a) || v.coluna.pasta === a.pasta);
}

function pegarVaga(idSala, a) {
  const s = E.salas[idSala];
  if (!s) return null;
  prepararSala(idSala, s);
  // v.removida: o módulo ou a coluna da vaga está saindo (ainda não saiu das salas)
  const livres = vs => vs.filter(v => livrePara(v, a) && !v.removida);

  // a casa, a mesa que ele já usou nesta sala, ou a última mesa antes de sair
  if (a.casa?.sala === idSala && livrePara(a.casa, a) && vagaValida(s, a.casa, a)) return a.casa;

  if (s.colunas) {
    // sala da pasta: o conjunto da sessão dele, ao lado da mãe (subagente)
    const sessao = sessaoDe(a);
    const minhas = s.colunas.filter(c => c.sessao === sessao).flatMap(c => c.vagas);
    const mae = a.tipo === 'subagente' && a.pai ? E.agentes.get(a.pai) : null;
    const ref = mae && (mae.casa || (vagaReal(mae.vaga) ? mae.vaga : null));
    let l = livres(minhas);
    if (l.length) return ref && minhas.includes(ref) ? maisPerto(l, [ref.pos]) : primeiraPorOrdem(l);
    const lembrada = a.mesaPorSala[idSala] || (a.ultimaVaga?.sala === idSala ? a.ultimaVaga : null);
    if (lembrada && livrePara(lembrada, a) && vagaValida(s, lembrada, a) && lembrada.coluna?.sessao === sessao) return lembrada;
    // teto (a sala não cresceu): a folga de outro conjunto da mesma pasta, perto do dele
    l = livres(s.colunas.filter(c => c.pasta === a.pasta).flatMap(c => c.vagas));
    if (l.length) {
      const refs = (minhas.length ? minhas : ref ? [ref] : []).map(v => v.pos);
      return refs.length ? maisPerto(l, refs) : primeiraPorOrdem(l);
    }
    return vagaExtra(idSala, s, a);
  }
  const lembrada = a.mesaPorSala[idSala] || (a.ultimaVaga?.sala === idSala ? a.ultimaVaga : null);
  if (lembrada && livrePara(lembrada, a) && vagaValida(s, lembrada, a)) return lembrada;
  const l = livres(s.vagas);
  // biblioteca: o lugar mais perto da estante da área que ele está consultando
  const xArea = idSala === 'biblioteca' && a.areaBiblioteca ? s.modulo?.salaNova?.lugarDaArea?.(a.areaBiblioteca) : null;
  if (l.length && xArea != null) {
    const xMundo = s.modulo.grupo.position.x + xArea;
    return l.reduce((m, v) => (Math.abs(v.pos.x - xMundo) < Math.abs(m.pos.x - xMundo) ? v : m));
  }
  if (l.length) return primeiraPorOrdem(l);
  // descanso sem assento livre: um ponto em pé livre do descanso (lugar aberto, longe
  // da passagem estreita da entrada) antes de um lugar qualquer
  if (idSala === 'descanso') {
    const p = pontosDoDescanso(s).find(q => !q.ocupadoPor && lugarValido(q.pos.x, q.pos.z, a, ESPACO_LUGAR, true));
    if (p) return { pos: p.pos.clone(), olhar: p.olhar, pose: 'em-pe', ponto: p, sala: 'descanso' };
  }
  return vagaExtra(idSala, s, a);
}

// Sala cheia: fica em pé perto da porta, por dentro, num lugar válido (fora da
// passagem, longe de divisória, mesas e de outros astronautas). No coworking, dentro
// da sala da pasta dele (e o mais perto do conjunto da sessão). Para onde olha:
// olharEmPe (nunca de cara para a parede).
function vagaExtra(idSala, s, a) {
  // o mais perto da porta, mas a 2,2 ou mais dela: quem fica em pé não estreita a
  // chegada de quem entra e sai (sem lugar assim, o mais perto que houver)
  let melhor = null, dMelhor = Infinity;
  const partes = s.colunas ? Est.partesDaPasta?.(a.pasta) : null;
  const regioes = partes?.length ? partes.map((r, i) => ({ id: `coworking:${a.pasta}:${i}`, r })) : [{ id: idSala, r: s }];
  const minhas = s.colunas ? s.colunas.filter(c => c.sessao === sessaoDe(a)).flatMap(c => c.vagas) : [];
  for (const { id, r } of regioes) {
    const zPorta = r.z0 < 0 ? -CORR : CORR;
    const xPorta = s.colunas ? r.cx : s.portaX;
    for (const c of candidatosDaSala(id, r)) {
      const dPorta = Math.hypot(c.x - xPorta, c.z - zPorta);
      let d = dPorta + (dPorta < 2.2 ? 100 : 0);
      if (minhas.length) d = Math.min(...minhas.map(v => Math.hypot(v.pos.x - c.x, v.pos.z - c.z))) + (dPorta < 2.2 ? 100 : 0);
      // gargalo (passagem estreita entre móveis): só se não houver lugar aberto
      if (!lugarAberto(c.x, c.z)) d += 50;
      if (d < dMelhor && lugarValido(c.x, c.z, a, ESPACO_LUGAR, true)) { melhor = c; dMelhor = d; }
    }
  }
  const pos = melhor ? new THREE.Vector3(melhor.x, 0, melhor.z)
    : (pontoLivre(s.portaX, s.portaZ + (s.fila === 'n' ? -1.2 : 1.2)) || new THREE.Vector3(s.portaX, 0, s.portaZ));
  return { pos, olhar: Math.PI / 4, pose: 'em-pe', extra: true, sala: idSala };
}

function reservarVaga(a, v, idSala) {
  a.vaga = v;
  if (v?.ponto) v.ponto.ocupadoPor = a;
  if (!v || !vagaReal(v)) return;
  v.ocupada = a;
  if (v.timerApoio) { clearTimeout(v.timerApoio); v.timerApoio = null; }
  ligarPosto(v, true);   // a mesa vira posto antes de ele chegar
  a.mesaPorSala[idSala] = v;
  if (idSala === 'coworking' && ehMesa(v)) {
    if (a.casa && a.casa !== v) soltarCasa(a);
    a.casa = v;
    v.casaDe = a;
  }
}

// Sai da vaga atual. Se for a casa, ela continua dele: tela meio acesa e caneca.
function liberarVaga(a) {
  const v = a.vaga;
  if (!v) return;
  a.vaga = null;
  a.girando = false;
  if (v.ponto) { if (v.ponto.ocupadoPor === a) v.ponto.ocupadoPor = null; return; }
  if (!vagaReal(v)) return;
  if (v.ocupada === a) v.ocupada = null;
  if (v.servico) v.mostrarServico?.(null);   // MCP e API (e a mesa no teto): o monitor volta ao normal
  a.servicoMostrado = null;
  if (v.casaDe === a) {
    acender(v, 0.6);
    v.definirCaneca?.(a.cor);
    return;
  }
  acender(v, 0);
  agendarApoio(v);
}

// Devolve a casa (descanso depois do relógio, ou saída): vira apoio em 20 s
function soltarCasa(a) {
  const v = a.casa;
  if (!v) return;
  a.casa = null;
  if (v.casaDe === a) v.casaDe = null;
  v.definirCaneca?.(null);
  if (v.ocupada === a) return;   // ainda sentado nela: liberarVaga cuida
  if (v.ocupada) return;
  acender(v, 0);
  agendarApoio(v);
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------
// Ponto da porta usado nas rotas de entrada e saída (testes.js usa o mesmo)
export function pontoDaPorta() { return new THREE.Vector3(E.X1 - 0.3, 0, 0); }

// Faixa da mão direita do corredor no ponto (x, z) para quem anda no sentido sx
function faixaZ(x, sx) {
  const m = E.mapa;
  const c = m?.corredorEm?.(x, 0);
  if (c && m.faixaDaMaoDireita) return m.faixaDaMaoDireita(c, sx);
  return Math.sign(sx) * 0.45;   // mapa sem faixas: mesmo desenho (0,45 do meio)
}

// Quem chega nasce do lado de fora, na faixa de quem anda para dentro (-x);
// quem vai embora some do lado de fora, na faixa de quem anda para fora (+x)
function pontoDeEntrada() {
  const x = E.ENTRADA_FORA.x;
  return new THREE.Vector3(x, 0, faixaZ(x, -1));
}
function pontoDeSaida() {
  const x = E.ENTRADA_FORA.x;
  return new THREE.Vector3(x, 0, faixaZ(x, 1));
}

// Acesso de uma vaga sentada: por trás da banqueta (mesa) ou pela frente (sofá),
// a 0,5 a 1,2 do assento, onde o corpo cabe e sem encostar em outro móvel no
// trecho. Cada vaga tem o seu: dois acessos ficam a 0,65 ou mais um do outro e de
// qualquer assento (dois levantando juntos não se travam). Sem lugar assim, tenta
// de lado e, por fim, a célula livre mais perto (como antes). Guardado por mapa.
const acessosDados = { chave: null, lista: [] };
// Para conferência (testes): o acesso que a vaga usa agora
export function acessoDaVaga(v) { return acessoDe(v); }
function acessoDe(v) {
  const vagas = todasAsVagas();
  if (!acessosDados.chave) {
    // calcula todos de uma vez, sempre na mesma ordem (a escolha não depende de
    // quem sentou primeiro)
    acessosDados.chave = vagasFixas.chave;
    acessosDados.lista = [];
    for (const o of vagas) if (o.pose === 'sentado' || o.encostado) calcularAcesso(o);
  }
  if (v._acesso && v._acessoMapa === E.mapa && v._acessoVersao === E.versaoMapa) return v._acesso;
  return calcularAcesso(v);
}

function calcularAcesso(v) {
  const fx = Math.sin(v.olhar), fz = Math.cos(v.olhar);
  const sentido = ehMesa(v) || v.acessoAtras ? -1 : 1;   // banquinho da oficina: chega por trás
  const direcoes = [[fx * sentido, fz * sentido], [-fx * sentido, -fz * sentido], [fz, -fx], [-fz, fx]];
  const longeDosOutros = (x, z) => acessosDados.lista.every(q => Math.hypot(q.x - x, q.z - z) >= DMIN)
    && todasAsVagas().every(o => o === v || o.pose !== 'sentado' || Math.hypot(o.pos.x - x, o.pos.z - z) >= DMIN);
  let achado = null;
  for (const [ux, uz] of direcoes) {
    for (let d = 0.5; d <= 1.201 && !achado; d += 0.1) {
      const x = v.pos.x + ux * d, z = v.pos.z + uz * d;
      if (corpoCabe(x, z) && trechoDoAssentoLimpo(v, x, z) && longeDosOutros(x, z)) achado = new THREE.Vector3(x, 0, z);
    }
    if (achado) break;
  }
  v._acesso = achado || pontoLivre(v.pos.x, v.pos.z) || v.pos.clone();
  v._acessoMapa = E.mapa;
  v._acessoVersao = E.versaoMapa;
  acessosDados.lista.push(v._acesso);
  return v._acesso;
}

// O trecho assento -> acesso só pode encostar nos móveis do próprio lugar (banqueta,
// mesa ou sofá: caixas a menos de 0,35 do assento). Com as caixas cruas do mapa
// (E.mapa.obstaculos), o corpo passa a 0,3 ou mais de todo o resto; sem elas, só
// pode cruzar células bloqueadas perto do assento.
function trechoDoAssentoLimpo(v, x, z) {
  const p = v.pos;
  const n = Math.ceil(Math.hypot(x - p.x, z - p.z) / 0.05);
  const caixas = E.mapa.obstaculos;
  const dist = (r, qx, qz) => Math.hypot(Math.max(r.xa - qx, 0, qx - r.xb), Math.max(r.za - qz, 0, qz - r.zb));
  if (v._caixasVersao !== E.versaoMapa) { v._caixasAlheias = null; v._caixasVersao = E.versaoMapa; }
  const alheias = caixas ? (v._caixasAlheias ||= caixas.filter(r => dist(r, p.x, p.z) >= 0.35 && dist(r, p.x, p.z) < 2.5)) : null;
  for (let k = 0; k <= n; k++) {
    const qx = p.x + (x - p.x) * k / n, qz = p.z + (z - p.z) * k / n;
    if (alheias) { if (alheias.some(r => dist(r, qx, qz) < RAIO)) return false; }
    else if (!andavelEm(qx, qz) && Math.hypot(qx - p.x, qz - p.z) > 0.45) return false;
  }
  return true;
}

// A* do mapa desviando, se pedido, de quem está parado (as células a menos de
// DMIN de cada um ficam bloqueadas só durante a busca: com o capacete de 0,84, uma
// passagem que deixa menos que isso ao lado de quem está parado não serve). Sem
// caminho, tenta sem os desvios; sem caminho nenhum, vai reto (como o mapa faz).
const RAIO_EVITAR = DMIN - 0.05;
function caminhoSeguro(de, para, evitar = []) {
  const m = E.mapa;
  const mudadas = [];
  const nc = Math.ceil(RAIO_EVITAR / 0.2);
  for (const q of evitar) {
    const [ci, cj] = m.celula(q.x, q.z);
    for (let i = ci - nc; i <= ci + nc; i++) for (let j = cj - nc; j <= cj + nc; j++) {
      if (!m.dentro(i, j)) continue;
      const k = j * m.nx + i;
      if (m.bloq[k]) continue;
      const c = m.centro(i, j);
      if (Math.hypot(c.x - q.x, c.z - q.z) > RAIO_EVITAR) continue;
      if (Math.hypot(c.x - de.x, c.z - de.z) < 0.25 || Math.hypot(c.x - para.x, c.z - para.z) < 0.25) continue;
      m.bloq[k] = 1;
      mudadas.push(k);
    }
  }
  let pts = null, falhou = false;
  const aviso = console.warn;
  console.warn = () => { falhou = true; };
  try { pts = m.caminho(de, para); } finally {
    console.warn = aviso;
    for (const k of mudadas) m.bloq[k] = 0;
  }
  if (falhou && mudadas.length) return caminhoSeguro(de, para, []);
  if (falhou) console.warn('sem caminho entre', de, para);
  return pts;
}

// Rota até o destino. Quem está sentado levanta pelo acesso da vaga; quem vai
// sentar chega pelo acesso e só então entra no assento (trechos marcados, para o
// teste de corpo sólido saber que ali ele entra de propósito na área da banqueta).
// Não há mais ponto da porta no começo: quem nasce já está na faixa de entrada,
// então trocar de destino nos primeiros segundos não faz meia-volta (BUG-04).
function rotaAte(a, idSala, destino, { vaga = null, evitar = [] } = {}) {
  const p = P(a);
  const pts = [];
  let de = p.clone();
  // sentado, ou ainda no trecho entre o assento e o acesso (levantando, ou desistiu
  // de sentar no meio do caminho): volta pelo acesso daquela vaga
  const s = a.assento || a.saindoDe || (a.rota[0]?.assento ? a.vagaRota : null);
  if (s && (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 0.25 || !corpoCabe(p.x, p.z))) {
    const ac = acessoDe(s).clone();
    ac.saidaAssento = true;
    pts.push(ac);
    de = ac;
    a.saindoDe = s;
  } else a.saindoDe = null;
  a.assento = null;
  if (idSala === 'fora') pts.push(...caminhoSeguro(de, pontoDeSaida(), evitar));
  else if (vaga && (vaga.pose === 'sentado' || vaga.encostado) && vagaReal(vaga)) {
    pts.push(...caminhoSeguro(de, acessoDe(vaga), evitar));
    const fim = destino.clone();
    fim.assento = true;
    pts.push(fim);
  } else pts.push(...caminhoSeguro(de, destino, evitar));
  // o A* começa no centro da célula onde ele está: se dá para ir direto ao ponto
  // seguinte, pula esse passinho (que às vezes vai na direção de quem está ao lado)
  if (pts.length >= 2 && !pts[0].saidaAssento && Math.hypot(pts[0].x - p.x, pts[0].z - p.z) < 0.2
    && corpoCabe(p.x, p.z) && visaoLivre(p, pts[1])) pts.shift();
  a.rota = pts;
  if (a.espera) { estadoPorta(a.espera.porta).espera.delete(a); a.espera = null; }
  a.trechoAssento = !!(pts[0]?.assento || pts[0]?.saidaAssento);
  a.salaDestino = idSala;
  a.vagaRota = vaga;
  a.destinoFinal = pts[pts.length - 1].clone();
  a.estado = 'andando';
  a.girando = false;
  a.parouDesde = 0;
  a.corpoDesde = 0;
  a.desviou = false;
}

// Refaz a rota desviando de quem está parado (sentado, em pé ou travado)
function replanejar(a, agoraMs) {
  a.ultimoReplano = agoraMs;
  const evitar = [];
  for (const o of E.agentes.values()) {
    if (o === a || !solido(o)) continue;
    if (o.estado !== 'andando' || (o.parouDesde && agoraMs - o.parouDesde > 300)) evitar.push(P(o).clone());
  }
  for (const n of npcsQuadro) evitar.push(n.boneco.position.clone());
  const v = a.vagaRota;
  const destino = a.salaDestino === 'fora' ? null : v && vagaReal(v) && (v.pose === 'sentado' || v.encostado) ? posDaVaga(a, v) : a.destinoFinal;
  rotaAte(a, a.salaDestino, destino, { vaga: v, evitar });
}

// Ponto onde o boneco fica na vaga. O subagente (menor) senta 0,08 mais perto da mesa.
function posDaVaga(a, v) {
  if (!v) return null;
  const p = Est.posVaga(v);
  if (a.tipo === 'subagente' && ehMesa(v) && v.pose === 'sentado') {
    return p.add(new THREE.Vector3(Math.sin(v.olhar), 0, Math.cos(v.olhar)).multiplyScalar(0.08));
  }
  return p;
}

// Quem está parado na cena (sentado ou em pé) espera a vez de partir; quem já anda,
// quem ainda está do lado de fora e quem vai embora sai na hora
function irPara(a, destino) {
  const parado = a.estado !== 'andando' && !a.aguardandoEntrada && !a.saindo && a.sala !== 'fora' && a.alvo !== 'fora';
  const agoraMs = relogio();
  if (parado && (partidaPertoRecente(a, agoraMs) || algumPendentePerto(a))) {
    if (!a.partidaPendente) a.partidaPendente = { destino, desde: agoraMs };
    else a.partidaPendente.destino = destino;
    return;
  }
  a.partidaPendente = null;
  if (parado) registrarPartida(a, agoraMs);
  partirPara(a, destino);
}

// Há alguém perto esperando a vez de partir há mais tempo (a ordem é de quem pediu antes)
function algumPendentePerto(a) {
  const p = P(a);
  for (const o of E.agentes.values()) {
    if (o === a || !o.partidaPendente) continue;
    if (a.partidaPendente && o.partidaPendente.desde >= a.partidaPendente.desde) continue;
    if (Math.hypot(P(o).x - p.x, P(o).z - p.z) < PARTIDA_PERTO_RAIO) return true;
  }
  return false;
}

// A cada quadro: quem espera a vez de partir sai quando a vez chega
function partidasPendentes(agoraMs) {
  const lista = [...E.agentes.values()].filter(a => a.partidaPendente).sort((x, y) => x.partidaPendente.desde - y.partidaPendente.desde);
  for (const a of lista) {
    if (!a.partidaPendente || a.saindo || a.alvo === 'fora') { a.partidaPendente = null; continue; }
    if (partidaPertoRecente(a, agoraMs)) continue;
    const { destino } = a.partidaPendente;
    a.partidaPendente = null;
    registrarPartida(a, agoraMs);
    partirPara(a, destino);
  }
}

function partirPara(a, destino) {
  a.origemRota = 'partida';
  encerrarConversa(a);
  liberarVaga(a);
  const v = pegarVaga(destino, a);
  reservarVaga(a, v, destino);
  a.alvo = destino;
  if (destino === 'descanso') { a.passouDescanso = true; a.proxAcao = 0; }
  rotaAte(a, destino, posDaVaga(a, v), { vaga: v });
  a.ultimoAvanco = 0;   // rota nova: o prazo do resgate recomeça no próximo quadro
}

// ---------------------------------------------------------------------------
// Para onde o agente deve ir, a partir do que a sessão está fazendo
// ---------------------------------------------------------------------------
// Uso de conector costuma ser uma chamada rápida no meio de outras ações. Para dar
// tempo de o astronauta chegar e trabalhar lá, ele fica na sala do conector por um
// tempo mínimo, a não ser que vá pesquisar, descansar ou use outro conector.
const PERMANENCIA_CONECTOR_MS = 15 * 1000;

function destinoDe(dado, a) {
  if (dado.atividade === 'esperar') return null;   // fica onde está
  if (dado.atividade === 'conector' && dado.conector) {
    const tipo = dado.conectorTipo === 'api' ? 'api' : 'mcp';
    a.ultimoConector = { nome: dado.conector, tipo, ate: agoraParede() + PERMANENCIA_CONECTOR_MS };
    a.conector = dado.conector;
    return tipo;
  }
  if (dado.atividade === 'editar' && a.ultimoConector?.ate > agoraParede()) {
    a.conector = a.ultimoConector.nome;
    return a.ultimoConector.tipo || E.salaPorConector.get(a.ultimoConector.nome)?.tipo || 'mcp';
  }
  // 'coordenar' fica na casa, como quem trabalha
  return SALA_DA_ATIVIDADE[dado.atividade] || 'coworking';
}

function definirLed(a, estado) {
  if (a.led === estado) return;
  a.led = estado;
  a.boneco.userData.definirLed?.(estado);
}

function ledDaAtividade(atividade) {
  if (atividade === 'oficina') return 'apagado';   // travado: a luz do capacete apagada
  return atividade === 'esperar' ? 'esperar' : atividade === 'descansar' || atividade === 'revisar' ? 'descanso' : 'trabalho';
}

function atualizarAgente(a, dado) {
  // pensamentos novos entram na fila do balão; 'vistos' guarda só os da última leitura
  let novo = false;
  for (const p of dado.pensamentos || []) {
    if (a.vistos.has(p.id)) continue;
    a.filaBalao.push(p.texto);
    novo = true;
  }
  a.vistos = new Set((dado.pensamentos || []).map(p => p.id));
  if (novo) {
    a.ultimaAcao = relogio();
    // a leitura chega a cada 1,5 s para todos de uma vez: cada balão novo espera um
    // pedacinho aleatório desse intervalo, para não acenderem juntos
    a.balaoLiberaEm = ultimoAgoraMs + Math.random() * 1400;
  }
  // só a ação mais nova vira balão (pedido do Eduardo, 03/10): aparece na hora em que
  // aquele astronauta faz algo, fica 2 s e some; nada de fila tocando balões em sequência
  if (a.filaBalao.length > 1) a.filaBalao = a.filaBalao.slice(-1);
  a.spanNome.textContent = dado.nome;
  a.spanAcao.textContent = dado.texto;
  a.div.classList.toggle('esperando', dado.atividade === 'esperar');

  const anterior = a.atividade;
  a.atividade = dado.atividade;
  definirLed(a, ledDaAtividade(dado.atividade));

  if (dado.atividade === 'descansar') {
    // saiu da fila sem pendência (resposta recusada, sessão interrompida): não fica
    // parado no lugar da fila; relógio cheio e vai ao descanso na vez dele
    const estavaNaFila = !!a.vaga?.fila;
    a.partidaPendente = null;
    if (a.filaId) sairDaFila(a);
    terminarTrabalho(a, dado, anterior);
    if (estavaNaFila && a.relogioAtivo) { a.paradoHaMs = Math.max(a.paradoHaMs, RELOGIO_MS); a.entregarAte = 0; }
    return;
  }

  // voltou a trabalhar: o relógio some e ele segue no lugar
  if (a.relogioAtivo) desligarRelogio(a);
  a.entregarAte = 0;

  // precisa de você ou terminou com sugestão: fila da sala do dono ou da revisão
  const idFila = filaDoDado(dado);
  if (idFila) { a.partidaPendente = null; entrarNaFila(a, idFila, dado); return; }
  if (a.filaId) sairDaFila(a);

  // null = fica onde está (e esquece a partida que esperava a vez)
  const destino = decidirDestino(a, dado);
  sincronizarServicoNaMesa(a);
  if (destino === null || destino === a.alvo) { a.partidaPendente = null; return; }
  if (a.partidaPendente?.destino === destino) return;   // já espera a vez de ir para lá
  irPara(a, destino);
}

// Teto do MCP e da API (I-1): sentado na mesa do coworking, o monitor mostra o nome
// do serviço enquanto ele usa; quando para de usar, a tela volta ao normal
function sincronizarServicoNaMesa(a) {
  const v = a.vaga;
  const quero = a.servicoNaMesa || null;
  if ((a.servicoMostrado || null) === quero) return;
  if (!v || v.sala !== 'coworking' || !ehMesa(v) || a.estado === 'andando' || a.girando) { if (!quero) a.servicoMostrado = null; return; }
  v.mostrarServico?.(quero);
  a.servicoMostrado = quero;
  E.sujo = true;
}

// Para onde ir agora, ou null para ficar onde está
function decidirDestino(a, dado) {
  let destino = destinoDe(dado, a);
  a.servicoNaMesa = null;
  if (destino === null) {
    // esperando você: fica onde está; se ainda não tem lugar, vai para a mesa
    if (a.alvo) return null;
    destino = 'coworking';
  }
  // MCP ou API no teto (as vagas de módulo cheias, revisão I-1): trabalha na mesa dele,
  // com o nome do serviço no monitor, até a sala caber
  if ((destino === 'mcp' || destino === 'api') && Est.semVagaPara?.(destino)) {
    a.servicoNaMesa = a.conector || dado.conector || null;
    destino = 'coworking';
  }
  // sala ainda acoplando (sala da pasta, coluna de mesas da sessão, MCP ou API): quem
  // chegou espera do lado de fora sem destino; quem já tem lugar fica onde está até ela
  // ficar pronta
  if (Est.aguardandoSala(destino, a.pasta, sessaoDe(a))) return null;
  if (!E.salas[destino]) {
    if (a.alvo) return null;
    destino = 'coworking';
  }
  if (destino === a.alvo) return destino;
  // sala cheia (mesas ocupadas e já EXTRAS_MAX em pé lá): quem já tem lugar fica
  // onde está e tenta de novo na próxima leitura; quem ainda está do lado de fora vai
  // para a mesa da pasta ou espera a vez de entrar (gente demais em pé numa sala
  // fecha o caminho de quem senta e levanta)
  if (salaCheiaPara(destino, a)) {
    if (a.alvo) return null;
    if (destino === 'coworking' || salaCheiaPara('coworking', a)) return null;
    destino = 'coworking';
  }
  return destino;
}

const EXTRAS_MAX = 3;
// Oficina e Biblioteca são salas pequenas com NPC andando: sem banquinho ou lugar
// livre, ninguém fica em pé lá dentro (com o capacete de 0,85 m, quem sobrava fechava
// a passagem do mecânico e do bibliotecário); ele continua na mesa até abrir lugar
const EXTRAS_MAX_SALA = { oficina: 0, biblioteca: 0 };
function salaCheiaPara(idSala, a) {
  const s = E.salas[idSala];
  if (!s || idSala === 'descanso') return false;
  if (s.vagas.some(v => livrePara(v, a) && vagaValida(s, v, a))) return false;
  let emPe = 0;
  for (const o of E.agentes.values()) if (o !== a && o.alvo === idSala && o.vaga?.extra && !o.saindo) emPe++;
  return emPe >= (EXTRAS_MAX_SALA[idSala] ?? EXTRAS_MAX);
}

// Fim de trabalho: espreguiça, relógio de 60 s no lugar e depois o descanso
function terminarTrabalho(a, dado, anterior) {
  a.paradoHaMs = dado.paradoHaMs ?? RELOGIO_MS;   // servidor antigo: vai direto
  a.paradoRecebidoEm = relogio();
  if (a.alvo === 'descanso') return;
  const temLugar = a.alvo && a.alvo !== 'fora';
  if (!temLugar) { irParaDescanso(a); return; }
  // já passou dos 60 s (página aberta agora, servidor antigo): relógio cheio, e ele
  // sai na vez dele (saída escalonada, em animarAgentes)
  if (!a.relogioAtivo) {
    a.relogioAtivo = true;
    if (anterior && anterior !== 'descansar') a.entregarAte = relogio() + ENTREGAR_MS;
  }
}

// O descanso (núcleo e módulo extra) está cheio: quem já está nele ou a caminho ocupa
// todos os assentos, cantos e pontos em pé
function descansoLotado(a) {
  const s = E.salas.descanso;
  if (!s) return false;
  const lugares = s.vagas.filter(v => !v.removida).length + pontosDoDescanso(s).length;
  let n = 0;
  for (const o of E.agentes.values()) if (o !== a && o.alvo === 'descanso' && !o.saindo) n++;
  return n >= lugares;
}

function irParaDescanso(a) {
  a.esperaDescanso = false;
  desligarRelogio(a);
  a.entregarAte = 0;
  soltarCasa(a);
  a.partidaPendente = null;
  if (a.estado !== 'andando' && !a.aguardandoEntrada) registrarPartida(a, relogio());
  partirPara(a, 'descanso');
}

function desligarRelogio(a) {
  a.relogioAtivo = false;
}

function sair(a) {
  a.partidaPendente = null;
  if (a.filaId) sairDaFila(a);
  // ainda esperava a vez de entrar: nem chegou a aparecer
  if (a.aguardandoEntrada) { removerAgente(a); return; }
  desligarRelogio(a);
  encerrarConversa(a);
  lembrarMesa(a);
  soltarCasa(a);
  liberarVaga(a);
  a.alvo = 'fora';
  a.entregarAte = 0;
  a.spanAcao.textContent = 'indo embora';
  a.div.classList.remove('esperando');
  // subagente que não passou pelo descanso some no lugar; sessões saem pela porta
  if (a.tipo === 'subagente' && !a.passouDescanso) {
    a.saindo = true;
    a.rota = [];
    a.estado = 'parado';
    return;
  }
  rotaAte(a, 'fora');
  a.ultimoAvanco = 0;
}

// Voltou a aparecer enquanto saía: desiste de ir embora
function voltar(a) {
  a.saindo = false;
  a.alvo = null;
}

// ---------------------------------------------------------------------------
// Salas: a estação (estacao.js) acopla a ilha de cada pasta e as salas MCP e
// API; aqui só se escolhe a vaga dentro delas
// ---------------------------------------------------------------------------
Est.definirGanchos({ plantaMudou, replanejarAndando, atualizarPendentes, soltarCasa });

// ---------------------------------------------------------------------------
// Aplicar a lista de agentes lida da fonte
// ---------------------------------------------------------------------------
// sem limite por padrão (decisão do Eduardo, 03/10, depois do teste com 48 astronautas);
// ?lotacao=N continua valendo para testes e máquinas mais fracas
const LOTACAO_PADRAO = Number(new URLSearchParams(location.search).get('lotacao')) || Infinity;
let lotacaoMaxima = LOTACAO_PADRAO;
// Para o teste da multidão (testes.js): mais de 10 astronautas na cena; sem valor, volta ao padrão
export function definirLotacao(n) { lotacaoMaxima = n > 0 ? n : LOTACAO_PADRAO; }

// Prioridade de quem entra quando o escritório está lotado:
// esperando você > terminou com sugestão (fila da revisão) > quem já está dentro e
// acabou de terminar (relógio ou descanso: mantém o lugar e o "+N" absorve os novos,
// revisão I-4) > sessões trabalhando > subagentes trabalhando > quem descansa de fora
function prioridade(d) {
  if (d.atividade === 'esperar' || d.pendencia === 'precisa_de_voce') return 0;
  if (d.atividade === 'revisar') return 0.5;
  if (d.atividade === 'descansar') {
    const a = E.agentes.get(d.id);
    return a && !a.aguardandoEntrada && !a.saindo && a.alvo !== 'fora' ? 0.9 : 3;
  }
  return d.tipo === 'subagente' ? 2 : 1;
}

// Oficina e biblioteca (F1): a atividade da sala nova por cima da que veio do servidor.
// A fila do dono vence a oficina; esperar e as filas vencem a biblioteca; a biblioteca
// só tira da mesa quem está editando ou coordenando (pesquisa, conector e descanso seguem).
function comSalasNovas(lista) {
  const sd = E.salasDados || {};
  const naOficina = new Map((sd.oficina?.naOficina || []).map(x => [x.id, x]));
  const agora = Date.now();
  const consultas = new Map();
  for (const ev of sd.memoria?.atividadeAgora || []) {
    if (!ev?.agenteId || consultas.has(ev.agenteId)) continue;
    if (ev.quando != null && agora - ev.quando > BIBLIOTECA_MS) continue;
    consultas.set(ev.agenteId, ev);
  }
  if (!naOficina.size && !consultas.size) return lista;
  return lista.map(d => {
    if (d.atividade === 'esperar' || d.pendencia === 'precisa_de_voce') return d;
    const of = naOficina.get(d.id);
    if (of) return { ...d, atividade: 'oficina', texto: 'na oficina: ' + (of.motivo || 'travou') };
    if (d.pendencia) return d;
    const ev = consultas.get(d.id);
    if (ev && (d.atividade === 'editar' || d.atividade === 'coordenar')) {
      const verbo = ev.acao === 'gravar' ? 'guardando na memória' : ev.acao === 'usar' ? 'usando uma skill' : 'consultando a memória';
      return { ...d, atividade: 'biblioteca', areaBiblioteca: ev.area, texto: ev.titulo ? `${verbo}: ${ev.titulo}` : verbo };
    }
    return d;
  });
}

export function aplicarEstado(dados) {
  // resposta com erro: mantém todo mundo como está
  if (!dados || dados.erro) return;
  const agentes = E.agentes;
  const lista = comSalasNovas(Array.isArray(dados.agentes) ? dados.agentes : []);

  // quem já está dentro tem preferência sobre quem acabou de chegar, no mesmo nível
  const ordenados = [...lista].sort((x, y) => prioridade(x) - prioridade(y) || (agentes.has(y.id) - agentes.has(x.id)));
  const dentro = ordenados.slice(0, lotacaoMaxima);   // fica de fora quem passa da lotação
  // "+N chegando": quem passou da lotação (só com ?lotacao) mais quem ainda espera a vez
  // do lado de fora, invisível (03/10: no teste de 120, ~35 esperavam sem nada na tela)
  let lafora = 0;
  for (const a of agentes.values()) if (a.aguardandoEntrada) lafora++;
  atualizarContador(ordenados.length - dentro.length + lafora, lotacaoMaxima);
  // a planta segue a demanda de quem está dentro (estacao.js)
  Est.planejarEstacao(dentro);
  // sessões antes dos subagentes, para o subagente nascer ao lado da mãe
  dentro.sort((x, y) => (x.tipo === 'subagente') - (y.tipo === 'subagente'));

  const vistos = new Set();
  for (const dado of dentro) {
    vistos.add(dado.id);
    const a = agentes.get(dado.id) || novoAgente(dado);
    a.ausente = 0;
    a.pasta = dado.pastaCaminho;
    a.tipo = dado.tipo;
    a.pai = dado.pai || a.pai;
    a.areaBiblioteca = dado.areaBiblioteca ?? null;
    a.tipoOficina = dado.atividade === 'oficina' ? (E.salasDados?.oficina?.naOficina || []).find(x => x.id === dado.id)?.tipo ?? null : null;
    if (a.alvo === 'fora' || a.saindo) voltar(a);   // voltou a trabalhar antes de sair
    atualizarAgente(a, dado);
  }
  // histerese: só sai depois de 3 leituras seguidas sem o agente
  for (const a of agentes.values()) {
    if (vistos.has(a.id)) continue;
    a.ausente++;
    if (a.ausente >= AUSENCIAS_PARA_SAIR && a.alvo !== 'fora' && !a.saindo) sair(a);
  }
  const agora = Date.now();
  for (const [id, m] of memoria) if (m.ate < agora) memoria.delete(id);
  atualizarPendentes();
  organizarFilas();
}

// ---------------------------------------------------------------------------
// Filas da sala do dono e da revisão (rodada 6, requisito aprovado em 03/10)
// - 'precisa_de_voce' (pergunta ou aprovação): fila em frente à mesa do comandante,
//   no Estúdio (E.salas.dono). 'entrega_com_sugestao' (terminou oferecendo o próximo
//   passo): fila do módulo de revisão (E.salas.revisao, acopla sob demanda).
// - Só sessões entram (ajudante nunca). Ordem de chegada: quando a pendência
//   começou (pendenteHaMs do servidor), e não quem anda mais rápido.
// - Os lugares vêm de s.filaDef (layout.js), conferidos no mapa como lugar em pé
//   (corpo sólido, longe de divisória, mesa e porta), a 0,75 ou mais um do outro:
//   um atrás do outro, olhando para a frente da fila. Nenhum outro astronauta
//   escolhe lugar em pé em cima deles.
// - Partida em fila (pedido do Eduardo: "andar em fila, não lado a lado"): em cada
//   fila, uma partida por vez (a cada PARTIDA_FILA_MS), na ordem da fila; quem sai
//   da frente libera e os de trás andam um lugar, um depois do outro.
// - Fila cheia, ou revisão ainda acoplando: fica onde está (sem lugar, vai para a
//   mesa) e entra quando abrir lugar. Notinha aparece do mesmo jeito.
// - Cada um na fila mostra uma NOTINHA pequena (estilo do balão) com o nome curto
//   da sessão. A ÚNICA ação clicável da Estação: clique chama POST /api/abrir e o
//   servidor abre a sessão no app (Claude ou Codex). Feedback discreto: 'abrindo…'.
//   O cartão do hover e o balão de pensamento ficam escondidos enquanto ele está na fila.
// ---------------------------------------------------------------------------
const SALA_DA_PENDENCIA = { precisa_de_voce: 'dono', entrega_com_sugestao: 'revisao' };
const FILAS = ['dono', 'revisao'];
const PARTIDA_FILA_MS = 700;
const ALTURA_NOTA = 1.72;              // × fator: ao lado do capacete
const NOME_NOTA_MAX = 22;
const SIMULANDO = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').has('simular');
let filasSujas = false;
const cacheFilas = new Map();          // idFila -> { chave, mapa, lugares }
const ultimaPartidaFila = new Map();   // idFila -> instante da última partida

function filaDoDado(dado) {
  if (dado.tipo === 'subagente') return null;
  return SALA_DA_PENDENCIA[dado.pendencia] || null;
}

// Lugares da fila no mundo, conferidos no mapa (guardados pela geometria da fila)
function lugaresDaFila(idFila) {
  const def = E.salas[idFila]?.filaDef;
  if (!def || !E.mapa) return [];
  const chave = JSON.stringify(def);
  const c = cacheFilas.get(idFila);
  if (c && c.chave === chave && c.mapa === E.mapa && c.versao === E.versaoMapa) return c.lugares;
  const lugares = [];
  for (const p of def.pontos) {
    const q = lugarDaFilaPerto(p.x, p.z, lugares);
    if (!q) continue;
    const frente = lugares.length ? lugares[lugares.length - 1].pos : def.olharAlvo;
    lugares.push({ pos: new THREE.Vector3(q.x, 0, q.z), olhar: Math.atan2(frente.x - q.x, frente.z - q.z),
      pose: 'em-pe', fila: idFila, sala: idFila, indice: lugares.length });
  }
  // mesmo lugar de antes: o mesmo objeto (quem já está nele não sai e volta a cada
  // remontagem do mapa)
  if (c) lugares.forEach((l, k) => { const o = c.lugares[k]; if (o && o.pos.distanceTo(l.pos) < 1e-6 && Math.abs(o.olhar - l.olhar) < 1e-6) lugares[k] = o; });
  cacheFilas.set(idFila, { chave, mapa: E.mapa, versao: E.versaoMapa, lugares });
  return lugares;
}

// O ponto pedido, ou o mais perto (até 0,3) que é um lugar em pé válido e fica a
// um passo dos lugares já escolhidos
const ESPACO_FILA = 0.88;   // um atrás do outro na fila (o capacete tem 0,84)
function lugarDaFilaPerto(x, z, ja) {
  const longe = (qx, qz) => ja.every(l => Math.hypot(l.pos.x - qx, l.pos.z - qz) >= ESPACO_FILA);
  if (lugarFixoValido(x, z) && longe(x, z)) return { x, z };
  for (const r of [0.1, 0.2, 0.3]) {
    for (let k = 0; k < 8; k++) {
      const ang = k * Math.PI / 4;
      const qx = x + Math.sin(ang) * r, qz = z + Math.cos(ang) * r;
      if (lugarFixoValido(qx, qz) && longe(qx, qz)) return { x: qx, z: qz };
    }
  }
  return null;
}

// Lugares de fila em uso agora (para ninguém mais parar em cima deles)
function pertoDeLugarDeFila(x, z) {
  for (const c of cacheFilas.values()) {
    if (c.mapa !== E.mapa) continue;
    for (const l of c.lugares) if (Math.hypot(l.pos.x - x, l.pos.z - z) < ESPACO_LUGAR) return true;
  }
  return false;
}

// Para conferência (testes.js): os lugares de cada fila que existe agora
export function lugaresDasFilas() {
  const r = {};
  for (const id of FILAS) if (E.salas[id]) r[id] = lugaresDaFila(id).map(l => ({ pos: l.pos.clone(), olhar: l.olhar }));
  return r;
}
// Para conferência: quem está em cada fila, na ordem
export function membrosDasFilas() {
  const r = {};
  for (const id of FILAS) r[id] = membrosDaFila(id).map(a => ({ id: a.id, pos: a.posFila, lugar: a.vaga?.fila === id ? a.vaga.indice : null, estado: a.estado }));
  return r;
}

function membrosDaFila(idFila) {
  return [...E.agentes.values()].filter(a => a.filaId === idFila && !a.saindo && a.alvo !== 'fora')
    .sort((x, y) => x.chegadaFila - y.chegadaFila || x.ordemChegada - y.ordemChegada);
}

function entrarNaFila(a, idFila, dado) {
  if (a.filaId !== idFila) {
    if (a.filaId) sairDaFila(a);
    a.filaId = idFila;
    a.chegadaFila = agoraParede() - Math.max(0, Number(dado.pendenteHaMs) || 0);
    a.posFila = -1;
  }
  a.pendencia = dado.pendencia;
  a.abrivel = !!dado.abrivel;
  // na fila, a notinha fala por ele: sem balão de pensamento acumulado
  a.filaBalao = [];
  a.balaoAtivo = false;
  atualizarNota(a, dado);
  filasSujas = true;
}

function sairDaFila(a) {
  a.filaId = null;
  a.posFila = -1;
  a.pendencia = null;
  a.filaPendente = null;
  if (a.nota) {
    a.nota.element?.remove?.();
    E.cena.remove(a.nota);
    a.nota = null;
  }
  a.notaOcupada = false;
  a.div.classList.remove('em-fila');
  filasSujas = true;
}

// Ordem da fila e lugar de cada um (a cada leitura e quando alguém entra ou sai)
function organizarFilas() {
  filasSujas = false;
  for (const idFila of FILAS) {
    const esperandoSala = !E.salas[idFila] || Est.aguardandoSala(idFila);
    const lugares = esperandoSala ? [] : lugaresDaFila(idFila);
    membrosDaFila(idFila).forEach((a, k) => {
      a.posFila = k;
      if (a.nota) {
        // lados alternados: notinhas de vizinhos de fila não se cobrem (o center do
        // CSS2DObject põe a borda da notinha no capacete; a margem do CSS dá a folga)
        a.nota.center.set(k % 2 === 1 ? 1 : 0, 0.5);
        a.nota.element.classList.toggle('esquerda', k % 2 === 1);
        a.nota.element.classList.toggle('primeiro', k === 0);
      }
      const lugar = lugares[k] || null;
      if (lugar && a.vaga === lugar) { a.filaPendente = null; return; }
      if (lugar) { a.filaPendente = lugar; return; }
      a.filaPendente = null;
      // fila cheia (ou revisão acoplando): fica onde está; quem ainda não tem
      // lugar vai para a mesa da pasta, como quem trabalha
      if (a.vaga?.fila) return;
      if (!a.alvo && !Est.aguardandoSala('coworking', a.pasta) && !salaCheiaPara('coworking', a) && E.salas.coworking) irPara(a, 'coworking');
    });
  }
}

// Uma partida por vez em cada fila, na ordem da fila (quem está na frente primeiro)
function partidasDasFilas(agoraMs) {
  for (const idFila of FILAS) {
    const ultima = ultimaPartidaFila.get(idFila) ?? -Infinity;
    if (agoraMs - ultima < PARTIDA_FILA_MS && agoraMs >= ultima) continue;
    const proximo = membrosDaFila(idFila).find(a => a.filaPendente);
    if (!proximo || proximo.resgatando) continue;
    // ainda levantando do relógio ou girando para sentar: espera o gesto acabar
    if (agoraMs < proximo.entregarAte || proximo.girando) continue;
    // o lugar pendente pode ser de uma sala que começou a desacoplar depois da última
    // organização (a revisão sai 90 s depois de vazia): só vai se o lugar ainda existe
    // (verificação v0.6: "módulo desacoplou com alguém dentro revisao")
    if (!E.salas[idFila] || Est.aguardandoSala(idFila) || !lugaresDaFila(idFila).includes(proximo.filaPendente)) {
      proximo.filaPendente = null;
      filasSujas = true;
      continue;
    }
    ultimaPartidaFila.set(idFila, agoraMs);
    irParaFila(proximo, proximo.filaPendente);
  }
}

function irParaFila(a, lugar) {
  a.origemRota = 'fila';
  a.filaPendente = null;
  a.partidaPendente = null;
  if (a.estado !== 'andando' && !a.aguardandoEntrada) registrarPartida(a, relogio());
  encerrarConversa(a);
  desligarRelogio(a);
  a.entregarAte = 0;
  liberarVaga(a);           // a mesa-casa continua dele: ele volta para ela depois
  a.vaga = lugar;
  a.alvo = lugar.sala;
  rotaAte(a, lugar.sala, lugar.pos.clone(), { vaga: lugar });
  a.ultimoAvanco = 0;
}

// Nome curto para a notinha (sem travessão, até 22 caracteres)
function nomeDaNota(nome) {
  const s = String(nome || 'Sessão').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\s+/g, ' ').trim() || 'Sessão';
  return s.length > NOME_NOTA_MAX ? s.slice(0, NOME_NOTA_MAX - 1).trimEnd() + '…' : s;
}

function atualizarNota(a, dado) {
  if (!a.nota) {
    const div = document.createElement('div');
    div.className = 'notinha';
    const ponto = document.createElement('span');
    ponto.className = 'ponto';
    const texto = document.createElement('span');
    texto.className = 'texto';
    div.append(ponto, texto);
    div.setAttribute?.('role', 'button');
    div.setAttribute?.('tabindex', '0');
    // a notinha fica por cima do canvas: o clique não chega à câmera
    div.addEventListener('pointerdown', ev => ev.stopPropagation?.());
    div.addEventListener('dblclick', ev => ev.stopPropagation?.());
    div.addEventListener('click', ev => { ev.stopPropagation?.(); clicarNota(a); });
    div.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault?.(); clicarNota(a); } });
    a.nota = new CSS2DObject(div);
    a.nota.center.set(0, 0.5);   // à direita do capacete até a fila dizer o lado
    a.notaTexto = texto;
    a.nota.visible = false;
    E.cena.add(a.nota);
  }
  const el = a.nota.element;
  el.classList.toggle('revisao', a.pendencia === 'entrega_com_sugestao');
  el.classList.toggle('abrivel', a.abrivel);
  a.notaNome = nomeDaNota(dado.nome);
  if (!a.notaOcupada) a.notaTexto.textContent = a.notaNome;
  const motivo = a.pendencia === 'entrega_com_sugestao' ? 'terminou com uma sugestão' : (dado.texto || 'precisa de você');
  el.title = `${a.notaNome} · ${motivo}` + (a.abrivel ? ' · clique para abrir a sessão' : ' · aberta fora do app');
  a.div.classList.add('em-fila');
}

function tokenDaPagina() {
  try { return document.querySelector?.('meta[name="estacao-token"]')?.getAttribute?.('content') || ''; } catch { return ''; }
}

function mostrarNaNota(a, texto, estado) {
  if (!a.nota) return;
  a.notaTexto.textContent = texto;
  a.nota.element.classList.toggle('abrindo', estado === 'abrindo');
  a.nota.element.classList.toggle('falhou', estado === 'falhou');
  E.sujo = true;
}

// Clique na notinha: pede ao servidor para abrir a sessão (ele monta a URL)
async function clicarNota(a) {
  if (!a.nota || !a.abrivel || a.notaOcupada) return;
  a.notaOcupada = true;
  mostrarNaNota(a, 'abrindo…', 'abrindo');
  let resultado = 'falhou';
  if (SIMULANDO) resultado = 'simulacao';
  else {
    try {
      const r = await fetch('/api/abrir', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Estacao-Token': tokenDaPagina() },
        body: JSON.stringify({ id: a.id }),
      });
      resultado = r.ok ? 'ok' : 'falhou';
    } catch { resultado = 'falhou'; }
  }
  if (resultado === 'falhou') mostrarNaNota(a, 'não deu para abrir', 'falhou');
  else if (resultado === 'simulacao') mostrarNaNota(a, 'só na simulação', 'falhou');
  setTimeout(() => {
    a.notaOcupada = false;
    if (a.nota) mostrarNaNota(a, a.notaNome, null);
  }, resultado === 'ok' ? 1800 : 2500);
}

// A cada quadro: a notinha acompanha o boneco (ao lado do capacete)
function animarNotas() {
  for (const a of E.agentes.values()) {
    if (!a.nota) continue;
    const b = a.boneco;
    a.nota.position.set(b.position.x, b.position.y + ALTURA_NOTA * a.fator, b.position.z);
    const visivel = !a.aguardandoEntrada && b.visible && a.fade > 0.5 && !a.saindo;
    if (a.nota.visible !== visivel) { a.nota.visible = visivel; E.sujo = true; }
  }
}

// ---------------------------------------------------------------------------
// Descanso vivo: a cada 6 a 15 s escolhe uma ação (sofá, ponto em pé, conversa)
// ---------------------------------------------------------------------------
let cachePontos = { mapa: null, sala: null, pontos: [] };

// Pontos em pé do descanso: s.pontosEmPe (se a planta trouxer) ou pontos livres
// do mapa perto da janela, da mesinha, das plantas e no meio da sala
function pontosDoDescanso(s) {
  if (cachePontos.mapa === E.mapa && cachePontos.sala === s) return cachePontos.pontos;
  const pontos = [];
  const partes = s.partes?.length ? s.partes : [s];   // descanso do núcleo e o módulo extra
  const dentroDaSala = p => partes.some(r => p.x > r.x0 + 0.3 && p.x < r.x1 - 0.3 && p.z > r.z0 + 0.3 && p.z < r.z1 - 0.3);
  // corpo sólido: só lugares válidos (longe de divisória, sofá, porta) e espaçados
  const aceitar = (p, olhar) => {
    if (!p || !dentroDaSala(p) || !lugarFixoValido(p.x, p.z)) return;
    if (pontos.some(q => q.pos.distanceTo(p) < ESPACO_LUGAR)) return;
    pontos.push({ pos: p, olhar, ocupadoPor: null });
  };
  if (Array.isArray(s.pontosEmPe) && s.pontosEmPe.length) {
    for (const q of s.pontosEmPe) {
      const p = q.isVector3 ? q : q.pos;
      if (p) aceitar(pontoLivre(p.x, p.z), q.olhar ?? Math.PI / 4);
    }
  }
  if (pontos.length < 3) {
    // os candidatos de reserva só em lugar aberto (capacete de 0,84: num corredor de 1 m
    // entre o sofá e a mesinha, quem para ali tranca a passagem de todo mundo)
    const zn = s.z0;
    const candidatos = [
      [s.x1 - 1.4, zn + 1.1, Math.PI],               // olhando pela janela
      [s.cx + 0.2, s.cz + 1.6, Math.PI],             // em frente à mesinha
      [s.cx + 1.5, s.cz + 0.6, -Math.PI / 2],        // ao lado da mesinha
      [s.x1 - 1.0, s.cz + 2.2, Math.PI / 4],         // perto da planta do canto
      [s.cx + 0.9, s.cz - 1.3, Math.PI / 4],         // meio da sala
      [s.x0 + 1.9, s.z1 - 0.9, Math.PI / 4],         // perto da passagem
      [s.x1 - 1.4, s.cz + 0.8, Math.PI / 4],         // canto da janela lateral
    ];
    for (const [x, z, olhar] of candidatos) {
      const p = pontoLivre(x, z);
      if (p && lugarAberto(p.x, p.z)) aceitar(p, olhar);
    }
  }
  // completa com pontos da grade só quando a planta não traz os dela (no descanso de
  // hoje, 3 pontos desenhados: os da grade caíam na passagem principal e trancavam)
  if (pontos.length < 3) {
    for (const c of candidatosDaSala('descanso', s)) {
      if (pontos.length >= 6) break;
      // só em lugar aberto: nunca na passagem estreita de um canto nem no bolso do fundo
      // dela (a do fliperama, entre ele e a meditação), onde quem chega e quem sai se travavam
      if (!lugarAberto(c.x, c.z)) continue;
      aceitar(new THREE.Vector3(c.x, 0, c.z), Math.PI / 4);
    }
  }
  cachePontos = { mapa: E.mapa, sala: s, pontos };
  return pontos;
}

// Lugar aberto: 0,55 de folga e pelo menos 70% das células andáveis num raio de 0,7
function lugarAberto(x, z) {
  if (E.mapa?.folgaEm && E.mapa.folgaEm(x, z) < 0.55) return false;
  let total = 0, livres = 0;
  for (let dx = -0.6; dx <= 0.61; dx += 0.2) for (let dz = -0.6; dz <= 0.61; dz += 0.2) {
    if (dx * dx + dz * dz > 0.49) continue;
    total++;
    if (andavelEm(x + dx, z + dz)) livres++;
  }
  return livres >= total * 0.7;
}

function encerrarConversa(a) {
  const o = a.conversaCom;
  a.conversaCom = null;
  if (o && o.conversaCom === a) o.conversaCom = null;
}

const estaNoDescanso = o => o.alvo === 'descanso' && o.sala === 'descanso' && !o.saindo && o.atividade === 'descansar';
// Já dentro de um cômodo do descanso (chegando ou mudando de lugar), descansando
const dentroDoDescanso = o => o.alvo === 'descanso' && !o.saindo && o.atividade === 'descansar'
  && !!E.salas.descanso && parteDe(E.salas.descanso, P(o)) >= 0;

// Índice do cômodo (s.partes) que contém o ponto, ou -1
function parteDe(s, p) {
  const partes = s.partes?.length ? s.partes : [s];
  return partes.findIndex(r => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1);
}

function acharParceiro(a, aceitar = () => true) {
  let melhor = null;
  for (const o of E.agentes.values()) {
    if (o === a || !estaNoDescanso(o) || o.estado === 'andando' || o.conversaCom || !aceitar(P(o))) continue;
    if (!melhor || aleat(a.h + o.h, a.nAcao) > 0.5) melhor = o;
  }
  return melhor;
}

function mostrarBalao(a, texto, ms, agoraMs) {
  a.divBalao.textContent = texto;
  a.balaoAtivo = true;
  a.balaoDesde = agoraMs;
  a.balaoAte = agoraMs + ms;
}

function proximaAcaoDescanso(a, agoraMs) {
  const s = E.salas.descanso;
  // troca de lugar um de cada vez (pendência da rodada 6: duas trocas começando juntas
  // andavam lado a lado dentro da sala): perto de quem acabou de sair, espera a vez
  if (a.vaga && (partidaPertoRecente(a, agoraMs) || algumAndandoPerto(a))) { a.proxAcao = agoraMs + 700 + (a.h % 5) * 160; return; }
  a.nAcao++;
  a.proxAcao = agoraMs + (6 + aleat(a.h, a.nAcao * 7 + Math.floor(agoraMs / 1000)) * 9) * 1000;
  if (!s) return;
  const aqui = parteDe(s, P(a));
  encerrarConversa(a);
  const r = aleat(a.h, a.nAcao * 3 + 1);
  // fica no cômodo onde está (descanso do núcleo ou módulo de descanso): trocar de
  // cômodo a cada ação enche o corredor e as portas de gente indo e vindo
  const mesmaParte = p => aqui < 0 || parteDe(s, p) === aqui;
  const parceiro = acharParceiro(a, mesmaParte);
  const sofas = s.vagas.filter(v => v.pose === 'sentado' && !v.cantoObj && !v.ocupada && !v.removida && mesmaParte(Est.posVaga(v)));
  // cantos de descompressão livres (fliperama, videogame, ioga, meditação): um por lugar
  const cantos = s.vagas.filter(v => v.cantoObj && !v.ocupada && !v.removida && v !== a.vaga && mesmaParte(Est.posVaga(v)));
  const pontos = pontosDoDescanso(s).filter(p => !p.ocupadoPor && mesmaParte(p.pos) && lugarValido(p.pos.x, p.pos.z, a, ESPACO_LUGAR, true));

  // às vezes só fica onde está, olhando em volta (pausa sem andar); com o cômodo
  // cheio (5 ou mais), mais vezes: menos gente cruzando a sala ao mesmo tempo
  let vizinhos = 0;
  for (const o of E.agentes.values()) if (o !== a && estaNoDescanso(o) && parteDe(s, P(o)) === aqui) vizinhos++;
  if (a.vaga && aleat(a.h, a.nAcao * 13 + 6) < (vizinhos >= 4 ? 0.7 : 0.22)) return;
  // ordem de preferência sorteada; na maioria das vezes não repete a ação anterior
  let ordem = r < 0.3 ? ['conversar', 'sofa', 'em-pe'] : r < 0.65 ? ['sofa', 'em-pe', 'conversar'] : ['em-pe', 'conversar', 'sofa'];
  if (aleat(a.h, a.nAcao * 17 + 8) < 0.75) ordem = [...ordem.filter(x => x !== a.ultimaAcaoDescanso), a.ultimaAcaoDescanso].filter(Boolean);
  // os cantos entram no sorteio do descanso vivo (sem repetir o canto de antes)
  if (cantos.length && a.ultimaAcaoDescanso !== 'canto' && aleat(a.h, a.nAcao * 29 + 3) < 0.3) ordem.unshift('canto');

  for (const acao of ordem) {
    if (acao === 'canto' && cantos.length) {
      // videogame em dupla: com um pufe ocupado, o outro chama mais
      const dupla = cantos.filter(v => v.acao === 'videogame' && v.parceiro?.ocupada);
      const lista = dupla.length && aleat(a.h, a.nAcao * 31 + 7) < 0.7 ? dupla : cantos;
      const v = lista[Math.floor(aleat(a.h, a.nAcao * 37 + 9) * lista.length)];
      moverNoDescanso(a, v);
      a.proxAcao += 12000;   // fica mais um pouco: as posturas e as partidas levam tempo
      a.ultimaAcaoDescanso = acao;
      return;
    }
    if (acao === 'conversar' && parceiro) {
      const pos = pontoDeConversa(s, parceiro, a);
      if (!pos) continue;
      moverNoDescanso(a, { pos, olhar: 0, pose: 'em-pe', conversa: true, sala: 'descanso' });
      a.conversaCom = parceiro;
      parceiro.conversaCom = a;
      parceiro.proxAcao = Math.max(parceiro.proxAcao, agoraMs + 10000);
      a.ultimaAcaoDescanso = acao;
      return;
    }
    if (acao === 'sofa' && sofas.length) {
      const v = sofas[Math.floor(aleat(a.h, a.nAcao * 5 + 2) * sofas.length)];
      if (v === a.vaga) continue;
      moverNoDescanso(a, v);
      a.ultimaAcaoDescanso = acao;
      return;
    }
    if (acao === 'em-pe' && pontos.length) {
      const p = pontos[Math.floor(aleat(a.h, a.nAcao * 11 + 4) * pontos.length)];
      if (p === a.vaga?.ponto) continue;
      p.ocupadoPor = a;
      moverNoDescanso(a, { pos: p.pos.clone(), olhar: p.olhar, pose: 'em-pe', ponto: p, sala: 'descanso' });
      a.ultimaAcaoDescanso = acao;
      return;
    }
  }
}

// Descanso vivo travado: fica onde está, se ali é um bom lugar em pé (longe de
// móvel, da porta e de todo mundo); senão vai ao ponto livre mais perto do mesmo
// cômodo; senão refaz a rota desviando de quem está parado
function desistirNoDescanso(a, agoraMs) {
  a.origemRota = 'desistir';
  const s = E.salas.descanso;
  const p = P(a);
  encerrarConversa(a);
  a.parouDesde = 0;
  // ainda no trecho do assento (levantando): senta de novo, pelo mesmo trecho
  const v0 = a.saindoDe;
  if (v0 && vagaReal(v0) && (!v0.ocupada || v0.ocupada === a) && Math.hypot(p.x - v0.pos.x, p.z - v0.pos.z) < 1.3) {
    liberarVaga(a);
    v0.ocupada = a;
    a.vaga = v0;
    const fim = posDaVaga(a, v0);
    fim.assento = true;
    a.rota = [fim];
    a.vagaRota = v0;
    a.destinoFinal = fim.clone();
    a.trechoAssento = true;
    a.saindoDe = null;
    a.proxAcao = agoraMs + (4 + aleat(a.h, a.nAcao * 23 + 5) * 5) * 1000;
    return;
  }
  // fica onde está se ali é um bom lugar em pé (nunca na faixa de quem senta e
  // levanta, na frente de porta ou encostado em móvel)
  if (s && lugarFixoValido(p.x, p.z) && lugarAberto(p.x, p.z) && lugarValido(p.x, p.z, a, DMIN + 0.1, true)) {
    liberarVaga(a);
    a.vaga = { pos: p.clone(), olhar: Math.PI / 4, pose: 'em-pe', extra: true, sala: 'descanso' };
    chegou(a);
    a.proxAcao = agoraMs + (3 + aleat(a.h, a.nAcao * 19 + 3) * 4) * 1000;
    return;
  }
  if (s) {
    const aqui = parteDe(s, p);
    let melhor = null, dMelhor = Infinity;
    for (const q of pontosDoDescanso(s)) {
      if (q.ocupadoPor || q === a.vaga?.ponto || (aqui >= 0 && parteDe(s, q.pos) !== aqui)) continue;
      const d = Math.hypot(q.pos.x - p.x, q.pos.z - p.z);
      if (d < dMelhor && lugarValido(q.pos.x, q.pos.z, a, ESPACO_LUGAR, true)) { melhor = q; dMelhor = d; }
    }
    if (melhor) {
      melhor.ocupadoPor = a;
      moverNoDescanso(a, { pos: melhor.pos.clone(), olhar: melhor.olhar, pose: 'em-pe', ponto: melhor, sala: 'descanso' }, 'desistir');
      a.ultimoReplano = agoraMs;
      return;
    }
  }
  replanejar(a, agoraMs);
}

// Lugar válido a 0,8 a 1,0 do parceiro, dentro da sala (corpo sólido: nunca colado)
function pontoDeConversa(s, parceiro, a) {
  const c = parceiro.boneco.position;
  for (const r of [0.95, 1.1]) {
    for (let k = 0; k < 8; k++) {
      const ang = Math.atan2(s.cx - c.x, s.cz - c.z) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 4;
      const x = c.x + Math.sin(ang) * r, z = c.z + Math.cos(ang) * r;
      if (x < s.x0 + 0.3 || x > s.x1 - 0.3 || z < s.z0 + 0.3 || z > s.z1 - 0.3) continue;
      if (lugarValido(x, z, a) && lugarAberto(x, z)) return new THREE.Vector3(x, 0, z);
    }
  }
  return null;
}

// Alguém do descanso andando a até 3,2 m (a troca dele ainda não terminou): no
// descanso, um troca de lugar de cada vez (quem trava é desfeito por dar passagem,
// desistir ou, no fim, o resgate)
function algumAndandoPerto(a) {
  const p = P(a);
  for (const o of E.agentes.values()) {
    if (o === a || o.estado !== 'andando' || o.resgatando || !solido(o) || o.alvo !== 'descanso') continue;
    if (o.parouDesde && ultimoAgoraMs - o.parouDesde > 1500) continue;   // travado: melhor sair da frente dele
    if (Math.hypot(P(o).x - p.x, P(o).z - p.z) < 3.2) return true;
  }
  return false;
}

function moverNoDescanso(a, v, origem = 'descanso') {
  a.origemRota = origem;
  if (a.estado !== 'andando') registrarPartida(a, relogio());
  liberarVaga(a);
  if (vagaReal(v)) v.ocupada = a;
  a.vaga = v;
  rotaAte(a, 'descanso', posDaVaga(a, v), { vaga: v });
  a.ultimoAvanco = 0;
}

// ---------------------------------------------------------------------------
// Animação de cada agente (chamada a cada quadro)
// ---------------------------------------------------------------------------
const tmp = new THREE.Vector3();
const projetado = new THREE.Vector3();

function girarPara(b, angulo, dt, vel) {
  b.rotation.y += difAngulo(angulo, b.rotation.y) * Math.min(1, dt * vel);
}

// Para onde olhar parado na vaga
function olharDe(a, v) {
  const o = a.conversaCom;
  if (o && v.pose !== 'sentado') return Math.atan2(o.boneco.position.x - a.boneco.position.x, o.boneco.position.z - a.boneco.position.z);
  if (v.fila) return v.olhar;   // na fila: olha para a frente (a mesa ou as costas de quem está na frente)
  if (v.olharFixo) return v.olhar;   // biblioteca: de frente para as estantes
  if (v.pose === 'em-pe' || !vagaReal(v)) return olharEmPe(a, v);
  return v.olhar;
}

// Em pé, ninguém fica de cara para a parede (pedido do Eduardo, 03/10; correção
// obrigatória da etapa da planta): olha para a mesa ou o lugar de trabalho mais
// próximo da sala; sem nenhum por perto, para o colega mais próximo; e só aceita o
// alvo se não houver parede ou divisória a menos de 0,8 m na frente antes dele
// (Est.paredeNaFrente: móvel no caminho vale, é algo para olhar). Sem alvo assim, olha
// para o lado com mais vista livre, de preferência para dentro da sala.
// O que depende só dos móveis é calculado uma vez por vaga e guardado nela.
const OLHAR_PAREDE_MIN = 0.8;
function olharEmPe(a, v) {
  if (v._olharEmPe !== undefined) return v._olharEmPe;
  const p = v.pos || a.boneco.position;
  const semParede = ang => !Est.paredeNaFrente?.(p.x, p.z, ang, OLHAR_PAREDE_MIN);
  const angulo = q => Math.atan2(q.x - p.x, q.z - p.z);
  // lugares de trabalho: primeiro os da mesma sala (na biblioteca, as estantes; nunca o
  // banquinho da oficina do outro lado da divisória), depois os de todas as salas
  const lugares = Object.values(E.salas || {}).flatMap(s => s.vagas || []);
  const daSala = v.sala ? E.salas[v.sala]?.vagas?.filter(u => u.pose === 'sentado' || u.olharFixo) : null;
  for (const lista of [daSala?.length ? daSala : null, lugares]) {
    if (!lista) continue;
    const alvos = [];
    for (const u of lista) {
      if (!u?.pos || u === v || (u.pose !== 'sentado' && !u.olharFixo)) continue;
      if (u.olharFixo && lista === lugares) continue;
      const d = Math.hypot(u.pos.x - p.x, u.pos.z - p.z);
      if (d > 0.6 && d < 4) alvos.push({ d, q: u.olharFixo ? { x: u.pos.x + Math.sin(u.olhar) * 1.5, z: u.pos.z + Math.cos(u.olhar) * 1.5 } : u.pos });
    }
    alvos.sort((x, y) => x.d - y.d);
    for (const { q } of alvos) {
      const ang = angulo(q);
      if (semParede(ang)) { v._olharEmPe = ang; return ang; }
    }
  }
  // o colega mais próximo (a direção muda: não guarda)
  let colega = null, dColega = Infinity;
  for (const o of E.agentes.values()) {
    if (o === a || !o.boneco || o.aguardandoEntrada) continue;
    const d = Math.hypot(o.boneco.position.x - p.x, o.boneco.position.z - p.z);
    if (d > 0.4 && d < 3 && d < dColega && semParede(angulo(o.boneco.position))) { dColega = d; colega = o.boneco.position; }
  }
  if (colega) return angulo(colega);
  v._olharEmPe = melhorVista(p, v.olhar);
  return v._olharEmPe;
}

// O lado com mais vista livre (16 direções); empate: o mais perto do ângulo preferido.
// Móvel a mais de 0,8 m também serve (é algo para olhar); parede perto, nunca.
function melhorVista(p, preferido = Math.PI / 4) {
  let melhor = preferido, nota = -Infinity;
  for (let k = 0; k < 16; k++) {
    const ang = k * Math.PI / 8;
    const vista = Est.vistaEm ? Est.vistaEm(p.x, p.z, ang, 3) : { dist: 3, oque: 'livre' };
    if (vista.oque === 'parede' && vista.dist < OLHAR_PAREDE_MIN) continue;
    const n = vista.dist + (vista.oque === 'movel' ? 0.6 : 0) - Math.abs(difAngulo(ang, preferido)) * 0.15;
    if (n > nota) { nota = n; melhor = ang; }
  }
  return melhor;
}

// y do quadril sentado: topo do assento menos 0,30 × escala
function ySentado(v, escala) {
  const topo = v.topoAssento ?? ((v.alturaAssento ?? 0.07) > 0.09 ? 0.54 : 0.51);
  return topo - 0.30 * escala;
}

function conversando(a) {
  const o = a.conversaCom;
  return !!(o && o.conversaCom === a && a.estado !== 'andando' && o.estado !== 'andando');
}

// dt em segundos; agoraMs = performance.now()
export function animarAgentes(dt, agoraMs) {
  // Quadro atrasado (aba em segundo plano, painel oculto, máquina lenta): o dt chega
  // limitado a 0,05 s, então o mundo andou bem menos que o relógio. Os prazos de
  // "travado" (resgate, rota nova, desempate, vez da porta) avançam junto; senão,
  // na volta, todo mundo que andava some e reaparece no destino (resgate em massa).
  const salto = ultimoAgoraMs ? agoraMs - ultimoAgoraMs - dt * 1000 : 0;
  if (salto > 150) adiarPrazos(salto);
  ultimoAgoraMs = Math.max(ultimoAgoraMs, agoraMs);
  const agentes = E.agentes;
  const agora = agoraMs / 1000;
  const semConexao = semConexaoLonga();
  Est.atualizarEstacao(agoraMs);   // mapa pendente e filas de acoplar e desacoplar
  atualizarNpcs();
  if (filasSujas) organizarFilas();
  partidasDasFilas(agoraMs);
  partidasPendentes(agoraMs);
  atualizarPortas(agoraMs);
  liberarEntrada(agoraMs);

  for (const a of [...agentes.values()]) {
    if (a.aguardandoEntrada) continue;   // invisível do lado de fora, esperando a vez
    const b = a.boneco;
    const escala = ESCALA_BONECO * a.fator;
    if (!a.ultimoAvanco) a.ultimoAvanco = agoraMs;

    // resgate: travado há 10 s, some no lugar e reaparece no destino
    if (a.resgatando) {
      if (animarResgate(a, dt, escala)) continue;
    } else if (a.estado === 'andando' && !a.saindo
      && (agoraMs - a.ultimoAvanco > (a.motivo === 'fila' || a.motivo === 'porta' ? RESGATE_FILA_MS : RESGATE_MS)
        || (!a.espera && a.progresso && agoraMs - a.progresso.ms > RESGATE_PROGRESSO_MS))) {
      a.resgatando = true;
      const p = P(a);
      ultimosResgates.push({ id: a.id, motivo: a.motivo, x: +p.x.toFixed(2), z: +p.z.toFixed(2), destino: a.salaDestino,
        porta: a.esperandoPorta?.sala ?? null, trechoAssento: a.trechoAssento, bloqueador: a.bloqueador ? (a.bloqueador.npc ? 'npc' : a.bloqueador.id) : null });
      if (ultimosResgates.length > 20) ultimosResgates.shift();
      continue;
    }

    // fade de entrada e de saída (escala até 0,01 em 0,4 s)
    if (a.saindo) {
      a.fade = Math.max(0, a.fade - dt / FADE_SAIDA_S);
      b.scale.setScalar((0.01 + 0.99 * a.fade) * escala);
      if (a.fade <= 0) { removerAgente(a); continue; }
    } else if (a.fade < 1) {
      a.fade = Math.min(1, a.fade + dt * 2.5);
      b.scale.setScalar((0.01 + 0.99 * a.fade) * escala);
    }

    // relógio do fim de trabalho: aos 60 s levanta e vai ao descanso
    // (um de cada vez: saída escalonada)
    if (a.relogioAtivo && !a.saindo && progressoRelogio(a, agoraMs) >= 1) {
      // descanso lotado (cada lugar é de um só; com o capacete de 0,85 m, gente a mais em
      // pé tranca as passagens): espera na mesa, com o relógio cheio, até abrir lugar
      a.esperaDescanso = descansoLotado(a);
      if (!a.esperaDescanso && vezDePartir(a, agoraMs)) irParaDescanso(a);
    }

    let modo, sentado = false;
    if (a.estado === 'andando' && !a.saindo) {
      andar(a, dt, escala, agoraMs);
      if (!E.agentes.has(a.id)) continue;
      // parado na fila ou na porta por mais de 0,25 s: fica em pé, quieto
      modo = a.estado === 'andando' && a.parouDesde && agoraMs - a.parouDesde > 250 ? 'parado' : 'andar';
    } else {
      const v = a.vaga;
      if (v && !a.saindo) {
        const olhar = olharDe(a, v);
        if (a.girando) {
          // sentar em dois tempos: primeiro gira de frente para a mesa, depois senta
          girarPara(b, olhar, dt, 12);
          if (Math.abs(difAngulo(olhar, b.rotation.y)) < 0.12 || agoraMs - a.girandoDesde > 700) {
            a.girando = false;
            if (vagaReal(v) && ehMesa(v)) {
              acender(v, 0.9);
              if (v.casaDe === a) v.definirCaneca?.(null);
              if ((v.sala === 'mcp' || v.sala === 'api') && a.conector) v.mostrarServico?.(a.conector);
              else if (v.sala === 'coworking' && a.servicoNaMesa) { v.mostrarServico?.(a.servicoNaMesa); a.servicoMostrado = a.servicoNaMesa; }
            }
          }
        } else {
          girarPara(b, olhar, dt, 8);
        }
        sentado = v.pose === 'sentado' && !a.girando;
        const alvoY = sentado ? ySentado(v, escala) : 0;
        b.position.y += (alvoY - b.position.y) * Math.min(1, dt * 8);
      } else {
        sentado = a.sentadoAntes && a.saindo;
      }
      modo = a.saindo && a.modo ? a.modo : escolherModo(a, v, agoraMs);
      if (modo === 'digitar' && semConexao) { modo = 'parado'; definirLed(a, 'apagado'); }
      else if (a.led === 'apagado' && !a.saindo) definirLed(a, ledDaAtividade(a.atividade));
      if (modo === 'digitar' && sentado) v?.rolarTela?.(dt);

      // descanso vivo
      if (estaNoDescanso(a) && agoraMs >= a.proxAcao) {
        if (!a.proxAcao) a.proxAcao = agoraMs + (3 + aleat(a.h, 99) * 5) * 1000;   // primeiro respiro
        else proximaAcaoDescanso(a, agoraMs);
      }
    }

    // estado para a câmera
    if (a.estado !== 'andando') a.estado = a.alvo === 'descanso' && a.sala === 'descanso' ? 'descanso' : a.relogioAtivo ? 'relogio' : 'parado';

    if (modo !== a.modo || sentado !== a.sentadoAntes) {
      a.transicaoAte = Math.max(agoraMs + 400, a.entregarAte);
      a.modo = modo;
      a.sentadoAntes = sentado;
    }
    // canto de descompressão: o animador do canto cuida da pose (por cima do 'descansar')
    const lugarCanto = a.vaga?.cantoObj && a.estado !== 'andando' && !a.girando && !a.saindo && a.alvo === 'descanso' ? a.vaga : null;
    if (a.animDescanso && a.animDescanso.lugar !== lugarCanto) { a.animDescanso.encerrar(); a.animDescanso = null; }
    if (lugarCanto && !a.animDescanso) a.animDescanso = lugarCanto.cantoObj.usar(lugarCanto, b, { fase: a.fase });
    if (a.animDescanso) a.animDescanso.quadro(agora, dt);
    else b.userData.animar(agora, modo, sentado, { dt, fase: a.fase, passo: a.passo, atividade: a.atividade });
  }

  animarBaloes(agoraMs);
  animarRelogios(agoraMs);
  animarNotas();
}

function escolherModo(a, v, agoraMs) {
  if (agoraMs < a.entregarAte) return 'entregar';
  // na fila: o primeiro da sala do dono acena; os outros esperam em pé, olhando em volta
  if (a.filaId && v?.fila) return a.pendencia === 'precisa_de_voce' && a.posFila === 0 ? 'esperar' : 'parado';
  if (a.atividade === 'esperar') return 'esperar';
  // oficina: espera quieto (limite de uso: olhos semicerrados); conversa quando o
  // mecânico fala com ele. Biblioteca: em pé, olhando as estantes
  if (a.alvo === 'oficina' && v && !a.relogioAtivo) {
    if (E.oficinaConversando === a.id) return 'conversar';
    return a.tipoOficina === 'limite' ? 'descansar' : 'parado';
  }
  if (a.alvo === 'biblioteca' && v && !a.relogioAtivo) return 'parado';
  if (a.alvo === 'descanso') {
    if (conversando(a)) return 'conversar';
    return v?.pose === 'sentado' ? 'pausa' : 'parado';   // em pé: olha ao redor
  }
  if (a.relogioAtivo || a.atividade === 'descansar') return 'descansar';
  if (!v) return 'descansar';
  return 'digitar';
}

function andar(a, dt, escala, agoraMs) {
  const b = a.boneco;
  const p = b.position;
  // consome os pontos já alcançados (sem encostar em ninguém no ajuste final)
  while (a.rota.length && Math.hypot(a.rota[0].x - p.x, a.rota[0].z - p.z) < 0.05) {
    const q = a.rota.shift();
    if (!quemBloqueia(a, q.x, q.z)) { p.x = q.x; p.z = q.z; }
    if (q.saidaAssento) a.saindoDe = null;
    if (q.recuo) { a.pausaAte = agoraMs + RECUO_PAUSA_MS; a.replanejarDepois = true; }
    a.desviou = false;
  }
  // abriu caminho para outro: espera um instante ao lado e depois refaz a rota
  if (a.pausaAte > agoraMs) {
    a.motivo = 'recuo';
    if (!a.parouDesde) a.parouDesde = agoraMs;
    a.progresso = { x: p.x, z: p.z, ms: agoraMs };
    p.y = 0;
    return;
  }
  if (a.replanejarDepois) { a.replanejarDepois = false; replanejar(a, agoraMs); }
  if (!a.rota.length) { chegou(a); p.y = 0; return; }
  const alvo = a.rota[0];
  a.trechoAssento = !!(alvo.assento || alvo.saidaAssento);
  tmp.set(alvo.x - p.x, 0, alvo.z - p.z);
  const dist = tmp.length();
  tmp.divideScalar(dist);
  a.dirx = tmp.x; a.dirz = tmp.z;

  // progresso: onde estava quando andou 0,15 pela última vez (travas e desempate)
  if (!a.progresso || Math.hypot(p.x - a.progresso.x, p.z - a.progresso.z) > 0.15) a.progresso = { x: p.x, z: p.z, ms: agoraMs };
  // esperando a vez da porta num lugar de espera fora da passagem
  if (a.espera && esperarNaVez(a, dt, escala, agoraMs)) { p.y = 0; return; }

  const prox = E.mapa?.portaEm ? proximaPorta(a) : null;
  a.proxPorta = prox?.porta || null;
  if (a.esperandoPorta && a.esperandoPorta !== a.proxPorta) a.esperandoPorta = null;   // mudou de rota

  // 1) fila indiana: desacelera atrás de quem vai no mesmo sentido
  let passo = Math.min(dist, a.velocidade * dt) * fatorFila(a, tmp.x, tmp.z, agoraMs);
  let motivo = passo > 1e-6 ? null : 'fila';
  // 2) porta: um por vez
  if (!motivo && !podePassarPorta(a, prox, p.x + tmp.x * passo, p.z + tmp.z * passo, agoraMs)) { passo = 0; motivo = 'porta'; }
  // 3) corpo sólido: não chega a menos de 0,6 de ninguém; contorna quem está parado
  let nx = p.x + tmp.x * passo, nz = p.z + tmp.z * passo;
  // 4) parede: depois de um desvio, a linha reta até o próximo ponto pode cruzar
  // móvel ou divisória; aí refaz a rota a partir de onde está
  if (!motivo && !a.trechoAssento && corpoCabe(p.x, p.z) && (!corpoCabe(nx, nz) || (a.desviou && !visaoLivre(p, alvo)))) {
    a.desviou = false;
    if (agoraMs - a.ultimoReplano > 250) { replanejar(a, agoraMs); p.y = 0; return; }
    passo = 0; motivo = 'parede';
  }
  if (!motivo) {
    const o = quemBloqueia(a, nx, nz);
    if (o) {
      const desvio = podeContornar(a, o, agoraMs) ? contornar(a, o, tmp.x, tmp.z, passo) : null;
      if (desvio) {
        // quem contorna anda de lado: os outros veem o sentido de verdade (fila)
        const dl = Math.hypot(desvio.x - p.x, desvio.z - p.z) || 1;
        a.dirx = (desvio.x - p.x) / dl; a.dirz = (desvio.z - p.z) / dl;
        nx = desvio.x; nz = desvio.z; a.desviou = true;
      } else { motivo = 'corpo'; a.bloqueador = o; }
    }
  }

  a.motivo = motivo;
  if (!motivo) {
    const andou = Math.hypot(nx - p.x, nz - p.z);
    const desviando = a.desviou && (nx !== p.x + tmp.x * passo || nz !== p.z + tmp.z * passo);
    p.x = nx; p.z = nz;
    a.passo += andou / (PASSADA * escala / ESCALA_BONECO) * Math.PI;   // passada pela distância: o pé não patina
    a.parouDesde = 0;
    a.corpoDesde = 0;
    // desvio de lado não conta como avanço (para o resgate); desviando há 1,2 s, refaz a rota
    if (semProgresso(a, agoraMs) > SEM_PROGRESSO_MS && agoraMs - a.ultimoReplano > 2000 && !a.trechoAssento) {
      if (dentroDoDescanso(a)) { desistirNoDescanso(a, agoraMs); p.y = 0; return; }
      replanejar(a, agoraMs);
    }
    if (!desviando) { a.desvioDesde = 0; if (andou > 1e-4) a.ultimoAvanco = agoraMs; }
    else {
      if (!a.desvioDesde) a.desvioDesde = agoraMs;
      if (agoraMs - a.desvioDesde > 1200 && agoraMs - a.ultimoReplano > 1000) { a.desvioDesde = 0; replanejar(a, agoraMs); }
    }
  } else {
    if (!a.parouDesde) a.parouDesde = agoraMs;
    // descanso vivo travado (corpo, fila ou porta) por 2 s: desiste daquela ação
    if (dentroDoDescanso(a) && (!a.trechoAssento || a.saindoDe)
      && (agoraMs - a.parouDesde > DESISTIR_DESCANSO_MS || semProgresso(a, agoraMs) > DESISTIR_DESCANSO_MS + 500)) {
      desistirNoDescanso(a, agoraMs);
      p.y = 0;
      return;
    }
    if (motivo !== 'porta' && !a.trechoAssento && semProgresso(a, agoraMs) > SEM_PROGRESSO_MS && agoraMs - a.ultimoReplano > 2000) replanejar(a, agoraMs);
    // parado por alguém que está em pé no caminho (sala cheia, relógio, descanso):
    // depois de 1 s, ele dá passagem (vai para um lugar em pé ao lado, fora da rota)
    // (quem fica contornando no mesmo lugar zera o parouDesde a cada passinho de lado: o
    // tempo sem progresso de verdade também conta, verificação v0.6)
    if (motivo === 'corpo' && a.bloqueador && !a.bloqueador.npc
      && (agoraMs - a.parouDesde > DAR_PASSAGEM_MS || semProgresso(a, agoraMs) > 2 * DAR_PASSAGEM_MS)) {
      const o = a.bloqueador;
      if (o.estado !== 'andando') darPassagem(o, a, agoraMs);
      // quem espera a vez de uma porta no caminho de outro muda de lugar de espera; sem
      // lugar para ele (sala apertada, colado na porta), quem está travado cede a vez
      // da porta a ele e sai de lado (verificação v0.6: os dois ficavam se esperando)
      else if (o.espera) { if (!moverEspera(o, a, agoraMs) && !moverEspera(o, a, agoraMs, true) && (agoraMs - a.parouDesde > 2 * DAR_PASSAGEM_MS || semProgresso(a, agoraMs) > 3 * DAR_PASSAGEM_MS)) cederPorta(a, o, agoraMs); }
      // dois andando que se travam (cada um no caminho do outro): o de menor
      // prioridade sai de lado; se não conseguir, depois de mais um tempo, o outro sai
      else if (o.parouDesde && (!temPrioridade(a, o) || agoraMs - a.parouDesde > 2 * DAR_PASSAGEM_MS + (a.h % 4) * 150)) abrirCaminho(a, o, agoraMs);
    }
    if (motivo === 'corpo' && !a.trechoAssento) {
      if (!a.corpoDesde) a.corpoDesde = agoraMs;
      // travado por um corpo: refaz a rota desviando de quem está parado
      // (o atraso varia por agente, para dois travados não replanejarem juntos)
      const espera = REPLANEJAR_MS + (a.h % 5) * 120;
      if (agoraMs - a.corpoDesde > espera && agoraMs - a.ultimoReplano > 1000) replanejar(a, agoraMs);
    } else a.corpoDesde = 0;
  }
  girarPara(b, Math.atan2(tmp.x, tmp.z), dt, 12);
  // quem nasceu do lado de fora passa a estar no corredor ao cruzar a porta (BUG-04)
  if (a.sala === 'fora' && p.x < E.X1 - 0.3) a.sala = 'corredor';
  p.y = 0;
}

// ---------------------------------------------------------------------------
// Fila indiana e corpo sólido
// ---------------------------------------------------------------------------
// Corpos dos NPCs neste quadro (posição de mundo), no formato que quemBloqueia e os
// desvios esperam: { npc, boneco: { position }, estado }. Um objeto por NPC, reaproveitado.
let npcsQuadro = [];
const proxiesNpc = new Map();
function atualizarNpcs() {
  const lista = corposNpc();
  npcsQuadro = lista.map(c => {
    let o = proxiesNpc.get(c.corpo);
    if (!o) { o = { id: 'npc', npc: true, h: 0, boneco: { position: new THREE.Vector3() } }; proxiesNpc.set(c.corpo, o); }
    o.boneco.position.set(c.x, 0, c.z);
    o.estado = c.andando ? 'andando' : 'parado';
    return o;
  });
  if (proxiesNpc.size > lista.length + 8) for (const k of [...proxiesNpc.keys()]) if (!lista.some(c => c.corpo === k)) proxiesNpc.delete(k);
}
export function npcsNaCena() { return npcsQuadro; }

// Há quanto tempo ele não sai de 0,15 m (andando)
const semProgresso = (a, agoraMs) => (a.progresso ? agoraMs - a.progresso.ms : 0);

// Quem passa primeiro quando dois estão lado a lado (estável por agente)
const temPrioridade = (o, a) => o.h < a.h || (o.h === a.h && o.id < a.id);

// Fração da velocidade que sobra para quem vai atrás. Para cada outro que anda no
// mesmo sentido (até 30°), mede a distância ao longo do sentido médio dos dois (o
// mesmo número, com sinal trocado, para os dois: nunca um espera o outro ao mesmo
// tempo). Na frente: desacelera de 1,10 até parar a 0,75. Lado a lado: o de menor
// prioridade para até o outro passar à frente.
function fatorFila(a, dx, dz, agoraMs = ultimoAgoraMs, largo = true) {
  const p = P(a);
  let f = 1;
  for (const o of E.agentes.values()) {
    if (o === a || o.estado !== 'andando' || o.resgatando || o.saindo || o.dirx === undefined || !solido(o)) continue;
    if (dx * o.dirx + dz * o.dirz < COS_MESMO_SENTIDO) continue;
    // escalonar: mesmo sentido, de 0,8 a 1,6 de lado, só contra quem anda de verdade
    // (quem está parado na fila, na porta ou travado não segura a faixa do lado)
    if (largo && emMovimento(o)) {
      const q = P(o);
      let mx = dx + o.dirx, mz = dz + o.dirz;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const rx = q.x - p.x, rz = q.z - p.z;
      const frente = rx * mx + rz * mz, lado = Math.abs(rx * mz - rz * mx);
      if (lado > LADO_FILA && lado <= LADO_LARGO && frente > -NIVEL_FILA && frente < ESCALONAR_SOLTA) {
        if (frente <= NIVEL_FILA) { if (temPrioridade(o, a)) return 0; continue; }
        f = Math.min(f, (frente - ESCALONAR_PARA) / (ESCALONAR_SOLTA - ESCALONAR_PARA));
        continue;
      }
    }
    // parado esperando uma porta: só é fila para quem espera a mesma porta atrás dele.
    // Quem espera outra porta é contornado; e quem está passando pela porta (dono
    // dela) não fica atrás de quem espera por ela
    if (o.esperandoPorta && o.parouDesde && agoraMs - o.parouDesde > 400
      && (o.esperandoPorta !== a.proxPorta || portas.get(o.esperandoPorta)?.dono === a)) continue;
    let mx = dx + o.dirx, mz = dz + o.dirz;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const q = P(o);
    const rx = q.x - p.x, rz = q.z - p.z;
    const frente = rx * mx + rz * mz;
    const lado = Math.abs(rx * mz - rz * mx);
    if (lado > LADO_FILA || frente < -NIVEL_FILA || frente > SEGUIR_SOLTA) continue;
    if (frente <= NIVEL_FILA) {
      if (temPrioridade(o, a)) return 0;
      continue;
    }
    f = Math.min(f, (frente - SEGUIR_PARA) / (SEGUIR_SOLTA - SEGUIR_PARA));
  }
  return Math.max(0, f);
}

// Primeiro corpo que ficaria a menos de 0,6 com o passo para (nx, nz) e mais perto
// do que já está (quem já está perto pode se afastar), ou null
function quemBloqueia(a, nx, nz) {
  const p = P(a);
  const lim2 = DMIN * DMIN;
  for (const o of npcsQuadro) {
    const q = o.boneco.position;
    const d2 = (nx - q.x) ** 2 + (nz - q.z) ** 2;
    if (d2 < lim2 && d2 < (p.x - q.x) ** 2 + (p.z - q.z) ** 2 - 1e-9) return o;
  }
  for (const o of E.agentes.values()) {
    if (o === a || !solido(o)) continue;
    const q = P(o);
    const d2 = (nx - q.x) ** 2 + (nz - q.z) ** 2;
    if (d2 >= lim2) continue;
    if (d2 < (p.x - q.x) ** 2 + (p.z - q.z) ** 2 - 1e-9) return o;
  }
  return null;
}

// Contorna quem está parado (sentado, em pé ou parado há 0,4 s) e quem vem de
// frente (os dois desviam pela mão direita). Quem vai no mesmo sentido não é
// ultrapassado: é fila. Entrando ou saindo do assento, também não.
function podeContornar(a, o, agoraMs) {
  if (a.trechoAssento) return false;
  if (o.estado !== 'andando' || (o.parouDesde > 0 && agoraMs - o.parouDesde > 400)) return true;
  return o.dirx !== undefined && a.dirx * o.dirx + a.dirz * o.dirz < -0.3;
}

// Desliza pela tangente do corpo que bloqueia; de frente, pela mão direita
function contornar(a, o, dx, dz, passo) {
  const p = P(a), q = P(o);
  let ox = q.x - p.x, oz = q.z - p.z;
  const ol = Math.hypot(ox, oz) || 1;
  ox /= ol; oz /= ol;
  const proj = dx * ox + dz * oz;
  let tx = dx - proj * ox, tz = dz - proj * oz;
  let tl = Math.hypot(tx, tz);
  if (tl < 0.35) { tx = -dz; tz = dx; tl = 1; }   // de frente: vai pela direita
  let lados = [[tx / tl, tz / tl], [-tx / tl, -tz / tl]];
  // mantém o lado escolhido contra o mesmo corpo por 1,5 s (sem ziguezague)
  const lado = ([sx, sz]) => Math.sign(ox * sz - oz * sx);
  const mem = a.ladoDesvio;
  if (mem && mem.o === o && ultimoAgoraMs - mem.t < 1500) lados = lados.filter(l => lado(l) === mem.sinal);
  const aqui = portaEm(p.x, p.z);
  for (const [sx, sz] of lados) {
    const x = p.x + sx * passo * 0.8, z = p.z + sz * passo * 0.8;
    if (!corpoCabe(x, z) || quemBloqueia(a, x, z)) continue;
    // o desvio não entra em porta alheia nem põe ninguém lado a lado
    // só entra de lado numa porta livre e vazia (e ela passa a ser dele)
    const porta = portaEm(x, z);
    if (porta && porta !== aqui) {
      const st = estadoPorta(porta);
      if ((st.dono ?? a) !== a || ninguemNaPorta(a, porta) === false) continue;
    }
    if (fatorFila(a, sx, sz, ultimoAgoraMs, false) <= 0) continue;
    if (porta && porta !== aqui) { const st = estadoPorta(porta); st.dono = a; st.desde = ultimoAgoraMs; st.espera.delete(a); }
    if (!mem || mem.o !== o || ultimoAgoraMs - mem.t >= 1500) a.ladoDesvio = { o, sinal: lado([sx, sz]), t: ultimoAgoraMs };
    return { x, z };
  }
  return null;
}

// Dar passagem: quem está parado em pé (não sentado, não andando) no caminho de
// 'a' vai para um lugar em pé válido ali perto, a 0,8 ou mais da rota de 'a'
// (no máximo uma vez a cada 3 s por astronauta)
// (x, z) fica a 'dist' ou mais da rota que 'a' ainda vai andar (os próximos trechos)
function longeDaRotaDe(a, x, z, dist, trechosMax = 4) {
  const trechos = [P(a), ...a.rota.slice(0, trechosMax)];
  for (let k = 0; k + 1 < trechos.length; k++) {
    const u = trechos[k], w = trechos[k + 1];
    const dx = w.x - u.x, dz = w.z - u.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - u.x) * dx + (z - u.z) * dz) / l2));
    if (Math.hypot(x - (u.x + dx * t), z - (u.z + dz * t)) < dist) return false;
  }
  return Math.hypot(x - trechos[0].x, z - trechos[0].z) >= dist;
}

// Quem espera a vez de uma porta no caminho de 'a' troca de lugar de espera (para
// um lugar fora das passagens, longe da rota de 'a'); no máximo a cada 3 s
// afastar: quem espera vai para lá por conta própria, então o trajeto em linha reta
// não pode passar perto de a (senão os dois continuam se travando)
function moverEspera(o, a, agoraMs, afastar = false) {
  if (!o.espera || (o.cedeuEm && agoraMs - o.cedeuEm < 3000)) return false;
  const q = P(o);
  const pa = P(a), dAgora = Math.hypot(q.x - pa.x, q.z - pa.z);
  const outrosPontos = [...E.agentes.values()].filter(x => x !== o && x.espera).map(x => x.espera.ponto);
  // com afastar, sem lugar fora da rota de a, serve um lugar que só saia da frente dele
  // (ele refaz a rota desviando de quem está parado)
  for (const exigirRota of afastar ? [true, false] : [true]) for (const r of [0.7, 1.0, 1.4, 1.9]) {
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2 + (o.h % 5) * 0.2;
      const x = q.x + Math.sin(ang) * r, z = q.z + Math.cos(ang) * r;
      if ((exigirRota && !longeDaRotaDe(a, x, z, 0.8)) || !corpoCabe(x, z) || !folgaBoa(x, z, RAIO + 0.08) || !foraDasPassagens(x, z)) continue;
      if (!lugarValido(x, z, o, DMIN + 0.1, true) || outrosPontos.some(p => Math.hypot(p.x - x, p.z - z) < ESPACO_LUGAR)) continue;
      if (!visaoLivre(q, { x, z })) continue;
      if (afastar) {
        // o primeiro passo já se afasta de a e o trajeto não chega a menos de DMIN dele
        const ux = (x - q.x) / r, uz = (z - q.z) / r;
        if ((ux * (q.x - pa.x) + uz * (q.z - pa.z)) < 0) continue;
        const t = Math.max(0, Math.min(r, (pa.x - q.x) * ux + (pa.z - q.z) * uz));
        if (Math.hypot(q.x + ux * t - pa.x, q.z + uz * t - pa.z) < Math.min(DMIN, dAgora) - 1e-3) continue;
      }
      o.espera.ponto = new THREE.Vector3(x, 0, z);
      o.cedeuEm = agoraMs;
      return true;
    }
  }
  return false;
}

// a está travado por o, que espera a vez da porta num lugar que fica no caminho de a e
// não tem para onde ir: a devolve a porta (se era dele), entra na espera depois de o e
// sai de lado da rota de o; o passa primeiro e a vem logo atrás
function cederPorta(a, o, agoraMs) {
  if (a.cedeuPortaEm && agoraMs - a.cedeuPortaEm < 4000) return false;
  const porta = o.espera?.porta;
  if (!porta) return false;
  const st = estadoPorta(porta);
  if (st.dono === a) { st.dono = null; st.desde = 0; }
  if (st.proximo === a) st.proximo = null;
  st.espera.set(a, agoraMs);
  a.esperandoPorta = porta;
  a.cedeuPortaEm = agoraMs;
  if (abrirCaminho(a, o, agoraMs)) return true;
  // sem lugar de lado (na boca da porta): volta pelo caminho de onde veio, para fora
  // da passagem, e refaz a rota depois de uma pausa
  const p = P(a);
  for (const r of [0.9, 1.2, 1.6]) {
    for (const giro of [0, 0.35, -0.35, 0.7, -0.7]) {
      const c = Math.cos(giro), sn = Math.sin(giro);
      const ux = -(a.dirx * c - a.dirz * sn), uz = -(a.dirx * sn + a.dirz * c);
      const x = p.x + ux * r, z = p.z + uz * r;
      if (!corpoCabe(x, z) || !folgaBoa(x, z, RAIO + 0.02) || !lugarValido(x, z, a, DMIN + 0.05, true) || !visaoLivre(p, { x, z })) continue;
      if (!foraDasPassagens(x, z)) continue;
      const ponto = new THREE.Vector3(x, 0, z);
      ponto.recuo = true;
      a.rota.unshift(ponto);
      a.trechoAssento = false;
      a.recuouEm = agoraMs;
      a.parouDesde = 0;
      a.desviou = false;
      return true;
    }
  }
  return true;
}

function darPassagem(o, a, agoraMs) {
  if (o.estado === 'andando' || o.saindo || o.resgatando || o.girando || o.aguardandoEntrada || o.sala === 'fora') return false;
  const v = o.vaga;
  if ((v && v.pose === 'sentado') || o.sentadoAntes) return false;
  if (o.cedeuEm && agoraMs - o.cedeuEm < 3000) return false;
  const q = P(o);
  const longeDaRota = (x, z) => longeDaRotaDe(a, x, z, 0.8);
  // primeiro um lugar em pé "bom" (longe de mesa, assento e porta); sala cheia,
  // qualquer lugar onde o corpo cabe, fora da passagem das portas e a 0,7 dos outros
  const bom = (x, z) => lugarFixoValido(x, z) && lugarValido(x, z, o, ESPACO_LUGAR, true);
  const aceitavel = (x, z) => corpoCabe(x, z) && folgaBoa(x, z, RAIO + 0.08) && foraDasPassagens(x, z)
    && lugarValido(x, z, o, DMIN + 0.1, true);
  for (const valido of [bom, aceitavel]) for (const r of [0.8, 1.1, 1.5, 2.0, 2.5]) {
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2 + (o.h % 5) * 0.2;
      const x = q.x + Math.sin(ang) * r, z = q.z + Math.cos(ang) * r;
      if (!longeDaRota(x, z) || !valido(x, z)) continue;
      if (!visaoLivre(q, { x, z })) continue;
      const sala = v?.sala || o.alvo || o.sala;
      encerrarConversa(o);
      liberarVaga(o);
      const nova = { pos: new THREE.Vector3(x, 0, z), olhar: Math.PI / 4, pose: 'em-pe', extra: true, sala };
      o.vaga = nova;
      o.origemRota = 'passagem';
      rotaAte(o, o.sala === 'corredor' ? sala : o.sala, nova.pos, { vaga: nova });
      o.cedeuEm = agoraMs;
      o.ultimoAvanco = 0;
      return true;
    }
  }
  return false;
}

// Abrir caminho: 'a' sai de lado para um lugar a 0,75 ou mais da rota de 'o' (em
// linha reta livre), espera um instante e refaz a rota (no máximo a cada 2,5 s)
function abrirCaminho(a, o, agoraMs) {
  if (a.trechoAssento || a.pausaAte > agoraMs || (a.recuouEm && agoraMs - a.recuouEm < 2500)) return false;
  const p = P(a);
  const longeDaRota = (x, z) => longeDaRotaDe(o, x, z, 0.75, 3);
  for (const r of [0.6, 0.9, 1.2, 1.6]) {
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2 + (a.h % 7) * 0.15;
      const x = p.x + Math.sin(ang) * r, z = p.z + Math.cos(ang) * r;
      if (!longeDaRota(x, z) || !corpoCabe(x, z) || !folgaBoa(x, z, RAIO + 0.02) || !lugarValido(x, z, a, DMIN + 0.05, true)) continue;
      if (!visaoLivre(p, { x, z })) continue;
      const ponto = new THREE.Vector3(x, 0, z);
      ponto.recuo = true;
      a.rota.unshift(ponto);
      a.trechoAssento = false;
      a.recuouEm = agoraMs;
      a.parouDesde = 0;
      a.desviou = false;
      return true;
    }
  }
  return false;
}

// Linha reta livre de móveis com a largura do astronauta (visao do mapa)
function visaoLivre(p, q) {
  const m = E.mapa;
  if (!m?.visao) return true;
  return m.visao(new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(q.x, 0, q.z), []);
}

// Ponto a 'dist' à frente, seguindo a rota
function pontoAdiante(a, dist) {
  let { x, z } = P(a);
  for (const q of a.rota) {
    const seg = Math.hypot(q.x - x, q.z - z);
    if (seg >= dist) return { x: x + (q.x - x) / seg * dist, z: z + (q.z - z) / seg * dist };
    dist -= seg;
    x = q.x; z = q.z;
  }
  return { x, z };
}

// ---------------------------------------------------------------------------
// Portas: um por vez. A porta é de quem chega a um passo dela com a passagem
// livre; quem chega depois espera ali (fora do caminho de quem sai) e, quando ela
// libera, entra quem está esperando há mais tempo.
// ---------------------------------------------------------------------------
const portas = new Map();   // porta do mapa -> { dono, desde, espera: Map(agente -> desde) }

function estadoPorta(porta) {
  let st = portas.get(porta);
  if (!st) { st = { dono: null, desde: 0, espera: new Map(), proximo: null, proximoDesde: 0 }; portas.set(porta, st); }
  return st;
}

// Primeira porta em que a rota entra nos próximos 1,6 (ou a porta em que ele já está)
// Só conta porta que a rota atravessa de verdade (passa de um lado do vão para o
// outro): quem só passa pelo corredor rente à boca de uma porta não entra na vez dela
function proximaPorta(a) {
  const p = P(a);
  const aqui = portaEm(p.x, p.z);
  if (aqui && rotaCruza(a, aqui)) return { porta: aqui, dentro: true, dist: 0 };
  for (let d = 0.2; d <= OLHAR_PORTA + 1e-6; d += 0.2) {
    const q = pontoAdiante(a, d);
    const porta = portaEm(q.x, q.z);
    if (porta && porta !== aqui && rotaCruza(a, porta)) return { porta, dentro: false, dist: d };
  }
  return null;
}

// A rota (a partir de onde ele está, até 4 m à frente) cruza o plano do vão dentro da largura da porta
function rotaCruza(a, porta) {
  const eixoZ = porta.eixo === 'z';
  const lado = q => (eixoZ ? q.z - porta.z : q.x - porta.x);
  const dentroDaLargura = q => Math.abs(eixoZ ? q.x - porta.x : q.z - porta.z) <= porta.larg / 2 + 0.3;
  let ant = P(a);
  for (let d = 0.2; d <= 4.001; d += 0.2) {
    const q = pontoAdiante(a, d);
    if (Math.sign(lado(ant)) !== Math.sign(lado(q)) && (dentroDaLargura(ant) || dentroDaLargura(q))) return true;
    ant = q;
  }
  return false;
}

// Boca da passagem do lado em que o ponto está (onde quem sai aparece)
function bocaDaPorta(porta, p) {
  if (porta.eixo === 'x') return { x: porta.x + (Math.sign(p.x - porta.x) || 1) * MARGEM_PORTA, z: porta.z };
  return { x: porta.x, z: porta.z + (Math.sign(p.z - porta.z) || 1) * MARGEM_PORTA };
}

// A passagem está vazia e o lugar logo depois dela (0,5 depois, seguindo a rota)
// não tem ninguém parado em cima. Quem espera esta mesma porta fica de lado e não conta.
function ninguemNaPorta(a, porta) {
  for (const o of E.agentes.values()) {
    if (o !== a && solido(o) && portaEm(P(o).x, P(o).z) === porta) return false;
  }
  return true;
}

function passagemLivre(a, porta) {
  if (!ninguemNaPorta(a, porta)) return false;
  let entrou = false, saida = null;
  for (let d = 0.2; d <= 4.001; d += 0.2) {
    const q = pontoAdiante(a, d);
    if (portaEm(q.x, q.z) === porta) entrou = true;
    else if (entrou) { saida = pontoAdiante(a, d + 0.5); break; }
  }
  if (!saida) return true;
  // só conta quem está passando ali agora; quem está parado é contornado (desvio
  // ou rota nova), senão dois esperando um pelo outro travam a porta
  for (const o of E.agentes.values()) {
    if (o === a || !solido(o) || o.esperandoPorta === porta || !emMovimento(o)) continue;
    if (Math.hypot(P(o).x - saida.x, P(o).z - saida.z) < DMIN) return false;
  }
  return true;
}

// Anda de verdade (não está parado na fila, na porta ou travado)
function emMovimento(o) {
  return o.estado === 'andando' && !(o.parouDesde && ultimoAgoraMs - o.parouDesde > 400);
}

// Pode dar o passo até (nx, nz)? A porta é de quem chega a um passo dela com a
// passagem e a saída livres e ninguém esperando há mais tempo. Com a porta
// ocupada, quem chega para a 1,05 da boca (fora do caminho de quem sai) e espera.
function podePassarPorta(a, prox, nx, nz, agoraMs) {
  if (!E.mapa?.portaEm) return true;
  const novaEm = portaEm(nx, nz);
  if (!prox && !novaEm) { a.esperandoPorta = null; return true; }
  const porta = prox?.porta || novaEm;
  const st = estadoPorta(porta);
  if (st.dono === a) { a.esperandoPorta = null; return true; }
  // o próximo da fila (mesmo sentido do dono, que já passou do vão): chega até a
  // boca e entra assim que o dono sai da passagem
  if (st.proximo === a) {
    if (!st.dono) { st.dono = a; st.desde = agoraMs; st.proximo = null; a.esperandoPorta = null; return true; }
    a.esperandoPorta = porta;
    const p = P(a), boca = bocaDaPorta(porta, p);
    const dN = Math.hypot(nx - boca.x, nz - boca.z), dA = Math.hypot(p.x - boca.x, p.z - boca.z);
    return novaEm !== porta && !(dN < 0.3 && dN < dA);
  }
  if (prox?.dentro) {   // já está na passagem: toma a porta se estiver livre e termina de passar
    if (!st.dono) { st.dono = a; st.desde = agoraMs; st.espera.delete(a); }
    a.esperandoPorta = null;
    return true;
  }
  const minha = st.espera.get(a) ?? Infinity;
  let antesDeMim = false;
  // só passa na frente quem está parado por causa desta porta (não por fila ou corpo)
  for (const [o, desde] of st.espera) {
    if (o !== a && desde < minha && o.esperandoPorta === porta && o.proxPorta === porta && o.motivo === 'porta'
      && E.agentes.get(o.id) === o) { antesDeMim = true; break; }
  }
  const p = P(a);
  const boca = bocaDaPorta(porta, p);
  const dNova = Math.hypot(nx - boca.x, nz - boca.z);
  const chegando = dNova < DIST_BOCA && dNova < Math.hypot(p.x - boca.x, p.z - boca.z);
  const livre = !st.dono && !st.proximo && !antesDeMim && passagemLivre(a, porta);
  if (livre) {
    // quem chega perto da boca (ou a um passo da passagem) já fica com a porta:
    // assim ninguém espera colado nela, no caminho de quem sai
    if (novaEm === porta || chegando || (prox && prox.dist <= ESPERA_ANTES_PORTA)) {
      st.dono = a;
      st.desde = agoraMs;
      st.espera.delete(a);
    }
    a.esperandoPorta = null;
    return true;
  }
  // ocupada: entra na espera. Perto da porta, espera num lugar de lado, fora da
  // passagem e da chegada dela (quem passa não esbarra em quem espera); sem lugar
  // assim, para a 1,05 da boca, no caminho
  entrarNaEspera(a, st, porta, agoraMs);
  a.esperandoPorta = porta;
  if (!a.espera && !a.trechoAssento && Math.hypot(p.x - boca.x, p.z - boca.z) < 2.2) {
    const ponto = pontoDeEspera(a, porta);
    if (ponto) { a.espera = { porta, ponto, desde: agoraMs }; return false; }
  }
  if (novaEm === porta) return false;
  return !chegando;
}

// Lugar de espera de uma porta: do lado em que ele está, a 0,75 a 1,3 da porta e
// de lado (fora da faixa da passagem), onde o corpo cabe, longe de quem está ali
// e dos lugares de espera dos outros, e em linha reta livre a partir dele
function pontoDeEspera(a, porta) {
  const p = P(a);
  const ladoZ = porta.eixo === 'z';
  const lado = (ladoZ ? Math.sign(p.z - porta.z) : Math.sign(p.x - porta.x)) || 1;
  const latAtual = ladoZ ? p.x - porta.x : p.z - porta.z;
  const lados = latAtual >= 0 ? [1, -1] : [-1, 1];
  const base = porta.larg / 2 + RAIO + 0.1;
  const ocupados = [];
  for (const o of E.agentes.values()) {
    if (o === a) continue;
    if (solido(o)) ocupados.push(P(o));
    if (o.espera) ocupados.push(o.espera.ponto);
  }
  // onde ele já está, se ali não é a frente de porta nenhuma (quem vem pelo corredor
  // espera na própria faixa, em fila, sem fechar a saída de quem passa)
  if (foraDasPassagens(p.x, p.z) && corpoCabe(p.x, p.z) && folgaBoa(p.x, p.z, RAIO + 0.08)
    && ocupados.every(q => Math.hypot(q.x - p.x, q.z - p.z) >= DMIN - 0.01)) return p.clone();
  for (const ao of [1.0, 1.3, 0.75]) for (const sl of lados) for (const la of [base, base + 0.3, base + 0.6]) {
    const x = ladoZ ? porta.x + sl * la : porta.x + lado * ao;
    const z = ladoZ ? porta.z + lado * ao : porta.z + sl * la;
    if (!corpoCabe(x, z) || !folgaBoa(x, z, RAIO + 0.08) || !foraDasPassagens(x, z)) continue;
    if (ocupados.some(q => Math.hypot(q.x - x, q.z - z) < ESPACO_LUGAR)) continue;
    if (!visaoLivre(p, { x, z })) continue;
    return new THREE.Vector3(x, 0, z);
  }
  return null;
}

// De que lado do vão o ponto está (-1 ou 1)
function ladoDaPorta(porta, p) {
  return Math.sign(porta.eixo === 'z' ? p.z - porta.z : p.x - porta.x) || 1;
}

// O dono da porta já cruzou o vão (está do outro lado em relação a 'a') e anda
// para longe dele
function donoIndoEmbora(porta, st, a) {
  const d = st.dono;
  if (!d || E.agentes.get(d.id) !== d || d.estado !== 'andando' || d.dirx === undefined) return false;
  const eixoZ = porta.eixo === 'z';
  const ladoA = eixoZ ? P(a).z - porta.z : P(a).x - porta.x;
  const ladoD = eixoZ ? P(d).z - porta.z : P(d).x - porta.x;
  if (Math.sign(ladoA) === Math.sign(ladoD) || Math.abs(ladoD) < 0.05) return false;
  const afasta = (eixoZ ? d.dirz : d.dirx) * Math.sign(ladoD);
  return afasta > 0.3 && !(d.parouDesde && ultimoAgoraMs - d.parouDesde > 300);
}

// Fora da faixa de passagem de todas as portas (até 1,5 antes e depois do vão)
function foraDasPassagens(x, z) {
  for (const q of E.mapa?.portas || []) {
    const ao = q.eixo === 'x' ? x - q.x : z - q.z;
    const la = q.eixo === 'x' ? z - q.z : x - q.x;
    if (Math.abs(ao) < 1.5 && Math.abs(la) < q.larg / 2 + RAIO) return false;
  }
  return true;
}

// Esperando a vez no lugar de espera. Quando a porta fica livre e ninguém espera
// há mais tempo, ela passa a ser dele e ele refaz a rota dali. Devolve true
// quando o quadro dele termina aqui.
function esperarNaVez(a, dt, escala, agoraMs) {
  const { porta, ponto } = a.espera;
  if (!(E.mapa?.portas || []).includes(porta) || agoraMs - a.espera.desde > ESPERA_PORTA_MAX_MS) {
    a.espera = null;   // mapa remontado, ou esperou demais: segue pela rota (resgate cuida)
    return false;
  }
  const st = estadoPorta(porta);
  entrarNaEspera(a, st, porta, agoraMs, a.espera.desde);
  const minha = st.espera.get(a);
  // quem espera há mais tempo, do mesmo lado da porta e do outro lado
  const meuLado = ladoDaPorta(porta, P(a));
  let antes = false, antesMesmoLado = false, outroLadoEsperaDesde = Infinity;
  for (const [o, desde] of st.espera) {
    if (o === a || desde >= minha || E.agentes.get(o.id) !== o || o.esperandoPorta !== porta) continue;
    antes = true;
    if (ladoDaPorta(porta, P(o)) === meuLado) { antesMesmoLado = true; break; }
    outroLadoEsperaDesde = Math.min(outroLadoEsperaDesde, desde);
  }
  // quem já está na boca da porta (dentro da margem dela) passa mesmo que outro espere
  // há mais tempo: enquanto ele está ali, o outro não consegue passar (verificação v0.6,
  // os dois ficavam esperando a vez um do outro)
  const naBoca = !!portaEm(P(a).x, P(a).z, MARGEM_PORTA + 0.35) && portaEm(P(a).x, P(a).z, MARGEM_PORTA + 0.35) === porta;
  if (st.dono === a || (!st.dono && !st.proximo && (!antes || naBoca) && ninguemNaPorta(a, porta))) {
    st.dono = a; st.desde = agoraMs; st.espera.delete(a);
    a.espera = null; a.esperandoPorta = null;
    replanejar(a, agoraMs);
    a.progresso = null;
    return true;
  }
  // o dono já passou do vão e vai embora do outro lado: ele é o próximo (mesmo
  // sentido, um atrás do outro) e já sai do lugar de espera
  // Em ondas: até LOTE_PORTA seguidos no mesmo sentido passam na frente de quem espera
  // do outro lado (a porta rende mais); depois a vez é do outro lado
  // (quem espera do outro lado há mais de 4 s fecha a onda)
  const ondaAberta = !antesMesmoLado && (st.lote?.n ?? 0) < LOTE_PORTA && agoraMs - outroLadoEsperaDesde < 4000;
  if (!st.proximo && (!antes || ondaAberta) && donoIndoEmbora(porta, st, a)) {
    st.proximo = a; st.proximoDesde = agoraMs; st.espera.delete(a);
    a.espera = null; a.esperandoPorta = porta;
    replanejar(a, agoraMs);
    a.progresso = null;
    return true;
  }
  a.esperandoPorta = porta;
  a.proxPorta = porta;
  a.motivo = 'porta';
  a.progresso = { x: P(a).x, z: P(a).z, ms: agoraMs };   // esperar a vez não é estar travado
  const p = P(a);
  const d = Math.hypot(ponto.x - p.x, ponto.z - p.z);
  if (d > 0.04) {
    const passo = Math.min(d, a.velocidade * 0.8 * dt);
    const ux = (ponto.x - p.x) / d, uz = (ponto.z - p.z) / d;
    const nx = p.x + ux * passo, nz = p.z + uz * passo;
    const bloq = quemBloqueia(a, nx, nz);
    if (!bloq && corpoCabe(nx, nz)) {
      p.x = nx; p.z = nz;
      a.dirx = ux; a.dirz = uz;
      a.passo += passo / (PASSADA * escala / ESCALA_BONECO) * Math.PI;
      a.parouDesde = 0;
      a.ultimoAvanco = agoraMs;
      girarPara(a.boneco, Math.atan2(ux, uz), dt, 12);
      return true;
    }
    // a caminho do lugar de espera, travado por quem está passando (ele quer ir por onde
    // este está): troca de lugar de espera para fora da rota dele (verificação v0.6: os
    // dois ficavam se esperando na boca da porta até o resgate)
    if (bloq && !bloq.npc && bloq.estado === 'andando' && !bloq.espera && !a.parouDesde) a.parouDesde = agoraMs;
    if (bloq && !bloq.npc && bloq.estado === 'andando' && !bloq.espera && agoraMs - a.parouDesde > 600) moverEspera(a, bloq, agoraMs, true);
  }
  // parado no lugar de espera, olhando para a porta
  if (!a.parouDesde) a.parouDesde = agoraMs;
  girarPara(a.boneco, Math.atan2(porta.x - p.x, porta.z - p.z), dt, 8);
  return true;
}

// Entra (ou continua) na espera da porta. A ordem de chegada é guardada no agente por
// 4 s: quem sai e volta à espera (a rota oscila, o mapa da porta é refeito) não perde o
// lugar, senão dois esperando trocam de vez sem parar e ninguém passa (verificação v0.6)
function entrarNaEspera(a, st, porta, agoraMs, desde = agoraMs) {
  const m = a.memEspera;
  if (!st.espera.has(a)) st.espera.set(a, m && m.porta === porta && agoraMs - m.ult < 1500 ? Math.min(m.desde, desde) : desde);
  a.memEspera = { porta, desde: st.espera.get(a), ult: agoraMs };
}

function esperarPorta(a, porta, st, agoraMs) {
  entrarNaEspera(a, st, porta, agoraMs);
  a.esperandoPorta = porta;
  return false;
}

// A cada quadro: a porta deixa de ser de quem já passou, sumiu ou não entrou em 4 s
function atualizarPortas(agoraMs) {
  if (!E.mapa?.portaEm) return;
  for (const [porta, st] of portas) {
    const d = st.dono;
    if (d) {
      const vivo = E.agentes.get(d.id) === d && !d.resgatando && !d.aguardandoEntrada;
      const p = d.boneco.position;
      const dentro = vivo && portaEm(p.x, p.z) === porta;
      // ainda chegando: a rota entra nesta porta nos próximos 1,6 (proxPorta, do quadro)
      const chegando = vivo && !dentro && d.estado === 'andando' && d.proxPorta === porta;
      // dono parado antes de entrar (fila, corpo) por mais de 0,8 s: a vez passa
      // para o próximo e ele volta para o fim da espera
      const travado = vivo && !dentro && d.parouDesde && agoraMs - d.parouDesde > 800 && agoraMs - st.desde > 1200;
      if (!vivo || (!dentro && (!chegando || agoraMs - st.desde > LIBERA_PORTA_MS || travado))) {
        st.dono = null;
        if (travado) { st.espera.set(d, agoraMs); d.esperandoPorta = porta; }
      }
    }
    // o próximo: some, para de andar ou demora demais, perde a vez; com a porta
    // livre, ela passa a ser dele
    const px = st.proximo;
    if (px && (E.agentes.get(px.id) !== px || px.estado !== 'andando' || px.resgatando || agoraMs - st.proximoDesde > LIBERA_PORTA_MS + 2000)) st.proximo = null;
    else if (px && !st.dono) { st.dono = px; st.desde = agoraMs; st.proximo = null; }
    // ondas: quantos donos seguidos vieram do mesmo lado
    if (st.dono && st.dono !== st.ultimoDono) {
      const lado = ladoDaPorta(porta, P(st.dono));
      st.lote = st.lote && st.lote.lado === lado ? { lado, n: st.lote.n + 1 } : { lado, n: 1 };
      st.ultimoDono = st.dono;
    }
    for (const o of st.espera.keys()) if (E.agentes.get(o.id) !== o || o.esperandoPorta !== porta) st.espera.delete(o);
  }
}

// ---------------------------------------------------------------------------
// Entrada: um por vez, quando o lugar de entrar está livre
// ---------------------------------------------------------------------------
function liberarEntrada(agoraMs) {
  let primeiro = null;
  for (const a of E.agentes.values()) {
    // quem ainda espera a sala acoplar (sem destino) não entra nem segura a fila
    if (a.aguardandoEntrada && a.alvo && (!primeiro || a.ordemChegada < primeiro.ordemChegada)) primeiro = a;
  }
  if (!primeiro) return;
  const e = P(primeiro);
  for (const o of E.agentes.values()) {
    if (o !== primeiro && solido(o) && Math.hypot(P(o).x - e.x, P(o).z - e.z) < SEGUIR_SOLTA) return;
  }
  primeiro.aguardandoEntrada = false;
  primeiro.boneco.visible = true;
  primeiro.ultimoAvanco = agoraMs;
  E.sujo = true;
}

// ---------------------------------------------------------------------------
// Resgate: some no lugar (0,4 s) e reaparece no destino quando ele estiver livre
// ---------------------------------------------------------------------------
let resgates = 0;
const ultimosResgates = [];   // para conferência: onde e por que travou

// Devolve true quando o quadro deste agente termina aqui
function animarResgate(a, dt, escala) {
  const b = a.boneco;
  if (a.fade > 0) {
    a.fade = Math.max(0, a.fade - dt / FADE_SAIDA_S);
    b.scale.setScalar((0.01 + 0.99 * a.fade) * escala);
    return true;
  }
  if (a.salaDestino === 'fora') { resgates++; removerAgente(a); return true; }
  const alvo = a.destinoFinal;
  if (!alvo) { a.resgatando = false; return false; }
  for (const o of E.agentes.values()) {
    if (o !== a && solido(o) && Math.hypot(P(o).x - alvo.x, P(o).z - alvo.z) < DMIN) return true;   // espera o destino vagar
  }
  // NPC (bibliotecário, mecânico) passando perto do destino: espera ele se afastar
  // (com folga: ele pode estar vindo nesta direção)
  for (const n of npcsQuadro) if (Math.hypot(n.boneco.position.x - alvo.x, n.boneco.position.z - alvo.z) < DMIN + 0.35) return true;
  b.position.set(alvo.x, 0, alvo.z);
  a.rota = [];
  a.resgatando = false;
  a.ultimoAvanco = 0;
  resgates++;
  chegou(a);
  return false;
}

// Empurra para frente os instantes que medem "há quanto tempo está travado"
function adiarPrazos(ms) {
  for (const a of E.agentes.values()) {
    if (a.ultimoAvanco) a.ultimoAvanco += ms;
    if (a.progresso) a.progresso.ms += ms;
    if (a.parouDesde) a.parouDesde += ms;
    if (a.corpoDesde) a.corpoDesde += ms;
    if (a.ultimoReplano) a.ultimoReplano += ms;
    if (a.espera) a.espera.desde += ms;
    if (a.memEspera) { a.memEspera.desde += ms; a.memEspera.ult += ms; }
  }
  for (const st of portas.values()) {
    if (st.desde) st.desde += ms;
    if (st.proximoDesde) st.proximoDesde += ms;
    for (const [o, t] of st.espera) st.espera.set(o, t + ms);
  }
}

// Para conferência (teste dos 50 agentes e console)
export function estatisticasFila() {
  const esperando = [...E.agentes.values()].filter(a => a.aguardandoEntrada).length;
  return { resgates, esperandoEntrada: esperando, portasOcupadas: [...portas.values()].filter(st => st.dono).length,
    ultimosResgates: [...ultimosResgates],
    portas: [...portas].map(([p, st]) => ({ sala: p.sala, x: +p.x.toFixed(2), z: +p.z.toFixed(2), dono: st.dono?.id ?? null, proximo: st.proximo?.id ?? null, espera: [...st.espera.keys()].map(o => o.id) })) };
}

function chegou(a) {
  a.rota = [];
  a.progresso = null;
  a.espera = null;
  a.sala = a.salaDestino;
  a.trechoAssento = false;
  a.parouDesde = 0;
  a.corpoDesde = 0;
  a.esperandoPorta = null;
  a.destinoFinal = P(a).clone();   // o lugar continua reservado enquanto ele está ali
  if (a.sala === 'fora') {   // fim da rota de saída: some com fade
    a.saindo = true;
    a.estado = 'parado';
    definirLed(a, 'apagado');
    return;
  }
  a.estado = 'parado';
  const v = a.vaga;
  if (!v) return;
  if (v.pose === 'sentado' || v.encostado) {
    a.girando = true;
    a.girandoDesde = ultimoAgoraMs;
    a.assento = v;   // ao levantar (ou sair do fliperama), sai pelo acesso desta vaga
  }
  if (v.conversa) {
    mostrarBalao(a, '···', 1500, ultimoAgoraMs);
    const o = a.conversaCom;
    if (o) o.baloesAgendados.push({ texto: '···', em: ultimoAgoraMs + 1700, dur: 1500 });
  }
}

function progressoRelogio(a, agoraMs) {
  return Math.min(1, Math.max(0, (a.paradoHaMs + (agoraMs - a.paradoRecebidoEm)) / RELOGIO_MS));
}

// ---------------------------------------------------------------------------
// Balões de pensamento: um por vez, 2 s cada; se dois ficam a menos de 70 px
// na tela, mostra só o mais recente
// ---------------------------------------------------------------------------
function animarBaloes(agoraMs) {
  const ativos = [];
  for (const a of E.agentes.values()) {
    const ag = a.baloesAgendados;
    if (ag.length && agoraMs >= ag[0].em) {
      const { texto, dur } = ag.shift();
      if (!a.saindo && a.alvo !== 'fora') mostrarBalao(a, texto, dur, agoraMs);
    }
    if (agoraMs >= a.balaoAte) {
      if (a.filaBalao.length && agoraMs >= (a.balaoLiberaEm || 0) && a.alvo !== 'fora' && !a.saindo && !a.nota) mostrarBalao(a, a.filaBalao.shift(), 2000, agoraMs);
      else a.balaoAtivo = false;
    }
    const b = a.boneco;
    a.balao.position.set(b.position.x, b.position.y + ALTURA_BALAO * a.fator, b.position.z);
    if (a.balaoAtivo) ativos.push(a);
  }

  // sobreposição na tela
  const suprimidos = new Set();
  if (ativos.length > 1 && E.camera) {
    const largura = E.renderer?.domElement?.clientWidth || globalThis.innerWidth || 1280;
    const altura = E.renderer?.domElement?.clientHeight || globalThis.innerHeight || 800;
    const telas = ativos.map(a => {
      projetado.copy(a.balao.position).project(E.camera);
      return { a, x: (projetado.x + 1) / 2 * largura, y: (1 - projetado.y) / 2 * altura };
    }).sort((p, q) => q.a.balaoDesde - p.a.balaoDesde);
    const aceitos = [];
    for (const t of telas) {
      if (aceitos.some(o => Math.hypot(o.x - t.x, o.y - t.y) < BALAO_MIN_PX)) suprimidos.add(t.a);
      else aceitos.push(t);
    }
  }
  for (const a of E.agentes.values()) {
    // quem espera invisível do lado de fora da entrada não mostra balão
    const mostrar = a.balaoAtivo && !suprimidos.has(a) && !a.aguardandoEntrada && a.boneco.visible && !a.nota;
    if (a.divBalao.classList.contains('visivel') !== mostrar) a.divBalao.classList.toggle('visivel', mostrar);
  }
}

// ---------------------------------------------------------------------------
// Relógio do fim de trabalho: anel pequeno acima da cabeça (div.relogio, --p)
// ---------------------------------------------------------------------------
function animarRelogios(agoraMs) {
  for (const a of E.agentes.values()) {
    const visivel = a.relogioAtivo && !a.saindo && agoraMs >= a.entregarAte;
    if (!visivel && !a.objRelogio) continue;
    if (!a.objRelogio) {
      const div = document.createElement('div');
      div.className = 'relogio';
      div.style.opacity = '0';
      div.style.transition = 'opacity .4s';
      a.objRelogio = new CSS2DObject(div);
      E.cena.add(a.objRelogio);
    }
    const el = a.objRelogio.element;
    const b = a.boneco;
    a.objRelogio.position.set(b.position.x, b.position.y + ALTURA_RELOGIO * a.fator, b.position.z);
    if (visivel) el.style.setProperty?.('--p', progressoRelogio(a, agoraMs).toFixed(3));
    if (visivel !== a.relogioVisivel) {
      a.relogioVisivel = visivel;
      el.style.opacity = visivel ? '1' : '0';
    }
  }
}

// ---------------------------------------------------------------------------
// Regime de desenho (main.js usa para decidir a taxa de quadros)
// ---------------------------------------------------------------------------
export function regimeAgentes() {
  if (Est.estacaoOcupada()) return 'movimento';   // módulo acoplando, desacoplando ou na fila
  if (!E.agentes.size) return 'vazio';
  const agoraMs = relogio();
  for (const a of E.agentes.values()) {
    // o relógio de 60 s (anel CSS de 16 px) não pede 60 quadros: enche bem a 24 por segundo (PERF-01)
    if (a.estado === 'andando' || a.saindo || a.fade < 1 || a.girando
      || a.aguardandoEntrada || a.resgatando || agoraMs < a.transicaoAte) return 'movimento';
  }
  return 'ambiente';
}
