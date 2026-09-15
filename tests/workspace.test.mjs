import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutManifest, createPortableBundle, createWorkspaceMap, createWikilinkRelations, listWorkspaceViews, openDirectoryWorkspace, openPortableBundle, parseNote, saveDirectoryWorkspace, selectWorkspaceView, serializeNote, stableNoteId, synchronizeWorkspaceNotes, validateSourcePath, workspaceDiagnostics } from '../workspace.js';

class MemoryFile {
  constructor(text = '') { this.kind = 'file'; this.text = text; }
  async getFile() { return { text: async () => this.text }; }
  async createWritable() { return { write: async (text) => { this.text = String(text); }, close: async () => {} }; }
}

class MemoryDirectory {
  constructor(name = 'workspace') { this.kind = 'directory'; this.name = name; this.children = new Map(); }
  async *entries() { yield* this.children.entries(); }
  async getDirectoryHandle(name, options = {}) {
    if (!this.children.has(name) && options.create) this.children.set(name, new MemoryDirectory(name));
    const child = this.children.get(name); if (!child || child.kind !== 'directory') throw new Error(`Directory not found: ${name}`); return child;
  }
  async getFileHandle(name, options = {}) {
    if (!this.children.has(name) && options.create) this.children.set(name, new MemoryFile());
    const child = this.children.get(name); if (!child || child.kind !== 'file') throw new Error(`File not found: ${name}`); return child;
  }
  async removeEntry(name) { if (!this.children.delete(name)) throw new Error(`Entry not found: ${name}`); }
}

class FailingFile extends MemoryFile {
  async createWritable() { return { write: async () => { throw new Error('simulated write failure'); }, close: async () => {} }; }
}

const notes = [
  parseNote(`---\nid: autonomia\ntitle: Autonomia\ncluster: trabalho\ntags: [poder, decisão]\nstatus: review\npropriedade-desconhecida: preservada\n---\n\n# Autonomia\n\nCorpo **Markdown**.`, 'notas/autonomia.md'),
  parseNote(`---\nid: governanca\ntitle: Governança\ncluster: estrutura\n---\n\n# Governança`, 'notas/governanca.md'),
];

test('workspace projects Markdown notes into a complete map', () => {
  const map = createWorkspaceMap(notes, {}, { id: 'projeto', title: 'Projeto' });
  assert.equal(map.hexagons.length, 2);
  assert.equal(map.clusters.length, 2);
  assert.equal(map.hexagons[0].sourcePath, 'notas/autonomia.md');
  assert.equal(map.hexagons[0].fields.status, 'review');
  assert.ok(map.fieldDefinitions.some((field) => field.key === 'status'));
});

test('plain Markdown uses deterministic path ids and remains frontmatter-free when unchanged', () => {
  const first = parseNote('# Título humano\n\nCorpo com [[Outra nota]].', 'Pasta/Minha Nota.md');
  const second = parseNote('# Título humano\n\nOutro corpo.', 'Pasta/Minha Nota.md');
  assert.equal(first.id, stableNoteId('Pasta/Minha Nota.md'));
  assert.equal(first.id, second.id);
  assert.equal(first.title, 'Título humano');
  assert.equal(first.hasFrontmatter, false);
  const entity = createWorkspaceMap([first]).hexagons[0];
  assert.equal(serializeNote(entity, {}), '# Título humano\n\nCorpo com [[Outra nota]].\n');
  assert.doesNotMatch(serializeNote(entity, {}), /^---/);
});

test('wikilinks are optional hexagon relations with actionable diagnostics', () => {
  const linked = [
    parseNote('# Origem\n\n[[Destino|segue]] e [[Ausente]].', 'notas/origem.md'),
    parseNote('# Destino', 'notas/destino.md'),
    parseNote('# Repetida', 'area-a/repetida.md'),
    parseNote('# Repetida', 'area-b/repetida.md'),
    parseNote('# Ambígua\n\n[[repetida]]', 'notas/ambigua.md'),
  ];
  assert.equal(createWorkspaceMap(linked).relations.length, 0);
  const imported = createWikilinkRelations(linked);
  assert.equal(imported.length, 1);
  assert.deepEqual(imported[0], {
    id: imported[0].id,
    source: linked[0].id,
    target: linked[1].id,
    sourceType: 'hexagon', targetType: 'hexagon', type: 'wikilink', label: 'segue', style: 'curve',
    routing: { mode: 'auto', offset: { along: 0, perpendicular: 0 }, waypoints: [], locked: false },
    imported: true,
  });
  const diagnostics = workspaceDiagnostics(linked, {}, { importWikilinks: true });
  assert.ok(diagnostics.some((issue) => issue.code === 'wikilink-missing' && issue.target === 'Ausente'));
  assert.ok(diagnostics.some((issue) => issue.code === 'wikilink-ambiguous' && issue.target === 'repetida'));
});

test('workspace manifest contains layout but not Markdown bodies', () => {
  const manifest = createLayoutManifest(createWorkspaceMap(notes));
  assert.ok(manifest.hexagons.every((item) => !Object.hasOwn(item, 'bodyMarkdown')));
  assert.ok(manifest.hexagons.every((item) => item.sourcePath));
});

test('portable bundle round-trips notes, unknown frontmatter and layout', () => {
  const map = createWorkspaceMap(notes, {}, { id: 'projeto', title: 'Projeto' });
  const originals = new Map(notes.map((note) => [note.id, note.originalFrontmatter]));
  const restored = openPortableBundle(createPortableBundle(map, originals));
  assert.equal(restored.map.title, 'Projeto');
  assert.equal(restored.name, 'Projeto');
  assert.equal(restored.map.hexagons.find((item) => item.id === 'autonomia').fields['propriedade-desconhecida'], 'preservada');
  assert.match(serializeNote(restored.map.hexagons[0], restored.originals.get('autonomia')), /propriedade-desconhecida: preservada/);
});

test('portable bundle round-trips multiple views without duplicating Markdown', async () => {
  const defaultMap = createWorkspaceMap(notes, {}, { id: 'projeto', title: 'Projeto' });
  defaultMap.hexagons[0].visual.color = '#335577';
  const defaultManifest = createLayoutManifest(defaultMap);
  const journeyMap = structuredClone(defaultMap);
  journeyMap.hexagons[0].visual.color = '#aa5522';
  journeyMap.activeViewId = 'jornada';
  journeyMap.layout = { ...journeyMap.layout, mode: 'mosaic', showClusterHulls: false, viewport: { x: 90, y: 40, zoom: 1.4 } };
  journeyMap.views = [
    { id: 'default', title: 'Mapa principal', mode: 'territories', showClusterHulls: true, layout: defaultMap.layout },
    { id: 'jornada', title: 'Jornada', mode: 'mosaic', showClusterHulls: false, layout: journeyMap.layout },
  ];
  const journeyManifest = createLayoutManifest(journeyMap);
  const viewManifests = new Map([['default', defaultManifest], ['jornada', journeyManifest]]);
  const bundle = createPortableBundle(journeyMap, new Map(notes.map((note) => [note.id, note.originalFrontmatter])), { viewManifests, activeViewId: 'jornada' });
  assert.ok(bundle.files['.hexmap/map.json']);
  assert.ok(bundle.files['.hexmap/views/jornada.json']);
  assert.equal(Object.keys(bundle.files).filter((path) => path.endsWith('.md')).length, notes.length);
  assert.deepEqual(JSON.parse(bundle.files['.hexmap/map.json']).views.map((view) => view.id), ['default', 'jornada']);
  const restored = openPortableBundle(bundle);
  assert.equal(restored.activeViewId, 'jornada');
  assert.equal(restored.name, 'Projeto');
  assert.deepEqual(listWorkspaceViews(restored).map((view) => view.id), ['default', 'jornada']);
  assert.equal(listWorkspaceViews(restored).find((view) => view.id === 'jornada').title, 'Jornada');
  assert.equal(restored.map.layout.mode, 'mosaic');
  restored.map.hexagons[0].title = 'Autonomia revisada';
  restored.map.hexagons[0].bodyMarkdown = '# Autonomia revisada\n\nConteúdo editado antes da troca.';
  synchronizeWorkspaceNotes(restored, restored.map);
  const defaultView = await selectWorkspaceView(restored, 'default');
  assert.equal(defaultView.activeViewId, 'default');
  assert.equal(defaultView.layout.mode, 'territories');
  assert.equal(defaultView.hexagons.length, notes.length);
  assert.equal(defaultView.hexagons[0].title, 'Autonomia revisada');
  assert.match(defaultView.hexagons[0].bodyMarkdown, /Conteúdo editado antes da troca/);
  assert.equal(defaultView.hexagons[0].visual.color, '#335577');
  assert.throws(() => createPortableBundle(journeyMap), /Catálogo de views necessário/);
});

test('diagnostics reject duplicate ids', () => {
  const duplicated = [...notes, { ...notes[0], sourcePath: 'duplicada.md' }];
  assert.ok(workspaceDiagnostics(duplicated).some((issue) => issue.code === 'duplicate-id'));
});

test('source paths stay relative Markdown files', () => {
  assert.equal(validateSourcePath('notas/ideias.md'), 'notas/ideias.md');
  assert.equal(validateSourcePath('notas\\ideias.md'), 'notas/ideias.md');
  for (const path of ['../fora.md', '/tmp/fora.md', 'C:/fora.md', '.hexmap/map.md', 'notas/../fora.md', 'notas/ideias.txt']) {
    assert.throws(() => validateSourcePath(path));
  }
});

test('portable bundle rejects unsafe file entries before projection', () => {
  assert.throws(() => openPortableBundle({ format: 'hexmap-workspace', version: '1.0.0', files: { '../escape.md': '# nope' } }));
});

test('directory workspace detects an external Markdown edit without overwriting it', async () => {
  const root = new MemoryDirectory('Projeto');
  const notesDirectory = await root.getDirectoryHandle('notas', { create: true });
  notesDirectory.children.set('autonomia.md', new MemoryFile(`---\nid: autonomia\ntitle: Autonomia\n---\n\n# Autonomia`));
  notesDirectory.children.set('governanca.md', new MemoryFile(`---\nid: governanca\ntitle: Governança\n---\n\n# Governança`));
  const loaded = await openDirectoryWorkspace(root);
  notesDirectory.children.get('governanca.md').text += '\n\nEditado fora.';
  loaded.map.hexagons[0].bodyMarkdown = '# Autonomia\n\nMudança no mapa.';
  await assert.rejects(() => saveDirectoryWorkspace(loaded, loaded.map), (error) => error.code === 'WORKSPACE_CONFLICT');
  assert.match(notesDirectory.children.get('autonomia.md').text, /# Autonomia/);
  assert.doesNotMatch(notesDirectory.children.get('autonomia.md').text, /Mudança no mapa/);
  assert.match(notesDirectory.children.get('governanca.md').text, /Editado fora/);
});

test('directory workspace reads and writes Markdown, project YAML and layout manifest', async () => {
  const root = new MemoryDirectory('Projeto');
  const notesDirectory = await root.getDirectoryHandle('notas', { create: true });
  notesDirectory.children.set('autonomia.md', new MemoryFile(`---\nid: autonomia\ntitle: Autonomia\ncluster: trabalho\ncustom: preservado\n---\n\n# Autonomia`));
  const loaded = await openDirectoryWorkspace(root);
  assert.equal(loaded.map.hexagons.length, 1);
  loaded.map.hexagons[0].bodyMarkdown = '# Autonomia\n\nConteúdo editado.';
  await saveDirectoryWorkspace(loaded, loaded.map);
  assert.match(notesDirectory.children.get('autonomia.md').text, /Conteúdo editado/);
  assert.match(notesDirectory.children.get('autonomia.md').text, /custom: preservado/);
  assert.ok((await root.getDirectoryHandle('.hexmap')).children.has('map.json'));
  assert.match((await root.getFileHandle('hexmap.yaml')).text, /title: Projeto HexMap/);
});

test('directory workspace keeps one Markdown corpus across default and extra view files', async () => {
  const root = new MemoryDirectory('Projeto');
  const notesDirectory = await root.getDirectoryHandle('notas', { create: true });
  notesDirectory.children.set('passo.md', new MemoryFile('# Passo\n\nConteúdo único.'));
  const internal = await root.getDirectoryHandle('.hexmap', { create: true });
  const viewsDirectory = await internal.getDirectoryHandle('views', { create: true });
  const base = createWorkspaceMap([parseNote('# Passo\n\nConteúdo único.', 'notas/passo.md')], {}, { id: 'roteiro', title: 'Roteiro' });
  const defaultManifest = createLayoutManifest(base);
  const journey = structuredClone(base);
  journey.activeViewId = 'jornada';
  journey.layout = { ...journey.layout, mode: 'mosaic', showClusterHulls: false, viewport: { x: 12, y: 34, zoom: 1.25 } };
  journey.views = [
    { id: 'default', title: 'Mapa principal', mode: 'territories', showClusterHulls: true, layout: base.layout },
    { id: 'jornada', title: 'Jornada', mode: 'mosaic', showClusterHulls: false, layout: journey.layout },
  ];
  internal.children.set('map.json', new MemoryFile(`${JSON.stringify(defaultManifest)}\n`));
  viewsDirectory.children.set('jornada.json', new MemoryFile(`${JSON.stringify(createLayoutManifest(journey))}\n`));
  root.children.set('hexmap.yaml', new MemoryFile('version: 1.0.0\nid: roteiro\ntitle: Roteiro\nactiveView: jornada\n'));
  const loaded = await openDirectoryWorkspace(root);
  assert.equal(loaded.activeViewId, 'jornada');
  assert.equal(loaded.map.layout.mode, 'mosaic');
  assert.deepEqual(listWorkspaceViews(loaded).map((view) => view.id), ['default', 'jornada']);
  loaded.map.layout.viewport.x = 99;
  loaded.viewManifests.get('default').layout.viewport.y = 77;
  await saveDirectoryWorkspace(loaded, loaded.map);
  assert.equal(JSON.parse(viewsDirectory.children.get('jornada.json').text).title, 'Jornada');
  assert.equal(JSON.parse(viewsDirectory.children.get('jornada.json').text).layout.viewport.x, 99);
  assert.equal(JSON.parse(internal.children.get('map.json').text).layout.viewport.x, defaultManifest.layout.viewport.x);
  assert.equal(JSON.parse(internal.children.get('map.json').text).layout.viewport.y, 77);
  assert.deepEqual(JSON.parse(internal.children.get('map.json').text).views.map((view) => view.id), ['default', 'jornada']);
  assert.equal([...notesDirectory.children.keys()].filter((name) => name.endsWith('.md')).length, 1);
  assert.match(notesDirectory.children.get('passo.md').text, /Conteúdo único/);
});

test('directory write rolls back earlier files when a later write fails', async () => {
  const root = new MemoryDirectory('Projeto');
  const notesDirectory = await root.getDirectoryHandle('notas', { create: true });
  const original = `---\nid: autonomia\ntitle: Autonomia\n---\n\n# Autonomia`;
  notesDirectory.children.set('autonomia.md', new MemoryFile(original));
  const loaded = await openDirectoryWorkspace(root);
  loaded.map.hexagons[0].bodyMarkdown = '# Autonomia\n\nMudança que deve ser revertida.';
  const internal = await root.getDirectoryHandle('.hexmap', { create: true });
  internal.children.set('map.json', new FailingFile('{}'));
  await assert.rejects(() => saveDirectoryWorkspace(loaded, loaded.map), /simulated write failure/);
  assert.equal(notesDirectory.children.get('autonomia.md').text, original);
  assert.equal(internal.children.get('map.json').text, '{}');
  assert.equal(root.children.has('hexmap.yaml'), false);
});
