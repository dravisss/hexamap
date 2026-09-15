# Instalação

## PyPI (wheel)

Em um ambiente virtual:

```bash
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
python -m pip install --upgrade pip
python -m pip install hexmap-studio==10.3.0
hexmap doctor --json
```

O pacote instala `hexmap` e `hexmap-mcp`. A dependência `visual` é opcional:
`python -m pip install 'hexmap-studio[visual]==10.3.0'` instala Playwright para
capturas; o editor e a CLI headless não precisam dela.

## GitHub / fonte

Para testar uma revisão específica sem publicar no PyPI:

```bash
git clone https://github.com/dravisss/hexamap hexamap
cd hexamap
python -m pip install .
```

Em CI, fixe uma tag ou SHA e verifique o `SHA256SUMS.txt` anexado à release.
Não execute `pip install` de um branch móvel em produção.

## Download local

O arquivo `preview-inline.html` pode ser aberto diretamente. Para a distribuição
standalone, extraia `hexmap-studio-10.3.0-standalone.zip` e abra `index.html`
ou `preview-inline.html`. O ZIP não executa código de instalação e não requer
Python.

## Servidor local

```bash
python -m server
# http://127.0.0.1:8123
```

O servidor só escuta loopback por padrão. Consulte `python server.py --help`
antes de escolher outro host; expor a porta exige `--allow-network` e uma
camada de autenticação/rede controlada pelo operador.

## Reprodutibilidade

Para construir os três artefatos (wheel, sdist e standalone) e o manifesto:

```bash
python -m pip install build
python scripts/build_release.py --output-dir /tmp/hexmap-dist
python scripts/check_release.py --dist /tmp/hexmap-dist
```

`SHA256SUMS.txt` é ordenado e calculado sobre os bytes finais. A construção
standalone usa entradas ordenadas e timestamp determinístico (`SOURCE_DATE_EPOCH`
ou zero), permitindo comparar dois builds do mesmo checkout.
