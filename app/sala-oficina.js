// Oficina: para onde vai o astronauta de uma sessão que travou por motivo TÉCNICO
// (erro repetido de ferramenta, limite de uso, conector pedindo login, API com erro,
// comando que passa do tempo). Não é a fila do dono (perguntas e aprovações).
// Bancada com ferramentas, quadro de ferramentas na parede (com o contorno de cada
// uma, que aparece quando ela sai do lugar), quadro de atendimento legível, bancos de
// espera e um mecânico NPC com rotina própria: atende quem está esperando, mexe na
// bancada, pega e devolve ferramenta, confere o quadro e, com a oficina vazia,
// descansa no banquinho dele. Dados de /api/oficina (app/fonte-oficina.js).
//
// EXPORTS
//   montarSalaOficina({ largura, profundidade, altParede }) -> { grupo, atualizar(dados), animar(t),
//     largura, profundidade, mecanico: { estado() }, assentos() }
//   criarQuadroAtendimento({ largura, altura }) -> { grupo, atualizar(lista, agora, atendendo) }
//   dadosExemplo(agora)  dois casos fictícios para a vitrine (?simular=1)

import * as THREE from 'three';
import { caixa, cilindro, piso, planta, tapete, caneca, luminariaMesa, relogioParede, hash, COR } from './pecas.js';
import { criarAstronauta, definirProvedor } from './personagens.js';
import { registrarNpc, removerNpc, passoNpc, marcarAndando, criarRoteador, criarCochilo, alguemPrecisaPassar } from './sala-corpos.js';

const FONTE = 'Figtree, -apple-system, "Helvetica Neue", sans-serif';
const ESCALA = 1.45;
const C = {
  parede: 0xece4d6, piso: 0xcdc5b8, rodape: 0xd9cfbf, bancadaTampo: 0xb98552, ferro: 0x3a3f4f,
  quadroFerr: 0xe6d3b0, moldura: 0x8a5a3a, armario: 0x23307a, puxador: 0xd9d9de, banco: 0x8a5a3a,
};
const CORES_AGENTE = [0x0038ef, 0x3f7d5a, 0x7a4b8c, 0x5b7fb5, 0xc0503a, 0x2a8c8c, 0xb5852b];
const ROTULO_TIPO = { 'erro-repetido': 'erro repetido', limite: 'limite de uso', conector: 'conector', api: 'API', tempo: 'tempo esgotado' };

// ---------------------------------------------------------------------------
// Canvas como textura
// ---------------------------------------------------------------------------
function telaCanvas(W, H, larg, alt, brilho = 0.55) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: textura, emissive: 0xffffff, emissiveMap: textura, emissiveIntensity: brilho, roughness: 0.6 });
  const plano = new THREE.Mesh(new THREE.PlaneGeometry(larg, alt), material);
  return { canvas, ctx: canvas.getContext('2d'), textura, material, plano };
}
function encaixar(g, texto, maxLarg, tam, peso = 800, min = 14) {
  do { g.font = `${peso} ${tam}px ${FONTE}`; tam -= 2; } while (g.measureText(texto).width > maxLarg && tam > min);
}
function cortar(g, texto, maxLarg) {
  if (g.measureText(texto).width <= maxLarg) return texto;
  let t = texto;
  while (t.length > 1 && g.measureText(t + '…').width > maxLarg) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}
function retRed(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Há quanto tempo, em português
function haQuanto(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'agora há pouco';
  const min = Math.round(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `há ${h} h ${r} min` : `há ${h} h`;
}
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtDia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
function voltaTexto(ms, agora) {
  if (!ms) return '';
  return fmtDia.format(ms) === fmtDia.format(agora) ? `volta às ${fmtHora.format(ms)}` : `volta ${fmtDia.format(ms)}, ${fmtHora.format(ms)}`;
}

// Ícones simples por tipo, desenhados no canvas (traço navy, sem marca)
function icone(g, tipo, cx, cy, r, cor) {
  g.save();
  g.strokeStyle = cor; g.fillStyle = cor; g.lineWidth = r * 0.16; g.lineCap = 'round'; g.lineJoin = 'round';
  if (tipo === 'limite') {               // ampulheta
    g.beginPath(); g.moveTo(cx - r * 0.55, cy - r * 0.7); g.lineTo(cx + r * 0.55, cy - r * 0.7); g.lineTo(cx - r * 0.55, cy + r * 0.7);
    g.lineTo(cx + r * 0.55, cy + r * 0.7); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(cx - r * 0.25, cy + r * 0.55); g.lineTo(cx + r * 0.25, cy + r * 0.55); g.lineTo(cx, cy + r * 0.2); g.closePath(); g.fill();
  } else if (tipo === 'conector') {      // tomada com dois pinos
    retRed(g, cx - r * 0.45, cy - r * 0.2, r * 0.9, r * 0.6, r * 0.12); g.stroke();
    g.beginPath(); g.moveTo(cx - r * 0.2, cy - r * 0.2); g.lineTo(cx - r * 0.2, cy - r * 0.62); g.moveTo(cx + r * 0.2, cy - r * 0.2); g.lineTo(cx + r * 0.2, cy - r * 0.62);
    g.moveTo(cx, cy + r * 0.4); g.lineTo(cx, cy + r * 0.75); g.stroke();
  } else if (tipo === 'api') {           // nuvem
    g.beginPath();
    g.arc(cx - r * 0.3, cy + r * 0.1, r * 0.32, Math.PI * 0.5, Math.PI * 1.5);
    g.arc(cx + r * 0.05, cy - r * 0.15, r * 0.42, Math.PI * 1.05, Math.PI * 1.95);
    g.arc(cx + r * 0.4, cy + r * 0.12, r * 0.3, Math.PI * 1.5, Math.PI * 0.5);
    g.closePath(); g.stroke();
  } else if (tipo === 'tempo') {         // cronômetro
    g.beginPath(); g.arc(cx, cy + r * 0.1, r * 0.6, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx, cy + r * 0.1); g.lineTo(cx, cy - r * 0.25); g.moveTo(cx, cy + r * 0.1); g.lineTo(cx + r * 0.28, cy + r * 0.2);
    g.moveTo(cx - r * 0.18, cy - r * 0.72); g.lineTo(cx + r * 0.18, cy - r * 0.72); g.stroke();
  } else {                               // erro repetido: setas em círculo
    g.beginPath(); g.arc(cx, cy, r * 0.55, Math.PI * 0.15, Math.PI * 1.25); g.stroke();
    g.beginPath(); g.arc(cx, cy, r * 0.55, Math.PI * 1.15, Math.PI * 2.25); g.stroke();
    for (const a of [Math.PI * 1.25, Math.PI * 0.25]) {
      const x = cx + Math.cos(a) * r * 0.55, y = cy + Math.sin(a) * r * 0.55;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a + 2.2) * r * 0.3, y + Math.sin(a + 2.2) * r * 0.3);
      g.moveTo(x, y); g.lineTo(x + Math.cos(a + 0.9) * r * 0.3, y + Math.sin(a + 0.9) * r * 0.3); g.stroke();
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Quadro de atendimento (parede): quem está na oficina, o motivo e há quanto tempo
// ---------------------------------------------------------------------------
export function criarQuadroAtendimento({ largura = 3.0, altura = 1.6, linhas = 3 } = {}) {
  const W = 1800, H = Math.round(W * altura / largura);
  const t = telaCanvas(W, H, largura, altura, 0.32);
  const grupo = new THREE.Group();
  caixa(largura + 0.1, altura + 0.1, 0.05, C.moldura, 0, -(altura + 0.1) / 2, -0.03, grupo);
  t.plano.position.z = 0.002;
  grupo.add(t.plano);
  let assinatura = null;

  function atualizar(lista = [], agora = Date.now(), atendendo = null) {
    const minuto = Math.floor(agora / 30000);
    const chave = JSON.stringify([lista.map(a => [a.id, a.nome, a.motivo, a.tipo, a.agencia, a.voltaEm, Math.floor((agora - a.desde) / 60000)]), atendendo, lista.length ? minuto : 0]);
    if (chave === assinatura) return false;
    assinatura = chave;
    const g = t.ctx;
    g.fillStyle = '#f7f3ec'; g.fillRect(0, 0, W, H);
    // cabeçalho
    g.fillStyle = '#030870'; g.fillRect(0, 0, W, 132);
    g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = `800 70px ${FONTE}`;
    g.fillText('Oficina', 60, 68);
    g.textAlign = 'right';
    g.font = `700 44px ${FONTE}`;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillText(lista.length ? (lista.length === 1 ? '1 em atendimento' : `${lista.length} em atendimento`) : 'sem fila', W - 60, 70);

    if (!lista.length) {
      // estado calmo
      g.textAlign = 'center';
      const cy = 132 + (H - 132) / 2;
      g.strokeStyle = '#3f7d5a'; g.lineWidth = 16; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.arc(W / 2, cy - 120, 74, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(W / 2 - 34, cy - 118); g.lineTo(W / 2 - 8, cy - 92); g.lineTo(W / 2 + 38, cy - 146); g.stroke();
      g.fillStyle = '#030870';
      g.font = `800 92px ${FONTE}`;
      g.fillText('Tudo funcionando', W / 2, cy + 40);
      g.fillStyle = 'rgba(3,8,112,0.7)';
      g.font = `600 46px ${FONTE}`;
      g.fillText('Nenhum astronauta parado por problema técnico', W / 2, cy + 130);
      t.textura.needsUpdate = true;
      return true;
    }

    const visiveis = lista.slice(0, linhas);
    const topo = 150, alt = (H - topo - (lista.length > linhas ? 64 : 16)) / linhas;
    visiveis.forEach((a, i) => {
      const y = topo + i * alt;
      const meio = y + alt / 2;
      if (a.id === atendendo) {
        g.fillStyle = 'rgba(0,56,239,0.10)'; retRed(g, 30, y + 6, W - 60, alt - 12, 18); g.fill();
        g.fillStyle = '#0038ef'; retRed(g, 30, y + 6, 12, alt - 12, 6); g.fill();
      }
      if (i > 0) { g.fillStyle = 'rgba(3,8,112,0.10)'; g.fillRect(60, y, W - 120, 3); }
      // número (o mesmo do crachá em cima do astronauta)
      g.fillStyle = '#030870';
      g.beginPath(); g.arc(116, meio, 48, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.font = `800 56px ${FONTE}`;
      g.fillText(String(i + 1), 116, meio + 3);
      // ícone do tipo
      icone(g, a.tipo, 240, meio, 54, '#0038ef');
      // nome, agência e motivo (a volta fica na coluna da direita, sem repetir)
      const xT = 322, larT = W - xT - 440;
      const volta = voltaTexto(a.voltaEm, agora);
      const motivo = volta ? a.motivo.replace(/,\s*volta\s.*$/, '') : a.motivo;
      g.textAlign = 'left'; g.fillStyle = '#030870';
      g.font = `700 32px ${FONTE}`;
      const chip = a.agencia || '';
      const lc = chip ? g.measureText(chip).width + 36 : 0;
      encaixar(g, a.nome, larT - lc - 24, 62, 800, 34);
      const nome = cortar(g, a.nome, larT - lc - 24);
      g.fillText(nome, xT, meio - 38);
      const larNome = g.measureText(nome).width;
      if (chip) {
        g.font = `700 32px ${FONTE}`;
        g.fillStyle = 'rgba(3,8,112,0.09)'; retRed(g, xT + larNome + 22, meio - 64, lc, 50, 25); g.fill();
        g.fillStyle = '#030870'; g.fillText(chip, xT + larNome + 40, meio - 38);
      }
      g.fillStyle = '#1b1f3a';
      encaixar(g, motivo, larT, 48, 600, 34);
      g.fillText(cortar(g, motivo, larT), xT, meio + 36);
      // tempo
      g.textAlign = 'right';
      g.fillStyle = '#030870';
      g.font = `800 52px ${FONTE}`;
      g.fillText(haQuanto(agora - a.desde), W - 60, meio - 34);
      g.font = `700 40px ${FONTE}`;
      if (volta) { g.fillStyle = '#0038ef'; g.fillText(volta, W - 60, meio + 36); }
      else { g.fillStyle = 'rgba(3,8,112,0.6)'; g.fillText(ROTULO_TIPO[a.tipo] || '', W - 60, meio + 36); }
    });
    if (lista.length > linhas) {
      g.textAlign = 'center'; g.fillStyle = '#030870'; g.font = `700 40px ${FONTE}`;
      g.fillText(lista.length - linhas === 1 ? 'e mais 1 esperando' : `e mais ${lista.length - linhas} esperando`, W / 2, H - 36);
    }
    t.textura.needsUpdate = true;
    return true;
  }
  return { grupo, atualizar, liberar() { t.textura.dispose(); t.material.dispose(); } };
}

// ---------------------------------------------------------------------------
// Ferramentas (3D, pequenas) e o quadro de ferramentas com os contornos
// ---------------------------------------------------------------------------
const FERRAMENTAS = [
  { nome: 'martelo', dx: -0.82, larg: 0.12, alt: 0.36 },
  { nome: 'chave', dx: -0.45, larg: 0.1, alt: 0.4 },
  { nome: 'fenda', dx: -0.12, larg: 0.06, alt: 0.34 },
  { nome: 'alicate', dx: 0.2, larg: 0.12, alt: 0.3 },
  { nome: 'chave', dx: 0.5, larg: 0.08, alt: 0.3 },
  { nome: 'trena', dx: 0.8, larg: 0.13, alt: 0.13 },
];
function criarFerramenta(nome) {
  const g = new THREE.Group();
  const aco = 0x9aa0aa, cabo = nome === 'fenda' ? 0x0038ef : 0x8a5a3a;
  if (nome === 'martelo') {
    caixa(0.035, 0.3, 0.035, cabo, 0, -0.15, 0, g);
    caixa(0.16, 0.06, 0.05, 0x4a4f5c, 0, 0.15, 0, g);
  } else if (nome === 'chave') {
    caixa(0.035, 0.3, 0.018, aco, 0, -0.15, 0, g);
    const anel = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.016, 8, 16, Math.PI * 1.5), new THREE.MeshStandardMaterial({ color: aco, metalness: 0.6, roughness: 0.35 }));
    anel.position.y = 0.19; anel.rotation.z = Math.PI * 0.75; anel.castShadow = true;
    g.add(anel);
  } else if (nome === 'fenda') {
    cilindro(0.022, 0.022, 0.13, cabo, 0, -0.17, 0, g, 12);
    cilindro(0.007, 0.007, 0.18, aco, 0, -0.04, 0, g, 8);
  } else if (nome === 'alicate') {
    const b1 = caixa(0.025, 0.26, 0.018, 0xc0503a, 0, -0.13, 0, g); b1.rotation.z = 0.12;
    const b2 = caixa(0.025, 0.26, 0.018, 0xc0503a, 0, -0.13, 0, g); b2.rotation.z = -0.12;
    caixa(0.05, 0.08, 0.02, aco, 0, 0.1, 0, g);
  } else {
    caixa(0.12, 0.12, 0.05, 0xe3c14e, 0, -0.06, 0, g);
    caixa(0.04, 0.04, 0.055, 0x2b2b33, 0, -0.02, 0, g, { sombra: false });
  }
  return g;
}

function criarQuadroFerramentas(largura = 2.2, altura = 1.0) {
  const grupo = new THREE.Group();
  const W = 1100, H = Math.round(W * altura / largura);
  const t = telaCanvas(W, H, largura, altura, 0.12);
  const g = t.ctx;
  g.fillStyle = '#e6d3b0'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(90,60,30,0.28)';
  for (let x = 25; x < W; x += 36) for (let y = 25; y < H; y += 36) { g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); }
  // contornos das ferramentas (o "lugar" de cada uma)
  g.fillStyle = 'rgba(3,8,112,0.22)';
  for (const f of FERRAMENTAS) {
    const cx = (f.dx / largura + 0.5) * W, cy = H * 0.52;
    const w = f.larg / largura * W * 1.15, h = f.alt / altura * H * 1.08;
    retRed(g, cx - w / 2, cy - h / 2, w, h, Math.min(w, h) * 0.3); g.fill();
  }
  t.textura.needsUpdate = true;
  caixa(largura + 0.08, altura + 0.08, 0.04, C.moldura, 0, -(altura + 0.08) / 2, -0.025, grupo);
  t.plano.position.z = 0.001;
  grupo.add(t.plano);
  // ferramentas penduradas
  const slots = FERRAMENTAS.map(f => {
    const m = criarFerramenta(f.nome);
    const casa = new THREE.Vector3(f.dx, altura * 0.02, 0.04);
    m.position.copy(casa);
    grupo.add(m);
    return { nome: f.nome, malha: m, casa, dx: f.dx, fora: false };
  });
  return { grupo, slots, liberar() { t.textura.dispose(); t.material.dispose(); } };
}

// ---------------------------------------------------------------------------
// Bancada com morsa, caixa de ferramentas, luminária e um aparelho em conserto
// ---------------------------------------------------------------------------
function criarBancada(comp = 2.3, prof = 0.7, alt = 0.92) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caixa(0.06, alt - 0.06, 0.06, C.ferro, sx * (comp / 2 - 0.08), 0, sz * (prof / 2 - 0.06), g);
  caixa(comp - 0.1, 0.03, prof - 0.1, C.ferro, 0, 0.24, 0, g);                       // prateleira de baixo
  caixa(comp, 0.06, prof, C.bancadaTampo, 0, alt - 0.06, 0, g);                        // tampo
  caixa(comp, 0.05, 0.03, 0x9a6b40, 0, alt - 0.06, prof / 2 - 0.005, g, { sombra: false });
  // caixa de ferramentas embaixo
  caixa(0.55, 0.24, 0.3, 0x0038ef, -0.55, 0.27, 0.02, g);
  caixa(0.3, 0.025, 0.04, COR.aluminio, -0.55, 0.51, 0.02, g, { sombra: false });
  caixa(0.42, 0.18, 0.28, COR.offWhite, 0.45, 0.27, 0, g);                             // caixote de peças
  // morsa na ponta esquerda
  const morsa = new THREE.Group();
  caixa(0.18, 0.08, 0.16, 0x4a4f5c, 0, 0, 0, morsa);
  caixa(0.06, 0.12, 0.16, 0x4a4f5c, -0.06, 0.08, 0, morsa);
  caixa(0.06, 0.12, 0.16, 0x4a4f5c, 0.08, 0.08, 0, morsa);
  cilindro(0.012, 0.012, 0.22, COR.aluminio, 0.14, 0.12, 0, morsa, 8).rotation.z = Math.PI / 2;
  morsa.position.set(-comp / 2 + 0.2, alt, 0.12);
  g.add(morsa);
  // aparelho em conserto: caixinha com a tampa aberta e uma luz que pisca
  const aparelho = new THREE.Group();
  caixa(0.34, 0.16, 0.24, 0x2a2e45, 0, 0, 0, aparelho);
  caixa(0.3, 0.02, 0.2, 0x1d6b4f, 0, 0.16, 0, aparelho, { sombra: false });           // placa
  const tampa = caixa(0.34, 0.012, 0.24, 0x2a2e45, 0, 0, 0, aparelho);
  tampa.position.set(0, 0.2, -0.17); tampa.rotation.x = -1.2;
  const matLed = new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x4cd97b, emissiveIntensity: 0.3 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), matLed);
  led.position.set(0.1, 0.19, 0.05);
  aparelho.add(led);
  for (let i = 0; i < 3; i++) caixa(0.04, 0.025, 0.03, [0xe3c14e, 0x9aa0aa, 0x5b7fb5][i], -0.08 + i * 0.06, 0.18, -0.02, aparelho, { sombra: false });
  aparelho.position.set(0.05, alt, 0.02);
  g.add(aparelho);
  // parafusos soltos e um pano
  for (let i = 0; i < 5; i++) cilindro(0.008, 0.008, 0.02, 0x9aa0aa, 0.42 + i * 0.035, alt, 0.18 + (i % 2) * 0.03, g, 6);
  caixa(0.2, 0.012, 0.14, 0xc0503a, 0.75, alt, 0.12, g, { sombra: false }).rotation.y = 0.3;
  luminariaMesa(g, comp / 2 - 0.22, alt, -0.18, -0.6);
  caneca(g, -comp / 2 + 0.55, alt, -0.15, 0xf1ede6);
  return { grupo: g, alt, animar(t, mexendo) {
    matLed.emissiveIntensity = mexendo ? (Math.sin(t * 9) > 0 ? 1.1 : 0.15) : 0.25 + 0.2 * Math.sin(t * 1.3);
  } };
}

// Banquinho redondo (assento a 0,51 m, como as banquetas da Estação)
function banquinho(x, z, pai, cor = C.banco) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  cilindro(0.2, 0.2, 0.06, cor, 0, 0.45, 0, g, 22);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    const p = cilindro(0.018, 0.018, 0.46, C.ferro, Math.sin(a) * 0.13, 0, Math.cos(a) * 0.13, g, 8);
    p.rotation.set(Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12);
  }
  const anel = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.01, 6, 20), new THREE.MeshStandardMaterial({ color: C.ferro }));
  anel.rotation.x = Math.PI / 2; anel.position.y = 0.2;
  g.add(anel);
  pai.add(g);
  return g;
}

// Crachá com o número (o mesmo da linha do quadro), sempre de frente para a câmera
function criarCracha() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textura, transparent: true, depthWrite: false }));
  sprite.scale.setScalar(0.32);
  sprite.renderOrder = 5;
  let atual = null;
  function definir(n) {
    if (n === atual) return;
    atual = n;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#030870'; g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.font = `800 64px ${FONTE}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 64, 68);
    textura.needsUpdate = true;
  }
  return { sprite, definir, liberar() { textura.dispose(); sprite.material.dispose(); } };
}

// Partes do astronauta para poses extras (pivôs criados por personagens.js)
function partesDo(boneco) {
  const corpo = boneco.children.find(o => o.isGroup);
  const grupos = corpo ? corpo.children.filter(o => o.isGroup) : [];
  const perto = (a, b) => Math.abs(a - b) < 1e-3;
  const bracos = grupos.filter(o => perto(Math.abs(o.position.x), 0.21) && perto(o.position.y, 0.54)).sort((a, b) => a.position.x - b.position.x);
  const cabeca = grupos.find(o => perto(o.position.x, 0) && perto(o.position.y, 0.82));
  return { corpo, bracos, cabeca };
}

// ---------------------------------------------------------------------------
// Mecânico: boné, avental navy, cinto de couro e a ferramenta da vez na mão
// ---------------------------------------------------------------------------
function criarMecanico() {
  const boneco = criarAstronauta(0x5b6b8a, 311, 'olhinhos');
  boneco.scale.setScalar(ESCALA);
  boneco.userData.npc = true;
  const partes = partesDo(boneco);
  // boné azul com aba (por cima do capacete)
  if (partes.cabeca) {
    const bone = new THREE.Group();
    const matBone = new THREE.MeshStandardMaterial({ color: COR.azul, roughness: 0.7, side: THREE.DoubleSide });
    // copa: calota por cima do capacete (raio 0,29), até a borda de cima da viseira
    const copa = new THREE.Mesh(new THREE.SphereGeometry(0.298, 28, 10, 0, Math.PI * 2, 0, Math.PI * 0.23), matBone);
    copa.castShadow = true;
    bone.add(copa);
    const botao = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), matBone);
    botao.position.y = 0.296;
    bone.add(botao);
    // aba para a frente, logo acima da viseira
    const aba = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 24, 1, false, -Math.PI / 2, Math.PI), matBone);
    aba.position.set(0, 0.215, 0.15); aba.scale.set(1, 1, 0.9); aba.rotation.x = 0.12; aba.castShadow = true;
    bone.add(aba);
    partes.cabeca.add(bone);
  }
  // avental navy e cinto de couro com bolsinha
  if (partes.corpo) {
    const avental = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.02), new THREE.MeshStandardMaterial({ color: COR.navy, roughness: 0.8 }));
    avental.position.set(0, 0.38, 0.185); avental.rotation.x = -0.08; avental.castShadow = true;
    partes.corpo.add(avental);
    const bolso = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.015), new THREE.MeshStandardMaterial({ color: 0x1b2580, roughness: 0.8 }));
    bolso.position.set(0, 0.34, 0.198); bolso.rotation.x = -0.08;
    partes.corpo.add(bolso);
    const cinto = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.026, 8, 28), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.7 }));
    cinto.rotation.x = Math.PI / 2; cinto.position.y = 0.3;
    partes.corpo.add(cinto);
    const bolsa = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.06), new THREE.MeshStandardMaterial({ color: 0x6e4529, roughness: 0.7 }));
    bolsa.position.set(0.17, 0.25, 0.08); bolsa.castShadow = true;
    partes.corpo.add(bolsa);
  }
  // mão da ferramenta (braço de x positivo)
  const mao = new THREE.Group();
  mao.position.set(0, -0.24, 0.02);
  partes.bracos[1]?.add(mao);
  boneco.traverse(o => { if (o.isMesh && !o.userData.hitbox) o.castShadow = true; });
  return { boneco, partes, mao };
}

// ---------------------------------------------------------------------------
// Sala inteira
// ---------------------------------------------------------------------------
export function montarSalaOficina({ largura = 6.6, profundidade = 4.6, altParede = 2.6 } = {}) {
  const sala = new THREE.Group();
  sala.name = 'sala-oficina';
  const X0 = -largura / 2, X1 = largura / 2, ZF = -profundidade / 2, ZS = profundidade / 2;

  // piso de cimento queimado quente, paredes em corte com rodapé
  piso(largura, profundidade, C.piso, 0, 0, sala);
  caixa(largura + 0.12, altParede, 0.12, C.parede, 0, 0, ZF - 0.06, sala);
  caixa(0.12, altParede, profundidade, C.parede, X0 - 0.06, 0, 0, sala);
  caixa(largura, 0.08, 0.02, C.rodape, 0, 0, ZF + 0.01, sala, { sombra: false });
  caixa(0.02, 0.08, profundidade, C.rodape, X0 + 0.01, 0, 0, sala, { sombra: false });

  // bancada encostada no fundo, com o quadro de ferramentas em cima
  const bancada = criarBancada(2.3, 0.7, 0.92);
  const xB = X0 + 0.5 + 2.3 / 2, zB = ZF + 0.12 + 0.35;
  bancada.grupo.position.set(xB, 0, zB);
  sala.add(bancada.grupo);
  caixa(2.3, 0.02, 1.3, 0x4a4f5c, xB, 0, zB + 0.3, sala, { sombra: false });          // tapete de borracha
  const ferramentas = criarQuadroFerramentas(2.2, 1.0);
  ferramentas.grupo.position.set(xB, 1.74, ZF + 0.03);
  sala.add(ferramentas.grupo);

  // quadro de atendimento à direita, na altura dos olhos de quem está em pé
  const quadro = criarQuadroAtendimento({ largura: 2.8, altura: 1.6 });
  const xQ = 1.05;
  quadro.grupo.position.set(xQ, 1.72, ZF + 0.04);
  sala.add(quadro.grupo);
  // relógio na parede da esquerda, acima da estante
  const relogio3d = relogioParede(X0 + 0.02, 2.15, ZF + 1.8, 0.17, sala);
  relogio3d.rotation.y = Math.PI / 2;

  // armário de gavetas navy no canto do fundo
  const armario = new THREE.Group();
  caixa(0.75, 1.25, 0.5, C.armario, 0, 0, 0, armario);
  for (let i = 0; i < 5; i++) {
    caixa(0.69, 0.006, 0.01, 0x3a47a0, 0, 0.2 + i * 0.22, 0.252, armario, { sombra: false });
    caixa(0.2, 0.025, 0.03, C.puxador, 0, 0.11 + i * 0.22, 0.26, armario, { sombra: false });
  }
  cilindro(0.05, 0.05, 0.26, 0x8fa3b8, -0.2, 1.25, 0, armario, 14);                    // garrafa térmica
  planta(0.15, 0.02, 0.55, COR.offWhite, 'folhaLarga', armario, 1.25);
  armario.position.set(X1 - 0.42, 0, ZF + 0.3);
  sala.add(armario);

  // estante de peças na parede da esquerda
  const estante = new THREE.Group();
  const LE = 1.7;   // comprimento da estante, ao longo da parede
  for (const dz of [-LE / 2, LE / 2]) caixa(0.36, 1.8, 0.04, C.moldura, 0, 0, dz, estante);
  const cores = [0x0038ef, COR.offWhite, 0xc0503a, 0x8fa3b8, 0xe3c14e];
  for (let k = 0; k < 4; k++) {
    caixa(0.36, 0.03, LE, 0xb98552, 0, 0.1 + k * 0.52, 0, estante);
    if (k < 3) for (let j = 0; j < 6; j++) if ((k + j) % 5 !== 3) caixa(0.26, 0.16, 0.22, cores[(k * 2 + j) % cores.length], 0.02, 0.13 + k * 0.52, -LE / 2 + 0.18 + j * 0.27, estante);
  }
  estante.position.set(X0 + 0.22, 0, ZF + 0.95 + LE / 2);
  planta(0, 0.2, 0.5, COR.terracota, 'suculenta', estante, 1.69);
  sala.add(estante);

  // área de espera: tapete e quatro banquinhos alinhados com as paredes (pedido do
  // Eduardo, 03/10: a fileira em diagonal não fazia sentido na sala), perto da frente,
  // de frente para o quadro de atendimento e a bancada, como numa sala de espera de
  // verdade; o número em cima da cabeça bate com a linha do quadro. O mecânico atende
  // pelas costas, na mochila. ANG = para onde os sentados olham (fundo da sala).
  const ANG = Math.PI, FRENTE = new THREE.Vector3(Math.sin(ANG), 0, Math.cos(ANG));
  const LADO = new THREE.Vector3(1, 0, 0);   // o 1º da fila fica do lado da bancada; a ponta, do lado da porta
  const centroFila = new THREE.Vector3(-0.6, 0, ZS - 1.3);
  const ESPACO = 1.15;
  const assentos = [-1.5, -0.5, 0.5, 1.5].map(k => centroFila.clone().addScaledVector(LADO, k * ESPACO));
  const tapeteFila = tapete(centroFila.x + FRENTE.x * 0.1, centroFila.z + FRENTE.z * 0.1, 4.5, 1.2, COR.azulCinza, sala);
  tapeteFila.rotation.y = ANG;
  assentos.forEach(a => banquinho(a.x, a.z, sala));
  // o mecânico atende na diagonal de trás, à direita de quem olha: os dois ficam à vista
  // a ~0,9 m de quem está sentado: os capacetes (0,84 m na escala 1,45) não se tocam
  const DE_LADO = 0.5, ATRAS = 0.75, PISTA = 0.95;
  // banquinho do mecânico, entre a bancada e o quadro
  const banquinhoMec = { x: -0.45, z: ZF + 0.5 };
  banquinho(banquinhoMec.x, banquinhoMec.z, sala, 0x3a3f4f);
  planta(X1 - 0.45, ZS - 0.45, 0.95, COR.terracota, 'folhaLarga', sala);

  // -------------------------------------------------------------------------
  // Quem está esperando
  // -------------------------------------------------------------------------
  const Y_SENTADO = 0.51 - 0.30 * ESCALA;
  const pessoas = new Map();       // id -> { boneco, cracha, assento, dado, entrada, saindo }
  let lista = [];
  const assentoLivre = () => assentos.findIndex((_, i) => ![...pessoas.values()].some(p => !p.saindo && p.assento === i));

  function atualizar(dados) {
    lista = Array.isArray(dados?.naOficina) ? dados.naOficina : [];
    const agora = Date.now();
    const vivos = new Set(lista.map(a => a.id));
    for (const [id, p] of pessoas) if (!vivos.has(id) && !p.saindo) p.saindo = relogio;
    lista.forEach((a, i) => {
      let p = pessoas.get(a.id);
      if (p?.saindo != null) { p.saindo = null; p.entrada = relogio - 1; p.boneco.scale.setScalar(ESCALA); p.cracha.sprite.material.opacity = 1; }
      if (!p) {
        const assento = assentoLivre();
        if (assento < 0) return;            // banquinhos cheios: só aparece no quadro
        const boneco = criarAstronauta(CORES_AGENTE[hash(a.id) % CORES_AGENTE.length], hash(a.id) % 997, 'olhinhos');
        definirProvedor(boneco, a.provedor || (a.agencia === 'Codex' ? 'openai' : 'anthropic'));
        boneco.scale.setScalar(0.001);
        boneco.position.set(assentos[assento].x, Y_SENTADO, assentos[assento].z);
        boneco.rotation.y = ANG;              // de frente para o quadro e a bancada
        boneco.traverse(o => { if (o.isMesh && !o.userData.hitbox) o.castShadow = true; });
        const cracha = criarCracha();
        cracha.sprite.position.set(assentos[assento].x, Y_SENTADO + 1.25 * ESCALA, assentos[assento].z);
        sala.add(boneco, cracha.sprite);
        p = { boneco, cracha, assento, entrada: relogio, saindo: null, fase: (hash(a.id) % 100) / 15, cabeca: partesDo(boneco).cabeca };
        pessoas.set(a.id, p);
      }
      p.dado = a;
      p.cracha.definir(i + 1);
    });
    quadro.atualizar(lista, agora, mecanico.atendendo());
  }

  // -------------------------------------------------------------------------
  // Mecânico: rotina própria, sorteada por semente
  // -------------------------------------------------------------------------
  const mec = criarMecanico();
  sala.add(mec.boneco);
  const pos = mec.boneco.position;
  pos.set(xB + 0.4, 0, zB + 0.75);
  let semente = 52361;
  const sorte = () => { semente = (semente * 48271) % 2147483647; return semente / 2147483647; };
  const VEL = 1.05;
  const pontos = {
    bancada: { pos: new THREE.Vector3(xB + 0.05, 0, zB + 0.7), olhar: Math.PI },
    quadro: { pos: new THREE.Vector3(xQ, 0, ZF + 1.2), olhar: Math.PI },
    armario: { pos: new THREE.Vector3(X1 - 0.42, 0, ZF + 1.05), olhar: Math.PI },
    banquinho: { pos: new THREE.Vector3(banquinhoMec.x, 0, banquinhoMec.z + 0.55), olhar: 0 },
  };
  const pontoFerramenta = s => ({ pos: new THREE.Vector3(xB + s.dx, 0, zB + 0.72), olhar: Math.PI });
  function pontoPessoa(p) {
    const s0 = assentos[p.assento];
    const pos = s0.clone().addScaledVector(LADO, DE_LADO).addScaledVector(FRENTE, -ATRAS);
    return { pos, olhar: Math.atan2(s0.x - pos.x, s0.z - pos.z) };
  }
  // Caminhos: reto quando não passa perto de ninguém sentado; senão pela "pista" atrás da
  // fileira (a 0,85 m dela) e, para quem está do lado da frente, pela ponta de trás da fila
  const pontaFila = assentos[3].clone().addScaledVector(LADO, 0.95).addScaledVector(FRENTE, -0.3);
  const naPista = P => P.clone().addScaledVector(FRENTE, -PISTA - P.clone().sub(centroFila).dot(FRENTE));
  function livre(a, b) {
    for (let k = 0; k <= 24; k++) {
      const x = a.x + (b.x - a.x) * k / 24, z = a.z + (b.z - a.z) * k / 24;
      for (const s0 of assentos) if (Math.hypot(x - s0.x, z - s0.z) < 0.6) return false;
    }
    return true;
  }
  function rotaAte(de, para) {
    const opcoes = [
      [para], [naPista(de), naPista(para), para], [pontaFila, naPista(para), para],
      [naPista(de), pontaFila, para], [pontaFila, para],
    ];
    for (const r of opcoes) {
      let a = de, ok = true;
      for (const b of r) { if (!livre(a, b)) { ok = false; break; } a = b; }
      if (ok) return r.map(v => v.clone()).filter((v, i, l) => (i ? l[i - 1] : de).distanceTo(v) > 0.03 || i === l.length - 1);
    }
    return [para.clone()];
  }

  let plano = [], passo = null, rota = [], fimAcao = 0, inicioAcao = 0, passada = 0, olhar = 0;
  let naMao = null;                 // slot da ferramenta que está com ele
  let atendendoId = null;
  const atendidos = new Map();      // id -> quando foi atendido pela última vez
  let sentado = false;

  const esperando = () => [...pessoas.entries()].filter(([, p]) => !p.saindo && relogio - p.entrada > 1.2);

  function planejar() {
    const fila = esperando();
    const r = sorte();
    if (fila.length) {
      // quem está há mais tempo sem atendimento
      fila.sort((a, b) => (atendidos.get(a[0]) ?? -1e9) - (atendidos.get(b[0]) ?? -1e9));
      const [id, p] = fila[0];
      const recente = relogio - (atendidos.get(id) ?? -1e9) < 25;
      if (!recente && r < 0.72) {
        const passos = [];
        if (!naMao) {
          const ideal = ferramentas.slots.findIndex(s => !s.fora && s.nome === (p.dado?.tipo === 'conector' || p.dado?.tipo === 'api' ? 'fenda' : 'chave'));
          passos.push({ tipo: 'pegar', slot: ideal >= 0 ? ideal : ferramentas.slots.findIndex(s => !s.fora) });
        }
        passos.push({ tipo: 'conversar', id, dur: 2.2 + sorte() * 1.8 });
        passos.push({ tipo: 'consertar', id, dur: 4 + sorte() * 4 });
        if (sorte() < 0.5) passos.push({ tipo: 'quadro', dur: 2 + sorte() * 2 });
        return passos;
      }
      if (r < 0.86) return [{ tipo: 'bancada', dur: 4 + sorte() * 4 }];
      return [{ tipo: 'quadro', dur: 2.5 + sorte() * 2 }];
    }
    // oficina vazia: rotina calma
    if (naMao) return [{ tipo: 'devolver' }];
    if (r < 0.34) return [{ tipo: 'bancada', dur: 5 + sorte() * 5 }];
    if (r < 0.5) return [{ tipo: 'quadro', dur: 2 + sorte() * 2 }];
    if (r < 0.66) return [{ tipo: 'pegar', slot: Math.floor(sorte() * ferramentas.slots.length) }, { tipo: 'bancada', dur: 3 + sorte() * 3 }, { tipo: 'devolver' }];
    if (r < 0.76) return [{ tipo: 'armario', dur: 2.5 + sorte() * 2 }];
    return [{ tipo: 'sentar', dur: 7 + sorte() * 7 }];
  }

  function destinoDe(p) {
    if (p.tipo === 'pegar') return pontoFerramenta(ferramentas.slots[p.slot]);
    if (p.tipo === 'devolver') return naMao ? pontoFerramenta(naMao) : null;
    if (p.tipo === 'conversar' || p.tipo === 'consertar') { const q = pessoas.get(p.id); return q && !q.saindo ? pontoPessoa(q) : null; }
    if (p.tipo === 'sentar') return pontos.banquinho;
    return pontos[p.tipo] || null;
  }

  const assentoMec = new THREE.Vector3(banquinhoMec.x, 0, banquinhoMec.z);
  function proximoPasso() {
    const levantou = sentado;
    if (sentado) { sentado = false; pos.y = 0; }
    if (!plano.length) plano = planejar();
    passo = plano.shift();
    const d = destinoDe(passo);
    if (!d || (passo.tipo === 'pegar' && passo.slot < 0)) { passo = null; plano = []; return; }
    passo.olhar = d.olhar;
    const origem = levantou ? pontos.banquinho.pos : pos;
    rota = pos.distanceTo(d.pos) > 0.04 ? rotaAte(origem, d.pos) : [];
    // para o banquinho e de volta: passa pela frente dele (não corta a quina da bancada)
    if (passo.tipo === 'sentar') rota.push(assentoMec.clone());
    if (levantou) rota.unshift(pontos.banquinho.pos.clone());
    atendendoId = passo.id || (plano.find(x => x.id)?.id ?? null);
    if (!rota.length) comecar();
  }
  function comecar() {
    inicioAcao = relogio;
    const dur = passo.tipo === 'pegar' || passo.tipo === 'devolver' ? 1.3 : passo.dur || 3;
    fimAcao = relogio + dur;
    if (passo.tipo === 'sentar') { sentado = true; pos.y = Y_SENTADO; }
  }
  function concluir() {
    if (passo.tipo === 'pegar') {
      const s = ferramentas.slots[passo.slot];
      s.fora = true;
      naMao = s;
      ferramentas.grupo.remove(s.malha);
      s.malha.position.set(0, 0, 0);
      s.malha.rotation.set(Math.PI / 2, 0, 0);
      mec.mao.add(s.malha);
    } else if (passo.tipo === 'devolver' && naMao) {
      mec.mao.remove(naMao.malha);
      naMao.malha.position.copy(naMao.casa);
      naMao.malha.rotation.set(0, 0, 0);
      ferramentas.grupo.add(naMao.malha);
      naMao.fora = false;
      naMao = null;
    } else if (passo.tipo === 'consertar') {
      atendidos.set(passo.id, relogio);
    }
    passo = null;
  }

  // pose extra por cima da animação padrão
  function pose(t, dt) {
    const u = relogio - inicioAcao;
    let modo = 'parado', sent = false;
    const andando = rota.length > 0;
    if (andando) modo = 'andar';
    else if (passo) {
      if (passo.tipo === 'conversar') modo = 'conversar';
      else if (passo.tipo === 'consertar' || passo.tipo === 'bancada') modo = 'digitar';
      else if (passo.tipo === 'sentar') { modo = 'pausa'; sent = true; }
    }
    mec.boneco.userData.animar(t, modo, sent, { dt, passo: passada, fase: 1.3 });
    const [, bDir] = mec.partes.bracos;
    const cab = mec.partes.cabeca;
    if (!andando && passo && bDir) {
      if (passo.tipo === 'pegar' || passo.tipo === 'devolver') {
        // ergue o braço até o quadro de ferramentas e desce com ela
        const e = u < 0.5 ? u / 0.5 : u < 0.9 ? 1 : Math.max(0, 1 - (u - 0.9) / 0.4);
        bDir.rotation.x = -2.45 * e * e * (3 - 2 * e);
        if (cab) cab.rotation.x -= 0.25 * e;
      } else if (passo.tipo === 'bancada') {
        // batidinhas com a ferramenta (ou apertando o parafuso), pausando de vez em quando
        const bate = Math.sin(u * 0.9) > -0.6;
        bDir.rotation.x = -1.25 + (bate ? Math.max(0, Math.sin(u * 7.5)) * 0.45 : 0.05);
        if (cab) cab.rotation.x += 0.18;
      } else if (passo.tipo === 'consertar') {
        bDir.rotation.x = -1.35 + Math.sin(u * 5) * 0.18;
        if (cab) cab.rotation.x += 0.12;
      } else if (passo.tipo === 'quadro' || passo.tipo === 'armario') {
        if (cab) cab.rotation.x -= passo.tipo === 'quadro' ? 0.28 : 0.05;
        if (passo.tipo === 'quadro' && Math.sin(u * 1.1) > 0.6) bDir.rotation.x = -1.6;   // aponta uma linha
      }
    }
    bancada.animar(t, passo?.tipo === 'bancada' && !andando);
  }

  // -------------------------------------------------------------------------
  // Quadro a quadro
  // -------------------------------------------------------------------------
  let relogio = 0, anterior = null, ultimoQuadro = 0;
  const vTmp = new THREE.Vector3();
  function animar(tempo) {
    const dt = anterior == null ? 1 / 60 : Math.min(0.1, Math.max(0, tempo - anterior));
    anterior = tempo;
    relogio += dt;

    // quem chega aparece com um pulinho; quem sai encolhe e some
    for (const [id, p] of pessoas) {
      if (p.saindo != null) {
        const k = Math.max(0, 1 - (relogio - p.saindo) / 0.5);
        p.boneco.scale.setScalar(Math.max(0.001, ESCALA * k));
        p.cracha.sprite.material.opacity = k;
        if (k <= 0) { sala.remove(p.boneco, p.cracha.sprite); p.boneco.userData.liberar?.(); p.cracha.liberar(); pessoas.delete(id); atendidos.delete(id); }
        continue;
      }
      const e = Math.min(1, (relogio - p.entrada) / 0.45);
      const pulo = e < 1 ? Math.sin(e * Math.PI) * 0.12 : 0;
      p.boneco.scale.setScalar(Math.max(0.001, ESCALA * (e < 1 ? 1 - Math.pow(1 - e, 3) : 1)));
      p.boneco.position.y = Y_SENTADO + pulo;
      // limite: espera tranquilo (olhos semicerrados); o resto: quieto, sem conexão
      const modo = p.dado?.tipo === 'limite' ? 'descansar' : 'parado';
      const sendoAtendido = atendendoId === id && passo && !rota.length && (passo.tipo === 'conversar' || passo.tipo === 'consertar');
      p.boneco.userData.animar(relogio, sendoAtendido && passo.tipo === 'conversar' ? 'conversar' : modo, true, { dt, fase: p.fase });
      if (p.cabeca) {
        p.cabeca.getWorldPosition(vTmp);
        sala.worldToLocal(vTmp);
        p.cracha.sprite.position.set(vTmp.x, vTmp.y + 0.62 + Math.sin(relogio * 1.6 + p.fase) * 0.02, vTmp.z);
      }
    }

    // mecânico
    if (passo && passo.id && !pessoas.get(passo.id)) { passo = null; plano = plano.filter(x => !x.id); rota = []; }
    if (!passo) proximoPasso();
    if (passo) {
      if (rota.length) {
        const alvo = rota[0];
        const dx = alvo.x - pos.x, dz = alvo.z - pos.z, dist = Math.hypot(dx, dz);
        if (dist < 0.03) { rota.shift(); if (!rota.length) comecar(); }
        else {
          const anda = Math.min(dist, VEL * dt);
          pos.x += dx / dist * anda; pos.z += dz / dist * anda;
          passada += anda / (0.39 * ESCALA / 1.45) * Math.PI;
          olhar = Math.atan2(dx, dz);
        }
      } else {
        olhar = passo.olhar ?? olhar;
        if (relogio >= fimAcao) concluir();
      }
    }
    const dif = ((olhar - mec.boneco.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    mec.boneco.rotation.y += dif * Math.min(1, dt * 8);
    pose(relogio, dt);

    // o quadro acompanha quem está sendo atendido e o "há N min"
    if (relogio - ultimoQuadro > 0.5) { ultimoQuadro = relogio; quadro.atualizar(lista, Date.now(), atendendoId); }
  }

  const mecanico = {
    atendendo: () => atendendoId,
    estado: () => ({ passo: passo?.tipo ?? null, alvo: passo?.id ?? null, andando: rota.length > 0, naMao: naMao?.nome ?? null, x: +pos.x.toFixed(2), z: +pos.z.toFixed(2) }),
  };
  quadro.atualizar([], Date.now(), null);

  return {
    grupo: sala, atualizar, animar, largura, profundidade, mecanico,
    assentos: () => [...pessoas.entries()].map(([id, p]) => ({ id, assento: p.assento, ...assentos[p.assento] })),
  };
}

// ---------------------------------------------------------------------------
// Módulo da Estação (F1-SALAS-E-VIDA, 03/10): a Oficina numa vaga de 4,6 x 6,8 m
// ---------------------------------------------------------------------------
// Acopla no norte quando alguém está travado por motivo técnico e sai 90 s depois de
// vazia (estacao.js). Quem espera aqui são os astronautas de verdade das sessões
// (agentes.js leva cada um a um banquinho); a sala não cria bonecos próprios.
// Coordenadas locais: x de -2,3 a 2,3; z de -3,4 (parede alta) a 3,4 (divisória do
// corredor, porta em x de 0,55 a 2,15). Piso e paredes vêm da casca (layout.js).
// Tudo alinhado às paredes (regra de 03/10): a fileira de 4 banquinhos fica reta, perto
// da frente, de frente para a bancada e o quadro (de costas para a câmera), com o 1º da
// fila do lado da bancada (esquerda) e a ponta do lado da porta; à direita da fileira
// sobra a passagem do mecânico. Ele atende cada um pelas costas, na mochila.
// EXPORTS do módulo: { grupo, vagas, atualizar(dados), definirOcupantes(lista),
//   atendendo(), animar(t), cochilar(sim), dormindo(), npcs, liberar() }
//   vagas: os 4 banquinhos no formato das vagas (pos local, olhar, pose 'sentado',
//     topoAssento 0,51, acessoAtras: chega e levanta por trás);
//   definirOcupantes([{ id, assento, sentado, boneco }]): quem está em cada banquinho
//     agora (sala-modulos.js, a cada quadro); o crachá com o número da linha do quadro
//     acompanha o capacete de quem está sentado.
export function montarModuloOficina() {
  const sala = new THREE.Group();
  sala.name = 'modulo-oficina';
  const XE = -2.3, ZF = -3.4;
  // no módulo a casca já põe um rodapé em ZF..ZF+0,02: este fica na frente dele (coincidiam e piscavam)
  caixa(4.6, 0.08, 0.02, C.rodape, 0, 0, ZF + 0.035, sala, { sombra: false });

  // bancada encostada no fundo, com o quadro de ferramentas em cima
  const BL = 2.0;
  const bancada = criarBancada(BL, 0.7, 0.92);
  const xB = XE + 0.15 + BL / 2, zB = ZF + 0.12 + 0.35;
  bancada.grupo.position.set(xB, 0, zB);
  sala.add(bancada.grupo);
  caixa(BL, 0.02, 1.2, 0x4a4f5c, xB, 0, zB + 0.3, sala, { sombra: false });
  const ferramentas = criarQuadroFerramentas(1.9, 0.9);
  ferramentas.grupo.position.set(xB, 1.74, ZF + 0.03);
  sala.add(ferramentas.grupo);
  // quadro de atendimento à direita, na altura dos olhos
  const quadro = criarQuadroAtendimento({ largura: 2.0, altura: 1.15 });
  const xQ = 1.15;
  quadro.grupo.position.set(xQ, 1.95, ZF + 0.04);
  sala.add(quadro.grupo);
  relogioParede(0.15, 2.5, ZF + 0.02, 0.15, sala);
  // armário de gavetas no canto do fundo (embaixo do quadro)
  const armario = new THREE.Group();
  caixa(0.75, 1.25, 0.5, C.armario, 0, 0, 0, armario);
  for (let i = 0; i < 5; i++) {
    caixa(0.69, 0.006, 0.01, 0x3a47a0, 0, 0.2 + i * 0.22, 0.252, armario, { sombra: false });
    caixa(0.2, 0.025, 0.03, C.puxador, 0, 0.11 + i * 0.22, 0.26, armario, { sombra: false });
  }
  cilindro(0.05, 0.05, 0.26, 0x8fa3b8, -0.2, 1.25, 0, armario, 14);
  const xA = 1.85, zA = ZF + 0.3;
  armario.position.set(xA, 0, zA);
  sala.add(armario);
  // estante de peças na divisória da esquerda, de frente para +x
  const estante = new THREE.Group();
  const LE = 1.3;
  for (const dz of [-LE / 2, LE / 2]) caixa(0.36, 1.8, 0.04, C.moldura, 0, 0, dz, estante);
  const cores = [0x0038ef, COR.offWhite, 0xc0503a, 0x8fa3b8, 0xe3c14e];
  for (let k = 0; k < 4; k++) {
    caixa(0.36, 0.03, LE, 0xb98552, 0, 0.1 + k * 0.52, 0, estante);
    if (k < 3) for (let j = 0; j < 4; j++) if ((k + j) % 5 !== 3) caixa(0.26, 0.16, 0.22, cores[(k * 2 + j) % cores.length], 0.02, 0.13 + k * 0.52, -LE / 2 + 0.2 + j * 0.3, estante);
  }
  const zE = -1.05;
  estante.position.set(XE + 0.25, 0, zE);
  planta(0, 0.2, 0.5, COR.terracota, 'suculenta', estante, 1.69);
  sala.add(estante);
  // plantas nos cantos (F2, capacete de 0,85 m): na faixa da frente, com o mecânico
  // atendendo atrás de um banquinho, quem ia sentar no do lado ficava sem passagem
  planta(2.0, -0.45, 0.95, COR.terracota, 'folhaLarga', sala);   // canto da direita, atrás da fileira
  planta(XE + 0.3, 3.05, 0.9, COR.offWhite, 'ficus', sala);

  // fileira de espera: 4 banquinhos alinhados, de frente para o fundo (ANG = pi)
  const ANG = Math.PI, ZFILA = 0.7;
  const assentos = [-1.9, -0.9, 0.1, 1.1].map(x => new THREE.Vector3(x, 0, ZFILA));
  tapete(-0.4, ZFILA + 0.1, 3.8, 1.2, COR.azulCinza, sala);
  assentos.forEach(a => banquinho(a.x, a.z, sala));
  const vagas = assentos.map((a, i) => ({
    pos: a.clone(), olhar: ANG, pose: 'sentado', topoAssento: 0.51, alturaAssento: 0.06, acessoAtras: true, ordem: i, sala: 'oficina',
  }));
  // banquinho do mecânico, entre a bancada e o armário (aparece quando ele senta)
  const banco = new THREE.Group();
  banquinho(0, 0, banco, 0x3a3f4f);
  const posBanco = new THREE.Vector3(0.2, 0, ZF + 0.55);
  banco.position.copy(posBanco);
  sala.add(banco);

  // -------------------------------------------------------------------------
  // Quem está esperando: os astronautas das sessões (definirOcupantes)
  // -------------------------------------------------------------------------
  const Y_SENTADO = 0.51 - 0.30 * ESCALA;
  let lista = [];                         // naOficina (ordem = número da linha do quadro)
  let ocupantes = [];                     // [{ id, assento, sentado, boneco, desde }]
  const crachas = new Map();              // id -> crachá
  let relogio = 0;
  const desdeSentado = new Map();         // id -> relógio em que sentou

  function atualizar(dados) {
    lista = Array.isArray(dados?.naOficina) ? dados.naOficina : [];
    quadro.atualizar(lista, Date.now(), atendendoId);
  }
  const vTmp = new THREE.Vector3();
  function definirOcupantes(novos) {
    ocupantes = novos || [];
    const vivos = new Set(ocupantes.filter(o => o.sentado).map(o => o.id));
    for (const [id, c] of crachas) if (!vivos.has(id)) { sala.remove(c.sprite); c.liberar(); crachas.delete(id); }
    for (const id of [...desdeSentado.keys()]) if (!vivos.has(id)) desdeSentado.delete(id);
    for (const o of ocupantes) {
      if (!o.sentado) continue;
      if (!desdeSentado.has(o.id)) desdeSentado.set(o.id, relogio);
      const n = lista.findIndex(x => x.id === o.id);
      let c = crachas.get(o.id);
      if (n < 0) { if (c) { sala.remove(c.sprite); c.liberar(); crachas.delete(o.id); } continue; }
      if (!c) { c = criarCracha(); crachas.set(o.id, c); sala.add(c.sprite); }
      c.definir(n + 1);
      o.boneco.getWorldPosition(vTmp);
      sala.worldToLocal(vTmp);
      c.sprite.position.set(vTmp.x, vTmp.y + 1.25 * ESCALA + Math.sin(relogio * 1.6 + n) * 0.02, vTmp.z);
    }
  }

  // -------------------------------------------------------------------------
  // Mecânico: rotina própria, sorteada por semente
  // -------------------------------------------------------------------------
  const mec = criarMecanico();
  sala.add(mec.boneco);
  const corpo = registrarNpc(mec.boneco, { sala: 'oficina' });
  const pos = mec.boneco.position;
  pos.set(xB + 0.4, 0, zB + 0.75);
  let semente = 52361;
  const sorte = () => { semente = (semente * 48271) % 2147483647; return semente / 2147483647; };
  const VEL = 1.05;
  const pontos = {
    bancada: { pos: new THREE.Vector3(xB + 0.05, 0, zB + 0.7), olhar: Math.PI },
    quadro: { pos: new THREE.Vector3(xQ - 0.3, 0, ZF + 1.2), olhar: Math.PI },
    armario: { pos: new THREE.Vector3(xA, 0, zA + 0.8), olhar: Math.PI },
  };
  const pontoFerramenta = s => ({ pos: new THREE.Vector3(xB + s.dx, 0, zB + 0.72), olhar: Math.PI });
  // atende pelas costas: em pé atrás do banquinho, olhando para a mochila
  // a 0,95 m: os capacetes (0,84 m de diâmetro na escala 1,45) não entram um no outro
  const pontoPessoa = o => ({ pos: new THREE.Vector3(assentos[o.assento].x, 0, ZFILA + 0.95), olhar: ANG });
  const obst = [
    { x: xB, z: zB, hx: BL / 2 + 0.02, hz: 0.37 }, { x: xA, z: zA, hx: 0.4, hz: 0.27 },
    { x: XE + 0.25, z: zE, hx: 0.2, hz: LE / 2 + 0.03 },
    // banquinho e o acesso de trás dele (onde o astronauta levanta): o mecânico passa
    // pela faixa de trás, a 1,3 m da fileira, e só entra ali para atender
    ...assentos.map(a => ({ x: a.x, z: a.z + 0.38, hx: 0.24, hz: 0.62 })),
    { x: 2.0, z: -0.45, hx: 0.25, hz: 0.25 }, { x: XE + 0.3, z: 3.05, hx: 0.25, hz: 0.25 },
  ];
  const roteador = criarRoteador(obst, { x0: XE + 0.4, x1: 1.93, z0: ZF + 0.55, z1: 3.0 });
  const coch = criarCochilo({ boneco: mec.boneco, banco, rota: roteador, vel: VEL, faseAnim: 1.3, modoSentado: 'pausa',
    assento: { entrada: new THREE.Vector3(posBanco.x, 0, posBanco.z + 0.55), pos: posBanco.clone(), y: Y_SENTADO, olhar: 0 },
    aoAcordar: () => { passo = null; plano = []; rota = []; } });

  let plano = [], passo = null, rota = [], fimAcao = 0, inicioAcao = 0, passada = 0, olhar = 0;
  let naMao = null;
  let atendendoId = null;
  const atendidos = new Map();
  let sentado = false;
  const est = { olhar: 0, travadoDesde: null, andou: 0 };

  const esperando = () => ocupantes.filter(o => o.sentado && relogio - (desdeSentado.get(o.id) ?? relogio) > 1.2);

  function planejar() {
    const fila = esperando();
    const r = sorte();
    if (fila.length) {
      fila.sort((a, b) => (atendidos.get(a.id) ?? -1e9) - (atendidos.get(b.id) ?? -1e9));
      const o = fila[0];
      const recente = relogio - (atendidos.get(o.id) ?? -1e9) < 25;
      if (!recente && r < 0.72) {
        const passos = [];
        const dado = lista.find(x => x.id === o.id);
        if (!naMao) {
          const ideal = ferramentas.slots.findIndex(s => !s.fora && s.nome === (dado?.tipo === 'conector' || dado?.tipo === 'api' ? 'fenda' : 'chave'));
          passos.push({ tipo: 'pegar', slot: ideal >= 0 ? ideal : ferramentas.slots.findIndex(s => !s.fora) });
        }
        passos.push({ tipo: 'conversar', id: o.id, dur: 2.2 + sorte() * 1.8 });
        passos.push({ tipo: 'consertar', id: o.id, dur: 4 + sorte() * 4 });
        if (sorte() < 0.5) passos.push({ tipo: 'quadro', dur: 2 + sorte() * 2 });
        return passos;
      }
      if (r < 0.86) return [{ tipo: 'bancada', dur: 4 + sorte() * 4 }];
      return [{ tipo: 'quadro', dur: 2.5 + sorte() * 2 }];
    }
    if (naMao) return [{ tipo: 'devolver' }];
    if (r < 0.4) return [{ tipo: 'bancada', dur: 5 + sorte() * 5 }];
    if (r < 0.58) return [{ tipo: 'quadro', dur: 2 + sorte() * 2 }];
    if (r < 0.78) return [{ tipo: 'pegar', slot: Math.floor(sorte() * ferramentas.slots.length) }, { tipo: 'bancada', dur: 3 + sorte() * 3 }, { tipo: 'devolver' }];
    return [{ tipo: 'armario', dur: 2.5 + sorte() * 2 }];
  }
  function destinoDe(p) {
    if (p.tipo === 'pegar') return pontoFerramenta(ferramentas.slots[p.slot]);
    if (p.tipo === 'devolver') return naMao ? pontoFerramenta(naMao) : null;
    if (p.tipo === 'conversar' || p.tipo === 'consertar') { const o = ocupantes.find(x => x.id === p.id && x.sentado); return o ? pontoPessoa(o) : null; }
    return pontos[p.tipo] || null;
  }
  function proximoPasso() {
    if (!plano.length) plano = planejar();
    passo = plano.shift();
    const d = destinoDe(passo);
    if (!d || (passo.tipo === 'pegar' && passo.slot < 0)) { passo = null; plano = []; return; }
    passo.olhar = d.olhar;
    rota = pos.distanceTo(d.pos) > 0.04 ? roteador(pos.clone().setY(0), d.pos) : [];
    atendendoId = passo.id || (plano.find(x => x.id)?.id ?? null);
    if (!rota.length) comecar();
  }
  function comecar() {
    inicioAcao = relogio;
    fimAcao = relogio + (passo.tipo === 'pegar' || passo.tipo === 'devolver' ? 1.3 : passo.dur || 3);
  }
  function concluir() {
    if (passo.tipo === 'pegar') {
      const s = ferramentas.slots[passo.slot];
      s.fora = true; naMao = s;
      ferramentas.grupo.remove(s.malha);
      s.malha.position.set(0, 0, 0); s.malha.rotation.set(Math.PI / 2, 0, 0);
      mec.mao.add(s.malha);
    } else if (passo.tipo === 'devolver' && naMao) {
      mec.mao.remove(naMao.malha);
      naMao.malha.position.copy(naMao.casa); naMao.malha.rotation.set(0, 0, 0);
      ferramentas.grupo.add(naMao.malha);
      naMao.fora = false; naMao = null;
    } else if (passo.tipo === 'consertar') atendidos.set(passo.id, relogio);
    passo = null;
  }
  function pose(t, dt, andando) {
    const u = relogio - inicioAcao;
    let modo = andando ? 'andar' : 'parado';
    if (!andando && passo) {
      if (passo.tipo === 'conversar') modo = 'conversar';
      else if (passo.tipo === 'consertar' || passo.tipo === 'bancada') modo = 'digitar';
    }
    mec.boneco.userData.animar(t, modo, sentado, { dt, passo: passada, fase: 1.3 });
    const [, bDir] = mec.partes.bracos;
    const cab = mec.partes.cabeca;
    if (!andando && passo && bDir) {
      if (passo.tipo === 'pegar' || passo.tipo === 'devolver') {
        const e = u < 0.5 ? u / 0.5 : u < 0.9 ? 1 : Math.max(0, 1 - (u - 0.9) / 0.4);
        bDir.rotation.x = -2.45 * e * e * (3 - 2 * e);
        if (cab) cab.rotation.x -= 0.25 * e;
      } else if (passo.tipo === 'bancada') {
        const bate = Math.sin(u * 0.9) > -0.6;
        bDir.rotation.x = -1.25 + (bate ? Math.max(0, Math.sin(u * 7.5)) * 0.45 : 0.05);
        if (cab) cab.rotation.x += 0.18;
      } else if (passo.tipo === 'consertar') {
        bDir.rotation.x = -1.35 + Math.sin(u * 5) * 0.18;
        if (cab) cab.rotation.x += 0.12;
      } else if (passo.tipo === 'quadro' || passo.tipo === 'armario') {
        if (cab) cab.rotation.x -= passo.tipo === 'quadro' ? 0.28 : 0.05;
        if (passo.tipo === 'quadro' && Math.sin(u * 1.1) > 0.6) bDir.rotation.x = -1.6;
      }
    }
    bancada.animar(t, passo?.tipo === 'bancada' && !andando);
  }

  let anterior = null, ultimoQuadro = 0;
  function animar(tempo) {
    const dt = anterior == null ? 1 / 60 : Math.min(0.1, Math.max(0, tempo - anterior));
    anterior = tempo;
    relogio += dt;
    // cochilo: só com a oficina sem ninguém esperando
    coch.pedir(querDormir && !esperando().length);
    if (coch.atualizar(relogio, dt)) {
      atendendoId = null;
      if (relogio - ultimoQuadro > 0.5) { ultimoQuadro = relogio; quadro.atualizar(lista, Date.now(), null); }
      return;
    }
    if (passo && passo.id && !ocupantes.some(o => o.id === passo.id && o.sentado)) { passo = null; plano = plano.filter(x => !x.id); rota = []; }
    // alguém levantando ou chegando perto dele: dá passagem (volta para a bancada)
    if (passo && !rota.length && passo.tipo !== 'bancada' && alguemPrecisaPassar(mec.boneco)) {
      if (passo.tipo === 'conversar' || passo.tipo === 'consertar') atendidos.set(passo.id, relogio);
      passo = null; plano = [{ tipo: 'bancada', dur: 3 + sorte() * 3 }];
    }
    if (!passo) proximoPasso();
    let andando = false;
    if (passo) {
      if (rota.length) {
        const r = passoNpc(mec.boneco, rota[0], VEL, dt, est, relogio);
        if (r === 'chegou') { rota.shift(); if (!rota.length) comecar(); }
        else if (r === 'andou') { passada += est.andou / (0.39 * ESCALA / 1.45) * Math.PI; olhar = est.olhar; andando = true; }
        else if (relogio - est.travadoDesde > 2.5) { passo = null; plano = []; rota = []; est.travadoDesde = null; }
      } else {
        marcarAndando(mec.boneco, false);
        olhar = passo.olhar ?? olhar;
        if (relogio >= fimAcao) concluir();
      }
    }
    const dif = ((olhar - mec.boneco.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    mec.boneco.rotation.y += dif * Math.min(1, dt * 8);
    pose(relogio, dt, andando);
    if (relogio - ultimoQuadro > 0.5) { ultimoQuadro = relogio; quadro.atualizar(lista, Date.now(), atendendoId); }
  }
  let querDormir = false;
  quadro.atualizar([], Date.now(), null);

  return {
    grupo: sala, vagas, atualizar, definirOcupantes, animar, npcs: [mec.boneco],
    // id de quem o mecânico está atendendo agora (conversando ou consertando)
    atendendo: () => (passo && !rota.length && (passo.tipo === 'conversar' || passo.tipo === 'consertar') ? passo.id : null),
    conversando: () => (passo && !rota.length && passo.tipo === 'conversar' ? passo.id : null),
    estadoMecanico: () => ({ passo: passo?.tipo ?? null, id: passo?.id ?? null, rota: rota.map(p => [+p.x.toFixed(2), +p.z.toFixed(2)]), travado: est.travadoDesde, rel: relogio, rastro: (est.rastro || []).map(p => [+p.x.toFixed(2), +p.z.toFixed(2)]), pos: [+pos.x.toFixed(2), +pos.z.toFixed(2)], dormindo: coch.dormindo(), plano: plano.map(x => x.tipo) }),
    cochilar(sim) { querDormir = !!sim; },
    dormindo: () => coch.dormindo(),
    liberar() {
      removerNpc(corpo);
      for (const c of crachas.values()) c.liberar();
      crachas.clear();
      quadro.liberar?.(); ferramentas.liberar?.();
    },
  };
}

// ---------------------------------------------------------------------------
// Dois casos fictícios (vitrine ?simular=1): nomes e motivos genéricos
// ---------------------------------------------------------------------------
export function dadosExemplo(agora = Date.now()) {
  const volta = agora + 95 * 60 * 1000;
  return {
    geradoEm: agora,
    naOficina: [
      { id: 'exemplo-a', nome: 'Carrossel de outubro', agencia: 'Claude Code', provedor: 'anthropic', tipoAgente: 'sessao', pasta: 'exemplo',
        tipo: 'conector', motivo: 'o Figma pediu login de novo', desde: agora - 4 * 60 * 1000, voltaEm: null },
      { id: 'codex:exemplo-2', nome: 'Relatório semanal', agencia: 'Codex', provedor: 'openai', tipoAgente: 'sessao', pasta: 'exemplo',
        tipo: 'limite', motivo: `limite de 5 h do Codex atingido, volta às ${fmtHora.format(volta)}`, desde: agora - 12 * 60 * 1000, voltaEm: volta },
    ],
  };
}
