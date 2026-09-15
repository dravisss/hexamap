# Privacidade e dados locais

HexMap Studio não envia mapas, notas, imagens ou telemetria para um serviço
remoto. O conteúdo canônico permanece em arquivos Markdown com frontmatter
YAML; o layout fica em `.hexmap/map.json`. O preview guarda apenas o estado de
interface em `localStorage` do navegador e permite exportar um JSON/bundle.

O servidor embutido é um servidor de arquivos estáticos local. Ele não possui
login, banco, sincronização, analytics ou endpoint de upload. Logs HTTP podem
ser produzidos pelo processo e devem ser tratados como dados locais.

### Limites da promessa

- extensões de navegador, plugins e ferramentas externas podem observar ou
  sincronizar arquivos fora do controle do projeto;
- ao abrir um link HTTP/HTTPS ou escolher uma imagem externa, o navegador pode
  fazer uma requisição própria;
- um processo com acesso à conta do usuário pode ler os arquivos como qualquer
  outro programa local;
- `--allow-network` expõe arquivos do diretório servido e não adiciona
  autenticação.

Para dados sensíveis, use uma conta do sistema com permissões mínimas, mantenha
o servidor em loopback, não abra bundles de terceiros no diretório pessoal e
faça backups/versionamento criptografados conforme a política da organização.
