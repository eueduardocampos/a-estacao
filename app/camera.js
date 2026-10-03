// ---------------------------------------------------------------------------
// Exibição dinâmica (pedido do Eduardo, 03/10): a câmera mostra TODOS os astronautas
// na mesma tela, sempre. Não segue ninguém e não alterna entre grupos.
//
// Quem entra no quadro: todos os astronautas presentes (trabalhando, esperando ou
// descansando; NPCs não contam). O quadro é o CÔMODO de cada um: quem está numa sala
// leva a sala inteira para o quadro (todos numa sala só = só aquela sala; em três
// salas = as três); quem está no corredor entra pelo próprio ponto. Zoom in, zoom out
// e centro se ajustam suavemente. Sem ninguém, o quadro é a estação inteira.
//
// Como enquadra (CAM-05): o alvo é o centro da CAIXA no espaço da câmera, levado ao
// chão (y = 0), e não o centroide. Histerese: só troca de alvo se o conjunto de grupos
// mudar, se alguém passar de 85% da vista ou se a caixa ocupar menos de 40% dela
// (quando dá para chegar mais perto). O zoom anda em escala log; perto do alvo, fixa
// e fica "assentada" (sem updateProjectionMatrix à toa), e o main pode parar de desenhar.
//
// Controles (CAM-02, BUG-07, CAM-08):
// - um clique parado não muda nada; arrastar mais de 6 px, roda ou pinça PAUSA o
//   seguir sem gravar nada, e depois de 60 s sem mexer ele volta sozinho (o ponto do
//   botão pulsa enquanto isso);
// - só o botão grava a preferência ('sim' ou 'nao') no localStorage;
// - ?zoom=livre ou ?zoom=seguir na URL força o padrão daquela abertura;
// - duplo clique em área vazia volta a seguir;
// - roda: pinça do trackpad (ctrlKey) faz zoom no cursor, roda de mouse comum faz zoom
//   como antes e dois dedos no trackpad passeiam pela estação.
// - botão "Ver a estação inteira" (ao lado da "Exibição dinâmica"): zoom out suave (1,2 s) até
//   enquadrar a pegada construída inteira. Vale a mesma regra de mexer na câmera: com
//   o seguir ligado, ele pausa (câmera livre, sem gravar) e volta sozinho depois de
//   60 s sem mexer; clicar em "Exibição dinâmica" volta a seguir na hora.
// O botão se chama "Exibição dinâmica" (ligado) ou "Câmera livre" (desligado).
// Tudo só mexe na câmera; nada aqui comanda as sessões.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { E } from './estado.js';
import { marcarSujo } from './cena.js';

const ZOOM_MAX_SEGUIR = 3.2;      // teto de zoom (um cômodo pequeno, de perto)
const MARGEM_COMODO = 0.8;        // folga em volta dos cômodos da exibição dinâmica
const ALTURA_QUADRO = 2.3;        // do pé ao topo do balão, em metros
const PAUSA_MS = 60000;           // pausa por interação volta sozinha depois disso
const ARRASTO_PX = 6;
const RAIO_ALVO = 16;             // o alvo da câmera não se afasta mais que isso da pegada
const VELOCIDADE = 1.8;           // k = 1 - exp(-dt × VELOCIDADE)
const TOLERANCIA = 0.002;
const FOLGA_PEGADA = 3;           // folga da pegada no zoom de "estação inteira"
const VOO_MS = 1200;              // duração do "Ver a estação inteira"

let preferencia = true;   // escolha do botão (ou da URL): seguir ou câmera livre
let pausada = false;      // pausa por interação (não grava)
let timerPausa = null;
let botao = null, ponto = null, rotulo = null, pulso = null;

let assentada = false;    // a câmera chegou ao alvo e está parada
let alvo = null;          // { chave, centro (Vector3 no chão), zoom, caixa }
let forcarAlvo = true;    // recalcular o alvo no próximo quadro (retomada, pegada nova)
let grupoFoco = null, focoDesde = 0;

let zoomPegada = 1;
// "Ver a estação inteira" em andamento: { inicio, de, para, zoomDe, zoomPara } ou null
let voo = null;
let chaveLimites = '';
const centroPegada = new THREE.Vector3();   // centro da pegada no chão (cursor dos controles)
const alvoPegada = new THREE.Vector3();     // ponto do chão no centro da pegada vista pela câmera

// ---------------------------------------------------------------------------
// Estado público
// ---------------------------------------------------------------------------
export function seguindo() { return preferencia && !pausada; }
export function cameraPausada() { return pausada; }
// Sem seguir, nada se mexe sozinho: conta como assentada (a não ser no meio do voo
// do "Ver a estação inteira", que precisa de quadros até chegar)
export function cameraAssentada() { return !voo && (!seguindo() || assentada); }
export function zoomDaPegada() { return zoomPegada; }

// Área construída. A planta elástica (rodada 3) publica E.pegada; antes disso,
// o retângulo do escritório inteiro com a porta.
export function pegadaAtual() {
  if (E.pegada && !E.pegada.isEmpty?.()) return E.pegada;
  return new THREE.Box3(new THREE.Vector3(E.X0, 0, E.ZN), new THREE.Vector3(E.X1 + 1.2, 2.8, E.ZS));
}

// ---------------------------------------------------------------------------
// Botão e preferência
// ---------------------------------------------------------------------------
function gravarPreferencia(ligado) {
  try { localStorage.setItem('zoomInteligente', ligado ? 'sim' : 'nao'); } catch { /* sem armazenamento */ }
}

function atualizarBotao() {
  if (!botao) return;
  const ativo = seguindo();
  botao.classList.toggle('ligado', ativo);
  botao.classList.toggle('pausado', pausada);
  botao.setAttribute('aria-pressed', String(preferencia));
  rotulo.textContent = ativo ? 'Exibição dinâmica' : 'Câmera livre';
  botao.title = pausada ? 'Câmera livre por um instante: a exibição dinâmica volta sozinha depois de 1 minuto sem mexer'
    : ativo ? 'A câmera se ajusta para mostrar todos os astronautas na mesma tela' : 'Clique para a câmera mostrar todos os astronautas na mesma tela';
  // o ponto pulsa enquanto a pausa conta o tempo para voltar a seguir
  if (pausada && !pulso && ponto?.animate) {
    pulso = ponto.animate(
      [{ opacity: 1, transform: 'scale(1)', backgroundColor: '#ee4c01' }, { opacity: 0.35, transform: 'scale(.7)', backgroundColor: '#ee4c01' }],
      { duration: 900, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
  } else if (!pausada && pulso) {
    pulso.cancel();
    pulso = null;
  }
}

function ligarSeguir() {
  voo = null;
  pausada = false;
  clearTimeout(timerPausa);
  timerPausa = null;
  forcarAlvo = true;
  assentada = false;
  atualizarBotao();
  marcarSujo();
}

// Interação com a câmera: pausa o seguir (sem gravar) e reinicia a contagem de 60 s
function interagiu() {
  if (!preferencia) return;
  pausada = true;
  clearTimeout(timerPausa);
  timerPausa = setTimeout(ligarSeguir, PAUSA_MS);
  atualizarBotao();
}

// "Ver a estação inteira": zoom out suave até a pegada construída. Com o seguir
// ligado, conta como mexer na câmera (pausa sem gravar; "Exibição dinâmica" volta na hora).
export function verEstacaoInteira() {
  const { camera, controles } = E;
  if (!camera || !controles || !(largVista() > 0 && altVista() > 0)) return;
  interagiu();
  camera.updateMatrixWorld();
  chaveLimites = '';            // pegada e zoom refeitos agora (a planta pode ter mudado)
  atualizarLimites();
  voo = {
    inicio: performance.now(),
    de: controles.target.clone(), para: alvoPegada.clone(),
    zoomDe: camera.zoom, zoomPara: zoomPegada,
  };
  marcarSujo();
}

const suave = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);   // começa e termina devagar

// Um passo do voo; devolve true enquanto ele ainda está no ar
function passoDoVoo(agora) {
  const { camera, controles } = E;
  const t = Math.min(1, Math.max(0, (agora - voo.inicio) / VOO_MS));
  const k = suave(t);
  _b.lerpVectors(voo.de, voo.para, k).sub(controles.target);
  controles.target.add(_b);
  camera.position.add(_b);
  camera.zoom = Math.exp(Math.log(voo.zoomDe) + (Math.log(voo.zoomPara) - Math.log(voo.zoomDe)) * k);
  camera.updateProjectionMatrix();
  marcarSujo();
  if (t >= 1) { voo = null; return false; }
  return true;
}

export function iniciarCamera() {
  try { preferencia = localStorage.getItem('zoomInteligente') !== 'nao'; } catch { /* sem armazenamento */ }
  const pedido = new URLSearchParams(location.search).get('zoom');
  if (pedido === 'livre') preferencia = false;
  else if (pedido === 'seguir') preferencia = true;

  botao = document.getElementById('zoom-inteligente');
  if (botao) {
    ponto = botao.querySelector('.ponto');
    rotulo = botao.querySelector('.rotulo');
    if (!rotulo) {
      rotulo = document.createElement('span');
      rotulo.className = 'rotulo';
      botao.append(rotulo);
    }
    botao.addEventListener('click', () => {
      // pausada: o clique só volta a seguir; senão alterna e grava
      if (pausada) { preferencia = true; ligarSeguir(); }
      else {
        preferencia = !preferencia;
        if (preferencia) ligarSeguir(); else atualizarBotao();
      }
      gravarPreferencia(preferencia);
      marcarSujo();
    });
  }
  document.getElementById('ver-inteira')?.addEventListener('click', verEstacaoInteira);
  iniciarGestos();
  atualizarBotao();
}

// ---------------------------------------------------------------------------
// Gestos: arrasto, roda e pinça, duplo clique
// ---------------------------------------------------------------------------
let inicioArrasto = null, arrastando = false;
let ultimaRolagem = { t: -1e9, tipo: null };

function iniciarGestos() {
  const tela = E.renderer.domElement;
  tela.addEventListener('pointerdown', ev => {
    inicioArrasto = { x: ev.clientX, y: ev.clientY };
    arrastando = false;
  });
  tela.addEventListener('pointermove', ev => {
    if (!inicioArrasto || !ev.buttons) return;
    if (!arrastando && Math.hypot(ev.clientX - inicioArrasto.x, ev.clientY - inicioArrasto.y) > ARRASTO_PX) arrastando = true;
    if (arrastando) { voo = null; interagiu(); }
  });
  const soltar = () => { inicioArrasto = null; arrastando = false; };
  window.addEventListener('pointerup', soltar);
  window.addEventListener('pointercancel', soltar);

  // Captura: chega antes do MapControls e não deixa ele tratar a roda
  tela.addEventListener('wheel', aoRolar, { capture: true, passive: false });
  tela.addEventListener('dblclick', ev => {
    if (seguindo() || sobreAstronauta(ev)) return;
    preferencia = true;   // vale para esta abertura; só o botão grava
    ligarSeguir();
  });
  // inércia dos controles e arrasto pedem quadro novo
  E.controles.addEventListener('change', marcarSujo);
}

// Classifica a rolagem: 'pinca' (trackpad com ctrlKey), 'roda' (mouse comum) ou 'pan' (dois dedos)
export function tipoDeRolagem(ev, agora = performance.now()) {
  let tipo;
  if (ev.ctrlKey) tipo = 'pinca';
  else if (ev.deltaMode === 1 || ev.deltaMode === 2) tipo = 'roda';
  else if (ev.deltaX !== 0) tipo = 'pan';
  else if (!Number.isInteger(ev.deltaY)) tipo = 'pan';                                   // fracionário: trackpad
  else if (ev.wheelDeltaY && ev.wheelDeltaY === -3 * ev.deltaY) tipo = 'pan';             // assinatura do trackpad no Chrome e no Safari
  else if (Math.abs(ev.deltaY) >= 50 || (ev.wheelDeltaY && ev.wheelDeltaY % 120 === 0)) tipo = 'roda';   // degraus grandes e inteiros
  else tipo = 'pan';
  // no meio de um mesmo gesto do trackpad, a inércia pode mandar um degrau grande:
  // continua passeando em vez de virar zoom de repente
  if (tipo === 'roda' && ev.deltaMode === 0 && ultimaRolagem.tipo === 'pan' && agora - ultimaRolagem.t < 120) tipo = 'pan';
  ultimaRolagem = { t: agora, tipo };
  return tipo;
}

function aoRolar(ev) {
  ev.preventDefault();
  ev.stopImmediatePropagation();
  voo = null;   // a mão da pessoa manda mais que o voo
  interagiu();
  const tipo = tipoDeRolagem(ev);
  const fatorModo = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1;
  if (tipo === 'pan') passear(ev.deltaX * fatorModo, ev.deltaY * fatorModo);
  else {
    // mesma sensibilidade do MapControls: 0,95 ^ (zoomSpeed × |delta| × 0,01); a pinça vale 10×
    const d = ev.deltaY * fatorModo * (tipo === 'pinca' ? 10 : 1);
    if (!d) return;
    const escala = Math.pow(0.95, E.controles.zoomSpeed * Math.abs(d) * 0.01);
    zoomNoCursor(d < 0 ? 1 / escala : escala, ev.clientX, ev.clientY);
  }
}

const _dir = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

function ndcDoCliente(x, y) {
  const r = E.renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(((x - r.left) / (r.width || 1)) * 2 - 1, -((y - r.top) / (r.height || 1)) * 2 + 1);
}

// Leva o alvo dos controles de volta ao chão (y = 0) pela direção da câmera: a imagem não muda
function alvoNoChao() {
  const { camera, controles } = E;
  camera.getWorldDirection(_dir);
  if (Math.abs(_dir.y) < 1e-4) return;
  const t = -controles.target.y / _dir.y;
  controles.target.addScaledVector(_dir, t);
  camera.position.addScaledVector(_dir, t);
}

// Zoom que mantém parado o ponto sob o cursor
export function zoomNoCursor(fator, clienteX, clienteY) {
  const { camera, controles } = E;
  const ndc = ndcDoCliente(clienteX, clienteY);
  camera.updateMatrixWorld();
  _a.set(ndc.x, ndc.y, 0).unproject(camera);
  camera.zoom = THREE.MathUtils.clamp(camera.zoom * fator, controles.minZoom, controles.maxZoom);
  camera.updateProjectionMatrix();
  _b.set(ndc.x, ndc.y, 0).unproject(camera);
  _a.sub(_b);
  camera.position.add(_a);
  controles.target.add(_a);
  alvoNoChao();
  marcarSujo();
}

// Passeia pela estação (dois dedos no trackpad): dx e dy em pixels, como num mapa
export function passear(dx, dy) {
  const { camera, controles } = E;
  const larguraTela = E.renderer.domElement.clientWidth || window.innerWidth || 1;
  const porPixel = (camera.right - camera.left) / camera.zoom / larguraTela;
  _a.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(dx * porPixel);
  _b.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(-dy * porPixel);
  _a.add(_b);
  camera.position.add(_a);
  controles.target.add(_a);
  alvoNoChao();
  marcarSujo();
}

const raio = new THREE.Raycaster();
function sobreAstronauta(ev) {
  // quem espera invisível do lado de fora da entrada não conta (o raio acerta objeto invisível)
  const alvos = [...E.agentes.values()].filter(a => !a.aguardandoEntrada && a.boneco?.visible)
    .map(a => a.boneco?.userData?.hitbox ?? a.boneco).filter(Boolean);
  if (!alvos.length) return false;
  raio.setFromCamera(ndcDoCliente(ev.clientX, ev.clientY), E.camera);
  return raio.intersectObjects(alvos, true).length > 0;
}

// ---------------------------------------------------------------------------
// Medidas no espaço da câmera
// ---------------------------------------------------------------------------
const _p = new THREE.Vector3();

function novaCaixa() { return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }; }
function incluirNaCaixa(c, ponto) {
  _p.copy(ponto).applyMatrix4(E.camera.matrixWorldInverse);
  c.minX = Math.min(c.minX, _p.x); c.maxX = Math.max(c.maxX, _p.x);
  c.minY = Math.min(c.minY, _p.y); c.maxY = Math.max(c.maxY, _p.y);
}
function largVista() { return E.camera.right - E.camera.left; }
function altVista() { return E.camera.top - E.camera.bottom; }

// Ponto do chão (y = 0) que aparece no ponto (x, y) do espaço da câmera
function noChao(cx, cy, destino = new THREE.Vector3()) {
  const { camera } = E;
  destino.set(cx, cy, 0).applyMatrix4(camera.matrixWorld);
  camera.getWorldDirection(_dir);
  if (Math.abs(_dir.y) > 1e-4) destino.addScaledVector(_dir, -destino.y / _dir.y);
  return destino;
}

// Pegada: zoom de "estação inteira", limites de zoom e de arrasto (refeito quando a pegada ou o frustum mudam)
function atualizarLimites() {
  const { camera, controles } = E;
  const p = pegadaAtual();
  const chave = [p.min.x, p.min.y, p.min.z, p.max.x, p.max.y, p.max.z, camera.left, camera.right, camera.top, camera.bottom]
    .map(n => (+n).toFixed(3)).join(',');
  if (chave === chaveLimites) return;
  chaveLimites = chave;
  camera.updateMatrixWorld();
  const c = novaCaixa();
  for (const x of [p.min.x, p.max.x]) for (const y of [p.min.y, p.max.y]) for (const z of [p.min.z, p.max.z]) incluirNaCaixa(c, _a.set(x, y, z));
  zoomPegada = Math.min(largVista() / (c.maxX - c.minX + FOLGA_PEGADA), altVista() / (c.maxY - c.minY + FOLGA_PEGADA));
  controles.minZoom = zoomPegada * 0.85;
  p.getCenter(centroPegada).setY(0);
  controles.cursor.copy(centroPegada);
  controles.maxTargetRadius = RAIO_ALVO;
  noChao((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, alvoPegada);
  forcarAlvo = true;
  marcarSujo();
}

// ---------------------------------------------------------------------------
// Quem entra no quadro
// ---------------------------------------------------------------------------
// Cômodo onde o astronauta está (módulo da estação que contém o ponto), ou null no corredor
function comodoDe(pos) {
  const mods = E.estacao?.modulos;
  if (!mods) return null;
  for (const m of mods.values()) {
    if (m.estado === 'desacoplando' || m.x0 === undefined) continue;
    if (pos.x >= m.x0 && pos.x <= m.x1 && pos.z >= m.z0 && pos.z <= m.z1) return m;
  }
  return null;
}

function calcularCandidato() {
  // quem está indo embora não entra no quadro; quem acabou de chegar entra (está na porta)
  const presentes = [...E.agentes.values()].filter(a => a.boneco && a.alvo !== 'fora' && !a.aguardandoEntrada);
  grupoFoco = null;
  if (!presentes.length) return { chave: '(vazio)', centro: alvoPegada.clone(), zoom: zoomPegada, caixa: null };
  const caixa = novaCaixa();
  const chaves = new Set();
  for (const a of presentes) {
    const pos = a.boneco.position;
    const m = comodoDe(pos);
    if (m) {
      chaves.add(m.id);
      // o cômodo inteiro, do chão até a altura da parede
      for (const x of [m.x0, m.x1]) for (const z of [m.z0, m.z1]) {
        incluirNaCaixa(caixa, _a.set(x, 0, z));
        incluirNaCaixa(caixa, _a.set(x, ALTURA_QUADRO, z));
      }
    } else {
      chaves.add('corredor');
      incluirNaCaixa(caixa, _a.set(pos.x, 0, pos.z));
      incluirNaCaixa(caixa, _a.set(pos.x, ALTURA_QUADRO, pos.z));
    }
  }
  const zoom = Math.min(largVista() / (caixa.maxX - caixa.minX + 2 * MARGEM_COMODO), altVista() / (caixa.maxY - caixa.minY + 2 * MARGEM_COMODO));
  const centro = noChao((caixa.minX + caixa.maxX) / 2, (caixa.minY + caixa.maxY) / 2);
  // o alvo fica dentro do raio permitido pelos controles, senão nunca assenta
  _b.subVectors(centro, centroPegada);
  if (_b.length() > RAIO_ALVO - 0.05) centro.copy(centroPegada).addScaledVector(_b.normalize(), RAIO_ALVO - 0.05);
  const zMin = Math.min(zoomPegada, ZOOM_MAX_SEGUIR);
  const zoomFinal = THREE.MathUtils.clamp(zoom, zMin, ZOOM_MAX_SEGUIR);
  // no zoom da estação inteira, todos já cabem na pegada: centra a pegada
  if (zoomFinal <= zoomPegada * 1.02) centro.copy(alvoPegada);
  return { chave: [...chaves].sort().join('|'), centro, zoom: zoomFinal, caixa };
}

// Histerese: o alvo atual ainda serve?
function precisaTrocar(c) {
  if (!alvo || !c.caixa) return false;
  _p.copy(alvo.centro).applyMatrix4(E.camera.matrixWorldInverse);
  const meiaL = largVista() / (2 * alvo.zoom), meiaA = altVista() / (2 * alvo.zoom);
  const fora = Math.max(
    Math.max(Math.abs(c.caixa.minX - _p.x), Math.abs(c.caixa.maxX - _p.x)) / meiaL,
    Math.max(Math.abs(c.caixa.minY - _p.y), Math.abs(c.caixa.maxY - _p.y)) / meiaA);
  if (fora > 0.85) return true;
  const ocupa = Math.max((c.caixa.maxX - c.caixa.minX) / (2 * meiaL), (c.caixa.maxY - c.caixa.minY) / (2 * meiaA));
  return ocupa < 0.4 && c.zoom > alvo.zoom * 1.05;
}

// ---------------------------------------------------------------------------
// Chamada a cada quadro processado. Atualiza os limites sempre; só move a câmera
// com o seguir ligado e sem pausa.
// ---------------------------------------------------------------------------
export function enquadrar(dt, agora = performance.now()) {
  const { camera, controles } = E;
  if (!camera || !controles || E.X1 === E.X0) return;
  // frustum ainda sem tamanho (janela zero): nada a enquadrar
  if (!(largVista() > 0 && altVista() > 0)) return;
  // zoom estragado (NaN ou zero, ex.: carregou numa janela de tamanho zero): recomeça da pegada
  if (!(camera.zoom > 0) || !Number.isFinite(camera.zoom)) { camera.zoom = 1; chaveLimites = null; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  atualizarLimites();
  if (voo) { passoDoVoo(performance.now()); assentada = false; return; }
  if (!seguindo()) { assentada = true; return; }

  const c = calcularCandidato();
  if (forcarAlvo || !alvo || c.chave !== alvo.chave || (c.caixa === null && !alvo.centro.equals(c.centro)) || precisaTrocar(c)) {
    alvo = c;
    forcarAlvo = false;
    assentada = false;
  }

  _b.subVectors(alvo.centro, controles.target);
  if (_b.length() < TOLERANCIA && Math.abs(camera.zoom - alvo.zoom) < TOLERANCIA) {
    if (!assentada) {
      controles.target.add(_b);
      camera.position.add(_b);
      if (camera.zoom !== alvo.zoom) { camera.zoom = alvo.zoom; camera.updateProjectionMatrix(); }
      assentada = true;
      marcarSujo();
    }
    return;
  }
  assentada = false;
  const k = 1 - Math.exp(-Math.max(0, dt) * VELOCIDADE);
  _b.multiplyScalar(k);
  controles.target.add(_b);
  camera.position.add(_b);
  camera.zoom = Math.exp(Math.log(camera.zoom) + (Math.log(alvo.zoom) - Math.log(camera.zoom)) * k);
  camera.updateProjectionMatrix();
}

// Para depuração no console: (await import('./camera.js')).estadoDaCamera()
export function estadoDaCamera() {
  return {
    seguindo: seguindo(), preferencia, pausada, assentada, voo: !!voo, zoom: E.camera?.zoom, zoomPegada,
    alvo: alvo && { chave: alvo.chave, zoom: alvo.zoom, centro: alvo.centro.toArray().map(n => +n.toFixed(2)) },
    grupoFoco, focoDesde,
  };
}
