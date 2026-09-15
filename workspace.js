import { parseMarkdownDocument, stringifyMarkdownDocument, stringifyYaml } from './frontmatter.js';

export const WORKSPACE_VERSION = '1.0.0';
export const MANIFEST_PATH = '.hexmap/map.json';
export const PROJECT_PATH = 'hexmap.yaml';
export const VIEWS_PATH = '.hexmap/views';
export const DEFAULT_VIEW_ID = 'default';
const RESERVED = new Set(['id', 'title', 'summary', 'cluster', 'tags', 'visual', 'hexmap']);

/**
 * Only portable, relative Markdown paths may be persisted in a workspace.
 * This guard is intentionally browser-side as well as server-side: a selected
 * directory is still untrusted input, and File System Access must never be
 * allowed to escape its root.
 */
export function validateSourcePath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('sourcePath vazio');
  const path = value.trim().replaceAll('\\', '/');
  if (path.length > 240 || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) throw new Error(`sourcePath inseguro: ${value}`);
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new Error(`sourcePath inseguro: ${value}`);
  if (!/\.md$/i.test(path) || parts.some((part) => part === '.hexmap' || part === '.git')) throw new Error(`sourcePath deve apontar para uma nota Markdown: ${value}`);
  return path;
}

export function fingerprintText(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

export class WorkspaceConflictError extends Error {
  constructor(path) {
    super(`Arquivo alterado fora do HexMap: ${path}`);
    this.name = 'WorkspaceConflictError';
    this.code = 'WORKSPACE_CONFLICT';
    this.path = path;
  }
}

export function slugifyFile(value) {
  return String(value || 'nota').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'nota';
}

export function stableNoteId(path) {
  const normalized = validateSourcePath(path).toLocaleLowerCase('en-US');
  const stem = slugifyFile(normalized.replace(/\.md$/i, ''));
  return `${stem}-${fingerprintText(normalized).split(':')[1].slice(0, 7)}`;
}

export function extractWikilinks(markdown = '') {
  const links = [];
  const pattern = /!?(?:\[\[)([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
  for (const match of String(markdown).matchAll(pattern)) {
    if (match[0].startsWith('!')) continue;
    const target = match[1].trim().replaceAll('\\', '/').replace(/\.md$/i, '');
    if (target) links.push({ target, label: match[2]?.trim() || '' });
  }
  return links;
}

export function parseNote(text, path = '') {
  if (path) path = validateSourcePath(path);
  const document = parseMarkdownDocument(text);
  const metadata = document.frontmatter;
  const fileName = path.split('/').pop()?.replace(/\.md$/i, '') || 'Nota';
  const heading = document.body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const id = String(metadata.id || (path ? stableNoteId(path) : slugifyFile(fileName)));
  const fields = Object.fromEntries(Object.entries(metadata).filter(([key]) => !RESERVED.has(key)));
  return {
    id,
    title: String(metadata.title || heading || fileName),
    summary: String(metadata.summary || ''),
    cluster: metadata.cluster ? String(metadata.cluster) : null,
    tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : metadata.tags ? [String(metadata.tags)] : [],
    visual: metadata.visual && typeof metadata.visual === 'object' ? metadata.visual : null,
    fields,
    bodyMarkdown: document.body.trim(),
    sourcePath: path,
    originalFrontmatter: metadata,
    hasFrontmatter: document.hasFrontmatter,
    derivedTitle: String(heading || fileName),
    wikilinks: extractWikilinks(document.body),
  };
}

export function serializeNote(entity, originalFrontmatter = {}) {
  const metadata = { ...originalFrontmatter, ...entity.fields };
  metadata.id = entity.id;
  metadata.title = entity.title;
  if (entity.summary) metadata.summary = entity.summary; else delete metadata.summary;
  if (entity.clusterId) metadata.cluster = entity.clusterId; else delete metadata.cluster;
  if (entity.tags?.length) metadata.tags = entity.tags; else delete metadata.tags;
  if (entity.visual && (entity.visual.mode !== 'text' || entity.visual.image?.src)) metadata.visual = entity.visual; else delete metadata.visual;
  const body = String(entity.bodyMarkdown || '');
  const fileName = entity.sourcePath?.split('/').at(-1)?.replace(/\.md$/i, '') || 'Nota';
  const currentPlainTitle = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fileName;
  const canRemainPlainMarkdown = entity.hasFrontmatter === false
    && entity.title === currentPlainTitle
    && !entity.summary
    && !entity.clusterId
    && !entity.tags?.length
    && !Object.keys(entity.fields || {}).length
    && !(entity.visual && (entity.visual.mode !== 'text' || entity.visual.image?.src));
  if (canRemainPlainMarkdown) return `${body.trimEnd()}\n`;
  return stringifyMarkdownDocument(metadata, entity.bodyMarkdown || '');
}

function defaultVisual() {
  return { mode: 'text', image: { src: '', fit: 'cover', position: '50% 50%', overlay: .38 } };
}

function resolveWikilinkTarget(notes, source, target) {
  const normalizedTarget = target.toLocaleLowerCase('en-US').replace(/^\.\//, '');
  const sourceDirectory = source.sourcePath.includes('/') ? source.sourcePath.slice(0, source.sourcePath.lastIndexOf('/') + 1) : '';
  const exact = notes.filter((note) => {
    const path = note.sourcePath.replace(/\.md$/i, '').toLocaleLowerCase('en-US');
    return path === normalizedTarget || path === `${sourceDirectory}${normalizedTarget}`.toLocaleLowerCase('en-US');
  });
  if (exact.length === 1) return { status: 'resolved', note: exact[0] };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };
  const byFileName = notes.filter((note) => note.sourcePath.replace(/\.md$/i, '').toLocaleLowerCase('en-US').split('/').at(-1) === normalizedTarget);
  if (byFileName.length === 1) return { status: 'resolved', note: byFileName[0] };
  if (byFileName.length > 1) return { status: 'ambiguous', candidates: byFileName };
  return { status: 'missing', candidates: [] };
}

export function createWikilinkRelations(notes, existingRelations = []) {
  const keys = new Set(existingRelations.map((relation) => `${relation.source}->${relation.target}`));
  const relations = [];
  for (const note of notes) for (const link of note.wikilinks || []) {
    const resolution = resolveWikilinkTarget(notes, note, link.target);
    const target = resolution.note;
    const key = target ? `${note.id}->${target.id}` : '';
    if (!target || target.id === note.id || keys.has(key)) continue;
    keys.add(key);
    relations.push({
      id: `wikilink-${fingerprintText(key).split(':')[1]}`,
      source: note.id,
      target: target.id,
      sourceType: 'hexagon',
      targetType: 'hexagon',
      type: 'wikilink',
      label: link.label || '',
      style: 'curve',
      routing: { mode: 'auto', offset: { along: 0, perpendicular: 0 }, waypoints: [], locked: false },
      imported: true,
    });
  }
  return relations;
}

function defaultLayout() {
  return {
    type: 'free',
    viewport: { x: 0, y: 0, zoom: 1 },
    axes: { xLabel: 'Eixo X', xMin: 0, xMax: 10, yLabel: 'Eixo Y', yMin: 0, yMax: 100, frame: { x: 250, y: 170, width: 1700, height: 980 } },
  };
}

function normalizeView(id, value = {}) {
  const fallback = defaultLayout();
  const candidate = structuredClone(value.layout || {});
  const layout = {
    ...fallback,
    ...candidate,
    viewport: { ...fallback.viewport, ...(candidate.viewport || {}) },
    axes: { ...fallback.axes, ...(candidate.axes || {}), frame: { ...fallback.axes.frame, ...(candidate.axes?.frame || {}) } },
  };
  const mode = value.mode || layout.mode || (layout.type === 'axes' ? 'axes' : 'territories');
  const showClusterHulls = value.showClusterHulls ?? layout.showClusterHulls ?? mode === 'territories';
  layout.mode = mode;
  layout.showClusterHulls = showClusterHulls;
  return { id, title: value.title || (id === DEFAULT_VIEW_ID ? 'Mapa principal' : id.replace(/[-_]/g, ' ')), mode, showClusterHulls, layout };
}

function viewManifestPath(id) {
  if (id === DEFAULT_VIEW_ID) return MANIFEST_PATH;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) throw new Error(`ID de view inválido: ${id}`);
  return `${VIEWS_PATH}/${id}.json`;
}

function workspaceViews(manifest, options = {}) {
  const supplied = options.viewManifests instanceof Map ? options.viewManifests : new Map();
  const descriptors = supplied.size
    ? [...supplied].map(([id, value]) => normalizeView(id, value))
    : (manifest.views?.length ? manifest.views.map((view) => normalizeView(view.id, view)) : [normalizeView(DEFAULT_VIEW_ID, manifest)]);
  if (!descriptors.some((view) => view.id === DEFAULT_VIEW_ID)) descriptors.unshift(normalizeView(DEFAULT_VIEW_ID, manifest));
  return descriptors;
}

export function createWorkspaceMap(notes, manifest = {}, project = {}, options = {}) {
  const saved = new Map((manifest.hexagons || []).map((item) => [item.id, { ...item, sourcePath: item.sourcePath ? validateSourcePath(item.sourcePath) : undefined }]));
  const clusterIds = [...new Set(notes.map((note) => note.cluster).filter(Boolean))];
  const savedClusters = new Map((manifest.clusters || []).map((cluster) => [cluster.id, cluster]));
  const clusters = clusterIds.map((id, index) => ({
    id,
    title: savedClusters.get(id)?.title || id.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    description: savedClusters.get(id)?.description || '',
    bodyMarkdown: savedClusters.get(id)?.bodyMarkdown || '',
    tags: savedClusters.get(id)?.tags || [],
    fields: savedClusters.get(id)?.fields || {},
    color: savedClusters.get(id)?.color || ['#b56f45','#687b9b','#5c8a79','#99842e','#806d93','#5d8e9b'][index % 6],
    label: savedClusters.get(id)?.label || { mode: 'auto', offsetX: 0, offsetY: 0 },
  }));
  const occupied = new Set();
  const hexagons = notes.map((note, index) => {
    const previous = saved.get(note.id) || {};
    let q = Number.isInteger(previous.q) ? previous.q : (index % 8) - 4;
    let r = Number.isInteger(previous.r) ? previous.r : Math.floor(index / 8) - 2;
    while (occupied.has(`${q},${r}`)) q += 1;
    occupied.add(`${q},${r}`);
    return {
      id: note.id, title: note.title, summary: note.summary, description: note.summary,
      bodyMarkdown: note.bodyMarkdown, tags: note.tags, fields: note.fields,
      hasFrontmatter: note.hasFrontmatter, derivedTitle: note.derivedTitle,
      visual: { ...defaultVisual(), ...(note.visual || {}), ...(previous.visual || {}) },
      q, r, clusterId: note.cluster || previous.clusterId || null,
      axisPosition: previous.axisPosition || null, sourcePath: note.sourcePath,
    };
  });
  const entityIds = new Set(hexagons.map((item) => item.id));
  const validClusterIds = new Set(clusters.map((item) => item.id));
  const savedRelations = (manifest.relations || []).filter((relation) => {
    const sourceValid = validClusterIds.has(relation.source) || entityIds.has(relation.source);
    const targetValid = validClusterIds.has(relation.target) || entityIds.has(relation.target);
    return sourceValid && targetValid;
  });
  const relations = options.importWikilinks ? [...savedRelations, ...createWikilinkRelations(notes, savedRelations)] : savedRelations;
  const views = workspaceViews(manifest, options);
  const requestedViewId = options.activeViewId || project.activeView || manifest.activeViewId || DEFAULT_VIEW_ID;
  const activeView = views.find((view) => view.id === requestedViewId) || views[0];
  return {
    $schema: './schemas/hexmap.schema.json', schemaVersion: manifest.schemaVersion || '1.0.0',
    workspaceVersion: WORKSPACE_VERSION, id: project.id || manifest.id || 'hexmap-workspace',
    title: project.title || manifest.title || 'Projeto HexMap', description: project.description || manifest.description || '',
    createdAt: manifest.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    layout: activeView.layout || manifest.layout || defaultLayout(),
    activeViewId: activeView.id,
    views,
    fieldDefinitions: manifest.fieldDefinitions?.length ? manifest.fieldDefinitions : inferFieldDefinitions(notes), styleRules: manifest.styleRules || { colorByField: null, colorMap: {} },
    hexagons, clusters, relations,
    annotations: manifest.annotations || [], nextEntity: hexagons.length + 1, nextCluster: clusters.length + 1,
    nextRelation: relations.length + 1, nextAnnotation: (manifest.annotations || []).length + 1, paletteCursor: clusters.length,
  };
}

export function inferFieldDefinitions(notes) {
  const values = new Map();
  for (const note of notes) for (const [key, value] of Object.entries(note.fields || {})) {
    if (!values.has(key)) values.set(key, []);
    values.get(key).push(value);
  }
  return [...values].map(([key, items]) => {
    const sample = items.find((item) => item !== null && item !== undefined);
    const type = typeof sample === 'boolean' ? 'boolean' : typeof sample === 'number' ? 'number' : Array.isArray(sample) ? 'multi-select' : 'text';
    return { key, label: key.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()), type };
  });
}

export function createLayoutManifest(map) {
  const activeViewId = map.activeViewId || DEFAULT_VIEW_ID;
  const sourceViews = map.views?.length ? [...map.views] : [normalizeView(activeViewId, { layout: map.layout })];
  if (!sourceViews.some((view) => view.id === activeViewId)) sourceViews.push(normalizeView(activeViewId, { layout: map.layout }));
  const views = sourceViews.map((view) => {
    const normalized = normalizeView(view.id, view.id === activeViewId ? { ...view, layout: map.layout } : view);
    return normalized;
  });
  return {
    workspaceVersion: WORKSPACE_VERSION, schemaVersion: map.schemaVersion, id: map.id, title: map.title,
    description: map.description || '', createdAt: map.createdAt, updatedAt: new Date().toISOString(),
    layout: structuredClone(map.layout), activeViewId, views,
    fieldDefinitions: structuredClone(map.fieldDefinitions), styleRules: structuredClone(map.styleRules),
    hexagons: map.hexagons.map(({ id, sourcePath, q, r, clusterId, axisPosition, visual }) => ({ id, sourcePath: sourcePath ? validateSourcePath(sourcePath) : undefined, q, r, clusterId, axisPosition: structuredClone(axisPosition), visual: structuredClone(visual) })),
    clusters: structuredClone(map.clusters), relations: structuredClone(map.relations), annotations: structuredClone(map.annotations),
  };
}

export function workspaceDiagnostics(notes, manifest = {}, options = {}) {
  const issues = [];
  const ids = new Map();
  for (const note of notes) {
    if (ids.has(note.id)) issues.push({ severity: 'error', code: 'duplicate-id', message: `ID duplicado: ${note.id}`, paths: [ids.get(note.id), note.sourcePath] });
    ids.set(note.id, note.sourcePath);
    if (!note.title) issues.push({ severity: 'warning', code: 'missing-title', message: `Nota sem título: ${note.sourcePath}`, paths: [note.sourcePath] });
  }
  for (const item of manifest.hexagons || []) {
    if (item.sourcePath) {
      try { validateSourcePath(item.sourcePath); } catch (error) { issues.push({ severity: 'error', code: 'unsafe-source-path', message: error.message, paths: [String(item.sourcePath)] }); }
    }
    if (!ids.has(item.id)) issues.push({ severity: 'warning', code: 'missing-source', message: `Arquivo ausente para ${item.id}`, paths: [item.sourcePath].filter(Boolean) });
  }
  if (options.importWikilinks) {
    for (const note of notes) for (const link of note.wikilinks || []) {
      const resolution = resolveWikilinkTarget(notes, note, link.target);
      if (resolution.status === 'missing') issues.push({
        severity: 'warning', code: 'wikilink-missing',
        message: `Wikilink sem destino: [[${link.target}]] em ${note.sourcePath}`,
        paths: [note.sourcePath], target: link.target,
      });
      if (resolution.status === 'ambiguous') issues.push({
        severity: 'warning', code: 'wikilink-ambiguous',
        message: `Wikilink ambíguo: [[${link.target}]] em ${note.sourcePath}`,
        paths: [note.sourcePath, ...resolution.candidates.map((candidate) => candidate.sourcePath)], target: link.target,
      });
    }
  }
  return issues;
}

async function readTextFile(root, path) {
  const parts = path.split('/').filter(Boolean);
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  const handle = await directory.getFileHandle(parts.at(-1));
  return (await handle.getFile()).text();
}

async function tryReadTextFile(root, path) {
  try { return await readTextFile(root, path); } catch { return null; }
}

async function collectViewManifests(root, legacyManifest) {
  const manifests = new Map([[DEFAULT_VIEW_ID, legacyManifest || {}]]);
  try {
    let directory = await root.getDirectoryHandle('.hexmap');
    directory = await directory.getDirectoryHandle('views');
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind !== 'file' || !/^[a-z0-9][a-z0-9_-]{0,63}\.json$/i.test(name)) continue;
      try { manifests.set(name.replace(/\.json$/i, ''), JSON.parse(await (await handle.getFile()).text())); } catch {}
    }
  } catch {}
  return manifests;
}

async function writeTextFile(root, path, text) {
  const parts = path.split('/').filter(Boolean);
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
  const handle = await directory.getFileHandle(parts.at(-1), { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function removeFile(root, path) {
  const parts = path.split('/').filter(Boolean);
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  await directory.removeEntry(parts.at(-1));
}

async function writeTransaction(root, writes) {
  const snapshots = new Map();
  for (const { path } of writes) snapshots.set(path, await tryReadTextFile(root, path));
  const written = [];
  try {
    for (const { path, text } of writes) {
      written.push(path);
      await writeTextFile(root, path, text);
    }
  } catch (error) {
    for (const path of written.reverse()) {
      const previous = snapshots.get(path);
      try {
        if (previous === null) await removeFile(root, path);
        else await writeTextFile(root, path, previous);
      } catch {}
    }
    throw error;
  }
}

async function collectMarkdown(directory, prefix = '') {
  const files = [];
  for await (const [name, handle] of directory.entries()) {
    if (name === '.hexmap' || name.startsWith('.git')) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') files.push(...await collectMarkdown(handle, path));
    else if (/\.md$/i.test(name)) files.push({ path, text: await (await handle.getFile()).text() });
  }
  return files;
}

export async function openDirectoryWorkspace(directoryHandle, options = {}) {
  const rawFiles = await collectMarkdown(directoryHandle);
  let manifest = {};
  try { manifest = JSON.parse(await readTextFile(directoryHandle, MANIFEST_PATH)); } catch {}
  let project = {};
  try { project = parseMarkdownDocument(`---\n${await readTextFile(directoryHandle, PROJECT_PATH)}\n---\n`).frontmatter; } catch {}
  const viewManifests = await collectViewManifests(directoryHandle, manifest);
  const activeViewId = options.viewId || project.activeView || manifest.activeViewId || DEFAULT_VIEW_ID;
  const activeManifest = viewManifests.get(activeViewId) || manifest;
  const notes = rawFiles.map((file) => parseNote(file.text, file.path));
  return {
    name: directoryHandle.name,
    directoryHandle,
    notes,
    originals: new Map(notes.map((note) => [note.id, note.originalFrontmatter])),
    fingerprints: new Map(rawFiles.map((file) => [file.path, fingerprintText(file.text)])),
    manifest: activeManifest,
    viewManifests,
    activeViewId: viewManifests.has(activeViewId) ? activeViewId : DEFAULT_VIEW_ID,
    sourceKind: 'directory',
    project,
    diagnostics: workspaceDiagnostics(notes, activeManifest, options),
    map: createWorkspaceMap(notes, activeManifest, project, { importWikilinks: options.importWikilinks, viewManifests, activeViewId }),
  };
}

export function listWorkspaceViews(workspace) {
  const manifests = workspace.viewManifests instanceof Map ? workspace.viewManifests : new Map([[DEFAULT_VIEW_ID, workspace.manifest || {}]]);
  return [...manifests].map(([id, manifest]) => normalizeView(id, manifest));
}

export async function selectWorkspaceView(workspace, viewId, options = {}) {
  const manifest = workspace.viewManifests?.get(viewId);
  if (!manifest) throw new Error(`View inexistente: ${viewId}`);
  workspace.activeViewId = viewId;
  workspace.manifest = manifest;
  workspace.map = createWorkspaceMap(workspace.notes, manifest, workspace.project, {
    importWikilinks: options.importWikilinks,
    viewManifests: workspace.viewManifests,
    activeViewId: viewId,
  });
  workspace.diagnostics = workspaceDiagnostics(workspace.notes, manifest, options);
  return workspace.map;
}

export function synchronizeWorkspaceNotes(workspace, map) {
  if (!workspace) return [];
  const previous = new Map((workspace.notes || []).map((note) => [note.id, note]));
  workspace.notes = map.hexagons.map((entity) => {
    const note = previous.get(entity.id) || {};
    return {
      ...note,
      id: entity.id,
      title: entity.title,
      summary: entity.summary || entity.description || '',
      cluster: entity.clusterId || null,
      tags: structuredClone(entity.tags || []),
      fields: structuredClone(entity.fields || {}),
      bodyMarkdown: entity.bodyMarkdown || '',
      sourcePath: entity.sourcePath,
      hasFrontmatter: entity.hasFrontmatter ?? note.hasFrontmatter ?? true,
      derivedTitle: entity.derivedTitle || note.derivedTitle || entity.title,
      wikilinks: extractWikilinks(entity.bodyMarkdown || ''),
    };
  });
  return workspace.notes;
}

function preservedViewTitle(viewId, map, manifests, fallback) {
  const stored = manifests.get(viewId);
  return stored?.views?.find((view) => view.id === viewId)?.title
    || map.views?.find((view) => view.id === viewId)?.title
    || stored?.title
    || fallback;
}

export async function saveDirectoryWorkspace(workspace, map, options = {}) {
  const nextFingerprints = new Map(workspace.fingerprints || []);
  const pendingNotes = [];
  for (const entity of map.hexagons) {
    const path = validateSourcePath(entity.sourcePath || `notas/${slugifyFile(entity.title)}.md`);
    entity.sourcePath = path;
    const current = await tryReadTextFile(workspace.directoryHandle, path);
    const expected = workspace.fingerprints?.get(path);
    if (expected && fingerprintText(current) !== expected) throw new WorkspaceConflictError(path);
    const serialized = serializeNote(entity, workspace.originals.get(entity.id) || {});
    pendingNotes.push({ path, serialized });
    nextFingerprints.set(path, fingerprintText(serialized));
  }
  const activeViewId = options.viewId || map.activeViewId || workspace.activeViewId || DEFAULT_VIEW_ID;
  const viewManifests = workspace.viewManifests instanceof Map ? new Map(workspace.viewManifests) : new Map();
  const activeManifest = createLayoutManifest({ ...map, activeViewId });
  activeManifest.title = preservedViewTitle(activeViewId, map, viewManifests, activeManifest.title);
  viewManifests.set(activeViewId, activeManifest);
  if (!viewManifests.has(DEFAULT_VIEW_ID)) {
    const defaultManifest = activeViewId === DEFAULT_VIEW_ID ? activeManifest : createLayoutManifest({ ...map, activeViewId: DEFAULT_VIEW_ID });
    defaultManifest.title = preservedViewTitle(DEFAULT_VIEW_ID, map, viewManifests, defaultManifest.title);
    viewManifests.set(DEFAULT_VIEW_ID, defaultManifest);
  }
  const descriptors = [...viewManifests].map(([id, stored]) => normalizeView(id, id === activeViewId ? activeManifest : stored));
  const compiledManifests = new Map([...viewManifests].map(([id, stored]) => [id, {
    ...(id === activeViewId ? activeManifest : stored),
    activeViewId: id,
    views: descriptors,
  }]));
  const projectText = `${stringifyYaml({ version: WORKSPACE_VERSION, id: map.id, title: map.title, description: map.description || '', notes: ['**/*.md'], manifest: MANIFEST_PATH, activeView: activeViewId })}\n`;
  await writeTransaction(workspace.directoryHandle, [
    ...pendingNotes.map(({ path, serialized }) => ({ path, text: serialized })),
    ...[...compiledManifests].map(([id, manifest]) => ({ path: viewManifestPath(id), text: `${JSON.stringify(manifest, null, 2)}\n` })),
    { path: PROJECT_PATH, text: projectText },
  ]);
  synchronizeWorkspaceNotes(workspace, map);
  workspace.viewManifests = compiledManifests;
  workspace.activeViewId = activeViewId;
  workspace.manifest = compiledManifests.get(activeViewId);
  workspace.fingerprints = nextFingerprints;
  return { savedAt: new Date().toISOString(), files: pendingNotes.length + compiledManifests.size + 1 };
}

export function createPortableBundle(map, originals = new Map(), options = {}) {
  const files = Object.fromEntries(map.hexagons.map((entity) => {
    const path = validateSourcePath(entity.sourcePath || `notas/${slugifyFile(entity.title)}.md`);
    return [path, serializeNote(entity, originals.get(entity.id) || {})];
  }));
  const activeViewId = options.activeViewId || map.activeViewId || DEFAULT_VIEW_ID;
  const suppliedViews = options.viewManifests instanceof Map ? new Map(options.viewManifests) : new Map();
  const activeManifest = createLayoutManifest({ ...map, activeViewId });
  activeManifest.title = preservedViewTitle(activeViewId, map, suppliedViews, activeManifest.title);
  if ((map.views?.length || 0) > 1 && !suppliedViews.size) throw new Error('Catálogo de views necessário para exportar um workspace com múltiplas views');
  for (const view of map.views || []) {
    if (view.id !== activeViewId && !suppliedViews.has(view.id)) throw new Error(`Manifesto ausente para a view: ${view.id}`);
  }
  if (!suppliedViews.has(DEFAULT_VIEW_ID)) {
    if (activeViewId !== DEFAULT_VIEW_ID) throw new Error('Manifesto da view default necessário para exportação');
    suppliedViews.set(DEFAULT_VIEW_ID, activeManifest);
  }
  suppliedViews.set(activeViewId, activeManifest);
  const descriptors = [...suppliedViews].map(([id, manifest]) => normalizeView(id, id === activeViewId ? activeManifest : manifest));
  for (const [id, stored] of suppliedViews) {
    const manifest = id === activeViewId ? activeManifest : stored;
    const compiled = { ...manifest, activeViewId: id, views: descriptors };
    files[viewManifestPath(id)] = `${JSON.stringify(compiled, null, 2)}\n`;
  }
  files[PROJECT_PATH] = `${stringifyYaml({ version: WORKSPACE_VERSION, id: map.id, title: map.title, description: map.description || '', notes: ['**/*.md'], manifest: MANIFEST_PATH, activeView: activeViewId })}\n`;
  return { format: 'hexmap-workspace', version: WORKSPACE_VERSION, files };
}

export function openPortableBundle(bundle) {
  if (bundle?.format !== 'hexmap-workspace' || !bundle.files) throw new Error('Bundle de workspace inválido');
  for (const path of Object.keys(bundle.files)) {
    if (path !== MANIFEST_PATH && path !== PROJECT_PATH && !path.startsWith(`${VIEWS_PATH}/`)) validateSourcePath(path);
    if (path.startsWith(`${VIEWS_PATH}/`) && !/^\.hexmap\/views\/[a-z0-9][a-z0-9_-]{0,63}\.json$/i.test(path)) throw new Error(`Caminho de view inválido: ${path}`);
    if (typeof bundle.files[path] !== 'string') throw new Error(`Conteúdo inválido no bundle: ${path}`);
  }
  const notes = Object.entries(bundle.files).filter(([path]) => /\.md$/i.test(path)).map(([path, text]) => parseNote(text, path));
  const defaultManifest = JSON.parse(bundle.files[MANIFEST_PATH] || '{}');
  const project = parseMarkdownDocument(`---\n${bundle.files[PROJECT_PATH] || ''}\n---\n`).frontmatter;
  const viewManifests = new Map([[DEFAULT_VIEW_ID, defaultManifest]]);
  for (const [path, text] of Object.entries(bundle.files)) if (path.startsWith(`${VIEWS_PATH}/`)) viewManifests.set(path.split('/').at(-1).replace(/\.json$/i, ''), JSON.parse(text));
  const requestedViewId = project.activeView || defaultManifest.activeViewId || DEFAULT_VIEW_ID;
  const activeViewId = viewManifests.has(requestedViewId) ? requestedViewId : DEFAULT_VIEW_ID;
  const manifest = viewManifests.get(activeViewId);
  return { name: project.title || defaultManifest.title || 'Workspace portátil', directoryHandle: null, notes, originals: new Map(notes.map((note) => [note.id, note.originalFrontmatter])), manifest, viewManifests, activeViewId, sourceKind: 'bundle', project, diagnostics: workspaceDiagnostics(notes, manifest), map: createWorkspaceMap(notes, manifest, project, { viewManifests, activeViewId }) };
}
