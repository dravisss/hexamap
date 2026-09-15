# Validação — HexaMap Studio V10

Versão validada neste documento: **10.3.0**. O relatório de browser, os
artefatos e os metadados devem sempre apontar para a mesma versão.

## Sequência executada

```bash
python3 browser_smoke.py
python3 validate_package.py
python3 scripts/build_release.py --output-dir /tmp/hexmap-dist
python3 scripts/check_release.py --dist /tmp/hexmap-dist
```

O validador recusa um relatório de browser mais antigo que os módulos centrais. Para refazer tudo num único comando:

```bash
HEXMAP_RUN_BROWSER=1 python3 validate_package.py
```

## Resultado funcional

```text
PASS JavaScript syntax
PASS Python compilation
PASS 11 unit tests
PASS JSON Schema Draft 2020-12
PASS structural audit of 3 examples
PASS inline standalone build
PASS 4 Agent Skills structure
PASS skill wrapper scripts
PASS browser smoke
PASS automatic routing: 0 hard collisions in demo
PASS automatic routing: 0 crossings in demo
PASS complete JSON export
PASS 0 console errors
PASS 0 page errors
```

## Testes unitários

### Geometria

- axial ↔ pixel round-trip;
- seis vizinhos únicos;
- distância axial.

### Dados

- estrutura rica V9;
- IDs únicos;
- honeycombs iniciais conectados;
- round-trip de posições, campos e visuais.

### Markdown

- headings, listas, links e ênfase;
- escape de HTML bruto;
- bloqueio de links não HTTP/HTTPS;
- geração de excerpt.

### Routing

- preferência por lado externo do mapa;
- obstacle avoidance sobre preferência estética;
- modo manual preserva offset salvo.

## Browser smoke

Relatório canônico:

```text
previews/browser-report.json
```

Resultado atual:

```json
{
  "version": "10.3.0",
  "initial_nodes": 48,
  "initial_clusters": 6,
  "initial_relations": 6,
  "initial_annotations": 0,
  "auto_route_hard_collisions": 0,
  "auto_route_crossings": 0,
  "tooltip_visible": true,
  "entity_drawer": true,
  "markdown_preview": true,
  "focus_reading": true,
  "custom_field_created": true,
  "custom_field_value": "alta",
  "tags_updated": true,
  "field_color_rule": "status",
  "style_color_inputs": 3,
  "image_uploaded": true,
  "image_mode": "icon",
  "relation_drawer": true,
  "routing_handle": true,
  "manual_curve_flip": true,
  "routing_mode_after_flip": "assisted",
  "routing_reset_auto": "auto",
  "cluster_drag_changed": true,
  "cluster_drag_member_count": 7,
  "annotation_created": true,
  "axes_layout": "axes",
  "axis_main": 1,
  "axes_cluster_keys": 6,
  "axes_hulls_hidden": 0,
  "new_relation_count": 7,
  "clusters_grouped_by_field": 3,
  "export_schema_version": "1.0.0",
  "export_has_positions": true,
  "export_has_routing": true,
  "export_has_fields": true,
  "export_has_visuals": true,
  "export_has_viewport": true,
  "import_roundtrip": true,
  "errors": []
}
```

## JSON examples

Todos passam em `validate` e `audit`:

```text
examples/organizational-system.json
examples/minimal-map.json
examples/axes-map.json
```

## Skills

Skills validadas:

```text
build-hexmap
compose-hexmap
audit-hexmap
```

Cada skill possui:

- `SKILL.md` com frontmatter `name` e `description`;
- `references/`;
- `scripts/` determinísticos.

## Evidências visuais

```text
previews/default.png
previews/reading-focus.png
previews/fields-and-style.png
previews/relation-routing.png
previews/canvas-text.png
previews/axes.png
```

## Persistência local

A gravação em `localStorage` está implementada e usada por toda chamada de `render()`. A política do ambiente de execução bloqueou navegação para origens locais durante o Chromium headless, portanto o gate automatizado cobre import/export e preservação do modelo, mas não reload em origem HTTP.

## Gate universal 10.2

O gate integrado também cobre seis testes da plataforma Python, instalação
limpa do wheel fora do repositório, runtime assets empacotados, composição de
300 células sem overlaps, dez presets, workspace headless, render arbitrário,
quatro skills portáteis, MCP stdio, os modos Territórios/Mosaico/Eixos,
relações tipadas, views sem duplicação de Markdown e certificação de interface
para os cinco harnesses instalados. Ver `qa/UNIVERSAL-MAPPING-ACCEPTANCE.md`.

## Escopo não validado

- colaboração concorrente;
- backend e sincronização remota;
- leitores de tela em todas as operações espaciais;
- milhares de hexágonos simultâneos;
- pathfinding multi-segmento para routing extremo;
- leitores de tela ainda dependem do drawer e da busca para substituir a manipulação espacial direta;
- pathfinding com múltiplos segmentos continua deliberadamente fora do núcleo simples.

## Gate de distribuição

`scripts/build_release.py` materializa wheel, sdist, standalone e
`SHA256SUMS.txt` sem publicar nada. `scripts/check_release.py` valida os hashes,
nomes/versão, conteúdo do ZIP, ausência de segredos e traversal. A instalação
limpa usada pelo validador instala o projeto fora do checkout e executa
`hexmap doctor --json` e um render de workspace.
