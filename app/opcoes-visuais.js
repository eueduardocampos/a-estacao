// Opções visuais da Estação, para decidir vendo (não altera o app).
//
// opcoes-visuais.html carrega a página normal (copia o cabeçalho e o corpo de
// index.html e importa main.js) e este arquivo troca, SÓ em tempo de execução,
// o material de peças já montadas na cena. Nenhum arquivo do app é editado.
//
// Parâmetros (podem ser somados com vírgula: ?opcao=passadeira-fibra,parede-tijolo):
//   ?opcao=passadeira-vermelha   como está hoje (nada muda)
//   ?opcao=passadeira-fibra      passadeira estreita de fibra natural (sisal, tom de palha)
//   ?opcao=sem-passadeira        corredor só com o piso
//   ?opcao=parede-lisa           como está hoje (nada muda)
//   ?opcao=parede-tijolo         tijolo aparente na parede do fundo do Módulo Claude, letras claras
//   ?opcao=parede-tijolo-faixa   tijolo aparente com uma faixa de reboco atrás das letras escuras
// Extras:
//   ?quadro=geral|corredor|corredor-perto|parede  enquadramento fixo (mesmo zoom e posição em todas as opções)
//   ?limpo=1                       esconde cabeçalho, botão e rodapé (para prints)
//   ?simular=4 e ?zoom=livre        repassados ao app (fonte.js e camera.js)
//
// Como a peça é encontrada (sem depender de export novo):
//   passadeira: Mesh filho direto da cena, cor 0x9c3f2a, 2 cm de altura (layout.js, montarEspinha)
//   parede: Mesh de 2,8 m de altura e 20 cm de espessura com a face em z = E.ZN, dentro
//           dos limites x da sala 'coworking' (o Estúdio, montarEstudio)
//   letras: plano com textura em y ≈ 2,32 m, colado na mesma parede (placaParede)
// Tudo é reaplicado a cada segundo, de forma idempotente, caso a cena seja remontada.

import * as THREE from 'three';
import { E } from './estado.js';
import { zoomDaPegada } from './camera.js';

const params = new URLSearchParams(location.search);
const opcoes = new Set(params.getAll('opcao').flatMap(v => v.split(',')).map(s => s.trim()).filter(Boolean));
const QUADRO = params.get('quadro');
const LIMPO = params.has('limpo');

const COR_PASSADEIRA = 0x336699;   // passadeira azul (decisão de 03/10; antes 0x9c3f2a)
const ALT_PAREDE = 2.8;

// ---------------------------------------------------------------------------
// Texturas desenhadas em canvas
// ---------------------------------------------------------------------------
function textura(canvas, repetir = false) {
  const tx = new THREE.CanvasTexture(canvas);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = E.renderer?.capabilities?.getMaxAnisotropy?.() || 1;
  if (repetir) tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  return tx;
}

function sorteio(semente) {
  let s = semente;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// Sisal: trama em "cestinho" (blocos alternando fios horizontais e verticais) com
// a borda debruada em algodão tingido (castanho), que desenha o contorno no piso. Um ladrilho = 0,7 m de largura da passadeira
// (v de 0 a 1) por 0,7 m de comprimento (u se repete ao longo do corredor).
function texturaSisal() {
  const W = 512, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = sorteio(7);
  g.fillStyle = '#c4a46e';
  g.fillRect(0, 0, W, H);
  const borda = 56;
  const bloco = 32;
  for (let by = borda; by < H - borda; by += bloco) {
    for (let bx = 0; bx < W; bx += bloco) {
      const horiz = ((bx / bloco) + ((by - borda) / bloco)) % 2 === 0;
      const tom = 178 + r() * 20;
      g.fillStyle = `rgb(${tom + 22},${tom - 4},${tom - 62})`;
      g.fillRect(bx, by, bloco, bloco);
      // fios
      for (let i = 0; i < 6; i++) {
        const t = (i + 0.5) / 6;
        const claro = r() > 0.5;
        g.strokeStyle = claro ? 'rgba(236,214,170,0.55)' : 'rgba(120,88,48,0.28)';
        g.lineWidth = 2.2;
        g.beginPath();
        if (horiz) { g.moveTo(bx + 1, by + t * bloco); g.lineTo(bx + bloco - 1, by + t * bloco); }
        else { g.moveTo(bx + t * bloco, by + 1); g.lineTo(bx + t * bloco, by + bloco - 1); }
        g.stroke();
      }
      g.strokeStyle = 'rgba(110,80,44,0.18)';
      g.lineWidth = 1;
      g.strokeRect(bx + 0.5, by + 0.5, bloco - 1, bloco - 1);
    }
  }
  // debrum castanho nas duas bordas compridas
  for (const y of [0, H - borda]) {
    g.fillStyle = '#9b7b55';
    g.fillRect(0, y, W, borda);
    g.strokeStyle = 'rgba(70,50,30,0.30)';
    g.lineWidth = 1.5;
    for (let x = 4; x < W; x += 9) { g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + 4, y + borda - 6); g.stroke(); }
  }
  return textura(c, true);
}

// Tijolo aparente em amarração corrida, desenhado na medida da parede
// (larg × 2,8 m), sem repetição visível.
function texturaTijolo(larg) {
  const PX = 220;                       // pixels por metro
  const W = Math.min(4096, Math.round(larg * PX)), H = Math.round(ALT_PAREDE * PX);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = sorteio(20261003);
  const junta = '#d9cbb9';
  g.fillStyle = junta;
  g.fillRect(0, 0, W, H);
  const tijL = 0.25 * PX * (W / (larg * PX)), tijA = 0.085 * PX, esp = 0.011 * PX;
  const tons = ['#a8583f', '#b2634a', '#9c4f3a', '#b96f53', '#a35a44', '#c07a5d', '#ab6046', '#94503d'];
  let linha = 0;
  for (let y = H; y > -tijA; y -= tijA, linha++) {
    const desloc = linha % 2 ? tijL / 2 : 0;
    for (let x = -desloc; x < W; x += tijL) {
      const x0 = x + esp / 2, y0 = y - tijA + esp / 2, w = tijL - esp, h = tijA - esp;
      g.fillStyle = tons[Math.floor(r() * tons.length)];
      g.fillRect(x0, y0, w, h);
      // luz de cima e leve sombra embaixo: relevo sem exagero
      const gr = g.createLinearGradient(0, y0, 0, y0 + h);
      gr.addColorStop(0, 'rgba(255,236,214,0.16)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0)');
      gr.addColorStop(1, 'rgba(60,30,20,0.16)');
      g.fillStyle = gr;
      g.fillRect(x0, y0, w, h);
      // manchinhas de queima
      for (let k = 0; k < 3; k++) {
        g.fillStyle = `rgba(${r() > 0.5 ? '70,35,25' : '235,200,170'},${0.05 + r() * 0.07})`;
        g.beginPath();
        g.ellipse(x0 + r() * w, y0 + r() * h, 2 + r() * 7, 1 + r() * 3, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // lavado quente por cima, para casar com a luz macia da cena
  g.fillStyle = 'rgba(240,215,190,0.10)';
  g.fillRect(0, 0, W, H);
  return textura(c);
}

// Letras do nome da sala redesenhadas (mesma medida do plano de placaParede)
function texturaLetras(texto, larg, alt, { cor, sombra }) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = Math.round(1024 * alt / larg);
  const g = c.getContext('2d');
  const t = texto.toUpperCase();
  let tam = Math.round(c.height * 0.45);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  do {
    g.font = `700 ${tam}px Figtree, -apple-system, "Helvetica Neue", sans-serif`;
    if ('letterSpacing' in g) g.letterSpacing = `${Math.round(tam * 0.12)}px`;
    tam -= 2;
  } while (g.measureText(t).width > c.width * 0.86 && tam > 12);
  if (sombra) { g.shadowColor = sombra; g.shadowBlur = 6; g.shadowOffsetY = 2; }
  g.fillStyle = cor;
  g.fillText(t, c.width / 2, c.height / 2 + Math.round(c.height * 0.02));
  return textura(c);
}

// ---------------------------------------------------------------------------
// Busca das peças na cena montada
// ---------------------------------------------------------------------------
const caixaTmp = new THREE.Box3();
const tam = new THREE.Vector3();
function medidasLocais(mesh) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  mesh.geometry.boundingBox.getSize(tam);
  return tam;
}

function acharPassadeira() {
  return E.cena?.children.find(o => o.isMesh && !Array.isArray(o.material)
    && (o.material?.color?.getHex() === COR_PASSADEIRA || o.userData.opcaoPassadeira)
    && Math.abs(medidasLocais(o).y - 0.02) < 0.005) ?? null;
}

function acharParedeEstudio() {
  const sala = E.salas?.coworking;
  if (!sala || !E.cena) return null;
  const x0 = sala.x0 ?? -Infinity, x1 = sala.x1 ?? Infinity;
  let achada = null;
  E.cena.traverse(o => {
    if (achada || !o.isMesh || o.userData.opcaoVisual) return;
    const t = medidasLocais(o);
    if (Math.abs(t.y - ALT_PAREDE) > 0.01 || Math.abs(t.z - 0.2) > 0.01 || t.x < 3) return;
    const p = o.getWorldPosition(new THREE.Vector3());
    if (Math.abs(p.z - (E.ZN - 0.1)) > 0.02) return;
    if (p.x < x0 - 0.1 || p.x > x1 + 0.1) return;
    achada = o;
  });
  return achada;
}

function acharLetras(parede) {
  const pai = parede.parent;
  return pai.children.find(o => o.isMesh && o.material?.map && o.material.transparent
    && o.geometry?.type === 'PlaneGeometry'
    && Math.abs(o.position.y - (ALT_PAREDE - 0.48)) < 0.03
    && Math.abs(o.position.z - (E.ZN + 0.012)) < 0.02) ?? null;
}

// ---------------------------------------------------------------------------
// Aplicação (idempotente)
// ---------------------------------------------------------------------------
const estado = { passadeira: 'vermelha', parede: 'lisa', achou: {} };
if (opcoes.has('passadeira-fibra')) estado.passadeira = 'fibra';
if (opcoes.has('sem-passadeira')) estado.passadeira = 'sem';
if (opcoes.has('parede-tijolo')) estado.parede = 'tijolo';
if (opcoes.has('parede-tijolo-faixa')) estado.parede = 'tijolo-faixa';

let matSisal = null;
function aplicarPassadeira() {
  const p = acharPassadeira();
  estado.achou.passadeira = !!p;
  if (!p || estado.passadeira === 'vermelha') return;
  if (estado.passadeira === 'sem') { if (p.visible) { p.visible = false; marcar(); } return; }
  if (p.userData.opcaoPassadeira === 'fibra') return;
  // fibra: 0,7 m de largura (a original tem 1,0), trama que se repete ao longo do corredor
  matSisal ||= new THREE.MeshStandardMaterial({ map: texturaSisal(), roughness: 0.95, metalness: 0 });
  p.material = matSisal;
  p.scale.z = 0.7;
  p.userData.opcaoPassadeira = 'fibra';
  // a espinha estica a passadeira em x (scale.x): a trama acompanha o comprimento real
  p.onBeforeRender = () => {
    const comprimento = medidasLocais(p).x * p.scale.x;
    const rep = comprimento / 0.7;
    if (Math.abs(matSisal.map.repeat.x - rep) > 1e-3) matSisal.map.repeat.set(rep, 1);
  };
  marcar();
}

function aplicarParede() {
  const parede = acharParedeEstudio();
  estado.achou.parede = !!parede;
  if (!parede || estado.parede === 'lisa') return;
  if (parede.userData.opcaoParede === estado.parede) return;
  parede.userData.opcaoParede = estado.parede;
  const g = parede.parent;
  const larg = medidasLocais(parede).x;
  // revestimento de tijolo colado na face de dentro da parede (atrás de janela,
  // estante, quadro e letras), no mesmo grupo do módulo
  const tijolo = new THREE.Mesh(new THREE.PlaneGeometry(larg - 0.02, ALT_PAREDE - 0.06),
    new THREE.MeshStandardMaterial({ map: texturaTijolo(larg), roughness: 0.92, metalness: 0 }));
  tijolo.position.set(parede.position.x, ALT_PAREDE / 2, E.ZN + 0.004);
  tijolo.receiveShadow = true;
  Object.assign(tijolo.userData, { parede: true, semMapa: true, opcaoVisual: true });
  g.add(tijolo);

  const letras = acharLetras(parede);
  estado.achou.letras = !!letras;
  if (letras) {
    const t = medidasLocais(letras);
    if (estado.parede === 'tijolo') {
      letras.material = letras.material.clone();
      letras.material.map = texturaLetras('Módulo Claude', t.x, t.y, { cor: '#fffaf1', sombra: 'rgba(40,18,10,0.6)' });
      letras.material.needsUpdate = true;
    } else {
      // faixa de reboco claro atrás das letras escuras originais
      const faixa = new THREE.Mesh(new THREE.PlaneGeometry(t.x + 0.5, t.y + 0.2),
        new THREE.MeshStandardMaterial({ color: 0xefe7da, roughness: 0.95 }));
      faixa.position.set(letras.position.x, letras.position.y, E.ZN + 0.008);
      faixa.receiveShadow = true;
      Object.assign(faixa.userData, { parede: true, semMapa: true, opcaoVisual: true });
      g.add(faixa);
    }
  }
  marcar();
}

function marcar() { E.sombraSuja = true; E.sujo = true; }

// ---------------------------------------------------------------------------
// Enquadramento fixo e modo limpo
// ---------------------------------------------------------------------------
const QUADROS = {
  // alvo no chão (x, z) e zoom relativo ao zoom de "estação inteira" da câmera
  geral: { x: -0.6, z: 0, zoom: 1.0, centro: true },
  corredor: { x: -2.0, z: 0.2, zoom: 1.45 },
  'corredor-perto': { x: 0.4, z: 0, zoom: 3.2 },
  parede: { x: -0.4, z: -6.6, zoom: 1.6 },
};
let zoomBase = null;
function enquadrar() {
  const q = QUADROS[QUADRO];
  const { camera, controles } = E;
  if (!q || !camera || !controles) return;
  zoomBase = zoomDaPegada() || zoomBase || camera.zoom;
  // 'geral' centra na pegada (a estação cresce para a esquerda quando um módulo acopla)
  const alvo = q.centro && E.pegada ? E.pegada.getCenter(new THREE.Vector3()).setY(0) : new THREE.Vector3(q.x, 0, q.z);
  const desloc = camera.position.clone().sub(controles.target);
  controles.target.copy(alvo);
  camera.position.copy(alvo).add(desloc);
  camera.zoom = zoomBase * q.zoom;
  camera.updateProjectionMatrix();
  controles.update();
  marcar();
}

if (LIMPO) {
  const css = document.createElement('style');
  css.textContent = '#cabecalho,#zoom-inteligente,#aviso,#ajuda{display:none!important}';
  document.head.append(css);
}

// ---------------------------------------------------------------------------
// Ciclo: espera a planta, aplica, enquadra e confere a cada segundo
// ---------------------------------------------------------------------------
async function esperarConstrucao() {
  while (!E.construido || !E.cena) await new Promise(r => setTimeout(r, 100));
}

function aplicarTudo() {
  try { aplicarPassadeira(); } catch (e) { console.error('opções visuais: passadeira', e); }
  try { aplicarParede(); } catch (e) { console.error('opções visuais: parede', e); }
}

await esperarConstrucao();
// fontes da placa (Figtree) antes de redesenhar as letras
try { await document.fonts.load('700 40px Figtree', 'Áa'); } catch { /* sem internet */ }
aplicarTudo();
enquadrar();
setTimeout(enquadrar, 400);   // depois do primeiro ajuste de limites da câmera
setInterval(aplicarTudo, 1000);
document.documentElement.dataset.opcoesProntas = '1';

window.__opcoesVisuais = { estado, opcoes: [...opcoes], quadro: QUADRO, enquadrar, aplicarTudo };
