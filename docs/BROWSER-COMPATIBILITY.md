# Compatibilidade de browsers

O editor usa JavaScript ES modules, SVG, CSS moderno, `localStorage` e APIs de
gesto. A matriz abaixo é o contrato suportado para a série 0.1:

| Navegador | Desktop | Mobile | Observação |
| --- | --- | --- | --- |
| Chromium 120+ | suportado | suportado | smoke automatizado usa Chromium |
| Firefox 121+ | suportado | suportado | validar File System Access antes de depender de pasta |
| Safari 17+ | suportado | suportado | bundle JSON é o fallback para seleção de diretório |

Browsers sem ES modules ou SVG moderno não são suportados. A experiência de
pasta local depende da permissão e disponibilidade de File System Access API;
exportar/importar um `hexmap-workspace` continua sendo o caminho portátil.

A validação automatizada em Chromium cobre 320×720, 375×812, 768×1024 e
1440×900, menu responsivo, ajuda por teclado, foco, drawer inerte quando
fechado e apresentação somente leitura. O viewport de 320 px cobre um estresse
de layout maior que 1440 px a 200%, embora não substitua uma auditoria manual do
controle de zoom de cada navegador.

Firefox e Safari fazem parte da matriz suportada por contrato e usam bundle
JSON quando a API de diretório não existe, mas não rodam no CI atual. Uma
auditoria manual completa com VoiceOver/NVDA também não é alegada como
certificação WCAG; o gate 0.1 cobre semântica, nomes acessíveis, foco e teclado.
