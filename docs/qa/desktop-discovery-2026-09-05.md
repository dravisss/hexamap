# HexMap Desktop — descoberta, leitura e hierarquia operacional

Data: 2026-09-05  
Base auditada: candidata pública curada `0.1.10`  
Escopo desta rodada: somente desktop, com contraprovas em `1440×900`, `1536×1008` e `1280×800`. A suíte completa conserva regressões legadas de outros viewports, mas nenhuma decisão nova foi orientada a mobile.

## Veredito

**ACCEPT.** Não restou P0/P1 reproduzível na camada desktop de descoberta, seleção e continuidade de contexto coberta nesta rodada. O browser smoke completo terminou com `errors: []`, e o pacote integral passou pelo gate de validação.

## Falhas reproduzidas e corrigidas

### P1 — a busca dizia “projeto”, mas ignorava clusters, relações e textos livres

- O índice cobria apenas hexágonos; conteúdo estrutural e anotações ficavam invisíveis ao principal mecanismo de descoberta.
- A busca agora indexa hexágonos, clusters, relações e textos do canvas, normaliza acentos e combina título, corpo, tags, campos e endpoints relevantes.
- Cada resultado explicita seu tipo e contexto; o estado sem resultados orienta quais termos tentar.
- Selecionar um resultado abre o drawer correto, limpa a consulta e fecha `aria-expanded` junto com o painel visível.

### P1 — seleção estrutural no 3D não tinha continuidade visual

- Buscar e abrir um cluster ou uma relação no 3D exibia o drawer, mas o mapa não indicava qual objeto estava ativo.
- Cluster selecionado agora recebe estado visual e semântico; relação selecionada destaca a conexão, o rótulo e seus endpoints.
- O canvas expõe o contexto selecionado para contraprova automatizada, e o conteýo focal permanece fora da área reservada pelo drawer em `1280×800`.
- Durante uma consulta, os rótulos 3D não correspondentes são atenuados com a mesma lógica contextual do 2D.

### P1 — relações entre hexágonos existiam no modelo, mas não no mapa 3D

- O renderer 3D só desenhava relações cujos dois endpoints eram clusters.
- A resolução de endpoints agora aceita clusters e hexágonos, reaproveitando posição e cor canônicas.
- A contraprova cria uma relação hexágono→hexágono em 3D e exige que a contagem renderizada acompanhe a contagem do modelo.

### P2 — a barra desktop tratava onze ações como igualmente importantes

- Ajuste de viewport, importação, exportação, reset, apresentação e ajuda competiam visualmente com criação, layout e descoberta.
- **Projeto** e **Buscar** ganharam nomes visíveis; tarefas secundárias foram consolidadas em **Mais** com itens textuais.
- O menu evita duplicar ações já visíveis no desktop e mantém acesso por setas, Home, End e Escape.

### P2 — resultados e menu secundário tinham percurso de teclado incompleto

- Seta para baixo agora move o foco do campo de busca para os resultados.
- Resultados e itens de **Mais** aceitam setas, Home e End; Escape fecha e devolve o foco ao controle de origem.
- A navegação considera somente itens realmente visíveis, evitando foco em duplicatas ocultas por breakpoint.

## Contraprovas desktop

- Em `1440×900`, buscar por `Tecnologia`, `articula` e uma anotação criada durante o teste; exigir resultado tipado e drawer correspondente.
- Buscar termo inexistente e exigir orientação explícita em vez de painel vazio.
- Navegar busca e menu **Mais** somente pelo teclado, fechar com Escape e verificar retorno de foco.
- Em `1280×800` no 3D, selecionar **Tecnologia** e exigir estado `aria-pressed`, realce visível e território fora do drawer.
- No mesmo viewport, selecionar `articula` e exigir realce da conexão, do rótulo e dos dois territórios conectados.
- Criar relação entre dois hexágonos no 3D e exigir paridade entre relações canônicas e renderizadas.
- Inspecionar drawers compacto e foco, leitura Markdown, estado vazio e feedback transitório sem nova regressão desktop.

## Evidência

- `previews/browser-report.json`
- `previews/audit/desktop-action-hierarchy.png`
- `previews/audit/desktop-search-all-content.png`
- `previews/audit/desktop-3d-search-context-1280.png`

## Validação

`npm run validate` e `npm run smoke` passaram sobre a candidata final:

- 30/30 testes JavaScript;
- 21/21 testes Python;
- schema e auditorias estruturais;
- instalação limpa e `doctor` do pacote;
- certificação CLI/MCP e harnesses;
- build inline autocontido e bundles 3D recompilados;
- browser smoke completo com os novos gates desktop;
- primeira ativação 3D: `79.0 ms`;
- p95 de render 3D: `14.4 ms`;
- fixture de 192 hexágonos: `503.1 ms` em 2D e `159.1 ms` para ativar 3D;
- console e erros de página: nenhum.

## Limite honesto

A rodada prova os fluxos no Chromium desktop automatizado e por inspeção visual das capturas. Ela não substitui leitor de tela real, uso editorial prolongado nem validação em outros motores de navegador.
