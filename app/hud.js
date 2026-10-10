// Interface por cima da cena:
//   - o "+N" na porta (quem não coube na cena);
//   - o resumo do cabeçalho (só o que é maior que zero; sem ninguém, "Estação tranquila");
//   - a aba do navegador ("• A Estação" e favicon com ponto laranja enquanto alguém espera você);
//   - o aviso de "sem conexão" depois de 10 s sem ler o servidor;
//   - o cartão do hover (nome, ação, pasta e "contexto N%" do astronauta sob o mouse);
//   - a ajuda efêmera do rodapé (só nas 3 primeiras aberturas);
//   - o botão "Novidades" (versão local, novidades do GitHub e como atualizar).
//
// Funções exportadas (o main.js chama):
//   iniciarHover()            registra o hover e também a ajuda (chama iniciarHud)
//   iniciarHud()              ajuda efêmera e medida da tela; pode ser chamada mais de uma vez
//   atualizarResumo(dados)    a cada leitura
//   atualizarHover(agora)     a cada quadro desenhado; refaz o raio no máximo a cada 100 ms
//   atualizarSemConexao()     a cada leitura que falhou (usa E.semConexaoDesde)
//   atualizarContador(excedentes, lotacao)   chamada pelo agentes.js
//
// Funções novas de outros pacotes (cena.js) são chamadas com optional chaining,
// porque podem ainda não existir: Cena.definirExpediente?.(...) e Cena.marcarSujo?.().

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { E } from './estado.js';
import * as Cena from './cena.js';

const TITULO = 'A Estação';
const TITULO_ESPERANDO = '• A Estação';
const LARANJA = '#ee4c01';

// ---------------------------------------------------------------------------
// "+N" na porta
// ---------------------------------------------------------------------------
let contadorFila = null;

// o segundo parâmetro (teto de astronautas) fica só por compatibilidade com agentes.js
export function atualizarContador(excedentes, lotacao) {
  if (!contadorFila) {
    const div = document.createElement('div');
    div.className = 'contador-fila';
    contadorFila = new CSS2DObject(div);
    contadorFila.position.set(E.X1 + 0.9, 1.2, 0);
    E.cena.add(contadorFila);
  }
  const el = contadorFila.element;
  const texto = `+${excedentes} chegando`;
  if (el.textContent !== texto) {
    el.textContent = texto;
    el.title = `${excedentes} astronauta${excedentes === 1 ? '' : 's'} esperando a vez de entrar (ou uma mesa ficar pronta)`;
    Cena.marcarSujo?.();
  }
  contadorFila.visible = excedentes > 0;
  el.style.display = excedentes > 0 ? '' : 'none';
}

// ---------------------------------------------------------------------------
// Textos: limpeza e nomes humanizados
// ---------------------------------------------------------------------------
// Nenhum texto visível leva travessão ou meia-risca, nem quando vem do nome da sessão
const semTravessao = s => String(s ?? '').replace(/\s*[\u2014\u2013]\s*/g, ', ');

// 'auditoria:VIS' vira 'Auditoria VIS'; 'general-purpose' vira 'General purpose'
export function humanizarNome(nome) {
  let s = semTravessao(nome).replace(/[:_]+/g, ' ');
  if (!/\s/.test(s.trim())) s = s.replace(/-+/g, ' ');   // só quando parece um identificador
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return 'Ajudante';
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length > 34 ? s.slice(0, 33).trimEnd() + '…' : s;
}

// ---------------------------------------------------------------------------
// Resumo do cabeçalho
// ---------------------------------------------------------------------------
// Conta como trabalhando tudo que não é espera, revisão nem descanso
// (editar, pesquisar, conector, coordenar e o que o servidor criar depois).
// 'revisar' (rodada 6): terminou com uma sugestão e está na fila da revisão.
const FORA_DO_TRABALHO = new Set(['esperar', 'descansar', 'revisar']);
const MAX_SERVICOS = 2;
const ROTULO_SERVICO = { mcp: 'MCP', api: 'API' };

// Partes do resumo, em ordem, só as maiores que zero. Função pura (testes no Node).
// Cada parte: { texto, espera? }. Lista vazia = ninguém na Estação.
// noRelogio(id): o astronauta ainda está no lugar, com o relógio de 60 s (revisão I-6);
// ele "acabou de terminar" e só conta como descansando quando vai para o descanso.
export function partesDoResumo(lista = [], noRelogio = () => false) {
  let trabalhando = 0, esperando = 0, descansando = 0, revisar = 0, terminaram = 0;
  const servicos = { mcp: [], api: [] };
  for (const d of lista) {
    if (d.atividade === 'esperar') esperando++;
    else if (d.atividade === 'descansar' && noRelogio(d.id)) terminaram++;
    else if (d.atividade === 'descansar') descansando++;
    else if (d.atividade === 'revisar') revisar++;
    else trabalhando++;
    if (d.atividade === 'conector' && d.conector) {
      // sem conectorTipo (servidor antigo), é MCP
      const tipo = d.conectorTipo === 'api' ? 'api' : 'mcp';
      const nome = semTravessao(d.conector);
      if (!servicos[tipo].includes(nome)) servicos[tipo].push(nome);
    }
  }
  const partes = [];
  if (trabalhando) partes.push({ texto: `${trabalhando} trabalhando` });
  if (esperando) partes.push({ texto: `${esperando} esperando você`, espera: true });
  if (revisar) partes.push({ texto: `${revisar} para revisar` });
  if (terminaram) partes.push({ texto: terminaram === 1 ? '1 acabou de terminar' : `${terminaram} acabaram de terminar` });
  if (descansando) partes.push({ texto: `${descansando} descansando` });
  for (const tipo of ['mcp', 'api']) {
    const nomes = servicos[tipo];
    if (!nomes.length) continue;
    const resto = nomes.length - MAX_SERVICOS;
    partes.push({ texto: `${ROTULO_SERVICO[tipo]}: ${nomes.slice(0, MAX_SERVICOS).join(', ')}${resto > 0 ? ` +${resto}` : ''}` });
  }
  return { partes, trabalhando, esperando, descansando, revisar, terminaram };
}

// Texto corrido do resumo (o mesmo que aparece no cabeçalho)
export function textoDoResumo(lista = [], noRelogio) {
  const { partes } = partesDoResumo(lista, noRelogio);
  return partes.length ? partes.map(p => p.texto).join(' · ') : 'Estação tranquila';
}

let resumoAtual = null;          // texto já escrito no #resumo (evita reescrever o DOM)
const dadosPorId = new Map();    // id -> último dado do agente (para o cartão do hover)

function escreverResumo(partes) {
  const el = document.getElementById('resumo');
  if (!el) return;
  const chave = partes.length ? partes.map(p => (p.espera ? '!' : '') + p.texto).join('|') : '';
  if (chave === resumoAtual) return;
  resumoAtual = chave;
  if (!partes.length) { el.textContent = 'Estação tranquila'; return; }
  el.textContent = '';
  partes.forEach((p, i) => {
    if (i) el.append(' · ');
    if (p.espera) {
      const s = document.createElement('span');
      s.className = 'espera';
      s.textContent = p.texto;
      el.append(s);
    } else el.append(p.texto);
  });
}

export function atualizarResumo(dados) {
  const lista = dados?.agentes || [];
  dadosPorId.clear();
  for (const d of lista) dadosPorId.set(d.id, d);

  const { partes, trabalhando, esperando, revisar } = partesDoResumo(lista, id => !!E.agentes?.get(id)?.relogioAtivo);
  // dado novo chegou: a conexão voltou
  definirSemConexao(false);
  escreverResumo(partes);
  // luz de expediente enquanto alguém trabalha, espera ou aguarda revisão; fim de tarde quando todos descansam
  Cena.definirExpediente?.(trabalhando + esperando + revisar > 0);
  atualizarAba(esperando > 0);
  // o agentes.js reescreve nome e ação a cada leitura; o cartão aberto volta ao formato do hover
  if (E.emFoco) preencherCartao(E.emFoco);
}

// ---------------------------------------------------------------------------
// Aba do navegador: título e favicon com ponto laranja enquanto alguém espera
// ---------------------------------------------------------------------------
let abaEsperando = null;         // último estado aplicado (null = ainda não aplicado)
let faviconOriginal = null;      // href do icone-64.png
let faviconComPonto = null;      // data: URL desenhada em canvas
let gerandoFavicon = null;       // promessa da geração (só uma vez)

function linkDoFavicon() {
  try { return document.querySelector?.('link[rel="icon"]') || null; } catch { return null; }
}

// icone-64.png com um pontinho laranja no canto superior direito (aro branco para destacar)
async function gerarFaviconComPonto(href) {
  const img = new Image();
  img.src = href;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 64, 64);
  g.beginPath(); g.arc(50, 14, 13, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  g.beginPath(); g.arc(50, 14, 10, 0, Math.PI * 2); g.fillStyle = LARANJA; g.fill();
  return c.toDataURL('image/png');
}

function aplicarFavicon() {
  const link = linkDoFavicon();
  if (!link) return;
  if (faviconOriginal === null) faviconOriginal = link.getAttribute('href') || 'icone-64.png';
  if (!abaEsperando) {
    if (link.getAttribute('href') !== faviconOriginal) link.setAttribute('href', faviconOriginal);
    return;
  }
  if (faviconComPonto) { link.setAttribute('href', faviconComPonto); return; }
  if (gerandoFavicon || typeof Image === 'undefined') return;
  gerandoFavicon = gerarFaviconComPonto(faviconOriginal)
    .then(url => { faviconComPonto = url; aplicarFavicon(); })
    .catch(() => { /* sem o desenho, fica só o título com o marcador */ });
}

function atualizarAba(esperando) {
  if (esperando === abaEsperando) return;
  abaEsperando = esperando;
  document.title = esperando ? TITULO_ESPERANDO : TITULO;
  aplicarFavicon();
}

// ---------------------------------------------------------------------------
// Sem conexão com o servidor local
// ---------------------------------------------------------------------------
const SEM_CONEXAO_MS = 10 * 1000;
let semConexaoVisivel = false;

// E.semConexaoDesde pode vir em Date.now() ou performance.now(); mede nos dois casos
function msDesde(instante) {
  return instante > 1e12 ? Date.now() - instante : performance.now() - instante;
}

function definirSemConexao(ligado) {
  if (ligado === semConexaoVisivel) return;
  semConexaoVisivel = ligado;
  document.body?.classList.toggle('sem-conexao', ligado);
  if (ligado) {
    const el = document.getElementById('resumo');
    if (el) {
      el.textContent = '';
      const s = document.createElement('span');
      s.style.opacity = '.7';
      s.textContent = 'reconectando…';
      el.append(s);
    }
    resumoAtual = null;          // na volta, o resumo é reescrito
  }
  Cena.marcarSujo?.();
}

// Chamada a cada leitura que falhou. Depois de 10 s sem conexão, avisa de forma discreta
// e esmaece a cena; o aviso sai sozinho na próxima leitura boa (atualizarResumo).
export function atualizarSemConexao() {
  const desde = E.semConexaoDesde;
  definirSemConexao(desde != null && msDesde(desde) > SEM_CONEXAO_MS);
}

// ---------------------------------------------------------------------------
// Cartão do hover: nome humanizado, ação atual e no máximo uma linha extra (pasta)
// ---------------------------------------------------------------------------
function acaoDoCartao(a, dado) {
  if (a.alvo === 'fora') return a.spanAcao?.textContent || 'indo embora';   // agentes.js escreve
  if (!dado) return a.spanAcao?.textContent || '';
  if (dado.atividade === 'descansar') {
    // no relógio, na mesa: acabou de terminar; já no descanso, descansando
    if (!a.relogioAtivo && a.alvo === 'descanso') return 'descansando';
    return dado.terminou || dado.tipo === 'subagente' ? 'entregou' : 'terminou';
  }
  return semTravessao(dado.texto);
}

// "contexto 62%" (0 a 100); sem dado, nada
export function textoContexto(pct) {
  if (pct == null || pct === '' || !Number.isFinite(+pct)) return '';
  return `contexto ${Math.max(0, Math.min(100, Math.round(+pct)))}%`;
}

function trocarTexto(el, texto) {
  if (el && el.textContent !== texto) el.textContent = texto;
}

function preencherCartao(a) {
  const dado = dadosPorId.get(a.id);
  if (!a.div) return;
  if (dado) trocarTexto(a.spanNome, humanizarNome(dado.nome));
  trocarTexto(a.spanAcao, acaoDoCartao(a, dado));
  // linha extra: o nome da pasta (se não repetir o nome do astronauta) e quanto da
  // janela de contexto a conversa já usou ("contexto 62%")
  const nome = dado ? humanizarNome(dado.nome) : '';
  const pasta = dado?.pasta ? semTravessao(dado.pasta) : '';
  const partes = [];
  if (pasta && pasta.toLowerCase() !== nome.toLowerCase()) partes.push(pasta);
  const ctx = textoContexto(dado?.contexto);
  if (ctx) partes.push(ctx);
  const extra = partes.join(' · ');
  if (!a.spanPastaHud && extra) {
    const s = document.createElement('span');
    s.className = 'pasta';
    Object.assign(s.style, {
      fontSize: '11px', fontWeight: '600', color: 'var(--navy)', opacity: '.75',
      background: 'rgba(255,255,255,.7)', padding: '0 6px', borderRadius: '6px',
    });
    a.div.append(s);
    a.spanPastaHud = s;
  }
  if (a.spanPastaHud) {
    trocarTexto(a.spanPastaHud, extra);
    a.spanPastaHud.style.display = extra ? '' : 'none';
  }
}

// O balão de pensamento fica escondido enquanto o cartão está aberto
// (o balão pode estar em a.objBalao ou a.balao, como CSS2DObject, ou só em a.divBalao)
function elementoDoBalao(a) {
  return a.objBalao?.element ?? a.balao?.element ?? a.divBalao ?? null;
}
function mostrarBalao(a, mostrar) {
  const el = elementoDoBalao(a);
  if (el?.style) el.style.visibility = mostrar ? '' : 'hidden';
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------
const INTERVALO_HOVER = 100;     // ms entre dois raios
const raio = new THREE.Raycaster();
const ponteiro = new THREE.Vector2();
let tela = null;                 // canvas do renderer
let retangulo = null;            // retângulo do canvas, medido no início e no resize
let ponteiroDentro = false;
let clienteX = 0, clienteY = 0;  // última posição do ponteiro (px da janela)
let ultimoRaio = -Infinity;      // instante do último raio (performance.now)
let ultimaChamadaExterna = -Infinity;   // última vez que o main chamou atualizarHover

function medirTela() {
  if (tela) retangulo = tela.getBoundingClientRect();
}

function definirFoco(novo) {
  const antigo = E.emFoco;
  if (novo === antigo) return;
  if (antigo) {
    antigo.div?.classList.remove('visivel');
    mostrarBalao(antigo, true);
  }
  if (novo) {
    preencherCartao(novo);
    novo.div?.classList.add('visivel');
    mostrarBalao(novo, false);
  }
  E.emFoco = novo;
  // o astronauta não é clicável (rodada 6: a única ação é a notinha da fila), então
  // o hover não troca o cursor para a mão
  if (tela) tela.style.cursor = '';
  Cena.marcarSujo?.();
}

// Astronauta sob o ponteiro (testa só as hitboxes; sem hitbox, o boneco inteiro)
function astronautaSobPonteiro() {
  if (!retangulo || !retangulo.width || !retangulo.height || !E.camera) return null;
  ponteiro.set(((clienteX - retangulo.left) / retangulo.width) * 2 - 1,
    -((clienteY - retangulo.top) / retangulo.height) * 2 + 1);
  raio.setFromCamera(ponteiro, E.camera);
  const alvos = [];
  const dono = new Map();
  for (const a of E.agentes.values()) {
    // quem espera invisível do lado de fora da entrada não recebe hover
    // (o Raycaster acerta objeto invisível)
    if (a.aguardandoEntrada || a.boneco?.visible === false) continue;
    const alvo = a.boneco?.userData?.hitbox || a.boneco;
    if (!alvo) continue;
    alvos.push(alvo);
    dono.set(alvo, a);
  }
  if (!alvos.length) return null;
  for (const hit of raio.intersectObjects(alvos, true)) {
    let obj = hit.object;
    while (obj && !dono.has(obj)) obj = obj.parent;
    if (obj) return dono.get(obj);
  }
  return null;
}

function refazerHover(agora) {
  // o astronauta em foco saiu da cena: solta o cartão
  if (E.emFoco && E.agentes.get(E.emFoco.id) !== E.emFoco) {
    E.emFoco.div?.classList.remove('visivel');
    mostrarBalao(E.emFoco, true);
    E.emFoco = null;
    if (tela) tela.style.cursor = '';
    Cena.marcarSujo?.();
  }
  if (!ponteiroDentro) { definirFoco(null); return; }
  // no máximo um raio a cada 100 ms (relógio que volta, de outra fonte, não trava o hover)
  if (agora >= ultimoRaio && agora - ultimoRaio < INTERVALO_HOVER) return;
  ultimoRaio = agora;
  definirFoco(astronautaSobPonteiro());
  if (E.emFoco) preencherCartao(E.emFoco);
}

// Chamada pelo main a cada quadro desenhado: o cartão acompanha o astronauta que anda
// sob o mouse parado e a câmera que se mexe sozinha
export function atualizarHover(agora) {
  const t = typeof agora === 'number' && agora < 1e12 ? agora : performance.now();
  ultimaChamadaExterna = performance.now();
  refazerHover(t);
}

export function iniciarHover() {
  iniciarHud();
  tela = E.renderer.domElement;
  medirTela();
  tela.addEventListener('pointermove', ev => {
    clienteX = ev.clientX;
    clienteY = ev.clientY;
    ponteiroDentro = true;
    if (!retangulo) medirTela();
    // sem quadros sendo desenhados (main antigo ou cena parada), o próprio movimento refaz o raio
    if (performance.now() - ultimaChamadaExterna > 250) refazerHover(performance.now());
  });
  const soltar = () => { ponteiroDentro = false; definirFoco(null); };
  tela.addEventListener('pointerleave', soltar);
  tela.addEventListener('pointercancel', soltar);
  window.addEventListener?.('blur', soltar);
  window.addEventListener?.('resize', medirTela);
}

// ---------------------------------------------------------------------------
// Ajuda efêmera: nas 3 primeiras aberturas, o rodapé aparece por 9 s e esmaece.
// Depois disso só aparece ao passar o mouse no "?" (CSS: #ajuda:hover ~ #aviso).
// ---------------------------------------------------------------------------
const CHAVE_AJUDA = 'ajudaVista';
const ABERTURAS_COM_AJUDA = 3;
const AJUDA_MS = 9000;
let hudIniciado = false;

function iniciarAjuda() {
  const aviso = document.getElementById('aviso');
  if (!aviso) return;
  let vistas = 0;
  try { vistas = Number(localStorage.getItem(CHAVE_AJUDA)) || 0; } catch { /* sem armazenamento: mostra */ }
  if (vistas >= ABERTURAS_COM_AJUDA) {
    // já viu: esconde sem a transição de 1 s, para não piscar na abertura
    const transicao = aviso.style.transition;
    aviso.style.transition = 'none';
    aviso.classList.add('some');
    void aviso.offsetWidth;
    aviso.style.transition = transicao || '';
    return;
  }
  try { localStorage.setItem(CHAVE_AJUDA, String(vistas + 1)); } catch { /* segue sem contar */ }
  aviso.classList.remove('some');
  setTimeout(() => aviso.classList.add('some'), AJUDA_MS);
}

export function iniciarHud() {
  if (hudIniciado) return;
  hudIniciado = true;
  iniciarAjuda();
  iniciarNovidades();
}

// ---------------------------------------------------------------------------
// Novidades: versão local, novidades do GitHub e como atualizar
// O servidor (GET /api/versao) consulta o GitHub no máximo 1 vez a cada 6 h; aqui
// só pedimos a ele de vez em quando. Sem resposta, o botão fica neutro (sem erro na
// tela). A página nunca executa a atualização: mostra o passo a passo e, no máximo,
// copia o comando. Todo texto vindo de fora entra por textContent (nunca innerHTML).
// ---------------------------------------------------------------------------
const NOVIDADES_RELER_MS = 30 * 60 * 1000;
let versaoInfo = null;
let botaoNovidades = null, painelNovidades = null;

let verificando = false;
async function lerVersao(forcar = false) {
  if (typeof fetch !== 'function') return;
  try {
    const r = await fetch('/api/versao' + (forcar ? '?verificar=1' : ''), { cache: 'no-store' });
    if (!r.ok) return;
    versaoInfo = await r.json();
  } catch { return; /* servidor antigo ou fora do ar: botão neutro */ }
  aplicarVersao();
}

function aplicarVersao() {
  if (!botaoNovidades || !versaoInfo) return;
  const nova = !!versaoInfo.temVersaoNova;
  botaoNovidades.classList.toggle('tem-nova', nova);
  botaoNovidades.title = nova ? `Tem versão nova: ${versaoInfo.versaoNova}` : `A Estação ${versaoInfo.versao}`;
  if (!painelNovidades.hidden) montarPainel();
}

const el = (tag, classe, texto) => {
  const n = document.createElement(tag);
  if (classe) n.className = classe;
  if (texto != null) n.textContent = semTravessao(texto);
  return n;
};

function dataCurta(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }); }
  catch { return ''; }
}

// Notas da release (markdown simples) em texto: títulos, listas e parágrafos
function notasEmTexto(notas) {
  const caixa = el('div', 'notas');
  let lista = null;
  for (const bruta of String(notas || '').split('\n')) {
    const linha = bruta.trim()
      .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1')    // [texto](link) vira texto
      .replace(/\*\*|__|`/g, '');
    if (!linha) { lista = null; continue; }
    if (/^([-*_])\1{2,}$/.test(linha)) { lista = null; continue; }   // linha separadora
    const item = linha.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!lista) { lista = el('ul'); caixa.append(lista); }
      lista.append(el('li', null, item[1]));
      continue;
    }
    lista = null;
    const titulo = linha.match(/^#{1,6}\s+(.*)$/);
    caixa.append(titulo ? el('h3', null, titulo[1]) : el('p', null, linha));
  }
  return caixa;
}

function linhaDeComando(comando) {
  const linha = el('div', 'comando');
  linha.append(el('code', null, comando));
  const copiar = el('button', 'botao-pilula copiar', 'Copiar');
  copiar.type = 'button';
  copiar.setAttribute('aria-label', 'Copiar o comando');
  copiar.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(comando); ok = true; } catch { /* sem área de transferência */ }
    copiar.textContent = ok ? 'Copiado' : 'Selecione e copie';
    setTimeout(() => { copiar.textContent = 'Copiar'; }, 1800);
  });
  return linha;
}

function montarPainel() {
  const p = painelNovidades;
  // remontar não pode tirar o foco do teclado de dentro do painel
  const tinhaFoco = p.contains?.(document.activeElement);
  p.textContent = '';
  const fechar = el('button', 'fechar', '×');
  fechar.type = 'button';
  fechar.setAttribute('aria-label', 'Fechar as atualizações');
  fechar.addEventListener('click', () => abrirPainel(false));
  p.append(fechar, el('h2', null, 'Atualizações'));
  const v = versaoInfo;
  if (!v) {
    p.append(el('p', 'versao-local', 'Lendo a versão…'));
    return;
  }
  p.append(el('div', 'versao-local', `Você está na versão ${v.versao}${v.commit ? ` (${v.commit})` : ''}`));
  const n = v.novidades || {};
  if (v.temVersaoNova) {
    p.append(el('p', 'estado nova', `Tem versão nova: ${v.versaoNova}`));
    p.append(el('h3', null, 'Como atualizar'));
    const passos = el('ol');
    passos.append(el('li', null, v.windows ? 'Feche A Estação (dois cliques em parar.cmd, na pasta do projeto).' : 'Feche A Estação (no Terminal, ./parar.sh).'));
    if (v.clone) {
      const li = el('li', null, (v.windows ? 'No PowerShell' : 'No Terminal') + ', rode o comando abaixo. Ele confere se há alterações suas na pasta (se houver, mostra quais e não mexe em nada), baixa a versão nova com git pull e atualiza as dependências com npm install.');
      passos.append(li);
    } else {
      passos.append(el('li', null, 'Esta pasta não veio de um git clone: baixe a versão nova no GitHub e troque a pasta, ou clone o repositório e rode ' + (v.windows ? 'instalar.cmd.' : './instalar.sh.')));
    }
    passos.append(el('li', null, v.windows ? 'Abra A Estação de novo (dois cliques no atalho da Área de Trabalho).' : 'Abra A Estação de novo (dois cliques no app ou ./iniciar.sh).'));
    p.append(passos);
    if (v.clone && v.comando) p.append(linhaDeComando(v.comando));
  } else if (n.estado === 'ok') {
    p.append(el('p', 'estado', 'Você está na versão mais recente'));
  } else if (n.estado === 'desligado') {
    p.append(el('p', 'estado', 'A consulta de novidades está desligada nesta máquina.'));
  } else if (n.estado === 'sem-releases') {
    p.append(el('p', 'estado', 'Ainda não há versões publicadas.'));
  } else {
    p.append(el('p', 'estado', 'Sem notícias do GitHub por enquanto.'));
  }
  // verificar agora (o servidor consulta o GitHub na hora, no máximo 1 vez por minuto)
  const verif = el('div', 'verificar');
  const quando = n.consultadoEm ? Math.round((Date.now() - n.consultadoEm) / 60000) : null;
  verif.append(el('span', 'quando', quando == null ? 'Ainda não verificado' : quando < 1 ? 'Verificado agora há pouco' : `Verificado há ${quando} min`));
  const bv = el('button', 'botao-verificar', verificando ? 'Verificando…' : 'Verificar agora');
  bv.type = 'button';
  bv.disabled = verificando;
  bv.addEventListener('click', async () => {
    verificando = true; montarPainel();
    await lerVersao(true);
    verificando = false; montarPainel();
    painelNovidades.querySelector('.botao-verificar')?.focus();
  });
  verif.append(bv);
  p.append(verif);
  const releases = Array.isArray(n.releases) ? n.releases : [];
  for (const r of releases) {
    const bloco = el('div', 'release');
    const cab = el('div');
    cab.append(el('span', 'titulo', `Versão ${r.versao}`));
    const data = dataCurta(r.publicadaEm);
    if (data) cab.append(el('span', 'data', data));
    bloco.append(cab);
    if (r.nome && r.nome.replace(/^v/i, '') !== r.versao) bloco.append(el('p', null, r.nome));
    if (r.notas) bloco.append(notasEmTexto(r.notas));
    p.append(bloco);
  }
  if (v.urlRepo && /^https:\/\/github\.com\//.test(v.urlRepo)) {
    const rodape = el('p');
    const a = el('a', null, 'Ver no GitHub');
    a.href = v.urlRepo + '/releases';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    rodape.append(a);
    p.append(rodape);
  }
  if (tinhaFoco) fechar.focus();
}

function abrirPainel(abrir) {
  if (!painelNovidades) return;
  if (abrir === !painelNovidades.hidden) return;
  painelNovidades.hidden = !abrir;
  botaoNovidades.setAttribute('aria-expanded', String(abrir));
  if (abrir) {
    montarPainel();
    painelNovidades.querySelector('.fechar')?.focus();
    lerVersao();   // o servidor responde do cache (no máximo 1 consulta ao GitHub a cada 6 h)
  } else {
    botaoNovidades.focus();
  }
}

function iniciarNovidades() {
  botaoNovidades = document.getElementById('novidades');
  painelNovidades = document.getElementById('painel-novidades');
  if (!botaoNovidades || !painelNovidades || typeof botaoNovidades.addEventListener !== 'function') return;
  botaoNovidades.addEventListener('click', () => abrirPainel(painelNovidades.hidden));
  document.addEventListener?.('keydown', ev => { if (ev.key === 'Escape' && !painelNovidades.hidden) abrirPainel(false); });
  // clique fora do painel fecha
  document.addEventListener?.('pointerdown', ev => {
    if (painelNovidades.hidden) return;
    if (painelNovidades.contains?.(ev.target) || botaoNovidades.contains?.(ev.target)) return;
    painelNovidades.hidden = true;
    botaoNovidades.setAttribute('aria-expanded', 'false');
  });
  lerVersao();
  setInterval(lerVersao, NOVIDADES_RELER_MS);
}

// ---------------------------------------------------------------------------
// Quem aparece como astronauta (03/10): "Sessões e ajudantes" (padrão: sessões,
// subagentes, agentes de workflow e tarefas em segundo plano) ou "Só as sessões".
// Escolha guardada no navegador; a troca vale na próxima leitura (até 1,5 s).
// ---------------------------------------------------------------------------
let modo = 'todos';
try { if (localStorage.getItem('estacao.modoVisao') === 'sessoes') modo = 'sessoes'; } catch {}
export function modoVisao() { return modo; }
function pintarModo(grupo) {
  for (const b of grupo.querySelectorAll('[data-modo]')) {
    const sel = b.dataset.modo === modo;
    b.setAttribute('aria-checked', String(sel));
    b.tabIndex = sel ? 0 : -1;
  }
}
if (typeof document !== 'undefined') {
  const grupo = document.getElementById('modo-visao');
  if (grupo) {
    pintarModo(grupo);
    const escolher = m => {
      if (m === modo) return;
      modo = m;
      try { localStorage.setItem('estacao.modoVisao', modo); } catch {}
      pintarModo(grupo);
    };
    grupo.addEventListener('click', e => { const b = e.target.closest('[data-modo]'); if (b) escolher(b.dataset.modo); });
    grupo.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      escolher(modo === 'sessoes' ? 'todos' : 'sessoes');
      grupo.querySelector(`[data-modo="${modo}"]`)?.focus();
      e.preventDefault();
    });
  }
}
