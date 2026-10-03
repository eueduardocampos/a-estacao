// Renderização: renderer, cena, câmera ortográfica, controles de zoom e
// arrastar, luzes, ambiente, sombra e o renderer das placas em HTML (CSS2D).
// Os objetos criados ficam em E (estado.js).
//
// Luz (VIS-04):
// - ambiente de sala (RoomEnvironment pré-filtrado) com intensidade 0,45, que dá
//   gradiente e reflexo macio aos materiais, mais um hemisfério fraco;
// - sol com sombra macia: PCFShadowMap com radius (o radius não funciona no
//   PCFSoftShadowMap) e mapa de 2048;
// - um chão invisível sob a base que só recebe a sombra do diorama (ShadowMaterial).
// Nada de adicionar ou remover luz depois da carga: isso recompila os shaders.
//
// Sombra sob demanda (PERF-02): shadowMap.autoUpdate = false. renderizar() só
// recalcula a sombra quando E.sombraSuja está marcada (main.js marca quando alguém
// anda; tween.js marca enquanto anima; ajustarSombra e podarSombras também marcam).
//
// Expediente e fim de tarde (VAZIO-05): definirExpediente(ligado) troca, em 4 s,
// só a intensidade e a cor das luzes que já existem. Quem chama é o hud.
//
// Desenho sob demanda (PERF-01): marcarSujo() pede um quadro novo mesmo com a cena
// parada (resize, hover, dado novo, TV ou placa trocada, balão novo).

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { E } from './estado.js';

// ---------------------------------------------------------------------------
// Calibragem da luz (dá para ajustar pelo console com calibrarLuz)
// ---------------------------------------------------------------------------
const LUZ = {
  hemisferio: 0.5,        // H: hemisfério no expediente (era 1,1 antes do ambiente de sala)
  hemisferioSemAmbiente: 1.1,   // se o ambiente de sala falhar, volta ao valor antigo
  ambiente: 0.45,         // cena.environmentIntensity
  exposicao: 1.05,
  transicaoS: 4,          // duração da troca entre expediente e fim de tarde
  expediente: { sol: 2.2, corSol: new THREE.Color(0xffe2c0), fatorHemisferio: 1, janelas: 1 },
  fimDeTarde: { sol: 1.5, corSol: new THREE.Color(0xffc890), fatorHemisferio: 0.82, janelas: 1.6 },
};

// Direção do sol: a mesma inclinação da v0.4 (posição (largura × 0,35; 22; 14) com largura 26)
const DIRECAO_SOL = new THREE.Vector3(26 * 0.35, 22, 14).normalize();
const DISTANCIA_SOL = 30;
const ALTURA_CHAO_SOMBRA = -0.82;      // logo abaixo da base do diorama (que vai de -0,8 a -0,1)
const MENOR_PECA_COM_SOMBRA = 0.12;    // peças menores que isso não projetam sombra

let sombrasRefeitas = 0;               // total de vezes que a sombra foi recalculada (métricas)

export function iniciarCena(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(densidade());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;      // só recalcula quando E.sombraSuja
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LUZ.exposicao;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const rotulos = new CSS2DRenderer({ element: document.getElementById('rotulos') });

  const cena = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 160);

  // Zoom (pinça e roda: camera.js cuida) e arrastar para passear; sem girar, para manter o isométrico.
  // minZoom, cursor e maxTargetRadius são ajustados pela câmera conforme a pegada.
  const controles = new MapControls(camera, renderer.domElement);
  Object.assign(controles, {
    enableRotate: false, enableDamping: true, dampingFactor: 0.12,
    zoomToCursor: true, zoomSpeed: 0.6, minZoom: 0.7, maxZoom: 6, screenSpacePanning: true,
  });
  controles.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controles.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };

  // Ambiente de sala: reflexo e gradiente macios nos materiais
  let comAmbiente = false;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const sala = new RoomEnvironment();
    cena.environment = pmrem.fromScene(sala, 0.04).texture;
    cena.environmentIntensity = LUZ.ambiente;
    sala.dispose?.();
    pmrem.dispose();
    comAmbiente = true;
  } catch (erro) {
    console.warn('A Estação: ambiente de sala indisponível, seguindo só com o hemisfério', erro);
  }
  if (!comAmbiente) LUZ.hemisferio = LUZ.hemisferioSemAmbiente;

  const hemisferio = new THREE.HemisphereLight(0xfff3e2, 0x7d73a6, LUZ.hemisferio);
  cena.add(hemisferio);
  const sol = new THREE.DirectionalLight(LUZ.expediente.corSol.getHex(), LUZ.expediente.sol);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.bias = -0.0004;
  sol.shadow.normalBias = 0.02;
  sol.shadow.radius = 3.5;          // penumbra macia (vale no PCFShadowMap)
  cena.add(sol, sol.target);

  // Chão invisível que só recebe a sombra do diorama
  const chaoSombra = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.15 }));
  chaoSombra.rotation.x = -Math.PI / 2;
  chaoSombra.position.y = ALTURA_CHAO_SOMBRA;
  chaoSombra.receiveShadow = true;
  chaoSombra.castShadow = false;
  chaoSombra.raycast = () => {};
  Object.assign(chaoSombra.userData, { semMapa: true, semPegada: true, chaoSombra: true });
  cena.add(chaoSombra);

  Object.assign(E, { renderer, rotulos, cena, camera, controles, hemisferio, sol });
  E.sujo = true;
  E.sombraSuja = true;
  aplicarLuz();
  window.addEventListener('resize', ajustarTela);
  vigiarDensidade();
  ajustarTela();
}

// ---------------------------------------------------------------------------
// Tela e nitidez
// ---------------------------------------------------------------------------
function densidade() { return Math.min(window.devicePixelRatio || 1, 2); }

// Ao arrastar a janela entre monitor comum e Retina, o devicePixelRatio muda:
// refaz o pixel ratio e volta a vigiar o valor novo (PERF-08/CAM-09)
function vigiarDensidade() {
  if (typeof window.matchMedia !== 'function') return;
  const consulta = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  const aoMudar = () => {
    consulta.removeEventListener?.('change', aoMudar);
    ajustarTela();
    vigiarDensidade();
  };
  consulta.addEventListener?.('change', aoMudar);
}

// Ajusta o frustum, o pixel ratio e o tamanho do canvas.
// O frustum é fixo pela largura máxima da planta (E.larguraMaxima, da planta elástica)
// para não dar saltos quando a estação cresce; o zoom da câmera é que se adapta.
export function ajustarTela() {
  const { camera, renderer, rotulos } = E;
  if (!camera) return;
  const w = window.innerWidth, h = window.innerHeight;
  // janela com tamanho zero (aba ou painel oculto ao carregar): espera o próximo resize,
  // senão o frustum vira NaN e o zoom da câmera fica NaN para sempre (tela vazia)
  if (!(w > 0 && h > 0)) return;
  const asp = w / h;
  const largura = E.larguraMaxima ?? ((E.X1 - E.X0) || 26);
  const profundidade = (E.ZS - E.ZN) || 16;
  const meiaLargura = (largura + profundidade) * 0.72 / 2 + 1.5;
  const meiaAlt = Math.max(11, meiaLargura / asp);
  Object.assign(camera, { left: -meiaAlt * asp, right: meiaAlt * asp, top: meiaAlt, bottom: -meiaAlt });
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(densidade());
  renderer.setSize(w, h);
  rotulos.setSize(w, h);
  E.sujo = true;
}

// Pede um quadro novo mesmo com a cena parada
export function marcarSujo() { E.sujo = true; }

// Desenha um quadro. Devolve true se os controles mexeram na câmera (inércia, arrasto).
export function renderizar() {
  const { renderer, controles } = E;
  const mudou = controles.update();
  if (E.sombraSuja) {
    renderer.shadowMap.needsUpdate = true;
    E.sombraSuja = false;
    sombrasRefeitas++;
  }
  renderer.render(E.cena, E.camera);
  E.rotulos.render(E.cena, E.camera);
  return mudou;
}

// Quantas vezes a sombra já foi recalculada (main.js tira a taxa por segundo)
export function contagemSombras() { return sombrasRefeitas; }

// ---------------------------------------------------------------------------
// Sombra
// ---------------------------------------------------------------------------
const _v = new THREE.Vector3();

// Reposiciona o sol e ajusta a câmera de sombra ao contorno real da estação.
// caixa: THREE.Box3 do que está construído (a pegada). Chamada depois da construção
// e pela planta elástica (rodada 3) quando a pegada muda.
export function ajustarSombra(caixa) {
  const { sol } = E;
  if (!sol || !caixa || caixa.isEmpty()) return;
  // a base do diorama desce até -0,8 e passa 0,3 das bordas
  const b = caixa.clone();
  b.min.y = Math.min(b.min.y, ALTURA_CHAO_SOMBRA);
  b.min.x -= 0.4; b.min.z -= 0.4; b.max.x += 0.4; b.max.z += 0.4;
  const centro = b.getCenter(new THREE.Vector3()).setY(0);
  sol.target.position.copy(centro);
  sol.position.copy(centro).addScaledVector(DIRECAO_SOL, DISTANCIA_SOL);
  sol.updateMatrixWorld();
  sol.target.updateMatrixWorld();

  // espaço da luz (como a câmera de sombra enxerga: do sol para o alvo)
  const vista = new THREE.Matrix4().lookAt(sol.position, sol.target.position, new THREE.Vector3(0, 1, 0));
  vista.setPosition(sol.position).invert();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const incluir = p => {
    _v.copy(p).applyMatrix4(vista);
    minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x);
    minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y);
    minZ = Math.min(minZ, _v.z); maxZ = Math.max(maxZ, _v.z);
  };
  const canto = new THREE.Vector3();
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
    canto.set(x, y, z);
    incluir(canto);
    // onde a sombra desse canto cai no chão de sombra
    const t = (y - ALTURA_CHAO_SOMBRA) / DIRECAO_SOL.y;
    incluir(canto.clone().addScaledVector(DIRECAO_SOL, -t));
  }
  const folga = 0.5;
  Object.assign(sol.shadow.camera, {
    left: minX - folga, right: maxX + folga, bottom: minY - folga, top: maxY + folga,
    near: Math.max(0.1, -maxZ - 1), far: -minZ + 1,
  });
  sol.shadow.camera.updateProjectionMatrix();
  E.sombraSuja = true;
  E.sujo = true;
}

function ehDeAstronauta(o) {
  for (let p = o; p; p = p.parent) {
    const u = p.userData;
    if (u && (u.agenteId || u.npc || u.hitbox === true || u.astronauta)) return true;
  }
  return false;
}

// Tira a sombra das peças pequenas (maior dimensão abaixo de 0,12): pés, teclados,
// canecas, enfeites. Percorre a cena uma vez depois da construção, sem tocar nos
// astronautas. Peças com escala quase zero (mesa em apoio, enfeite recolhido) são
// medidas pelo tamanho cheio. Devolve quantas peças perderam a sombra.
export function podarSombras(raiz = E.cena) {
  let podadas = 0;
  const tam = new THREE.Vector3(), escala = new THREE.Vector3();
  const s = v => (Math.abs(v) < 0.01 ? 1 : Math.abs(v));
  raiz.updateMatrixWorld(true);
  raiz.traverse(o => {
    if (!o.isMesh || !o.castShadow || !o.geometry) return;
    if (ehDeAstronauta(o)) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox) return;
    g.boundingBox.getSize(tam);
    o.getWorldScale(escala);
    const maior = Math.max(tam.x * s(escala.x), tam.y * s(escala.y), tam.z * s(escala.z));
    if (maior < MENOR_PECA_COM_SOMBRA) { o.castShadow = false; podadas++; }
  });
  E.sombraSuja = true;
  return podadas;
}

// ---------------------------------------------------------------------------
// Expediente e fim de tarde
// ---------------------------------------------------------------------------
let mistura = 0;        // 0 = expediente, 1 = fim de tarde (valor atual)
let misturaAlvo = 0;
const _corA = new THREE.Color(), _corB = new THREE.Color();

// ligado = alguém trabalhando ou esperando. Chamar de novo com o mesmo valor não reinicia nada.
export function definirExpediente(ligado) {
  const alvo = ligado ? 0 : 1;
  if (alvo === misturaAlvo) return;
  misturaAlvo = alvo;
  E.sujo = true;
}

export function emExpediente() { return misturaAlvo === 0; }
export function luzEmTransicao() { return mistura !== misturaAlvo; }

// Chamada a cada quadro pelo main. Devolve true enquanto a luz está mudando.
export function atualizarLuz(dt) {
  if (mistura === misturaAlvo) return false;
  const passo = Math.max(0, dt) / LUZ.transicaoS;
  mistura = misturaAlvo > mistura ? Math.min(misturaAlvo, mistura + passo) : Math.max(misturaAlvo, mistura - passo);
  aplicarLuz();
  return true;
}

function aplicarLuz() {
  const { sol, hemisferio } = E;
  if (!sol || !hemisferio) return;
  const f = mistura * mistura * (3 - 2 * mistura);   // começo e fim suaves
  const a = LUZ.expediente, b = LUZ.fimDeTarde;
  sol.intensity = a.sol + (b.sol - a.sol) * f;
  sol.color.copy(_corA.copy(a.corSol)).lerp(_corB.copy(b.corSol), f);
  hemisferio.intensity = LUZ.hemisferio * (a.fatorHemisferio + (b.fatorHemisferio - a.fatorHemisferio) * f);
  if (E.cena) E.cena.environmentIntensity = LUZ.ambiente;
  if (E.renderer) E.renderer.toneMappingExposure = LUZ.exposicao;
  // janelas com um pouco mais de brilho no fim de tarde (se pecas.js expuser E.janelas)
  const fatorJanela = a.janelas + (b.janelas - a.janelas) * f;
  for (const j of E.janelas || []) {
    const m = j?.material ?? j;
    if (!m || typeof m.emissiveIntensity !== 'number') continue;
    m.userData ??= {};
    m.userData.brilhoBase ??= m.emissiveIntensity;
    m.emissiveIntensity = m.userData.brilhoBase * fatorJanela + 0.12 * f;
  }
}

// Ajuste fino pelo console, para comparar prints:
//   (await import('./cena.js')).calibrarLuz({ hemisferio: 0.55, ambiente: 0.5 })
export function calibrarLuz({ hemisferio, ambiente, exposicao, raioSombra } = {}) {
  if (hemisferio != null) LUZ.hemisferio = hemisferio;
  if (ambiente != null) LUZ.ambiente = ambiente;
  if (exposicao != null) LUZ.exposicao = exposicao;
  if (raioSombra != null && E.sol) E.sol.shadow.radius = raioSombra;
  aplicarLuz();
  E.sujo = true;
  return { hemisferio: LUZ.hemisferio, ambiente: LUZ.ambiente, exposicao: LUZ.exposicao, raioSombra: E.sol?.shadow.radius, mistura };
}
