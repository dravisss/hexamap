# Processo de release

O release é uma operação de build e verificação, não um deploy automático.

1. Confirme que a versão em `pyproject.toml`, `package.json`, documentação e
   browser report é a mesma.
2. Execute os testes locais e `python -m pip install build` (apenas no
   ambiente de build), seguido de `python scripts/build_release.py`.
3. Execute `python scripts/check_release.py`; guarde o log e o
   `SHA256SUMS.txt`.
4. Revise o diff e publique manualmente os artefatos no GitHub/PyPI somente
   depois de uma aprovação humana. O workflow de GitHub Actions anexa artefatos
   a uma execução, mas não possui etapa de publicação nem segredo de PyPI.
5. Após a publicação, instale o wheel em um ambiente limpo e repita
   `hexmap doctor --json`, `hexmap validate` e o smoke de browser quando
   Playwright estiver disponível.

## Artefatos

- `hexmap_studio-<versão>-py3-none-any.whl` — CLI/MCP, `hexmap_export`,
  migrações e runtime empacotados;
- `hexmap_studio-<versão>.tar.gz` — fonte para auditoria e rebuild;
- `hexmap-studio-<versão>-standalone.zip` — preview sem Python;
- `SHA256SUMS.txt` — checksums SHA-256 dos três artefatos.

Nenhum artefato deve conter `.env`, chave privada, token, `__pycache__`,
`node_modules` ou dados de usuário. `check_release.py` falha se encontrar esses
nomes ou traversal no ZIP.
