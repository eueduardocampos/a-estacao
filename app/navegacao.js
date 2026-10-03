// Mapa de caminhos do escritório: uma grade sobre o piso marcando onde dá para
// andar. Tudo que está apoiado no chão (paredes, divisórias, mesas, estantes,
// sofás, plantas...) vira obstáculo, com uma folga do tamanho do astronauta.
// Os caminhos são calculados com A* e depois "esticados" para ficarem naturais.
//
// Fila indiana e corpo sólido (requisito obrigatório de 03/10):
// - cada astronauta é um corpo de raio RAIO_CORPO (0,3 m); os trechos andados
//   ficam a pelo menos FOLGA + meia célula de qualquer obstáculo (medido: 0,34 m);
// - no corredor vale a mão direita: quem anda para +x usa a faixa de z positivo e
//   quem anda para -x a de z negativo (definirCorredor). As faixas ficam a 0,45 m do
//   meio, então quem vem em sentidos opostos passa a pelo menos 0,6 m (dois raios);
// - as portas ficam registradas (definirPorta / portaEm) para o pacote de agentes
//   fazer passar um por vez; pontosEmFila devolve lugares de espera espaçados e
//   longe de divisória; folgaEm e invade servem para conferir que nenhum corpo
//   entra em parede, divisória ou móvel (teste dos 50 agentes).
//
// Estação elástica (rodada 3): o mapa é criado uma vez só, com a largura máxima
// da estação, e remontado a cada módulo que acopla ou desacopla (limpar() e
// bloquear de novo). Os obstáculos de cada módulo são medidos uma vez, com o
// grupo dele em escala 1 e as mesas como posto (medirObstaculos), e guardados em
// coordenadas locais; a cena nunca é varrida com astronautas dentro.

import * as THREE from 'three';

const CELULA = 0.2;     // tamanho de cada quadradinho da grade
const FOLGA = 0.24;     // meia largura do astronauta: distância mínima dos obstáculos
export const RAIO_CORPO = 0.3;   // raio do corpo sólido do astronauta
export const PASSO_FILA = 0.7;   // distância entre quem está na fila (cerca de 1 passo)
// Faixas da mão direita no corredor: centro a 0,45 m do meio, meia largura 0,15 m
const MEIO_FAIXA = 0.45, MEIA_FAIXA = 0.15, PESO_FAIXA = 1.5;
const BALDE = 1;          // tamanho do balde do índice de obstáculos (m)
const ALCANCE_FOLGA = 2;  // folgaEm mede até essa distância

// Retângulos dos obstáculos de um grupo (um módulo da estação), em coordenadas
// relativas à posição do grupo: tudo que encosta no chão e tem altura (os mesmos
// filtros de marcarObstaculos). Medir com o grupo em escala 1, y = 0 e as mesas
// como posto (banqueta puxada, monitor em escala 1), para guardar a banqueta ou
// recolher o monitor nunca abrir buraco no mapa.
export function medirObstaculos(grupo, ignorar = () => false) {
  const caixa = new THREE.Box3();
  const rects = [];
  grupo.updateWorldMatrix(true, true);
  const ox = grupo.position.x, oz = grupo.position.z;
  grupo.traverse(o => {
    if (!o.isMesh || foraDoMapa(o) || ignorar(o)) return;
    caixa.setFromObject(o);
    if (caixa.isEmpty() || caixa.max.y <= 0.12 || caixa.min.y >= 0.9) return;
    rects.push({ xa: caixa.min.x - ox, za: caixa.min.z - oz, xb: caixa.max.x - ox, zb: caixa.max.z - oz });
  });
  return rects;
}

// Marcas em userData que tiram um objeto (e tudo dentro dele) do mapa:
// astronautas, NPCs, caixas de acerto do hover e peças decorativas (luz no piso,
// cortina, quadro...)
const MARCAS_FORA_DO_MAPA = ['agenteId', 'npc', 'hitbox', 'semMapa'];
function foraDoMapa(o) {
  for (let p = o; p; p = p.parent) {
    const d = p.userData;
    if (d && MARCAS_FORA_DO_MAPA.some(k => d[k])) return true;
  }
  return false;
}

export class Mapa {
  constructor(x0, x1, z0, z1) {
    this.x0 = x0; this.z0 = z0;
    this.nx = Math.ceil((x1 - x0) / CELULA);
    this.nz = Math.ceil((z1 - z0) / CELULA);
    this.bloq = new Uint8Array(this.nx * this.nz);
    this.obstaculos = [];   // caixas cruas (sem folga) de tudo que foi bloqueado
    this.corredores = [];   // trechos com mão direita
    this.portas = [];       // passagens de um por vez
    this.baldes = null;     // índice dos obstáculos, montado na primeira consulta
    this.celCorredor = null;
  }

  celula(x, z) {
    return [Math.floor((x - this.x0) / CELULA), Math.floor((z - this.z0) / CELULA)];
  }
  centro(i, j) {
    return new THREE.Vector3(this.x0 + (i + 0.5) * CELULA, 0, this.z0 + (j + 0.5) * CELULA);
  }
  dentro(i, j) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz; }

  bloquearRetangulo(xa, za, xb, zb) {
    this.obstaculos.push({ xa, za, xb, zb });
    this.baldes = null;
    const [i0, j0] = this.celula(xa - FOLGA, za - FOLGA);
    const [i1, j1] = this.celula(xb + FOLGA, zb + FOLGA);
    for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++)
      for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) this.bloq[j * this.nx + i] = 1;
  }

  // Vários retângulos de uma vez (rodada 3: móveis de uma sala deslocada).
  // rects = [{ xa, za, xb, zb }] em coordenadas de mundo antes do deslocamento
  // (dx, dz); cada um recebe a mesma folga de marcarObstaculos.
  bloquearRetangulos(rects, dx = 0, dz = 0) {
    for (const r of rects) this.bloquearRetangulo(r.xa + dx, r.za + dz, r.xb + dx, r.zb + dz);
  }

  // Esvazia o mapa (rodada 3: remontar depois de mudar a planta). Corredores e
  // portas também saem: quem remonta registra de novo.
  limpar() {
    this.bloq.fill(0);
    this.alcance = null;
    this.obstaculos = [];
    this.corredores = [];
    this.portas = [];
    this.baldes = null;
    this.celCorredor = null;
  }

  // -------------------------------------------------------------------------
  // Corpo sólido: distância até o obstáculo mais perto (caixas cruas, sem folga)
  // -------------------------------------------------------------------------
  indexar() {
    this.baldes = new Map();
    const m = ALCANCE_FOLGA;
    for (const r of this.obstaculos) {
      for (let bi = Math.floor((r.xa - m) / BALDE); bi <= Math.floor((r.xb + m) / BALDE); bi++)
        for (let bj = Math.floor((r.za - m) / BALDE); bj <= Math.floor((r.zb + m) / BALDE); bj++) {
          const k = bi + ',' + bj;
          if (!this.baldes.has(k)) this.baldes.set(k, []);
          this.baldes.get(k).push(r);
        }
    }
  }

  // Distância (m) do ponto até a borda do obstáculo mais perto, até ALCANCE_FOLGA.
  // Dentro de um obstáculo dá 0.
  folgaEm(x, z) {
    if (!this.baldes) this.indexar();
    const lista = this.baldes.get(Math.floor(x / BALDE) + ',' + Math.floor(z / BALDE));
    let menor = ALCANCE_FOLGA;
    if (lista) for (const r of lista) {
      const dx = Math.max(r.xa - x, 0, x - r.xb), dz = Math.max(r.za - z, 0, z - r.zb);
      const d = Math.hypot(dx, dz);
      if (d < menor) menor = d;
    }
    return menor;
  }

  // Caixas cruas (sem folga) que contêm o ponto (F2: "ninguém de cara para a parede",
  // estacao.paredeNaFrente separa parede de móvel)
  obstaculosEm(x, z) {
    if (!this.baldes) this.indexar();
    const lista = this.baldes.get(Math.floor(x / BALDE) + ',' + Math.floor(z / BALDE));
    return lista ? lista.filter(r => x >= r.xa && x <= r.xb && z >= r.za && z <= r.zb) : [];
  }

  // Um corpo de raio dado em (x, z) entra em parede, divisória ou móvel?
  // (Quem está sentado fica de propósito dentro da área da cadeira ou do sofá:
  // o teste deve conferir só quem anda ou está em pé.)
  invade(x, z, raio = RAIO_CORPO) { return this.folgaEm(x, z) < raio - 1e-6; }

  // -------------------------------------------------------------------------
  // Fila indiana: corredor com mão direita, portas e lugares de espera
  // -------------------------------------------------------------------------
  // Corredor ao longo de x, entre za e zb (centros das divisórias). Quem anda
  // para +x vai pela faixa de z maior; para -x, pela de z menor.
  definirCorredor({ xa, xb, za, zb }) {
    const meio = Math.min(MEIO_FAIXA, (zb - za) / 4);
    this.corredores.push({ xa, xb, za, zb, zc: (za + zb) / 2, meio });
    this.celCorredor = null;
  }

  corredorEm(x, z) {
    return this.corredores.find(c => x >= c.xa && x <= c.xb && z >= c.za && z <= c.zb) || null;
  }

  // z do meio da faixa da mão direita para quem anda no sentido sx (+1 ou -1)
  faixaDaMaoDireita(c, sx) { return c.zc + Math.sign(sx || 1) * c.meio; }

  // Passagem de um por vez. eixo = direção de quem atravessa ('x' ou 'z').
  definirPorta({ x, z, larg, eixo = 'z', sala = null }) {
    this.portas.push({ x, z, larg, eixo, sala });
  }

  // Porta cuja passagem contém o ponto (margem = quanto antes e depois do vão conta)
  portaEm(x, z, margem = 0.6) {
    return this.portas.find(p => {
      const ao = p.eixo === 'z' ? z - p.z : x - p.x;     // ao longo da travessia
      const la = p.eixo === 'z' ? x - p.x : z - p.z;     // de lado
      return Math.abs(ao) <= margem && Math.abs(la) <= p.larg / 2;
    }) || null;
  }

  // n lugares de espera a partir de 'inicio', na direção (dx, dz), um atrás do
  // outro a 'passo' de distância. Cada um cai na célula andável mais perto com
  // pelo menos 'folga' de qualquer obstáculo e longe dos lugares já escolhidos.
  pontosEmFila(inicio, direcao, n, { passo = PASSO_FILA, folga = RAIO_CORPO + 0.1 } = {}) {
    const len = Math.hypot(direcao.x, direcao.z) || 1;
    const ux = direcao.x / len, uz = direcao.z / len;
    const pontos = [];
    for (let k = 0; k < n; k++) {
      const alvo = { x: inicio.x + ux * passo * k, z: inicio.z + uz * passo * k };
      const ok = (i, j) => {
        if (!this.dentro(i, j) || !this.andavel(j * this.nx + i)) return false;
        const c = this.centro(i, j);
        if (this.folgaEm(c.x, c.z) < folga) return false;
        return pontos.every(p => Math.hypot(p.x - c.x, p.z - c.z) >= passo * 0.9);
      };
      const cel = this.buscarCelula(...this.celula(alvo.x, alvo.z), ok);
      if (cel) pontos.push(this.centro(cel[0], cel[1]));
    }
    return pontos;
  }

  // Busca em largura a partir de (i, j) pela primeira célula que satisfaz ok
  buscarCelula(i, j, ok, passos = 40) {
    if (ok(i, j)) return [i, j];
    const visto = new Set([j * this.nx + i]);
    let borda = [[i, j]];
    for (let passo = 0; passo < passos && borda.length; passo++) {
      const prox = [];
      for (const [ci, cj] of borda) {
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (!this.dentro(ni, nj)) continue;
          const k = nj * this.nx + ni;
          if (visto.has(k)) continue;
          visto.add(k);
          if (ok(ni, nj)) return [ni, nj];
          prox.push([ni, nj]);
        }
      }
      borda = prox;
    }
    return null;
  }

  // Índice do corredor de cada célula (0 = fora), para o A* não procurar toda hora
  mapearCorredores() {
    this.celCorredor = new Int16Array(this.nx * this.nz);
    this.corredores.forEach((c, n) => {
      for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
        const p = this.centro(i, j);
        if (p.x >= c.xa && p.x <= c.xb && p.z >= c.za && p.z <= c.zb) this.celCorredor[j * this.nx + i] = n + 1;
      }
    });
  }

  // Custo extra de andar ao longo do corredor fora da faixa da mão direita
  custoFaixa(k, ni, nj, di) {
    if (!di || !this.corredores.length) return 0;
    if (!this.celCorredor) this.mapearCorredores();
    const n = this.celCorredor[k];
    if (!n) return 0;
    const c = this.corredores[n - 1];
    const z = this.z0 + (nj + 0.5) * CELULA;
    const desvio = Math.abs(z - this.faixaDaMaoDireita(c, di));
    return PESO_FAIXA * Math.min(1, Math.max(0, desvio - MEIA_FAIXA) / 0.3);
  }

  // Varre a cena: tudo que encosta no chão e tem altura vira obstáculo.
  // Ignora piso, tapete, capacho (baixos demais), o que está pendurado
  // (luminárias, quadros, janelas, monitores sobre a mesa contam pela mesa) e
  // o que tem userData.agenteId, npc, hitbox ou semMapa (nele ou num pai).
  marcarObstaculos(cena, ignorar = () => false) {
    const caixa = new THREE.Box3();
    cena.updateMatrixWorld(true);
    cena.traverse(o => {
      if (!o.isMesh || foraDoMapa(o) || ignorar(o)) return;
      caixa.setFromObject(o);
      if (caixa.max.y <= 0.12 || caixa.min.y >= 0.9) return;
      this.bloquearRetangulo(caixa.min.x, caixa.min.z, caixa.max.x, caixa.max.z);
    });
  }

  // Marca quais células livres estão ligadas ao ponto dado (o corredor).
  // Bolsões fechados entre móveis deixam de contar como lugar andável.
  calcularAlcance(ponto) {
    this.alcance = new Uint8Array(this.nx * this.nz);
    const [i0, j0] = this.celula(ponto.x, ponto.z);
    const fila = [j0 * this.nx + i0];
    this.alcance[fila[0]] = 1;
    while (fila.length) {
      const k = fila.pop();
      const ci = k % this.nx, cj = (k - ci) / this.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (!this.dentro(ni, nj)) continue;
        const nk = nj * this.nx + ni;
        if (this.bloq[nk] || this.alcance[nk]) continue;
        this.alcance[nk] = 1;
        fila.push(nk);
      }
    }
  }

  andavel(k) { return !this.bloq[k] && (!this.alcance || this.alcance[k]); }

  livre(i, j, liberados) {
    if (!this.dentro(i, j)) return false;
    if (this.andavel(j * this.nx + i)) return true;
    return liberados.some(([li, lj, r]) => (i - li) ** 2 + (j - lj) ** 2 <= r * r);
  }

  // Célula livre mais próxima (busca em largura), para quem está sentado numa
  // cadeira ou num sofá, que ficam dentro da área bloqueada da mobília
  livreMaisProxima(i, j) {
    if (this.dentro(i, j) && this.andavel(j * this.nx + i)) return [i, j];
    const visto = new Set([j * this.nx + i]);
    let borda = [[i, j]];
    for (let passo = 0; passo < 40 && borda.length; passo++) {
      const prox = [];
      for (const [ci, cj] of borda) {
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (!this.dentro(ni, nj)) continue;
          const k = nj * this.nx + ni;
          if (visto.has(k)) continue;
          visto.add(k);
          if (this.andavel(k)) return [ni, nj];
          prox.push([ni, nj]);
        }
      }
      borda = prox;
    }
    return null;
  }

  // Caminho de A até B desviando dos obstáculos. Devolve lista de pontos.
  // Sai do ponto de partida para a célula livre mais próxima, anda só por células
  // livres e no fim entra no destino (cadeira, sofá) a partir da célula livre vizinha.
  // maoDireita = false desliga as faixas do corredor (rota livre, como antes).
  caminho(de, para, { maoDireita = true } = {}) {
    const ini = this.livreMaisProxima(...this.celula(de.x, de.z));
    const ult = this.livreMaisProxima(...this.celula(para.x, para.z));
    if (!ini || !ult) { console.warn('sem célula livre perto de', de, para); return [para.clone()]; }
    const [si, sj] = ini, [ti, tj] = ult;
    const liberados = [];
    const n = this.nx * this.nz;
    const g = new Float32Array(n).fill(Infinity);
    const veio = new Int32Array(n).fill(-1);
    const fechado = new Uint8Array(n);
    const inicio = sj * this.nx + si, fim = tj * this.nx + ti;
    const h = (i, j) => Math.hypot(i - ti, j - tj);
    const aberta = new FilaMinima();
    g[inicio] = 0;
    aberta.push(inicio, h(si, sj));

    const viz = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (aberta.tamanho) {
      const atual = aberta.pop();
      if (atual === fim) break;
      if (fechado[atual]) continue;
      fechado[atual] = 1;
      const ci = atual % this.nx, cj = (atual - ci) / this.nx;
      for (const [di, dj, custo] of viz) {
        const ni = ci + di, nj = cj + dj;
        if (!this.livre(ni, nj, liberados)) continue;
        // não corta quina na diagonal
        if (di && dj && (!this.livre(ci + di, cj, liberados) || !this.livre(ci, cj + dj, liberados))) continue;
        const k = nj * this.nx + ni;
        const novo = g[atual] + custo * (1 + (maoDireita ? this.custoFaixa(k, ni, nj, di) : 0));
        if (novo < g[k]) {
          g[k] = novo;
          veio[k] = atual;
          aberta.push(k, novo + h(ni, nj));
        }
      }
    }
    if (veio[fim] === -1 && fim !== inicio) {
      console.warn('sem caminho entre', de, para);
      return [para.clone()];
    }

    const celulas = [];
    for (let k = fim; k !== -1; k = veio[k]) celulas.push(k);
    celulas.reverse();

    // estica o caminho: pula pontos intermediários quando há linha de visão livre
    const pontos = celulas.map(k => this.centro(k % this.nx, Math.floor(k / this.nx)));
    const esticado = [pontos[0]];
    let ancora = pontos[0];
    let i = 0;
    while (i < pontos.length - 1) {
      let j = pontos.length - 1;
      while (j > i + 1 && !this.visao(ancora, pontos[j], liberados, maoDireita)) j--;
      esticado.push(pontos[j]);
      ancora = pontos[j];
      i = j;
    }
    // último trecho: da última célula livre até a cadeira/sofá
    esticado.push(para.clone());
    return esticado;
  }

  // Linha de visão com a largura do astronauta. Com faixa = true, um trecho que
  // anda ao longo do corredor também precisa ficar inteiro na faixa da mão direita
  // (trechos curtos ou de travessia passam).
  visao(a, b, liberados, faixa = false) {
    const dist = a.distanceTo(b);
    if (dist < 1e-6) return true;
    const ddx = b.x - a.x, ddz = b.z - a.z;
    const naFaixa = faixa && this.corredores.length && Math.abs(ddx) > 0.4 && Math.abs(ddx) > 1.5 * Math.abs(ddz);
    const passos = Math.ceil(dist / (CELULA * 0.25));
    const px = -(b.z - a.z) / dist * CELULA * 0.5, pz = (b.x - a.x) / dist * CELULA * 0.5;
    for (let s = 0; s <= passos; s++) {
      const t = s / passos;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      if (naFaixa) {
        const c = this.corredorEm(x, z);
        if (c && Math.abs(z - this.faixaDaMaoDireita(c, ddx)) > MEIA_FAIXA + 0.06) return false;
      }
      for (const f of [-1, 0, 1]) {
        const [i, j] = this.celula(x + px * f, z + pz * f);
        if (!this.livre(i, j, liberados)) return false;
      }
    }
    return true;
  }

  // Visualização do mapa (para conferir): verde = andável, vermelho = bloqueado.
  // Chamada de novo (a cada remontagem), troca o desenho anterior.
  desenhar(cena) {
    for (const m of this.desenho || []) { cena.remove(m); m.geometry.dispose(); m.material.dispose(); m.dispose?.(); }
    const geo = new THREE.PlaneGeometry(CELULA * 0.9, CELULA * 0.9).rotateX(-Math.PI / 2);
    const livre = new THREE.MeshBasicMaterial({ color: 0x3fbf6f, transparent: true, opacity: 0.35, depthWrite: false });
    const bloq = new THREE.MeshBasicMaterial({ color: 0xe04a3a, transparent: true, opacity: 0.35, depthWrite: false });
    const total = this.nx * this.nz;
    const mLivre = new THREE.InstancedMesh(geo, livre, total), mBloq = new THREE.InstancedMesh(geo, bloq, total);
    let a = 0, b = 0;
    const m = new THREE.Matrix4();
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const c = this.centro(i, j);
      m.makeTranslation(c.x, 0.07, c.z);
      if (this.bloq[j * this.nx + i]) mBloq.setMatrixAt(b++, m); else mLivre.setMatrixAt(a++, m);
    }
    mLivre.count = a; mBloq.count = b;
    for (const m of [mLivre, mBloq]) { m.userData.semMapa = true; m.raycast = () => {}; }
    mBloq.geometry = geo.clone();   // cada malha com a sua geometria (descarte separado)
    cena.add(mLivre, mBloq);
    this.desenho = [mLivre, mBloq];
  }
}

class FilaMinima {
  constructor() { this.itens = []; }
  get tamanho() { return this.itens.length; }
  push(valor, prioridade) {
    const v = this.itens;
    v.push([prioridade, valor]);
    let i = v.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p][0] <= v[i][0]) break;
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const v = this.itens;
    const topo = v[0];
    const ultimo = v.pop();
    if (v.length) {
      v[0] = ultimo;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < v.length && v[l][0] < v[m][0]) m = l;
        if (r < v.length && v[r][0] < v[m][0]) m = r;
        if (m === i) break;
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return topo[1];
  }
}
