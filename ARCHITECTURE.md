# Arquitetura — HexaMap Studio V10

## Princípio

A aplicação possui uma superfície visual simples, mas separa responsabilidades internamente:

```text
CONTENT MODEL
  hexagons · clusters · relations · annotations · fields

SEMANTICS
  cluster membership · typed endpoints · content identity

GEOMETRY
  axial coordinates · physical adjacency · optional hulls · snapping · axes

VIEWS
  territories · mosaic · axes · named layout projections

ROUTING
  anchors · candidates · scoring · manual override

RENDERING
  axes · cluster fields · routes · editorial labels · annotations · cells

INTERACTION
  drag · grouping · split · merge · connect · drawers

PERSISTENCE
  Markdown/YAML · folder workspace · layout manifest · portable bundle · localStorage · JSON

AGENT INTERFACE
  JSON Schema · CLI · Skills
```

## Módulos

### `data.js`

Cria o dataset de demonstração V9 e define a paleta inicial.

### `hex.js`

Responsável por:

- conversão axial ↔ pixel;
- vizinhos;
- distância axial;
- hull;
- curvas geométricas auxiliares;
- funções de interseção e bounds.

### `router.js`

Solver de relações. Não conhece o domínio do mapa; recebe geometria, obstáculos e preferências.

### `markdown.js`

Renderer de subset Markdown seguro. Escapa HTML bruto antes de produzir o HTML permitido.

### `frontmatter.js`

Parser e serializer do subconjunto YAML usado por workspaces locais e notas Obsidian. Mantém propriedades desconhecidas como campos customizados.

### `workspace.js`

Projeta uma pasta de Markdown no modelo visual, separa conteúdo de layout, mantém múltiplas views sobre um corpus, diagnostica IDs/fontes, grava com File System Access API e produz bundles portáteis sem banco.

### `app.js`

Orquestra estado, renderização, drawers, interações, persistência, importação e exportação.

### `schemas/hexmap.schema.json`

Contrato canônico para arquivos de mapa.

### `hexmap_cli.py`

Operações determinísticas para agentes e automação.

## Modelo de dados

### Hexágono

É a unidade canônica de conteúdo e posição:

```json
{
  "id": "autonomy",
  "title": "Autonomia",
  "summary": "Capacidade localizada de decidir.",
  "bodyMarkdown": "## Autonomia\n\n...",
  "tags": ["trabalho", "poder"],
  "fields": {"status": "em-analise"},
  "visual": {
    "mode": "icon",
    "image": {
      "src": "assets/icons/autonomy.svg",
      "fit": "contain",
      "position": "50% 38%",
      "overlay": 0.25
    }
  },
  "q": -5,
  "r": -1,
  "clusterId": "work",
  "axisPosition": {"x": 0.2, "y": 0.37}
}
```

### Cluster

O contorno não armazena uma forma fixa. Ele é derivado dos membros.

```json
{
  "id": "work",
  "title": "Organização do trabalho",
  "description": "...",
  "bodyMarkdown": "...",
  "tags": [],
  "fields": {},
  "color": "#bf7448",
  "label": {
    "mode": "auto",
    "offsetX": 0,
    "offsetY": 0
  }
}
```

### Relação

```json
{
  "id": "r1",
  "source": "work",
  "target": "gov",
  "label": "estrutura",
  "routing": {
    "mode": "auto",
    "offset": {
      "along": 0,
      "perpendicular": 0.2
    },
    "waypoints": [],
    "locked": false
  }
}
```

### Anotação

```json
{
  "id": "annotation-1",
  "type": "text",
  "x": 880,
  "y": 220,
  "width": 360,
  "title": "Hipótese",
  "bodyMarkdown": "## Hipótese\n\n...",
  "style": {
    "variant": "editorial",
    "fontSize": 18,
    "align": "left"
  }
}
```

## Transformações topológicas

### Split

Quando um hexágono deixa de ser contíguo ao componente principal:

1. a adjacency axial é recalculada;
2. componentes conectados são detectados;
3. o cluster original mantém um componente;
4. componentes adicionais podem virar novos clusters;
5. uma célula isolada pode ficar sem cluster.

### Merge

Quando células ou honeycombs passam a compartilhar adjacency:

1. os componentes são detectados;
2. clusters envolvidos são combinados;
3. uma nova identidade é criada quando a recombinação é estrutural;
4. relações externas são remapeadas;
5. relações internas redundantes são removidas.

### Agrupamento por campo

A operação usa um campo ou a primeira tag como chave, cria clusters e compacta cada grupo numa região do canvas.

## Public API

Disponível no browser:

```js
HexMapStudio.version
HexMapStudio.getMap()
HexMapStudio.getJson()
HexMapStudio.setMap(map)
HexMapStudio.selectHexagon(id)
HexMapStudio.selectCluster(id)
HexMapStudio.setLayout('free' | 'axes')
HexMapStudio.fit()
HexMapStudio.reset()
HexMapStudio.routingReport()
```

Essa API é útil para testes, automação e integrações com LLMs ou hosts externos.
