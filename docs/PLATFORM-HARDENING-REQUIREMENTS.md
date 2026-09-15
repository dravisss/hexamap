# Requisitos de hardening da plataforma (handoff para E–F)

`hexmap_platform.py` é propriedade da task E–F. Este documento preserva o
contrato de segurança que a camada compartilhada deve implementar sem tornar o
runtime pesado.

## Limites mínimos

Os valores podem ser ajustados com evidência, mas devem ser constantes visíveis
e testadas:

| Entrada | Limite inicial | Falha |
| --- | ---: | --- |
| bundle JSON | 16 MiB | `HEXMAP_LIMIT_EXCEEDED` |
| arquivos por bundle | 2.000 | `HEXMAP_LIMIT_EXCEEDED` |
| arquivo Markdown/YAML | 2 MiB | `HEXMAP_LIMIT_EXCEEDED` |
| imagem incorporada | 8 MiB | `HEXMAP_LIMIT_EXCEEDED` |
| caminho relativo | 512 caracteres | `HEXMAP_PATH_INVALID` |
| hexágonos / relações | 10.000 | `HEXMAP_LIMIT_EXCEEDED` |

Leia bytes antes de decodificar texto, limite `bodyMarkdown` e recuse objetos
JSON que não possam ser serializados. Imagens `data:` devem usar base64 estrito
e um MIME de imagem explícito (PNG, JPEG, GIF, WebP ou SVG); URLs HTTP/HTTPS
podem ser preservadas, mas nunca buscadas pelo processo Python.

## Paths e escrita

- aceite apenas caminhos relativos, sem NUL, `.` ou `..`;
- resolva o destino e confirme que ele permanece dentro da raiz escolhida;
- rejeite symlinks que escapem da raiz durante leitura, importação ou render;
- bundles só podem escrever `hexmap.yaml`, `.hexmap/map.json` e arquivos
  Markdown;
- mantenha escrita atômica e não apague arquivos existentes em um import
  parcialmente inválido;
- valide todo o bundle antes da primeira escrita (transação all-or-nothing).

## Testes de aceite obrigatórios

Adicionar testes Python reais para:

1. bundle válido com duas notas faz round-trip e continua sem banco;
2. `../outside`, caminho absoluto, NUL, symlink externo e extensão inesperada
   são rejeitados sem criar arquivo fora da raiz;
3. bundle acima de 16 MiB, mais de 2.000 arquivos, arquivo acima de 2 MiB,
   Markdown acima do limite e imagem base64 acima de 8 MiB falham fechados;
4. base64/mime inválido e mapa com valores não JSON falham sem traceback de
   implementação;
5. import inválido não deixa artefato parcial e `dry_run` não escreve;
6. render incorpora apenas imagens dentro da raiz autorizada, com o limite
   aplicado, e preserva URLs sem fazer requisições de rede.

Os códigos acima devem aparecer no envelope CLI/MCP e manter compatibilidade
com os códigos documentados em `contracts/ERRORS.md`.
