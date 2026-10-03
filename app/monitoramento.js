// Monitoramento (rodada 5): liga as salas de controle (Sala Anthropic e Sala OpenAI,
// controle.js, montadas por estacao.js) aos dados lidos e anima os operadores NPC.
//
// EXPORTS (main.js chama):
//   aplicarMonitoramento(dados)   a cada leitura: medidores (dados.limites, contrato do
//                                 servidor) e a tripulação de cada provedor (quantos
//                                 trabalhando e descansando) nos painéis
//   animarMonitoramento(dt, agoraMs)  a cada quadro: operador, globo e telas; devolve
//                                 true se algum operador andou (a sombra acompanha, no
//                                 máximo 8 vezes por segundo)
//   haOperadores()                há sala de controle em cena (main.js mantém a cena
//                                 viva em 20 quadros por segundo mesmo sem agentes)
//
// Sem dados.limites (servidor antigo), usa limitesCodex para a Sala OpenAI e deixa a
// Sala Anthropic como "Limites indisponíveis".

import { E } from './estado.js';
import { salasDeControle } from './estacao.js';
import { dadosDeLimitesCodex } from './controle.js';

const SOMBRA_OPERADOR_MS = 125;
let ultimosDados = null;
const aplicadas = new WeakMap();   // sala -> assinatura dos dados já aplicados
let ultimaSombra = 0;

// Quantos de cada provedor estão trabalhando (inclui esperando) e descansando
function tripulacoes(agentes = []) {
  const t = { anthropic: { trabalhando: 0, descansando: 0 }, openai: { trabalhando: 0, descansando: 0 } };
  for (const d of agentes) {
    const p = t[d.provedor === 'openai' ? 'openai' : 'anthropic'];
    if (d.atividade === 'descansar') p.descansando++; else p.trabalhando++;
  }
  return t;
}

function dadosDaSala(provedor, dados) {
  const lim = dados?.limites?.[provedor];
  let base;
  if (lim) base = { medidores: lim.medidores || [], atualizadoEm: lim.atualizadoEm ?? null, aviso: lim.aviso };
  else if (provedor === 'openai' && dados?.limitesCodex) base = dadosDeLimitesCodex(dados.limitesCodex);
  else base = { medidores: [], aviso: 'esta instalação não tem acesso aos limites do plano' };
  return { ...base, tripulacao: tripulacoes(dados?.agentes)[provedor] };
}

function aplicarEm(sala) {
  if (!ultimosDados) return;
  const d = dadosDaSala(sala.userData.provedor, ultimosDados);
  const k = JSON.stringify(d);
  if (aplicadas.get(sala) === k) return;
  aplicadas.set(sala, k);
  sala.userData.definirDados(d);
  E.sujo = true;
}

export function aplicarMonitoramento(dados) {
  if (!dados || dados.erro) return;
  ultimosDados = dados;
  for (const sala of salasDeControle()) aplicarEm(sala);
}

export function animarMonitoramento(dt, agoraMs = performance.now()) {
  let andou = false;
  for (const sala of salasDeControle()) {
    if (!aplicadas.has(sala)) aplicarEm(sala);   // sala recém-acoplada recebe os últimos dados
    const r = sala.userData.atualizar?.(dt, Date.now());
    if (r?.andou) andou = true;
  }
  if (andou && agoraMs - ultimaSombra > SOMBRA_OPERADOR_MS) { ultimaSombra = agoraMs; E.sombraSuja = true; }
  return andou;
}

export function haOperadores() { return salasDeControle().length > 0; }
