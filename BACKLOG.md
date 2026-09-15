---
title: HexaMap Studio Backlog
status: resolved
updated: 2026-09-05
---

# Backlog

## Posicionamento preferencial do título de cluster

- Prioridade: P2
- Estado: concluído em 2026-09-05
- Contexto: o posicionamento automático evita colisões, mas pode colocar um título abaixo do cluster mesmo quando existe espaço útil acima. O caso observado foi o cluster “Governança” no mapa de demonstração.
- Regra desejada: usar a posição superior como preferência estável. Só posicionar abaixo ou nas laterais quando uma colisão real com hexágonos, relações, outros títulos ou limites visíveis tornar a posição superior inviável.
- Critérios de aceite:
  - “Governança” permanece com o título acima no arranjo demonstrado.
  - pequenos movimentos do cluster não fazem o título alternar entre cima e baixo.
  - o fallback continua evitando sobreposição com nós, relações e outros títulos.
  - testes cobrem preferência superior, colisão superior e estabilidade após pequenos deslocamentos.

### Resolução

- a estimativa de largura passou a refletir a medida real do título editorial, sem o piso artificial de 220 px que criava colisões inexistentes;
- “Governança” permanece acima do território no mapa inicial e no viewport de 1440 × 900;
- o smoke visual agora falha se o título voltar para baixo;
- o fallback lateral/inferior e as penalidades contra colisão continuam ativos.
