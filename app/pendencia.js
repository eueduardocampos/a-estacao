// Heurística de "terminou com sugestão" (rodada 6), usada pelo servidor (Claude) e
// pela fonte do Codex. Função pura, sem leitura de arquivo: dá para testar no Node.
//
// Detecção honesta (requisito aprovado em 03/10): pergunta pendente e pedido de
// aprovação são confiáveis; "terminou com sugestão" é heurística e pode errar.
// Por isso ela é conservadora: só o FIM da última fala do assistente conta.
// - termina com '?' (depois de tirar markdown, aspas e parênteses do fim); ou
// - o último parágrafo (até 300 caracteres) traz uma oferta de próximo passo em
//   português ou inglês: 'quer que eu', 'posso seguir', 'sigo com', 'want me to'...
// Blocos de código são ignorados (uma interrogação dentro do código não conta).

const OFERTAS = new RegExp([
  'quer que eu', 'querem que eu', 'prefere que eu', 'preferem que eu', 'você quer que', 'voce quer que',
  'posso seguir', 'posso continuar', 'posso fazer', 'posso aplicar', 'posso ajustar', 'posso publicar',
  'posso começar', 'posso comecar', 'posso mandar', 'posso enviar', 'posso subir', 'posso rodar',
  'sigo com', 'sigo para', 'sigo assim', 'devo seguir',
  'se quiser,? (eu )?(posso|fa[cç]o|sigo|ajusto|preparo|monto|deixo|aplico|rodo|publico)',
  'want me to', 'should i\\b', 'shall i\\b', 'would you like me to', 'do you want me to',
  "let me know if you('d| would) like",
].join('|'), 'i');

export function terminaComOferta(texto) {
  const s = String(texto || '')
    .replace(/```[\s\S]*?```/g, ' ')        // blocos de código inteiros
    .replace(/```[\s\S]*$/, ' ')            // bloco aberto no recorte do fim
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+$/, '');
  if (!s) return false;
  if (/\?["'”’)\]]*$/.test(s)) return true;
  const ultimoParagrafo = s.split(/\n\s*\n/).pop().slice(-300);
  return OFERTAS.test(ultimoParagrafo);
}
