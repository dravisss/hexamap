# Segurança

## Escopo e suporte

HexMap Studio 10.3.x é um aplicativo local-first. O servidor incluído serve
arquivos estáticos apenas em `127.0.0.1` por padrão; não há conta, banco,
telemetria ou API remota obrigatória. Correções de segurança são priorizadas
para a série 10.3.x enquanto ela estiver em manutenção.

## Modelo de ameaças

O processo local pode ler os arquivos que o usuário escolhe abrir e escrever
no diretório de destino de uma operação explícita. Um bundle, nota Markdown,
imagem ou caminho recebido de fonte não confiável é considerado entrada
adversarial. O código impõe limites de tamanho/quantidade, rejeita traversal,
symlinks que escapem da raiz e limita a incorporação de imagens. Isso reduz
exaustão de memória, sobrescrita arbitrária e XSS acidental; não transforma o
programa em sandbox contra um usuário local já comprometido.

O HTML é estático e pode ser aberto sem servidor. O servidor local envia CSP e
headers defensivos, mas não deve ser exposto à rede sem uma camada de controle
de acesso. O modo `--allow-network` é deliberadamente explícito e não oferece
autenticação.

## Relato responsável

Não publique detalhes de uma vulnerabilidade antes de uma correção combinada.
Abra um Security Advisory privado no GitHub, quando o repositório estiver
habilitado, ou envie uma descrição mínima ao mantenedor. Não inclua mapas,
imagens, tokens, cookies ou outros dados pessoais no relato; forneça apenas um
fixture mínimo reproduzível. O projeto não promete SLA para versões fora da
série suportada.

## Práticas de distribuição

- Verifique `SHA256SUMS.txt` antes de instalar um wheel, sdist ou standalone.
- Prefira `pip install --require-hashes` quando a organização mantiver um lock.
- Use um ambiente virtual e mantenha `jsonschema` e `PyYAML` atualizados.
- O workflow de release constrói e anexa artefatos, mas nunca publica usando
  um token implícito ou segredo presente no repositório.
