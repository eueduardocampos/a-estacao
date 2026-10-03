// Estado compartilhado da Estação.
// Bindings importados de outro módulo são somente leitura, então tudo que é
// mutável e usado por mais de um módulo mora aqui, no objeto E.

export const E = {
  // cena.js
  cena: null,              // THREE.Scene
  camera: null,            // THREE.OrthographicCamera
  renderer: null,          // THREE.WebGLRenderer
  controles: null,         // MapControls (zoom e arrastar)
  rotulos: null,           // CSS2DRenderer (placas, balões, "+N")
  sol: null,               // DirectionalLight com sombra
  hemisferio: null,        // HemisphereLight

  // layout.js
  salas: {},               // id da sala -> sala (x0, x1, z0, z1, vagas, ilhas, tv...)
  mapa: null,              // Mapa de caminhos (navegacao.js)
  X0: 0, X1: 0,            // limites do escritório no eixo x
  ZN: 0, ZS: 0,            // parede do fundo (norte) e fim da fileira da frente (sul)
  ENTRADA_FORA: null,      // ponto do lado de fora da porta, onde o astronauta nasce e some

  // agentes.js
  agentes: new Map(),      // id do agente -> astronauta na cena
  ilhaPorPasta: new Map(), // caminho da pasta -> índice da ilha do coworking
  salaPorConector: new Map(), // nome do conector -> id da sala com TV

  // hud.js
  emFoco: null,            // astronauta sob o mouse (mostra a placa com nome e ação)

  // main.js
  construido: false,       // a planta já foi montada
  dados: null,             // última resposta de lerEstado()
  semConexaoDesde: null,   // reservado: instante em que a leitura começou a falhar
  teste: null,             // 'multidao' enquanto testes.js dirige os agentes (sem leitura)

  // reservados para as próximas rodadas
  pegada: null,            // área construída de fato (enquadramento da câmera)
  larguraMaxima: null,     // largura máxima da planta
  sombraSuja: true,        // a sombra precisa ser recalculada (tween.js marca enquanto anima)
};
