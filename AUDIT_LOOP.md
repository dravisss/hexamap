# Auditoria crítica da V9 — cinco ciclos

O fluxo utilizado foi:

```text
implementar → renderizar em Chromium → capturar → criticar → corrigir → testar → repetir
```

A V9 não foi tratada como simples soma de features. Cada ciclo verificou se a nova capacidade preservava a simplicidade e a gramática visual da V8.

## Ciclo 1 — baseline e preservação do mapa simples

### Mediocridade identificada

A primeira ampliação corria o risco de repetir a V7: transformar uma interface espacial direta num produto dominado por configurações, modos e drawers.

### Reflexão

Os recursos avançados deveriam permanecer progressivos. O mapa precisa continuar compreensível como:

```text
hexágonos + clusters + relações + texto
```

### Correções

- uma única superfície de mapa;
- quatro ferramentas diretas;
- nenhum modo conceitual alternativo;
- configurações profundas escondidas no drawer;
- preservação do drag, split, merge e move-cluster.

### Evidência

`previews/audit/iter-01-baseline.png`

---

## Ciclo 2 — conteúdo profundo sem apagar os hexágonos

### Mediocridade identificada

Markdown, campos e imagens poderiam fazer o drawer e o estilo por propriedades dominarem a experiência. A primeira composição também deixava uma anotação de demonstração interferir no fit inicial.

### Reflexão

O hexágono continua sendo a unidade visual compacta. A profundidade deve abrir sob demanda, não aumentar a densidade do mapa em repouso.

### Correções

- drawer com Peek, Wide e Focus;
- Markdown em editor/preview;
- leitura editorial em tela cheia;
- custom fields e tags por tabs;
- imagens opcionais em quatro modos;
- nenhuma anotação inserida por padrão;
- uploads incorporados ao JSON.

### Evidências

- `previews/audit/iter-02-current.png`
- `previews/audit/iter-02-features.png`

---

## Ciclo 3 — routing automático e controle editorial

### Mediocridade identificada

Uma regra simples baseada na perpendicular do segmento fazia curvas apontarem para dentro do mapa, entrarem no cluster pelo lado errado ou atravessarem outros territórios.

### Reflexão

A curva correta não depende apenas da distância entre origem e destino. Ela depende de:

- normais de saída/entrada;
- hulls;
- labels;
- outras rotas;
- centro da composição;
- preferência manual.

### Correções

- geração de até 112 candidatos no modo Auto;
- avaliação dos dois lados;
- detecção polygonal de obstáculos;
- penalidade de tangente incorreta;
- penalidade de collision e clearance;
- penalidade de crossing;
- preferência pelo exterior do mapa;
- modos Auto, Assisted e Manual;
- handle arrastável e dois sliders.

### Crítica posterior

O primeiro render ainda deixava labels do mapa cortados e tooltips persistirem em screenshots de estado. Isso foi corrigido no ciclo final.

### Evidências

- `previews/audit/iter-03-router-content.png`
- `previews/audit/iter-03b-clean-map.png`

---

## Ciclo 4 — template X/Y e foco de leitura

### Mediocridade identificada

A primeira versão de eixos desenhava hulls de clusters que atravessavam grandes distâncias, criando campos gigantes e sem significado. O modo Focus inicialmente repetia o título e mantinha controles demais.

### Reflexão

No template X/Y, a posição semântica deve vencer a topologia do honeycomb. O cluster precisa permanecer identificável pela cor, não por um hull que conecta pontos distantes.

Na leitura em tela cheia, o drawer deve se transformar em documento, não apenas crescer.

### Correções

- hulls removidos no layout por eixos;
- chaves editoriais de cluster acima do gráfico;
- borda de cluster preservada nas células;
- relações rebaixadas no estado normal de eixos;
- leitura Focus com corpo Markdown amplo e sidebar de campos;
- tabs ocultas em Focus;
- tags transformadas em pills legíveis.

### Evidências

- `previews/audit/iter-04-axes.png`
- `previews/audit/iter-04b-axes-fixed.png`
- `previews/audit/iter-04c-axes-clean.png`
- `previews/audit/iter-04-reading-focus.png`
- `previews/audit/iter-04-routing.png`

---

## Ciclo 5 — auditoria funcional e acabamento final

### Mediocridade identificada

Features isoladas poderiam passar em testes unitários e falhar em sequência real. O primeiro browser smoke revelou dois problemas:

1. mover Recursos para a esquerda acionava uma recombinação involuntária no próprio teste;
2. a coordenada fixa usada para criar texto às vezes caía sobre um hexágono depois do movimento do cluster.

Esses não eram apenas problemas do teste: mostravam que validação baseada em uma composição congelada era frágil.

### Correções

- drag do cluster testado para uma direção sem merge;
- seleção automática de espaço vazio para inserir texto;
- reset entre cenários que não deveriam contaminar um ao outro;
- map bounds inclui títulos editoriais;
- tooltip é encerrada ao mudar de contexto;
- screenshots finais sem drawer ou annotation residual;
- exemplos atualizados com `$schema`;
- skills e CLI incorporados ao gate final.

### Resultado

O fluxo completo passou em Chromium:

```text
48 hexágonos
6 clusters
6 relações iniciais
0 hard collisions no routing automático
0 route crossings no demo inicial
Markdown e leitura Focus
campo customizado
colorização por campo
imagem incorporada
routing manual e reset automático
cluster inteiro movido preservando 7 membros
texto livre criado
layout X/Y
nova relação criada
agrupamento por campo
export JSON completo
reimportação completa do JSON exportado
0 erros de console
0 page errors
```

### Evidências finais

- `previews/audit/iter-05-final-default.png`
- `previews/audit/iter-05-final-reading.png`
- `previews/audit/iter-05-final-routing.png`
- `previews/audit/iter-05-final-axes.png`
- `previews/browser-report.json`
