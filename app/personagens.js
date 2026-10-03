// Estilos de personagem do escritório. Cada função devolve um THREE.Group.
// Altura de referência: ~1.1 unidades (o escritório aplica a escala, hoje 1,45).
//
// CONTRATO (rodada 1 da reforma, v0.5)
// - boneco.userData.animar(t, modo, sentado = false, opc = {})
//     t        segundos (relógio da página)
//     modo     'andar' | 'digitar' | 'esperar' | 'descansar'
//              e os novos: 'entregar' (espreguiçar de ~1,6 s ao terminar a tarefa;
//              chamar continuamente, a contagem começa quando o modo muda),
//              'pausa' (sentado no sofá descansando; já dobra as pernas),
//              'conversar' (em pé, virado para outro, gesticula leve) e
//              'parado' (sem digitar, para quando não há conexão).
//     sentado  pernas dobradas no assento (vale para todos os modos menos 'andar')
//     opc      { dt, fase, passo, atividade }
//       dt        segundos desde o quadro anterior (sem dt, usa 1/60)
//       fase      radianos, deslocamento por agente, para ninguém andar,
//                 digitar ou respirar em sincronia
//       passo     radianos acumulados de passada. Se ausente, usa t × 10 (como antes).
//                 Para o pé não patinar, avance passo += distância / 0,39 × π
//                 (0,39 = comprimento útil da passada na escala 1,45; em outra
//                 escala, 0,39 × escala / 1,45).
//       atividade 'editar' | 'pesquisar' | 'conector' | 'esperar' | 'descansar' | 'coordenar'
//   Sem o 4º argumento, tudo funciona como antes (vitrine.html e main.js atuais).
// - As poses se misturam: cada articulação persegue a pose-alvo com
//   atual += (alvo - atual) × (1 - exp(-dt × 12)). Para não amortecer os
//   balanços (andar, digitar), a mistura é feita sobre a diferença na troca
//   de modo, que decai nesse mesmo ritmo: troca completa em ~0,25 s.
// - Encaixe sentado: o y certo do boneco é topoAssento - 0,30 × escala
//   (banqueta 0,51 e sofá 0,54; o main ajusta na rodada 2).
// - userData.definirLed(estado): 'trabalho' | 'descanso' | 'esperar' | 'apagado'.
//   null volta ao automático (o LED segue o modo; é o padrão).
// - userData.olhos (2 meshes), userData.luzAntena, userData.viseira, userData.halo.
// - userData.definirCorOlhos(cor, emissive): troca a cor base dos olhos.
// - userData.definirCorLuz(cor, emissive): troca a cor da luz da antena (fora do 'esperar').
// - definirProvedor(boneco, provedor): olhinhos e luz da antena na cor do provedor
//   (CORES_PROVEDOR: 'anthropic' coral/terracota, 'openai' verde), mantendo a cor do
//   agente no traje (mochila, cinto, braçadeiras e gola). O 'esperar' continua laranja.
// - userData.hitbox: cilindro invisível de acerto para o hover (raio 0,4, altura 1,3).
// - userData.liberar(): dispose só dos materiais exclusivos do boneco
//   (viseira, olhos, luz da antena e halo). Geometrias são compartilhadas
//   entre todos os bonecos (cache geo) e nunca recebem dispose.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const PELES = [0xf2c9a5, 0xd9a67e, 0xa8714a, 0x7a4a2e, 0xf6dcc4];
export const CABELOS = [0x2b2118, 0x5a3a22, 0xc58b3c, 0x1d1d24, 0x9c3f2a, 0xd9d0c4];

const LARANJA = 0xee4c01;
const REFLEXO_TELA = 0x6ea8ff;

// Cor do provedor nos olhinhos e na luz da antena. O coral fica bem longe do laranja
// #ee4c01 (mais claro e rosado), que é o sinal de "esperando você".
export const CORES_PROVEDOR = {
  anthropic: { olhos: 0xffd2bf, brilhoOlhos: 0xf2906f, luz: 0xe8896a },
  openai: { olhos: 0xbff5d6, brilhoOlhos: 0x3fcf8e, luz: 0x37c486 },
};
export function definirProvedor(boneco, provedor) {
  const c = CORES_PROVEDOR[provedor];
  if (!c || !boneco?.userData) return;
  boneco.userData.definirCorOlhos?.(c.olhos, c.brilhoOlhos);
  boneco.userData.definirCorLuz?.(c.luz, c.luz);
  boneco.userData.provedor = provedor;
}

// Materiais compartilhados por cor + parâmetros
const cache = new Map();
function mat(cor, extra = {}) {
  const k = cor + JSON.stringify(extra);
  if (!cache.has(k)) cache.set(k, new THREE.MeshStandardMaterial({ color: cor, roughness: 0.6, ...extra }));
  return cache.get(k);
}

// Geometrias compartilhadas por tipo + parâmetros (+ transformação opcional no fim:
// { girarY, escala: [x, y, z] }). Ex.: geo('capsula', 0.075, 0.12, 4, 12).
// Nenhuma geometria daqui recebe dispose: todos os bonecos usam as mesmas.
const cacheGeo = new Map();
const CONSTRUTORES = {
  capsula: (...p) => new THREE.CapsuleGeometry(...p),
  esfera: (...p) => new THREE.SphereGeometry(...p),
  toro: (...p) => new THREE.TorusGeometry(...p),
  cilindro: (...p) => new THREE.CylinderGeometry(...p),
  cone: (...p) => new THREE.ConeGeometry(...p),
  caixaR: (...p) => new RoundedBoxGeometry(...p),
};
function geo(tipo, ...params) {
  const transf = params.length && typeof params[params.length - 1] === 'object' ? params.pop() : null;
  const k = tipo + '|' + params.join('|') + (transf ? '|' + JSON.stringify(transf) : '');
  let g = cacheGeo.get(k);
  if (!g) {
    g = CONSTRUTORES[tipo](...params);
    if (transf?.girarY) g.rotateY(transf.girarY);
    if (transf?.escala) g.scale(...transf.escala);
    g.userData.compartilhada = true;
    cacheGeo.set(k, g);
  }
  return g;
}

// exclusivo = true: material clonado só para este boneco (muda por agente)
function malha(geometria, cor, x, y, z, pai, extra, exclusivo = false) {
  const material = exclusivo ? mat(cor, extra).clone() : mat(cor, extra);
  const m = new THREE.Mesh(geometria, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  pai.add(m);
  return m;
}
// Pivô: um grupo posicionado na articulação, para girar braço/perna pelo ombro/quadril
function pivo(pai, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  pai.add(g);
  return g;
}
function variacao(h) {
  return { pele: PELES[h % PELES.length], cabelo: CABELOS[(h >> 3) % CABELOS.length], penteado: (h >> 6) % 3 };
}

// Halo do LED: textura radial única, criada na primeira vez (canvas no navegador,
// DataTexture fora dele, para os testes em node)
let texturaHalo = null;
function obterTexturaHalo() {
  if (texturaHalo) return texturaHalo;
  const N = 64;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const gr = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, N, N);
    texturaHalo = new THREE.CanvasTexture(c);
    texturaHalo.colorSpace = THREE.SRGBColorSpace;
  } else {
    const d = new Uint8Array(N * N * 4);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const r = Math.min(1, Math.hypot(i - N / 2, j - N / 2) / (N / 2));
      const o = (i * N + j) * 4;
      d[o] = d[o + 1] = d[o + 2] = 255;
      d[o + 3] = Math.round(255 * (1 - r) * (1 - r));
    }
    texturaHalo = new THREE.DataTexture(d, N, N);
    texturaHalo.needsUpdate = true;
  }
  return texturaHalo;
}

// Hitbox de acerto para o hover: material único e invisível (não aparece nem faz sombra,
// mas o Raycaster do three r180 acerta, porque Mesh.raycast não olha visible)
const MAT_HITBOX = new THREE.MeshBasicMaterial({ visible: false });
function finalizarBoneco(g, exclusivos = []) {
  const hb = new THREE.Mesh(geo('cilindro', 0.4, 0.4, 1.3, 12), MAT_HITBOX);
  hb.position.y = 0.65;
  hb.castShadow = hb.receiveShadow = false;
  hb.userData.hitbox = true;
  g.add(hb);
  g.userData.hitbox = hb;
  let liberado = false;
  g.userData.liberar = () => {
    if (liberado) return;
    liberado = true;
    for (const m of new Set(exclusivos)) m.dispose();
  };
  return g;
}

// ---------------------------------------------------------------------------
// A) Chibi: cabeça grande, corpo pequeno, braços e pernas curtinhos
// ---------------------------------------------------------------------------
export function criarChibi(cor, h = 1) {
  const v = variacao(h);
  const g = new THREE.Group();
  const corpo = pivo(g, 0, 0, 0);

  // pernas
  const pernas = [-0.08, 0.08].map(px => {
    const p = pivo(corpo, px, 0.3, 0);
    malha(geo('capsula', 0.065, 0.14, 4, 10), 0x2f3550, 0, -0.12, 0, p);
    malha(geo('esfera', 0.075, 12, 8, { escala: [1, 0.6, 1.35] }), 0x2b2b33, 0, -0.25, 0.03, p);
    return p;
  });
  // tronco (camiseta na cor do agente)
  malha(geo('capsula', 0.17, 0.16, 6, 16), cor, 0, 0.42, 0, corpo);
  // braços
  const bracos = [-1, 1].map(lado => {
    const b = pivo(corpo, lado * 0.19, 0.52, 0);
    malha(geo('capsula', 0.05, 0.14, 4, 10), cor, 0, -0.1, 0, b);
    malha(geo('esfera', 0.055, 12, 8), v.pele, 0, -0.21, 0, b);
    b.rotation.z = lado * 0.15;
    return b;
  });
  // cabeça grande
  const cabeca = pivo(corpo, 0, 0.78, 0);
  malha(geo('esfera', 0.27, 28, 20, { escala: [1, 0.94, 0.95] }), v.pele, 0, 0, 0, cabeca);
  if (v.penteado === 0) {
    malha(geo('esfera', 0.285, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), v.cabelo, 0, 0.02, -0.02, cabeca).rotation.x = -0.3;
  } else if (v.penteado === 1) {
    malha(geo('esfera', 0.285, 28, 14, 0, Math.PI * 2, 0, Math.PI / 1.7), v.cabelo, 0, 0.02, -0.03, cabeca).rotation.x = -0.45;
    malha(geo('esfera', 0.11, 14, 10), v.cabelo, 0, 0.2, -0.2, cabeca);   // coque
  } else {
    malha(geo('esfera', 0.285, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2.3), v.cabelo, 0, 0.03, 0, cabeca).rotation.x = -0.2;
    malha(geo('capsula', 0.1, 0.25, 4, 10), v.cabelo, 0, -0.1, -0.2, cabeca);  // rabo
  }
  // rosto
  for (const px of [-0.09, 0.09]) {
    malha(geo('esfera', 0.035, 12, 10, { escala: [1, 1.25, 0.6] }), 0x1a1a22, px, -0.01, 0.245, cabeca);
    malha(geo('esfera', 0.012, 8, 6), 0xffffff, px + 0.012, 0.015, 0.265, cabeca, { emissive: 0xffffff, emissiveIntensity: 0.4 });
    malha(geo('esfera', 0.035, 10, 8, { escala: [1.3, 0.7, 0.4] }), 0xf08a8a, px * 1.55, -0.08, 0.22, cabeca, { transparent: true, opacity: 0.55 });
  }
  malha(geo('toro', 0.035, 0.01, 6, 12, Math.PI), 0x6b2a2a, 0, -0.09, 0.25, cabeca).rotation.z = Math.PI;

  Object.assign(g.userData, animadorPadrao({ corpo, pernas, bracos, cabeca, semente: h }));
  return finalizarBoneco(g);
}

// ---------------------------------------------------------------------------
// B) Bonequinho de montar: tronco trapézio, mãos em C, cabeça cilíndrica
// ---------------------------------------------------------------------------
export function criarMontar(cor, h = 1) {
  const v = variacao(h);
  const g = new THREE.Group();
  const corpo = pivo(g, 0, 0, 0);
  const pernas = [-0.075, 0.075].map(px => {
    const p = pivo(corpo, px, 0.36, 0);
    malha(geo('caixaR', 0.14, 0.34, 0.17, 3, 0.03), 0x2f3550, 0, -0.17, 0.01, p);
    return p;
  });
  malha(geo('caixaR', 0.32, 0.06, 0.18, 3, 0.02), 0x2f3550, 0, 0.38, 0, corpo);
  const tronco = geo('cilindro', 0.13, 0.17, 0.34, 4, 1, { girarY: Math.PI / 4, escala: [1.15, 1, 0.62] });
  malha(tronco, cor, 0, 0.58, 0, corpo, { flatShading: true });
  const bracos = [-1, 1].map(lado => {
    const b = pivo(corpo, lado * 0.17, 0.7, 0);
    malha(geo('capsula', 0.045, 0.16, 4, 10), cor, lado * 0.02, -0.1, 0, b);
    malha(geo('toro', 0.035, 0.016, 8, 14, Math.PI * 1.5), 0xf2d34a, lado * 0.03, -0.24, 0.02, b).rotation.x = Math.PI / 2;
    b.rotation.z = lado * 0.12;
    return b;
  });
  malha(geo('cilindro', 0.05, 0.05, 0.05, 16), 0xf2d34a, 0, 0.77, 0, corpo);
  const cabeca = pivo(corpo, 0, 0.9, 0);
  malha(geo('caixaR', 0.24, 0.24, 0.24, 4, 0.1), 0xf2d34a, 0, 0, 0, cabeca);
  malha(geo('cilindro', 0.06, 0.06, 0.05, 16), 0xf2d34a, 0, 0.14, 0, cabeca);
  // cabelo de encaixar
  malha(geo('esfera', 0.155, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.2, { escala: [1, 0.85, 1] }), v.cabelo, 0, 0.06, -0.01, cabeca);
  for (const px of [-0.05, 0.05]) malha(geo('esfera', 0.018, 8, 8), 0x1a1a22, px, 0.01, 0.12, cabeca);
  malha(geo('toro', 0.04, 0.008, 6, 12, Math.PI), 0x1a1a22, 0, -0.03, 0.12, cabeca).rotation.z = Math.PI;
  Object.assign(g.userData, animadorPadrao({ corpo, pernas, bracos, cabeca, rigido: true, semente: h }));
  return finalizarBoneco(g);
}

// ---------------------------------------------------------------------------
// C) Feijão: corpo e cabeça numa peça só, olhos grandes, mãozinhas soltas
// ---------------------------------------------------------------------------
export function criarFeijao(cor, h = 1) {
  const v = variacao(h);
  const g = new THREE.Group();
  const corpo = pivo(g, 0, 0, 0);
  const pernas = [-0.09, 0.09].map(px => {
    const p = pivo(corpo, px, 0.1, 0);
    malha(geo('esfera', 0.08, 12, 8, { escala: [1, 0.7, 1.3] }), 0x2b2b33, 0, -0.05, 0.02, p);
    return p;
  });
  malha(geo('capsula', 0.27, 0.42, 8, 24), cor, 0, 0.55, 0, corpo, { roughness: 0.45 });
  // "rosto" claro
  malha(geo('esfera', 0.22, 24, 16, { escala: [1, 0.8, 0.5] }), 0xfdf6ec, 0, 0.78, 0.15, corpo, { roughness: 0.4 });
  const cabeca = pivo(corpo, 0, 0.78, 0);
  for (const px of [-0.08, 0.08]) {
    malha(geo('esfera', 0.045, 14, 10, { escala: [1, 1.3, 0.5] }), 0x1a1a22, px, 0.01, 0.26, cabeca);
    malha(geo('esfera', 0.014, 8, 6), 0xffffff, px + 0.015, 0.04, 0.28, cabeca, { emissive: 0xffffff, emissiveIntensity: 0.4 });
  }
  malha(geo('toro', 0.03, 0.009, 6, 12, Math.PI), 0x6b2a2a, 0, -0.08, 0.26, cabeca).rotation.z = Math.PI;
  // topete na cor do cabelo
  malha(geo('cone', 0.07, 0.16, 10), v.cabelo, 0.03, 0.43, 0.02, cabeca).rotation.z = -0.4;
  const bracos = [-1, 1].map(lado => {
    const b = pivo(corpo, lado * 0.3, 0.55, 0);
    malha(geo('esfera', 0.07, 12, 10), cor, lado * 0.02, -0.08, 0.02, b, { roughness: 0.45 });
    return b;
  });
  Object.assign(g.userData, animadorPadrao({ corpo, pernas, bracos, cabeca, gelatina: true, semente: h }));
  return finalizarBoneco(g);
}

// ---------------------------------------------------------------------------
// D) Astronautinha: traje branco fofinho, capacete redondo, mochila de oxigênio.
// variante: 'espelhado' (viseira escura com reflexo), 'rostinho' (vidro mostra
// o rosto), 'olhinhos' (viseira escura com olhos de luz)
// ---------------------------------------------------------------------------
export function criarAstronauta(cor, h = 1, variante = 'espelhado') {
  const v = variacao(h);
  const BRANCO = 0xf4f2ee, CINZA = 0xb9bcc6;
  const g = new THREE.Group();
  const corpo = pivo(g, 0, 0, 0);

  // pernas com botas
  const pernas = [-0.09, 0.09].map(px => {
    const p = pivo(corpo, px, 0.3, 0);
    malha(geo('capsula', 0.075, 0.12, 4, 12), BRANCO, 0, -0.1, 0, p);
    malha(geo('caixaR', 0.15, 0.1, 0.2, 3, 0.04), CINZA, 0, -0.24, 0.02, p);
    return p;
  });
  // tronco do traje, com faixa e painel na cor do agente
  malha(geo('capsula', 0.19, 0.16, 8, 20), BRANCO, 0, 0.43, 0, corpo, { roughness: 0.7 });
  malha(geo('toro', 0.19, 0.025, 8, 28), cor, 0, 0.36, 0, corpo).rotation.x = Math.PI / 2;
  malha(geo('caixaR', 0.16, 0.11, 0.05, 3, 0.02), cor, 0, 0.47, 0.17, corpo);
  for (const [px, c] of [[-0.04, 0x4cd97b], [0, 0xf2c14e], [0.04, 0xee4c01]]) {
    malha(geo('esfera', 0.014, 8, 6), c, px, 0.48, 0.2, corpo, { emissive: c, emissiveIntensity: 0.8 });
  }
  // mochila de oxigênio
  malha(geo('caixaR', 0.3, 0.32, 0.14, 3, 0.05), cor, 0, 0.48, -0.19, corpo);   // mochila na cor do agente: visível de longe
  malha(geo('cilindro', 0.035, 0.035, 0.26, 10), BRANCO, -0.09, 0.5, -0.27, corpo);
  malha(geo('cilindro', 0.035, 0.035, 0.26, 10), BRANCO, 0.09, 0.5, -0.27, corpo);
  // braços com luvas e braçadeira colorida
  const bracos = [-1, 1].map(lado => {
    const b = pivo(corpo, lado * 0.21, 0.54, 0);
    malha(geo('capsula', 0.06, 0.13, 4, 10), BRANCO, 0, -0.1, 0, b);
    malha(geo('toro', 0.062, 0.016, 6, 16), cor, 0, -0.1, 0, b).rotation.x = Math.PI / 2;
    malha(geo('esfera', 0.065, 12, 10), CINZA, 0, -0.22, 0, b);
    b.rotation.z = lado * 0.18;
    return b;
  });
  // capacete
  const cabeca = pivo(corpo, 0, 0.82, 0);
  malha(geo('toro', 0.17, 0.035, 10, 28), cor, 0, -0.2, 0, cabeca).rotation.x = Math.PI / 2;   // gola
  // casco do capacete com a abertura da viseira na frente (+z fica em phi = PI/2)
  const PH0 = Math.PI / 2 - Math.PI * 0.4, PHL = Math.PI * 0.8, TH0 = Math.PI * 0.27, THL = Math.PI * 0.4;
  const casco = { roughness: 0.35, side: THREE.DoubleSide, shadowSide: THREE.BackSide };   // sem shadowSide a sombra do próprio casco pisca na nuca
  malha(geo('esfera', 0.29, 40, 28, PH0 + PHL, Math.PI * 2 - PHL), BRANCO, 0, 0, 0, cabeca, casco);
  malha(geo('esfera', 0.29, 20, 10, PH0, PHL, 0, TH0), BRANCO, 0, 0, 0, cabeca, casco);
  malha(geo('esfera', 0.29, 20, 10, PH0, PHL, TH0 + THL, Math.PI - TH0 - THL), BRANCO, 0, 0, 0, cabeca, casco);
  // viseira: calota frontal na mesma abertura (material próprio: reflete a tela quando digita)
  const geoVis = geo('esfera', 0.285, 32, 20, PH0, PHL, TH0, THL);
  let viseira;
  const olhos = [];
  if (variante === 'rostinho') {
    // rosto visível atrás do vidro
    malha(geo('esfera', 0.2, 24, 18), v.pele, 0, -0.01, 0.04, cabeca);
    malha(geo('esfera', 0.205, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), v.cabelo, 0, 0.01, 0.02, cabeca).rotation.x = -0.35;
    for (const px of [-0.07, 0.07]) {
      malha(geo('esfera', 0.03, 10, 8, { escala: [1, 1.25, 0.6] }), 0x1a1a22, px, -0.01, 0.225, cabeca);
      malha(geo('esfera', 0.03, 10, 8, { escala: [1.3, 0.7, 0.4] }), 0xf08a8a, px * 1.6, -0.07, 0.2, cabeca, { transparent: true, opacity: 0.5 });
    }
    malha(geo('toro', 0.028, 0.008, 6, 12, Math.PI), 0x6b2a2a, 0, -0.08, 0.215, cabeca).rotation.z = Math.PI;
    viseira = malha(geoVis, 0xbfe0ff, 0, 0, 0, cabeca,
      { transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1 }, true);
    viseira.castShadow = false;
  } else {
    viseira = malha(geoVis, 0x101a3d, 0, 0, 0, cabeca, { roughness: 0.12, metalness: 0.6 }, true);
    // reflexo
    malha(geo('esfera', 0.05, 12, 8, { escala: [1.6, 0.6, 0.3] }), 0xffffff, -0.09, 0.08, 0.27, cabeca,
      { emissive: 0xffffff, emissiveIntensity: 0.5, transparent: true, opacity: 0.7 });
    if (variante === 'olhinhos') {
      // os dois olhos dividem um material, exclusivo deste boneco
      const matOlhos = mat(0x8fe3ff, { emissive: 0x6fd8ff, emissiveIntensity: 1.6 }).clone();
      for (const px of [-0.075, 0.075]) {
        const o = malha(geo('capsula', 0.022, 0.03, 4, 8), 0x8fe3ff, px, -0.01, 0.272, cabeca);
        o.material = matOlhos;
        olhos.push(o);
      }
    }
  }
  // reflexo da tela: emissive azulado com intensidade 0 (sem mudança visual até digitar sentado)
  viseira.material.emissive.setHex(REFLEXO_TELA);
  viseira.material.emissiveIntensity = 0;
  // anteninha com luz (LED de status) na cor do agente
  malha(geo('cilindro', 0.01, 0.01, 0.12, 6), CINZA, 0.15, 0.27, -0.05, cabeca).rotation.z = -0.4;
  const luz = malha(geo('esfera', 0.03, 10, 8), cor, 0.18, 0.33, -0.05, cabeca, { emissive: cor, emissiveIntensity: 0.9 }, true);
  // halo do LED no 'esperar': sprite aditivo pequeno (o Sprite do three usa uma geometria única)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: obterTexturaHalo(), color: LARANJA, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.setScalar(0.25);
  halo.position.copy(luz.position);
  halo.renderOrder = 10;
  halo.visible = false;
  halo.raycast = () => {};   // o hover usa a hitbox
  cabeca.add(halo);

  Object.assign(g.userData, animadorPadrao({ corpo, pernas, bracos, cabeca, olhos, luz, halo, viseira, semente: h }));
  g.userData.olhos = olhos;
  g.userData.luzAntena = luz;
  g.userData.viseira = viseira;
  g.userData.halo = halo;
  return finalizarBoneco(g, [viseira.material, luz.material, halo.material, ...olhos.map(o => o.material)]);
}

// ---------------------------------------------------------------------------
// Animação comum: poses-alvo por modo, misturadas suavemente
// ---------------------------------------------------------------------------
// Canais animados: pernas e braços (rotation.x), abertura dos braços (rotation.z),
// corpo (y, inclinação, escala), cabeça (x, y, z), olhos (deslocamento e escala)
// e o reflexo na viseira
const CANAIS = ['pe0', 'pe1', 'bx0', 'bx1', 'bz0', 'bz1', 'cy', 'crz', 'csx', 'csy',
  'kx', 'ky', 'kz', 'ox', 'oy', 'os', 'osy', 'vis'];
const RAPIDEZ_MISTURA = 12;
const suave = u => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };

function animadorPadrao({ corpo, pernas, bracos, cabeca, rigido, gelatina, olhos = [], luz = null, halo = null, viseira = null, semente = 1 }) {
  const baseZ = bracos.map(b => b.rotation.z);
  const ladoBraco = bracos.map((b, i) => Math.sign(baseZ[i]) || (i === 0 ? -1 : 1));
  const baseOlhos = olhos.map(o => o.position.clone());
  const corOlhos = olhos[0] ? { cor: olhos[0].material.color.getHex(), emissive: olhos[0].material.emissive.getHex() } : null;
  const corOlhosEsperar = { cor: LARANJA, emissive: LARANJA };
  const corLuz = luz ? { cor: luz.material.color.getHex(), emissive: luz.material.emissive.getHex() } : null;
  const corLuzEsperar = { cor: LARANJA, emissive: LARANJA };
  const intensOlhos = olhos[0]?.material.emissiveIntensity ?? 1;

  const alvo = {}, atual = {}, desvio = {};
  for (const c of CANAIS) { alvo[c] = atual[c] = desvio[c] = 0; }
  let chave = null, modoAnterior = null, inicioModo = 0;
  let ledManual = null;
  let corOlhosAplicada = null, corLuzAplicada = null;

  // piscar: intervalo de 3 a 6 s, sorteado de forma estável a partir da semente
  let nPiscada = 0, proxPiscada = null;
  const aleat = n => { const x = Math.sin((n + 1) * 12.9898 + semente * 78.233) * 43758.5453; return x - Math.floor(x); };
  function fatorPiscada(t, lenta) {
    const dur = lenta ? 0.4 : 0.12;
    if (proxPiscada === null || t > proxPiscada + 8 || t < proxPiscada - 8) proxPiscada = t + 0.4 + aleat(nPiscada++) * 4;
    while (t >= proxPiscada + dur) proxPiscada += dur + 3 + aleat(nPiscada++) * 3;
    if (t < proxPiscada) return 1;
    return 1 - 0.9 * Math.sin(Math.PI * (t - proxPiscada) / dur);   // chega a 0,1 no meio
  }

  function aplicarCor(m, c) { m.color.setHex(c.cor); m.emissive.setHex(c.emissive); }

  function poseAlvo(t, modo, sentado, fase, passo, atividade) {
    // pose neutra
    alvo.pe0 = alvo.pe1 = alvo.bx0 = alvo.bx1 = 0;
    alvo.bz0 = baseZ[0]; alvo.bz1 = baseZ[1];
    alvo.cy = alvo.crz = 0; alvo.csx = alvo.csy = 1;
    alvo.kx = alvo.ky = alvo.kz = 0;
    alvo.ox = alvo.oy = 0; alvo.os = alvo.osy = 1;
    alvo.vis = 0;

    if (modo === 'andar') {
      const f = (passo ?? t * 10) + fase;
      alvo.pe0 = Math.sin(f) * 0.6;
      alvo.pe1 = -Math.sin(f) * 0.6;
      alvo.bx0 = -Math.sin(f) * 0.7;
      alvo.bx1 = Math.sin(f) * 0.7;
      alvo.cy = Math.abs(Math.sin(f)) * 0.05;
      alvo.crz = rigido ? 0 : Math.sin(f) * 0.04;
      if (gelatina) { alvo.csx = 1 + Math.sin(f * 2) * 0.03; alvo.csy = 1 - Math.sin(f * 2) * 0.03; }
    } else if (modo === 'digitar') {
      if (sentado) {
        // sentado à mesa: antebraços na altura do tampo
        alvo.bx0 = -1.45 + Math.sin(t * 22 + fase) * 0.08;
        alvo.bx1 = -1.45 + Math.sin(t * 22 + fase + 1.5) * 0.08;
        alvo.vis = 0.15 + Math.sin(t * 22 + fase) * 0.05;   // reflexo da tela pulsando com a digitação
      } else {
        alvo.bx0 = -1.1 + Math.sin(t * 22 + fase) * 0.12;
        alvo.bx1 = -1.1 + Math.sin(t * 22 + fase + 1.5) * 0.12;
      }
      alvo.kx = 0.12 + Math.sin(t * 3 + fase) * 0.03;
      if (atividade === 'pesquisar') {
        alvo.ox = Math.sin(t * 1.8 + fase) * 0.015;   // varredura lateral
        alvo.oy = -0.006;
      } else {
        alvo.ox = Math.sin(t * 1.7 + fase) * 0.005 + Math.sin(t * 13 + fase) * 0.002;   // leitura com tremida curta
        alvo.oy = -0.012;
      }
    } else if (modo === 'esperar') {
      alvo.bx1 = -2.6 + Math.sin(t * 8 + fase) * 0.35;   // acenando
      alvo.cy = Math.abs(Math.sin(t * 5 + fase)) * 0.06;
      alvo.kx = -0.1;
    } else if (modo === 'entregar') {
      // espreguiçar: os dois braços sobem uma vez e descem, sem oscilar (~1,6 s)
      const u = t - inicioModo;
      const e = u < 0.45 ? suave(u / 0.45) : u < 1.1 ? 1 : 1 - suave((u - 1.1) / 0.5);
      const tremida = Math.sin(t * 28 + fase) * 0.05 * e * e * e;
      alvo.bx0 = -2.8 * e + tremida;
      alvo.bx1 = -2.8 * e - tremida;
      alvo.bz0 = baseZ[0] + ladoBraco[0] * 0.17 * e;
      alvo.bz1 = baseZ[1] + ladoBraco[1] * 0.17 * e;
      alvo.kx = -0.18 * e;
      alvo.cy = 0.02 * e;
      alvo.csy = 1 + 0.035 * e;
      alvo.csx = 1 - 0.015 * e;
      alvo.osy = 0.4;   // arcos felizes
      alvo.oy = 0.01;
    } else if (modo === 'conversar') {
      // em pé, virado para o outro: um braço gesticula leve, cabeça acena
      alvo.bx0 = -0.35 + Math.sin(t * 2.6 + fase) * 0.25;
      alvo.bz0 = baseZ[0] + ladoBraco[0] * (0.1 + Math.sin(t * 1.3 + fase) * 0.06);
      alvo.bx1 = -0.08;
      alvo.kx = Math.sin(t * 1.7 + fase) * 0.06;
      alvo.kz = Math.sin(t * 0.8 + fase) * 0.04;
      alvo.cy = Math.abs(Math.sin(t * 2.6 + fase)) * 0.008;
    } else if (modo === 'parado') {
      // sem conexão: quieto, olhando em volta devagar
      alvo.ky = Math.sin(t * 0.4 + fase) * 0.15;
      alvo.csy = 1 + Math.sin(t * 1.5 + fase) * 0.008;
    } else {   // 'descansar', 'pausa' (e qualquer modo desconhecido)
      alvo.kx = Math.sin(t * 1.4 + fase) * 0.05;
      alvo.kz = Math.sin(t * 0.9 + fase) * 0.06;
      alvo.csy = 1 + Math.sin(t * 2 + fase) * 0.015;
      if (modo === 'descansar' || modo === 'pausa') alvo.osy = 0.4;   // semicerrados
      if (modo === 'pausa') alvo.bz0 = 0.5;   // um braço apoiado
    }
    if (atividade === 'coordenar' && modo !== 'andar') {
      alvo.ky = Math.sin(t * 0.6 + fase) * 0.25;   // olha de um lado para o outro
      alvo.ox = Math.sin(t * 0.9 + fase) * 0.01;
    }
    if ((sentado || modo === 'pausa') && modo !== 'andar') {
      // sentado: coxas para a frente, corpo parado no assento
      alvo.pe0 = alvo.pe1 = -1.45;
      alvo.cy = 0;
      alvo.crz = 0;
    }
  }

  function animar(t, modo, sentado = false, opc = {}) {
    const dt = Math.min(0.1, Math.max(0, opc.dt ?? 1 / 60));
    const fase = opc.fase ?? 0;
    const atividade = opc.atividade;
    if (modo !== modoAnterior) { inicioModo = t; modoAnterior = modo; }

    poseAlvo(t, modo, sentado, fase, opc.passo, atividade);

    // mistura: na troca de modo, guarda a diferença e deixa decair
    const novaChave = modo + '|' + !!sentado + '|' + (atividade || '');
    const k = Math.exp(-dt * RAPIDEZ_MISTURA);
    if (chave === null) {
      for (const c of CANAIS) desvio[c] = 0;
    } else if (novaChave !== chave) {
      for (const c of CANAIS) desvio[c] = (atual[c] - alvo[c]) * k;
    } else {
      for (const c of CANAIS) desvio[c] *= k;
    }
    chave = novaChave;
    for (const c of CANAIS) atual[c] = alvo[c] + desvio[c];

    pernas[0].rotation.x = atual.pe0;
    pernas[1].rotation.x = atual.pe1;
    bracos[0].rotation.x = atual.bx0;
    bracos[1].rotation.x = atual.bx1;
    bracos[0].rotation.z = atual.bz0;
    bracos[1].rotation.z = atual.bz1;
    corpo.position.y = atual.cy;
    corpo.rotation.z = atual.crz;
    corpo.scale.set(atual.csx, atual.csy, 1);
    cabeca.rotation.set(atual.kx, atual.ky, atual.kz);

    // olhos: posição, tamanho, piscada e cor
    const esperando = modo === 'esperar' || atividade === 'esperar';
    if (olhos.length) {
      const lenta = modo === 'descansar' || modo === 'pausa';
      const pisc = fatorPiscada(t, lenta);
      const os = atual.os * (esperando ? 1.2 : 1);
      olhos.forEach((o, i) => {
        o.position.set(baseOlhos[i].x + atual.ox, baseOlhos[i].y + atual.oy, baseOlhos[i].z);
        o.scale.set(os, os * atual.osy * pisc, os);
      });
      const cor = esperando ? corOlhosEsperar : corOlhos;
      if (cor !== corOlhosAplicada) {
        aplicarCor(olhos[0].material, cor);
        olhos[0].material.emissiveIntensity = esperando ? Math.max(intensOlhos, 1.8) : intensOlhos;
        corOlhosAplicada = cor;
      }
    }

    // LED da antena
    if (luz) {
      const estado = ledManual ?? (esperando ? 'esperar'
        : (modo === 'descansar' || modo === 'pausa' || modo === 'entregar') ? 'descanso'
        : modo === 'parado' ? 'apagado' : 'trabalho');
      const m = luz.material;
      const cor = estado === 'esperar' ? corLuzEsperar : corLuz;
      if (cor !== corLuzAplicada) { aplicarCor(m, cor); corLuzAplicada = cor; }
      if (estado === 'esperar') {
        // pisca a ~1,2 Hz, com halo
        const k = Math.min(1, Math.max(0, (Math.sin(t * Math.PI * 2 * 1.2 + fase) + 0.2) * 2.5));
        m.emissiveIntensity = 0.25 + 2.25 * k;
        if (halo) { halo.visible = true; halo.material.opacity = 0.2 + 0.8 * k; }
      } else {
        if (halo) halo.visible = false;
        m.emissiveIntensity = estado === 'trabalho' ? 0.9
          : estado === 'descanso' ? 0.6 + 0.3 * Math.sin(t * Math.PI * 2 / 3 + fase)   // respiração lenta (3 s)
          : 0;
      }
    }

    // reflexo da tela na viseira
    if (viseira) viseira.material.emissiveIntensity = Math.max(0, atual.vis);
  }

  function definirLed(estado) {
    ledManual = estado === null || estado === undefined || estado === 'auto' ? null : estado;
  }
  function definirCorOlhos(cor, emissive = cor) {
    if (!corOlhos) return;
    corOlhos.cor = cor; corOlhos.emissive = emissive;
    corOlhosAplicada = null;
  }
  function definirCorLuz(cor, emissive = cor) {
    if (!corLuz) return;
    corLuz.cor = cor; corLuz.emissive = emissive;
    corLuzAplicada = null;
  }
  return { animar, definirLed, definirCorOlhos, definirCorLuz };
}

export const ASTRONAUTAS = {
  espelhado: { nome: 'Viseira espelhada', criar: (c, h) => criarAstronauta(c, h, 'espelhado'), descricao: 'Clássico: viseira escura com reflexo, rosto escondido.' },
  rostinho: { nome: 'Rostinho no vidro', criar: (c, h) => criarAstronauta(c, h, 'rostinho'), descricao: 'Capacete de vidro mostrando o rosto e o cabelo de cada um.' },
  olhinhos: { nome: 'Olhinhos de luz', criar: (c, h) => criarAstronauta(c, h, 'olhinhos'), descricao: 'Viseira escura com dois olhinhos acesos. Fofo e misterioso.' },
};

export const ESTILOS = {
  chibi: { nome: 'Chibi', criar: criarChibi, descricao: 'Cabeção, corpinho pequeno, bochechas. Fofo e expressivo.' },
  montar: { nome: 'De montar', criar: criarMontar, descricao: 'Bonequinho de encaixar: cabeça amarela, mãos em C.' },
  feijao: { nome: 'Feijão', criar: criarFeijao, descricao: 'Corpo e cabeça numa peça só, olhões. Simples e gráfico.' },
};
