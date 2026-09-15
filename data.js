export const PALETTE = [
  '#bf7448', '#6f85ac', '#5f9887', '#a18e37', '#8f78a8', '#5f9bad',
  '#af6678', '#7a8b5f', '#aa7654', '#5d8d9a', '#8e6b9b', '#9d8150',
];

const COMPACT = [
  [0,0],[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1],[2,-1],[2,0],[1,1],[0,2],[-1,2],
];

const specs = [
  {
    id: 'work', title: 'Organização do trabalho', color: PALETTE[0], center: [-6,-1],
    description: 'Como atividades, responsabilidades e autonomia são distribuídas.',
    items: [
      ['division','Divisão do trabalho','Distribuição estrutural de atividades, responsabilidades e dependências.'],
      ['autonomy','Autonomia','Capacidade localizada de tomar decisões consequenciais.'],
      ['roles','Papéis','Conjuntos relativamente estáveis de expectativas e responsabilidades.'],
      ['specialization','Especialização','Concentração de capacidades ou responsabilidades específicas.'],
      ['accountability','Accountability','Mecanismos pelos quais decisões tornam-se imputáveis e contestáveis.'],
      ['standards','Padrões','Referências compartilhadas que estabilizam expectativas.'],
      ['interdependence','Interdependência','Grau em que o trabalho de uma unidade depende de outras.'],
      ['decisionrights','Direitos decisórios','Distribuição da capacidade legítima de decidir.'],
      ['localknowledge','Conhecimento local','Informação situada disponível perto do trabalho real.'],
      ['workload','Carga de trabalho','Distribuição de volume, intensidade e ritmo de atividade.'],
    ],
  },
  {
    id: 'gov', title: 'Governança', color: PALETTE[1], center: [0,-4],
    description: 'Regras, mandatos e mecanismos de decisão e contestação.',
    items: [
      ['authority','Autoridade','Capacidade reconhecida de estabelecer decisões obrigatórias.'],
      ['mandates','Mandatos','Domínios nos quais grupos ou papéis podem agir legitimamente.'],
      ['policy','Políticas','Regras gerais que delimitam escolhas recorrentes.'],
      ['review','Revisão','Mecanismo de examinar e contestar decisões realizadas.'],
      ['consent','Consentimento','Validação coletiva em que objeções relevantes são tratadas.'],
      ['delegation','Delegação','Transferência delimitada de capacidade decisória.'],
      ['transparency','Transparência','Disponibilidade de informação sobre regras e decisões.'],
      ['appeal','Apelação','Caminho legítimo para revisar ou contestar decisões.'],
    ],
  },
  {
    id: 'tech', title: 'Tecnologia', color: PALETTE[2], center: [6,-7],
    description: 'Infraestruturas e mediações técnicas que condicionam a ação.',
    items: [
      ['automation','Automação','Transferência de atividades ou decisões para sistemas técnicos.'],
      ['algomgmt','Gestão algorítmica','Coordenação e controle mediados por sistemas computacionais.'],
      ['infrastructure','Infraestrutura','Camada técnica que condiciona possibilidades de ação.'],
      ['interfaces','Interfaces','Pontos de interação que moldam o acesso às capacidades técnicas.'],
      ['datafication','Dataficação','Conversão de processos e comportamentos em dados.'],
      ['surveillance','Vigilância','Produção assimétrica de visibilidade sobre comportamento.'],
      ['tooling','Ferramentas','Artefatos incorporados às práticas cotidianas.'],
      ['platforms','Plataformas','Infraestruturas que intermedeiam relações e capacidades.'],
    ],
  },
  {
    id: 'coord', title: 'Coordenação', color: PALETTE[3], center: [-6,4],
    description: 'Mecanismos que produzem coerência entre atividades interdependentes.',
    items: [
      ['coordination','Coordenação','Produção de coerência entre atividades interdependentes.'],
      ['mutualadjust','Ajuste mútuo','Coordenação produzida por negociação direta.'],
      ['protocols','Protocolos','Sequências e regras explícitas para interações recorrentes.'],
      ['synchronization','Sincronização','Alinhamento temporal entre atividades ou fluxos.'],
      ['handoffs','Handoffs','Transferências de trabalho, informação ou responsabilidade.'],
      ['bottleneck','Gargalos','Pontos cuja capacidade restringe o fluxo do sistema.'],
      ['redundancy','Redundância','Duplicação deliberada de capacidades para reduzir fragilidade.'],
    ],
  },
  {
    id: 'info', title: 'Informação', color: PALETTE[4], center: [0,2],
    description: 'Produção, circulação e interpretação de informação no sistema.',
    items: [
      ['feedback','Feedback','Informação sobre consequências que retorna ao sistema.'],
      ['visibility','Visibilidade','Grau em que estados e consequências podem ser percebidos.'],
      ['signals','Sinais','Indícios compactos usados para orientar atenção e ação.'],
      ['documentation','Documentação','Registro relativamente persistente de conhecimento e decisões.'],
      ['metrics','Métricas','Representações quantitativas usadas para acompanhar fenômenos.'],
      ['sensemaking','Sensemaking','Produção coletiva de interpretações sobre situações ambíguas.'],
      ['memory','Memória organizacional','Persistência de conhecimento para além de indivíduos.'],
      ['noise','Ruído','Informação que compete com sinais relevantes.'],
    ],
  },
  {
    id: 'res', title: 'Recursos', color: PALETTE[5], center: [6,-2],
    description: 'Meios materiais, temporais e cognitivos necessários à ação.',
    items: [
      ['resources','Recursos','Meios materiais, temporais, cognitivos e financeiros.'],
      ['time','Tempo','Capacidade temporal disponível para executar, coordenar e aprender.'],
      ['budget','Orçamento','Capacidade financeira alocada a um domínio de ação.'],
      ['capacity','Capacidade','Quantidade efetiva de trabalho ou processamento disponível.'],
      ['skills','Capacidades','Conhecimentos e habilidades incorporados a pessoas e coletivos.'],
      ['access','Acesso','Possibilidade efetiva de mobilizar recursos relevantes.'],
      ['slack','Folga','Recursos não comprometidos que permitem adaptação.'],
    ],
  },
];

const statusValues = ['rascunho', 'em-analise', 'validado'];
const evidenceValues = ['exploratoria', 'moderada', 'forte'];

function bodyFor(title, description) {
  return `## ${title}\n\n${description}\n\n### Questões para análise\n\n- Como este elemento se manifesta na prática?\n- Quais relações estruturais o sustentam?\n- Que evidências permitem avaliá-lo?\n\n> Este conteúdo é editável em Markdown e pode crescer até se tornar uma nota, análise, relatório ou metodologia completa.`;
}

export function createInitialMap() {
  const clusters = specs.map(({ id, title, color, description }) => ({
    id,
    title,
    description,
    bodyMarkdown: `## ${title}\n\n${description}`,
    color,
    tags: [],
    fields: {},
    label: { mode: 'auto', offsetX: 0, offsetY: 0 },
  }));
  const hexagons = [];
  let globalIndex = 0;
  for (const spec of specs) {
    spec.items.forEach(([id, title, description], index) => {
      const [dq, dr] = COMPACT[index];
      const visual = { mode: 'text', image: { src: '', fit: 'cover', position: '50% 50%', overlay: 0.38 } };
      if (id === 'autonomy') {
        visual.mode = 'icon';
        visual.image.src = './assets/icons/autonomy.svg';
      }
      if (id === 'automation') {
        visual.mode = 'cover';
        visual.image.src = './assets/icons/technology.svg';
        visual.image.overlay = 0.48;
      }
      hexagons.push({
        id,
        title,
        summary: description,
        description,
        bodyMarkdown: bodyFor(title, description),
        tags: [spec.id, globalIndex % 4 === 0 ? 'estrutural' : 'conceito'],
        fields: {
          status: statusValues[globalIndex % statusValues.length],
          evidence: evidenceValues[(globalIndex + 1) % evidenceValues.length],
          time: (globalIndex % 10) + 1,
          energy: 20 + ((globalIndex * 17) % 80),
        },
        visual,
        q: spec.center[0] + dq,
        r: spec.center[1] + dr,
        clusterId: spec.id,
        axisPosition: null,
      });
      globalIndex += 1;
    });
  }
  const relations = [
    { id: 'r1', source: 'work', target: 'gov', label: 'estrutura', routing: { mode: 'auto', offset: { along: 0, perpendicular: 0.2 } } },
    { id: 'r2', source: 'gov', target: 'tech', label: 'regula', routing: { mode: 'auto', offset: { along: 0, perpendicular: 0.2 } } },
    { id: 'r3', source: 'tech', target: 'res', label: 'sustenta', routing: { mode: 'auto', offset: { along: 0, perpendicular: 0.2 } } },
    { id: 'r4', source: 'res', target: 'info', label: 'alimenta', routing: { mode: 'auto', offset: { along: 0, perpendicular: 0.2 } } },
    { id: 'r5', source: 'info', target: 'coord', label: 'retroalimenta', routing: { mode: 'auto', offset: { along: 0, perpendicular: 0.2 } } },
    { id: 'r6', source: 'coord', target: 'work', label: 'articula', routing: { mode: 'auto', offset: { along: 0, perpendicular: 0.2 } } },
  ];
  return {
    $schema: './schemas/hexmap.schema.json',
    schemaVersion: '1.0.0',
    id: 'hexmap-studio-demo',
    title: 'Sistema organizacional',
    description: 'Mapa hexagonal editável para sistematização de conhecimento e análise de sistemas.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    layout: {
      type: 'free',
      mode: 'territories',
      showClusterHulls: true,
      viewport: { x: 0, y: 0, zoom: 1 },
      axes: {
        xLabel: 'Tempo', xMin: 0, xMax: 10,
        yLabel: 'Energia', yMin: 0, yMax: 100,
        frame: { x: 250, y: 170, width: 1700, height: 980 },
      },
    },
    fieldDefinitions: [
      { key: 'status', label: 'Status', type: 'select', options: ['rascunho', 'em-analise', 'validado'] },
      { key: 'evidence', label: 'Evidência', type: 'select', options: ['exploratoria', 'moderada', 'forte'] },
      { key: 'time', label: 'Tempo', type: 'number' },
      { key: 'energy', label: 'Energia', type: 'number' },
    ],
    styleRules: { colorByField: null, colorMap: {} },
    hexagons,
    clusters,
    relations,
    annotations: [],
    nextEntity: 1,
    nextCluster: 1,
    nextRelation: 1,
    nextAnnotation: 1,
    paletteCursor: 6,
  };
}

/**
 * A deliberately small starter map for a first project. Content stays in the
 * same canonical shape as the demonstration map, but starts with no notes so
 * the first decision is the user's rather than ours.
 */
export function createEmptyMap(title = 'Meu primeiro mapa') {
  const now = new Date().toISOString();
  return {
    $schema: './schemas/hexmap.schema.json',
    schemaVersion: '1.0.0',
    id: String(title || 'Meu primeiro mapa').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meu-primeiro-mapa',
    title: title || 'Meu primeiro mapa',
    description: 'Um espaço para organizar ideias, evidências e relações.',
    createdAt: now,
    updatedAt: now,
    layout: {
      type: 'free',
      mode: 'territories',
      showClusterHulls: true,
      viewport: { x: 0, y: 0, zoom: 1 },
      axes: { xLabel: 'Eixo X', xMin: 0, xMax: 10, yLabel: 'Eixo Y', yMin: 0, yMax: 100, frame: { x: 250, y: 170, width: 1700, height: 980 } },
    },
    fieldDefinitions: [],
    styleRules: { colorByField: null, colorMap: {} },
    hexagons: [],
    clusters: [],
    relations: [],
    annotations: [],
    nextEntity: 1,
    nextCluster: 1,
    nextRelation: 1,
    nextAnnotation: 1,
    paletteCursor: 0,
  };
}

/**
 * A tiny editorial template gives a new project useful structure without
 * importing the full demo subject matter.
 */
export function createTemplateMap(title = 'Mapa de projeto') {
  const map = createEmptyMap(title);
  map.description = 'Template editorial para uma pergunta, seus sinais e próximos movimentos.';
  map.fieldDefinitions = [
    { key: 'status', label: 'Status', type: 'select', options: ['rascunho', 'em-analise', 'validado'] },
    { key: 'evidence', label: 'Evidência', type: 'select', options: ['exploratoria', 'moderada', 'forte'] },
  ];
  const colors = [PALETTE[0], PALETTE[1], PALETTE[2]];
  const groups = [
    ['pergunta', 'Pergunta', 'O que queremos compreender ou tornar visível?', -2, 0, 'rascunho'],
    ['sinais', 'Sinais', 'Que observações, relatos ou dados sustentam a leitura?', 0, 0, 'em-analise'],
    ['movimentos', 'Movimentos', 'Que hipótese, decisão ou experimento vem a seguir?', 2, 0, 'rascunho'],
  ];
  map.clusters = groups.map(([id, clusterTitle, description], index) => ({
    id,
    title: clusterTitle,
    description,
    bodyMarkdown: `## ${clusterTitle}\n\n${description}`,
    color: colors[index], tags: [], fields: {}, label: { mode: 'auto', offsetX: 0, offsetY: 0 },
  }));
  map.hexagons = groups.map(([id, nodeTitle, description, q, r, status], index) => ({
    id,
    title: nodeTitle,
    summary: description,
    description,
    bodyMarkdown: `## ${nodeTitle}\n\n${description}\n\n### Notas\n\nAdicione conteúdo em Markdown aqui.`,
    tags: ['começo'],
    fields: { status, evidence: 'exploratoria' },
    visual: { mode: 'text', image: { src: '', fit: 'cover', position: '50% 50%', overlay: .38 } },
    q, r, clusterId: id, axisPosition: null,
  }));
  map.relations = [
    { id: 'r1', source: 'pergunta', target: 'sinais', label: 'investiga', routing: { mode: 'auto', offset: { along: 0, perpendicular: .2 } } },
    { id: 'r2', source: 'sinais', target: 'movimentos', label: 'informa', routing: { mode: 'auto', offset: { along: 0, perpendicular: .2 } } },
  ];
  map.nextEntity = 4;
  map.nextRelation = 3;
  map.paletteCursor = 3;
  return map;
}

export function createJourneyMap(title = 'Jornada e caminhos') {
  const map = createEmptyMap(title);
  map.description = 'Um mosaico contínuo para ordenar etapas, decisões e passagens.';
  map.layout.mode = 'mosaic';
  map.layout.showClusterHulls = false;
  const steps = [
    ['entrada', 'Entrada', -3, 0, 'momento'],
    ['contexto', 'Contexto', -2, 0, 'momento'],
    ['escolha', 'Escolha', -1, 0, 'decisão'],
    ['travessia', 'Travessia', 0, 0, 'momento'],
    ['aprendizado', 'Aprendizado', 1, 0, 'evidência'],
    ['proximo', 'Próximo passo', 2, 0, 'momento'],
  ];
  const groups = [
    ['momento', 'Momentos', PALETTE[0]],
    ['decisão', 'Decisões', PALETTE[2]],
    ['evidência', 'Evidências', PALETTE[4]],
  ];
  map.clusters = groups.map(([id, clusterTitle, color]) => ({
    id, title: clusterTitle, description: '', bodyMarkdown: `## ${clusterTitle}`,
    color, tags: [], fields: {}, label: { mode: 'auto', offsetX: 0, offsetY: 0 },
  }));
  map.hexagons = steps.map(([id, nodeTitle, q, r, clusterId]) => ({
    id, title: nodeTitle, summary: '', description: '', bodyMarkdown: `## ${nodeTitle}\n\nDescreva esta etapa.`,
    tags: [], fields: {}, visual: { mode: 'text', image: { src: '', fit: 'cover', position: '50% 50%', overlay: .38 } },
    q, r, clusterId, axisPosition: null,
  }));
  map.relations = steps.slice(0, -1).map((step, index) => ({
    id: `path-${index + 1}`, source: step[0], target: steps[index + 1][0], sourceType: 'hexagon', targetType: 'hexagon',
    style: 'edge', label: '', routing: { mode: 'auto', offset: { along: 0, perpendicular: 0 } },
  }));
  map.nextEntity = 7; map.nextRelation = 6; map.nextCluster = 4; map.paletteCursor = 3;
  return map;
}

export function createLibraryMap(title = 'Biblioteca de notas') {
  const map = createEmptyMap(title);
  map.description = 'Uma base simples para explorar notas por temas, sem exigir contornos.';
  map.layout.mode = 'mosaic';
  map.layout.showClusterHulls = false;
  const themes = [
    ['ideias', 'Ideias', PALETTE[1], -1],
    ['fontes', 'Fontes', PALETTE[3], 0],
    ['sínteses', 'Sínteses', PALETTE[5], 1],
  ];
  map.clusters = themes.map(([id, clusterTitle, color]) => ({ id, title: clusterTitle, description: '', bodyMarkdown: `## ${clusterTitle}`, color, tags: [], fields: {}, label: { mode: 'auto', offsetX: 0, offsetY: 0 } }));
  map.hexagons = themes.map(([id, nodeTitle, , q]) => ({ id: `${id}-1`, title: `Primeira ${nodeTitle.toLowerCase()}`, summary: '', description: '', bodyMarkdown: `## Primeira ${nodeTitle.toLowerCase()}\n\nEscreva ou conecte uma nota Markdown.`, tags: [], fields: {}, visual: { mode: 'text', image: { src: '', fit: 'cover', position: '50% 50%', overlay: .38 } }, q, r: 0, clusterId: id, axisPosition: null }));
  map.nextEntity = 4; map.nextCluster = 4; map.paletteCursor = 3;
  return map;
}
