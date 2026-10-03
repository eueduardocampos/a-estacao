// Cantos de descompressão da sala de descanso: fliperama, videogame, ioga e
// meditação. Pedido de 03/10 (ESPECIFICACAO.md, "cantos de descompressão no
// descanso"), feito como peça avulsa para ligar no app depois da reforma.
//
// Cada criador devolve um CANTO:
//   canto.tipo        'fliperama' | 'videogame' | 'ioga' | 'meditacao'
//   canto.nome        nome em português (legenda)
//   canto.grupo       THREE.Group posicionável (frente do canto em +z local,
//                     costas para a parede em -z). Posicione e gire à vontade.
//   canto.pegada      { x0, x1, z0, z1 } local, já com o lugar de quem usa
//   canto.lugares     lugares de descanso reserváveis (um astronauta por lugar)
//   canto.atualizarLugares()   recalcula pos/olhar no mundo (chamar depois de
//                     mover o grupo; o criador já chama uma vez)
//   canto.usar(lugar, boneco, { fase })  devolve o ANIMADOR do astronauta
//   canto.atualizar(t, dt)  anima as peças (telas, joystick, lanterna).
//                     Devolve true quando algo mudou (pedir quadro novo)
//   canto.liberar()   descarta o que é só deste canto (liberarObjeto do pecas)
//
// LUGAR (mesmo formato das vagas do layout, para entrar em s.vagas ou nos pontos
// do descanso):
//   { id, canto, acao, pose: 'em-pe' | 'sentado', topoAssento (sentado),
//     pos (Vector3 no mundo, y 0), olhar (rotação y no mundo),
//     local (Vector3 no grupo), olharLocal, sala: 'descanso',
//     ocupada: null (o agentes.js marca), emUso (o animador marca),
//     encostado: true quando o lugar fica colado na peça (o mapa de caminhos
//     trata como assento: o astronauta chega pelo ponto livre mais próximo) }
//   O y do boneco sentado segue a regra do personagens.js:
//   topoAssento - 0,30 × escala (posicionarNoLugar faz isso).
//
// ANIMADOR (canto.usar ou animarNoLugar):
//   animador.quadro(t, dt)  chamar a cada quadro NO LUGAR de boneco.userData.animar
//                           (ele chama o animar do personagem com 'descansar' para
//                           olhos, piscada e LED de descanso, e por cima aplica a
//                           pose do canto nos pivôs, com mistura suave)
//   animador.encerrar()     tira o controle das mãos, zera os eixos que o
//                           personagem não controla e libera o lugar (emUso false)
// Poses: fliperama (em pé, mão esquerda no joystick, direita batucando os botões,
// corpo inclinado para a tela); videogame (sentado no pufe com o controle,
// inclina nas curvas; em dupla, às vezes olha para o parceiro); ioga (quatro
// posturas simples alternando a cada 7 s: saudação, árvore, estrela e
// alongamento lateral); meditação (sentado na zafu, pernas cruzadas, mãos nos
// joelhos, olhos fechados e respiração lenta de 6 s).
//
// Os pivôs (corpo, pernas, braços, cabeça) não são expostos pelo personagens.js:
// pivosDoAstronauta acha os grupos pela estrutura do criarAstronauta. Se o
// personagens.js passar a expor userData.pivos, ele é usado primeiro.
//
// Sem luz de verdade (mudar o número de luzes recompila os shaders): telas,
// lanterna e luz no piso são materiais com brilho. Sem som. Sem texto nem logo.

import * as THREE from 'three';
import { mat, caixa, cilindro, planta, COR, liberarObjeto } from './pecas.js';

export const ESCALA_ASTRONAUTA = 1.45;

// Tons calmos para os cantos (sinais navy, azul e laranja só em pontinhos)
const TOM = {
  corpoFliperama: 0x7d8fb3, grafite: 0x3a3f4f, tela: 0x10131f,
  pufeA: 0x8fb4a8, pufeB: 0xd99a8a, tapeteGame: 0xe9d8bf,
  tapeteIoga: 0x93a9c9, tapeteEnrolado: 0xc98a6a, cortica: 0xc4a174,
  zabuton: 0x9db08f, zafu: 0x6f7a99, papel: 0xf4ead6, pedra: 0x9a9890,
};

// ---------------------------------------------------------------------------
// Geometrias e texturas compartilhadas deste arquivo
// ---------------------------------------------------------------------------
const geos = new Map();
function geo(chave, criar) {
  let g = geos.get(chave);
  if (!g) { g = criar(); g.userData.compartilhada = true; geos.set(chave, g); }
  return g;
}
function malha(geometria, material, x, y, z, pai, sombra = true) {
  const m = new THREE.Mesh(geometria, material);
  m.position.set(x, y, z);
  m.castShadow = sombra;
  m.receiveShadow = true;
  pai.add(m);
  return m;
}
// Esfera achatada (almofadas, pedras, topo do pufe)
function esferaAchatada(r, fy, cor, x, y, z, pai, extra) {
  const g = geo(`esf|${r}|${fy}`, () => new THREE.SphereGeometry(r, 24, 14).scale(1, fy, 1));
  return malha(g, mat(cor, extra), x, y, z, pai);
}
const temDocumento = typeof document !== 'undefined';
function marcarSemMapa(o) { o.userData.semMapa = true; return o; }

// Luz quente no piso (mesmo desenho da poça do pecas.js, sem luz de verdade)
let texturaPoca = null;
function gradientePoca() {
  if (texturaPoca || !temDocumento) return texturaPoca;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,222,170,1)');
  gr.addColorStop(0.45, 'rgba(255,214,160,0.55)');
  gr.addColorStop(1, 'rgba(255,205,150,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  texturaPoca = new THREE.CanvasTexture(c);
  texturaPoca.colorSpace = THREE.SRGBColorSpace;
  texturaPoca.userData.compartilhada = true;
  return texturaPoca;
}
function pocaDeLuz(x, z, tam, opacidade, pai) {
  const material = new THREE.MeshBasicMaterial({ map: gradientePoca(), color: 0xffe2b8, transparent: true, depthWrite: false, opacity: opacidade });
  const m = new THREE.Mesh(geo(`plano|${tam}`, () => new THREE.PlaneGeometry(tam, tam)), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.03, z);
  m.raycast = () => {};
  marcarSemMapa(m);
  pai.add(m);
  return m;
}

// Tela animada desenhada em canvas: material com brilho próprio (emissiveMap)
function telaCanvas(largPx, altPx) {
  const material = new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.35, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0 });
  if (!temDocumento) return { material, ctx: null, textura: null, W: largPx, H: altPx };
  const c = document.createElement('canvas');
  c.width = largPx; c.height = altPx;
  const textura = new THREE.CanvasTexture(c);
  textura.colorSpace = THREE.SRGBColorSpace;
  material.map = textura;
  material.emissiveMap = textura;
  return { material, ctx: c.getContext('2d'), textura, W: largPx, H: altPx };
}
function retanguloRedondo(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  ctx.fill();
}
function bola(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
// sorteio estável (desenhos)
const sorteio = n => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const suave = u => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
// pulso de 0 a 1 que acontece uma vez a cada 'periodo' s, com 'dur' s de duração
function pulso(t, periodo, dur) {
  const u = ((t % periodo) + periodo) % periodo;
  return u > dur ? 0 : Math.sin(Math.PI * u / dur);
}

// ---------------------------------------------------------------------------
// Lugares
// ---------------------------------------------------------------------------
function novoLugar(canto, i, acao, pose, x, z, olharLocal, extra = {}) {
  return {
    id: `${canto}:${i}`, canto, acao, pose,
    local: new THREE.Vector3(x, 0, z), olharLocal,
    pos: new THREE.Vector3(x, 0, z), olhar: olharLocal,
    sala: 'descanso', ocupada: null, emUso: false, fase: 0, t: 0,
    ...extra,
  };
}

function montarCanto(tipo, nome, grupo, lugares, pegada, atualizarPecas) {
  grupo.userData.cantoDescompressao = tipo;
  const canto = {
    tipo, nome, grupo, lugares, pegada,
    atualizarLugares() {
      grupo.updateWorldMatrix(true, false);
      const q = new THREE.Quaternion(), e = new THREE.Euler();
      grupo.getWorldQuaternion(q);
      e.setFromQuaternion(q, 'YXZ');
      for (const l of lugares) {
        l.pos.copy(l.local).applyMatrix4(grupo.matrixWorld);
        l.pos.y = 0;
        l.olhar = e.y + l.olharLocal;
      }
      return lugares;
    },
    usar(lugar, boneco, opc = {}) { return animarNoLugar(lugar, boneco, opc); },
    atualizar(t, dt = 1 / 60) { return atualizarPecas ? atualizarPecas(t, dt) : false; },
    liberar() {
      for (const l of lugares) l.emUso = false;
      grupo.parent?.remove(grupo);
      return liberarObjeto(grupo);
    },
  };
  canto.atualizarLugares();
  return canto;
}

// Põe o boneco no lugar (posição, altura do assento e direção)
export function posicionarNoLugar(boneco, lugar, escala = ESCALA_ASTRONAUTA) {
  boneco.position.set(lugar.pos.x, lugar.pose === 'sentado' ? (lugar.topoAssento ?? 0.51) - 0.30 * escala : 0, lugar.pos.z);
  boneco.rotation.y = lugar.olhar;
  return boneco;
}

// ---------------------------------------------------------------------------
// 1) Fliperama: gabinete com laterais de madeira, tela com arte abstrata,
// joystick e botões. Um lugar em pé, colado no painel.
// ---------------------------------------------------------------------------
function desenharMarquise(ctx, W, H) {
  const gr = ctx.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, '#c98a6a'); gr.addColorStop(0.5, '#e3c48f'); gr.addColorStop(1, '#8fa3bf');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,245,225,0.85)';
  bola(ctx, W * 0.5, H * 0.95, H * 0.55);           // sol nascendo
  ctx.fillStyle = 'rgba(30,36,64,0.35)';
  for (let i = 0; i < 4; i++) ctx.fillRect(0, H * (0.62 + i * 0.1), W, H * 0.04);   // faixas
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 9; i++) bola(ctx, W * (0.06 + i * 0.11), H * (0.2 + 0.12 * Math.sin(i * 1.7)), 2.2);
}

function desenharFliperama(tela, t, jogando, fase) {
  const { ctx, W, H } = tela;
  if (!ctx) return;
  ctx.fillStyle = '#141a33';
  ctx.fillRect(0, 0, W, H);
  // estrelas descendo
  const vel = jogando ? 70 : 14;
  ctx.fillStyle = 'rgba(232,228,220,0.7)';
  for (let i = 0; i < 26; i++) {
    const x = sorteio(i + 1) * W, y = (sorteio(i + 40) * H + t * vel * (0.5 + sorteio(i + 80))) % H;
    ctx.fillRect(x, y, 2, 2);
  }
  if (jogando) {
    // blocos abstratos no alto, balançando e piscando
    const cores = ['#7cc4b0', '#c98a6a', '#e8dcc6', '#8fb6ff'];
    const dx = Math.sin(t * 0.8) * 14;
    for (let l = 0; l < 3; l++) for (let c = 0; c < 6; c++) {
      if (sorteio(l * 7 + c + Math.floor(t / 3)) < 0.18) continue;   // alguns já foram
      ctx.globalAlpha = 0.65 + 0.35 * Math.sin(t * 6 + l + c);
      ctx.fillStyle = cores[(l + c) % cores.length];
      retanguloRedondo(ctx, 22 + c * 27 + dx, 14 + l * 18, 18, 11, 4);
    }
    ctx.globalAlpha = 1;
    // nave (triângulo arredondado) seguindo o joystick
    const nx = W / 2 + Math.sin(t * 2.3 + fase) * W * 0.32;
    ctx.fillStyle = '#8fb6ff';
    ctx.beginPath();
    ctx.moveTo(nx, H - 34); ctx.lineTo(nx - 11, H - 14); ctx.lineTo(nx + 11, H - 14); ctx.closePath(); ctx.fill();
    // disparos
    ctx.fillStyle = '#f3eee4';
    for (let i = 0; i < 4; i++) {
      const u = ((t * 2.8 + i / 4) % 1);
      const sx = W / 2 + Math.sin((t - u * 0.35) * 2.3 + fase) * W * 0.32;
      ctx.fillRect(sx - 1, H - 36 - u * (H - 60), 2, 7);
    }
    // estouro de vez em quando (o único laranja)
    const e = pulso(t + fase, 2.6, 0.45);
    if (e > 0) {
      ctx.globalAlpha = e;
      ctx.fillStyle = '#ee4c01';
      bola(ctx, W * 0.3 + sorteio(Math.floor((t + fase) / 2.6)) * W * 0.4, 40, 6 + 10 * (1 - e));
      ctx.globalAlpha = 1;
    }
  } else {
    // modo de espera: círculos macios pulsando e um bloquinho quicando
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.18 + 0.1 * Math.sin(t * 1.2 + i * 2);
      ctx.fillStyle = ['#8fb6ff', '#7cc4b0', '#c98a6a'][i];
      bola(ctx, W * (0.3 + i * 0.2), H * 0.45, 26 + 8 * Math.sin(t * 0.9 + i));
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e8dcc6';
    retanguloRedondo(ctx, W / 2 - 8, H * 0.75 - Math.abs(Math.sin(t * 2)) * 30, 16, 16, 4);
  }
}

export function criarFliperama({ cor = TOM.corpoFliperama } = {}) {
  const g = new THREE.Group();
  g.name = 'canto-fliperama';
  const W = 0.68, ZC = -0.36;              // gabinete de z -0,66 a -0,06
  const madeira = COR.madeiraMedia;
  // pé recuado, corpo de baixo e laterais de madeira (perfil em dois blocos)
  caixa(W - 0.06, 0.06, 0.52, TOM.grafite, 0, 0, ZC, g);
  caixa(W - 0.06, 0.66, 0.56, cor, 0, 0.06, ZC, g);
  for (const lado of [-1, 1]) {
    caixa(0.04, 0.74, 0.6, madeira, lado * (W / 2 - 0.02), 0.02, ZC, g);
    caixa(0.04, 0.98, 0.42, madeira, lado * (W / 2 - 0.02), 0.76, ZC - 0.09, g);
  }
  // corpo de cima, moldura da tela e marquise
  caixa(W - 0.06, 0.98, 0.36, cor, 0, 0.76, ZC - 0.12, g);
  // porta das fichas: retângulo escuro com duas fendas acesas
  caixa(0.22, 0.2, 0.02, TOM.grafite, 0, 0.3, -0.07, g, { seg: 0 });
  for (const x of [-0.05, 0.05]) caixa(0.025, 0.05, 0.012, COR.laranja, x, 0.37, -0.055, g, { seg: 0, sombra: false, mat: { emissive: COR.laranja, emissiveIntensity: 0.6 } });

  // painel de controle: tampo inclinado na direção de quem joga (topo ~0,77)
  const painel = new THREE.Group();
  painel.position.set(0, 0.7, -0.03);
  painel.rotation.x = 0.12;
  g.add(painel);
  caixa(W - 0.02, 0.07, 0.24, TOM.grafite, 0, 0, 0, painel);
  caixa(W - 0.06, 0.012, 0.2, 0x2b2f3d, 0, 0.07, 0, painel, { seg: 0, sombra: false });
  // joystick (lado de quem joga com a mão esquerda: x negativo do canto)
  const joy = new THREE.Group();
  joy.position.set(-0.2, 0.082, 0.01);
  painel.add(joy);
  cilindro(0.035, 0.04, 0.01, 0x1d2030, 0, 0, 0, joy, 16);
  cilindro(0.008, 0.008, 0.09, 0xb9bcc6, 0, 0, 0, joy, 8);
  esferaAchatada(0.026, 1, TOM.tapeteEnrolado, 0, 0.1, 0, joy, { roughness: 0.4 });
  // botões em duas fileiras (o último com o laranja de acento)
  const coresBotao = [0xe8dcc6, 0x8fa3bf, 0xa8c39f, 0xc98a6a, 0xe8dcc6, COR.laranja];
  const botoes = [];
  coresBotao.forEach((c, i) => {
    const b = cilindro(0.022, 0.022, 0.016, c, 0.06 + (i % 3) * 0.075, 0.08, (i < 3 ? -0.03 : 0.04), painel, 14);
    b.material = mat(c, { roughness: 0.35, emissive: c, emissiveIntensity: i === 5 ? 0.35 : 0.05 });
    b.userData.y0 = b.position.y;
    botoes.push(b);
  });

  // tela inclinada para trás, dentro da moldura escura
  const caixaTela = new THREE.Group();
  caixaTela.position.set(0, 1.2, -0.29);
  caixaTela.rotation.x = -0.2;
  g.add(caixaTela);
  caixa(W - 0.08, 0.5, 0.03, TOM.grafite, 0, -0.25, 0, caixaTela, { seg: 0 });
  const tela = telaCanvas(200, 168);
  const vidro = malha(geo('telaFlip', () => new THREE.PlaneGeometry(0.5, 0.42)), tela.material, 0, 0, 0.017, caixaTela, false);
  vidro.raycast = () => {};
  // marquise com arte abstrata acesa, no alto
  caixa(W - 0.04, 0.2, 0.3, TOM.grafite, 0, 1.6, ZC - 0.1, g);
  let matMarquise = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.5 });
  if (temDocumento) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 72;
    desenharMarquise(c.getContext('2d'), 256, 72);
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    matMarquise = new THREE.MeshStandardMaterial({ map: tx, emissiveMap: tx, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.6 });
  }
  malha(geo('marquise', () => new THREE.PlaneGeometry(W - 0.1, 0.16)), matMarquise, 0, 1.7, ZC + 0.051, g, false);
  // topo de madeira
  caixa(W, 0.04, 0.34, madeira, 0, 1.8, ZC - 0.1, g);

  // lugar em pé: colado no painel (0,44 da frente do gabinete), olhando para a tela
  const lugar = novoLugar('fliperama', 0, 'fliperama', 'em-pe', 0, 0.44, Math.PI, { encostado: true });
  let ultimoDesenho = -1;
  function atualizarPecas(t) {
    const jogando = lugar.emUso;
    const fps = jogando ? 15 : 4;
    let mudou = false;
    const alvoBrilho = jogando ? 0.95 : 0.55;
    if (Math.abs(tela.material.emissiveIntensity - alvoBrilho) > 0.01) {
      tela.material.emissiveIntensity += (alvoBrilho - tela.material.emissiveIntensity) * 0.15;
      mudou = true;
    }
    if (Math.floor(t * fps) !== ultimoDesenho) {
      ultimoDesenho = Math.floor(t * fps);
      desenharFliperama(tela, t, jogando, lugar.fase);
      if (tela.textura) tela.textura.needsUpdate = true;
      mudou = true;
    }
    // joystick e botões acompanham a animação de quem joga
    const f = lugar.fase;
    const tj = jogando ? lugar.t : 0;
    joy.rotation.set(jogando ? 0.25 * Math.cos(tj * 3.1 + f) : 0, 0, jogando ? -0.35 * Math.sin(tj * 2.3 + f) : 0);
    botoes.forEach((b, i) => {
      const toque = jogando && i < 5 ? Math.pow(Math.max(0, Math.sin(tj * 7.3 + f + i * 1.3)), 6) : 0;
      b.position.y = b.userData.y0 - 0.008 * toque;
    });
    return mudou || jogando;
  }
  const canto = montarCanto('fliperama', 'Fliperama', g, [lugar], { x0: -0.4, x1: 0.4, z0: -0.7, z1: 0.8 }, atualizarPecas);
  atualizarPecas(0);
  return canto;
}

// ---------------------------------------------------------------------------
// 2) Videogame: rack baixo de madeira, TV, console, dois controles e dois pufes
// sobre um tapete. Dois lugares sentados (dá para jogar em dupla).
// ---------------------------------------------------------------------------
function desenharJogoTv(tela, t, jogadores) {
  const { ctx, W, H } = tela;
  if (!ctx) return;
  const n = Math.max(1, jogadores.length);
  const larg = W / n;
  const paletas = [
    { ceu: ['#8fb6ff', '#e8dcc6'], morro1: '#a8c39f', morro2: '#5f8f4e', heroi: '#f3eee4' },
    { ceu: ['#e9b8a0', '#f3e2c4'], morro1: '#c9a37e', morro2: '#8a6a52', heroi: '#f3eee4' },
  ];
  for (let j = 0; j < n; j++) {
    const p = paletas[j % 2];
    const x0 = j * larg;
    const tt = t + (jogadores[j]?.fase ?? 0);
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, 0, larg, H); ctx.clip();
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, p.ceu[0]); gr.addColorStop(1, p.ceu[1]);
    ctx.fillStyle = gr;
    ctx.fillRect(x0, 0, larg, H);
    ctx.fillStyle = 'rgba(255,248,230,0.9)';
    bola(ctx, x0 + larg * 0.75, H * 0.28, 12);
    // morros em duas camadas, rolando em velocidades diferentes
    for (const [cor, alt, vel, amp] of [[p.morro1, 0.62, 18, 10], [p.morro2, 0.78, 46, 7]]) {
      ctx.fillStyle = cor;
      ctx.beginPath();
      ctx.moveTo(x0, H);
      for (let x = 0; x <= larg; x += 4) ctx.lineTo(x0 + x, H * alt - amp * Math.sin((x + tt * vel) * 0.045));
      ctx.lineTo(x0 + larg, H);
      ctx.closePath(); ctx.fill();
    }
    // herói: quadradinho pulando, com sombra
    const pulo = Math.abs(Math.sin(tt * 2.4)) * 26;
    ctx.fillStyle = 'rgba(30,36,64,0.25)';
    retanguloRedondo(ctx, x0 + larg * 0.3 - 7, H * 0.86, 14, 3, 2);
    ctx.fillStyle = p.heroi;
    retanguloRedondo(ctx, x0 + larg * 0.3 - 8, H * 0.86 - 16 - pulo, 16, 16, 4);
    ctx.fillStyle = '#2a2e45';
    ctx.fillRect(x0 + larg * 0.3 + 1, H * 0.86 - 12 - pulo, 3, 3);
    // moedinhas
    ctx.fillStyle = '#e3d28f';
    for (let i = 0; i < 3; i++) bola(ctx, x0 + ((i * 70 - tt * 46) % (larg + 40) + larg + 40) % (larg + 40) - 20, H * 0.48, 4);
    ctx.restore();
  }
  if (n > 1) { ctx.fillStyle = '#1d2030'; ctx.fillRect(W / 2 - 1.5, 0, 3, H); }
}

// Controle de videogame (usado no rack e nas mãos)
function criarControle(pai, x, y, z) {
  const c = new THREE.Group();
  c.position.set(x, y, z);
  pai.add(c);
  caixa(0.11, 0.025, 0.055, TOM.grafite, 0, -0.0125, 0, c, { seg: 0 });
  for (const lado of [-1, 1]) esferaAchatada(0.026, 0.8, TOM.grafite, lado * 0.055, -0.004, 0.012, c);
  esferaAchatada(0.008, 0.6, 0xe8dcc6, -0.03, 0.012, -0.004, c);
  esferaAchatada(0.008, 0.6, 0x8fa3bf, 0.03, 0.012, -0.004, c);
  c.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return c;
}

export function criarVideogame({ coresPufes = [TOM.pufeA, TOM.pufeB] } = {}) {
  const g = new THREE.Group();
  g.name = 'canto-videogame';
  const ZR = -0.62;                         // meio do rack (encostado na parede)
  // tapete por baixo dos pufes
  caixa(1.7, 0.018, 1.0, TOM.tapeteGame, 0, 0.006, 0.45, g, { sombra: false, mat: { roughness: 1 } });
  // rack baixo de madeira com pezinhos e frente com dois nichos
  for (const [x, z] of [[-0.58, ZR - 0.14], [0.58, ZR - 0.14], [-0.58, ZR + 0.14], [0.58, ZR + 0.14]]) cilindro(0.02, 0.02, 0.08, TOM.grafite, x, 0, z, g, 8);
  caixa(1.3, 0.34, 0.4, COR.madeiraMedia, 0, 0.08, ZR, g);
  for (const x of [-0.32, 0.32]) caixa(0.56, 0.22, 0.02, COR.madeiraEscura, x, 0.14, ZR + 0.2, g, { seg: 0 });
  // TV num pezinho, encostada atrás
  const topoRack = 0.42;
  caixa(0.3, 0.02, 0.16, TOM.grafite, 0, topoRack, ZR - 0.08, g, { seg: 0 });
  caixa(0.06, 0.08, 0.04, TOM.grafite, 0, topoRack + 0.02, ZR - 0.1, g, { seg: 0 });
  caixa(1.02, 0.6, 0.05, TOM.grafite, 0, topoRack + 0.08, ZR - 0.1, g);
  const tela = telaCanvas(256, 144);
  const vidro = malha(geo('telaTv', () => new THREE.PlaneGeometry(0.96, 0.54)), tela.material, 0, topoRack + 0.38, ZR - 0.074, g, false);
  vidro.raycast = () => {};
  // console com luzinha
  caixa(0.24, 0.06, 0.17, COR.offWhite, 0.47, topoRack, ZR + 0.06, g, { seg: 0 });
  const luzConsole = caixa(0.03, 0.006, 0.008, 0x6ea8ff, 0.43, topoRack + 0.03, ZR + 0.146, g, { seg: 0, sombra: false });
  luzConsole.material = new THREE.MeshStandardMaterial({ color: 0x6ea8ff, emissive: 0x6ea8ff, emissiveIntensity: 0.15 });
  // dois controles descansando no rack
  const controlesRack = [criarControle(g, -0.45, topoRack + 0.026, ZR + 0.08), criarControle(g, -0.3, topoRack + 0.026, ZR + 0.1)];
  controlesRack[1].rotation.y = Math.PI / 2;   // alinhado (regra de 03/10: nada em diagonal)
  // suculenta no rack e planta grande no canto
  planta(-0.56, ZR - 0.06, 1.3, COR.offWhite, 'suculenta', g, topoRack);
  planta(0.92, ZR + 0.05, 0.85, COR.terracota, 'folhaLarga', g);

  // pufes redondos com almofada fofa por cima (assento ~0,38)
  const TOPO = 0.38;
  const lugares = [];
  // lado a lado, numa fileira reta paralela ao rack (regra de 03/10: tudo alinhado às
  // paredes; antes ficavam em leve diagonal)
  [[-0.46, 0.5], [0.46, 0.5]].forEach(([x, z], i) => {
    const cor = coresPufes[i % coresPufes.length];
    cilindro(0.25, 0.27, 0.3, cor, x, 0, z, g, 24);
    esferaAchatada(0.255, 0.33, cor, x, 0.3, z, g, { roughness: 0.95 });
    esferaAchatada(0.018, 0.5, COR.linho, x, 0.383, z, g);
    // de frente para a TV (reto, para o rack)
    const olhar = Math.PI;
    lugares.push(novoLugar('videogame', i, 'videogame', 'sentado', x, z, olhar, { topoAssento: TOPO, alturaAssento: 0.11, lado: i === 0 ? -1 : 1 }));
  });
  lugares[0].parceiro = lugares[1];
  lugares[1].parceiro = lugares[0];
  lugares.forEach((l, i) => { l.controleRack = controlesRack[i]; });

  let ultimoDesenho = -1;
  function atualizarPecas(t) {
    const jogadores = lugares.filter(l => l.emUso);
    for (const l of lugares) l.controleRack.visible = !l.emUso;
    const ligada = jogadores.length > 0;
    let mudou = false;
    const alvo = ligada ? 0.9 : 0;
    if (Math.abs(tela.material.emissiveIntensity - alvo) > 0.01) {
      tela.material.emissiveIntensity += (alvo - tela.material.emissiveIntensity) * 0.12;
      tela.material.color.setHex(ligada ? 0x1a1d29 : 0x0b0d14);
      mudou = true;
    }
    luzConsole.material.emissiveIntensity = ligada ? 1.6 : 0.15;
    if (ligada && Math.floor(t * 15) !== ultimoDesenho) {
      ultimoDesenho = Math.floor(t * 15);
      desenharJogoTv(tela, t, jogadores);
      if (tela.textura) tela.textura.needsUpdate = true;
      mudou = true;
    }
    return mudou;
  }
  return montarCanto('videogame', 'Videogame', g, lugares, { x0: -1.0, x1: 1.1, z0: -0.85, z1: 0.95 }, atualizarPecas);
}

// ---------------------------------------------------------------------------
// 3) Ioga: tapete aberto, tapete enrolado com alça, bloco de cortiça, toalha
// dobrada e um ficus. Um lugar em pé no meio do tapete.
// ---------------------------------------------------------------------------
export function criarCantoIoga({ corTapete = TOM.tapeteIoga } = {}) {
  const g = new THREE.Group();
  g.name = 'canto-ioga';
  // tapete aberto (baixo: não entra no mapa de caminhos)
  caixa(1.75, 0.012, 0.66, corTapete, 0, 0.004, 0.12, g, { seg: 0, sombra: false, mat: { roughness: 0.95 } });
  caixa(1.6, 0.002, 0.04, 0xb7c6dd, 0, 0.016, -0.12, g, { seg: 0, sombra: false });   // listrinha
  // tapete enrolado deitado, com alça
  const rolo = new THREE.Group();
  rolo.position.set(-0.2, 0.07, -0.55);
  rolo.rotation.z = Math.PI / 2;
  g.add(rolo);
  malha(geo('rolo', () => new THREE.CylinderGeometry(0.07, 0.07, 0.62, 20)), mat(TOM.tapeteEnrolado, { roughness: 0.95 }), 0, 0, 0, rolo);
  malha(geo('roloPonta', () => new THREE.TorusGeometry(0.045, 0.012, 6, 18)), mat(0xb87a5c, { roughness: 0.95 }), 0, 0.312, 0, rolo).rotation.x = Math.PI / 2;
  for (const y of [-0.18, 0.18]) malha(geo('alca', () => new THREE.TorusGeometry(0.074, 0.008, 6, 20)), mat(COR.linho), 0, y, 0, rolo).rotation.x = Math.PI / 2;
  // bloco de cortiça e toalha dobrada
  caixa(0.23, 0.08, 0.15, TOM.cortica, 0.3, 0, -0.55, g);
  caixa(0.3, 0.05, 0.2, COR.linho, 0.62, 0, -0.52, g);
  caixa(0.3, 0.04, 0.2, 0xa8c39f, 0.62, 0.05, -0.52, g);
  // planta alta no canto (à direita do tapete, para não ficar atrás de quem pratica)
  planta(1.05, -0.5, 0.75, COR.offWhite, 'ficus', g);

  // de frente para a sala, meio virado para a câmera da estação: as posturas leem melhor
  const lugar = novoLugar('ioga', 0, 'ioga', 'em-pe', 0, 0.12, 0.55);
  return montarCanto('ioga', 'Ioga', g, [lugar], { x0: -1.0, x1: 1.3, z0: -0.75, z1: 0.5 }, null);
}

// ---------------------------------------------------------------------------
// 4) Meditação: zabuton (colchonete quadrado), zafu (almofada redonda), lanterna
// de papel com luz baixa no piso, planta e pedrinhas empilhadas. Um lugar
// sentado na zafu.
// ---------------------------------------------------------------------------
export function criarCantoMeditacao({ corZafu = TOM.zafu } = {}) {
  const g = new THREE.Group();
  g.name = 'canto-meditacao';
  // zabuton baixo (fica fora do mapa) e zafu
  caixa(0.9, 0.05, 0.9, TOM.zabuton, 0, 0, 0, g, { mat: { roughness: 0.95 } });
  caixa(0.78, 0.004, 0.78, 0x8a9e7d, 0, 0.05, 0, g, { seg: 0, sombra: false });   // costura do colchonete
  cilindro(0.24, 0.25, 0.08, corZafu, 0, 0.05, 0, g, 28);
  esferaAchatada(0.245, 0.24, corZafu, 0, 0.13, 0, g, { roughness: 0.95 });
  malha(geo('costuraZafu', () => new THREE.TorusGeometry(0.245, 0.009, 6, 32)), mat(0x5d6787), 0, 0.13, 0, g).rotation.x = Math.PI / 2;
  // lanterna de papel no chão, acesa (luz baixa) e poça quente no piso
  const lan = new THREE.Group();
  lan.position.set(0.62, 0, -0.42);
  g.add(lan);
  cilindro(0.12, 0.12, 0.025, COR.madeiraEscura, 0, 0, 0, lan, 18);
  const papel = new THREE.MeshStandardMaterial({ color: TOM.papel, roughness: 0.85, emissive: COR.luzQuente, emissiveIntensity: 0.75 });
  malha(geo('lanterna', () => new THREE.CylinderGeometry(0.1, 0.11, 0.3, 20)), papel, 0, 0.175, 0, lan);
  cilindro(0.105, 0.105, 0.02, COR.madeiraEscura, 0, 0.325, 0, lan, 18);
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) cilindro(0.008, 0.008, 0.3, COR.madeiraEscura, Math.cos(a) * 0.105, 0.025, Math.sin(a) * 0.105, lan, 6);
  const poca = pocaDeLuz(0.3, -0.1, 1.6, 0.24, g);
  // planta à esquerda (fora de trás de quem medita) e pedrinhas numa bandeja
  planta(-0.75, -0.05, 0.85, COR.terracota, 'folhaLarga', g);
  caixa(0.26, 0.025, 0.18, COR.madeiraClara, 0.62, 0, 0.3, g, { seg: 0 });
  esferaAchatada(0.065, 0.45, TOM.pedra, 0.62, 0.045, 0.3, g, { roughness: 0.9 });
  esferaAchatada(0.048, 0.5, 0xb3b0a6, 0.62, 0.085, 0.3, g, { roughness: 0.9 });
  esferaAchatada(0.032, 0.55, 0x85837c, 0.62, 0.117, 0.3, g, { roughness: 0.9 });

  const lugar = novoLugar('meditacao', 0, 'meditar', 'sentado', 0, 0, 0, { topoAssento: 0.18, alturaAssento: 0.11 });
  // a lanterna respira junto com quem medita (bem de leve)
  function atualizarPecas(t) {
    const resp = lugar.emUso ? Math.sin(2 * Math.PI * (lugar.t / 6) + lugar.fase) : 0;
    const alvo = 0.75 + 0.12 * resp;
    const mudou = Math.abs(papel.emissiveIntensity - alvo) > 0.005;
    papel.emissiveIntensity = alvo;
    poca.material.opacity = 0.24 + 0.04 * resp;
    return mudou;
  }
  return montarCanto('meditacao', 'Meditação', g, [lugar], { x0: -1.0, x1: 0.8, z0: -0.6, z1: 0.5 }, atualizarPecas);
}

export const CANTOS = {
  fliperama: criarFliperama,
  videogame: criarVideogame,
  ioga: criarCantoIoga,
  meditacao: criarCantoMeditacao,
};
// Ações do descanso vivo que estes cantos acrescentam (ESPECIFICACAO, item do pedido)
export const ACOES_DESCOMPRESSAO = ['fliperama', 'videogame', 'ioga', 'meditar'];

export function criarCanto(tipo, opc) {
  const f = CANTOS[tipo];
  if (!f) throw new Error(`canto de descompressão desconhecido: ${tipo}`);
  return f(opc);
}

// ---------------------------------------------------------------------------
// Pivôs do astronauta (personagens.js, criarAstronauta)
// ---------------------------------------------------------------------------
// Estrutura: boneco > corpo (1º filho) > [perna0, perna1, braço0, braço1, cabeça]
// como grupos, na ordem em que são criados. braço0/perna0 ficam em x negativo.
export function pivosDoAstronauta(boneco) {
  const u = boneco?.userData?.pivos;
  if (u?.corpo && u.pernas?.length === 2 && u.bracos?.length === 2 && u.cabeca) return u;
  const corpo = boneco?.children?.find(c => c.isGroup && !c.isMesh);
  if (!corpo) return null;
  const grupos = corpo.children.filter(c => c.isGroup && !c.isMesh && !c.isSprite && !c.userData.controleNasMaos);
  if (grupos.length < 5) return null;
  return { corpo, pernas: [grupos[0], grupos[1]], bracos: [grupos[2], grupos[3]], cabeca: grupos[4] };
}

// ---------------------------------------------------------------------------
// Poses (alvos por canal). Lado: braço0/perna0 em x negativo (lado -1).
// rotation.z positivo no braço do lado -1 leva a mão para dentro;
// rotation.x negativo leva braço e perna para a frente.
// ---------------------------------------------------------------------------
const CANAIS = ['pe0x', 'pe1x', 'pe0z', 'pe1z', 'bx0', 'bx1', 'bz0', 'bz1', 'cy', 'crx', 'crz', 'csy',
  'kx', 'ky', 'kz', 'abre', 'olx', 'oly'];

function neutra() {
  return { pe0x: 0, pe1x: 0, pe0z: 0, pe1z: 0, bx0: 0, bx1: 0, bz0: -0.18, bz1: 0.18, cy: 0, crx: 0, crz: 0, csy: 1,
    kx: 0, ky: 0, kz: 0, abre: 1, olx: 0, oly: 0 };
}

const POSES = {
  // em pé no painel: esquerda no joystick (braço1), direita nos botões (braço0)
  fliperama(t, f) {
    const p = neutra();
    const toque = Math.pow(Math.max(0, Math.sin(t * 7.3 + f)), 6);
    const fileira = Math.sin(t * 0.9 + f) > 0 ? 1 : -1;
    const vibra = pulso(t + f * 2, 8.3, 0.9);      // de vez em quando, um pulinho de empolgação
    p.bx0 = -1.55 + 0.14 * toque + 0.04 * fileira;
    p.bz0 = 0.12 + 0.05 * fileira;
    p.bx1 = -1.5 + 0.06 * Math.cos(t * 3.1 + f);
    p.bz1 = -0.08 - 0.07 * Math.sin(t * 2.3 + f);
    p.crx = 0.07;
    p.crz = 0.03 * Math.sin(t * 1.1 + f);
    p.cy = 0.025 * vibra;
    p.kx = -0.03 - 0.1 * vibra;
    p.ky = 0.05 * Math.sin(t * 0.7 + f);
    p.csy = 1 + 0.01 * Math.sin(t * 2 + f);
    p.abre = 2.4;                                  // olhos abertos (o 'descansar' semicerra)
    p.olx = 0.012 * Math.sin(t * 2.3 + f);
    p.oly = 0.004;
    p.rapidez = 9;
    return p;
  },
  // sentado no pufe com o controle nas mãos, inclinando nas curvas
  videogame(t, f, lugar) {
    const p = neutra();
    p.pe0x = p.pe1x = -1.05;
    p.pe0z = -0.14; p.pe1z = 0.14;
    p.bx0 = -1.0 + 0.04 * Math.sin(t * 13 + f);
    p.bx1 = -1.0 + 0.04 * Math.sin(t * 11 + f + 1);
    p.bz0 = 0.42; p.bz1 = -0.42;
    const curva = 0.13 * Math.sin(t * 0.8 + f) * suave(Math.abs(Math.sin(t * 0.37 + f)) * 1.6);
    p.crz = curva;
    p.kz = curva * 0.5;
    p.crx = 0.1;
    p.csy = 1 + 0.012 * Math.sin(t * 2.2 + f);
    // em dupla: de vez em quando olha para o parceiro (riso rápido)
    if (lugar.parceiro?.emUso) {
      const olha = pulso(t + f, 9, 1.4);
      p.ky = (lugar.lado ?? 1) * -0.5 * olha;
      p.cy = 0.012 * olha * Math.abs(Math.sin(t * 14));
    }
    p.abre = 2.4;
    p.oly = -0.004;
    p.rapidez = 8;
    return p;
  },
  // quatro posturas simples alternando a cada 7 s
  ioga(t, f) {
    const p = neutra();
    const tt = t + f * 3;
    const n = Math.floor(tt / 7) % 4;
    const resp = Math.sin(2 * Math.PI * tt / 4);
    if (n === 0 || n === 1) {
      // saudação: braços para cima em V (o capacete é grande: mãos juntas
      // por cima da cabeça ficariam escondidas dentro dele)
      p.bz0 = -2.6; p.bz1 = 2.6;
      p.bx0 = p.bx1 = 0.3;                         // um pouco à frente do capacete
      p.kx = -0.15;
      if (n === 1) {
        // árvore: perna1 dobrada para fora, equilibrando
        p.pe1x = -0.35; p.pe1z = 1.0;
        p.crz = -0.04 + 0.02 * Math.sin(tt * 1.3);
        p.kx = 0;
      }
    } else if (n === 2) {
      // estrela: pernas e braços abertos
      p.pe0z = -0.35; p.pe1z = 0.35;
      p.bz0 = -1.5; p.bz1 = 1.5;
      p.cy = -0.02;
      p.kx = -0.05;
    } else {
      // alongamento lateral: braço1 por cima da cabeça, tronco para o lado
      p.pe0z = -0.2; p.pe1z = 0.2;
      p.bz1 = 2.25; p.bx1 = -0.15;
      p.bz0 = -0.3;
      p.crz = 0.26; p.kz = 0.1;
      p.cy = -0.01;
    }
    p.csy = 1 + 0.015 * resp;
    p.abre = 1.2;
    p.rapidez = 2.2;
    return p;
  },
  // sentado na zafu, pernas cruzadas, mãos nos joelhos, respiração de 6 s
  meditar(t, f) {
    const p = neutra();
    const resp = Math.sin(2 * Math.PI * t / 6 + f);
    p.pe0x = p.pe1x = -1.35;
    p.pe0z = -1.2; p.pe1z = 1.2;
    p.bx0 = p.bx1 = -0.55 - 0.04 * resp;
    p.bz0 = -0.62; p.bz1 = 0.62;
    p.csy = 1 + 0.03 * resp;
    p.cy = 0.006 * resp;
    p.kx = 0.1 - 0.04 * resp;
    p.abre = 0.28;                                 // olhos fechados
    p.oly = -0.006;
    p.rapidez = 3;
    return p;
  },
};

// Controle nas mãos (videogame), preso ao corpo do astronauta
function prenderControle(corpo) {
  const c = criarControle(corpo, 0, 0.415, 0.2);
  c.rotation.x = -0.45;
  c.userData.controleNasMaos = true;
  return c;
}

// Animador de um astronauta usando um lugar de descanso.
// opc: { fase (radianos, para ninguém ficar em sincronia), modoBase ('descansar') }
export function animarNoLugar(lugar, boneco, opc = {}) {
  const piv = pivosDoAstronauta(boneco);
  const poseDe = POSES[lugar.acao];
  if (!piv || !poseDe) return null;
  const fase = opc.fase ?? 0;
  const modoBase = opc.modoBase ?? 'descansar';
  const sentado = lugar.pose === 'sentado';
  const olhos = boneco.userData.olhos || [];
  const atual = {};
  let iniciado = false;
  let controle = lugar.acao === 'videogame' ? prenderControle(piv.corpo) : null;
  lugar.emUso = true;
  lugar.fase = fase;

  function lerAtual() {
    const { corpo, pernas, bracos, cabeca } = piv;
    Object.assign(atual, {
      pe0x: pernas[0].rotation.x, pe1x: pernas[1].rotation.x, pe0z: pernas[0].rotation.z, pe1z: pernas[1].rotation.z,
      bx0: bracos[0].rotation.x, bx1: bracos[1].rotation.x, bz0: bracos[0].rotation.z, bz1: bracos[1].rotation.z,
      cy: corpo.position.y, crx: corpo.rotation.x, crz: corpo.rotation.z, csy: corpo.scale.y,
      kx: cabeca.rotation.x, ky: cabeca.rotation.y, kz: cabeca.rotation.z, abre: 1, olx: 0, oly: 0,
    });
  }

  const animador = {
    lugar, boneco,
    quadro(t, dt = 1 / 60) {
      dt = Math.min(0.1, Math.max(0, dt));
      // olhos, piscada e LED de descanso vêm do personagem
      boneco.userData.animar?.(t, modoBase, sentado, { dt, fase });
      if (!iniciado) { lerAtual(); iniciado = true; }
      const alvo = poseDe(t, fase, lugar);
      const k = 1 - Math.exp(-dt * (alvo.rapidez ?? 8));
      for (const c of CANAIS) atual[c] += (alvo[c] - atual[c]) * k;
      const { corpo, pernas, bracos, cabeca } = piv;
      pernas[0].rotation.x = atual.pe0x; pernas[1].rotation.x = atual.pe1x;
      pernas[0].rotation.z = atual.pe0z; pernas[1].rotation.z = atual.pe1z;
      bracos[0].rotation.x = atual.bx0; bracos[1].rotation.x = atual.bx1;
      bracos[0].rotation.z = atual.bz0; bracos[1].rotation.z = atual.bz1;
      corpo.position.y = atual.cy;
      corpo.rotation.x = atual.crx;
      corpo.rotation.z = atual.crz;
      corpo.scale.set(1, atual.csy, 1);
      cabeca.rotation.set(atual.kx, atual.ky, atual.kz);
      for (const o of olhos) {
        o.scale.y *= atual.abre;
        o.position.x += atual.olx;
        o.position.y += atual.oly;
      }
      lugar.t = t;
    },
    encerrar() {
      if (controle) { controle.parent?.remove(controle); controle = null; }
      const { corpo, pernas } = piv;
      corpo.rotation.x = 0;
      pernas[0].rotation.z = pernas[1].rotation.z = 0;
      lugar.emUso = false;
    },
  };
  return animador;
}
