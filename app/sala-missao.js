// Sala de missão: quando um workflow (orquestração de vários subagentes) está
// rodando, o quadro da parede mostra a missão: nome, descrição, as fases na
// ordem do script (feitas, a que roda e as que faltam), quantos agentes já
// terminaram e quantos rodam em cada fase, e há quanto tempo começou. Com mais
// de uma missão ativa, o quadro ganha abas que se revezam. Sem missão, mostra
// a última concluída ou "Nenhuma missão em andamento", sem cobrança nem placar.
//
// Uma mesa de reunião no meio e um coordenador de missão (NPC, não é agente: sem
// balão nem placa) com rotina própria: vai até o quadro e aponta a fase atual,
// volta para a cabeceira, confere a prancheta, se apoia na mesa, toma um café.
//
// Dados de /api/missao (app/fonte-missao.js).
// montarSalaMissao() -> { grupo, atualizar(dados), animar(t), largura, profundidade, quadro, coordenador }

import * as THREE from 'three';
import { caixa, cilindro, piso, planta, tapete, cadeira, estante, aparador, caneca, pendente, relogioParede, COR } from './pecas.js';
import { criarAstronauta } from './personagens.js';
import { registrarNpc, removerNpc, passoNpc, marcarAndando, criarRoteador } from './sala-corpos.js';

const FONTE = 'Figtree, -apple-system, "Helvetica Neue", sans-serif';
const C = {
  parede: 0xece6dc, piso: 0xd6b083, tapete: 0x9fb0c9, tampo: 0xc8a27a, pe: 0x8a5a3a,
  moldura: COR.madeiraMedia, ledge: COR.madeiraEscura,
};
const TROCA_ABA_S = 14;     // com várias missões ativas, cada aba fica esse tempo no quadro

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------
function semAcento(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

// "reforma-a-estacao" -> "Reforma a Estação": devolve os acentos procurando a
// mesma palavra na descrição
export function nomeBonito(nome = '', descricao = '') {
  const palavrasDesc = new Map();
  for (const p of descricao.split(/[^\p{L}\p{N}]+/u)) if (p.length > 2 && !palavrasDesc.has(semAcento(p))) palavrasDesc.set(semAcento(p), p);
  const t = nome.replace(/[-_]+/g, ' ').trim().split(/\s+/).map(p => {
    const d = palavrasDesc.get(semAcento(p));
    if (!d) return p;
    // mantém maiúscula só de nome próprio (a descrição escreveu assim no meio da frase)
    return d;
  }).join(' ');
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

export function tempoRelativo(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 dia' : `${d} dias`;
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function quebrar(g, texto, maxLarg, maxLinhas) {
  const palavras = String(texto || '').split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (let i = 0; i < palavras.length; i++) {
    const tenta = atual ? atual + ' ' + palavras[i] : palavras[i];
    if (g.measureText(tenta).width <= maxLarg || !atual) { atual = tenta; continue; }
    linhas.push(atual);
    atual = palavras[i];
    if (linhas.length === maxLinhas) { atual = null; break; }
  }
  if (atual) linhas.push(atual);
  const cortou = linhas.length > maxLinhas || (atual === null);
  const saida = linhas.slice(0, maxLinhas);
  if (cortou && saida.length) {
    let u = saida[saida.length - 1];
    while (u.length > 1 && g.measureText(u + '…').width > maxLarg) u = u.slice(0, -1).trimEnd();
    saida[saida.length - 1] = u + '…';
  }
  return saida;
}

function cortar(g, texto, maxLarg) {
  let t = String(texto || '');
  if (g.measureText(t).width <= maxLarg) return t;
  while (t.length > 1 && g.measureText(t + '…').width > maxLarg) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

function pilula(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h);
}

// ---------------------------------------------------------------------------
// Quadro da missão (canvas como textura, com moldura de madeira)
// ---------------------------------------------------------------------------
export function criarQuadroMissao({ largura = 3.8, altura = 1.9 } = {}) {
  const W = 2400, H = Math.round(W * altura / largura);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: textura, emissive: 0xffffff, emissiveMap: textura, emissiveIntensity: 0.72, roughness: 0.4 });
  const tela = new THREE.Mesh(new THREE.PlaneGeometry(largura, altura), material);
  tela.position.z = 0.035;

  const grupo = new THREE.Group();
  // moldura de madeira, fundo grafite e uma bordinha embaixo com dois pincéis
  caixa(largura + 0.16, altura + 0.16, 0.05, C.moldura, 0, -(altura + 0.16) / 2, 0, grupo);
  caixa(largura + 0.02, altura + 0.02, 0.02, 0x1d2240, 0, -(altura + 0.02) / 2, 0.02, grupo, { sombra: false });
  grupo.add(tela);
  caixa(largura * 0.55, 0.035, 0.1, C.ledge, largura * 0.12, -altura / 2 - 0.13, 0.06, grupo);
  for (const [dx, cor] of [[0.05, COR.laranja], [0.2, COR.azul]]) {
    const p = cilindro(0.012, 0.012, 0.13, cor, largura * 0.12 + dx, 0, 0, grupo, 8);
    p.rotation.z = Math.PI / 2;
    p.position.set(largura * 0.12 + dx, -altura / 2 - 0.08, 0.07);
  }
  // luz de missão no alto da moldura: laranja respirando quando há missão em andamento
  const matLuz = new THREE.MeshStandardMaterial({ color: 0x8a8f9c, emissive: COR.laranja, emissiveIntensity: 0, roughness: 0.3 });
  caixa(0.16, 0.05, 0.1, COR.grafite, largura / 2 - 0.25, altura / 2 + 0.08, 0.03, grupo);
  const luz = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), matLuz);
  luz.position.set(largura / 2 - 0.25, altura / 2 + 0.13, 0.03);
  grupo.add(luz);

  let assinatura = null, ultimo = null, aba = 0, trocaEm = 0;
  let alvo = null;   // onde está a fase atual no quadro (coordenadas locais do grupo)
  let ativa = false;

  const px = (x, y) => new THREE.Vector3((x / W - 0.5) * largura, (0.5 - y / H) * altura, 0.04);

  function fundo() {
    const f = g.createLinearGradient(0, 0, W * 0.4, H);
    f.addColorStop(0, '#0d1660'); f.addColorStop(1, '#070b3c');
    g.fillStyle = f; g.fillRect(0, 0, W, H);
    // pontinhos discretos, de prancheta de engenharia
    g.fillStyle = 'rgba(255,255,255,0.045)';
    for (let y = 40; y < H; y += 60) for (let x = 40; x < W; x += 60) g.fillRect(x, y, 3, 3);
  }

  function rotulo(texto, x, y, cor) {
    g.font = `800 30px ${FONTE}`;
    if ('letterSpacing' in g) g.letterSpacing = '4px';
    g.fillStyle = cor; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(texto.toUpperCase(), x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  }

  function desenharVazio() {
    fundo();
    alvo = null;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // órbita calma no meio
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 4;
    g.beginPath(); g.ellipse(W / 2, H * 0.36, 150, 52, -0.25, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(143,179,255,0.9)';
    g.beginPath(); g.arc(W / 2, H * 0.36, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ee4c01';
    g.beginPath(); g.arc(W / 2 + 140, H * 0.36 - 40, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.font = `800 92px ${FONTE}`;
    g.fillText('Nenhuma missão em andamento', W / 2, H * 0.6);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = `600 40px ${FONTE}`;
    g.fillText('Quando um workflow começar, ele aparece aqui.', W / 2, H * 0.6 + 90);
  }

  function desenharMissao(m, ativas, agora) {
    fundo();
    const pad = 80;
    let topo = 70;
    // abas: uma por missão ativa
    if (ativas.length > 1) {
      g.font = `800 34px ${FONTE}`;
      let x = pad;
      ativas.forEach((a, i) => {
        const t = cortar(g, nomeBonito(a.nome, a.descricao), 520);
        const w = g.measureText(t).width + 64;
        pilula(g, x, 34, w, 70, 35);
        if (a.id === m.id) { g.fillStyle = '#0038ef'; g.fill(); } else { g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 3; g.stroke(); }
        g.fillStyle = a.id === m.id ? '#ffffff' : 'rgba(255,255,255,0.65)';
        g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(t, x + 32, 70);
        x += w + 18;
      });
      topo = 150;
    }

    // ---- coluna da esquerda: a missão
    const xe = pad, larE = 900;
    let y = topo + 40;
    if (m.ativa) {
      g.fillStyle = '#ee4c01';
      g.beginPath(); g.arc(xe + 10, y - 11, 10, 0, Math.PI * 2); g.fill();
      rotulo(m.situacao === 'entre-fases' ? 'Missão em andamento · entre fases' : 'Missão em andamento', xe + 34, y, '#ff8a4c');
    } else {
      const quando = tempoRelativo(agora - (m.fim || agora));
      rotulo(m.situacao === 'parada' ? `Missão encerrada há ${quando}` : `Missão concluída há ${quando}`, xe, y, '#8fb3ff');
    }
    y += 30;
    g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.font = `800 96px ${FONTE}`;
    for (const l of quebrar(g, nomeBonito(m.nome, m.descricao), larE, 2)) { g.fillText(l, xe, y); y += 108; }
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.font = `700 32px ${FONTE}`;
    g.fillText(`pasta ${m.projeto}`, xe, y + 4);
    y += 66;
    g.fillStyle = 'rgba(255,255,255,0.72)';
    g.font = `600 38px ${FONTE}`;
    const linhasDesc = Math.max(1, Math.min(4, Math.floor((H - 330 - y) / 50)));
    for (const l of quebrar(g, m.descricao, larE, linhasDesc)) { g.fillText(l, xe, y); y += 50; }

    // rodapé da esquerda: o agora (ou o resumo de quando acabou)
    const base = H - 90;
    g.textBaseline = 'alphabetic';
    if (m.ativa) {
      const atual = m.fases.find(f => f.titulo === m.faseAtual) || m.fases.find(f => f.estado === 'rodando');
      rotulo('Agora', xe, base - 160, 'rgba(255,255,255,0.5)');
      g.fillStyle = '#ffffff';
      g.font = `800 64px ${FONTE}`;
      g.fillText(cortar(g, atual ? atual.titulo : 'preparando a próxima fase', larE), xe, base - 92);
      const rot = atual?.agentes?.rotulos || [];
      g.font = `700 30px ${FONTE}`;
      let x = xe;
      for (const r of rot.slice(0, 3)) {
        const t = cortar(g, r, 300);
        const w = g.measureText(t).width + 36;
        if (x + w > xe + larE) break;
        pilula(g, x, base - 70, w, 48, 24);
        g.fillStyle = 'rgba(238,76,1,0.22)'; g.fill();
        g.fillStyle = '#ffd0b8'; g.textBaseline = 'middle';
        g.fillText(t, x + 18, base - 45);
        g.textBaseline = 'alphabetic';
        x += w + 12;
      }
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.font = `700 34px ${FONTE}`;
      g.fillText(`começou há ${tempoRelativo(agora - m.inicio)}`, xe, base + 30);
    } else {
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.font = `700 34px ${FONTE}`;
      g.fillText(`durou ${tempoRelativo((m.fim || agora) - m.inicio)} · ${plural(m.agentes.total, 'agente', 'agentes')}`, xe, base + 30);
    }

    // ---- coluna da direita: as fases
    const xd = 1080, xFim = W - pad;
    g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(xd - 60, topo + 10); g.lineTo(xd - 60, H - 60); g.stroke();
    rotulo('Fases', xd, topo + 40, 'rgba(255,255,255,0.5)');
    const n = Math.max(1, m.fases.length);
    const y0 = topo + 80, disp = H - 60 - y0;
    const alt = Math.min(150, disp / n);
    const r = Math.max(14, Math.min(26, alt * 0.2));
    const xm = xd + r + 4;
    const tamT = Math.max(28, Math.min(50, alt * 0.36)), tamD = Math.max(20, Math.min(28, alt * 0.2));
    let primeiraFalta = true;
    alvo = null;
    const centros = m.fases.map((f, i) => y0 + alt * i + alt / 2);
    // trilho entre os marcadores
    for (let i = 0; i < m.fases.length - 1; i++) {
      const feita = m.fases[i].estado === 'feita' && m.fases[i + 1].estado !== 'falta';
      g.strokeStyle = feita ? 'rgba(143,179,255,0.55)' : 'rgba(255,255,255,0.16)';
      g.lineWidth = 5;
      g.setLineDash(feita ? [] : [10, 12]);
      g.beginPath(); g.moveTo(xm, centros[i] + r + 4); g.lineTo(xm, centros[i + 1] - r - 4); g.stroke();
    }
    g.setLineDash([]);
    m.fases.forEach((f, i) => {
      const cy = centros[i];
      if (f.estado === 'rodando') {
        pilula(g, xd - 24, cy - alt / 2 + 6, xFim - xd + 48, alt - 12, 22);
        g.fillStyle = 'rgba(238,76,1,0.14)'; g.fill();
        if (!alvo || f.titulo === m.faseAtual) alvo = px(xm, cy);
      }
      // marcador
      if (f.estado === 'feita') {
        g.fillStyle = '#3d6bff';
        g.beginPath(); g.arc(xm, cy, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(4, r * 0.22); g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(xm - r * 0.45, cy + r * 0.02); g.lineTo(xm - r * 0.1, cy + r * 0.36); g.lineTo(xm + r * 0.48, cy - r * 0.34); g.stroke();
      } else if (f.estado === 'rodando') {
        g.fillStyle = 'rgba(238,76,1,0.35)';
        g.beginPath(); g.arc(xm, cy, r + 11, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ee4c01';
        g.beginPath(); g.arc(xm, cy, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(xm, cy, r * 0.36, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = '#0a1048';
        g.beginPath(); g.arc(xm, cy, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 4;
        g.beginPath(); g.arc(xm, cy, r - 2, 0, Math.PI * 2); g.stroke();
      }
      // contagem à direita
      const a = f.agentes || { rodando: 0, concluidos: 0 };
      let cont = '', corCont = 'rgba(255,255,255,0.55)';
      if (f.estado === 'rodando') {
        cont = `${a.rodando} rodando` + (a.concluidos ? ` · ${plural(a.concluidos, 'concluído', 'concluídos')}` : '');
        corCont = '#ff9a66';
      } else if (f.estado === 'feita') {
        cont = plural(a.concluidos, 'concluído', 'concluídos') + (f.volta ? ' · volta depois' : '');
      } else if (m.ativa && primeiraFalta) {
        cont = 'próxima'; corCont = 'rgba(255,255,255,0.42)';
      }
      if (f.estado === 'falta') primeiraFalta = false;
      g.font = `700 ${Math.round(tamD * 1.35)}px ${FONTE}`;
      g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillStyle = corCont;
      g.fillText(cont, xFim, cy);
      const larCont = cont ? g.measureText(cont).width + 30 : 0;
      // título e detalhe
      const xt = xm + r + 28, larT = xFim - xt - larCont;
      const temDetalhe = f.detalhe && alt >= 64;
      g.textAlign = 'left';
      g.font = `800 ${Math.round(tamT)}px ${FONTE}`;
      g.fillStyle = f.estado === 'falta' ? 'rgba(255,255,255,0.5)' : '#ffffff';
      g.fillText(cortar(g, f.titulo, larT), xt, temDetalhe ? cy - tamD * 0.62 : cy);
      if (temDetalhe) {
        g.font = `600 ${Math.round(tamD)}px ${FONTE}`;
        g.fillStyle = f.estado === 'falta' ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.55)';
        g.fillText(cortar(g, f.detalhe, larT), xt, cy + tamT * 0.56);
      }
    });
    if (!m.fases.length) {
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.font = `600 36px ${FONTE}`;
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText('o script não declarou fases', xd, y0);
    }
  }

  // escolhe o que mostrar: missões ativas (com abas) ou a última concluída
  function atualizar(dados, agora = Date.now(), t = 0) {
    if (dados) ultimo = dados;
    const missoes = ultimo?.missoes || [];
    const ativas = missoes.filter(m => m.ativa);
    if (ativas.length > 1) {
      if (trocaEm === 0) trocaEm = t + TROCA_ABA_S;
      else if (t >= trocaEm) { aba = (aba + 1) % ativas.length; trocaEm = t + TROCA_ABA_S; }
    }
    if (aba >= ativas.length) aba = 0;
    const m = ativas.length ? ativas[aba] : missoes[0] || null;
    ativa = !!(m && m.ativa);
    const minuto = Math.floor(agora / 60000);
    const chave = JSON.stringify([m, ativas.map(a => a.id), minuto]);
    if (chave === assinatura) return false;
    assinatura = chave;
    if (m) desenharMissao(m, ativas, agora); else desenharVazio();
    textura.needsUpdate = true;
    return true;
  }
  function redesenhar() { assinatura = null; if (ultimo) atualizar(null); }
  // a fonte Figtree chega depois: redesenha quando ela estiver pronta
  if (typeof document !== 'undefined' && document.fonts?.load) {
    Promise.all(['600', '700', '800'].map(p => document.fonts.load(`${p} 40px Figtree`))).then(redesenhar).catch(() => {});
  }
  desenharVazio();
  textura.needsUpdate = true;

  function animar(t) {
    matLuz.emissiveIntensity = ativa ? 0.6 + 0.9 * (0.5 + 0.5 * Math.sin(t * 2.2)) : 0;
    matLuz.color.setHex(ativa ? 0xffb08a : 0x8a8f9c);
  }

  return {
    grupo, atualizar, animar, redesenhar, largura, altura,
    // ponto (local ao grupo) da fase que está rodando, para o coordenador apontar
    alvoFase: () => alvo?.clone() ?? null,
    temMissaoAtiva: () => ativa,
    liberar() { textura.dispose(); material.dispose(); tela.geometry.dispose(); matLuz.dispose(); luz.geometry.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Coordenador de missão: astronauta de detalhes navy, com prancheta
// ---------------------------------------------------------------------------
const ESCALA = 1.45, VEL = 1.0, PASSADA = 0.39 * ESCALA / 1.45;
const Y_SENTADO = 0.51 - 0.30 * ESCALA;

function criarCoordenador() {
  const boneco = criarAstronauta(COR.navy, 211, 'olhinhos');
  boneco.scale.setScalar(ESCALA);
  boneco.userData.npc = true;
  // articulações (pivôs do personagens.js): braços em (±0,21; 0,54) e cabeça em (0; 0,82)
  const bracos = [], pivos = [];
  boneco.traverse(o => { if (o.isGroup && o !== boneco) pivos.push(o); });
  for (const p of pivos) if (Math.abs(Math.abs(p.position.x) - 0.21) < 0.01 && Math.abs(p.position.y - 0.54) < 0.01) bracos[p.position.x < 0 ? 0 : 1] = p;
  const cabeca = pivos.find(p => Math.abs(p.position.x) < 0.001 && Math.abs(p.position.y - 0.82) < 0.01);
  // lenço laranja no pescoço: o coordenador se destaca sem placa
  const lenco = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 8, 24), new THREE.MeshStandardMaterial({ color: COR.laranja, roughness: 0.7 }));
  lenco.rotation.x = Math.PI / 2;
  lenco.position.y = 0.66;
  boneco.add(lenco);
  // prancheta segurada com as duas mãos na frente do peito
  const prancheta = new THREE.Group();
  caixa(0.17, 0.012, 0.23, COR.madeiraMedia, 0, 0, 0, prancheta, { seg: 0 });
  caixa(0.14, 0.004, 0.18, 0xf4f1ea, 0, 0.012, 0.015, prancheta, { seg: 0, sombra: false });
  for (let k = 0; k < 4; k++) caixa(0.09 - (k % 2) * 0.03, 0.002, 0.008, 0x8a93a8, -0.015, 0.016, -0.04 + k * 0.035, prancheta, { seg: 0, sombra: false });
  caixa(0.06, 0.02, 0.025, 0x9aa0aa, 0, 0.01, -0.105, prancheta, { seg: 0, sombra: false });
  prancheta.position.set(0, 0.5, 0.3);
  prancheta.rotation.set(-0.75, Math.PI, 0);
  prancheta.scale.setScalar(1.25);
  prancheta.visible = false;
  boneco.add(prancheta);
  boneco.traverse(o => { if (o.isMesh && !o.userData.hitbox) o.castShadow = true; });
  return { boneco, bracos, cabeca, prancheta, liberar() { lenco.geometry.dispose(); lenco.material.dispose(); boneco.userData.liberar?.(); } };
}

// Rotina independente, com sorteio de semente própria. pontos() devolve os
// lugares da sala; quadro dá o alvo da fase atual. Os caminhos passam pelo
// corredor entre o quadro e a mesa (laneZ): sobe ou desce em linha reta até ele.
// opc (F1, módulo da Estação): rota(de, para) troca o corredor por rotas que desviam
// dos móveis; cadeira (Object3D) só aparece enquanto ele está sentado nela (nada de
// cadeira vazia à mostra). Com cochilar(true), ele vai para a cadeira e para.
function rotinaDoCoordenador(pontos, quadro, laneZ, opc = {}) {
  const c = criarCoordenador();
  const { boneco } = c;
  let semente = 2741;
  const sorte = () => { semente = (semente * 48271) % 2147483647; return semente / 2147483647; };
  const fase = 1.3;
  let rota = [], acao = null, ultima = null, ate = 0, inicio = 0, passo = 0, olhar = 0;
  let sentado = false, saida = null;   // saida: ponto de pé ao lado da cadeira
  let braco = 0;                        // mistura do braço que aponta (0 a 1)
  const est = { olhar: 0, travadoDesde: null, andou: 0 };
  let querDormir = false, dormindo = false, kCadeira = opc.cadeira ? 0 : 1;
  if (opc.cadeira) opc.cadeira.scale.setScalar(0.001);
  boneco.position.copy(pontos().cabeceira.pos);
  olhar = pontos().cabeceira.olhar;

  // ações e pesos: com missão em andamento ele vive no quadro e na prancheta;
  // sem missão, senta, toma café, folheia a estante e de vez em quando olha o quadro
  const ACOES = {
    apontar:   { lugar: 'fase',      dur: [3.5, 5.5], peso: [3.2, 0] },
    olhar:     { lugar: 'quadro',    dur: [2.5, 4.5], peso: [1.0, 0.9] },
    prancheta: { lugar: 'cabeceira', dur: [4, 7],     peso: [2.4, 1.0] },
    apoiar:    { lugar: 'apoio',     dur: [3, 5],     peso: [1.4, 0.4] },
    sentar:    { lugar: 'cadeira',   dur: [8, 14],    peso: [0.4, 3.0] },
    cafe:      { lugar: 'cafe',      dur: [4, 6],     peso: [0.5, 1.2] },
    estante:   { lugar: 'estante',   dur: [3.5, 6],   peso: [0.3, 1.0] },
  };

  function lugarDe(nome) {
    const p = pontos();
    if (nome === 'fase') {
      const a = quadro.alvoMundo();
      if (!a) return null;
      // fica um pouco à esquerda da fase e aponta com o braço do lado +x (o que a câmera vê)
      return { pos: new THREE.Vector3(Math.min(p.quadro.xMax, Math.max(p.quadro.xMin, a.x - 0.4)), 0, laneZ), olhar: Math.PI, mira: a };
    }
    return p[nome];
  }
  function escolher() {
    const ativa = quadro.temMissaoAtiva();
    const cands = Object.entries(ACOES).filter(([k, a]) => k !== ultima && (k !== 'apontar' || quadro.alvoMundo()));
    const pesos = cands.map(([, a]) => a.peso[ativa ? 0 : 1]);
    let r = sorte() * pesos.reduce((s, x) => s + x, 0);
    for (let i = 0; i < cands.length; i++) { r -= pesos[i]; if (r <= 0) return cands[i][0]; }
    return cands[cands.length - 1][0];
  }
  function irPara(nome) {
    const lugar = lugarDe(ACOES[nome].lugar);
    if (!lugar) return false;
    const p = boneco.position.clone();
    rota = [];
    if (sentado) { sentado = false; boneco.position.y = 0; if (saida) { rota.push(saida.clone()); p.copy(saida); } }
    const destino = lugar.entrada || lugar.pos;
    if (opc.rota) rota.push(...opc.rota(p.clone().setY(0), destino.clone()));
    else {
      const mesmaColuna = Math.abs(p.x - destino.x) < 0.05;
      if (!mesmaColuna && Math.abs(p.z - laneZ) > 0.05) rota.push(new THREE.Vector3(p.x, 0, laneZ));
      if (!mesmaColuna) rota.push(new THREE.Vector3(destino.x, 0, laneZ));
      rota.push(destino.clone());
    }
    if (lugar.entrada) rota.push(lugar.pos.clone());
    rota = rota.filter((q, i) => q.distanceTo(i ? rota[i - 1] : boneco.position) > 0.02);
    acao = { nome, lugar };
    ultima = nome;
    return true;
  }

  function atualizar(t, dt) {
    // cadeira: aparece quando ele vai sentar e some quando levanta
    if (opc.cadeira) {
      const quer = sentado || (acao?.nome === 'sentar' && rota.length <= 1) ? 1 : 0;
      if (Math.abs(quer - kCadeira) > 0.002) { kCadeira += (quer - kCadeira) * Math.min(1, dt * 7); opc.cadeira.scale.setScalar(Math.max(0.001, kCadeira)); }
    }
    // cochilo: sentado na cadeira, parado (a cena volta a 0 quadros por segundo)
    if (dormindo) {
      if (querDormir) return;
      dormindo = false; ate = t + 1.5;
    }
    if (querDormir && sentado && kCadeira > 0.98 && acao?.nome === 'sentar') {
      dormindo = true; ate = Infinity;
      boneco.userData.animar(t, 'descansar', true, { dt, fase });
      return;
    }
    if (querDormir && acao?.nome !== 'sentar' && !sentado && (!rota.length || acao?.nome !== 'sentar')) {
      if (irPara('sentar')) ate = Infinity;
    }
    const fazendo = acao && !rota.length && t < ate ? acao.nome : null;
    if (rota.length) {
      const alvo = rota[0];
      const d = new THREE.Vector3(alvo.x - boneco.position.x, 0, alvo.z - boneco.position.z);
      const dist = d.length();
      // corpo sólido: com o módulo na Estação, espera quem estiver no caminho
      const r = dist < 0.03 ? 'chegou' : passoNpc(boneco, alvo, VEL, dt, est, t);
      if (r === 'parado' && t - est.travadoDesde > 2.5) { rota = []; acao = null; est.travadoDesde = null; }
      else if (r === 'andou') { passo += est.andou / PASSADA * Math.PI; olhar = est.olhar; }
      else if (r === 'chegou') {
        rota.shift();
        if (!rota.length) {
          const [a, z] = ACOES[acao.nome].dur;
          inicio = t; ate = t + a + sorte() * (z - a);
          if (acao.nome === 'sentar') { sentado = true; saida = acao.lugar.entrada.clone(); boneco.position.y = Y_SENTADO; if (querDormir) ate = Infinity; }
        }
      }
      boneco.userData.animar(t, r === 'parado' ? 'parado' : 'andar', false, { dt, passo, fase });
    } else if (fazendo) {
      olhar = acao.lugar.olhar;
      const modo = { apoiar: 'digitar', sentar: 'descansar' }[fazendo] || 'parado';
      boneco.userData.animar(t, modo, fazendo === 'sentar', { dt, fase, atividade: fazendo === 'apontar' ? 'coordenar' : undefined });
    } else {
      // escolhe a próxima (a cada ação ele decide de novo, olhando o quadro do momento)
      let ok = false;
      marcarAndando(boneco, false);
      for (let i = 0; i < 4 && !ok; i++) ok = irPara(escolher());
      boneco.userData.animar(t, sentado ? 'descansar' : 'parado', sentado, { dt, fase });
    }

    // poses por cima da animação padrão: apontar, prancheta, café, mãos para trás
    const u = t - inicio;
    const k = 1 - Math.exp(-dt * 7);
    const querBraco = fazendo === 'apontar' && u < (ate - inicio) - 0.8 ? 1 : 0;
    braco += (querBraco - braco) * k;
    const [b0, b1] = c.bracos;
    if (b0 && braco > 0.001) {
      // de costas para a câmera, o braço do lado +x do mundo é o b0: ele mira a fase,
      // inclinado pela altura do alvo; a outra mão vai na cintura
      const mira = acao?.lugar?.mira;
      const ombro = 0.54 * ESCALA + 0.05;
      const elev = mira ? Math.atan2(mira.y - ombro, Math.max(0.3, Math.abs(boneco.position.z - mira.z))) : 0.6;
      const rx = -(Math.PI / 2 + Math.max(-0.2, Math.min(1.25, elev))) + Math.sin(t * 5) * 0.04;
      b0.rotation.x += (rx - b0.rotation.x) * braco;
      b0.rotation.z += (-0.32 - b0.rotation.z) * braco;
      if (b1) { b1.rotation.x += (0.2 - b1.rotation.x) * braco; b1.rotation.z += (0.45 - b1.rotation.z) * braco; }
      if (c.cabeca) c.cabeca.rotation.x += (-0.28 - c.cabeca.rotation.x) * braco;
    }
    if (fazendo === 'prancheta' && b0 && b1) {
      b0.rotation.x = -1.05; b0.rotation.z = 0.25;
      b1.rotation.x = -1.0 + Math.sin(t * 9) * 0.05; b1.rotation.z = -0.25 + Math.sin(t * 3.1) * 0.04;
      if (c.cabeca) { c.cabeca.rotation.x = 0.34 + Math.sin(u * 0.8) * 0.04; c.cabeca.rotation.y = Math.sin(u * 0.45) * 0.08; }
    }
    if ((fazendo === 'olhar' || fazendo === 'estante') && b0 && b1) {
      // mãos para trás, cabeça erguida varrendo devagar
      b0.rotation.x = b1.rotation.x = 0.45;
      b0.rotation.z = -0.3; b1.rotation.z = 0.3;
      if (c.cabeca) { c.cabeca.rotation.x = fazendo === 'olhar' ? -0.2 : 0.05; c.cabeca.rotation.y = Math.sin(u * 0.55 + fase) * 0.3; }
    }
    if (fazendo === 'cafe' && b0) {
      const ciclo = (u + 0.8) % 2.8, gole = ciclo < 0.9 ? Math.sin(Math.PI * ciclo / 0.9) : 0;
      b0.rotation.x = -0.95 - gole * 1.3; b0.rotation.z = -0.3 - gole * 0.1;
      if (c.cabeca) c.cabeca.rotation.x = -0.18 * gole + 0.05;
    }
    c.prancheta.visible = fazendo === 'prancheta';
    caneca.visible = fazendo === 'cafe';

    const dif = ((olhar - boneco.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    boneco.rotation.y += dif * Math.min(1, dt * 8);
  }

  // caneca na mão direita do café
  const caneca = new THREE.Group();
  cilindro(0.045, 0.04, 0.09, 0xf1ede6, 0, 0, 0, caneca, 14);
  caneca.position.set(0, -0.27, 0.05);
  caneca.visible = false;
  c.bracos[0]?.add(caneca);

  return {
    boneco, atualizar,
    cochilar(sim) { querDormir = !!sim; if (!sim && sentado && ate === Infinity) ate = 0; },
    dormindo: () => dormindo,
    estado: () => ({ acao: acao?.nome ?? null, andando: rota.length > 0, sentado, x: +boneco.position.x.toFixed(2), z: +boneco.position.z.toFixed(2) }),
    liberar: c.liberar,
  };
}

// ---------------------------------------------------------------------------
// Sala inteira (vitrine e, depois, módulo da Estação)
// ---------------------------------------------------------------------------
export function montarSalaMissao({ largura = 7.6, profundidade = 5.0, altParede = 2.7 } = {}) {
  const sala = new THREE.Group();
  const X0 = -largura / 2, ZF = -profundidade / 2;
  piso(largura, profundidade, C.piso, 0, 0, sala);
  caixa(largura + 0.12, altParede, 0.12, C.parede, 0, 0, ZF - 0.06, sala);
  caixa(0.12, altParede, profundidade, C.parede, X0 - 0.06, 0, 0, sala);
  // faixa navy baixa nas paredes (rodapé alto), detalhe de identidade
  caixa(largura, 0.1, 0.02, COR.navy, 0, 0, ZF + 0.01, sala, { sombra: false, seg: 0 });
  caixa(0.02, 0.1, profundidade, COR.navy, X0 + 0.01, 0, 0, sala, { sombra: false, seg: 0 });

  // quadro da missão na parede do fundo
  const quadro = criarQuadroMissao({ largura: 3.8, altura: 1.9 });
  const QX = -0.55, QY = 0.62 + 1.9 / 2;
  quadro.grupo.position.set(QX, QY, ZF + 0.02);
  sala.add(quadro.grupo);

  // mesa de reunião: tampo comprido, dois pés de painel, 5 banquetas e a cabeceira
  const TX = -0.55, TZ = 0.55, TL = 2.6, TP = 1.15, TA = 0.74;
  const mesa = new THREE.Group();
  mesa.position.set(TX, 0, TZ);
  sala.add(mesa);
  caixa(TL, 0.06, TP, C.tampo, 0, TA - 0.06, 0, mesa, { seg: 3 });
  for (const lx of [-TL / 2 + 0.35, TL / 2 - 0.35]) caixa(0.08, TA - 0.06, TP - 0.3, C.pe, lx, 0, 0, mesa);
  caixa(TL - 0.8, 0.06, 0.06, C.pe, 0, 0.18, 0, mesa, { seg: 0 });
  // em cima: papéis, um mapa aberto, duas canecas e uma suculenta
  for (const [x, z, r] of [[-0.75, -0.18, 0.12], [-0.55, 0.2, -0.2], [0.55, -0.15, 0.3]]) {
    const p = caixa(0.24, 0.006, 0.32, 0xf4f1ea, x, TA, z, mesa, { seg: 0, sombra: false });
    p.rotation.y = r;
  }
  caixa(0.62, 0.006, 0.42, 0xdfe6f2, 0.05, TA, 0.05, mesa, { seg: 0, sombra: false });
  caixa(0.46, 0.007, 0.012, COR.azul, 0.03, TA, -0.02, mesa, { seg: 0, sombra: false }).rotation.y = 0.5;
  caixa(0.3, 0.007, 0.012, COR.laranja, 0.12, TA, 0.1, mesa, { seg: 0, sombra: false }).rotation.y = -0.7;
  caneca(mesa, -0.2, TA, 0.32, 0xf1ede6);
  caneca(mesa, 0.85, TA, 0.25, 0xc98b6b);
  planta(-1.05, 0.25, 1.4, COR.offWhite, 'suculenta', mesa, TA);
  // banquetas: 2 no fundo (o meio-direito fica livre para ele se apoiar), 3 na frente, a cabeceira dele
  const CZ = TP / 2 + 0.38;
  for (const lx of [-0.85, 0]) cadeira(mesa, lx, -CZ, 0);
  for (const lx of [-0.85, 0, 0.85]) cadeira(mesa, lx, CZ, Math.PI);
  const CAB_X = TL / 2 + 0.55;
  cadeira(mesa, CAB_X, 0, Math.PI / 2, 0xc9d3e6);
  tapete(TX, TZ, TL + 1.5, TP + 1.9, C.tapete, sala);
  for (const dx of [-0.65, 0.65]) pendente(TX + dx, TZ, altParede, sala, { poca: { x: TX + dx, z: TZ, w: 1.5, d: 1.5 } }).definirNivel(1, { instantaneo: true });

  // canto do café (fundo, à direita) com relógio em cima, estante na parede da esquerda, plantas
  const CAFE_X = largura / 2 - 0.85;
  aparador(CAFE_X, ZF + 0.26, 0, 1.1, sala);
  cilindro(0.06, 0.06, 0.24, COR.grafite, CAFE_X + 0.3, 0.62, ZF + 0.26, sala, 14);   // garrafa térmica
  caneca(sala, CAFE_X + 0.1, 0.62, ZF + 0.3, 0x9fb59a);
  relogioParede(CAFE_X, 1.95, ZF + 0.01, 0.2, sala);
  estante(X0 + 0.22, -0.35, Math.PI / 2, 1.6, {}, sala);
  planta(X0 + 0.45, ZF + 0.45, 1.0, COR.offWhite, 'folhaLarga', sala);
  planta(X0 + 0.5, -ZF - 0.5, 0.95, COR.terracota, 'ficus', sala);
  planta(largura / 2 - 0.4, -ZF - 0.45, 0.9, COR.offWhite, 'folhaLarga', sala);

  // lugares do coordenador
  const laneZ = ZF + 0.85;
  const meiaLarg = 3.8 / 2;
  const PONTOS = {
    quadro: { pos: new THREE.Vector3(QX + 0.3, 0, laneZ + 0.15), olhar: Math.PI, xMin: QX - meiaLarg + 0.5, xMax: QX + meiaLarg + 0.2 },
    // na cabeceira ele fica de perfil para a câmera, para a prancheta aparecer
    cabeceira: { pos: new THREE.Vector3(TX + CAB_X + 0.55, 0, TZ), olhar: -Math.PI / 4 },
    cadeira: { pos: new THREE.Vector3(TX + CAB_X, 0, TZ), entrada: new THREE.Vector3(TX + CAB_X + 0.55, 0, TZ), olhar: -Math.PI / 2 },
    apoio: { pos: new THREE.Vector3(TX + 0.85, 0, TZ - TP / 2 - 0.36), olhar: 0 },
    cafe: { pos: new THREE.Vector3(CAFE_X, 0, laneZ), olhar: Math.PI },
    estante: { pos: new THREE.Vector3(X0 + 0.95, 0, -0.35), olhar: -Math.PI / 2 },
  };
  const quadroParaRotina = {
    temMissaoAtiva: quadro.temMissaoAtiva,
    alvoMundo() {
      const a = quadro.alvoFase();
      if (!a) return null;
      // em coordenadas da sala (a rotina vive dentro do grupo da sala)
      return a.add(quadro.grupo.position);
    },
  };
  const coordenador = rotinaDoCoordenador(() => PONTOS, quadroParaRotina, laneZ);
  sala.add(coordenador.boneco);

  let anterior = null, ultimaChecagem = -1;
  function atualizar(dados) {
    if (!dados) return;
    quadro.atualizar(dados, Date.now(), anterior ?? 0);
  }
  function animar(tempo) {
    const dt = anterior == null ? 1 / 60 : Math.min(0.1, Math.max(0, tempo - anterior));
    anterior = tempo;
    // o "há X min" e o revezamento das abas: confere uma vez por segundo
    if (tempo - ultimaChecagem >= 1) { ultimaChecagem = tempo; quadro.atualizar(null, Date.now(), tempo); }
    quadro.animar(tempo);
    coordenador.atualizar(tempo, dt);
  }
  return {
    grupo: sala, atualizar, animar, largura, profundidade, altParede, quadro, coordenador,
    liberar() { quadro.liberar(); coordenador.liberar(); },
  };
}

// ---------------------------------------------------------------------------
// Módulo da Estação (F1-SALAS-E-VIDA, 03/10): a Sala de missão numa vaga de 4,6 x 6,8
// ---------------------------------------------------------------------------
// Acopla no norte quando há workflow em andamento e fica reservada uns 3 min depois
// (estacao.js). Coordenadas locais: x de -2,3 a 2,3; z de -3,4 (parede alta do fundo)
// a 3,4 (divisória do corredor). Sem piso nem paredes (a casca vem de layout.js) e sem
// porta: só o coordenador vive aqui. Tudo alinhado às paredes (giros de 90 graus).
// - quadro da missão na parede do fundo, canto do café à direita dele;
// - mesa de reunião comprida no sentido da profundidade, sem banquetas vazias: a
//   cadeira da cabeceira (a do coordenador, virada para o quadro) só aparece quando
//   ele senta; aparador baixo com livros encostado na divisória da esquerda;
// - cochilo: senta na cabeceira e para.
export function montarModuloMissao() {
  const sala = new THREE.Group();
  sala.name = 'modulo-missao';
  const XE = -2.3, ZF = -3.4, ALT = 2.8;
  // no módulo a casca já põe um rodapé em ZF..ZF+0,02: este fica na frente dele (coincidiam e piscavam)
  caixa(4.6, 0.1, 0.02, COR.navy, 0, 0, ZF + 0.035, sala, { sombra: false, seg: 0 });

  // quadro da missão na parede do fundo
  const QL = 3.5, QA = 1.75;
  const quadro = criarQuadroMissao({ largura: QL, altura: QA });
  const QX = -2.18 + QL / 2, QY = 0.62 + QA / 2;
  quadro.grupo.position.set(QX, QY, ZF + 0.02);
  sala.add(quadro.grupo);

  // mesa de reunião girada 90 graus: o comprimento vai do fundo para a frente
  const TX = -0.35, TZ = 0.0, TL = 2.6, TP = 1.15, TA = 0.74;
  const mesa = new THREE.Group();
  mesa.position.set(TX, 0, TZ);
  mesa.rotation.y = -Math.PI / 2;   // x local da mesa -> +z do mundo (cabeceira na frente)
  sala.add(mesa);
  caixa(TL, 0.06, TP, C.tampo, 0, TA - 0.06, 0, mesa, { seg: 3 });
  for (const lx of [-TL / 2 + 0.35, TL / 2 - 0.35]) caixa(0.08, TA - 0.06, TP - 0.3, C.pe, lx, 0, 0, mesa);
  caixa(TL - 0.8, 0.06, 0.06, C.pe, 0, 0.18, 0, mesa, { seg: 0 });
  for (const [x, z] of [[-0.75, -0.18], [-0.55, 0.2], [0.55, -0.15]]) caixa(0.24, 0.006, 0.32, 0xf4f1ea, x, TA, z, mesa, { seg: 0, sombra: false });
  caixa(0.62, 0.006, 0.42, 0xdfe6f2, 0.05, TA, 0.05, mesa, { seg: 0, sombra: false });
  caixa(0.46, 0.007, 0.012, COR.azul, 0.03, TA, -0.02, mesa, { seg: 0, sombra: false });
  caixa(0.3, 0.007, 0.012, COR.laranja, 0.12, TA, 0.1, mesa, { seg: 0, sombra: false });
  caneca(mesa, -0.2, TA, 0.32, 0xf1ede6);
  caneca(mesa, 0.85, TA, 0.25, 0xc98b6b);
  planta(-1.05, 0.25, 1.4, COR.offWhite, 'suculenta', mesa, TA);
  const CAB = TL / 2 + 0.55;
  const cadeiraCab = cadeira(mesa, CAB, 0, Math.PI / 2, 0xc9d3e6);
  tapete(TX, TZ + 0.2, TP + 1.7, TL + 1.4, C.tapete, sala);
  for (const dz of [-0.65, 0.65]) pendente(TX, TZ + dz, ALT, sala, { poca: { x: TX, z: TZ + dz, w: 1.5, d: 1.5 } }).definirNivel(1, { instantaneo: true });

  // café à direita do quadro e aparador de livros na divisória da esquerda
  const CAFE_X = 1.78;
  aparador(CAFE_X, ZF + 0.26, 0, 0.8, sala);
  cilindro(0.06, 0.06, 0.24, COR.grafite, CAFE_X + 0.2, 0.62, ZF + 0.26, sala, 14);
  caneca(sala, CAFE_X - 0.05, 0.62, ZF + 0.3, 0x9fb59a);
  relogioParede(CAFE_X, 1.95, ZF + 0.01, 0.18, sala);
  const ZA = 1.75;
  aparador(XE + 0.3, ZA, Math.PI / 2, 1.3, sala);
  planta(XE + 0.45, 3.0, 0.95, COR.terracota, 'ficus', sala);
  planta(-0.5, 2.95, 0.9, COR.offWhite, 'folhaLarga', sala);   // fora do vão da porta (x 0,55 a 2,15)
  planta(1.95, 0.9, 0.85, COR.pretoFosco, 'folhaLarga', sala);

  // lugares do coordenador (no espaço da sala)
  const laneZ = ZF + 0.85;
  const V = (x, z) => new THREE.Vector3(x, 0, z);
  const zCab = TZ + CAB;   // cadeira da cabeceira (no mundo: a mesa gira -90 graus)
  const PONTOS = {
    quadro: { pos: V(QX + 0.3, laneZ + 0.15), olhar: Math.PI, xMin: QX - QL / 2 + 0.5, xMax: QX + QL / 2 - 0.2 },
    cabeceira: { pos: V(TX + 0.85, zCab), olhar: Math.PI / 2 },
    cadeira: { pos: V(TX, zCab), entrada: V(TX, zCab + 0.55), olhar: Math.PI },
    apoio: { pos: V(TX + TP / 2 + 0.36, TZ - 0.4), olhar: -Math.PI / 2 },
    cafe: { pos: V(CAFE_X, laneZ), olhar: Math.PI },
    estante: { pos: V(XE + 0.95, ZA), olhar: -Math.PI / 2 },
  };
  const obst = [
    { x: TX, z: TZ, hx: TP / 2 + 0.02, hz: TL / 2 + 0.02 },
    { x: CAFE_X, z: ZF + 0.26, hx: 0.42, hz: 0.22 },
    { x: XE + 0.3, z: ZA, hx: 0.22, hz: 0.67 },
    { x: XE + 0.45, z: 3.0, hx: 0.25, hz: 0.25 }, { x: 1.95, z: 2.95, hx: 0.25, hz: 0.25 }, { x: 1.95, z: 0.9, hx: 0.25, hz: 0.25 },
  ];
  const rota = criarRoteador(obst, { x0: XE + 0.4, x1: 1.95, z0: ZF + 0.45, z1: 3.0 });
  const quadroParaRotina = {
    temMissaoAtiva: quadro.temMissaoAtiva,
    alvoMundo() { const a = quadro.alvoFase(); return a ? a.add(quadro.grupo.position) : null; },
  };
  const coordenador = rotinaDoCoordenador(() => PONTOS, quadroParaRotina, laneZ, { rota, cadeira: cadeiraCab });
  sala.add(coordenador.boneco);
  const corpo = registrarNpc(coordenador.boneco, { sala: 'missao' });

  let anterior = null, ultimaChecagem = -1;
  function atualizar(dados) { if (dados) quadro.atualizar(dados, Date.now(), anterior ?? 0); }
  function animar(tempo) {
    const dt = anterior == null ? 1 / 60 : Math.min(0.1, Math.max(0, tempo - anterior));
    anterior = tempo;
    if (tempo - ultimaChecagem >= 1) { ultimaChecagem = tempo; quadro.atualizar(null, Date.now(), tempo); }
    quadro.animar(tempo);
    coordenador.atualizar(tempo, dt);
  }
  return {
    grupo: sala, atualizar, animar, npcs: [coordenador.boneco],
    cochilar: sim => coordenador.cochilar(sim), dormindo: () => coordenador.dormindo(),
    liberar() { removerNpc(corpo); quadro.liberar(); coordenador.liberar(); },
  };
}

// ---------------------------------------------------------------------------
// Dados de exemplo (vitrine: ?exemplo=varias | concluida | vazia)
// ---------------------------------------------------------------------------
export function dadosExemplo(tipo = 'varias', agora = Date.now()) {
  const fase = (titulo, detalhe, estado, rodando = 0, concluidos = 0, rotulos = [], volta = false) =>
    ({ titulo, detalhe, estado, volta, agentes: { rodando, concluidos, parados: 0, rotulos } });
  const a = {
    id: 'wf_exemplo-1', nome: 'reforma-a-estacao', descricao: 'Implementa a reforma de A Estação em rodadas: pacotes do plano em paralelo por rodada, integrador com teste no navegador a cada rodada',
    sessao: 'exemplo', projeto: 'Claude', pasta: '~/Claude', inicio: agora - 72 * 60000, fim: null, ativa: true, situacao: 'andamento', faseAtual: 'Rodada 3',
    agentes: { total: 12, rodando: 3, concluidos: 9 },
    fases: [
      fase('Rodada 1', 'base: módulos, servidor, personagens, interface', 'feita', 0, 4),
      fase('Rodada 2', 'ganho psicológico imediato', 'feita', 0, 5),
      fase('Rodada 3', 'estação elástica', 'rodando', 3, 0, ['R3-ESTACAO', 'R3-MAPA', 'R3-CAMERA']),
      fase('Rodada 4', 'verificação integrada', 'falta'),
      fase('Integração', 'um integrador por rodada testa no navegador e corrige', 'feita', 0, 2, [], true),
    ],
  };
  const b = {
    id: 'wf_exemplo-2', nome: 'auditoria-do-site', descricao: 'Audita o site em 6 dimensões e verifica cada achado com um cético por dimensão',
    sessao: 'exemplo', projeto: 'site', pasta: '~/site', inicio: agora - 9 * 60000, fim: null, ativa: true, situacao: 'andamento', faseAtual: 'Auditoria',
    agentes: { total: 6, rodando: 6, concluidos: 0 },
    fases: [fase('Auditoria', '6 especialistas', 'rodando', 6, 0, ['auditoria:SEO', 'auditoria:VIS']), fase('Verificação', 'um cético por dimensão', 'falta'), fase('Plano', 'síntese', 'falta')],
  };
  const c = { ...b, id: 'wf_exemplo-3', ativa: false, situacao: 'concluida', fim: agora - 25 * 60000, inicio: agora - 61 * 60000, faseAtual: null,
    agentes: { total: 13, rodando: 0, concluidos: 13 },
    fases: [fase('Auditoria', '6 especialistas', 'feita', 0, 6), fase('Verificação', 'um cético por dimensão', 'feita', 0, 6), fase('Plano', 'síntese', 'feita', 0, 1)] };
  const missoes = { varias: [a, b, c], uma: [a, c], concluida: [c], vazia: [] }[tipo] || [a, b, c];
  return { geradoEm: agora, missoes };
}
