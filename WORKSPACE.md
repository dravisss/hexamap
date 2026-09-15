---
title: "HexaMap Workspace — contrato local-first"
date: 2026-08-29
status: implementado
tags:
  - hexmap
  - markdown
  - yaml
  - local-first
---

# HexaMap Workspace

O workspace do HexaMap é uma pasta comum. Não há banco de dados, conta, servidor remoto ou formato binário.

## Estrutura

```text
Meu Projeto/
├── hexmap.yaml
├── notas/
│   ├── autonomia.md
│   └── governanca.md
├── assets/
└── .hexmap/
    ├── map.json
    └── views/
        └── jornada.json
```

- `hexmap.yaml`: identidade e configuração portátil do projeto;
- `**/*.md`: conteúdo canônico e campos;
- `.hexmap/map.json`: layout, clusters, relações, anotações e aparência;
- `.hexmap/views/*.json`: leituras alternativas do mesmo corpus, sem duplicar notas;
- `assets/`: imagens referenciadas por caminhos relativos.

## Nota canônica

```markdown
---
id: autonomia
title: Autonomia
cluster: trabalho
tags:
  - poder
  - decisão
status: em-analise
---

# Autonomia

Capacidade localizada de tomar decisões consequenciais.
```

`id` é a identidade estável. Renomear o arquivo ou o título não deve quebrar relações. Propriedades YAML que não pertencem ao HexMap são projetadas como campos customizados e preservadas no round-trip.

Frontmatter é opcional. Sem ele, o app usa o primeiro H1 (ou o nome do arquivo)
como título e deriva um ID determinístico do caminho. Wikilinks só viram relações
quando a importação opcional é ativada; destinos ausentes ou ambíguos aparecem no
diagnóstico.

## Regras de sincronização

1. Conteúdo e frontmatter vêm dos arquivos Markdown.
2. Posição e routing vêm de `.hexmap/map.json`.
3. Alterações não gravadas bloqueiam a releitura da pasta.
4. Salvar nunca remove arquivos que desapareceram do mapa.
5. IDs duplicados e fontes ausentes aparecem no diagnóstico.
6. A escrita usa `FileSystemWritableFileStream`, que conclui a troca do conteúdo somente ao fechar o stream.
7. Trocar de leitura não reescreve nem duplica o conteúdo das notas.

## Modos de operação

### Pasta conectada

Em browsers Chromium compatíveis, **Projeto → Abrir pasta** concede acesso somente à pasta escolhida. O app lê os Markdown e grava as mudanças de volta.

### Bundle portátil

Quando o navegador não oferece acesso a diretórios, o app importa e exporta um arquivo `*.hexmap-workspace.json`. O bundle contém os mesmos arquivos por caminho e pode ser aberto novamente sem backend.

### JSON legado

Importação e exportação do mapa JSON completo continuam disponíveis para compatibilidade, automação e CLI.

## Limites deliberados

- YAML cobre escalares, listas, mapas aninhados e blocos de texto mais comuns em Obsidian; recursos YAML avançados como anchors e custom tags não são interpretados;
- comentários YAML não são preservados ao regravar uma nota, embora propriedades desconhecidas sejam;
- exclusão física de Markdown nunca é automática;
- colaboração simultânea e merge ficam a cargo do filesystem/Git.
