// Sala dos servidores: um rack por servidor que mantém algo de pé nesta máquina
// (com telinha de nome, portas, CPU, memória e tempo ligado, e LEDs que piscam
// conforme o uso) e um painel de parede com CPU, GPU, memória e disco da máquina.
// Dados de /api/servidores (app/fonte-servidores.js).

import * as THREE from 'three';
import { caixa, piso, planta, COR } from './pecas.js';
import { faixaDe } from './controle.js';
import { criarAstronauta } from './personagens.js';
import { registrarNpc, removerNpc, criarRoteador, passoNpc, marcarAndando, criarCochilo } from './sala-corpos.js';
import { tween, cancelarTweens } from './tween.js';
import { E } from './estado.js';

const FONTE = 'Figtree, -apple-system, "Helvetica Neue", sans-serif';
const C = {
  grafite: 0x2a2e3a, rackCorpo: 0x30343f, rackFrente: 0x23262f, pisoTec: 0xc9ccd4, juntas: 0xb3b7c1,
  bandeja: 0x8d929e, parede: 0xe9ebef,
};

// Canvas desenhado como textura, com plano pronto para pendurar
function telaCanvas(W, H, larg, alt) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: textura, emissive: 0xffffff, emissiveMap: textura, emissiveIntensity: 0.75, roughness: 0.35 });
  const plano = new THREE.Mesh(new THREE.PlaneGeometry(larg, alt), material);
  return { canvas, ctx: canvas.getContext('2d'), textura, material, plano };
}

function tempoLigado(s) {
  if (s == null) return '';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

function encaixar(g, texto, maxLarg, tam, peso = 800) {
  do { g.font = `${peso} ${tam}px ${FONTE}`; tam -= 2; } while (g.measureText(texto).width > maxLarg && tam > 12);
}

// ---------------------------------------------------------------------------
// Painel da máquina: 4 anéis (CPU, GPU, memória, disco)
// ---------------------------------------------------------------------------
export function criarPainelMaquina({ largura = 3.2, altura = 1.2 } = {}) {
  const W = 1600, H = Math.round(1600 * altura / largura);
  const t = telaCanvas(W, H, largura, altura);
  const grupo = new THREE.Group();
  caixa(largura + 0.08, altura + 0.08, 0.05, C.grafite, 0, -(altura + 0.08) / 2, -0.03, grupo);
  grupo.add(t.plano);
  let assinatura = null;

  function anel(g, cx, cy, r, pct, cor) {
    g.lineCap = 'round';
    g.lineWidth = r * 0.16;
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
    if (pct != null) {
      g.strokeStyle = cor;
      g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * Math.min(1, pct / 100)); g.stroke();
    }
  }

  function atualizar(m) {
    if (!m) return false;
    const chave = [m.cpu, m.cpuPico, m.gpu, m.memoria?.pct, m.disco?.pct].join('|');
    if (chave === assinatura) return false;
    assinatura = chave;
    const g = t.ctx;
    const fundo = g.createLinearGradient(0, 0, 0, H);
    fundo.addColorStop(0, '#111a4d'); fundo.addColorStop(1, '#0a0f35');
    g.fillStyle = fundo; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = `800 44px ${FONTE}`;
    g.fillText('Esta máquina', 60, 78);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = `600 28px ${FONTE}`;
    g.fillText(`${m.nome || ''} · ${m.nucleos || '?'} núcleos`, 60, 118);
    const itens = [
      // média do último minuto; o pico só aparece quando foi bem acima da média
      { rotulo: 'CPU', pct: m.cpu, detalhe: m.cpuPico != null && m.cpuPico >= (m.cpu ?? 0) + 10 ? `média de 1 min · pico ${m.cpuPico}%` : 'média de 1 min' },
      { rotulo: 'GPU', pct: m.gpu, detalhe: 'placa de vídeo' },
      { rotulo: 'Memória', pct: m.memoria?.pct, detalhe: m.memoria ? `${m.memoria.usadoGB} de ${m.memoria.totalGB} GB` : '' },
      // disco é informação neutra, sem faixa de alerta
      { rotulo: 'Disco', pct: m.disco?.pct, detalhe: m.disco ? `${m.disco.livreGB} GB livres` : '', neutro: true },
    ];
    const r = 112, y = 330;
    itens.forEach((it, i) => {
      const cx = 220 + i * 390;
      const cor = it.neutro ? '#8fb3e6' : faixaDe(it.pct ?? 0).cor;
      anel(g, cx, y, r, it.pct, cor);
      g.textAlign = 'center';
      g.fillStyle = '#ffffff';
      g.font = `800 72px ${FONTE}`;
      g.fillText(it.pct == null ? 'sem dados' : `${Math.round(it.pct)}%`, cx, y + 22);
      g.font = `800 34px ${FONTE}`;
      g.fillText(it.rotulo, cx, y + r + 70);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.font = `600 24px ${FONTE}`;
      g.fillText(it.detalhe, cx, y + r + 106);
    });
    t.textura.needsUpdate = true;
    return true;
  }
  return { grupo, atualizar, liberar() { t.textura.dispose(); t.material.dispose(); } };
}

// ---------------------------------------------------------------------------
// Rack de um servidor
// ---------------------------------------------------------------------------
const ALT_RACK = 1.95, LARG_RACK = 0.8, PROF_RACK = 0.85;

// Tamanho do rack pelo consumo real do processo (pedido do Eduardo, 03/10: "coisas que
// precisam de mais recursos têm servidores maiores; coisas mais simples, menores").
// larg é a frente do rack (cerca do dobro do rack de antes, 0,8 m), prof a profundidade.
// mesma profundidade nos três (como numa fileira de datacenter): frentes e fundos
// alinhados; o tamanho aparece na largura e na altura (03/10: com profundidades
// diferentes a fileira ficava "desalinhada" na vista)
export const TAMANHOS_RACK = {
  pequeno: { larg: 1.0, prof: 0.9, alt: 1.45 },
  medio: { larg: 1.35, prof: 0.9, alt: 1.8 },
  grande: { larg: 1.7, prof: 0.9, alt: 2.15 },
};
const TAMANHO_VITRINE = { larg: LARG_RACK, prof: PROF_RACK, alt: ALT_RACK };

// Até ~60 MB de memória, pequeno; até ~250 MB, médio; acima disso, grande. CPU alta
// também conta (25% ou mais sobe para médio, 60% ou mais para grande). A própria
// Estação é sempre média.
export function tamanhoDoServidor(s) {
  if (s?.categoria === 'estacao') return 'medio';
  const mem = s?.memoriaMB ?? 0, cpu = s?.cpu ?? 0;
  if (mem > 250 || cpu >= 60) return 'grande';
  if (mem > 60 || cpu >= 25) return 'medio';
  return 'pequeno';
}

export function criarRack(srv, i = 0, tamanho = null) {
  const dim = typeof tamanho === 'string' ? TAMANHOS_RACK[tamanho] : tamanho || TAMANHO_VITRINE;
  const L = dim.larg, A = dim.alt, P = dim.prof;
  const g = new THREE.Group();
  caixa(L, A, P, C.rackCorpo, 0, 0, 0, g);
  caixa(L - 0.06, A - 0.08, 0.02, C.rackFrente, 0, 0.04, P / 2, g, { sombra: false });
  // gavetas com fenda de ventilação (mais gavetas no rack mais alto)
  const nGavetas = Math.max(4, Math.round((A - 1.0) / 0.1));
  for (let k = 0; k < nGavetas; k++) caixa(L - 0.14, 0.012, 0.012, 0x15171f, 0, 0.12 + k * 0.1, P / 2 + 0.012, g, { sombra: false });
  // LEDs: verde quando escuta, piscam mais rápido com mais CPU (uma coluna a mais a cada 0,3 m de frente)
  const leds = [];
  const colunas = Math.max(4, Math.floor((L - 0.2) / 0.075));
  for (let k = 0; k < colunas * 2; k++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x4cd97b, emissiveIntensity: 0.2 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 0.01), mat);
    m.position.set(-L / 2 + 0.11 + (k % colunas) * 0.06, 0.18 + Math.floor(k / colunas) * 0.1, P / 2 + 0.018);
    g.add(m);
    leds.push({ mat, fase: (i * 1.7 + k * 0.9) % 6.28, vel: 2 + ((i * 3 + k * 5) % 7) });
  }
  // telinha na frente, no alto (no rack grande ela não passa de 1,1 m de largura)
  const lt = Math.min(L - 0.1, 1.1), at = lt * 400 / 512;
  const t = telaCanvas(512, 400, lt, at);
  t.plano.position.set(0, Math.min(1.35, A - 0.1 - at / 2), P / 2 + 0.016);
  g.add(t.plano);
  let assinatura = null;

  function atualizar(s) {
    srv = s || srv;
    const chave = [srv.nome, srv.portas.join(','), Math.round(srv.cpu ?? -1), srv.memoriaMB, tempoLigado(srv.ligadoHaS)].join('|');
    if (chave === assinatura) return;
    assinatura = chave;
    const c = t.ctx;
    const fundo = c.createLinearGradient(0, 0, 0, 400);
    const estacao = srv.categoria === 'estacao';
    fundo.addColorStop(0, estacao ? '#0a1f7a' : '#111a4d'); fundo.addColorStop(1, '#0a0f35');
    c.fillStyle = fundo; c.fillRect(0, 0, 512, 400);
    c.fillStyle = estacao ? '#ee4c01' : '#4cd97b';
    c.beginPath(); c.arc(40, 52, 12, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff'; c.textAlign = 'left'; c.textBaseline = 'middle';
    encaixar(c, srv.nome, 420, 44);
    c.fillText(srv.nome, 64, 54);
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.font = `700 30px ${FONTE}`;
    const portas = srv.portas.length > 3 ? `${srv.portas.slice(0, 3).join(', ')} +${srv.portas.length - 3}` : srv.portas.join(', ');
    c.fillText(`porta ${portas}`, 30, 128);
    c.fillStyle = '#ffffff';
    c.font = `800 52px ${FONTE}`;
    c.fillText(`${srv.cpu == null ? '?' : Math.round(srv.cpu)}%`, 30, 220);
    c.fillText(`${srv.memoriaMB ?? '?'} MB`, 250, 220);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = `600 26px ${FONTE}`;
    c.fillText('CPU', 30, 268);
    c.fillText('memória', 250, 268);
    c.fillText(`ligado há ${tempoLigado(srv.ligadoHaS)}`, 30, 350);
    t.textura.needsUpdate = true;
  }
  atualizar(srv);

  function animar(tempo) {
    const ritmo = 0.6 + Math.min(4, (srv.cpu || 0) / 10);
    for (const l of leds) l.mat.emissiveIntensity = 0.25 + 0.9 * (Math.sin(tempo * l.vel * ritmo + l.fase) > 0.35 ? 1 : 0);
  }
  return { grupo: g, atualizar, animar, dim, liberar() { t.textura.dispose(); t.material.dispose(); for (const l of leds) l.mat.dispose(); } };
}

// Rack baixo e discreto que agrupa os apps do Mac
export function criarRackApps(apps) {
  const g = new THREE.Group();
  caixa(LARG_RACK * 1.6, 1.0, PROF_RACK, 0x3a3e49, 0, 0, 0, g);
  const t = telaCanvas(820, 420, LARG_RACK * 1.6 - 0.1, (LARG_RACK * 1.6 - 0.1) * 420 / 820);
  t.plano.position.set(0, 0.55, PROF_RACK / 2 + 0.012);
  g.add(t.plano);
  let assinatura = null;
  function atualizar(lista) {
    const nomes = [...new Set(lista.map(a => a.nome))];
    const chave = nomes.join('|');
    if (chave === assinatura) return;
    assinatura = chave;
    const c = t.ctx;
    c.fillStyle = '#1b1f2b'; c.fillRect(0, 0, 820, 420);
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.font = `800 40px ${FONTE}`;
    c.fillText(`Apps do Mac (${nomes.length})`, 30, 46);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = `600 26px ${FONTE}`;
    nomes.slice(0, 10).forEach((n, i) => c.fillText(n.slice(0, 26), 30 + (i % 2) * 400, 110 + Math.floor(i / 2) * 58));
    t.textura.needsUpdate = true;
  }
  atualizar(apps);
  return { grupo: g, atualizar, liberar() { t.textura.dispose(); t.material.dispose(); } };
}

// ---------------------------------------------------------------------------
// Técnico: astronauta que mantém tudo de pé. Anda pelo corredor dos racks, mexe
// no rack mais ocupado, confere o painel da máquina e o rack dos apps do Mac.
// Não é agente: não tem balão nem placa, e usa cinto de ferramentas e maleta.
// ---------------------------------------------------------------------------
const ESCALA = 1.45, VEL = 1.1;

function criarTecnico() {
  const boneco = criarAstronauta(0x5d6676, 97, 'olhinhos');
  boneco.scale.setScalar(ESCALA);
  // cinto de ferramentas com faixa refletiva e maleta na mão direita
  const cinto = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.035, 10, 28), new THREE.MeshStandardMaterial({ color: 0xee4c01, roughness: 0.6 }));
  cinto.rotation.x = Math.PI / 2;
  cinto.position.y = 0.4;
  boneco.add(cinto);
  const faixa = new THREE.Mesh(new THREE.TorusGeometry(0.207, 0.012, 6, 28), new THREE.MeshStandardMaterial({ color: 0xf3f3f0, emissive: 0xffffff, emissiveIntensity: 0.25 }));
  faixa.rotation.x = Math.PI / 2;
  faixa.position.y = 0.4;
  boneco.add(faixa);
  const maleta = new THREE.Group();
  caixa(0.18, 0.13, 0.07, 0x2b2b33, 0, 0, 0, maleta);
  caixa(0.07, 0.025, 0.02, 0x9aa0aa, 0, 0.13, 0, maleta);
  maleta.position.set(0.3, 0.12, 0.02);
  boneco.add(maleta);
  boneco.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { boneco, maleta };
}

// Rotina independente, sorteada por semente própria (sem Math.random repetido igual)
function rotinaDoTecnico(alvos, corredorZ) {
  const { boneco, maleta } = criarTecnico();
  let semente = 7919;
  const sorte = () => { semente = (semente * 48271) % 2147483647; return semente / 2147483647; };
  let rota = [], acao = null, ate = 0, ultimo = -1, passo = 0, olhar = 0;
  boneco.position.set(0, 0, corredorZ);

  function escolher() {
    const lista = alvos();
    if (!lista.length) return null;
    // pesos: rack com mais CPU chama mais atenção; painel e apps de vez em quando
    const pesos = lista.map((a, i) => (i === ultimo ? 0.05 : 1) * (a.tipo === 'rack' ? 1 + (a.cpu || 0) / 8 : a.tipo === 'painel' ? 1.3 : 0.8));
    let r = sorte() * pesos.reduce((x, y) => x + y, 0);
    for (let i = 0; i < lista.length; i++) { r -= pesos[i]; if (r <= 0) { ultimo = i; return lista[i]; } }
    ultimo = 0; return lista[0];
  }
  function irPara(alvo) {
    const p = boneco.position;
    rota = [new THREE.Vector3(p.x, 0, corredorZ), new THREE.Vector3(alvo.pos.x, 0, corredorZ), alvo.pos.clone()];
    acao = alvo;
  }
  function atualizar(t, dt) {
    if (rota.length) {
      const alvo = rota[0];
      const d = new THREE.Vector3(alvo.x - boneco.position.x, 0, alvo.z - boneco.position.z);
      const dist = d.length();
      if (dist < 0.03) { rota.shift(); if (!rota.length) ate = t + (acao.tipo === 'painel' ? 3 + sorte() * 3 : 4 + sorte() * 5); }
      else {
        const anda = Math.min(dist, VEL * dt);
        boneco.position.addScaledVector(d.normalize(), anda);
        passo += anda / (0.42 * ESCALA) * Math.PI;
        olhar = Math.atan2(d.x, d.z);
      }
      boneco.userData.animar(t, 'andar', false, { dt, passo, fase: 0.7 });
    } else if (acao && t < ate) {
      olhar = acao.olhar;
      // no rack: mãos no equipamento; no painel: olha para cima, parado
      boneco.userData.animar(t, acao.tipo === 'painel' ? 'parado' : 'digitar', false, { dt, fase: 0.7 });
      maleta.visible = acao.tipo === 'painel';
    } else {
      maleta.visible = true;
      const prox = escolher();
      if (prox) irPara(prox);
      else boneco.userData.animar(t, 'parado', false, { dt });
    }
    const dif = ((olhar - boneco.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    boneco.rotation.y += dif * Math.min(1, dt * 8);
  }
  return { boneco, atualizar };
}

// ---------------------------------------------------------------------------
// Sala inteira (para a vitrine e, depois, como módulo da Estação)
// ---------------------------------------------------------------------------
export function montarSalaServidores({ largura = 8.2, profundidade = 4.4, altParede = 2.6 } = {}) {
  const sala = new THREE.Group();
  const X0 = -largura / 2, ZF = -profundidade / 2;
  // piso técnico elevado, em placas
  piso(largura, profundidade, C.pisoTec, 0, 0, sala);
  for (let x = X0 + 0.6; x < -X0; x += 0.6) caixa(0.012, 0.004, profundidade - 0.1, C.juntas, x, 0.001, 0, sala, { seg: 0, sombra: false });
  for (let z = ZF + 0.6; z < -ZF; z += 0.6) caixa(largura - 0.1, 0.004, 0.012, C.juntas, 0, 0.001, z, sala, { seg: 0, sombra: false });
  // paredes em corte
  caixa(largura + 0.12, altParede, 0.12, C.parede, 0, 0, ZF - 0.06, sala);
  caixa(0.12, altParede, profundidade, C.parede, X0 - 0.06, 0, 0, sala);
  // bandeja de cabos no alto, ao longo das fileiras
  caixa(largura - 0.6, 0.05, 0.3, C.bandeja, 0, altParede - 0.3, ZF + 1.2, sala, { sombra: false });
  // painel da máquina na parede do fundo
  const painel = criarPainelMaquina({ largura: 3.4, altura: 1.25 });
  painel.grupo.position.set(largura * 0.08, 2.3, ZF + 0.05);
  sala.add(painel.grupo);
  planta(-X0 - 0.5, ZF + 0.5, 1.0, COR.offWhite, 'folhaLarga', sala);
  planta(X0 + 0.5, -ZF - 0.5, 0.9, COR.offWhite, 'folhaLarga', sala);

  const fileira = new THREE.Group();
  sala.add(fileira);
  let racks = [], rackApps = null, assinatura = null;

  function atualizar(dados) {
    if (!dados) return;
    painel.atualizar(dados.maquina);
    const meus = dados.servidores.filter(s => s.categoria !== 'app');
    const apps = dados.servidores.filter(s => s.categoria === 'app');
    const chave = meus.map(s => s.pid).join(',');
    if (chave !== assinatura) {
      // a lista mudou (servidor ligou ou desligou): remonta a fileira
      assinatura = chave;
      for (const r of racks) { r.liberar(); fileira.remove(r.grupo); }
      rackApps?.liberar(); if (rackApps) fileira.remove(rackApps.grupo);
      racks = meus.map((s, i) => criarRack(s, i));
      // uma fileira só: com muitos servidores os racks ficam um pouco menores, nunca em duas fileiras
      // (a segunda fileira bloqueava o corredor por onde o técnico anda)
      const disponivel = largura - 2.4;
      const escala = Math.min(1, disponivel / (racks.length * (LARG_RACK + 0.1)));
      const passo = (LARG_RACK + 0.1) * escala;
      racks.forEach((r, i) => {
        r.grupo.scale.setScalar(escala);
        r.grupo.position.set(X0 + 0.75 + i * passo, 0, ZF + 1.2);
        fileira.add(r.grupo);
      });
      // rack dos apps do Mac: baixo, no fim da fileira, de lado para a câmera
      rackApps = criarRackApps(apps);
      rackApps.grupo.position.set(-X0 - 0.7, 0, ZF + 1.6);
      rackApps.grupo.rotation.y = Math.PI / 2;
      fileira.add(rackApps.grupo);
    } else {
      meus.forEach((s, i) => racks[i]?.atualizar(s));
      rackApps?.atualizar(apps);
    }
  }
  // pontos de trabalho do técnico: na frente de cada rack, embaixo do painel e no rack dos apps
  const filaZ = ZF + 1.2;
  const corredorZ = filaZ + PROF_RACK / 2 + 0.9;
  let ultimosDados = null;
  function alvos() {
    const lista = racks.map((r, i) => ({ tipo: 'rack', cpu: ultimosDados?.servidores.filter(s => s.categoria !== 'app')[i]?.cpu,
      pos: new THREE.Vector3(r.grupo.position.x, 0, filaZ + PROF_RACK / 2 + 0.42), olhar: Math.PI }));
    lista.push({ tipo: 'painel', pos: new THREE.Vector3(painel.grupo.position.x, 0, corredorZ), olhar: Math.PI });
    if (rackApps) lista.push({ tipo: 'apps', pos: new THREE.Vector3(rackApps.grupo.position.x - PROF_RACK / 2 - 0.42, 0, rackApps.grupo.position.z), olhar: -Math.PI / 2 });
    return lista;
  }
  const tecnico = rotinaDoTecnico(alvos, corredorZ);
  sala.add(tecnico.boneco);
  const atualizarSala = atualizar;
  let anterior = null;
  function animar(tempo) {
    const dt = anterior == null ? 1 / 60 : Math.min(0.1, tempo - anterior);
    anterior = tempo;
    for (const r of racks) r.animar(tempo);
    tecnico.atualizar(tempo, dt);
  }
  return { grupo: sala, atualizar: d => { ultimosDados = d; atualizarSala(d); }, animar, largura, profundidade };
}

// ---------------------------------------------------------------------------
// Módulo da Estação: sala MODULAR (F2, pedido do Eduardo em 03/10)
// ---------------------------------------------------------------------------
// "O espaço que você usa hoje para dois servidores vai ser para um servidor só... a
// sala vai aumentando de tamanho conforme a quantidade de servidores rodando."
// Coordenadas locais do módulo-base: x de -2,3 a 2,3, z de -3,4 (fundo: no sul, a
// divisória do corredor, com a porta) a 3,4 (frente, o lado da câmera). Sem piso nem
// paredes (layout.js monta a casca). Ninguém entra (m.semAcesso): só o técnico vive aqui.
// - um rack por servidor seu (fora os apps do Mac), do tamanho do consumo dele
//   (TAMANHOS_RACK), em fileiras alinhadas às paredes, de frente para +x;
// - a sala ocupa 1 vaga com até ~3 racks (uma fileira encostada na esquerda); com mais,
//   pede extensões (módulos 'servidores' com extensao, estacao.js) na vaga vizinha do
//   mesmo lado, sem divisória no meio e com piso único; cada extensão tem duas
//   fileiras. As extensões ficam à esquerda (x local -4,6 × k) e os racks delas são
//   do módulo-base (o técnico anda pela sala inteira);
// - quando os servidores caem, os racks encolhem e somem (0,4 s), os que ficam vão para
//   perto do núcleo (0,7 s) e a extensão vazia desacopla com a animação de sempre;
// - painel "Esta máquina" num painel técnico solto junto do fundo, à esquerda da porta;
//   rack baixo dos apps do Mac na frente, à direita; o técnico anda entre eles (rotas
//   desviando dos móveis, corpo sólido de 0,86 m) e, com a estação parada há mais de
//   1 min, cochila sentado num caixote de ferramentas que aparece ao lado do painel.
// Devolve { grupo, atualizar(dados), animar(t), cochilar(sim), dormindo(), npcs, liberar,
//   extensoesNecessarias(), definirExtensoes(n, travado), extensaoVazia(k), racks() }.
export const EXT_MAX = 2;                 // até 2 extensões (3 vagas)
const VAGA = 4.6, GAP_RACK = 0.1;
const AUSENTE_MS = 8000;                  // servidor que sumiu: o rack espera uma leitura antes de sair
// Fileiras (x do fundo do rack, faixa em z): na base, encostada na esquerda e começando
// depois do painel (que fica à vista por cima dela); em cada extensão, uma no meio e
// outra encostada na esquerda, com corredores de 1,3 m ou mais na frente de cada uma
const FILEIRAS_BASE = [{ ext: 0, xFundo: -2.15, z0: -1.7, z1: 2.95 }];   // 3 racks (2 médios e 1 grande)
// todas as fileiras começam e terminam na mesma linha da base (z -1,7 a 2,95): na sala
// fundida elas ficam alinhadas entre si, com a faixa do fundo livre para o técnico passar
const fileirasDaExtensao = k => [
  { ext: k, xFundo: -VAGA * k + 0.05, z0: -1.7, z1: 2.95 },
  { ext: k, xFundo: -VAGA * k - 2.15, z0: -1.7, z1: 2.95 },
];

// Lugar de cada rack (na ordem) nas fileiras da base e das nExt extensões; com escala
// < 1, todos encolhem (sala sem vaga para crescer). Devolve só os que couberam.
export function planoDeRacks(tamanhos, nExt, escala = 1) {
  const fileiras = [...FILEIRAS_BASE];
  for (let k = 1; k <= nExt; k++) fileiras.push(...fileirasDaExtensao(k));
  const plano = [];
  let f = 0, cursor = fileiras[0].z0;
  for (const t of tamanhos) {
    const d = TAMANHOS_RACK[t];
    const w = d.larg * escala;
    while (f < fileiras.length && cursor + w > fileiras[f].z1 + 1e-6) { f++; if (f < fileiras.length) cursor = fileiras[f].z0; }
    if (f >= fileiras.length) break;
    plano.push({ x: fileiras[f].xFundo + d.prof * escala / 2, z: cursor + w / 2, ext: fileiras[f].ext, escala, tam: t });
    cursor += w + GAP_RACK;
  }
  return plano;
}

// Quantas extensões a lista de tamanhos pede (0 a EXT_MAX)
export function extensoesPara(tamanhos) {
  for (let n = 0; n <= EXT_MAX; n++) if (planoDeRacks(tamanhos, n).length >= tamanhos.length) return n;
  return EXT_MAX;
}

// Juntas do piso técnico alinhadas ao mundo (as placas continuam de um módulo para o
// outro, sem emenda: o piso da sala fundida é um só)
function juntasDoPiso(sala, xMundo) {
  const passo = 0.6;
  for (let xw = Math.ceil((xMundo - 2.25) / passo) * passo; xw < xMundo + 2.25; xw += passo) {
    caixa(0.012, 0.004, 6.7, C.juntas, xw - xMundo, 0.001, 0, sala, { seg: 0, sombra: false });
  }
  for (let z = -3.4 + passo; z < 3.4; z += passo) caixa(4.6, 0.004, 0.012, C.juntas, 0, 0.001, z, sala, { seg: 0, sombra: false });
}

// Extensão: só o piso técnico (a casca vem de layout.js, sem porta: a sala fundida tem
// uma porta só, a da base). Os racks que ficam nela são do módulo-base.
export function montarModuloServidoresExtensao({ xMundo = 0 } = {}) {
  const sala = new THREE.Group();
  sala.name = 'modulo-servidores-extensao';
  juntasDoPiso(sala, xMundo);
  return { grupo: sala, vagas: [], atualizar() {}, animar() {}, npcs: [], cochilar() {}, dormindo: () => true, liberar() {} };
}

export function montarModuloServidores({ lado = 's', xMundo = 0 } = {}) {
  const sala = new THREE.Group();
  sala.name = 'modulo-servidores';
  const XE = -2.3, ZF = -3.4;
  juntasDoPiso(sala, xMundo);

  // painel técnico solto junto do fundo, à esquerda da porta (vão de 0,55 a 2,15 no sul)
  const PX = -0.85, PZ = ZF + 0.28, PL = 2.3, PA = 0.86;
  caixa(PL + 0.2, 1.86, 0.1, 0xd9dce3, PX, 0, PZ - 0.05, sala);
  caixa(PL + 0.3, 0.06, 0.36, C.bandeja, PX, 0, PZ, sala, { seg: 0 });
  const painel = criarPainelMaquina({ largura: PL, altura: PA });
  painel.grupo.position.set(PX, 1.3, PZ + 0.03);
  sala.add(painel.grupo);
  // planta no canto da frente à direita (no norte, no canto do fundo: a porta fica na frente)
  const zPlanta = lado === 'n' ? ZF + 0.5 : 2.95;
  planta(2.0, zPlanta, 0.95, COR.offWhite, 'folhaLarga', sala);

  // rack baixo dos apps do Mac (de frente para +x), na frente à direita
  const AX = 1.35, AZ = 1.6;
  const rackApps = criarRackApps([]);
  rackApps.grupo.rotation.y = Math.PI / 2;
  rackApps.grupo.position.set(AX, 0, AZ);
  sala.add(rackApps.grupo);

  const fileira = new THREE.Group();
  sala.add(fileira);
  const racks = new Map();          // chave do servidor -> { r, tam, chave, x, z, ext, escala }
  const saindo = new Set();         // racks encolhendo antes de sair
  const tamanhos = new Map();       // chave -> { tam, candidato, vezes } (o tamanho não pisca)
  const ausentes = new Map();       // chave -> { srv, desde } (servidor que sumiu agora)
  let meus = [], nExt = 0, travado = false, ultimosDados = null, contador = 0;

  const chaveDe = srv => `${srv.nome}#${srv.portas?.[0] ?? srv.pid}`;
  // O tamanho só muda depois de 3 leituras seguidas pedindo o mesmo (15 s)
  function tamanhoEstavel(srv) {
    const ch = chaveDe(srv), novo = tamanhoDoServidor(srv);
    let t = tamanhos.get(ch);
    if (!t) { t = { tam: novo, candidato: novo, vezes: 0 }; tamanhos.set(ch, t); return t.tam; }
    if (novo === t.tam) { t.candidato = novo; t.vezes = 0; return t.tam; }
    if (novo === t.candidato) t.vezes++; else { t.candidato = novo; t.vezes = 1; }
    if (t.vezes >= 3) { t.tam = novo; t.vezes = 0; }
    return t.tam;
  }

  let lista = [];                   // servidores seus da última leitura
  function atualizar(dados) {
    if (!dados) return;
    ultimosDados = dados;
    painel.atualizar(dados.maquina);
    const agora = Date.now();
    lista = (dados.servidores || []).filter(s => s.categoria !== 'app');
    rackApps.atualizar((dados.servidores || []).filter(s => s.categoria === 'app'));
    // servidor que sumiu fica uns segundos (um reinício rápido não desmonta o rack)
    const vivos = new Set(lista.map(chaveDe));
    for (const s of meus) if (!vivos.has(chaveDe(s)) && !ausentes.has(chaveDe(s))) ausentes.set(chaveDe(s), { srv: s, desde: agora });
    for (const ch of [...ausentes.keys()]) if (vivos.has(ch)) ausentes.delete(ch);
    for (const srv of lista) srv._tam = tamanhoEstavel(srv);   // uma vez por leitura
    montarLista();
  }
  // a lista de racks: os da última leitura e os que sumiram há menos de AUSENTE_MS
  function montarLista() {
    const todos = [...lista, ...[...ausentes.values()].map(a => a.srv)];
    // ordem estável: A Estação primeiro, depois os projetos pelo nome
    const ordem = { estacao: 0, projeto: 1 };
    meus = todos.sort((a, b) => ((ordem[a.categoria] ?? 2) - (ordem[b.categoria] ?? 2)) || chaveDe(a).localeCompare(chaveDe(b)));
    for (const ch of [...tamanhos.keys()]) if (!meus.some(s => chaveDe(s) === ch)) tamanhos.delete(ch);
    reorganizar();
  }

  // Extensões que a lista de agora pede (estacao.js acopla e desacopla)
  const extensoesNecessarias = () => extensoesPara(meus.map(s => s._tam));
  // estacao.js: quantas extensões estão prontas (coladas na base) e se a sala está
  // travada (precisa crescer e não tem vaga: os racks encolhem para caber)
  function definirExtensoes(n, preso = false) {
    if (n === nExt && !!preso === travado) return;
    nExt = n; travado = !!preso;
    reorganizar();
  }

  function sairRack(e) {
    saindo.add(e);
    tween({ obj: e.r.grupo.scale, prop: 'y', para: 0.001, dur: 0.4, ease: 'easeInCubic', chave: 'rack:' + e.id,
      aoFim: () => { fileira.remove(e.r.grupo); e.r.liberar(); saindo.delete(e); refazerRotas(); E.sombraSuja = true; E.sujo = true; } });
  }

  function reorganizar() {
    const tams = meus.map(s => s._tam);
    const usar = Math.min(nExt, extensoesPara(tams));
    let plano = planoDeRacks(tams, usar);
    // sem vaga para crescer (ou no máximo de extensões): todos encolhem até caber
    if (plano.length < tams.length && (travado || usar >= EXT_MAX)) {
      let esc = 1;
      // (até 0,3: nenhum servidor fica de fora da sala, mesmo esperando a vaga de crescer)
      while (esc > 0.3 && plano.length < tams.length) { esc -= 0.05; plano = planoDeRacks(tams, usar, esc); }
    }
    const vistos = new Set();
    plano.forEach((p, i) => {
      const srv = meus[i], ch = chaveDe(srv);
      vistos.add(ch);
      let e = racks.get(ch);
      if (e && e.tam !== p.tam) { racks.delete(ch); sairRack(e); e = null; }   // mudou de tamanho: troca o rack
      if (!e) {
        e = { id: ++contador, chave: ch, tam: p.tam, r: criarRack(srv, contador, p.tam), x: p.x, z: p.z, ext: p.ext, escala: p.escala };
        e.r.grupo.rotation.y = Math.PI / 2;   // de frente para +x, alinhado às paredes
        e.r.grupo.position.set(p.x, 0, p.z);
        e.r.grupo.scale.set(p.escala, 0.001, p.escala);
        fileira.add(e.r.grupo);
        racks.set(ch, e);
        tween({ obj: e.r.grupo.scale, prop: 'y', para: p.escala, dur: 0.5, atraso: 0.05 * (i % 6), ease: 'easeOutBack', chave: 'rack:' + e.id });
      } else {
        if (Math.abs(e.x - p.x) > 1e-3 || Math.abs(e.z - p.z) > 1e-3) {
          tween({ obj: e.r.grupo.position, prop: 'x', para: p.x, dur: 0.7, ease: 'easeInOutSine', chave: 'rack:' + e.id + ':x' });
          tween({ obj: e.r.grupo.position, prop: 'z', para: p.z, dur: 0.7, ease: 'easeInOutSine', chave: 'rack:' + e.id + ':z' });
        }
        if (Math.abs(e.escala - p.escala) > 1e-3) {
          e.r.grupo.scale.x = e.r.grupo.scale.z = p.escala;
          tween({ obj: e.r.grupo.scale, prop: 'y', para: p.escala, dur: 0.4, chave: 'rack:' + e.id });
        }
        e.x = p.x; e.z = p.z; e.ext = p.ext; e.escala = p.escala;
      }
      e.r.atualizar(srv);
    });
    for (const [ch, e] of [...racks]) if (!vistos.has(ch)) { racks.delete(ch); sairRack(e); }
    refazerRotas();
    E.sombraSuja = true;
    E.sujo = true;
  }

  // Extensão k sem rack (nem encolhendo) e sem o técnico dentro: pode desacoplar
  function extensaoVazia(k) {
    for (const e of [...racks.values(), ...saindo]) if (e.ext >= k) return false;
    return tec.boneco.position.x > XE - VAGA * (k - 1) + 0.05;
  }

  // caminhos do técnico: refeitos quando os racks mudam ou a sala cresce/encolhe
  let roteador = null;
  function refazerRotas() {
    const usadas = Math.max(0, ...[...racks.values(), ...saindo].map(e => e.ext));
    const obst = [
      { x: PX, z: PZ, hx: PL / 2 + 0.15, hz: 0.2 },
      { x: AX, z: AZ, hx: PROF_RACK / 2, hz: LARG_RACK * 0.8 },
      { x: 2.0, z: zPlanta, hx: 0.25, hz: 0.25 },
      ...[...racks.values(), ...saindo].map(e => ({ x: e.x, z: e.z, hx: TAMANHOS_RACK[e.tam].prof * e.escala / 2, hz: TAMANHOS_RACK[e.tam].larg * e.escala / 2 })),
    ];
    roteador = criarRoteador(obst, { x0: XE - VAGA * usadas + 0.4, x1: 1.95, z0: ZF + 0.4, z1: 3.0 });
  }
  refazerRotas();

  function alvos() {
    const lista = [...racks.values()].map(e => ({ tipo: 'rack', cpu: meus.find(s => chaveDe(s) === e.chave)?.cpu,
      pos: new THREE.Vector3(e.x + TAMANHOS_RACK[e.tam].prof * e.escala / 2 + 0.45, 0, e.z), olhar: -Math.PI / 2 }));
    lista.push({ tipo: 'painel', pos: new THREE.Vector3(PX, 0, PZ + 0.95), olhar: Math.PI });
    lista.push({ tipo: 'apps', pos: new THREE.Vector3(AX + PROF_RACK / 2 + 0.45, 0, AZ), olhar: -Math.PI / 2 });
    return lista;
  }
  // caixote do cochilo: aparece quando ele vai sentar e some quando levanta
  const caixote = new THREE.Group();
  caixa(0.5, 0.36, 0.4, 0x8a5a3a, 0, 0, 0, caixote);
  caixa(0.52, 0.03, 0.42, 0x6e4529, 0, 0.36, 0, caixote, { seg: 0 });
  caixa(0.18, 0.02, 0.02, 0xd9d9de, 0, 0.26, 0.205, caixote, { seg: 0, sombra: false });
  caixote.position.set(0.75, 0, PZ + 0.95);
  sala.add(caixote);
  const cochilo = { pos: new THREE.Vector3(0.75, 0, PZ + 1.5), assento: caixote.position.clone(), y: 0.39 - 0.30 * ESCALA, olhar: 0 };

  const tec = rotinaModulo({ alvos, rota: (a, b) => roteador(a, b), cochilo, caixote });
  tec.boneco.position.set(0, 0, 0.4);
  sala.add(tec.boneco);
  const corpo = registrarNpc(tec.boneco, { sala: 'servidores' });

  let anterior = null;
  function animar(tempo) {
    const dt = anterior == null ? 1 / 60 : Math.min(0.1, Math.max(0, tempo - anterior));
    anterior = tempo;
    // o servidor que sumiu não voltou: o rack sai (sem esperar a próxima leitura mudar)
    if (ausentes.size) {
      const agora = Date.now();
      let saiu = false;
      for (const [ch, a] of ausentes) if (agora - a.desde > AUSENTE_MS) { ausentes.delete(ch); saiu = true; }
      if (saiu) montarLista();
    }
    for (const e of racks.values()) e.r.animar(tempo);
    for (const e of saindo) e.r.animar(tempo);
    tec.atualizar(tempo, dt);
  }
  return {
    grupo: sala, atualizar, animar, npcs: [tec.boneco],
    cochilar: sim => tec.cochilar(sim), dormindo: () => tec.dormindo(),
    extensoesNecessarias, definirExtensoes, extensaoVazia,
    racks: () => [...racks.values()].map(e => ({ nome: meus.find(s => chaveDe(s) === e.chave)?.nome, tam: e.tam, x: +e.x.toFixed(2), z: +e.z.toFixed(2), ext: e.ext, escala: e.escala })),
    dadosAtuais: () => ultimosDados,
    liberar() {
      removerNpc(corpo); painel.liberar(); rackApps.liberar();
      for (const e of [...racks.values(), ...saindo]) { cancelarTweens('rack:' + e.id); e.r.liberar(); }
    },
  };
}

// Técnico no módulo: a rotina de sempre (rack mais ocupado chama mais atenção, painel e
// apps de vez em quando), com rotas pelo roteador, corpo sólido e cochilo
function rotinaModulo({ alvos, rota: roteador, cochilo: lugar, caixote }) {
  const { boneco, maleta } = criarTecnico();
  boneco.userData.npc = true;
  let semente = 7919;
  const sorte = () => { semente = (semente * 48271) % 2147483647; return semente / 2147483647; };
  let rota = [], acao = null, ate = 0, ultimo = -1, passo = 0;
  const est = { olhar: 0, travadoDesde: null, andou: 0 };
  const coch = criarCochilo({ boneco, assento: { entrada: lugar.pos, pos: lugar.assento, y: lugar.y, olhar: lugar.olhar }, banco: caixote,
    rota: roteador, vel: VEL, faseAnim: 0.7, aoAcordar: () => { rota = []; acao = null; maleta.visible = true; } });

  function escolher() {
    const lista = alvos();
    if (!lista.length) return null;
    const pesos = lista.map((a, i) => (i === ultimo ? 0.05 : 1) * (a.tipo === 'rack' ? 1 + (a.cpu || 0) / 8 : a.tipo === 'painel' ? 1.3 : 0.8));
    let r = sorte() * pesos.reduce((x, y) => x + y, 0);
    for (let i = 0; i < lista.length; i++) { r -= pesos[i]; if (r <= 0) { ultimo = i; return lista[i]; } }
    ultimo = 0; return lista[0];
  }
  function atualizar(t, dt) {
    if (coch.atualizar(t, dt)) { maleta.visible = true; return; }
    if (rota.length) {
      const r = passoNpc(boneco, rota[0], VEL, dt, est, t);
      if (r === 'chegou') {
        rota.shift();
        if (!rota.length) ate = t + (acao?.tipo === 'painel' ? 3 + sorte() * 3 : 4 + sorte() * 5);
      } else if (r === 'andou') passo += est.andou / (0.42 * ESCALA) * Math.PI;
      else if (t - est.travadoDesde > 2.5) { rota = []; acao = null; est.travadoDesde = null; }   // travado: muda de ideia
      boneco.userData.animar(t, r === 'parado' ? 'parado' : 'andar', false, { dt, passo, fase: 0.7 });
    } else if (acao && t < ate) {
      est.olhar = acao.olhar;
      boneco.userData.animar(t, acao.tipo === 'painel' ? 'parado' : 'digitar', false, { dt, fase: 0.7 });
      maleta.visible = acao.tipo === 'painel';
    } else {
      maleta.visible = true;
      marcarAndando(boneco, false);
      const prox = escolher();
      if (prox) { rota = roteador(boneco.position.clone().setY(0), prox.pos); acao = prox; }
      boneco.userData.animar(t, 'parado', false, { dt, fase: 0.7 });
    }
    const dif = ((est.olhar - boneco.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    boneco.rotation.y += dif * Math.min(1, dt * 8);
  }
  return { boneco, atualizar, cochilar: sim => coch.pedir(sim), dormindo: () => coch.dormindo() };
}
