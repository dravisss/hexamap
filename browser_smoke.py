from pathlib import Path
import base64
import json
import subprocess
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent
subprocess.run(['python3', str(root / 'build_inline.py')], check=True)
html = (root / 'preview-inline.html').read_text(encoding='utf-8')
previews = root / 'previews'
audit = previews / 'audit'
previews.mkdir(exist_ok=True)
audit.mkdir(exist_ok=True)

report = {}
browser_candidates = [
    Path('/usr/bin/chromium'),
    Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    Path('/Applications/Chromium.app/Contents/MacOS/Chromium'),
]
browser_executable = next((str(path) for path in browser_candidates if path.exists()), None)
with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        executable_path=browser_executable,
        args=['--no-sandbox', '--disable-dev-shm-usage'],
    )
    page = browser.new_page(viewport={'width': 1536, 'height': 1008}, accept_downloads=True)
    page.set_default_timeout(10000)
    errors = []
    page.on('console', lambda msg: errors.append(f'console:{msg.type}:{msg.text}') if msg.type == 'error' else None)
    page.on('pageerror', lambda exc: errors.append(f'pageerror:{exc}'))
    page.set_content(html, wait_until='load')
    page.wait_for_timeout(850)

    def reset():
        page.locator('#resetBtn').evaluate('e => e.click()')
        page.wait_for_timeout(420)

    def close_drawer():
        if 'open' in (page.locator('#drawer').get_attribute('class') or ''):
            page.locator('#drawerClose').evaluate('e => e.click()')
            page.wait_for_timeout(220)

    def activate_action(target_page, action_id):
        direct = target_page.locator(f'#{action_id}')
        if direct.is_visible():
            direct.click()
            return
        menu = target_page.locator('#mobileActions')
        if menu.is_hidden():
            target_page.locator('#moreBtn').click()
        target_page.locator(f'#mobileActions [data-action="{action_id}"]').click()

    print('STAGE initial', flush=True)
    report['version'] = page.evaluate('HexMapStudio.version')
    report['initial_nodes'] = page.locator('.hex-node').count()
    report['initial_clusters'] = page.locator('.cluster-contour').count()
    report['initial_relations'] = page.locator('.relation-path').count()
    report['initial_annotations'] = page.locator('.canvas-annotation').count()
    report['global_controls_precede_canvas'] = page.evaluate('''() => Boolean(
      document.querySelector('.topbar').compareDocumentPosition(document.querySelector('#workspace'))
      & Node.DOCUMENT_POSITION_FOLLOWING
    )''')
    report['governance_label_above'] = page.evaluate('''() => {
      const label = document.querySelector('[data-cluster-label="gov"]');
      const nodes = [...document.querySelectorAll('.hex-node[data-cluster="gov"]')];
      if (!label || !nodes.length) return false;
      return label.getBoundingClientRect().bottom < Math.min(...nodes.map(node => node.getBoundingClientRect().top));
    }''')
    routing_report = page.evaluate('HexMapStudio.routingReport()')
    report['auto_route_hard_collisions'] = sum(item['hardCollisions'] for item in routing_report)
    report['auto_route_crossings'] = sum(item['crossings'] for item in routing_report)
    page.screenshot(path=str(previews / 'default.png'))
    report['desktop_primary_actions_named'] = page.locator('#projectBtn strong').is_visible() and page.locator('#searchBtn strong').is_visible()
    report['desktop_secondary_actions_collapsed'] = all(page.locator(selector).is_hidden() for selector in ('#fitBtn', '#importBtn', '#exportBtn', '#presentationBtn', '#resetBtn', '#helpBtn'))
    report['desktop_more_actions_visible'] = page.locator('#moreBtn').is_visible()
    page.locator('#moreBtn').focus(); page.locator('#moreBtn').press('Enter'); page.wait_for_timeout(100)
    visible_more_actions = page.locator('#mobileActions button:visible')
    report['desktop_more_actions_are_textual'] = visible_more_actions.count() == 6 and 'Ajustar mapa' in visible_more_actions.first.inner_text() and page.locator('#mobileActions [data-action="searchBtn"]').is_hidden()
    report['desktop_more_keyboard_focus_enters'] = page.evaluate('document.activeElement?.dataset.action === "fitBtn"')
    page.keyboard.press('ArrowDown'); page.wait_for_timeout(40)
    report['desktop_more_arrow_navigation'] = page.evaluate('document.activeElement?.dataset.action === "importBtn"')
    page.screenshot(path=str(audit / 'desktop-action-hierarchy.png'))
    page.keyboard.press('Escape'); page.wait_for_timeout(60)
    report['desktop_more_escape_returns_focus'] = page.locator('#mobileActions').is_hidden() and page.evaluate('document.activeElement?.id === "moreBtn"')

    initial_map = page.evaluate('HexMapStudio.getMap()')
    moved_governance = json.loads(json.dumps(initial_map))
    for item in moved_governance['hexagons']:
        if item.get('clusterId') == 'gov':
            item['r'] += 1
    page.evaluate('(value) => HexMapStudio.setMap(value, {fit: false})', moved_governance)
    page.wait_for_timeout(180)
    report['governance_label_stable_after_small_move'] = page.evaluate('''() => {
      const label = document.querySelector('[data-cluster-label="gov"]');
      const nodes = [...document.querySelectorAll('.hex-node[data-cluster="gov"]')];
      return label && nodes.length && label.getBoundingClientRect().bottom < Math.min(...nodes.map(node => node.getBoundingClientRect().top));
    }''')
    page.evaluate('(value) => HexMapStudio.setMap(value, {fit: false})', initial_map)
    page.wait_for_timeout(180)

    print('STAGE empty-project first action', flush=True)
    empty_map = json.loads(json.dumps(initial_map))
    empty_map['hexagons'] = []
    empty_map['clusters'] = []
    empty_map['relations'] = []
    empty_map['annotations'] = []
    page.evaluate('(value) => HexMapStudio.setMap(value)', empty_map)
    page.wait_for_timeout(160)
    report['empty_project_action_visible'] = page.locator('#canvasEmptyState').is_visible() and page.locator('#emptyAddHex').is_visible()
    page.locator('#emptyAddHex').click(); page.wait_for_timeout(100)
    report['empty_project_cta_waits_for_canvas'] = page.locator('.hex-node').count() == 0 and page.locator('#canvasEmptyState').is_hidden()
    report['empty_project_canvas_receives_focus'] = page.evaluate('document.activeElement?.id === "workspace"')
    page.screenshot(path=str(audit / 'empty-project-armed.png'))
    page.mouse.click(760, 520); page.wait_for_timeout(180)
    report['empty_project_first_hex_created'] = page.locator('.hex-node').count() == 1 and page.locator('#drawer').is_visible()
    page.evaluate('(value) => HexMapStudio.setMap(value)', initial_map)
    page.wait_for_timeout(180)

    print('STAGE desktop project creation and editing integrity', flush=True)
    creation_page = browser.new_page(viewport={'width': 1440, 'height': 900})
    creation_errors = []
    creation_page.on('console', lambda msg: creation_errors.append(f'creation-console:{msg.type}:{msg.text}') if msg.type == 'error' else None)
    creation_page.on('pageerror', lambda exc: creation_errors.append(f'creation-pageerror:{exc}'))
    creation_page.route('https://hexmap-creation.test/**', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
    creation_page.goto('https://hexmap-creation.test/?qa=1', wait_until='load')
    creation_page.evaluate("localStorage.setItem('hexmap-studio-onboarding-v1', 'seen'); localStorage.setItem('hexmap-view-mode', '2d')")
    creation_page.reload(wait_until='load'); creation_page.wait_for_timeout(420)
    original_project = creation_page.evaluate('''() => ({
      title: HexMapStudio.getMap().title,
      hexagons: HexMapStudio.getMap().hexagons.length,
      relations: HexMapStudio.getMap().relations.length,
    })''')

    creation_page.locator('#projectBtn').click(); creation_page.wait_for_timeout(100)
    creation_page.locator('#newProjectBtn').click(); creation_page.wait_for_timeout(120)
    report['desktop_new_project_cancel_named'] = creation_page.locator('#welcomeClose').inner_text() == 'Cancelar'
    report['desktop_new_project_title_starts_blank'] = creation_page.locator('#welcomeProjectTitle').input_value() == ''
    creation_page.screenshot(path=str(audit / 'desktop-project-creation.png'))
    creation_page.locator('#welcomeClose').click(); creation_page.wait_for_timeout(120)
    report['desktop_new_project_cancel_preserves_map'] = creation_page.evaluate('''(before) => {
      const map = HexMapStudio.getMap();
      return map.title === before.title && map.hexagons.length === before.hexagons && map.relations.length === before.relations;
    }''', original_project)

    creation_page.locator('#newProjectBtn').click(); creation_page.wait_for_timeout(90)
    creation_page.locator('[data-start-mode="journey"]').click(); creation_page.wait_for_timeout(300)
    report['desktop_journey_uses_specific_default'] = creation_page.evaluate('''() => {
      const map = HexMapStudio.getMap();
      return map.title === 'Jornada e caminhos' && map.hexagons.length === 6 && map.relations.length === 5;
    }''')
    report['desktop_new_project_resets_tool'] = 'active' in (creation_page.locator('.tool[data-tool="move"]').get_attribute('class') or '')
    report['desktop_new_project_explains_undo'] = 'Desfazer' in creation_page.locator('#toast').inner_text()
    creation_page.keyboard.press('Meta+z'); creation_page.wait_for_timeout(180)
    report['desktop_new_project_is_undoable'] = creation_page.evaluate('''(before) => {
      const map = HexMapStudio.getMap();
      return map.title === before.title && map.hexagons.length === before.hexagons && map.relations.length === before.relations;
    }''', original_project)

    creation_page.locator('#projectBtn').click(); creation_page.wait_for_timeout(80)
    creation_page.locator('#newProjectBtn').click(); creation_page.wait_for_timeout(80)
    creation_page.locator('#welcomeProjectTitle').fill('Estratégia 2027')
    creation_page.locator('[data-start-mode="empty"]').click(); creation_page.wait_for_timeout(180)
    report['desktop_custom_empty_project_named'] = creation_page.evaluate('HexMapStudio.getMap().title') == 'Estratégia 2027'
    report['desktop_empty_hint_visible'] = creation_page.locator('#canvasEmptyState').is_visible()
    creation_page.keyboard.press('h'); creation_page.wait_for_timeout(100)
    report['desktop_empty_keyboard_arms_canvas'] = creation_page.locator('#canvasEmptyState').is_hidden() and creation_page.evaluate('document.activeElement?.id === "workspace"')
    creation_page.keyboard.press('Escape'); creation_page.wait_for_timeout(100)
    report['desktop_empty_escape_disarms_canvas'] = creation_page.locator('#canvasEmptyState').is_visible() and 'active' in (creation_page.locator('.tool[data-tool="move"]').get_attribute('class') or '')
    creation_page.keyboard.press('h'); creation_page.mouse.click(650, 470); creation_page.wait_for_timeout(180)
    created_entity_id = creation_page.evaluate('HexMapStudio.getMap().hexagons[0].id')
    original_entity_title = creation_page.evaluate('(id) => HexMapStudio.getMap().hexagons.find((item) => item.id === id).title', created_entity_id)
    creation_page.locator('#entityTitle').fill('Decisão central')
    creation_page.keyboard.press('Escape'); creation_page.wait_for_timeout(160)
    report['desktop_escape_commits_text_edit'] = creation_page.evaluate('(id) => HexMapStudio.getMap().hexagons.find((item) => item.id === id).title', created_entity_id) == 'Decisão central' and creation_page.locator('#drawer').is_hidden()
    creation_page.keyboard.press('Meta+z'); creation_page.wait_for_timeout(140)
    report['desktop_escape_edit_is_undoable'] = creation_page.evaluate('(id) => HexMapStudio.getMap().hexagons.find((item) => item.id === id).title', created_entity_id) == original_entity_title

    creation_page.evaluate('(id) => HexMapStudio.selectHexagon(id)', created_entity_id); creation_page.wait_for_timeout(90)
    creation_page.locator('[data-drawer-tab="fields"]').click(); creation_page.wait_for_timeout(80)
    report['desktop_field_options_progressive'] = creation_page.locator('#newFieldOptionsGroup').is_hidden()
    creation_page.locator('#newFieldType').select_option('select'); creation_page.wait_for_timeout(60)
    report['desktop_field_options_revealed'] = creation_page.locator('#newFieldOptionsGroup').is_visible()
    creation_page.locator('#newFieldLabel').fill('Etapa')
    creation_page.locator('#newFieldOptions').fill('Planejado, Em andamento, Concluído')
    creation_page.locator('#newFieldOptions').press('Enter'); creation_page.wait_for_timeout(120)
    report['desktop_field_enter_creates'] = creation_page.evaluate('HexMapStudio.getMap().fieldDefinitions.some((field) => field.key === "etapa")')
    creation_page.locator('[data-custom-field="etapa"]').select_option('Em andamento')
    creation_page.locator('[data-custom-field="etapa"]').dispatch_event('change'); creation_page.wait_for_timeout(100)
    creation_page.keyboard.press('Escape'); creation_page.wait_for_timeout(80)
    creation_page.locator('#mapSettingsBtn').click(); creation_page.locator('[data-drawer-tab="fields"]').click(); creation_page.wait_for_timeout(80)
    creation_page.locator('[data-delete-field="etapa"]').click(); creation_page.wait_for_timeout(110)
    field_delete_toast = creation_page.locator('#toast').inner_text()
    report['desktop_field_delete_explains_impact'] = '1 valor preenchido' in field_delete_toast and 'Desfazer' in field_delete_toast
    report['desktop_field_delete_removes_definition_and_value'] = creation_page.evaluate('''(id) => {
      const map = HexMapStudio.getMap();
      return !map.fieldDefinitions.some((field) => field.key === 'etapa') && map.hexagons.find((item) => item.id === id).fields.etapa === undefined;
    }''', created_entity_id)
    creation_page.keyboard.press('Meta+z'); creation_page.wait_for_timeout(140)
    report['desktop_field_delete_is_undoable'] = creation_page.evaluate('''(id) => {
      const map = HexMapStudio.getMap();
      return map.fieldDefinitions.some((field) => field.key === 'etapa') && map.hexagons.find((item) => item.id === id).fields.etapa === 'Em andamento';
    }''', created_entity_id)
    creation_page.keyboard.press('Escape'); creation_page.wait_for_timeout(80)

    creation_page.locator('[data-tool="text"]').click(); creation_page.mouse.click(1010, 650); creation_page.wait_for_timeout(140)
    annotation_id = creation_page.evaluate('HexMapStudio.getMap().annotations[0].id')
    creation_page.locator('[data-drawer-tab="appearance"]').click(); creation_page.wait_for_timeout(70)
    annotation_width_before = creation_page.evaluate('(id) => HexMapStudio.getMap().annotations.find((item) => item.id === id).width', annotation_id)
    creation_page.locator('#annotationWidth').focus(); creation_page.locator('#annotationWidth').press('ArrowRight'); creation_page.wait_for_timeout(80)
    annotation_width_after = creation_page.evaluate('(id) => HexMapStudio.getMap().annotations.find((item) => item.id === id).width', annotation_id)
    report['desktop_annotation_range_has_value'] = creation_page.locator('#annotationWidthValue').inner_text() == f'{int(annotation_width_after)}px'
    report['desktop_annotation_range_retains_focus'] = creation_page.evaluate('document.activeElement?.id === "annotationWidth"')
    creation_page.screenshot(path=str(audit / 'desktop-editing-integrity.png'))
    creation_page.keyboard.press('Escape'); creation_page.wait_for_timeout(80)
    creation_page.keyboard.press('Meta+z'); creation_page.wait_for_timeout(120)
    report['desktop_annotation_range_is_undoable'] = annotation_width_after > annotation_width_before and creation_page.evaluate('(id) => HexMapStudio.getMap().annotations.find((item) => item.id === id).width', annotation_id) == annotation_width_before
    creation_page.locator('#searchBtn').click(); creation_page.locator('#mapSearch').fill('Nova anotação'); creation_page.wait_for_timeout(80)
    report['desktop_search_finds_annotation'] = creation_page.locator(f'[data-search-type="annotation"][data-search-id="{annotation_id}"]').count() == 1
    creation_page.locator(f'[data-search-type="annotation"][data-search-id="{annotation_id}"]').click(); creation_page.wait_for_timeout(90)
    report['desktop_search_annotation_opens_drawer'] = creation_page.locator('.drawer-kicker').inner_text() == 'TEXTO NO CANVAS'
    creation_page.keyboard.press('Escape'); creation_page.wait_for_timeout(70)

    creation_page.evaluate('(id) => HexMapStudio.selectHexagon(id)', created_entity_id); creation_page.wait_for_timeout(80)
    creation_page.locator('[data-drawer-tab="appearance"]').click(); creation_page.wait_for_timeout(70)
    overlay_before = creation_page.evaluate('(id) => HexMapStudio.getMap().hexagons.find((item) => item.id === id).visual.image.overlay', created_entity_id)
    creation_page.locator('#imageOverlay').focus(); creation_page.locator('#imageOverlay').press('ArrowRight'); creation_page.wait_for_timeout(80)
    overlay_after = creation_page.evaluate('(id) => HexMapStudio.getMap().hexagons.find((item) => item.id === id).visual.image.overlay', created_entity_id)
    report['desktop_overlay_range_has_value'] = creation_page.locator('#imageOverlayValue').inner_text() == f'{round(overlay_after * 100)}%'
    report['desktop_overlay_range_retains_focus'] = creation_page.evaluate('document.activeElement?.id === "imageOverlay"')
    creation_page.keyboard.press('Escape'); creation_page.wait_for_timeout(80)
    creation_page.keyboard.press('Meta+z'); creation_page.wait_for_timeout(120)
    report['desktop_overlay_range_is_undoable'] = overlay_after > overlay_before and creation_page.evaluate('(id) => HexMapStudio.getMap().hexagons.find((item) => item.id === id).visual.image.overlay', created_entity_id) == overlay_before
    errors.extend(creation_errors)
    creation_page.close()

    print('STAGE 3d cluster and color editing', flush=True)
    page.locator('#viewModeBtn').click()
    page.wait_for_timeout(520)
    cluster_label = page.locator('.three-cluster-label').first
    cluster_id = cluster_label.get_attribute('data-cluster')
    cluster_label.click()
    page.wait_for_timeout(180)
    report['three_cluster_click_opens_drawer'] = page.locator('#drawer').evaluate('e => e.classList.contains("open")') and page.locator('.drawer-kicker').inner_text().startswith('CLUSTER')
    page.locator('[data-drawer-tab="appearance"]').click()
    page.locator('#clusterColorInput').fill('#245f73')
    page.locator('#clusterColorInput').dispatch_event('change')
    page.wait_for_timeout(180)
    report['three_cluster_color_changed'] = page.evaluate('(id) => HexMapStudio.getMap().clusters.find(c => c.id === id).color', cluster_id) == '#245f73'
    close_drawer()
    cell_label = page.locator('.three-cell-label').first
    cell_id = cell_label.get_attribute('data-cell')
    cell_label.click()
    page.wait_for_timeout(150)
    page.locator('[data-drawer-tab="appearance"]').click()
    page.locator('#entityColor').fill('#b4472d')
    page.locator('#entityColor').dispatch_event('change')
    page.wait_for_timeout(180)
    report['three_hex_color_changed'] = page.evaluate('(id) => HexMapStudio.getMap().hexagons.find(h => h.id === id).visual.color', cell_id) == '#b4472d'
    report['three_hex_inherit_available'] = page.locator('#inheritEntityColor').is_enabled()
    page.screenshot(path=str(audit / '3d-color-editing.png'))
    close_drawer()
    page.locator('#viewModeBtn').click()
    page.wait_for_timeout(260)

    print('STAGE 3d new-map editing', flush=True)
    sparse_map = page.evaluate('HexMapStudio.getMap()')
    sparse_map['hexagons'] = [dict(sparse_map['hexagons'][0], q=0, r=0, clusterId=None, fields={})]
    sparse_map['clusters'] = []
    sparse_map['relations'] = []
    sparse_map['annotations'] = []
    sparse_map['nextEntity'] = 100
    page.evaluate('(value) => HexMapStudio.setMap(value)', sparse_map)
    page.locator('#viewModeBtn').click()
    page.wait_for_timeout(520)
    report['three_sparse_cell_visible'] = page.locator('.three-cell-label').evaluate('e => Boolean(e.style.left && e.style.top)')
    sparse_before_move = page.evaluate('() => { const h = HexMapStudio.getMap().hexagons[0]; return [h.q, h.r]; }')
    sparse_label_box = page.locator('.three-cell-label').bounding_box()
    page.locator('.three-cell-label').evaluate('e => { e.style.pointerEvents = "none"; }')
    page.mouse.move(sparse_label_box['x'] + sparse_label_box['width'] / 2, sparse_label_box['y'] + sparse_label_box['height'] / 2)
    page.mouse.down()
    page.mouse.move(sparse_label_box['x'] + sparse_label_box['width'] / 2 + 150, sparse_label_box['y'] + sparse_label_box['height'] / 2, steps=10)
    page.mouse.up()
    page.wait_for_timeout(320)
    sparse_after_move = page.evaluate('() => { const h = HexMapStudio.getMap().hexagons[0]; return [h.q, h.r]; }')
    report['three_move_commits_on_drop'] = sparse_after_move != sparse_before_move
    report['three_move_has_no_confirmation'] = page.locator('#threeMoveConfirm').count() == 0
    before_three_add = page.evaluate('HexMapStudio.getMap().hexagons.length')
    page.locator('[data-tool="add"]').click()
    canvas_box = page.locator('#threeCanvas').bounding_box()
    page.mouse.click(canvas_box['x'] + canvas_box['width'] * .68, canvas_box['y'] + canvas_box['height'] * .52)
    page.wait_for_timeout(420)
    report['three_add_created'] = page.evaluate('HexMapStudio.getMap().hexagons.length') == before_three_add + 1
    report['three_add_opens_editor'] = page.locator('#entityTitle').is_visible()
    report['three_new_cell_has_label'] = page.locator('.three-cell-label').count() == before_three_add + 1
    page.screenshot(path=str(audit / '3d-new-map-editing.png'))
    page.locator('#viewModeBtn').click()
    page.wait_for_timeout(260)

    print('STAGE 2d cursor-anchored drag', flush=True)
    drag_map = page.evaluate('HexMapStudio.getMap()')
    drag_map['hexagons'] = [dict(drag_map['hexagons'][0], q=0, r=0, clusterId=None)]
    drag_map['clusters'] = []
    drag_map['relations'] = []
    page.evaluate('(value) => HexMapStudio.setMap(value, {fit: false})', drag_map)
    page.wait_for_timeout(220)
    close_drawer()
    node = page.locator('.hex-node').first
    before_box = node.bounding_box()
    start_x = before_box['x'] + before_box['width'] * .60
    start_y = before_box['y'] + before_box['height'] * .5
    end_x = start_x + 190
    end_y = start_y
    initial_offset = (before_box['x'] + before_box['width'] / 2) - start_x
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(end_x, end_y, steps=8)
    page.mouse.up()
    page.wait_for_timeout(260)
    after_box = page.locator('.hex-node').first.bounding_box()
    final_offset = (after_box['x'] + after_box['width'] / 2) - end_x
    report['drag_offset_delta_px'] = round(abs(final_offset - initial_offset), 2)
    report['drag_preserves_grab_offset'] = report['drag_offset_delta_px'] <= 18
    reset()

    print('STAGE free tiling without automatic clusters', flush=True)
    tiling_map = page.evaluate('HexMapStudio.getMap()')
    first = dict(tiling_map['hexagons'][0], id='tile-a', q=0, r=0, clusterId=None)
    tiling_map['hexagons'] = [first]
    tiling_map['clusters'] = []
    tiling_map['relations'] = []
    tiling_map['layout']['mode'] = 'territories'
    tiling_map['layout']['autoCluster'] = False
    page.evaluate('(value) => HexMapStudio.setMap(value, {fit: false})', tiling_map)
    page.wait_for_timeout(220)
    page.locator('#mapSettingsBtn').click()
    page.locator('[data-drawer-tab="layout"]').click()
    report['auto_cluster_toggle_visible'] = page.locator('#autoCluster').is_visible()
    report['auto_cluster_toggle_off'] = not page.locator('#autoCluster').is_checked()
    page.screenshot(path=str(audit / 'tiling-setting.png'))
    close_drawer()
    tile_a = page.locator('[data-entity="tile-a"]').bounding_box()
    page.locator('[data-tool="add"]').click()
    page.mouse.click(tile_a['x'] + tile_a['width'] * 1.42, tile_a['y'] + tile_a['height'] / 2)
    page.wait_for_timeout(260)
    report['tiling_stays_clusterless'] = page.evaluate('''() => {
      const map = HexMapStudio.getMap(); const [a, b] = map.hexagons;
      const distance = Math.max(Math.abs(a.q-b.q), Math.abs(a.r-b.r), Math.abs((-a.q-a.r)-(-b.q-b.r)));
      return distance === 1 && map.clusters.length === 0 && map.hexagons.every(h => !h.clusterId);
    }''')
    page.mouse.move(0, 0); page.wait_for_timeout(80)
    page.screenshot(path=str(audit / 'tiling-without-clusters.png'))
    reset()

    print('STAGE markdown', flush=True)
    # Tooltip and deep Markdown drawer.
    autonomy = page.locator('[data-entity="autonomy"]')
    autonomy.hover(); page.wait_for_timeout(120)
    report['tooltip_visible'] = page.locator('#tooltip').is_visible()
    autonomy.click(); page.wait_for_timeout(220)
    report['entity_drawer'] = 'open' in (page.locator('#drawer').get_attribute('class') or '')
    report['drawer_defaults_to_reading'] = page.locator('[data-start-edit]').is_visible()
    page.locator('[data-start-edit]').click()
    source = page.locator('#entityMarkdown')
    source.fill('## Autonomia local\n\nTexto **Markdown** colado durante o teste.\n\n- decisão\n- responsabilidade')
    source.dispatch_event('change')
    page.wait_for_timeout(150)
    report['markdown_preview'] = 'Autonomia local' in page.locator('.markdown-preview').inner_text()
    page.locator('#drawerExpand').click(); page.wait_for_timeout(260)
    report['focus_reading'] = 'focus' in (page.locator('#drawer').get_attribute('class') or '')
    page.screenshot(path=str(previews / 'reading-focus.png'))
    close_drawer()

    print('STAGE fields', flush=True)
    # Custom field, tags, and style-by-field.
    page.evaluate('HexMapStudio.selectHexagon("autonomy")')
    page.locator('[data-drawer-tab="fields"]').click()
    page.locator('#entityTags').fill('trabalho, poder, decisão')
    page.locator('#entityTags').dispatch_event('change')
    page.locator('#newFieldLabel').fill('Prioridade')
    page.locator('#newFieldType').select_option('select')
    page.locator('#newFieldOptions').fill('baixa, média, alta')
    page.locator('#createFieldDefinition').click(); page.wait_for_timeout(180)
    page.locator('[data-custom-field="prioridade"]').select_option('alta')
    page.locator('[data-custom-field="prioridade"]').dispatch_event('change')
    report['custom_field_created'] = page.evaluate('HexMapStudio.getMap().fieldDefinitions.some(f => f.key === "prioridade")')
    report['custom_field_value'] = page.evaluate('HexMapStudio.getMap().hexagons.find(h => h.id === "autonomy").fields.prioridade')
    report['tags_updated'] = page.evaluate('HexMapStudio.getMap().hexagons.find(h => h.id === "autonomy").tags.includes("decisão")')
    close_drawer()

    page.locator('#mapSettingsBtn').click(); page.locator('[data-drawer-tab="style"]').click()
    page.locator('#colorByField').select_option('status'); page.wait_for_timeout(220)
    report['field_color_rule'] = page.evaluate('HexMapStudio.getMap().styleRules.colorByField')
    report['style_color_inputs'] = page.locator('[data-style-color]').count()
    if report['style_color_inputs']:
        color_input = page.locator('[data-style-color]').first
        color_input.evaluate("e => { e.value = '#d54f4f'; e.dispatchEvent(new Event('change',{bubbles:true})); }")
    page.screenshot(path=str(previews / 'fields-and-style.png'))
    close_drawer()

    print('STAGE image', flush=True)
    # Optional image/icon upload.
    page.evaluate('HexMapStudio.selectHexagon("roles")')
    page.locator('[data-drawer-tab="appearance"]').click()
    page.locator('#visualMode').select_option('icon')
    page.locator('#uploadImage').click()
    page.locator('#imageInput').set_input_files(str(root / 'assets' / 'icons' / 'autonomy.svg'))
    page.wait_for_timeout(300)
    report['image_uploaded'] = page.evaluate('HexMapStudio.getMap().hexagons.find(h => h.id === "roles").visual.image.src.startsWith("data:image")')
    report['image_mode'] = page.evaluate('HexMapStudio.getMap().hexagons.find(h => h.id === "roles").visual.mode')
    close_drawer()
    page.evaluate('document.querySelector("#toast").hidden = true')

    print('STAGE routing', flush=True)
    # Automatic relation routing and manual override.
    page.locator('[data-relation-hit="r1"]').evaluate("e => e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))")
    page.wait_for_timeout(220)
    report['relation_drawer'] = page.locator('#routingBend').count() == 1
    report['routing_handle'] = page.locator('[data-relation-handle="r1"]').count() == 1
    routing_bend_before = float(page.locator('#routingBend').input_value())
    page.locator('#routingBend').focus(); page.locator('#routingBend').press('ArrowRight'); page.wait_for_timeout(80)
    routing_bend_after = page.evaluate('HexMapStudio.getMap().relations.find((item) => item.id === "r1").routing.offset.perpendicular')
    report['desktop_routing_range_keyboard_updates'] = routing_bend_after > routing_bend_before and page.locator('#routingMode').input_value() == 'assisted'
    report['desktop_routing_range_retains_focus'] = page.evaluate('document.activeElement?.id === "routingBend"')
    page.locator('#resetRouting').click(); page.wait_for_timeout(120)
    path_before = page.locator('[data-relation="r1"] .relation-path').get_attribute('d')
    page.locator('#flipRouting').click(); page.wait_for_timeout(200)
    path_after = page.locator('[data-relation="r1"] .relation-path').get_attribute('d')
    report['manual_curve_flip'] = path_before != path_after
    report['routing_mode_after_flip'] = page.evaluate('HexMapStudio.getMap().relations.find(r => r.id === "r1").routing.mode')
    page.screenshot(path=str(previews / 'relation-routing.png'))
    page.locator('#resetRouting').click(); page.wait_for_timeout(160)
    report['routing_reset_auto'] = page.evaluate('HexMapStudio.getMap().relations.find(r => r.id === "r1").routing.mode')
    close_drawer()

    print('STAGE cluster drag', flush=True)
    # Move whole cluster.
    reset()
    before_positions = page.evaluate('HexMapStudio.getMap().hexagons.filter(h => h.clusterId === "res").map(h => [h.id,h.q,h.r])')
    label = page.locator('[data-cluster-label="res"]')
    box = label.bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.mouse.down(); page.mouse.move(box['x'] + box['width'] / 2 + 72, box['y'] + box['height'] / 2 - 24, steps=8); page.mouse.up()
    page.wait_for_timeout(360)
    after_positions = page.evaluate('HexMapStudio.getMap().hexagons.filter(h => h.clusterId === "res").map(h => [h.id,h.q,h.r])')
    report['cluster_drag_changed'] = before_positions != after_positions
    report['cluster_drag_member_count'] = len(after_positions)

    print('STAGE annotation', flush=True)
    # Add free Markdown text on canvas.
    page.locator('[data-tool="text"]').click()
    blank = page.evaluate("""() => {
      const blocked = (el) => el && (el.closest('.topbar,.statusbar,.drawer,.hex-node,.cluster-label,.cluster-hit,.relation-hit,.canvas-annotation') || !el.closest('#workspace'));
      for (let y = 880; y >= 180; y -= 55) {
        for (let x = 1180; x >= 240; x -= 65) {
          const el = document.elementFromPoint(x, y);
          if (!blocked(el)) return {x, y};
        }
      }
      return {x: 760, y: 880};
    }""")
    page.mouse.click(blank['x'], blank['y']); page.wait_for_timeout(260)
    report['annotation_created'] = page.locator('.canvas-annotation').count() == 1
    page.locator('#annotationTitle').fill('Hipótese de trabalho'); page.locator('#annotationTitle').dispatch_event('change')
    page.locator('[data-markdown-mode="edit"]').click()
    page.locator('#annotationMarkdown').fill('## Hipótese\n\nA coordenação depende de **feedback** e capacidade local.')
    page.locator('#annotationMarkdown').dispatch_event('change')
    page.wait_for_timeout(160)
    page.screenshot(path=str(previews / 'canvas-text.png'))
    close_drawer()
    reset()

    print('STAGE axes', flush=True)
    # Axes template and semantic positions.
    page.locator('#layoutSelect').select_option('axes'); page.wait_for_timeout(480)
    report['axes_layout'] = page.locator('#layoutSelect').input_value()
    report['axis_main'] = page.locator('.axis-main').count()
    report['axes_cluster_keys'] = page.locator('.axis-key').count()
    report['axes_hulls_hidden'] = page.locator('.cluster-contour').count()
    close_drawer()
    page.evaluate('document.querySelector("#toast").hidden = true')
    page.screenshot(path=str(previews / 'axes.png'))

    print('STAGE connect', flush=True)
    # Switch back and create a relation using the simple tool.
    page.locator('#layoutSelect').select_option('territories'); page.wait_for_timeout(420)
    close_drawer()
    page.locator('[data-tool="connect"]').evaluate('e => e.click()')
    page.locator('[data-cluster-label="work"]').evaluate('e => e.click()')
    page.locator('[data-cluster-label="tech"]').evaluate('e => e.click()')
    page.wait_for_timeout(240)
    report['new_relation_count'] = page.locator('.relation-path').count()
    close_drawer()

    print('STAGE mosaic path', flush=True)
    page.locator('#layoutSelect').select_option('mosaic'); page.wait_for_timeout(260)
    report['mosaic_layout'] = page.locator('#layoutSelect').input_value()
    report['mosaic_hulls_hidden'] = page.evaluate('HexMapStudio.getMap().layout.showClusterHulls === false')
    nodes = page.locator('.hex-node')
    page.locator('[data-tool="connect"]').click()
    nodes.nth(0).click(); nodes.nth(1).click(); page.wait_for_timeout(180)
    report['hex_relation_count'] = page.evaluate('HexMapStudio.getMap().relations.filter(r => r.sourceType === "hexagon" && r.targetType === "hexagon").length')
    close_drawer()
    page.screenshot(path=str(audit / 'mosaic-path.png'))

    print('STAGE group', flush=True)
    # Group by a field through settings; reset afterwards.
    page.locator('#mapSettingsBtn').evaluate('e => e.click()'); page.wait_for_timeout(120)
    page.locator('[data-drawer-tab="style"]').evaluate('e => e.click()'); page.wait_for_timeout(120)
    page.locator('#groupByField').select_option('status')
    page.locator('#applyGroupByField').evaluate('e => e.click()'); page.wait_for_timeout(380)
    report['clusters_grouped_by_field'] = page.locator('.cluster-label').count()
    reset()

    print('STAGE export', flush=True)
    # Export the exact model, including positions and layout.
    with page.expect_download() as download_info:
        activate_action(page, 'exportBtn')
    download = download_info.value
    exported = json.loads(Path(download.path()).read_text(encoding='utf-8'))
    report['export_schema_version'] = exported.get('schemaVersion')
    report['export_has_positions'] = all('q' in item and 'r' in item for item in exported['hexagons'])
    report['export_has_routing'] = all('routing' in item for item in exported['relations'])
    report['export_has_fields'] = 'fieldDefinitions' in exported and 'styleRules' in exported
    report['export_has_visuals'] = all('visual' in item for item in exported['hexagons'])
    report['export_has_viewport'] = 'viewport' in exported['layout']

    print('STAGE publish', flush=True)
    publication_icon = 'data:image/svg+xml;base64,' + base64.b64encode((root / 'assets' / 'icons' / 'autonomy.svg').read_bytes()).decode('ascii')
    page.evaluate('''(icon) => {
      const map = HexMapStudio.getMap();
      map.hexagons[0].visual = { mode: 'icon', color: null, image: { src: icon, fit: 'contain', position: '50% 50%', overlay: .38 } };
      map.annotations = [{ id: 'publication-note', type: 'text', title: 'Hipótese publicada', bodyMarkdown: '## Evidência\\n\\nA publicação preserva esta anotação.', x: 1420, y: 970, width: 330, style: { variant: 'note', fontSize: 18, align: 'left' } }];
      map.nextAnnotation = 2;
      HexMapStudio.setMap(map, { fit: false });
    }''', publication_icon)
    page.wait_for_timeout(180)
    page.locator('#mapSettingsBtn').click(); page.locator('[data-drawer-tab="publish"]').click(); page.wait_for_timeout(120)
    with page.expect_download() as html_download_info:
        page.locator('#exportHtmlFromPublish').click()
    html_text = Path(html_download_info.value.path()).read_text(encoding='utf-8')
    report['published_html_standalone'] = '<svg' in html_text and 'HexaMap Studio' in html_text and '<script' not in html_text
    with page.expect_download() as svg_download_info:
        page.locator('#exportSvgFromPublish').click()
    svg_text = Path(svg_download_info.value.path()).read_text(encoding='utf-8')
    report['published_svg_standalone'] = svg_text.startswith('<svg') and '<title' in svg_text and '<polygon' in svg_text
    report['published_svg_preserves_image'] = publication_icon in svg_text and 'data-published-entity' in svg_text
    report['published_svg_preserves_annotation'] = 'data-published-annotation="publication-note"' in svg_text and 'Hipótese publicada' in svg_text and 'preserva' in svg_text and 'anotação' in svg_text
    publication_page = browser.new_page(viewport={'width': 1280, 'height': 900})
    publication_page.set_content(html_text, wait_until='load'); publication_page.wait_for_timeout(180)
    report['published_html_renders_fidelity'] = publication_page.locator('[data-published-entity] image').evaluate_all("els => els.some((element) => element.getAttribute('href')?.startsWith('data:image'))") and publication_page.locator('[data-published-annotation="publication-note"]').count() == 1 and 'Hipótese publicada' in (publication_page.locator('[data-published-annotation="publication-note"]').text_content() or '')
    publication_page.screenshot(path=str(audit / 'publication-fidelity.png'), full_page=True)
    publication_page.close()

    # Re-import a complete exported JSON through the actual file input.
    import_fixture = previews / 'import-smoke.json'
    imported_payload = json.loads(json.dumps(exported))
    imported_payload['title'] = 'Mapa reimportado'
    imported_payload['layout']['viewport'] = {'x': 321, 'y': 222, 'zoom': 0.73}
    import_fixture.write_text(json.dumps(imported_payload, ensure_ascii=False), encoding='utf-8')
    page.locator('#importInput').set_input_files(str(import_fixture))
    page.wait_for_timeout(420)
    report['import_roundtrip'] = page.evaluate('HexMapStudio.getMap().title') == 'Mapa reimportado'
    report['import_preserves_viewport'] = page.evaluate('''() => {
      const viewport = HexMapStudio.getMap().layout.viewport;
      return viewport.x === 321 && viewport.y === 222 && viewport.zoom === .73;
    }''')
    import_fixture.unlink(missing_ok=True)

    print('STAGE local-first workspace', flush=True)
    page.set_viewport_size({'width': 1440, 'height': 900}); page.wait_for_timeout(120)
    close_drawer()
    page.locator('#projectBtn').click(); page.wait_for_timeout(120)
    report['workspace_panel'] = page.locator('#importWorkspaceBundle').count() == 1
    report['project_disclosure_semantics'] = page.locator('#projectBtn').get_attribute('aria-expanded') == 'true' and page.locator('#projectBtn').get_attribute('aria-controls') == 'drawer' and page.locator('#drawer').get_attribute('aria-label') == 'Projeto local-first'
    close_drawer()
    page.locator('#searchBtn').click()
    page.locator('#mapSearch').fill('autonomia'); page.wait_for_timeout(100)
    report['search_result_count'] = page.locator('[data-search-entity]').count()
    report['search_dims_nonmatches'] = page.locator('.hex-node.search-hidden').count() > 0
    page.locator('#mapSearch').press('ArrowDown'); page.wait_for_timeout(40)
    report['desktop_search_keyboard_enters_results'] = page.evaluate('document.activeElement?.dataset.searchEntity === "autonomy"')
    page.keyboard.press('Enter'); page.wait_for_timeout(100)
    report['desktop_search_selection_closes_disclosure'] = page.locator('#searchPanel').is_hidden() and page.locator('#searchBtn').get_attribute('aria-expanded') == 'false' and page.locator('.drawer-kicker').inner_text().startswith('HEXÁGONO')
    close_drawer(); page.locator('#searchBtn').click()
    page.locator('#mapSearch').fill('vigilancia'); page.wait_for_timeout(100)
    report['search_ignores_diacritics'] = page.locator('[data-search-entity="surveillance"]').count() == 1
    page.locator('#mapSearch').fill('Tecnologia'); page.wait_for_timeout(100)
    report['desktop_search_finds_cluster'] = page.locator('[data-search-type="cluster"][data-search-id="tech"]').count() == 1
    page.locator('[data-search-type="cluster"][data-search-id="tech"]').click(); page.wait_for_timeout(100)
    report['desktop_search_cluster_opens_drawer'] = page.locator('.drawer-kicker').inner_text().startswith('CLUSTER')
    close_drawer(); page.locator('#searchBtn').click(); page.locator('#mapSearch').fill('articula'); page.wait_for_timeout(100)
    report['desktop_search_finds_relation'] = page.locator('[data-search-type="relation"]').count() >= 1
    page.screenshot(path=str(audit / 'desktop-search-all-content.png'))
    page.locator('[data-search-type="relation"]').first.click(); page.wait_for_timeout(100)
    report['desktop_search_relation_opens_drawer'] = page.locator('.drawer-kicker').inner_text() == 'RELAÇÃO' and page.locator('#searchBtn').get_attribute('aria-expanded') == 'false'
    close_drawer(); page.locator('#searchBtn').click(); page.locator('#mapSearch').fill('resultado-que-nao-existe-hexmap'); page.wait_for_timeout(80)
    report['desktop_search_no_results_guidance'] = page.locator('.search-empty').is_visible() and 'Nenhum item encontrado' in page.locator('.search-empty').inner_text()
    page.locator('#closeSearch').click()

    bundle_fixture = root / 'examples' / 'workspace-bundle.json'
    page.locator('#workspaceBundleInput').set_input_files(str(bundle_fixture)); page.wait_for_timeout(300)
    report['workspace_bundle_nodes'] = page.locator('.hex-node').count()
    report['workspace_bundle_title'] = page.locator('#mapTitle').inner_text()
    report['workspace_bundle_connected'] = page.evaluate('HexMapStudio.workspace().connected')
    with page.expect_download() as workspace_download_info:
        page.locator('#exportWorkspaceBundle').click()
    page.wait_for_timeout(100)
    workspace_export = json.loads(Path(workspace_download_info.value.path()).read_text(encoding='utf-8'))
    report['workspace_export_format'] = workspace_export.get('format')
    report['workspace_export_markdown'] = any(path.endswith('.md') for path in workspace_export.get('files', {}))
    report['workspace_panel_status_after_initial_export'] = page.locator('.workspace-state small').inner_text()
    report['workspace_bundle_export_marks_clean'] = 'Tudo em dia' in report['workspace_panel_status_after_initial_export']

    page.locator('#newWorkspaceView').click(); page.wait_for_timeout(140)
    new_view_id = page.evaluate('HexMapStudio.getMap().activeViewId')
    close_drawer()
    page.locator('#layoutSelect').select_option('mosaic'); page.wait_for_timeout(220)
    page.evaluate('HexMapStudio.selectHexagon("autonomia")'); page.wait_for_timeout(100)
    page.locator('[data-start-edit]').click()
    page.locator('#entityTitle').fill('Autonomia revisada entre leituras'); page.locator('#entityTitle').dispatch_event('change'); page.wait_for_timeout(100)
    page.locator('#entityMarkdown').fill('# Autonomia revisada\n\nConteúdo preservado ao trocar de leitura.'); page.locator('#entityMarkdown').dispatch_event('change'); page.wait_for_timeout(100)
    close_drawer()
    page.locator('#projectBtn').click(); page.wait_for_timeout(80)
    report['workspace_bundle_dirty_announced'] = 'mudanças' in page.locator('.workspace-state small').inner_text().lower()
    close_drawer()

    blocked_import_fixture = previews / 'import-while-workspace-dirty.json'
    blocked_payload = json.loads(json.dumps(exported)); blocked_payload['title'] = 'Não deve substituir o workspace'
    blocked_import_fixture.write_text(json.dumps(blocked_payload, ensure_ascii=False), encoding='utf-8')
    page.locator('#importInput').set_input_files(str(blocked_import_fixture)); page.wait_for_timeout(220)
    report['dirty_workspace_blocks_json_import'] = page.evaluate('HexMapStudio.workspace().connected && HexMapStudio.getMap().hexagons.some((item) => item.title === "Autonomia revisada entre leituras")') and 'Exporte o bundle' in page.locator('#toast').inner_text()
    page.locator('#resetBtn').evaluate('e => e.click()'); page.wait_for_timeout(120)
    report['dirty_workspace_blocks_reset'] = page.evaluate('HexMapStudio.workspace().connected && HexMapStudio.getMap().activeViewId') == new_view_id
    page.locator('#projectBtn').click(); page.wait_for_timeout(80)
    page.locator('#newProjectBtn').click(); page.wait_for_timeout(100)
    report['dirty_workspace_blocks_new_project'] = page.locator('#welcomeOverlay').is_hidden() and page.evaluate('HexMapStudio.workspace().connected && HexMapStudio.getMap().activeViewId') == new_view_id and 'Exporte o bundle' in page.locator('#toast').inner_text()

    page.locator('#detachWorkspace').click(); page.wait_for_timeout(100)
    report['dirty_workspace_blocks_detach'] = page.evaluate('HexMapStudio.workspace().connected') and 'Exporte o bundle' in page.locator('#toast').inner_text()
    page.locator('#workspaceViewSelect').select_option('default'); page.wait_for_timeout(220)
    report['workspace_content_survives_view_switch'] = page.evaluate('''() => {
      const entity = HexMapStudio.getMap().hexagons.find((item) => item.id === 'autonomia');
      return entity?.title === 'Autonomia revisada entre leituras' && entity.bodyMarkdown.includes('Conteúdo preservado');
    }''')
    report['workspace_default_view_preserved'] = page.evaluate('HexMapStudio.getMap().layout.mode') == 'territories'
    page.locator('#workspaceViewSelect').select_option(new_view_id); page.wait_for_timeout(220)
    report['workspace_new_view_preserved'] = page.evaluate('HexMapStudio.getMap().layout.mode') == 'mosaic'
    report['workspace_dirty_survives_view_switch'] = 'mudanças' in page.locator('.workspace-state small').inner_text().lower()

    with page.expect_download() as updated_workspace_download_info:
        page.locator('#exportWorkspaceBundle').click()
    page.wait_for_timeout(100)
    updated_workspace_path = Path(updated_workspace_download_info.value.path())
    updated_workspace = json.loads(updated_workspace_path.read_text(encoding='utf-8'))
    report['workspace_multiview_export_complete'] = '.hexmap/map.json' in updated_workspace['files'] and f'.hexmap/views/{new_view_id}.json' in updated_workspace['files'] and 'Autonomia revisada entre leituras' in updated_workspace['files']['notas/autonomia.md'] and 'Conteúdo preservado' in updated_workspace['files']['notas/autonomia.md']
    report['workspace_updated_export_marks_clean'] = 'Tudo em dia' in page.locator('.workspace-state small').inner_text()

    workspace_roundtrip_page = browser.new_page(viewport={'width': 1180, 'height': 780})
    workspace_roundtrip_errors = []
    workspace_roundtrip_page.on('console', lambda msg: workspace_roundtrip_errors.append(f'workspace-roundtrip-console:{msg.type}:{msg.text}') if msg.type == 'error' else None)
    workspace_roundtrip_page.on('pageerror', lambda exc: workspace_roundtrip_errors.append(f'workspace-roundtrip-pageerror:{exc}'))
    workspace_roundtrip_page.route('https://hexmap-workspace-roundtrip.test/**', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
    workspace_roundtrip_page.goto('https://hexmap-workspace-roundtrip.test/?qa=1', wait_until='load')
    workspace_roundtrip_page.evaluate("localStorage.setItem('hexmap-studio-onboarding-v1', 'seen'); localStorage.setItem('hexmap-view-mode', '2d')")
    workspace_roundtrip_page.reload(wait_until='load'); workspace_roundtrip_page.wait_for_timeout(260)
    workspace_roundtrip_page.locator('#workspaceBundleInput').set_input_files(str(updated_workspace_path)); workspace_roundtrip_page.wait_for_timeout(320)
    report['workspace_multiview_reimport_active'] = workspace_roundtrip_page.evaluate('(expected) => HexMapStudio.getMap().activeViewId === expected && HexMapStudio.getMap().layout.mode === "mosaic"', new_view_id)
    report['workspace_multiview_reimport_content'] = workspace_roundtrip_page.evaluate('''() => {
      const entity = HexMapStudio.getMap().hexagons.find((item) => item.id === 'autonomia');
      return entity?.title === 'Autonomia revisada entre leituras' && entity.bodyMarkdown.includes('Conteúdo preservado');
    }''')
    report['workspace_view_title_preserved'] = workspace_roundtrip_page.locator('#workspaceViewSelect').input_value() == new_view_id and workspace_roundtrip_page.locator('#workspaceViewSelect option:checked').inner_text() == 'Leitura 2'
    report['workspace_project_title_preserved'] = workspace_roundtrip_page.locator('#drawerContent h2').inner_text() == 'Exemplo Local-first'
    report['workspace_reimport_status_clean'] = 'Tudo em dia' in workspace_roundtrip_page.locator('.workspace-state small').inner_text()
    workspace_label_box = workspace_roundtrip_page.locator('.workspace-view-row .sr-only').bounding_box()
    report['workspace_view_label_visually_hidden'] = bool(workspace_label_box and workspace_label_box['width'] <= 1 and workspace_label_box['height'] <= 1)
    workspace_roundtrip_page.screenshot(path=str(audit / 'workspace-multiview-roundtrip.png'))
    errors.extend(workspace_roundtrip_errors)
    workspace_roundtrip_page.close()
    blocked_import_fixture.unlink(missing_ok=True)

    print('STAGE responsive and accessibility', flush=True)
    # Responsive chrome, keyboard discovery and presentation mode. The 320 px
    # viewport is also stricter than a 1440 px browser zoomed to 200%.
    close_drawer()
    page.locator('#resetBtn').evaluate('e => e.click()')
    page.wait_for_timeout(320)
    report['clean_reset_disconnects_workspace'] = not page.evaluate('HexMapStudio.workspace().connected') and page.locator('#mapTitle').inner_text() == 'Sistema organizacional'
    page.evaluate('document.querySelector("#toast").hidden = true')
    print('STAGE onboarding modal', flush=True)
    page.set_viewport_size({'width': 1280, 'height': 720})
    page.locator('#projectBtn').click(); page.locator('#newProjectBtn').click(); page.wait_for_timeout(120)
    report['onboarding_modal_inert'] = page.locator('#welcomeOverlay').is_visible() and page.locator('#workspace').get_attribute('inert') is not None
    report['onboarding_focus_inside'] = page.evaluate('document.querySelector("#welcomeOverlay").contains(document.activeElement)')
    report['onboarding_footer_visible_when_scrolls'] = page.evaluate('''() => {
      const card = document.querySelector('.welcome-card');
      const foot = document.querySelector('.welcome-foot');
      const rect = foot.getBoundingClientRect();
      return card.scrollHeight > card.clientHeight && rect.top >= 0 && rect.bottom <= innerHeight;
    }''')
    page.screenshot(path=str(audit / 'onboarding.png'))
    page.keyboard.press('Escape'); page.wait_for_timeout(80)
    report['onboarding_modal_closed'] = page.locator('#welcomeOverlay').is_hidden() and page.locator('#workspace').get_attribute('inert') is None
    close_drawer()
    responsive = {}
    for width, height in ((320, 720), (375, 812), (601, 700), (640, 700), (680, 700), (700, 700), (768, 1024), (844, 390), (1440, 900)):
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_timeout(220)
        page.locator('#fitBtn').evaluate('e => e.click()')
        page.wait_for_timeout(220)
        topbar = page.locator('.topbar').bounding_box()
        inside = bool(topbar and topbar['x'] >= -0.5 and topbar['x'] + topbar['width'] <= width + 0.5)
        chrome_clear = page.evaluate('''() => {
          const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const groups = [...document.querySelector('.topbar').children].filter(visible);
          const controls = [...document.querySelectorAll('.topbar button, .topbar select')].filter(visible);
          const rects = [...groups, ...controls].map((element) => ({ element, rect: element.getBoundingClientRect() }));
          const insideViewport = rects.every(({ rect }) => rect.left >= -0.5 && rect.right <= innerWidth + 0.5 && rect.top >= -0.5 && rect.bottom <= innerHeight + 0.5);
          const groupRects = groups.map(element => element.getBoundingClientRect());
          const groupsDoNotOverlap = groupRects.every((a, index) => groupRects.slice(index + 1).every((b) => {
            const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            return overlapWidth <= .5 || overlapHeight <= .5;
          }));
          return insideViewport && groupsDoNotOverlap;
        }''')
        focal_territory_inside = page.evaluate('''() => {
          if (document.documentElement.dataset.fitMode !== 'focal') return true;
          const first = HexMapStudio.getMap().hexagons[0];
          const elements = [
            document.querySelector(`[data-cluster-label="${first.clusterId}"]`),
            ...document.querySelectorAll(`.hex-node[data-cluster="${first.clusterId}"]`),
          ].filter(Boolean);
          const chromeBottom = Math.max(
            document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0,
            document.querySelector('#toolHint')?.getBoundingClientRect().bottom || 0
          );
          return elements.length > 1 && elements.every((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= chromeBottom - 1 && rect.bottom <= innerHeight - 40;
          });
        }''')
        responsive[f'{width}x{height}'] = {
            'topbar_inside_viewport': inside,
            'chrome_clear': chrome_clear,
            'fit_mode': page.locator('html').get_attribute('data-fit-mode'),
            'focal_territory_inside': focal_territory_inside,
            'project_visible': page.locator('#projectBtn').is_visible(),
            'search_visible': page.locator('#searchBtn').is_visible(),
        }
        page.screenshot(path=str(audit / f'viewport-{width}x{height}.png'))
    report['responsive_viewports'] = responsive
    report['responsive_all_inside'] = all(item['topbar_inside_viewport'] and item['chrome_clear'] and item['focal_territory_inside'] for item in responsive.values())
    report['responsive_compact_boundary'] = all(responsive[key]['fit_mode'] == 'focal' for key in ('601x700', '640x700', '680x700')) and responsive['700x700']['fit_mode'] == 'overview'
    report['responsive_short_landscape_focal'] = responsive['844x390']['fit_mode'] == 'focal' and responsive['844x390']['focal_territory_inside']
    report['zoom_200_layout_equivalent'] = responsive['320x720']['topbar_inside_viewport'] and responsive['320x720']['chrome_clear']

    page.set_viewport_size({'width': 320, 'height': 568})
    page.locator('#fitBtn').evaluate('e => e.click()'); page.wait_for_timeout(180)
    page.locator('#helpBtn').evaluate('e => e.click()'); page.wait_for_timeout(80)
    help_rect = page.locator('#helpPopover').bounding_box()
    report['help_short_mobile_inside'] = bool(help_rect and help_rect['x'] >= 0 and help_rect['y'] >= 0 and help_rect['x'] + help_rect['width'] <= 320 and help_rect['y'] + help_rect['height'] <= 568)
    report['help_short_mobile_scrollable'] = page.locator('#helpPopover').evaluate("e => getComputedStyle(e).overflowY === 'auto' && e.scrollHeight >= e.clientHeight")
    report['help_disclosure_semantics'] = page.locator('#helpBtn').get_attribute('aria-expanded') == 'true' and page.locator('#helpBtn').get_attribute('aria-controls') == 'helpPopover'
    page.screenshot(path=str(audit / 'help-mobile-short-320x568.png'))
    page.locator('#closeHelp').click(); page.wait_for_timeout(80)

    print('STAGE focus, escape and preserved context', flush=True)
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.locator('#resetBtn').evaluate('e => e.click()')
    page.wait_for_timeout(320)
    governance_box = page.locator('[data-cluster-label="gov"]').bounding_box()
    governance_nodes = page.locator('.hex-node[data-cluster="gov"]')
    governance_top = min(governance_nodes.nth(index).bounding_box()['y'] for index in range(governance_nodes.count()))
    report['governance_label_top_at_1440'] = governance_box['y'] + governance_box['height'] < governance_top

    autonomy = page.locator('[data-entity="autonomy"]')
    autonomy.focus(); page.keyboard.press('Enter'); page.wait_for_timeout(120)
    report['drawer_keyboard_focus_enters'] = page.evaluate('document.activeElement?.id === "drawerClose"')
    report['drawer_context_label'] = page.evaluate("document.querySelector('#drawer').getAttribute('aria-label') === `Detalhes do hexágono ${HexMapStudio.getMap().hexagons.find(item => item.id === 'autonomy').title}`")
    report['drawer_live_region_scoped'] = page.locator('#drawer').get_attribute('aria-live') is None and page.locator('#connectText').get_attribute('role') == 'status'
    page.locator('[data-drawer-tab="content"]').focus(); page.keyboard.press('ArrowRight'); page.wait_for_timeout(80)
    report['drawer_tabs_arrow_navigation'] = page.evaluate('document.activeElement?.dataset?.drawerTab === "fields" && document.activeElement?.getAttribute("aria-selected") === "true"')
    page.keyboard.press('Home'); page.wait_for_timeout(80)
    page.keyboard.press('Escape'); page.wait_for_timeout(120)
    report['drawer_keyboard_focus_returns'] = page.evaluate('document.activeElement?.dataset?.entity === "autonomy"')
    report['tool_hint_retires_after_use'] = page.locator('#toolHint').evaluate('e => e.classList.contains("quiet")')

    page.locator('#searchBtn').focus(); page.keyboard.press('Enter'); page.wait_for_timeout(80)
    report['search_focus_enters'] = page.evaluate('document.activeElement?.id === "mapSearch"')
    report['search_disclosure_semantics'] = page.locator('#searchBtn').get_attribute('aria-expanded') == 'true' and page.locator('#searchBtn').get_attribute('aria-controls') == 'searchPanel'
    page.locator('#mapSearch').fill('autonomia')
    page.keyboard.press('Escape'); page.wait_for_timeout(80)
    report['search_escape_closes_and_returns'] = page.locator('#searchPanel').is_hidden() and page.evaluate('document.activeElement?.id === "searchBtn"')

    page.locator('#moreBtn').focus(); page.keyboard.press('Enter'); page.wait_for_timeout(80)
    page.locator('#mobileActions [data-action="helpBtn"]').focus(); page.keyboard.press('Enter'); page.wait_for_timeout(80)
    report['help_focus_enters'] = page.evaluate('document.activeElement?.id === "closeHelp"')
    page.keyboard.press('Escape'); page.wait_for_timeout(80)
    report['help_escape_closes_and_returns'] = page.locator('#helpPopover').is_hidden() and page.evaluate('document.activeElement?.id === "moreBtn"')

    page.locator('.tool[data-tool="connect"]').click(); page.wait_for_timeout(60)
    report['tool_toggle_semantics'] = page.locator('.tool[data-tool="connect"]').get_attribute('aria-pressed') == 'true' and page.locator('.tool[data-tool="move"]').get_attribute('aria-pressed') == 'false'
    page.locator('.tool[data-tool="move"]').click(); page.wait_for_timeout(60)

    page.locator('[data-entity="platforms"]').click(); page.wait_for_timeout(160)
    selected_rect = page.locator('[data-entity="platforms"]').bounding_box()
    drawer_rect = page.locator('#drawer').bounding_box()
    report['drawer_preserves_selected_context'] = selected_rect['x'] + selected_rect['width'] <= drawer_rect['x']
    page.screenshot(path=str(audit / '2d-drawer-context.png'))
    page.locator('#drawerClose').click(); page.wait_for_timeout(120)

    print('STAGE responsive 3d context', flush=True)
    page.locator('#viewModeBtn').click(); page.wait_for_timeout(520)
    three_width_before = page.locator('#threeViewport').bounding_box()['width']
    page.locator('.three-cell-label[data-cell="platforms"]').focus(); page.keyboard.press('Enter'); page.wait_for_timeout(520)
    three_width_with_drawer = page.locator('#threeViewport').bounding_box()['width']
    selected_three_rect = page.locator('.three-cell-label[data-cell="platforms"]').bounding_box()
    three_rect = page.locator('#threeViewport').bounding_box()
    report['three_drawer_reserves_canvas'] = three_width_with_drawer <= three_width_before - 300
    report['three_selected_context_visible'] = (
        selected_three_rect['x'] >= three_rect['x'] and
        selected_three_rect['x'] + selected_three_rect['width'] <= three_rect['x'] + three_rect['width']
    )
    page.screenshot(path=str(audit / '3d-drawer-context.png'))
    page.keyboard.press('Escape'); page.wait_for_timeout(420)

    page.set_viewport_size({'width': 920, 'height': 820}); page.wait_for_timeout(520)
    intermediate_width = page.locator('#threeViewport').bounding_box()['width']
    page.locator('.three-cell-label[data-cell="platforms"]').click(); page.wait_for_timeout(320)
    intermediate_with_drawer = page.locator('#threeViewport').bounding_box()['width']
    intermediate_selected = page.locator('.three-cell-label[data-cell="platforms"]').bounding_box()
    intermediate_drawer = page.locator('#drawer').bounding_box()
    report['three_intermediate_keeps_canvas'] = abs(intermediate_width - intermediate_with_drawer) <= 1
    report['three_intermediate_drawer_flips_left'] = intermediate_drawer['x'] <= 20
    report['three_intermediate_selected_visible'] = intermediate_selected['x'] >= intermediate_drawer['x'] + intermediate_drawer['width']
    page.screenshot(path=str(audit / '3d-intermediate-drawer-920.png'))
    page.locator('#drawerClose').click(); page.wait_for_timeout(220)

    page.set_viewport_size({'width': 844, 'height': 390}); page.wait_for_timeout(620)
    short_three_clear = page.evaluate('''() => {
      const top = Math.max(document.querySelector('.topbar').getBoundingClientRect().bottom, document.querySelector('#toolHint').getBoundingClientRect().bottom);
      const bottom = document.querySelector('.statusbar').getBoundingClientRect().top;
      const allLabels = [...document.querySelectorAll('.three-cell-label, .three-cluster-label')];
      const labels = allLabels.filter((element) => element.getAttribute('aria-hidden') !== 'true');
      const focusClusterId = HexMapStudio.getMap().hexagons[0].clusterId;
      const expected = HexMapStudio.getMap().hexagons.filter((item) => item.clusterId === focusClusterId).length + 1;
      return {
        count: allLabels.length,
        visible: labels.length,
        expected,
        fitMode: document.querySelector('#threeCanvas').dataset.fitMode,
        inside: labels.filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= top - 1 && rect.bottom <= bottom + 1;
        }).length,
      };
    }''')
    report['three_short_landscape_label_count'] = short_three_clear['count']
    report['three_short_landscape_focal'] = short_three_clear['fitMode'] == 'focal' and short_three_clear['visible'] == short_three_clear['expected']
    report['three_short_landscape_unobscured'] = short_three_clear['inside'] == short_three_clear['visible']
    page.screenshot(path=str(audit / '3d-short-landscape-844x390.png'))
    initial_focus_cluster = page.locator('.three-cluster-label:not([aria-hidden="true"])').get_attribute('data-cluster')
    page.locator('#searchBtn').click(); page.locator('#mapSearch').fill('vigilância'); page.wait_for_timeout(100)
    target_focus_id = page.locator('[data-search-entity="surveillance"]').get_attribute('data-search-entity')
    page.locator('[data-search-entity="surveillance"]').click(); page.wait_for_timeout(180)
    page.locator('#drawerClose').click(); page.wait_for_timeout(220)
    next_focus_cluster = page.locator('.three-cluster-label:not([aria-hidden="true"])').get_attribute('data-cluster')
    report['three_short_landscape_focus_clusters'] = [initial_focus_cluster, next_focus_cluster]
    report['three_short_landscape_search_reframes'] = initial_focus_cluster != next_focus_cluster and page.locator(f'.three-cell-label[data-cell="{target_focus_id}"]').get_attribute('aria-hidden') is None
    report['three_short_landscape_note'] = page.locator('.three-mode-note').inner_text() == 'Território em foco · use Buscar para navegar'
    page.screenshot(path=str(audit / '3d-short-landscape-search-844x390.png'))

    page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(620)
    mobile_three = page.locator('.three-cell-label')
    mobile_three_visible = 0
    viewport_rect = page.locator('#threeViewport').bounding_box()
    for index in range(mobile_three.count()):
        rect = mobile_three.nth(index).bounding_box()
        if rect and rect['x'] >= viewport_rect['x'] and rect['y'] >= viewport_rect['y'] and rect['x'] + rect['width'] <= viewport_rect['x'] + viewport_rect['width'] and rect['y'] + rect['height'] <= viewport_rect['y'] + viewport_rect['height']:
            mobile_three_visible += 1
    report['three_mobile_all_cells_inside'] = mobile_three_visible == 48
    report['three_mobile_cluster_count'] = page.locator('.three-cluster-label').count()
    page.screenshot(path=str(audit / '3d-mobile-390.png'))
    page.locator('.three-cell-label').first.click(); page.wait_for_timeout(220)
    mobile_drawer = page.locator('#drawer').bounding_box()
    report['three_mobile_drawer_inside'] = mobile_drawer['x'] >= 0 and mobile_drawer['x'] + mobile_drawer['width'] <= 390 and mobile_drawer['y'] >= 0 and mobile_drawer['y'] + mobile_drawer['height'] <= 844
    report['three_mobile_tabs_visible'] = page.locator('.drawer-tab').count() == 4 and all(page.locator('.drawer-tab').nth(index).is_visible() for index in range(4))
    page.screenshot(path=str(audit / '3d-mobile-drawer-390.png'))
    page.locator('#drawerClose').click(); page.locator('#viewModeBtn').click(); page.wait_for_timeout(220)

    page.locator('#moreBtn').click(); page.wait_for_timeout(80)
    report['mobile_search_in_overflow'] = page.locator('[data-action="searchBtn"]').is_visible()
    report['mobile_settings_in_overflow'] = page.locator('[data-action="mapSettingsBtn"]').is_visible()
    page.screenshot(path=str(audit / 'mobile-overflow-390.png'))
    page.locator('[data-action="searchBtn"]').click(); page.wait_for_timeout(80)
    report['mobile_search_opens'] = page.locator('#searchPanel').is_visible() and page.evaluate('document.activeElement?.id === "mapSearch"')
    page.keyboard.press('Escape'); page.wait_for_timeout(80)
    page.locator('#moreBtn').click(); page.locator('[data-action="mapSettingsBtn"]').click(); page.wait_for_timeout(120)
    report['mobile_settings_opens'] = page.locator('#drawer').is_visible() and page.locator('#mapTitleInput').is_visible()
    report['settings_disclosure_semantics'] = page.locator('#mapSettingsBtn').get_attribute('aria-expanded') == 'true' and page.locator('#mapSettingsBtn').get_attribute('aria-controls') == 'drawer' and page.locator('#drawer').get_attribute('aria-label') == 'Configurações do mapa'
    page.locator('#drawerClose').click()

    page.set_viewport_size({'width': 768, 'height': 1024})
    page.keyboard.press('?')
    page.wait_for_timeout(120)
    report['keyboard_help'] = page.locator('#helpPopover').is_visible() and page.locator('#closeHelp').evaluate('e => document.activeElement === e')
    page.keyboard.press('Escape')
    report['closed_drawer_hidden'] = page.locator('#drawer').is_hidden() and page.locator('#drawer').get_attribute('aria-hidden') == 'true'
    page.locator('#moreBtn').click()
    report['tablet_overflow_menu'] = page.locator('[data-action="presentationBtn"]').is_visible()
    page.locator('[data-action="presentationBtn"]').click()
    page.wait_for_timeout(260)
    page.evaluate('document.querySelector("#toast").hidden = true')
    report['presentation_read_only'] = page.locator('body').evaluate('e => e.classList.contains("presentation-mode") && e.classList.contains("read-only-mode")')
    report['presentation_chrome_clean'] = page.locator('#toolHint').is_hidden() and page.locator('.statusbar').is_hidden() and page.locator('#moreBtn').is_hidden()
    report['presentation_titles_preserve_words'] = page.locator('[data-cluster-label]:not([data-long-title="true"]) strong').evaluate_all("els => els.every(e => getComputedStyle(e).overflowWrap === 'normal' && getComputedStyle(e).wordBreak === 'normal')")
    report['presentation_titles_unclipped'] = page.locator('[data-cluster-label]:not([data-long-title="true"]) strong').evaluate_all("els => els.every(e => e.scrollHeight <= Math.ceil(parseFloat(getComputedStyle(e).lineHeight) * 2) + 2)")
    presentation_label_rects = [page.locator('[data-cluster-label]').nth(index).bounding_box() for index in range(page.locator('[data-cluster-label]').count())]
    report['presentation_cluster_labels_inside'] = all(rect and rect['x'] >= 8 and rect['y'] >= 76 and rect['x'] + rect['width'] <= 760 and rect['y'] + rect['height'] <= 1016 for rect in presentation_label_rects)
    presentation_nodes = page.locator('.hex-node')
    presentation_node_rects = [presentation_nodes.nth(index).bounding_box() for index in range(presentation_nodes.count())]
    rightmost_node_index = max(range(len(presentation_node_rects)), key=lambda index: presentation_node_rects[index]['x'] if presentation_node_rects[index] else -1)
    presentation_nodes.nth(rightmost_node_index).hover(); page.wait_for_timeout(80)
    presentation_tooltip_rect = page.locator('#tooltip').bounding_box()
    report['presentation_tooltip_inside'] = page.locator('#tooltip').is_visible() and presentation_tooltip_rect and presentation_tooltip_rect['x'] >= 12 and presentation_tooltip_rect['y'] >= 12 and presentation_tooltip_rect['x'] + presentation_tooltip_rect['width'] <= 756 and presentation_tooltip_rect['y'] + presentation_tooltip_rect['height'] <= 1012
    page.mouse.move(8, 88); page.wait_for_timeout(60)
    page.screenshot(path=str(audit / 'presentation-tablet.png'))
    page.locator('#presentationBtn').click()

    print('STAGE 3d workflow parity and history', flush=True)
    workflow_page = browser.new_page(viewport={'width': 1280, 'height': 800})
    workflow_errors = []
    workflow_page.on('console', lambda msg: workflow_errors.append(f'workflow-console:{msg.type}:{msg.text}') if msg.type == 'error' else None)
    workflow_page.on('pageerror', lambda exc: workflow_errors.append(f'workflow-pageerror:{exc}'))
    workflow_page.route('https://hexmap-workflow.test/**', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
    workflow_page.goto('https://hexmap-workflow.test/?qa=1', wait_until='load')
    workflow_page.evaluate("localStorage.setItem('hexmap-studio-onboarding-v1', 'seen'); localStorage.setItem('hexmap-view-mode', '3d')")
    workflow_page.reload(wait_until='load'); workflow_page.wait_for_timeout(620)

    workflow_page.locator('#searchBtn').click(); workflow_page.locator('#mapSearch').fill('Tecnologia'); workflow_page.wait_for_timeout(120)
    workflow_cluster_result = workflow_page.locator('[data-search-type="cluster"]').first
    workflow_search_cluster_id = workflow_cluster_result.get_attribute('data-search-id')
    report['desktop_3d_search_dims_nonmatches'] = workflow_page.locator('.three-cluster-label.search-hidden').count() >= 1 and workflow_page.locator(f'.three-cluster-label[data-cluster="{workflow_search_cluster_id}"]').evaluate("e => !e.classList.contains('search-hidden')")
    workflow_cluster_result.click(); workflow_page.wait_for_timeout(260)
    workflow_search_cluster_label = workflow_page.locator(f'.three-cluster-label[data-cluster="{workflow_search_cluster_id}"]')
    workflow_search_cluster_box = workflow_search_cluster_label.bounding_box()
    workflow_search_drawer_box = workflow_page.locator('#drawer').bounding_box()
    report['desktop_3d_search_selects_cluster'] = workflow_page.locator('#threeCanvas').get_attribute('data-selected-cluster') == workflow_search_cluster_id and workflow_search_cluster_label.get_attribute('aria-pressed') == 'true' and 'selected' in (workflow_search_cluster_label.get_attribute('class') or '') and workflow_page.locator('.drawer-kicker').inner_text().startswith('CLUSTER')
    report['desktop_3d_cluster_context_unobscured'] = bool(workflow_search_cluster_box and workflow_search_drawer_box and workflow_search_cluster_box['x'] + workflow_search_cluster_box['width'] <= workflow_search_drawer_box['x'])
    workflow_page.keyboard.press('Escape'); workflow_page.wait_for_timeout(180)

    workflow_page.locator('#searchBtn').click(); workflow_page.locator('#mapSearch').fill('articula'); workflow_page.wait_for_timeout(120)
    workflow_relation_result = workflow_page.locator('[data-search-type="relation"]').first
    workflow_search_relation_id = workflow_relation_result.get_attribute('data-search-id')
    report['desktop_3d_search_dims_other_relations'] = workflow_page.locator('.three-relation-label.search-hidden').count() >= 1 and workflow_page.locator(f'.three-relation-label[data-relation="{workflow_search_relation_id}"]').evaluate("e => !e.classList.contains('search-hidden')")
    workflow_relation_result.click(); workflow_page.wait_for_timeout(260)
    workflow_selected_relation_label = workflow_page.locator(f'.three-relation-label[data-relation="{workflow_search_relation_id}"]')
    report['desktop_3d_search_selects_relation'] = workflow_page.locator('#threeCanvas').get_attribute('data-selected-relation') == workflow_search_relation_id and workflow_selected_relation_label.get_attribute('data-selected') == 'true' and 'selected' in (workflow_selected_relation_label.get_attribute('class') or '') and workflow_page.locator('.drawer-kicker').inner_text() == 'RELAÇÃO'
    report['desktop_3d_relation_endpoints_visible'] = workflow_page.locator('.three-cluster-label.relation-context').count() == 2 and workflow_selected_relation_label.is_visible()
    report['desktop_3d_search_disclosure_closes'] = workflow_page.locator('#searchPanel').is_hidden() and workflow_page.locator('#searchBtn').get_attribute('aria-expanded') == 'false'
    workflow_page.screenshot(path=str(audit / 'desktop-3d-search-context-1280.png'))
    workflow_page.keyboard.press('Escape'); workflow_page.wait_for_timeout(180)

    workflow_cluster = workflow_page.locator('.three-cluster-label:not([aria-hidden="true"])').first
    workflow_cluster_id = workflow_cluster.get_attribute('data-cluster')
    workflow_cluster_before = workflow_page.evaluate('(clusterId) => HexMapStudio.getMap().hexagons.filter((item) => item.clusterId === clusterId).map(({ id, q, r }) => [id, q, r])', workflow_cluster_id)
    workflow_cluster.evaluate("element => element.addEventListener('pointerdown', event => { window.__qaClusterPointerId = event.pointerId; }, { once: true })")
    workflow_cluster_box = workflow_cluster.bounding_box()
    workflow_cluster_x = workflow_cluster_box['x'] + workflow_cluster_box['width'] / 2
    workflow_cluster_y = workflow_cluster_box['y'] + workflow_cluster_box['height'] / 2
    workflow_page.mouse.move(workflow_cluster_x, workflow_cluster_y)
    workflow_page.mouse.down(); workflow_page.mouse.move(workflow_cluster_x + 160, workflow_cluster_y + 48, steps=8)
    workflow_cluster_pointer_id = workflow_page.evaluate('window.__qaClusterPointerId')
    workflow_page.evaluate('''([pointerId, x, y]) => document.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true, cancelable: true, pointerId: pointerId + 100, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: y,
    }))''', [workflow_cluster_pointer_id, workflow_cluster_x + 160, workflow_cluster_y + 48])
    report['three_cluster_ignores_foreign_pointer_cancel'] = workflow_page.locator('#threeCanvas').get_attribute('data-last-interaction').startswith(f'cluster-preview:{workflow_cluster_id}:')
    workflow_page.evaluate('''([pointerId, x, y]) => document.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: y,
    }))''', [workflow_cluster_pointer_id, workflow_cluster_x + 160, workflow_cluster_y + 48])
    workflow_page.mouse.up(); workflow_page.wait_for_timeout(220)
    workflow_cluster_after = workflow_page.evaluate('(clusterId) => HexMapStudio.getMap().hexagons.filter((item) => item.clusterId === clusterId).map(({ id, q, r }) => [id, q, r])', workflow_cluster_id)
    report['three_cluster_cancel_reverts_drag'] = workflow_cluster_after == workflow_cluster_before and workflow_page.locator('#threeCanvas').get_attribute('data-last-interaction') == f'cluster-cancel:{workflow_cluster_id}'
    three_cancel_zoom_before = float(workflow_page.locator('#threeCanvas').get_attribute('data-camera-zoom'))
    workflow_canvas_box = workflow_page.locator('#threeCanvas').bounding_box()
    workflow_page.mouse.move(workflow_canvas_box['x'] + 24, workflow_canvas_box['y'] + workflow_canvas_box['height'] - 24)
    workflow_page.mouse.wheel(0, -420); workflow_page.wait_for_timeout(260)
    three_cancel_zoom_after = float(workflow_page.locator('#threeCanvas').get_attribute('data-camera-zoom'))
    report['three_cluster_cancel_restores_camera'] = three_cancel_zoom_after > three_cancel_zoom_before
    workflow_page.screenshot(path=str(audit / 'spatial-desktop-3d-cancel.png'))
    workflow_cells = workflow_page.locator('.three-cell-label:not([aria-hidden="true"])')
    first_workflow_id = workflow_cells.nth(0).get_attribute('data-cell')
    second_workflow_id = workflow_cells.nth(1).get_attribute('data-cell')
    workflow_cells.nth(0).focus(); workflow_cells.nth(0).press('Shift+Enter'); workflow_page.wait_for_timeout(80)
    workflow_page.locator(f'.three-cell-label[data-cell="{second_workflow_id}"]').focus(); workflow_page.locator(f'.three-cell-label[data-cell="{second_workflow_id}"]').press('Shift+Enter'); workflow_page.wait_for_timeout(120)
    report['three_keyboard_multiselect'] = workflow_page.locator('#selectionToolbar').is_visible() and workflow_page.locator('#selectionCount').inner_text() == '2 selecionados'
    report['three_multiselect_visual_state'] = workflow_page.locator('#threeCanvas').get_attribute('data-multi-selected') == '2' and workflow_page.locator('#threeCanvas').get_attribute('data-multi-selection-markers') == '2' and workflow_page.locator(f'.three-cell-label[data-cell="{first_workflow_id}"]').get_attribute('aria-pressed') == 'true' and workflow_page.locator(f'.three-cell-label[data-cell="{second_workflow_id}"]').get_attribute('aria-pressed') == 'true'
    report['multiselect_announced'] = workflow_page.locator('#selectionCount').get_attribute('aria-live') == 'polite'
    workflow_page.screenshot(path=str(audit / 'workflow-3d-multiselect.png'))
    workflow_page.keyboard.press('Escape'); workflow_page.wait_for_timeout(100)
    report['multiselect_escape_clears'] = workflow_page.locator('#selectionToolbar').is_hidden() and workflow_page.locator('#threeCanvas').get_attribute('data-multi-selected') == '0'
    workflow_page.locator(f'.three-cell-label[data-cell="{first_workflow_id}"]').click(modifiers=['Shift']); workflow_page.wait_for_timeout(60)
    workflow_page.locator(f'.three-cell-label[data-cell="{second_workflow_id}"]').click(modifiers=['Shift']); workflow_page.wait_for_timeout(80)
    workflow_page.locator('#makeClusterBtn').click(); workflow_page.wait_for_timeout(180)
    report['three_multiselect_forms_cluster'] = workflow_page.evaluate('''() => {
      const map = HexMapStudio.getMap();
      const cluster = map.clusters.find((item) => item.title.startsWith('Novo cluster'));
      return Boolean(cluster) && map.hexagons.filter((item) => item.clusterId === cluster.id).length === 2;
    }''') and workflow_page.locator('.drawer-kicker').inner_text().startswith('CLUSTER')
    workflow_page.screenshot(path=str(audit / 'workflow-3d-cluster.png'))
    workflow_page.keyboard.press('Meta+z'); workflow_page.wait_for_timeout(160)
    report['history_undo_cluster'] = workflow_page.evaluate("!HexMapStudio.getMap().clusters.some((item) => item.title.startsWith('Novo cluster'))")

    relation_count_before = workflow_page.evaluate('HexMapStudio.getMap().relations.length')
    connect_pair = workflow_page.evaluate('''() => {
      const map = HexMapStudio.getMap();
      for (const source of map.clusters) for (const target of map.clusters) {
        if (source.id === target.id) continue;
        if (!map.relations.some((item) => item.source === source.id && item.target === target.id)) return [source.id, target.id];
      }
      return null;
    }''')
    workflow_page.locator('.tool[data-tool="connect"]').click()
    workflow_page.locator(f'.three-cluster-label[data-cluster="{connect_pair[0]}"]').click(); workflow_page.wait_for_timeout(80)
    report['three_connect_source_feedback'] = workflow_page.locator('#connectBanner').is_visible() and 'destino' in workflow_page.locator('#connectText').inner_text().lower()
    workflow_page.locator(f'.three-cluster-label[data-cluster="{connect_pair[1]}"]').click(); workflow_page.wait_for_timeout(160)
    report['three_connect_creates_relation'] = workflow_page.evaluate('HexMapStudio.getMap().relations.length') == relation_count_before + 1 and workflow_page.locator('#drawer').is_visible() and workflow_page.locator('.drawer-kicker').inner_text() == 'RELAÇÃO'
    report['three_connect_returns_to_move'] = 'active' in (workflow_page.locator('.tool[data-tool="move"]').get_attribute('class') or '') and workflow_page.locator('#connectBanner').is_hidden()
    workflow_page.screenshot(path=str(audit / 'workflow-3d-connect.png'))
    workflow_page.keyboard.press('Meta+z'); workflow_page.wait_for_timeout(140)
    report['history_undo_relation'] = workflow_page.evaluate('HexMapStudio.getMap().relations.length') == relation_count_before
    workflow_page.keyboard.press('Meta+Shift+z'); workflow_page.wait_for_timeout(140)
    report['history_redo_relation'] = workflow_page.evaluate('HexMapStudio.getMap().relations.length') == relation_count_before + 1

    workflow_page.keyboard.press('Escape'); workflow_page.wait_for_timeout(100)
    delete_pair = workflow_page.evaluate('''() => {
      const map = HexMapStudio.getMap();
      const key = (q, r) => `${q},${r}`;
      const directions = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
      const connectedWithout = (candidate) => {
        const cells = map.hexagons.filter((item) => item.clusterId === candidate.clusterId && item.id !== candidate.id);
        if (cells.length < 2) return false;
        const byPosition = new Map(cells.map((item) => [key(item.q, item.r), item]));
        const seen = new Set([cells[0].id]);
        const queue = [cells[0]];
        while (queue.length) {
          const current = queue.shift();
          for (const [dq, dr] of directions) {
            const neighbor = byPosition.get(key(current.q + dq, current.r + dr));
            if (neighbor && !seen.has(neighbor.id)) { seen.add(neighbor.id); queue.push(neighbor); }
          }
        }
        return seen.size === cells.length;
      };
      for (const source of map.hexagons.filter((item) => item.clusterId && connectedWithout(item))) {
        const target = map.hexagons.find((item) => item.clusterId !== source.clusterId && !map.relations.some((relation) => relation.source === source.id && relation.target === item.id));
        if (target) return [source.id, target.id];
      }
      return null;
    }''')
    hex_relation_count_before = workflow_page.evaluate('HexMapStudio.getMap().relations.length')
    workflow_page.locator('.tool[data-tool="connect"]').click()
    workflow_page.locator(f'.three-cell-label[data-cell="{delete_pair[0]}"]').click(); workflow_page.wait_for_timeout(70)
    workflow_page.locator(f'.three-cell-label[data-cell="{delete_pair[1]}"]').click(); workflow_page.wait_for_timeout(150)
    delete_relation_id = workflow_page.evaluate('''([source, target]) => HexMapStudio.getMap().relations.find((relation) => relation.source === source && relation.target === target)?.id''', delete_pair)
    report['three_hex_connect_creates_relation'] = bool(delete_relation_id) and workflow_page.evaluate('HexMapStudio.getMap().relations.length') == hex_relation_count_before + 1
    report['three_hex_connect_renders_relation'] = int(workflow_page.locator('#threeCanvas').get_attribute('data-rendered-relations')) == hex_relation_count_before + 1
    workflow_page.keyboard.press('Escape'); workflow_page.wait_for_timeout(90)
    workflow_page.locator(f'.three-cell-label[data-cell="{delete_pair[0]}"]').click(); workflow_page.wait_for_timeout(100)
    report['entity_delete_from_content_context'] = workflow_page.locator('#drawer-tab-content').get_attribute('aria-selected') == 'true' and workflow_page.locator('#deleteEntity').count() == 0
    workflow_page.keyboard.press('Delete'); workflow_page.wait_for_timeout(150)
    deleted_integrity = workflow_page.evaluate('''([entityId, relationId]) => {
      const map = HexMapStudio.getMap();
      const endpointIds = new Set([...map.hexagons.map((item) => item.id), ...map.clusters.map((item) => item.id)]);
      return {
        entityGone: !map.hexagons.some((item) => item.id === entityId),
        relationGone: !map.relations.some((item) => item.id === relationId),
        noDangling: map.relations.every((item) => endpointIds.has(item.source) && endpointIds.has(item.target)),
      };
    }''', [delete_pair[0], delete_relation_id])
    delete_toast = workflow_page.locator('#toast').inner_text()
    report['entity_delete_cascades_relations'] = deleted_integrity['entityGone'] and deleted_integrity['relationGone'] and deleted_integrity['noDangling']
    report['entity_delete_explains_undo'] = 'relação vinculada' in delete_toast and 'Desfazer' in delete_toast
    workflow_page.screenshot(path=str(audit / 'workflow-delete-undo.png'))
    workflow_page.keyboard.press('Meta+z'); workflow_page.wait_for_timeout(160)
    report['history_undo_entity_delete'] = workflow_page.evaluate('''([entityId, relationId, expectedRelations]) => {
      const map = HexMapStudio.getMap();
      return map.hexagons.some((item) => item.id === entityId)
        && map.relations.some((item) => item.id === relationId)
        && map.relations.length === expectedRelations;
    }''', [delete_pair[0], delete_relation_id, hex_relation_count_before + 1])
    errors.extend(workflow_errors)
    workflow_page.close()

    print('STAGE recovery and 3d context-loss fallback', flush=True)
    qa_page = browser.new_page(viewport={'width': 1440, 'height': 900})
    qa_errors = []
    qa_page.on('console', lambda msg: qa_errors.append(f'console:{msg.type}:{msg.text}') if msg.type == 'error' else None)
    qa_page.on('pageerror', lambda exc: qa_errors.append(f'pageerror:{exc}'))
    qa_page.route('https://hexmap.test/**', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
    qa_page.goto('https://hexmap.test/?qa=1', wait_until='load')
    qa_page.evaluate("localStorage.setItem('hexmap-studio-onboarding-v1', 'seen'); localStorage.setItem('hexmap-view-mode', '2d'); sessionStorage.removeItem('hexmap-studio-recovery-v1')")
    qa_page.reload(wait_until='load'); qa_page.wait_for_timeout(320)
    corrupt_raw = '{"title":"mapa interrompido","hexagons":['
    qa_page.evaluate("value => { localStorage.setItem('hexmap-studio-v9', value); localStorage.setItem('hexmap-studio-corrupt-backup-v1', JSON.stringify({ raw: 'backup anterior', savedAt: '2026-09-04T00:00:00.000Z' })); }", corrupt_raw)
    qa_page.reload(wait_until='load'); qa_page.wait_for_timeout(240)
    report['corrupt_storage_not_overwritten'] = qa_page.evaluate("value => localStorage.getItem('hexmap-studio-v9') === value", corrupt_raw)
    report['corrupt_storage_prior_backup_preserved'] = qa_page.evaluate("JSON.parse(localStorage.getItem('hexmap-studio-corrupt-backup-v1')).raw === 'backup anterior'")
    report['corrupt_storage_backup_preserved'] = qa_page.evaluate("value => JSON.parse(sessionStorage.getItem('hexmap-studio-corrupt-backup-v1')).raw === value", corrupt_raw)
    report['corrupt_storage_named_recovery'] = qa_page.locator('#recoveryBanner').is_visible() and qa_page.locator('#recoveryBanner').get_attribute('aria-label') == 'Recuperação do armazenamento local'
    qa_page.set_viewport_size({'width': 390, 'height': 844})
    qa_page.screenshot(path=str(audit / 'corrupt-storage-recovery-390x844.png'))
    with qa_page.expect_download() as corrupt_download_info:
        qa_page.locator('#downloadCorruptStorage').click()
    report['corrupt_storage_download_exact'] = Path(corrupt_download_info.value.path()).read_text(encoding='utf-8') == corrupt_raw
    qa_page.locator('#replaceCorruptStorage').click(); qa_page.wait_for_timeout(180)
    report['corrupt_storage_new_map_after_backup'] = qa_page.evaluate("() => { const map = JSON.parse(localStorage.getItem('hexmap-studio-v9')); return map.hexagons.length === 48 && Boolean(localStorage.getItem('hexmap-studio-corrupt-backup-v1')); }")
    report['corrupt_storage_recovery_closes'] = qa_page.locator('#recoveryBanner').is_hidden()

    qa_page.evaluate('''() => {
      const candidate = structuredClone(HexMapStudio.getMap());
      candidate.title = 'Mapa recuperado pelo gate';
      candidate.hexagons[0].title = 'Conceito recuperado';
      const snapshot = structuredClone(candidate);
      delete snapshot.updatedAt;
      sessionStorage.setItem('hexmap-studio-recovery-v1', JSON.stringify({
        map: candidate,
        snapshot: JSON.stringify(snapshot),
        savedAt: new Date().toISOString(),
        workspaceName: 'Gate local-first',
      }));
    }''')
    qa_page.set_viewport_size({'width': 320, 'height': 568})
    qa_page.reload(wait_until='load'); qa_page.wait_for_timeout(320)
    recovery_rect = qa_page.locator('#recoveryBanner').bounding_box()
    report['recovery_banner_named_region'] = qa_page.locator('#recoveryBanner').is_visible() and qa_page.locator('#recoveryBanner').get_attribute('role') == 'region' and qa_page.locator('#recoveryBanner').get_attribute('aria-label') == 'Recuperação de sessão'
    report['recovery_banner_inside_mobile'] = bool(recovery_rect and recovery_rect['x'] >= 0 and recovery_rect['y'] >= 0 and recovery_rect['x'] + recovery_rect['width'] <= 320 and recovery_rect['y'] + recovery_rect['height'] <= 568)
    qa_page.screenshot(path=str(audit / 'recovery-banner-320x568.png'))
    qa_page.locator('#restoreRecovery').click(); qa_page.wait_for_timeout(220)
    report['recovery_restore_roundtrip'] = qa_page.evaluate("HexMapStudio.getMap().title === 'Mapa recuperado pelo gate' && HexMapStudio.getMap().hexagons[0].title === 'Conceito recuperado' && !sessionStorage.getItem('hexmap-studio-recovery-v1')")
    report['recovery_restore_persisted'] = qa_page.evaluate("JSON.parse(localStorage.getItem('hexmap-studio-v9')).title === 'Mapa recuperado pelo gate'")
    qa_page.evaluate('''() => {
      const candidate = structuredClone(HexMapStudio.getMap());
      candidate.title = 'Este candidato deve ser descartado';
      const snapshot = structuredClone(candidate);
      delete snapshot.updatedAt;
      sessionStorage.setItem('hexmap-studio-recovery-v1', JSON.stringify({ map: candidate, snapshot: JSON.stringify(snapshot), savedAt: new Date().toISOString() }));
    }''')
    qa_page.reload(wait_until='load'); qa_page.wait_for_timeout(240)
    qa_page.locator('#dismissRecovery').click(); qa_page.wait_for_timeout(160)
    report['recovery_dismiss_preserves_current'] = qa_page.evaluate("HexMapStudio.getMap().title === 'Mapa recuperado pelo gate' && !sessionStorage.getItem('hexmap-studio-recovery-v1')")

    qa_page.set_viewport_size({'width': 1440, 'height': 900})
    qa_page.evaluate("localStorage.setItem('hexmap-view-mode', '3d')")
    qa_page.reload(wait_until='load'); qa_page.wait_for_timeout(520)
    report['view_mode_persists_on_normal_origin'] = qa_page.locator('html').get_attribute('data-view-mode') == '3d'
    qa_page.wait_for_function("document.querySelector('#threeCanvas')?.dataset.firstRenderMs")
    report['three_first_render_ms'] = float(qa_page.locator('#threeCanvas').get_attribute('data-first-render-ms'))
    report['three_render_p95_ms'] = float(qa_page.locator('#threeCanvas').get_attribute('data-render-ms-p95'))
    report['three_render_triangles'] = int(qa_page.locator('#threeCanvas').get_attribute('data-triangles'))
    qa_page.keyboard.press('Alt+Shift+M')
    qa_page.wait_for_function("document.documentElement.dataset.lifecycleQa === 'passed'", timeout=20000)
    report['three_lifecycle_cycles'] = int(qa_page.locator('html').get_attribute('data-lifecycle-cycles'))
    report['three_lifecycle_peak_textures'] = int(qa_page.locator('html').get_attribute('data-lifecycle-peak-textures'))
    report['three_lifecycle_peak_geometries'] = int(qa_page.locator('html').get_attribute('data-lifecycle-peak-geometries'))
    report['three_context_loss_hook_called'] = qa_page.evaluate('HexMapStudio.forceThreeContextLossForQA()')
    qa_page.wait_for_timeout(320)
    report['three_context_loss_falls_back_to_2d'] = (
        qa_page.locator('#viewModeBtn').is_hidden()
        and qa_page.locator('#threeViewport').is_hidden()
        and qa_page.locator('.hex-node').count() == 48
        and qa_page.locator('html').get_attribute('data-view-mode') == '2d'
    )
    report['three_context_loss_explained'] = 'mapa completo continua no modo 2D' in qa_page.locator('#toast').inner_text()
    qa_page.screenshot(path=str(audit / '3d-context-loss-fallback.png'))
    errors.extend(qa_errors)
    qa_page.close()

    print('STAGE scale and malformed input', flush=True)
    scale_page = browser.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    scale_errors = []
    scale_page.on('console', lambda msg: scale_errors.append(f'scale-console:{msg.type}:{msg.text}') if msg.type == 'error' else None)
    scale_page.on('pageerror', lambda exc: scale_errors.append(f'scale-pageerror:{exc}'))
    scale_page.route('https://hexmap-scale.test/**', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
    scale_page.goto('https://hexmap-scale.test/?qa=1', wait_until='load')
    scale_page.evaluate("localStorage.setItem('hexmap-studio-onboarding-v1', 'seen'); localStorage.setItem('hexmap-view-mode', '2d')")
    scale_page.reload(wait_until='load'); scale_page.wait_for_timeout(260)
    scale_render_ms = scale_page.evaluate('''() => {
      const base = HexMapStudio.getMap();
      const offsets = [[0,0],[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1],[2,-1]];
      const clusters = [];
      const hexagons = [];
      const relations = [];
      for (let clusterIndex = 0; clusterIndex < 24; clusterIndex += 1) {
        const clusterId = `scale-c${clusterIndex}`;
        const column = clusterIndex % 6;
        const row = Math.floor(clusterIndex / 6);
        clusters.push({
          ...structuredClone(base.clusters[clusterIndex % base.clusters.length]),
          id: clusterId,
          title: clusterIndex === 0 ? `TerritorioDeEscalaSemQuebra${'MuitoLongo'.repeat(9)}` : `Território de escala ${clusterIndex + 1}`,
          view3d: undefined,
          view3dMobile: undefined,
        });
        offsets.forEach(([dq, dr], itemIndex) => {
          const id = `scale-${clusterIndex}-${itemIndex}`;
          hexagons.push({
            ...structuredClone(base.hexagons[(clusterIndex * offsets.length + itemIndex) % base.hexagons.length]),
            id,
            title: clusterIndex === 0 && itemIndex === 0 ? `Vigilância ${'ExtremamenteLongaSemQuebra'.repeat(8)}` : `Item de escala ${clusterIndex}-${itemIndex}`,
            summary: `Conteúdo de escala ${clusterIndex}-${itemIndex}`,
            bodyMarkdown: `## Item ${clusterIndex}-${itemIndex}\n\nConteúdo extremo, persistente e pesquisável.`,
            tags: ['escala', `grupo-${clusterIndex}`],
            clusterId,
            q: column * 12 + dq,
            r: row * 10 + dr,
            visual: { mode: 'text', image: { src: '', fit: 'cover', position: '50% 50%', overlay: .38 } },
          });
        });
        relations.push({ id: `scale-r${clusterIndex}`, source: clusterId, target: `scale-c${(clusterIndex + 1) % 24}`, sourceType: 'cluster', targetType: 'cluster', style: 'curve', label: `fluxo ${clusterIndex + 1}`, routing: { mode: 'auto', offset: { along: 0, perpendicular: .2 } } });
      }
      const map = { ...structuredClone(base), id: 'scale-map', title: `Mapa ${'ExtremamenteLongoSemQuebra'.repeat(10)}`, hexagons, clusters, relations, annotations: [], layout: { ...structuredClone(base.layout), type: 'free', mode: 'territories' } };
      const started = performance.now();
      HexMapStudio.setMap(map);
      return performance.now() - started;
    }''')
    scale_page.wait_for_timeout(320)
    report['scale_2d_render_ms'] = round(scale_render_ms, 1)
    report['scale_2d_nodes'] = scale_page.locator('.hex-node').count()
    report['scale_2d_clusters'] = scale_page.locator('.cluster-contour').count()
    report['scale_2d_fit_below_legacy_floor'] = float(scale_page.locator('#zoomPct').inner_text().replace('%', '')) < 36
    scale_status_box = scale_page.locator('.statusbar').bounding_box()
    scale_topbar_box = scale_page.locator('.topbar').bounding_box()
    scale_territory_rects = [scale_page.locator('.cluster-contour').nth(index).bounding_box() for index in range(scale_page.locator('.cluster-contour').count())]
    report['scale_2d_territories_unobscured'] = all(
        rect and rect['y'] >= scale_topbar_box['y'] + scale_topbar_box['height'] + 4 and rect['y'] + rect['height'] <= scale_status_box['y'] - 4
        for rect in scale_territory_rects
    )
    report['scale_2d_semantic_overview'] = scale_page.locator('html').get_attribute('data-hexmap-density') == 'dense-overview' and scale_page.locator('.hex-label').first.evaluate("e => getComputedStyle(e).opacity === '0'")
    report['scale_2d_cluster_titles_legible'] = scale_page.locator('[data-cluster-label] strong').first.bounding_box()['height'] >= 10
    report['scale_header_title_contained'] = scale_page.locator('#mapTitle').evaluate("e => e.scrollWidth > e.clientWidth && e.getBoundingClientRect().right <= document.querySelector('.topbar').getBoundingClientRect().right")
    long_cluster_height = scale_page.locator('[data-cluster-label="scale-c0"] strong').bounding_box()['height']
    report['scale_long_cluster_title_clamped'] = long_cluster_height <= 56
    scale_page.screenshot(path=str(audit / 'scale-2d-192.png'))

    scale_page.locator('#searchBtn').click(); scale_page.wait_for_timeout(80)
    report['scale_search_initial_window'] = scale_page.locator('[data-search-entity]').count() == 80 and scale_page.locator('#searchSummary').inner_text().endswith('MOSTRANDO 80')
    scale_page.locator('#showMoreSearch').click(); scale_page.wait_for_timeout(60)
    report['scale_search_second_window'] = scale_page.locator('[data-search-entity]').count() == 160
    scale_page.locator('#showMoreSearch').click(); scale_page.wait_for_timeout(60)
    report['scale_search_complete_window'] = scale_page.locator('[data-search-entity]').count() == 192 and scale_page.locator('#showMoreSearch').count() == 0
    scale_page.locator('#mapSearch').fill('vigilancia'); scale_page.wait_for_timeout(80)
    report['scale_search_accentless_unique'] = scale_page.locator('[data-search-entity="scale-0-0"]').count() == 1 and scale_page.locator('[data-search-entity]').count() == 1
    scale_page.locator('[data-search-entity="scale-0-0"]').click(); scale_page.wait_for_timeout(100)
    scale_page.set_viewport_size({'width': 390, 'height': 844}); scale_page.wait_for_timeout(180)
    drawer_box = scale_page.locator('#drawer').bounding_box()
    drawer_title_box = scale_page.locator('#drawerContent > h2').bounding_box()
    report['scale_long_drawer_title_contained'] = drawer_title_box['x'] >= drawer_box['x'] and drawer_title_box['x'] + drawer_title_box['width'] <= drawer_box['x'] + drawer_box['width']
    report['scale_long_drawer_title_clamped'] = drawer_title_box['height'] <= 170
    scale_page.screenshot(path=str(audit / 'scale-long-content-drawer-390x844.png'))
    scale_page.locator('#drawerClose').click(); scale_page.wait_for_timeout(80)

    scale_page.set_viewport_size({'width': 1440, 'height': 900}); scale_page.wait_for_timeout(180)
    with scale_page.expect_download() as scale_download_info:
        activate_action(scale_page, 'exportBtn')
    scale_export = json.loads(Path(scale_download_info.value.path()).read_text(encoding='utf-8'))
    report['scale_export_complete'] = len(scale_export['hexagons']) == 192 and len(scale_export['clusters']) == 24 and len(scale_export['relations']) == 24
    malformed_fixture = previews / 'malformed-scale-import.json'
    malformed_fixture.write_text('{"hexagons":[],"clusters":[],"relations":"not-an-array"}', encoding='utf-8')
    scale_page.locator('#importInput').set_input_files(str(malformed_fixture)); scale_page.wait_for_timeout(120)
    report['malformed_import_preserves_map'] = scale_page.evaluate("HexMapStudio.getMap().hexagons.length === 192") and 'Falha ao importar' in scale_page.locator('#toast').inner_text()
    malformed_fixture.unlink(missing_ok=True)
    report['scale_local_storage_complete'] = scale_page.evaluate("JSON.parse(localStorage.getItem('hexmap-studio-v9')).hexagons.length === 192")

    scale_page.locator('#viewModeBtn').click(); scale_page.wait_for_timeout(900)
    scale_page.wait_for_function("document.querySelector('#threeCanvas')?.dataset.firstRenderMs")
    scale_clusters = scale_page.locator('.three-cluster-label')
    scale_cluster_rects = [scale_clusters.nth(index).bounding_box() for index in range(scale_clusters.count())]
    report['scale_3d_cluster_count'] = scale_clusters.count()
    report['scale_3d_long_cluster_title_clamped'] = scale_clusters.first.locator('strong').bounding_box()['height'] <= 30
    report['scale_3d_cluster_labels_inside'] = all(rect and rect['x'] >= 0 and rect['y'] >= 0 and rect['x'] + rect['width'] <= 1440 and rect['y'] + rect['height'] <= 900 for rect in scale_cluster_rects)
    report['scale_3d_cluster_labels_nonoverlap'] = all(
        min(a['x'] + a['width'], b['x'] + b['width']) - max(a['x'], b['x']) <= 1 or min(a['y'] + a['height'], b['y'] + b['height']) - max(a['y'], b['y']) <= 1
        for index, a in enumerate(scale_cluster_rects) for b in scale_cluster_rects[index + 1:]
    )
    visible_scale_cells = scale_page.locator('.three-cell-label:not([aria-hidden="true"])').count()
    report['scale_3d_label_lod'] = scale_page.locator('#threeCanvas').get_attribute('data-label-lod') == 'cluster-priority' and 24 <= visible_scale_cells <= 48
    report['scale_3d_first_render_ms'] = float(scale_page.locator('#threeCanvas').get_attribute('data-first-render-ms'))
    scale_page.screenshot(path=str(audit / 'scale-3d-192.png'))

    scale_page.set_viewport_size({'width': 390, 'height': 844}); scale_page.wait_for_timeout(700)
    visible_focal_labels = scale_page.locator('.three-cell-label:not([aria-hidden="true"]), .three-cluster-label:not([aria-hidden="true"])')
    scale_focus_cluster = scale_page.locator('.three-cluster-label:not([aria-hidden="true"])').get_attribute('data-cluster')
    report['scale_3d_mobile_focal'] = scale_page.locator('#threeCanvas').get_attribute('data-fit-mode') == 'focal' and scale_focus_cluster == 'scale-c0' and visible_focal_labels.count() == 9
    scale_page.locator('#moreBtn').click(); scale_page.locator('[data-action="searchBtn"]').click(); scale_page.locator('#mapSearch').fill('Item de escala 23-0'); scale_page.wait_for_timeout(100)
    scale_page.locator('[data-search-entity="scale-23-0"]').click(); scale_page.wait_for_timeout(140)
    scale_page.locator('#drawerClose').click(); scale_page.wait_for_timeout(180)
    report['scale_3d_mobile_search_reframes'] = scale_page.locator('.three-cluster-label:not([aria-hidden="true"])').get_attribute('data-cluster') == 'scale-c23'
    mobile_cluster_rect = scale_page.locator('.three-cluster-label:not([aria-hidden="true"])').bounding_box()
    mobile_cell_rects = [scale_page.locator('.three-cell-label:not([aria-hidden="true"])').nth(index).bounding_box() for index in range(scale_page.locator('.three-cell-label:not([aria-hidden="true"])').count())]
    report['scale_3d_mobile_cluster_title_unobscured'] = scale_page.locator('.three-cluster-label:not([aria-hidden="true"])').get_attribute('data-position') == 'pinned' and all(
        min(mobile_cluster_rect['x'] + mobile_cluster_rect['width'], rect['x'] + rect['width']) - max(mobile_cluster_rect['x'], rect['x']) <= 1 or min(mobile_cluster_rect['y'] + mobile_cluster_rect['height'], rect['y'] + rect['height']) - max(mobile_cluster_rect['y'], rect['y']) <= 1
        for rect in mobile_cell_rects
    )
    scale_page.screenshot(path=str(audit / 'scale-3d-mobile-search-390x844.png'))
    errors.extend(scale_errors)
    scale_page.close()

    print('STAGE desktop spatial input, reduced motion and forced colors', flush=True)
    desktop_input_page = browser.new_page(viewport={'width': 1440, 'height': 900})
    desktop_input_errors = []
    desktop_input_page.on('console', lambda msg: desktop_input_errors.append(f'desktop-input-console:{msg.type}:{msg.text}') if msg.type == 'error' else None)
    desktop_input_page.on('pageerror', lambda exc: desktop_input_errors.append(f'desktop-input-pageerror:{exc}'))
    desktop_input_page.emulate_media(reduced_motion='reduce')
    desktop_input_page.route('https://hexmap-desktop-input.test/**', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
    desktop_input_page.goto('https://hexmap-desktop-input.test/?qa=reduced-motion', wait_until='load')
    desktop_input_page.evaluate("localStorage.setItem('hexmap-studio-onboarding-v1', 'seen'); localStorage.setItem('hexmap-view-mode', '2d')")
    desktop_input_page.reload(wait_until='load'); desktop_input_page.wait_for_timeout(520)

    desktop_wheel_before = desktop_input_page.evaluate('''() => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform);
      return { scale: m.a, worldX: (500 - m.e) / m.a, worldY: (420 - m.f) / m.a };
    }''')
    desktop_input_page.locator('#workspace').dispatch_event('wheel', {'deltaX': 0, 'deltaY': -120, 'deltaMode': 0, 'clientX': 500, 'clientY': 420})
    desktop_input_page.wait_for_timeout(220)
    desktop_wheel_after = desktop_input_page.evaluate('''() => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform);
      return { scale: m.a, worldX: (500 - m.e) / m.a, worldY: (420 - m.f) / m.a, viewport: HexMapStudio.getMap().layout.viewport };
    }''')
    report['desktop_wheel_zoom_keeps_anchor'] = desktop_wheel_after['scale'] > desktop_wheel_before['scale'] * 1.1 and abs(desktop_wheel_after['worldX'] - desktop_wheel_before['worldX']) < .2 and abs(desktop_wheel_after['worldY'] - desktop_wheel_before['worldY']) < .2
    report['desktop_wheel_zoom_persists'] = abs(desktop_wheel_after['viewport']['zoom'] - desktop_wheel_after['scale']) < .002

    desktop_horizontal_before = desktop_input_page.evaluate('''() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform); return { scale: m.a, tx: m.e, ty: m.f }; }''')
    desktop_input_page.locator('#workspace').dispatch_event('wheel', {'deltaX': 96, 'deltaY': 0, 'deltaMode': 0, 'clientX': 720, 'clientY': 450})
    desktop_input_page.wait_for_timeout(220)
    desktop_horizontal_after = desktop_input_page.evaluate('''() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform); return { scale: m.a, tx: m.e, ty: m.f }; }''')
    report['trackpad_horizontal_pans_without_zoom'] = abs(desktop_horizontal_after['scale'] - desktop_horizontal_before['scale']) < .002 and desktop_horizontal_after['tx'] < desktop_horizontal_before['tx'] - 90

    desktop_input_page.locator('.skip-link').focus(); desktop_input_page.keyboard.press('Enter'); desktop_input_page.wait_for_timeout(80)
    report['skip_link_focuses_canvas'] = desktop_input_page.evaluate("document.activeElement?.id === 'workspace'")
    report['keyboard_canvas_focus_visible'] = desktop_input_page.locator('#workspace').evaluate("e => getComputedStyle(e, '::after').content !== 'none' && parseFloat(getComputedStyle(e, '::after').borderTopWidth) >= 3")
    desktop_keyboard_before = desktop_input_page.evaluate('''() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform); return { scale: m.a, tx: m.e }; }''')
    desktop_input_page.keyboard.press('ArrowRight'); desktop_input_page.keyboard.press('Equal'); desktop_input_page.wait_for_timeout(220)
    desktop_keyboard_after = desktop_input_page.evaluate('''() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform); return { scale: m.a, tx: m.e, viewport: HexMapStudio.getMap().layout.viewport }; }''')
    report['keyboard_canvas_pan'] = desktop_keyboard_after['tx'] < desktop_keyboard_before['tx'] - 30
    report['keyboard_canvas_zoom'] = desktop_keyboard_after['scale'] > desktop_keyboard_before['scale'] * 1.1
    report['keyboard_viewport_persists'] = abs(desktop_keyboard_after['viewport']['zoom'] - desktop_keyboard_after['scale']) < .002
    desktop_saved_viewport = desktop_keyboard_after['viewport']
    desktop_input_page.reload(wait_until='load'); desktop_input_page.wait_for_timeout(420)
    desktop_reloaded_viewport = desktop_input_page.evaluate('''() => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform);
      return { scale: m.a, tx: m.e, ty: m.f };
    }''')
    report['desktop_viewport_survives_reload'] = abs(desktop_reloaded_viewport['scale'] - desktop_saved_viewport['zoom']) < .002 and abs(desktop_reloaded_viewport['tx'] - desktop_saved_viewport['x']) < .1 and abs(desktop_reloaded_viewport['ty'] - desktop_saved_viewport['y']) < .1
    desktop_center_before_resize = desktop_input_page.evaluate('''() => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform);
      return { x: (innerWidth / 2 - m.e) / m.a, y: (innerHeight / 2 - m.f) / m.a };
    }''')
    desktop_input_page.set_viewport_size({'width': 1280, 'height': 820}); desktop_input_page.wait_for_timeout(240)
    desktop_center_after_resize = desktop_input_page.evaluate('''() => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform);
      return { x: (innerWidth / 2 - m.e) / m.a, y: (innerHeight / 2 - m.f) / m.a };
    }''')
    report['desktop_resize_preserves_world_center'] = abs(desktop_center_after_resize['x'] - desktop_center_before_resize['x']) < .2 and abs(desktop_center_after_resize['y'] - desktop_center_before_resize['y']) < .2
    desktop_input_page.set_viewport_size({'width': 1440, 'height': 900}); desktop_input_page.wait_for_timeout(240)
    desktop_input_page.keyboard.press('0'); desktop_input_page.wait_for_timeout(240)
    desktop_input_page.locator('.skip-link').focus(); desktop_input_page.keyboard.press('Enter'); desktop_input_page.wait_for_timeout(80)
    report['keyboard_canvas_fit_restores_overview'] = desktop_input_page.evaluate('''() => {
      const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
      const bottom = document.querySelector('.statusbar').getBoundingClientRect().top;
      return [...document.querySelectorAll('.hex-node, [data-cluster-label]')].every((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= top && rect.bottom <= bottom;
      });
    }''')
    report['reduced_motion_css'] = desktop_input_page.evaluate('''() => {
      const duration = getComputedStyle(document.querySelector('#drawer')).transitionDuration.split(',').map(parseFloat);
      return matchMedia('(prefers-reduced-motion: reduce)').matches && duration.every((value) => value <= .001);
    }''')
    desktop_input_page.screenshot(path=str(audit / 'spatial-keyboard.png'))

    desktop_input_page.locator('#viewModeBtn').click(); desktop_input_page.wait_for_timeout(520)
    report['three_reduced_motion'] = desktop_input_page.locator('#threeCanvas').get_attribute('data-motion') == 'reduced'
    desktop_input_page.locator('#viewModeBtn').click(); desktop_input_page.wait_for_timeout(220)

    desktop_cancel_map = json.loads(json.dumps(initial_map))
    desktop_cancel_map['hexagons'] = [dict(desktop_cancel_map['hexagons'][0], q=0, r=0, clusterId=None)]
    desktop_cancel_map['clusters'] = []
    desktop_cancel_map['relations'] = []
    desktop_input_page.evaluate('(value) => HexMapStudio.setMap(value)', desktop_cancel_map); desktop_input_page.wait_for_timeout(420)
    desktop_cancel_before = desktop_input_page.evaluate('HexMapStudio.getMap().hexagons[0]')
    desktop_input_page.evaluate('''() => {
      const node = document.querySelector('.hex-node');
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 151, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 151, pointerType: 'mouse', button: 0, buttons: 1, clientX: x + 190, clientY: y + 80 }));
      window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerId: 151, pointerType: 'mouse', button: 0, buttons: 0, clientX: x + 190, clientY: y + 80 }));
    }''')
    desktop_input_page.wait_for_timeout(180)
    desktop_cancel_after = desktop_input_page.evaluate('HexMapStudio.getMap().hexagons[0]')
    report['pointer_cancel_reverts_drag'] = desktop_cancel_after['q'] == desktop_cancel_before['q'] and desktop_cancel_after['r'] == desktop_cancel_before['r'] and not desktop_input_page.locator('#workspace').evaluate("e => e.classList.contains('panning') || e.classList.contains('pinching')") and desktop_input_page.locator('.hex-node.dragging').count() == 0

    desktop_input_page.emulate_media(reduced_motion='reduce', forced_colors='active'); desktop_input_page.wait_for_timeout(260)
    desktop_input_page.locator('.hex-node').first.click(); desktop_input_page.wait_for_timeout(180)
    report['forced_colors_active'] = desktop_input_page.evaluate("matchMedia('(forced-colors: active)').matches")
    report['forced_colors_structure_visible'] = desktop_input_page.evaluate('''() => {
      const topbar = getComputedStyle(document.querySelector('.topbar'));
      const border = getComputedStyle(document.querySelector('.hex-border'));
      const selected = getComputedStyle(document.querySelector('.hex-node.selected'));
      return parseFloat(topbar.borderTopWidth) >= 1 && border.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(selected.outlineWidth) >= 3;
    }''')
    desktop_input_page.screenshot(path=str(audit / 'forced-colors.png'))
    errors.extend(desktop_input_errors)
    desktop_input_page.close()

    print('STAGE touch compatibility regression', flush=True)
    interaction_context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    interaction_page = interaction_context.new_page()
    interaction_errors = []
    interaction_page.on('console', lambda msg: interaction_errors.append(f'interaction-console:{msg.type}:{msg.text}') if msg.type == 'error' else None)
    interaction_page.on('pageerror', lambda exc: interaction_errors.append(f'interaction-pageerror:{exc}'))
    interaction_page.emulate_media(reduced_motion='reduce')
    interaction_page.route('https://hexmap-spatial.test/**', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
    interaction_page.goto('https://hexmap-spatial.test/?qa=reduced-motion', wait_until='load')
    interaction_page.evaluate("localStorage.setItem('hexmap-studio-onboarding-v1', 'seen'); localStorage.setItem('hexmap-view-mode', '2d')")
    interaction_page.reload(wait_until='load'); interaction_page.wait_for_timeout(760)
    pinch_before = interaction_page.evaluate('''() => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform);
      return { scale: matrix.a, tx: matrix.e, ty: matrix.f, worldX: (195 - matrix.e) / matrix.a, worldY: (450 - matrix.f) / matrix.a };
    }''')
    interaction_cdp = interaction_context.new_cdp_session(interaction_page)
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 125, 'y': 450, 'id': 41}, {'x': 265, 'y': 450, 'id': 42}]})
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 65, 'y': 450, 'id': 41}, {'x': 325, 'y': 450, 'id': 42}]})
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    interaction_page.wait_for_timeout(260)
    pinch_after = interaction_page.evaluate('''() => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform);
      const viewport = HexMapStudio.getMap().layout.viewport;
      return { scale: matrix.a, tx: matrix.e, ty: matrix.f, worldX: (195 - matrix.e) / matrix.a, worldY: (450 - matrix.f) / matrix.a, viewport };
    }''')
    report['touch_pinch_zooms'] = pinch_after['scale'] > pinch_before['scale'] * 1.45
    report['touch_pinch_keeps_anchor'] = abs(pinch_after['worldX'] - pinch_before['worldX']) < 1 and abs(pinch_after['worldY'] - pinch_before['worldY']) < 1
    report['touch_pinch_persists_viewport'] = abs(pinch_after['viewport']['zoom'] - pinch_after['scale']) < .002 and abs(pinch_after['viewport']['x'] - pinch_after['tx']) < .1 and abs(pinch_after['viewport']['y'] - pinch_after['ty']) < .1
    interaction_page.screenshot(path=str(audit / 'spatial-touch-pinch.png'))

    horizontal_before = interaction_page.evaluate('''() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform); return { scale: m.a, tx: m.e, ty: m.f }; }''')
    interaction_page.locator('#workspace').dispatch_event('wheel', {'deltaX': 96, 'deltaY': 0, 'deltaMode': 0, 'clientX': 195, 'clientY': 450})
    interaction_page.wait_for_timeout(220)
    horizontal_after = interaction_page.evaluate('''() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform); return { scale: m.a, tx: m.e, ty: m.f }; }''')
    report['touch_context_horizontal_pan_without_zoom'] = abs(horizontal_after['scale'] - horizontal_before['scale']) < .002 and horizontal_after['tx'] < horizontal_before['tx'] - 90

    cancel_map = json.loads(json.dumps(initial_map))
    cancel_map['hexagons'] = [dict(cancel_map['hexagons'][0], q=0, r=0, clusterId=None)]
    cancel_map['clusters'] = []
    cancel_map['relations'] = []
    interaction_page.evaluate('(value) => HexMapStudio.setMap(value)', cancel_map); interaction_page.wait_for_timeout(520)
    cancel_before = interaction_page.evaluate('HexMapStudio.getMap().hexagons[0]')
    interaction_page.evaluate('''() => {
      const node = document.querySelector('.hex-node');
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 51, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 51, pointerType: 'mouse', button: 0, buttons: 1, clientX: x + 190, clientY: y + 80 }));
      window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerId: 51, pointerType: 'mouse', button: 0, buttons: 0, clientX: x + 190, clientY: y + 80 }));
    }''')
    interaction_page.wait_for_timeout(180)
    cancel_after = interaction_page.evaluate('HexMapStudio.getMap().hexagons[0]')
    report['touch_context_pointer_cancel_reverts_drag'] = cancel_after['q'] == cancel_before['q'] and cancel_after['r'] == cancel_before['r'] and not interaction_page.locator('#workspace').evaluate("e => e.classList.contains('panning') || e.classList.contains('pinching')") and interaction_page.locator('.hex-node.dragging').count() == 0

    touch_node_box = interaction_page.locator('.hex-node').bounding_box()
    touch_node_x = touch_node_box['x'] + touch_node_box['width'] / 2
    touch_node_y = touch_node_box['y'] + touch_node_box['height'] / 2
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': touch_node_x, 'y': touch_node_y, 'id': 71}]})
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': touch_node_x + 165, 'y': touch_node_y + 20, 'id': 71}]})
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    interaction_page.wait_for_timeout(240)
    touch_drag_after = interaction_page.evaluate('HexMapStudio.getMap().hexagons[0]')
    report['touch_drag_moves_once'] = touch_drag_after['q'] != cancel_before['q'] or touch_drag_after['r'] != cancel_before['r']
    interaction_page.keyboard.press('Meta+z'); interaction_page.wait_for_timeout(180)
    touch_drag_undo = interaction_page.evaluate('HexMapStudio.getMap().hexagons[0]')
    report['touch_drag_is_undoable'] = touch_drag_undo['q'] == cancel_before['q'] and touch_drag_undo['r'] == cancel_before['r']

    touch_pan_before = interaction_page.evaluate('''() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform); return { tx: m.e, ty: m.f }; }''')
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 32, 'y': 700, 'id': 81}]})
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 92, 'y': 742, 'id': 81}]})
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    interaction_page.wait_for_timeout(220)
    touch_pan_after = interaction_page.evaluate('''() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#world')).transform); return { tx: m.e, ty: m.f, viewport: HexMapStudio.getMap().layout.viewport }; }''')
    report['touch_pan_moves_canvas'] = touch_pan_after['tx'] > touch_pan_before['tx'] + 50 and touch_pan_after['ty'] > touch_pan_before['ty'] + 30
    report['touch_pan_persists_viewport'] = abs(touch_pan_after['viewport']['x'] - touch_pan_after['tx']) < .1 and abs(touch_pan_after['viewport']['y'] - touch_pan_after['ty']) < .1

    interaction_page.locator('#viewModeBtn').click(); interaction_page.wait_for_timeout(520)
    three_touch_before = float(interaction_page.locator('#threeCanvas').get_attribute('data-camera-zoom'))
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 125, 'y': 520, 'id': 61}, {'x': 265, 'y': 520, 'id': 62}]})
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 65, 'y': 520, 'id': 61}, {'x': 325, 'y': 520, 'id': 62}]})
    interaction_cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    interaction_page.wait_for_timeout(320)
    three_touch_after = float(interaction_page.locator('#threeCanvas').get_attribute('data-camera-zoom'))
    report['three_touch_pinch_zooms'] = three_touch_after > three_touch_before * 1.15
    interaction_page.screenshot(path=str(audit / 'spatial-3d-touch-pinch.png'))
    errors.extend(interaction_errors)
    interaction_page.close()
    interaction_context.close()

    # localStorage is exercised by the application when served from a normal origin;
    # navigation to local origins is blocked in this execution environment.

    report['errors'] = errors
    browser.close()

(previews / 'browser-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))

assert report['version'] == '10.3.0'
assert report['initial_nodes'] == 48
assert report['initial_clusters'] == 6
assert report['initial_relations'] == 6
assert report['initial_annotations'] == 0
assert report['global_controls_precede_canvas'] is True
assert report['desktop_primary_actions_named'] is True
assert report['desktop_secondary_actions_collapsed'] is True
assert report['desktop_more_actions_visible'] is True
assert report['desktop_more_actions_are_textual'] is True
assert report['desktop_more_keyboard_focus_enters'] is True
assert report['desktop_more_arrow_navigation'] is True
assert report['desktop_more_escape_returns_focus'] is True
assert report['governance_label_above'] is True
assert report['governance_label_stable_after_small_move'] is True
assert report['empty_project_action_visible'] is True
assert report['empty_project_cta_waits_for_canvas'] is True
assert report['empty_project_canvas_receives_focus'] is True
assert report['empty_project_first_hex_created'] is True
assert report['desktop_new_project_cancel_named'] is True
assert report['desktop_new_project_title_starts_blank'] is True
assert report['desktop_new_project_cancel_preserves_map'] is True
assert report['desktop_journey_uses_specific_default'] is True
assert report['desktop_new_project_resets_tool'] is True
assert report['desktop_new_project_explains_undo'] is True
assert report['desktop_new_project_is_undoable'] is True
assert report['desktop_custom_empty_project_named'] is True
assert report['desktop_empty_hint_visible'] is True
assert report['desktop_empty_keyboard_arms_canvas'] is True
assert report['desktop_empty_escape_disarms_canvas'] is True
assert report['desktop_escape_commits_text_edit'] is True
assert report['desktop_escape_edit_is_undoable'] is True
assert report['desktop_field_options_progressive'] is True
assert report['desktop_field_options_revealed'] is True
assert report['desktop_field_enter_creates'] is True
assert report['desktop_field_delete_explains_impact'] is True
assert report['desktop_field_delete_removes_definition_and_value'] is True
assert report['desktop_field_delete_is_undoable'] is True
assert report['desktop_annotation_range_has_value'] is True
assert report['desktop_annotation_range_retains_focus'] is True
assert report['desktop_annotation_range_is_undoable'] is True
assert report['desktop_search_finds_annotation'] is True
assert report['desktop_search_annotation_opens_drawer'] is True
assert report['desktop_overlay_range_has_value'] is True
assert report['desktop_overlay_range_retains_focus'] is True
assert report['desktop_overlay_range_is_undoable'] is True
assert report['auto_route_hard_collisions'] == 0
assert report['three_cluster_click_opens_drawer'] is True
assert report['three_cluster_color_changed'] is True
assert report['three_hex_color_changed'] is True
assert report['three_hex_inherit_available'] is True
assert report['three_sparse_cell_visible'] is True
assert report['three_move_commits_on_drop'] is True
assert report['three_move_has_no_confirmation'] is True
assert report['three_add_created'] is True
assert report['three_add_opens_editor'] is True
assert report['three_new_cell_has_label'] is True
assert report['drag_preserves_grab_offset'] is True
assert report['auto_cluster_toggle_visible'] is True
assert report['auto_cluster_toggle_off'] is True
assert report['tiling_stays_clusterless'] is True
assert report['tooltip_visible'] is True
assert report['entity_drawer'] is True
assert report['markdown_preview'] is True
assert report['focus_reading'] is True
assert report['custom_field_created'] is True
assert report['custom_field_value'] == 'alta'
assert report['tags_updated'] is True
assert report['field_color_rule'] == 'status'
assert report['style_color_inputs'] >= 1
assert report['image_uploaded'] is True
assert report['image_mode'] == 'icon'
assert report['relation_drawer'] is True
assert report['routing_handle'] is True
assert report['desktop_routing_range_keyboard_updates'] is True
assert report['desktop_routing_range_retains_focus'] is True
assert report['manual_curve_flip'] is True
assert report['routing_mode_after_flip'] == 'assisted'
assert report['routing_reset_auto'] == 'auto'
assert report['cluster_drag_changed'] is True
assert report['cluster_drag_member_count'] == 7
assert report['annotation_created'] is True
assert report['axes_layout'] == 'axes'
assert report['axis_main'] == 1
assert report['axes_cluster_keys'] == 6
assert report['axes_hulls_hidden'] == 0
assert report['new_relation_count'] == 7
assert report['mosaic_layout'] == 'mosaic'
assert report['mosaic_hulls_hidden'] is True
assert report['hex_relation_count'] >= 1
assert report['clusters_grouped_by_field'] >= 2
assert report['export_schema_version'] == '1.0.0'
assert report['export_has_positions'] is True
assert report['export_has_routing'] is True
assert report['export_has_fields'] is True
assert report['export_has_visuals'] is True
assert report['export_has_viewport'] is True
assert report['published_html_standalone'] is True
assert report['published_svg_standalone'] is True
assert report['published_svg_preserves_image'] is True
assert report['published_svg_preserves_annotation'] is True
assert report['published_html_renders_fidelity'] is True
assert report['import_roundtrip'] is True
assert report['import_preserves_viewport'] is True
assert report['workspace_panel'] is True
assert report['project_disclosure_semantics'] is True
assert report['search_result_count'] == 1
assert report['search_dims_nonmatches'] is True
assert report['search_ignores_diacritics'] is True
assert report['desktop_search_keyboard_enters_results'] is True
assert report['desktop_search_selection_closes_disclosure'] is True
assert report['desktop_search_finds_cluster'] is True
assert report['desktop_search_cluster_opens_drawer'] is True
assert report['desktop_search_finds_relation'] is True
assert report['desktop_search_relation_opens_drawer'] is True
assert report['desktop_search_no_results_guidance'] is True
assert report['workspace_bundle_nodes'] == 2
assert report['workspace_bundle_title'] == 'Exemplo Local-first'
assert report['workspace_bundle_connected'] is True
assert report['workspace_export_format'] == 'hexmap-workspace'
assert report['workspace_export_markdown'] is True
assert report['workspace_bundle_export_marks_clean'] is True
assert report['workspace_bundle_dirty_announced'] is True
assert report['dirty_workspace_blocks_json_import'] is True
assert report['dirty_workspace_blocks_reset'] is True
assert report['dirty_workspace_blocks_new_project'] is True
assert report['dirty_workspace_blocks_detach'] is True
assert report['workspace_content_survives_view_switch'] is True
assert report['workspace_default_view_preserved'] is True
assert report['workspace_new_view_preserved'] is True
assert report['workspace_dirty_survives_view_switch'] is True
assert report['workspace_multiview_export_complete'] is True
assert report['workspace_updated_export_marks_clean'] is True
assert report['workspace_multiview_reimport_active'] is True
assert report['workspace_multiview_reimport_content'] is True
assert report['workspace_view_title_preserved'] is True
assert report['workspace_project_title_preserved'] is True
assert report['workspace_reimport_status_clean'] is True
assert report['workspace_view_label_visually_hidden'] is True
assert report['clean_reset_disconnects_workspace'] is True
assert report['onboarding_modal_inert'] is True
assert report['onboarding_focus_inside'] is True
assert report['onboarding_footer_visible_when_scrolls'] is True
assert report['onboarding_modal_closed'] is True
assert report['responsive_all_inside'] is True
assert report['responsive_compact_boundary'] is True
assert report['responsive_short_landscape_focal'] is True
assert report['zoom_200_layout_equivalent'] is True
assert report['help_short_mobile_inside'] is True
assert report['help_short_mobile_scrollable'] is True
assert report['help_disclosure_semantics'] is True
assert report['governance_label_top_at_1440'] is True
assert report['drawer_keyboard_focus_enters'] is True
assert report['drawer_context_label'] is True
assert report['drawer_live_region_scoped'] is True
assert report['drawer_tabs_arrow_navigation'] is True
assert report['drawer_keyboard_focus_returns'] is True
assert report['tool_hint_retires_after_use'] is True
assert report['search_focus_enters'] is True
assert report['search_disclosure_semantics'] is True
assert report['search_escape_closes_and_returns'] is True
assert report['help_focus_enters'] is True
assert report['help_escape_closes_and_returns'] is True
assert report['tool_toggle_semantics'] is True
assert report['drawer_preserves_selected_context'] is True
assert report['three_drawer_reserves_canvas'] is True
assert report['three_selected_context_visible'] is True
assert report['three_intermediate_keeps_canvas'] is True
assert report['three_intermediate_drawer_flips_left'] is True
assert report['three_intermediate_selected_visible'] is True
assert report['three_short_landscape_label_count'] == 54
assert report['three_short_landscape_focal'] is True
assert report['three_short_landscape_unobscured'] is True
assert report['three_short_landscape_search_reframes'] is True
assert report['three_short_landscape_note'] is True
assert report['three_mobile_all_cells_inside'] is True
assert report['three_mobile_cluster_count'] == 6
assert report['three_mobile_drawer_inside'] is True
assert report['three_mobile_tabs_visible'] is True
assert report['mobile_search_in_overflow'] is True
assert report['mobile_settings_in_overflow'] is True
assert report['mobile_search_opens'] is True
assert report['mobile_settings_opens'] is True
assert report['settings_disclosure_semantics'] is True
assert report['keyboard_help'] is True
assert report['closed_drawer_hidden'] is True
assert report['tablet_overflow_menu'] is True
assert report['presentation_read_only'] is True
assert report['presentation_chrome_clean'] is True
assert report['presentation_titles_preserve_words'] is True
assert report['presentation_titles_unclipped'] is True
assert report['presentation_cluster_labels_inside'] is True
assert report['presentation_tooltip_inside'] is True
assert report['desktop_3d_search_dims_nonmatches'] is True
assert report['desktop_3d_search_selects_cluster'] is True
assert report['desktop_3d_cluster_context_unobscured'] is True
assert report['desktop_3d_search_dims_other_relations'] is True
assert report['desktop_3d_search_selects_relation'] is True
assert report['desktop_3d_relation_endpoints_visible'] is True
assert report['desktop_3d_search_disclosure_closes'] is True
assert report['three_keyboard_multiselect'] is True
assert report['three_multiselect_visual_state'] is True
assert report['multiselect_announced'] is True
assert report['multiselect_escape_clears'] is True
assert report['three_multiselect_forms_cluster'] is True
assert report['history_undo_cluster'] is True
assert report['three_cluster_ignores_foreign_pointer_cancel'] is True
assert report['three_cluster_cancel_reverts_drag'] is True
assert report['three_cluster_cancel_restores_camera'] is True
assert report['three_connect_source_feedback'] is True
assert report['three_connect_creates_relation'] is True
assert report['three_connect_returns_to_move'] is True
assert report['history_undo_relation'] is True
assert report['history_redo_relation'] is True
assert report['three_hex_connect_creates_relation'] is True
assert report['three_hex_connect_renders_relation'] is True
assert report['entity_delete_from_content_context'] is True
assert report['entity_delete_cascades_relations'] is True
assert report['entity_delete_explains_undo'] is True
assert report['history_undo_entity_delete'] is True
assert report['corrupt_storage_not_overwritten'] is True
assert report['corrupt_storage_prior_backup_preserved'] is True
assert report['corrupt_storage_backup_preserved'] is True
assert report['corrupt_storage_named_recovery'] is True
assert report['corrupt_storage_download_exact'] is True
assert report['corrupt_storage_new_map_after_backup'] is True
assert report['corrupt_storage_recovery_closes'] is True
assert report['recovery_banner_named_region'] is True
assert report['recovery_banner_inside_mobile'] is True
assert report['recovery_restore_roundtrip'] is True
assert report['recovery_restore_persisted'] is True
assert report['recovery_dismiss_preserves_current'] is True
assert report['view_mode_persists_on_normal_origin'] is True
assert 0 < report['three_first_render_ms'] < 1500
assert 0 <= report['three_render_p95_ms'] < 100
assert report['three_render_triangles'] > 0
assert report['three_lifecycle_cycles'] == 20
assert report['three_lifecycle_peak_textures'] <= 12
assert report['three_lifecycle_peak_geometries'] <= 16
assert report['three_context_loss_hook_called'] is True
assert report['three_context_loss_falls_back_to_2d'] is True
assert report['three_context_loss_explained'] is True
assert 0 < report['scale_2d_render_ms'] < 2500
assert report['scale_2d_nodes'] == 192
assert report['scale_2d_clusters'] == 24
assert report['scale_2d_fit_below_legacy_floor'] is True
assert report['scale_2d_territories_unobscured'] is True
assert report['scale_2d_semantic_overview'] is True
assert report['scale_2d_cluster_titles_legible'] is True
assert report['scale_header_title_contained'] is True
assert report['scale_long_cluster_title_clamped'] is True
assert report['scale_search_initial_window'] is True
assert report['scale_search_second_window'] is True
assert report['scale_search_complete_window'] is True
assert report['scale_search_accentless_unique'] is True
assert report['scale_long_drawer_title_contained'] is True
assert report['scale_long_drawer_title_clamped'] is True
assert report['scale_export_complete'] is True
assert report['malformed_import_preserves_map'] is True
assert report['scale_local_storage_complete'] is True
assert report['scale_3d_cluster_count'] == 24
assert report['scale_3d_long_cluster_title_clamped'] is True
assert report['scale_3d_cluster_labels_inside'] is True
assert report['scale_3d_cluster_labels_nonoverlap'] is True
assert report['scale_3d_label_lod'] is True
assert 0 < report['scale_3d_first_render_ms'] < 2500
assert report['scale_3d_mobile_focal'] is True
assert report['scale_3d_mobile_search_reframes'] is True
assert report['scale_3d_mobile_cluster_title_unobscured'] is True
assert report['touch_pinch_zooms'] is True
assert report['touch_pinch_keeps_anchor'] is True
assert report['touch_pinch_persists_viewport'] is True
assert report['trackpad_horizontal_pans_without_zoom'] is True
assert report['desktop_wheel_zoom_keeps_anchor'] is True
assert report['desktop_wheel_zoom_persists'] is True
assert report['pointer_cancel_reverts_drag'] is True
assert report['touch_drag_moves_once'] is True
assert report['touch_drag_is_undoable'] is True
assert report['touch_pan_moves_canvas'] is True
assert report['touch_pan_persists_viewport'] is True
assert report['keyboard_canvas_pan'] is True
assert report['keyboard_canvas_zoom'] is True
assert report['keyboard_viewport_persists'] is True
assert report['desktop_viewport_survives_reload'] is True
assert report['desktop_resize_preserves_world_center'] is True
assert report['keyboard_canvas_fit_restores_overview'] is True
assert report['skip_link_focuses_canvas'] is True
assert report['keyboard_canvas_focus_visible'] is True
assert report['reduced_motion_css'] is True
assert report['three_reduced_motion'] is True
assert report['three_touch_pinch_zooms'] is True
assert report['forced_colors_active'] is True
assert report['forced_colors_structure_visible'] is True
assert report['errors'] == []
