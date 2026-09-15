# Changelog

## 0.1.10 — 2026-09-15

- corrigida a ordem de navegação: comandos globais agora vêm antes das dezenas de elementos do canvas;
- em projeto vazio, “Adicionar conceito” agora prepara e foca o canvas sem criar acidentalmente um hexágono sob o próprio botão;
- drawer, busca, ajuda e tabs receberam entrada, retorno e navegação por teclado previsíveis;
- Busca e Configurações voltaram a ser alcançáveis no menu de overflow mobile;
- o mapa 2D preserva o item selecionado ao abrir o drawer; a cena 3D reserva espaço em desktop largo e, em larguras intermediárias, posiciona o drawer no lado oposto ao item acionado;
- onboarding rolável mantém uma decisão primária visível em telas baixas;
- a dica de gesto deixa de ocupar o canvas depois do primeiro uso;
- títulos curtos de cluster preservam a posição superior preferencial;
- a captura determinística passou a localizar Chromium ou Chrome também no macOS;
- smoke visual ampliado para foco, Escape, tabs, contexto 2D/3D, 920 px, mobile 390 px e ações antes inacessíveis.
- chrome intermediário sem colisão entre `601–680 px`, com gate sobre os filhos visíveis do cabeçalho;
- telas estreitas ou baixas usam enquadramento focal em vez de um overview cortado;
- no 3D horizontal baixo, Busca reenquadra o território escolhido e os rótulos fora de foco deixam a ordem assistiva;
- Projeto, Busca, Configurações, Ajuda, ferramentas e drawer passaram a anunciar estado e contexto dinâmicos;
- recovery agora tem contraprova real de restaurar, persistir e descartar em origem de navegador normal.

## 10.2.0 — 2026-08-29

- três leituras sobre a mesma gramática: Territórios, Mosaico e Eixos;
- contornos de clusters opcionais, sem acoplar proximidade e pertencimento;
- relações entre hexágonos e clusters, com caminhos por bordas adjacentes;
- Markdown comum sem frontmatter obrigatório e wikilinks opcionais;
- múltiplas leituras do mesmo corpus sem duplicar os arquivos Markdown;
- templates orientados a sistema, jornada e biblioteca;
- publicação HTML e SVG acessível diretamente na interface;
- contratos, schema, migração, CLI, MCP e skills atualizados de ponta a ponta.

## 10.1.0 — 2026-08-29

- consolidada a plataforma universal local-first com CLI headless, MCP stdio,
  quatro Agent Skills, schemas e workspace Markdown/YAML;
- adicionados presets de composição, semantic LOD, routing e auditoria visual;
- pacote Python instalável e preview HTML autocontido;
- gates de release público, checksums, CI multiplataforma e hardening do
  servidor local.

## Antes de 10.1.0

As mudanças históricas estão preservadas no histórico Git. Consulte o commit
correspondente para a evidência de cada marco visual e de plataforma.
