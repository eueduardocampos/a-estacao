// Biblioteca da memória: estantes com o conhecimento que fica de uma conversa
// para outra (memórias por área, skills, regras CLAUDE.md e AGENTS.md, memórias
// do Codex), um fichário que é o índice (MEMORY.md), um quadro com o que mudou
// há pouco e o que está sendo consultado agora, poltrona de leitura e um
// astronauta bibliotecário com rotina própria. Dados de /api/memoria
// (app/fonte-memoria.js). Nunca mostra conteúdo de memória: só títulos curtos.
//
// montarSalaMemoria(opc) -> { grupo, atualizar(dados), animar(t), largura, profundidade,
//   pontoDaArea(id), vagas() }
//   atualizar: acende a prateleira de quem está sendo consultado ou gravado agora,
//     ajusta a quantidade de livros de cada estante, redesenha placas e quadro;
//   animar(t): t em segundos (relógio da página);
//   pontoDaArea(id): { pos: Vector3 (no grupo da sala), olhar } onde um astronauta de
//     sessão fica para consultar aquela área ('indice' = fichário), ao lado do
//     lugar do bibliotecário, para os dois não se sobreporem;
//   vagas(): todos os pontos acima, com { area, pos, olhar }.

import * as THREE from 'three';
import { caixa, cilindro, piso, planta, tapete, pendente, luminariaPe, luminariaMesa, caneca, rodape, COR, mat } from './pecas.js';
import { criarAstronauta } from './personagens.js';
import { registrarNpc, removerNpc, passoNpc, marcarAndando, criarRoteador } from './sala-corpos.js';

const FONTE = 'Figtree, -apple-system, "Helvetica Neue", sans-serif';
const NAVY = '#030870', AZUL = '#0038ef', LARANJA = '#ee4c01';

// Tons calmos por área (lombadas dos livros, faixa da placa e chips do quadro)
export const CORES_AREA = {
  preferencias: 0xc98a6a, projetos: 0x8fa3bf, referencias: 0xa8c39f, voce: 0xd9c27a,
  skills: 0xb7a6d9, regras: 0x7d8a9e, codex: 0x8fb4a8, indice: 0xb98552,
};
const NOMES_AREA = {
  preferencias: 'Preferências', projetos: 'Projetos', referencias: 'Referências', voce: 'Sobre você',
  skills: 'Skills', regras: 'Regras', codex: 'Codex', indice: 'Índice',
};
const hex = n => '#' + n.toString(16).padStart(6, '0');

// Medidas
const LARG = 9.0, PROF = 5.2, ALT = 2.9;
const X0 = -LARG / 2, ZF = -PROF / 2;
const LE = 1.2, PE = 0.38, HE = 2.1;          // estante: largura, profundidade, altura
const LARG_ESTANTE = LE;
const ESCALA = 1.45, VEL = 1.0, RAIO = 0.32;   // bibliotecário

function sorteador(s) { let x = s % 2147483647 || 1; return () => (x = (x * 48271) % 2147483647) / 2147483647; }

function haQuanto(ms, agora = Date.now()) {
  const s = Math.max(0, Math.round((agora - ms) / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  if (s < 2 * 86400) return 'ontem';
  return `há ${Math.round(s / 86400)} dias`;
}

// Canvas como textura (fosco, com um pouco de brilho próprio para ler à meia-luz)
function telaCanvas(W, H, larg, alt, brilho = 0.3) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: textura, emissive: 0xffffff, emissiveMap: textura, emissiveIntensity: brilho, roughness: 0.85 });
  const plano = new THREE.Mesh(new THREE.PlaneGeometry(larg, alt), material);
  return { canvas, ctx: canvas.getContext('2d'), textura, material, plano };
}

function cortar(g, texto, max) {
  if (g.measureText(texto).width <= max) return texto;
  let t = texto;
  while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t.replace(/[\s,.;:]+$/, '') + '…';
}
function encaixar(g, texto, maxLarg, tam, peso = 800, min = 18) {
  do { g.font = `${peso} ${tam}px ${FONTE}`; tam -= 2; } while (g.measureText(texto).width > maxLarg && tam > min);
}
function retangulo(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

// Quem precisa redesenhar quando a fonte Figtree terminar de carregar
const aoCarregarFonte = new Set();
if (typeof document !== 'undefined' && document.fonts?.ready) document.fonts.ready.then(() => { for (const f of aoCarregarFonte) f(); });

// Brilho: gradiente radial aditivo, uma textura só
let texturaBrilho = null;
function brilho() {
  if (texturaBrilho) return texturaBrilho;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 32, 2, 64, 32, 62);
  r.addColorStop(0, 'rgba(255,255,255,0.95)'); r.addColorStop(0.45, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 64);
  texturaBrilho = new THREE.CanvasTexture(c);
  return texturaBrilho;
}
const COR_LUZ = { consultar: new THREE.Color(0xffc978), usar: new THREE.Color(0xffc978), gravar: new THREE.Color(0xff7a2a) };

// ---------------------------------------------------------------------------
// Placa de madeira com o nome da área e quantos itens tem
// ---------------------------------------------------------------------------
function criarPlaca(area, larg = LE - 0.12) {
  const alt = 0.26;
  const W = 512, H = Math.round(512 * alt / larg);
  const t = telaCanvas(W, H, larg, alt, 0.35);
  const g = new THREE.Group();
  caixa(larg + 0.04, alt + 0.04, 0.03, COR.madeiraEscura, 0, -0.02, -0.018, g, { seg: 0 });
  t.plano.position.y = alt / 2;
  g.add(t.plano);
  let assinatura = null, args = null;
  function desenhar(total, acao, forcar = false) {
    const chave = total + '|' + acao;
    if (chave === assinatura && !forcar) return;
    assinatura = chave; args = [total, acao];
    const c = t.ctx;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#f4efe6'; c.fillRect(0, 0, W, H);
    c.fillStyle = hex(CORES_AREA[area]); c.fillRect(0, 0, 18, H);
    const destaque = acao === 'gravar' ? LARANJA : acao ? AZUL : null;
    if (destaque) { c.strokeStyle = destaque; c.lineWidth = 10; c.strokeRect(5, 5, W - 10, H - 10); }
    // número num chip à direita
    const num = String(total ?? '?');
    c.font = `800 56px ${FONTE}`;
    const wn = Math.max(76, c.measureText(num).width + 36);
    c.fillStyle = destaque || 'rgba(3,8,112,0.08)';
    retangulo(c, W - wn - 18, (H - 76) / 2, wn, 76, 38); c.fill();
    c.fillStyle = destaque ? '#ffffff' : NAVY;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(num, W - 18 - wn / 2, H / 2 + 3);
    c.fillStyle = '#2a2e45'; c.textAlign = 'left';
    encaixar(c, NOMES_AREA[area], W - wn - 70, 58);
    c.fillText(NOMES_AREA[area], 40, H / 2 + 3);
    t.textura.needsUpdate = true;
  }
  aoCarregarFonte.add(() => args && desenhar(args[0], args[1], true));
  return { grupo: g, desenhar };
}

// ---------------------------------------------------------------------------
// Estante de uma área: 4 nichos, livros instanciados, placa no topo, nichos que acendem
// ---------------------------------------------------------------------------
function criarEstante(area, semente, LE = LARG_ESTANTE) {
  const g = new THREE.Group();
  caixa(LE, HE, PE, COR.madeiraMedia, 0, 0, 0, g);
  const nichos = [];
  for (let p = 0; p < 4; p++) {
    const y = 0.15 + p * 0.5;
    const m = mat(0x6e4529).clone();
    m.emissive = new THREE.Color(0xffc978); m.emissiveIntensity = 0;
    caixa(LE - 0.1, 0.4, 0.3, 0x6e4529, 0, y, 0.06, g, { sombra: false, material: m });
    // faixa de luz embaixo da tábua de cima e brilho aditivo na frente do nicho
    const fita = new THREE.Mesh(new THREE.BoxGeometry(LE - 0.16, 0.012, 0.012), new THREE.MeshStandardMaterial({ color: 0x5a3a24, emissive: 0xffc978, emissiveIntensity: 0 }));
    fita.position.set(0, y + 0.385, 0.205);
    g.add(fita);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(LE + 0.2, 0.62), new THREE.MeshBasicMaterial({
      map: brilho(), color: 0xffc978, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.set(0, y + 0.2, 0.235);
    halo.renderOrder = 5;
    halo.raycast = () => {};
    g.add(halo);
    nichos.push({ y, mat: m, fita: fita.material, halo: halo.material, nivel: 0 });
  }
  // livros: vagas sorteadas uma vez; o número visível acompanha o total da área
  const r = sorteador(semente);
  const base = new THREE.Color(CORES_AREA[area]);
  const paleta = [base.clone(), base.clone().lerp(new THREE.Color(0xffffff), 0.35), base.clone().lerp(new THREE.Color(0x2a2e45), 0.25),
    new THREE.Color(0xe8dcc6), new THREE.Color(0xf1ede6), base.clone().lerp(new THREE.Color(0xe8dcc6), 0.5)];
  const vagas = [];
  for (const p of [1, 2, 0, 3]) {
    let lx = -LE / 2 + 0.1;
    while (lx < LE / 2 - 0.14) {
      const w = 0.05 + r() * 0.05, h = 0.22 + r() * 0.13;
      vagas.push({ p, x: lx + w / 2, w, h, cor: paleta[Math.floor(r() * paleta.length)] });
      lx += w + 0.008;
    }
  }
  const livros = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.82 }), vagas.length);
  livros.castShadow = false; livros.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  vagas.forEach((l, i) => {
    v.set(l.x, 0.15 + l.p * 0.5 + l.h / 2, 0.1); s.set(l.w, l.h, 0.24);
    m4.compose(v, q, s);
    livros.setMatrixAt(i, m4);
    livros.setColorAt(i, l.cor);
  });
  livros.count = 0;
  livros.frustumCulled = false;
  g.add(livros);
  // aparador de livros onde a fileira acaba (fica no fim do que está à mostra)
  const aparadores = [0, 1, 2, 3].map(() => { const a = caixa(0.02, 0.18, 0.2, COR.grafite, 0, 0, 0.1, g, { seg: 0, sombra: false }); a.visible = false; return a; });

  // estante quase vazia: vasinho e dois livros deitados no nicho de cima, para não ficar oca
  const enfeite = new THREE.Group();
  planta(LE / 2 - 0.22, 0.12, 1.6, COR.offWhite, 'suculenta', enfeite, 0.15 + 3 * 0.5);
  caixa(0.24, 0.04, 0.18, base.getHex(), -0.2, 0.15 + 3 * 0.5, 0.1, enfeite, { seg: 0 });
  caixa(0.2, 0.035, 0.16, 0xe8dcc6, -0.2, 0.15 + 3 * 0.5 + 0.04, 0.1, enfeite, { seg: 0 }).rotation.y = 0.25;
  enfeite.visible = false;
  g.add(enfeite);

  const placa = criarPlaca(area, LE - (LE < 1 ? 0.06 : 0.12));
  placa.grupo.position.set(0, HE + 0.03, 0.06);
  g.add(placa.grupo);

  let mostrados = -1;
  function definirTotal(total) {
    // até a capacidade, um livro por item; dali em diante a estante fica cheia
    const n = Math.min(vagas.length, Math.max(0, total || 0));
    if (n === mostrados) return;
    mostrados = n;
    livros.count = n;
    livros.instanceMatrix.needsUpdate = true;
    enfeite.visible = n <= vagas.filter(x => x.p !== 3).length;   // enquanto o nicho de cima não tem livro
    // aparador no fim de cada fileira incompleta
    const ultimo = new Map();
    vagas.slice(0, n).forEach(l => ultimo.set(l.p, l));
    aparadores.forEach((a, p) => {
      const l = ultimo.get(p);
      const cheia = vagas.filter(x => x.p === p).length === vagas.slice(0, n).filter(x => x.p === p).length;
      a.visible = !!l && !cheia;
      if (l) a.position.set(l.x + l.w / 2 + 0.02, 0.15 + p * 0.5 + 0.09, 0.1);
    });
  }
  return { grupo: g, nichos, placa, definirTotal };
}

// ---------------------------------------------------------------------------
// Fichário: o índice das memórias (MEMORY.md), com gavetinhas que abrem
// ---------------------------------------------------------------------------
function criarFichario() {
  const g = new THREE.Group();
  const W = 1.05, D = 0.55, H = 0.9;
  for (const [x, z] of [[-W / 2 + 0.06, -D / 2 + 0.06], [W / 2 - 0.06, -D / 2 + 0.06], [-W / 2 + 0.06, D / 2 - 0.06], [W / 2 - 0.06, D / 2 - 0.06]]) cilindro(0.025, 0.02, 0.08, COR.madeiraEscura, x, 0, z, g, 8);
  caixa(W, H, D, COR.madeiraMedia, 0, 0.08, 0, g);
  caixa(W + 0.04, 0.03, D + 0.04, COR.madeiraEscura, 0, 0.08 + H, 0, g, { seg: 0 });
  const gavetas = [];
  const dw = (W - 0.08) / 3 - 0.025, dh = (H - 0.08) / 4 - 0.025;
  const latao = mat(0xc9a24a, { roughness: 0.35, metalness: 0.6 });
  const etiqueta = mat(0xf4efe6, { roughness: 0.9 });
  for (let lin = 0; lin < 4; lin++) for (let col = 0; col < 3; col++) {
    const gav = new THREE.Group();
    gav.position.set(-W / 2 + 0.04 + (col + 0.5) * ((W - 0.08) / 3), 0.08 + 0.04 + (3 - lin + 0.5) * ((H - 0.08) / 4) - dh / 2, D / 2);
    g.add(gav);
    const frente = caixa(dw, dh, 0.03, COR.madeiraClara, 0, 0, 0.005, gav, { seg: 0, sombra: false });
    frente.material = frente.material.clone();
    frente.material.emissive = new THREE.Color(0xffc978);
    frente.material.emissiveIntensity = 0;
    caixa(dw - 0.03, dh - 0.03, 0.42, COR.madeiraMedia, 0, 0.012, -0.2, gav, { seg: 0, sombra: false });   // corpo, escondido dentro
    caixa(0.09, 0.035, 0.006, 0, 0, dh * 0.58, 0.022, gav, { seg: 0, sombra: false, material: etiqueta });
    const puxador = cilindro(0.012, 0.012, 0.07, 0, 0, dh * 0.3, 0.03, gav, 8);
    puxador.material = latao; puxador.rotation.z = Math.PI / 2; puxador.position.y = dh * 0.3;
    gavetas.push({ grupo: gav, frente: frente.material, aberta: 0, alvo: 0 });
  }
  luminariaMesa(g, -W / 2 + 0.2, 0.08 + H + 0.03, -0.08, 0.6);
  planta(W / 2 - 0.18, -0.06, 1.5, COR.offWhite, 'suculenta', g, 0.08 + H + 0.03);
  const placa = criarPlaca('indice', 0.62);
  placa.grupo.position.set(0.06, 0.08 + H + 0.03, 0.1);
  placa.grupo.rotation.x = -0.18;
  g.add(placa.grupo);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.3, H * 0.9), new THREE.MeshBasicMaterial({
    map: brilho(), color: 0xffc978, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.position.set(0, 0.55, D / 2 + 0.05);
  halo.renderOrder = 5;
  halo.raycast = () => {};
  g.add(halo);
  return { grupo: g, gavetas, placa, halo: halo.material, largura: W, profundidade: D };
}

// ---------------------------------------------------------------------------
// Quadro: o que está sendo consultado agora, o que mudou há pouco e quantos por área
// ---------------------------------------------------------------------------
const VERBO = { consultar: 'consultando', gravar: 'gravando', usar: 'usando a skill' };
export function criarQuadro({ largura = 3.2, altura = 1.8 } = {}) {
  const W = 1600, H = Math.round(1600 * altura / largura);
  const t = telaCanvas(W, H, largura, altura, 0.42);
  const grupo = new THREE.Group();
  caixa(largura + 0.1, altura + 0.1, 0.05, COR.madeiraEscura, 0, -(altura + 0.1) / 2, -0.03, grupo);
  t.plano.position.z = 0.002;
  grupo.add(t.plano);
  let assinatura = null, ultimo = null;

  function desenhar(d, forcar = false) {
    if (!d) return false;
    const agora = Date.now();
    const chave = JSON.stringify([d.prateleiras?.map(p => [p.total, p.acao]), d.fichario?.total, d.atividadeAgora?.map(e => [e.titulo, e.acao, haQuanto(e.quando, agora)]),
      d.ultimas?.[0] && [d.ultimas[0].titulo, haQuanto(d.ultimas[0].quando, agora)], d.recentes?.map(r => [r.titulo, haQuanto(r.modificadoEm, agora)])]);
    if (chave === assinatura && !forcar) return false;
    assinatura = chave; ultimo = d;
    const g = t.ctx;
    g.fillStyle = '#f6f1e7'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(3,8,112,0.10)'; g.lineWidth = 3; g.strokeRect(18, 18, W - 36, H - 36);
    g.textBaseline = 'alphabetic';
    // cabeçalho
    g.fillStyle = NAVY; g.textAlign = 'left';
    g.font = `800 84px ${FONTE}`;
    g.fillText('Biblioteca da memória', 56, 112);
    g.fillStyle = 'rgba(3,8,112,0.14)'; g.fillRect(56, 146, W - 112, 4);
    const SUAVE = 'rgba(42,46,69,0.82)', HA = 'rgba(3,8,112,0.68)';

    // coluna da esquerda: agora
    const XE = 56, LE_ = 740;
    g.textAlign = 'left'; g.fillStyle = LARANJA; g.font = `800 40px ${FONTE}`;
    g.fillText('AGORA', XE, 214);
    const ativos = (d.atividadeAgora || []).slice(0, 2);
    if (ativos.length) {
      ativos.forEach((e, i) => {
        const y = 292 + i * 176;
        g.fillStyle = e.provedor === 'openai' ? '#37c486' : '#e8896a';
        g.beginPath(); g.arc(XE + 16, y - 20, 16, 0, Math.PI * 2); g.fill();
        const ha = haQuanto(e.quando, agora);
        g.font = `700 42px ${FONTE}`;
        const wHa = g.measureText(ha).width;
        g.textAlign = 'right'; g.fillStyle = HA;
        g.fillText(ha, XE + LE_, y);
        g.textAlign = 'left'; g.fillStyle = NAVY;
        const frase = `${e.agente} ${VERBO[e.acao] || e.acao}`;
        encaixar(g, frase, LE_ - 48 - wHa - 24, 60, 800, 40);
        g.fillText(cortar(g, frase, LE_ - 48 - wHa - 24), XE + 48, y);
        g.fillStyle = SUAVE; g.font = `700 48px ${FONTE}`;
        g.fillText(cortar(g, `${NOMES_AREA[e.area] || e.area} · ${e.titulo}`, LE_ - 48), XE + 48, y + 66);
      });
    } else {
      g.fillStyle = NAVY; g.font = `800 60px ${FONTE}`;
      g.fillText('Tudo quieto agora.', XE, 292);
      const u = d.ultimas?.[0];
      g.fillStyle = SUAVE; g.font = `700 46px ${FONTE}`;
      const txt = u ? `Última vez: ${NOMES_AREA[u.area] || u.area}, ${haQuanto(u.quando, agora)}` : 'Nada consultado na última meia hora.';
      g.fillText(cortar(g, txt, LE_), XE, 366);
      if (u) g.fillText(cortar(g, u.titulo, LE_), XE, 426);
    }

    // coluna da direita: atualizadas há pouco
    const XD = 870, LD = W - 56 - XD;
    g.fillStyle = AZUL; g.font = `800 40px ${FONTE}`; g.textAlign = 'left';
    g.fillText('ATUALIZADAS HÁ POUCO', XD, 214);
    (d.recentes || []).slice(0, 4).forEach((r, i) => {
      const y = 292 + i * 100;
      g.fillStyle = hex(CORES_AREA[r.area] || 0x9a9aa3);
      retangulo(g, XD, y - 38, 26, 38, 6); g.fill();
      const ha = haQuanto(r.modificadoEm, agora);
      g.font = `700 40px ${FONTE}`;
      const wHa = g.measureText(ha).width;
      g.textAlign = 'right'; g.fillStyle = HA;
      g.fillText(ha, W - 56, y);
      g.textAlign = 'left'; g.fillStyle = '#2a2e45'; g.font = `700 50px ${FONTE}`;
      g.fillText(cortar(g, r.titulo, LD - 46 - wHa - 24), XD + 46, y);
    });

    // rodapé: quantos por área (inventário, não placar)
    g.fillStyle = 'rgba(3,8,112,0.14)'; g.fillRect(56, H - 222, W - 112, 4);
    const itens = [...(d.prateleiras || []).map(p => ({ id: p.id, n: p.total, acao: p.acao })), { id: 'indice', n: d.fichario?.total ?? 0, acao: d.fichario?.acao }];
    const passo = (W - 112) / itens.length;
    itens.forEach((it, i) => {
      const cx = 56 + passo * (i + 0.5);
      const destaque = it.acao === 'gravar' ? LARANJA : it.acao ? AZUL : null;
      if (destaque) { g.fillStyle = destaque; retangulo(g, cx - passo / 2 + 6, H - 202, passo - 12, 168, 20); g.fill(); }
      g.textAlign = 'center';
      g.fillStyle = destaque ? '#ffffff' : NAVY; g.font = `800 72px ${FONTE}`;
      g.fillText(String(it.n ?? 0), cx, H - 104);
      g.fillStyle = destaque ? '#ffffff' : SUAVE;
      encaixar(g, NOMES_AREA[it.id], passo - 16, 36, 700);
      g.fillText(NOMES_AREA[it.id], cx, H - 54);
      if (!destaque) { g.fillStyle = hex(CORES_AREA[it.id]); g.fillRect(cx - 26, H - 196, 52, 9); }
    });
    t.textura.needsUpdate = true;
    return true;
  }
  aoCarregarFonte.add(() => ultimo && desenhar(ultimo, true));
  return { grupo, desenhar, liberar() { aoCarregarFonte.delete(desenhar); t.textura.dispose(); t.material.dispose(); } };
}

// ---------------------------------------------------------------------------
// Móveis de leitura
// ---------------------------------------------------------------------------
function criarPoltrona(cor = 0xc98a6a) {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.4, -0.36], [0.4, -0.36], [-0.4, 0.36], [0.4, 0.36]]) cilindro(0.03, 0.022, 0.1, COR.madeiraEscura, x, 0, z, g, 8);
  caixa(1.0, 0.32, 0.9, cor, 0, 0.1, 0, g);
  caixa(1.0, 0.62, 0.22, cor, 0, 0.32, -0.34, g);
  caixa(0.18, 0.44, 0.9, cor, -0.41, 0.32, 0, g);
  caixa(0.18, 0.44, 0.9, cor, 0.41, 0.32, 0, g);
  caixa(0.64, 0.12, 0.64, COR.linho, 0, 0.42, 0.06, g);
  const almofada = caixa(0.42, 0.32, 0.12, COR.azulCinza, 0, 0.56, -0.18, g);
  almofada.rotation.x = -0.2;
  // manta dobrada no braço
  caixa(0.2, 0.05, 0.5, 0xe8dcc6, 0.41, 0.76, 0.05, g, { seg: 0 });
  return { grupo: g, assento: new THREE.Vector3(0, 0, 0.06), alturaAssento: 0.54 - 0.3 * ESCALA };
}

function criarCarrinho() {
  const g = new THREE.Group();
  const W = 0.9, D = 0.45;
  for (const [x, z] of [[-W / 2 + 0.03, -D / 2 + 0.03], [W / 2 - 0.03, -D / 2 + 0.03], [-W / 2 + 0.03, D / 2 - 0.03], [W / 2 - 0.03, D / 2 - 0.03]]) {
    cilindro(0.018, 0.018, 0.72, COR.grafite, x, 0.06, z, g, 8);
    const roda = cilindro(0.05, 0.05, 0.03, COR.pretoFosco, x, 0.01, z, g, 12);
    roda.rotation.x = Math.PI / 2; roda.position.y = 0.05;
  }
  caixa(W, 0.03, D, COR.madeiraMedia, 0, 0.18, 0, g, { seg: 0 });
  caixa(W, 0.03, D, COR.madeiraMedia, 0, 0.58, 0, g, { seg: 0 });
  const alca = cilindro(0.015, 0.015, D - 0.04, COR.grafite, W / 2 + 0.06, 0.84, 0, g, 8);
  alca.rotation.x = Math.PI / 2;
  for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) { const h = cilindro(0.012, 0.012, 0.1, COR.grafite, W / 2 + 0.01, 0.8, z, g, 6); h.rotation.z = Math.PI / 2; }
  // livros em pé, um inclinado, e uma pilha deitada embaixo
  const r = sorteador(77);
  const cores = Object.values(CORES_AREA).concat([0xe8dcc6, 0xf1ede6]);
  let x = -W / 2 + 0.06;
  for (let i = 0; i < 9; i++) {
    const w = 0.05 + r() * 0.04, h = 0.2 + r() * 0.1;
    const l = caixa(w, h, 0.22, cores[Math.floor(r() * cores.length)], x + w / 2, 0.61, 0, g, { seg: 0 });
    if (i === 8) { l.rotation.z = -0.35; l.position.x += 0.05; }
    x += w + 0.01;
  }
  let y = 0.21;
  for (let i = 0; i < 3; i++) { const h = 0.05; caixa(0.32 - i * 0.03, h, 0.24 - i * 0.02, cores[(i * 3) % cores.length], -0.15, y, 0, g, { seg: 0 }).rotation.y = (r() - 0.5) * 0.3; y += h; }
  return { grupo: g, largura: W, profundidade: D };
}

function criarMesinha() {
  const g = new THREE.Group();
  cilindro(0.17, 0.19, 0.02, COR.madeiraEscura, 0, 0, 0, g, 18);
  cilindro(0.025, 0.025, 0.5, COR.madeiraEscura, 0, 0.02, 0, g, 8);
  cilindro(0.24, 0.24, 0.03, COR.madeiraMedia, 0, 0.52, 0, g, 22);
  let y = 0.55;
  for (const [w, d, c, rot] of [[0.22, 0.16, CORES_AREA.projetos, 0.2], [0.2, 0.15, CORES_AREA.preferencias, -0.15], [0.18, 0.13, 0xe8dcc6, 0.4]]) {
    caixa(w, 0.035, d, c, -0.05, y, -0.02, g, { seg: 0 }).rotation.y = rot; y += 0.035;
  }
  caneca(g, 0.12, 0.55, 0.07, 0xf1ede6);
  return g;
}

// ---------------------------------------------------------------------------
// Caminhos: grafo de visibilidade sobre retângulos (girados) inflados pelo raio do corpo
// ---------------------------------------------------------------------------
function criarMapa(obstaculos, limites) {
  const obs = obstaculos.map(o => ({ ...o, c: Math.cos(o.rot || 0), s: Math.sin(o.rot || 0), hx: o.hx + RAIO, hz: o.hz + RAIO }));
  const local = (o, x, z) => { const dx = x - o.x, dz = z - o.z; return [dx * o.c - dz * o.s, dx * o.s + dz * o.c]; };
  const mundo = (o, lx, lz) => [o.x + lx * o.c + lz * o.s, o.z - lx * o.s + lz * o.c];
  const dentro = (o, x, z, folga = 0) => { const [a, b] = local(o, x, z); return Math.abs(a) < o.hx - folga && Math.abs(b) < o.hz - folga; };
  // segmento x retângulo no espaço do retângulo (Liang-Barsky)
  function corta(o, ax, az, bx, bz) {
    const [x1, z1] = local(o, ax, az), [x2, z2] = local(o, bx, bz);
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dz = z2 - z1;
    for (const [p, q] of [[-dx, x1 + o.hx], [dx, o.hx - x1], [-dz, z1 + o.hz], [dz, o.hz - z1]]) {
      if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return t1 - t0 > 1e-4;
  }
  const noLimite = (x, z) => x >= limites.x0 && x <= limites.x1 && z >= limites.z0 && z <= limites.z1;
  const nos = [];
  for (const o of obs) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const [x, z] = mundo(o, sx * (o.hx + 0.04), sz * (o.hz + 0.04));
    if (noLimite(x, z) && !obs.some(p => dentro(p, x, z))) nos.push(new THREE.Vector3(x, 0, z));
  }
  function livre(a, b, ignorar) { return !obs.some(o => !ignorar.has(o) && corta(o, a.x, a.z, b.x, b.z)); }
  // rota de a até b: lista de pontos (sem o ponto de partida)
  return function rota(a, b) {
    const ignorar = new Set(obs.filter(o => dentro(o, a.x, a.z, 0.01) || dentro(o, b.x, b.z, 0.01)));
    if (livre(a, b, ignorar)) return [b.clone()];
    const todos = [a, ...nos, b];
    const n = todos.length, dist = new Array(n).fill(Infinity), ant = new Array(n).fill(-1), feito = new Array(n).fill(false);
    dist[0] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!feito[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === n - 1) break;
      feito[u] = true;
      for (let v = 0; v < n; v++) {
        if (feito[v] || v === u) continue;
        const d = dist[u] + todos[u].distanceTo(todos[v]);
        if (d < dist[v] && livre(todos[u], todos[v], ignorar)) { dist[v] = d; ant[v] = u; }
      }
    }
    if (ant[n - 1] < 0) return [b.clone()];   // sem caminho: vai direto (não deve acontecer)
    const lista = [];
    for (let i = n - 1; i > 0; i = ant[i]) lista.unshift(todos[i].clone());
    return lista;
  };
}

// ---------------------------------------------------------------------------
// Bibliotecário: astronauta de óculos redondos que cuida da biblioteca.
// Não é agente: sem balão, sem placa, fora do hover (userData.npc).
// ---------------------------------------------------------------------------
function criarBoneco() {
  const boneco = criarAstronauta(0x4f6b5a, 211, 'olhinhos');
  boneco.scale.setScalar(ESCALA);
  boneco.userData.npc = true;
  const corpo = boneco.children[0];
  const bracos = corpo.children.filter(o => o.isGroup && Math.abs(Math.abs(o.position.x) - 0.21) < 0.01 && Math.abs(o.position.y - 0.54) < 0.01)
    .sort((a, b) => a.position.x - b.position.x);
  const cabeca = corpo.children.find(o => o.isGroup && Math.abs(o.position.y - 0.82) < 0.01);
  // óculos redondos sobre a viseira
  const aro = mat(0x8a6a3a, { roughness: 0.35, metalness: 0.5 });
  for (const px of [-0.078, 0.078]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 24), aro);
    r.position.set(px, -0.01, 0.288);
    cabeca?.add(r);
  }
  const ponte = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6), aro);
  ponte.rotation.z = Math.PI / 2; ponte.position.set(0, 0.0, 0.29);
  cabeca?.add(ponte);
  // pilha de livros (arrumar) e livro aberto (ler, consultar)
  const pilha = new THREE.Group();
  [[0.24, 0.05, 0.17, CORES_AREA.projetos], [0.22, 0.045, 0.16, CORES_AREA.preferencias], [0.2, 0.04, 0.15, CORES_AREA.referencias]].reduce((y, [w, h, d, c], i) => {
    caixa(w, h, d, c, 0, y, 0, pilha, { seg: 0 }).rotation.y = (i - 1) * 0.12; return y + h;
  }, 0);
  pilha.position.set(0, 0.36, 0.25);
  pilha.visible = false;
  corpo.add(pilha);
  const livro = new THREE.Group();
  caixa(0.2, 0.012, 0.15, COR.madeiraEscura, 0, 0, 0, livro, { seg: 0 });
  const folhas = caixa(0.19, 0.012, 0.14, 0xf6f1e7, 0, 0.012, 0, livro, { seg: 0 });
  folhas.castShadow = false;
  livro.position.set(0, 0.44, 0.26);
  livro.rotation.x = 0.9;
  livro.visible = false;
  corpo.add(livro);
  boneco.traverse(o => { if (o.isMesh && !o.userData.hitbox) o.castShadow = true; });
  return { boneco, bracos, cabeca, pilha, livro };
}

const angDif = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const altNivel = n => 0.15 + n * 0.5 + 0.2;   // meio do nicho, em metros

function rotinaDoBibliotecario({ pontos, rota, gavetas, semente = 5813 }) {
  const { boneco, bracos, cabeca, pilha, livro } = criarBoneco();
  const sorte = sorteador(semente);
  const pos = boneco.position;
  pos.set(0.3, 0, -0.5);
  let fila = [], passo = null, olhar = 0, andar = 0, ultimaRotina = null, t = 0;
  let sentado = false, peso = 0, querDormir = false;
  const est = { olhar: 0, travadoDesde: null, andou: 0 };
  const extra = { b0x: 0, b1x: 0, b0z: 0, b1z: 0, kx: 0, ky: 0 };
  const atendidos = new Map();   // chave do pedido -> quando foi atendido
  let pedidos = [];
  const fase = sorte() * 6;
  const baseZ = bracos.map(b => b.rotation.z);

  // --- planos -------------------------------------------------------------
  const ir = (p) => ({ tipo: 'ir', alvo: p });
  const fazer = (pose, dur, opc = {}) => ({ tipo: 'fazer', pose, dur, ...opc });
  const estantes = () => Object.keys(pontos).filter(k => k !== 'indice' && k !== 'carrinho' && k !== 'poltrona' && k !== 'quadro');
  function escolherEstante() {
    const lista = estantes();
    return lista[Math.floor(sorte() * lista.length)];
  }
  function planoRotina() {
    const opcoes = [['arrumar', 0.3], ['fichario', 0.2], ['conferir', 0.24], ['ler', 0.12], ['quadro', 0.14]].filter(([n]) => n !== ultimaRotina);
    let r = sorte() * opcoes.reduce((s, [, p]) => s + p, 0);
    let nome = opcoes[0][0];
    for (const [n, p] of opcoes) { r -= p; if (r <= 0) { nome = n; break; } }
    ultimaRotina = nome;
    const nivel = Math.floor(sorte() * 4);
    switch (nome) {
      case 'arrumar': {
        const e = escolherEstante();
        return [ir(pontos.carrinho), fazer('pegar', 2 + sorte(), { aoFim: () => { pilha.visible = true; } }),
          ir(pontos[e]), fazer('guardar', 3 + sorte() * 1.5, { nivel, aoMeio: () => { pilha.visible = false; } })];
      }
      case 'fichario': return [ir(pontos.indice), fazer('folhear', 4 + sorte() * 3, { gaveta: Math.floor(sorte() * gavetas.length) })];
      case 'conferir': {
        const a = escolherEstante(); let b = escolherEstante(); if (b === a) b = escolherEstante();
        return [ir(pontos[a]), fazer('olhar', 2.5 + sorte() * 2.5, { nivel }), ir(pontos[b]), fazer('olhar', 2 + sorte() * 2.5, { nivel: Math.floor(sorte() * 4) })];
      }
      case 'ler': return [ir(pontos.poltrona.chegada), { tipo: 'sentar' }, fazer('ler', 8 + sorte() * 6, { aoInicio: () => { livro.visible = true; }, aoFim: () => { livro.visible = false; } }), { tipo: 'levantar' }];
      default: return [ir(pontos.quadro), fazer('olhar', 3 + sorte() * 2.5, { nivel: 3.4 })];
    }
  }
  function planoPedido(p) {
    const plano = [];
    if (sentado) plano.push({ tipo: 'levantar' });
    livro.visible = false;
    if (p.area === 'indice') {
      plano.push(ir(pontos.indice), fazer('folhear', 5 + sorte() * 2, { gaveta: Math.floor(sorte() * gavetas.length), pedido: p }));
    } else {
      const novo = p.acao === 'gravar';
      if (novo && !pilha.visible) livro.visible = true;   // a memória nova chega na mão dele
      plano.push(ir(pontos[p.area]));
      if (novo) plano.push(fazer('guardar', 4.5, { nivel: p.nivel ?? 1, pedido: p, aoInicio: () => { pilha.visible = false; livro.visible = true; }, aoMeio: () => { livro.visible = false; } }));
      else plano.push(fazer('consultar', 5.5, { nivel: p.nivel ?? 1, pedido: p }));
    }
    if (pilha.visible) plano.push(ir(pontos[escolherEstante()]), fazer('guardar', 3, { nivel: Math.floor(sorte() * 4), aoMeio: () => { pilha.visible = false; } }));
    return plano;
  }
  function proximoPedido() {
    const agora = performance.now();
    for (const [k, q] of atendidos) if (agora - q > 120_000) atendidos.delete(k);
    return pedidos.find(p => !atendidos.has(p.chave) && pontos[p.area]);
  }

  // --- execução -----------------------------------------------------------
  function iniciar(p) {
    passo = p;
    passo.ini = t;
    if (p.tipo === 'ir') { passo.rota = rota(pos.clone(), p.alvo.pos); }
    else if (p.tipo === 'sentar') { passo.de = pos.clone(); }
    else if (p.tipo === 'levantar') { passo.de = pos.clone(); }
    else if (p.tipo === 'fazer') {
      if (p.pedido) atendidos.set(p.pedido.chave, performance.now());
      p.aoInicio?.();
      if (p.gaveta != null) gavetas[p.gaveta].alvo = 1;
    }
  }
  function terminar() {
    if (passo?.tipo === 'fazer') {
      if (!passo.meioFeito) passo.aoMeio?.();
      passo.aoFim?.();
      if (passo.pose === 'consultar') livro.visible = false;
      if (passo.gaveta != null) gavetas[passo.gaveta].alvo = 0;
    }
    passo = null;
  }
  function seguir() {
    if (!fila.length) fila = planoRotina();
    iniciar(fila.shift());
  }

  // pose extra dos braços e da cabeça (null = deixa a animação comum)
  function poseExtra(p, u) {
    if (!p) return pilha.visible ? { b0x: -0.85, b1x: -0.85, b0z: 0.14, b1z: -0.14, kx: 0.05, ky: 0 } : null;
    if (p.tipo === 'ir') return pilha.visible || livro.visible ? { b0x: -0.85, b1x: -0.85, b0z: 0.14, b1z: -0.14, kx: 0.05, ky: 0 } : null;
    if (p.tipo !== 'fazer') return null;
    const H = altNivel(p.nivel ?? 1) * 1.0;
    const braco = -(Math.PI / 2 + Math.atan2(H - 0.54 * ESCALA, 0.45));
    const olharNivel = Math.max(-0.45, Math.min(0.45, -(H - 1.4) * 0.45));
    switch (p.pose) {
      case 'pegar': return { b0x: -0.55, b1x: -0.6 + Math.sin(u * 4) * 0.08, b0z: 0.1, b1z: -0.1, kx: 0.38, ky: 0 };
      case 'guardar': {
        const empurra = Math.max(0, Math.sin(u * 3.2)) * 0.08;
        return { b0x: braco * 0.75, b1x: braco - empurra, b0z: 0.08, b1z: -0.04, kx: olharNivel, ky: Math.sin(u * 0.7) * 0.08 };
      }
      case 'consultar': {
        // estica até a prateleira, tira o livro, lê um pouco e devolve
        const fim = p.dur;
        const lendo = u > 1.3 && u < fim - 1.2;
        if (lendo !== livro.visible) livro.visible = lendo;
        if (lendo) return { b0x: -1.05, b1x: -1.05, b0z: 0.28, b1z: -0.28, kx: 0.3, ky: Math.sin(u * 0.8) * 0.06 };
        return { b0x: braco * 0.6, b1x: braco, b0z: 0.06, b1z: -0.04, kx: olharNivel, ky: 0 };
      }
      case 'folhear': return { b0x: -0.95, b1x: -0.95 + Math.max(0, Math.sin(u * 5 + fase)) * 0.28, b0z: 0.16, b1z: -0.12, kx: 0.42, ky: Math.sin(u * 0.9) * 0.1 };
      case 'olhar': return { b0x: 0.45, b1x: 0.45, b0z: 0.12, b1z: -0.12, kx: Math.max(-0.45, Math.min(0.45, -(altNivel(p.nivel ?? 1.5) - 1.4) * 0.4)) + (Math.sin(u * 0.9 + fase) > 0.95 ? 0.1 : 0), ky: Math.sin(u * 0.55 + fase) * 0.32 };
      case 'ler': return { b0x: -1.05, b1x: -1.05, b0z: 0.28, b1z: -0.28, kx: 0.32, ky: Math.sin(u * 0.4) * 0.05 };
      default: return null;
    }
  }

  function atualizar(tempo, dt) {
    t = tempo;
    // pedido novo (alguém mexendo numa prateleira agora) interrompe a rotina
    if (passo?.pose === 'dormir' && sentado) return;   // cochilando: parado, sem animar
    const pedido = querDormir ? null : proximoPedido();
    if (pedido && !passo?.pedido && !(passo?.tipo === 'sentar') && !(passo?.tipo === 'levantar')) {
      const emPedido = fila.some(x => x.pedido);
      if (!emPedido) { terminar(); fila = planoPedido(pedido); }
    }
    if (!passo) seguir();

    let modo = 'parado';
    if (passo.tipo === 'ir') {
      const alvo = passo.rota[0];
      if (!alvo) { olhar = passo.alvo.olhar; marcarAndando(boneco, false); terminar(); }
      else {
        // corpo sólido (F1): espera quem estiver no caminho; travado 3 s, refaz a rota
        const r = passoNpc(boneco, alvo, VEL, dt, est, t);
        if (r === 'chegou') passo.rota.shift();
        else if (r === 'andou') { andar += est.andou / (0.39) * Math.PI; olhar = est.olhar; modo = 'andar'; }
        else if (t - est.travadoDesde > 3) { est.travadoDesde = null; passo.rota = rota(pos.clone().setY(0), passo.alvo.pos); }
      }
    } else if (passo.tipo === 'sentar' || passo.tipo === 'levantar') {
      const u = Math.min(1, (t - passo.ini) / 0.7);
      const e = u * u * (3 - 2 * u);
      const assento = pontos.poltrona.assento, chegada = pontos.poltrona.chegada.pos;
      const [de, para] = passo.tipo === 'sentar' ? [passo.de, assento] : [passo.de, chegada];
      pos.x = de.x + (para.x - de.x) * e; pos.z = de.z + (para.z - de.z) * e;
      const y0 = passo.tipo === 'sentar' ? 0 : pontos.poltrona.alturaAssento, y1 = passo.tipo === 'sentar' ? pontos.poltrona.alturaAssento : 0;
      pos.y = y0 + (y1 - y0) * e;
      olhar = pontos.poltrona.olhar;
      sentado = passo.tipo === 'sentar' ? u > 0.3 : u < 0.7;
      if (u >= 1) terminar();
    } else if (passo.tipo === 'fazer') {
      const u = t - passo.ini;
      if (passo.alvo?.olhar != null) olhar = passo.alvo.olhar;
      if (!passo.meioFeito && u > passo.dur * 0.6) { passo.meioFeito = true; passo.aoMeio?.(); }
      modo = sentado ? 'descansar' : 'parado';
      if (u >= passo.dur) terminar();
    }

    boneco.userData.animar(t, modo, sentado, { dt, passo: andar, fase });
    // braços e cabeça: mistura suave com a pose extra
    const alvoExtra = poseExtra(passo, passo ? t - passo.ini : 0);
    peso += ((alvoExtra ? 1 : 0) - peso) * Math.min(1, dt * 7);
    if (alvoExtra) Object.assign(extra, Object.fromEntries(Object.entries(alvoExtra).map(([k, v]) => [k, extra[k] + (v - extra[k]) * Math.min(1, dt * 9)])));
    if (peso > 0.001 && bracos.length === 2) {
      bracos[0].rotation.x += (extra.b0x - bracos[0].rotation.x) * peso;
      bracos[1].rotation.x += (extra.b1x - bracos[1].rotation.x) * peso;
      bracos[0].rotation.z += (baseZ[0] + extra.b0z - bracos[0].rotation.z) * peso;
      bracos[1].rotation.z += (baseZ[1] + extra.b1z - bracos[1].rotation.z) * peso;
      if (cabeca) { cabeca.rotation.x += (extra.kx - cabeca.rotation.x) * peso; cabeca.rotation.y += (extra.ky - cabeca.rotation.y) * peso; }
    }
    boneco.rotation.y += angDif(boneco.rotation.y, olhar) * Math.min(1, dt * 8);
  }
  function definirPedidos(lista) { pedidos = lista; }
  // Cochilo (F1): termina o que faz, senta na poltrona e para; acorda e levanta
  function cochilar(sim) {
    if (sim === querDormir) return;
    querDormir = !!sim;
    if (sim) {
      if (passo?.tipo === 'sentar') { fila = [fazer('dormir', Infinity)]; return; }
      if (passo?.tipo === 'levantar') { fila = [{ tipo: 'sentar' }, fazer('dormir', Infinity)]; return; }
      terminar();
      fila = sentado ? [fazer('dormir', Infinity)] : [ir(pontos.poltrona.chegada), { tipo: 'sentar' }, fazer('dormir', Infinity)];
    } else if (passo?.pose === 'dormir' || fila.some(x => x.pose === 'dormir')) {
      terminar(); fila = sentado ? [{ tipo: 'levantar' }] : [];
    }
  }
  const dormindo = () => passo?.pose === 'dormir' && sentado;
  return { boneco, atualizar, definirPedidos, cochilar, dormindo };
}

// ---------------------------------------------------------------------------
// Sala inteira (vitrine e, depois, módulo da Estação)
// ---------------------------------------------------------------------------
export function montarSalaMemoria({ semente = 5813 } = {}) {
  const sala = new THREE.Group();
  sala.name = 'biblioteca-da-memoria';
  piso(LARG, PROF, 0xcfa77a, 0, 0, sala);
  caixa(LARG + 0.12, ALT, 0.12, 0xefe6d6, 0, 0, ZF - 0.06, sala);
  caixa(0.12, ALT, PROF, 0xefe6d6, X0 - 0.06, 0, 0, sala);
  rodape(X0, ZF, -X0, ZF + 0.02, sala);
  rodape(X0, ZF, X0 + 0.02, -ZF, sala);
  tapete(2.95, 1.2, 2.5, 1.95, 0xe9c9a8, sala);
  tapete(-0.75, 1.15, 2.1, 1.0, 0xc9b49a, sala);

  // estantes: 4 de memórias na parede do fundo, 3 (skills, regras, Codex) na da esquerda
  const estantes = new Map();
  const pontos = {};
  const vagasAgentes = {};
  ['preferencias', 'projetos', 'referencias', 'voce'].forEach((id, i) => {
    const e = criarEstante(id, 101 + i * 37);
    const x = -3.45 + i * 1.28;
    e.grupo.position.set(x, 0, ZF + PE / 2);
    sala.add(e.grupo);
    estantes.set(id, e);
    pontos[id] = { pos: new THREE.Vector3(x, 0, ZF + PE + 0.5), olhar: Math.PI };
    // visitante: meio passo atrás e de lado (0,61 m do bibliotecário, fora das estantes e do carrinho)
    vagasAgentes[id] = { pos: new THREE.Vector3(x + (i === 0 ? 0.35 : -0.35), 0, ZF + PE + 1.0), olhar: Math.PI };
  });
  ['skills', 'regras', 'codex'].forEach((id, j) => {
    const e = criarEstante(id, 401 + j * 53);
    const z = -1.45 + j * 1.28;
    e.grupo.position.set(X0 + PE / 2, 0, z);
    e.grupo.rotation.y = Math.PI / 2;
    sala.add(e.grupo);
    estantes.set(id, e);
    pontos[id] = { pos: new THREE.Vector3(X0 + PE + 0.5, 0, z), olhar: -Math.PI / 2 };
    vagasAgentes[id] = { pos: new THREE.Vector3(X0 + PE + 1.0, 0, z + 0.35), olhar: -Math.PI / 2 };
  });

  // fichário no meio, com pendente em cima
  const fichario = criarFichario();
  fichario.grupo.position.set(-0.75, 0, 0.55);
  sala.add(fichario.grupo);
  pontos.indice = { pos: new THREE.Vector3(-0.85, 0, 0.55 + fichario.profundidade / 2 + 0.45), olhar: Math.PI };
  vagasAgentes.indice = { pos: new THREE.Vector3(-0.15, 0, 0.55 + fichario.profundidade / 2 + 0.6), olhar: Math.PI };
  pendente(-0.75, 0.55, ALT, sala).definirNivel(1, { instantaneo: true });

  // quadro na parede do fundo, carrinho de livros embaixo
  const quadro = criarQuadro({ largura: 3.2, altura: 1.8 });
  quadro.grupo.position.set(2.75, 0.85 + 0.9, ZF + 0.03);
  sala.add(quadro.grupo);
  const carrinho = criarCarrinho();
  carrinho.grupo.position.set(1.6, 0, -1.2);
  sala.add(carrinho.grupo);
  pontos.carrinho = { pos: new THREE.Vector3(1.6, 0, -1.2 + carrinho.profundidade / 2 + 0.42), olhar: Math.PI };
  pontos.quadro = { pos: new THREE.Vector3(3.05, 0, -1.25), olhar: Math.PI };

  // canto de leitura: poltrona, mesinha, luminária de pé
  const ROT = 0;   // alinhada às paredes (regra de 03/10: nada em diagonal)
  const poltrona = criarPoltrona();
  poltrona.grupo.position.set(3.15, 0, 1.05);
  poltrona.grupo.rotation.y = ROT;
  sala.add(poltrona.grupo);
  const doLocal = (lx, lz) => new THREE.Vector3(3.15 + lx * Math.cos(ROT) + lz * Math.sin(ROT), 0, 1.05 - lx * Math.sin(ROT) + lz * Math.cos(ROT));
  pontos.poltrona = { chegada: { pos: doLocal(0, 0.95), olhar: ROT }, assento: doLocal(0, 0.06), alturaAssento: poltrona.alturaAssento, olhar: ROT };
  const mesinha = criarMesinha();
  mesinha.position.set(3.98, 0, 1.6);
  sala.add(mesinha);
  luminariaPe(3.95, 0.3, sala, { poca: { dx: -0.4, dz: 0.5, tam: 2.0 } });
  planta(-3.95, 2.15, 1.0, COR.terracota, 'ficus', sala);
  planta(4.1, 2.25, 0.9, COR.offWhite, 'folhaLarga', sala);

  // caminhos do bibliotecário
  const obstaculos = [
    { x: (X0 + 1.0) / 2, z: ZF + 0.2, hx: (1.0 - X0) / 2, hz: 0.2 },                // estantes do fundo
    { x: X0 + 0.2, z: (ZF + 1.75) / 2, hx: 0.2, hz: (1.75 - ZF) / 2 },              // estantes da esquerda
    { x: -0.75, z: 0.55, hx: fichario.largura / 2, hz: fichario.profundidade / 2 },
    { x: 1.6, z: -1.2, hx: 0.5, hz: 0.25 },
    { x: 3.15, z: 1.05, hx: 0.5, hz: 0.47, rot: ROT },
    { x: 3.98, z: 1.6, hx: 0.24, hz: 0.24 },
    { x: 3.95, z: 0.3, hx: 0.16, hz: 0.16 },
    { x: -3.95, z: 2.15, hx: 0.25, hz: 0.25 },
    { x: 4.1, z: 2.25, hx: 0.25, hz: 0.25 },
  ];
  const rota = criarMapa(obstaculos, { x0: X0 + RAIO, x1: -X0 - RAIO, z0: ZF + RAIO, z1: -ZF - RAIO });
  const bib = rotinaDoBibliotecario({ pontos, rota, gavetas: fichario.gavetas, semente });
  sala.add(bib.boneco);

  // ---- dados -----------------------------------------------------------------
  let ultimos = null;
  const alvoLuz = new Map();   // id -> { nivel, cor }
  function atualizar(d) {
    if (!d) return;
    ultimos = d;
    alvoLuz.clear();
    for (const p of d.prateleiras || []) {
      const e = estantes.get(p.id);
      if (!e) continue;
      e.definirTotal(p.total);
      e.placa.desenhar(p.total, p.acao);
      if (p.ativa) alvoLuz.set(p.id, { nivel: p.nivel ?? 1, acao: p.acao || 'consultar' });
    }
    fichario.placa.desenhar(d.fichario?.total ?? 0, d.fichario?.acao || null);
    if (d.fichario?.ativa) alvoLuz.set('indice', { acao: d.fichario.acao || 'consultar' });
    quadro.desenhar(d);
    bib.definirPedidos((d.atividadeAgora || []).map(e => ({ chave: `${e.agenteId}|${e.area}|${e.titulo}|${e.acao}`, area: e.area, nivel: e.nivel, acao: e.acao })));
  }

  let anterior = null, proximoQuadro = 0;
  function animar(tempo) {
    const dt = anterior == null ? 1 / 60 : Math.min(0.1, Math.max(0, tempo - anterior));
    anterior = tempo;
    const k = Math.min(1, dt * 4);
    const pulso = 0.85 + 0.15 * Math.sin(tempo * 2.4);
    for (const [id, e] of estantes) {
      const luz = alvoLuz.get(id);
      e.nichos.forEach((n, p) => {
        const alvo = luz && p === luz.nivel ? 1 : 0;
        n.nivel += (alvo - n.nivel) * k;
        if (luz && alvo) { n.mat.emissive.copy(COR_LUZ[luz.acao] || COR_LUZ.consultar); n.halo.color.copy(n.mat.emissive); n.fita.emissive.copy(n.mat.emissive); }
        n.mat.emissiveIntensity = 1.0 * n.nivel * pulso;
        n.fita.emissiveIntensity = 2.2 * n.nivel;
        n.halo.opacity = 0.7 * n.nivel * pulso;
      });
    }
    const luzF = alvoLuz.get('indice');
    for (const gav of fichario.gavetas) {
      gav.aberta += (gav.alvo - gav.aberta) * Math.min(1, dt * 5);
      gav.grupo.position.z = fichario.profundidade / 2 + gav.aberta * 0.22;
      gav.frente.emissiveIntensity += ((luzF ? 0.35 * pulso : 0) - gav.frente.emissiveIntensity) * k;
      if (luzF) gav.frente.emissive.copy(COR_LUZ[luzF.acao] || COR_LUZ.consultar);
    }
    fichario.halo.opacity += ((luzF ? 0.45 * pulso : 0) - fichario.halo.opacity) * k;
    if (luzF) fichario.halo.color.copy(COR_LUZ[luzF.acao] || COR_LUZ.consultar);
    bib.atualizar(tempo, dt);
    // "há 12 s" no quadro: redesenha a cada 5 s mesmo sem dado novo
    if (ultimos && tempo > proximoQuadro) { proximoQuadro = tempo + 5; quadro.desenhar(ultimos); }
  }

  function pontoDaArea(id) {
    const v = vagasAgentes[id];
    return v ? { pos: v.pos.clone(), olhar: v.olhar } : null;
  }
  function vagas() { return Object.entries(vagasAgentes).map(([area, v]) => ({ area, pos: v.pos.clone(), olhar: v.olhar })); }

  return { grupo: sala, atualizar, animar, largura: LARG, profundidade: PROF, altura: ALT, pontoDaArea, vagas, bibliotecario: bib.boneco };
}

// ---------------------------------------------------------------------------
// Módulo da Estação (F1-SALAS-E-VIDA, 03/10): a Biblioteca numa vaga de 4,6 x 6,8 m
// ---------------------------------------------------------------------------
// Acopla no norte quando alguém mexe em memória ou skill e fica 10 min depois da última
// consulta (estacao.js). Coordenadas locais: x de -2,3 a 2,3; z de -3,4 (parede alta) a
// 3,4 (divisória do corredor, porta em x de 0,55 a 2,15). Piso e paredes vêm da casca.
// Tudo alinhado às paredes (giros de 0 ou 90 graus):
// - as 7 estantes (memórias por área, skills, regras e Codex), estreitas, lado a lado na
//   parede do fundo, cada uma com a sua placa; o bibliotecário anda na faixa da frente;
// - 5 lugares em pé para os astronautas das sessões, numa linha a 1,7 m do fundo, de
//   frente para as estantes (vagas da sala lógica 'biblioteca'); cada um vai para o
//   lugar mais perto da estante que está consultando (lugarDaArea);
// - quadro do que mudou e do que está sendo consultado num cavalete encostado na
//   divisória da esquerda, de frente para +x; fichário no meio, com a pendente;
// - canto de leitura (poltrona virada para +x, mesinha e luminária de pé), onde ele
//   lê e cochila; carrinho de livros.
export function montarModuloMemoria({ semente = 5813 } = {}) {
  const sala = new THREE.Group();
  sala.name = 'modulo-biblioteca';
  const XE = -2.3, ZFM = -3.4, ALTM = 2.8;
  rodape(-2.3, ZFM, 2.3, ZFM + 0.02, sala);
  const LEM = 0.6, PASSO_E = 0.63;
  const estantes = new Map();
  const pontos = {};
  const xDaArea = {};
  ['preferencias', 'projetos', 'referencias', 'voce', 'skills', 'regras', 'codex'].forEach((id, i) => {
    const e = criarEstante(id, 101 + i * 37, LEM);
    const x = -1.89 + i * PASSO_E;
    e.grupo.position.set(x, 0, ZFM + PE / 2);
    sala.add(e.grupo);
    estantes.set(id, e);
    xDaArea[id] = x;
    pontos[id] = { pos: new THREE.Vector3(x, 0, ZFM + PE + 0.5), olhar: Math.PI };
  });
  // fichário à direita, de frente para a câmera, com a pendente em cima. F2 (03/10, o
  // capacete é o corpo: 0,85 m entre centros): fichário e carrinho saíram do meio, e
  // da porta até os lugares em frente às estantes sobra uma passagem larga (antes eram
  // duas frestas de 0,7 m entre o carrinho, o fichário e o cavalete, onde quem chegava
  // e quem saía se travavam)
  const fichario = criarFichario();
  const FX = 1.2, FZ = 0.25;
  fichario.grupo.position.set(FX, 0, FZ);
  sala.add(fichario.grupo);
  xDaArea.indice = FX;
  pontos.indice = { pos: new THREE.Vector3(FX - 0.1, 0, FZ + fichario.profundidade / 2 + 0.45), olhar: Math.PI };
  pendente(FX, FZ, ALTM, sala).definirNivel(1, { instantaneo: true });

  // quadro num cavalete na divisória da esquerda, de frente para +x
  const QL = 2.3, QA = 1.3;
  const quadro = criarQuadro({ largura: QL, altura: QA });
  const cavalete = new THREE.Group();
  cavalete.position.set(XE + 0.12, 0, -0.15);
  cavalete.rotation.y = Math.PI / 2;
  sala.add(cavalete);
  for (const dx of [-QL / 2 + 0.08, QL / 2 - 0.08]) caixa(0.06, 2.3, 0.06, COR.madeiraEscura, dx, 0, -0.04, cavalete);
  caixa(QL + 0.1, 0.05, 0.12, COR.madeiraEscura, 0, 0.9, 0, cavalete, { seg: 0 });
  quadro.grupo.position.set(0, 0.95 + QA / 2, 0.02);
  cavalete.add(quadro.grupo);

  // carrinho de livros (encostado no cavalete, embaixo do quadro) e canto de leitura
  const carrinho = criarCarrinho();
  const CX = -1.4, CZ = 0.65;
  carrinho.grupo.position.set(CX, 0, CZ);
  sala.add(carrinho.grupo);
  pontos.carrinho = { pos: new THREE.Vector3(CX, 0, CZ + carrinho.profundidade / 2 + 0.42), olhar: Math.PI };
  pontos.quadro = { pos: new THREE.Vector3(XE + 0.85, 0, -0.15), olhar: -Math.PI / 2 };
  const poltrona = criarPoltrona();
  const PXp = -1.75, PZp = 2.2;
  poltrona.grupo.position.set(PXp, 0, PZp);
  poltrona.grupo.rotation.y = Math.PI / 2;   // virada para +x
  sala.add(poltrona.grupo);
  pontos.poltrona = { chegada: { pos: new THREE.Vector3(PXp + 0.95, 0, PZp), olhar: Math.PI / 2 },
    assento: new THREE.Vector3(PXp + 0.06, 0, PZp), alturaAssento: poltrona.alturaAssento, olhar: Math.PI / 2 };
  const mesinha = criarMesinha();
  mesinha.position.set(PXp, 0, PZp + 0.9);
  sala.add(mesinha);
  luminariaPe(XE + 0.3, PZp - 0.85, sala, { poca: { dx: 0.4, dz: 0.5, tam: 1.8 } });
  planta(0.1, 2.95, 0.95, COR.terracota, 'ficus', sala);
  planta(2.0, -1.25, 0.85, COR.offWhite, 'folhaLarga', sala);   // canto do fundo, fora da passagem

  // lugares em pé dos astronautas das sessões (vagas da sala 'biblioteca'): 4, a 0,95 m
  // um do outro (com 5 a 0,75 m os capacetes se sobrepunham e o quinto não chegava)
  const vagas = [-1.6, -0.65, 0.3, 1.25].map((x, i) => ({
    // a 1,07 m da faixa onde o bibliotecário pega os livros (z -2,52): os capacetes não se encostam
    pos: new THREE.Vector3(x, 0, -1.45), olhar: Math.PI, olharFixo: true, pose: 'em-pe', sala: 'biblioteca', ordem: i,
  }));

  // caminhos do bibliotecário
  const obstaculos = [
    { x: 0, z: ZFM + PE / 2, hx: 2.2, hz: PE / 2 },
    { x: XE + 0.12, z: -0.15, hx: 0.1, hz: QL / 2 + 0.02 },
    { x: FX, z: FZ, hx: fichario.largura / 2 + 0.02, hz: fichario.profundidade / 2 + 0.24 },
    { x: CX, z: CZ, hx: 0.52, hz: 0.25 },
    { x: PXp, z: PZp, hx: 0.47, hz: 0.52 },
    { x: PXp, z: PZp + 0.9, hx: 0.25, hz: 0.25 },
    { x: XE + 0.3, z: PZp - 0.85, hx: 0.16, hz: 0.16 },
    { x: 0.1, z: 2.95, hx: 0.25, hz: 0.25 }, { x: 2.0, z: -1.25, hx: 0.25, hz: 0.25 },
  ];
  const rota = criarRoteador(obstaculos, { x0: XE + 0.35, x1: 1.95, z0: ZFM + PE + 0.32, z1: 3.0 });
  const bib = rotinaDoBibliotecario({ pontos, rota, gavetas: fichario.gavetas, semente });
  bib.boneco.position.set(0.3, 0, -2.5);
  sala.add(bib.boneco);
  const corpo = registrarNpc(bib.boneco, { sala: 'biblioteca' });

  let ultimos = null;
  const alvoLuz = new Map();
  function atualizar(d) {
    if (!d) return;
    ultimos = d;
    alvoLuz.clear();
    for (const p of d.prateleiras || []) {
      const e = estantes.get(p.id);
      if (!e) continue;
      e.definirTotal(p.total);
      e.placa.desenhar(p.total, p.acao);
      if (p.ativa) alvoLuz.set(p.id, { nivel: p.nivel ?? 1, acao: p.acao || 'consultar' });
    }
    fichario.placa.desenhar(d.fichario?.total ?? 0, d.fichario?.acao || null);
    if (d.fichario?.ativa) alvoLuz.set('indice', { acao: d.fichario.acao || 'consultar' });
    quadro.desenhar(d);
    bib.definirPedidos((d.atividadeAgora || []).map(e => ({ chave: `${e.agenteId}|${e.area}|${e.titulo}|${e.acao}`, area: e.area, nivel: e.nivel, acao: e.acao })));
  }
  let anterior = null, proximoQuadro = 0;
  function animar(tempo) {
    const dt = anterior == null ? 1 / 60 : Math.min(0.1, Math.max(0, tempo - anterior));
    anterior = tempo;
    const k = Math.min(1, dt * 4);
    const pulso = 0.85 + 0.15 * Math.sin(tempo * 2.4);
    for (const [id, e] of estantes) {
      const luz = alvoLuz.get(id);
      e.nichos.forEach((n, p) => {
        const alvo = luz && p === luz.nivel ? 1 : 0;
        n.nivel += (alvo - n.nivel) * k;
        if (luz && alvo) { n.mat.emissive.copy(COR_LUZ[luz.acao] || COR_LUZ.consultar); n.halo.color.copy(n.mat.emissive); n.fita.emissive.copy(n.mat.emissive); }
        n.mat.emissiveIntensity = 1.0 * n.nivel * pulso;
        n.fita.emissiveIntensity = 2.2 * n.nivel;
        n.halo.opacity = 0.7 * n.nivel * pulso;
      });
    }
    const luzF = alvoLuz.get('indice');
    for (const gav of fichario.gavetas) {
      gav.aberta += (gav.alvo - gav.aberta) * Math.min(1, dt * 5);
      gav.grupo.position.z = fichario.profundidade / 2 + gav.aberta * 0.22;
      gav.frente.emissiveIntensity += ((luzF ? 0.35 * pulso : 0) - gav.frente.emissiveIntensity) * k;
      if (luzF) gav.frente.emissive.copy(COR_LUZ[luzF.acao] || COR_LUZ.consultar);
    }
    fichario.halo.opacity += ((luzF ? 0.45 * pulso : 0) - fichario.halo.opacity) * k;
    if (luzF) fichario.halo.color.copy(COR_LUZ[luzF.acao] || COR_LUZ.consultar);
    bib.atualizar(tempo, dt);
    if (ultimos && tempo > proximoQuadro) { proximoQuadro = tempo + 5; quadro.desenhar(ultimos); }
  }
  // Há luz acesa ou gaveta se mexendo (a cena precisa de quadros mesmo com ele dormindo)
  function animando() {
    for (const e of estantes.values()) if (e.nichos.some(n => n.nivel > 0.01)) return true;
    return fichario.gavetas.some(g => Math.abs(g.aberta - g.alvo) > 0.01) || alvoLuz.size > 0;
  }
  // x da estante (ou do fichário) de uma área: agentes.js escolhe o lugar mais perto
  const lugarDaArea = id => (id in xDaArea ? xDaArea[id] : null);
  return {
    grupo: sala, vagas, atualizar, animar, lugarDaArea, animando, npcs: [bib.boneco],
    cochilar: sim => bib.cochilar(sim), dormindo: () => bib.dormindo(),
    liberar() { removerNpc(corpo); },
  };
}
