#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse
import subprocess
import sys

ap = argparse.ArgumentParser(description='Capture deterministic HexaMap Studio V10 states')
ap.add_argument('output')
ap.add_argument('--action', choices=['default','cluster','entity','reading','routing','axes','text','fields'], default='default')
ap.add_argument('--width', type=int, default=1536)
ap.add_argument('--height', type=int, default=1008)
args = ap.parse_args()
root = Path(__file__).resolve().parent
subprocess.run([sys.executable, str(root / 'build_inline.py')], check=True, capture_output=True)
html = (root / 'preview-inline.html').read_text(encoding='utf-8')
browser_candidates = [
    Path('/usr/bin/chromium'),
    Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    Path('/Applications/Chromium.app/Contents/MacOS/Chromium'),
]
browser_executable = next((str(path) for path in browser_candidates if path.exists()), None)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=browser_executable, args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': args.width, 'height': args.height})
    page.set_default_timeout(10000)
    errors = []
    page.on('console', lambda m: errors.append(f'console:{m.type}:{m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror:{e}'))
    page.set_content(html, wait_until='load')
    page.wait_for_timeout(650)

    if args.action == 'cluster':
        page.locator('[data-cluster-label="work"]').click()
    elif args.action in {'entity','reading'}:
        page.locator('[data-entity="autonomy"]').click()
        if args.action == 'reading':
            page.locator('#drawerExpand').click(); page.locator('#drawerExpand').click()
    elif args.action == 'routing':
        page.locator('[data-relation-hit="r1"]').evaluate("e => e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))")
        page.locator('#flipRouting').click()
    elif args.action == 'axes':
        page.locator('#layoutSelect').select_option('axes')
    elif args.action == 'text':
        page.locator('[data-tool="text"]').click()
        page.mouse.click(1120, 850)
        page.locator('#annotationTitle').fill('Hipótese de trabalho')
        page.locator('#annotationTitle').dispatch_event('change')
        page.locator('#annotationMarkdown').fill('## Hipótese\n\nTexto livre em **Markdown** sobre o canvas.')
        page.locator('#annotationMarkdown').dispatch_event('change')
        page.locator('#drawerClose').evaluate('e => e.click()')
    elif args.action == 'fields':
        page.locator('#mapSettingsBtn').click()
        page.locator('[data-drawer-tab="style"]').click()
        page.locator('#colorByField').select_option('status')

    page.wait_for_timeout(350)
    page.mouse.move(20, args.height - 20)
    page.evaluate('document.querySelector("#toast").hidden = true')
    page.screenshot(path=args.output, animations='disabled')
    print({
        'errors': errors,
        'nodes': page.locator('.hex-node').count(),
        'clusters': page.locator('.cluster-contour').count(),
        'relations': page.locator('.relation-path').count(),
        'annotations': page.locator('.canvas-annotation').count(),
        'action': args.action,
    })
    browser.close()
