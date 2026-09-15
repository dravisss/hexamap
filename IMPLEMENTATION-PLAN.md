---
title: "HexaMap Studio V10 — Plano local-first"
date: 2026-08-29
status: executado
tags:
  - hexmap
  - roadmap
  - local-first
  - markdown
---

# HexaMap Studio V10 — Plano local-first

## Resultado pretendido

Transformar o editor autocontido em uma ferramenta geral de mapeamento hexagonal, sem banco, cuja fonte canônica seja uma pasta de Markdown com frontmatter YAML.

## Decisões arquiteturais

| Decisão | Escolha | Razão |
|---|---|---|
| Fonte de verdade | Markdown + YAML | Legível, Git-friendly e compatível com Obsidian |
| Estado visual | `.hexmap/map.json` | Evita poluir notas ao arrastar células |
| Relações | Manifest visual | Uma relação envolve dois objetos e routing não é conteúdo da nota |
| Persistência | File System Access API | Acesso local direto sem backend |
| Fallback | Bundle JSON portátil | Funciona onde diretórios não estão disponíveis |
| Compatibilidade | JSON legado preservado | Mantém CLI, skills e automações existentes |
| Identidade | `id` estável no frontmatter | Renomear título/arquivo não rompe relações |
| Exclusão | Nunca apagar Markdown automaticamente | Fail-closed contra perda de dados |

## Fases executadas

- [x] Isolar o projeto do Git do `2ndBrain`.
- [x] Auditar UI/UX e registrar baseline visual.
- [x] Implementar parser/serializer de frontmatter.
- [x] Preservar propriedades YAML desconhecidas como campos.
- [x] Projetar notas Markdown no modelo HexMap.
- [x] Separar conteúdo canônico do manifest de layout.
- [x] Abrir e gravar pastas locais.
- [x] Criar bundle portátil sem banco ou servidor.
- [x] Manter import/export JSON legado.
- [x] Adicionar diagnóstico de IDs duplicados e fontes ausentes.
- [x] Adicionar busca por conteúdo, tags e campos.
- [x] Criar navegação direta para resultado com foco legível.
- [x] Migrar drag/pan para Pointer Events.
- [x] Adicionar `focus-visible` e `prefers-reduced-motion`.
- [x] Criar composição mobile focada em um território.
- [x] Criar fixtures de pasta e bundle.
- [x] Cobrir workspace no browser smoke.
- [x] Documentar contrato, limites e operação.

## Gates de aceitação

1. Markdown → mapa preserva ID, conteúdo, tags, cluster e campos.
2. Mapa → Markdown preserva propriedades YAML desconhecidas.
3. O manifest não duplica `bodyMarkdown`.
4. Bundle → app → bundle preserva pelo menos um Markdown e o layout.
5. Busca encontra conteúdo e reduz visualmente não correspondentes.
6. O app modular e o inline autocontido carregam sem console errors.
7. Todos os testes existentes continuam passando.
8. Mobile não possui ações visíveis fora do viewport.

## Limites conhecidos e próximos incrementos

- comentários, anchors, aliases YAML e custom tags não sobrevivem à serialização;
- alterações externas são reconciliadas por **Reler pasta**, ainda não por file watcher;
- assets locais são referenciados, mas ainda não há pipeline de cópia/renomeação;
- remoção do mapa não remove a nota; exclusão/arquivamento deve ganhar fluxo explícito;
- a permissão da pasta precisa ser escolhida pelo usuário por exigência do navegador;
- colaboração simultânea permanece responsabilidade de Git/filesystem;
- a auditoria visual histórica continua válida para densidade desktop e hierarquia das relações, apesar dos reparos mobile e de navegação.

