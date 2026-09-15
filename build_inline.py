from pathlib import Path
import base64, mimetypes
root = Path(__file__).resolve().parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'styles.css').read_text(encoding='utf-8')

def clean_module(text: str) -> str:
    lines = []
    skipping = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith('import '):
            skipping = True
            if stripped.endswith(';'):
                skipping = False
            continue
        if skipping:
            if stripped.endswith(';'):
                skipping = False
            continue
        line = line.replace('export const ', 'const ').replace('export function ', 'function ').replace('export ', '')
        lines.append(line)
    return '\n'.join(lines)

def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode('ascii')

hexjs = clean_module((root / 'hex.js').read_text(encoding='utf-8'))
router = clean_module((root / 'router.js').read_text(encoding='utf-8'))
markdown = clean_module((root / 'markdown.js').read_text(encoding='utf-8'))
frontmatter = clean_module((root / 'frontmatter.js').read_text(encoding='utf-8'))
workspace = clean_module((root / 'workspace.js').read_text(encoding='utf-8'))
data = clean_module((root / 'data.js').read_text(encoding='utf-8'))
for asset in (root / 'assets').rglob('*'):
    if asset.is_file():
        relative = './' + asset.relative_to(root).as_posix()
        data = data.replace(relative, data_uri(asset))
app = clean_module((root / 'app.js').read_text(encoding='utf-8'))
three = (root / 'three-view.inline.js').read_text(encoding='utf-8')
for asset in (root / 'assets').rglob('*'):
    if asset.is_file():
        relative = './' + asset.relative_to(root).as_posix()
        three = three.replace(relative, data_uri(asset))
html = html.replace('<link rel="stylesheet" href="./styles.css" />', f'<style>{css}</style>')
html = html.replace('<script type="module" src="./app.js"></script>', f'<script>\n{hexjs}\n{router}\n{markdown}\n{frontmatter}\n{workspace}\n{data}\n{three}\nconst {{ HexMapThreeView }} = HexMapThree;\n{app}\n</script>')
(root / 'preview-inline.html').write_text(html, encoding='utf-8')
print('built preview-inline.html')
