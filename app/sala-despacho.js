// Despacho de tarefas agendadas: uma sala de partidas aconchegante. Na parede, o
// quadro de horários (estilo painel de estação, com letras que viram) lista as
// rotinas do Claude e do Codex: nome, agência, quando roda, próxima e última
// execução. Um balcão de despacho, uma prateleira de maletas e um astronauta
// despachante que vive ali (confere o quadro, carimba papéis, arruma maletas).
// Quando uma rotina começa a rodar, ele faz a cerimônia de saída: confere o
// quadro, carimba no balcão e um viajante pega a maleta e sai pela porta.
// Só informativo. Dados de /api/despacho (app/fonte-despacho.js).
//
// Uso: const sala = montarSalaDespacho(); cena.add(sala.grupo);
//      sala.atualizar(dados)  (a cada leitura)   sala.animar(t)  (a cada quadro, t em segundos)

import * as THREE from 'three';
import { caixa, cilindro, piso, planta, tapete, luminariaMesa, relogioParede, COR } from './pecas.js';
import { criarAstronauta, definirProvedor } from './personagens.js';
import { registrarNpc, removerNpc, passoLivre, marcarAndando, criarCochilo } from './sala-corpos.js';

const FONTE = 'Figtree, -apple-system, "Helvetica Neue", sans-serif';
const FUSO = 'America/Sao_Paulo';
const AGENCIAS = {
  claude: { nome: 'Claude', css: '#d47a5a', cor: 0xd47a5a, provedor: 'anthropic' },
  codex: { nome: 'Codex', css: '#4f9d7c', cor: 0x4f9d7c, provedor: 'openai' },
};
const C = {
  parede: 0xeee6da, rodapeParede: 0xd9cdbb, piso: 0xd6b083, madeira: 0xb98552, madeiraEscura: 0x8a5a3a,
  tampo: 0xd8b48c, corredor: 0xf3dfbf, tapete: 0x9db3d9,
};
const ESCALA = 1.45;

// ---------------------------------------------------------------------------
// Relógio de Brasília e textos relativos (mesmas regras de fonte-despacho.js)
// ---------------------------------------------------------------------------
const fmtParede = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
function parede(ms) {
  const p = {};
  for (const { type, value } of fmtParede.formatToParts(new Date(ms))) p[type] = value;
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour % 24, min: +p.minute };
}
const dois = n => String(n).padStart(2, '0');
const hhmm = p => `${dois(p.hora)}:${dois(p.min)}`;
const diaAbs = p => Math.floor(Date.UTC(p.ano, p.mes - 1, p.dia) / 86_400_000);
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaSemana = p => new Date(Date.UTC(p.ano, p.mes - 1, p.dia)).getUTCDay();

export function textoFuturo(ms, agora = Date.now()) {
  if (ms == null) return null;
  const dif = ms - agora;
  if (dif < 60_000) return 'agora';
  const min = Math.round(dif / 60_000);
  if (min < 60) return `em ${min} min`;
  if (dif < 12 * 3_600_000) { const h = Math.floor(min / 60), m = min % 60; return m ? `em ${h} h ${m} min` : `em ${h} h`; }
  const p = parede(ms), dias = diaAbs(p) - diaAbs(parede(agora));
  if (dias === 0) return `hoje ${hhmm(p)}`;
  if (dias === 1) return `amanhã ${hhmm(p)}`;
  if (dias < 7) return `${DIAS_CURTOS[diaSemana(p)]} ${hhmm(p)}`;
  return `${dois(p.dia)}/${dois(p.mes)} ${hhmm(p)}`;
}
export function textoPassado(ms, agora = Date.now()) {
  if (ms == null) return null;
  const dif = agora - ms;
  if (dif < 60_000) return 'agora há pouco';
  if (dif < 3_600_000) return `há ${Math.round(dif / 60_000)} min`;
  const p = parede(ms), dias = diaAbs(parede(agora)) - diaAbs(p);
  if (dias === 0) return `hoje ${hhmm(p)}`;
  if (dias === 1) return `ontem ${hhmm(p)}`;
  if (dias < 7) return `${DIAS_CURTOS[diaSemana(p)]} ${hhmm(p)}`;
  return `${dois(p.dia)}/${dois(p.mes)} ${hhmm(p)}`;
}
const maiuscula = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

function sorteador(semente) {
  let s = semente % 2147483647 || 1;
  return () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
}

function encaixar(g, texto, maxLarg, tam, peso = 800, minimo = 18) {
  do { g.font = `${peso} ${tam}px ${FONTE}`; tam -= 1; } while (g.measureText(texto).width > maxLarg && tam > minimo);
  if (g.measureText(texto).width > maxLarg) {
    let t = texto;
    while (t.length > 1 && g.measureText(t + '…').width > maxLarg) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  }
  return texto;
}
function retArred(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ---------------------------------------------------------------------------
// Quadro de horários (canvas), com letras que viram quando o valor muda
// ---------------------------------------------------------------------------
const QW = 2048, QH = 851, LINHAS = 6, Y0 = 214, ALT_LINHA = 88, PASSO_LINHA = 96;
const COLUNAS = [
  { id: 'nome', rotulo: 'ROTINA', x: 44, w: 694 },
  { id: 'agencia', rotulo: 'AGÊNCIA', x: 752, w: 184 },
  { id: 'quando', rotulo: 'QUANDO RODA', x: 950, w: 474 },
  { id: 'proxima', rotulo: 'PRÓXIMA', x: 1438, w: 272 },
  { id: 'ultima', rotulo: 'ÚLTIMA', x: 1724, w: 280 },
];
const GIRO = 0.42;   // segundos de uma plaqueta virando

export function criarQuadroHorarios({ largura = 3.9, altura = 1.62 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = QW; canvas.height = QH;
  const g = canvas.getContext('2d');
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: textura, emissive: 0xffffff, emissiveMap: textura, emissiveIntensity: 0.7, roughness: 0.4 });
  const grupo = new THREE.Group();
  // moldura de madeira, faixa de luz quente em cima
  caixa(largura + 0.16, altura + 0.16, 0.07, C.madeiraEscura, 0, -0.08, -0.035, grupo);
  caixa(largura + 0.24, 0.05, 0.16, C.madeira, 0, altura + 0.08, 0.0, grupo);
  caixa(largura - 0.2, 0.018, 0.02, 0xffe2b0, 0, altura + 0.06, 0.07, grupo, { sombra: false, mat: { emissive: 0xffd9a0, emissiveIntensity: 0.9 } });
  const plano = new THREE.Mesh(new THREE.PlaneGeometry(largura, altura), material);
  plano.position.set(0, altura / 2, 0.006);
  grupo.add(plano);
  // destaque das linhas que estão rodando: faixa laranja translúcida que pulsa
  const destaques = [];
  const matDestaque = new THREE.MeshBasicMaterial({ color: 0xee4c01, transparent: true, opacity: 0.25, depthWrite: false });
  for (let i = 0; i < LINHAS; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(largura * (QW - 76) / QW, altura * (ALT_LINHA + 6) / QH), matDestaque);
    m.position.set(0, altura * (1 - (Y0 + i * PASSO_LINHA + ALT_LINHA / 2) / QH), 0.012);
    m.visible = false;
    m.renderOrder = 2;
    grupo.add(m);
    destaques.push(m);
  }

  let rotinas = [], pagina = 0, trocouPaginaEm = 0, sujo = true, ultimoMinuto = '', ultimoRelativo = 0;
  const partindo = new Map();   // id -> instante em que o horário chegou (antes de o dado confirmar)
  const celulas = new Map();    // "linha:coluna" -> { assinatura, anterior, desenho, desenhoAnterior, inicio }
  let girando = false;
  if (typeof document !== 'undefined' && document.fonts?.ready) document.fonts.ready.then(() => { sujo = true; });

  function paginas() { return Math.max(1, Math.ceil(rotinas.length / LINHAS)); }
  function situacao(r, agora) {
    if (r.rodandoAgora) return 'rodando';
    if (partindo.has(r.id)) return 'partindo';
    return r.estado;
  }

  // ---- conteúdo de cada célula (desenho relativo ao retângulo da plaqueta) ----
  function conteudo(r, col, agora) {
    const st = situacao(r, agora);
    const apagado = st === 'pausada' || st === 'manual' || st === 'concluida';
    switch (col.id) {
      case 'nome': {
        const cor = st === 'rodando' || st === 'partindo' ? '#ee4c01' : st === 'ativa' ? '#5fd08f' : '#8a90b8';
        return {
          assinatura: `${r.nome}|${st}`,
          desenhar(x, y, w, h) {
            g.beginPath(); g.arc(x + 30, y + h / 2, 11, 0, Math.PI * 2);
            if (st === 'manual') { g.lineWidth = 4; g.strokeStyle = cor; g.stroke(); } else { g.fillStyle = cor; g.fill(); }
            g.fillStyle = apagado ? 'rgba(255,255,255,0.72)' : '#ffffff';
            g.textAlign = 'left';
            g.fillText(encaixar(g, r.nome, w - 74, 38, 800, 22), x + 56, y + h / 2 + 2);
          },
        };
      }
      case 'agencia': {
        const a = AGENCIAS[r.agencia] || { nome: r.agencia, css: '#7c84a8' };
        return {
          assinatura: a.nome,
          desenhar(x, y, w, h) {
            g.fillStyle = a.css;
            retArred(g, x + 14, y + 18, w - 28, h - 36, (h - 36) / 2); g.fill();
            g.fillStyle = '#ffffff'; g.textAlign = 'center';
            g.font = `800 30px ${FONTE}`;
            g.fillText(a.nome, x + w / 2, y + h / 2 + 2);
          },
        };
      }
      case 'quando': {
        const t = maiuscula(r.descricaoHorario || '');
        return {
          assinatura: t,
          desenhar(x, y, w, h) {
            g.fillStyle = apagado ? 'rgba(255,255,255,0.66)' : 'rgba(255,255,255,0.9)';
            g.textAlign = 'left';
            g.fillText(encaixar(g, t, w - 36, 32, 700, 20), x + 18, y + h / 2 + 2);
          },
        };
      }
      case 'proxima': {
        let t, cor = '#ffffff', peso = 800;
        if (st === 'rodando') { t = 'rodando agora'; cor = '#ff7a3d'; }
        else if (st === 'partindo') { t = 'partindo'; cor = '#ff7a3d'; }
        else if (st === 'ativa') t = r.proxima ? textoFuturo(r.proxima.ms, agora) : 'sem previsão';
        else if (st === 'pausada') { t = 'pausada'; cor = 'rgba(255,255,255,0.55)'; peso = 700; }
        else if (st === 'concluida') { t = 'concluída'; cor = 'rgba(255,255,255,0.55)'; peso = 700; }
        else { t = 'na mão'; cor = 'rgba(255,255,255,0.55)'; peso = 700; }
        return {
          assinatura: t,
          desenhar(x, y, w, h) {
            g.fillStyle = cor; g.textAlign = 'left';
            g.fillText(encaixar(g, t, w - 36, 34, peso, 20), x + 18, y + h / 2 + 2);
          },
        };
      }
      case 'ultima': {
        const u = r.ultima;
        const t = u ? textoPassado(u.ms, agora) : 'sem registro';
        const ok = u ? u.ok : undefined;
        return {
          assinatura: `${t}|${ok}`,
          desenhar(x, y, w, h) {
            const cy = y + h / 2;
            let tx = x + 18;
            if (u) {
              const cx = x + 34;
              g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
              if (ok === true) {
                g.fillStyle = 'rgba(95,208,143,0.22)'; g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();
                g.strokeStyle = '#5fd08f'; g.beginPath(); g.moveTo(cx - 8, cy + 1); g.lineTo(cx - 2, cy + 7); g.lineTo(cx + 9, cy - 7); g.stroke();
              } else if (ok === false) {
                g.fillStyle = 'rgba(208,122,106,0.25)'; g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();
                g.strokeStyle = '#e09a8c'; g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx, cy + 2); g.stroke();
                g.fillStyle = '#e09a8c'; g.beginPath(); g.arc(cx, cy + 8, 3, 0, Math.PI * 2); g.fill();
              } else {
                g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(cx, cy, 7, 0, Math.PI * 2); g.fill();
              }
              tx = x + 60;
            }
            g.fillStyle = u ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.5)';
            g.textAlign = 'left';
            g.fillText(encaixar(g, t, x + w - tx - 12, u ? 30 : 28, 700, 18), tx, cy + 2);
          },
        };
      }
    }
    return { assinatura: '', desenhar() {} };
  }

  function plaqueta(x, y, w, h) {
    g.fillStyle = '#141c66';
    retArred(g, x, y, w, h, 10); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.035)';
    retArred(g, x, y, w, h / 2, 10); g.fill();
  }
  function emenda(x, y, w, h) {
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.fillRect(x + 2, y + h / 2 - 1.5, w - 4, 3);
  }

  function desenharCelula(chave, x, y, w, h, novo, t) {
    let c = celulas.get(chave);
    if (!c) { c = { assinatura: novo.assinatura, desenho: novo.desenhar, inicio: -1 }; celulas.set(chave, c); }
    else if (c.assinatura !== novo.assinatura) {
      c.desenhoAnterior = c.desenho; c.anterior = c.assinatura;
      c.assinatura = novo.assinatura; c.desenho = novo.desenhar; c.inicio = t;
    } else c.desenho = novo.desenhar;
    plaqueta(x, y, w, h);
    const p = c.inicio < 0 ? 1 : (t - c.inicio) / GIRO;
    g.save();
    retArred(g, x, y, w, h, 10); g.clip();
    g.textBaseline = 'middle';
    if (p >= 1) c.desenho(x, y, w, h);
    else {
      girando = true;
      const desenho = p < 0.5 ? c.desenhoAnterior : c.desenho;
      const s = Math.max(0.02, Math.abs(Math.cos(p * Math.PI)));
      g.translate(0, y + h / 2); g.scale(1, s); g.translate(0, -(y + h / 2));
      desenho?.(x, y, w, h);
    }
    g.restore();
    emenda(x, y, w, h);
  }

  function desenhar(t) {
    const agora = Date.now();
    girando = false;
    const fundo = g.createLinearGradient(0, 0, 0, QH);
    fundo.addColorStop(0, '#0d1458'); fundo.addColorStop(1, '#070b3a');
    g.fillStyle = fundo; g.fillRect(0, 0, QW, QH);
    // cabeçalho
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = '#ffffff'; g.font = `800 72px ${FONTE}`;
    g.fillText('Despacho', 48, 92);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = `600 30px ${FONTE}`;
    g.fillText('rotinas programadas do Claude e do Codex', 48, 134);
    const relogio = hhmm(parede(agora));
    g.textAlign = 'right';
    g.fillStyle = '#ffffff'; g.font = `800 76px ${FONTE}`;
    g.fillText(relogio, QW - 48, 92);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = `600 26px ${FONTE}`;
    g.fillText('horário de Brasília', QW - 48, 132);
    // legenda
    let lx = 1080;
    const legenda = [['#5fd08f', 'ativa', 'cheio'], ['#8a90b8', 'pausada', 'cheio'], ['#8a90b8', 'na mão', 'anel'], ['#ee4c01', 'rodando', 'cheio']];
    g.font = `700 26px ${FONTE}`; g.textAlign = 'left';
    for (const [cor, rot, tipo] of legenda) {
      g.beginPath(); g.arc(lx + 9, 112, 9, 0, Math.PI * 2);
      if (tipo === 'anel') { g.lineWidth = 3.5; g.strokeStyle = cor; g.stroke(); } else { g.fillStyle = cor; g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillText(rot, lx + 26, 121);
      lx += 46 + g.measureText(rot).width + 24;
    }
    // filete laranja
    g.fillStyle = '#ee4c01'; g.fillRect(48, 156, QW - 96, 4);
    // rótulos das colunas
    g.font = `800 22px ${FONTE}`; g.fillStyle = 'rgba(255,255,255,0.5)';
    for (const col of COLUNAS) g.fillText(col.rotulo.split('').join(' '), col.x + (col.id === 'nome' ? 56 : 18), 198);
    // linhas
    const visiveis = rotinas.slice(pagina * LINHAS, pagina * LINHAS + LINHAS);
    for (let i = 0; i < LINHAS; i++) {
      const y = Y0 + i * PASSO_LINHA;
      const r = visiveis[i];
      destaques[i].visible = !!r && (r.rodandoAgora || partindo.has(r.id));
      for (const col of COLUNAS) {
        const chave = `${i}:${col.id}`;
        if (r) desenharCelula(chave, col.x, y, col.w, ALT_LINHA, conteudo(r, col, agora), t);
        else desenharCelula(chave, col.x, y, col.w, ALT_LINHA, { assinatura: '', desenhar() {} }, t);
      }
    }
    if (!rotinas.length) {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = `800 44px ${FONTE}`;
      g.fillText('Nenhuma rotina programada', QW / 2, Y0 + PASSO_LINHA * 2.4);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = `600 28px ${FONTE}`;
      g.fillText('as rotinas do Claude e do Codex aparecem aqui', QW / 2, Y0 + PASSO_LINHA * 3.1);
    }
    // rodapé
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = `600 24px ${FONTE}`;
    const ativas = rotinas.filter(r => r.estado === 'ativa').length;
    const rodando = rotinas.filter(r => r.rodandoAgora).length;
    const partes = [`${rotinas.length} ${rotinas.length === 1 ? 'rotina' : 'rotinas'}`];
    if (ativas) partes.push(`${ativas} ${ativas === 1 ? 'ativa' : 'ativas'}`);
    if (rodando) partes.push(`${rodando} rodando agora`);
    g.fillText(partes.join(' · '), 48, QH - 18);
    if (paginas() > 1) { g.textAlign = 'right'; g.fillText(`página ${pagina + 1} de ${paginas()}`, QW - 48, QH - 18); }
    textura.needsUpdate = true;
    ultimoMinuto = relogio;
    sujo = false;
  }

  function atualizar(lista) {
    rotinas = Array.isArray(lista) ? lista : [];
    for (const id of [...partindo.keys()]) {
      const r = rotinas.find(x => x.id === id);
      // confirmou que rodou (ou a próxima já é outra): sai do "partindo"
      if (!r || r.rodandoAgora || Date.now() - partindo.get(id) > 90_000) partindo.delete(id);
    }
    if (pagina >= paginas()) pagina = 0;
    sujo = true;
  }
  function marcarPartindo(id) { partindo.set(id, Date.now()); sujo = true; }

  function animar(t) {
    const agora = Date.now();
    if (paginas() > 1 && t - trocouPaginaEm > 10) { pagina = (pagina + 1) % paginas(); trocouPaginaEm = t; sujo = true; }
    if (hhmm(parede(agora)) !== ultimoMinuto) sujo = true;
    if (agora - ultimoRelativo > 15_000) { ultimoRelativo = agora; sujo = true; }
    if (sujo || girando) desenhar(t);
    const pulso = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(t * 3.2));
    matDestaque.opacity = pulso;
  }

  // posição (no grupo) do centro da linha de uma rotina, para o despachante olhar
  function linhaDe(id) {
    const i = rotinas.findIndex(r => r.id === id);
    if (i < 0) return null;
    return Math.floor(i / LINHAS) === pagina ? i % LINHAS : null;
  }

  return {
    grupo, atualizar, animar, marcarPartindo, linhaDe, largura, altura,
    liberar() { textura.dispose(); material.dispose(); matDestaque.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Peças da sala: maleta, balcão, prateleira, banco e portas
// ---------------------------------------------------------------------------
function maleta(cor, pai) {
  const m = new THREE.Group();
  caixa(0.34, 0.25, 0.12, cor, 0, 0, 0, m);
  caixa(0.11, 0.025, 0.025, 0x3b3530, 0, 0.25, 0, m, { sombra: false });
  caixa(0.016, 0.24, 0.124, 0xe9dcc6, -0.1, 0.005, 0, m, { sombra: false });   // tira de couro claro
  caixa(0.016, 0.24, 0.124, 0xe9dcc6, 0.1, 0.005, 0, m, { sombra: false });
  if (pai) pai.add(m);
  return m;
}

function sinalizacao(texto, larg, alt, corFundo = '#030870') {
  const W = 512, H = Math.round(512 * alt / larg);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const desenhar = () => {
    g.fillStyle = corFundo; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(encaixar(g, texto, W - 60, Math.round(H * 0.56), 800, 16), W / 2, H / 2 + 2);
    tx.needsUpdate = true;
  };
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  desenhar();
  if (document.fonts?.ready) document.fonts.ready.then(desenhar);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(larg, alt), new THREE.MeshStandardMaterial({ map: tx, emissive: 0xffffff, emissiveMap: tx, emissiveIntensity: 0.45, roughness: 0.5 }));
  m.userData.liberar = () => { tx.dispose(); m.material.dispose(); m.geometry.dispose(); };
  return m;
}

// ---------------------------------------------------------------------------
// Bonecos: despachante (NPC da sala) e viajante (sai com a maleta)
// ---------------------------------------------------------------------------
function criarDespachante() {
  const b = criarAstronauta(0x5a6273, 211, 'olhinhos');
  b.scale.setScalar(ESCALA);
  b.userData.npc = true;
  // colete navy com friso laranja e quepe navy: equipe da estação, não agente
  const colete = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.196, 0.21, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x030870, roughness: 0.75, side: THREE.DoubleSide }));
  colete.position.y = 0.47;
  b.add(colete);
  const friso = new THREE.Mesh(new THREE.TorusGeometry(0.203, 0.011, 6, 28), new THREE.MeshStandardMaterial({ color: 0xee4c01, roughness: 0.6 }));
  friso.rotation.x = Math.PI / 2; friso.position.y = 0.4;
  b.add(friso);
  const quepe = new THREE.Mesh(new THREE.TorusGeometry(0.236, 0.034, 8, 30), new THREE.MeshStandardMaterial({ color: 0x030870, roughness: 0.6 }));
  quepe.rotation.x = Math.PI / 2; quepe.position.y = 0.98;
  b.add(quepe);
  // prancheta na mão esquerda
  const prancheta = new THREE.Group();
  caixa(0.16, 0.2, 0.015, 0x9a6b45, 0, 0, 0, prancheta);
  caixa(0.13, 0.15, 0.004, 0xf7f1e6, 0, 0.02, 0.009, prancheta, { sombra: false });
  prancheta.position.set(-0.27, 0.2, 0.06);
  prancheta.rotation.x = -0.25;
  b.add(prancheta);
  b.traverse(o => { if (o.isMesh) o.castShadow = true; });
  b.userData.liberarExtras = () => { for (const m of [colete, friso, quepe]) { m.geometry.dispose(); m.material.dispose(); } };
  return { boneco: b, prancheta };
}

function criarViajante(agencia, semente) {
  const a = AGENCIAS[agencia] || AGENCIAS.claude;
  const b = criarAstronauta(a.cor, semente, 'olhinhos');
  definirProvedor(b, a.provedor);
  b.scale.setScalar(ESCALA);
  b.userData.npc = true;
  // materiais próprios, para poder aparecer e sumir na porta sem mexer nos outros bonecos
  const materiais = [];
  b.traverse(o => {
    if (!o.isMesh && !o.isSprite) return;
    o.material = o.material.clone();
    o.material.transparent = true;
    o.material.userData.opacidadeBase = o.material.opacity;
    materiais.push(o.material);
    if (o.isMesh) o.castShadow = true;
  });
  const mala = maleta(a.cor === 0xd47a5a ? 0xb2533c : 0x3d7a61);
  mala.scale.setScalar(0.85);
  mala.position.set(0.3, 0.05, 0.02);
  mala.visible = false;
  b.add(mala);
  mala.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.userData.opacidadeBase = 1; materiais.push(o.material); } });
  function opacidade(v) {
    for (const m of materiais) m.opacity = (m.userData.opacidadeBase ?? 1) * v;
    b.visible = v > 0.01;
  }
  return { boneco: b, mala, opacidade, liberar() { for (const m of materiais) m.dispose(); } };
}

// Movimento simples por pontos (a sala é pequena e as rotas são desenhadas à mão)
function andante(boneco, { vel = 1.0, fase = 0 } = {}) {
  let rota = [], olhar = boneco.rotation.y, passo = 0;
  const p = boneco.position;
  return {
    ir(pontos, olharFinal) { rota = pontos.map(([x, z]) => new THREE.Vector3(x, 0, z)); this.olharFinal = olharFinal; },
    get chegou() { return rota.length === 0; },
    olharFinal: null,
    passo(t, dt, modoParado = 'parado', opc = {}) {
      if (rota.length) {
        const alvo = rota[0];
        const dx = alvo.x - p.x, dz = alvo.z - p.z, dist = Math.hypot(dx, dz);
        let parado = false;
        if (dist < 0.02) { rota.shift(); }
        else {
          const anda = Math.min(dist, vel * dt);
          const nx = p.x + dx / dist * anda, nz = p.z + dz / dist * anda;
          // corpo sólido (F1): não chega a menos de 0,6 de ninguém
          if (passoLivre(boneco, nx, nz)) {
            p.x = nx; p.z = nz;
            passo += anda / (0.39 * ESCALA / 1.45) * Math.PI;
            olhar = Math.atan2(dx, dz);
          } else parado = true;
        }
        marcarAndando(boneco, !parado);
        boneco.userData.animar(t, parado ? 'parado' : 'andar', false, { dt, passo, fase });
      } else {
        marcarAndando(boneco, false);
        if (this.olharFinal != null) olhar = this.olharFinal;
        boneco.userData.animar(t, modoParado, false, { dt, fase, ...opc });
      }
      const dif = ((olhar - boneco.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      boneco.rotation.y += dif * Math.min(1, dt * 8);
    },
  };
}

// ---------------------------------------------------------------------------
// Sala inteira
// ---------------------------------------------------------------------------
// Opções: largura, profundidade e altParede (vitrine); modulo: true monta a sala para
// uma vaga da Estação (F1, 4,6 x 6,8 m, sem piso nem paredes laterais; ver cenarioModulo).
export function montarSalaDespacho({ largura = 7.4, profundidade = 4.8, altParede = 2.6, modulo = false } = {}) {
  if (modulo) { largura = 4.6; profundidade = 6.8; altParede = 2.8; }
  const sala = new THREE.Group();
  sala.name = 'sala-despacho';
  const X0 = -largura / 2, X1 = largura / 2, ZF = -profundidade / 2, ZT = profundidade / 2;
  const liberaveis = [];
  const { PS, PE, quadro, QX, B, P, maletas, bilhete, carimbo, TOPO, cer } = modulo ? cenarioModulo() : cenarioVitrine();

  // ---------------------------------------------------------------------------
  // Cenário da vitrine (sala de 7,4 x 4,8 com portas de serviço e de embarque)
  // ---------------------------------------------------------------------------
  function cenarioVitrine() {
  // piso de madeira e tapete na frente do balcão
  piso(largura, profundidade, C.piso, 0, 0, sala);
  tapete(1.25, 1.2, 2.7, 1.15, C.tapete, sala);

  // paredes em corte, com a porta de serviço no fundo e a porta de embarque à esquerda
  const PS = { x0: 0.95, x1: 1.85, alt: 2.1 };   // porta de serviço (fundo)
  const PE = { z0: 0.75, z1: 1.75, alt: 2.1 };   // porta de embarque (esquerda)
  const esp = 0.12;
  caixa(PS.x0 - (X0 - esp), altParede, esp, C.parede, (X0 - esp + PS.x0) / 2, 0, ZF - esp / 2, sala);
  caixa(X1 - PS.x1, altParede, esp, C.parede, (PS.x1 + X1) / 2, 0, ZF - esp / 2, sala);
  caixa(PS.x1 - PS.x0, altParede - PS.alt, esp, C.parede, (PS.x0 + PS.x1) / 2, PS.alt, ZF - esp / 2, sala);
  caixa(esp, altParede, PE.z0 - ZF, C.parede, X0 - esp / 2, 0, (ZF + PE.z0) / 2, sala);
  caixa(esp, altParede, ZT - PE.z1, C.parede, X0 - esp / 2, 0, (PE.z1 + ZT) / 2, sala);
  caixa(esp, altParede - PE.alt, PE.z1 - PE.z0, C.parede, X0 - esp / 2, PE.alt, (PE.z0 + PE.z1) / 2, sala);
  // rodapé
  caixa(largura, 0.08, 0.02, C.rodapeParede, 0, 0, ZF + 0.01, sala, { sombra: false });
  caixa(0.02, 0.08, profundidade, C.rodapeParede, X0 + 0.01, 0, 0, sala, { sombra: false });
  // batentes de madeira nas duas portas
  for (const x of [PS.x0, PS.x1]) caixa(0.07, PS.alt, 0.16, C.madeira, x, 0, ZF - 0.02, sala);
  caixa(PS.x1 - PS.x0 + 0.14, 0.07, 0.16, C.madeira, (PS.x0 + PS.x1) / 2, PS.alt, ZF - 0.02, sala);
  for (const z of [PE.z0, PE.z1]) caixa(0.16, PE.alt, 0.07, C.madeira, X0 - 0.02, 0, z, sala);
  caixa(0.16, 0.07, PE.z1 - PE.z0 + 0.14, C.madeira, X0 - 0.02, PE.alt, (PE.z0 + PE.z1) / 2, sala);
  // o que se vê pelas portas: luz quente de corredor no vão (o viajante aparece e some ali)
  const luzCorredor = { emissive: 0xffd9a0, emissiveIntensity: 0.45 };
  caixa(PS.x1 - PS.x0, PS.alt, 0.02, C.corredor, (PS.x0 + PS.x1) / 2, 0, ZF - esp + 0.01, sala, { mat: luzCorredor, sombra: false, seg: 0 });
  caixa(0.02, PE.alt, PE.z1 - PE.z0, C.corredor, X0 - esp + 0.01, 0, (PE.z0 + PE.z1) / 2, sala, { mat: luzCorredor, sombra: false, seg: 0 });
  // placa "Embarque" sobre a porta da esquerda
  const placaEmbarque = sinalizacao('Embarque', 0.86, 0.22);
  placaEmbarque.rotation.y = Math.PI / 2;
  placaEmbarque.position.set(X0 + 0.012, PE.alt + 0.24, (PE.z0 + PE.z1) / 2);
  sala.add(placaEmbarque);
  liberaveis.push({ liberar: placaEmbarque.userData.liberar });

  // quadro de horários na parede do fundo
  const quadro = criarQuadroHorarios({ largura: 3.9, altura: 1.62 });
  const QX = X0 + 0.5 + 3.9 / 2;   // de -3,2 a 0,7
  quadro.grupo.position.set(QX, 0.86, ZF + 0.05);
  sala.add(quadro.grupo);
  liberaveis.push(quadro);

  // balcão de despacho
  const B = { x: 1.3, z: 0.2, larg: 2.4, prof: 0.6, alt: 0.95 };
  const balcao = new THREE.Group();
  balcao.position.set(B.x, 0, B.z);
  sala.add(balcao);
  caixa(B.larg, B.alt, B.prof, C.madeira, 0, 0, 0, balcao);
  caixa(B.larg + 0.1, 0.05, B.prof + 0.1, C.tampo, 0, B.alt, 0, balcao);
  caixa(B.larg + 0.02, 0.07, 0.02, 0x030870, 0, 0.72, B.prof / 2 + 0.005, balcao, { sombra: false });
  caixa(B.larg + 0.02, 0.012, 0.022, 0xee4c01, 0, 0.69, B.prof / 2 + 0.006, balcao, { sombra: false });
  for (let i = 0; i < 5; i++) caixa(0.02, 0.6, 0.012, C.madeiraEscura, -B.larg / 2 + 0.2 + i * (B.larg - 0.4) / 4, 0.06, B.prof / 2 + 0.003, balcao, { sombra: false });
  const TOPO = B.alt + 0.05;
  // papéis, carimbo, almofada de tinta, sineta e luminária
  const pilha = new THREE.Group();
  pilha.position.set(-0.6, TOPO, -0.02);
  balcao.add(pilha);
  for (let i = 0; i < 6; i++) caixa(0.22, 0.008, 0.3, i % 2 ? 0xf7f1e6 : 0xece2cf, (i % 3) * 0.006, i * 0.008, 0, pilha, { sombra: false }).rotation.y = (i % 3 - 1) * 0.05;
  caixa(0.16, 0.02, 0.1, 0x2b2b33, -0.15, TOPO, 0.05, balcao);
  caixa(0.13, 0.006, 0.075, 0x030870, -0.15, TOPO + 0.02, 0.05, balcao, { sombra: false });
  const carimbo = new THREE.Group();
  carimbo.position.set(-0.32, TOPO, 0.04);
  balcao.add(carimbo);
  caixa(0.07, 0.025, 0.05, 0x3b3530, 0, 0, 0, carimbo);
  cilindro(0.012, 0.012, 0.07, 0x8a5a3a, 0, 0.025, 0, carimbo, 10);
  cilindro(0.026, 0.026, 0.035, 0xb98552, 0, 0.09, 0, carimbo, 14);
  const bilhete = caixa(0.12, 0.004, 0.07, 0xfff7e8, -0.42, TOPO, 0.2, balcao, { sombra: false });
  bilhete.visible = false;
  cilindro(0.045, 0.06, 0.02, 0xc9a24a, 0.55, TOPO, 0.12, balcao, 16);
  cilindro(0.008, 0.008, 0.035, 0xc9a24a, 0.55, TOPO + 0.02, 0.12, balcao, 8);
  luminariaMesa(balcao, 0.95, TOPO, -0.12, Math.PI * 0.9);
  planta(1.05, 0.12, 0.45, COR.offWhite, 'suculenta', balcao, TOPO);

  // prateleira de maletas encostada no fundo, à direita
  const P = { x: 2.85, z: ZF + 0.26, larg: 1.3, prof: 0.42, alt: 1.82 };
  const prat = new THREE.Group();
  prat.position.set(P.x, 0, P.z);
  sala.add(prat);
  caixa(0.04, P.alt, P.prof, C.madeiraEscura, -P.larg / 2, 0, 0, prat);
  caixa(0.04, P.alt, P.prof, C.madeiraEscura, P.larg / 2, 0, 0, prat);
  const NIVEIS = [0.06, 0.64, 1.22, P.alt - 0.04];
  for (const y of NIVEIS) caixa(P.larg, 0.035, P.prof, C.madeira, 0, y, 0, prat);
  const coresMaleta = [0xc98a6a, 0x030870, 0xa8c39f, 0x8fa3bf, 0xe8dcc6, 0xb2533c, 0x3d7a61, 0x8a5a3a, 0xd9b48a];
  const maletas = [];
  for (let n = 0; n < 3; n++) {
    for (let k = 0; k < 3; k++) {
      if (n === 2 && k === 2) continue;   // um vão na de cima: é ali que o despachante arruma
      const m = maleta(coresMaleta[(n * 3 + k) % coresMaleta.length], prat);
      const x = -P.larg / 2 + 0.24 + k * 0.41;
      m.position.set(x, NIVEIS[n] + 0.035, 0.02);
      m.rotation.y = (k - 1) * 0.05;
      maletas.push({ m, base: m.position.clone(), nivel: n });
    }
  }
  // relógio de parede acima da prateleira
  relogioParede(P.x, 2.25, ZF + 0.02, 0.17, sala);

  // banco de espera na parede da esquerda, com plantas
  const banco = new THREE.Group();
  banco.position.set(X0 + 0.3, 0, -0.75);
  sala.add(banco);
  caixa(0.42, 0.05, 1.5, C.madeira, 0, 0.42, 0, banco);
  caixa(0.06, 0.42, 1.5, C.madeira, -0.18, 0.47, 0, banco);
  for (const z of [-0.65, 0.65]) caixa(0.36, 0.42, 0.05, C.madeiraEscura, 0, 0, z, banco);
  caixa(0.3, 0.2, 0.08, 0xe6a93a, 0.02, 0.47, 0.35, banco).rotation.z = 0.25;   // almofada
  planta(X0 + 0.4, ZF + 0.45, 0.85, COR.terracota, 'folhaLarga', sala);
  planta(X0 + 0.4, ZT - 0.45, 0.95, COR.offWhite, 'ficus', sala);
  planta(X1 - 0.45, ZT - 0.5, 0.8, COR.pretoFosco, 'folhaLarga', sala);
  const cer = {
    inicio: [B.x, -0.45], zc: -0.75,
    entrada: [(PS.x0 + PS.x1) / 2, ZF + 0.12], olharEntrada: 0,
    fadeEntrada: px => (px.z - (ZF + 0.12)) / 0.6,
    rotaEntrada: x => [[(PS.x0 + PS.x1) / 2, ZF + 0.85], [x, P.z + 0.85]],
    rotaBalcao: () => [[X1 - 0.5, P.z + 1.0], [X1 - 0.5, B.z + 0.85], [B.x - 0.3, B.z + 0.72]],
    saida: [[X0 + 1.0, (PE.z0 + PE.z1) / 2], [X0 + 0.18, (PE.z0 + PE.z1) / 2]], olharSaida: -Math.PI / 2,
    fadeSaida: px => (px.x - (X0 + 0.18)) / 0.75,
  };
  return { PS, PE, quadro, QX, B, P, maletas, bilhete, carimbo, TOPO, cer };
  }

  // ---------------------------------------------------------------------------
  // Cenário do módulo da Estação (F1-SALAS-E-VIDA, 03/10): vaga de 4,6 x 6,8 m no
  // norte (ala técnica, vaga 3). x de -2,3 a 2,3; z de -3,4 (parede alta do fundo)
  // a 3,4 (divisória do corredor, com a porta de embarque em x 0,55 a 2,15). Piso,
  // parede do fundo e divisórias vêm da casca (layout.js). Tudo alinhado às paredes.
  // - parede do fundo: quadro de horários, porta de serviço e prateleira de maletas;
  // - balcão paralelo ao fundo, com o corredor do despachante atrás;
  // - o viajante entra pela porta de serviço, pega a maleta, carimba no balcão e sai
  //   pela porta do módulo (Embarque), sumindo no corredor da Estação;
  // - sem banco de espera (nada de assento vazio à mostra).
  // ---------------------------------------------------------------------------
  function cenarioModulo() {
    tapete(-0.5, -0.2, 2.6, 1.05, C.tapete, sala);
    // no módulo a casca já põe um rodapé em ZF..ZF+0,02: este fica na frente dele (coincidiam e piscavam)
    caixa(4.6, 0.08, 0.02, C.rodapeParede, 0, 0, ZF + 0.035, sala, { sombra: false });
    // porta de serviço na parede do fundo (vão com luz quente de corredor)
    const PS = { x0: 0.68, x1: 1.42, alt: 2.1 };
    caixa(PS.x1 - PS.x0, PS.alt, 0.03, C.corredor, (PS.x0 + PS.x1) / 2, 0, ZF + 0.005, sala,
      { mat: { emissive: 0xffd9a0, emissiveIntensity: 0.45 }, sombra: false, seg: 0 });
    for (const x of [PS.x0, PS.x1]) caixa(0.07, PS.alt, 0.1, C.madeira, x, 0, ZF + 0.03, sala);
    caixa(PS.x1 - PS.x0 + 0.14, 0.07, 0.1, C.madeira, (PS.x0 + PS.x1) / 2, PS.alt, ZF + 0.03, sala);
    const PE = { x0: 0.55, x1: 2.15, z: 3.4 };   // a porta do módulo, no corredor
    // placa "Embarque" num pedestal ao lado da porta, virada para a câmera
    const placaEmbarque = sinalizacao('Embarque', 0.62, 0.17);
    const pedestal = new THREE.Group();
    pedestal.position.set(0.2, 0, 3.05);
    cilindro(0.12, 0.14, 0.03, C.madeiraEscura, 0, 0, 0, pedestal, 16);
    cilindro(0.022, 0.022, 1.12, C.madeiraEscura, 0, 0.03, 0, pedestal, 8);
    caixa(0.68, 0.23, 0.04, C.madeira, 0, 1.12, 0, pedestal, { seg: 0 });
    placaEmbarque.position.set(0, 1.235, 0.022);
    pedestal.add(placaEmbarque);
    sala.add(pedestal);
    liberaveis.push({ liberar: placaEmbarque.userData.liberar });

    // quadro de horários na parede do fundo, à esquerda da porta de serviço
    const QL = 2.75, QA = 1.14;
    const quadro = criarQuadroHorarios({ largura: QL, altura: QA });
    const QX = -2.18 + QL / 2;
    quadro.grupo.position.set(QX, 0.95, ZF + 0.05);
    sala.add(quadro.grupo);
    liberaveis.push(quadro);

    // balcão de despacho (paralelo ao fundo)
    const B = { x: -0.45, z: -1.2, larg: 2.4, prof: 0.6, alt: 0.95 };
    const r = montarBalcao(B);

    // prateleira de maletas estreita, encostada no fundo à direita da porta de serviço
    const P = { x: 1.88, z: ZF + 0.26, larg: 0.72, prof: 0.42, alt: 1.82 };
    const maletas = montarPrateleira(P, 2);
    relogioParede(QX, 2.45, ZF + 0.02, 0.15, sala);
    planta(-1.95, 2.95, 0.95, COR.offWhite, 'ficus', sala);
    planta(-1.95, 0.6, 0.85, COR.terracota, 'folhaLarga', sala);
    planta(1.95, 1.0, 0.8, COR.pretoFosco, 'folhaLarga', sala);
    const xPorta = (PS.x0 + PS.x1) / 2, xSaida = (PE.x0 + PE.x1) / 2;
    const cer = {
      inicio: [B.x, B.z - 0.8], zc: null,
      entrada: [xPorta, ZF + 0.12], olharEntrada: 0,
      fadeEntrada: px => (px.z - (ZF + 0.12)) / 0.6,
      rotaEntrada: x => [[xPorta, ZF + 1.05], [Math.min(x, 1.9), ZF + 1.05]],
      rotaBalcao: () => [[1.15, ZF + 1.3], [1.15, B.z + 0.7], [B.x - 0.3, B.z + 0.7]],
      saida: [[xSaida, B.z + 0.95], [xSaida, 2.55], [xSaida, 3.35]], olharSaida: 0,
      fadeSaida: px => (3.35 - px.z) / 0.8,
    };
    return { PS, PE, quadro, QX, B, P, maletas, bilhete: r.bilhete, carimbo: r.carimbo, TOPO: r.TOPO, cer };
  }

  // Balcão com papéis, carimbo, almofada, sineta e luminária (o mesmo da vitrine)
  function montarBalcao(B) {
    const balcao = new THREE.Group();
    balcao.position.set(B.x, 0, B.z);
    sala.add(balcao);
    caixa(B.larg, B.alt, B.prof, C.madeira, 0, 0, 0, balcao);
    caixa(B.larg + 0.1, 0.05, B.prof + 0.1, C.tampo, 0, B.alt, 0, balcao);
    caixa(B.larg + 0.02, 0.07, 0.02, 0x030870, 0, 0.72, B.prof / 2 + 0.005, balcao, { sombra: false });
    caixa(B.larg + 0.02, 0.012, 0.022, 0xee4c01, 0, 0.69, B.prof / 2 + 0.006, balcao, { sombra: false });
    for (let i = 0; i < 5; i++) caixa(0.02, 0.6, 0.012, C.madeiraEscura, -B.larg / 2 + 0.2 + i * (B.larg - 0.4) / 4, 0.06, B.prof / 2 + 0.003, balcao, { sombra: false });
    const TOPO = B.alt + 0.05;
    const pilha = new THREE.Group();
    pilha.position.set(-0.6, TOPO, -0.02);
    balcao.add(pilha);
    for (let i = 0; i < 6; i++) caixa(0.22, 0.008, 0.3, i % 2 ? 0xf7f1e6 : 0xece2cf, (i % 3) * 0.006, i * 0.008, 0, pilha, { sombra: false });
    caixa(0.16, 0.02, 0.1, 0x2b2b33, -0.15, TOPO, 0.05, balcao);
    caixa(0.13, 0.006, 0.075, 0x030870, -0.15, TOPO + 0.02, 0.05, balcao, { sombra: false });
    const carimbo = new THREE.Group();
    carimbo.position.set(-0.32, TOPO, 0.04);
    balcao.add(carimbo);
    caixa(0.07, 0.025, 0.05, 0x3b3530, 0, 0, 0, carimbo);
    cilindro(0.012, 0.012, 0.07, 0x8a5a3a, 0, 0.025, 0, carimbo, 10);
    cilindro(0.026, 0.026, 0.035, 0xb98552, 0, 0.09, 0, carimbo, 14);
    const bilhete = caixa(0.12, 0.004, 0.07, 0xfff7e8, -0.42, TOPO, 0.2, balcao, { sombra: false });
    bilhete.visible = false;
    cilindro(0.045, 0.06, 0.02, 0xc9a24a, 0.55, TOPO, 0.12, balcao, 16);
    cilindro(0.008, 0.008, 0.035, 0xc9a24a, 0.55, TOPO + 0.02, 0.12, balcao, 8);
    luminariaMesa(balcao, 0.95, TOPO, -0.12, Math.PI);
    planta(1.05, 0.12, 0.45, COR.offWhite, 'suculenta', balcao, TOPO);
    return { balcao, TOPO, carimbo, bilhete };
  }

  // Prateleira de maletas ('colunas' maletas por nível; um vão em cima, onde ele arruma)
  function montarPrateleira(P, colunas) {
    const prat = new THREE.Group();
    prat.position.set(P.x, 0, P.z);
    sala.add(prat);
    caixa(0.04, P.alt, P.prof, C.madeiraEscura, -P.larg / 2, 0, 0, prat);
    caixa(0.04, P.alt, P.prof, C.madeiraEscura, P.larg / 2, 0, 0, prat);
    const NIVEIS = [0.06, 0.64, 1.22, P.alt - 0.04];
    for (const y of NIVEIS) caixa(P.larg, 0.035, P.prof, C.madeira, 0, y, 0, prat);
    const cores = [0xc98a6a, 0x030870, 0xa8c39f, 0x8fa3bf, 0xe8dcc6, 0xb2533c, 0x3d7a61, 0x8a5a3a, 0xd9b48a];
    const lista = [];
    const passoK = (P.larg - 0.08) / colunas;
    for (let n = 0; n < 3; n++) for (let k = 0; k < colunas; k++) {
      if (n === 2 && k === colunas - 1) continue;
      const m = maleta(cores[(n * 3 + k) % cores.length], prat);
      m.position.set(-P.larg / 2 + 0.04 + passoK * (k + 0.5), NIVEIS[n] + 0.035, 0.02);
      lista.push({ m, base: m.position.clone(), nivel: n });
    }
    return lista;
  }

  // ---------------------------------------------------------------------------
  // Despachante: rotina própria, semente própria
  // ---------------------------------------------------------------------------
  const { boneco: despachante, prancheta } = criarDespachante();
  despachante.position.set(cer.inicio[0], 0, cer.inicio[1]);
  sala.add(despachante);
  const anda = andante(despachante, { vel: 1.0, fase: 0.9 });
  const sorte = sorteador(30211);
  const PONTOS = {
    quadroA: { p: [QX - 1.1, ZF + 1.05], olhar: Math.PI },
    quadroB: { p: [QX + 0.9, ZF + 1.05], olhar: Math.PI },
    quadroMeio: { p: [QX, ZF + 1.1], olhar: Math.PI },
    balcao: { p: [B.x - 0.3, B.z - 0.64], olhar: 0 },
    balcaoPapeis: { p: [B.x - 0.65, B.z - 0.64], olhar: 0.2 },
    prateleira: { p: [modulo ? P.x : P.x + 0.2, P.z + 0.95], olhar: Math.PI },
    janelaBalcao: { p: [B.x + 0.6, B.z - 0.7], olhar: -2.2 },   // de lado, olhando o quadro de longe
  };
  const TAREFAS = [
    { acao: 'quadro', ponto: 'quadroA', peso: 1.0, dur: [3, 6] },
    { acao: 'quadro', ponto: 'quadroB', peso: 1.0, dur: [3, 6] },
    { acao: 'carimbar', ponto: 'balcao', peso: 1.3, dur: [4, 7] },
    { acao: 'papeis', ponto: 'balcaoPapeis', peso: 0.8, dur: [3, 5] },
    { acao: 'maletas', ponto: 'prateleira', peso: 1.1, dur: [4, 7] },
    { acao: 'olhar', ponto: 'janelaBalcao', peso: 0.5, dur: [2, 4] },
  ];
  let tarefa = null, fimAcao = 0, cerimonia = null, ultimaTarefa = null;
  let maletaMexida = null;
  const fila = [];
  let carimbando = false;

  function sortearTarefa() {
    const cands = TAREFAS.filter(x => x !== ultimaTarefa);
    let r = sorte() * cands.reduce((s, x) => s + x.peso, 0);
    for (const x of cands) { r -= x.peso; if (r <= 0) return x; }
    return cands[cands.length - 1];
  }
  // rotas: pelo "corredor de trás" (z entre o balcão e o fundo), sempre livre
  function rotaPara(destino) {
    const [x, z] = destino;
    const p = despachante.position;
    const zc = cer.zc;
    if (zc == null || Math.abs(p.z - z) < 0.2 || (p.z < -0.2 && z < -0.2)) return [[x, z]];
    return [[p.x, zc], [x, zc], [x, z]];
  }
  function iniciarTarefa(t) {
    tarefa = sortearTarefa();
    ultimaTarefa = tarefa;
    const pt = PONTOS[tarefa.ponto];
    anda.ir(rotaPara(pt.p), pt.olhar);
    tarefa.durSorteada = tarefa.dur[0] + sorte() * (tarefa.dur[1] - tarefa.dur[0]);
    fimAcao = null;
    if (tarefa.acao === 'maletas') maletaMexida = maletas[Math.floor(sorte() * maletas.length)];
  }

  function modoDaTarefa(t) {
    if (!tarefa) return 'parado';
    if (tarefa.acao === 'carimbar' || tarefa.acao === 'papeis' || tarefa.acao === 'maletas') return 'digitar';
    if (tarefa.acao === 'olhar') return 'conversar';
    return 'parado';
  }

  // ---------------------------------------------------------------------------
  // Cerimônia de saída
  // ---------------------------------------------------------------------------
  let semente = 500;
  function despachar(agencia = 'claude', id = null) {
    fila.push({ agencia, id });
  }

  function comecarCerimonia(t) {
    const pedido = fila.shift();
    const v = criarViajante(pedido.agencia, ++semente);
    v.boneco.position.set(cer.entrada[0], 0, cer.entrada[1]);
    v.boneco.rotation.y = cer.olharEntrada;
    v.opacidade(0);
    v.boneco.visible = false;
    sala.add(v.boneco);
    v.corpo = modulo ? registrarNpc(v.boneco, { sala: 'despacho' }) : null;   // corpo sólido também para o viajante
    // a maleta que ele vai pegar: a mais à frente das prateleiras de baixo
    const visiveis = maletas.filter(x => x.m.visible && x.nivel < 2);
    const escolhida = visiveis.length ? visiveis[Math.floor(sorte() * visiveis.length)] : null;
    cerimonia = {
      ...pedido, v, anda: andante(v.boneco, { vel: 0.95, fase: 2.1 + sorte() }),
      etapa: 'chamado', desde: t, escolhida, linha: pedido.id ? quadro.linhaDe(pedido.id) : null,
    };
    // despachante larga o que fazia e vai conferir o quadro
    if (maletaMexida) { maletaMexida.m.position.copy(maletaMexida.base); maletaMexida.m.rotation.y = 0; maletaMexida = null; }
    tarefa = null;
    const pt = PONTOS.quadroMeio;
    anda.ir(rotaPara(pt.p), pt.olhar);
  }

  function passoCerimonia(t, dt) {
    const c = cerimonia;
    const v = c.v;
    const xPorta = (PS.x0 + PS.x1) / 2;
    const fimDe = s => t - c.desde > s;
    // despachante
    let modoDesp = 'parado';
    switch (c.etapa) {
      case 'chamado':
        if (anda.chegou) { c.etapa = 'conferindo'; c.desde = t; }
        break;
      case 'conferindo':
        modoDesp = 'conversar';
        if (fimDe(2.4)) {
          c.etapa = 'indoBalcao'; c.desde = t;
          anda.ir(rotaPara(PONTOS.balcao.p), PONTOS.balcao.olhar);
          // viajante entra pela porta de serviço e vai à prateleira
          c.anda.ir(cer.rotaEntrada(c.escolhida ? P.x + c.escolhida.base.x : P.x), Math.PI);
          c.viaj = 'entrando';
        }
        break;
      case 'indoBalcao':
        if (anda.chegou) { c.etapa = 'aguardando'; c.desde = t; }
        break;
      case 'aguardando':
        modoDesp = 'parado';
        if (c.viaj === 'noBalcao') { c.etapa = 'carimbando'; c.desde = t; }
        break;
      case 'carimbando':
        modoDesp = 'digitar';
        carimbando = true;
        if (fimDe(1.6)) {
          carimbando = false;
          bilhete.visible = false;
          c.etapa = 'acenando'; c.desde = t;
          // viajante segue para a porta de embarque
          c.anda.ir(cer.saida, cer.olharSaida);
          c.viaj = 'saindo';
        } else if (fimDe(0.8)) bilhete.visible = true;
        break;
      case 'acenando':
        modoDesp = 'conversar';
        if (c.viaj === 'foi') { c.etapa = 'fim'; }
        break;
    }
    anda.passo(t, dt, modoDesp, { atividade: 'coordenar' });

    // viajante
    let modoV = 'parado';
    const px = v.boneco.position;
    if (c.viaj === 'entrando') {
      v.opacidade(Math.min(1, Math.max(0, cer.fadeEntrada(px))));
      if (c.anda.chegou) { c.viaj = 'pegando'; c.viajDesde = t; }
    } else if (c.viaj === 'pegando') {
      modoV = 'digitar';
      if (t - c.viajDesde > 0.9) {
        if (c.escolhida) c.escolhida.m.visible = false;
        v.mala.visible = true;
        c.viaj = 'indoBalcao';
        c.anda.ir(cer.rotaBalcao(), Math.PI);
      }
    } else if (c.viaj === 'indoBalcao') {
      if (c.anda.chegou) c.viaj = 'noBalcao';
    } else if (c.viaj === 'noBalcao') {
      modoV = 'parado';
    } else if (c.viaj === 'saindo') {
      const fade = Math.min(1, Math.max(0, cer.fadeSaida(px)));
      v.opacidade(fade);
      if (c.anda.chegou) c.viaj = 'foi';
    }
    c.anda.passo(t, dt, modoV);

    if (c.etapa === 'fim') {
      sala.remove(v.boneco);
      removerNpc(v.corpo);
      v.liberar();
      const voltar = c.escolhida;
      if (voltar) setTimeout(() => { voltar.m.visible = true; }, 25_000);   // a maleta volta para a prateleira depois
      cerimonia = null;
      tarefa = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Dados e animação
  // ---------------------------------------------------------------------------
  const vistos = new Set();       // execuções que já tiveram cerimônia
  const partidas = new Map();     // id -> instantes que já tiveram cerimônia pelo horário
  const jaPartiu = (id, ms) => (partidas.get(id) || []).some(x => Math.abs(x - ms) < 10 * 60_000);
  let rotinas = [];

  function atualizar(dados) {
    if (!dados) return;
    rotinas = dados.rotinas || [];
    quadro.atualizar(rotinas);
    for (const r of rotinas) {
      if (!r.rodandoAgora) continue;
      const chave = `${r.id}|${r.ultima?.ms ?? ''}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      // se o horário já disparou a cerimônia desta partida, não repete
      if (r.ultima?.ms && jaPartiu(r.id, r.ultima.ms)) continue;
      despachar(r.agencia, r.id);
    }
  }

  // Cochilo (F1, só no módulo): banqueta atrás do balcão que aparece quando ele vai
  // sentar; com cerimônia na fila, ele acorda para despachar
  let coch = null, corpo = null, querDormir = false;
  if (modulo) {
    const banqueta = new THREE.Group();
    cilindro(0.2, 0.2, 0.05, 0x3a3f6f, 0, 0.68, 0, banqueta, 20);
    cilindro(0.025, 0.03, 0.68, 0x3a3f4f, 0, 0, 0, banqueta, 8);
    cilindro(0.17, 0.19, 0.02, 0x3a3f4f, 0, 0, 0, banqueta, 16);
    const BQ = new THREE.Vector3(B.x + 0.85, 0, B.z - 0.66);
    banqueta.position.copy(BQ);
    sala.add(banqueta);
    coch = criarCochilo({ boneco: despachante, banco: banqueta, rota: (de, para) => [para.clone()], vel: 1.0, faseAnim: 0.9,
      assento: { entrada: new THREE.Vector3(BQ.x, 0, BQ.z - 0.55), pos: BQ.clone(), y: 0.73 - 0.30 * ESCALA, olhar: 0 },
      aoAcordar: () => {
        if (maletaMexida) { maletaMexida.m.position.copy(maletaMexida.base); maletaMexida.m.rotation.y = 0; maletaMexida = null; }
        tarefa = null; anda.ir([], null);
      } });
    corpo = registrarNpc(despachante, { sala: 'despacho' });
  }

  let anterior = null;
  function animar(t) {
    const dt = anterior == null ? 1 / 60 : Math.min(0.1, Math.max(0, t - anterior));
    anterior = t;
    const agora = Date.now();
    if (coch) {
      coch.pedir(querDormir && !cerimonia && !fila.length);
      if (!cerimonia && coch.atualizar(t, dt)) { quadro.animar(t); carimbando = false; prancheta.visible = true; return; }
    }
    // horário chegou para uma rotina ativa: "partindo" e cerimônia, antes mesmo do próximo dado
    for (const r of rotinas) {
      if (!r.ativa || r.rodandoAgora || !r.proxima) continue;
      if (r.proxima.ms <= agora && agora - r.proxima.ms < 90_000) {
        if (jaPartiu(r.id, r.proxima.ms)) continue;
        partidas.set(r.id, [...(partidas.get(r.id) || []).slice(-5), r.proxima.ms]);
        quadro.marcarPartindo(r.id);
        despachar(r.agencia, r.id);
      }
    }
    quadro.animar(t);
    if (!cerimonia && fila.length) comecarCerimonia(t);

    if (cerimonia) passoCerimonia(t, dt);
    else {
      if (!tarefa) iniciarTarefa(t);
      if (anda.chegou && fimAcao == null) fimAcao = t + tarefa.durSorteada;
      const fazendo = anda.chegou;
      carimbando = fazendo && tarefa.acao === 'carimbar';
      anda.passo(t, dt, fazendo ? modoDaTarefa(t) : 'parado', { atividade: tarefa.acao === 'quadro' ? 'coordenar' : undefined });
      // arrumando maletas: a escolhida desliza um pouco e volta alinhada
      if (maletaMexida && tarefa.acao === 'maletas' && fazendo) {
        const u = Math.min(1, (t - (fimAcao - tarefa.durSorteada)) / tarefa.durSorteada);
        maletaMexida.m.position.x = maletaMexida.base.x + Math.sin(u * Math.PI) * 0.06;
        maletaMexida.m.rotation.y = Math.sin(u * Math.PI * 2) * 0.12;
      }
      if (fimAcao != null && t >= fimAcao) {
        if (maletaMexida) { maletaMexida.m.position.copy(maletaMexida.base); maletaMexida.m.rotation.y = 0; maletaMexida = null; }
        tarefa = null;
      }
    }
    // carimbo sobe e desce enquanto ele carimba; prancheta some quando as mãos estão ocupadas
    carimbo.position.y = TOPO + (carimbando ? Math.max(0, Math.sin(t * 9)) * 0.06 : 0);
    prancheta.visible = !carimbando && !(tarefa && anda.chegou && (tarefa.acao === 'maletas' || tarefa.acao === 'papeis'));
  }

  return {
    grupo: sala, atualizar, animar, largura, profundidade, altParede,
    quadro: quadro.grupo,                       // para enquadrar o quadro de perto
    despachar,                                  // para testes: despachar('codex')
    get emCerimonia() { return !!cerimonia || fila.length > 0; },
    npcs: [despachante],
    cochilar(sim) { querDormir = !!sim; },
    dormindo: () => !!coch?.dormindo() && !cerimonia && !fila.length,
    liberar() {
      removerNpc(corpo);
      for (const l of liberaveis) l.liberar?.();
      despachante.userData.liberarExtras?.();
      if (cerimonia) { removerNpc(cerimonia.v.corpo); cerimonia.v.liberar(); }
    },
  };
}
