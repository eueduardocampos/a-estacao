// Peças do diorama: paleta, primitivas (caixa, cilindro, grupo), móveis,
// plantas, luminárias, placas de texto, quadros e TVs. Tudo é criado direto em
// E.cena, salvo quando um grupo pai é passado.
//
// CONTRATO DA MESA (rodada 2, v0.5). mesaComputador(x, z, rot, corTampo, pai, opc)
// devolve a vaga com:
//   pos, olhar, pose, alturaAssento   lugar do astronauta sentado (banqueta puxada)
//   tela        material da tela do monitor (emissiveIntensity > 0 acende o código)
//   grupo, local                      o THREE.Group da mesa e a vaga no espaço dele
//   topoAssento 0,51 (topo da banqueta)
//   banqueta    grupo da banqueta (desliza de z 0,25, guardada, para 0,62, puxada)
//   posto       subgrupo com monitor e teclado (escala y 0,001 quando é mesa de apoio)
//   enfeites    objetos do tampo; os do meio (userData.meio) recolhem quando vira posto
//   caneca      caneca com alça, escondida até definirCaneca(cor)
//   ligado      true = posto (monitor à mostra), false = mesa de apoio
//   definirPosto(ligado, { instantaneo })  0,4 s, easeOutCubic; desligar apaga a tela antes
//   mostrarServico(texto | null)      nome do serviço no monitor (até 14 letras); null = código
//   definirCaneca(cor | null)         caneca na cor da mochila sobre o tampo, ou esconde
//   acenderTela(nivel)                0 apagada, 0,6 em casa, 0,9 ocupada (liga o posto se precisar)
//   rolarTela(dt)                     rola as linhas de código (chamar enquanto digita)
// layout.js acrescenta v.sala (id da sala), v.ordem e v.ocupada.
//
// LUMINÁRIAS. pendente(x, z, altParede, pai, { base, poca }) e luminariaPe(x, z, pai)
// devolvem { cupula, poca, definirNivel(n, { instantaneo }) }: a cúpula brilha
// (emissive quente, 0 a 1,2) e a poça de luz no piso vai de 0 a 0,22 de opacidade,
// com fade de 0,6 s. Nenhuma luz de verdade é criada (mudar o número de luzes
// recompila os shaders).
//
// TEXTOS. Letras de parede, placas de ilha, TVs e nomes de serviço são desenhados
// em canvas e redesenhados quando as fontes terminam de carregar (BUG-09).
//
// ESTAÇÃO ELÁSTICA (rodada 3). Todas as peças aceitam um grupo pai (o grupo do
// módulo que acopla e desacopla). Peças de parede (janela, letras, quadro,
// relógio, rodapé) levam userData.parede, para crescer junto com a parede.
// Geometrias de mesmo tamanho, materiais de mat(), texturas de base (código,
// tela apagada, luz no piso, artes, céu, piso de madeira) são compartilhados e
// marcados com userData.compartilhada. liberarObjeto(raiz) descarta só o que é
// exclusivo da peça (plantas, materiais clonados, telas, placas, TVs) e desliga
// os redesenhos de texto dela.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { E } from './estado.js';
import { tween, cancelarTweens } from './tween.js';

// Altura das paredes. Mora aqui porque a placa da parede usa; layout.js reexporta.
export const ALT_PAREDE = 2.8;

// ---------------------------------------------------------------------------
// Paleta
// ---------------------------------------------------------------------------
// navy, azul e laranja são só para SINAIS (placa acesa, TV ligada, mochila, balão).
export const COR = {
  navy: 0x030870, azul: 0x0038ef, laranja: 0xee4c01,
  madeiraClara: 0xd9b48a, madeiraMedia: 0xb98552, madeiraEscura: 0x8a5a3a,
  madeiraTampo: 0xd8b48c,
  cinza: 0x9a9aa3, preto: 0x2b2b33,
  grafite: 0x3a3f4f, grafiteClaro: 0x6b6f7a, aluminio: 0xd9d9de,
  linho: 0xe4dccd, azulAcinzentado: 0x8fa3b8, cortina: 0xd9d2c5, fibra: 0xc4a174,
  verde: 0x5f8f4e, verdeClaro: 0x8db87a, folha: 0x4f7d43, folhaClara: 0x6f9a5a,
  vaso: 0xf1ede6, terracota: 0xc07a55, offWhite: 0xf1ede6, pretoFosco: 0x34343a,
  areia: 0xe8dcc6, salvia: 0xa8c39f, terracotaSuave: 0xc98a6a, azulCinza: 0x8fa3bf,
  luzQuente: 0xffd9a0,
  base: 0x7f73a8,
};
export const PISOS_DEPTO = [0xd6b083, 0xc4c0ba, 0xbf8c5c, 0xe4dfd6, 0xcfa77a, 0xb9b4c9, 0xd8c2a4, 0xa9b8a0];
export const TAPETES_DEPTO = [0x9db3d9, 0xe9c9a8, 0x7f9d72, 0xd99a8a, 0xb7a6d9, 0xe3d28f, 0x8fb4a8, 0xc9b49a];
// tons calmos para objetos de cena (livros, pastas, canecas), sem as cores de sinal
const CORES_LIVRO = [0x8fa3bf, 0xc98a6a, 0xa8c39f, 0xe8dcc6, 0x7d8a9e, 0xb9a48a, 0x6f7f6a, 0xd8c7a8];
const CORES_CANECA = [0xf1ede6, 0xc98b6b, 0x9fb59a];

// ---------------------------------------------------------------------------
// Peças básicas
// ---------------------------------------------------------------------------
const materiais = new Map();
export function mat(cor, extra = {}) {
  const chave = cor + JSON.stringify(extra);
  if (!materiais.has(chave)) {
    const m = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.78, metalness: 0, ...extra });
    m.userData.compartilhada = true;
    materiais.set(chave, m);
  }
  return materiais.get(chave);
}

// Geometrias compartilhadas: a mesma caixa (ou cilindro, ou plano) com as mesmas
// medidas é criada uma vez só. Nenhuma delas recebe dispose.
const geometrias = new Map();
function geoCompartilhada(chave, criar) {
  let g = geometrias.get(chave);
  if (!g) { g = criar(); g.userData.compartilhada = true; geometrias.set(chave, g); }
  return g;
}
const k4 = n => +n.toFixed(4);

// Segmentos de arredondamento de uma caixa (PERF-05): peça pequena vira caixa
// simples, placa fina e comprida (piso, moldura) fica com 1, peça média com 2 e
// só móvel grande deitado ou fundo (sofá, estante, tampo) com 3. Paredes e
// divisórias ficam com 2. O tampo da mesa pede 3 explicitamente.
export function segmentosDe(w, h, d) {
  const [menor, meio, maior] = [w, h, d].sort((a, b) => a - b);
  if (Math.min(0.05, menor / 2.5) < 0.012) return 0;   // arredondamento abaixo de ~1 cm não aparece
  if (menor < 0.1) return maior < 1 ? 0 : 1;
  if (maior >= 1.2 && maior <= 3 && meio >= 0.6 && (h === menor || menor >= 0.3)) return 3;
  return 2;
}

function geoCaixa(w, h, d, seg) {
  const r = Math.min(0.05, Math.min(w, h, d) / 2.5);
  return geoCompartilhada(`caixa|${k4(w)}|${k4(h)}|${k4(d)}|${seg}|${k4(r)}`,
    () => (seg ? new RoundedBoxGeometry(w, h, d, seg, r) : new THREE.BoxGeometry(w, h, d)));
}
function geoCilindro(rt, rb, h, seg) {
  return geoCompartilhada(`cil|${k4(rt)}|${k4(rb)}|${k4(h)}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
}
function geoPlano(w, h) {
  return geoCompartilhada(`plano|${k4(w)}|${k4(h)}`, () => new THREE.PlaneGeometry(w, h));
}

// extra: { material, mat (opções do material), sombra (false = não projeta), seg (força os segmentos) }
export function caixa(w, h, d, cor, x, y, z, pai = E.cena, extra = {}) {
  const m = new THREE.Mesh(geoCaixa(w, h, d, extra.seg ?? segmentosDe(w, h, d)), extra.material || mat(cor, extra.mat));
  m.position.set(x, y + h / 2, z);
  m.castShadow = extra.sombra !== false;
  m.receiveShadow = true;
  pai.add(m);
  return m;
}

export function cilindro(rt, rb, h, cor, x, y, z, pai = E.cena, seg = 20) {
  const m = new THREE.Mesh(geoCilindro(rt, rb, h, seg), mat(cor));
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  pai.add(m);
  return m;
}

export function grupo(x, z, rot = 0, pai = E.cena) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  pai.add(g);
  return g;
}

export function noMundo(g, lx, lz) {
  g.updateWorldMatrix(true, false);
  return new THREE.Vector3(lx, 0, lz).applyMatrix4(g.matrixWorld);
}

// Gerador pseudoaleatório com semente: a mesma pasta gera sempre a mesma decoração
let semente = 1;
// layout.js reinicia a semente antes de montar, para a decoração sair sempre igual
export function definirSemente(n) { semente = n; }
export function aleatorio() { semente = (semente * 16807) % 2147483647; return (semente - 1) / 2147483646; }
export function escolher(lista) { return lista[Math.floor(aleatorio() * lista.length)]; }
export function hash(texto) { let h = 7; for (const c of texto) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

// Sorteio local para desenhos em canvas: não mexe na semente da planta
function sorteio(n) {
  let s = (n >>> 0) || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// Malha sem efeito no mapa de caminhos (luz no piso, cortina, rodapé, quadro)
function semMapa(o) { o.userData.semMapa = true; return o; }

// ---------------------------------------------------------------------------
// Redesenho dos textos quando as fontes chegam (BUG-09)
// ---------------------------------------------------------------------------
const redesenhos = new Set();
let ouvindoFontes = false;
function aoCarregarFontes(fn) {
  redesenhos.add(fn);
  if (ouvindoFontes) return fn;
  ouvindoFontes = true;
  const fontes = typeof document !== 'undefined' ? document.fonts : null;
  fontes?.addEventListener?.('loadingdone', redesenharTextos);
  return fn;
}
// Quantos textos estão registrados para redesenho (conferência de vazamento)
export function contagemRedesenhos() { return redesenhos.size; }
// Redesenha letras de parede, placas, TVs e nomes de serviço com a fonte atual
export function redesenharTextos() {
  for (const fn of redesenhos) {
    try { fn(); } catch (e) { console.warn('redesenho de texto falhou', e); }
  }
}

function compartilhada(o) { o.userData.compartilhada = true; return o; }

function texturaDeCanvas(canvas) {
  const tx = new THREE.CanvasTexture(canvas);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = E.renderer?.capabilities?.getMaxAnisotropy?.() || 1;
  return tx;
}

// ---------------------------------------------------------------------------
// Plantas (VIS-08): folhas de verdade, unidas numa geometria só por planta
// ---------------------------------------------------------------------------
const EIXO_Y = new THREE.Vector3(0, 1, 0);

function comCor(geo, cor) {
  const c = new THREE.Color(cor);
  const n = geo.attributes.position.count;
  const cores = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { cores[i * 3] = c.r; cores[i * 3 + 1] = c.g; cores[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(cores, 3));
  return geo;
}

// Folha: esfera achatada (1 x 0,05 x 0,45) com a base na origem, inclinada para
// cima e girada em torno do caule
function folha(comprimento, inclinacao, giro, x, y, z, cor, { gomos = [12, 8], espessura = 0.05 } = {}) {
  const g = new THREE.SphereGeometry(0.5, gomos[0], gomos[1]);
  g.scale(1, espessura, 0.45);
  g.translate(0.5, 0, 0);
  g.scale(comprimento, comprimento, comprimento);
  g.rotateZ(inclinacao);
  g.rotateY(giro);
  g.translate(x, y, z);
  return comCor(g, cor);
}

// Cilindro fino de a até b (caule, tronco, haste)
function haste(a, b, raio, cor, lados = 5) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(raio * 0.8, raio, dir.length(), lados);
  g.translate(0, dir.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(EIXO_Y, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return comCor(g, cor);
}

function vasoComBorda(partes, raioTopo, raioBase, altura, cor) {
  partes.push(comCor(new THREE.CylinderGeometry(raioTopo, raioBase, altura, 18).translate(0, altura / 2, 0), cor));
  const borda = new THREE.TorusGeometry(raioTopo, Math.max(0.008, raioTopo * 0.11), raioTopo < 0.1 ? 4 : 6, raioTopo < 0.1 ? 12 : 18);
  borda.rotateX(Math.PI / 2);
  borda.translate(0, altura, 0);
  partes.push(comCor(borda, cor));
  partes.push(comCor(new THREE.CylinderGeometry(raioTopo * 0.92, raioTopo * 0.92, 0.01, 14).translate(0, altura - 0.025, 0), 0x4a3426));
}

const ANGULO_DOURADO = 137.5 * Math.PI / 180;

// tipo: 'folhaLarga' (costela-de-adão, cantos), 'ficus' (alto, perto de janela)
// ou 'suculenta' (de mesa). cor = cor do vaso. y = altura da base (mesa, prateleira).
export function planta(x, z, esc = 1, cor = null, tipo = null, pai = E.cena, y = 0) {
  tipo ||= escolher(['folhaLarga', 'ficus']);
  cor ??= escolher([COR.terracota, COR.offWhite, COR.pretoFosco]);
  const g = grupo(x, z, aleatorio() * Math.PI * 2, pai);
  g.position.y = y;
  g.scale.setScalar(esc);
  const partes = [];
  const verdes = [COR.folha, COR.folhaClara];
  const caule = 0x5d6b3e;

  if (tipo === 'suculenta') {
    vasoComBorda(partes, 0.075, 0.06, 0.08, cor);
    const n = 8 + Math.floor(aleatorio() * 3);
    for (let i = 0; i < n; i++) {
      const giro = i * ANGULO_DOURADO;
      const interna = i >= n - 3;
      partes.push(folha(interna ? 0.06 : 0.085 + aleatorio() * 0.02, (interna ? 60 : 35 + aleatorio() * 20) * Math.PI / 180, giro,
        Math.cos(giro) * 0.01, 0.075, -Math.sin(giro) * 0.01, i % 3 ? 0x8fb59a : COR.folhaClara, { gomos: [6, 5], espessura: 0.22 }));
    }
  } else if (tipo === 'ficus') {
    vasoComBorda(partes, 0.17, 0.13, 0.36, cor);
    const topo = new THREE.Vector3(0.03, 1.2, 0.02);
    partes.push(haste(new THREE.Vector3(0, 0.34, 0), topo, 0.028, 0x7a5a3c, 6));
    const n = 14;
    for (let i = 0; i < n; i++) {
      const giro = i * ANGULO_DOURADO;
      const t = i / (n - 1);
      const yf = 0.78 + t * 0.55;
      const r = 0.03 + (1 - Math.abs(t - 0.45)) * 0.05;
      partes.push(folha(0.17 + aleatorio() * 0.06, (35 + aleatorio() * 30) * Math.PI / 180, giro,
        topo.x + Math.cos(giro) * r, yf, topo.z - Math.sin(giro) * r, verdes[i % 2], { gomos: [8, 6] }));
    }
  } else {
    // folha larga: 7 a 10 folhas em espiral, cada uma num caule saindo da terra
    vasoComBorda(partes, 0.2, 0.15, 0.4, cor);
    const n = 7 + Math.floor(aleatorio() * 4);
    for (let i = 0; i < n; i++) {
      const giro = i * ANGULO_DOURADO + aleatorio() * 0.3;
      const rb = 0.06 + aleatorio() * 0.04, yb = 0.55 + aleatorio() * 0.3;
      const base = new THREE.Vector3(Math.cos(giro) * rb, yb, -Math.sin(giro) * rb);
      partes.push(haste(new THREE.Vector3(0, 0.38, 0), base, 0.009, caule));
      partes.push(folha(0.34 + aleatorio() * 0.12, (35 + aleatorio() * 30) * Math.PI / 180, giro, base.x, base.y, base.z, verdes[i % 2]));
    }
  }
  const geo = mergeGeometries(partes);
  partes.forEach(p => p.dispose());
  const m = new THREE.Mesh(geo, mat(0xffffff, { vertexColors: true, roughness: 0.72 }));
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// Objetos de mesa e caneca (ID-10)
// ---------------------------------------------------------------------------
// Caneca: cilindro com alça (meio toro), em cerâmica dessaturada
export function caneca(pai, x, y, z, cor = escolher(CORES_CANECA)) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = aleatorio() * Math.PI * 2;
  const material = mat(cor, { roughness: 0.5 });
  const corpo = new THREE.Mesh(geoCilindro(0.038, 0.034, 0.09, 14), material);
  corpo.position.y = 0.045;
  const alca = new THREE.Mesh(geoCompartilhada('alca', () => new THREE.TorusGeometry(0.024, 0.007, 6, 10, Math.PI)), material);
  alca.rotation.z = -Math.PI / 2;
  alca.position.set(0.038, 0.047, 0);
  const cafe = new THREE.Mesh(geoCilindro(0.032, 0.032, 0.004, 12), mat(0x5a3a26));
  cafe.position.y = 0.08;
  for (const m of [corpo, alca]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  g.add(cafe);
  g.userData.definirCor = c => { const mm = mat(c, { roughness: 0.5 }); corpo.material = alca.material = mm; };
  pai.add(g);
  return g;
}

function livroAberto(pai, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = (aleatorio() - 0.5) * 0.8;
  caixa(0.34, 0.008, 0.23, escolher(CORES_LIVRO), 0, 0, 0, g, { seg: 0 });
  for (const lado of [-1, 1]) {
    const pagina = caixa(0.16, 0.012, 0.21, 0xf3eee4, lado * 0.082, 0.006, 0, g, { seg: 0 });
    pagina.rotation.z = -lado * 0.07;
  }
  pai.add(g);
  return g;
}

function pilhaLivros(pai, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = (aleatorio() - 0.5) * 0.6;
  let alt = 0;
  const n = 2 + Math.floor(aleatorio() * 2);
  for (let i = 0; i < n; i++) {
    const h = 0.03 + aleatorio() * 0.015;
    const l = caixa(0.2 - i * 0.015, h, 0.15 - i * 0.01, escolher(CORES_LIVRO), 0, alt, 0, g, { seg: 0 });
    l.rotation.y = (aleatorio() - 0.5) * 0.3;
    alt += h;
  }
  pai.add(g);
  return g;
}

// Luminária de mesa articulada (decoração, apagada)
export function luminariaMesa(pai, x, y, z, rot = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rot;
  const metal = COR.grafiteClaro;
  cilindro(0.06, 0.07, 0.015, metal, 0, 0, 0, g, 16);
  const cotovelo = new THREE.Vector3(-0.06, 0.26, 0), ponta = new THREE.Vector3(0.12, 0.36, 0);
  const geo = mergeGeometries([
    haste(new THREE.Vector3(0, 0.015, 0), cotovelo, 0.008, metal, 6),
    haste(cotovelo, ponta, 0.008, metal, 6),
  ]);
  const braco = new THREE.Mesh(geo, mat(0xffffff, { vertexColors: true, roughness: 0.6 }));
  braco.castShadow = true;
  g.add(braco);
  const cabeca = new THREE.Mesh(geoCilindro(0.025, 0.06, 0.08, 14), mat(COR.offWhite, { roughness: 0.5 }));
  cabeca.position.copy(ponta);
  cabeca.rotation.z = -0.9;
  cabeca.castShadow = true;
  g.add(cabeca);
  pai.add(g);
  return g;
}

// ---------------------------------------------------------------------------
// Banqueta e mesa com posto de trabalho
// ---------------------------------------------------------------------------
// Banqueta giratória sem encosto (a mochila de oxigênio faz esse papel):
// assento em tecido claro, base e coluna em madeira. Devolve o grupo.
export function cadeira(g, lx, lz, rot, corAssento = COR.linho) {
  const c = new THREE.Group();
  c.position.set(lx, 0, lz);
  c.rotation.y = rot;
  g.add(c);
  cilindro(0.2, 0.22, 0.03, COR.madeiraMedia, 0, 0, 0, c, 16);
  cilindro(0.035, 0.035, 0.4, COR.madeiraMedia, 0, 0.03, 0, c, 8);
  caixa(0.48, 0.09, 0.48, corAssento, 0, 0.42, 0, c, { seg: 1 });
  return c;
}

// Textura de "linhas de código" (VIS-06): uma imagem só, clonada por tela para
// cada uma ter o próprio deslocamento
let codigoBase = null;
function texturaCodigo() {
  if (codigoBase) return codigoBase;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#262a35';
  g.fillRect(0, 0, c.width, c.height);
  const r = sorteio(4242);
  const cores = ['#e8e4dc', '#e8e4dc', '#ee4c01', '#8fb6ff', '#7cc4b0'];
  for (let y = 8; y < c.height - 6; y += 13) {
    let x = 12 + Math.floor(r() * 4) * 14;
    const tokens = 1 + Math.floor(r() * 3);
    for (let t = 0; t < tokens && x < c.width - 30; t++) {
      const w = 16 + r() * 60;
      g.fillStyle = cores[Math.floor(r() * cores.length)];
      g.beginPath();
      g.roundRect?.(x, y, Math.min(w, c.width - 12 - x), 6, 3);
      g.fill();
      x += w + 8;
    }
  }
  codigoBase = compartilhada(texturaDeCanvas(c));
  codigoBase.wrapS = codigoBase.wrapT = THREE.RepeatWrapping;
  return codigoBase;
}

// Tela apagada: grafite liso
let apagadaBase = null;
function texturaApagada() {
  if (apagadaBase) return apagadaBase;
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3f4f';
  g.fillRect(0, 0, 4, 4);
  apagadaBase = compartilhada(texturaDeCanvas(c));
  return apagadaBase;
}

// Nome do serviço no monitor (salas MCP e API): fundo navy, letras claras
const servicos = new Map();
function texturaServico(texto) {
  if (!servicos.has(texto)) servicos.set(texto, compartilhada(texturaTexto(texto, 0.31 / 0.55,
    { fundo: '#030870', cor: '#f3eee4', peso: 800, caixaAlta: false, fracao: 0.34, largura: 512, espaco: 0.02 })));
  return servicos.get(texto);
}

let contadorVaga = 0;

// opc: { assento (cor do tecido da banqueta), luminaria (true = luminária articulada no canto),
//        segTampo (arredondamento do tampo: 3 nas ilhas, perto da câmera; 2 no resto) }
export function mesaComputador(x, z, rot = 0, corTampo = COR.madeiraTampo, pai = E.cena, opc = {}) {
  const g = grupo(x, z, rot, pai);
  const chave = 'vaga:' + (++contadorVaga);
  caixa(1.4, 0.06, 0.75, corTampo, 0, 0.72, 0, g, { seg: opc.segTampo ?? 2 });
  for (const [lx, lz] of [[-0.62, -0.3], [0.62, -0.3], [-0.62, 0.3], [0.62, 0.3]]) caixa(0.05, 0.72, 0.05, COR.madeiraMedia, lx, 0, lz, g);
  const TOPO = 0.78;

  // posto: monitor (15% menor, carcaça clara, tela grafite) e teclado
  const posto = new THREE.Group();
  posto.position.y = TOPO;
  g.add(posto);
  caixa(0.18, 0.012, 0.12, COR.aluminio, 0, 0, -0.23, posto, { seg: 0 });
  caixa(0.05, 0.2, 0.04, COR.aluminio, 0, 0, -0.25, posto, { seg: 0 });
  caixa(0.61, 0.37, 0.04, COR.aluminio, 0, 0.17, -0.24, posto, { seg: 1 });
  caixa(0.5, 0.03, 0.16, 0xe8e8ea, 0, 0, 0.05, posto, { seg: 1 });

  const codigo = texturaCodigo().clone();
  codigo.offset.y = Math.random();
  const apagada = texturaApagada();
  const tela = new THREE.MeshStandardMaterial({ color: 0xffffff, map: apagada, emissive: 0xffffff, emissiveMap: apagada, roughness: 0.35 });
  const planoTela = new THREE.Mesh(geoPlano(0.55, 0.31), tela);
  planoTela.position.set(0, 0.17 + 0.185, -0.218);
  posto.add(planoTela);

  // enfeites: 1 ou 2, com cara de uso; o do meio do tampo recolhe quando vira posto
  const enfeites = [];
  const noMeio = escolher(['livroAberto', 'livroAberto', 'pilhaLivros', 'caneca']);
  const xm = (aleatorio() - 0.5) * 0.2, zm = -0.05 + aleatorio() * 0.12;
  const meio = noMeio === 'livroAberto' ? livroAberto(g, xm, TOPO, zm)
    : noMeio === 'pilhaLivros' ? pilhaLivros(g, xm, TOPO, zm) : caneca(g, xm, TOPO, zm);
  meio.userData.meio = true;
  enfeites.push(meio);
  if (opc.luminaria) {
    enfeites.push(luminariaMesa(g, -0.5, TOPO, -0.2, 0.5));
  } else if (aleatorio() < 0.55) {
    const lado = aleatorio() < 0.5 ? -1 : 1;
    const qual = escolher(['suculenta', 'suculenta', 'pilhaLivros', 'caneca', 'luminaria']);
    const ex = lado * 0.52, ez = -0.18 + aleatorio() * 0.1;
    enfeites.push(qual === 'suculenta' ? planta(ex, ez, 1, escolher([COR.terracota, COR.offWhite, COR.pretoFosco]), 'suculenta', g, TOPO)
      : qual === 'pilhaLivros' ? pilhaLivros(g, ex, TOPO, ez)
        : qual === 'caneca' ? caneca(g, ex, TOPO, ez) : luminariaMesa(g, ex, TOPO, ez, lado > 0 ? Math.PI - 0.5 : 0.5));
  }

  // caneca da mesa-casa: aparece na cor da mochila de quem senta ali
  const canecaCasa = caneca(g, 0.42, TOPO, 0.17, CORES_CANECA[0]);
  canecaCasa.visible = false;

  const banqueta = cadeira(g, 0, 0.62, 0, opc.assento ?? COR.linho);

  const v = {
    pos: noMundo(g, 0, 0.62), olhar: rot + Math.PI, pose: 'sentado', alturaAssento: 0.07, tela,
    grupo: g, local: new THREE.Vector3(0, 0, 0.62), topoAssento: 0.51,
    banqueta, posto, enfeites, caneca: canecaCasa, ligado: true, servico: null,
  };

  // A tela troca de imagem conforme o brilho: apagada (grafite) ou código/serviço.
  // Quem só muda tela.emissiveIntensity (agentes.js da rodada 1) também funciona.
  let intensidade = 0;
  function atualizarTela() {
    const acesa = intensidade > 0;
    const imagem = acesa ? (v.servico ? texturaServico(v.servico) : codigo) : apagada;
    if (tela.map !== imagem) { tela.map = imagem; tela.emissiveMap = imagem; }
    tela.color.setHex(acesa ? 0x8a8f9c : 0xffffff);
    // tela acesa precisa do monitor à mostra
    if (acesa && !v.ligado) v.definirPosto(true);
  }
  Object.defineProperty(tela, 'emissiveIntensity', {
    get: () => intensidade,
    set: n => { intensidade = n; atualizarTela(); },
    configurable: true,
  });

  v.acenderTela = nivel => { tela.emissiveIntensity = Math.max(0, nivel || 0); };
  v.rolarTela = dt => { codigo.offset.y = (codigo.offset.y + (dt || 0) * 0.05) % 1; };
  v.mostrarServico = texto => {
    v.servico = texto ? String(texto).trim().slice(0, 14).trim() : null;
    atualizarTela();
  };
  v.definirCaneca = cor => {
    if (cor == null) { canecaCasa.visible = false; return; }
    canecaCasa.userData.definirCor(cor);
    canecaCasa.visible = true;
  };

  const doMeio = () => enfeites.filter(e => e.userData.meio);
  // ao desacoplar o módulo: para as animações desta mesa e solta a textura de código
  g.userData.aoLiberar = () => {
    cancelarTweens(chave + ':posto');
    cancelarTweens(chave + ':banqueta');
    doMeio().forEach((e, i) => ['x', 'y', 'z'].forEach(k => cancelarTweens(`${chave}:enfeite${i}${k}`)));
    codigo.dispose();
  };
  v.definirPosto = (ligado, { instantaneo = false } = {}) => {
    ligado = !!ligado;
    if (instantaneo) {
      cancelarTweens(chave + ':posto');
      cancelarTweens(chave + ':banqueta');
      doMeio().forEach((e, i) => ['x', 'y', 'z'].forEach(k => cancelarTweens(`${chave}:enfeite${i}${k}`)));
      v.ligado = ligado;
      if (!ligado) { v.servico = null; v.acenderTela(0); }
      posto.scale.y = ligado ? 1 : 0.001;
      posto.visible = ligado;
      banqueta.position.z = ligado ? 0.62 : 0.25;
      for (const e of doMeio()) { e.scale.setScalar(ligado ? 0.001 : 1); e.visible = !ligado; }
      E.sombraSuja = true;
      return;
    }
    if (v.ligado === ligado) return;
    v.ligado = ligado;
    if (!ligado) { v.servico = null; v.acenderTela(0); }   // desliga com a tela já apagada
    posto.visible = true;
    tween({ obj: posto, prop: 'scale.y', para: ligado ? 1 : 0.001, dur: 0.4, ease: 'easeOutCubic', chave: chave + ':posto',
      aoFim: ligado ? undefined : () => { posto.visible = false; } });
    tween({ obj: banqueta, prop: 'position.z', para: ligado ? 0.62 : 0.25, dur: 0.4, ease: 'easeOutCubic', chave: chave + ':banqueta' });
    doMeio().forEach((e, i) => {
      e.visible = true;
      for (const k of ['x', 'y', 'z']) {
        tween({ obj: e, prop: 'scale.' + k, para: ligado ? 0.001 : 1, dur: 0.3, ease: 'easeOutCubic', chave: `${chave}:enfeite${i}${k}`,
          aoFim: ligado && k === 'y' ? () => { e.visible = false; } : undefined });
      }
    });
  };
  return v;
}

// ---------------------------------------------------------------------------
// Estante, sofá, tapete, capacho
// ---------------------------------------------------------------------------
const CORES_PASTA = [0x8fa3bf, 0xe8dcc6, 0xc98a6a, 0xa8c39f, 0x7d8a9e];

// decorar: uma prateleira com pastas, porta-retrato e vasinho no lugar dos livros
export function estante(x, z, rot, larg = 2, { decorar = true } = {}, pai = E.cena) {
  const g = grupo(x, z, rot, pai);
  caixa(larg, 2.1, 0.38, COR.madeiraMedia, 0, 0, 0, g);
  for (let p = 0; p < 4; p++) {
    const y = 0.15 + p * 0.5;
    caixa(larg - 0.1, 0.4, 0.3, 0x6e4529, 0, y, 0.06, g, { sombra: false });
    if (decorar && p === 2) { decorarPrateleira(g, larg, y); continue; }
    let lx = -larg / 2 + 0.12;
    while (lx < larg / 2 - 0.2) {
      const w = 0.06 + aleatorio() * 0.07, h = 0.24 + aleatorio() * 0.12;
      caixa(w, h, 0.24, escolher(CORES_LIVRO), lx + w / 2, y, 0.1, g, { sombra: false, seg: w < 0.1 ? 0 : 1 });
      lx += w + 0.012;
      if (aleatorio() < 0.08) lx += 0.15;
    }
  }
  return g;
}

// A estante é um bloco com a fachada dos livros 1 cm para fora; a prateleira
// decorada ganha uma bancada rasa na frente do nicho, onde ficam pastas,
// porta-retrato e vasinho
function decorarPrateleira(g, larg, y) {
  const ZF = 0.29;   // meio da bancada (o nicho termina em z 0,21)
  caixa(larg - 0.1, 0.025, 0.17, COR.madeiraClara, 0, y, ZF, g, { seg: 0 });
  const piso = y + 0.025;
  let lx = -larg / 2 + 0.16;
  const n = 3 + Math.floor(aleatorio() * 2);
  for (let i = 0; i < n; i++) {
    const pasta = caixa(0.07, 0.3, 0.14, escolher(CORES_PASTA), lx + 0.035, piso, ZF, g, { seg: 0 });
    pasta.rotation.z = i === n - 1 ? 0.18 : 0;   // a última encostada
    lx += 0.08;
  }
  // porta-retrato apoiado no fundo do nicho
  const pr = new THREE.Group();
  pr.position.set(0.05, piso, 0.25);
  pr.rotation.set(-0.14, (aleatorio() - 0.5) * 0.4, 0);
  g.add(pr);
  caixa(0.18, 0.23, 0.02, COR.madeiraEscura, 0, 0, 0, pr, { seg: 0 });
  const foto = new THREE.Mesh(geoPlano(0.14, 0.19), materialArte(escolher(['campo', 'mar', 'horizonte'])));
  foto.position.set(0, 0.115, 0.011);
  pr.add(foto);
  planta(larg / 2 - 0.3, ZF, 1.1, COR.offWhite, 'suculenta', g, piso);
}

export function sofa(x, z, rot, lugares = 3, cor = 0x9cbf95, pai = E.cena) {
  const g = grupo(x, z, rot, pai);
  const larg = lugares * 0.75 + 0.3;
  caixa(larg, 0.32, 0.85, cor, 0, 0.1, 0, g);
  caixa(larg, 0.55, 0.22, cor, 0, 0.35, -0.32, g);
  caixa(0.18, 0.42, 0.85, cor, -larg / 2 + 0.09, 0.1, 0, g);
  caixa(0.18, 0.42, 0.85, cor, larg / 2 - 0.09, 0.1, 0, g);
  const vagas = [];
  for (let i = 0; i < lugares; i++) {
    const lx = -larg / 2 + 0.525 + i * 0.75;
    caixa(0.68, 0.12, 0.6, 0xc6dcbc, lx, 0.42, 0.06, g);
    vagas.push({ pos: noMundo(g, lx, 0.1), olhar: rot, pose: 'sentado', alturaAssento: 0.11 });
  }
  caixa(0.4, 0.34, 0.12, 0xe6a93a, -larg / 2 + 0.5, 0.52, -0.16, g);
  caixa(0.4, 0.34, 0.12, 0xe6a93a, larg / 2 - 0.5, 0.52, -0.16, g);
  return vagas;
}

export function tapete(x, z, w, d, cor, pai = E.cena) { return caixa(w, 0.02, d, cor, x, 0.006, z, pai, { sombra: false }); }

// Capacho liso de fibra, sem texto (VIS-10, ID-10)
export function capacho(x, z, girar = false, larg = 1.0, prof = 0.5) {
  return caixa(girar ? prof : larg, 0.02, girar ? larg : prof, COR.fibra, x, 0.028, z, E.cena, { sombra: false, mat: { roughness: 1 } });
}

// ---------------------------------------------------------------------------
// Luminárias e luz no piso (VIS-06, VAZIO-09): sem PointLight
// ---------------------------------------------------------------------------
let texturaPoca = null;
function gradienteRadial() {
  if (texturaPoca) return texturaPoca;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,222,170,1)');
  grad.addColorStop(0.45, 'rgba(255,214,160,0.55)');
  grad.addColorStop(1, 'rgba(255,205,150,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  texturaPoca = compartilhada(texturaDeCanvas(c));
  return texturaPoca;
}

// Plano de luz quente no piso, sem borda e fora do mapa de caminhos
function planoDeLuz(x, z, w, d, pai, opacidade = 0) {
  const material = new THREE.MeshBasicMaterial({ map: gradienteRadial(), color: 0xffe2b8, transparent: true, depthWrite: false, opacity: opacidade });
  const m = new THREE.Mesh(geoPlano(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.03, z);
  m.visible = opacidade > 0;
  semMapa(m);
  pai.add(m);
  return m;
}

let contadorLuz = 0;
function luzDeCupula(cupula, poca) {
  const chave = 'luz:' + (++contadorLuz);
  cupula.userData.aoLiberar = () => { cancelarTweens(chave + ':c'); cancelarTweens(chave + ':p'); };
  const luz = {
    cupula, poca, nivel: 0,
    definirNivel(n, { instantaneo = false } = {}) {
      n = Math.max(0, Math.min(1, n || 0));
      luz.nivel = n;
      if (instantaneo) {
        cancelarTweens(chave + ':c'); cancelarTweens(chave + ':p');
        cupula.material.emissiveIntensity = 1.2 * n;
        poca.material.opacity = 0.22 * n;
        poca.visible = n > 0;
        return;
      }
      if (n > 0) poca.visible = true;
      tween({ obj: cupula.material, prop: 'emissiveIntensity', para: 1.2 * n, dur: 0.6, ease: 'easeInOutSine', chave: chave + ':c' });
      tween({ obj: poca.material, prop: 'opacity', para: 0.22 * n, dur: 0.6, ease: 'easeInOutSine', chave: chave + ':p',
        aoFim: n > 0 ? undefined : () => { poca.visible = false; } });
    },
  };
  return luz;
}

// Pendente: só a luz (a cúpula de cerâmica ficou invisível em 03/10). base = altura da boca da cúpula.
// poca = { x, z, w, d } (padrão: 1,6 x 1,6 embaixo da luminária)
export function pendente(x, z, altParede, pai = E.cena, { base = altParede - 1.45, poca = null } = {}) {
  const ALT = 0.24;
  // Sem fio e sem cúpula à mostra (pedido do Eduardo, 03/10): na vista isométrica, sem
  // teto, a cúpula pendurada ficava flutuando e entrava na frente dos capacetes. Fica só
  // a poça de luz quente no chão, que acende com o trabalho; a cúpula existe invisível
  // porque é ela que guarda o brilho (luzDeCupula).
  const material = new THREE.MeshStandardMaterial({ color: 0xece6dc, roughness: 0.55, emissive: COR.luzQuente, emissiveIntensity: 0 });
  const cupula = new THREE.Mesh(geoCilindro(0.07, 0.24, ALT, 20), material);
  cupula.position.set(x, base + ALT / 2, z);
  cupula.visible = false;
  cupula.castShadow = false;
  pai.add(cupula);
  const p = poca || { x, z, w: 1.6, d: 1.6 };
  return luzDeCupula(cupula, planoDeLuz(p.x, p.z, p.w, p.d, pai));
}

// Luminária de pé (Descanso): sempre acesa, com poça própria
// poca: deslocamento e tamanho da poça de luz (padrão: 0,2 e 0,3 ao lado, 1,8 m)
export function luminariaPe(x, z, pai = E.cena, { poca = { dx: 0.2, dz: 0.3, tam: 1.8 } } = {}) {
  cilindro(0.15, 0.16, 0.03, COR.grafiteClaro, x, 0, z, pai, 18);
  cilindro(0.014, 0.014, 1.42, COR.grafiteClaro, x, 0.03, z, pai, 8);
  const material = new THREE.MeshStandardMaterial({ color: COR.linho, roughness: 0.8, emissive: COR.luzQuente, emissiveIntensity: 0 });
  const cupula = new THREE.Mesh(geoCilindro(0.13, 0.19, 0.26, 20), material);
  cupula.position.set(x, 1.45 + 0.13, z);
  cupula.castShadow = true;
  pai.add(cupula);
  const luz = luzDeCupula(cupula, planoDeLuz(x + poca.dx, z + poca.dz, poca.tam, poca.tam, pai));
  luz.definirNivel(1, { instantaneo: true });
  return luz;
}

// ---------------------------------------------------------------------------
// Quadros, arte e relógio (VIS-03, VIS-07)
// ---------------------------------------------------------------------------
export const ARTES_TV = ['horizonte', 'mar', 'planeta', 'campo'];

function circulo(g, x, y, r, cor) { g.fillStyle = cor; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function morro(g, W, H, y0, y1, amp, cor, fase = 0) {
  g.fillStyle = cor;
  g.beginPath();
  g.moveTo(0, H);
  g.lineTo(0, y0);
  g.bezierCurveTo(W * (0.25 + fase), y0 - amp, W * (0.55 + fase), y1 + amp, W, y1);
  g.lineTo(W, H);
  g.closePath();
  g.fill();
}
function ceu(g, W, H, de, para, ate = 1) {
  const grad = g.createLinearGradient(0, 0, 0, H * ate);
  grad.addColorStop(0, de); grad.addColorStop(1, para);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

// Arte minimalista dessaturada (areia, sálvia, terracota, azul-acinzentado)
function desenharArte(g, tipo, W, H) {
  const r = sorteio(hash(tipo));
  if (tipo === 'horizonte') {
    ceu(g, W, H, '#f1e9db', '#e8dcc6');
    circulo(g, W * 0.68, H * 0.4, H * 0.12, '#dcc49c');
    morro(g, W, H, H * 0.66, H * 0.6, H * 0.1, '#bcd1b3');
    morro(g, W, H, H * 0.82, H * 0.72, H * 0.08, '#a8c39f', 0.1);
    g.fillStyle = '#93b08a'; g.fillRect(0, H * 0.9, W, H * 0.1);
  } else if (tipo === 'mar') {
    ceu(g, W, H, '#8fa3bf', '#c3cddb', 0.62);
    circulo(g, W * 0.3, H * 0.3, H * 0.08, '#efe7d6');
    const grad = g.createLinearGradient(0, H * 0.62, 0, H);
    grad.addColorStop(0, '#8196b2'); grad.addColorStop(1, '#6f86a5');
    g.fillStyle = grad; g.fillRect(0, H * 0.62, W, H * 0.38);
    g.fillStyle = 'rgba(239,231,214,0.55)';
    for (let i = 0; i < 5; i++) {
      const w = W * (0.12 - i * 0.018), y = H * (0.67 + i * 0.06);
      g.beginPath(); g.roundRect?.(W * 0.3 - w / 2, y, w, H * 0.012, H * 0.006); g.fill();
    }
  } else if (tipo === 'planeta') {
    ceu(g, W, H, '#ece3d2', '#e3d6bf');
    for (let i = 0; i < 22; i++) circulo(g, r() * W, r() * H, 1.5 + r() * 2.5, 'rgba(160,140,110,0.45)');
    const cx = W * 0.5, cy = H * 0.52, rp = H * 0.2;
    g.strokeStyle = '#8fa3bf'; g.lineWidth = H * 0.025;
    g.beginPath(); g.ellipse(cx, cy, rp * 1.9, rp * 0.45, -0.25, Math.PI, Math.PI * 2); g.stroke();
    circulo(g, cx, cy, rp, '#c98a6a');
    g.fillStyle = 'rgba(255,240,220,0.18)';
    g.beginPath(); g.arc(cx - rp * 0.25, cy - rp * 0.25, rp * 0.7, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx, cy, rp * 1.9, rp * 0.45, -0.25, 0, Math.PI); g.stroke();
  } else if (tipo === 'campo') {
    ceu(g, W, H, '#f1e9db', '#e3d7c1');
    g.fillStyle = '#a8c39f';
    g.beginPath(); g.ellipse(W * 0.5, H * 1.25, W * 0.85, H * 0.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#95b38c';
    g.beginPath(); g.ellipse(W * 0.2, H * 1.3, W * 0.6, H * 0.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8a6a52'; g.fillRect(W * 0.63, H * 0.42, W * 0.018, H * 0.28);
    circulo(g, W * 0.64, H * 0.4, H * 0.13, '#8fae86');
    circulo(g, W * 0.6, H * 0.46, H * 0.09, '#9dbb93');
  } else if (tipo === 'mapa') {
    g.fillStyle = '#b8c7d6'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(1, W / 400);
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, H * i / 6); g.lineTo(W, H * i / 6); g.stroke(); }
    for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(W * i / 10, 0); g.lineTo(W * i / 10, H); g.stroke(); }
    g.fillStyle = '#e8dcc6';
    // continentes estilizados (elipses tortas)
    for (const [x, y, rx, ry, a] of [[0.22, 0.3, 0.1, 0.13, 0.3], [0.28, 0.66, 0.06, 0.15, -0.2], [0.5, 0.28, 0.06, 0.08, 0],
      [0.52, 0.58, 0.07, 0.15, 0.1], [0.7, 0.32, 0.17, 0.12, -0.1], [0.82, 0.72, 0.06, 0.05, 0]]) {
      g.beginPath(); g.ellipse(W * x, H * y, W * rx, H * ry, a, 0, Math.PI * 2); g.fill();
    }
  } else {
    // abstrato: formas soltas para os quadrinhos
    g.fillStyle = '#f1ece2'; g.fillRect(0, 0, W, H);
    const v = tipo === 'abstrato2';
    g.fillStyle = v ? '#a8c39f' : '#c98a6a';
    g.beginPath(); g.arc(W * 0.5, H * (v ? 0.62 : 0.45), W * 0.3, Math.PI, 0); g.fill();
    g.fillStyle = v ? '#8fa3bf' : '#e8dcc6';
    g.fillRect(W * 0.2, H * (v ? 0.66 : 0.5), W * 0.6, H * 0.12);
    circulo(g, W * (v ? 0.3 : 0.7), H * 0.25, W * 0.08, v ? '#c98a6a' : '#8fa3bf');
  }
}

const artes = new Map();
function materialArte(tipo) {
  if (!artes.has(tipo)) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    desenharArte(c.getContext('2d'), tipo, 256, 256);
    artes.set(tipo, compartilhada(new THREE.MeshStandardMaterial({ map: compartilhada(texturaDeCanvas(c)), roughness: 0.85 })));
  }
  return artes.get(tipo);
}

// Quadro na parede. y = base da moldura. parede 'fundo' (ZN, de frente) ou 'lateral' (X0).
export function quadroFundo(x, y, z, larg, alt, cor = COR.areia, { moldura = COR.madeiraMedia, arte = null, parede = 'fundo', pai = E.cena } = {}) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (parede === 'lateral') g.rotation.y = Math.PI / 2;
  semMapa(g);
  g.userData.parede = true;
  pai.add(g);
  caixa(larg + 0.08, alt + 0.08, 0.035, moldura, 0, 0, 0.018, g, { seg: 0 });
  const tela = new THREE.Mesh(geoPlano(larg, alt), arte ? materialArte(arte) : mat(cor));
  tela.position.set(0, alt / 2 + 0.04, 0.04);
  tela.receiveShadow = true;
  g.add(tela);
  return g;
}

// Relógio de parede redondo (10h10, parado)
let materialRelogio = null;
export function relogioParede(x, y, z, raio = 0.17, pai = E.cena) {
  if (!materialRelogio) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#f4efe6'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#3a3f4f'; g.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, l = i % 3 ? 14 : 24;
      g.lineWidth = i % 3 ? 4 : 7;
      g.beginPath(); g.moveTo(128 + Math.sin(a) * 112, 128 - Math.cos(a) * 112);
      g.lineTo(128 + Math.sin(a) * (112 - l), 128 - Math.cos(a) * (112 - l)); g.stroke();
    }
    g.lineWidth = 9;
    g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(-Math.PI / 3) * 60, 128 - Math.cos(-Math.PI / 3) * 60); g.stroke();
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(Math.PI / 3) * 90, 128 - Math.cos(Math.PI / 3) * 90); g.stroke();
    circulo(g, 128, 128, 8, '#3a3f4f');
    materialRelogio = compartilhada(new THREE.MeshStandardMaterial({ map: compartilhada(texturaDeCanvas(c)), roughness: 0.6 }));
  }
  const g = new THREE.Group();
  g.position.set(x, y, z);
  semMapa(g);
  g.userData.parede = true;
  pai.add(g);
  const fundo = new THREE.Mesh(geoCilindro(raio, raio, 0.04, 28), mat(COR.grafite));
  fundo.rotation.x = Math.PI / 2;
  fundo.position.z = 0.02;
  const aro = new THREE.Mesh(geoCompartilhada('aro|' + k4(raio), () => new THREE.TorusGeometry(raio, 0.016, 8, 32)), mat(COR.grafite));
  aro.position.z = 0.04;
  const face = new THREE.Mesh(geoCompartilhada('face|' + k4(raio), () => new THREE.CircleGeometry(raio * 0.95, 32)), materialRelogio);
  face.position.z = 0.045;
  fundo.castShadow = true;
  g.add(fundo, aro, face);
  return g;
}

// ---------------------------------------------------------------------------
// Textos em canvas: letras de parede, placa da ilha e nome de serviço
// ---------------------------------------------------------------------------
function desenharTexto(c, texto, { fundo = null, trama = false, cor = '#3b2a1c', peso = 700, caixaAlta = true, fracao = 0.36, espaco = 0.12 } = {}) {
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (fundo) {
    g.fillStyle = fundo;
    g.fillRect(0, 0, c.width, c.height);
    if (trama) {
      // trama de fibra: pontinhos claros e escuros
      const r = sorteio(7);
      for (let n = 0; n < 9000; n++) {
        g.fillStyle = n % 2 ? 'rgba(255,240,210,0.10)' : 'rgba(60,35,10,0.10)';
        g.fillRect(r() * c.width, r() * c.height, 3, 2);
      }
    }
  }
  const t = caixaAlta ? texto.toUpperCase() : texto;
  g.fillStyle = cor;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let tam = Math.round(c.height * fracao);
  do {
    g.font = `${peso} ${tam}px Figtree, -apple-system, "Helvetica Neue", sans-serif`;
    if ('letterSpacing' in g) g.letterSpacing = `${Math.round(tam * espaco)}px`;
    tam -= 2;
  } while (g.measureText(t).width > c.width * 0.86 && tam > 12);
  g.fillText(t, c.width / 2, c.height / 2 + Math.round(c.height * 0.02));
}

// opções: fundo, trama (fibra), cor, peso, caixaAlta, fracao (altura da letra), espaco, largura do canvas
export function texturaTexto(texto, proporcao, opcoes = {}) {
  const c = document.createElement('canvas');
  c.width = opcoes.largura || 1024; c.height = Math.round(c.width * proporcao);
  desenharTexto(c, texto, opcoes);
  const tx = texturaDeCanvas(c);
  // guardado fora do userData (Texture.clone copia o userData como JSON)
  tx.redesenho = aoCarregarFontes(() => { desenharTexto(c, texto, opcoes); tx.needsUpdate = true; });
  return tx;
}

// Letras adesivadas na parede do fundo (CAM-06): plano de 0,45 de altura, letra a 45%
export function placaParede(texto, x, larg = 1.8, cor = '#2a2e45', pai = E.cena, z = E.ZN) {
  const alt = 0.45;
  const letras = new THREE.Mesh(geoPlano(larg, alt),
    new THREE.MeshStandardMaterial({ map: texturaTexto(texto, alt / larg, { cor, peso: 700, fracao: 0.45 }), transparent: true, roughness: 0.9 }));
  letras.position.set(x, ALT_PAREDE - 0.48, z + 0.012);
  semMapa(letras);
  letras.userData.parede = true;
  pai.add(letras);
  return letras;
}

// Letreiro de parede com texto que muda (F2: nome da pasta na parede da sala dela): as
// mesmas letras adesivadas da placaParede, redesenhadas no canvas. definir(texto)
// troca o texto; sem texto, o letreiro some.
export function letreiroParede(x, larg = 2.2, cor = '#2a2e45', pai = E.cena, z = E.ZN) {
  const alt = 0.45;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = Math.round(1024 * alt / larg);
  const tx = texturaDeCanvas(c);
  const malha = new THREE.Mesh(geoPlano(larg, alt), new THREE.MeshStandardMaterial({ map: tx, transparent: true, roughness: 0.9 }));
  malha.position.set(x, ALT_PAREDE - 0.48, z + 0.012);
  semMapa(malha);
  malha.userData.parede = true;
  malha.visible = false;
  pai.add(malha);
  const opcoes = { cor, peso: 700, fracao: 0.45 };
  const l = { malha, texto: null };
  const desenhar = () => { if (l.texto) { desenharTexto(c, l.texto, opcoes); tx.needsUpdate = true; } };
  l.definir = texto => {
    texto = texto ? String(texto) : null;
    if (texto === l.texto) return;
    l.texto = texto;
    malha.visible = !!texto;
    desenhar();
  };
  malha.userData.redesenho = aoCarregarFontes(desenhar);
  return l;
}

// ---------------------------------------------------------------------------
// Janela com céu, cortinas, rodapé e sol no piso (VIS-09, fase 1; sem tijolo)
// ---------------------------------------------------------------------------
let materialCeu = null;
function vidroComCeu() {
  if (materialCeu) return materialCeu;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  ceu(g, 256, 256, '#cfe0f0', '#f3eadb');
  // silhuetas de prédios bem claras
  const r = sorteio(99);
  for (const [cor, base] of [['rgba(214,224,236,0.9)', 0.62], ['rgba(226,232,238,0.95)', 0.74]]) {
    let x = -10;
    while (x < 256) {
      const w = 18 + r() * 34, h = 256 * (0.12 + r() * 0.26);
      g.fillStyle = cor;
      g.fillRect(x, 256 * base - h + 256 * (1 - base), w, h);
      x += w + 2 + r() * 8;
    }
  }
  materialCeu = compartilhada(new THREE.MeshStandardMaterial({ map: compartilhada(texturaDeCanvas(c)), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0.35, roughness: 0.2 }));
  materialCeu.emissiveMap = materialCeu.map;
  // cena.js deixa as janelas um pouco mais claras no fim de tarde
  (E.janelas ||= []).push(materialCeu);
  return materialCeu;
}

// Duas cortinas de linho, cada uma com 3 dobras (cilindros achatados), numa geometria só
function geoCortinas(larg, alt) {
  return geoCompartilhada(`cortinas|${k4(larg)}|${k4(alt)}`, () => {
    const partes = [];
    for (const lado of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const dobra = new THREE.CylinderGeometry(0.055, 0.065, alt, 10);
        dobra.scale(1, 1, 0.45);
        dobra.translate(lado * (larg / 2 + 0.06 + i * 0.085), alt / 2, 0);
        partes.push(dobra);
      }
    }
    const g = mergeGeometries(partes);
    partes.forEach(p => p.dispose());
    return g;
  });
}

let materialSol = null;
export function janela(x, larg = 2.2, pai = E.cena, z = E.ZN) {
  const j = new THREE.Group();
  j.userData.parede = true;
  pai.add(j);
  caixa(larg + 0.16, 1.5, 0.08, 0xffffff, x, 0.9, z + 0.03, j);
  const vidro = new THREE.Mesh(geoPlano(larg, 1.34), vidroComCeu());
  vidro.position.set(x, 0.98 + 0.67, z + 0.075);
  j.add(vidro);
  caixa(0.06, 1.34, 0.1, 0xffffff, x, 0.98, z + 0.1, j);
  semMapa(caixa(larg + 0.3, 0.035, 0.12, 0xffffff, x, 0.86, z + 0.06, j, { seg: 0 }));   // peitoril
  // cortinas e varão
  const altCortina = 1.95;
  const cortinas = new THREE.Mesh(geoCortinas(larg, altCortina), mat(COR.cortina, { roughness: 0.95 }));
  cortinas.position.set(x, 0.58, z + 0.17);
  cortinas.castShadow = cortinas.receiveShadow = true;
  semMapa(cortinas);
  j.add(cortinas);
  const varao = new THREE.Mesh(geoCilindro(0.012, 0.012, larg + 0.75, 8), mat(COR.grafiteClaro));
  varao.rotation.z = Math.PI / 2;
  varao.position.set(x, 0.58 + altCortina + 0.03, z + 0.17);
  semMapa(varao);
  j.add(varao);
  // mancha de sol quente e sem borda no piso, em frente à janela
  materialSol ||= compartilhada(new THREE.MeshBasicMaterial({ map: gradienteRadial(), color: 0xffe6c0, transparent: true, depthWrite: false, opacity: 0.17 }));
  const sol = new THREE.Mesh(geoPlano(larg * 1.15, 1.6), materialSol);
  sol.rotation.set(-Math.PI / 2, 0, 0.12);
  sol.position.set(x + 0.15, 0.029, z + 1.0);
  semMapa(sol);
  j.add(sol);
  return j;
}

// Rodapé de 0,08 m em madeira média (paredes altas)
export function rodape(xa, za, xb, zb, pai = E.cena) {
  const w = Math.max(0.02, xb - xa), d = Math.max(0.02, zb - za);
  const r = semMapa(caixa(w, 0.08, d, COR.madeiraMedia, (xa + xb) / 2, 0, (za + zb) / 2, pai, { seg: 0, sombra: false }));
  r.userData.parede = true;
  return r;
}

// ---------------------------------------------------------------------------
// Placa da ilha (CAM-04, ID-05): acima dos monitores, presa por duas hastes
// finas na divisória; invisível (com a moldura) enquanto a ilha está livre
// ---------------------------------------------------------------------------
export function placaIlha(x, z, pai = E.cena, { topoDivisoria = 1.15, larg = 1.3 } = {}) {
  const alt = 0.29, base = 1.52;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  pai.add(g);
  const hx0 = larg / 2 - 0.2;   // hastes a 0,2 da borda (0,45 na placa de 1,3)
  for (const hx of [-hx0, hx0]) {
    const h = cilindro(0.01, 0.01, base - topoDivisoria, COR.grafiteClaro, hx, topoDivisoria, 0, g, 6);
    h.castShadow = false;
  }
  caixa(larg + 0.04, alt + 0.04, 0.03, COR.navy, 0, base, 0, g, { seg: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = Math.round(768 * alt / larg);
  const textura = texturaDeCanvas(canvas);
  const material = new THREE.MeshStandardMaterial({ map: textura, emissive: 0xffffff, emissiveMap: textura, emissiveIntensity: 0, roughness: 0.4 });
  const frente = new THREE.Mesh(geoPlano(larg, alt), material);
  frente.position.set(0, base + 0.02 + alt / 2, 0.02);
  g.add(frente);
  const placa = { canvas, textura, material, texto: undefined, grupo: g };
  mostrarNaPlaca(placa, null);
  g.userData.redesenho = aoCarregarFontes(() => { const t = placa.texto; placa.texto = undefined; mostrarNaPlaca(placa, t); });
  return placa;
}

export function mostrarNaPlaca(placa, texto) {
  if (placa.texto === texto) return;
  placa.texto = texto;
  const { canvas, textura, material } = placa;
  if (placa.grupo) placa.grupo.visible = !!texto;
  if (!texto) { material.emissiveIntensity = 0; return; }
  const g = canvas.getContext('2d');
  g.fillStyle = '#030870';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let tam = Math.round(canvas.height * 0.5);
  do { g.font = `800 ${tam}px Figtree, -apple-system, sans-serif`; tam -= 2; } while (g.measureText(texto).width > canvas.width - 70 && tam > 18);
  g.fillText(texto, canvas.width / 2, canvas.height * 0.45);
  g.fillStyle = '#ee4c01';
  g.fillRect(canvas.width / 2 - 22, canvas.height * 0.8, 44, 6);
  material.emissiveIntensity = 0.8;
  textura.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// TV (VIS-03, ID-02, CAM-06, ID-09): sem conector vira quadro; com conector,
// mostra o nome grande, com fade
// ---------------------------------------------------------------------------
let contadorTv = 0;
export function tvCowork(s, x, z, pai = E.cena) {
  caixa(1.4, 0.45, 0.42, COR.madeiraMedia, x, 0, z, pai);
  caixa(0.08, 0.12, 0.08, COR.grafiteClaro, x, 0.45, z, pai);
  caixa(1.5, 0.86, 0.06, COR.grafiteClaro, x, 0.55, z, pai, { seg: 1 });
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 576;
  const textura = texturaDeCanvas(canvas);
  const material = new THREE.MeshStandardMaterial({ map: textura, emissive: 0xffffff, emissiveMap: textura, emissiveIntensity: 0.12, roughness: 0.5 });
  const tela = new THREE.Mesh(geoPlano(1.42, 0.8), material);
  tela.position.set(x, 0.55 + 0.43, z + 0.035);
  pai.add(tela);
  const tv = { canvas, textura, material, pasta: undefined, legenda: '', arte: escolher(ARTES_TV), chave: 'tv:' + (++contadorTv), alvo: 0.12, _nivel: 1 };
  // nivel de 0 a 1 escurece a tela inteira (cor e brilho) durante a troca
  Object.defineProperty(tv, 'nivel', {
    get() { return tv._nivel; },
    set(n) { tv._nivel = n; material.color.setScalar(0.3 + 0.7 * n); material.emissiveIntensity = tv.alvo * n; },
  });
  s.tv = tv;
  mostrarNaTv(s, null, '', { instantaneo: true });
  tela.userData.redesenho = aoCarregarFontes(() => desenharTv(tv));
  tela.userData.aoLiberar = () => cancelarTweens(tv.chave);
  return tv;
}

function quebrarEmDuas(g, texto, maxW) {
  const palavras = texto.split(/\s+/);
  if (palavras.length < 2) {
    const meio = Math.ceil(texto.length / 2);
    return [texto.slice(0, meio), texto.slice(meio)];
  }
  let melhor = null;
  for (let i = 1; i < palavras.length; i++) {
    const a = palavras.slice(0, i).join(' '), b = palavras.slice(i).join(' ');
    const w = Math.max(g.measureText(a).width, g.measureText(b).width);
    if (!melhor || w < melhor.w) melhor = { w, linhas: [a, b] };
  }
  return melhor.linhas;
}

function desenharTv(tv) {
  const { canvas, textura } = tv;
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  if (!tv.pasta) {
    // modo quadro: moldura fina clara e arte dessaturada
    g.fillStyle = '#f4efe6';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(22, 22);
    g.beginPath(); g.rect(0, 0, W - 44, H - 44); g.clip();
    desenharArte(g, tv.arte, W - 44, H - 44);
    g.restore();
  } else {
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#030870'); grad.addColorStop(1, '#0038ef');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const centro = tv.legenda ? H * 0.54 : H * 0.48;
    if (tv.legenda) {
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.font = '600 40px Figtree, -apple-system, sans-serif';
      g.fillText(tv.legenda, W / 2, H * 0.17);
    }
    // nome até ~45% da altura, em uma ou duas linhas
    const maxW = W - 160;
    let linhas = [tv.pasta], tam = 196;
    const fonte = t => `800 ${t}px Figtree, -apple-system, sans-serif`;
    do { g.font = fonte(tam); tam -= 4; } while (g.measureText(tv.pasta).width > maxW && tam > 116);
    if (g.measureText(tv.pasta).width > maxW) {
      tam = 124;
      g.font = fonte(tam);
      linhas = quebrarEmDuas(g, tv.pasta, maxW);
      while (Math.max(...linhas.map(l => g.measureText(l).width)) > maxW && tam > 48) { tam -= 4; g.font = fonte(tam); }
    } else tam += 4;
    const alturaLinha = tam * 1.04;
    g.fillStyle = '#ffffff';
    linhas.forEach((l, i) => g.fillText(l, W / 2, centro + (i - (linhas.length - 1) / 2) * alturaLinha));
    g.fillStyle = '#ee4c01';
    g.fillRect(W / 2 - 40, centro + (linhas.length / 2) * alturaLinha + 18, 80, 10);
  }
  textura.needsUpdate = true;
}

// texto = nome do conector (ou null para o modo quadro); legenda vazia por padrão
export function mostrarNaTv(s, texto, legenda = '', { instantaneo = false } = {}) {
  const tv = s.tv;
  texto = texto || null;
  if (tv.pasta === texto && tv.legenda === legenda) return;
  tv.pasta = texto;
  tv.legenda = legenda || '';
  const alvo = texto ? 0.85 : 0.12;
  if (instantaneo) {
    cancelarTweens(tv.chave);
    desenharTv(tv);
    tv.alvo = alvo;
    tv.nivel = 1;
    return;
  }
  // apaga, troca o desenho no meio e acende de novo (0,5 s no total)
  tween({ obj: tv, prop: 'nivel', para: 0, dur: 0.25, ease: 'easeInCubic', chave: tv.chave, aoFim: () => {
    desenharTv(tv);
    tv.alvo = tv.pasta ? 0.85 : 0.12;
    tween({ obj: tv, prop: 'nivel', para: 1, dur: 0.25, ease: 'easeOutCubic', chave: tv.chave });
  } });
}

// ---------------------------------------------------------------------------
// Piso de madeira em tábuas (VIS-05): uma textura de 512 px com tábuas de
// 0,18 m ao longo de x, variação de ±4% por tábua e junta 1 px mais escura.
// A cor da madeira vem do material; o material é guardado por cor e tamanho
// (módulos do mesmo tipo dividem o mesmo).
// ---------------------------------------------------------------------------
const LADO_TEXTURA_PISO = 2.88;   // metros cobertos pela imagem (16 tábuas de 0,18)
let tabuasBase = null;
function texturaTabuas() {
  if (tabuasBase) return tabuasBase;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const r = sorteio(1803);
  const ALT = 32;   // 0,18 m em pixels
  for (let y = 0; y < 512; y += ALT) {
    let x = -Math.floor(r() * 300);
    while (x < 512) {
      const comp = 150 + Math.floor(r() * 230);
      const f = 0.96 + r() * 0.08;   // ±4% de luminosidade
      const v = Math.round(240 * f);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, comp, ALT);
      // veios discretos
      g.fillStyle = 'rgba(0,0,0,0.035)';
      for (let k = 0; k < 3; k++) g.fillRect(x + 4, y + 5 + Math.floor(r() * (ALT - 10)), comp - 8, 1);
      // junta de topo
      g.fillStyle = 'rgba(60,40,20,0.22)';
      g.fillRect(x + comp - 1, y, 1, ALT);
      x += comp;
    }
    // junta comprida entre as fileiras
    g.fillStyle = 'rgba(60,40,20,0.22)';
    g.fillRect(0, y + ALT - 1, 512, 1);
  }
  tabuasBase = compartilhada(texturaDeCanvas(c));
  tabuasBase.wrapS = tabuasBase.wrapT = THREE.RepeatWrapping;
  return tabuasBase;
}

const materiaisPiso = new Map();
// Material de piso de madeira para uma placa de w x d metros. x0Mundo (opcional): a
// borda esquerda da placa no mundo; as tábuas ficam alinhadas ao mundo, e duas placas
// vizinhas da mesma sala continuam o mesmo desenho, sem emenda (F2)
export function materialPiso(cor, w, d, x0Mundo = null) {
  const fase = x0Mundo == null ? 0 : (((x0Mundo / LADO_TEXTURA_PISO) % 1) + 1) % 1;
  const chave = cor + '|' + k4(w) + '|' + k4(d) + '|' + k4(fase);
  let m = materiaisPiso.get(chave);
  if (!m) {
    const tx = texturaTabuas().clone();
    tx.repeat.set(w / LADO_TEXTURA_PISO, d / LADO_TEXTURA_PISO);
    tx.offset.x = fase;
    compartilhada(tx);
    // a imagem tem 94% de brilho médio: a cor sobe um pouco para compensar
    const base = new THREE.Color(cor);
    base.r = Math.min(1, base.r * 1.06); base.g = Math.min(1, base.g * 1.06); base.b = Math.min(1, base.b * 1.06);
    m = compartilhada(new THREE.MeshStandardMaterial({ color: base, map: tx, roughness: 0.82, metalness: 0 }));
    materiaisPiso.set(chave, m);
  }
  return m;
}

// Placa de piso de madeira (topo em y = 0), sem sombra. continuo (F2, salas de pasta
// que se fundem): borda reta, sem chanfro, e tábuas alinhadas ao mundo pela borda
// esquerda x0Mundo, para dois módulos da mesma sala virarem um piso só, sem linha
export function piso(w, d, cor, x, z, pai = E.cena, { continuo = false, x0Mundo = null } = {}) {
  return caixa(w, 0.06, d, cor, x, -0.06, z, pai, { sombra: false, seg: continuo ? 0 : undefined,
    material: materialPiso(cor, w, d, continuo ? x0Mundo : null) });
}

// ---------------------------------------------------------------------------
// Jardim (vaga sem módulo no meio da estação): canteiro baixo e luminária
// ---------------------------------------------------------------------------
// Canteiro de madeira com terra e plantas, sem banco nem assento
export function canteiro(x, z, w, d, pai = E.cena) {
  const g = grupo(x, z, 0, pai);
  const ALT = 0.34;
  caixa(w, ALT, d, 0xb9a48a, 0, 0, 0, g);
  caixa(w - 0.16, 0.03, d - 0.16, 0x5b4332, 0, ALT - 0.015, 0, g, { seg: 0, sombra: false });
  const tipos = ['folhaLarga', 'ficus', 'folhaLarga', 'suculenta'];
  const n = Math.max(2, Math.round(w / 1.1));
  for (let i = 0; i < n; i++) {
    const t = tipos[(i + Math.floor(aleatorio() * 4)) % tipos.length];
    const px = -w / 2 + (i + 0.5) * (w / n) + (aleatorio() - 0.5) * 0.2;
    const pz = (aleatorio() - 0.5) * (d - 0.7);
    const esc = t === 'suculenta' ? 2.2 : t === 'ficus' ? 0.75 : 0.85 + aleatorio() * 0.2;
    planta(px, pz, esc, 0x6b4a33, t, g, ALT - 0.08);
  }
  return g;
}

// Luminária de jardim: haste baixa com globo quente (brilho fixo, sem luz de verdade)
export function luminariaJardim(x, z, pai = E.cena) {
  const g = grupo(x, z, 0, pai);
  cilindro(0.07, 0.08, 0.04, COR.grafite, 0, 0, 0, g, 12);
  cilindro(0.018, 0.018, 0.62, COR.grafite, 0, 0.04, 0, g, 8);
  const globo = new THREE.Mesh(geoCompartilhada('globoJardim', () => new THREE.SphereGeometry(0.09, 16, 12)),
    mat(0xfff1d6, { emissive: COR.luzQuente, emissiveIntensity: 0.9, roughness: 0.4 }));
  globo.position.y = 0.75;
  globo.castShadow = false;
  g.add(globo);
  return g;
}

// Aparador baixo de madeira com livros e uma suculenta em cima
export function aparador(x, z, rot, larg = 1.3, pai = E.cena) {
  const g = grupo(x, z, rot, pai);
  caixa(larg, 0.62, 0.4, COR.madeiraMedia, 0, 0, 0, g);
  pilhaLivros(g, -larg / 2 + 0.25, 0.62, 0);
  planta(larg / 2 - 0.25, 0, 1.6, COR.offWhite, 'suculenta', g, 0.62);
  return g;
}

// Plaquinha com o nome do dono na mesa do comandante (texto pequeno, sem logo)
export function plaquinhaNome(texto, x, y, z, pai = E.cena) {
  const larg = 0.36, alt = 0.085;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.x = -0.35;
  pai.add(g);
  caixa(larg + 0.02, alt + 0.02, 0.025, COR.madeiraEscura, 0, -alt / 2 - 0.01, -0.014, g, { seg: 0, sombra: false });
  const tx = texturaTexto(texto, alt / larg, { fundo: '#f4efe6', cor: '#2a2e45', peso: 700, caixaAlta: false, fracao: 0.5, largura: 512, espaco: 0.02 });
  const frente = new THREE.Mesh(geoPlano(larg, alt), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.7 }));
  g.add(frente);
  return g;
}

// ---------------------------------------------------------------------------
// Descarte (módulo que desacopla): geometrias, materiais e texturas exclusivos
// ---------------------------------------------------------------------------
function liberarTextura(t) {
  if (!t || t.userData?.compartilhada) return;
  if (t.redesenho) { redesenhos.delete(t.redesenho); t.redesenho = null; }
  t.dispose();
}

// Descarta tudo o que é só desta árvore de objetos. Compartilhados ficam.
// Devolve quantas geometrias, materiais e texturas foram descartados.
export function liberarObjeto(raiz) {
  const conta = { geometrias: 0, materiais: 0, texturas: 0 };
  const vistos = new Set();
  raiz.traverse(o => {
    o.userData.aoLiberar?.();
    if (o.userData.redesenho) { redesenhos.delete(o.userData.redesenho); o.userData.redesenho = null; }
    const geo = o.geometry;
    if (geo && !geo.userData?.compartilhada && !vistos.has(geo)) { vistos.add(geo); geo.dispose(); conta.geometrias++; }
    const lista = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of lista) {
      if (m.userData?.compartilhada || vistos.has(m)) continue;
      vistos.add(m);
      for (const k of ['map', 'emissiveMap', 'alphaMap']) {
        const t = m[k];
        if (t && !vistos.has(t) && !t.userData?.compartilhada) { vistos.add(t); liberarTextura(t); conta.texturas++; }
      }
      m.dispose();
      conta.materiais++;
    }
  });
  return conta;
}
