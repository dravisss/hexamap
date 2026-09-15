# Routing de relações

## Objetivo

A curva deve:

- sair do cluster de origem para fora;
- chegar ao destino pelo exterior;
- evitar clusters não relacionados;
- evitar títulos editoriais;
- reduzir cruzamentos;
- evitar o centro congestionado do mapa quando houver alternativa;
- permanecer curta e editorialmente controlável.

## Geometria

Cada relação é uma Bézier quadrática:

```text
start → control → end
```

O controle é armazenado em coordenadas normalizadas em relação ao segmento origem–destino:

```json
{
  "along": 0.0,
  "perpendicular": 0.22
}
```

- `along` move o controle ao longo do eixo da relação;
- `perpendicular` escolhe lado e intensidade da curva.

## Geração de candidatos

No modo `auto`, o solver testa:

- 16 intensidades/lados perpendiculares;
- 7 deslocamentos longitudinais;
- até 112 candidatos por relação.

No modo `assisted`, ele procura numa vizinhança pequena em torno da escolha do usuário.

No modo `manual`, usa exatamente o offset salvo.

## Função de custo

A pontuação considera:

```text
comprimento adicional
saída para dentro da origem
chegada pelo lado errado
colisão com polygon/hull
clearance insuficiente
colisão com label
cruzamento de rota
proximidade do interior do mapa
preferência manual/assistida
```

Penalidades de colisão são propositalmente muito maiores do que preferências estéticas.

## Obstáculos

O router aceita:

- polygons de clusters;
- retângulos de labels;
- samples das relações já roteadas.

Cada curva é amostrada em 37 pontos para avaliação.

## Interação manual

Ao selecionar uma relação:

- arraste o handle no canvas;
- use o slider de curvatura lateral;
- use o slider de avanço angular;
- inverta o lado;
- retorne para Auto.

Mover clusters provoca novo cálculo em Auto e Assistido. Manual preserva a intenção salva.

## Limite atual

O solver trabalha com uma única Bézier quadrática. Quando um mapa exige múltiplas curvas ou corredores ortogonais, a próxima evolução é:

```text
visibility graph → A* → simplificação → spline
```

Essa evolução pode ser implementada dentro de `router.js` sem alterar o JSON público.
