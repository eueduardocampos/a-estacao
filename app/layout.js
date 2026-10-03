// Planta da Estação (rodada 3, estação elástica): a espinha (base lilás, faixa
// clara, piso do corredor, passadeira e parede da ponta), a porta fixa em X1 e os
// montadores de cada cômodo. Quem decide o que existe e quando é estacao.js.
// Escreve em E: X0, X1, ZN, ZS, ENTRADA_FORA, larguraMaxima e mapa.
//
// MONTADORES. Recebem o módulo m (estacao.js) com o grupo já na posição final
// (x do centro da vaga, z = 0) e montam dentro dele: x local (de -w/2 a w/2) e
// z do mundo. Preenchem m.laje (piso), m.paredes (crescem do chão), m.vagas,
// m.colunas, m.placaSala, m.luzes, m.tv, m.porta, m.pontosEmPe e m.luminaria.
//   montarEstudio          núcleo norte, vagas 2 e 3 (9,2 m): as duas colunas da sala
//                          da primeira pasta, mesa da janela (Pesquisa do núcleo, 1
//                          posto), mesa do comandante e, em frente a ela, a fila de
//                          quem precisa de você (m.filaDef)
//   montarDescansoNucleo   núcleo sul, vaga 0: sofá de 3, poltrona, mesinha,
//                          luminária de pé sempre acesa e 3 pontos em pé
//   montarJardim           canteiro baixo e luminária de jardim, sem assento
//   montarIlhaModulo       sala de pasta (F2): duas colunas de mesas, pendente,
//                          letreiro da pasta (norte) ou placa na divisória (sul)
//   montarSalaServico      MCP ou API: 4 mesas viradas para a TV
//   montarPesquisaModulo   3 mesas na janela
//   montarDescansoModulo   sofá, poltrona, mesinha e 3 pontos em pé
//   montarRevisaoModulo    rodada 6: mesa de revisão, quadro de avisos e a fila de quem
//                          terminou com uma sugestão (m.filaDef)
//   montarSalaNova         salas novas (F1): Servidores, Portaria, Despacho, Missão,
//                          Oficina e Biblioteca, com as peças de app/sala-*.js; ver
//                          SALAS_NOVAS (piso, parede, porta e montador de cada uma)
//   montarSalaControleModulo  Sala Anthropic (núcleo sul, vaga 1) ou Sala OpenAI
//                          (módulo, só com Codex na máquina): mural de medidores,
//                          console e operador NPC (controle.js). Ninguém entra:
//                          m.semAcesso tira o cômodo do mapa de caminhos.
// Referências guardadas para os agentes: m.colunas (montarColunas: { x, zc, grupo,
// vagas, placa }); v.sala (sala lógica) e v.ordem (0 = primeira) em toda vaga.
// A divisória da esquerda de cada cômodo fica em m.divisoriaEsq: estacao.js a tira
// (e do mapa) quando dois módulos da mesma pasta se fundem numa sala só.
// As mesas nascem como posto (banqueta puxada, monitor à mostra); estacao.js mede
// os obstáculos assim e depois deixa todas como mesa de apoio.
//
// ESPINHA. Malhas criadas com a largura máxima e esticadas por scale.x e
// position.x (esticarEspinha, 0,9 s). A porta e o capacho ficam fixos em X1.
// Passadeira azul #336699 (decisão do Eduardo, 03/10), no mesmo formato de antes.

import * as THREE from 'three';
import { Mapa } from './navegacao.js';
import { montarSalaControle } from './controle.js';
import { criarCanto } from './descompressao.js';
import { montarModuloServidores, montarModuloServidoresExtensao } from './sala-servidores.js';
import { montarModuloPortaria } from './sala-portaria.js';
import { montarSalaDespacho } from './sala-despacho.js';
import { montarModuloMissao } from './sala-missao.js';
import { montarModuloOficina } from './sala-oficina.js';
import { montarModuloMemoria } from './sala-memoria.js';
import { E } from './estado.js';
import { ajustarTela } from './cena.js';
import { tween, cancelarTweens } from './tween.js';
import {
  ALT_PAREDE, COR, caixa, cilindro, definirSemente, aleatorio, escolher,
  planta, mesaComputador, estante, sofa, tapete, pendente, luminariaPe, capacho, placaParede, janela, caneca, luminariaMesa,
  placaIlha, mostrarNaPlaca, tvCowork, quadroFundo, relogioParede, rodape, piso, canteiro, luminariaJardim, aparador, letreiroParede,
} from './pecas.js';
import {
  iniciarEstacao, CORR, PROF, VAO, ALT_DIVISORIA, X1, ZN, ZS, ZB, ZS2, DOBRA_X, XMIN_MAX, XMIN_NUCLEO,
} from './estacao.js';

export { ALT_PAREDE, CORR, PROF, VAO, ALT_DIVISORIA };

// Tecido da banqueta: um tom por cômodo, sorteado pela semente
const ASSENTOS = [COR.linho, COR.azulAcinzentado];
// Piso por tipo (VIS-05): carvalho no Estúdio e nas ilhas, madeira média no
// descanso e uma madeira suave diferente em cada tipo de módulo
const PISO = {
  estudio: COR.madeiraTampo, ilha: COR.madeiraTampo, descanso: COR.madeiraMedia,
  mcp: 0xcab9a5, api: 0xd2b893, pesquisa: 0xc6bcae, jardim: 0xd5c8b0,
  // salas de controle: madeira clara e quente (Anthropic), cinza claro e liso (OpenAI)
  'controle-anthropic': 0xd8b896, 'controle-openai': 0xcfd1d3,
  revisao: 0xd3c3ab,
  // salas novas (F1): piso técnico cinza nos servidores, cimento quente na oficina,
  // madeiras médias nas outras
  servidores: 0xc9ccd4, portaria: 0xd6b083, despacho: 0xcfa77a, missao: 0xd2ae84, oficina: 0xcdc5b8, biblioteca: 0xc9a273,
};
const DIVISORIA = 0xf3efe8;

export function construir() {
  definirSemente(20261003);
  E.X1 = X1; E.ZN = ZN; E.ZS = ZS; E.X0 = XMIN_NUCLEO;
  E.ENTRADA_FORA = new THREE.Vector3(X1 + 1.2, 0, 0);
  E.larguraMaxima = X1 - XMIN_MAX;   // frustum fixo pela estação máxima (camera.js e cena.js)
  // mapa de caminhos com a largura máxima, criado uma vez (estacao.js remonta)
  E.mapa = new Mapa(XMIN_MAX - 0.5, X1 + 1.5, ZN, ZS2 + 0.5);
  iniciarEstacao();   // espinha, núcleo, mapa, salas lógicas e pegada

  // câmera olhando o centro da pegada (o núcleo fica centrado em x = 0)
  const { camera, controles } = E;
  const c = E.pegada.getCenter(new THREE.Vector3()).setY(0);
  camera.position.set(c.x + 30, 27, c.z + 30);
  camera.lookAt(c);
  controles.target.copy(c);
  controles.update();
  ajustarTela();
}

// ---------------------------------------------------------------------------
// Espinha
// ---------------------------------------------------------------------------
export function montarEspinha() {
  const W = X1 - XMIN_MAX;
  const prof = ZS - ZN;
  const esp = {
    base: caixa(W + 0.6, 0.7, prof + 0.6, COR.base, 0, -0.8, 0),
    faixa: caixa(W + 0.3, 0.12, prof + 0.3, 0xefe8dd, 0, -0.17, 0),
    corredor: caixa(W, 0.06, CORR * 2, 0xcfc6b8, 0, -0.06, 0, E.cena, { sombra: false }),
    passadeira: caixa(W - 2, 0.02, 1.0, 0x336699, 0, 0.006, 0, E.cena, { sombra: false }),
    // parede da ponta (esquerda): acompanha xMin sem esticar
    parede: caixa(0.2, ALT_PAREDE, prof + 0.2, 0xeee7dc, 0, 0, -0.1),
    rodape: rodape(-0.01, ZN, 0.01, ZS),
    larguras: { base: W + 0.6, faixa: W + 0.3, corredor: W, passadeira: W - 2 },
    _x: XMIN_NUCLEO,
  };
  Object.defineProperty(esp, 'xMin', {
    get() { return esp._x; },
    set(x) { esp._x = x; aplicarEspinha(esp, x); },
  });
  esp.xMin = XMIN_NUCLEO;
  // entrada no fim do corredor: só um capacho liso de fibra, fora da sombra da divisória
  capacho(X1 - 0.6, 0, true, 1.0, 0.5);
  return esp;
}

function aplicarEspinha(esp, x) {
  const esticar = (m, de, ate, larg) => { m.scale.x = Math.max(0.001, (ate - de) / larg); m.position.x = (de + ate) / 2; };
  esticar(esp.base, x - 0.3, X1 + 0.3, esp.larguras.base);
  esticar(esp.faixa, x - 0.15, X1 + 0.15, esp.larguras.faixa);
  esticar(esp.corredor, x, X1, esp.larguras.corredor);
  esticar(esp.passadeira, x + 1.5, X1 - 0.5, esp.larguras.passadeira);
  esp.parede.position.x = x - 0.1;
  esp.rodape.position.x = x + 0.01;
  E.sombraSuja = true;
  E.sujo = true;
}

// ---------------------------------------------------------------------------
// Perna B do U (v0.7): base, corredor, passadeira e o conector da curva na ponta oeste.
// Peças de tamanho 1 esticadas por escala; só aparecem com a estação dobrada.
// ---------------------------------------------------------------------------
let pecasU = null;
function criarPecasU() {
  const p = {
    base: caixa(1, 0.7, 1, COR.base, 0, -0.8, 0),
    faixa: caixa(1, 0.12, 1, 0xefe8dd, 0, -0.17, 0),
    corredorB: caixa(1, 0.06, CORR * 2, 0xcfc6b8, 0, -0.06, ZB, E.cena, { sombra: false }),
    passadeiraB: caixa(1, 0.02, 1.0, 0x336699, 0, 0.006, ZB, E.cena, { sombra: false }),
    conector: caixa(CORR * 2, 0.06, 1, 0xcfc6b8, 0, -0.06, 0, E.cena, { sombra: false }),
    passadeiraC: caixa(1.0, 0.02, 1, 0x336699, 0, 0.006, 0, E.cena, { sombra: false }),
    fimB: caixa(0.14, ALT_DIVISORIA, ZS2 - ZS, DIVISORIA, 0, 0, (ZS + ZS2) / 2),
  };
  for (const m of Object.values(p)) m.visible = false;
  return p;
}
export function atualizarDobra(esp, { ativo, xMin, xMaxB }) {
  if (!pecasU) { if (!ativo) return; pecasU = criarPecasU(); }
  for (const m of Object.values(pecasU)) m.visible = ativo;
  // a parede da ponta oeste vai até a frente da perna B quando há U
  esp.parede.scale.z = ativo ? (ZS2 - ZN + 0.2) / (ZS - ZN + 0.2) : 1;
  esp.parede.position.z = ativo ? (ZN + ZS2) / 2 - 0.1 * 0 : -0.1;
  if (!ativo) { E.sombraSuja = true; E.sujo = true; return; }
  const caixaX = (m, x0, x1) => { m.scale.x = Math.max(0.001, x1 - x0); m.position.x = (x0 + x1) / 2; };
  const caixaZ = (m, z0, z1) => { m.scale.z = Math.max(0.001, z1 - z0); m.position.z = (z0 + z1) / 2; };
  caixaX(pecasU.base, xMin - 0.3, Math.max(xMaxB, DOBRA_X) + 0.3); caixaZ(pecasU.base, ZS, ZS2 + 0.3);
  caixaX(pecasU.faixa, xMin - 0.15, Math.max(xMaxB, DOBRA_X) + 0.15); caixaZ(pecasU.faixa, ZS, ZS2 + 0.15);
  caixaX(pecasU.corredorB, DOBRA_X, xMaxB);
  caixaX(pecasU.passadeiraB, DOBRA_X - CORR, xMaxB - 0.5);
  pecasU.conector.position.x = xMin + CORR; caixaZ(pecasU.conector, -CORR, ZB + CORR);
  pecasU.passadeiraC.position.x = xMin + CORR; caixaZ(pecasU.passadeiraC, 0.5, ZB - 0.5);
  pecasU.fimB.position.x = xMaxB;
  E.sombraSuja = true;
  E.sujo = true;
}

// Estica ou encolhe a espinha até a nova ponta (0,9 s), sem mexer na porta
export function esticarEspinha(esp, xMin, { instantaneo = false } = {}) {
  if (instantaneo) { cancelarTweens('espinha'); esp.xMin = xMin; return; }
  tween({ obj: esp, prop: 'xMin', para: xMin, dur: 0.9, ease: 'easeOutCubic', chave: 'espinha' });
}

// Lado físico do módulo (na perna B do U o norte e o sul se invertem: layout.js
// monta com as medidas da perna A e estacao.js desloca o módulo depois)
const ladoGeo = m => m.ladoFisico || m.lado;

// ---------------------------------------------------------------------------
// Casca de um cômodo: piso de madeira, parede alta no fundo (só no norte),
// divisória baixa à esquerda e divisória do corredor com o vão da porta.
// porta = x local do centro do vão (null = sem porta, como no jardim).
// ---------------------------------------------------------------------------
function casca(m, { porta = 0, corPiso = COR.madeiraTampo, corParede = 0xeee7dc } = {}) {
  const g = m.grupo, w = m.x1 - m.x0, d = m.z1 - m.z0;
  // salas de pasta (Estúdio e módulos 'ilha') e a sala dos servidores (modular): piso
  // contínuo, para a sala fundida ser um piso só, sem emenda nem chanfro entre os
  // módulos (pedido do Eduardo, 03/10)
  const sala = m.tipo === 'estudio' || m.tipo === 'ilha' || m.tipo === 'servidores';
  m.laje.push(piso(w, d, corPiso, 0, m.cz, g, { continuo: sala, x0Mundo: m.x0 }));
  const norte = ladoGeo(m) === 'n';
  if (norte && !m.dz) {
    m.paredes.push(caixa(w, ALT_PAREDE, 0.2, corParede, 0, 0, ZN - 0.1, g));
    m.paredes.push(rodape(-w / 2, ZN, w / 2, ZN + 0.02, g));
  } else if (norte) {
    // perna B: as costas dão para as salas do sul da perna A; divisória baixa (parede
    // alta ali taparia a perna A na câmera)
    m.costas = caixa(w, ALT_DIVISORIA, 0.14, DIVISORIA, 0, 0, ZN + 0.07, g);
    m.paredes.push(m.costas);
  }
  m.divisoriaEsq = caixa(0.14, ALT_DIVISORIA, d, DIVISORIA, -w / 2, 0, m.cz, g);
  m.paredes.push(m.divisoriaEsq);
  const zp = norte ? -CORR : CORR;
  if (porta == null) {
    m.paredes.push(caixa(w, ALT_DIVISORIA, 0.14, DIVISORIA, 0, 0, zp, g));
    return;
  }
  const a = porta - VAO / 2 + w / 2, b = w / 2 - (porta + VAO / 2);
  if (a > 0.02) m.paredes.push(caixa(a, ALT_DIVISORIA, 0.14, DIVISORIA, -w / 2 + a / 2, 0, zp, g));
  if (b > 0.02) m.paredes.push(caixa(b, ALT_DIVISORIA, 0.14, DIVISORIA, w / 2 - b / 2, 0, zp, g));
  m.porta = { x: m.cx + porta, local: porta };
}

// Ordem de ocupação: as vagas mais perto da porta do cômodo vêm primeiro
function ordenarPelaPorta(vagas, portaX, portaZ, primeira = 0) {
  [...vagas]
    .sort((a, b) => (Math.abs(a.pos.z - portaZ) - Math.abs(b.pos.z - portaZ)) || (Math.abs(a.pos.x - portaX) - Math.abs(b.pos.x - portaX)) || (b.pos.x - a.pos.x))
    .forEach((v, i) => { v.ordem = primeira + i; });
}
const portaZDe = m => (ladoGeo(m) === 'n' ? -CORR - 0.7 : CORR + 0.7);

// Conjuntos de mesas por sessão (F2, "coworking modulado", 03/10). Cada sala de pasta
// tem, por vaga, DUAS colunas fixas (x local em xs); cada coluna são 2 mesas frente a
// frente com a divisória sálvia no meio: a de trás (rot π) com o astronauta de frente
// para a câmera, ordem 0; a da frente (rot 0), ordem 1. As colunas nascem recolhidas e
// brotam quando uma sessão precisa delas (estacao.js). Entre as duas colunas sobra um
// vão de 0,2 m; quando as duas são da mesma sessão, a ponte de divisória fecha o vão
// (um conjunto só). Cada coluna leva uma plaquinha com o nome da sessão (placaIlha
// pequena, na divisória), acesa só na primeira coluna de cada conjunto. Uma pendente por vaga, com
// a poça de luz no meio das duas colunas (acende quando alguma mesa é posto).
const COR_DIVISORIA_ILHA = 0x6f8f62;   // sálvia (uma cor só, VIS-05)
function montarColunas(m, xs, zc, assento) {
  const g = m.grupo;
  const colunas = xs.map((x, i) => {
    const cg = new THREE.Group();
    cg.position.set(x, 0, 0);   // filhos em x local da coluna e z do mundo
    cg.name = 'coluna';
    g.add(cg);
    const vagas = [[-0.5, Math.PI, 0], [0.5, 0, 1]].map(([dz, rot, ordem]) => {
      const v = mesaComputador(0, zc + dz, rot, COR.madeiraTampo, cg, { assento, segTampo: 3 });
      v.ordem = ordem;
      v.sala = 'coworking';
      return v;
    });
    caixa(1.45, 0.4, 0.06, COR_DIVISORIA_ILHA, 0, 0.75, zc, cg);
    // plaquinha com o nome da sessão dona do conjunto, na metade esquerda da divisória:
    // no centro, ficava na frente do capacete de quem senta atrás
    const placa = placaIlha(-0.15, zc, cg, { larg: 1.1 });
    return { i, x, zc, grupo: cg, vagas, placa };
  });
  // ponte de divisória entre as duas colunas (só aparece com as duas da mesma sessão)
  const xm = (xs[0] + xs[1]) / 2, vao = Math.abs(xs[1] - xs[0]) - 1.45;
  m.ponte = caixa(vao + 0.04, 0.4, 0.06, COR_DIVISORIA_ILHA, xm, 0.75, zc, g);
  m.ponte.userData.semMapa = true;   // o vão já fica fechado pelas mesas das duas colunas
  m.ponte.visible = false;
  const luz = pendente(xm, zc - 0.3, ALT_PAREDE, g, { base: 2.02, poca: { x: xm, z: zc, w: 3.6, d: 3.6 } });
  m.luzes.push({ pendente: luz, vagas: colunas.flatMap(c => c.vagas) });
  m.colunas = colunas;
  m.vagas.push(...colunas.flatMap(c => c.vagas));
  return colunas;
}

// Placa com o nome da pasta, uma por sala (estacao.js acende só no módulo-base).
// Um padrão só, nos dois lados (pedido do Eduardo, 03/10: "a gente não pode ter padrões
// diferentes para representar as mesmas coisas"): placa navy em cima da divisória do
// corredor, na entrada da sala, de frente para a câmera, à esquerda da porta.
// xPlaca: centro da placa (fora do vão da porta de cada tipo de sala).
function placaDaSala(m, xPlaca = -0.95) {
  const z = ladoGeo(m) === 'n' ? -CORR : CORR;
  const p = placaIlha(xPlaca, z, m.grupo, { topoDivisoria: ALT_DIVISORIA, larg: 1.6 });
  return { definir: texto => mostrarNaPlaca(p, texto), placa: p };
}

// ---------------------------------------------------------------------------
// Núcleo
// ---------------------------------------------------------------------------
// Estúdio (norte, vagas 2 e 3, 9,2 m): parede alta com janela e o letreiro com o nome
// da pasta dona da sala (antes, as letras fixas 'Módulo Claude'), as duas colunas de
// mesas da sala dessa pasta (crescendo para a vaga 4 sem divisória), mesa da janela
// (1 posto, sala 'pesquisa'), mesa do comandante (sempre apoio, não é vaga), estante e
// plantas.
export function montarEstudio(m) {
  const g = m.grupo;
  casca(m, { porta: 0.4, corPiso: PISO.estudio, corParede: 0xeee7dc });
  janela(2.5, 3.2, g);
  m.placaSala = placaDaSala(m, m.lado === 'n' ? -1.5 : -0.95);   // porta do estúdio em 0,4 (vão de -0,4 a 1,2)
  estante(-3.3, ZN + 0.25, 0, 2.0, {}, g);
  relogioParede(-3.3, 2.52, ZN, 0.17, g);
  quadroFundo(-1.0, 1.12, ZN, 0.9, 0.56, COR.areia, { moldura: COR.preto, arte: escolher(['horizonte', 'campo']), pai: g });
  planta(0.05, ZN + 0.6, 1.0, null, 'ficus', g);
  planta(4.15, -1.85, 1.0, null, 'folhaLarga', g);
  planta(-4.15, -1.85, 0.9, null, 'folhaLarga', g);
  const assento = escolher(ASSENTOS);
  montarColunas(m, [-2.9, -1.3], m.cz + 0.35, assento);
  // mesa da janela: a Pesquisa do núcleo (o primeiro que pesquisa senta aqui)
  const vp = mesaComputador(1.6, ZN + 0.9, 0, COR.madeiraTampo, g, { assento, luminaria: true });
  vp.sala = 'pesquisa';
  vp.ordem = 0;
  m.vagaPesquisa = vp;
  m.vagas.push(vp);
  // mesa do comandante: madeira média, banqueta guardada e caneca; a plaquinha com o
  // nome do dono fica na borda da frente (estacao.js)
  const vc = mesaComputador(3.45, ZN + 0.9, 0, COR.madeiraMedia, g, { assento });
  m.mesasExtras.push(vc);
  vc.definirCaneca?.(0xc98b6b);
  m.comandante = { mesa: vc, plaquinha: null, x: 3.45 + 0.3, y: 0.82, z: ZN + 0.9 + 0.33 };
  // fila de quem precisa de você (rodada 6): em frente à mesa do comandante, um atrás
  // do outro (0,9 m: a 0,8 os capacetes se encostavam na tela), em linha reta até
  // perto do corredor, alinhada às paredes (regra de 03/10: nada em diagonal). O
  // primeiro fica a cerca de 1 m da mesa, olhando para ela. 0,15 m à esquerda do
  // centro da mesa, para o último lugar não encostar na planta do canto. x local, z do
  // mundo; agentes.js confere cada lugar no mapa (corpo sólido).
  m.filaDef = { olharAlvo: { x: 3.3, z: ZN + 0.9 },
    pontos: [[3.3, -5.7], [3.3, -4.8], [3.3, -3.9], [3.3, -3.0], [3.3, -2.1]] };
}

// Revisão (rodada 6): quem terminou com uma sugestão espera aqui, em fila, a vez de
// você ler. Mesa de revisão com papéis e luminária, quadro de avisos com recados
// coloridos e as letras 'Revisão' na parede (no norte). A fila sai da frente da mesa
// em direção ao corredor, 0,9 m entre um e outro, longe da porta (à direita).
// No sul (lado norte cheio), a mesa fica na borda da frente e a fila sobe para o
// corredor, de frente para a câmera.
export function montarRevisaoModulo(m) {
  const g = m.grupo;
  const norte = m.lado === 'n';
  casca(m, { porta: 1.25, corPiso: PISO.revisao, corParede: 0xefe6d8 });
  const dz = norte ? 1 : -1;
  const zMesa = norte ? ZN + 0.75 : ZS - 0.75;
  const xMesa = -0.7;
  // mesa de revisão: tampo claro, pés de madeira média, papéis, caneca e luminária
  caixa(1.5, 0.06, 0.7, COR.madeiraClara, xMesa, 0.72, zMesa, g, { seg: 2 });
  for (const [lx, lz] of [[-0.66, -0.28], [0.66, -0.28], [-0.66, 0.28], [0.66, 0.28]]) caixa(0.05, 0.72, 0.05, COR.madeiraMedia, xMesa + lx, 0, zMesa + lz, g);
  const papeis = [[-0.35, 0.02, 0.12], [-0.3, -0.05, -0.2], [0.05, 0.04, 0.35], [0.12, -0.02, -0.08]];
  papeis.forEach(([lx, lz, rot], i) => {
    const folha = caixa(0.24, 0.006 + i * 0.002, 0.31, i % 2 ? 0xf7f3ea : 0xffffff, xMesa + lx, 0.78 + i * 0.004, zMesa + lz * dz, g, { seg: 0, sombra: false });
    folha.rotation.y = rot;
  });
  caneca(g, xMesa + 0.5, 0.78, zMesa + 0.12 * dz, 0x7d8fb3);
  luminariaMesa(g, xMesa - 0.6, 0.78, zMesa - 0.18 * dz, norte ? 0.5 : Math.PI - 0.5);
  if (norte) {
    janela(1.35, 1.4, g);
    placaParede('Revisão', -0.7, 1.6, '#2a2e45', g);
    // quadro de avisos com recados coloridos (papel, sem texto)
    const quadro = quadroFundo(-0.7, 1.05, ZN, 1.1, 0.62, 0xd9c3a0, { moldura: COR.madeiraMedia, pai: g });
    [[-0.38, 0.42, 0x0038ef], [-0.1, 0.5, 0xee4c01], [0.2, 0.4, 0xf2d27a], [0.38, 0.2, 0x9cbf95], [-0.25, 0.16, 0xf7f3ea], [0.05, 0.22, 0xf2d27a]]
      .forEach(([lx, ly, cor]) => caixa(0.15, 0.15, 0.01, cor, lx, ly, 0.045, quadro, { seg: 0, sombra: false }));
  }
  planta(1.9, norte ? ZN + 0.6 : ZS - 0.5, 1.0, null, 'folhaLarga', g);
  planta(-1.9, norte ? ZN + 0.6 : ZS - 0.5, 0.85, COR.terracota, 'ficus', g);
  // fila: o primeiro a 1,2 m da mesa, olhando para ela; os outros atrás, a 0,9 m, até
  // perto do corredor (5 lugares)
  const z0 = zMesa + dz * 1.2;
  m.filaDef = { olharAlvo: { x: xMesa, z: zMesa }, pontos: Array.from({ length: 5 }, (_, k) => [xMesa, z0 + dz * 0.9 * k]) };
}

// Sala de estar (descanso do núcleo e módulo de descanso): sofá de 3 virado para a
// câmera, poltrona, mesinha a 1 m do sofá (sobra uma faixa andável para quem senta
// e levanta), tapete (o único da estação), aparador e 3 pontos em pé (na frente,
// no aparador e em frente à mesinha).
// No sul (o normal), o sofá fica de costas para o corredor. No norte (lado sul
// cheio), fica de costas para a parede do fundo, embaixo de uma janela, e o
// aparador vai para o canto do fundo (longe da porta).
function salaDeEstar(m, { nucleo }) {
  const g = m.grupo;
  const norte = m.lado === 'n';
  casca(m, { porta: -1.0, corPiso: PISO.descanso });
  // z de cada peça: no sul a partir do corredor; no norte a partir da parede do fundo
  const P = norte
    ? { sofa: ZN + 0.75, poltrona: -5.2, mesinha: -5.45, aparador: -6.9, planta: -1.8, frente: -2.4, mesinhaPonto: -4.45 }
    : { sofa: CORR + 0.75, poltrona: 4.0, mesinha: 3.75, aparador: 6.3, planta: ZS - 0.6, frente: nucleo ? ZS - 0.95 : ZS - 1.2, mesinhaPonto: 4.8 };
  if (norte) janela(1.0, 1.8, g);
  // sofá de 3 com só os dois lugares das pontas (1,5 m entre eles): os do meio ficavam a
  // 0,75 e os capacetes (0,84) se sobrepunham na tela (regra de 03/10: 0,85 m)
  m.vagas.push(...sofa(1.0, P.sofa, 0, 3, 0x9cbf95, g).filter((_, i) => i !== 1));
  // cantos de descompressão (aprovados em 03/10), só no sul (o normal): no Descanso do
  // núcleo, fliperama no lugar do aparador e meditação na frente; no descanso extra,
  // videogame no lugar do aparador e ioga na frente
  const cantos = norte ? [] : nucleo
    ? [['fliperama', -1.55, P.aparador, Math.PI / 2], ['meditacao', 0.7, 6.95, 0]]
    : [['videogame', -1.38, 6.45, Math.PI / 2], ['ioga', 0.95, 6.95, 0]];
  // poltrona virada para a mesinha, encostada na parede (x -1,6). No sul a mesinha fica
  // 0,35 m mais à direita (F2, capacete de 0,85 m): entre a poltrona e a mesinha sobra
  // uma passagem de 1,9 m, onde dois astronautas se cruzam sem se travar, e não sobra
  // bolso sem saída entre a mesinha e a borda
  m.vagas.push(...sofa(-1.6, P.poltrona, Math.PI / 2, 1, 0x8fb4a8, g));
  const xm = norte ? 1.0 : 1.35;
  caixa(1.1, 0.38, 0.6, COR.madeiraClara, xm, 0, P.mesinha, g);          // mesinha
  planta(xm + 0.25, P.mesinha - 0.05, 1.2, COR.terracota, 'suculenta', g, 0.38);
  caixa(0.24, 0.04, 0.17, COR.azulCinza, xm - 0.2, 0.38, P.mesinha + 0.05, g, { seg: 0 }).rotation.y = 0.35;
  tapete(xm - 0.45, P.mesinha + 0.05, 3.0, 2.2, 0x9db08f, g);
  if (norte) aparador(-2.0, P.aparador, Math.PI / 2, 1.3, g);
  if (norte || nucleo) planta(1.95, P.planta, 1.1, null, 'folhaLarga', g);
  m.cantos = [];
  for (const [tipo, x, z, rot] of cantos) {
    const c = criarCanto(tipo);
    c.grupo.position.set(x, 0, z);
    c.grupo.rotation.y = rot;   // só 0 ou 90 graus: alinhado às paredes
    g.add(c.grupo);
    c.atualizarLugares();
    for (const l of c.lugares) {
      // lugar de descanso reservável (um astronauta por lugar), no formato das vagas:
      // chega e sai por trás (acessoAtras) e olha para a peça (olharFixo)
      l.cantoObj = c;
      l.acessoAtras = true;
      l.olharFixo = true;
      m.vagas.push(l);
    }
    m.cantos.push(c);
  }
  if (nucleo) {
    // parapeito baixo na borda da frente (nunca parede alta no sul)
    m.paredes.push(caixa(4.3, 0.42, 0.12, DIVISORIA, 0.1, 0, ZS - 0.12, g));
    // luminária de pé sempre acesa, com a poça sobre a poltrona
    m.luminaria = luminariaPe(-1.95, 3.15, g, { poca: { dx: 0.6, dz: 0.6, tam: 1.8 } });
  }
  m.pontosEmPe = [
    { pos: new THREE.Vector3(m.cx + 0.5, 0, P.frente), olhar: 0 },              // na frente, olhando para fora
    { pos: new THREE.Vector3(m.cx - 1.2, 0, P.aparador), olhar: -Math.PI / 2 },  // no aparador
    { pos: new THREE.Vector3(m.cx + 1.0, 0, P.mesinhaPonto), olhar: Math.PI },   // em frente à mesinha
  ].filter((_, i) => norte || i === 2);   // no sul, a frente e o aparador viraram cantos
  // no sul, dois pontos em pé entre a mesinha e os cantos (longe dos assentos, dos
  // acessos e das peças dos cantos): sem eles o descanso cheio se amontoava na frente do sofá
  // (F2: a 1,1 m ou mais um do outro, o espaço dos lugares em pé com o capacete de 0,85 m)
  if (!norte) m.pontosEmPe.push({ pos: new THREE.Vector3(m.cx + 0.05, 0, 5.45), olhar: 0 }, { pos: new THREE.Vector3(m.cx + 1.7, 0, 5.7), olhar: 0 });
  for (const v of m.vagas) v.sala = 'descanso';
}

export function montarDescansoNucleo(m) { salaDeEstar(m, { nucleo: true }); }

// Módulo de enchimento ('jardim' para a estação): completa o retângulo quando um lado
// do corredor fica mais curto. Desde 03/10 (pedido do Eduardo: "o espaço que a gente
// não usa profissionalmente é onde a gente tem a descompressão") ele sorteia, estável
// pela vaga e sem repetir o vizinho, entre jardim de verdade, sala de ioga, sala de
// fliperama e parquinho. Só os de verdade têm porta (o jardim é aberto, sem porta).
// No norte, a parede alta ganha uma janela.
const ENCHIMENTOS = ['jardim', 'ioga', 'fliperama', 'parque'];
export function tipoDeEnchimento(m) { return ENCHIMENTOS[(m.vaga * 3 + (m.lado === 'n' ? 1 : 0)) % ENCHIMENTOS.length]; }

export function montarJardim(m) {
  const g = m.grupo;
  const tipo = tipoDeEnchimento(m);
  m.enchimento = tipo;
  const norte = ladoGeo(m) === 'n';
  casca(m, { porta: tipo === 'jardim' ? null : 1.35, corPiso: tipo === 'ioga' ? 0xd9ccb4 : tipo === 'fliperama' ? 0xc8bfd6 : tipo === 'parque' ? 0xc9d4b0 : PISO.jardim });
  if (norte && !m.dz) janela(0, 1.6, g);
  // cantos de descompressão encostados no fundo (norte) ou na frente (sul), alinhados às paredes
  const cantos = [];
  const porCanto = (tipoCanto, x) => {
    const c = criarCanto(tipoCanto);
    const z = norte ? m.z0 + 0.25 - c.pegada.z0 : m.z1 - 0.3 - c.pegada.z1;
    c.grupo.position.set(x, 0, z);
    g.add(c.grupo);
    c.atualizarLugares();
    cantos.push(c);
    return c;
  };
  const zc = norte ? m.cz - 0.4 : m.cz + 0.4;
  if (tipo === 'jardim') {
    canteiro(-0.25, zc, 3.0, 1.7, g);
    luminariaJardim(1.7, zc + (norte ? 1.35 : -1.35), g);
  } else if (tipo === 'ioga') {
    porCanto('ioga', -1.35); porCanto('ioga', -0.05); porCanto('meditacao', 1.4);
    planta(-1.95, norte ? m.z1 - 0.6 : m.z0 + 0.6, 1.0, COR.terracota, 'folhaLarga', g);
  } else if (tipo === 'fliperama') {
    porCanto('fliperama', -1.7); porCanto('fliperama', -0.75); porCanto('videogame', 1.05);
    tapete(0, zc, 3.6, 2.0, 0x8f86b0, g);
  } else {
    // parquinho: escorregador, balanço e caixa de areia, com grama clara
    const zP = zc;
    // escorregador: escada à esquerda, rampa descendo para a direita (alinhado ao eixo x)
    caixa(0.5, 1.1, 0.5, 0xee4c01, -1.6, 0, zP, g);
    caixa(0.6, 0.05, 0.6, 0xf3efe8, -1.6, 1.1, zP, g);
    const rampa = caixa(1.6, 0.06, 0.5, 0x0038ef, -0.85, 0.55, zP, g);
    rampa.rotation.z = -0.62;
    // balanço: duas colunas e a travessa, dois assentos pendurados
    for (const dx of [0.35, 1.75]) caixa(0.08, 1.7, 0.08, 0x3a3f4f, dx, 0, zP + (norte ? 1.3 : -1.3), g);
    caixa(1.5, 0.08, 0.08, 0x3a3f4f, 1.05, 1.66, zP + (norte ? 1.3 : -1.3), g);
    for (const dx of [0.75, 1.35]) {
      for (const dd of [-0.1, 0.1]) cilindro(0.008, 0.008, 1.1, 0x6b6f7a, dx + dd, 0.55, zP + (norte ? 1.3 : -1.3), g, 6);
      caixa(0.32, 0.04, 0.18, 0xf2c14e, dx, 0.53, zP + (norte ? 1.3 : -1.3), g);
    }
    // caixa de areia
    caixa(1.3, 0.14, 1.0, COR.madeiraClara, 1.0, 0, zP + (norte ? -0.6 : 0.6), g);
    caixa(1.18, 0.02, 0.88, 0xe9d7a8, 1.0, 0.13, zP + (norte ? -0.6 : 0.6), g, { sombra: false });
    planta(-1.9, zP + (norte ? 1.5 : -1.5), 1.1, null, 'ficus', g);
  }
  m.cantos = cantos;
}

// ---------------------------------------------------------------------------
// Módulos
// ---------------------------------------------------------------------------
// Sala de pasta (F2): duas colunas encostadas à esquerda (x local -1,5 e 0,1) e um
// corredor de 1,5 m à direita, na linha da porta, que dá a volta por trás das mesas
// (com a sala cheia, dois se cruzam nele sem se travar). Sem divisória entre módulos da
// mesma pasta, os corredores e os fundos se juntam numa sala só. Parede do fundo sempre no mesmo tom (a emenda entre dois módulos não
// aparece). No norte: janela à direita (sobre o corredor) e letreiro da pasta; no sul,
// placa da pasta na divisória do corredor.
export function montarIlhaModulo(m) {
  const g = m.grupo;
  const norte = ladoGeo(m) === 'n';
  casca(m, { porta: 1.52, corPiso: PISO.ilha, corParede: 0xeee7dc });
  if (norte && !m.dz) janela(1.6, 1.0, g);
  const zCanto = norte ? ZN + 0.6 : ZS - 0.6;
  planta(1.85, zCanto, 0.9, null, 'folhaLarga', g);
  planta(-1.85, zCanto, 1.0, null, 'ficus', g);
  montarColunas(m, [-1.5, 0.1], m.cz + (norte ? 0.35 : -0.35), escolher(ASSENTOS));
  m.placaSala = placaDaSala(m, -0.95);
}

// Sala MCP ou API: 4 mesas em duas fileiras viradas para a TV. A TV mostra 'MCP'
// ou 'API' e o monitor de cada posto, o nome do serviço em uso. As fileiras ficam
// a 2,2 m (cabe o acesso por trás da banqueta da primeira) e encostadas na
// divisória da esquerda, com um corredor de 1,5 m à direita, na linha da porta,
// onde dois astronautas se cruzam sem se travar (com as mesas centradas sobravam
// 0,3 m de cada lado; com 0,9 m o corredor era de mão única). No sul a TV fica junto ao corredor; no
// norte, na parede do fundo; nos dois casos virada para a câmera.
export function montarSalaServico(m, tipo) {
  const g = m.grupo;
  const norte = m.lado === 'n';
  casca(m, { porta: 1.35, corPiso: PISO[tipo] });
  const zTv = norte ? ZN + 0.55 : CORR + 0.55;
  const z1 = zTv + 1.75, z2 = z1 + 2.2;
  const assento = escolher(ASSENTOS);
  for (const [px, z] of [[-1.5, z1], [0, z1], [-1.5, z2], [0, z2]]) {
    const v = mesaComputador(px, z, 0, COR.madeiraTampo, g, { assento });
    v.sala = tipo;
    m.vagas.push(v);
  }
  ordenarPelaPorta(m.vagas, m.porta.x, portaZDe(m));
  planta(1.9, norte ? ZN + 0.6 : ZS - 0.45, 0.8 + aleatorio() * 0.4, escolher([COR.terracota, COR.offWhite, COR.pretoFosco]), 'folhaLarga', g);
  // pendente acima da altura dos capacetes e fora da frente deles na câmera isométrica
  const luz = pendente(-0.3, z1 + 0.8, ALT_PAREDE, g, { base: 2.02, poca: { x: -0.5, z: z1 + 1.1, w: 3.4, d: 3.6 } });
  m.luzes.push({ pendente: luz, vagas: m.vagas });
  m.tv = tvCowork(m, -1.0, zTv, g);
}

// Pesquisa extra: 3 mesas. No norte, na janela, viradas para a parede do fundo;
// no sul (lado norte cheio), na borda da frente, viradas para a câmera.
export function montarPesquisaModulo(m) {
  const g = m.grupo;
  const norte = m.lado === 'n';
  casca(m, { porta: 0, corPiso: PISO.pesquisa, corParede: 0xd9e2f5 });
  if (norte) janela(0, 2.8, g);
  const zMesa = norte ? ZN + 0.9 : ZS - 0.9, rot = norte ? 0 : Math.PI;
  const assento = escolher(ASSENTOS);
  [[0, 1], [-1.5, 2], [1.5, 3]].forEach(([x, ordem], i) => {
    const v = mesaComputador(x, zMesa, rot, COR.madeiraTampo, g, { assento, luminaria: i === 1 });
    v.sala = 'pesquisa';
    v.ordem = ordem;   // a mesa da janela do Estúdio é a 0
    m.vagas.push(v);
  });
  const dz = norte ? 1 : -1;
  const luz = pendente(0.6, zMesa + dz * 0.8, ALT_PAREDE, g, { base: 1.95, poca: { x: 0, z: zMesa + dz * 0.4, w: 3.8, d: 1.9 } });
  m.luzes.push({ pendente: luz, vagas: m.vagas });
  planta(1.9, norte ? -1.85 : 1.85, 1.0, null, 'ficus', g);
}

export function montarDescansoModulo(m) { salaDeEstar(m, { nucleo: false }); }

// Sala de controle (Sala Anthropic ou Sala OpenAI). No sul o mural fica junto do
// corredor e deixa o vão da porta livre (x local de 0,55 a 2,15); no norte o mural
// encosta na parede do fundo e não há porta (a frente do cômodo tem plantas).
// O operador é NPC (userData.npc): não entra no mapa nem na lotação.
export function montarSalaControleModulo(m, provedor) {
  const g = m.grupo;
  const norte = m.lado === 'n';
  casca(m, { porta: 1.35, corPiso: PISO['controle-' + provedor] ?? PISO.mcp,
    corParede: provedor === 'openai' ? 0xe6e7e8 : 0xeee3d3 });
  const sala = montarSalaControle(provedor, { lado: m.lado, escala: 1.45 });
  sala.position.z = m.cz;
  g.add(sala);
  m.controle = sala;
  m.semAcesso = true;
}

// ---------------------------------------------------------------------------
// Salas novas (F1-SALAS-E-VIDA, 03/10)
// ---------------------------------------------------------------------------
// Cada sala vem de app/sala-*.js num grupo próprio, em coordenadas locais do módulo
// (x de -2,3 a 2,3; z de -3,4 a 3,4 com o fundo em -3,4) e sem piso nem paredes: aqui
// entram a casca (piso na cor da sala, parede alta no norte, divisórias), o grupo na
// profundidade do cômodo e, nas salas com astronautas (oficina e biblioteca), as vagas
// em coordenadas de mundo. As outras (servidores, portaria, despacho, missão) são só
// dos NPCs: m.semAcesso, o cômodo inteiro vira bloco no mapa de caminhos.
// porta: x local do vão na divisória do corredor (null = sem vão). Toda sala tem porta
// (pedido do Eduardo, 03/10: "tem umas salas que não têm porta"), mesmo as só de NPC. No despacho o vão
// é a porta de embarque por onde o viajante sai (ninguém entra: o módulo é bloco).
// Servidores é modular (F2): a base (núcleo) e as extensões (m.extensao), sem porta e
// fundidas com ela (estacao.js), onde ficam os racks que não cabem na base.
const SALAS_NOVAS = {
  servidores: { parede: 0xe9ebef, porta: 1.35,
    montar: m => (m.extensao ? montarModuloServidoresExtensao({ xMundo: m.cx }) : montarModuloServidores({ lado: m.lado, xMundo: m.cx })) },
  portaria: { parede: 0xece6dc, porta: 1.35, montar: () => montarModuloPortaria() },
  despacho: { parede: 0xeee6da, porta: 1.35, montar: () => montarSalaDespacho({ modulo: true }) },
  missao: { parede: 0xece6dc, porta: 1.35, montar: () => montarModuloMissao() },
  oficina: { parede: 0xece4d6, porta: 1.35, montar: () => montarModuloOficina(), acesso: true },
  biblioteca: { parede: 0xefe6d6, porta: 1.35, montar: () => montarModuloMemoria(), acesso: true },
};

export function montarSalaNova(m) {
  const def = SALAS_NOVAS[m.tipo];
  // extensão da sala dos servidores: sem porta (a sala fundida tem uma só, a da base)
  const porta = m.tipo === 'servidores' && m.extensao ? null : def.porta;
  casca(m, { porta, corPiso: PISO[m.tipo], corParede: def.parede });
  if (porta == null) m.porta = null;
  const sala = def.montar(m);
  sala.grupo.position.z = m.cz;
  m.grupo.add(sala.grupo);
  m.salaNova = sala;
  if (!def.acesso) { m.semAcesso = true; return; }
  // vagas da sala lógica: posição de mundo com o módulo no lugar final (estacao.js
  // guarda o local de cada uma em v.localModulo)
  for (const v of sala.vagas || []) {
    v.pos = new THREE.Vector3(m.grupo.position.x + v.pos.x, 0, m.cz + v.pos.z);
    v.sala = m.tipo;
    m.vagas.push(v);
  }
}
