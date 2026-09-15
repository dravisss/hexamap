import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SQRT3 = Math.sqrt(3);
const SIZE = 1.04;
const HEIGHT = .34;
const CAP_HEIGHT = .078;

function roundedHexShape(radius, corner = .12) {
  const vertices = Array.from({ length: 6 }, (_, i) => { const angle = Math.PI / 6 + i * Math.PI / 3; return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius); });
  const shape = new THREE.Shape();
  vertices.forEach((vertex, i) => {
    const previous = vertices[(i + 5) % 6]; const next = vertices[(i + 1) % 6];
    const edge = vertex.distanceTo(previous); const t = Math.min(.34, corner / edge);
    const start = vertex.clone().lerp(previous, t); const end = vertex.clone().lerp(next, t);
    if (i === 0) shape.moveTo(start.x, start.y); else shape.lineTo(start.x, start.y);
    shape.quadraticCurveTo(vertex.x, vertex.y, end.x, end.y);
  });
  shape.closePath(); return shape;
}

function layerGeometry(radius, depth, corner, bevel) {
  const geometry = new THREE.ExtrudeGeometry(roundedHexShape(radius, corner), { depth, steps: 1, bevelEnabled: true, bevelSegments: 4, bevelSize: bevel, bevelThickness: bevel * .8, curveSegments: 4 });
  geometry.translate(0, 0, -depth / 2);
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function hexBandGeometry(innerRadius, outerRadius, y = 0) {
  const positions = [];
  for (let index = 0; index < 6; index += 1) {
    const a = Math.PI / 6 + index * Math.PI / 3; const b = Math.PI / 6 + (index + 1) * Math.PI / 3;
    const outerA = [Math.cos(a) * outerRadius, y, Math.sin(a) * outerRadius]; const outerB = [Math.cos(b) * outerRadius, y, Math.sin(b) * outerRadius];
    const innerA = [Math.cos(a) * innerRadius, y, Math.sin(a) * innerRadius]; const innerB = [Math.cos(b) * innerRadius, y, Math.sin(b) * innerRadius];
    positions.push(...outerA, ...outerB, ...innerA, ...innerA, ...outerB, ...innerB);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals(); return geometry;
}

function contactShadowTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 10, 64, 64, 60);
  gradient.addColorStop(0, 'rgba(46,37,27,.34)'); gradient.addColorStop(.52, 'rgba(46,37,27,.12)'); gradient.addColorStop(1, 'rgba(46,37,27,0)');
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function fiberAlbedoTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#d4cec1'; context.fillRect(0, 0, 256, 256);
  let seed = 104729;
  const random = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 34; i += 1) {
    const x = random() * 256; const y = random() * 256; const radius = 12 + random() * 34;
    const light = random() > .48; const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, light ? 'rgba(255,253,244,.27)' : 'rgba(76,65,53,.22)');
    gradient.addColorStop(1, 'rgba(216,211,200,0)'); context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.lineCap = 'round';
  for (let i = 0; i < 280; i += 1) {
    const x = random() * 256; const y = random() * 256; const length = 12 + random() * 38; const slope = (random() - .5) * 5;
    context.strokeStyle = random() > .46 ? `rgba(255,253,245,${.11 + random() * .11})` : `rgba(65,55,45,${.09 + random() * .1})`;
    context.lineWidth = .55 + random() * 1.05; context.beginPath(); context.moveTo(x, y); context.lineTo(x + length, y + slope); context.stroke();
  }
  for (let i = 0; i < 1900; i += 1) {
    const value = Math.round(175 + random() * 58);
    context.fillStyle = `rgba(${value},${value},${value},${.11 + random() * .15})`;
    const x = random() * 256; const y = random() * 256; const length = 1 + random() * 11;
    context.fillRect(x, y, length, random() < .86 ? .55 : 1.1);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(.92, .92); return texture;
}

function paperRoughnessTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const context = canvas.getContext('2d'); const image = context.createImageData(256, 256);
  let seed = 130363;
  const random = () => ((seed = seed * 48271 % 2147483647) - 1) / 2147483646;
  for (let y = 0; y < 256; y += 1) for (let x = 0; x < 256; x += 1) {
    const macro = Math.sin(x * .055) * 13 + Math.sin((x + y) * .031) * 10 + Math.cos(y * .043) * 8;
    const value = THREE.MathUtils.clamp(190 + macro + (random() - .5) * 46, 126, 246); const index = (y * 256 + x) * 4;
    image.data[index] = image.data[index + 1] = image.data[index + 2] = value; image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0); const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.NoColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(.92, .92); return texture;
}

function axial(q, r, y = HEIGHT / 2) {
  return new THREE.Vector3(SIZE * SQRT3 * (q + r / 2), y, SIZE * 1.5 * r);
}

function semanticLift(cell) {
  const energy = Number(cell?.fields?.energy);
  if (!Number.isFinite(energy)) return 0;
  return THREE.MathUtils.clamp((energy - 20) / 80, 0, 1) * .09;
}

function cubeRound(q, r) {
  const x = q; const z = r; const y = -x - z;
  let rx = Math.round(x); let ry = Math.round(y); let rz = Math.round(z);
  const xd = Math.abs(rx - x); const yd = Math.abs(ry - y); const zd = Math.abs(rz - z);
  if (xd > yd && xd > zd) rx = -ry - rz; else if (yd > zd) ry = -rx - rz; else rz = -rx - ry;
  return { q: rx, r: rz };
}

function worldAxial(x, z) {
  return cubeRound((SQRT3 / 3 * x - z / 3) / SIZE, (2 / 3 * z) / SIZE);
}

function hull(points) {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (const p of sorted.toReversed()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function expanded(points, padding = 1.1) {
  const center = points.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y }), { x: 0, y: 0 });
  center.x /= points.length || 1; center.y /= points.length || 1;
  return points.map((p) => { const dx = p.x - center.x; const dy = p.y - center.y; const d = Math.hypot(dx, dy) || 1; return { x: p.x + dx / d * padding, y: p.y + dy / d * padding }; });
}

function smoothClosed(points, iterations = 2) {
  let result = points;
  for (let pass = 0; pass < iterations; pass += 1) {
    result = result.flatMap((point, index) => {
      const next = result[(index + 1) % result.length];
      return [
        { x: point.x * .75 + next.x * .25, y: point.y * .75 + next.y * .25 },
        { x: point.x * .25 + next.x * .75, y: point.y * .25 + next.y * .75 },
      ];
    });
  }
  return result;
}

function withColor(geometry, color) {
  const rgb = new THREE.Color(color); const values = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < geometry.attributes.position.count; i += 1) { values[i * 3] = rgb.r; values[i * 3 + 1] = rgb.g; values[i * 3 + 2] = rgb.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3)); return geometry;
}

export class HexMapThreeView {
  constructor({ canvas, labels, onSelect, onSelectCluster, onDragStart, onMove, onClusterMove, onAdd, onUnavailable }) {
    this.startedAt = performance.now();
    this.canvas = canvas;
    this.labels = labels;
    this.onSelect = onSelect;
    this.onSelectCluster = onSelectCluster;
    this.onDragStart = onDragStart;
    this.onMove = onMove;
    this.onClusterMove = onClusterMove;
    this.onAdd = onAdd;
    this.onUnavailable = onUnavailable;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#eee8dc');
    this.scene.fog = new THREE.FogExp2('#eee8dc', .006);
    this.camera = new THREE.OrthographicCamera(-14, 14, 9, -9, .1, 100);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.25 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = .92;
    this.controls = new MapControls(this.camera, canvas);
    this.controls.enableRotate = false;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.search).get('qa') === 'reduced-motion';
    this.canvas.dataset.motion = this.reducedMotion ? 'reduced' : 'full';
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = .08;
    this.controls.minZoom = innerWidth < 700 ? .2 : .58;
    this.controls.maxZoom = 2.5;
    this.handleControlsChange = () => this.invalidate();
    this.controls.addEventListener('change', this.handleControlsChange);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.worldPoint = new THREE.Vector3();
    this.tileMeshes = [];
    this.frame = 0;
    this.active = false;
    this.requestedActive = false;
    this.activationStartedAt = null;
    this.interactive = true;
    this.tool = 'move';
    this.drag = null;
    this.suppressClick = false;
    this.suppressClusterClick = false;
    this.mapSignature = '';
    this.selectedId = null;
    this.selectedClusterId = null;
    this.selectedRelationId = null;
    this.multiSelectedIds = new Set();
    this.focusedId = null;
    this.focalViewport = this.isFocalViewport();
    this.renderDurations = [];
    this.frameLatencies = [];
    this.resetCamera();
    const loader = new THREE.TextureLoader();
    const qaMode = new URLSearchParams(location.search).get('qa'); const qaAssetFailure = qaMode === 'asset-failure';
    const normalUrl = qaAssetFailure ? './assets/materials/book-pattern/missing-normal-map.jpg' : './assets/materials/book-pattern/book_pattern_nor_gl_1k.jpg';
    this.normalMap = loader.load(normalUrl, () => { this.canvas.dataset.materialAsset = 'ready'; this.canvas.dataset.normalReadyMs = (performance.now() - this.startedAt).toFixed(2); this.invalidate(); }, undefined, () => this.useProceduralMaterialFallback());
    this.fiberMap = fiberAlbedoTexture();
    this.roughnessMap = paperRoughnessTexture();
    this.contactShadowMap = contactShadowTexture();
    this.fiberMap.anisotropy = this.roughnessMap.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    for (const texture of [this.normalMap]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1.65, 1.65); texture.colorSpace = THREE.NoColorSpace;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    }
    this.addEnvironment();
    this.handlers = {
      click: (event) => this.pick(event),
      pointerdown: (event) => this.pointerDown(event),
      pointermove: (event) => this.pointerMove(event),
      pointerup: (event) => this.pointerUp(event),
      pointercancel: (event) => this.cancelAllMoves(event),
      contextlost: (event) => { event.preventDefault(); this.canvas.dataset.context = 'lost'; this.setActive(false); this.onUnavailable?.('context-lost'); },
      contextrestored: () => { this.canvas.dataset.context = 'restored'; },
      visibilitychange: () => {
        this.active = this.requestedActive && !document.hidden;
        if (this.active) { this.resize(); this.invalidate(); } else this.cancelAllMoves();
      },
      clusterpointermove: (event) => this.clusterPointerMove(event),
      clusterpointerup: (event) => this.clusterPointerUp(event),
      clusterpointercancel: (event) => this.cancelAllMoves(event),
      cancel: () => this.cancelAllMoves(),
    };
    for (const type of ['click', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'webglcontextlost', 'webglcontextrestored']) canvas.addEventListener(type, this.handlers[type.replace('webgl', '')]);
    document.addEventListener('visibilitychange', this.handlers.visibilitychange);
    document.addEventListener('pointermove', this.handlers.clusterpointermove);
    document.addEventListener('pointerup', this.handlers.clusterpointerup);
    document.addEventListener('pointercancel', this.handlers.clusterpointercancel);
    window.addEventListener('blur', this.handlers.cancel);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
  }

  addEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environmentMap = pmrem.fromScene(new RoomEnvironment(), .035).texture;
    this.scene.environment = this.environmentMap;
    pmrem.dispose();
    this.scene.add(new THREE.AmbientLight('#fff7ea', .24));
    this.scene.add(new THREE.HemisphereLight('#fffaf0', '#655f56', 1.05));
    const key = new THREE.DirectionalLight('#ffe5bd', 3.55);
    key.position.set(-10, 16, 8); key.castShadow = true; key.shadow.mapSize.set(innerWidth < 700 ? 512 : 1024, innerWidth < 700 ? 512 : 1024); key.shadow.bias = -.00025;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#b8d7da', .66); rim.position.set(12, 7, -10); this.scene.add(rim);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 55), new THREE.MeshStandardMaterial({ color: '#eee8dc', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.09; ground.receiveShadow = true;
    ground.userData.persistent = true;
    this.scene.add(ground);
  }

  setActive(active) {
    if (active && !this.requestedActive) {
      this.activationStartedAt = performance.now();
      delete this.canvas.dataset.firstRenderMs;
    }
    this.requestedActive = active;
    this.active = active && !document.hidden;
    if (this.active) { this.resize(); this.invalidate(); } else this.cancelAllMoves();
  }

  useProceduralMaterialFallback() {
    this.canvas.dataset.materialAsset = 'procedural-fallback';
    this.scene.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) if (material.normalMap) { material.normalMap = null; material.needsUpdate = true; }
    });
    this.normalMap?.dispose(); this.normalMap = null; this.invalidate();
  }

  setInteractive(interactive) {
    this.interactive = interactive;
    if (!interactive) this.cancelAllMoves();
  }

  setTool(tool) {
    this.tool = tool || 'move';
    this.canvas.dataset.tool = this.tool;
  }

  isFocalViewport() {
    return (innerHeight <= 500 && innerWidth >= 700) || (innerWidth < 700 && (this.map?.hexagons?.length || 0) > 96);
  }

  minimumZoom() {
    if (this.isFocalViewport()) return .34;
    if (innerWidth < 700 || (this.map?.hexagons?.length || 0) > 96) return .2;
    return .58;
  }

  focusClusterId() {
    const focused = this.map?.hexagons.find((cell) => cell.id === this.focusedId);
    const selected = this.map?.hexagons.find((cell) => cell.id === this.selectedId);
    return focused?.clusterId || selected?.clusterId || this.map?.hexagons[0]?.clusterId || null;
  }

  focusCells() {
    const clusterId = this.focusClusterId();
    return this.isFocalViewport() && clusterId
      ? this.map.hexagons.filter((cell) => cell.clusterId === clusterId)
      : this.map.hexagons;
  }

  fit(selectedId = this.selectedId) {
    if (selectedId && this.map?.hexagons.some((cell) => cell.id === selectedId)) {
      this.selectedId = selectedId;
      this.focusedId = selectedId;
    }
    this.centerCameraOnMap();
    this.fitCameraToMap();
    this.paintSelection();
    this.invalidate();
  }

  update(map, selectedId = null, multiSelectedIds = [], selection = {}) {
    this.map = map;
    const signature = JSON.stringify({ hexagons: map.hexagons.map(({ id, q, r, clusterId, visual }) => ({ id, q, r, clusterId, color: visual?.color || null })), clusters: map.clusters, relations: map.relations });
    if (signature !== this.mapSignature) {
      this.mapSignature = signature;
      this.rebuild();
    }
    const nextMultiSelectedIds = new Set(multiSelectedIds);
    const multiSelectionChanged = nextMultiSelectedIds.size !== this.multiSelectedIds.size || [...nextMultiSelectedIds].some((id) => !this.multiSelectedIds.has(id));
    const contextSelectionChanged = selection.clusterId !== this.selectedClusterId || selection.relationId !== this.selectedRelationId;
    if (selectedId !== this.selectedId || multiSelectionChanged || contextSelectionChanged) {
      this.selectedId = selectedId;
      this.selectedClusterId = selection.clusterId || null;
      this.selectedRelationId = selection.relationId || null;
      this.multiSelectedIds = nextMultiSelectedIds;
      this.paintSelection();
    }
    this.invalidate();
  }

  rebuild() {
    const rebuildStartedAt = performance.now();
    for (const object of [...this.scene.children]) {
      if (object.userData.persistent || object.isLight) continue;
      this.scene.remove(object); object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose()); else object.material?.dispose();
    }
    this.tileMeshes = [];
    this.labels.replaceChildren();
    const clusterMap = new Map(this.map.clusters.map((cluster) => [cluster.id, cluster]));
    this.buildPresentationLayout(clusterMap);
    this.mobilePriorityCells = new Set([...clusterMap.keys()].map((clusterId) => {
      const center = this.center(clusterId);
      return this.map.hexagons.filter((cell) => cell.clusterId === clusterId)
        .sort((a, b) => this.cellPosition(a).distanceToSquared(center) - this.cellPosition(b).distanceToSquared(center))[0]?.id;
    }).filter(Boolean));
    this.addMembranes(clusterMap);
    this.addRelations(clusterMap);
    const baseGeometry = layerGeometry(SIZE * .965, HEIGHT, .13, .052);
    const capGeometry = layerGeometry(SIZE * .855, CAP_HEIGHT, .15, .034);
    const shadowGeometry = new THREE.PlaneGeometry(SIZE * 2.45, SIZE * 2.05); shadowGeometry.rotateX(-Math.PI / 2);
    const shadows = new THREE.InstancedMesh(shadowGeometry, new THREE.MeshBasicMaterial({ map: this.contactShadowMap, transparent: true, opacity: .64, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true }), this.map.hexagons.length);
    const shadowHelper = new THREE.Object3D();
    this.map.hexagons.forEach((cell, index) => { shadowHelper.position.copy(this.cellPosition(cell, -.045)); shadowHelper.scale.set(1, 1, 1); shadowHelper.updateMatrix(); shadows.setMatrixAt(index, shadowHelper.matrix); });
    shadows.renderOrder = 1; this.scene.add(shadows);
    const baseFace = new THREE.MeshStandardMaterial({ color: '#cbc6bc', roughness: .84, metalness: 0, normalMap: this.normalMap, normalScale: new THREE.Vector2(.12, .12), envMapIntensity: .56 });
    const baseSide = new THREE.MeshStandardMaterial({ color: '#aaa398', roughness: .9, metalness: 0, normalMap: this.normalMap, normalScale: new THREE.Vector2(.1, .1), envMapIntensity: .5 });
    const capFace = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: this.fiberMap, roughnessMap: this.roughnessMap, roughness: .76, metalness: 0, clearcoat: .14, clearcoatRoughness: .7, sheen: .23, sheenRoughness: .76, sheenColor: new THREE.Color('#fff8e9'), normalMap: this.normalMap, normalScale: new THREE.Vector2(.52, .52), envMapIntensity: .7 });
    const capSide = new THREE.MeshStandardMaterial({ color: '#ddd7cc', roughness: .86, metalness: 0, normalMap: this.normalMap, normalScale: new THREE.Vector2(.13, .13) });
    const base = new THREE.InstancedMesh(baseGeometry, [baseFace, baseSide], this.map.hexagons.length);
    const mesh = new THREE.InstancedMesh(capGeometry, [capFace, capSide], this.map.hexagons.length);
    const baseColors = [];
    const capColors = [];
    base.castShadow = true; base.receiveShadow = true; base.renderOrder = 2; base.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.cells = this.map.hexagons; mesh.renderOrder = 3; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.userData.partner = base; mesh.userData.partnerOffsetY = -(HEIGHT / 2 + CAP_HEIGHT / 2 + .012);
    const helper = new THREE.Object3D();
    this.map.hexagons.forEach((cell, index) => {
      const clusterColor = cell.visual?.color || clusterMap.get(cell.clusterId)?.color || '#8f775f';
      const tonalVariation = ((index * 17) % 7 - 3) * .014;
      const capColor = new THREE.Color(clusterColor).offsetHSL(0, -.045, .115 + tonalVariation);
      const baseColor = capColor.clone().offsetHSL(0, .015, -.095);
      baseColors.push(baseColor); capColors.push(capColor);
      helper.position.copy(this.basePosition(cell)); helper.updateMatrix(); base.setMatrixAt(index, helper.matrix); base.setColorAt(index, baseColor);
      helper.position.copy(this.capPosition(cell)); helper.updateMatrix(); mesh.setMatrixAt(index, helper.matrix); mesh.setColorAt(index, capColor);
    });
    if (base.instanceColor) base.instanceColor.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.baseColors = capColors; base.userData.baseColors = baseColors;
    this.scene.add(base, mesh); this.tileMeshes.push(mesh);
    this.addTileInlays(clusterMap);
    this.createLabels(clusterMap);
    this.createSelectionRing();
    this.createMoveIndicators();
    this.paintSelection();
    this.centerCameraOnMap();
    this.fitCameraToMap();
    this.canvas.dataset.rebuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
  }

  buildPresentationLayout(clusterMap) {
    const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const compact = innerWidth < 700;
    const desktopSlots = [[-7.1,-4.25],[0,-4.25],[7.1,-4.25],[-7.1,4.25],[0,4.25],[7.1,4.25]];
    const compactSlots = [[-3.3,-5.25],[3.3,-5.25],[-3.3,0],[3.3,0],[-3.3,5.25],[3.3,5.25]];
    const clusters = [...clusterMap.values()];
    const makeGridSlots = () => {
      const columns = compact ? 2 : Math.ceil(Math.sqrt(clusters.length * 1.5));
      const rows = Math.ceil(clusters.length / columns);
      const spacingX = compact ? 6.6 : 7.1;
      const spacingZ = compact ? 5.25 : 8.5;
      return clusters.map((_, index) => [
        (index % columns - (columns - 1) / 2) * spacingX,
        (Math.floor(index / columns) - (rows - 1) / 2) * spacingZ,
      ]);
    };
    const slots = clusters.length <= 6 ? (compact ? compactSlots : desktopSlots) : makeGridSlots();
    const titles = ['organizacao do trabalho','governanca','tecnologia','coordenacao','informacao','recursos'];
    const namedSlots = new Map(clusters.length <= 6 ? titles.map((title, index) => [title, slots[index]]) : []);
    this.compactLayout = compact;
    this.clusterOffsets = new Map();
    clusters.forEach((cluster, index) => {
      const cells = this.map.hexagons.filter((cell) => cell.clusterId === cluster.id);
      const source = cells.reduce((sum, cell) => sum.add(axial(cell.q, cell.r, 0)), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, cells.length));
      const authored = compact ? cluster.view3dMobile : cluster.view3d;
      const slot = Number.isFinite(authored?.x) && Number.isFinite(authored?.z) ? [authored.x, authored.z] : namedSlots.get(normalize(cluster.title)) || slots[index % slots.length];
      this.clusterOffsets.set(cluster.id, new THREE.Vector3(slot[0] - source.x, 0, slot[1] - source.z));
    });
  }

  cellPosition(cell, y = 0) {
    return axial(cell.q, cell.r, y).add(this.clusterOffsets?.get(cell.clusterId) || new THREE.Vector3());
  }

  basePosition(cell) { return this.cellPosition(cell, HEIGHT / 2 + semanticLift(cell)); }
  capPosition(cell) { return this.cellPosition(cell, HEIGHT + CAP_HEIGHT / 2 + .012 + semanticLift(cell)); }

  addMembranes(clusterMap) {
    const fills = []; const linePositions = []; const lineColors = [];
    for (const [id, cluster] of clusterMap) {
      const perimeter = this.map.hexagons.filter((h) => h.clusterId === id).flatMap((cell) => {
        const center = this.cellPosition(cell, 0);
        return Array.from({ length: 6 }, (_, index) => {
          const angle = Math.PI / 6 + index * Math.PI / 3;
          return { x: center.x + Math.cos(angle) * SIZE * 1.01, y: center.z + Math.sin(angle) * SIZE * 1.01 };
        });
      });
      const silhouette = hull(perimeter);
      const points = smoothClosed(expanded(silhouette, 1.02), 2);
      if (points.length < 3) continue;
      const shape = new THREE.Shape(); shape.moveTo(points[0].x, -points[0].y); points.slice(1).forEach((p) => shape.lineTo(p.x, -p.y)); shape.closePath();
      const fill = new THREE.ShapeGeometry(shape); fill.rotateX(-Math.PI / 2); fill.translate(0, -.02, 0); fills.push(withColor(fill, cluster.color));
      [1.12, .91, .7, .49, .28].forEach((padding, band) => {
        const ringPoints = smoothClosed(expanded(silhouette, padding), 1);
        const ring = ringPoints.map((p, index) => {
          const wobble = Math.sin(index * 2.173 + band * 1.61 + id.length) * (.018 + band * .004);
          const previous = ringPoints[(index + ringPoints.length - 1) % ringPoints.length];
          const next = ringPoints[(index + 1) % ringPoints.length];
          const nx = -(next.y - previous.y); const ny = next.x - previous.x; const length = Math.hypot(nx, ny) || 1;
          return new THREE.Vector3(p.x + nx / length * wobble, .008 + band * .005, p.y + ny / length * wobble);
        });
        ring.forEach((point, i) => { const next = ring[(i + 1) % ring.length]; linePositions.push(point.x, point.y, point.z, next.x, next.y, next.z); const c = new THREE.Color(cluster.color); lineColors.push(c.r,c.g,c.b,c.r,c.g,c.b); });
      });
    }
    if (fills.length) this.scene.add(new THREE.Mesh(mergeGeometries(fills, false), new THREE.MeshBasicMaterial({ vertexColors: true, map: this.fiberMap, transparent: true, opacity: .16, depthWrite: false, side: THREE.DoubleSide })));
    if (linePositions.length) {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
      this.scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .34 })));
    }
  }

  addTileInlays(clusterMap) {
    const geometry = hexBandGeometry(SIZE * .735, SIZE * .785, 0);
    const material = new THREE.MeshStandardMaterial({ transparent: true, opacity: .62, roughness: .82, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const inlays = new THREE.InstancedMesh(geometry, material, this.map.hexagons.length);
    const helper = new THREE.Object3D(); const colors = [];
    this.map.hexagons.forEach((cell, index) => {
      const source = cell.visual?.color || clusterMap.get(cell.clusterId)?.color || '#8f775f';
      const color = new THREE.Color(source).offsetHSL(0, -.09, -.18);
      colors.push(color); helper.position.copy(this.capPosition(cell)); helper.position.y += CAP_HEIGHT / 2 + .008; helper.updateMatrix();
      inlays.setMatrixAt(index, helper.matrix); inlays.setColorAt(index, color);
    });
    if (inlays.instanceColor) inlays.instanceColor.needsUpdate = true;
    inlays.instanceMatrix.setUsage(THREE.DynamicDrawUsage); inlays.renderOrder = 4; this.scene.add(inlays);
    const capMesh = this.tileMeshes[0];
    if (capMesh) capMesh.userData.decorators = [{ mesh: inlays, offsetY: CAP_HEIGHT / 2 + .008, colors }];
  }

  center(clusterId) {
    const points = this.map.hexagons.filter((h) => h.clusterId === clusterId).map((h) => this.cellPosition(h, .05));
    return points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, points.length));
  }

  endpointPosition(endpointId) {
    const cell = this.map.hexagons.find((item) => item.id === endpointId);
    if (cell) return this.cellPosition(cell, .05);
    if (this.map.clusters.some((item) => item.id === endpointId)) return this.center(endpointId);
    return null;
  }

  endpointColor(endpointId, clusterMap) {
    const cluster = clusterMap.get(endpointId);
    if (cluster) return cluster.color;
    const cell = this.map.hexagons.find((item) => item.id === endpointId);
    return cell?.visual?.color || clusterMap.get(cell?.clusterId)?.color || '#8f775f';
  }

  addRelations(clusterMap) {
    const tubes = []; const casings = []; const arrows = [];
    let renderedRelations = 0;
    for (const relation of this.map.relations) {
      const start = this.endpointPosition(relation.source); const end = this.endpointPosition(relation.target);
      if (!start || !end) continue;
      renderedRelations += 1;
      const middle = start.clone().lerp(end, .5); middle.y = .24;
      const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
      const color = new THREE.Color(this.endpointColor(relation.source, clusterMap)).offsetHSL(0, .14, -.31);
      casings.push(new THREE.TubeGeometry(curve, 24, .046, 5, false));
      tubes.push(withColor(new THREE.TubeGeometry(curve, 24, .032, 5, false), color));
      const arrow = new THREE.ConeGeometry(.095, .28, 10); const position = curve.getPoint(.93); const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(.93).normalize()); arrow.applyMatrix4(new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1,1,1))); arrows.push(withColor(arrow, color));
    }
    if (casings.length) this.scene.add(new THREE.Mesh(mergeGeometries(casings, false), new THREE.MeshStandardMaterial({ color: '#f7f1e6', roughness: .88, transparent: true, opacity: .72 })));
    if (tubes.length) this.scene.add(new THREE.Mesh(mergeGeometries(tubes, false), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .88 })));
    if (arrows.length) this.scene.add(new THREE.Mesh(mergeGeometries(arrows, false), new THREE.MeshBasicMaterial({ vertexColors: true })));
    this.canvas.dataset.renderedRelations = String(renderedRelations);
  }

  createLabels(clusterMap) {
    for (const [id, cluster] of clusterMap) {
      const label = document.createElement('button'); label.type = 'button'; label.className = 'three-cluster-label'; label.dataset.cluster = id; label.dataset.longTitle = String(/\S{18,}/.test(cluster.title)); label.setAttribute('aria-label', `Abrir cluster ${cluster.title}`); label.setAttribute('aria-pressed', 'false');
      label.innerHTML = `<strong>${cluster.title}</strong><span>${this.map.hexagons.filter((h) => h.clusterId === id).length} hexágonos</span>`;
      label.addEventListener('pointerdown', (event) => this.clusterPointerDown(event, id));
      label.addEventListener('click', (event) => { event.stopPropagation(); if (!this.suppressClusterClick) this.onSelectCluster?.(id); });
      this.labels.append(label);
    }
    for (const relation of this.map.relations) {
      const label = document.createElement('div'); label.className = 'three-relation-label'; label.dataset.relation = relation.id; label.textContent = relation.label; label.setAttribute('aria-hidden', 'true'); this.labels.append(label);
    }
    this.map.hexagons.forEach((cell, index) => {
      const label = document.createElement('button'); label.type = 'button'; label.className = 'three-cell-label'; label.dataset.cell = cell.id; label.dataset.priority = String(index % 2 === 0); label.textContent = cell.title; label.setAttribute('aria-label', `Selecionar hexágono ${cell.title}`); label.setAttribute('aria-pressed', 'false'); label.addEventListener('click', (event) => this.onSelect?.(cell.id, { shiftKey: event.shiftKey })); label.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.onSelect?.(cell.id, { shiftKey: event.shiftKey }); } }); this.labels.append(label);
    });
  }

  pointerGround(event, target = new THREE.Vector3()) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera); return this.raycaster.ray.intersectPlane(this.dragPlane, target);
  }

  clusterPointerDown(event, clusterId) {
    if (!this.active || !this.interactive || event.button !== 0 || this.drag || this.clusterDrag) return;
    const ground = this.pointerGround(event, new THREE.Vector3()); if (!ground) return;
    event.preventDefault(); event.stopPropagation(); this.controls.enabled = false;
    this.clusterDrag = { id: clusterId, pointerId: event.pointerId, start: ground.clone(), delta: { q: 0, r: 0 }, moved: false };
    this.canvas.dataset.lastInteraction = `cluster-start:${clusterId}`; this.invalidate();
  }

  clusterPointerMove(event) {
    if (!this.clusterDrag || event.pointerId !== this.clusterDrag.pointerId) return;
    const ground = this.pointerGround(event, new THREE.Vector3()); if (!ground) return;
    const delta = worldAxial(ground.x - this.clusterDrag.start.x, ground.z - this.clusterDrag.start.z);
    if (delta.q === this.clusterDrag.delta.q && delta.r === this.clusterDrag.delta.r) return;
    this.clusterDrag.delta = delta; this.clusterDrag.moved ||= Boolean(delta.q || delta.r);
    const offset = axial(delta.q, delta.r, 0);
    for (const mesh of this.tileMeshes) mesh.userData.cells.forEach((cell, index) => { if (cell.clusterId === this.clusterDrag.id) this.setInstancePosition(mesh, index, this.capPosition(cell).add(offset)); });
    this.canvas.dataset.lastInteraction = `cluster-preview:${this.clusterDrag.id}:${delta.q},${delta.r}`; this.invalidate();
  }

  clusterPointerUp(event) {
    if (!this.clusterDrag || event.pointerId !== this.clusterDrag.pointerId) return;
    const pending = this.clusterDrag; this.clusterDrag = null; this.controls.enabled = true;
    this.suppressClusterClick = true;
    setTimeout(() => { this.suppressClusterClick = false; }, 0);
    const base = this.center(pending.id); const visualDelta = axial(pending.delta.q, pending.delta.r, 0);
    const accepted = pending.moved && this.onClusterMove?.(pending.id, pending.delta.q, pending.delta.r, { x: base.x + visualDelta.x, z: base.z + visualDelta.z, compact: innerWidth < 700 });
    if (!pending.moved) this.onSelectCluster?.(pending.id);
    this.canvas.dataset.lastInteraction = `${accepted ? 'cluster-commit' : 'cluster-cancel'}:${pending.id}`;
    if (pending.moved && !accepted) this.rebuild(); this.invalidate();
  }

  createSelectionRing() {
    const makeBand = (innerRadius, outerRadius, color, opacity) => {
      return new THREE.Mesh(hexBandGeometry(innerRadius, outerRadius, HEIGHT + CAP_HEIGHT + .062), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide }));
    };
    this.selectionRings = [makeBand(SIZE * .73, SIZE * .775, '#fbfaf5', 1), makeBand(SIZE * .79, SIZE * .845, '#2689bd', .98)];
    this.selectionRings.forEach((ring) => { ring.visible = false; ring.renderOrder = 12; this.scene.add(ring); });
    this.multiSelectionMesh = new THREE.InstancedMesh(
      hexBandGeometry(SIZE * .78, SIZE * .89, HEIGHT + CAP_HEIGHT + .068),
      new THREE.MeshBasicMaterial({ color: '#237dac', transparent: true, opacity: .98, depthTest: false, side: THREE.DoubleSide }),
      Math.max(1, this.map.hexagons.length),
    );
    this.multiSelectionMesh.count = 0;
    this.multiSelectionMesh.renderOrder = 13;
    this.scene.add(this.multiSelectionMesh);
    this.relationSelectionMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#167daf', transparent: true, opacity: .96, depthTest: false }));
    this.relationSelectionMesh.visible = false;
    this.relationSelectionMesh.renderOrder = 14;
    this.scene.add(this.relationSelectionMesh);
  }

  createMoveIndicators() {
    const points = Array.from({ length: 7 }, (_, i) => { const angle = Math.PI / 6 + i * Math.PI / 3; return new THREE.Vector3(Math.cos(angle) * SIZE * .93, .245, Math.sin(angle) * SIZE * .93); });
    const originMaterial = new THREE.LineDashedMaterial({ color: '#f8f4e9', dashSize: .12, gapSize: .08, transparent: true, opacity: .95, depthTest: false });
    this.originIndicator = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), originMaterial); this.originIndicator.computeLineDistances();
    this.destinationIndicator = new THREE.Mesh(hexBandGeometry(SIZE * .91, SIZE * .97, .025), new THREE.MeshBasicMaterial({ color: '#3c9b6b', transparent: true, opacity: .96, depthTest: false, side: THREE.DoubleSide }));
    this.dragShadow = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 2.45, SIZE * 2.05), new THREE.MeshBasicMaterial({ map: this.contactShadowMap, transparent: true, opacity: .68, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true }));
    this.dragShadow.rotation.x = -Math.PI / 2; this.dragShadow.position.y = .02;
    this.dragGuide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: '#327fbd', dashSize: .18, gapSize: .11, transparent: true, opacity: .78, depthTest: false }));
    for (const indicator of [this.originIndicator, this.destinationIndicator, this.dragShadow, this.dragGuide]) { indicator.visible = false; indicator.renderOrder = 15; this.scene.add(indicator); }
  }

  paintSelection() {
    const selectedRelation = this.map?.relations.find((relation) => relation.id === this.selectedRelationId);
    const relatedClusterIds = new Set();
    const relatedCellIds = new Set();
    if (selectedRelation) {
      for (const endpointId of [selectedRelation.source, selectedRelation.target]) {
        if (this.map.clusters.some((cluster) => cluster.id === endpointId)) relatedClusterIds.add(endpointId);
        if (this.map.hexagons.some((cell) => cell.id === endpointId)) relatedCellIds.add(endpointId);
      }
    }
    for (const mesh of this.tileMeshes) {
      mesh.userData.cells.forEach((cell, index) => {
        const color = mesh.userData.baseColors[index].clone();
        if (cell.clusterId === this.selectedClusterId) color.lerp(new THREE.Color('#167daf'), .28);
        else if (relatedClusterIds.has(cell.clusterId) || relatedCellIds.has(cell.id)) color.lerp(new THREE.Color('#167daf'), .17);
        if (this.multiSelectedIds.has(cell.id)) color.lerp(new THREE.Color('#237dac'), .48);
        mesh.setColorAt(index, color);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const label of this.labels?.querySelectorAll('.three-cell-label') || []) {
      const selected = label.dataset.cell === this.selectedId || this.multiSelectedIds.has(label.dataset.cell);
      label.setAttribute('aria-pressed', String(selected));
      label.classList.toggle('relation-context', relatedCellIds.has(label.dataset.cell));
    }
    for (const label of this.labels?.querySelectorAll('.three-cluster-label') || []) {
      const selected = label.dataset.cluster === this.selectedClusterId;
      label.setAttribute('aria-pressed', String(selected));
      label.classList.toggle('selected', selected);
      label.classList.toggle('relation-context', relatedClusterIds.has(label.dataset.cluster));
    }
    for (const label of this.labels?.querySelectorAll('.three-relation-label') || []) {
      const selected = label.dataset.relation === this.selectedRelationId;
      label.classList.toggle('selected', selected);
      label.dataset.selected = String(selected);
    }
    this.canvas.dataset.selectedCluster = this.selectedClusterId || '';
    this.canvas.dataset.selectedRelation = this.selectedRelationId || '';
    this.canvas.dataset.multiSelected = String(this.multiSelectedIds.size);
    if (this.multiSelectionMesh) {
      const helper = new THREE.Object3D(); let index = 0;
      for (const cell of this.map?.hexagons || []) {
        if (!this.multiSelectedIds.has(cell.id)) continue;
        helper.position.copy(this.cellPosition(cell, 0)); helper.updateMatrix();
        this.multiSelectionMesh.setMatrixAt(index, helper.matrix); index += 1;
      }
      this.multiSelectionMesh.count = index;
      this.multiSelectionMesh.instanceMatrix.needsUpdate = true;
      this.canvas.dataset.multiSelectionMarkers = String(index);
    }
    const selected = this.map?.hexagons.find((cell) => cell.id === this.selectedId);
    for (const ring of this.selectionRings || []) {
      ring.visible = Boolean(selected);
      if (selected) ring.position.copy(this.cellPosition(selected, 0));
    }
    if (this.relationSelectionMesh) {
      const start = selectedRelation ? this.endpointPosition(selectedRelation.source) : null;
      const end = selectedRelation ? this.endpointPosition(selectedRelation.target) : null;
      this.relationSelectionMesh.geometry.dispose();
      if (start && end) {
        const middle = start.clone().lerp(end, .5); middle.y = .27;
        this.relationSelectionMesh.geometry = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, middle, end), 30, .058, 8, false);
        this.relationSelectionMesh.visible = true;
      } else {
        this.relationSelectionMesh.geometry = new THREE.BufferGeometry();
        this.relationSelectionMesh.visible = false;
      }
    }
  }

  hitAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.tileMeshes, false)[0];
  }

  setInstancePosition(mesh, index, position, scale = 1) {
    const helper = new THREE.Object3D(); helper.position.copy(position); helper.scale.setScalar(scale); helper.updateMatrix();
    mesh.setMatrixAt(index, helper.matrix); mesh.instanceMatrix.needsUpdate = true;
    if (mesh.userData.partner) {
      helper.position.copy(position); helper.position.y += mesh.userData.partnerOffsetY || 0; helper.scale.setScalar(scale); helper.updateMatrix();
      mesh.userData.partner.setMatrixAt(index, helper.matrix); mesh.userData.partner.instanceMatrix.needsUpdate = true;
    }
    for (const decoration of mesh.userData.decorators || []) {
      helper.position.copy(position); helper.position.y += decoration.offsetY || 0; helper.scale.setScalar(scale); helper.updateMatrix();
      decoration.mesh.setMatrixAt(index, helper.matrix); decoration.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  pointerDown(event) {
    if (!this.active || !this.interactive || event.button !== 0) return;
    this.canvas.dataset.lastPointer = `${Math.round(event.clientX)},${Math.round(event.clientY)}`;
    const hit = this.hitAt(event); const cell = hit?.object?.userData?.cells?.[hit.instanceId];
    this.canvas.dataset.lastPointerHit = cell?.id || 'none';
    if (!cell) return;
    event.preventDefault(); event.stopPropagation();
    this.controls.enabled = false; this.canvas.setPointerCapture(event.pointerId); this.canvas.classList.add('dragging');
    const origin = this.capPosition(cell);
    this.drag = { pointerId: event.pointerId, mesh: hit.object, index: hit.instanceId, cell, origin, position: origin.clone(), candidate: { q: cell.q, r: cell.r }, valid: false, moved: false };
    this.selectedId = cell.id; this.originIndicator.position.copy(origin.clone().setY(0)); this.originIndicator.visible = true;
    this.setInstancePosition(hit.object, hit.instanceId, origin.clone().setY(.83), 1.035); this.paintSelection(); this.invalidate();
  }

  pointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.hitAt(event);
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.worldPoint)) return;
    const wasMoved = this.drag.moved;
    this.drag.moved ||= Math.hypot(this.worldPoint.x - this.drag.origin.x, this.worldPoint.z - this.drag.origin.z) > .14;
    if (!wasMoved && this.drag.moved) this.onDragStart?.(this.drag.cell.id);
    this.drag.position.set(this.worldPoint.x, .83, this.worldPoint.z);
    this.setInstancePosition(this.drag.mesh, this.drag.index, this.drag.position, 1.035);
    this.dragShadow.position.set(this.drag.position.x, .02, this.drag.position.z); this.dragShadow.visible = true;
    const guidePoints = [this.drag.origin.clone().setY(.18), this.drag.origin.clone().lerp(this.drag.position, .5).setY(.3), this.drag.position.clone().setY(.18)];
    this.dragGuide.geometry.setFromPoints(guidePoints); this.dragGuide.computeLineDistances(); this.dragGuide.visible = true;
    const targetCluster = this.map.clusters.map((cluster) => ({ cluster, center: this.center(cluster.id) })).sort((a, b) => a.center.distanceToSquared(this.worldPoint) - b.center.distanceToSquared(this.worldPoint))[0]?.cluster;
    const clusterOffset = this.clusterOffsets.get(targetCluster?.id || this.drag.cell.clusterId) || new THREE.Vector3();
    const candidate = worldAxial(this.worldPoint.x - clusterOffset.x, this.worldPoint.z - clusterOffset.z);
    const occupied = this.map.hexagons.some((cell) => cell.id !== this.drag.cell.id && cell.q === candidate.q && cell.r === candidate.r);
    this.drag.candidate = candidate; this.drag.targetClusterId = targetCluster?.id || null; this.drag.valid = !occupied && (candidate.q !== this.drag.cell.q || candidate.r !== this.drag.cell.r || this.drag.targetClusterId !== this.drag.cell.clusterId);
    this.destinationIndicator.position.copy(axial(candidate.q, candidate.r, 0).add(clusterOffset)); this.destinationIndicator.material.color.set(this.drag.valid ? '#379b6c' : '#bd554e'); this.destinationIndicator.visible = true;
    this.invalidate();
  }

  pointerUp(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.controls.enabled = true; this.canvas.classList.remove('dragging'); this.suppressClick = true; setTimeout(() => { this.suppressClick = false; }, 0);
    if (!this.drag.moved) { const selectedId = this.drag.cell.id; this.canvas.dataset.lastInteraction = `select:${selectedId}`; this.cancelMove(); this.onSelect?.(selectedId, { shiftKey: event.shiftKey }); return; }
    if (!this.drag.valid) { this.canvas.dataset.lastInteraction = `cancel:${this.drag.cell.id}`; this.cancelMove(); return; }
    const pending = this.drag; this.drag = null; this.originIndicator.visible = false; this.destinationIndicator.visible = false; this.dragShadow.visible = false; this.dragGuide.visible = false;
    const accepted = this.onMove?.(pending.cell.id, pending.candidate.q, pending.candidate.r);
    this.canvas.dataset.lastInteraction = `${accepted ? 'commit' : 'reject'}:${pending.cell.id}`;
    if (!accepted) this.setInstancePosition(pending.mesh, pending.index, pending.origin);
    this.controls.enabled = true; this.canvas.classList.remove('dragging'); this.invalidate();
  }

  cancelMove(event) {
    if (!this.drag || (event?.pointerId != null && event.pointerId !== this.drag.pointerId)) return false;
    const pointerId = this.drag.pointerId;
    if (this.drag) this.setInstancePosition(this.drag.mesh, this.drag.index, this.drag.origin);
    this.drag = null;
    if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    if (this.originIndicator) this.originIndicator.visible = false; if (this.destinationIndicator) this.destinationIndicator.visible = false; if (this.dragShadow) this.dragShadow.visible = false; if (this.dragGuide) this.dragGuide.visible = false;
    this.controls.enabled = !this.clusterDrag; this.canvas.classList.remove('dragging'); this.invalidate();
    return true;
  }

  cancelClusterMove(event) {
    if (!this.clusterDrag || (event?.pointerId != null && event.pointerId !== this.clusterDrag.pointerId)) return false;
    const pending = this.clusterDrag;
    this.clusterDrag = null;
    this.suppressClusterClick = true;
    setTimeout(() => { this.suppressClusterClick = false; }, 0);
    this.controls.enabled = !this.drag;
    this.canvas.dataset.lastInteraction = `cluster-cancel:${pending.id}`;
    if (pending.moved) this.rebuild();
    this.invalidate();
    return true;
  }

  cancelAllMoves(event) {
    if (this.drag && (event?.pointerId == null || event.pointerId === this.drag.pointerId)) this.canvas.dataset.lastInteraction = `cancel:${this.drag.cell.id}`;
    const cellCancelled = this.cancelMove(event);
    const clusterCancelled = this.cancelClusterMove(event);
    if (!this.drag && !this.clusterDrag) this.controls.enabled = true;
    return cellCancelled || clusterCancelled;
  }

  pick(event) {
    if (!this.active || this.suppressClick) return;
    if (this.tool === 'add') {
      const point = this.pointerGround(event, new THREE.Vector3());
      if (point) this.onAdd?.(worldAxial(point.x, point.z));
      return;
    }
    const hit = this.hitAt(event);
    const cell = hit?.object?.userData?.cells?.[hit.instanceId];
    if (cell) this.onSelect?.(cell.id, { shiftKey: event.shiftKey });
  }

  resetCamera() {
    const compact = innerWidth < 700;
    this.camera.position.set(compact ? 0 : -1.6, compact ? 23 : 24, compact ? 24 : 18);
    this.camera.zoom = compact ? .46 : innerWidth < 1100 ? .5 : .62;
    this.camera.lookAt(0, 0, 0); this.camera.updateProjectionMatrix();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const focalViewport = this.isFocalViewport();
    const fitModeChanged = focalViewport !== this.focalViewport;
    this.focalViewport = focalViewport;
    const height = 17; const aspect = rect.width / rect.height;
    this.camera.left = -height * aspect / 2; this.camera.right = height * aspect / 2; this.camera.top = height / 2; this.camera.bottom = -height / 2;
    this.controls.minZoom = this.minimumZoom();
    if (this.camera.zoom < this.controls.minZoom) this.camera.zoom = this.controls.minZoom;
    this.camera.updateProjectionMatrix(); this.renderer.setSize(rect.width, rect.height, false);
    if (this.map && this.compactLayout !== (innerWidth < 700)) { this.rebuild(); this.invalidate(); return; }
    if (this.map && fitModeChanged) this.centerCameraOnMap();
    if (this.map) this.fitCameraToMap(); this.invalidate();
  }

  centerCameraOnMap() {
    if (!this.map?.hexagons?.length) return;
    const cells = this.focusCells();
    const box = new THREE.Box3(); cells.forEach((cell) => box.expandByPoint(this.cellPosition(cell, 0)));
    const center = box.getCenter(new THREE.Vector3()); center.y = 0;
    if (innerWidth >= 700 && !this.isFocalViewport()) center.z -= 2;
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.copy(center); this.camera.position.copy(center).add(offset); this.camera.lookAt(center); this.controls.update();
  }

  fitCameraToMap() {
    if (!this.map?.hexagons?.length) return;
    this.camera.updateMatrixWorld(); this.camera.updateProjectionMatrix();
    let maxX = .01; let maxY = .01;
    const focalViewport = this.isFocalViewport();
    for (const cell of this.focusCells()) {
      const projected = this.cellPosition(cell, .2).project(this.camera);
      maxX = Math.max(maxX, Math.abs(projected.x)); maxY = Math.max(maxY, Math.abs(projected.y));
    }
    const compact = innerWidth < 700;
    const factor = Math.min((compact ? .76 : focalViewport ? .72 : .88) / maxX, (compact ? .68 : focalViewport ? .5 : .76) / maxY);
    if (Number.isFinite(factor) && Math.abs(factor - 1) > .01) {
      this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, this.minimumZoom(), focalViewport ? 1.45 : .9);
      this.camera.updateProjectionMatrix();
    }
    this.canvas.dataset.fitMode = focalViewport ? 'focal' : 'overview';
    this.canvas.parentElement.dataset.fitMode = focalViewport ? 'focal' : 'overview';
    const note = this.canvas.parentElement.querySelector('.three-mode-note');
    if (note) note.textContent = focalViewport
      ? 'Território em foco · use Buscar para navegar'
      : 'Visualização 3D conectada ao mesmo mapa local-first';
  }

  updateLabels() {
    const pixelsPerWorldUnit = this.canvas.clientHeight * this.camera.zoom / (this.camera.top - this.camera.bottom);
    const tilePixels = SIZE * 1.75 * pixelsPerWorldUnit;
    const focalViewport = this.isFocalViewport();
    const focusClusterId = this.focusClusterId();
    const denseOverview = !focalViewport && this.map.hexagons.length > 96;
    this.canvas.dataset.labelLod = denseOverview ? 'cluster-priority' : 'all';
    this.canvas.parentElement.dataset.labelLod = this.canvas.dataset.labelLod;
    for (const label of this.labels.children) {
      const isCluster = Boolean(label.dataset.cluster);
      const isRelation = Boolean(label.dataset.relation);
      const relation = isRelation ? this.map.relations.find((item) => item.id === label.dataset.relation) : null;
      const cell = !isCluster && !isRelation ? this.map.hexagons.find((item) => item.id === label.dataset.cell) : null;
      const dragging = Boolean(cell && this.drag?.cell.id === cell.id);
      let p;
      if (isCluster) p = this.center(label.dataset.cluster);
      else if (isRelation) {
        const start = this.endpointPosition(relation.source); const end = this.endpointPosition(relation.target);
        if (!start || !end) { label.style.opacity = '0'; continue; }
        const index = this.map.relations.indexOf(relation); const dx = end.x - start.x; const dz = end.z - start.z; const length = Math.hypot(dx, dz) || 1;
        p = start.clone().lerp(end, .5); p.x += -dz / length * (index % 2 ? .34 : -.34); p.z += dx / length * (index % 2 ? .34 : -.34); p.y = .42;
      } else p = dragging ? this.drag.position.clone() : this.capPosition(cell).add(new THREE.Vector3(0, .055, 0));
      const previewClusterId = isCluster ? label.dataset.cluster : cell?.clusterId;
      const inFocalTerritory = !focalViewport || (!isRelation && previewClusterId === focusClusterId);
      const relationIndex = isRelation ? this.map.relations.indexOf(relation) : -1;
      const relationStep = Math.max(1, Math.ceil(this.map.relations.length / 8));
      const priorityRelation = !isRelation || relationIndex % relationStep === 0 || relation?.id === this.selectedRelationId;
      const inLabelLod = !denseOverview || (cell ? this.mobilePriorityCells.has(cell.id) || cell.id === this.selectedId || this.multiSelectedIds.has(cell.id) : priorityRelation);
      const labelVisible = inFocalTerritory && inLabelLod;
      if (!labelVisible || isRelation) label.setAttribute('aria-hidden', 'true');
      else label.removeAttribute('aria-hidden');
      if (label.matches('button')) label.tabIndex = labelVisible ? 0 : -1;
      if (!labelVisible) { label.style.opacity = '0'; continue; }
      if (this.clusterDrag && this.clusterDrag.id === previewClusterId) p.add(axial(this.clusterDrag.delta.q, this.clusterDrag.delta.r, 0));
      if (isCluster) p.y = .6;
      p.project(this.camera);
      let left = (p.x * .5 + .5) * this.canvas.clientWidth; let top = (-p.y * .5 + .5) * this.canvas.clientHeight + (isCluster ? (focalViewport ? -42 : innerWidth < 700 ? -30 : -68) : 0);
      const mobileClusterVisible = !isCluster || innerWidth >= 700 || (Math.abs(p.x) < 1.04 && Math.abs(p.y) < 1.04);
      if (isCluster && focalViewport && innerWidth < 700) {
        left = this.canvas.clientWidth / 2;
        top = 38;
        label.dataset.position = 'pinned';
      } else if (isCluster) delete label.dataset.position;
      if (isCluster && innerWidth < 700 && label.dataset.position !== 'pinned') { const halfWidth = Math.max(72, label.offsetWidth / 2 + 8); left = THREE.MathUtils.clamp(left, halfWidth, this.canvas.clientWidth - halfWidth); top = THREE.MathUtils.clamp(top, 222, this.canvas.clientHeight - 120); }
      if (isCluster && label.dataset.position !== 'pinned') top -= focalViewport ? 12 : innerWidth < 700 ? 10 : 28;
      if (isCluster) {
        const halfWidth = label.offsetWidth / 2 + 8;
        const halfHeight = label.offsetHeight / 2 + 8;
        left = THREE.MathUtils.clamp(left, halfWidth, this.canvas.clientWidth - halfWidth);
        top = THREE.MathUtils.clamp(top, halfHeight, this.canvas.clientHeight - halfHeight);
      }
      label.style.left = `${left}px`; label.style.top = `${top}px`;
      if (isCluster) label.style.opacity = mobileClusterVisible ? '1' : '0';
      if (isRelation) label.style.opacity = innerWidth < 700 ? '.88' : '1';
      if (!isCluster && !isRelation) {
        const labelWidth = THREE.MathUtils.clamp(tilePixels * .82, innerWidth < 700 ? 27 : 42, 90);
        const labelHeight = THREE.MathUtils.clamp(tilePixels * .34, innerWidth < 700 ? 14 : 20, 38);
        const minimumFontSize = innerWidth < 700 ? 2.8 : 2.8;
        let fontSize = THREE.MathUtils.clamp(tilePixels * .16, innerWidth < 700 ? 5.2 : 6.2, 10.5);
        label.style.width = `${labelWidth}px`;
        label.style.height = `${labelHeight}px`;
        label.style.fontSize = `${fontSize}px`;
        label.style.lineHeight = '1';
        for (let attempt = 0; attempt < 6 && label.scrollWidth > label.clientWidth + 1; attempt += 1) {
          const ratio = (label.clientWidth - 2) / Math.max(label.scrollWidth, 1);
          fontSize = Math.max(minimumFontSize, fontSize * Math.min(.94, ratio));
          label.style.fontSize = `${fontSize}px`;
        }
        label.style.opacity = '1';
      }
    }
    if (innerWidth < 700) this.resolveMobileLabelCollisions();
    this.resolveEditorialLabelCollisions();
    if (focalViewport) {
      for (const label of this.labels.querySelectorAll('.three-cluster-label:not([aria-hidden="true"])')) {
        label.style.top = `${THREE.MathUtils.clamp(Number.parseFloat(label.style.top), 28, this.canvas.clientHeight - 28)}px`;
      }
    }
  }

  resolveMobileLabelCollisions() {
    const labels = [...this.labels.querySelectorAll('.three-cluster-label')].filter((label) => label.style.opacity !== '0').sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const placed = [];
    for (const label of labels) {
      let attempts = 0; let rect = label.getBoundingClientRect();
      while (attempts < 6) {
        const collision = placed.find((other) => rect.left < other.right + 6 && rect.right > other.left - 6 && rect.top < other.bottom + 4 && rect.bottom > other.top - 4);
        if (!collision) break;
        const nextTop = Math.min(this.canvas.clientHeight - 112, Number.parseFloat(label.style.top) + collision.bottom - rect.top + 8);
        label.style.top = `${nextTop}px`; rect = label.getBoundingClientRect(); attempts += 1;
      }
      placed.push(rect);
    }
  }

  resolveEditorialLabelCollisions() {
    const visible = (selector) => [...this.labels.querySelectorAll(selector)].filter((label) => label.style.opacity !== '0');
    const intersects = (a, b, gap = 3) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
    const cells = visible('.three-cell-label').map((label) => label.getBoundingClientRect());
    const clusters = visible('.three-cluster-label').sort((a, b) => {
      const ar = a.getBoundingClientRect(); const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    });
    const clusterRects = [];
    if (innerWidth >= 700) {
      const clusterOffsets = [[0,0],[0,-22],[0,22],[0,-44],[0,44],[-28,0],[28,0],[-28,-22],[28,-22],[-28,22],[28,22],[0,66],[0,-66]];
      for (const label of clusters) {
        const originLeft = Number.parseFloat(label.style.left); const originTop = Number.parseFloat(label.style.top);
        let best = { score: Number.POSITIVE_INFINITY, dx: 0, dy: 0 };
        for (const [dx, dy] of clusterOffsets) {
          const halfWidth = label.offsetWidth / 2 + 8; const halfHeight = label.offsetHeight / 2 + 8;
          label.style.left = `${THREE.MathUtils.clamp(originLeft + dx, halfWidth, this.canvas.clientWidth - halfWidth)}px`;
          label.style.top = `${THREE.MathUtils.clamp(originTop + dy, halfHeight, this.canvas.clientHeight - halfHeight)}px`;
          const rect = label.getBoundingClientRect();
          const clusterCollisions = clusterRects.reduce((total, other) => total + (intersects(rect, other, 6) ? 1 : 0), 0);
          const cellCollisions = cells.reduce((total, other) => total + (intersects(rect, other, 4) ? 1 : 0), 0);
          const score = clusterCollisions * 10000 + cellCollisions * 1000 + Math.hypot(dx, dy);
          if (score < best.score) best = { score, dx, dy };
        }
        const halfWidth = label.offsetWidth / 2 + 8; const halfHeight = label.offsetHeight / 2 + 8;
        label.style.left = `${THREE.MathUtils.clamp(originLeft + best.dx, halfWidth, this.canvas.clientWidth - halfWidth)}px`;
        label.style.top = `${THREE.MathUtils.clamp(originTop + best.dy, halfHeight, this.canvas.clientHeight - halfHeight)}px`;
        clusterRects.push(label.getBoundingClientRect());
      }
    } else {
      clusterRects.push(...clusters.map((label) => label.getBoundingClientRect()));
    }
    const placed = [];
    const offsets = [[0,0],[0,-18],[0,18],[-24,0],[24,0],[-18,-15],[18,15],[-18,15],[18,-15],[0,-32],[0,32],[-38,0],[38,0],[-30,-24],[30,24],[-30,24],[30,-24],[0,-50],[0,50],[-48,-42],[48,-42],[-48,42],[48,42],[-64,-30],[64,-30],[-64,30],[64,30],[0,-68],[0,68],[0,86],[0,104]];
    for (const label of visible('.three-relation-label')) {
      const originLeft = Number.parseFloat(label.style.left); const originTop = Number.parseFloat(label.style.top);
      let best = { score: Number.POSITIVE_INFINITY, dx: 0, dy: 0 };
      for (const [dx, dy] of offsets) {
        label.style.left = `${originLeft + dx}px`; label.style.top = `${originTop + dy}px`;
        const rect = label.getBoundingClientRect();
        const cellCollisions = cells.reduce((total, other) => total + (intersects(rect, other, 3) ? 1 : 0), 0);
        const clusterCollisions = clusterRects.reduce((total, other) => total + (intersects(rect, other, 5) ? 1 : 0), 0);
        const relationCollisions = placed.reduce((total, other) => total + (intersects(rect, other, 5) ? 1 : 0), 0);
        const outside = rect.left < 5 || rect.right > innerWidth - 5 || rect.top < 92 || rect.bottom > innerHeight - 72;
        const score = (relationCollisions + clusterCollisions) * 10000 + cellCollisions * 1000 + (outside ? 500 : 0) + Math.hypot(dx, dy);
        if (score < best.score) best = { score, dx, dy };
      }
      label.style.left = `${originLeft + best.dx}px`; label.style.top = `${originTop + best.dy}px`;
      placed.push(label.getBoundingClientRect());
    }
  }

  invalidate() {
    if (this.disposed || !this.active || this.frame) return;
    const queuedAt = performance.now();
    this.frame = requestAnimationFrame(() => {
      const startedAt = performance.now(); this.frame = 0; this.controls.update(); this.canvas.dataset.cameraZoom = this.camera.zoom.toFixed(3); this.updateLabels(); this.renderer.render(this.scene, this.camera);
      if (!this.canvas.dataset.firstRenderMs) this.canvas.dataset.firstRenderMs = (performance.now() - (this.activationStartedAt || this.startedAt)).toFixed(2);
      this.frameLatencies.push(startedAt - queuedAt); this.renderDurations.push(performance.now() - startedAt);
      if (this.renderDurations.length > 120) { this.renderDurations.shift(); this.frameLatencies.shift(); }
      const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] || 0; };
      this.canvas.dataset.renderMsMedian = percentile(this.renderDurations, .5).toFixed(2); this.canvas.dataset.renderMsP95 = percentile(this.renderDurations, .95).toFixed(2); this.canvas.dataset.rafLatencyP95 = percentile(this.frameLatencies, .95).toFixed(2); this.canvas.dataset.renderSamples = String(this.renderDurations.length);
      this.canvas.dataset.renderCalls = String(this.renderer.info.render.calls); this.canvas.dataset.triangles = String(this.renderer.info.render.triangles); this.canvas.dataset.textures = String(this.renderer.info.memory.textures); this.canvas.dataset.dpr = this.renderer.getPixelRatio().toFixed(2);
    });
  }

  forceContextLossForQA() {
    this.renderer.forceContextLoss();
  }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.controls.removeEventListener('change', this.handleControlsChange); this.controls.dispose();
    for (const type of ['click', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'webglcontextlost', 'webglcontextrestored']) this.canvas.removeEventListener(type, this.handlers[type.replace('webgl', '')]);
    document.removeEventListener('visibilitychange', this.handlers.visibilitychange);
    document.removeEventListener('pointermove', this.handlers.clusterpointermove); document.removeEventListener('pointerup', this.handlers.clusterpointerup); document.removeEventListener('pointercancel', this.handlers.clusterpointercancel);
    window.removeEventListener('blur', this.handlers.cancel);
    this.scene.traverse((object) => { object.geometry?.dispose(); if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose()); else object.material?.dispose(); });
    this.labels.replaceChildren(); this.renderer.dispose(); this.renderer.forceContextLoss();
    for (const texture of [this.normalMap, this.fiberMap, this.roughnessMap, this.contactShadowMap, this.environmentMap]) texture?.dispose();
  }
}
