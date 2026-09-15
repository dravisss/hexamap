# Contribuindo

Obrigado por contribuir com o HexMap Studio. O projeto mantém uma superfície
local-first simples: Markdown e YAML são conteúdo canônico, `.hexmap/map.json`
guarda layout e relações, e nenhum banco ou backend remoto é requisito.

## Fluxo

1. Abra uma issue para uma mudança maior e descreva a motivação, o escopo e o
   comportamento de fallback.
2. Crie uma branch curta a partir de `main` e faça commits pequenos e
   explicativos. Não inclua segredos, mapas pessoais, artefatos de `dist/` ou
   `__pycache__`.
3. Atualize testes e documentação na mesma mudança. Preserve a versão publicada
   nos exemplos e relatórios quando não houver release nova.
4. Rode `python3 validate_package.py`, `npm test` e os checks focados. Para
   mudanças de distribuição, rode `python3 scripts/build_release.py` e
   `python3 scripts/check_release.py` em um diretório temporário.

## Write-set e revisão

Não misture alterações visuais com hardening de release. Mudanças em
`index.html`, `styles.css`, `app.js`, `workspace.js` e `data.js` precisam de
evidência visual própria. Toda entrada externa deve falhar fechada e toda
operação de escrita deve ser delimitada por uma raiz explícita.

Pull requests devem explicar: arquivos alterados, testes executados, limites
novos, compatibilidade de browser e qualquer gate que não pôde ser executado.
