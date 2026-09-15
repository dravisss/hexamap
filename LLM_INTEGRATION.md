# Integração com LLMs e Agent Skills

## Contrato mínimo para um agente

Um agente não precisa conhecer DOM, CSS ou detalhes do renderer. Ele precisa de três coisas:

```text
1. schemas/hexmap.schema.json
2. hexmap_cli.py
3. skills/
```

Na distribuição instalável, essas superfícies são descobertas por `hexmap` no
`PATH`; nenhum agente precisa conhecer a árvore interna do repositório.

## Superfícies universais

```text
hexmap          CLI headless com envelopes JSON
hexmap-mcp      MCP stdio sobre a mesma biblioteca
hexmap skills   instalador das quatro skills portáteis
```

Leia `UNIVERSAL-AGENT-PLATFORM.md` para instalação, ciclo completo, presets,
LOD, renderização arbitrária e certificação entre harnesses.

## Fluxo recomendado

```text
material do usuário
        ↓
build-hexmap
        ↓
map.json semanticamente válido
        ↓
compose-hexmap
        ↓
layout + routing + aparência
        ↓
audit-hexmap
        ↓
map.json final + relatório
```

## Skill 1 — build-hexmap

Usar quando o usuário fornecer:

- notas;
- relatório;
- metodologia;
- pesquisa;
- descrição de sistema;
- base de conceitos;
- dados estruturados.

Responsabilidades:

- definir a unidade de análise;
- criar hexágonos canônicos;
- escrever resumo e Markdown;
- criar tags e field definitions;
- criar clusters iniciais;
- criar relações direcionais justificadas;
- adicionar anotações de contexto;
- validar o JSON.

## Skill 2 — compose-hexmap

Responsabilidades:

- escolher Territórios, Mosaico ou Eixos conforme a pergunta do usuário;
- manter adjacência física, pertencimento semântico e view como conceitos independentes;
- usar relações `edge` somente entre hexágonos axialmente adjacentes;
- usar relações `curve` para conexões livres entre hexágonos ou clusters;
- compactar honeycombs;
- posicionar clusters;
- escolher imagens e modos visuais;
- aplicar colorização por campo;
- posicionar anotações;
- resetar relações para routing automático;
- preparar viewport.

## Skill 3 — audit-hexmap

Responsabilidades:

- validar schema;
- auditar referências e sobreposições;
- renderizar em Chromium;
- avaliar default e estados de interação;
- criticar composição, legibilidade e routing;
- iterar até os gates passarem.

## Comandos determinísticos

```bash
python3 hexmap_cli.py init --title "Meu mapa" -o map.json
python3 hexmap_cli.py validate map.json
python3 hexmap_cli.py audit map.json
python3 hexmap_cli.py normalize map.json -o normalized.json
python3 hexmap_cli.py layout map.json --template free -o composed.json
python3 hexmap_cli.py route composed.json -o routed.json
```

## Prompt operacional mínimo

Um agente compatível pode receber:

```text
Use build-hexmap para modelar o material fornecido.
Use compose-hexmap para escolher e criar a leitura mais útil.
Use audit-hexmap por cinco ciclos visuais.
Entregue map.json validado e uma nota separando fatos da fonte e decisões interpretativas.
```

## Regras importantes

- não duplicar o mesmo conceito apenas porque participa de mais de um tema;
- distinguir estrutura presente na fonte de interpretação do agente;
- usar IDs estáveis;
- manter `routing.mode = auto` por padrão;
- nunca remover conteúdo para resolver layout;
- não tratar tags decorativas como clusters sem justificativa;
- usar campos apenas quando sustentarem leitura, filtragem, eixos, agrupamento ou estilo;
- executar validação após toda transformação estrutural.

## Progressive disclosure

Os `SKILL.md` mantêm apenas a sequência operacional e os gates centrais. Detalhes extensos ficam em:

```text
references/
scripts/
```

Isso reduz contexto desnecessário e permite que o agente carregue schema, routing e checklists somente quando precisa.
