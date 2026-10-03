// Corpos dos NPCs das salas (F1-SALAS-E-VIDA, 03/10): técnico, porteiro,
// despachante, coordenador, bibliotecário, mecânico e operadores.
//
// NPC não é agente: fica fora do hover, da lotação e do mapa de caminhos
// (userData.npc), e cada um tem rotina própria dentro da sua sala. Mas o corpo é
// sólido como o de todo astronauta: nenhum NPC chega a menos de 0,86 (o capacete) de
// um astronauta de sessão ou de outro NPC, e os astronautas desviam dos NPCs.
//
// EXPORTS
//   registrarNpc(boneco, { sala })  põe o boneco no registro (devolve o corpo)
//   removerNpc(corpo)               tira do registro (sala que desacoplou)
//   corposNpc()                     [{ corpo, boneco, x, z, andando }] em coordenadas
//                                   de mundo, só os que estão na cena
//   passoLivre(boneco, nx, nz)      o NPC pode ir para (nx, nz), nas coordenadas do pai
//                                   do boneco? Não pode se ficar a menos de 0,6 de alguém
//                                   e mais perto do que já está (quem está perto pode se
//                                   afastar). Sem a cena (vitrine), sempre pode.
//   marcarAndando(boneco, sim)      o NPC está andando neste quadro (os astronautas
//                                   contornam quem está parado e esperam quem anda)
// Sem dependência de agentes.js: lê E.agentes (estado.js) direto.

import * as THREE from 'three';
import { E } from './estado.js';

export const RAIO_NPC = 0.3;
// distância mínima entre centros: o capacete tem 0,84 m de diâmetro na escala 1,45, então
// com 0,6 (2 x raio do corpo) eles se sobrepunham na tela (pedido do Eduardo, 03/10)
const DMIN = 0.86;

const corpos = new Set();

export function registrarNpc(boneco, { sala = null } = {}) {
  const corpo = { boneco, sala, andando: false };
  boneco.userData.corpoNpc = corpo;
  corpos.add(corpo);
  return corpo;
}

export function removerNpc(corpo) {
  if (!corpo) return;
  corpos.delete(corpo);
  if (corpo.boneco?.userData) corpo.boneco.userData.corpoNpc = null;
}

export function marcarAndando(boneco, sim) {
  const c = boneco?.userData?.corpoNpc;
  if (c) c.andando = !!sim;
}

// Está na cena da Estação (e não numa vitrine ou num módulo já removido)?
function naCena(o) {
  if (!E.cena) return false;
  for (let p = o; p; p = p.parent) {
    if (p === E.cena) return true;
    if (p.visible === false) return false;
  }
  return false;
}

const _p = new THREE.Vector3();
export function corposNpc() {
  const lista = [];
  for (const c of corpos) {
    if (!naCena(c.boneco)) continue;
    c.boneco.getWorldPosition(_p);
    lista.push({ corpo: c, boneco: c.boneco, x: _p.x, z: _p.z, andando: c.andando });
  }
  return lista;
}

// Astronautas de sessão que contam como corpo (mesma regra de agentes.js: na cena,
// visíveis e sem estar sumindo)
function corposAgentes() {
  const lista = [];
  for (const a of E.agentes?.values?.() || []) {
    if (a.aguardandoEntrada || !a.boneco?.visible) continue;
    if (!(a.fade > 0.15 || (!a.saindo && !a.resgatando))) continue;
    lista.push(a.boneco.position);
  }
  return lista;
}

const _de = new THREE.Vector3(), _para = new THREE.Vector3();
export function passoLivre(boneco, nx, nz) { return !quemBloqueiaNpc(boneco, nx, nz); }

// Quem impede o passo do NPC: 'agente', 'npc' ou null (livre)
export function quemBloqueiaNpc(boneco, nx, nz) {
  const pai = boneco?.parent;
  if (!pai || !naCena(boneco)) return null;
  pai.updateWorldMatrix(true, false);
  _de.copy(boneco.position).setY(0);
  pai.localToWorld(_de);
  _para.set(nx, 0, nz);
  pai.localToWorld(_para);
  const bloqueia = (x, z) => {
    const d2 = (_para.x - x) ** 2 + (_para.z - z) ** 2;
    if (d2 >= DMIN * DMIN) return false;
    return d2 < (_de.x - x) ** 2 + (_de.z - z) ** 2 - 1e-9;
  };
  for (const q of corposAgentes()) if (bloqueia(q.x, q.z)) return 'agente';
  for (const c of corposNpc()) if (c.boneco !== boneco && bloqueia(c.x, c.z)) return 'npc';
  return null;
}

// ---------------------------------------------------------------------------
// Caminhos dentro de uma sala: grafo de visibilidade sobre retângulos inflados pelo
// raio do corpo (o mesmo da Biblioteca da memória). obstaculos: [{ x, z, hx, hz }]
// (centro e meias medidas, nas coordenadas da sala); limites: { x0, x1, z0, z1 } por
// onde o centro do corpo pode passar. Devolve rota(a, b) -> [pontos] sem o de partida.
// ---------------------------------------------------------------------------
export function criarRoteador(obstaculos, limites, raio = RAIO_NPC) {
  const obs = obstaculos.map(o => ({ ...o, hx: o.hx + raio, hz: o.hz + raio }));
  const dentro = (o, x, z, folga = 0) => Math.abs(x - o.x) < o.hx - folga && Math.abs(z - o.z) < o.hz - folga;
  // segmento x retângulo (Liang-Barsky)
  function corta(o, ax, az, bx, bz) {
    const x1 = ax - o.x, z1 = az - o.z, dx = bx - ax, dz = bz - az;
    let t0 = 0, t1 = 1;
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
    const x = o.x + sx * (o.hx + 0.04), z = o.z + sz * (o.hz + 0.04);
    if (noLimite(x, z) && !obs.some(p => dentro(p, x, z))) nos.push(new THREE.Vector3(x, 0, z));
  }
  const livre = (a, b, ignorar) => !obs.some(o => !ignorar.has(o) && corta(o, a.x, a.z, b.x, b.z));
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
    if (ant[n - 1] < 0) return [b.clone()];
    const lista = [];
    for (let i = n - 1; i > 0; i = ant[i]) lista.unshift(todos[i].clone());
    return lista;
  };
}

// ---------------------------------------------------------------------------
// Andar um passo (comum às rotinas): anda até 'alvo' (Vector3 nas coordenadas do pai)
// respeitando o corpo sólido. Devolve 'chegou' | 'andou' | 'parado'. Guarda em
// estado.travadoDesde quando começou a ficar parado por alguém no caminho.
// ---------------------------------------------------------------------------
// Travado por um astronauta de sessão (que não pede passagem a NPC) por mais de 0,5 s,
// o NPC recua pelo caminho que acabou de fazer (rastro, livre de móveis) até ~1 m
// atrás: quem está levantando do banquinho ou chegando no lugar dele passa.
export function passoNpc(boneco, alvo, vel, dt, estado, t) {
  const p = boneco.position;
  const rastro = (estado.rastro ||= []);
  const dx = alvo.x - p.x, dz = alvo.z - p.z, dist = Math.hypot(dx, dz);
  if (dist < 0.03) { estado.travadoDesde = null; marcarAndando(boneco, false); return 'chegou'; }
  const anda = Math.min(dist, vel * dt);
  const nx = p.x + dx / dist * anda, nz = p.z + dz / dist * anda;
  const quem = quemBloqueiaNpc(boneco, nx, nz);
  if (quem) {
    if (estado.travadoDesde == null) estado.travadoDesde = t;
    if (quem === 'agente' && t - estado.travadoDesde > 0.5 && rastro.length) {
      // volta pelo rastro (o ponto mais antigo a até ~1 m)
      const r = rastro[rastro.length - 1];
      const rx = r.x - p.x, rz = r.z - p.z, rd = Math.hypot(rx, rz);
      if (rd < 0.03) rastro.pop();
      else {
        const k = Math.min(rd, vel * dt) / rd;
        if (!quemBloqueiaNpc(boneco, p.x + rx * k, p.z + rz * k)) {
          p.x += rx * k; p.z += rz * k;
          estado.andou = rd * k;
          estado.olhar = Math.atan2(-rx, -rz);   // recua de frente para quem passa
          marcarAndando(boneco, true);
          return 'andou';
        }
      }
    }
    marcarAndando(boneco, false);
    return 'parado';
  }
  estado.travadoDesde = null;
  const ultimo = rastro[rastro.length - 1];
  if (!ultimo || Math.hypot(p.x - ultimo.x, p.z - ultimo.z) > 0.12) { rastro.push({ x: p.x, z: p.z }); if (rastro.length > 9) rastro.shift(); }
  p.x = nx; p.z = nz;
  estado.andou = anda;
  estado.olhar = Math.atan2(dx, dz);
  marcarAndando(boneco, true);
  return 'andou';
}

// ---------------------------------------------------------------------------
// Cochilo dos NPCs (F1): com a estação parada há mais de 1 min (ninguém trabalhando),
// cada NPC termina o passo, vai até o lugar dele, senta e para; a cena volta a 0
// quadros por segundo. Quando alguém começa a trabalhar, levanta e volta à rotina.
//   criarCochilo({ boneco, assento: { entrada, pos, y, olhar }, banco, rota, vel,
//                  aoAcordar, modoSentado })
//     assento.entrada: ponto livre de onde ele senta; assento.pos: onde fica sentado;
//     assento.y: y do boneco sentado (topo do assento - 0,30 x escala);
//     banco: Object3D opcional que aparece quando ele vai sentar e some quando
//     levanta (nada de assento vazio à mostra); rota(de, para) -> [pontos].
//   cochilo.pedir(sim), cochilo.atualizar(t, dt) -> true quando o cochilo cuidou do
//   boneco neste quadro (a rotina não mexe nele), cochilo.dormindo().
// ---------------------------------------------------------------------------
export function criarCochilo({ boneco, assento, banco = null, rota, vel = 1, aoAcordar = null, modoSentado = 'descansar', faseAnim = 0 }) {
  let quer = false, fase = 'acordado', desde = 0, k = banco ? 0 : 1, caminho = [], passo = 0;
  const est = { olhar: 0, travadoDesde: null, andou: 0 };
  if (banco) { banco.scale.setScalar(0.001); banco.userData.semMapa = true; }
  const de = new THREE.Vector3();
  function girar(alvo, dt) {
    const dif = ((alvo - boneco.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    boneco.rotation.y += dif * Math.min(1, dt * 8);
  }
  function atualizarBanco(dt) {
    if (!banco) return;
    const alvo = fase === 'sentando' || fase === 'dormindo' || fase === 'levantando' || (fase === 'indo' && caminho.length <= 1) ? 1 : 0;
    if (Math.abs(alvo - k) < 0.002) return;
    k += (alvo - k) * Math.min(1, dt * 7);
    banco.scale.setScalar(Math.max(0.001, k));
  }
  return {
    pedir(sim) { quer = !!sim; },
    get querDormir() { return quer; },
    dormindo: () => fase === 'dormindo',
    acordado: () => fase === 'acordado',
    atualizar(t, dt) {
      atualizarBanco(dt);
      if (fase === 'acordado') {
        if (!quer || !assento) return false;
        fase = 'indo';
        caminho = rota(boneco.position.clone().setY(0), assento.entrada);
      }
      if (fase === 'indo') {
        if (!quer) { fase = 'acordado'; marcarAndando(boneco, false); aoAcordar?.(); return false; }
        if (caminho.length) {
          const r = passoNpc(boneco, caminho[0], vel, dt, est, t);
          if (r === 'chegou') caminho.shift();
          else if (r === 'andou') passo += est.andou / 0.39 * Math.PI;
          else if (t - est.travadoDesde > 3) { est.travadoDesde = null; caminho = rota(boneco.position.clone().setY(0), assento.entrada); }
          boneco.userData.animar(t, r === 'parado' ? 'parado' : 'andar', false, { dt, passo, fase: faseAnim });
          girar(est.olhar, dt);
          return true;
        }
        fase = 'sentando'; desde = t; de.copy(boneco.position).setY(0);
      }
      if (fase === 'sentando') {
        const u = Math.min(1, (t - desde) / 0.7), e = u * u * (3 - 2 * u);
        boneco.position.set(de.x + (assento.pos.x - de.x) * e, assento.y * e, de.z + (assento.pos.z - de.z) * e);
        boneco.userData.animar(t, modoSentado, u > 0.3, { dt, fase: faseAnim });
        girar(assento.olhar, dt * 1.5);
        if (u >= 1 && (!banco || k > 0.98)) { fase = 'dormindo'; boneco.rotation.y = assento.olhar; }
        return true;
      }
      if (fase === 'dormindo') {
        if (quer) return true;
        fase = 'levantando'; desde = t;
      }
      if (fase === 'levantando') {
        const u = Math.min(1, (t - desde) / 0.6), e = u * u * (3 - 2 * u);
        boneco.position.set(assento.pos.x + (assento.entrada.x - assento.pos.x) * e, assento.y * (1 - e), assento.pos.z + (assento.entrada.z - assento.pos.z) * e);
        boneco.userData.animar(t, 'parado', u < 0.5, { dt, fase: faseAnim });
        if (u >= 1) { fase = 'acordado'; boneco.position.y = 0; aoAcordar?.(); }
        return true;
      }
      return false;
    },
  };
}

// Algum astronauta de sessão andando a menos de 'raio' do NPC (ele está no caminho:
// a rotina dá passagem, porque o astronauta não pede passagem a NPC)
export function alguemPrecisaPassar(boneco, raio = 0.95) {
  if (!naCena(boneco)) return false;
  boneco.getWorldPosition(_p);
  for (const a of E.agentes?.values?.() || []) {
    if (a.aguardandoEntrada || a.saindo || a.estado !== 'andando') continue;
    const q = a.boneco.position;
    if (Math.hypot(q.x - _p.x, q.z - _p.z) < raio) return true;
  }
  return false;
}
