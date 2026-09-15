# Gramática universal do HexMap

O HexMap não é um editor genérico de nós. É uma superfície hexagonal
local-first em que conteúdo, pertencimento, proximidade e conexão permanecem
conceitos distintos.

## Princípio central

```text
Markdown       conteúdo canônico
clusterId      pertencimento semântico
q/r            proximidade física
relations      conexão explícita
layout/view    forma de leitura
```

Encostar duas células não muda necessariamente sua categoria. Fazer parte de
um cluster não obriga a desenhar um contorno. Trocar de visualização não duplica
nem altera o Markdown.

## Três gramáticas

### Territórios

Preserva a composição original: grupos aparecem como ilhas, hulls ajudam a
perceber fronteiras e relações curvas conectam conceitos ou territórios.

### Mosaico

Usa a grade como superfície contínua. Hulls são opcionais, cores podem indicar
categorias e relações `edge` entre células adjacentes formam caminhos. O modo
não funde clusters apenas porque células passaram a compartilhar uma borda.

### Eixos

Posiciona células por valores semânticos X/Y e preserva o comportamento já
existente. A cor pode continuar indicando grupos sem transformar a posição em
pertencimento.

## Relações

Uma relação usa o mesmo objeto para quatro combinações:

```text
cluster  -> cluster
hexágono -> hexágono
hexágono -> cluster
cluster  -> hexágono
```

`curve` é a representação livre padrão. `edge` só é válida entre hexágonos
adjacentes e destaca a borda compartilhada. Uma sequência de relações `edge`
é um caminho; não existe uma entidade paralela obrigatória chamada “Path”.

## Views

O mapa compilado pode declarar `activeViewId` e `views[]`. A view ativa também
é materializada no `layout` raiz para clientes antigos. Em uma pasta, a view
default permanece em `.hexmap/map.json` e views extras podem viver em
`.hexmap/views/<id>.json`.

Views contêm somente estado visual, layout e relações quando necessário. O
corpo de cada célula continua existindo uma única vez em seu arquivo Markdown.

## Markdown progressivo

Uma nota não precisa conhecer o HexMap para ser aberta:

1. filename fornece um título de fallback;
2. o primeiro heading pode refinar o título;
3. o corpo inteiro permanece Markdown;
4. frontmatter, quando existe, acrescenta ID, cluster, tags, campos e aparência;
5. wikilinks podem ser projetados como relações célula–célula mediante escolha
   explícita, sem reescrever os arquivos de origem.

## Limite de complexidade

Esta evolução não autoriza banco, conta, backend obrigatório, colaboração em
tempo real, sistema de plugins ou uma ontologia genérica de diagramas. A
arquitetura continua pequena porque todas as novas leituras reutilizam as
entidades e arquivos existentes.

