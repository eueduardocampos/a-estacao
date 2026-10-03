// Teste da multidão no terminal (fila indiana e corpo sólido, requisito de 03/10).
// Roda a mesma função do ?teste=multidao (testes.js) sem navegador: monta a
// planta de verdade (layout.js, estacao.js, navegacao.js) e os agentes de
// verdade (agentes.js), com um DOM mínimo, sem WebGL e com relógio de teste
// (Date.now, performance.now e setTimeout andam no tempo simulado).
//
// Uso (na pasta app):
//   node teste-multidao.mjs [agentes=50] [segundos=60] [semente=1] [descansando=10] [segundosDescanso=180] [segundosSalas=120]
// A fase 'salas' (F1) leva 12 astronautas à oficina e à biblioteca, com a missão acoplada,
// e os NPCs de todas as salas entram na conta do corpo sólido.
// Sai com código 1 se houver sobreposição, invasão de obstáculo ou alguém preso.

// ---------------------------------------------------------------------------
// Relógio de teste
// ---------------------------------------------------------------------------
let agoraMs = 1000;
const BASE_DATA = Date.UTC(2026, 9, 3, 12, 0, 0);
const timers = [];
let idTimer = 1;
const perfReal = globalThis.performance;
globalThis.performance = { now: () => agoraMs, mark() {}, measure() {}, timeOrigin: perfReal.timeOrigin };
Date.now = () => BASE_DATA + agoraMs;
globalThis.setTimeout = (f, ms = 0) => { const t = { id: idTimer++, em: agoraMs + ms, f }; timers.push(t); return t.id; };
globalThis.clearTimeout = id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
function avancar(ms) {
  agoraMs = ms;
  timers.sort((a, b) => a.em - b.em);
  while (timers.length && timers[0].em <= agoraMs) timers.shift().f();
}

// ---------------------------------------------------------------------------
// DOM mínimo (placas, balões e texturas de canvas)
// ---------------------------------------------------------------------------
class Classes {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach(x => this.s.add(x)); }
  remove(...c) { c.forEach(x => this.s.delete(x)); }
  toggle(c, f) { const on = f === undefined ? !this.s.has(c) : !!f; if (on) this.s.add(c); else this.s.delete(c); return on; }
  contains(c) { return this.s.has(c); }
}
function contexto2d() {
  const base = {
    measureText(t) { const m = /(\d+)px/.exec(this.font || '10px'); return { width: String(t).length * Number(m ? m[1] : 10) * 0.55 }; },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  return new Proxy(base, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
}
class Elemento {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.style = { setProperty: (k, v) => { this.style[k] = v; } };
    this.classList = new Classes(); this.children = []; this.textContent = ''; this.width = 300; this.height = 150; this.dataset = {};
  }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.s].join(' '); }
  append(...c) { this.children.push(...c); }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  remove() {}
  setAttribute() {} getAttribute() { return null; }
  addEventListener() {} removeEventListener() {}
  getContext() { return (this._ctx ||= contexto2d()); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800 }; }
  querySelector(sel) { return ((this._filhos ||= new Map()).get(sel) || this._filhos.set(sel, new Elemento('span')).get(sel)); } querySelectorAll() { return []; }
}
Elemento.prototype.ownerDocument = { defaultView: { Element: Elemento } };
const porId = new Map();
globalThis.document = {
  createElement: tag => new Elemento(tag),
  getElementById: id => { if (!porId.has(id)) porId.set(id, new Elemento('div')); return porId.get(id); },
  querySelector: () => null, querySelectorAll: () => [],
  body: new Elemento('body'), hidden: false, title: '',
  fonts: { load: async () => {} },
  addEventListener() {},
};
globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.innerWidth = 1280; globalThis.innerHeight = 800; globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = () => 0;

// ---------------------------------------------------------------------------
// Planta e cena (sem WebGL)
// ---------------------------------------------------------------------------
const THREE = await import('three');
const { E } = await import('./estado.js');
const { construir } = await import('./layout.js');
const { testarMultidao } = await import('./testes.js');

E.renderer = {
  setPixelRatio() {}, setSize() {}, render() {}, shadowMap: {}, domElement: document.createElement('canvas'),
  capabilities: { getMaxAnisotropy: () => 16 },
  info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } },
};
E.rotulos = { setSize() {}, render() {} };
E.cena = new THREE.Scene();
E.camera = new THREE.OrthographicCamera(-20, 20, 12, -12, 1, 160);
E.controles = { target: new THREE.Vector3(), update() {}, addEventListener() {}, mouseButtons: {}, touches: {} };
E.sol = new THREE.DirectionalLight();
E.cena.add(E.sol, E.sol.target);
construir();
E.construido = true;
avancar(agoraMs + 100);   // um quadro: o mapa da estação fica pronto

const [agentes = 50, segundos = 60, semente = 1, descansando = 10, segundosDescanso = 180, segundosSalas = 120] = process.argv.slice(2).map(Number);
const inicio = perfReal.now();
const r = await testarMultidao({ agentes, segundos, semente, descansando, segundosDescanso, segundosSalas, aoAvancar: avancar });
r.tempoReal_s = +((perfReal.now() - inicio) / 1000).toFixed(1);   // no terminal, o relógio do teste é falso
console.log(JSON.stringify(r, null, 1));
process.exit(r.passou ? 0 : 1);
