// Animações curtas de um valor numérico (tweens), atualizadas pelo laço principal.
// Ex.: tween({ obj: boneco, prop: 'position.y', para: 0.07, dur: 0.4, ease: 'easeOutBack' })
// prop aceita caminho com ponto ('position.z', 'scale.y', 'material.emissiveIntensity').
// dur e atraso em segundos. 'chave' cancela o tween anterior com a mesma chave.
// de = undefined usa o valor atual da propriedade quando o tween começa.

import { E } from './estado.js';

export const EASINGS = {
  linear: t => t,
  easeOutCubic: t => 1 - (1 - t) ** 3,
  easeInCubic: t => t ** 3,
  easeInOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
};

const ativos = [];

const agoraPadrao = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// 'position.z' -> { alvo: obj.position, chave: 'z' }
function resolver(obj, prop) {
  const partes = prop.split('.');
  let alvo = obj;
  for (let i = 0; i < partes.length - 1; i++) {
    alvo = alvo?.[partes[i]];
    if (alvo == null) throw new Error(`tween: caminho inválido "${prop}"`);
  }
  return { alvo, campo: partes[partes.length - 1] };
}

export function tween({ obj, prop, de, para, dur, ease = 'easeOutCubic', atraso = 0, aoFim, chave }) {
  if (chave !== undefined) cancelarTweens(chave);
  const { alvo, campo } = resolver(obj, prop);
  const t = {
    alvo, campo, de, para,
    dur: Math.max(0, dur || 0) * 1000,
    inicio: agoraPadrao() + Math.max(0, atraso) * 1000,
    ease: typeof ease === 'function' ? ease : (EASINGS[ease] || EASINGS.easeOutCubic),
    aoFim, chave, comecou: false,
  };
  ativos.push(t);
  E.sombraSuja = true;
  return t;
}

// Avança todos os tweens; agoraMs = performance.now()
export function atualizarTweens(agoraMs = agoraPadrao()) {
  if (!ativos.length) return;
  E.sombraSuja = true;
  const terminados = [];
  for (let i = ativos.length - 1; i >= 0; i--) {
    const t = ativos[i];
    if (agoraMs < t.inicio) continue;   // ainda no atraso
    if (!t.comecou) {
      t.comecou = true;
      if (t.de === undefined) t.de = t.alvo[t.campo];
    }
    const p = t.dur ? Math.min(1, (agoraMs - t.inicio) / t.dur) : 1;
    t.alvo[t.campo] = t.de + (t.para - t.de) * t.ease(p);
    if (p >= 1) {
      t.alvo[t.campo] = t.para;
      ativos.splice(i, 1);
      terminados.push(t);
    }
  }
  // aoFim roda depois do laço, para poder criar tweens novos sem bagunçar a lista
  for (const t of terminados.reverse()) t.aoFim?.();
}

export function haTweens() { return ativos.length > 0; }

// Interrompe (sem chamar aoFim) os tweens com essa chave; sem chave, todos
export function cancelarTweens(chave) {
  for (let i = ativos.length - 1; i >= 0; i--) {
    if (chave === undefined || ativos[i].chave === chave) ativos.splice(i, 1);
  }
}
