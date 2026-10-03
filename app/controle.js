// Salas de controle (Sala Anthropic e Sala OpenAI): peças prontas para a rodada 5.
//
// Arquivo novo e independente: só lê pecas.js (plantas e piso de madeira) se ele
// carregar; se não carregar, usa peças próprias mais simples. Nada aqui mexe em E.
//
// EXPORTS
//   PROVEDORES                 cores e nomes de cada provedor (cor só em detalhes)
//   faixaDe(pct)               { id, rotulo, cor } tranquilo (< 60), atenção (< 85), crítico
//   criarPainelMedidores(opc)  painel de parede com os medidores de janela de uso,
//                              desenhado em canvas. atualizar(dados) só redesenha
//                              quando algo visível muda (devolve true se redesenhou)
//   criarPainelLateral(opc)    tela menor: relógio, data e tripulação do provedor
//   criarConsole(provedor)     console do operador (mesa em pé, 3 monitores, faixa
//                              na cor do provedor)
//   criarOperador(provedor, opc) NPC operador com rotina em ciclo; atualizar(dt)
//   montarSalaControle(provedor, opc) Group da sala inteira (ver abaixo)
//   dadosDeQuotas(quotas)      converte o campo quotas do painel claude-usage
//                              (localhost:8090/api/state) em { anthropic, openai }
//   dadosDeLimitesCodex(rl)    converte o rate_limits do Codex (fonte-codex.js,
//                              limitesCodex()) em dados da Sala OpenAI
//   dadosExemplo(agora)        dados da vitrine
//
// DADOS DE UMA SALA (definirDados / painel.atualizar)
//   { medidores: [{ rotulo: 'Sessão · 5 h', pct: 11, reiniciaEm: ms | ISO | null,
//                   janelaMin: 300 }],
//     atualizadoEm: ms, tripulacao: { trabalhando, descansando } | null,
//     aviso: 'texto' (opcional, quando não há medidores) }
//   pct null = indisponível (anel tracejado e "sem dados").
//
// SALA (montarSalaControle). Coordenadas locais: x de -2,3 a 2,3 (VAGA_L 4,6) e
// z de -3,4 a 3,4 (PROF 6,8), centro no meio do cômodo, chão em y = 0.
//   O mural de telas fica no lado -z, virado para +z (para a câmera). No sul (a
//   vaga das salas de controle, lado 's') o -z é o corredor: o mural é um móvel
//   solto e deixa livre a porta em x de 0,55 a 2,15 (porta 1,35, vão 1,6, igual
//   às salas MCP e API). No norte, o -z é a parede alta e o mural encosta nela.
//   Integração: sala.position.z = m.cz; m.grupo.add(sala); a cada quadro,
//   sala.userData.atualizar(dt) (devolve { andou }: marcar E.sombraSuja quando
//   true, porque o operador projeta sombra) e, a cada leitura,
//   sala.userData.definirDados(dados).
//   opc: { casca: false | 's' | 'n' (piso e divisórias próprios, para a vitrine),
//          semente, escala (1,45, a dos agentes) }
//   userData: provedor, painel, lateral, console, operador, obstaculos (retângulos
//   { x, z, w, d } locais, para o mapa de caminhos), porta, atualizar,
//   definirDados, liberar.
//   O operador não é agente: não entra na lotação nem tem balão de pensamento.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// pecas.js está em reforma: se falhar ao carregar, a sala usa peças próprias
let Pecas = null;
try { Pecas = await import('./pecas.js'); } catch (e) { console.warn('controle.js: pecas.js indisponível, usando peças próprias', e); }

// ---------------------------------------------------------------------------
// Paleta
// ---------------------------------------------------------------------------
export const PROVEDORES = {
  anthropic: { id: 'anthropic', nome: 'Anthropic', sala: 'Sala Anthropic', tripulacao: 'Claude', cor: 0xd47a5a, css: '#d47a5a' },
  openai: { id: 'openai', nome: 'OpenAI', sala: 'Sala OpenAI', tripulacao: 'Codex', cor: 0x4f9d7c, css: '#4f9d7c' },
};
const FAIXAS = {
  tranquilo: { id: 'tranquilo', rotulo: 'tranquilo', cor: '#6d9fd6' },
  atencao: { id: 'atencao', rotulo: 'atenção', cor: '#dcae58' },
  critico: { id: 'critico', rotulo: 'crítico', cor: '#d07a6a' },
  indisponivel: { id: 'indisponivel', rotulo: 'sem dados', cor: '#7c84a8' },
};
export function faixaDe(pct, provedor = null) {
  const cores = provedor && TEMAS[provedor]?.faixas;
  const f = pct == null || !Number.isFinite(pct) ? FAIXAS.indisponivel
    : pct >= 85 ? FAIXAS.critico : pct >= 60 ? FAIXAS.atencao : FAIXAS.tranquilo;
  return cores ? { ...f, cor: cores[f.id] } : f;
}

// Clima de cada sala (feedback de 03/10): reconhecíveis lado a lado só pela atmosfera,
// sem logo nem marca, e com o MESMO nível de tecnologia (segundo feedback de 03/10: a
// Anthropic parecia "a empresa antiga"). Anthropic: tecnologia quente (grafite quente,
// argila, bronze escovado, cerâmica, plantas em terracota), coral de acento.
// OpenAI: preto, branco e cinza, superfícies lisas, vidro e metal escovado, verde-água
// discreto de acento.
const TEMAS = {
  anthropic: {
    // 03/10: tão tecnológica quanto a OpenAI (telas escuras, metal, luz de acento), só que
    // quente: grafite quente, argila e bronze, coral de acento. Nada de "sala antiga".
    painel: { fundo: ['#241e1a', '#1a1512'], grade: 'rgba(255,236,220,0.035)', texto: '#f6ede2', suave: 'rgba(246,237,226,0.66)',
      fraco: 'rgba(246,237,226,0.44)', trilho: 'rgba(255,236,220,0.11)', linha: 'rgba(255,236,220,0.1)', fonte: FONTE_SANS(), pesoTitulo: 600, pesoNumero: 700 },
    faixas: { tranquilo: '#a3c79d', atencao: '#e6b56a', critico: '#ec8a6c', indisponivel: '#8f857d' },
    moldura: 0x3a312b, colunaMural: 0x2e2723, fundoMural: 0x3a322c, aparador: 0xcdb497, tampo: 0xf2e8da, travessa: 0xb08d6a,
    corpoConsole: 0xc9ae8f, tampoConsole: 0xf3eadc, puxador: 0x9c7a5c, monitor: 0x221c18,
    tela: { fundo: '#1d1815', tinta: '#f6ede2', fraca: 'rgba(255,236,220,0.18)', trilho: 'rgba(255,236,220,0.12)' },
    tapete: 0xe3d3ba, cupula: 0xeadfcd, placaFundo: '#f4efe6', placaTinta: '#3a2c22',
  },
  openai: {
    painel: { fundo: ['#121314', '#0a0b0c'], grade: 'rgba(255,255,255,0.03)', texto: '#f3f4f4', suave: 'rgba(243,244,244,0.64)',
      fraco: 'rgba(243,244,244,0.42)', trilho: 'rgba(255,255,255,0.1)', linha: 'rgba(255,255,255,0.09)', fonte: FONTE_SANS(), pesoTitulo: 600, pesoNumero: 700 },
    faixas: { tranquilo: '#8ccfbb', atencao: '#e1b866', critico: '#e48673', indisponivel: '#80858a' },
    moldura: 0x1b1c1e, colunaMural: 0x1e1f22, fundoMural: 0x2b2d31, aparador: 0x2a2b2f, tampo: 0xe8e9ea, travessa: 0xb7bbc0,
    corpoConsole: 0x242528, tampoConsole: 0xeeeff0, puxador: 0xa8acb2, monitor: 0x111214,
    tela: { fundo: '#0b0c0d', tinta: '#f3f4f4', fraca: 'rgba(255,255,255,0.18)', trilho: 'rgba(255,255,255,0.12)' },
    tapete: 0xd6d9dc, cupula: 0xf2f3f4, placaFundo: '#f5f6f6', placaTinta: '#16181a',
  },
};
function FONTE_SANS() { return 'Figtree, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif'; }
const temaDe = provedor => TEMAS[provedor] || TEMAS.anthropic;
const C = {
  madeiraClara: 0xd9b48a, madeiraMedia: 0xb98552, madeiraEscura: 0x8a5a3a, tampo: 0xd8b48c,
  grafite: 0x3a3f4f, grafiteClaro: 0x6b6f7a, offWhite: 0xf1ede6, linho: 0xe4dccd,
  divisoria: 0xf3efe8, piso: 0xcdbca4, tapete: 0xb9c3cf, folha: 0x4f7d43, folhaClara: 0x6f9a5a,
  terracota: 0xc07a55, tela: 0x0b1240,
  // operador
  traje: 0x8494aa, trajeEscuro: 0x6c7b91, colete: 0x3f4b5e, faixaRefletiva: 0xdfe5ec,
  luva: 0x59606d, bota: 0x474d59, capacete: 0xa7b4c6, viseira: 0x22324d, fone: 0x2b2f3a,
};
const FONTE = 'Figtree, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';

// ---------------------------------------------------------------------------
// Materiais e geometrias compartilhados (nunca recebem dispose)
// ---------------------------------------------------------------------------
const materiais = new Map();
function mat(cor, extra = {}) {
  const k = cor + JSON.stringify(extra);
  if (!materiais.has(k)) {
    const m = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.72, metalness: 0, ...extra });
    m.userData.compartilhada = true;
    materiais.set(k, m);
  }
  return materiais.get(k);
}
const geometrias = new Map();
const CONSTR = {
  caixa: (w, h, d) => {
    const menor = Math.min(w, h, d), r = Math.min(0.045, menor / 2.5);
    return r < 0.012 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, menor < 0.1 ? 1 : 2, r);
  },
  cilindro: (...p) => new THREE.CylinderGeometry(...p),
  esfera: (...p) => new THREE.SphereGeometry(...p),
  capsula: (...p) => new THREE.CapsuleGeometry(...p),
  toro: (...p) => new THREE.TorusGeometry(...p),
  plano: (...p) => new THREE.PlaneGeometry(...p),
};
function geo(tipo, ...p) {
  const transf = p.length && typeof p[p.length - 1] === 'object' ? p.pop() : null;
  const k = tipo + '|' + p.map(n => +(+n).toFixed(4)).join('|') + (transf ? JSON.stringify(transf) : '');
  let g = geometrias.get(k);
  if (!g) {
    g = CONSTR[tipo](...p);
    if (transf?.escala) g.scale(...transf.escala);
    g.userData.compartilhada = true;
    geometrias.set(k, g);
  }
  return g;
}
function malha(g, material, x, y, z, pai, sombra = true) {
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  m.castShadow = sombra;
  m.receiveShadow = true;
  pai.add(m);
  return m;
}
// caixa apoiada: y é a base
function caixa(w, h, d, cor, x, y, z, pai, extra) {
  return malha(geo('caixa', w, h, d), extra?.material || mat(cor, extra?.mat), x, y + h / 2, z, pai, extra?.sombra !== false);
}
function cilindro(rt, rb, h, cor, x, y, z, pai, seg = 18) {
  return malha(geo('cilindro', rt, rb, h, seg), mat(cor), x, y + h / 2, z, pai);
}

// Sorteio com semente (mulberry32)
function sorteador(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Textos em canvas: redesenho quando as fontes chegam
// ---------------------------------------------------------------------------
const redesenhos = new Set();
if (typeof document !== 'undefined' && document.fonts) {
  const tudo = () => { for (const f of redesenhos) f(true); };
  document.fonts.addEventListener?.('loadingdone', tudo);
  document.fonts.ready?.then(tudo);
}
function telaCanvas(w, h, largM, altM) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 8;
  // tela acesa: não depende da luz da sala; cor levemente abaixo de 1 para não estourar
  const material = new THREE.MeshBasicMaterial({ map: textura, toneMapped: false, color: 0xe9e9e9 });
  const plano = new THREE.Mesh(geo('plano', largM, altM), material);
  plano.castShadow = false;
  plano.receiveShadow = false;
  return { canvas, ctx: canvas.getContext('2d'), textura, material, plano };
}
function arredondado(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function ajustarFonte(g, texto, peso, tam, maxW, minimo = 14, fonte = FONTE) {
  do { g.font = `${peso} ${tam}px ${fonte}`; tam -= 2; } while (g.measureText(texto).width > maxW && tam > minimo);
}

// ---------------------------------------------------------------------------
// Horários (fuso do computador; nesta máquina, Brasília)
// ---------------------------------------------------------------------------
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const doisDig = n => String(n).padStart(2, '0');
function paraMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;   // segundos (Codex) ou ms
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}
function hora(ms) { const d = new Date(ms); return `${doisDig(d.getHours())}h${doisDig(d.getMinutes())}`; }
function textoReinicio(reiniciaEm, agora) {
  const ms = paraMs(reiniciaEm);
  if (ms == null) return 'reinício desconhecido';
  if (ms <= agora) return 'reiniciando';
  const d = new Date(ms), hoje = new Date(agora);
  const dias = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) / 864e5);
  if (dias === 0) return `reinicia às ${hora(ms)}`;
  if (dias === 1) return `reinicia amanhã, ${hora(ms)}`;
  if (dias < 7) return `reinicia ${DIAS[d.getDay()]}, ${hora(ms)}`;
  return `reinicia ${d.getDate()} ${MESES[d.getMonth()]}, ${hora(ms)}`;
}
// fração do tempo da janela que já passou (0 a 1), ou null
function tempoDecorrido(m, agora) {
  const fim = paraMs(m.reiniciaEm);
  if (fim == null || !m.janelaMin) return null;
  const total = m.janelaMin * 60e3;
  return Math.min(1, Math.max(0, 1 - (fim - agora) / total));
}

// ---------------------------------------------------------------------------
// (a) Painel de parede com os medidores de janela de uso
// ---------------------------------------------------------------------------
// opc: { provedor, largura (m), altura (m) }. Devolve { grupo, tela, atualizar,
// tick, liberar, redesenhos (contagem, para conferir) }.
// atualizar(dados, agora) e tick(agora) só redesenham quando a "assinatura" do
// que aparece na tela muda (pct arredondado, faixa, texto de reinício, minuto do
// "atualizado", tempo decorrido em %).
export function criarPainelMedidores({ provedor = 'anthropic', largura = 1.7, altura = 0.95 } = {}) {
  const P = PROVEDORES[provedor] || PROVEDORES.anthropic;
  const T = temaDe(provedor).painel, F = T.fonte;
  const faixa = pct => faixaDe(pct, provedor);
  const W = 1024, H = Math.round(1024 * altura / largura);
  const t = telaCanvas(W, H, largura, altura);
  const grupo = new THREE.Group();
  // moldura fina de grafite atrás da tela
  caixa(largura + 0.06, altura + 0.06, 0.04, temaDe(provedor).moldura, 0, -(altura + 0.06) / 2, -0.025, grupo);
  t.plano.position.z = 0.0;
  grupo.add(t.plano);
  let dados = { medidores: [] }, assinatura = null, contagem = 0;

  function assinar(agora) {
    const ms = dados.medidores || [];
    const partes = ms.map(m => [m.rotulo, m.pct == null ? 'x' : Math.round(m.pct), textoReinicio(m.reiniciaEm, agora),
      (() => { const f = tempoDecorrido(m, agora); return f == null ? 'x' : Math.round(f * 100); })()].join('~'));
    const at = dados.atualizadoEm ? hora(paraMs(dados.atualizadoEm)) : '';
    return partes.join('|') + '#' + at + '#' + (dados.aviso || '');
  }

  function desenhar() {
    const g = t.ctx, agora = Date.now();
    contagem++;
    // fundo navy escuro com grade muito leve
    const fundo = g.createLinearGradient(0, 0, 0, H);
    fundo.addColorStop(0, T.fundo[0]); fundo.addColorStop(1, T.fundo[1]);
    g.fillStyle = fundo;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = T.grade;
    g.lineWidth = 1;
    for (let x = 32; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 32; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

    // cabeçalho
    g.textBaseline = 'middle';
    g.fillStyle = P.css;
    g.beginPath(); g.arc(46, 52, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = T.texto;
    g.textAlign = 'left';
    g.font = `${T.pesoTitulo} 34px ${F}`;
    g.fillText(`Janelas de uso · ${P.tripulacao}`, 70, 54);
    if (dados.atualizadoEm) {
      g.textAlign = 'right';
      g.fillStyle = T.fraco;
      g.font = `500 24px ${F}`;
      g.fillText(`atualizado às ${hora(paraMs(dados.atualizadoEm))}`, W - 40, 54);
    }
    g.fillStyle = T.linha;
    g.fillRect(36, 92, W - 72, 2);

    const ms = (dados.medidores || []).slice(0, 4);
    if (!ms.length) {
      g.textAlign = 'center';
      g.fillStyle = T.texto;
      g.font = `${T.pesoTitulo} 44px ${F}`;
      g.fillText('Limites indisponíveis', W / 2, H * 0.52);
      g.fillStyle = T.fraco;
      g.font = `500 26px ${F}`;
      g.fillText(dados.aviso || 'esta instalação não tem acesso aos limites do plano', W / 2, H * 0.52 + 52);
    } else if (ms.length === 1) {
      desenharUnico(g, ms[0], agora);
    } else {
      const colW = (W - 72) / ms.length;
      ms.forEach((m, i) => desenharColuna(g, m, 36 + colW * i, colW, agora, ms.length));
    }
    t.textura.needsUpdate = true;
  }

  function anel(g, cx, cy, r, esp, m) {
    const fx = faixa(m.pct);
    g.lineCap = 'round';
    g.lineWidth = esp;
    g.strokeStyle = T.trilho;
    if (m.pct == null) g.setLineDash([esp * 0.7, esp * 0.9]);
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    if (m.pct != null) {
      const p = Math.min(100, Math.max(0, m.pct)) / 100;
      g.strokeStyle = fx.cor;
      if (p > 0.004) { g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.stroke(); }
      else { g.fillStyle = fx.cor; g.beginPath(); g.arc(cx, cy - r, esp / 2, 0, Math.PI * 2); g.fill(); }
    }
    // valor no centro
    g.textAlign = 'center';
    g.fillStyle = T.texto;
    if (m.pct == null) {
      g.font = `600 ${Math.round(r * 0.3)}px ${F}`;
      g.fillStyle = T.suave;
      g.fillText('sem dados', cx, cy + 2);
    } else {
      g.font = `${T.pesoNumero} ${Math.round(r * 0.62)}px ${F}`;
      const txt = String(Math.round(m.pct));
      const wNum = g.measureText(txt).width;
      g.font = `600 ${Math.round(r * 0.3)}px ${F}`;
      const wPct = g.measureText('%').width;
      const x0 = cx - (wNum + wPct + 4) / 2;
      g.textAlign = 'left';
      g.font = `${T.pesoNumero} ${Math.round(r * 0.62)}px ${F}`;
      g.fillText(txt, x0, cy + 4);
      g.font = `600 ${Math.round(r * 0.3)}px ${F}`;
      g.fillStyle = T.suave;
      g.fillText('%', x0 + wNum + 4, cy + r * 0.12);
    }
  }

  // barra fina do tempo da janela: quanto do período já passou
  function barraTempo(g, x, y, w, m, agora, tam = 21) {
    const f = tempoDecorrido(m, agora);
    if (f == null) return;
    g.fillStyle = T.trilho;
    arredondado(g, x, y, w, 8, 4); g.fill();
    g.fillStyle = T.suave;
    if (f > 0.01) { arredondado(g, x, y, Math.max(8, w * f), 8, 4); g.fill(); }
    g.textAlign = 'left';
    g.fillStyle = T.fraco;
    g.font = `500 ${tam}px ${F}`;
    g.fillText(`${Math.round(f * 100)}% do tempo da janela`, x, y + 30);
  }

  function desenharColuna(g, m, x, w, agora, n) {
    const cx = x + w / 2, r = n >= 4 ? 80 : n === 3 ? 108 : 118, cy = 108 + 26 + r;
    anel(g, cx, cy, r, n >= 4 ? 18 : 24, m);
    const fx = faixa(m.pct);
    let y = cy + r + 50;
    g.textAlign = 'center';
    g.fillStyle = T.texto;
    ajustarFonte(g, m.rotulo, T.pesoTitulo, 32, w - 24, 18, F);
    g.fillText(m.rotulo, cx, y);
    y += 40;
    g.font = `700 22px ${F}`;
    g.fillStyle = fx.cor;
    g.fillText(fx.rotulo, cx, y);
    y += 34;
    g.fillStyle = T.suave;
    const reinicio = textoReinicio(m.reiniciaEm, agora);
    ajustarFonte(g, reinicio, 500, 23, w - 24, 14, F);
    g.fillText(reinicio, cx, y);
    y += 30;
    const bw = Math.min(w - 50, 230);
    if (y + 34 < H) barraTempo(g, cx - bw / 2, y, bw, m, agora, n >= 3 ? 17 : 20);
  }

  function desenharUnico(g, m, agora) {
    const r = 150, cx = 74 + r, cy = 120 + (H - 120) / 2 - 6;
    anel(g, cx, cy, r, 30, m);
    const fx = faixa(m.pct);
    const x = cx + r + 70, maxW = W - x - 50;
    g.textAlign = 'left';
    g.fillStyle = T.texto;
    ajustarFonte(g, m.rotulo, T.pesoTitulo, 54, maxW, 24, F);
    g.fillText(m.rotulo, x, cy - 82);
    g.font = `700 32px ${F}`;
    g.fillStyle = fx.cor;
    g.fillText(fx.rotulo, x, cy - 26);
    g.fillStyle = T.suave;
    const reinicio = textoReinicio(m.reiniciaEm, agora);
    ajustarFonte(g, reinicio, 500, 30, maxW, 16, F);
    g.fillText(reinicio, x, cy + 22);
    barraTempo(g, x, cy + 64, Math.min(maxW, 380), m, agora, 22);
  }

  function atualizar(novos, agora = Date.now()) {
    if (novos) dados = { medidores: [], ...novos };
    const a = assinar(agora);
    if (a === assinatura) return false;
    assinatura = a;
    desenhar();
    return true;
  }
  const redesenho = forcar => { if (forcar) assinatura = null; atualizar(null); };
  redesenhos.add(redesenho);
  atualizar(dados);
  return {
    grupo, tela: t.plano, atualizar, tick: agora => atualizar(null, agora),
    get redesenhos() { return contagem; },
    liberar() { redesenhos.delete(redesenho); t.textura.dispose(); t.material.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Tela lateral: relógio, data e tripulação (redesenha por minuto ou dado novo)
// ---------------------------------------------------------------------------
export function criarPainelLateral({ provedor = 'anthropic', largura = 0.72, altura = 0.95 } = {}) {
  const P = PROVEDORES[provedor] || PROVEDORES.anthropic;
  const T = temaDe(provedor).painel, F = T.fonte;
  const W = 400, H = Math.round(400 * altura / largura);
  const t = telaCanvas(W, H, largura, altura);
  const grupo = new THREE.Group();
  caixa(largura + 0.06, altura + 0.06, 0.04, temaDe(provedor).moldura, 0, -(altura + 0.06) / 2, -0.025, grupo);
  grupo.add(t.plano);
  let trip = null, assinatura = null;
  function desenhar(agora) {
    const g = t.ctx, d = new Date(agora);
    const fundo = g.createLinearGradient(0, 0, 0, H);
    fundo.addColorStop(0, T.fundo[0]); fundo.addColorStop(1, T.fundo[1]);
    g.fillStyle = fundo; g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = T.texto;
    g.font = `${T.pesoNumero} 104px ${F}`;
    g.fillText(`${doisDig(d.getHours())}:${doisDig(d.getMinutes())}`, W / 2, H * 0.2);
    g.fillStyle = T.suave;
    g.font = `500 28px ${F}`;
    g.fillText(`${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`, W / 2, H * 0.2 + 78);
    g.fillStyle = T.linha;
    g.fillRect(36, H * 0.46, W - 72, 2);
    g.fillStyle = T.suave;
    g.font = `${T.pesoTitulo} 28px ${F}`;
    g.fillText(`Tripulação ${P.tripulacao}`, W / 2, H * 0.56);
    const linhas = trip
      ? [[trip.trabalhando ?? 0, 'em missão'], [trip.descansando ?? 0, 'descansando']]
      : null;
    if (linhas) {
      linhas.forEach(([n, rot], i) => {
        const y = H * 0.68 + i * 62;
        g.textAlign = 'right';
        g.fillStyle = T.texto;
        g.font = `${T.pesoNumero} 50px ${F}`;
        g.fillText(String(n), W * 0.36, y);
        g.textAlign = 'left';
        g.fillStyle = T.suave;
        g.font = `500 28px ${F}`;
        g.fillText(rot, W * 0.36 + 16, y + 3);
      });
    } else {
      g.fillStyle = T.fraco;
      g.font = `500 26px ${F}`;
      g.fillText('aguardando dados', W / 2, H * 0.72);
    }
    // luz de "ligado" na cor do provedor
    g.fillStyle = P.css;
    g.beginPath(); g.arc(W / 2 - 52, H - 40, 8, 0, Math.PI * 2); g.fill();
    g.textAlign = 'left';
    g.fillStyle = T.fraco;
    g.font = `500 22px ${F}`;
    g.fillText('em linha', W / 2 - 36, H - 38);
    t.textura.needsUpdate = true;
  }
  function atualizar(tripulacao, agora = Date.now()) {
    if (tripulacao !== undefined) trip = tripulacao;
    const d = new Date(agora);
    const a = `${d.getHours()}:${d.getMinutes()}|${trip ? trip.trabalhando + '/' + trip.descansando : '-'}`;
    if (a === assinatura) return false;
    assinatura = a;
    desenhar(agora);
    return true;
  }
  const redesenho = forcar => { if (forcar) assinatura = null; atualizar(undefined); };
  redesenhos.add(redesenho);
  atualizar(null);
  return {
    grupo, tela: t.plano, atualizar, tick: agora => atualizar(undefined, agora),
    liberar() { redesenhos.delete(redesenho); t.textura.dispose(); t.material.dispose(); },
  };
}

// Placa com o nome da sala (em cima do mural)
function placaSala(provedor, larg = 1.5) {
  const P = PROVEDORES[provedor];
  const TM = temaDe(provedor);
  const W = 768, H = Math.round(768 * 0.22 / larg);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: textura, roughness: 0.6 });
  const g = new THREE.Group();
  caixa(larg + 0.04, 0.26, 0.05, TM.moldura, 0, 0, -0.03, g);
  const plano = new THREE.Mesh(geo('plano', larg, 0.22), material);
  plano.position.set(0, 0.13, 0.0);
  g.add(plano);
  const desenhar = () => {
    const c = canvas.getContext('2d');
    c.fillStyle = TM.placaFundo; c.fillRect(0, 0, W, H);
    c.textBaseline = 'middle'; c.textAlign = 'left';
    ajustarFonte(c, P.sala, TM.painel.pesoTitulo + 100, 70, W - 130, 30, TM.painel.fonte);
    const tw = c.measureText(P.sala).width;
    const x0 = (W - tw - 40) / 2;
    c.fillStyle = P.css;
    c.beginPath(); c.arc(x0 + 12, H / 2, 12, 0, Math.PI * 2); c.fill();
    c.fillStyle = TM.placaTinta;
    c.fillText(P.sala, x0 + 40, H / 2 + 3);
    textura.needsUpdate = true;
  };
  desenhar();
  redesenhos.add(desenhar);
  g.userData.liberar = () => { redesenhos.delete(desenhar); textura.dispose(); material.dispose(); };
  return g;
}

// ---------------------------------------------------------------------------
// (b) Console do operador
// ---------------------------------------------------------------------------
// Mesa em pé (topo a 0,64 m, na escala dos astronautas), 2,1 × 0,7 m, centrada
// na origem do grupo. O operador fica do lado -z (de frente para +z, para a
// câmera); os monitores olham para ele. A faixa na cor do provedor corre na
// frente (+z), que é o lado que a câmera vê.
export function criarConsole(provedor = 'anthropic', { largura = 2.1, profundidade = 0.7 } = {}) {
  const P = PROVEDORES[provedor] || PROVEDORES.anthropic;
  const TM = temaDe(provedor), TL = TM.tela;
  const metal = provedor === 'openai' ? { metalness: 0.55, roughness: 0.32 } : undefined;
  const g = new THREE.Group();
  const ALT = 0.64;
  // corpo: dois gabinetes nas pontas e um painel frontal
  caixa(0.5, ALT - 0.05, profundidade - 0.06, TM.corpoConsole, -largura / 2 + 0.27, 0, 0, g);
  caixa(0.5, ALT - 0.05, profundidade - 0.06, TM.corpoConsole, largura / 2 - 0.27, 0, 0, g);
  caixa(largura - 1.0, ALT - 0.17, 0.05, TM.corpoConsole, 0, 0.07, profundidade / 2 - 0.06, g);
  // tampo
  caixa(largura, 0.05, profundidade, TM.tampoConsole, 0, ALT - 0.05, 0, g, { mat: { roughness: provedor === 'openai' ? 0.25 : 0.6 } });
  // faixa na cor do provedor, logo abaixo do tampo, na frente
  caixa(largura - 0.08, 0.035, 0.012, P.cor, 0, ALT - 0.1, profundidade / 2 + 0.002, g,
    { mat: { emissive: P.cor, emissiveIntensity: 0.25, roughness: 0.5 }, sombra: false });
  // gavetas com puxadores
  for (const sx of [-1, 1]) {
    for (const y of [0.16, 0.36]) caixa(0.16, 0.018, 0.02, TM.puxador, sx * (largura / 2 - 0.27), y, profundidade / 2 - 0.02, g, { sombra: false });
  }
  // monitores (olhando para -z, onde fica o operador)
  const telas = [];
  const posicoes = [[-0.62, -0.32], [0, 0], [0.62, 0.32]];
  posicoes.forEach(([x, giro], i) => {
    const m = new THREE.Group();
    m.position.set(x, ALT, 0.12);
    m.rotation.y = Math.PI + giro;
    caixa(0.1, 0.012, 0.08, TM.monitor, 0, 0, 0, m, { mat: metal });
    caixa(0.03, 0.12, 0.03, TM.monitor, 0, 0.01, -0.01, m, { mat: metal });
    caixa(0.5, 0.3, 0.035, TM.monitor, 0, 0.1, -0.02, m);
    const t = telaCanvas(256, 150, 0.46, 0.27);
    t.plano.position.set(0, 0.25, -0.002 + 0.018);
    m.add(t.plano);
    g.add(m);
    telas.push(t);
  });
  // teclado e um mousepad do lado do operador
  caixa(0.46, 0.02, 0.15, C.grafiteClaro, -0.1, ALT, -0.2, g);
  caixa(0.22, 0.006, 0.18, C.grafite, 0.38, ALT, -0.2, g, { sombra: false });
  caixa(0.05, 0.02, 0.08, C.offWhite, 0.38, ALT + 0.006, -0.2, g);
  // plantinha em cima do console (lado da câmera)
  const vaso = new THREE.Group();
  vaso.position.set(largura / 2 - 0.16, ALT, 0.2);
  cilindro(0.06, 0.05, 0.09, provedor === 'openai' ? 0x2b2c30 : C.terracota, 0, 0, 0, vaso, 14);
  for (let i = 0; i < 5; i++) {
    const f = malha(geo('esfera', 0.05, 10, 8, { escala: [0.55, 1.2, 0.3] }), mat(i % 2 ? C.folha : C.folhaClara), 0, 0.14, 0, vaso);
    f.rotation.set(0.5, i * 1.26, 0);
    f.position.set(Math.sin(i * 1.26) * 0.025, 0.13, Math.cos(i * 1.26) * 0.025);
  }
  g.add(vaso);

  // telas: barrinhas dos medidores (esquerda), radar (meio) e linhas de registro (direita)
  let dadosTela = null;
  function desenharBarras() {
    const { ctx: c, canvas, textura } = telas[0];
    c.fillStyle = TL.fundo; c.fillRect(0, 0, canvas.width, canvas.height);
    const ms = dadosTela?.medidores || [];
    c.textBaseline = 'middle';
    ms.slice(0, 4).forEach((m, i) => {
      const y = 26 + i * 32;
      c.fillStyle = TL.tinta;
      c.font = `600 15px ${TM.painel.fonte}`;
      c.textAlign = 'left';
      c.fillText((m.rotulo || '').slice(0, 16), 14, y);
      c.fillStyle = TL.trilho;
      arredondado(c, 140, y - 5, 100, 10, 5); c.fill();
      if (m.pct != null) {
        c.fillStyle = faixaDe(m.pct, provedor).cor;
        arredondado(c, 140, y - 5, Math.max(10, m.pct), 10, 5); c.fill();
      }
    });
    if (!ms.length) {
      c.fillStyle = TL.tinta; c.font = `600 18px ${TM.painel.fonte}`; c.textAlign = 'center';
      c.fillText('sem dados', canvas.width / 2, canvas.height / 2);
    }
    textura.needsUpdate = true;
  }
  (function desenharRadar() {
    const { ctx: c, canvas, textura } = telas[1];
    c.fillStyle = TL.fundo; c.fillRect(0, 0, canvas.width, canvas.height);
    c.strokeStyle = TL.fraca; c.lineWidth = 2;
    for (const r of [20, 42, 64]) { c.beginPath(); c.arc(128, 75, r, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(128, 5); c.lineTo(128, 145); c.moveTo(58, 75); c.lineTo(198, 75); c.stroke();
    c.fillStyle = P.css;
    for (const [a, r] of [[0.7, 40], [2.4, 58], [4.2, 26]]) { c.beginPath(); c.arc(128 + Math.cos(a) * r, 75 + Math.sin(a) * r, 5, 0, Math.PI * 2); c.fill(); }
    textura.needsUpdate = true;
  })();
  (function desenharRegistro() {
    const { ctx: c, canvas, textura } = telas[2];
    c.fillStyle = TL.fundo; c.fillRect(0, 0, canvas.width, canvas.height);
    const rnd = sorteador(provedor === 'openai' ? 77 : 33);
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i === 2 ? P.css : TL.fraca;
      c.globalAlpha = i === 2 ? 1 : 0.7 + rnd() * 0.3;
      arredondado(c, 14 + (i % 3) * 10, 14 + i * 16, 60 + rnd() * 150, 7, 3.5); c.fill();
    }
    c.globalAlpha = 1;
    textura.needsUpdate = true;
  })();
  desenharBarras();
  const redesenho = () => desenharBarras();
  redesenhos.add(redesenho);

  return {
    grupo: g,
    altura: ALT,
    // lugar do operador digitando, no espaço do console
    pontoDigitar: new THREE.Vector3(-0.1, 0, -profundidade / 2 - 0.3),
    atualizar(dados) {
      const k = JSON.stringify((dados?.medidores || []).map(m => [m.rotulo, m.pct == null ? null : Math.round(m.pct)]));
      if (k === this._k) return false;
      this._k = k; dadosTela = dados; desenharBarras();
      return true;
    },
    liberar() { redesenhos.delete(redesenho); for (const t of telas) { t.textura.dispose(); t.material.dispose(); } },
  };
}

// ---------------------------------------------------------------------------
// (c) Operador NPC
// ---------------------------------------------------------------------------
// Astronauta de macacão cinza-azulado, colete escuro com faixa refletiva e um
// distintivo na cor do provedor, capacete cinza-claro com fone e microfone,
// olhos de luz quente e pequenos, sem antena e sem mochila colorida (só uma
// pochete escura nas costas). Mesmas proporções dos agentes (altura ~1,1 antes
// da escala; escala padrão 1,45).
function montarBonecoOperador(provedor) {
  const P = PROVEDORES[provedor] || PROVEDORES.anthropic;
  const g = new THREE.Group();
  const corpo = new THREE.Group();
  g.add(corpo);
  const traje = mat(C.traje, { roughness: 0.8 });
  // pernas e botas
  const pernas = [-0.09, 0.09].map(px => {
    const p = new THREE.Group(); p.position.set(px, 0.3, 0); corpo.add(p);
    malha(geo('capsula', 0.075, 0.12, 4, 12), traje, 0, -0.1, 0, p);
    malha(geo('caixa', 0.15, 0.1, 0.2), mat(C.bota), 0, -0.24, 0.02, p);
    return p;
  });
  // tronco, cinto e colete
  malha(geo('capsula', 0.19, 0.16, 8, 20), traje, 0, 0.43, 0, corpo);
  malha(geo('toro', 0.19, 0.022, 8, 28), mat(C.colete), 0, 0.34, 0, corpo).rotation.x = Math.PI / 2;
  const colete = mat(C.colete, { roughness: 0.85 });
  malha(geo('cilindro', 0.205, 0.2, 0.2, 24, 1, true), colete, 0, 0.46, 0, corpo).material = colete;
  malha(geo('cilindro', 0.207, 0.207, 0.03, 24, 1, true), mat(C.faixaRefletiva, { roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.08 }), 0, 0.44, 0, corpo);
  // bolsos e distintivo do provedor no peito (lado esquerdo do boneco)
  for (const px of [-0.08, 0.08]) malha(geo('caixa', 0.07, 0.06, 0.03), mat(0x4c5a70), px, 0.39, 0.19, corpo);
  malha(geo('caixa', 0.06, 0.045, 0.02), mat(P.cor, { emissive: P.cor, emissiveIntensity: 0.15 }), -0.07, 0.5, 0.2, corpo);
  // pochete nas costas (no lugar da mochila de oxigênio)
  malha(geo('caixa', 0.2, 0.1, 0.08), mat(C.colete), 0, 0.33, -0.2, corpo);
  // braços: macacão, punho do colete e luva
  const bracos = [-1, 1].map(lado => {
    const b = new THREE.Group(); b.position.set(lado * 0.21, 0.54, 0); corpo.add(b);
    malha(geo('capsula', 0.06, 0.13, 4, 10), traje, 0, -0.1, 0, b);
    malha(geo('toro', 0.062, 0.014, 6, 16), mat(C.trajeEscuro), 0, -0.15, 0, b).rotation.x = Math.PI / 2;
    malha(geo('esfera', 0.062, 12, 10), mat(C.luva), 0, -0.22, 0, b);
    b.rotation.z = lado * 0.16;
    return b;
  });
  // capacete
  const cabeca = new THREE.Group(); cabeca.position.set(0, 0.82, 0); corpo.add(cabeca);
  malha(geo('toro', 0.16, 0.035, 10, 28), mat(C.colete), 0, -0.2, 0, cabeca).rotation.x = Math.PI / 2;   // gola
  const PH0 = Math.PI / 2 - Math.PI * 0.38, PHL = Math.PI * 0.76, TH0 = Math.PI * 0.3, THL = Math.PI * 0.36;
  // shadowSide: o casco é DoubleSide e, sem isso, a sombra dele mesmo pisca na nuca quando anda
  const casco = mat(C.capacete, { roughness: 0.4, side: THREE.DoubleSide, shadowSide: THREE.BackSide });
  malha(geo('esfera', 0.285, 40, 28, PH0 + PHL, Math.PI * 2 - PHL), casco, 0, 0, 0, cabeca);
  malha(geo('esfera', 0.285, 20, 10, PH0, PHL, 0, TH0), casco, 0, 0, 0, cabeca);
  malha(geo('esfera', 0.285, 20, 10, PH0, PHL, TH0 + THL, Math.PI - TH0 - THL), casco, 0, 0, 0, cabeca);
  malha(geo('esfera', 0.28, 32, 20, PH0, PHL, TH0, THL), mat(C.viseira, { roughness: 0.15, metalness: 0.5 }), 0, 0, 0, cabeca);
  malha(geo('esfera', 0.045, 12, 8, { escala: [1.6, 0.6, 0.3] }), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.4, transparent: true, opacity: 0.6 }), -0.09, 0.07, 0.265, cabeca, false);
  // olhos: luz quente, redondos e menores que os dos agentes (material exclusivo, pisca)
  const matOlhos = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: 1.1, roughness: 0.4 });
  const olhos = [-0.07, 0.07].map(px => malha(geo('esfera', 0.024, 10, 8), matOlhos, px, -0.015, 0.268, cabeca, false));
  // fone: arco por cima, conchas dos lados e microfone na frente
  malha(geo('toro', 0.312, 0.016, 6, 28, Math.PI), mat(C.fone), 0, 0.0, -0.02, cabeca);   // arco de orelha a orelha, afastado do casco (encostado, piscava)
  for (const lado of [-1, 1]) {
    const c = malha(geo('cilindro', 0.075, 0.075, 0.05, 16), mat(C.fone), lado * 0.295, -0.02, -0.02, cabeca);
    c.rotation.z = Math.PI / 2;
    malha(geo('cilindro', 0.05, 0.05, 0.02, 14), mat(0x4a505c), lado * 0.325, -0.02, -0.02, cabeca).rotation.z = Math.PI / 2;
  }
  const haste = malha(geo('cilindro', 0.008, 0.008, 0.2, 6), mat(C.fone), -0.29, -0.1, 0.1, cabeca);
  haste.rotation.set(Math.PI / 2 - 0.35, 0, 0.25);
  malha(geo('esfera', 0.022, 10, 8), mat(P.cor, { emissive: P.cor, emissiveIntensity: 0.4 }), -0.25, -0.14, 0.2, cabeca);

  // objetos de mão, os dois na mão esquerda: nos pontos do café e da prancheta ele
  // fica de frente para +x e a mão esquerda é a do lado da câmera (aparecem nas ações)
  const caneca = new THREE.Group();
  caneca.position.set(0, -0.27, 0.03);
  malha(geo('cilindro', 0.045, 0.04, 0.1, 14), mat(C.offWhite, { roughness: 0.5 }), 0, 0, 0, caneca);
  malha(geo('toro', 0.026, 0.008, 6, 10, Math.PI), mat(C.offWhite, { roughness: 0.5 }), -0.045, 0.0, 0, caneca).rotation.z = Math.PI / 2;
  malha(geo('cilindro', 0.038, 0.038, 0.004, 12), mat(0x5a3a26), 0, 0.045, 0, caneca, false);
  caneca.visible = false;
  bracos[0].add(caneca);
  const prancheta = new THREE.Group();
  prancheta.position.set(0.02, -0.26, 0.06);
  caixa(0.2, 0.012, 0.27, C.madeiraClara, 0, -0.006, 0, prancheta);
  caixa(0.17, 0.004, 0.22, 0xf7f3ea, 0, 0.006, 0.015, prancheta, { sombra: false });
  caixa(0.08, 0.02, 0.03, C.grafiteClaro, 0, 0.006, -0.12, prancheta, { sombra: false });
  for (let i = 0; i < 4; i++) caixa(0.11 - (i % 2) * 0.03, 0.002, 0.008, 0x9aa3b5, -0.02, 0.009, -0.06 + i * 0.04, prancheta, { sombra: false });
  prancheta.visible = false;
  bracos[0].add(prancheta);

  // hitbox (mesmo raio dos agentes), caso o hud queira mostrar "Operador da sala"
  const hb = new THREE.Mesh(geo('cilindro', 0.4, 0.4, 1.3, 12), new THREE.MeshBasicMaterial({ visible: false }));
  hb.position.y = 0.65;
  hb.userData.hitbox = true;
  g.add(hb);
  return { g, corpo, pernas, bracos, cabeca, olhos, caneca, prancheta, matOlhos, hitbox: hb };
}

// Ações do operador e quanto duram (segundos, mínimo e máximo)
const ACOES = {
  olhar: [4, 7.5],       // olha um painel, mãos para trás, cabeça varrendo
  apontar: [2.6, 4],     // aponta para um medidor
  digitar: [6, 10],      // digita no console, de vez em quando ergue os olhos
  cafe: [6, 9],          // toma café no aparador (goles a cada ~2,5 s)
  prancheta: [5, 8],     // confere a prancheta e anota
  alongar: [2.2, 3],     // espreguiça (entre uma tarefa e outra)
};
const RAPIDEZ = 12;          // mistura das poses (igual aos agentes)
const VELOCIDADE = 0.8;      // m/s andando
const PASSADA = 0.39;        // passada útil na escala 1,45 (contrato de personagens.js)

// opc: { semente, escala, ritmo (multiplica a duração das ações), pontos: { nome:
//        { pos: Vector3, olhar: rad } }, tarefas: [{ acao, ponto, peso }],
//        caminho(de, para) -> [Vector3...] }
// Cada operador tem a própria semente, o próprio ritmo e o próprio conjunto de
// tarefas (montarSalaControle, PERFIS): dois operadores nunca fazem a mesma coisa em
// sincronia por construção.
// Sem pontos, o operador faz as ações no lugar, em ciclo.
// Devolve { grupo, atualizar(dt), estado(), liberar }.
export function criarOperador(provedor = 'anthropic', opc = {}) {
  const b = montarBonecoOperador(provedor);
  const escala = opc.escala ?? 1.45;
  const ritmo = opc.ritmo ?? 1;
  b.g.scale.setScalar(escala);
  b.g.userData.npc = true;   // fora do mapa de caminhos e do hover dos agentes
  const rnd = sorteador(opc.semente ?? (provedor === 'openai' ? 911 : 417));
  const pontos = opc.pontos || null;
  const tarefas = opc.tarefas || Object.keys(ACOES).filter(a => a !== 'alongar').map(acao => ({ acao, ponto: null, peso: 1 }));
  const caminho = opc.caminho || ((de, para) => [para.clone()]);

  // animação (canais misturados como em personagens.js)
  const CAN = ['pe0', 'pe1', 'bx0', 'bx1', 'bz0', 'bz1', 'cy', 'kx', 'ky', 'kz', 'cx'];
  const alvo = {}, atual = {}, desvio = {};
  for (const c of CAN) alvo[c] = atual[c] = desvio[c] = 0;
  const baseZ = b.bracos.map(x => x.rotation.z);
  let chave = null, t = 0, passo = 0;
  const fase = rnd() * 10;

  // rotina
  let tarefa = null, ultima = null, estadoR = 'parado', rota = [], timer = 0, durAcao = 0, inicioAcao = 0;
  let olharAlvo = 0, alongarDepois = false;
  const pos = b.g.position;

  function sortearTarefa() {
    const cands = tarefas.filter(x => x.acao !== ultima?.acao || (x.ponto && x.ponto !== ultima?.ponto && x.acao === 'olhar'))
      .filter(x => !(ultima && x.acao === ultima.acao && x.ponto === ultima.ponto));
    const total = cands.reduce((s, x) => s + (x.peso ?? 1), 0);
    let r = rnd() * total;
    for (const x of cands) { r -= x.peso ?? 1; if (r <= 0) return x; }
    return cands[cands.length - 1];
  }
  function iniciar(x) {
    tarefa = x;
    const p = x.ponto && pontos?.[x.ponto];
    if (p) {
      rota = caminho(pos.clone(), p.pos.clone());
      olharAlvo = p.olhar;
      estadoR = rota.length ? 'andando' : 'virando';
    } else {
      rota = [];
      estadoR = 'virando';
    }
    if (estadoR === 'andando') return;
    comecarAcao();
  }
  function comecarAcao() {
    estadoR = 'agindo';
    const [a, z] = ACOES[tarefa.acao];
    durAcao = (a + rnd() * (z - a)) * ritmo;
    inicioAcao = t;
    timer = 0;
  }
  function proxima() {
    if (tarefa.acao !== 'alongar') ultima = tarefa;
    // às vezes espreguiça no lugar antes de seguir (pausa natural)
    if (!alongarDepois && tarefa.acao !== 'alongar' && rnd() < 0.18) {
      alongarDepois = true;
      tarefa = { acao: 'alongar', ponto: null };
      comecarAcao();
      return;
    }
    alongarDepois = false;
    iniciar(sortearTarefa());
  }

  const angDif = (a, b2) => { let d = (b2 - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

  function pose(acao, andando) {
    alvo.pe0 = alvo.pe1 = 0; alvo.bx0 = alvo.bx1 = 0;
    alvo.bz0 = baseZ[0]; alvo.bz1 = baseZ[1];
    alvo.cy = 0; alvo.cx = 0; alvo.kx = 0; alvo.ky = 0; alvo.kz = 0;
    const u = t - inicioAcao;
    if (andando) {
      const f = passo + fase;
      alvo.pe0 = Math.sin(f) * 0.55; alvo.pe1 = -Math.sin(f) * 0.55;
      alvo.bx0 = -Math.sin(f) * 0.5; alvo.bx1 = Math.sin(f) * 0.5;
      alvo.cy = Math.abs(Math.sin(f)) * 0.04;
      alvo.kx = 0.04;
      return;
    }
    switch (acao) {
      case 'olhar':
        // mãos para trás, cabeça erguida, varrendo devagar; de vez em quando acena que sim
        alvo.bx0 = alvo.bx1 = 0.5;
        alvo.bz0 = baseZ[0] + 0.12; alvo.bz1 = baseZ[1] - 0.12;
        alvo.kx = -0.2 + (Math.sin(u * 0.9 + fase) > 0.93 ? 0.12 : 0);
        alvo.ky = Math.sin(u * 0.55 + fase) * 0.28;
        alvo.cx = Math.sin(u * 0.4) * 0.01;
        break;
      case 'apontar': {
        const e = Math.min(1, u / 0.35);
        alvo.bx1 = -1.75 * e + Math.sin(u * 5) * 0.06 * e;
        alvo.bz1 = baseZ[1] - 0.05 * e;
        alvo.bx0 = 0.2; alvo.bz0 = baseZ[0] - 0.1;   // mão na cintura
        alvo.kx = -0.25; alvo.ky = Math.sin(u * 1.2) * 0.08;
        break;
      }
      case 'digitar': {
        alvo.bx0 = -1.15 + Math.sin(t * 20 + fase) * 0.09;
        alvo.bx1 = -1.15 + Math.sin(t * 20 + fase + 1.6) * 0.09;
        alvo.bz0 = baseZ[0] + 0.12; alvo.bz1 = baseZ[1] - 0.12;
        const ergue = Math.sin(u * 0.7 + fase) > 0.75;   // ergue os olhos para o mural
        alvo.kx = ergue ? -0.12 : 0.24;
        alvo.ky = ergue ? Math.sin(u * 0.5) * 0.15 : 0;
        alvo.cx = 0.03;
        break;
      }
      case 'cafe': {
        // segura a caneca (mão esquerda) no peito e dá um gole a cada ~2,6 s
        const ciclo = (u + 0.8) % 2.6, gole = ciclo < 0.9 ? Math.sin(Math.PI * ciclo / 0.9) : 0;
        alvo.bx0 = -0.95 - gole * 1.35;
        alvo.bz0 = baseZ[0] + 0.22 + gole * 0.12;
        alvo.kx = -0.2 * gole + 0.05;
        alvo.ky = (1 - gole) * Math.sin(u * 0.6) * 0.2;
        alvo.bx1 = 0.05;
        break;
      }
      case 'prancheta':
        alvo.bx0 = -1.15; alvo.bz0 = baseZ[0] + 0.42;
        alvo.bx1 = -1.0 + Math.sin(t * 9) * 0.05; alvo.bz1 = baseZ[1] - 0.3 + Math.sin(t * 3.1) * 0.05;
        alvo.kx = 0.32 + Math.sin(u * 0.8) * 0.04;
        alvo.ky = Math.sin(u * 0.45) * 0.08;
        break;
      case 'alongar': {
        const e = u < 0.5 ? u / 0.5 : u < durAcao - 0.6 ? 1 : Math.max(0, (durAcao - u) / 0.6);
        const s = e * e * (3 - 2 * e);
        alvo.bx0 = alvo.bx1 = -2.7 * s;
        alvo.bz0 = baseZ[0] - 0.15 * s; alvo.bz1 = baseZ[1] + 0.15 * s;
        alvo.kx = -0.2 * s; alvo.cy = 0.015 * s;
        break;
      }
      case 'sentar':   // cochilo (F1): coxas para a frente, mãos no colo, cabeça baixa
        alvo.pe0 = alvo.pe1 = -1.45;
        alvo.bx0 = alvo.bx1 = -0.5;
        alvo.kx = 0.22;
        break;
      default:
        alvo.ky = Math.sin(t * 0.4 + fase) * 0.15;
    }
  }

  // piscar
  let proxPisc = 1 + rnd() * 3;
  function fatorPiscada() {
    if (t > proxPisc + 0.14) proxPisc = t + 2.5 + rnd() * 3.5;
    if (t < proxPisc) return 1;
    return 1 - 0.9 * Math.sin(Math.PI * (t - proxPisc) / 0.14);
  }

  // Cochilo (F1): com a estação parada há mais de 1 min, vai até o banquinho (que
  // aparece na hora, ao lado do café), senta e para; acorda quando alguém trabalha.
  // opc.cochilo = { entrada, pos, olhar, y, banco }
  const coch = opc.cochilo || null;
  let querDormir = false, cochilo = null, kBanco = 0;   // cochilo: null | 'indo' | 'sentando' | 'dormindo' | 'levantando'
  let cochDesde = 0;
  if (coch?.banco) { coch.banco.scale.setScalar(0.001); coch.banco.userData.semMapa = true; }
  function definirCochilo(sim) { querDormir = !!sim && !!coch; }

  let andou = false;
  function atualizar(dt) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    t += dt;
    andou = false;
    if (coch?.banco) {
      const alvoB = cochilo === 'sentando' || cochilo === 'dormindo' || cochilo === 'levantando' || (cochilo === 'indo' && rota.length <= 1) ? 1 : 0;
      if (Math.abs(alvoB - kBanco) > 0.002) { kBanco += (alvoB - kBanco) * Math.min(1, dt * 7); coch.banco.scale.setScalar(Math.max(0.001, kBanco)); }
    }
    if (cochilo === 'dormindo') {
      if (querDormir) return false;
      cochilo = 'levantando'; cochDesde = t;
    }
    if (querDormir && !cochilo) {
      cochilo = 'indo';
      tarefa = { acao: 'parado', ponto: null };
      rota = caminho(pos.clone(), coch.entrada.clone());
      olharAlvo = coch.olhar;
      estadoR = rota.length ? 'andando' : 'virando';
    }
    if (cochilo === 'indo' && !querDormir) { cochilo = null; tarefa = null; }
    if (cochilo === 'indo' && estadoR !== 'andando') { cochilo = 'sentando'; cochDesde = t; tarefa = { acao: 'sentar', ponto: null }; estadoR = 'agindo'; }
    if (cochilo === 'sentando' || cochilo === 'levantando') {
      const u = Math.min(1, (t - cochDesde) / 0.7), e = u * u * (3 - 2 * u);
      const k = cochilo === 'sentando' ? e : 1 - e;
      pos.x = coch.entrada.x + (coch.pos.x - coch.entrada.x) * k;
      pos.z = coch.entrada.z + (coch.pos.z - coch.entrada.z) * k;
      pos.y = coch.y * k;
      b.g.rotation.y += angDif(b.g.rotation.y, coch.olhar) * (1 - Math.exp(-dt * 8));
      tarefa = { acao: k > 0.3 ? 'sentar' : 'parado', ponto: null };
      if (u >= 1) {
        if (cochilo === 'sentando' && kBanco > 0.98) cochilo = 'dormindo';
        else if (cochilo === 'levantando') { cochilo = null; pos.y = 0; tarefa = null; }
      }
      andou = true;
    }
    if (!tarefa) iniciar(sortearTarefa());

    if (estadoR === 'andando') {
      const alvoP = rota[0];
      const dx = alvoP.x - pos.x, dz = alvoP.z - pos.z, dist = Math.hypot(dx, dz);
      const ang = Math.atan2(dx, dz);
      const dA = angDif(b.g.rotation.y, ang);
      b.g.rotation.y += dA * (1 - Math.exp(-dt * 10));
      // só anda bem quando já está mais ou menos virado para onde vai
      const v = VELOCIDADE * Math.max(0.25, Math.cos(Math.min(Math.PI / 2, Math.abs(dA))));
      const d = Math.min(dist, v * dt);
      if (dist > 1e-4) { pos.x += dx / dist * d; pos.z += dz / dist * d; }
      passo += d / (PASSADA * escala / 1.45) * Math.PI;
      andou = d > 0;
      if (dist - d < 0.01) {
        rota.shift();
        if (!rota.length) estadoR = 'virando';
      }
    } else if (estadoR === 'virando') {
      const dA = angDif(b.g.rotation.y, olharAlvo);
      b.g.rotation.y += dA * (1 - Math.exp(-dt * 8));
      if (Math.abs(dA) < 0.05 || !tarefa.ponto) comecarAcao();
    } else if (estadoR === 'agindo' && !cochilo) {
      timer += dt;
      if (tarefa.ponto && pontos?.[tarefa.ponto]) {
        const dA = angDif(b.g.rotation.y, olharAlvo);
        b.g.rotation.y += dA * (1 - Math.exp(-dt * 6));
      }
      if (timer >= durAcao) proxima();
    }

    const acao = tarefa?.acao;
    pose(acao, estadoR === 'andando');
    const novaChave = (estadoR === 'andando' ? 'andar' : acao) || '';
    const k = Math.exp(-dt * RAPIDEZ);
    if (chave === null) for (const c of CAN) desvio[c] = 0;
    else if (novaChave !== chave) for (const c of CAN) desvio[c] = (atual[c] - alvo[c]) * k;
    else for (const c of CAN) desvio[c] *= k;
    chave = novaChave;
    for (const c of CAN) atual[c] = alvo[c] + desvio[c];

    b.pernas[0].rotation.x = atual.pe0; b.pernas[1].rotation.x = atual.pe1;
    b.bracos[0].rotation.x = atual.bx0; b.bracos[1].rotation.x = atual.bx1;
    b.bracos[0].rotation.z = atual.bz0; b.bracos[1].rotation.z = atual.bz1;
    b.corpo.position.y = atual.cy;
    b.corpo.rotation.x = atual.cx;
    b.cabeca.rotation.set(atual.kx, atual.ky, atual.kz);
    // caneca e prancheta só aparecem na ação delas (e ficam niveladas com o chão)
    b.caneca.visible = estadoR === 'agindo' && acao === 'cafe';
    b.caneca.rotation.x = -atual.bx0;
    b.caneca.rotation.z = -atual.bz0;
    b.prancheta.visible = estadoR === 'agindo' && acao === 'prancheta';
    b.prancheta.rotation.x = -atual.bx0 - 0.75;
    b.prancheta.rotation.z = -atual.bz0;
    const pisc = fatorPiscada();
    for (const o of b.olhos) o.scale.set(1, pisc * (acao === 'prancheta' && estadoR === 'agindo' ? 0.75 : 1), 1);
    return andou;
  }

  return {
    grupo: b.g,
    hitbox: b.hitbox,
    atualizar,
    // para conferência: o que ele está fazendo agora
    estado: () => ({ acao: tarefa?.acao ?? null, ponto: tarefa?.ponto ?? null, fase: estadoR, x: +pos.x.toFixed(2), z: +pos.z.toFixed(2) }),
    // pula para a próxima ação (testes)
    pular: () => { if (tarefa) proxima(); },
    definirCochilo, dormindo: () => cochilo === 'dormindo',
    liberar() { b.matOlhos.dispose(); b.hitbox.material.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Caminhos dentro da sala: grafo de visibilidade sobre os retângulos dos móveis
// ---------------------------------------------------------------------------
function cruzaRet(a, b2, r) {
  // Liang-Barsky: o segmento a-b2 entra no retângulo r ({ x0, x1, z0, z1 })?
  let t0 = 0, t1 = 1;
  const dx = b2.x - a.x, dz = b2.z - a.z;
  const testes = [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dz, a.z - r.z0], [dz, r.z1 - a.z]];
  for (const [p, q] of testes) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const u = q / p;
    if (p < 0) { if (u > t1) return false; if (u > t0) t0 = u; }
    else { if (u < t0) return false; if (u < t1) t1 = u; }
  }
  return t1 - t0 > 1e-6;
}
function criarCaminho(obstaculos, limites, folga = 0.34) {
  const rets = obstaculos.map(o => ({ x0: o.x - o.w / 2 - folga, x1: o.x + o.w / 2 + folga, z0: o.z - o.d / 2 - folga, z1: o.z + o.d / 2 + folga }));
  const dentro = p => p.x > limites.x0 && p.x < limites.x1 && p.z > limites.z0 && p.z < limites.z1 && !rets.some(r => p.x > r.x0 + 1e-3 && p.x < r.x1 - 1e-3 && p.z > r.z0 + 1e-3 && p.z < r.z1 - 1e-3);
  const nos = [];
  for (const r of rets) for (const [x, z] of [[r.x0 - 0.02, r.z0 - 0.02], [r.x1 + 0.02, r.z0 - 0.02], [r.x0 - 0.02, r.z1 + 0.02], [r.x1 + 0.02, r.z1 + 0.02]]) {
    const p = new THREE.Vector3(x, 0, z);
    if (dentro(p)) nos.push(p);
  }
  const livre = (a, b2) => !rets.some(r => cruzaRet(a, b2, r));
  return (de, para) => {
    if (livre(de, para)) return [para];
    const todos = [de, ...nos, para];
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
        if (d < dist[v] && livre(todos[u], todos[v])) { dist[v] = d; ant[v] = u; }
      }
    }
    if (ant[n - 1] < 0) return [para];   // sem saída: vai reto (não deveria acontecer)
    const r = [];
    for (let i = n - 1; i > 0; i = ant[i]) r.unshift(todos[i]);
    return r;
  };
}

// ---------------------------------------------------------------------------
// Peças de apoio: aparador do café, púlpito da prancheta, globo, estante baixa
// ---------------------------------------------------------------------------
function aparadorCafe(provedor) {
  const TM = temaDe(provedor);
  const g = new THREE.Group();   // frente em +z do grupo
  caixa(1.0, 0.6, 0.42, TM.aparador, 0, 0, 0, g);
  caixa(1.04, 0.04, 0.46, TM.tampo, 0, 0.6, 0, g);
  for (const x of [-0.25, 0.25]) caixa(0.12, 0.018, 0.02, TM.puxador, x, 0.42, 0.215, g, { sombra: false });
  // cafeteira
  caixa(0.24, 0.32, 0.22, C.grafite, -0.25, 0.64, -0.04, g);
  caixa(0.2, 0.04, 0.1, C.grafiteClaro, -0.25, 0.68, 0.08, g);
  cilindro(0.055, 0.05, 0.13, 0x5f6878, -0.25, 0.72, 0.06, g, 14);
  malha(geo('esfera', 0.014, 8, 6), mat(PROVEDORES[provedor].cor, { emissive: PROVEDORES[provedor].cor, emissiveIntensity: 0.8 }), -0.18, 0.92, 0.075, g, false);
  // canecas e açucareiro
  const canecas = provedor === 'openai' ? [C.offWhite, 0x2b2c30, 0xd9dbdd] : [C.offWhite, 0xc98b6b, 0x9fb59a];
  for (const [x, z, c] of [[0.08, 0.06, canecas[0]], [0.2, -0.05, canecas[1]], [0.32, 0.08, canecas[2]]]) cilindro(0.04, 0.036, 0.09, c, x, 0.64, z, g, 14);
  cilindro(0.05, 0.05, 0.07, C.linho, 0.42, 0.64, -0.1, g, 14);
  return g;
}
function pulpito(provedor) {
  const TM = temaDe(provedor);
  const g = new THREE.Group();
  cilindro(0.16, 0.18, 0.03, TM.moldura, 0, 0, 0, g);
  cilindro(0.03, 0.03, 0.6, provedor === 'openai' ? TM.travessa : TM.moldura, 0, 0.03, 0, g, 10);
  const tampo = caixa(0.34, 0.03, 0.28, TM.tampo, 0, 0.63, 0, g);
  tampo.rotation.x = 0;
  // uma segunda prancheta guardada (a que ele usa aparece na mão)
  caixa(0.2, 0.012, 0.27, C.madeiraClara, 0.02, 0.66, 0, g);
  caixa(0.17, 0.004, 0.22, 0xf7f3ea, 0.02, 0.672, 0.015, g, { sombra: false });
  return g;
}
// OpenAI: armário baixo preto com tampo de vidro fosco e pés de metal (no lugar da estante)
function armarioVidro() {
  const g = new THREE.Group();   // comprido no eixo z, frente para +x
  for (const z of [-0.55, 0.55]) for (const x of [-0.12, 0.12]) cilindro(0.015, 0.015, 0.12, 0xb7bbc0, x, 0, z, g, 8);
  caixa(0.36, 0.42, 1.3, 0x1e1f22, 0, 0.12, 0, g, { mat: { roughness: 0.35 } });
  caixa(0.38, 0.32, 1.32, 0xdfe6ea, 0, 0.54, 0, g, { mat: { roughness: 0.15, transparent: true, opacity: 0.45 } });
  caixa(0.4, 0.02, 1.34, 0xb7bbc0, 0, 0.86, 0, g, { mat: { metalness: 0.6, roughness: 0.3 } });
  // dentro do vidro: dois blocos lisos (arquivos) e uma peça branca
  caixa(0.22, 0.22, 0.3, 0xf2f3f4, 0, 0.56, -0.35, g, { sombra: false });
  caixa(0.22, 0.16, 0.22, 0x2b2c30, 0, 0.56, 0.3, g, { sombra: false });
  return g;
}
// OpenAI: escultura de metal escovado num pedestal preto, com um anel de luz verde-água
function escultura(provedor) {
  const g = new THREE.Group();
  caixa(0.42, 0.62, 0.42, 0x1b1c1e, 0, 0, 0, g, { mat: { roughness: 0.3 } });
  const esfera = malha(geo('esfera', 0.2, 28, 20), mat(0xc4c8cd, { metalness: 0.75, roughness: 0.28 }), 0, 0.84, 0, g);
  const anel = malha(geo('toro', 0.27, 0.008, 6, 40), mat(PROVEDORES[provedor].cor, { emissive: PROVEDORES[provedor].cor, emissiveIntensity: 0.7 }), 0, 0.84, 0, g, false);
  anel.rotation.x = Math.PI / 2 - 0.35;
  g.userData.girar = dt => { anel.rotation.z += dt * 0.25; esfera.rotation.y += dt * 0.08; };
  return g;
}
// Anthropic: escultura de cerâmica (formas orgânicas empilhadas) num pedestal de pedra
// clara, com anel de luz coral girando (par da escultura de metal da OpenAI)
function esculturaCeramica(provedor) {
  const g = new THREE.Group();
  caixa(0.42, 0.62, 0.42, 0xd9c7b0, 0, 0, 0, g, { mat: { roughness: 0.5 } });
  const forma = new THREE.Group();
  forma.position.y = 0.62;
  g.add(forma);
  malha(geo('esfera', 0.17, 24, 16, { escala: [1, 0.55, 1] }), mat(0xc07a55, { roughness: 0.55 }), 0, 0.09, 0, forma);
  malha(geo('esfera', 0.12, 24, 16, { escala: [1, 0.75, 1] }), mat(0xe9dcc6, { roughness: 0.6 }), 0.02, 0.24, 0, forma);
  malha(geo('esfera', 0.07, 20, 14), mat(0x8f5a3e, { roughness: 0.5 }), -0.01, 0.37, 0, forma);
  const anel = malha(geo('toro', 0.27, 0.008, 6, 40), mat(PROVEDORES[provedor].cor, { emissive: PROVEDORES[provedor].cor, emissiveIntensity: 0.7 }), 0, 0.84, 0, g, false);
  anel.rotation.x = Math.PI / 2 - 0.35;
  g.userData.girar = dt => { anel.rotation.z += dt * 0.25; forma.rotation.y += dt * 0.08; };
  return g;
}
// Anthropic: armário baixo de grafite quente, vidro fosco e tampo de bronze (par do armário de vidro)
function armarioQuente() {
  const g = new THREE.Group();   // comprido no eixo z, frente para +x
  for (const z of [-0.55, 0.55]) for (const x of [-0.12, 0.12]) cilindro(0.015, 0.015, 0.12, 0xb08d6a, x, 0, z, g, 8);
  caixa(0.36, 0.42, 1.3, 0x3a322c, 0, 0.12, 0, g, { mat: { roughness: 0.45 } });
  caixa(0.38, 0.32, 1.32, 0xf1e4d4, 0, 0.54, 0, g, { mat: { roughness: 0.2, transparent: true, opacity: 0.45 } });
  caixa(0.4, 0.02, 1.34, 0xb08d6a, 0, 0.86, 0, g, { mat: { metalness: 0.5, roughness: 0.35 } });
  caixa(0.22, 0.2, 0.28, 0xe9dcc6, 0, 0.56, -0.35, g, { sombra: false });
  caixa(0.22, 0.14, 0.22, 0xc07a55, 0, 0.56, 0.3, g, { sombra: false });
  return g;
}
// Anthropic: trio de vasos de cerâmica (em cima do armário)
function vasosCeramica(pai, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  cilindro(0.07, 0.09, 0.22, 0xc07a55, 0, 0, -0.45, g, 16);
  malha(geo('esfera', 0.1, 16, 12, { escala: [1, 0.85, 1] }), mat(0xe9dcc6, { roughness: 0.8 }), 0, 0.09, -0.15, g);
  cilindro(0.05, 0.06, 0.16, 0x8f5a3e, 0, 0, 0.5, g, 14);
  pai.add(g);
  return g;
}

function plantaGrande(x, z, esc, pai, tipo = 'folhaLarga', cor = C.offWhite) {
  if (Pecas?.planta) {
    try { return Pecas.planta(x, z, esc, cor, tipo, pai); } catch (e) { /* cai na própria */ }
  }
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.scale.setScalar(esc); pai.add(g);
  cilindro(0.2, 0.15, 0.4, cor, 0, 0, 0, g);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4;
    const f = malha(geo('esfera', 0.16, 12, 8, { escala: [0.5, 1.5, 0.25] }), mat(i % 2 ? C.folha : C.folhaClara), Math.cos(a) * 0.1, 0.75 + (i % 3) * 0.12, Math.sin(a) * 0.1, g);
    f.rotation.set(Math.cos(a) * 0.6, a, Math.sin(a) * 0.6);
  }
  return g;
}
function pendenteSala(x, z, pai, provedor = 'anthropic') {
  const TM = temaDe(provedor);
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  // sem fio e sem luminária pendurada (03/10: sem teto na vista, peça pendurada flutua e
  // entra na frente dos capacetes); fica só a poça de luz no chão
  void TM;
  // poça de luz macia no chão
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  const tom = provedor === 'openai' ? '235,240,255' : '255,220,170';
  gr.addColorStop(0, `rgba(${tom},1)`); gr.addColorStop(1, `rgba(${tom},0)`);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
  const tx = new THREE.CanvasTexture(c);
  const poca = new THREE.Mesh(geo('plano', 2.6, 2.6), new THREE.MeshBasicMaterial({ map: tx, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }));
  poca.rotation.x = -Math.PI / 2;
  poca.position.y = 0.012;
  poca.castShadow = poca.receiveShadow = false;
  g.add(poca);
  g.userData.liberar = () => { tx.dispose(); poca.material.dispose(); };
  pai.add(g);
  return g;
}

// ---------------------------------------------------------------------------
// (d) Sala de controle inteira
// ---------------------------------------------------------------------------
export const SALA = { largura: 4.6, profundidade: 6.8, porta: { x: 1.35, vao: 1.6 } };

// Rotina de cada operador (independentes: semente, ritmo, pesos, ponto de partida)
const PERFIS = {
  anthropic: {
    semente: 417, ritmo: 1.12, inicio: 'console',
    tarefas: [
      { acao: 'olhar', ponto: 'painelEsq', peso: 1.0 },
      { acao: 'olhar', ponto: 'painelDir', peso: 0.8 },
      { acao: 'olhar', ponto: 'lateral', peso: 0.5 },
      { acao: 'apontar', ponto: 'painelEsq', peso: 0.6 },
      { acao: 'digitar', ponto: 'console', peso: 1.1 },
      { acao: 'cafe', ponto: 'cafe', peso: 1.0 },
      { acao: 'prancheta', ponto: 'prancheta', peso: 1.1 },
      { acao: 'prancheta', ponto: 'estante', peso: 0.8 },   // lendo junto da estante de livros
    ],
  },
  openai: {
    semente: 911, ritmo: 0.86, inicio: 'painelDir',
    tarefas: [
      { acao: 'olhar', ponto: 'painelEsq', peso: 1.3 },
      { acao: 'olhar', ponto: 'painelDir', peso: 1.2 },
      { acao: 'olhar', ponto: 'lateral', peso: 0.9 },
      { acao: 'apontar', ponto: 'painelDir', peso: 0.8 },
      { acao: 'apontar', ponto: 'lateral', peso: 0.4 },
      { acao: 'digitar', ponto: 'console', peso: 1.9 },
      { acao: 'cafe', ponto: 'cafe', peso: 0.5 },
      { acao: 'prancheta', ponto: 'prancheta', peso: 0.5 },
    ],
  },
};

export function montarSalaControle(provedor = 'anthropic', opc = {}) {
  const P = PROVEDORES[provedor] || PROVEDORES.anthropic;
  const TM = temaDe(P.id), openai = P.id === 'openai';
  const W = opc.largura ?? SALA.largura, D = opc.profundidade ?? SALA.profundidade;
  const lado = opc.lado ?? (opc.casca === 'n' ? 'n' : 's');
  const sala = new THREE.Group();
  sala.name = 'sala-controle-' + P.id;
  const liberaveis = [];
  const obstaculos = [];
  const zFundo = -D / 2;

  // casca própria (vitrine): piso e divisórias como as de layout.js
  if (opc.casca) {
    if (Pecas?.piso) {
      try { Pecas.piso(W, D, C.piso, 0, 0, sala); } catch { caixa(W, 0.06, D, C.piso, 0, -0.06, 0, sala, { sombra: false }); }
    } else caixa(W, 0.06, D, C.piso, 0, -0.06, 0, sala, { sombra: false });
    const ALT_DIV = 0.9;
    caixa(0.14, ALT_DIV, D, C.divisoria, -W / 2, 0, 0, sala);
    if (lado === 'n') {
      caixa(W, 2.8, 0.2, 0xe9e3da, 0, 0, zFundo - 0.1, sala);
      caixa(W - 0.02, 0.08, 0.03, 0xd9cfc0, 0, 0, zFundo + 0.015, sala, { sombra: false });
    } else {
      // divisória do corredor com a porta (x de 0,55 a 2,15)
      const a = SALA.porta.x - SALA.porta.vao / 2 + W / 2, bb = W / 2 - (SALA.porta.x + SALA.porta.vao / 2);
      if (a > 0.02) caixa(a, ALT_DIV, 0.14, C.divisoria, -W / 2 + a / 2, 0, zFundo, sala);
      if (bb > 0.02) caixa(bb, ALT_DIV, 0.14, C.divisoria, W / 2 - bb / 2, 0, zFundo, sala);
      caixa(W, 0.42, 0.12, C.divisoria, 0, 0, D / 2 - 0.06, sala);   // parapeito baixo na frente
    }
  }

  // mural de telas: móvel solto de x -2,12 a 0,5 (no sul, deixa a porta livre)
  const mural = new THREE.Group();
  const xm0 = -W / 2 + 0.18, xm1 = SALA.porta.x - SALA.porta.vao / 2 - 0.05;
  const muralL = xm1 - xm0, muralX = (xm0 + xm1) / 2, zMural = zFundo + 0.36;
  mural.position.set(muralX, 0, zMural);
  sala.add(mural);
  const metal = openai ? { metalness: 0.6, roughness: 0.3 } : { metalness: 0.5, roughness: 0.35 };   // aço (OpenAI) ou bronze (Anthropic)
  caixa(muralL, 0.62, 0.42, TM.aparador, 0, 0, 0, mural);                             // aparador de baixo
  caixa(muralL + 0.04, 0.035, 0.46, TM.tampo, 0, 0.62, 0, mural, { mat: openai ? { roughness: 0.25 } : undefined });
  for (let i = 0; i < 4; i++) caixa(0.16, 0.018, 0.02, TM.puxador, -muralL / 2 + muralL * (i + 0.5) / 4, 0.45, 0.215, mural, { sombra: false, mat: metal });
  caixa(0.08, 2.56, 0.1, TM.colunaMural, -muralL / 2 + 0.04, 0.0, -0.12, mural);     // colunas
  caixa(0.08, 2.56, 0.1, TM.colunaMural, muralL / 2 - 0.04, 0.0, -0.12, mural);
  caixa(muralL - 0.08, 1.86, 0.05, TM.fundoMural, 0, 0.66, -0.15, mural);             // fundo atrás das telas (creme ou grafite)
  caixa(muralL, 0.06, 0.12, TM.travessa, 0, 2.52, -0.12, mural, { mat: metal });     // travessa de cima
  // faixa de luz macia na cor do provedor, embaixo das telas
  caixa(muralL - 0.2, 0.02, 0.02, P.cor, 0, 1.2, -0.1, mural, { mat: { emissive: P.cor, emissiveIntensity: 0.6 }, sombra: false });
  // telas: principal (medidores) e lateral (relógio e tripulação)
  // telas a partir de 1,32 m: o capacete do operador (1,6 m) não cobre os medidores na câmera
  const Y_TELAS = 1.32;
  const larLat = 0.72, larPri = muralL - 0.16 - larLat - 0.1;
  const painel = criarPainelMedidores({ provedor, largura: larPri, altura: 0.95 });
  painel.grupo.position.set(-muralL / 2 + 0.08 + larPri / 2, Y_TELAS + 0.95 / 2, -0.1);
  mural.add(painel.grupo);
  const lateral = criarPainelLateral({ provedor, largura: larLat, altura: 0.95 });
  lateral.grupo.position.set(muralL / 2 - 0.08 - larLat / 2, Y_TELAS + 0.95 / 2, -0.1);
  mural.add(lateral.grupo);
  liberaveis.push(painel, lateral);
  // placa com o nome da sala em cima do mural
  const placa = placaSala(provedor, Math.min(1.7, muralL - 0.3));
  placa.position.set(-0.1, 2.58, -0.1);
  mural.add(placa);
  liberaveis.push({ liberar: placa.userData.liberar });
  // objetos no aparador: plantinha, rádio e pasta
  const pv = new THREE.Group(); pv.position.set(-muralL / 2 + 0.3, 0.655, 0.05); mural.add(pv);
  cilindro(0.07, 0.055, 0.1, openai ? 0x2b2c30 : C.terracota, 0, 0, 0, pv, 14);
  for (let i = 0; i < 6; i++) {
    const f = malha(geo('esfera', 0.055, 10, 8, { escala: [0.55, 1.3, 0.3] }), mat(i % 2 ? C.folha : C.folhaClara), Math.sin(i) * 0.02, 0.15, Math.cos(i) * 0.02, pv);
    f.rotation.set(0.5, i * 1.05, 0);
  }
  if (openai) {
    caixa(0.1, 0.24, 0.1, 0x1b1c1e, muralL / 2 - 0.45, 0.655, 0.05, mural);                   // caixa de som
    caixa(0.32, 0.018, 0.22, 0xc4c8cd, 0.1, 0.655, 0.02, mural, { mat: { metalness: 0.6, roughness: 0.3 } }).rotation.y = 0.2;   // notebook fechado
  } else {
    cilindro(0.06, 0.06, 0.22, 0xd9c3a5, muralL / 2 - 0.45, 0.655, 0.05, mural, 18);                // caixa de som de tecido
    malha(geo('toro', 0.045, 0.006, 6, 20), mat(PROVEDORES.anthropic.cor, { emissive: PROVEDORES.anthropic.cor, emissiveIntensity: 0.7 }), muralL / 2 - 0.45, 0.88, 0.05, mural, false).rotation.x = Math.PI / 2;
    caixa(0.32, 0.018, 0.22, 0xd6c7b4, 0.1, 0.655, 0.02, mural, { mat: { metalness: 0.5, roughness: 0.35 } }).rotation.y = 0.2;   // notebook fechado (alumínio quente)
  }
  obstaculos.push({ x: muralX, z: zMural - 0.03, w: muralL + 0.04, d: 0.5 });

  // console no meio, operador do lado do mural
  const cons = criarConsole(provedor);
  const zCons = zMural + 1.95;
  cons.grupo.position.set(muralX + 0.05, 0, zCons);
  sala.add(cons.grupo);
  liberaveis.push(cons);
  obstaculos.push({ x: muralX + 0.05, z: zCons, w: 2.1, d: 0.7 });
  // tapete sob o console e a faixa de trabalho
  caixa(2.9, 0.015, 2.1, TM.tapete, muralX + 0.05, 0.004, zCons - 0.55, sala, { sombra: false });
  pendenteSala(muralX - 0.55, zCons + 0.15, sala, P.id);   // sobre o console: na câmera, não cai na frente das telas
  liberaveis.push({ liberar: () => sala.children.forEach(c => c.userData.liberar?.()) });

  // aparador do café (lado direito, frente para -x) e púlpito da prancheta
  const cafe = aparadorCafe(provedor);
  cafe.position.set(W / 2 - 0.36, 0, zCons + 1.5);
  cafe.rotation.y = -Math.PI / 2;
  sala.add(cafe);
  obstaculos.push({ x: W / 2 - 0.36, z: zCons + 1.5, w: 0.46, d: 1.04 });
  const pul = pulpito(P.id);
  pul.position.set(W / 2 - 0.45, 0, zCons - 0.25);
  pul.rotation.y = -Math.PI / 2;
  sala.add(pul);
  obstaculos.push({ x: W / 2 - 0.45, z: zCons - 0.25, w: 0.36, d: 0.36 });

  // metade da frente: escultura, armário baixo e plantas (sem cadeira vazia)
  // Anthropic: escultura de cerâmica com anel de luz coral, armário de grafite quente com
  // vidro fosco e tampo de bronze, vasos de cerâmica, plantas em terracota.
  // OpenAI: escultura de metal, armário de vidro preto e uma planta só, em vaso preto.
  const gl = openai ? escultura(P.id) : esculturaCeramica(P.id);
  gl.position.set(-0.2, 0, D / 2 - 1.9);
  sala.add(gl);
  obstaculos.push({ x: -0.2, z: D / 2 - 1.9, w: 0.6, d: 0.6 });
  const est = openai ? armarioVidro() : armarioQuente();
  const zEst = D / 2 - 1.55;
  est.position.set(-W / 2 + 0.3, 0, zEst);
  sala.add(est);
  if (!openai) vasosCeramica(est, -0.02, 0.88, 0);
  obstaculos.push({ x: -W / 2 + 0.3, z: zEst, w: 0.4, d: 1.3 });
  if (openai) plantaGrande(-W / 2 + 0.42, D / 2 - 0.5, 0.9, sala, 'folhaLarga', 0x2b2c30);
  else plantaGrande(-W / 2 + 0.42, D / 2 - 0.5, 1.0, sala, 'ficus', C.offWhite);
  // no norte a frente (+z) é o corredor: a planta sai do vão da porta (x 0,55 a 2,15)
  plantaGrande(lado === 'n' ? 0.1 : W / 2 - 0.42, D / 2 - 0.5, 0.95, sala, openai ? 'ficus' : 'folhaLarga', openai ? 0xeeeff0 : C.terracota);
  obstaculos.push({ x: -W / 2 + 0.42, z: D / 2 - 0.5, w: 0.45, d: 0.45 }, { x: lado === 'n' ? 0.1 : W / 2 - 0.42, z: D / 2 - 0.5, w: 0.45, d: 0.45 });
  if (lado === 'n') {   // no sul, esse canto é a porta
    plantaGrande(W / 2 - 0.4, zFundo + 0.55, 0.85, sala, 'folhaLarga', openai ? 0x2b2c30 : C.terracota);
    obstaculos.push({ x: W / 2 - 0.4, z: zFundo + 0.55, w: 0.42, d: 0.42 });
  }

  // operador: pontos de cada ação (no espaço da sala)
  const V = (x, z) => new THREE.Vector3(x, 0, z);
  const zFaixa = zMural + 0.85;   // faixa de trabalho entre o mural e o console
  const xPri = muralX - muralL / 2 + 0.08 + larPri / 2, xLat = muralX + muralL / 2 - 0.08 - larLat / 2;
  const pontos = {
    painelEsq: { pos: V(xPri - larPri * 0.28, zFaixa), olhar: Math.PI },
    painelDir: { pos: V(xPri + larPri * 0.28, zFaixa), olhar: Math.PI },
    lateral: { pos: V(xLat, zFaixa + 0.05), olhar: Math.PI - 0.12 },
    console: { pos: V(muralX + 0.05 + cons.pontoDigitar.x, zCons + cons.pontoDigitar.z), olhar: 0 },
    cafe: { pos: V(W / 2 - 0.97, zCons + 1.5), olhar: Math.PI / 2 },
    prancheta: { pos: V(W / 2 - 1.0, zCons - 0.25), olhar: Math.PI / 2 },
  };
  // ronda da Anthropic: mais papel (prancheta, leitura na estante, café); da OpenAI:
  // mais console e painel. Semente, ritmo e ponto de partida diferentes em cada sala.
  pontos.estante = { pos: V(-W / 2 + 0.3 + 0.62, zEst), olhar: -Math.PI / 2 };
  const perfil = PERFIS[P.id] || PERFIS.anthropic;
  const tarefas = perfil.tarefas.filter(t => pontos[t.ponto]);
  const limites = { x0: -W / 2 + 0.3, x1: W / 2 - 0.3, z0: zFundo + 0.3, z1: D / 2 - 0.3 };
  const caminho = criarCaminho(obstaculos, limites, 0.28);
  // banquinho do cochilo (F1): no lugar do café, aparece quando ele vai sentar
  const banco = new THREE.Group();
  cilindro(0.19, 0.19, 0.05, openai ? 0x2b2c30 : C.terracota, 0, 0.46, 0, banco, 18);
  cilindro(0.025, 0.03, 0.46, openai ? 0xc4c8cd : 0x8a5a3a, 0, 0, 0, banco, 8);
  cilindro(0.15, 0.17, 0.02, openai ? 0xc4c8cd : 0x8a5a3a, 0, 0, 0, banco, 14);
  banco.position.copy(pontos.cafe.pos);
  sala.add(banco);
  const escalaOp = opc.escala ?? 1.45;
  const cochilo = { pos: pontos.cafe.pos.clone(), entrada: pontos.cafe.pos.clone().add(V(-0.55, 0)), olhar: pontos.cafe.olhar,
    y: 0.51 - 0.30 * escalaOp, banco };
  const operador = criarOperador(provedor, { semente: opc.semente ?? perfil.semente, escala: opc.escala, ritmo: perfil.ritmo, pontos, tarefas, caminho, cochilo });
  operador.grupo.position.copy(pontos[perfil.inicio].pos);
  operador.grupo.rotation.y = pontos[perfil.inicio].olhar;
  sala.add(operador.grupo);
  liberaveis.push(operador);

  let ultimoTick = 0, relogio = 0;
  function atualizar(dt, agoraMs = Date.now()) {
    relogio += dt;
    const andou = operador.atualizar(dt);
    gl.userData.girar(dt);
    if (agoraMs - ultimoTick > 1000) {   // telas: confere uma vez por segundo, redesenha só se mudou
      ultimoTick = agoraMs;
      painel.tick(agoraMs);
      lateral.tick(agoraMs);
    }
    return { andou };
  }
  function definirDados(dados) {
    if (!dados) return;
    painel.atualizar(dados);
    lateral.atualizar(dados.tripulacao ?? null);
    cons.atualizar(dados);
  }
  Object.assign(sala.userData, {
    provedor: P.id, painel, lateral, console: cons, operador, obstaculos, pontos,
    porta: lado === 's' ? { x: SALA.porta.x, z: zFundo, vao: SALA.porta.vao } : null,
    atualizar, definirDados,
    definirCochilo: sim => operador.definirCochilo(sim), dormindo: () => operador.dormindo(),
    liberar() { for (const l of liberaveis) l.liberar?.(); },
  });
  return sala;
}

// ---------------------------------------------------------------------------
// Conversores de dados
// ---------------------------------------------------------------------------
// quotas do painel claude-usage: [{ provider: 'claude' | 'codex', label, utilization,
// resets_at, window_hours }]
export function dadosDeQuotas(quotas, agora = Date.now()) {
  const sai = { anthropic: { medidores: [], atualizadoEm: agora }, openai: { medidores: [], atualizadoEm: agora } };
  for (const q of quotas || []) {
    const dest = q.provider === 'codex' ? sai.openai : q.provider === 'claude' ? sai.anthropic : null;
    if (!dest) continue;
    dest.medidores.push({
      rotulo: rotuloCurto(q.label || q.key || ''),
      pct: Number.isFinite(+q.utilization) ? +q.utilization : null,
      reiniciaEm: q.resets_at ?? null,
      janelaMin: q.window_hours ? q.window_hours * 60 : null,
    });
    const visto = paraMs(q.snapshot_ts);
    if (visto) dest.atualizadoEm = Math.min(dest.atualizadoEm, visto);
  }
  return sai;
}
// "Sessão · 5 horas" -> "Sessão · 5 h"
function rotuloCurto(s) { return String(s).replace(/(\d+)\s*horas?/i, '$1 h').trim(); }

// rate_limits do Codex: { primary: { used_percent, window_minutes, resets_at | resets_in_seconds },
// secondary, visto_em }
export function dadosDeLimitesCodex(rl, agora = Date.now()) {
  if (!rl) return { medidores: [], aviso: 'nenhuma sessão do Codex informou os limites ainda' };
  const vistoEm = paraMs(rl.visto_em) ?? agora;
  const janela = j => {
    if (!j) return null;
    const min = j.window_minutes ?? null;
    const reinicia = j.resets_at != null ? paraMs(j.resets_at)
      : j.resets_in_seconds != null ? vistoEm + j.resets_in_seconds * 1000 : null;
    const rot = min == null ? 'Codex' : min >= 1440 ? `Codex · ${Math.round(min / 1440)} dias` : `Codex · ${Math.round(min / 60)} h`;
    return { rotulo: rot, pct: Number.isFinite(+j.used_percent) ? +j.used_percent : null, reiniciaEm: reinicia, janelaMin: min };
  };
  const medidores = [janela(rl.primary), janela(rl.secondary)].filter(Boolean)
    .sort((a, b) => (a.janelaMin ?? 0) - (b.janelaMin ?? 0));
  return { medidores, atualizadoEm: vistoEm };
}

// Dados da vitrine (pedido da tarefa): Claude Sessão 5 h 11%, Semana 7 d 14%,
// Fable 7 d 0%; Codex 7 dias 15%
export function dadosExemplo(agora = Date.now()) {
  const h = 3600e3;
  return {
    anthropic: {
      medidores: [
        { rotulo: 'Sessão · 5 h', pct: 11, reiniciaEm: agora + 3.2 * h, janelaMin: 300 },
        { rotulo: 'Semana · 7 dias', pct: 14, reiniciaEm: agora + 102 * h, janelaMin: 10080 },
        { rotulo: 'Fable · 7 dias', pct: 0, reiniciaEm: agora + 102 * h, janelaMin: 10080 },
      ],
      atualizadoEm: agora,
      tripulacao: { trabalhando: 3, descansando: 1 },
    },
    openai: {
      medidores: [{ rotulo: 'Codex · 7 dias', pct: 15, reiniciaEm: agora + 149 * h, janelaMin: 10080 }],
      atualizadoEm: agora,
      tripulacao: { trabalhando: 1, descansando: 0 },
    },
  };
}
