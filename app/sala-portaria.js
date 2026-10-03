// Portaria dos conectores: um quadro de status na parede do fundo (conectores
// agrupados por estado, com os que precisam de atenção em destaque), um
// claviculário de hotel na parede da esquerda (uma chave por conector, com a
// etiqueta na cor do estado), o balcão de recepção com um terminal e o porteiro,
// um NPC com rotina própria: confere o quadro, mexe nas chaves, atende no
// balcão, digita no terminal e dá uma volta até a entrada.
// Dados de /api/portaria (app/fonte-portaria.js). Só nomes escritos, sem logos.

import * as THREE from 'three';
import { caixa, cilindro, piso, planta, relogioParede, tapete, COR } from './pecas.js';
import { criarAstronauta } from './personagens.js';
import { registrarNpc, removerNpc, passoNpc, marcarAndando, criarCochilo, criarRoteador } from './sala-corpos.js';

const FONTE = 'Figtree, -apple-system, "Helvetica Neue", sans-serif';
const FUSO = 'America/Sao_Paulo';
const C = {
  parede: 0xece6dc, pisoMadeira: 0xd6b083, balcao: 0x8a5a3a, tampo: 0xd8b48c, frente: 0x3a3f6f,
  quadroMoldura: 0x5b3e2b, armario: 0xb98552, fundoArmario: 0x7a5236, latao: 0xd8b25a, tapete: 0x9db3d9,
};

// Estados: cor de sinal, rótulo no plural e no singular
export const ESTADOS = {
  'falhou': { cor: '#e0605a', hex: 0xe0605a, plural: 'falharam', singular: 'falhou' },
  'precisa-autorizar': { cor: '#ee4c01', hex: 0xee4c01, plural: 'pedem login', singular: 'pede login' },
  'conectado': { cor: '#5fbf8a', hex: 0x5fbf8a, plural: 'conectados', singular: 'conectado' },
  'desconhecido': { cor: '#b9b4d9', hex: 0xb9b4d9, plural: 'sem notícia', singular: 'sem notícia' },
  'desativado': { cor: '#9aa0ac', hex: 0x9aa0ac, plural: 'desligados', singular: 'desligado' },
};
const ATENCAO = new Set(['falhou', 'precisa-autorizar']);
const ORIGEM_CURTA = { 'claude.ai': 'claude.ai', local: 'local', plugin: 'plugin', codex: 'Codex' };

const hora = iso => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }) : '');

function telaCanvas(W, H, larg, alt, brilho = 0.75) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: textura, emissive: 0xffffff, emissiveMap: textura, emissiveIntensity: brilho, roughness: 0.35 });
  const plano = new THREE.Mesh(new THREE.PlaneGeometry(larg, alt), material);
  return { canvas, ctx: canvas.getContext('2d'), textura, material, plano };
}

function retArred(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// corta o texto com reticências até caber
function caber(g, texto, maxLarg) {
  if (g.measureText(texto).width <= maxLarg) return texto;
  let t = texto;
  while (t.length > 1 && g.measureText(t + '…').width > maxLarg) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

// Nome para exibir: conta junto e, quando o mesmo nome aparece em mais de uma
// origem, a origem entre parênteses
function rotulos(lista) {
  const vezes = new Map();
  for (const c of lista) vezes.set(c.nome, (vezes.get(c.nome) || 0) + 1);
  return lista.map(c => ({ ...c, rotulo: c.nome + (c.conta ? ` · ${c.conta}` : '') + (vezes.get(c.nome) > 1 && !c.conta ? ` (${ORIGEM_CURTA[c.origem] || c.origem})` : '') }));
}

// Junta os de plugin que pedem login: costumam ser muitos e repetidos entre pacotes
function itensDeAtencao(conectores) {
  const fora = conectores.filter(c => ATENCAO.has(c.estado));
  const plugins = fora.filter(c => c.origem === 'plugin' && c.estado === 'precisa-autorizar');
  const principais = rotulos(fora.filter(c => !plugins.includes(c)));
  principais.sort((a, b) => (a.estado === 'falhou' ? 0 : 1) - (b.estado === 'falhou' ? 0 : 1) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  const nomesPlugins = [...new Set(plugins.map(c => c.nome))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { principais, plugins, nomesPlugins };
}

// ---------------------------------------------------------------------------
// Quadro de status (parede do fundo)
// ---------------------------------------------------------------------------
export function criarQuadro({ largura = 4.6, altura = 1.75 } = {}) {
  const W = 2400, H = Math.round(W * altura / largura);
  const t = telaCanvas(W, H, largura, altura, 0.7);
  const grupo = new THREE.Group();
  caixa(largura + 0.14, altura + 0.14, 0.06, C.quadroMoldura, 0, -(altura + 0.14) / 2, -0.035, grupo);
  grupo.add(t.plano);
  let assinatura = null;

  function atualizar(dados) {
    if (!dados) return;
    const lista = dados.conectores || [];
    const chave = lista.map(c => c.id + c.estado + (c.usadoEm || '')).join('|') + hora(dados.geradoEm);
    if (chave === assinatura) return;
    assinatura = chave;
    const g = t.ctx;
    const fundo = g.createLinearGradient(0, 0, 0, H);
    fundo.addColorStop(0, '#111a4d'); fundo.addColorStop(1, '#0a0f35');
    g.fillStyle = fundo; g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';

    // título
    g.fillStyle = '#ffffff'; g.textAlign = 'left';
    g.font = `800 58px ${FONTE}`;
    g.fillText('Portaria dos conectores', 56, 82);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.textAlign = 'right';
    g.font = `600 30px ${FONTE}`;
    g.fillText(`${lista.length} no quadro · atualizado às ${hora(dados.geradoEm)}`, W - 56, 80);

    // placar por estado
    const ordem = ['conectado', 'precisa-autorizar', 'falhou', 'desconhecido', 'desativado'];
    const conta = Object.fromEntries(ordem.map(e => [e, lista.filter(c => c.estado === e).length]));
    const larguraPlaca = (W - 112 - 4 * 24) / 5;
    ordem.forEach((e, i) => {
      const x = 56 + i * (larguraPlaca + 24), y = 118;
      g.fillStyle = conta[e] && ATENCAO.has(e) ? 'rgba(238,76,1,0.16)' : 'rgba(255,255,255,0.06)';
      retArred(g, x, y, larguraPlaca, 140, 22); g.fill();
      g.fillStyle = ESTADOS[e].cor;
      g.beginPath(); g.arc(x + 40, y + 70, 15, 0, Math.PI * 2); g.fill();
      g.fillStyle = conta[e] ? '#ffffff' : 'rgba(255,255,255,0.35)'; g.textAlign = 'left';
      g.font = `800 84px ${FONTE}`;
      g.fillText(String(conta[e]), x + 74, y + 100);
      const larguraNum = g.measureText(String(conta[e])).width;
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.font = `700 32px ${FONTE}`;
      g.fillText(caber(g, conta[e] === 1 ? ESTADOS[e].singular : ESTADOS[e].plural, larguraPlaca - larguraNum - 100), x + 86 + larguraNum, y + 96);
    });

    // coluna da esquerda: precisa de atenção
    const topo = 310, X1 = 1150;
    const { principais, nomesPlugins } = itensDeAtencao(lista);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff'; g.font = `800 38px ${FONTE}`;
    g.fillText('Precisa de atenção', 56, topo);
    g.fillStyle = '#ee4c01'; g.fillRect(56, topo + 14, 120, 6);
    if (!principais.length && !nomesPlugins.length) {
      g.fillStyle = '#5fbf8a'; g.font = `800 56px ${FONTE}`;
      g.fillText('Tudo em ordem por aqui.', 56, topo + 140);
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = `600 30px ${FONTE}`;
      g.fillText('Nenhum conector pedindo login ou com falha.', 56, topo + 194);
    } else {
      const linhaH = 92, base = topo + 60;
      const cabem = Math.floor((H - 130 - base) / linhaH);
      const reservaPlugins = nomesPlugins.length ? 1 : 0;
      const mostrar = principais.slice(0, Math.max(0, cabem - reservaPlugins - (principais.length > cabem - reservaPlugins ? 1 : 0)));
      let y = base;
      for (const c of mostrar) {
        g.fillStyle = 'rgba(255,255,255,0.05)'; retArred(g, 56, y, X1 - 56, linhaH - 12, 16); g.fill();
        g.fillStyle = ESTADOS[c.estado].cor; retArred(g, 56, y, 14, linhaH - 12, 7); g.fill();
        // etiqueta do estado, à direita
        g.font = `800 24px ${FONTE}`;
        const etq = ESTADOS[c.estado].singular, le = g.measureText(etq).width + 30;
        g.fillStyle = ESTADOS[c.estado].cor; retArred(g, X1 - le - 18, y + 18, le, 40, 20); g.fill();
        g.fillStyle = '#ffffff'; g.fillText(etq, X1 - le - 3, y + 47);
        const livre = X1 - le - 18 - 92 - 24;
        g.fillStyle = '#ffffff'; g.font = `800 38px ${FONTE}`;
        g.fillText(caber(g, c.rotulo, livre), 92, y + 44);
        g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = `600 24px ${FONTE}`;
        g.fillText(caber(g, c.origem === 'plugin' ? (c.detalhe || '') : `${ORIGEM_CURTA[c.origem]} · ${c.detalhe || ''}`, livre), 92, y + 72);
        y += linhaH;
      }
      const resto = principais.length - mostrar.length;
      if (resto > 0) {
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = `700 30px ${FONTE}`;
        g.fillText(`e mais ${resto}: ${principais.slice(mostrar.length).map(c => c.rotulo).join(', ')}`.slice(0, 90), 92, y + 44);
        y += 64;
      }
      if (nomesPlugins.length) {
        g.fillStyle = 'rgba(238,76,1,0.12)'; retArred(g, 56, y, X1 - 56, linhaH - 12, 16); g.fill();
        g.fillStyle = '#ee4c01'; retArred(g, 56, y, 14, linhaH - 12, 7); g.fill();
        g.fillStyle = '#ffffff'; g.font = `800 34px ${FONTE}`;
        g.fillText(`${nomesPlugins.length} ${nomesPlugins.length === 1 ? 'conector de plugin pede' : 'conectores de plugin pedem'} login`, 92, y + 44);
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = `600 24px ${FONTE}`;
        g.fillText(caber(g, nomesPlugins.join(', '), X1 - 130), 92, y + 74);
      }
    }

    // coluna da direita: chaves dos conectados
    const conectados = rotulos(lista.filter(c => c.estado === 'conectado'));
    const XD = 1210, LD = W - 56 - XD;
    g.fillStyle = '#ffffff'; g.font = `800 38px ${FONTE}`;
    g.fillText(`Conectados (${conectados.length})`, XD, topo);
    g.fillStyle = '#5fbf8a'; g.fillRect(XD, topo + 14, 120, 6);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = `600 24px ${FONTE}`;
    g.textAlign = 'right';
    g.fillText(`ponto azul: usado nas últimas ${dados.janelaUsoHoras || 48} h`, W - 56, topo);
    g.textAlign = 'left';
    const areaTopo = topo + 44, areaAlt = H - 130 - areaTopo;
    let cols = 3, linhas = 1, tagH = 58;
    for (cols = 3; cols <= 6; cols++) {
      linhas = Math.ceil(conectados.length / cols);
      tagH = Math.min(62, Math.floor(areaAlt / Math.max(1, linhas)));
      if (tagH >= 46) break;
    }
    const tagW = (LD - (cols - 1) * 14) / cols;
    const fonteTag = Math.max(20, Math.min(30, Math.round(tagH * 0.48)));
    conectados.forEach((c, i) => {
      const x = XD + (i % cols) * (tagW + 14), y = areaTopo + Math.floor(i / cols) * tagH;
      if (y + tagH - 8 > H - 120) return;
      g.fillStyle = 'rgba(95,191,138,0.14)'; retArred(g, x, y, tagW, tagH - 10, 12); g.fill();
      g.fillStyle = c.usadoEm ? '#4d8bff' : 'rgba(95,191,138,0.7)';
      g.beginPath(); g.arc(x + 20, y + (tagH - 10) / 2, c.usadoEm ? 9 : 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.font = `${c.usadoEm ? 800 : 600} ${fonteTag}px ${FONTE}`;
      g.fillText(caber(g, c.rotulo, tagW - 46), x + 38, y + (tagH - 10) / 2 + fonteTag * 0.36);
    });

    // rodapé: sem notícia e desligados
    const rodape = (estado, rotulo, y) => {
      const l = rotulos(lista.filter(c => c.estado === estado));
      if (!l.length) return;
      g.fillStyle = ESTADOS[estado].cor;
      g.beginPath(); g.arc(68, y - 9, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = `700 26px ${FONTE}`;
      const cab = `${rotulo} (${l.length}): `;
      g.fillText(cab, 90, y);
      const lc = g.measureText(cab).width;
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = `600 26px ${FONTE}`;
      g.fillText(caber(g, l.map(c => c.rotulo).join(', '), W - 56 - 90 - lc), 90 + lc, y);
    };
    rodape('desconhecido', 'Sem notícia', H - 74);
    rodape('desativado', 'Desligados', H - 30);
    t.textura.needsUpdate = true;
  }
  return { grupo, atualizar, liberar() { t.textura.dispose(); t.material.dispose(); } };
}

// ---------------------------------------------------------------------------
// Terminal do balcão: resumo curto
// ---------------------------------------------------------------------------
function criarTerminal() {
  const g = new THREE.Group();
  caixa(0.5, 0.32, 0.03, 0x23262f, 0, 0.12, 0, g);
  cilindro(0.025, 0.025, 0.12, 0x3a3f4f, 0, 0, -0.03, g, 8);
  caixa(0.2, 0.012, 0.14, 0x3a3f4f, 0, 0, -0.03, g, { sombra: false });
  const t = telaCanvas(640, 380, 0.46, 0.46 * 380 / 640, 0.85);
  t.plano.position.set(0, 0.28, 0.017);
  g.add(t.plano);
  let assinatura = null;
  function atualizar(dados) {
    const l = dados?.conectores || [];
    const n = e => l.filter(c => c.estado === e).length;
    const atencao = n('falhou') + n('precisa-autorizar');
    const chave = [l.length, n('conectado'), atencao, hora(dados?.geradoEm)].join('|');
    if (chave === assinatura) return;
    assinatura = chave;
    const c = t.ctx;
    c.fillStyle = '#0d1440'; c.fillRect(0, 0, 640, 380);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.font = `700 30px ${FONTE}`;
    c.fillText(`Portaria · ${hora(dados?.geradoEm)}`, 34, 56);
    c.fillStyle = '#5fbf8a'; c.font = `800 72px ${FONTE}`;
    c.fillText(String(n('conectado')), 34, 160);
    c.fillStyle = '#ffffff'; c.font = `700 34px ${FONTE}`;
    c.fillText('conectados', 34 + c.measureText(String(n('conectado'))).width + 120, 150);
    c.fillStyle = atencao ? '#ee4c01' : 'rgba(255,255,255,0.4)'; c.font = `800 72px ${FONTE}`;
    c.fillText(String(atencao), 34, 270);
    c.fillStyle = '#ffffff'; c.font = `700 34px ${FONTE}`;
    c.fillText(atencao === 1 ? 'pede atenção' : 'pedem atenção', 34 + c.measureText(String(atencao)).width + 120, 260);
    c.fillStyle = 'rgba(255,255,255,0.5)'; c.font = `600 26px ${FONTE}`;
    c.fillText(`${l.length} no quadro`, 34, 340);
    t.textura.needsUpdate = true;
  }
  return { grupo: g, atualizar, liberar() { t.textura.dispose(); t.material.dispose(); } };
}

// ---------------------------------------------------------------------------
// Claviculário: uma chave por conector, etiqueta na cor do estado.
// Montado com a frente para +z (local); a sala gira para encostar na parede.
// ---------------------------------------------------------------------------
const ARM = { larg: 2.0, alt: 1.25, prof: 0.08, base: 0.82 };

function criarClaviculario() {
  const g = new THREE.Group();
  caixa(ARM.larg + 0.12, ARM.alt + 0.12, ARM.prof, C.armario, 0, ARM.base - 0.06, 0, g);
  caixa(ARM.larg, ARM.alt, 0.01, C.fundoArmario, 0, ARM.base, ARM.prof / 2, g, { sombra: false });
  // plaquinha "chaves" em cima
  const placa = telaCanvas(512, 96, 0.6, 0.6 * 96 / 512, 0.35);
  placa.ctx.fillStyle = '#f4efe6'; placa.ctx.fillRect(0, 0, 512, 96);
  placa.ctx.fillStyle = '#2a2e45'; placa.ctx.textAlign = 'center'; placa.ctx.textBaseline = 'middle';
  placa.ctx.font = `800 54px ${FONTE}`; placa.ctx.fillText('CHAVES', 256, 52);
  placa.textura.needsUpdate = true;
  placa.plano.position.set(0, ARM.base + ARM.alt + 0.14, ARM.prof / 2 + 0.005);
  caixa(0.64, 0.14, 0.02, C.balcao, 0, ARM.base + ARM.alt + 0.07, ARM.prof / 2 - 0.01, g, { sombra: false });
  g.add(placa.plano);

  const chaves = new THREE.Group();
  g.add(chaves);
  const matLatao = new THREE.MeshStandardMaterial({ color: C.latao, roughness: 0.35, metalness: 0.6 });
  const matEtiqueta = Object.fromEntries(Object.entries(ESTADOS).map(([e, v]) => [e, new THREE.MeshStandardMaterial({ color: v.hex, roughness: 0.6, emissive: v.hex, emissiveIntensity: ATENCAO.has(e) ? 0.25 : 0.05 })]));
  const matUsado = new THREE.MeshStandardMaterial({ color: 0x4d8bff, emissive: 0x4d8bff, emissiveIntensity: 0.8 });
  const geoGancho = new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6).rotateX(Math.PI / 2);
  const geoArgola = new THREE.TorusGeometry(0.016, 0.004, 6, 14);
  const geoHaste = new THREE.BoxGeometry(0.012, 0.06, 0.006);
  const geoPonto = new THREE.SphereGeometry(0.008, 8, 6);
  let lista = [], assinatura = null, passoY = 0.2;

  function atualizar(conectores) {
    const chave = conectores.map(c => c.id + c.estado + (c.usadoEm ? 'u' : '')).join('|');
    if (chave === assinatura) return false;
    assinatura = chave;
    chaves.clear();
    for (const k of lista) k.geoEtiqueta.dispose();
    lista = [];
    const n = Math.max(1, conectores.length);
    // grade: proporção do armário (largura/altura ~ 1,6)
    let cols = Math.max(4, Math.ceil(Math.sqrt(n * 1.7)));
    const linhas = Math.ceil(n / cols);
    const sx = (ARM.larg - 0.16) / cols, sy = (ARM.alt - 0.12) / linhas;
    passoY = sy;
    const ew = Math.min(0.075, sx * 0.62), eh = Math.min(0.11, sy * 0.5);
    conectores.forEach((c, i) => {
      const col = i % cols, lin = Math.floor(i / cols);
      const x = -ARM.larg / 2 + 0.08 + sx * (col + 0.5);
      const y = ARM.base + ARM.alt - 0.06 - sy * lin - 0.02;
      const gancho = new THREE.Mesh(geoGancho, matLatao);
      gancho.position.set(x, y, ARM.prof / 2 + 0.025);
      chaves.add(gancho);
      // a chave balança num pivô na ponta do gancho
      const pivo = new THREE.Group();
      pivo.position.set(x, y, ARM.prof / 2 + 0.045);
      chaves.add(pivo);
      const argola = new THREE.Mesh(geoArgola, matLatao);
      argola.position.y = -0.016;
      pivo.add(argola);
      const haste = new THREE.Mesh(geoHaste, matLatao);
      haste.position.set(0, -0.06, 0);
      pivo.add(haste);
      const geoEtiqueta = new THREE.BoxGeometry(ew, eh, 0.008);
      const etiqueta = new THREE.Mesh(geoEtiqueta, matEtiqueta[c.estado] || matEtiqueta.desconhecido);
      etiqueta.position.set(0, -0.09 - eh / 2, 0.004);
      pivo.add(etiqueta);
      if (c.usadoEm) {
        const p = new THREE.Mesh(geoPonto, matUsado);
        p.position.set(0, -0.09 - eh * 0.25, 0.01);
        pivo.add(p);
      }
      // desligado: chave virada, como quem guardou
      if (c.estado === 'desativado') pivo.rotation.y = Math.PI * 0.45;
      lista.push({ pivo, estado: c.estado, fase: (i * 1.37) % 6.28, geoEtiqueta, x, y });
    });
    return true;
  }
  // as de atenção balançam de leve; um toque do porteiro faz a chave tocada balançar mais
  let toque = null;
  function animar(t) {
    for (const k of lista) {
      let a = ATENCAO.has(k.estado) ? Math.sin(t * 1.6 + k.fase) * 0.12 : 0;
      if (toque && toque.k === k) a += Math.sin((t - toque.t) * 7) * 0.35 * Math.exp(-(t - toque.t) * 1.2);
      k.pivo.rotation.z = a;
    }
  }
  function tocar(i, t) { if (lista[i]) toque = { k: lista[i], t }; }
  function posicaoChave(i) { const k = lista[i]; return k ? { x: k.x, y: k.y } : null; }
  return { grupo: g, atualizar, animar, tocar, posicaoChave, chaves: () => lista };
}

// ---------------------------------------------------------------------------
// Porteiro: astronauta com quepe, crachá e prancheta. Não é agente: sem balão.
// ---------------------------------------------------------------------------
const ESCALA = 1.45, VEL = 1.0;

function criarPorteiro() {
  const boneco = criarAstronauta(0x2f3d8f, 131, 'olhinhos');
  boneco.scale.setScalar(ESCALA);
  boneco.userData.npc = true;
  const cabeca = boneco.userData.luzAntena?.parent;
  // braços: pivôs filhos do corpo em x = ±0,21 e y = 0,54 (criarAstronauta)
  const corpo = boneco.children[0];
  const bracos = corpo.children.filter(o => Math.abs(Math.abs(o.position.x) - 0.21) < 0.01 && Math.abs(o.position.y - 0.54) < 0.01)
    .sort((a, b) => a.position.x - b.position.x);
  // quepe navy com faixa laranja e aba
  if (cabeca) {
    const quepe = new THREE.Group();
    const navy = new THREE.MeshStandardMaterial({ color: 0x1a2266, roughness: 0.6 });
    const copa = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.19, 0.1, 24), navy);
    copa.position.y = 0.255;
    const topo = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.205, 0.025, 24), navy);
    topo.position.y = 0.315;
    const faixa = new THREE.Mesh(new THREE.CylinderGeometry(0.197, 0.192, 0.03, 24), new THREE.MeshStandardMaterial({ color: COR.laranja, roughness: 0.5 }));
    faixa.position.y = 0.235;
    const aba = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.014, 20, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: 0x14183f, roughness: 0.4 }));
    aba.position.set(0, 0.21, 0.07);
    aba.rotation.x = 0.18;
    quepe.add(copa, topo, faixa, aba);
    quepe.traverse(o => { if (o.isMesh) o.castShadow = true; });
    cabeca.add(quepe);
  }
  // crachá no peito
  const cracha = new THREE.Group();
  caixa(0.075, 0.095, 0.01, 0xf4f2ee, 0, 0, 0, cracha, { sombra: false });
  caixa(0.075, 0.02, 0.012, COR.laranja, 0, 0.075, 0, cracha, { sombra: false });
  cracha.position.set(-0.1, 0.5, 0.175);
  cracha.rotation.x = -0.12;
  corpo.add(cracha);
  // prancheta (aparece quando confere o quadro)
  const prancheta = new THREE.Group();
  caixa(0.17, 0.012, 0.22, C.balcao, 0, 0, 0, prancheta);
  caixa(0.14, 0.004, 0.17, 0xf4f2ee, 0, 0.012, 0.01, prancheta, { sombra: false });
  caixa(0.06, 0.01, 0.025, 0x9aa0aa, 0, 0.014, -0.095, prancheta, { sombra: false });
  prancheta.position.set(0, 0.45, 0.27);
  prancheta.rotation.x = -0.75;
  prancheta.visible = false;
  boneco.add(prancheta);
  return { boneco, cabeca, bracos, prancheta };
}

// acoes: quadro (aponta e anota), chaves (mexe numa chave), balcao (atende),
// terminal (digita), ronda (vai até a entrada e olha), alongar (no lugar)
const DURACAO = { quadro: [6, 10], chaves: [4, 7], balcao: [5, 9], terminal: [4, 8], ronda: [4, 7], alongar: [1.7, 1.7] };

function rotinaDoPorteiro(sala) {
  const p = criarPorteiro();
  const { boneco } = p;
  let semente = 52361;
  const sorte = () => { semente = (semente * 48271) % 2147483647; return semente / 2147483647; };
  let rota = [], acao = null, ultima = null, inicio = 0, ate = 0, passo = 0, olhar = 0, chaveAlvo = -1;
  boneco.position.copy(sala.pontos.balcao.pos);
  // corpo sólido e cochilo (F1): só valem com a sala na Estação (sala.cochilo)
  const est = { olhar: 0, travadoDesde: null, andou: 0 };
  const coch = sala.cochilo ? criarCochilo({ boneco, assento: sala.cochilo, banco: sala.cochilo.banco, rota: sala.caminho, vel: VEL, faseAnim: 0.3,
    aoAcordar: () => { rota = []; acao = null; } }) : null;

  function escolher() {
    const atencao = sala.indicesAtencao();
    const pesos = {
      quadro: atencao.length ? 2.2 : 1.4,
      chaves: atencao.length ? 2.0 : 1.0,
      balcao: 1.6, terminal: 1.2, ronda: 0.7,
      alongar: ultima && ultima !== 'alongar' ? 0.35 : 0,
    };
    if (ultima) pesos[ultima] *= 0.15;
    const total = Object.values(pesos).reduce((a, b) => a + b, 0);
    let r = sorte() * total;
    for (const [k, w] of Object.entries(pesos)) { r -= w; if (r <= 0) return k; }
    return 'balcao';
  }
  function chegar(t) {
    const [a, b] = DURACAO[acao.nome];
    inicio = t; ate = t + a + sorte() * (b - a);
    if (acao.nome === 'chaves') sala.claviculario.tocar(chaveAlvo, t + 0.8);
  }
  function irPara(nome, t) {
    let destino;
    if (nome === 'chaves') {
      // prefere uma chave que precisa de atenção
      const atencao = sala.indicesAtencao();
      const todas = sala.claviculario.chaves().length;
      chaveAlvo = atencao.length && sorte() < 0.75 ? atencao[Math.floor(sorte() * atencao.length)] : Math.floor(sorte() * Math.max(1, todas));
      destino = sala.pontoDaChave(chaveAlvo);
    } else if (nome === 'quadro') {
      destino = sala.pontos[sala.indicesAtencao().length && sorte() < 0.7 ? 'quadroAtencao' : 'quadroConectados'];
    } else if (nome === 'alongar') {
      rota = [];
      acao = { nome, olhar };
      chegar(t);
      return;
    } else destino = sala.pontos[nome];
    rota = sala.caminho(boneco.position.clone(), destino.pos.clone());
    acao = { nome, olhar: destino.olhar };
  }
  function atualizar(t, dt) {
    let modo = 'parado';
    p.prancheta.visible = false;
    if (coch?.atualizar(t, dt)) return coch.dormindo() ? 'dormindo' : 'cochilo';
    if (rota.length) {
      const r = passoNpc(boneco, rota[0], VEL, dt, est, t);
      if (r === 'chegou') {
        rota.shift();
        if (!rota.length) chegar(t);
      } else if (r === 'andou') {
        passo += est.andou / (0.42 * ESCALA) * Math.PI;
        olhar = est.olhar;
      } else if (t - est.travadoDesde > 2.5) { rota = []; acao = null; est.travadoDesde = null; }
      modo = r === 'parado' ? 'parado' : 'andar';
      boneco.userData.animar(t, modo, false, { dt, passo, fase: 0.3 });
    } else if (acao && t < ate) {
      olhar = acao.olhar;
      const u = (t - inicio) / Math.max(0.1, ate - inicio);
      if (acao.nome === 'quadro') {
        // primeiro aponta para o quadro, depois anota na prancheta
        modo = u < 0.4 ? 'parado' : 'digitar';
        p.prancheta.visible = u >= 0.4;
      } else if (acao.nome === 'balcao') modo = 'conversar';
      else if (acao.nome === 'terminal') modo = 'digitar';
      else if (acao.nome === 'alongar') modo = 'entregar';
      else modo = 'parado';
      boneco.userData.animar(t, modo, false, { dt, fase: 0.3 });
      // poses que o animador não tem: apontar e alcançar a chave
      const [esq, dir] = p.bracos;
      const e = Math.max(0, Math.min(1, (t - inicio) / 0.4, (ate - t) / 0.4));
      if (acao.nome === 'quadro' && u < 0.4 && dir) {
        dir.rotation.x = -2.0 * e + Math.sin(t * 2.2) * 0.12 * e;
        if (p.cabeca) p.cabeca.rotation.x = -0.3 * e;
      } else if (acao.nome === 'chaves' && dir && esq) {
        dir.rotation.x = -2.35 * e + Math.sin(t * 6) * 0.1 * e;
        esq.rotation.x = -0.9 * e;
        if (p.cabeca) p.cabeca.rotation.x = -0.35 * e;
      } else if (acao.nome === 'ronda' && p.cabeca) {
        p.cabeca.rotation.y = Math.sin(t * 0.7) * 0.35;
      }
    } else {
      if (acao) ultima = acao.nome;
      marcarAndando(boneco, false);
      irPara(escolher(), t);
      boneco.userData.animar(t, 'parado', false, { dt, fase: 0.3 });
    }
    const dif = ((olhar - boneco.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    boneco.rotation.y += dif * Math.min(1, dt * 8);
    return modo;
  }
  return { boneco, atualizar, acao: () => acao?.nome || null, cochilar: sim => coch?.pedir(sim), dormindo: () => !!coch?.dormindo() };
}

// ---------------------------------------------------------------------------
// Sala inteira
// ---------------------------------------------------------------------------
export function montarSalaPortaria({ largura = 8.4, profundidade = 5.0, altParede = 2.6 } = {}) {
  const sala = new THREE.Group();
  const X0 = -largura / 2, ZF = -profundidade / 2;
  piso(largura, profundidade, C.pisoMadeira, 0, 0, sala);
  // paredes em corte
  caixa(largura + 0.12, altParede, 0.12, C.parede, 0, 0, ZF - 0.06, sala);
  caixa(0.12, altParede, profundidade, C.parede, X0 - 0.06, 0, 0, sala);
  caixa(largura, 0.08, 0.02, 0xd8cfc0, 0, 0, ZF + 0.01, sala, { sombra: false });
  caixa(0.02, 0.08, profundidade, 0xd8cfc0, X0 + 0.01, 0, 0, sala, { sombra: false });

  // quadro de status na parede do fundo
  const QX = 0.9, QL = 4.6, QA = 1.75;
  const quadro = criarQuadro({ largura: QL, altura: QA });
  quadro.grupo.position.set(QX, 0.8 + QA / 2, ZF + 0.05);
  sala.add(quadro.grupo);
  relogioParede(-2.55, 2.05, ZF + 0.02, 0.2, sala);

  // claviculário na parede da esquerda, de frente para +x
  const claviculario = criarClaviculario();
  const CZ = 0.15;
  claviculario.grupo.position.set(X0 + 0.04, 0, CZ);
  claviculario.grupo.rotation.y = Math.PI / 2;
  sala.add(claviculario.grupo);

  // balcão de recepção
  const BX = 0.6, BZ = ZF + 1.75, BL = 3.2, BP = 0.62, BA = 1.02;
  const balcao = new THREE.Group();
  balcao.position.set(BX, 0, BZ);
  sala.add(balcao);
  caixa(BL, BA - 0.05, BP - 0.08, C.balcao, 0, 0, 0, balcao);
  caixa(BL - 0.1, 0.62, 0.02, C.frente, 0, 0.18, BP / 2 - 0.03, balcao, { sombra: false });
  caixa(BL - 0.1, 0.025, 0.022, COR.laranja, 0, 0.84, BP / 2 - 0.025, balcao, { sombra: false });
  caixa(BL + 0.08, 0.05, BP + 0.04, C.tampo, 0, BA - 0.05, 0, balcao);
  const terminal = criarTerminal();
  terminal.grupo.position.set(-0.75, BA, -0.05);
  terminal.grupo.rotation.y = Math.PI;   // tela para o porteiro
  balcao.add(terminal.grupo);
  // campainha, livro de registro e suculenta
  cilindro(0.06, 0.07, 0.02, 0x3a3f4f, 0.55, BA, 0.12, balcao, 14);
  const cupula = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: C.latao, roughness: 0.3, metalness: 0.7 }));
  cupula.position.set(0.55, BA + 0.02, 0.12);
  cupula.castShadow = true;
  balcao.add(cupula);
  const livro = new THREE.Group();
  caixa(0.2, 0.025, 0.28, 0x6b2f2f, -0.1, 0, 0, livro);
  caixa(0.2, 0.025, 0.28, 0x6b2f2f, 0.1, 0, 0, livro);
  caixa(0.18, 0.01, 0.26, 0xf4efe6, -0.1, 0.025, 0, livro, { sombra: false });
  caixa(0.18, 0.01, 0.26, 0xf4efe6, 0.1, 0.025, 0, livro, { sombra: false });
  livro.position.set(0.05, BA, 0.08);
  livro.rotation.y = 0.15;
  balcao.add(livro);
  planta(1.35, 0.05, 1.7, COR.offWhite, 'suculenta', balcao, BA);

  // espera: banco, tapete, capacho e plantas
  tapete(BX, BZ + 1.35, 3.4, 1.5, C.tapete, sala);
  const banco = new THREE.Group();
  banco.position.set(3.55, 0, 0.9);
  banco.rotation.y = -Math.PI / 2;
  sala.add(banco);
  caixa(1.5, 0.08, 0.48, C.balcao, 0, 0.4, 0, banco);
  for (const x of [-0.65, 0.65]) caixa(0.08, 0.4, 0.42, 0x6b4a33, x, 0, 0, banco);
  caixa(0.66, 0.07, 0.42, 0x8fa3b8, -0.36, 0.48, 0, banco);
  caixa(0.66, 0.07, 0.42, 0x8fa3b8, 0.36, 0.48, 0, banco);
  caixa(1.0, 0.02, 0.6, COR.fibra, 1.9, 0.006, -ZF - 0.4, sala, { sombra: false, mat: { roughness: 1 } });
  planta(-X0 - 0.45, ZF + 0.45, 1.0, COR.offWhite, 'folhaLarga', sala);
  planta(X0 + 0.55, -ZF - 0.55, 0.95, COR.terracota, 'ficus', sala);
  planta(3.55, -ZF - 0.5, 0.8, COR.pretoFosco, 'folhaLarga', sala);

  // pontos do porteiro (y = 0). Corredor atrás do balcão em z = corZ.
  const corZ = BZ - BP / 2 - 0.42;
  const pontos = {
    balcao: { pos: new THREE.Vector3(BX + 0.25, 0, corZ + 0.06), olhar: 0 },
    terminal: { pos: new THREE.Vector3(BX - 0.75, 0, corZ + 0.06), olhar: 0 },
    quadroAtencao: { pos: new THREE.Vector3(QX - QL / 4, 0, ZF + 0.62), olhar: Math.PI },
    quadroConectados: { pos: new THREE.Vector3(QX + QL / 4, 0, ZF + 0.62), olhar: Math.PI },
    ronda: { pos: new THREE.Vector3(-2.3, 0, 1.25), olhar: Math.PI * 0.2 },
  };
  // caminho: sobe para o corredor, anda em x e desce até o destino (o corredor é livre)
  function caminho(de, para) {
    const pts = [];
    if (Math.abs(de.z - corZ) > 0.05) pts.push(new THREE.Vector3(de.x, 0, corZ));
    if (Math.abs(de.x - para.x) > 0.05) pts.push(new THREE.Vector3(para.x, 0, corZ));
    pts.push(para);
    return pts;
  }
  // a chave i fica em (x local do armário, y); no mundo: z = CZ - x, encostado na parede
  function pontoDaChave(i) {
    const k = claviculario.posicaoChave(i) || { x: 0 };
    const z = Math.max(corZ + 0.2, CZ - k.x);
    return { pos: new THREE.Vector3(X0 + 0.62, 0, z), olhar: -Math.PI / 2 };
  }
  let ultimos = [];
  const indicesAtencao = () => ultimos.map((c, i) => (ATENCAO.has(c.estado) ? i : -1)).filter(i => i >= 0);

  const porteiro = rotinaDoPorteiro({ pontos, caminho, pontoDaChave, indicesAtencao, claviculario });
  sala.add(porteiro.boneco);

  function atualizar(dados) {
    if (!dados?.conectores) return;
    ultimos = dados.conectores;
    quadro.atualizar(dados);
    terminal.atualizar(dados);
    claviculario.atualizar(dados.conectores);
  }
  // relógio próprio: só avança (aba em segundo plano ou tempo que volta não travam a rotina)
  let anterior = null, relogio = 0;
  function animar(tempo) {
    const dt = anterior == null ? 1 / 60 : Math.max(0, Math.min(0.1, tempo - anterior));
    anterior = tempo;
    relogio += dt;
    claviculario.animar(relogio);
    porteiro.atualizar(relogio, dt);
  }
  return { grupo: sala, atualizar, animar, largura, profundidade, porteiro };
}

// ---------------------------------------------------------------------------
// Módulo da Estação (F1-SALAS-E-VIDA, 03/10): a Portaria numa vaga de 4,6 x 6,8 m
// ---------------------------------------------------------------------------
// Ala técnica, núcleo norte (vaga 2), sempre presente. Coordenadas locais: x de -2,3
// a 2,3; z de -3,4 (parede alta do fundo) a 3,4 (divisória do corredor). Sem piso nem
// paredes (layout.js monta a casca, sem porta: ninguém entra). Tudo alinhado às paredes.
// - na parede do fundo, o quadro de status (esquerda) e o claviculário (direita);
// - balcão de recepção paralelo ao fundo, com o porteiro no corredor de trás;
// - na frente, tapete, capacho e plantas (sem banco de espera: nada de assento vazio);
// - cochilo: banqueta alta atrás do balcão, que aparece quando ele vai sentar.
export function montarModuloPortaria() {
  const sala = new THREE.Group();
  sala.name = 'modulo-portaria';
  const XE = -2.3, ZF = -3.4;
  // no módulo a casca já põe um rodapé em ZF..ZF+0,02: este fica na frente dele (coincidiam e piscavam)
  caixa(4.6, 0.08, 0.02, 0xd8cfc0, 0, 0, ZF + 0.035, sala, { sombra: false });

  // quadro de status e claviculário na parede do fundo
  const QL = 2.25, QA = 1.25, QX = -1.06;
  const quadro = criarQuadro({ largura: QL, altura: QA });
  quadro.grupo.position.set(QX, 0.95 + QA / 2, ZF + 0.05);
  sala.add(quadro.grupo);
  const claviculario = criarClaviculario();
  const CX = 1.17;
  claviculario.grupo.position.set(CX, 0, ZF + 0.04);
  sala.add(claviculario.grupo);
  relogioParede(QX, 2.5, ZF + 0.02, 0.15, sala);

  // balcão de recepção
  const BX = -0.25, BZ = -1.45, BL = 2.6, BP = 0.62, BA = 1.02;
  const balcao = new THREE.Group();
  balcao.position.set(BX, 0, BZ);
  sala.add(balcao);
  caixa(BL, BA - 0.05, BP - 0.08, C.balcao, 0, 0, 0, balcao);
  caixa(BL - 0.1, 0.62, 0.02, C.frente, 0, 0.18, BP / 2 - 0.03, balcao, { sombra: false });
  caixa(BL - 0.1, 0.025, 0.022, COR.laranja, 0, 0.84, BP / 2 - 0.025, balcao, { sombra: false });
  caixa(BL + 0.08, 0.05, BP + 0.04, C.tampo, 0, BA - 0.05, 0, balcao);
  const terminal = criarTerminal();
  terminal.grupo.position.set(-0.6, BA, -0.05);
  terminal.grupo.rotation.y = Math.PI;
  balcao.add(terminal.grupo);
  cilindro(0.06, 0.07, 0.02, 0x3a3f4f, 0.55, BA, 0.12, balcao, 14);
  const cupula = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: C.latao, roughness: 0.3, metalness: 0.7 }));
  cupula.position.set(0.55, BA + 0.02, 0.12);
  cupula.castShadow = true;
  balcao.add(cupula);
  const livro = new THREE.Group();
  caixa(0.2, 0.025, 0.28, 0x6b2f2f, -0.1, 0, 0, livro);
  caixa(0.2, 0.025, 0.28, 0x6b2f2f, 0.1, 0, 0, livro);
  caixa(0.18, 0.01, 0.26, 0xf4efe6, -0.1, 0.025, 0, livro, { sombra: false });
  caixa(0.18, 0.01, 0.26, 0xf4efe6, 0.1, 0.025, 0, livro, { sombra: false });
  livro.position.set(0.1, BA, 0.08);
  balcao.add(livro);
  planta(1.05, 0.05, 1.6, COR.offWhite, 'suculenta', balcao, BA);

  // frente: tapete, capacho e plantas
  tapete(BX, 0.75, 3.0, 1.6, C.tapete, sala);
  caixa(1.0, 0.02, 0.6, COR.fibra, 1.2, 0.006, 2.9, sala, { sombra: false, mat: { roughness: 1 } });
  planta(XE + 0.45, 2.95, 0.95, COR.terracota, 'ficus', sala);
  planta(-0.6, 2.95, 0.9, COR.offWhite, 'folhaLarga', sala);
  planta(-1.85, 1.0, 0.8, COR.pretoFosco, 'folhaLarga', sala);

  // pontos do porteiro; corredor atrás do balcão em z = corZ
  const corZ = BZ - BP / 2 - 0.45;
  const pontos = {
    balcao: { pos: new THREE.Vector3(BX + 0.3, 0, corZ + 0.06), olhar: 0 },
    terminal: { pos: new THREE.Vector3(BX - 0.6, 0, corZ + 0.06), olhar: 0 },
    quadroAtencao: { pos: new THREE.Vector3(QX - QL / 4, 0, ZF + 0.62), olhar: Math.PI },
    quadroConectados: { pos: new THREE.Vector3(QX + QL / 4, 0, ZF + 0.62), olhar: Math.PI },
    ronda: { pos: new THREE.Vector3(1.75, 0, 1.6), olhar: 0 },
  };
  const obst = [
    { x: BX, z: BZ, hx: BL / 2 + 0.06, hz: BP / 2 + 0.02 },
    { x: XE + 0.45, z: 2.95, hx: 0.25, hz: 0.25 }, { x: -0.6, z: 2.95, hx: 0.25, hz: 0.25 }, { x: -1.85, z: 1.0, hx: 0.25, hz: 0.25 },
  ];
  const caminho = criarRoteador(obst, { x0: XE + 0.4, x1: 1.95, z0: ZF + 0.55, z1: 3.0 });
  function pontoDaChave(i) {
    const k = claviculario.posicaoChave(i) || { x: 0 };
    return { pos: new THREE.Vector3(Math.max(0.35, Math.min(1.9, CX + k.x)), 0, ZF + 0.62), olhar: Math.PI };
  }
  // banqueta alta atrás do balcão (aparece no cochilo)
  const banqueta = new THREE.Group();
  cilindro(0.2, 0.2, 0.05, 0x3a3f6f, 0, 0.68, 0, banqueta, 20);
  cilindro(0.025, 0.03, 0.68, 0x3a3f4f, 0, 0, 0, banqueta, 8);
  cilindro(0.17, 0.19, 0.02, 0x3a3f4f, 0, 0, 0, banqueta, 16);
  const BQ = new THREE.Vector3(BX + 0.95, 0, corZ + 0.02);
  banqueta.position.copy(BQ);
  sala.add(banqueta);
  const cochilo = { entrada: new THREE.Vector3(BQ.x, 0, BQ.z - 0.55), pos: BQ.clone(), y: 0.73 - 0.30 * ESCALA, olhar: 0, banco: banqueta };

  let ultimos = [];
  const indicesAtencao = () => ultimos.map((c, i) => (ATENCAO.has(c.estado) ? i : -1)).filter(i => i >= 0);
  const porteiro = rotinaDoPorteiro({ pontos, caminho, pontoDaChave, indicesAtencao, claviculario, cochilo });
  sala.add(porteiro.boneco);
  const corpo = registrarNpc(porteiro.boneco, { sala: 'portaria' });

  function atualizar(dados) {
    if (!dados?.conectores) return;
    ultimos = dados.conectores;
    quadro.atualizar(dados);
    terminal.atualizar(dados);
    claviculario.atualizar(dados.conectores);
  }
  let anterior = null, relogio = 0;
  function animar(tempo) {
    const dt = anterior == null ? 1 / 60 : Math.max(0, Math.min(0.1, tempo - anterior));
    anterior = tempo;
    relogio += dt;
    claviculario.animar(relogio);
    porteiro.atualizar(relogio, dt);
  }
  return {
    grupo: sala, atualizar, animar, npcs: [porteiro.boneco],
    cochilar: sim => porteiro.cochilar(sim), dormindo: () => porteiro.dormindo(),
    liberar() { removerNpc(corpo); quadro.liberar?.(); terminal.liberar?.(); },
  };
}
