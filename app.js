import { createEmptyMap, createInitialMap, createTemplateMap, createJourneyMap, createLibraryMap, PALETTE } from './data.js';
import { HexMapThreeView } from './three-view.bundle.js';
import { renderMarkdown, markdownExcerpt } from './markdown.js';
import { routeRelation, offsetFromControl } from './router.js';
import {
  createPortableBundle,
  createLayoutManifest,
  listWorkspaceViews,
  openDirectoryWorkspace,
  openPortableBundle,
  saveDirectoryWorkspace,
  selectWorkspaceView,
  synchronizeWorkspaceNotes,
  validateSourcePath,
  WorkspaceConflictError,
} from './workspace.js';
import {
  HEX_SIZE,
  axialToPixel,
  pixelToAxial,
  neighbors,
  coordKey,
  hexCorners,
  expandedHull,
  smoothClosedPath,
  centroid,
  spiral,
  quadraticPath,
  quadraticPoint,
} from './hex.js';

const $ = (selector) => document.querySelector(selector);
if (new URLSearchParams(location.search).get('qa') === 'keyboard') document.documentElement.dataset.qaKeyboard = 'true';
const $$ = (selector) => [...document.querySelectorAll(selector)];

const WORLD = { width: 2200, height: 1400, origin: { x: 1100, y: 700 } };
// Kept stable so V9 browser sessions migrate into V10 without data loss.
const STORAGE_KEY = 'hexmap-studio-v9';
const ONBOARDING_KEY = 'hexmap-studio-onboarding-v1';
const RECOVERY_KEY = 'hexmap-studio-recovery-v1';
const CORRUPT_BACKUP_KEY = 'hexmap-studio-corrupt-backup-v1';
let storageLoadIssue = null;
let storedViewportAvailable = false;
const COMPACT_SLOTS = [
  {q:0,r:0},{q:1,r:0},{q:0,r:1},{q:-1,r:1},{q:-1,r:0},{q:0,r:-1},{q:1,r:-1},
  {q:2,r:-1},{q:2,r:0},{q:1,r:1},{q:0,r:2},{q:-1,r:2},{q:-2,r:2},{q:-2,r:1},{q:-2,r:0},
  {q:-1,r:-1},{q:0,r:-2},{q:1,r:-2},{q:2,r:-2},{q:2,r:-1},
];

const workspace = $('#workspace');
const world = $('#world');
const axisLayer = $('#axisLayer');
const clusterLayer = $('#clusterLayer');
const relationLayer = $('#relationLayer');
const clusterLabelLayer = $('#clusterLabelLayer');
const annotationLayer = $('#annotationLayer');
const nodeLayer = $('#nodeLayer');
const drawer = $('#drawer');
const drawerContent = $('#drawerContent');
const tooltip = $('#tooltip');
const toast = $('#toast');
const mapTitle = $('#mapTitle');
const toolHint = $('#toolHint');
const selectionToolbar = $('#selectionToolbar');
const selectionCount = $('#selectionCount');
const connectBanner = $('#connectBanner');
const connectText = $('#connectText');
const zoomPct = $('#zoomPct');
const mapStats = $('#mapStats');
const saveStatus = $('#saveStatus');
const helpPopover = $('#helpPopover');
const importInput = $('#importInput');
const imageInput = $('#imageInput');
const layoutSelect = $('#layoutSelect');
const searchPanel = $('#searchPanel');
const mapSearch = $('#mapSearch');
const searchResults = $('#searchResults');
const searchSummary = $('#searchSummary');
const workspaceBundleInput = $('#workspaceBundleInput');
const welcomeOverlay = $('#welcomeOverlay');
const recoveryBanner = $('#recoveryBanner');
const threeViewport = $('#threeViewport');
const threeCanvas = $('#threeCanvas');
const threeLabels = $('#threeLabels');
let threeView = null;

function loadViewMode() {
  try { return localStorage.getItem('hexmap-view-mode') === '3d' ? '3d' : '2d'; } catch { return '2d'; }
}
let welcomePreviousFocus = null;
let drawerWasOpen = false;
let drawerReturnTarget = null;
let searchPreviousFocus = null;
let helpPreviousFocus = null;
let keyboardNavigation = false;
window.addEventListener('pointerdown', () => { keyboardNavigation = false; }, { capture: true });
window.addEventListener('keydown', (event) => {
  if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) keyboardNavigation = true;
}, { capture: true });

function drawerTarget(kind, id) {
  let element = null;
  if (kind === 'entity') {
    element = [...document.querySelectorAll('[data-entity], .three-cell-label')]
      .find((item) => item.dataset.entity === id || item.dataset.cell === id);
  } else if (kind === 'cluster') {
    element = [...document.querySelectorAll('[data-cluster-label], .three-cluster-label')]
      .find((item) => item.dataset.clusterLabel === id || item.dataset.cluster === id);
  } else if (kind === 'relation') {
    element = [...document.querySelectorAll('[data-relation-hit]')]
      .find((item) => item.dataset.relationHit === id);
  } else if (kind === 'annotation') {
    element = [...document.querySelectorAll('[data-annotation]')]
      .find((item) => item.dataset.annotation === id);
  } else if (kind === 'control') element = document.getElementById(id);
  const rect = element?.getBoundingClientRect();
  const side = innerWidth >= 901 && innerWidth < 1200 && rect && rect.width && rect.left + rect.width / 2 > innerWidth / 2 ? 'left' : 'right';
  return { kind, id, side, keyboard: keyboardNavigation };
}

const state = {
  map: loadMap(),
  tool: 'move',
  selectedEntityId: null,
  selectedClusterId: null,
  selectedRelationId: null,
  selectedAnnotationId: null,
  settingsOpen: false,
  drawerTab: 'content',
  drawerMode: 'peek',
  markdownMode: 'preview',
  multiSelection: new Set(),
  connectSource: null,
  scale: 1,
  tx: 0,
  ty: 0,
  panning: false,
  moved: false,
  drag: null,
  history: [],
  future: [],
  clusterGeometry: new Map(),
  labelGeometry: new Map(),
  relationGeometry: new Map(),
  toastTimer: null,
  toolHintTimer: null,
  pendingImageEntityId: null,
  workspace: null,
  workspaceOpen: false,
  workspaceBusy: false,
  searchOpen: false,
  searchQuery: '',
  searchLimit: 80,
  presentation: false,
  readOnly: false,
  onboardingOpen: false,
  recoveryCandidate: null,
  recoveryOpen: false,
  conflict: null,
  viewMode: loadViewMode(),
};
const activeTouchPointers = new Map();
let touchGesture = null;
let viewportSaveTimer = null;
state.scale = Number(state.map.layout?.viewport?.zoom) || 1;
state.tx = Number(state.map.layout?.viewport?.x) || 0;
state.ty = Number(state.map.layout?.viewport?.y) || 0;
state.recoveryCandidate = loadRecoveryCandidate();
state.recoveryOpen = Boolean(state.recoveryCandidate && workspaceSnapshot() !== state.recoveryCandidate.snapshot);

function loadRecoveryCandidate() {
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const candidate = JSON.parse(raw);
    if (!candidate?.map || typeof candidate.map !== 'object' || !candidate.snapshot) return null;
    return candidate;
  } catch { return null; }
}

function hasStorageKey(key) {
  try { return Boolean(window.localStorage?.getItem(key)); } catch { return false; }
}

function isFirstRun() {
  return !hasStorageKey(ONBOARDING_KEY) && ['http:', 'https:', 'file:'].includes(window.location.protocol);
}

function markOnboardingSeen() {
  try { localStorage.setItem(ONBOARDING_KEY, 'seen'); } catch {}
}

function hasUnsavedWork() {
  return Boolean(state.workspace && state.workspace.lastSavedMap !== workspaceSnapshot());
}

function guardWorkspaceReplacement(action) {
  if (!hasUnsavedWork()) return true;
  const instruction = state.workspace?.directoryHandle ? 'Salve as alterações' : 'Exporte o bundle atualizado';
  showToast(`${instruction} antes de ${action}`);
  return false;
}

function persistRecovery() {
  if (!hasUnsavedWork()) return;
  try {
    sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ map: state.map, snapshot: workspaceSnapshot(), savedAt: new Date().toISOString(), workspaceName: state.workspace?.name || null }));
  } catch {}
}

function clone(value) {
  return structuredClone(value);
}

function slugify(value) {
  return String(value || 'field')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field';
}

function normalizeMap(input) {
  const map = clone(input || {});
  if (!map.hexagons && Array.isArray(map.entities)) map.hexagons = map.entities;
  delete map.entities;
  map.$schema ||= './schemas/hexmap.schema.json';
  map.schemaVersion ||= '1.0.0';
  map.id ||= 'hexmap-imported';
  map.title ||= 'Mapa hexagonal';
  map.description ||= '';
  map.createdAt ||= new Date().toISOString();
  map.updatedAt ||= new Date().toISOString();
  map.layout ||= { type: 'free' };
  map.layout.type ||= 'free';
  map.layout.mode ||= map.layout.type === 'axes' ? 'axes' : 'territories';
  map.layout.showClusterHulls ??= map.layout.mode === 'territories';
  map.layout.autoCluster ??= map.layout.mode === 'territories';
  map.layout.viewport ||= { x: 0, y: 0, zoom: 1 };
  map.layout.axes ||= {
    xLabel: 'Eixo X', xMin: 0, xMax: 10,
    yLabel: 'Eixo Y', yMin: 0, yMax: 100,
    frame: { x: 250, y: 170, width: 1700, height: 980 },
  };
  map.fieldDefinitions ||= [];
  map.styleRules ||= { colorByField: null, colorMap: {} };
  map.styleRules.colorMap ||= {};
  map.hexagons ||= [];
  map.clusters ||= [];
  map.relations ||= [];
  map.annotations ||= [];
  map.nextEntity ||= 1;
  map.nextCluster ||= 1;
  map.nextRelation ||= 1;
  map.nextAnnotation ||= 1;
  map.paletteCursor ||= 0;
  for (const hex of map.hexagons) {
    hex.title ||= 'Sem título';
    hex.summary ??= hex.description || '';
    hex.description ??= hex.summary || '';
    hex.bodyMarkdown ??= hex.description || '';
    hex.tags ||= [];
    hex.fields ||= {};
    hex.visual ||= { mode: 'text', image: { src: '', fit: 'cover', position: '50% 50%', overlay: .38 } };
    hex.visual.mode ||= 'text';
    hex.visual.image ||= { src: '', fit: 'cover', position: '50% 50%', overlay: .38 };
    hex.q ??= 0; hex.r ??= 0;
    hex.clusterId ??= null;
    hex.axisPosition ??= null;
  }
  for (const cluster of map.clusters) {
    cluster.title ||= 'Cluster sem título';
    cluster.description ||= '';
    cluster.bodyMarkdown ??= cluster.description;
    cluster.tags ||= [];
    cluster.fields ||= {};
    cluster.color ||= PALETTE[0];
    cluster.label ||= { mode: 'auto', offsetX: 0, offsetY: 0 };
  }
  for (const relation of map.relations) {
    relation.sourceType ||= clusterByIdFromMap(map, relation.source) ? 'cluster' : 'hexagon';
    relation.targetType ||= clusterByIdFromMap(map, relation.target) ? 'cluster' : 'hexagon';
    relation.style ||= relation.sourceType === 'hexagon' && relation.targetType === 'hexagon' ? 'edge' : 'curve';
    relation.label ||= 'relaciona-se';
    relation.routing ||= { mode: 'auto', offset: { along: 0, perpendicular: .2 } };
    relation.routing.mode ||= 'auto';
    relation.routing.offset ||= { along: 0, perpendicular: .2 };
  }
  for (const annotation of map.annotations) {
    annotation.type ||= 'text';
    annotation.title ||= 'Anotação';
    annotation.bodyMarkdown ||= '';
    annotation.width ||= 320;
    annotation.style ||= { variant: 'editorial', fontSize: 17, align: 'left' };
  }
  return map;
}

function clusterByIdFromMap(map, id) {
  return map.clusters.some((cluster) => cluster.id === id);
}

function layoutMode() {
  return state.map.layout.type === 'axes' ? 'axes' : (state.map.layout.mode || 'territories');
}

function isMosaic() {
  return layoutMode() === 'mosaic';
}

function autoClusterEnabled() {
  return state.map.layout.type !== 'axes' && state.map.layout.autoCluster !== false;
}

function mapSnapshot() {
  return JSON.stringify(state.map);
}

function syncViewportToMap() {
  state.map.layout ||= {};
  state.map.layout.viewport = { x: state.tx, y: state.ty, zoom: state.scale };
}

function restoreViewportFromMap(map = state.map) {
  const viewport = map.layout?.viewport || {};
  state.scale = Number.isFinite(Number(viewport.zoom)) && Number(viewport.zoom) > 0 ? Number(viewport.zoom) : 1;
  state.tx = Number.isFinite(Number(viewport.x)) ? Number(viewport.x) : 0;
  state.ty = Number.isFinite(Number(viewport.y)) ? Number(viewport.y) : 0;
}

function scheduleViewportSave(delay = 180) {
  clearTimeout(viewportSaveTimer);
  viewportSaveTimer = setTimeout(() => {
    viewportSaveTimer = null;
    saveMap();
    if (state.workspaceOpen) renderWorkspaceDrawer();
  }, delay);
}

function zoomViewportAt(clientX, clientY, factor) {
  const oldScale = state.scale;
  const nextScale = Math.max(.28, Math.min(1.75, oldScale * factor));
  if (Math.abs(nextScale - oldScale) < .0001) return false;
  const worldX = (clientX - state.tx) / oldScale;
  const worldY = (clientY - state.ty) / oldScale;
  state.scale = nextScale;
  state.tx = clientX - worldX * nextScale;
  state.ty = clientY - worldY * nextScale;
  applyTransform();
  toolHint.classList.add('quiet');
  scheduleViewportSave();
  return true;
}

function workspaceViewTitle(viewId, fallback = '', map = state.map) {
  const stored = state.workspace?.viewManifests?.get(viewId);
  return stored?.views?.find((view) => view.id === viewId)?.title
    || map.views?.find((view) => view.id === viewId)?.title
    || stored?.title
    || fallback;
}

function captureWorkspaceView(viewId, map = state.map) {
  const manifest = createLayoutManifest({ ...map, activeViewId: viewId });
  manifest.title = workspaceViewTitle(viewId, manifest.title, map);
  return manifest;
}

function workspaceSnapshot() {
  const map = clone(state.map);
  delete map.updatedAt;
  map.layout ||= {};
  map.layout.viewport = { x: state.tx, y: state.ty, zoom: state.scale };
  if (!state.workspace) return JSON.stringify(map);
  const activeViewId = state.workspace.activeViewId || map.activeViewId || 'default';
  const viewManifests = state.workspace.viewManifests instanceof Map ? new Map(state.workspace.viewManifests) : new Map();
  const activeManifest = captureWorkspaceView(activeViewId, map);
  delete activeManifest.updatedAt;
  viewManifests.set(activeViewId, activeManifest);
  const views = [...viewManifests]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, manifest]) => {
      const stable = clone(manifest);
      delete stable.updatedAt;
      return [id, stable];
    });
  return JSON.stringify({ map, activeViewId, views });
}

function restoreSnapshot(snapshot) {
  state.map = JSON.parse(snapshot);
  clearSelection({ keepWorkspace: Boolean(state.workspace) });
  render();
  saveMap();
}

function remember(before = mapSnapshot()) {
  state.history.push(before);
  if (state.history.length > 100) state.history.shift();
  state.future = [];
  updateActionButtons();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(mapSnapshot());
  restoreSnapshot(state.history.pop());
}

function redo() {
  if (!state.future.length) return;
  state.history.push(mapSnapshot());
  restoreSnapshot(state.future.pop());
}

function loadMap() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch {}
  if (!raw) return normalizeMap(createInitialMap());
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.hexagons) || !Array.isArray(parsed.clusters)) throw new Error('invalid');
    const viewport = parsed.layout?.viewport;
    storedViewportAvailable = [viewport?.x, viewport?.y, viewport?.zoom].every((value) => Number.isFinite(Number(value)))
      && (Math.abs(Number(viewport.x)) > .1 || Math.abs(Number(viewport.y)) > .1 || Math.abs(Number(viewport.zoom) - 1) > .001);
    return normalizeMap(parsed);
  } catch (error) {
    let backupSaved = false;
    const backup = JSON.stringify({ raw, savedAt: new Date().toISOString(), reason: error?.message || 'invalid' });
    try {
      const existing = localStorage.getItem(CORRUPT_BACKUP_KEY);
      if (!existing) { localStorage.setItem(CORRUPT_BACKUP_KEY, backup); backupSaved = true; }
      else backupSaved = JSON.parse(existing)?.raw === raw;
    } catch {}
    if (!backupSaved) try { sessionStorage.setItem(CORRUPT_BACKUP_KEY, backup); backupSaved = true; } catch {}
    storageLoadIssue = { raw, backupSaved, downloaded: false };
    return normalizeMap(createInitialMap());
  }
}

function saveMap() {
  if (storageLoadIssue) {
    saveStatus.innerHTML = '<i class="conflict"></i> dados locais aguardam recuperação';
    return;
  }
  state.map.updatedAt = new Date().toISOString();
  syncViewportToMap();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.map));
    if (state.workspace) {
      const dirty = state.workspace.lastSavedMap !== workspaceSnapshot();
      const cleanLabel = state.workspace.directoryHandle ? 'pasta sincronizada' : 'bundle carregado';
      const dirtyLabel = state.workspace.directoryHandle ? 'alterações não gravadas' : 'exporte o bundle para salvar';
      saveStatus.innerHTML = state.conflict
        ? '<i class="conflict"></i> conflito externo'
        : dirty ? `<i class="dirty"></i> ${dirtyLabel}` : `<i></i> ${cleanLabel}`;
    } else saveStatus.innerHTML = '<i></i> salvo localmente';
  } catch {
    saveStatus.innerHTML = '<i></i> sessão temporária';
  }
  persistRecovery();
}

function entityById(id) {
  return state.map.hexagons.find((entity) => entity.id === id);
}

function clusterById(id) {
  return state.map.clusters.find((cluster) => cluster.id === id);
}

function relationById(id) {
  return state.map.relations.find((relation) => relation.id === id);
}

function endpointRecord(endpoint) {
  if (!endpoint) return null;
  const type = endpoint.type || (clusterById(endpoint.id) ? 'cluster' : 'hexagon');
  const item = type === 'cluster' ? clusterById(endpoint.id) : entityById(endpoint.id);
  return item ? { id: item.id, type, title: item.title, item } : null;
}

function relationEndpoint(relation, side) {
  return endpointRecord({ id: relation[side], type: relation[`${side}Type`] || (clusterById(relation[side]) ? 'cluster' : 'hexagon') });
}

function endpointCenter(endpoint) {
  if (!endpoint) return null;
  return endpoint.type === 'cluster' ? clusterGeometry(endpoint.id)?.center || null : positionOf(endpoint.item);
}

function hexPort(entity, towardPoint) {
  const center = positionOf(entity);
  const dx = towardPoint.x - center.x;
  const dy = towardPoint.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  const radius = HEX_SIZE * .88;
  return { x: center.x + dx / length * radius, y: center.y + dy / length * radius };
}

function membersOf(clusterId) {
  return state.map.hexagons.filter((entity) => entity.clusterId === clusterId);
}

function positionOf(entity) {
  if (state.map.layout.type === 'axes' && entity.axisPosition) {
    const frame = state.map.layout.axes.frame;
    return {
      x: frame.x + Math.max(0, Math.min(1, entity.axisPosition.x)) * frame.width,
      y: frame.y + (1 - Math.max(0, Math.min(1, entity.axisPosition.y))) * frame.height,
    };
  }
  return axialToPixel(entity.q, entity.r, WORLD.origin);
}

function axisValuesOf(entity) {
  if (!entity.axisPosition) return null;
  const axes = state.map.layout.axes;
  return {
    x: axes.xMin + entity.axisPosition.x * (axes.xMax - axes.xMin),
    y: axes.yMin + entity.axisPosition.y * (axes.yMax - axes.yMin),
  };
}

function initializeAxisPositions() {
  const frame = state.map.layout.axes.frame;
  const positions = state.map.hexagons.map((entity) => ({ entity, point: axialToPixel(entity.q, entity.r, WORLD.origin) }));
  if (!positions.length) return;
  const minX = Math.min(...positions.map((item) => item.point.x));
  const maxX = Math.max(...positions.map((item) => item.point.x));
  const minY = Math.min(...positions.map((item) => item.point.y));
  const maxY = Math.max(...positions.map((item) => item.point.y));
  for (const { entity, point } of positions) {
    if (entity.axisPosition) continue;
    entity.axisPosition = {
      x: (point.x - minX) / Math.max(1, maxX - minX),
      y: 1 - (point.y - minY) / Math.max(1, maxY - minY),
    };
    const xField = state.map.fieldDefinitions.find((field) => field.key === 'time');
    const yField = state.map.fieldDefinitions.find((field) => field.key === 'energy');
    if (xField && Number.isFinite(Number(entity.fields?.time))) entity.axisPosition.x = (Number(entity.fields.time) - state.map.layout.axes.xMin) / Math.max(1, state.map.layout.axes.xMax - state.map.layout.axes.xMin);
    if (yField && Number.isFinite(Number(entity.fields?.energy))) entity.axisPosition.y = (Number(entity.fields.energy) - state.map.layout.axes.yMin) / Math.max(1, state.map.layout.axes.yMax - state.map.layout.axes.yMin);
    entity.axisPosition.x = Math.max(0, Math.min(1, entity.axisPosition.x));
    entity.axisPosition.y = Math.max(0, Math.min(1, entity.axisPosition.y));
  }
}

function allPositionsMap(excludeIds = new Set()) {
  const map = new Map();
  for (const entity of state.map.hexagons) {
    if (!excludeIds.has(entity.id)) map.set(coordKey(entity.q, entity.r), entity.id);
  }
  return map;
}

function nodeAt(q, r, excludeId = null) {
  return state.map.hexagons.find((entity) => entity.id !== excludeId && entity.q === q && entity.r === r) || null;
}

function adjacentEntities(entity) {
  if (state.map.layout.type === 'axes') {
    const point = positionOf(entity);
    return state.map.hexagons.filter((candidate) => {
      if (candidate.id === entity.id) return false;
      const other = positionOf(candidate);
      return Math.hypot(point.x - other.x, point.y - other.y) <= HEX_SIZE * 1.9;
    });
  }
  return neighbors(entity.q, entity.r)
    .map(({ q, r }) => nodeAt(q, r, entity.id))
    .filter(Boolean);
}

function connectedComponents(entityIds) {
  const remaining = new Set(entityIds);
  const components = [];
  while (remaining.size) {
    const [startId] = remaining;
    remaining.delete(startId);
    const queue = [startId];
    const component = [];
    while (queue.length) {
      const id = queue.shift();
      const entity = entityById(id);
      if (!entity) continue;
      component.push(id);
      for (const adjacent of adjacentEntities(entity)) {
        if (remaining.has(adjacent.id) && entityIds.includes(adjacent.id)) {
          remaining.delete(adjacent.id);
          queue.push(adjacent.id);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function nextClusterColor() {
  const index = state.map.paletteCursor % PALETTE.length;
  state.map.paletteCursor += 1;
  return PALETTE[index];
}

function createCluster(entityIds, title = null, color = null) {
  const id = `cluster-${state.map.nextCluster++}`;
  const cluster = {
    id,
    title: title || `Novo cluster ${state.map.nextCluster - 1}`,
    description: 'Agrupamento criado no canvas.',
    bodyMarkdown: '## Novo cluster\n\nAgrupamento criado no canvas.',
    tags: [],
    fields: {},
    color: color || nextClusterColor(),
    label: { mode: 'auto', offsetX: 0, offsetY: 0 },
  };
  state.map.clusters.push(cluster);
  for (const entityId of entityIds) {
    const entity = entityById(entityId);
    if (entity) entity.clusterId = id;
  }
  return cluster;
}

function removeEmptyClusters() {
  const occupied = new Set(state.map.hexagons.map((entity) => entity.clusterId).filter(Boolean));
  const removed = new Set(state.map.clusters.filter((cluster) => !occupied.has(cluster.id)).map((cluster) => cluster.id));
  state.map.clusters = state.map.clusters.filter((cluster) => occupied.has(cluster.id));
  if (removed.size) {
    state.map.relations = state.map.relations.filter((relation) => !removed.has(relation.source) && !removed.has(relation.target));
  }
}

function rewriteRelations(removedIds, targetId) {
  const next = [];
  const seen = new Set();
  for (const relation of state.map.relations) {
    const source = removedIds.has(relation.source) ? targetId : relation.source;
    const target = removedIds.has(relation.target) ? targetId : relation.target;
    if (!source || !target || source === target) continue;
    const pair = `${source}->${target}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    next.push({ ...relation, source, target });
  }
  state.map.relations = next;
}

function mergeClusters(clusterIds, preferredId = null, { createNew = false } = {}) {
  const ids = [...new Set(clusterIds.filter(Boolean))].filter((id) => clusterById(id));
  if (ids.length < 2) return ids[0] || null;

  let targetId = preferredId && ids.includes(preferredId) ? preferredId : null;
  if (createNew) {
    const sources = ids.map(clusterById).filter(Boolean);
    const names = sources.map((cluster) => cluster.title);
    const id = `cluster-${state.map.nextCluster++}`;
    const title = names.length <= 2 ? names.join(' + ') : `${names.slice(0, 2).join(' + ')} + ${names.length - 2}`;
    const merged = {
      id,
      title,
      description: `Cluster formado pela recombinação de ${names.join(', ')}.`,
      bodyMarkdown: `## ${title}\n\nCluster formado pela recombinação de ${names.join(', ')}.`,
      tags: [], fields: {},
      color: nextClusterColor(),
      label: { mode: 'auto', offsetX: 0, offsetY: 0 },
    };
    state.map.clusters.push(merged);
    targetId = id;
  } else if (!targetId) {
    targetId = ids
      .map((id) => ({ id, count: membersOf(id).length }))
      .sort((a, b) => b.count - a.count)[0].id;
  }

  const removed = new Set(createNew ? ids : ids.filter((id) => id !== targetId));
  for (const entity of state.map.hexagons) {
    if (removed.has(entity.clusterId)) entity.clusterId = targetId;
  }
  state.map.clusters = state.map.clusters.filter((cluster) => !removed.has(cluster.id));
  rewriteRelations(removed, targetId);
  return targetId;
}

function splitDisconnectedClusters() {
  if (!autoClusterEnabled()) return;
  const clusters = [...state.map.clusters];
  for (const cluster of clusters) {
    const memberIds = membersOf(cluster.id).map((entity) => entity.id);
    if (memberIds.length <= 1) {
      if (memberIds.length === 1) entityById(memberIds[0]).clusterId = null;
      continue;
    }
    const components = connectedComponents(memberIds).sort((a, b) => b.length - a.length);
    if (components.length <= 1) continue;
    const [, ...fragments] = components;
    for (const fragment of fragments) {
      if (fragment.length === 1) {
        entityById(fragment[0]).clusterId = null;
      } else {
        createCluster(fragment, `${cluster.title} · fragmento`, cluster.color);
      }
    }
  }
  removeEmptyClusters();
}

function groupConnectedUngrouped() {
  if (!autoClusterEnabled()) return;
  const ungroupedIds = state.map.hexagons.filter((entity) => !entity.clusterId).map((entity) => entity.id);
  if (ungroupedIds.length < 2) return;
  for (const component of connectedComponents(ungroupedIds)) {
    if (component.length >= 2) createCluster(component);
  }
}

function clustersTouchingEntity(entity) {
  const clusters = new Map();
  for (const adjacent of adjacentEntities(entity)) {
    if (!adjacent.clusterId) continue;
    clusters.set(adjacent.clusterId, (clusters.get(adjacent.clusterId) || 0) + 1);
  }
  return [...clusters.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

function reconcileEntityMove(entityId) {
  if (!autoClusterEnabled()) return;
  const entity = entityById(entityId);
  if (!entity) return;
  const originalClusterId = entity.clusterId;
  const touching = clustersTouchingEntity(entity);
  const touchesOriginal = originalClusterId && touching.includes(originalClusterId);
  const others = touching.filter((id) => id !== originalClusterId);

  if (touchesOriginal && others.length) {
    entity.clusterId = originalClusterId;
    mergeClusters([originalClusterId, ...others], originalClusterId);
  } else if (touchesOriginal) {
    entity.clusterId = originalClusterId;
  } else if (others.length) {
    entity.clusterId = others[0];
    if (others.length > 1) mergeClusters(others, others[0]);
  } else {
    entity.clusterId = null;
  }

  splitDisconnectedClusters();
  groupConnectedUngrouped();
  removeEmptyClusters();
}

function clustersTouchedByMembers(memberIds, ownClusterId) {
  if (state.map.layout.type === 'axes') return [];
  const moving = new Set(memberIds);
  const touched = new Set();
  for (const id of memberIds) {
    const entity = entityById(id);
    for (const cell of neighbors(entity.q, entity.r)) {
      const other = state.map.hexagons.find((candidate) => !moving.has(candidate.id) && candidate.q === cell.q && candidate.r === cell.r);
      if (other?.clusterId && other.clusterId !== ownClusterId) touched.add(other.clusterId);
    }
  }
  return [...touched];
}

function reconcileClusterMove(clusterId) {
  if (!autoClusterEnabled()) return { clusterId, merged: false };
  const memberIds = membersOf(clusterId).map((entity) => entity.id);
  const touched = clustersTouchedByMembers(memberIds, clusterId);
  let resultId = clusterId;
  let merged = false;
  if (touched.length === 1) {
    resultId = mergeClusters([clusterId, ...touched], null, { createNew: true });
    merged = true;
  }
  splitDisconnectedClusters();
  groupConnectedUngrouped();
  removeEmptyClusters();
  return { clusterId: resultId, merged, ambiguous: touched.length > 1 };
}

function clusterGeometry(clusterId) {
  return state.clusterGeometry.get(clusterId) || null;
}

function render() {
  document.documentElement.dataset.hexmapPreset = state.map.styleRules?.preset || 'editorial';
  document.body.classList.toggle('presentation-mode', state.presentation);
  document.body.classList.toggle('read-only-mode', state.readOnly);
  mapTitle.textContent = state.map.title;
  layoutSelect.value = layoutMode();
  renderControls();
  renderAxes();
  renderClusters();
  renderRelations();
  renderAnnotations();
  renderNodes();
  renderDrawer();
  renderSelectionToolbar();
  renderStats();
  renderEmptyState();
  renderRecoveryBanner();
  applySearchFilter();
  applyTransform();
  saveMap();
  lockEditorControls();
  renderViewMode();
}

function renderViewMode() {
  const active = state.viewMode === '3d';
  document.documentElement.dataset.viewMode = state.viewMode;
  threeViewport.hidden = !active;
  const button = $('#viewModeBtn');
  button.textContent = active ? '2D' : '3D';
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? 'Ativar visualização 2D' : 'Ativar visualização 3D');
  if (!threeView) return;
  threeView.setActive(active);
  threeView.setInteractive(!state.readOnly && state.tool === 'move' && state.map.layout.type === 'free');
  threeView.setTool(state.tool);
  if (active) threeView.update(state.map, state.selectedEntityId, state.multiSelection, {
    clusterId: state.selectedClusterId,
    relationId: state.selectedRelationId,
  });
}

function toggleViewMode() {
  state.viewMode = state.viewMode === '3d' ? '2d' : '3d';
  try { localStorage.setItem('hexmap-view-mode', state.viewMode); } catch {}
  renderViewMode();
  showToast(state.viewMode === '3d' ? 'Visualização 3D ativada — o mapa canônico não mudou' : 'Visualização 2D ativada');
}

function disableThreeView(reason = 'unavailable') {
  console.warn(`Visualização 3D indisponível (${reason}); mantendo o renderer 2D.`);
  state.viewMode = '2d';
  try { localStorage.setItem('hexmap-view-mode', state.viewMode); } catch {}
  $('#viewModeBtn').hidden = true;
  renderViewMode();
  showToast('Contexto 3D indisponível — o mapa completo continua no modo 2D');
}

async function runThreeLifecycleQA(cycles = 20) {
  if (!new URLSearchParams(location.search).has('qa')) return false;
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-2000px;top:0;width:640px;height:480px;'; document.body.append(host);
  const samples = [];
  for (let index = 0; index < cycles; index += 1) {
    const canvas = document.createElement('canvas'); const labels = document.createElement('div');
    host.append(canvas, labels);
    const instance = new HexMapThreeView({ canvas, labels }); instance.setActive(true); instance.update(state.map, null);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    samples.push({ cycle: index + 1, textures: instance.renderer.info.memory.textures, geometries: instance.renderer.info.memory.geometries, programs: instance.renderer.info.programs?.length || 0 });
    instance.dispose(); host.replaceChildren();
  }
  host.remove(); document.documentElement.dataset.lifecycleQa = 'passed'; document.documentElement.dataset.lifecycleCycles = String(cycles); document.documentElement.dataset.lifecyclePeakTextures = String(Math.max(...samples.map((sample) => sample.textures))); document.documentElement.dataset.lifecyclePeakGeometries = String(Math.max(...samples.map((sample) => sample.geometries))); return samples;
}

function commitThreeMove(id, q, r) {
  if (state.readOnly || state.tool !== 'move' || state.map.layout.type !== 'free') return false;
  const entity = entityById(id);
  if (!entity || nodeAt(q, r, id)) return false;
  const before = mapSnapshot();
  entity.q = q; entity.r = r;
  reconcileEntityMove(id);
  remember(before);
  state.selectedEntityId = id;
  showToast(autoClusterEnabled() ? 'Topologia 3D atualizada no mapa canônico' : 'Posição 3D atualizada');
  render();
  return true;
}

function commitThreeClusterMove(clusterId, q, r, view3d) {
  if (state.readOnly || state.tool !== 'move' || state.map.layout.type !== 'free') return false;
  const members = membersOf(clusterId);
  if (!members.length) return false;
  const before = mapSnapshot();
  const drag = {
    id: clusterId,
    memberIds: members.map((entity) => entity.id),
    basePositions: Object.fromEntries(members.map((entity) => [entity.id, { q: entity.q, r: entity.r }])),
    lastDelta: { q: 0, r: 0 },
  };
  const delta = safeClusterDelta(drag, { q, r });
  if (!delta.q && !delta.r) return false;
  for (const entity of members) {
    const base = drag.basePositions[entity.id]; entity.q = base.q + delta.q; entity.r = base.r + delta.r;
  }
  const cluster = clusterById(clusterId);
  const anchorKey = view3d?.compact ? 'view3dMobile' : 'view3d';
  if (cluster && Number.isFinite(view3d?.x) && Number.isFinite(view3d?.z)) cluster[anchorKey] = { x: view3d.x, z: view3d.z };
  const result = reconcileClusterMove(clusterId);
  const resultCluster = clusterById(result.clusterId);
  if (resultCluster && Number.isFinite(view3d?.x) && Number.isFinite(view3d?.z)) resultCluster[anchorKey] = { x: view3d.x, z: view3d.z };
  remember(before); state.selectedClusterId = result.clusterId;
  showToast(result.ambiguous ? 'Cluster movido sem mesclar: encoste em apenas um cluster por vez' : result.merged ? 'Clusters recombinados' : 'Cluster movido no mapa canônico');
  render(); return true;
}

function renderControls() {
  $$('.tool').forEach((button) => {
    const active = button.dataset.tool === state.tool;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  workspace.classList.toggle('connecting', state.tool === 'connect');
  workspace.classList.toggle('adding', state.tool === 'add');
  workspace.classList.toggle('adding-text', state.tool === 'text');
  workspace.classList.toggle('axes-layout', state.map.layout.type === 'axes');
  workspace.classList.toggle('mosaic-layout', isMosaic());
  workspace.classList.toggle('territories-layout', layoutMode() === 'territories');
  $('#undoBtn').disabled = state.history.length === 0;
  $('#redoBtn').disabled = state.future.length === 0;
  $('#projectBtn').classList.toggle('active-context', Boolean(state.workspace));
  $('#searchBtn').classList.toggle('active-context', state.searchOpen);
  $('#searchBtn').setAttribute('aria-expanded', String(state.searchOpen));
  $('#presentationBtn')?.classList.toggle('active-context', state.presentation);
  $('#presentationBtn')?.setAttribute('aria-label', state.presentation ? 'Sair da apresentação' : 'Abrir apresentação');
  $('#presentationBtn')?.setAttribute('title', state.presentation ? 'Sair da apresentação (Esc)' : 'Abrir apresentação (P)');

  connectBanner.hidden = state.tool !== 'connect';
  if (state.tool === 'connect') {
    const source = state.connectSource && endpointRecord(state.connectSource);
    connectText.textContent = source
      ? `Origem: ${source.title} · selecione o destino`
      : 'Selecione um hexágono ou cluster de origem';
  }

  const hints = {
    move: state.map.layout.type === 'axes'
      ? 'Arraste hexágonos e clusters sobre os eixos. As posições semânticas X/Y são salvas no JSON.'
      : isMosaic()
        ? 'Encaixe hexágonos livremente. A proximidade não muda seus grupos; use Conectar para desenhar caminhos.'
        : 'Arraste hexágonos para separar, juntar ou recombinar clusters. Arraste o contorno ou o título para mover o cluster inteiro.',
    connect: 'Clique em dois hexágonos ou clusters. Vizinhos formam um caminho pela borda; distantes recebem uma conexão.',
    add: 'Clique no canvas para adicionar um novo hexágono.',
    text: 'Clique no canvas para inserir uma anotação Markdown livre.',
  };
  toolHint.textContent = hints[state.tool];
}

function renderAxes() {
  axisLayer.innerHTML = '';
  if (state.map.layout.type !== 'axes') return;
  const axes = state.map.layout.axes;
  const frame = axes.frame;
  const xTicks = 10;
  const yTicks = 10;
  let grid = '';
  for (let index = 0; index <= xTicks; index += 1) {
    const x = frame.x + frame.width * index / xTicks;
    const value = axes.xMin + (axes.xMax - axes.xMin) * index / xTicks;
    grid += `<line x1="${x}" y1="${frame.y}" x2="${x}" y2="${frame.y + frame.height}" class="axis-grid-line"></line>`;
    grid += `<text x="${x}" y="${frame.y + frame.height + 34}" class="axis-tick" text-anchor="middle">${Number(value.toFixed(1))}</text>`;
  }
  for (let index = 0; index <= yTicks; index += 1) {
    const y = frame.y + frame.height * index / yTicks;
    const value = axes.yMax - (axes.yMax - axes.yMin) * index / yTicks;
    grid += `<line x1="${frame.x}" y1="${y}" x2="${frame.x + frame.width}" y2="${y}" class="axis-grid-line"></line>`;
    grid += `<text x="${frame.x - 28}" y="${y + 4}" class="axis-tick" text-anchor="end">${Number(value.toFixed(1))}</text>`;
  }
  axisLayer.innerHTML = `
    <g class="axis-grid">${grid}</g>
    <path class="axis-main" d="M ${frame.x} ${frame.y} V ${frame.y + frame.height} H ${frame.x + frame.width}"></path>
    <text class="axis-title x" x="${frame.x + frame.width}" y="${frame.y + frame.height + 68}" text-anchor="end">${escapeHtml(axes.xLabel)}</text>
    <text class="axis-title y" x="${frame.x - 78}" y="${frame.y}" transform="rotate(-90 ${frame.x - 78} ${frame.y})" text-anchor="end">${escapeHtml(axes.yLabel)}</text>`;
}

function geometryFromMembers(members) {
  const points = members.flatMap((entity) => hexCorners(positionOf(entity), HEX_SIZE * .96));
  const hull = expandedHull(points, 42);
  const path = smoothClosedPath(hull);
  const center = centroid(hull);
  return {
    hull,
    center,
    minX: Math.min(...hull.map((point) => point.x)),
    minY: Math.min(...hull.map((point) => point.y)),
    maxX: Math.max(...hull.map((point) => point.x)),
    maxY: Math.max(...hull.map((point) => point.y)),
    path,
  };
}

function renderComponentsForCluster(clusterId) {
  const all = membersOf(clusterId);
  if (state.map.layout.type === 'axes') return all.length ? [all] : [];
  return connectedComponents(all.map((entity) => entity.id))
    .map((ids) => ids.map(entityById).filter(Boolean))
    .filter((component) => component.length >= 1)
    .sort((a, b) => b.length - a.length);
}

function dragTargetClusterIds() {
  if (!autoClusterEnabled()) return [];
  if (state.drag?.type === 'entity') {
    const entity = entityById(state.drag.id);
    if (!entity) return [];
    return [...new Set(adjacentEntities(entity)
      .map((neighbor) => neighbor.clusterId)
      .filter((id) => id && id !== entity.clusterId))];
  }
  if (state.drag?.type === 'cluster') return clustersTouchedByMembers(state.drag.memberIds, state.drag.id);
  return [];
}

function dragNeighborEntityIds() {
  if (state.drag?.type !== 'entity') return new Set();
  const entity = entityById(state.drag.id);
  if (!entity) return new Set();
  return new Set(adjacentEntities(entity).filter((neighbor) => neighbor.id !== entity.id).map((neighbor) => neighbor.id));
}

function rectsOverlap(a, b, padding = 0) {
  return !(a.maxX + padding < b.minX || b.maxX + padding < a.minX || a.maxY + padding < b.minY || b.maxY + padding < a.minY);
}

function chooseLabelRect(cluster, geometry, placedRects) {
  // Reserve the space the editorial label actually needs. The old 220 px
  // floor made short titles collide on paper and pushed “Governança” below
  // its territory even when the preferred top slot was visibly free.
  const titleWidth = Math.max(176, Math.min(350, cluster.title.length * 10.2 + 72));
  const height = 76;
  const gap = 24;
  const topY = geometry.minY - height - gap;
  const centeredX = geometry.center.x - titleWidth / 2;
  const narrowCanvas = innerWidth < 900;
  const candidates = [
    { x: geometry.minX + 4, y: topY, penalty: 0 },
    { x: centeredX, y: topY, penalty: 0 },
    { x: geometry.maxX - titleWidth, y: topY, penalty: 0 },
    { x: centeredX + 80, y: topY, penalty: 80 },
    { x: centeredX - 80, y: topY, penalty: 80 },
    { x: centeredX + 160, y: topY, penalty: 180 },
    { x: centeredX - 160, y: topY, penalty: 180 },
    { x: geometry.minX - titleWidth - gap, y: geometry.center.y - height / 2, penalty: narrowCanvas ? 5600 : 2400 },
    { x: geometry.maxX + gap, y: geometry.center.y - height / 2, penalty: narrowCanvas ? 5600 : 2400 },
    { x: geometry.minX + 4, y: geometry.maxY + gap, penalty: narrowCanvas ? 2200 : 3600 },
    { x: centeredX, y: geometry.maxY + gap, penalty: narrowCanvas ? 2200 : 3600 },
    { x: geometry.maxX - titleWidth, y: geometry.maxY + gap, penalty: narrowCanvas ? 2200 : 3600 },
  ];
  const otherClusters = [...state.clusterGeometry.values()].filter((item) => item !== geometry);
  let best = null;
  for (const candidate of candidates) {
    const rect = { minX: candidate.x, minY: candidate.y, maxX: candidate.x + titleWidth, maxY: candidate.y + height, width: titleWidth, height };
    let score = candidate.penalty + Math.hypot(candidate.x + titleWidth / 2 - geometry.center.x, candidate.y + height / 2 - geometry.center.y) * .04;
    for (const placed of placedRects) if (rectsOverlap(rect, placed, 12)) score += 9000;
    for (const other of otherClusters) {
      const bounds = { minX: other.minX, minY: other.minY, maxX: other.maxX, maxY: other.maxY };
      if (rectsOverlap(rect, bounds, 10)) score += 4500;
    }
    if (!best || score < best.score) best = { rect, score };
  }
  const manual = cluster.label?.mode === 'manual';
  if (manual) {
    best.rect.minX += cluster.label.offsetX || 0;
    best.rect.maxX += cluster.label.offsetX || 0;
    best.rect.minY += cluster.label.offsetY || 0;
    best.rect.maxY += cluster.label.offsetY || 0;
  }
  return best.rect;
}

function renderClusters() {
  state.clusterGeometry.clear();
  state.labelGeometry.clear();
  clusterLayer.innerHTML = `
    <defs>
      <pattern id="clusterGrain" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
        <line x1="0" y1="0" x2="0" y2="12" stroke="#4b4139" stroke-opacity=".045" stroke-width="1" />
      </pattern>
    </defs>`;
  clusterLabelLayer.innerHTML = '';
  const dropTargets = new Set(dragTargetClusterIds());

  if (state.map.layout.type === 'axes') {
    const frame = state.map.layout.axes.frame;
    const slotWidth = frame.width / Math.max(1, state.map.clusters.length);
    state.map.clusters.forEach((cluster, index) => {
      const members = membersOf(cluster.id);
      if (!members.length) return;
      const geometry = geometryFromMembers(members);
      state.clusterGeometry.set(cluster.id, geometry);
      const rect = {
        minX: frame.x + index * slotWidth + 4,
        minY: frame.y - 88,
        maxX: frame.x + (index + 1) * slotWidth - 8,
        maxY: frame.y - 22,
        width: slotWidth - 12,
        height: 66,
      };
      state.labelGeometry.set(cluster.id, rect);
      const label = document.createElement('div');
      label.className = `cluster-label editorial axis-key${state.selectedClusterId === cluster.id ? ' selected' : ''}`;
      label.dataset.clusterLabel = cluster.id;
      label.dataset.longTitle = String(/\S{18,}/.test(cluster.title));
      label.tabIndex = 0;
      label.setAttribute('role', 'button');
      label.setAttribute('aria-label', `Abrir cluster ${cluster.title}`);
      label.style.left = `${rect.minX}px`;
      label.style.top = `${rect.minY}px`;
      label.style.width = `${rect.width}px`;
      label.style.setProperty('--cluster-color', cluster.color);
      label.innerHTML = `<span class="cluster-kicker">CLUSTER</span><strong>${escapeHtml(cluster.title)}</strong><small>${members.length} ${members.length === 1 ? 'hexágono' : 'hexágonos'}</small><span class="grip" aria-hidden="true">⠿</span>`;
      clusterLabelLayer.appendChild(label);
    });
    clusterLabelLayer.querySelectorAll('[data-cluster-label]').forEach((label) => {
      const clusterId = label.dataset.clusterLabel;
      label.addEventListener('pointerdown', (event) => handleClusterPointerDown(event, clusterId));
      label.addEventListener('click', (event) => handleClusterClick(event, clusterId));
      label.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleClusterClick(event, clusterId); } });
    });
    return;
  }

  for (const cluster of state.map.clusters) {
    const members = membersOf(cluster.id);
    if (members.length < 1) continue;
    const components = renderComponentsForCluster(cluster.id);
    if (!components.length) continue;
    const geometries = components.map((component) => ({ component, geometry: geometryFromMembers(component) }));
    const main = geometries[0];
    state.clusterGeometry.set(cluster.id, main.geometry);

    const selected = state.selectedClusterId === cluster.id;
    const connectSource = state.connectSource?.type === 'cluster' && state.connectSource.id === cluster.id;
    const dropTarget = dropTargets.has(cluster.id);
    geometries.forEach(({ geometry }, index) => {
      clusterLayer.insertAdjacentHTML('beforeend', `
        <g class="cluster-group${state.map.layout.showClusterHulls ? '' : ' hull-hidden'}${selected ? ' selected' : ''}${connectSource ? ' connect-source' : ''}${dropTarget ? ' drop-target' : ''}${index > 0 ? ' detached-part' : ''}" data-cluster="${cluster.id}">
          <path class="cluster-underlay" d="${geometry.path}" stroke="${cluster.color}"></path>
          <path class="cluster-fill" d="${geometry.path}" fill="${cluster.color}"></path>
          <path class="cluster-grain" d="${geometry.path}" fill="url(#clusterGrain)"></path>
          <path class="cluster-contour" d="${geometry.path}" stroke="${cluster.color}"></path>
          <path class="cluster-hit" d="${geometry.path}" data-cluster-hit="${cluster.id}"></path>
        </g>`);
    });
  }

  const placed = [];
  for (const cluster of state.map.clusters) {
    const geometry = state.clusterGeometry.get(cluster.id);
    if (!geometry) continue;
    const members = membersOf(cluster.id);
    const rect = chooseLabelRect(cluster, geometry, placed);
    placed.push(rect);
    state.labelGeometry.set(cluster.id, rect);
    const selected = state.selectedClusterId === cluster.id;
    const connectSource = state.connectSource?.type === 'cluster' && state.connectSource.id === cluster.id;
    const dropTarget = dropTargets.has(cluster.id);
    const label = document.createElement('div');
    label.className = `cluster-label editorial${selected ? ' selected' : ''}${connectSource ? ' connect-source' : ''}${dropTarget ? ' drop-target' : ''}`;
    label.dataset.clusterLabel = cluster.id;
    label.dataset.longTitle = String(/\S{18,}/.test(cluster.title));
    label.tabIndex = 0;
    label.setAttribute('role', 'button');
    label.setAttribute('aria-label', `Abrir cluster ${cluster.title}`);
    label.style.left = `${rect.minX}px`;
    label.style.top = `${rect.minY}px`;
    label.style.width = `${rect.width}px`;
    label.style.setProperty('--cluster-color', cluster.color);
    label.innerHTML = `<span class="cluster-kicker">CLUSTER</span><strong>${escapeHtml(cluster.title)}</strong><small>${members.length} ${members.length === 1 ? 'hexágono' : 'hexágonos'}</small><span class="grip" aria-hidden="true">⠿</span>`;
    clusterLabelLayer.appendChild(label);
  }

  clusterLayer.querySelectorAll('[data-cluster-hit]').forEach((path) => {
    const clusterId = path.dataset.clusterHit;
    path.addEventListener('pointerdown', (event) => handleClusterPointerDown(event, clusterId));
    path.addEventListener('click', (event) => handleClusterClick(event, clusterId));
  });
  clusterLabelLayer.querySelectorAll('[data-cluster-label]').forEach((label) => {
    const clusterId = label.dataset.clusterLabel;
    label.addEventListener('pointerdown', (event) => handleClusterPointerDown(event, clusterId));
    label.addEventListener('click', (event) => handleClusterClick(event, clusterId));
    label.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleClusterClick(event, clusterId); } });
  });
}

function clusterPort(clusterId, towardPoint) {
  const geometry = clusterGeometry(clusterId);
  if (!geometry) return null;
  const center = geometry.center;
  const dx = towardPoint.x - center.x;
  const dy = towardPoint.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  let projection = 0;
  for (const point of geometry.hull) projection = Math.max(projection, (point.x - center.x) * ux + (point.y - center.y) * uy);
  return { x: center.x + ux * (projection + 14), y: center.y + uy * (projection + 14) };
}

function routeObstacles(relation) {
  return [...state.clusterGeometry.entries()]
    .filter(([id]) => id !== relation.source && id !== relation.target)
    .map(([, geometry]) => ({
      minX: geometry.minX - 28, minY: geometry.minY - 28,
      maxX: geometry.maxX + 28, maxY: geometry.maxY + 28,
      polygon: geometry.hull,
    }));
}

function mapClusterCenter() {
  const centers = [...state.clusterGeometry.values()].map((geometry) => geometry.center);
  if (!centers.length) return { x: WORLD.width / 2, y: WORLD.height / 2 };
  return {
    x: centers.reduce((sum, point) => sum + point.x, 0) / centers.length,
    y: centers.reduce((sum, point) => sum + point.y, 0) / centers.length,
  };
}

function relationLabelPlacement(curve, width, height, obstacles, occupiedRects) {
  const candidates = [.36, .43, .5, .57, .64];
  let best = null;
  for (const t of candidates) {
    const point = quadraticPoint(curve.start, curve.control, curve.end, t);
    const rect = { minX: point.x - width / 2, minY: point.y - height / 2, maxX: point.x + width / 2, maxY: point.y + height / 2 };
    let score = Math.abs(t - .5) * 25;
    for (const obstacle of obstacles) if (rectsOverlap(rect, obstacle, 10)) score += 9000;
    for (const occupied of occupiedRects) if (rectsOverlap(rect, occupied, 5)) score += 4200;
    if (!best || score < best.score) best = { point, rect, score };
  }
  return best;
}

function renderRelations() {
  const previousGeometry = new Map(state.relationGeometry);
  state.relationGeometry.clear();
  relationLayer.innerHTML = `
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="8.3" refY="5" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#71675e"></path>
      </marker>
      <marker id="arrowStrong" markerWidth="10" markerHeight="10" refX="8.3" refY="5" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#312c28"></path>
      </marker>
    </defs>`;

  const existingRoutes = [];
  const clusterLabelRects = [...state.labelGeometry.entries()].map(([clusterId, rect]) => ({ ...rect, clusterId }));
  const relationLabelRects = [];
  const mapCenter = mapClusterCenter();
  for (const relation of state.map.relations) {
    const source = relationEndpoint(relation, 'source');
    const target = relationEndpoint(relation, 'target');
    const sourceCenter = endpointCenter(source);
    const targetCenter = endpointCenter(target);
    if (!source || !target || !sourceCenter || !targetCenter) continue;
    const start = source.type === 'cluster' ? clusterPort(source.id, targetCenter) : hexPort(source.item, targetCenter);
    const end = target.type === 'cluster' ? clusterPort(target.id, sourceCenter) : hexPort(target.item, sourceCenter);
    if (!start || !end) continue;
    const obstacles = routeObstacles(relation);
    const labelRects = clusterLabelRects.filter(({ clusterId }) => clusterId !== relation.source && clusterId !== relation.target);
    const previousOffset = previousGeometry.get(relation.id)?.offset || null;
    const adjacentEdge = isAdjacentHexRelation(relation, source, target);
    const curve = adjacentEdge
      ? { start, end, control: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, samples: [start, end], offset: { along: 0, perpendicular: 0 } }
      : routeRelation({ relation, start, end, sourceCenter, targetCenter, mapCenter, obstacles, labelRects: [...labelRects, ...relationLabelRects], existingRoutes, previousOffset, hysteresis: state.drag?.type === 'cluster' ? 360 : 220 });
    existingRoutes.push(curve.samples);
    const selected = state.selectedRelationId === relation.id;
    const labelWidth = Math.max(60, Math.min(176, relation.label.length * 6.8 + 30));
    const labelPlacement = relationLabelPlacement({ ...curve, start, end }, labelWidth, 24, obstacles, [...labelRects, ...relationLabelRects]);
    const labelPoint = labelPlacement?.point || quadraticPoint(start, curve.control, end, .5);
    if (labelPlacement) relationLabelRects.push(labelPlacement.rect);
    state.relationGeometry.set(relation.id, { ...curve, start, end, labelPoint, labelRect: labelPlacement?.rect || null });
    relationLayer.insertAdjacentHTML('beforeend', `
      <g class="relation-group${adjacentEdge ? ' edge-relation' : ' curve-relation'}${selected ? ' selected' : ''}" data-relation="${relation.id}">
        <path class="relation-path" d="${curve.d}" ${adjacentEdge ? '' : `marker-end="url(#${selected ? 'arrowStrong' : 'arrow'})"`}></path>
        <path class="relation-hit" d="${curve.d}" data-relation-hit="${relation.id}" tabindex="0" role="button" aria-label="Abrir relação ${escapeAttr(relation.label)}"></path>
        ${relation.label ? `<g class="relation-label" transform="translate(${labelPoint.x} ${labelPoint.y})">
          <rect x="${-labelWidth/2}" y="-12" width="${labelWidth}" height="24" rx="12"></rect>
          <text text-anchor="middle" y="3.5">${escapeHtml(relation.label)}</text>
        </g>` : ''}
        ${selected && !adjacentEdge ? `<g class="routing-control"><line x1="${(start.x + end.x) / 2}" y1="${(start.y + end.y) / 2}" x2="${curve.control.x}" y2="${curve.control.y}"></line><circle cx="${curve.control.x}" cy="${curve.control.y}" r="10" data-relation-handle="${relation.id}"></circle></g>` : ''}
      </g>`);
  }

  relationLayer.querySelectorAll('[data-relation-hit]').forEach((path) => {
    const openRelation = (event) => {
      event.stopPropagation();
      hideTooltip();
      dismissToolHint();
      if (state.tool === 'connect') return;
      clearSelection();
      drawerReturnTarget = drawerTarget('relation', path.dataset.relationHit);
      state.selectedRelationId = path.dataset.relationHit;
      state.drawerTab = 'routing';
      state.markdownMode = 'preview';
      render();
    };
    path.addEventListener('click', openRelation);
    path.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRelation(event); } });
  });
  relationLayer.querySelectorAll('[data-relation-handle]').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const relationId = handle.dataset.relationHandle;
      const relation = relationById(relationId);
      const geometry = state.relationGeometry.get(relationId);
      if (!relation || !geometry) return;
      state.drag = { type: 'relation-handle', id: relationId, before: mapSnapshot(), start: geometry.start, end: geometry.end };
      state.drag.pointerId = event.pointerId;
      state.moved = false;
    });
  });
}

function renderAnnotations() {
  annotationLayer.innerHTML = '';
  for (const annotation of state.map.annotations) {
    const el = document.createElement('article');
    el.className = `canvas-annotation ${annotation.style?.variant || 'editorial'}${state.selectedAnnotationId === annotation.id ? ' selected' : ''}`;
    el.dataset.annotation = annotation.id;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Abrir anotação ${annotation.title || 'sem título'}`);
    el.style.left = `${annotation.x}px`;
    el.style.top = `${annotation.y}px`;
    el.style.width = `${annotation.width || 320}px`;
    el.style.setProperty('--annotation-size', `${annotation.style?.fontSize || 17}px`);
    el.style.textAlign = annotation.style?.align || 'left';
    el.innerHTML = `<span class="annotation-kicker">NOTA</span>${annotation.title ? `<h3>${escapeHtml(annotation.title)}</h3>` : ''}<div class="annotation-markdown">${renderMarkdown(annotation.bodyMarkdown || '')}</div><span class="annotation-grip">⠿</span>`;
    annotationLayer.appendChild(el);
  }
  annotationLayer.querySelectorAll('[data-annotation]').forEach((el) => {
    const id = el.dataset.annotation;
    el.addEventListener('pointerdown', (event) => handleAnnotationPointerDown(event, id));
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      hideTooltip();
      dismissToolHint();
      if (state.moved) return;
      clearSelection();
      drawerReturnTarget = drawerTarget('annotation', id);
      state.selectedAnnotationId = id;
      state.drawerTab = 'content';
      state.drawerMode = 'peek';
      state.markdownMode = 'preview';
      render();
    });
    el.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.click(); } });
  });
}

function fieldValueFor(entity, fieldKey) {
  if (fieldKey === '__tags__') return entity.tags || [];
  return entity.fields?.[fieldKey];
}

function ensureColorMap(fieldKey) {
  if (!fieldKey) return;
  const values = [...new Set(state.map.hexagons.flatMap((entity) => {
    const value = fieldValueFor(entity, fieldKey);
    return (Array.isArray(value) ? value : [value]).filter((item) => item !== undefined && item !== null && item !== '');
  }))];
  values.forEach((value, index) => {
    const key = String(value);
    if (!state.map.styleRules.colorMap[key]) state.map.styleRules.colorMap[key] = PALETTE[index % PALETTE.length];
  });
}

function visualColorFor(entity, cluster) {
  if (entity.visual?.color) return entity.visual.color;
  const fieldKey = state.map.styleRules.colorByField;
  if (fieldKey) {
    ensureColorMap(fieldKey);
    const raw = fieldValueFor(entity, fieldKey);
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined && value !== null && value !== '') return state.map.styleRules.colorMap[String(value)] || cluster?.color || '#8d8075';
  }
  return cluster?.color || '#8d8075';
}

function fitHexLabel(label) {
  const fullText = label.textContent.trim();
  const maxSize = Number.parseFloat(getComputedStyle(label).fontSize) || 12;
  const minSize = 8;
  let size = maxSize;
  label.style.fontSize = `${size}px`;
  while (size > minSize && (label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1)) {
    size -= .5;
    label.style.fontSize = `${size}px`;
  }
  label.classList.toggle('compact', size < maxSize);
  if (label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1) {
    let low = 1;
    let high = fullText.length;
    let best = '…';
    while (low <= high) {
      const length = Math.floor((low + high) / 2);
      const candidate = `${fullText.slice(0, length).trimEnd()}…`;
      label.textContent = candidate;
      if (label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 1) {
        best = candidate;
        low = length + 1;
      } else {
        high = length - 1;
      }
    }
    label.textContent = best;
    label.classList.add('truncated');
  }
  label.title = fullText;
}

function renderNodes() {
  nodeLayer.innerHTML = '';
  const mergeNeighbors = dragNeighborEntityIds();
  for (const entity of state.map.hexagons) {
    const cluster = entity.clusterId ? clusterById(entity.clusterId) : null;
    const position = positionOf(entity);
    const selected = state.selectedEntityId === entity.id;
    const multi = state.multiSelection.has(entity.id);
    const connectSource = state.connectSource?.type === 'hexagon' && state.connectSource.id === entity.id;
    const visual = entity.visual || { mode: 'text', image: { src: '' } };
    const color = visualColorFor(entity, cluster);
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `hex-node visual-${visual.mode || 'text'}${cluster ? '' : ' ungrouped'}${selected ? ' selected' : ''}${multi ? ' multi-selected' : ''}${connectSource ? ' connect-source' : ''}${state.drag?.type === 'entity' && state.drag.id === entity.id ? ' dragging' : ''}${mergeNeighbors.has(entity.id) ? ' merge-target' : ''}`;
    node.dataset.entity = entity.id;
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `Abrir hexágono ${entity.title}`);
    node.dataset.cluster = entity.clusterId || '';
    node.style.left = `${position.x}px`;
    node.style.top = `${position.y}px`;
    node.style.setProperty('--cluster-color', color);
    node.style.setProperty('--image-overlay', String(visual.image?.overlay ?? .38));
    const image = visual.image?.src
      ? `<img class="hex-media ${visual.mode === 'cover' || visual.mode === 'image' ? 'cover' : 'icon'}" src="${escapeAttr(visual.image.src)}" alt="" style="object-fit:${escapeAttr(visual.image.fit || 'cover')};object-position:${escapeAttr(visual.image.position || '50% 50%')}">`
      : '';
    const showLabel = visual.mode !== 'image';
    node.innerHTML = `
      <span class="hex-border"></span>
      <span class="hex-face"></span>
      ${image}
      <span class="hex-image-overlay"></span>
      <span class="hex-sheen"></span>
      <span class="hex-grain"></span>
      ${showLabel ? `<span class="hex-label">${escapeHtml(entity.title)}</span>` : ''}`;
    nodeLayer.appendChild(node);
    const label = node.querySelector('.hex-label');
    if (label) fitHexLabel(label);
  }

  nodeLayer.querySelectorAll('[data-entity]').forEach((node) => {
    const entityId = node.dataset.entity;
    node.addEventListener('pointerdown', (event) => handleEntityPointerDown(event, entityId));
    node.addEventListener('click', (event) => handleEntityClick(event, entityId));
    node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleEntityClick(event, entityId); } });
    node.addEventListener('mouseenter', (event) => showTooltip(event, entityId));
    node.addEventListener('mousemove', moveTooltip);
    node.addEventListener('mouseleave', hideTooltip);
  });
}

function renderSelectionToolbar() {
  const count = state.multiSelection.size;
  selectionToolbar.hidden = count === 0;
  selectionCount.textContent = `${count} selecionado${count === 1 ? '' : 's'}`;
}

function renderStats() {
  const clustered = state.map.hexagons.filter((entity) => entity.clusterId).length;
  mapStats.textContent = `${state.map.hexagons.length} hexágonos · ${state.map.clusters.length} clusters · ${state.map.relations.length} relações · ${state.map.annotations.length} textos · ${clustered} agrupados`;
}

function renderEmptyState() {
  const empty = $('#canvasEmptyState');
  if (!empty) return;
  const isEmpty = state.map.hexagons.length === 0 && state.map.annotations.length === 0;
  const firstActionArmed = isEmpty && ['add', 'text'].includes(state.tool);
  empty.hidden = !isEmpty || state.presentation || firstActionArmed;
  if (!isEmpty || firstActionArmed) return;
  const connected = state.workspace?.directoryHandle;
  empty.innerHTML = `<div class="empty-state-mark" aria-hidden="true">⬢</div>
    <p class="eyebrow">${connected ? 'PASTA CONECTADA' : 'PROJETO NOVO'}</p>
    <h1>Seu mapa começa aqui.</h1>
    <p>Adicione o primeiro conceito no canvas ou abra a pasta onde suas notas já vivem.</p>
    <div class="empty-state-actions"><button class="primary" id="emptyAddHex">Adicionar conceito</button><button id="emptyOpenProject">Abrir projeto</button></div>
    <span class="empty-state-hint">Dica: pressione H para adicionar um hexágono.</span>`;
  $('#emptyAddHex')?.addEventListener('click', (event) => {
    event.stopPropagation();
    setTool('add');
    empty.hidden = true;
    workspace.focus();
    showToast('Clique no canvas para posicionar o primeiro conceito');
  });
  $('#emptyOpenProject')?.addEventListener('click', (event) => {
    event.stopPropagation();
    clearSelection({ keepWorkspace: true }); state.workspaceOpen = true; render();
  });
}

function renderRecoveryBanner() {
  if (!recoveryBanner) return;
  if (storageLoadIssue) {
    recoveryBanner.hidden = false;
    recoveryBanner.setAttribute('aria-label', 'Recuperação do armazenamento local');
    recoveryBanner.innerHTML = `<div><strong>O mapa local não pôde ser lido e não foi sobrescrito.</strong><span>${storageLoadIssue.backupSaved ? 'Uma cópia bruta foi isolada neste navegador.' : 'Baixe o dado bruto antes de iniciar um novo mapa.'}</span></div><div class="recovery-actions"><button class="primary" id="downloadCorruptStorage">Baixar dado bruto</button><button id="replaceCorruptStorage" ${storageLoadIssue.backupSaved || storageLoadIssue.downloaded ? '' : 'disabled'}>Começar novo mapa</button></div>`;
    $('#downloadCorruptStorage')?.addEventListener('click', () => {
      downloadBlob(new Blob([storageLoadIssue.raw], { type: 'application/json' }), 'hexmap-dado-local-corrompido.json');
      storageLoadIssue.downloaded = true;
      renderRecoveryBanner();
      showToast('Cópia bruta baixada');
    });
    $('#replaceCorruptStorage')?.addEventListener('click', () => {
      if (!storageLoadIssue.backupSaved && !storageLoadIssue.downloaded) { showToast('Baixe o dado bruto antes de continuar'); return; }
      const issue = storageLoadIssue;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.map));
        storageLoadIssue = null;
        renderRecoveryBanner(); saveMap();
        showToast('Novo mapa iniciado; a cópia bruta foi preservada');
      } catch {
        storageLoadIssue = issue;
        showToast('O armazenamento continua indisponível; o dado original foi mantido');
      }
    });
    return;
  }
  recoveryBanner.setAttribute('aria-label', 'Recuperação de sessão');
  recoveryBanner.hidden = !state.recoveryOpen;
  if (!state.recoveryOpen) return;
  const when = state.recoveryCandidate?.savedAt ? new Date(state.recoveryCandidate.savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  recoveryBanner.innerHTML = `<div><strong>Encontramos uma sessão não gravada${when ? ` das ${when}` : ''}.</strong><span>Seu trabalho continua local e não foi enviado para lugar nenhum.</span></div><div class="recovery-actions"><button class="primary" id="restoreRecovery">Restaurar</button><button id="dismissRecovery">Descartar</button></div>`;
  $('#restoreRecovery')?.addEventListener('click', () => {
    const candidate = state.recoveryCandidate;
    if (!candidate?.map) return;
    state.map = normalizeMap(candidate.map);
    state.scale = Number(state.map.layout?.viewport?.zoom) || 1;
    state.tx = Number(state.map.layout?.viewport?.x) || 0;
    state.ty = Number(state.map.layout?.viewport?.y) || 0;
    state.recoveryOpen = false;
    state.recoveryCandidate = null;
    try { sessionStorage.removeItem(RECOVERY_KEY); } catch {}
    clearSelection({ keepWorkspace: Boolean(state.workspace) });
    render(); fitMap(true);
    showToast('Sessão restaurada');
  });
  $('#dismissRecovery')?.addEventListener('click', () => {
    state.recoveryOpen = false;
    state.recoveryCandidate = null;
    try { sessionStorage.removeItem(RECOVERY_KEY); } catch {}
    renderRecoveryBanner();
    showToast('Recuperação descartada');
  });
}

function lockEditorControls() {
  if (!state.readOnly) return;
  drawerContent?.querySelectorAll('input, textarea, select, [data-start-edit], .drawer-actions button, [data-custom-field], #createFieldDefinition').forEach((element) => {
    element.setAttribute('disabled', 'disabled');
    element.setAttribute('aria-disabled', 'true');
  });
}

function drawerTabs(items) {
  return `<div class="drawer-tabs" role="tablist">${items.map(([id, label]) => `<button id="drawer-tab-${id}" role="tab" aria-controls="drawer-panel-${id}" aria-selected="${state.drawerTab === id}" tabindex="${state.drawerTab === id ? '0' : '-1'}" class="drawer-tab${state.drawerTab === id ? ' active' : ''}" data-drawer-tab="${id}">${label}</button>`).join('')}</div>`;
}

function drawerPanel(content) {
  return `<div class="drawer-panel" id="drawer-panel-${state.drawerTab}" role="tabpanel" aria-labelledby="drawer-tab-${state.drawerTab}" tabindex="0">${content}</div>`;
}

function bindDrawerTabs() {
  const buttons = [...drawerContent.querySelectorAll('[data-drawer-tab]')];
  const activate = (id, focus = false) => {
    state.drawerTab = id;
    renderDrawer();
    if (focus) requestAnimationFrame(() => drawerContent.querySelector(`[data-drawer-tab="${id}"]`)?.focus());
  };
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => activate(button.dataset.drawerTab, keyboardNavigation));
    button.addEventListener('keydown', (event) => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(event.key in keys) && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + keys[event.key] + buttons.length) % buttons.length;
      activate(buttons[next].dataset.drawerTab, true);
    });
  });
}

function fieldInputHtml(definition, value, ownerKind = 'entity') {
  const id = `custom-field-${ownerKind}-${definition.key}`;
  const label = escapeHtml(definition.label || definition.key);
  if (definition.type === 'boolean') {
    return `<label class="field-check"><input type="checkbox" id="${id}" data-custom-field="${definition.key}" data-field-type="boolean" ${value ? 'checked' : ''}><span>${label}</span></label>`;
  }
  if (definition.type === 'select') {
    return `<div class="drawer-section compact"><label class="field-label" for="${id}">${label}</label><select class="field-input" id="${id}" data-custom-field="${definition.key}" data-field-type="select"><option value="">—</option>${(definition.options || []).map((option) => `<option value="${escapeAttr(option)}" ${String(value ?? '') === String(option) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></div>`;
  }
  if (definition.type === 'multi-select') {
    const serialized = Array.isArray(value) ? value.join(', ') : (value ?? '');
    return `<div class="drawer-section compact"><label class="field-label" for="${id}">${label}</label><input class="field-input" id="${id}" data-custom-field="${definition.key}" data-field-type="multi-select" value="${escapeAttr(serialized)}" placeholder="valor, outro valor"><p class="field-help">Separe múltiplos valores por vírgula.</p></div>`;
  }
  if (definition.type === 'image') {
    return `<div class="drawer-section compact"><label class="field-label" for="${id}">${label}</label><input class="field-input" type="url" id="${id}" data-custom-field="${definition.key}" data-field-type="image" value="${escapeAttr(value ?? '')}" placeholder="https://… ou data:image/…"></div>`;
  }
  if (definition.type === 'markdown' || definition.type === 'long-text') {
    return `<div class="drawer-section compact"><label class="field-label" for="${id}">${label}</label><textarea class="field-textarea small" id="${id}" data-custom-field="${definition.key}" data-field-type="${definition.type}">${escapeHtml(value ?? '')}</textarea></div>`;
  }
  const inputType = ['number', 'date', 'url', 'color'].includes(definition.type) ? definition.type : 'text';
  return `<div class="drawer-section compact"><label class="field-label" for="${id}">${label}</label><input class="field-input" type="${inputType}" id="${id}" data-custom-field="${definition.key}" data-field-type="${definition.type}" value="${escapeAttr(value ?? '')}"></div>`;
}

function bindCustomFieldInputs(owner) {
  drawerContent.querySelectorAll('[data-custom-field]').forEach((input) => input.addEventListener('change', () => {
    const before = mapSnapshot();
    const key = input.dataset.customField;
    const type = input.dataset.fieldType;
    let value;
    if (type === 'boolean') value = input.checked;
    else if (type === 'number') value = input.value === '' ? null : Number(input.value);
    else if (type === 'multi-select') value = input.value.split(',').map((item) => item.trim()).filter(Boolean);
    else value = input.value;
    owner.fields ||= {};
    owner.fields[key] = value;
    remember(before);
    render();
  }));
}

function newFieldForm() {
  return `<form class="new-field-form" id="newFieldForm">
    <label class="field-label" for="newFieldLabel">Nome do campo</label>
    <input class="field-input" id="newFieldLabel" placeholder="Ex.: Responsável" autocomplete="off">
    <label class="field-label" for="newFieldType">Tipo de conteúdo</label>
    <select class="field-input" id="newFieldType">
      <option value="text">Texto curto</option><option value="long-text">Texto longo</option><option value="markdown">Markdown</option>
      <option value="number">Número</option><option value="date">Data</option><option value="boolean">Booleano</option>
      <option value="select">Seleção</option><option value="multi-select">Seleção múltipla</option><option value="url">URL</option><option value="color">Cor</option><option value="image">Imagem / URL</option>
    </select>
    <label id="newFieldOptionsGroup" hidden><span class="field-label">Opções</span><input class="field-input" id="newFieldOptions" placeholder="Planejado, Em andamento, Concluído" aria-describedby="newFieldOptionsHelp"><span class="field-help" id="newFieldOptionsHelp">Separe as opções por vírgula.</span></label>
    <button type="submit" class="primary" id="createFieldDefinition">Criar campo</button>
  </form>`;
}

function bindNewFieldForm() {
  const form = $('#newFieldForm');
  const typeInput = $('#newFieldType');
  const optionsGroup = $('#newFieldOptionsGroup');
  if (!form || !typeInput || !optionsGroup) return;
  const updateOptionsVisibility = () => { optionsGroup.hidden = !['select', 'multi-select'].includes(typeInput.value); };
  typeInput.addEventListener('change', updateOptionsVisibility);
  updateOptionsVisibility();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const label = $('#newFieldLabel').value.trim();
    if (!label) { showToast('Dê um nome ao campo'); return; }
    const type = typeInput.value;
    const options = $('#newFieldOptions').value.split(',').map((value) => value.trim()).filter(Boolean);
    if (['select', 'multi-select'].includes(type) && !options.length) { showToast('Adicione ao menos uma opção'); $('#newFieldOptions').focus(); return; }
    const before = mapSnapshot();
    let key = slugify(label);
    let suffix = 2;
    while (state.map.fieldDefinitions.some((field) => field.key === key)) key = `${slugify(label)}-${suffix++}`;
    state.map.fieldDefinitions.push({ key, label, type, ...(['select','multi-select'].includes(type) ? { options } : {}) });
    remember(before);
    showToast(`Campo “${label}” criado`);
    renderDrawer();
  });
}

function markdownEditorHtml(owner, prefix) {
  const mode = state.markdownMode;
  return `<div class="markdown-toolbar">
    <button data-markdown-mode="edit" class="${mode === 'edit' ? 'active' : ''}">Editar</button>
    <button data-markdown-mode="split" class="${mode === 'split' ? 'active' : ''}">Dividir</button>
    <button data-markdown-mode="preview" class="${mode === 'preview' ? 'active' : ''}">Ler</button>
  </div>
  <div class="markdown-workspace mode-${mode}">
    <textarea class="markdown-source" id="${prefix}Markdown" spellcheck="true" placeholder="Cole ou escreva Markdown…">${escapeHtml(owner.bodyMarkdown || '')}</textarea>
    <article class="markdown-preview">${renderMarkdown(owner.bodyMarkdown || '')}</article>
  </div>`;
}

function bindMarkdownEditor(owner, prefix) {
  drawerContent.querySelectorAll('[data-markdown-mode]').forEach((button) => button.addEventListener('click', () => {
    state.markdownMode = button.dataset.markdownMode;
    renderDrawer();
  }));
  const textarea = $(`#${prefix}Markdown`);
  if (textarea) {
    let beforeSnapshot = null;
    let initialValue = owner.bodyMarkdown || '';
    const startSession = () => { if (!beforeSnapshot) beforeSnapshot = mapSnapshot(); };
    textarea.addEventListener('focus', startSession, { once: true });
    textarea.addEventListener('input', () => {
      startSession();
      owner.bodyMarkdown = textarea.value;
      const preview = drawerContent.querySelector('.markdown-preview');
      if (preview) preview.innerHTML = renderMarkdown(textarea.value);
      saveMap();
    });
    textarea.addEventListener('change', () => {
      owner.bodyMarkdown = textarea.value;
      if (textarea.value !== initialValue && beforeSnapshot) {
        remember(beforeSnapshot);
        initialValue = textarea.value;
        beforeSnapshot = null;
      }
    });
  }
}

function focusReadingHtml(owner, { title = '', summary = '', tags = [], fields = {} } = {}) {
  const populatedFields = state.map.fieldDefinitions
    .map((definition) => ({ definition, value: fields?.[definition.key] }))
    .filter(({ value }) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length));
  return `<article class="focus-document" aria-label="Leitura em foco de ${escapeAttr(title || 'conteúdo')}">
    <div class="focus-document-meta">
      <span class="focus-document-kicker">LEITURA EM FOCO</span>
      ${tags.length ? `<div class="tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
    </div>
    ${!owner.bodyMarkdown && summary ? `<p class="focus-document-empty">${escapeHtml(summary)}</p>` : ''}
    <div class="focus-document-body markdown-preview">${renderMarkdown(owner.bodyMarkdown || '')}</div>
    ${populatedFields.length ? `<aside class="focus-document-fields"><h3>Campos</h3><div class="focus-field-grid">${populatedFields.map(({ definition, value }) => `<div><span>${escapeHtml(definition.label)}</span><strong>${escapeHtml(Array.isArray(value) ? value.join(', ') : value)}</strong></div>`).join('')}</div></aside>` : ''}
  </article>`;
}

function deleteEntityById(entityId) {
  if (state.readOnly) return false;
  const entity = entityById(entityId);
  if (!entity) return false;
  const before = mapSnapshot();
  const relationCountBefore = state.map.relations.length;
  state.map.hexagons = state.map.hexagons.filter((item) => item.id !== entityId);
  state.map.relations = state.map.relations.filter((relation) => relation.source !== entityId && relation.target !== entityId);
  splitDisconnectedClusters();
  removeEmptyClusters();
  const removedRelations = relationCountBefore - state.map.relations.length;
  if (state.selectedEntityId === entityId) state.selectedEntityId = null;
  state.multiSelection.delete(entityId);
  if (state.connectSource?.id === entityId) state.connectSource = null;
  remember(before);
  const relationNote = removedRelations
    ? ` e ${removedRelations} ${removedRelations === 1 ? 'relação vinculada' : 'relações vinculadas'}`
    : '';
  showToast(`Hexágono excluído${relationNote} · use Desfazer para restaurar`);
  render();
  return true;
}

function deleteRelationById(relationId) {
  if (state.readOnly || !relationById(relationId)) return false;
  const before = mapSnapshot();
  state.map.relations = state.map.relations.filter((item) => item.id !== relationId);
  if (state.selectedRelationId === relationId) state.selectedRelationId = null;
  remember(before);
  showToast('Relação excluída · use Desfazer para restaurar');
  render();
  return true;
}

function deleteAnnotationById(annotationId) {
  if (state.readOnly || !state.map.annotations.some((item) => item.id === annotationId)) return false;
  const before = mapSnapshot();
  state.map.annotations = state.map.annotations.filter((item) => item.id !== annotationId);
  if (state.selectedAnnotationId === annotationId) state.selectedAnnotationId = null;
  remember(before);
  showToast('Texto excluído · use Desfazer para restaurar');
  render();
  return true;
}

function renderEntityDrawer(entity) {
  const cluster = entity.clusterId ? clusterById(entity.clusterId) : null;
  const adjacent = adjacentEntities(entity);
  const tabs = [['content','Conteúdo'],['fields','Campos'],['appearance','Aparência'],['relations','Relações']];
  let panel = '';
  if (state.drawerTab === 'content') {
    panel = state.drawerMode === 'focus' || state.markdownMode === 'preview'
      ? `${focusReadingHtml(entity, { title: entity.title, summary: entity.summary || entity.description || '', tags: entity.tags || [], fields: entity.fields || {} })}${state.drawerMode === 'focus' ? '' : '<div class="drawer-actions"><button data-start-edit>Editar conteúdo</button></div>'}`
      : `<div class="drawer-section"><label class="field-label" for="entityTitle">Título</label><input class="field-input title-input" id="entityTitle" value="${escapeAttr(entity.title)}"></div>
      <div class="drawer-section"><label class="field-label" for="entitySummary">Resumo</label><textarea class="field-textarea summary" id="entitySummary">${escapeHtml(entity.summary || entity.description || '')}</textarea></div>
      ${markdownEditorHtml(entity, 'entity')}`;
  } else if (state.drawerTab === 'fields') {
    panel = `<div class="drawer-section"><label class="field-label" for="entityTags">Tags</label><input class="field-input" id="entityTags" value="${escapeAttr((entity.tags || []).join(', '))}" placeholder="tag, outra-tag"></div>
      <div class="custom-fields">${state.map.fieldDefinitions.map((definition) => fieldInputHtml(definition, entity.fields?.[definition.key], 'entity')).join('')}</div>
      <div class="drawer-section"><h3>Novo campo no mapa</h3>${newFieldForm()}</div>`;
  } else if (state.drawerTab === 'appearance') {
    const visual = entity.visual || { mode: 'text', image: {} };
    const inheritedColor = visualColorFor({ ...entity, visual: { ...visual, color: null } }, cluster);
    panel = `<div class="drawer-section"><label class="field-label" for="entityColor">Cor do hexágono</label><div class="color-editor"><input type="color" id="entityColor" value="${escapeAttr(visual.color || inheritedColor)}" aria-label="Cor do hexágono"><button id="inheritEntityColor" ${visual.color ? '' : 'disabled'}>Herdar do cluster</button></div><p class="drawer-note">${visual.color ? 'Esta cor substitui a cor do cluster e qualquer regra do mapa.' : 'Este hexágono herda a cor do cluster ou da regra ativa.'}</p></div>
      <div class="drawer-section"><label class="field-label" for="visualMode">Composição do hexágono</label><select class="field-input" id="visualMode">
        <option value="text" ${visual.mode === 'text' ? 'selected' : ''}>Somente texto</option>
        <option value="icon" ${visual.mode === 'icon' ? 'selected' : ''}>Imagem/ícone + texto</option>
        <option value="cover" ${visual.mode === 'cover' ? 'selected' : ''}>Imagem de fundo + texto</option>
        <option value="image" ${visual.mode === 'image' ? 'selected' : ''}>Somente imagem</option>
      </select></div>
      <div class="drawer-section"><label class="field-label" for="imageUrl">Imagem — URL ou data URI</label><input class="field-input" id="imageUrl" value="${escapeAttr(visual.image?.src || '')}" placeholder="https://… ou assets/imagem.webp"><div class="inline-actions"><button id="uploadImage">Carregar imagem</button><button id="removeImage">Remover</button></div></div>
      <div class="drawer-section split-fields"><div><label class="field-label" for="imageFit">Ajuste</label><select class="field-input" id="imageFit"><option value="cover" ${(visual.image?.fit || 'cover') === 'cover' ? 'selected' : ''}>Cobrir</option><option value="contain" ${visual.image?.fit === 'contain' ? 'selected' : ''}>Conter</option></select></div><div><label class="field-label" for="imagePosition">Posição</label><input class="field-input" id="imagePosition" value="${escapeAttr(visual.image?.position || '50% 50%')}"></div></div>
      <div class="drawer-section"><label class="field-label" for="imageOverlay">Overlay do texto <output id="imageOverlayValue">${Math.round((visual.image?.overlay ?? .38) * 100)}%</output></label><input type="range" min="0" max="0.85" step="0.01" id="imageOverlay" value="${visual.image?.overlay ?? .38}"></div>`;
  } else {
    const axisValues = axisValuesOf(entity);
    panel = `<div class="metric-grid"><div><span>Cluster</span><strong>${cluster ? escapeHtml(cluster.title) : 'nenhum'}</strong></div><div><span>Vizinhos</span><strong>${adjacent.length}</strong></div><div><span>${state.map.layout.type === 'axes' ? 'X / Y' : 'Coordenada'}</span><strong>${axisValues ? `${axisValues.x.toFixed(1)} / ${axisValues.y.toFixed(1)}` : `${entity.q}, ${entity.r}`}</strong></div></div>
      <div class="drawer-section"><h3>Vizinhança imediata</h3><p class="neighbor-list">${adjacent.map((item) => escapeHtml(item.title)).join(' · ') || 'Nenhum hexágono adjacente.'}</p></div>
      <div class="drawer-actions"><button id="detachEntity">Retirar do cluster</button><button class="danger" id="deleteEntity">Excluir hexágono</button></div>`;
  }
  drawerContent.innerHTML = `<div class="drawer-kicker">HEXÁGONO${cluster ? ` · ${escapeHtml(cluster.title).toUpperCase()}` : ' · SEM CLUSTER'}</div><h2 title="${escapeAttr(entity.title)}">${escapeHtml(entity.title)}</h2><p class="drawer-lede">${escapeHtml(entity.summary || entity.description || '')}</p>${drawerTabs(tabs)}${drawerPanel(panel)}`;
  bindDrawerTabs();
  if (state.drawerTab === 'content') {
    $('[data-start-edit]')?.addEventListener('click', () => { state.markdownMode = 'edit'; renderDrawer(); });
    if (state.drawerMode !== 'focus' && state.markdownMode !== 'preview') {
      bindTextChange('#entityTitle', entity.title, (value) => { entity.title = value || 'Sem título'; });
      bindTextChange('#entitySummary', entity.summary || '', (value) => { entity.summary = value; entity.description = value; });
      bindMarkdownEditor(entity, 'entity');
    }
  } else if (state.drawerTab === 'fields') {
    bindTextChange('#entityTags', (entity.tags || []).join(', '), (value) => { entity.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean); });
    bindCustomFieldInputs(entity); bindNewFieldForm();
  } else if (state.drawerTab === 'appearance') {
    $('#entityColor').addEventListener('change', () => { const before = mapSnapshot(); entity.visual.color = $('#entityColor').value; remember(before); render(); });
    $('#inheritEntityColor').addEventListener('click', () => { const before = mapSnapshot(); entity.visual.color = null; remember(before); render(); });
    $('#visualMode').addEventListener('change', () => { const before = mapSnapshot(); entity.visual.mode = $('#visualMode').value; remember(before); render(); });
    bindTextChange('#imageUrl', entity.visual.image?.src || '', (value) => { entity.visual.image.src = value; });
    $('#imageFit').addEventListener('change', () => { const before = mapSnapshot(); entity.visual.image.fit = $('#imageFit').value; remember(before); render(); });
    bindTextChange('#imagePosition', entity.visual.image?.position || '50% 50%', (value) => { entity.visual.image.position = value || '50% 50%'; });
    let overlayBefore = null;
    const overlayInitial = Number(entity.visual.image?.overlay ?? .38);
    const beginOverlayChange = () => { overlayBefore ||= mapSnapshot(); };
    $('#imageOverlay').addEventListener('pointerdown', beginOverlayChange);
    $('#imageOverlay').addEventListener('focus', beginOverlayChange);
    $('#imageOverlay').addEventListener('input', () => {
      beginOverlayChange();
      entity.visual.image.overlay = Number($('#imageOverlay').value);
      $('#imageOverlayValue').textContent = `${Math.round(entity.visual.image.overlay * 100)}%`;
      renderNodes();
    });
    $('#imageOverlay').addEventListener('change', () => {
      if (overlayBefore && entity.visual.image.overlay !== overlayInitial) remember(overlayBefore);
      overlayBefore = null;
      saveMap();
      updateActionButtons();
    });
    $('#uploadImage').addEventListener('click', () => { state.pendingImageEntityId = entity.id; imageInput.click(); });
    $('#removeImage').addEventListener('click', () => { const before = mapSnapshot(); entity.visual.image.src = ''; entity.visual.mode = 'text'; remember(before); render(); });
  } else {
    $('#detachEntity')?.addEventListener('click', () => { const before = mapSnapshot(); entity.clusterId = null; splitDisconnectedClusters(); remember(before); showToast('Hexágono retirado do cluster'); render(); });
    $('#deleteEntity')?.addEventListener('click', () => deleteEntityById(entity.id));
  }
}

function renderClusterDrawer(cluster) {
  const members = membersOf(cluster.id);
  const incoming = state.map.relations.filter((relation) => relation.target === cluster.id);
  const outgoing = state.map.relations.filter((relation) => relation.source === cluster.id);
  const tabs = [['content','Conteúdo'],['fields','Campos'],['appearance','Aparência'],['relations','Relações']];
  let panel = '';
  if (state.drawerTab === 'content') {
    panel = state.drawerMode === 'focus' || state.markdownMode === 'preview'
      ? `${focusReadingHtml(cluster, { title: cluster.title, summary: cluster.description || '', tags: cluster.tags || [], fields: cluster.fields || {} })}${state.drawerMode === 'focus' ? '' : '<div class="drawer-actions"><button data-start-edit>Editar conteúdo</button></div>'}`
      : `<div class="drawer-section"><label class="field-label" for="clusterTitle">Título</label><input class="field-input title-input" id="clusterTitle" value="${escapeAttr(cluster.title)}"></div><div class="drawer-section"><label class="field-label" for="clusterDescription">Resumo</label><textarea class="field-textarea summary" id="clusterDescription">${escapeHtml(cluster.description || '')}</textarea></div>${markdownEditorHtml(cluster, 'cluster')}`;
  } else if (state.drawerTab === 'fields') {
    panel = `<div class="drawer-section"><label class="field-label" for="clusterTags">Tags</label><input class="field-input" id="clusterTags" value="${escapeAttr((cluster.tags || []).join(', '))}"></div><div class="custom-fields">${state.map.fieldDefinitions.map((definition) => fieldInputHtml(definition, cluster.fields?.[definition.key], 'cluster')).join('')}</div>${newFieldForm()}`;
  } else if (state.drawerTab === 'appearance') {
    panel = `<div class="drawer-section"><label class="field-label" for="clusterColorInput">Cor do cluster</label><div class="color-editor"><input type="color" id="clusterColorInput" value="${escapeAttr(cluster.color)}" aria-label="Cor do cluster"><span>Escolha qualquer cor</span></div><div class="color-grid" aria-label="Cores sugeridas">${PALETTE.map((color) => `<button class="color-choice${color === cluster.color ? ' active' : ''}" style="--choice:${color}" data-color="${color}" title="Usar ${color}" aria-label="Usar cor ${color}"></button>`).join('')}</div></div><p class="drawer-note">Os hexágonos sem cor própria herdam esta cor. O título editorial é posicionado automaticamente.</p>`;
  } else {
    panel = `<div class="metric-grid"><div><span>Hexágonos</span><strong>${members.length}</strong></div><div><span>Entradas</span><strong>${incoming.length}</strong></div><div><span>Saídas</span><strong>${outgoing.length}</strong></div></div><div class="drawer-section"><h3>Composição</h3><p class="neighbor-list">${members.map((entity) => escapeHtml(entity.title)).join(' · ')}</p></div><div class="drawer-section"><h3>Relações</h3><div class="relation-cards">${[...incoming, ...outgoing].map((relation) => `<button data-focus-relation="${relation.id}"><strong>${escapeHtml(relation.label)}</strong><span>${escapeHtml(clusterById(relation.source)?.title || '')} → ${escapeHtml(clusterById(relation.target)?.title || '')}</span></button>`).join('') || '<p class="empty-note">Nenhuma relação.</p>'}</div></div><div class="drawer-actions"><button id="dissolveCluster">Desmontar cluster</button><button class="primary" id="startRelation">Criar relação</button></div>`;
  }
  drawerContent.innerHTML = `<div class="drawer-kicker">CLUSTER · ARRASTÁVEL</div><h2>${escapeHtml(cluster.title)}</h2><p class="drawer-lede">${escapeHtml(cluster.description || '')}</p>${drawerTabs(tabs)}${drawerPanel(panel)}`;
  bindDrawerTabs();
  if (state.drawerTab === 'content') {
    $('[data-start-edit]')?.addEventListener('click', () => { state.markdownMode = 'edit'; renderDrawer(); });
    if (state.drawerMode !== 'focus' && state.markdownMode !== 'preview') {
      bindTextChange('#clusterTitle', cluster.title, (value) => { cluster.title = value || 'Cluster sem título'; });
      bindTextChange('#clusterDescription', cluster.description || '', (value) => { cluster.description = value; });
      bindMarkdownEditor(cluster, 'cluster');
    }
  } else if (state.drawerTab === 'fields') {
    bindTextChange('#clusterTags', (cluster.tags || []).join(', '), (value) => { cluster.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean); });
    bindCustomFieldInputs(cluster); bindNewFieldForm();
  } else if (state.drawerTab === 'appearance') {
    $('#clusterColorInput').addEventListener('change', () => { const before = mapSnapshot(); cluster.color = $('#clusterColorInput').value; remember(before); render(); });
    $$('.color-choice').forEach((button) => button.addEventListener('click', () => { const before = mapSnapshot(); cluster.color = button.dataset.color; remember(before); render(); }));
  } else {
    drawerContent.querySelectorAll('[data-focus-relation]').forEach((button) => button.addEventListener('click', () => { clearSelection(); state.selectedRelationId = button.dataset.focusRelation; state.drawerTab = 'routing'; render(); }));
    $('#dissolveCluster').addEventListener('click', () => dissolveCluster(cluster.id));
    $('#startRelation').addEventListener('click', () => { setTool('connect'); state.connectSource = { id: cluster.id, type: 'cluster' }; state.selectedClusterId = null; render(); });
  }
}

function renderRelationDrawer(relation) {
  const source = relationEndpoint(relation, 'source');
  const target = relationEndpoint(relation, 'target');
  const geometry = state.relationGeometry.get(relation.id);
  const tabs = [['routing','Curvatura'],['content','Conteúdo']];
  const routing = relation.routing || { mode: 'auto', offset: { along: 0, perpendicular: .2 } };
  const edge = isAdjacentHexRelation(relation, source, target);
  let panel;
  if (state.drawerTab === 'content') {
    panel = `<div class="relation-card"><strong>${escapeHtml(source?.title || 'Origem')}</strong> → <strong>${escapeHtml(target?.title || 'Destino')}</strong></div><div class="drawer-section"><label class="field-label" for="relationLabel">Rótulo <span class="optional">opcional</span></label><input class="field-input" id="relationLabel" value="${escapeAttr(relation.label)}" placeholder="Sem rótulo"></div><div class="drawer-actions"><button class="danger" id="deleteRelation">Excluir relação</button></div>`;
  } else {
    panel = `<div class="relation-card"><strong>${escapeHtml(source?.title || 'Origem')}</strong> → <strong>${escapeHtml(target?.title || 'Destino')}</strong></div>
      ${edge ? '<p class="drawer-note">Hexágonos vizinhos usam a borda compartilhada como caminho. Afaste um deles para transformar a ligação em linha.</p>' : `
      <div class="drawer-section"><label class="field-label" for="routingMode">Modo de roteamento</label><select class="field-input" id="routingMode"><option value="auto" ${routing.mode === 'auto' ? 'selected' : ''}>Automático</option><option value="assisted" ${routing.mode === 'assisted' ? 'selected' : ''}>Assistido</option><option value="manual" ${routing.mode === 'manual' ? 'selected' : ''}>Manual</option></select></div>
      <div class="routing-metrics"><div><span>Desvio lateral</span><strong id="routingBendValue">${(routing.offset?.perpendicular || 0).toFixed(2)}</strong></div><div><span>Ângulo</span><strong id="routingAngleValue">${(routing.offset?.along || 0).toFixed(2)}</strong></div><div><span>Custo</span><strong>${Math.round(geometry?.score || 0)}</strong></div></div>
      <div class="drawer-section"><label class="field-label" for="routingBend">Curvatura lateral</label><input type="range" id="routingBend" min="-0.95" max="0.95" step="0.01" value="${routing.offset?.perpendicular || 0}"></div>
      <div class="drawer-section"><label class="field-label" for="routingAngle">Ângulo / avanço do controle</label><input type="range" id="routingAngle" min="-0.65" max="0.65" step="0.01" value="${routing.offset?.along || 0}"></div>
      <p class="drawer-note">O modo automático avalia os dois lados da relação, a direção de saída, territórios, títulos, cruzamentos e o lado externo do mapa. Ajuste pelos sliders ou arraste o handle no canvas apenas quando quiser uma decisão editorial específica.</p>
      `}<div class="drawer-actions routing-actions">${edge ? '' : '<button id="flipRouting">Inverter lado</button><button id="resetRouting">Recalcular automaticamente</button>'}<button class="danger" id="deleteRelation">Excluir relação</button></div>`;
  }
  drawerContent.innerHTML = `<div class="drawer-kicker">${edge ? 'CAMINHO ENTRE HEXÁGONOS' : 'RELAÇÃO'}</div><h2>${escapeHtml(relation.label || `${source?.title || 'Origem'} → ${target?.title || 'Destino'}`)}</h2>${drawerTabs(tabs)}${drawerPanel(panel)}`;
  bindDrawerTabs();
  if (state.drawerTab === 'content') bindTextChange('#relationLabel', relation.label, (value) => { relation.label = value; });
  else if (!edge) {
    $('#routingMode').addEventListener('change', () => { const before = mapSnapshot(); relation.routing.mode = $('#routingMode').value; remember(before); render(); });
    let sliderBefore = null;
    const updateRoutingFromSliders = () => {
      sliderBefore ||= mapSnapshot();
      relation.routing.mode = 'assisted';
      relation.routing.offset = { along: Number($('#routingAngle').value), perpendicular: Number($('#routingBend').value) };
      $('#routingMode').value = 'assisted';
      $('#routingBendValue').textContent = relation.routing.offset.perpendicular.toFixed(2);
      $('#routingAngleValue').textContent = relation.routing.offset.along.toFixed(2);
      renderRelations();
    };
    $('#routingBend').addEventListener('input', updateRoutingFromSliders);
    $('#routingAngle').addEventListener('input', updateRoutingFromSliders);
    const commitRouting = () => {
      if (sliderBefore) remember(sliderBefore);
      sliderBefore = null;
      saveMap();
      updateActionButtons();
    };
    $('#routingBend').addEventListener('change', commitRouting);
    $('#routingAngle').addEventListener('change', commitRouting);
    $('#flipRouting').addEventListener('click', () => { const before = mapSnapshot(); relation.routing.mode = 'assisted'; relation.routing.offset ||= { along: 0, perpendicular: .2 }; relation.routing.offset.perpendicular = -(relation.routing.offset.perpendicular || .22); remember(before); render(); });
    $('#resetRouting').addEventListener('click', () => { const before = mapSnapshot(); relation.routing = { mode: 'auto', offset: { along: 0, perpendicular: .2 } }; remember(before); render(); });
  }
  $('#deleteRelation')?.addEventListener('click', () => deleteRelationById(relation.id));
}

function renderAnnotationDrawer(annotation) {
  const tabs = [['content','Conteúdo'],['appearance','Aparência']];
  let panel;
  if (state.drawerTab === 'appearance') {
    panel = `<div class="drawer-section"><label class="field-label" for="annotationVariant">Estilo</label><select class="field-input" id="annotationVariant"><option value="editorial" ${annotation.style.variant === 'editorial' ? 'selected' : ''}>Editorial</option><option value="note" ${annotation.style.variant === 'note' ? 'selected' : ''}>Nota</option><option value="label" ${annotation.style.variant === 'label' ? 'selected' : ''}>Título solto</option></select></div><div class="drawer-section"><label class="field-label" for="annotationSize">Tamanho <output id="annotationSizeValue">${annotation.style.fontSize || 17}px</output></label><input type="range" id="annotationSize" min="12" max="38" value="${annotation.style.fontSize || 17}"></div><div class="drawer-section"><label class="field-label" for="annotationWidth">Largura <output id="annotationWidthValue">${annotation.width || 320}px</output></label><input type="range" id="annotationWidth" min="180" max="720" value="${annotation.width || 320}"></div><div class="drawer-actions"><button class="danger" id="deleteAnnotation">Excluir texto</button></div>`;
  } else {
    panel = state.drawerMode === 'focus'
      ? focusReadingHtml(annotation, { title: annotation.title || 'Anotação', summary: '', tags: [], fields: {} })
      : `<div class="drawer-section"><label class="field-label" for="annotationTitle">Título</label><input class="field-input title-input" id="annotationTitle" value="${escapeAttr(annotation.title || '')}"></div>${markdownEditorHtml(annotation, 'annotation')}`;
  }
  drawerContent.innerHTML = `<div class="drawer-kicker">TEXTO NO CANVAS</div><h2>${escapeHtml(annotation.title || 'Anotação')}</h2>${drawerTabs(tabs)}${drawerPanel(panel)}`;
  bindDrawerTabs();
  if (state.drawerTab === 'content') {
    if (state.drawerMode !== 'focus') { bindTextChange('#annotationTitle', annotation.title || '', (value) => { annotation.title = value; }); bindMarkdownEditor(annotation, 'annotation'); }
  }
  else {
    $('#annotationVariant').addEventListener('change', () => { const before = mapSnapshot(); annotation.style.variant = $('#annotationVariant').value; remember(before); render(); });
    const bindAnnotationRange = (inputSelector, outputSelector, readValue, writeValue) => {
      const input = $(inputSelector);
      const output = $(outputSelector);
      const initialValue = Number(readValue());
      let before = null;
      const begin = () => { before ||= mapSnapshot(); };
      input.addEventListener('pointerdown', begin);
      input.addEventListener('focus', begin);
      input.addEventListener('input', () => {
        begin();
        const value = Number(input.value);
        writeValue(value);
        output.textContent = `${value}px`;
        renderAnnotations();
      });
      input.addEventListener('change', () => {
        if (before && Number(readValue()) !== initialValue) remember(before);
        before = null;
        saveMap();
        updateActionButtons();
      });
    };
    bindAnnotationRange('#annotationSize', '#annotationSizeValue', () => annotation.style.fontSize || 17, (value) => { annotation.style.fontSize = value; });
    bindAnnotationRange('#annotationWidth', '#annotationWidthValue', () => annotation.width || 320, (value) => { annotation.width = value; });
    $('#deleteAnnotation').addEventListener('click', () => deleteAnnotationById(annotation.id));
  }
}

function renderMapSettings() {
  const axes = state.map.layout.axes;
  const tabs = [['map','Mapa'],['fields','Campos'],['style','Estilo'],['layout','Layout'],['publish','Publicar']];
  let panel = '';
  if (state.drawerTab === 'map') {
    panel = `<div class="drawer-section"><label class="field-label" for="mapTitleInput">Título do mapa</label><input class="field-input title-input" id="mapTitleInput" value="${escapeAttr(state.map.title)}"></div><div class="drawer-section"><label class="field-label" for="mapDescriptionInput">Descrição</label><textarea class="field-textarea" id="mapDescriptionInput">${escapeHtml(state.map.description || '')}</textarea></div><div class="metric-grid"><div><span>Hexágonos</span><strong>${state.map.hexagons.length}</strong></div><div><span>Clusters</span><strong>${state.map.clusters.length}</strong></div><div><span>Schema</span><strong>${state.map.schemaVersion}</strong></div></div>`;
  } else if (state.drawerTab === 'fields') {
    panel = `<div class="field-definition-list">${state.map.fieldDefinitions.map((field) => `<div class="field-definition"><div><strong>${escapeHtml(field.label)}</strong><span>${escapeHtml(field.key)} · ${escapeHtml(field.type)}</span></div><button data-delete-field="${field.key}" title="Excluir ${escapeAttr(field.label)}" aria-label="Excluir campo ${escapeAttr(field.label)}">×</button></div>`).join('')}</div><div class="drawer-section"><h3>Criar campo</h3>${newFieldForm()}</div>`;
  } else if (state.drawerTab === 'style') {
    const fieldOptions = `<option value="__tags__" ${state.map.styleRules.colorByField === '__tags__' ? 'selected' : ''}>Tags — primeira tag</option>${state.map.fieldDefinitions.map((field) => `<option value="${field.key}" ${state.map.styleRules.colorByField === field.key ? 'selected' : ''}>${escapeHtml(field.label)}</option>`).join('')}`;
    panel = `<div class="drawer-section"><label class="field-label" for="colorByField">Colorir hexágonos por campo</label><select class="field-input" id="colorByField"><option value="">Cor do cluster</option>${fieldOptions}</select></div>${state.map.styleRules.colorByField ? `<div class="style-legend">${Object.entries(state.map.styleRules.colorMap).map(([value,color]) => `<label><input type="color" data-style-color="${escapeAttr(value)}" value="${escapeAttr(color)}"><strong>${escapeHtml(value)}</strong></label>`).join('')}</div>` : ''}<div class="drawer-section"><label class="field-label" for="groupByField">Formar clusters por campo</label><div class="inline-actions"><select class="field-input" id="groupByField"><option value="">Escolha um campo</option><option value="__tags__">Tags — primeira tag</option>${state.map.fieldDefinitions.map((field) => `<option value="${field.key}">${escapeHtml(field.label)}</option>`).join('')}</select><button id="applyGroupByField">Aplicar</button></div><p class="drawer-note">Reorganiza o mapa a partir do campo escolhido. Para campos múltiplos e tags, o primeiro valor preenchido funciona como chave principal.</p></div>`;
  } else if (state.drawerTab === 'publish') {
    const externalImageCount = state.map.hexagons.filter((entity) => entity.visual?.image?.src && !entity.visual.image.src.startsWith('data:')).length;
    panel = `<div class="publish-hero"><span class="publish-icon">◉</span><div><h3>Compartilhe sem servidor</h3><p>Baixe uma página pronta ou uma imagem vetorial. Nada é enviado: os arquivos são gerados neste navegador.</p></div></div><div class="publish-actions"><button id="exportHtmlFromPublish" class="primary">Baixar página HTML</button><button id="exportSvgFromPublish">Baixar SVG</button><button id="openPresentationFromPublish">Ver apresentação</button><button id="exportBundleFromPublish">Pacote editável</button></div>${externalImageCount ? `<p class="drawer-note" role="note"><strong>${externalImageCount} ${externalImageCount === 1 ? 'imagem usa' : 'imagens usam'} URL externa.</strong> HTML e SVG preservarão o endereço, mas precisarão de internet. Use “Carregar imagem” para um arquivo totalmente independente.</p>` : ''}<div class="drawer-section"><h3>Qual escolher?</h3><p class="drawer-note"><strong>HTML</strong> abre em qualquer navegador. <strong>SVG</strong> serve para documentos e impressão. O <strong>pacote editável</strong> leva o mapa e suas notas para outro HexMap.</p></div>`;
  } else {
    const mode = layoutMode();
    panel = `<div class="drawer-section"><label class="field-label" for="settingsLayoutType">Modo do mapa</label><select class="field-input" id="settingsLayoutType"><option value="territories" ${mode === 'territories' ? 'selected' : ''}>Territórios</option><option value="mosaic" ${mode === 'mosaic' ? 'selected' : ''}>Mosaico</option><option value="axes" ${mode === 'axes' ? 'selected' : ''}>Eixos</option></select><p class="drawer-note">Territórios destaca grupos. Mosaico favorece tiling e caminhos. Eixos posiciona por dois valores.</p></div><div class="drawer-section"><label class="check-row"><input type="checkbox" id="autoCluster" ${state.map.layout.autoCluster ? 'checked' : ''} ${mode === 'axes' ? 'disabled' : ''}><span>Agrupar automaticamente ao encostar</span></label><p class="drawer-note">Desligue para conectar hexágonos como tiles ou caminhos sem criar clusters. Clusters existentes permanecem até serem desmontados.</p></div><div class="drawer-section"><label class="check-row"><input type="checkbox" id="showClusterHulls" ${state.map.layout.showClusterHulls ? 'checked' : ''}><span>Mostrar contornos dos grupos</span></label></div><div class="axes-settings" ${mode === 'axes' ? '' : 'hidden'}><div class="drawer-section split-fields"><div><label class="field-label" for="xAxisLabel">Eixo X</label><input class="field-input" id="xAxisLabel" value="${escapeAttr(axes.xLabel)}"></div><div><label class="field-label" for="yAxisLabel">Eixo Y</label><input class="field-input" id="yAxisLabel" value="${escapeAttr(axes.yLabel)}"></div></div><div class="drawer-section four-fields"><label>mín X<input class="field-input" type="number" id="xMin" value="${axes.xMin}"></label><label>máx X<input class="field-input" type="number" id="xMax" value="${axes.xMax}"></label><label>mín Y<input class="field-input" type="number" id="yMin" value="${axes.yMin}"></label><label>máx Y<input class="field-input" type="number" id="yMax" value="${axes.yMax}"></label></div></div>`;
  }
  drawerContent.innerHTML = `<div class="drawer-kicker">CONFIGURAÇÃO DO MAPA</div><h2>${escapeHtml(state.map.title)}</h2>${drawerTabs(tabs)}${drawerPanel(panel)}`;
  bindDrawerTabs();
  if (state.drawerTab === 'map') { bindTextChange('#mapTitleInput', state.map.title, (value) => { state.map.title = value || 'Mapa hexagonal'; }); bindTextChange('#mapDescriptionInput', state.map.description || '', (value) => { state.map.description = value; }); }
  else if (state.drawerTab === 'fields') {
    bindNewFieldForm();
    drawerContent.querySelectorAll('[data-delete-field]').forEach((button) => button.addEventListener('click', () => {
      const before = mapSnapshot();
      const key = button.dataset.deleteField;
      const definition = state.map.fieldDefinitions.find((field) => field.key === key);
      const owners = [...state.map.hexagons, ...state.map.clusters];
      const removedValues = owners.filter((owner) => {
        const value = owner.fields?.[key];
        return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length);
      }).length;
      state.map.fieldDefinitions = state.map.fieldDefinitions.filter((field) => field.key !== key);
      for (const owner of owners) delete owner.fields?.[key];
      if (state.map.styleRules.colorByField === key) state.map.styleRules.colorByField = null;
      remember(before);
      const valueNote = removedValues ? ` e ${removedValues} ${removedValues === 1 ? 'valor preenchido' : 'valores preenchidos'}` : '';
      showToast(`Campo “${definition?.label || key}” excluído${valueNote} · use Desfazer para restaurar`);
      render();
    }));
  } else if (state.drawerTab === 'style') {
    $('#colorByField').addEventListener('change', () => { const before = mapSnapshot(); state.map.styleRules.colorByField = $('#colorByField').value || null; state.map.styleRules.colorMap = {}; remember(before); render(); });
    drawerContent.querySelectorAll('[data-style-color]').forEach((input) => input.addEventListener('change', () => { const before = mapSnapshot(); state.map.styleRules.colorMap[input.dataset.styleColor] = input.value; remember(before); render(); }));
    $('#applyGroupByField').addEventListener('click', () => { const key = $('#groupByField').value; if (!key) { showToast('Escolha um campo'); return; } groupByField(key); });
  } else if (state.drawerTab === 'layout') {
    $('#settingsLayoutType').addEventListener('change', () => changeLayout($('#settingsLayoutType').value));
    $('#autoCluster').addEventListener('change', () => { const before = mapSnapshot(); state.map.layout.autoCluster = $('#autoCluster').checked; remember(before); render(); showToast(state.map.layout.autoCluster ? 'Agrupamento automático ativado' : 'Tiling livre ativado'); });
    $('#showClusterHulls').addEventListener('change', () => { const before = mapSnapshot(); state.map.layout.showClusterHulls = $('#showClusterHulls').checked; remember(before); render(); });
    bindTextChange('#xAxisLabel', axes.xLabel, (value) => { axes.xLabel = value || 'Eixo X'; });
    bindTextChange('#yAxisLabel', axes.yLabel, (value) => { axes.yLabel = value || 'Eixo Y'; });
    ['xMin','xMax','yMin','yMax'].forEach((id) => $(`#${id}`).addEventListener('change', () => { const before = mapSnapshot(); axes[id] = Number($(`#${id}`).value); remember(before); render(); }));
  } else {
    $('#openPresentationFromPublish')?.addEventListener('click', () => { state.settingsOpen = false; state.presentation = true; state.readOnly = true; state.drawerMode = 'focus'; clearSelection(); render(); fitMap(true); showToast('Modo apresentação — somente leitura'); });
    $('#exportHtmlFromPublish')?.addEventListener('click', exportPublishedHtml);
    $('#exportSvgFromPublish')?.addEventListener('click', exportPublishedSvg);
    $('#exportBundleFromPublish')?.addEventListener('click', () => exportWorkspaceBundle());
  }
}

function renderDrawer() {
  const open = Boolean(state.selectedEntityId || state.selectedClusterId || state.selectedRelationId || state.selectedAnnotationId || state.settingsOpen || state.workspaceOpen);
  const opening = open && !drawerWasOpen;
  const closing = !open && drawerWasOpen;
  document.documentElement.dataset.drawerOpen = String(open);
  document.documentElement.dataset.drawerMode = state.drawerMode;
  document.documentElement.dataset.drawerSide = drawerReturnTarget?.side || 'right';
  drawer.hidden = !open;
  drawer.classList.toggle('open', open);
  drawer.toggleAttribute('inert', !open);
  drawer.setAttribute('aria-hidden', String(!open));
  drawer.classList.toggle('wide', state.drawerMode === 'wide');
  drawer.classList.toggle('focus', state.drawerMode === 'focus');
  $('#projectBtn').setAttribute('aria-expanded', String(open && state.workspaceOpen));
  $('#mapSettingsBtn').setAttribute('aria-expanded', String(open && state.settingsOpen));
  let drawerLabel = 'Detalhes do mapa';
  if (state.workspaceOpen) drawerLabel = 'Projeto local-first';
  else if (state.settingsOpen) drawerLabel = 'Configurações do mapa';
  else if (state.selectedEntityId) drawerLabel = `Detalhes do hexágono ${entityById(state.selectedEntityId)?.title || ''}`.trim();
  else if (state.selectedClusterId) drawerLabel = `Detalhes do cluster ${clusterById(state.selectedClusterId)?.title || ''}`.trim();
  else if (state.selectedRelationId) {
    const relation = relationById(state.selectedRelationId);
    const source = relation ? relationEndpoint(relation, 'source') : null;
    const target = relation ? relationEndpoint(relation, 'target') : null;
    drawerLabel = `Detalhes da relação ${relation?.label || [source?.title, target?.title].filter(Boolean).join(' para ')}`.trim();
  } else if (state.selectedAnnotationId) {
    const annotation = state.map.annotations.find((item) => item.id === state.selectedAnnotationId);
    drawerLabel = `Detalhes da anotação ${annotation?.title || 'sem título'}`;
  }
  drawer.setAttribute('aria-label', drawerLabel);
  const expandAction = state.drawerMode === 'focus' ? 'Reduzir leitura' : 'Expandir leitura';
  $('#drawerExpand').textContent = state.drawerMode === 'focus' ? '⤡' : state.drawerMode === 'wide' ? '⛶' : '⤢';
  $('#drawerExpand').setAttribute('aria-expanded', String(state.drawerMode !== 'peek'));
  $('#drawerExpand').setAttribute('aria-label', expandAction);
  $('#drawerExpand').setAttribute('title', expandAction);
  drawerWasOpen = open;
  if (opening && (drawerReturnTarget?.keyboard || keyboardNavigation)) requestAnimationFrame(() => $('#drawerClose')?.focus());
  if (!open) {
    if (closing && drawerReturnTarget?.keyboard) requestAnimationFrame(restoreDrawerFocus);
    else if (closing) drawerReturnTarget = null;
    return;
  }
  if (state.workspaceOpen) { renderWorkspaceDrawer(); return; }
  if (state.settingsOpen) { renderMapSettings(); return; }
  if (state.selectedEntityId) { const entity = entityById(state.selectedEntityId); if (entity) renderEntityDrawer(entity); return; }
  if (state.selectedClusterId) { const cluster = clusterById(state.selectedClusterId); if (cluster) renderClusterDrawer(cluster); return; }
  if (state.selectedRelationId) { const relation = relationById(state.selectedRelationId); if (relation) renderRelationDrawer(relation); return; }
  if (state.selectedAnnotationId) { const annotation = state.map.annotations.find((item) => item.id === state.selectedAnnotationId); if (annotation) renderAnnotationDrawer(annotation); }
}

function bindTextChange(selector, initialValue, updater) {
  const input = $(selector);
  input.addEventListener('change', () => {
    const before = mapSnapshot();
    if (input.value === initialValue) return;
    updater(input.value.trim());
    remember(before);
    render();
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('\n', '&#10;');
}

function clearSelection({ keepSettings = false, keepWorkspace = false } = {}) {
  hideTooltip();
  state.selectedEntityId = null;
  state.selectedClusterId = null;
  state.selectedRelationId = null;
  state.selectedAnnotationId = null;
  if (!keepSettings) state.settingsOpen = false;
  if (!keepWorkspace) state.workspaceOpen = false;
  state.multiSelection.clear();
  state.drawerTab = 'content';
  state.drawerMode = 'peek';
  state.markdownMode = 'preview';
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}

function currentPortableBundle() {
  syncViewportToMap();
  if (state.workspace) synchronizeWorkspaceNotes(state.workspace, state.map);
  return createPortableBundle(state.map, state.workspace?.originals, {
    viewManifests: state.workspace?.viewManifests,
    activeViewId: state.workspace?.activeViewId || state.map.activeViewId,
  });
}

function exportWorkspaceBundle({ backup = false } = {}) {
  try {
    const suffix = backup ? '-backup' : '';
    downloadJson(currentPortableBundle(), `${slugify(state.map.title)}${suffix}.hexmap-workspace.json`);
    if (!backup && state.workspace && !state.workspace.directoryHandle) state.workspace.lastSavedMap = workspaceSnapshot();
    saveMap();
    if (state.workspaceOpen) renderWorkspaceDrawer();
    showToast(backup ? 'Backup portátil baixado' : 'Bundle editável exportado');
  } catch (error) {
    showToast(`Falha ao exportar bundle: ${error.message}`);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.hidden = true; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function publishedTextLines(value, maxCharacters, maxLines) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  for (const word of words) {
    const chunks = word.length > maxCharacters ? word.match(new RegExp(`.{1,${maxCharacters}}`, 'g')) : [word];
    for (const chunk of chunks) {
      const last = lines.at(-1);
      if (last && `${last} ${chunk}`.length <= maxCharacters) lines[lines.length - 1] = `${last} ${chunk}`;
      else lines.push(chunk);
    }
  }
  if (lines.length > maxLines) {
    const remainder = lines.slice(maxLines - 1).join(' ');
    lines.splice(maxLines - 1, Infinity, `${remainder.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`);
  }
  return lines;
}

function publishedAnnotationMarkup(annotation) {
  const width = Math.max(180, Math.min(720, Number(annotation.width) || 320));
  const fontSize = Math.max(12, Math.min(38, Number(annotation.style?.fontSize) || 17));
  const variant = ['editorial', 'note', 'label'].includes(annotation.style?.variant) ? annotation.style.variant : 'editorial';
  const align = ['left', 'center', 'right'].includes(annotation.style?.align) ? annotation.style.align : 'left';
  const inset = variant === 'label' ? 0 : 18;
  const textWidth = Math.max(120, width - inset * 2);
  const characters = Math.max(16, Math.floor(textWidth / (fontSize * .58)));
  const titleLines = publishedTextLines(annotation.title || '', characters, 2);
  const bodyLines = publishedTextLines(markdownExcerpt(annotation.bodyMarkdown || '', 520), Math.max(18, Math.floor(textWidth / (fontSize * .43))), 7);
  const titleLineHeight = fontSize * 1.12;
  const bodyFontSize = Math.max(10, fontSize * .72);
  const bodyLineHeight = bodyFontSize * 1.5;
  const kickerHeight = variant === 'label' ? 0 : 15;
  const titleHeight = titleLines.length * titleLineHeight;
  const bodyGap = titleLines.length && bodyLines.length ? 8 : 0;
  const height = Math.max(42, inset * 2 + kickerHeight + titleHeight + bodyGap + bodyLines.length * bodyLineHeight);
  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const textX = align === 'center' ? width / 2 : align === 'right' ? width - inset : inset;
  let cursorY = inset;
  const kicker = variant === 'label' ? '' : `<text class="published-annotation-kicker" x="${textX}" y="${cursorY + 8}" text-anchor="${anchor}">NOTA</text>`;
  cursorY += kickerHeight;
  const title = titleLines.length ? `<text class="published-annotation-title" x="${textX}" y="${cursorY + fontSize}" text-anchor="${anchor}" style="font-size:${fontSize}px">${titleLines.map((line, index) => `<tspan x="${textX}" dy="${index ? titleLineHeight : 0}">${escapeHtml(line)}</tspan>`).join('')}</text>` : '';
  cursorY += titleHeight + bodyGap;
  const body = bodyLines.length ? `<text class="published-annotation-body" x="${textX}" y="${cursorY + bodyFontSize}" text-anchor="${anchor}" style="font-size:${bodyFontSize}px">${bodyLines.map((line, index) => `<tspan x="${textX}" dy="${index ? bodyLineHeight : 0}">${escapeHtml(line)}</tspan>`).join('')}</text>` : '';
  const accent = variant === 'editorial' ? `<line class="published-annotation-accent" x1="1.5" y1="0" x2="1.5" y2="${height}"/>` : '';
  return `<g class="published-annotation ${variant}" data-published-annotation="${escapeAttr(annotation.id)}" transform="translate(${Number(annotation.x) || 0} ${Number(annotation.y) || 0})" role="group" aria-label="Anotação ${escapeAttr(annotation.title || 'sem título')}"><rect width="${width}" height="${height}" rx="${variant === 'note' ? 14 : 0}"></rect>${accent}${kicker}${title}${body}</g>`;
}

function publishedSvgMarkup() {
  const bounds = mapBounds();
  const pad = 70;
  const viewBox = [bounds.minX - pad, bounds.minY - pad, Math.max(240, bounds.maxX - bounds.minX + pad * 2), Math.max(180, bounds.maxY - bounds.minY + pad * 2)];
  const clusters = clusterLayer.cloneNode(true);
  clusters.querySelectorAll('.cluster-hit').forEach((node) => node.remove());
  if (!state.map.layout.showClusterHulls) clusters.querySelectorAll('.cluster-group').forEach((node) => node.remove());
  const relations = relationLayer.cloneNode(true);
  relations.querySelectorAll('.relation-hit,.routing-control').forEach((node) => node.remove());
  relations.querySelectorAll('.relation-group').forEach((node) => node.classList.remove('selected'));
  const clipPaths = [];
  const nodes = state.map.hexagons.map((entity, index) => {
    const point = positionOf(entity);
    const cluster = entity.clusterId ? clusterById(entity.clusterId) : null;
    const color = visualColorFor(entity, cluster);
    const corners = hexCorners(point);
    const points = corners.map((corner) => `${corner.x.toFixed(2)},${corner.y.toFixed(2)}`).join(' ');
    const clipId = `published-hex-${index}`;
    clipPaths.push(`<clipPath id="${clipId}"><polygon points="${points}"/></clipPath>`);
    const visual = entity.visual || { mode: 'text', image: {} };
    const mode = ['text', 'icon', 'cover', 'image'].includes(visual.mode) ? visual.mode : 'text';
    const lines = mode === 'image' ? [] : publishedTextLines(entity.title, 17, mode === 'icon' ? 2 : 3);
    const startY = mode === 'icon' ? point.y + 20 : point.y - ((lines.length - 1) * 7);
    const minX = Math.min(...corners.map((corner) => corner.x));
    const minY = Math.min(...corners.map((corner) => corner.y));
    const maxX = Math.max(...corners.map((corner) => corner.x));
    const maxY = Math.max(...corners.map((corner) => corner.y));
    const image = visual.image?.src
      ? mode === 'icon'
        ? `<image class="published-node-image icon" href="${escapeAttr(visual.image.src)}" x="${point.x - 18}" y="${point.y - 37}" width="36" height="36" preserveAspectRatio="xMidYMid ${visual.image.fit === 'contain' ? 'meet' : 'slice'}"/>`
        : `<image class="published-node-image cover" href="${escapeAttr(visual.image.src)}" x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" preserveAspectRatio="xMidYMid ${visual.image.fit === 'contain' ? 'meet' : 'slice'}" clip-path="url(#${clipId})"/>`
      : '';
    const overlay = image && mode === 'cover' ? `<polygon class="published-node-overlay" points="${points}" style="fill-opacity:${Number(visual.image?.overlay ?? .38)}"/>` : '';
    return `<g class="published-node visual-${mode}" data-published-entity="${escapeAttr(entity.id)}" role="group" aria-label="Hexágono ${escapeAttr(entity.title)}"><polygon points="${points}" style="--node-color:${escapeAttr(color)}"/>${image}${overlay}${lines.map((line, lineIndex) => `<text x="${point.x}" y="${startY + lineIndex * 14}" text-anchor="middle">${escapeHtml(line)}</text>`).join('')}</g>`;
  }).join('');
  const labels = layoutMode() === 'territories' ? state.map.clusters.map((cluster) => {
    const rect = state.labelGeometry.get(cluster.id);
    if (!rect) return '';
    return `<g class="published-cluster-label"><line x1="${rect.minX}" y1="${rect.minY - 9}" x2="${rect.minX + 34}" y2="${rect.minY - 9}" stroke="${escapeAttr(cluster.color)}"/><text x="${rect.minX}" y="${rect.minY + 10}">${escapeHtml(cluster.title)}</text></g>`;
  }).join('') : '';
  const annotations = state.map.annotations.map(publishedAnnotationMarkup).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}" width="${Math.round(viewBox[2])}" height="${Math.round(viewBox[3])}" role="img" aria-labelledby="map-title map-description"><title id="map-title">${escapeHtml(state.map.title)}</title><desc id="map-description">${escapeHtml(state.map.description || 'Mapa hexagonal')}</desc><defs>${clipPaths.join('')}</defs><style>
    :root{color-scheme:light}.paper{fill:#f7f3eb}.axis-grid-line{stroke:#cfc7bb;stroke-width:1;stroke-dasharray:3 8}.axis-main{fill:none;stroke:#6d645c;stroke-width:2}.axis-tick{font:10px system-ui;fill:#83776d}.axis-title{font:700 16px Georgia,serif;fill:#38322d}.cluster-fill{fill-opacity:.055}.cluster-grain{display:none}.cluster-underlay{fill:none;stroke-width:8;stroke-opacity:.06}.cluster-contour{fill:none;stroke-width:1.5;stroke-opacity:.55}.relation-path{fill:none;stroke:#5d554d;stroke-width:2.1}.edge-relation .relation-path{stroke-width:7;stroke-linecap:round;stroke-opacity:.72}.relation-label rect{fill:#fffdf8;stroke:#d8d0c5}.relation-label text{font:700 10px system-ui;fill:#4a423b}.published-node>polygon:first-child{fill:#fbfaf6;stroke:var(--node-color);stroke-width:2}.published-node text{font:600 10px system-ui;fill:#38322d}.published-node.visual-cover text{fill:#fff;text-shadow:0 1px 4px #000}.published-node-overlay{fill:#211d1a;stroke:none}.published-node-image{pointer-events:none}.published-cluster-label text{font:700 18px Georgia,serif;fill:#302b27}.published-annotation>rect{fill:rgba(255,253,248,.88);stroke:rgba(67,56,47,.22);stroke-width:1}.published-annotation.editorial>rect{stroke-width:0}.published-annotation-accent{stroke:#665a50;stroke-width:3}.published-annotation.note>rect{fill:#faefc2}.published-annotation.label>rect{fill:none;stroke:none}.published-annotation-kicker{font:800 8px system-ui;letter-spacing:2px;fill:#8c7f74}.published-annotation-title{font-family:Georgia,serif;font-weight:700;fill:#39312b}.published-annotation-body{font-family:Georgia,serif;fill:#5f554c}
  </style><rect class="paper" x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" height="${viewBox[3]}"/>${axisLayer.innerHTML}${clusters.innerHTML}${relations.innerHTML}${nodes}${labels}${annotations}</svg>`;
}

function exportPublishedSvg() {
  downloadBlob(new Blob([publishedSvgMarkup()], { type: 'image/svg+xml;charset=utf-8' }), `${slugify(state.map.title)}.svg`);
  showToast('SVG baixado');
}

function exportPublishedHtml() {
  const svg = publishedSvgMarkup();
  const title = escapeHtml(state.map.title);
  const description = escapeHtml(state.map.description || 'Mapa hexagonal');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeAttr(state.map.description || 'Mapa hexagonal')}"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f3eb;color:#302b27;font-family:system-ui,sans-serif}header{padding:28px clamp(20px,5vw,72px) 12px}h1{margin:0;font:700 clamp(28px,5vw,48px)/1 Georgia,serif}p{max-width:68ch;color:#72675d;line-height:1.55}.map{padding:12px;overflow:auto}.map svg{display:block;width:100%;height:auto;max-height:calc(100vh - 150px)}footer{padding:12px 24px 24px;color:#8a7e73;font-size:12px}</style></head><body><header><h1>${title}</h1><p>${description}</p></header><main class="map">${svg}</main><footer>Feito com HexaMap Studio · arquivo local e independente</footer></body></html>`;
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${slugify(state.map.title)}.html`);
  showToast('Página HTML baixada');
}

function workspaceIssueHtml(issue) {
  return `<li class="workspace-issue ${escapeAttr(issue.severity)}"><strong>${escapeHtml(issue.code)}</strong><span>${escapeHtml(issue.message)}</span></li>`;
}

function openWelcome(mode = 'first') {
  if (!welcomeOverlay) return;
  if (mode === 'new' && !guardWorkspaceReplacement('começar outro projeto')) return;
  state.onboardingOpen = true;
  welcomePreviousFocus = document.activeElement;
  welcomeOverlay.hidden = false;
  [...document.querySelector('.app').children].filter((child) => child !== welcomeOverlay).forEach((child) => child.setAttribute('inert', ''));
  welcomeOverlay.dataset.mode = mode;
  const title = $('#welcomeTitle');
  const description = $('#welcomeDescription');
  const titleInput = $('#welcomeProjectTitle');
  const closeButton = $('#welcomeClose');
  closeButton.dataset.welcomeMode = mode;
  titleInput.value = '';
  if (mode === 'new') {
    title.textContent = 'Comece um projeto novo';
    description.textContent = 'Escolha uma base para começar. Você poderá editar tudo depois, mantendo seus textos como arquivos Markdown.';
    closeButton.textContent = 'Cancelar';
  } else {
    title.textContent = 'O que você quer mapear?';
    description.textContent = 'Comece com uma tela em branco, um template ou um exemplo. Seus textos continuam sendo arquivos Markdown na sua pasta — o HexMap só organiza as relações visuais.';
    closeButton.textContent = 'Continuar com a demonstração';
  }
  requestAnimationFrame(() => titleInput.focus());
}

function closeWelcome() {
  if (!welcomeOverlay) return;
  state.onboardingOpen = false;
  welcomeOverlay.hidden = true;
  [...document.querySelector('.app').children].filter((child) => child !== welcomeOverlay).forEach((child) => child.removeAttribute('inert'));
  markOnboardingSeen();
  if (welcomePreviousFocus instanceof HTMLElement) welcomePreviousFocus.focus();
  welcomePreviousFocus = null;
}

function startProject(mode) {
  const defaultTitles = { empty: 'Meu primeiro mapa', template: 'Mapa de projeto', journey: 'Jornada e caminhos', library: 'Biblioteca de notas', demo: 'Sistema organizacional' };
  const title = ($('#welcomeProjectTitle')?.value || '').trim() || defaultTitles[mode] || 'Meu primeiro mapa';
  if (mode === 'folder') {
    closeWelcome();
    clearSelection({ keepWorkspace: true });
    state.workspaceOpen = true;
    state.drawerMode = 'peek';
    render();
    if (typeof window.showDirectoryPicker !== 'function') showToast('Use Importar bundle neste navegador para abrir um projeto portátil');
    else chooseWorkspaceFolder(false);
    return;
  }
  if (mode === 'bundle') {
    closeWelcome();
    workspaceBundleInput?.click();
    return;
  }
  const before = mapSnapshot();
  const factories = { template: createTemplateMap, journey: createJourneyMap, library: createLibraryMap };
  state.map = normalizeMap(mode === 'demo' ? createInitialMap() : factories[mode] ? factories[mode](title) : createEmptyMap(title));
  state.scale = Number(state.map.layout?.viewport?.zoom) || 1;
  state.tx = Number(state.map.layout?.viewport?.x) || 0;
  state.ty = Number(state.map.layout?.viewport?.y) || 0;
  state.workspace = null;
  state.conflict = null;
  state.tool = 'move';
  state.connectSource = null;
  state.presentation = false;
  state.readOnly = false;
  state.searchOpen = false;
  state.searchQuery = '';
  state.history = [];
  state.future = [];
  remember(before);
  clearSelection();
  closeWelcome();
  render();
  fitMap(true);
  revealToolHint(7000);
  const started = { demo: 'Demonstração carregada', template: 'Sistema e territórios criado', journey: 'Jornada e caminhos criada', library: 'Biblioteca de notas criada' };
  showToast(`${started[mode] || 'Projeto vazio criado'} · use Desfazer para restaurar o mapa anterior`);
}

function openPublishPanel() {
  clearSelection({ keepSettings: true });
  state.settingsOpen = true;
  state.drawerTab = 'publish';
  state.drawerMode = 'wide';
  render();
}

function renderWorkspaceDrawer() {
  const workspaceState = state.workspace;
  const directorySupported = typeof window.showDirectoryPicker === 'function';
  const issues = workspaceState?.diagnostics || [];
  const sourceCount = state.map.hexagons.filter((entity) => entity.sourcePath).length;
  const dirty = hasUnsavedWork();
  const views = workspaceState ? listWorkspaceViews(workspaceState) : [];
  const activeViewId = workspaceState?.activeViewId || state.map.activeViewId || 'default';
  drawerContent.innerHTML = `<div class="drawer-kicker">PROJETO LOCAL-FIRST</div>
    <h2>${escapeHtml(workspaceState?.name || 'Arquivos Markdown')}</h2>
    <p class="drawer-lede">Seus textos continuam em arquivos comuns. O HexMap lê e organiza esses arquivos; nada é enviado para a nuvem.</p>
    <div class="workspace-state ${workspaceState ? 'connected' : ''}">
      <span>${workspaceState?.directoryHandle ? 'Pasta conectada' : workspaceState ? 'Bundle portátil' : 'Rascunho local'}</span>
      <strong>${sourceCount} de ${state.map.hexagons.length} hexágonos com arquivo</strong>
      <small>${dirty ? 'Há mudanças no mapa esperando para serem gravadas.' : 'Tudo em dia com a fonte canônica.'}</small>
    </div>
    ${workspaceState ? `<div class="drawer-section compact workspace-views"><h3>Leituras do mesmo conteúdo</h3><div class="workspace-view-row"><label class="sr-only" for="workspaceViewSelect">Leitura ativa</label><select class="field-input" id="workspaceViewSelect">${views.map((view) => `<option value="${escapeAttr(view.id)}" ${view.id === activeViewId ? 'selected' : ''}>${escapeHtml(view.title || view.id)}</option>`).join('')}</select><button id="newWorkspaceView">Nova leitura</button></div><p class="drawer-note">Cada leitura guarda apenas posições, relações e aparência. Seus arquivos Markdown não são duplicados.</p></div>` : ''}
    <div class="workspace-actions">
      <button id="openWorkspaceFolder" class="primary" ${directorySupported ? '' : 'disabled'}>Abrir projeto da pasta</button>
      <button id="attachWorkspaceFolder" ${directorySupported ? '' : 'disabled'}>Conectar este mapa</button>
      <button id="newProjectBtn">Novo projeto</button>
      <button id="saveWorkspace" ${workspaceState?.directoryHandle ? '' : 'disabled'}>Salvar Markdown</button>
      <button id="refreshWorkspace" ${workspaceState?.directoryHandle ? '' : 'disabled'}>Reler pasta</button>
      <button id="backupWorkspace">Fazer backup</button>
      <button id="importWorkspaceBundle">Importar bundle</button>
      <button id="exportWorkspaceBundle">Exportar bundle</button>
    </div>
    ${state.conflict ? '<div class="workspace-conflict" role="alert"><strong>Uma nota mudou fora do HexMap.</strong><span>Faça um backup, releia a pasta e confira a diferença antes de salvar novamente.</span></div>' : ''}
    ${!directorySupported ? '<p class="drawer-note">Este navegador não abre pastas diretamente. Use um bundle portátil — o formato contém as mesmas notas e pode voltar para qualquer computador.</p>' : ''}
    <div class="drawer-section"><h3>Como os arquivos funcionam</h3><div class="file-contract"><code>notas/*.md</code><span>onde vivem suas ideias e o frontmatter</span><code>hexmap.yaml</code><span>nome e descrição do projeto</span><code>.hexmap/map.json</code><span>posições, relações e aparência</span></div><p class="drawer-note">Abrir projeto da pasta lê uma fonte existente. Conectar este mapa usa uma pasta vazia para começar a gravar este mapa nela.</p></div>
    <div class="drawer-section"><h3>Diagnóstico</h3>${issues.length ? `<ul class="workspace-issues">${issues.map(workspaceIssueHtml).join('')}</ul>` : '<p class="empty-note">Nenhum conflito estrutural detectado.</p>'}</div>
    <div class="drawer-actions"><button id="publishWorkspace" class="primary">Abrir publicação</button>${workspaceState ? '<button id="detachWorkspace">Desconectar sem apagar arquivos</button>' : ''}</div>`;
  $('#openWorkspaceFolder')?.addEventListener('click', () => chooseWorkspaceFolder(false));
  $('#attachWorkspaceFolder')?.addEventListener('click', () => chooseWorkspaceFolder(true));
  $('#newProjectBtn')?.addEventListener('click', () => openWelcome('new'));
  $('#saveWorkspace')?.addEventListener('click', saveCurrentWorkspace);
  $('#refreshWorkspace')?.addEventListener('click', refreshCurrentWorkspace);
  $('#backupWorkspace')?.addEventListener('click', () => exportWorkspaceBundle({ backup: true }));
  $('#importWorkspaceBundle')?.addEventListener('click', () => workspaceBundleInput.click());
  $('#exportWorkspaceBundle')?.addEventListener('click', () => exportWorkspaceBundle());
  $('#publishWorkspace')?.addEventListener('click', openPublishPanel);
  $('#workspaceViewSelect')?.addEventListener('change', (event) => switchWorkspaceView(event.target.value));
  $('#newWorkspaceView')?.addEventListener('click', createWorkspaceView);
  $('#detachWorkspace')?.addEventListener('click', () => {
    if (!guardWorkspaceReplacement('desconectar este projeto')) return;
    state.workspace = null; state.workspaceOpen = false; state.conflict = null; render(); showToast('Projeto desconectado; arquivos preservados');
  });
}

async function switchWorkspaceView(viewId) {
  if (!state.workspace || viewId === state.workspace.activeViewId) return;
  const currentId = state.workspace.activeViewId || state.map.activeViewId || 'default';
  synchronizeWorkspaceNotes(state.workspace, state.map);
  state.workspace.viewManifests ||= new Map();
  state.workspace.viewManifests.set(currentId, captureWorkspaceView(currentId));
  const before = mapSnapshot();
  try {
    state.map = normalizeMap(await selectWorkspaceView(state.workspace, viewId));
    restoreViewportFromMap();
    remember(before);
    clearSelection({ keepWorkspace: true });
    render();
    if (state.viewMode === '3d') threeView?.fit();
    showToast(`Leitura “${listWorkspaceViews(state.workspace).find((view) => view.id === viewId)?.title || viewId}” aberta`);
  } catch (error) {
    showToast(error.message || 'Não foi possível abrir esta leitura');
  }
}

function createWorkspaceView() {
  if (!state.workspace) return;
  const views = listWorkspaceViews(state.workspace);
  let index = views.length + 1;
  let id = `leitura-${index}`;
  const used = new Set(views.map((view) => view.id));
  while (used.has(id)) { index += 1; id = `leitura-${index}`; }
  const currentId = state.workspace.activeViewId || state.map.activeViewId || 'default';
  state.workspace.viewManifests ||= new Map();
  state.workspace.viewManifests.set(currentId, captureWorkspaceView(currentId));
  const title = `Leitura ${index}`;
  const manifest = createLayoutManifest({ ...state.map, activeViewId: id, views: [{ id, title, mode: layoutMode(), showClusterHulls: state.map.layout.showClusterHulls, layout: clone(state.map.layout) }] });
  manifest.title = title;
  state.workspace.viewManifests.set(id, manifest);
  state.workspace.activeViewId = id;
  state.workspace.manifest = manifest;
  state.map.activeViewId = id;
  state.map.views = listWorkspaceViews(state.workspace);
  render();
  showToast(`${title} criada; reorganize o mapa e salve quando quiser`);
}

async function chooseWorkspaceFolder(attachCurrent) {
  if (state.workspaceBusy || typeof window.showDirectoryPicker !== 'function') return;
  if (!guardWorkspaceReplacement(attachCurrent ? 'conectar outra pasta' : 'abrir outro projeto')) return;
  state.workspaceBusy = true;
  try {
    const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const loaded = await openDirectoryWorkspace(directoryHandle);
    if (attachCurrent && loaded.notes.length > 0) {
      showToast('Para usar este mapa, escolha uma pasta vazia; para ler esta pasta, use “Abrir pasta”');
      return;
    }
    if (attachCurrent && loaded.notes.length === 0) {
      state.workspace = { ...loaded, map: state.map, originals: new Map(), diagnostics: [], fingerprints: new Map(), lastSavedMap: '' };
      state.conflict = null;
      await saveCurrentWorkspace();
    } else {
      const before = mapSnapshot();
      state.workspace = loaded;
      state.map = normalizeMap(loaded.map);
      restoreViewportFromMap();
      state.conflict = null;
      remember(before); clearSelection({ keepWorkspace: true }); state.workspaceOpen = true; render();
      state.workspace.lastSavedMap = workspaceSnapshot(); saveMap(); renderWorkspaceDrawer();
      if (state.viewMode === '3d') threeView?.fit();
      showToast(`${loaded.notes.length} notas Markdown carregadas`);
    }
  } catch (error) {
    if (error?.name !== 'AbortError') showToast(`Não foi possível abrir a pasta: ${error.message}`);
  } finally { state.workspaceBusy = false; }
}

async function saveCurrentWorkspace() {
  if (!state.workspace?.directoryHandle || state.workspaceBusy) return;
  state.workspaceBusy = true;
  try {
    for (const entity of state.map.hexagons) if (entity.sourcePath) validateSourcePath(entity.sourcePath);
    const result = await saveDirectoryWorkspace(state.workspace, state.map);
    state.workspace.lastSavedMap = workspaceSnapshot();
    state.conflict = null;
    try { sessionStorage.removeItem(RECOVERY_KEY); } catch {}
    saveMap(); renderWorkspaceDrawer();
    showToast(`${result.files} arquivos gravados com segurança`);
  } catch (error) {
    if (error instanceof WorkspaceConflictError || error?.code === 'WORKSPACE_CONFLICT') {
      state.conflict = { path: error.path };
      renderWorkspaceDrawer();
      showToast(`Conflito em ${error.path}; nada foi sobrescrito`);
    } else showToast(`Falha ao salvar workspace: ${error.message}`);
  }
  finally { state.workspaceBusy = false; }
}

async function refreshCurrentWorkspace() {
  if (!state.workspace?.directoryHandle || state.workspaceBusy) return;
  if (state.workspace.lastSavedMap !== workspaceSnapshot()) { showToast('Salve as alterações antes de reler a pasta'); return; }
  state.workspaceBusy = true;
  try {
    const loaded = await openDirectoryWorkspace(state.workspace.directoryHandle);
    state.workspace = loaded; state.map = normalizeMap(loaded.map); restoreViewportFromMap(); state.conflict = null;
    clearSelection({ keepWorkspace: true }); state.workspaceOpen = true; render(); state.workspace.lastSavedMap = workspaceSnapshot(); saveMap(); renderWorkspaceDrawer();
    if (state.viewMode === '3d') threeView?.fit();
    showToast('Pasta relida');
  } catch (error) { showToast(`Falha ao reler: ${error.message}`); }
  finally { state.workspaceBusy = false; }
}

function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function entitySearchText(entity) {
  return normalizeSearchText([entity.title, entity.summary, entity.bodyMarkdown, ...(entity.tags || []), ...Object.values(entity.fields || {})].flat().join(' '));
}

function matchingEntities(query = state.searchQuery) {
  const terms = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
  return terms.length ? state.map.hexagons.filter((entity) => terms.every((term) => entitySearchText(entity).includes(term))) : state.map.hexagons;
}

function searchIndex() {
  const entities = state.map.hexagons.map((entity) => ({
    type: 'entity', id: entity.id, title: entity.title || 'Hexágono sem título',
    context: `${clusterById(entity.clusterId)?.title || 'Sem cluster'}${entity.tags?.length ? ` · ${entity.tags.slice(0, 3).join(' · ')}` : ''}`,
    searchText: entitySearchText(entity),
  }));
  const clusters = state.map.clusters.map((cluster) => ({
    type: 'cluster', id: cluster.id, title: cluster.title || 'Cluster sem título',
    context: `Cluster · ${membersOf(cluster.id).length} hexágonos`,
    searchText: normalizeSearchText([cluster.title, cluster.description, cluster.bodyMarkdown, ...(cluster.tags || []), ...Object.values(cluster.fields || {})].flat().join(' ')),
  }));
  const relations = state.map.relations.map((relation) => {
    const source = relationEndpoint(relation, 'source');
    const target = relationEndpoint(relation, 'target');
    const endpoints = `${source?.title || 'Origem'} → ${target?.title || 'Destino'}`;
    return {
      type: 'relation', id: relation.id, title: relation.label || endpoints,
      context: `Relação · ${endpoints}`,
      searchText: normalizeSearchText([relation.label, source?.title, target?.title].join(' ')),
    };
  });
  const annotations = state.map.annotations.map((annotation) => ({
    type: 'annotation', id: annotation.id, title: annotation.title || 'Texto sem título',
    context: 'Texto no canvas',
    searchText: normalizeSearchText([annotation.title, annotation.bodyMarkdown].join(' ')),
  }));
  return [...entities, ...clusters, ...relations, ...annotations];
}

function matchingSearchItems(query = state.searchQuery) {
  const normalizedQuery = normalizeSearchText(query).trim();
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const matches = terms.length ? searchIndex().filter((item) => terms.every((term) => item.searchText.includes(term))) : searchIndex();
  if (!terms.length) return matches;
  return matches.sort((left, right) => {
    const leftTitle = normalizeSearchText(left.title);
    const rightTitle = normalizeSearchText(right.title);
    const score = (title) => title === normalizedQuery ? 0 : title.startsWith(normalizedQuery) ? 1 : title.includes(normalizedQuery) ? 2 : 3;
    return score(leftTitle) - score(rightTitle) || left.title.localeCompare(right.title, 'pt-BR');
  });
}

function applySearchFilter() {
  const active = Boolean(state.searchQuery.trim());
  const items = matchingSearchItems();
  const entityMatches = new Set(items.filter((item) => item.type === 'entity').map((item) => item.id));
  const clusterMatches = new Set(items.filter((item) => item.type === 'cluster').map((item) => item.id));
  const relationMatches = new Set(items.filter((item) => item.type === 'relation').map((item) => item.id));
  const annotationMatches = new Set(items.filter((item) => item.type === 'annotation').map((item) => item.id));
  for (const clusterId of clusterMatches) for (const entity of membersOf(clusterId)) entityMatches.add(entity.id);
  for (const entityId of entityMatches) {
    const clusterId = entityById(entityId)?.clusterId;
    if (clusterId) clusterMatches.add(clusterId);
  }
  for (const relationId of relationMatches) {
    const relation = relationById(relationId);
    for (const endpoint of [relationEndpoint(relation, 'source'), relationEndpoint(relation, 'target')]) {
      if (endpoint?.type === 'cluster') {
        clusterMatches.add(endpoint.id);
        for (const entity of membersOf(endpoint.id)) entityMatches.add(entity.id);
      } else if (endpoint?.id) {
        entityMatches.add(endpoint.id);
        if (endpoint.item.clusterId) clusterMatches.add(endpoint.item.clusterId);
      }
    }
  }
  nodeLayer.querySelectorAll('[data-entity]').forEach((node) => node.classList.toggle('search-hidden', active && !entityMatches.has(node.dataset.entity)));
  clusterLayer.querySelectorAll('.cluster-group[data-cluster]').forEach((group) => group.classList.toggle('search-hidden', active && !clusterMatches.has(group.dataset.cluster)));
  clusterLabelLayer.querySelectorAll('[data-cluster-label]').forEach((label) => label.classList.toggle('search-hidden', active && !clusterMatches.has(label.dataset.clusterLabel)));
  relationLayer.querySelectorAll('.relation-group[data-relation]').forEach((group) => group.classList.toggle('search-hidden', active && !relationMatches.has(group.dataset.relation)));
  annotationLayer.querySelectorAll('[data-annotation]').forEach((annotation) => annotation.classList.toggle('search-hidden', active && !annotationMatches.has(annotation.dataset.annotation)));
  threeLabels.querySelectorAll('.three-cell-label[data-cell]').forEach((label) => label.classList.toggle('search-hidden', active && !entityMatches.has(label.dataset.cell)));
  threeLabels.querySelectorAll('.three-cluster-label[data-cluster]').forEach((label) => label.classList.toggle('search-hidden', active && !clusterMatches.has(label.dataset.cluster)));
  threeLabels.querySelectorAll('.three-relation-label[data-relation]').forEach((label) => label.classList.toggle('search-hidden', active && !relationMatches.has(label.dataset.relation)));
}

function renderSearchResults() {
  const matches = matchingSearchItems();
  const visible = matches.slice(0, state.searchLimit);
  const totalLabel = state.searchQuery.trim() ? `${matches.length} resultado${matches.length === 1 ? '' : 's'}` : `${matches.length} itens no projeto`;
  searchSummary.textContent = matches.length > visible.length ? `${totalLabel} · mostrando ${visible.length}` : totalLabel;
  searchResults.innerHTML = visible.map((item) => `<button data-search-type="${item.type}" data-search-id="${escapeAttr(item.id)}"${item.type === 'entity' ? ` data-search-entity="${escapeAttr(item.id)}"` : ''}><span class="search-result-type">${{ entity: 'Hexágono', cluster: 'Cluster', relation: 'Relação', annotation: 'Texto' }[item.type]}</span><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.context)}</span></button>`).join('')
    + (!visible.length ? '<p class="search-empty">Nenhum item encontrado. Tente outro título, conteúdo, tag, campo, cluster ou relação.</p>' : '')
    + (matches.length > visible.length ? `<button class="search-more" id="showMoreSearch">Mostrar mais ${Math.min(80, matches.length - visible.length)}</button>` : '');
  $('#showMoreSearch')?.addEventListener('click', () => { state.searchLimit += 80; renderSearchResults(); });
  searchResults.querySelectorAll('[data-search-type]').forEach((button) => button.addEventListener('click', () => {
    const type = button.dataset.searchType;
    const id = button.dataset.searchId;
    drawerReturnTarget = drawerTarget('control', 'searchBtn');
    searchPreviousFocus = null;
    clearSelection();
    if (type === 'entity') state.selectedEntityId = id;
    if (type === 'cluster') state.selectedClusterId = id;
    if (type === 'relation') state.selectedRelationId = id;
    if (type === 'annotation') state.selectedAnnotationId = id;
    state.drawerTab = 'content';
    state.drawerMode = 'peek';
    state.markdownMode = 'preview';
    state.searchOpen = false; searchPanel.hidden = true; state.searchQuery = ''; mapSearch.value = '';
    $('#searchBtn').classList.remove('active-context');
    $('#searchBtn').setAttribute('aria-expanded', 'false');
    const entity = type === 'entity' ? entityById(id) : null;
    const cluster = type === 'cluster' ? clusterGeometry(id) : null;
    const relation = type === 'relation' ? state.relationGeometry.get(id) : null;
    const annotation = type === 'annotation' ? state.map.annotations.find((item) => item.id === id) : null;
    const point = entity ? positionOf(entity) : cluster?.center || relation?.labelPoint || (annotation ? { x: annotation.x + (annotation.width || 320) / 2, y: annotation.y + 90 } : null);
    render();
    if (state.viewMode === '3d') threeView?.fit(entity?.id);
    else if (point) { state.scale = Math.max(state.scale, .9); state.tx = innerWidth / 2 - point.x * state.scale; state.ty = innerHeight / 2 - point.y * state.scale; applyTransform(); }
  }));
  applySearchFilter();
}

function toggleSearch(force) {
  const wasOpen = state.searchOpen;
  state.searchOpen = typeof force === 'boolean' ? force : !state.searchOpen;
  searchPanel.hidden = !state.searchOpen;
  $('#searchBtn').classList.toggle('active-context', state.searchOpen);
  $('#searchBtn').setAttribute('aria-expanded', String(state.searchOpen));
  if (state.searchOpen) {
    if (!wasOpen) { searchPreviousFocus = document.activeElement; state.searchLimit = 80; }
    renderSearchResults();
    requestAnimationFrame(() => mapSearch.focus());
  } else {
    state.searchQuery = ''; mapSearch.value = ''; applySearchFilter();
    const returnFocus = searchPreviousFocus;
    if (wasOpen && keyboardNavigation && returnFocus instanceof HTMLElement && returnFocus.isConnected) requestAnimationFrame(() => returnFocus.focus());
    searchPreviousFocus = null;
  }
}

function setTool(tool) {
  if (state.readOnly) return;
  const beginningFirstItem = state.map.hexagons.length === 0 && state.map.annotations.length === 0 && ['add', 'text'].includes(tool);
  state.tool = tool;
  if (tool !== 'connect') state.connectSource = null;
  renderControls();
  renderEmptyState();
  if (beginningFirstItem) requestAnimationFrame(() => workspace.focus());
  revealToolHint();
  threeView?.setTool(tool);
  threeView?.setInteractive(state.viewMode === '3d' && tool === 'move' && state.map.layout.type === 'free');
}

function togglePresentation(force) {
  state.presentation = typeof force === 'boolean' ? force : !state.presentation;
  state.readOnly = state.presentation;
  if (state.presentation) {
    state.tool = 'move';
    state.connectSource = null;
    clearSelection();
    state.drawerMode = 'focus';
    hideTooltip();
    showToast('Modo apresentação — somente leitura');
  } else {
    state.drawerMode = 'peek';
    showToast('Modo edição reativado');
  }
  render();
  if (state.presentation) fitMap(true);
}

function handleEntityClick(event, entityId) {
  event.stopPropagation();
  hideTooltip();
  dismissToolHint();
  if (state.moved) return;
  const entity = entityById(entityId);
  if (state.tool === 'connect') {
    handleConnectEndpoint({ id: entity.id, type: 'hexagon' });
    return;
  }
  if (state.tool === 'add' || state.tool === 'text') return;
  if (event.shiftKey) {
    state.selectedEntityId = null; state.selectedClusterId = null; state.selectedRelationId = null; state.selectedAnnotationId = null; state.settingsOpen = false;
    if (state.multiSelection.has(entityId)) state.multiSelection.delete(entityId); else state.multiSelection.add(entityId);
    render();
    return;
  }
  state.multiSelection.clear();
  drawerReturnTarget = drawerTarget('entity', entityId);
  state.selectedEntityId = entityId;
  state.selectedClusterId = null;
  state.selectedRelationId = null;
  state.selectedAnnotationId = null;
  state.settingsOpen = false;
  state.drawerTab = 'content';
  state.drawerMode = 'peek';
  state.markdownMode = 'preview';
  render();
}

function handleClusterClick(event, clusterId) {
  event.stopPropagation();
  hideTooltip();
  dismissToolHint();
  if (state.moved) return;
  if (state.tool === 'connect') { handleConnectEndpoint({ id: clusterId, type: 'cluster' }); return; }
  if (state.tool !== 'move') return;
  state.multiSelection.clear();
  drawerReturnTarget = drawerTarget('cluster', clusterId);
  state.selectedClusterId = clusterId;
  state.selectedEntityId = null;
  state.selectedRelationId = null;
  state.selectedAnnotationId = null;
  state.settingsOpen = false;
  state.drawerTab = 'content';
  state.drawerMode = 'peek';
  render();
}

function axialDistance(a, b) {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs((-a.q - a.r) - (-b.q - b.r)));
}

function isAdjacentHexRelation(relation, source = relationEndpoint(relation, 'source'), target = relationEndpoint(relation, 'target')) {
  return relation.style === 'edge' && source?.type === 'hexagon' && target?.type === 'hexagon' && axialDistance(source.item, target.item) === 1;
}

function handleConnectEndpoint(endpoint) {
  const selected = endpointRecord(endpoint);
  if (!selected) return;
  if (!state.connectSource) {
    state.connectSource = { id: selected.id, type: selected.type };
    showToast('Agora selecione o destino');
    render();
    return;
  }
  if (state.connectSource.id === selected.id && state.connectSource.type === selected.type) { showToast('Selecione outro elemento'); return; }
  const source = endpointRecord(state.connectSource);
  if (!source) { state.connectSource = null; render(); return; }
  const exists = state.map.relations.some((relation) => relation.source === source.id && relation.target === selected.id && (relation.sourceType || 'cluster') === source.type && (relation.targetType || 'cluster') === selected.type);
  if (exists) { showToast('Essa relação já existe'); return; }
  const adjacent = source.type === 'hexagon' && selected.type === 'hexagon' && axialDistance(source.item, selected.item) === 1;
  const before = mapSnapshot();
  const relation = {
    id: `relation-${state.map.nextRelation++}`,
    source: source.id,
    target: selected.id,
    sourceType: source.type,
    targetType: selected.type,
    style: adjacent ? 'edge' : 'curve',
    label: adjacent ? '' : 'relaciona-se',
    routing: { mode: 'auto', offset: { along: 0, perpendicular: .2 } },
  };
  state.map.relations.push(relation);
  remember(before);
  clearSelection();
  state.selectedRelationId = relation.id;
  state.drawerTab = 'routing';
  state.connectSource = null;
  state.tool = 'move';
  showToast(adjacent ? 'Caminho criado pela borda' : 'Relação criada');
  render();
}

function handleEntityPointerDown(event, entityId) {
  if (state.readOnly) return;
  if (event.button !== 0 || state.tool !== 'move' || event.shiftKey) return;
  event.stopPropagation();
  state.moved = false;
  const entity = entityById(entityId);
  const pointer = pointerToWorld(event);
  const position = positionOf(entity);
  state.drag = {
    type: 'entity', id: entityId, before: mapSnapshot(),
    pointerId: event.pointerId,
    startClient: { x: event.clientX, y: event.clientY },
    grabOffset: { x: pointer.x - position.x, y: pointer.y - position.y },
    start: { q: entity.q, r: entity.r, axisPosition: entity.axisPosition ? { ...entity.axisPosition } : null },
  };
}

function handleClusterPointerDown(event, clusterId) {
  if (state.readOnly) return;
  if (event.button !== 0 || state.tool !== 'move') return;
  event.stopPropagation();
  state.moved = false;
  const members = membersOf(clusterId);
  state.drag = {
    type: 'cluster', id: clusterId, before: mapSnapshot(),
    pointerId: event.pointerId,
    startClient: { x: event.clientX, y: event.clientY },
    basePositions: Object.fromEntries(members.map((entity) => [entity.id, { q: entity.q, r: entity.r, axisPosition: entity.axisPosition ? { ...entity.axisPosition } : null }])),
    memberIds: members.map((entity) => entity.id),
    lastDelta: { q: 0, r: 0 },
  };
}

function handleAnnotationPointerDown(event, annotationId) {
  if (state.readOnly) return;
  if (event.button !== 0 || state.tool !== 'move') return;
  if (event.target.closest('a,button,input,textarea')) return;
  event.stopPropagation();
  const annotation = state.map.annotations.find((item) => item.id === annotationId);
  if (!annotation) return;
  state.moved = false;
  state.drag = {
    type: 'annotation', id: annotationId, before: mapSnapshot(),
    pointerId: event.pointerId,
    startClient: { x: event.clientX, y: event.clientY },
    start: { x: annotation.x, y: annotation.y },
  };
}

function safeEntityCell(entityId, candidate) {
  if (!nodeAt(candidate.q, candidate.r, entityId)) return candidate;
  return spiral(candidate, 3).find((cell) => !nodeAt(cell.q, cell.r, entityId)) || candidate;
}

function safeClusterDelta(drag, candidate) {
  const occupied = allPositionsMap(new Set(drag.memberIds));
  const deltas = spiral(candidate, 3);
  for (const delta of deltas) {
    const safe = drag.memberIds.every((id) => {
      const base = drag.basePositions[id];
      return !occupied.has(coordKey(base.q + delta.q, base.r + delta.r));
    });
    if (safe) return delta;
  }
  return drag.lastDelta;
}

function pointerToWorld(event) {
  return { x: (event.clientX - state.tx) / state.scale, y: (event.clientY - state.ty) / state.scale };
}

function pointerToAxial(event) {
  const worldPoint = pointerToWorld(event);
  return pixelToAxial(worldPoint.x, worldPoint.y, WORLD.origin);
}

function touchMetrics() {
  const [first, second] = [...activeTouchPointers.values()];
  if (!first || !second) return null;
  return {
    center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
  };
}

function resetTouchGestureBaseline() {
  const metrics = touchMetrics();
  if (!metrics) return;
  touchGesture = {
    startDistance: metrics.distance,
    startScale: state.scale,
    startTx: state.tx,
    startTy: state.ty,
    worldAnchor: {
      x: (metrics.center.x - state.tx) / state.scale,
      y: (metrics.center.y - state.ty) / state.scale,
    },
  };
}

function trackTouchPointerDown(event) {
  if (state.viewMode !== '2d' || event.pointerType !== 'touch') return;
  activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activeTouchPointers.size < 2) return;
  const drag = state.drag;
  if (drag?.before && state.moved) {
    state.map = normalizeMap(JSON.parse(drag.before));
    state.drag = null;
    render();
  } else state.drag = null;
  state.panning = false;
  workspace.classList.remove('panning');
  workspace.classList.add('pinching');
  resetTouchGestureBaseline();
  state.moved = true;
  event.preventDefault();
  event.stopPropagation();
}

function axisPositionFromWorld(point) {
  const frame = state.map.layout.axes.frame;
  return {
    x: Math.max(0, Math.min(1, (point.x - frame.x) / frame.width)),
    y: Math.max(0, Math.min(1, 1 - (point.y - frame.y) / frame.height)),
  };
}

function onPointerMove(event) {
  if (event.pointerType === 'touch' && activeTouchPointers.has(event.pointerId)) {
    activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  if (touchGesture && activeTouchPointers.size >= 2) {
    const metrics = touchMetrics();
    if (!metrics) return;
    state.scale = Math.max(.28, Math.min(1.75, touchGesture.startScale * metrics.distance / touchGesture.startDistance));
    state.tx = metrics.center.x - touchGesture.worldAnchor.x * state.scale;
    state.ty = metrics.center.y - touchGesture.worldAnchor.y * state.scale;
    state.moved = true;
    if (event.cancelable) event.preventDefault();
    applyTransform();
    toolHint.classList.add('quiet');
    return;
  }
  if (state.drag?.pointerId !== undefined && event.pointerId !== state.drag.pointerId) return;
  if (state.panning && state.panStart?.pointerId !== undefined && event.pointerId !== state.panStart.pointerId) return;
  if (state.drag?.type === 'relation-handle') {
    state.moved = true;
    const relation = relationById(state.drag.id);
    if (!relation) return;
    relation.routing.mode = 'assisted';
    relation.routing.offset = offsetFromControl(state.drag.start, state.drag.end, pointerToWorld(event));
    renderRelations(); renderDrawer();
    return;
  }
  if (state.drag?.type === 'annotation') {
    const distance = Math.hypot(event.clientX - state.drag.startClient.x, event.clientY - state.drag.startClient.y);
    if (distance < 3) return;
    state.moved = true;
    const annotation = state.map.annotations.find((item) => item.id === state.drag.id);
    annotation.x = state.drag.start.x + (event.clientX - state.drag.startClient.x) / state.scale;
    annotation.y = state.drag.start.y + (event.clientY - state.drag.startClient.y) / state.scale;
    renderAnnotations();
    return;
  }
  if (state.drag?.type === 'entity') {
    const distance = Math.hypot(event.clientX - state.drag.startClient.x, event.clientY - state.drag.startClient.y);
    if (distance < 3) return;
    state.moved = true;
    const entity = entityById(state.drag.id);
    const pointer = pointerToWorld(event);
    const adjustedPoint = {
      x: pointer.x - (state.drag.grabOffset?.x || 0),
      y: pointer.y - (state.drag.grabOffset?.y || 0),
    };
    if (state.map.layout.type === 'axes') {
      entity.axisPosition = axisPositionFromWorld(adjustedPoint);
      const values = axisValuesOf(entity);
      if (state.map.fieldDefinitions.some((field) => field.key === 'time')) entity.fields.time = Number(values.x.toFixed(2));
      if (state.map.fieldDefinitions.some((field) => field.key === 'energy')) entity.fields.energy = Number(values.y.toFixed(2));
    } else {
      const candidate = safeEntityCell(entity.id, pixelToAxial(adjustedPoint.x, adjustedPoint.y, WORLD.origin));
      entity.q = candidate.q; entity.r = candidate.r;
    }
    renderClusters(); renderRelations(); renderNodes(); renderStats();
    return;
  }
  if (state.drag?.type === 'cluster') {
    const distance = Math.hypot(event.clientX - state.drag.startClient.x, event.clientY - state.drag.startClient.y);
    if (distance < 3) return;
    state.moved = true;
    if (state.map.layout.type === 'axes') {
      const frame = state.map.layout.axes.frame;
      const dx = (event.clientX - state.drag.startClient.x) / state.scale / frame.width;
      const dy = -(event.clientY - state.drag.startClient.y) / state.scale / frame.height;
      for (const id of state.drag.memberIds) {
        const base = state.drag.basePositions[id];
        const entity = entityById(id);
        const baseAxis = base.axisPosition || { x: .5, y: .5 };
        entity.axisPosition = { x: Math.max(0, Math.min(1, baseAxis.x + dx)), y: Math.max(0, Math.min(1, baseAxis.y + dy)) };
        const values = axisValuesOf(entity);
        if (state.map.fieldDefinitions.some((field) => field.key === 'time')) entity.fields.time = Number(values.x.toFixed(2));
        if (state.map.fieldDefinitions.some((field) => field.key === 'energy')) entity.fields.energy = Number(values.y.toFixed(2));
      }
    } else {
      const dx = (event.clientX - state.drag.startClient.x) / state.scale;
      const dy = (event.clientY - state.drag.startClient.y) / state.scale;
      const candidate = pixelToAxial(dx, dy, { x: 0, y: 0 });
      const delta = safeClusterDelta(state.drag, candidate);
      state.drag.lastDelta = delta;
      for (const id of state.drag.memberIds) {
        const base = state.drag.basePositions[id];
        const entity = entityById(id);
        entity.q = base.q + delta.q; entity.r = base.r + delta.r;
      }
    }
    renderClusters(); renderRelations(); renderNodes();
    return;
  }
  if (state.panning) {
    state.moved = true;
    state.tx = state.panStart.tx + event.clientX - state.panStart.x;
    state.ty = state.panStart.ty + event.clientY - state.panStart.y;
    applyTransform(); toolHint.classList.add('quiet');
  }
}

function onPointerUp(event) {
  if (event?.pointerType === 'touch') activeTouchPointers.delete(event.pointerId);
  if (touchGesture) {
    if (activeTouchPointers.size >= 2) resetTouchGestureBaseline();
    else {
      touchGesture = null;
      workspace.classList.remove('pinching');
      scheduleViewportSave(0);
      setTimeout(() => { state.moved = false; }, 0);
    }
    return;
  }
  if (state.drag?.pointerId !== undefined && event?.pointerId !== state.drag.pointerId) return;
  if (state.panning && state.panStart?.pointerId !== undefined && event?.pointerId !== state.panStart.pointerId) return;
  const panned = state.panning && state.moved;
  if (state.drag?.type === 'relation-handle') {
    const drag = state.drag; state.drag = null;
    if (state.moved) { remember(drag.before); showToast('Curvatura ajustada manualmente'); render(); }
  } else if (state.drag?.type === 'annotation') {
    const drag = state.drag; state.drag = null;
    if (state.moved) { remember(drag.before); render(); }
  } else if (state.drag?.type === 'entity') {
    const drag = state.drag; state.drag = null;
    if (state.moved) {
      if (state.map.layout.type !== 'axes') reconcileEntityMove(drag.id);
      remember(drag.before); showToast(state.map.layout.type === 'axes' ? 'Posição X/Y atualizada' : autoClusterEnabled() ? 'Topologia atualizada' : 'Posição atualizada'); render();
    }
  } else if (state.drag?.type === 'cluster') {
    const drag = state.drag; state.drag = null;
    if (state.moved) {
      const result = reconcileClusterMove(drag.id);
      remember(drag.before);
      if (state.selectedClusterId === drag.id) state.selectedClusterId = result.clusterId;
      showToast(result.ambiguous ? 'Cluster movido sem mesclar: encoste em apenas um cluster por vez' : result.merged ? 'Clusters recombinados' : 'Cluster movido'); render();
    }
  }
  state.panning = false;
  workspace.classList.remove('panning');
  if (panned) scheduleViewportSave(0);
  if (state.moved) dismissToolHint();
  setTimeout(() => { state.moved = false; }, 0);
}

function onPointerCancel(event) {
  if (event?.pointerType === 'touch') activeTouchPointers.delete(event.pointerId);
  const cancelGesture = Boolean(touchGesture && (!event || event.pointerType === 'touch'));
  const cancelDrag = Boolean(state.drag && (!event || state.drag.pointerId === undefined || event.pointerId === state.drag.pointerId));
  const cancelPan = Boolean(state.panning && (!event || state.panStart?.pointerId === undefined || event.pointerId === state.panStart.pointerId));
  if (event && !cancelGesture && !cancelDrag && !cancelPan) return;
  let rerender = false;
  if (cancelGesture) {
    state.scale = touchGesture.startScale;
    state.tx = touchGesture.startTx;
    state.ty = touchGesture.startTy;
    touchGesture = null;
    activeTouchPointers.clear();
  }
  if (cancelDrag) {
    if (state.drag.before && state.moved) {
      state.map = normalizeMap(JSON.parse(state.drag.before));
      rerender = true;
    }
    state.drag = null;
  }
  if (cancelPan) {
    state.tx = state.panStart.tx;
    state.ty = state.panStart.ty;
    state.panning = false;
  }
  workspace.classList.remove('panning', 'pinching');
  state.moved = false;
  if (rerender) render(); else applyTransform();
}

function formClusterFromSelection() {
  const ids = [...state.multiSelection];
  if (ids.length < 2) { showToast('Selecione pelo menos dois hexágonos'); return; }
  const before = mapSnapshot();
  const selected = ids.map(entityById).filter(Boolean);
  const oldClusters = new Set(selected.map((entity) => entity.clusterId).filter(Boolean));
  if (layoutMode() === 'territories') {
    const avg = {
      q: Math.round(selected.reduce((sum, entity) => sum + entity.q, 0) / selected.length),
      r: Math.round(selected.reduce((sum, entity) => sum + entity.r, 0) / selected.length),
    };
    const occupied = allPositionsMap(new Set(ids));
    let chosenCenter = avg;
    for (const candidate of spiral(avg, 8)) {
      const fits = ids.every((id, index) => {
        const slot = COMPACT_SLOTS[index] || COMPACT_SLOTS[index % COMPACT_SLOTS.length];
        return !occupied.has(coordKey(candidate.q + slot.q, candidate.r + slot.r));
      });
      if (fits) { chosenCenter = candidate; break; }
    }
    selected.forEach((entity, index) => {
      const slot = COMPACT_SLOTS[index] || COMPACT_SLOTS[index % COMPACT_SLOTS.length];
      entity.q = chosenCenter.q + slot.q;
      entity.r = chosenCenter.r + slot.r;
      entity.clusterId = null;
    });
  }
  const cluster = createCluster(ids);
  for (const oldId of oldClusters) splitDisconnectedClusters();
  removeEmptyClusters();
  state.multiSelection.clear();
  state.selectedClusterId = cluster.id;
  state.drawerTab = 'content';
  remember(before);
  showToast('Novo cluster formado');
  render();
}

function dissolveCluster(clusterId) {
  const cluster = clusterById(clusterId);
  if (!cluster) return;
  const before = mapSnapshot();
  const members = membersOf(clusterId);
  if (layoutMode() === 'territories') {
    const center = {
      q: Math.round(members.reduce((sum, entity) => sum + entity.q, 0) / members.length),
      r: Math.round(members.reduce((sum, entity) => sum + entity.r, 0) / members.length),
    };
    const occupied = allPositionsMap(new Set(members.map((entity) => entity.id)));
    const spreadSlots = spiral({ q: 0, r: 0 }, 5).filter((cell) => Math.max(Math.abs(cell.q), Math.abs(cell.r), Math.abs(-cell.q-cell.r)) >= 2);
    members.forEach((entity, index) => {
      const slot = spreadSlots[index] || { q: index * 2, r: 0 };
      let candidate = { q: center.q + slot.q, r: center.r + slot.r };
      candidate = spiral(candidate, 4).find((cell) => !occupied.has(coordKey(cell.q, cell.r))) || candidate;
      entity.q = candidate.q; entity.r = candidate.r;
      occupied.set(coordKey(candidate.q, candidate.r), entity.id);
    });
  }
  members.forEach((entity) => { entity.clusterId = null; });
  state.map.clusters = state.map.clusters.filter((item) => item.id !== clusterId);
  state.map.relations = state.map.relations.filter((relation) => relation.source !== clusterId && relation.target !== clusterId);
  state.selectedClusterId = null;
  remember(before);
  showToast('Cluster desmontado em hexágonos independentes');
  render();
}

function addHexAt(event, axialCandidate = null) {
  const before = mapSnapshot();
  const worldPoint = event ? pointerToWorld(event) : axialToPixel(axialCandidate?.q || 0, axialCandidate?.r || 0, WORLD.origin);
  const candidate = state.map.layout.type === 'free' ? safeEntityCell(null, axialCandidate || pointerToAxial(event)) : { q: 0, r: 0 };
  const entity = {
    id: `hex-${state.map.nextEntity++}`,
    title: 'Novo conceito',
    summary: 'Descreva este elemento do mapa.',
    description: 'Descreva este elemento do mapa.',
    bodyMarkdown: '## Novo conceito\n\nCole ou escreva conteúdo Markdown aqui.',
    tags: [], fields: {},
    visual: { mode: 'text', image: { src: '', fit: 'cover', position: '50% 50%', overlay: .38 } },
    q: candidate.q, r: candidate.r,
    clusterId: null,
    axisPosition: state.map.layout.type === 'axes' ? axisPositionFromWorld(worldPoint) : null,
  };
  state.map.hexagons.push(entity);
  if (autoClusterEnabled()) {
    const adjacent = adjacentEntities(entity);
    if (adjacent.length) {
      const adjacentClusters = [...new Set(adjacent.map((item) => item.clusterId).filter(Boolean))];
      if (adjacentClusters.length) entity.clusterId = adjacentClusters[0]; else groupConnectedUngrouped();
    }
  }
  remember(before);
  clearSelection();
  state.selectedEntityId = entity.id;
  state.drawerTab = 'content';
  state.markdownMode = 'edit';
  state.tool = 'move';
  showToast('Hexágono criado');
  render();
}

function addTextAt(event) {
  const before = mapSnapshot();
  const point = pointerToWorld(event);
  const annotation = {
    id: `annotation-${state.map.nextAnnotation++}`,
    type: 'text', x: point.x, y: point.y, width: 340,
    title: 'Nova anotação',
    bodyMarkdown: 'Escreva ou cole **Markdown** aqui.',
    style: { variant: 'editorial', fontSize: 17, align: 'left' },
  };
  state.map.annotations.push(annotation);
  remember(before);
  clearSelection();
  state.selectedAnnotationId = annotation.id;
  state.drawerTab = 'content';
  state.tool = 'move';
  showToast('Texto adicionado ao canvas');
  render();
}

function groupByField(fieldKey) {
  const definition = fieldKey === '__tags__'
    ? { key: '__tags__', label: 'Tag principal', type: 'multi-select' }
    : state.map.fieldDefinitions.find((field) => field.key === fieldKey);
  if (!definition) return;
  const groups = new Map();
  for (const entity of state.map.hexagons) {
    const raw = fieldValueFor(entity, fieldKey);
    const values = Array.isArray(raw) ? raw : [raw];
    const value = values.filter((item) => item !== undefined && item !== null && item !== '')[0];
    if (value === undefined) continue;
    const key = String(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entity);
  }
  if (!groups.size) { showToast('Nenhum valor preenchido nesse campo'); return; }
  const before = mapSnapshot();
  state.map.clusters = [];
  state.map.relations = [];
  state.map.hexagons.forEach((entity) => { entity.clusterId = null; });
  const centers = [
    {q:-8,r:-4},{q:0,r:-5},{q:8,r:-4},{q:-9,r:4},{q:0,r:5},{q:9,r:3},{q:-3,r:10},{q:6,r:9},
  ];
  let index = 0;
  for (const [value, members] of groups.entries()) {
    const cluster = createCluster(members.map((entity) => entity.id), `${definition.label}: ${value}`, PALETTE[index % PALETTE.length]);
    cluster.description = `Agrupamento derivado automaticamente do campo ${definition.label}.`;
    cluster.bodyMarkdown = `## ${cluster.title}\n\nCluster derivado do campo **${definition.label}**.`;
    if (layoutMode() === 'territories') {
      const center = centers[index] || { q: (index % 4) * 7 - 10, r: Math.floor(index / 4) * 7 - 4 };
      members.forEach((entity, memberIndex) => {
        const slot = COMPACT_SLOTS[memberIndex] || spiral({q:0,r:0}, 6)[memberIndex];
        entity.q = center.q + slot.q; entity.r = center.r + slot.r;
      });
    }
    index += 1;
  }
  removeEmptyClusters();
  remember(before);
  clearSelection();
  state.settingsOpen = true;
  state.drawerTab = 'style';
  showToast(`Clusters criados por ${definition.label}`);
  render(); fitMap(true);
}

function changeLayout(type) {
  if (!['territories', 'mosaic', 'axes'].includes(type) || type === layoutMode()) return;
  const before = mapSnapshot();
  if (type === 'axes') initializeAxisPositions();
  state.map.layout.type = type === 'axes' ? 'axes' : 'free';
  state.map.layout.mode = type;
  if (type === 'territories') state.map.layout.showClusterHulls = true;
  else if (type === 'mosaic') state.map.layout.showClusterHulls = false;
  if (type === 'territories') state.map.layout.autoCluster = true;
  else if (type === 'mosaic') state.map.layout.autoCluster = false;
  remember(before);
  clearSelection();
  state.settingsOpen = true;
  state.drawerTab = 'layout';
  showToast(type === 'axes' ? 'Modo Eixos ativado' : type === 'mosaic' ? 'Modo Mosaico ativado' : 'Modo Territórios ativado');
  render(); fitMap(true);
}

function showTooltip(event, entityId) {
  if (state.drag || state.selectedEntityId || state.selectedClusterId || state.selectedRelationId || state.selectedAnnotationId || state.settingsOpen || state.workspaceOpen) return;
  const entity = entityById(entityId);
  const cluster = entity.clusterId ? clusterById(entity.clusterId) : null;
  tooltip.hidden = false;
  tooltip.innerHTML = `<strong>${escapeHtml(entity.title)}</strong><p>${escapeHtml(entity.summary || entity.description || markdownExcerpt(entity.bodyMarkdown || ''))}</p><span>${cluster ? escapeHtml(cluster.title) : 'sem cluster'} · ${(entity.tags || []).slice(0,3).map(escapeHtml).join(' · ') || `${adjacentEntities(entity).length} vizinhos`}</span>`;
  moveTooltip(event);
}

function moveTooltip(event) {
  const margin = 12;
  const gap = 16;
  const width = tooltip.offsetWidth || 300;
  const height = tooltip.offsetHeight || 120;
  let left = event.clientX + gap;
  let top = event.clientY + gap;
  if (left + width > window.innerWidth - margin) left = event.clientX - width - gap;
  if (top + height > window.innerHeight - margin) top = event.clientY - height - gap;
  tooltip.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - width - margin))}px`;
  tooltip.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast.hidden = true; }, 1900);
}

function revealToolHint(duration = 6000) {
  toolHint.classList.remove('quiet');
  clearTimeout(state.toolHintTimer);
  state.toolHintTimer = setTimeout(() => toolHint.classList.add('quiet'), duration);
}

function dismissToolHint() {
  clearTimeout(state.toolHintTimer);
  toolHint.classList.add('quiet');
}

function restoreDrawerFocus() {
  const target = drawerReturnTarget;
  drawerReturnTarget = null;
  let element = null;
  if (target?.kind === 'entity') {
    element = [...document.querySelectorAll('[data-entity], .three-cell-label')]
      .find((item) => item.dataset.entity === target.id || item.dataset.cell === target.id);
  } else if (target?.kind === 'cluster') {
    element = [...document.querySelectorAll('[data-cluster-label], .three-cluster-label')]
      .find((item) => item.dataset.clusterLabel === target.id || item.dataset.cluster === target.id);
  } else if (target?.kind === 'relation') {
    element = [...document.querySelectorAll('[data-relation-hit]')]
      .find((item) => item.dataset.relationHit === target.id);
  } else if (target?.kind === 'annotation') {
    element = [...document.querySelectorAll('[data-annotation]')]
      .find((item) => item.dataset.annotation === target.id);
  } else if (target?.kind === 'control') {
    element = document.getElementById(target.id);
  }
  if (element && !element.getClientRects().length) element = $('#moreBtn');
  if (element && typeof element.focus === 'function') element.focus();
  else workspace.focus();
}

function toggleHelp(force) {
  const open = typeof force === 'boolean' ? force : helpPopover.hidden;
  $('#helpBtn').setAttribute('aria-expanded', String(open));
  if (open) {
    helpPreviousFocus = document.activeElement;
    helpPopover.hidden = false;
    if (keyboardNavigation) requestAnimationFrame(() => $('#closeHelp')?.focus());
    return;
  }
  helpPopover.hidden = true;
  if (keyboardNavigation && helpPreviousFocus instanceof HTMLElement && helpPreviousFocus.isConnected) helpPreviousFocus.focus();
  helpPreviousFocus = null;
}

function updateActionButtons() {
  $('#undoBtn').disabled = state.history.length === 0;
  $('#redoBtn').disabled = state.future.length === 0;
}

function applyTransform() {
  const drawerOpen = state.selectedEntityId || state.selectedClusterId || state.selectedRelationId || state.selectedAnnotationId || state.settingsOpen;
  const drawerCompensation = drawerOpen && state.drawerMode !== 'focus' && window.innerWidth >= 1200
    ? Math.min(Math.max(0, (drawer.offsetWidth || (state.drawerMode === 'wide' ? 780 : 410)) / 2 - 28), window.innerWidth * .28)
    : 0;
  world.style.transform = `translate(${state.tx - drawerCompensation}px, ${state.ty}px) scale(${state.scale})`;
  document.documentElement.dataset.hexmapLod = state.scale < .48 ? 'overview' : state.scale < .72 ? 'medium' : 'detail';
  const denseOverview = state.map.hexagons.length > 96 && state.scale < .22;
  document.documentElement.dataset.hexmapDensity = denseOverview ? 'dense-overview' : 'normal';
  world.style.setProperty('--overview-label-scale', denseOverview ? String(Math.min(3.5, Math.max(1, .42 / state.scale))) : '1');
  world.style.setProperty('--presentation-label-scale', state.presentation ? String(Math.min(1.7, Math.max(1, .55 / state.scale))) : '1');
  zoomPct.textContent = `${Math.round(state.scale * 100)}%`;
}

function mapBounds() {
  if (state.map.layout.type === 'axes') {
    const frame = state.map.layout.axes.frame;
    return { minX: frame.x - 150, minY: frame.y - 120, maxX: frame.x + frame.width + 150, maxY: frame.y + frame.height + 130 };
  }
  const positions = state.map.hexagons.map(positionOf);
  const annotations = state.map.annotations.map((item) => ({ minX: item.x, minY: item.y, maxX: item.x + (item.width || 320), maxY: item.y + 240 }));
  const labels = [...state.labelGeometry.values()];
  if (!positions.length && !annotations.length && !labels.length) return { minX: 0, minY: 0, maxX: WORLD.width, maxY: WORLD.height };
  const minXs = [...positions.map((point) => point.x), ...annotations.map((item) => item.minX), ...labels.map((item) => item.minX)];
  const minYs = [...positions.map((point) => point.y), ...annotations.map((item) => item.minY), ...labels.map((item) => item.minY)];
  const maxXs = [...positions.map((point) => point.x), ...annotations.map((item) => item.maxX), ...labels.map((item) => item.maxX)];
  const maxYs = [...positions.map((point) => point.y), ...annotations.map((item) => item.maxY), ...labels.map((item) => item.maxY)];
  return {
    minX: Math.min(...minXs) - 180,
    minY: Math.min(...minYs) - 120,
    maxX: Math.max(...maxXs) + 180,
    maxY: Math.max(...maxYs) + 150,
  };
}

function fitMap(animate = true) {
  const compactWidth = window.innerWidth <= 680;
  const shortViewport = window.innerHeight <= 500;
  if ((compactWidth || shortViewport) && state.map.hexagons.length) {
    const focus = entityById(state.selectedEntityId) || state.map.hexagons[0];
    const clusterId = state.selectedClusterId || focus.clusterId;
    const geometry = clusterId ? state.clusterGeometry.get(clusterId) : null;
    const label = clusterId ? state.labelGeometry.get(clusterId) : null;
    const point = positionOf(focus);
    const bounds = geometry ? {
      minX: Math.min(geometry.minX, label?.minX ?? geometry.minX) - 24,
      minY: Math.min(geometry.minY, label?.minY ?? geometry.minY) - 18,
      maxX: Math.max(geometry.maxX, label?.maxX ?? geometry.maxX) + 24,
      maxY: Math.max(geometry.maxY, label?.maxY ?? geometry.maxY) + 18,
    } : { minX: point.x - 150, minY: point.y - 150, maxX: point.x + 150, maxY: point.y + 150 };
    const available = {
      left: 18,
      top: compactWidth ? 176 : 126,
      right: window.innerWidth - 18,
      bottom: window.innerHeight - 46,
    };
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    state.scale = Math.max(.34, Math.min((available.right - available.left) / width, (available.bottom - available.top) / height, compactWidth ? .82 : .66));
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    state.tx = (available.left + available.right) / 2 - centerX * state.scale;
    state.ty = (available.top + available.bottom) / 2 - centerY * state.scale;
    document.documentElement.dataset.fitMode = 'focal';
    if (animate) world.classList.add('animate');
    applyTransform();
    if (animate) setTimeout(() => world.classList.remove('animate'), 380);
    toolHint.textContent = 'Explore um território por vez. Use Buscar para saltar entre conceitos e clusters.';
    scheduleViewportSave(animate ? 420 : 180);
    return;
  }
  document.documentElement.dataset.fitMode = 'overview';
  const bounds = mapBounds();
  const denseMap = state.map.hexagons.length > 96;
  const available = { left: 24, top: 126, right: window.innerWidth - 24, bottom: window.innerHeight - (denseMap ? 80 : 46) };
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const minimumScale = denseMap ? .1 : .36;
  state.scale = Math.max(minimumScale, Math.min((available.right - available.left) / width, (available.bottom - available.top) / height, 1.05));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  state.tx = (available.left + available.right) / 2 - centerX * state.scale;
  state.ty = (available.top + available.bottom) / 2 - centerY * state.scale;
  if (animate) world.classList.add('animate');
  applyTransform();
  if (animate) setTimeout(() => world.classList.remove('animate'), 380);
  scheduleViewportSave(animate ? 420 : 180);
}

function exportMap() {
  state.map.layout.viewport = { x: state.tx, y: state.ty, zoom: state.scale };
  state.map.updatedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(state.map, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.map.id || 'hexmap'}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('JSON completo exportado');
}

function importMap(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      if (!guardWorkspaceReplacement('importar outro mapa')) return;
      const parsed = normalizeMap(JSON.parse(reader.result));
      if (!Array.isArray(parsed.hexagons) || !Array.isArray(parsed.clusters) || !Array.isArray(parsed.relations)) throw new Error('Formato inválido');
      const before = mapSnapshot();
      state.map = parsed;
      state.workspace = null;
      state.conflict = null;
      restoreViewportFromMap(parsed);
      remember(before);
      clearSelection();
      render();
      if (state.viewMode === '3d') threeView?.fit();
      showToast('Mapa importado');
    } catch (error) {
      showToast(`Falha ao importar: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

function resetMap() {
  if (!guardWorkspaceReplacement('restaurar a demonstração')) return;
  const before = mapSnapshot();
  state.map = normalizeMap(createInitialMap());
  state.workspace = null;
  state.conflict = null;
  clearSelection();
  remember(before);
  render(); fitMap(true);
  showToast('Demonstração restaurada · use Desfazer para recuperar o mapa anterior');
}

workspace.addEventListener('pointerdown', trackTouchPointerDown, { capture: true });
workspace.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (event.target.closest('.three-viewport, .hex-node, [data-cluster-hit], .cluster-label, [data-relation-hit], [data-relation-handle], .canvas-annotation, .topbar, .drawer, .selection-toolbar, .connect-banner, .help-popover')) return;
  if (state.tool === 'add' || state.tool === 'text') return;
  state.panning = true;
  state.moved = false;
  state.panStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, tx: state.tx, ty: state.ty };
  workspace.classList.add('panning');
});

workspace.addEventListener('click', (event) => {
  if (state.moved) return;
  if (event.target.closest('.three-viewport, .hex-node, [data-cluster-hit], .cluster-label, [data-relation-hit], [data-relation-handle], .canvas-annotation, .topbar, .drawer, .selection-toolbar, .connect-banner, .help-popover')) return;
  if (state.tool === 'add') { addHexAt(event); return; }
  if (state.tool === 'text') { addTextAt(event); return; }
  clearSelection(); render();
});

workspace.addEventListener('wheel', (event) => {
  event.preventDefault();
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? innerHeight : 1;
  const deltaX = event.deltaX * unit;
  const deltaY = event.deltaY * unit;
  const horizontalPan = !event.ctrlKey && (event.shiftKey || (Math.abs(deltaX) > Math.abs(deltaY) * 1.25 && Math.abs(deltaX) > 0));
  if (horizontalPan) {
    state.tx -= event.shiftKey && !deltaX ? deltaY : deltaX;
    if (!event.shiftKey) state.ty -= deltaY;
    applyTransform(); toolHint.classList.add('quiet'); scheduleViewportSave();
  } else if (deltaY) {
    const normalized = Math.max(-240, Math.min(240, deltaY));
    zoomViewportAt(event.clientX, event.clientY, Math.exp(-normalized * .0012));
  }
}, { passive: false });

document.addEventListener('pointerdown', (event) => {
  if (state.searchOpen && !event.target.closest('#searchPanel, #searchBtn')) toggleSearch(false);
  if (!helpPopover.hidden && !event.target.closest('#helpPopover, #helpBtn')) toggleHelp(false);
  const mobileActions = $('#mobileActions');
  if (!mobileActions.hidden && !event.target.closest('#mobileActions, #moreBtn')) {
    mobileActions.hidden = true;
    $('#moreBtn').setAttribute('aria-expanded', 'false');
  }
}, { capture: true });

window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerCancel);
window.addEventListener('blur', () => onPointerCancel());
let previousViewportSize = { width: innerWidth, height: innerHeight, focal: innerWidth <= 680 || innerHeight <= 500 };
window.addEventListener('resize', () => {
  const mobileActions = $('#mobileActions');
  if (window.innerWidth > 1100 && !mobileActions.hidden) {
    mobileActions.hidden = true;
    $('#moreBtn').setAttribute('aria-expanded', 'false');
  }
  const nextViewportSize = { width: innerWidth, height: innerHeight, focal: innerWidth <= 680 || innerHeight <= 500 };
  if (nextViewportSize.focal !== previousViewportSize.focal) fitMap(false);
  else {
    state.tx += (nextViewportSize.width - previousViewportSize.width) / 2;
    state.ty += (nextViewportSize.height - previousViewportSize.height) / 2;
    applyTransform();
    scheduleViewportSave();
  }
  previousViewportSize = nextViewportSize;
});
window.addEventListener('beforeunload', (event) => {
  if (!hasUnsavedWork()) return;
  persistRecovery();
  event.preventDefault();
  event.returnValue = 'Há alterações deste projeto ainda não gravadas ou exportadas.';
});
window.addEventListener('keydown', (event) => {
  if (state.onboardingOpen) {
    if (event.key === 'Escape') { event.preventDefault(); closeWelcome(); return; }
    if (event.key === 'Tab') {
      const focusable = [...welcomeOverlay.querySelectorAll('button,input,[href],select,textarea,[tabindex]:not([tabindex="-1"])')].filter((element) => !element.disabled && !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  const meta = event.ctrlKey || event.metaKey;
  if (meta && event.key.toLowerCase() === 'k') { event.preventDefault(); toggleSearch(); return; }
  const active = document.activeElement;
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName) || active?.isContentEditable;
  if (editing) {
    if (event.key !== 'Escape') return;
    if (active?.tagName === 'SELECT') return;
    event.preventDefault();
    active.blur();
  }
  if (meta && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
  if (event.key === 'Escape') {
    if (state.searchOpen) { event.preventDefault(); toggleSearch(false); return; }
    if (!helpPopover.hidden) { event.preventDefault(); toggleHelp(false); return; }
    if (!$('#mobileActions').hidden) {
      event.preventDefault();
      $('#mobileActions').hidden = true;
      $('#moreBtn').setAttribute('aria-expanded', 'false');
      $('#moreBtn').focus();
      return;
    }
    if (state.presentation) { togglePresentation(false); return; }
    if (state.multiSelection.size) { event.preventDefault(); state.multiSelection.clear(); render(); return; }
    const drawerOpen = state.selectedEntityId || state.selectedClusterId || state.selectedRelationId || state.selectedAnnotationId || state.settingsOpen || state.workspaceOpen;
    if (drawerOpen) { event.preventDefault(); state.connectSource = null; state.tool = 'move'; clearSelection(); render(); return; }
    state.connectSource = null; state.tool = 'move'; render();
    return;
  }
  if (event.key === '?' || (event.key === '/' && event.shiftKey)) { event.preventDefault(); toggleHelp(); }
  const canvasFocused = active === workspace || active === document.body;
  if (canvasFocused && state.viewMode === '2d' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const step = event.shiftKey ? 120 : 48;
    if (event.key === 'ArrowLeft') state.tx += step;
    if (event.key === 'ArrowRight') state.tx -= step;
    if (event.key === 'ArrowUp') state.ty += step;
    if (event.key === 'ArrowDown') state.ty -= step;
    applyTransform(); toolHint.classList.add('quiet'); scheduleViewportSave(); return;
  }
  if (canvasFocused && state.viewMode === '2d' && ['+', '=', '-', '_'].includes(event.key)) {
    event.preventDefault();
    zoomViewportAt(innerWidth / 2, innerHeight / 2, ['+', '='].includes(event.key) ? 1.15 : 1 / 1.15); return;
  }
  if (event.key === '0') { event.preventDefault(); state.viewMode === '3d' ? threeView?.fit() : fitMap(true); }
  if (event.key.toLowerCase() === 'p') { event.preventDefault(); togglePresentation(); return; }
  if (event.key.toLowerCase() === 'v') setTool('move');
  if (event.key.toLowerCase() === 'c') setTool('connect');
  if (event.key.toLowerCase() === 'h') setTool('add');
  if (event.key.toLowerCase() === 't' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) setTool('text');
  if ((event.key === 'Delete' || event.key === 'Backspace') && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) {
    let deleted = false;
    if (state.selectedRelationId) deleted = deleteRelationById(state.selectedRelationId);
    else if (state.selectedEntityId) deleted = deleteEntityById(state.selectedEntityId);
    else if (state.selectedAnnotationId) deleted = deleteAnnotationById(state.selectedAnnotationId);
    if (deleted) event.preventDefault();
  }
});

$$('.tool').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));
$('#undoBtn').addEventListener('click', undo);
$('#viewModeBtn').addEventListener('click', toggleViewMode);
$('#redoBtn').addEventListener('click', redo);
$('#projectBtn').addEventListener('click', () => { drawerReturnTarget = drawerTarget('control', 'projectBtn'); clearSelection({ keepWorkspace: true }); state.workspaceOpen = true; state.drawerMode = 'peek'; render(); });
$('#searchBtn').addEventListener('click', () => toggleSearch());
$('#closeSearch').addEventListener('click', () => toggleSearch(false));
mapSearch.addEventListener('input', () => { state.searchQuery = mapSearch.value; state.searchLimit = 80; renderSearchResults(); });
mapSearch.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown') return;
  const firstResult = searchResults.querySelector('button:not(.search-more)');
  if (!firstResult) return;
  event.preventDefault();
  firstResult.focus();
});
searchResults.addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...searchResults.querySelectorAll('button')].filter((button) => button.getClientRects().length);
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next].focus();
});
$('#fitBtn').addEventListener('click', () => state.viewMode === '3d' ? threeView?.fit() : fitMap(true));
$('#exportBtn').addEventListener('click', exportMap);
$('#presentationBtn')?.addEventListener('click', () => togglePresentation());
$('#importBtn').addEventListener('click', () => importInput.click());
$('#resetBtn').addEventListener('click', resetMap);
$('#helpBtn').addEventListener('click', () => toggleHelp());
$('#moreBtn').addEventListener('click', () => {
  const menu = $('#mobileActions');
  menu.hidden = !menu.hidden;
  $('#moreBtn').setAttribute('aria-expanded', String(!menu.hidden));
  if (!menu.hidden && keyboardNavigation) requestAnimationFrame(() => [...menu.querySelectorAll('button:not(:disabled)')].find((button) => button.getClientRects().length)?.focus());
});
$('#mobileActions').addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...$('#mobileActions').querySelectorAll('button:not(:disabled)')].filter((button) => button.getClientRects().length);
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next].focus();
});
$('#mobileActions').querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
  $('#mobileActions').hidden = true;
  $('#moreBtn').setAttribute('aria-expanded', 'false');
  $('#moreBtn').focus();
  $(`#${button.dataset.action}`)?.click();
}));
welcomeOverlay?.querySelectorAll('[data-start-mode]').forEach((button) => button.addEventListener('click', () => startProject(button.dataset.startMode)));
$('#welcomeClose')?.addEventListener('click', () => $('#welcomeClose').dataset.welcomeMode === 'new' ? closeWelcome() : startProject('demo'));
$('#closeHelp').addEventListener('click', () => toggleHelp(false));
$('#cancelConnect').addEventListener('click', () => setTool('move'));
$('#makeClusterBtn').addEventListener('click', formClusterFromSelection);
$('#clearSelectionBtn').addEventListener('click', () => { state.multiSelection.clear(); render(); });
$('#drawerClose').addEventListener('click', () => { clearSelection(); render(); });
$('#drawerExpand').addEventListener('click', () => {
  hideTooltip();
  const readingContent = state.selectedEntityId || state.selectedClusterId || state.selectedAnnotationId;
  state.drawerMode = readingContent ? (state.drawerMode === 'focus' ? 'peek' : 'focus') : (state.drawerMode === 'peek' ? 'wide' : 'peek');
  renderDrawer(); applyTransform();
});
$('#mapSettingsBtn').addEventListener('click', () => { drawerReturnTarget = drawerTarget('control', 'mapSettingsBtn'); clearSelection(); state.settingsOpen = true; state.drawerTab = 'map'; state.drawerMode = 'wide'; render(); });
layoutSelect.addEventListener('change', () => changeLayout(layoutSelect.value));
importInput.addEventListener('change', () => { if (importInput.files?.[0]) importMap(importInput.files[0]); importInput.value = ''; });
workspaceBundleInput.addEventListener('change', () => {
  const file = workspaceBundleInput.files?.[0];
  if (!file) return;
  if (!guardWorkspaceReplacement('importar outro bundle')) { workspaceBundleInput.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const before = mapSnapshot();
      const loaded = openPortableBundle(JSON.parse(reader.result));
      state.workspace = { ...loaded, lastSavedMap: '' };
      state.map = normalizeMap(loaded.map); restoreViewportFromMap();
      remember(before); clearSelection({ keepWorkspace: true }); state.workspaceOpen = true; render();
      state.workspace.lastSavedMap = workspaceSnapshot(); saveMap(); renderWorkspaceDrawer();
      if (state.viewMode === '3d') threeView?.fit();
      showToast(`${loaded.notes.length} notas importadas do bundle`);
    } catch (error) { showToast(`Bundle inválido: ${error.message}`); }
  };
  reader.readAsText(file); workspaceBundleInput.value = '';
});
imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  const entity = state.pendingImageEntityId ? entityById(state.pendingImageEntityId) : null;
  if (!file || !entity) return;
  const before = mapSnapshot();
  const reader = new FileReader();
  reader.onload = () => {
    entity.visual ||= { mode: 'icon', image: {} };
    entity.visual.image ||= {};
    entity.visual.image.src = reader.result;
    if (entity.visual.mode === 'text') entity.visual.mode = 'icon';
    remember(before); render(); showToast('Imagem incorporada ao JSON');
  };
  reader.readAsDataURL(file);
  imageInput.value = '';
  state.pendingImageEntityId = null;
});


window.HexMapStudio = Object.freeze({
  version: '10.3.0',
  getMap: () => clone(state.map),
  getJson: () => JSON.stringify(state.map, null, 2),
  setMap: (input, { fit = true } = {}) => {
    const before = mapSnapshot();
    state.map = normalizeMap(typeof input === 'string' ? JSON.parse(input) : input);
    remember(before);
    clearSelection();
    render();
    if (fit) state.viewMode === '3d' ? threeView?.fit() : fitMap(true);
    return clone(state.map);
  },
  selectHexagon: (id) => {
    if (!entityById(id)) return false;
    drawerReturnTarget = drawerTarget('entity', id);
    clearSelection(); state.selectedEntityId = id; state.drawerTab = 'content'; render(); return true;
  },
  selectCluster: (id) => {
    if (!clusterById(id)) return false;
    drawerReturnTarget = drawerTarget('cluster', id);
    clearSelection(); state.selectedClusterId = id; state.drawerTab = 'content'; render(); return true;
  },
  setLayout: (type) => { changeLayout(type); return state.map.layout.type; },
  forceThreeContextLossForQA: () => {
    if (!new URLSearchParams(location.search).has('qa') || !threeView) return false;
    threeView.forceContextLossForQA(); return true;
  },
  fit: () => state.viewMode === '3d' ? threeView?.fit() : fitMap(true),
  reset: () => resetMap(),
  routingReport: () => [...state.relationGeometry.entries()].map(([id, geometry]) => ({
    id,
    score: geometry.score,
    hardCollisions: geometry.hardCollisions || 0,
    crossings: geometry.crossings || 0,
    offset: geometry.offset,
  })),
  workspace: () => ({ connected: Boolean(state.workspace), name: state.workspace?.name || null, diagnostics: clone(state.workspace?.diagnostics || []) }),
  search: (query) => matchingEntities(String(query || '')).map((entity) => entity.id),
});

try {
  threeView = new HexMapThreeView({
    canvas: threeCanvas,
    labels: threeLabels,
    onDragStart: () => { clearSelection(); renderDrawer(); },
    onSelect: (id, modifiers = {}) => {
      if (!entityById(id)) return;
      handleEntityClick({ stopPropagation() {}, shiftKey: Boolean(modifiers.shiftKey) }, id);
    },
    onSelectCluster: (id) => {
      if (!clusterById(id)) return;
      handleClusterClick({ stopPropagation() {} }, id);
    },
    onMove: commitThreeMove,
    onClusterMove: commitThreeClusterMove,
    onAdd: (cell) => {
      if (state.readOnly || state.tool !== 'add' || state.map.layout.type !== 'free') return false;
      addHexAt(null, cell);
      return true;
    },
    onUnavailable: disableThreeView,
  });
  if (new URLSearchParams(location.search).has('qa')) {
    document.addEventListener('keydown', (event) => {
      if (event.altKey && event.shiftKey && event.code === 'KeyL') threeView?.forceContextLossForQA();
      if (event.altKey && event.shiftKey && event.code === 'KeyM') runThreeLifecycleQA();
    });
  }
} catch (error) {
  disableThreeView(error?.message || 'initialization-failed');
}

render();
revealToolHint();
requestAnimationFrame(() => storedViewportAvailable ? applyTransform() : fitMap(false));
if (!state.recoveryOpen && isFirstRun()) requestAnimationFrame(() => openWelcome('first'));
