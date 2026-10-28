import * as THREE from 'three';
import type { PotStyle, SurfaceStyle } from '../game/pots';
import { potDims } from '../game/pots';
import { type TreeLayout, bezierPoint, frameAt, layoutBounds, radiusAt } from '../tree/layout';
import type { PrunePreview } from '../tree/ops';
import { SPECIES, seasonOf } from '../tree/species';
import type { BranchId, TreeState } from '../tree/types';
import type { V3 } from '../tree/vec';
import { buildBarkGeometry, buildWireGeometry } from './barkMesh';
import { CameraRig } from './camera';
import { type FoliageCluster, type FoliageMesh, buildFoliage, foliageClusters, highlightFoliage } from './foliage';
import { buildMarks } from './marks';
import { buildPot } from './potMesh';
import { barkTexture, radialTexture } from './textures';

export interface SceneInput {
  tree: TreeState;
  layout: TreeLayout;
  pot: PotStyle;
  surface: SurfaceStyle;
}

export interface Highlight {
  selected: BranchId | null;
  removal: PrunePreview | null;
  /** Visual tone of the selection shell. */
  tone: 'prune' | 'shape' | 'wire' | 'inspect';
}

export interface PickResult {
  branchId: BranchId;
  t: number;
}

export interface Background {
  id: string;
  name: string;
  /** CSS gradient for the live view. */
  css: string;
  /** Colour stops for exported portraits (top → bottom). */
  stops: [string, string];
  ink: string;
  unlock?: string;
}

export const BACKGROUNDS: Background[] = [
  { id: 'paper', name: 'Rice paper', css: 'radial-gradient(120% 90% at 50% 30%, #fbf7ee 0%, #f1eadb 60%, #e4dac6 100%)', stops: ['#fbf7ee', '#e2d7c2'], ink: '#2b2622' },
  { id: 'mist', name: 'Morning mist', css: 'linear-gradient(180deg, #e9eef0 0%, #dfe5e2 55%, #cfd6cf 100%)', stops: ['#eef2f3', '#cbd3cb'], ink: '#26302c' },
  { id: 'dusk', name: 'Late light', css: 'linear-gradient(180deg, #f3d9b9 0%, #e7c2a0 50%, #c99b82 100%)', stops: ['#f5dcbd', '#c39580'], ink: '#3a2219' },
  { id: 'ink', name: 'Ink', css: 'radial-gradient(120% 90% at 50% 30%, #3a3633 0%, #23201e 70%, #181614 100%)', stops: ['#3b3734', '#141211'], ink: '#f3ecdf', unlock: 'bg:ink' },
  { id: 'moss', name: 'Moss garden', css: 'linear-gradient(180deg, #dfe6cf 0%, #c3cfa6 60%, #9fae7c 100%)', stops: ['#e2e8d2', '#99a877'], ink: '#24301c', unlock: 'bg:moss' },
];

const VERMILION = new THREE.Color('#d2492f');
const GOLD = new THREE.Color('#f0cf6e');
const WIRE_COPPER = new THREE.Color('#b0663a');

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly container: HTMLElement;
  private treeGroup = new THREE.Group();
  private overlayGroup = new THREE.Group();
  private potGroup = new THREE.Group();
  private fxGroup = new THREE.Group();
  private barkMat: THREE.MeshStandardMaterial;
  private wireMat = new THREE.MeshStandardMaterial({ color: WIRE_COPPER, metalness: 0.65, roughness: 0.35 });
  private overlayMat = new THREE.MeshBasicMaterial({ color: VERMILION, transparent: true, opacity: 0.5, depthWrite: false });
  private ringMat = new THREE.MeshBasicMaterial({ color: VERMILION });
  private foliage: FoliageMesh | null = null;
  private clusters: FoliageCluster[] = [];
  private input: SceneInput | null = null;
  private highlight: Highlight = { selected: null, removal: null, tone: 'inspect' };
  private disposeTree: (() => void)[] = [];
  private disposePot: (() => void) | null = null;
  private potKey = '';
  private dirty = true;
  private raf = 0;
  private last = performance.now();
  private frameListeners = new Set<() => void>();
  private effects: { update(dt: number): boolean }[] = [];
  private slowFrames = 0;
  private dpr: number;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private ground: THREE.Mesh;
  private contact: THREE.Mesh;
  reducedMotion = false;
  cutRing: THREE.Mesh | null = null;

  static create(container: HTMLElement): Stage | null {
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
      if (!gl) return null;
      return new Stage(container);
    } catch {
      return null;
    }
  }

  private constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    this.rig = new CameraRig(1);
    this.barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });

    this.hemi = new THREE.HemisphereLight('#fff6e6', '#6b5a48', 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1dc', 2.3);
    this.sun.position.set(3.5, 7, 4.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -3.5;
    sc.right = 3.5;
    sc.top = 4.5;
    sc.bottom = -2;
    sc.near = 1;
    sc.far = 20;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun);
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.55);
    fill.position.set(-5, 3, -2);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight('#ffe4c4', 0.7);
    rim.position.set(-1, 4, -6);
    this.scene.add(rim);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.13 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.scene.add(this.contact);

    this.scene.add(this.treeGroup, this.overlayGroup, this.potGroup, this.fxGroup);
    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.disposers.push(() => ro.disconnect());
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    this.loop();
  }

  private disposers: (() => void)[] = [];
  onContextChange: ((lost: boolean) => void) | null = null;

  private onContextLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.raf);
    this.onContextChange?.(true);
  };

  private onContextRestored = () => {
    this.potKey = '';
    if (this.input) this.setScene(this.input, true);
    this.onContextChange?.(false);
    this.loop();
  };

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    // Narrow portrait screens need a little more distance to fit the tree.
    this.rig.camera.fov = w / h < 0.7 ? 34 : 30;
    this.rig.camera.updateProjectionMatrix();
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
  }

  onFrame(cb: () => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    let moving = this.rig.update(dt, this.reducedMotion);
    if (this.effects.length) {
      this.effects = this.effects.filter((e) => e.update(dt));
      moving = true;
    }
    if (moving || this.dirty) {
      this.renderer.render(this.scene, this.rig.camera);
      this.dirty = false;
      for (const cb of this.frameListeners) cb();
      this.adaptQuality(dt);
    }
  };

  /** Drop resolution on devices that can't keep up. */
  private adaptQuality(dt: number): void {
    if (dt > 0.034) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 40 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.resize();
      this.slowFrames = 0;
    }
  }

  // ---------------------------------------------------------------- scene

  setScene(input: SceneInput, force = false): void {
    const prev = this.input;
    this.input = input;
    if (force || !prev || prev.tree !== input.tree) this.rebuildTree();
    const potKey = JSON.stringify([input.pot, input.surface, input.tree.seed]);
    if (force || potKey !== this.potKey) {
      this.potKey = potKey;
      this.rebuildPot();
    }
    this.applyHighlight();
    this.invalidate();
  }

  /** Frame the camera to the current tree (used when opening a tree). */
  frameTree(immediate = false): void {
    if (!this.input) return;
    const b = layoutBounds(this.input.layout);
    const width = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
    const pot = potDims(this.input.pot);
    this.rig.setHome(Math.max(b.max[1], 1.5), Math.max(width, pot.width), pot.height + 0.15, this.rig.camera.aspect);
    this.rig.reset();
    if (immediate) {
      this.rig.pose = { ...this.rig.goal, target: [...this.rig.goal.target] };
      this.rig.apply();
    }
    this.invalidate();
  }

  private rebuildTree(): void {
    for (const d of this.disposeTree) d();
    this.disposeTree = [];
    this.treeGroup.clear();
    const input = this.input!;
    const sp = SPECIES[input.tree.species];
    const tex = barkTexture(sp);
    this.barkMat.map = tex;
    this.barkMat.bumpMap = tex;
    this.barkMat.bumpScale = sp.bark.furrow * 2.2;
    this.barkMat.color.set('#ffffff').multiplyScalar(1.3);
    this.barkMat.needsUpdate = true;

    const barkGeo = buildBarkGeometry(input.tree, input.layout, sp);
    const bark = new THREE.Mesh(barkGeo, this.barkMat);
    bark.castShadow = true;
    bark.receiveShadow = true;
    this.treeGroup.add(bark);
    this.disposeTree.push(() => barkGeo.dispose());

    this.clusters = foliageClusters(input.tree, input.layout, sp);
    this.foliage = buildFoliage(input.tree, this.clusters, sp, input.layout);
    this.treeGroup.add(this.foliage.object);
    const f = this.foliage;
    this.disposeTree.push(() => f.dispose());

    const wired = Object.values(input.tree.branches).filter((b) => b.wire).map((b) => b.id);
    const wireGeo = buildWireGeometry(input.tree, input.layout, wired);
    if (wireGeo) {
      const w = new THREE.Mesh(wireGeo, this.wireMat);
      w.castShadow = true;
      this.treeGroup.add(w);
      this.disposeTree.push(() => wireGeo.dispose());
    }
    const marks = buildMarks(input.tree, input.layout, sp);
    this.treeGroup.add(marks.group);
    this.disposeTree.push(() => marks.dispose());

    // Season shifts the light a touch.
    const season = seasonOf(input.tree.day);
    this.hemi.color.set(season === 'autumn' ? '#ffe9d0' : season === 'winter' ? '#eef2f7' : '#fff6e6');
    this.sun.color.set(season === 'autumn' ? '#ffdcb5' : season === 'winter' ? '#f2f5ff' : '#fff1dc');
  }

  private rebuildPot(): void {
    this.disposePot?.();
    this.potGroup.clear();
    const input = this.input!;
    const p = buildPot(input.pot, input.surface, input.tree.seed);
    this.potGroup.add(p.group);
    this.disposePot = p.dispose;
    const d = potDims(input.pot);
    const groundY = 0.05 - 0.02 - d.height - 0.08;
    this.ground.position.y = groundY;
    this.contact.position.y = groundY + 0.002;
    this.contact.scale.set(d.width * 1.5, d.depthZ * 1.7, 1);
  }

  setHighlight(h: Highlight): void {
    this.highlight = h;
    this.applyHighlight();
    this.invalidate();
  }

  private overlayDispose: (() => void)[] = [];

  private applyHighlight(): void {
    for (const d of this.overlayDispose) d();
    this.overlayDispose = [];
    this.overlayGroup.clear();
    this.cutRing = null;
    const input = this.input;
    if (!input) return;
    const { selected, removal, tone } = this.highlight;
    const sp = SPECIES[input.tree.species];
    const ids = new Set<BranchId>();
    const range = new Map<BranchId, [number, number]>();
    if (removal) {
      for (const id of removal.removed) ids.add(id);
      if (removal.shortened) {
        ids.add(removal.shortened.id);
        range.set(removal.shortened.id, [removal.shortened.t, 1]);
      }
    } else if (selected) {
      ids.add(selected);
    }
    if (this.foliage) {
      if (removal) highlightFoliage(this.foliage, new Set(removal.removed), VERMILION, 0.6);
      else highlightFoliage(this.foliage, selected ? new Set([selected]) : null, GOLD, 0.35);
    }
    if (!ids.size) return;
    const geo = buildBarkGeometry(input.tree, input.layout, sp, {
      include: (id) => ids.has(id),
      range,
      inflate: [1.12, 0.007],
      quality: 'low',
      plain: true,
    });
    this.overlayMat.color.copy(removal ? VERMILION : tone === 'wire' ? WIRE_COPPER : GOLD);
    this.overlayMat.opacity = removal ? 0.55 : 0.42;
    const mesh = new THREE.Mesh(geo, this.overlayMat);
    mesh.renderOrder = 2;
    this.overlayGroup.add(mesh);
    this.overlayDispose.push(() => geo.dispose());

    // A ring marks exactly where the blade will close.
    const cutId = removal?.shortened?.id ?? (removal && selected ? selected : null);
    if (cutId && input.layout.has(cutId)) {
      const l = input.layout.get(cutId)!;
      const t = removal?.shortened?.t ?? 0.02;
      const r = radiusAt(l, t);
      const ringGeo = new THREE.TorusGeometry(r * 1.35 + 0.008, Math.max(0.004, r * 0.16), 8, 28);
      const ring = new THREE.Mesh(ringGeo, this.ringMat);
      const f = frameAt(l, t);
      ring.position.set(...bezierPoint(l, t));
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...f.t));
      ring.renderOrder = 3;
      this.overlayGroup.add(ring);
      this.cutRing = ring;
      this.overlayDispose.push(() => ringGeo.dispose());
    }
  }

  // ---------------------------------------------------------------- effects

  /** The cut piece drops away and fades – the satisfying part of a snip. */
  playCut(before: SceneInput, preview: PrunePreview): void {
    if (this.reducedMotion) return;
    const sp = SPECIES[before.tree.species];
    const ids = new Set(preview.removed);
    const range = new Map<BranchId, [number, number]>();
    if (preview.shortened) {
      ids.add(preview.shortened.id);
      range.set(preview.shortened.id, [preview.shortened.t, 1]);
    }
    if (!ids.size) return;
    const geo = buildBarkGeometry(before.tree, before.layout, sp, { include: (id) => ids.has(id), range, quality: 'low' });
    const mat = this.barkMat.clone();
    mat.transparent = true;
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, mat));
    const clusters = foliageClusters(before.tree, before.layout, sp).filter((c) => preview.removed.includes(c.branchId));
    let fol: FoliageMesh | null = null;
    if (clusters.length) {
      fol = buildFoliage(before.tree, clusters, sp, before.layout);
      group.add(fol.object);
    }
    // Pivot around the cut point.
    const cutId = preview.shortened?.id ?? preview.removed[0]!;
    const l = before.layout.get(cutId);
    const pivot = l ? bezierPoint(l, preview.shortened?.t ?? 0) : ([0, 1, 0] as V3);
    const holder = new THREE.Group();
    holder.position.set(...pivot);
    group.position.set(-pivot[0], -pivot[1], -pivot[2]);
    holder.add(group);
    this.fxGroup.add(holder);
    const out = new THREE.Vector3(pivot[0], 0, pivot[2]).normalize().multiplyScalar(0.6);
    const vel = new THREE.Vector3(out.x, 0.6, out.z);
    const spinAxis = new THREE.Vector3(-out.z, 0, out.x).normalize();
    let age = 0;
    const floorY = this.ground.position.y + 0.1;
    const foliageMats = fol ? fol.meshes.map((m) => m.material as THREE.Material) : [];
    this.effects.push({
      update: (dt) => {
        age += dt;
        vel.y -= 6.5 * dt;
        holder.position.addScaledVector(vel, dt);
        if (holder.position.y < floorY) {
          holder.position.y = floorY;
          vel.multiplyScalar(0.3);
        }
        holder.rotateOnWorldAxis(spinAxis, dt * 2.2);
        const fade = Math.max(0, 1 - Math.max(0, age - 0.35) / 0.55);
        mat.opacity = fade;
        holder.scale.setScalar(0.9 + 0.1 * fade);
        if (age > 0.9) {
          this.fxGroup.remove(holder);
          geo.dispose();
          mat.dispose();
          fol?.dispose();
          void foliageMats;
          return false;
        }
        return true;
      },
    });
    this.invalidate();
  }

  /** Brief pulse on a branch – feedback for wire/shape confirmation. */
  pulse(id: BranchId): void {
    if (this.reducedMotion || !this.input) return;
    const input = this.input;
    const sp = SPECIES[input.tree.species];
    const geo = buildBarkGeometry(input.tree, input.layout, sp, { include: (x) => x === id, inflate: [1.2, 0.01], quality: 'low', plain: true });
    const mat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.6, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    this.fxGroup.add(mesh);
    let age = 0;
    this.effects.push({
      update: (dt) => {
        age += dt;
        mat.opacity = 0.6 * Math.max(0, 1 - age / 0.5);
        if (age >= 0.5) {
          this.fxGroup.remove(mesh);
          geo.dispose();
          mat.dispose();
          return false;
        }
        return true;
      },
    });
  }

  // ---------------------------------------------------------------- projection & picking

  project(p: V3): { x: number; y: number; depth: number; visible: boolean } {
    const v = new THREE.Vector3(...p).project(this.rig.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const camPos = this.rig.camera.position;
    const depth = camPos.distanceTo(new THREE.Vector3(...p));
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, depth, visible: v.z < 1 && v.z > -1 };
  }

  private pxPerWorld(depth: number): number {
    const h = this.container.clientHeight;
    return h / (2 * Math.tan((this.rig.camera.fov * Math.PI) / 360) * Math.max(depth, 0.01));
  }

  /**
   * Screen-space picking: generous on touch, prefers the nearest surface, and
   * treats a tap on a foliage pad as a tap on the branch that carries it.
   */
  pick(x: number, y: number, tolerance: number): PickResult | null {
    const input = this.input;
    if (!input) return null;
    type Cand = { id: BranchId; t: number; eff: number; depth: number };
    const cands: Cand[] = [];
    const N = 12;
    for (const [id, l] of input.layout) {
      let prev = this.project(bezierPoint(l, 0));
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const cur = this.project(bezierPoint(l, t));
        if (!prev.visible || !cur.visible) {
          prev = cur;
          continue;
        }
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        const len2 = dx * dx + dy * dy;
        const u = len2 > 1e-6 ? Math.max(0, Math.min(1, ((x - prev.x) * dx + (y - prev.y) * dy) / len2)) : 0;
        const px = prev.x + dx * u;
        const py = prev.y + dy * u;
        const d = Math.hypot(x - px, y - py);
        const tt = (i - 1 + u) / N;
        const depth = prev.depth + (cur.depth - prev.depth) * u;
        const rpx = radiusAt(l, tt) * this.pxPerWorld(depth);
        const eff = Math.max(0, d - rpx);
        if (eff <= tolerance) cands.push({ id, t: tt, eff, depth });
        prev = cur;
      }
    }
    for (const c of this.clusters) {
      const s = this.project(c.pos);
      if (!s.visible) continue;
      const rpx = c.size * 1.2 * this.pxPerWorld(s.depth);
      const d = Math.hypot(x - s.x, y - s.y);
      if (d <= rpx) cands.push({ id: c.branchId, t: 1, eff: 2 + (d / rpx) * 2, depth: s.depth });
    }
    if (!cands.length) return null;
    const direct = cands.filter((c) => c.eff <= 4);
    const pool = direct.length ? direct : cands;
    pool.sort((a, b) => (direct.length ? a.depth - b.depth : a.eff - b.eff || a.depth - b.depth));
    const best = pool[0]!;
    return { branchId: best.id, t: best.t };
  }

  /** Closest curve parameter on one branch to a screen point (for dragging the cut marker). */
  nearestT(id: BranchId, x: number, y: number): number {
    const l = this.input?.layout.get(id);
    if (!l) return 0;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const s = this.project(bezierPoint(l, t));
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** Convert a screen point to a world point on the camera-facing plane through `anchor`. */
  unproject(x: number, y: number, anchor: V3): V3 {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const ndc = new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.rig.camera);
    const normal = new THREE.Vector3();
    this.rig.camera.getWorldDirection(normal);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...anchor));
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return anchor;
    return [hit.x, hit.y, hit.z];
  }

  // ---------------------------------------------------------------- capture

  /**
   * Render a clean portrait (no UI, no selection) onto a painted background
   * with a small typographic caption.
   */
  async capture(opts: {
    width: number;
    height: number;
    background: Background;
    caption?: { title: string; lines: string[] };
  }): Promise<Blob | null> {
    const { width, height, background, caption } = opts;
    const savedHighlight = this.highlight;
    this.overlayGroup.visible = false;
    this.fxGroup.visible = false;
    if (this.foliage) highlightFoliage(this.foliage, null, GOLD, 0);
    const oldSize = new THREE.Vector2();
    this.renderer.getSize(oldSize);
    const oldDpr = this.renderer.getPixelRatio();
    const oldAspect = this.rig.camera.aspect;
    const shadowSize = this.sun.shadow.mapSize.x;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.rig.camera.aspect = width / height;
      this.rig.camera.updateProjectionMatrix();
      this.rig.pose = { ...this.rig.goal, target: [...this.rig.goal.target] };
      this.rig.apply();
      this.renderer.render(this.scene, this.rig.camera);
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const g = out.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, background.stops[0]);
      grad.addColorStop(1, background.stops[1]);
      g.fillStyle = grad;
      g.fillRect(0, 0, width, height);
      // Soft vignette.
      const vig = g.createRadialGradient(width / 2, height * 0.42, height * 0.2, width / 2, height * 0.5, height * 0.8);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.12)');
      g.fillStyle = vig;
      g.fillRect(0, 0, width, height);
      g.drawImage(this.renderer.domElement, 0, 0, width, height);
      if (caption) {
        const pad = Math.round(width * 0.07);
        g.fillStyle = background.ink;
        g.textBaseline = 'alphabetic';
        g.font = `600 ${Math.round(width * 0.052)}px "Fraunces", Georgia, serif`;
        g.fillText(caption.title, pad, height - pad - Math.round(width * 0.05) * caption.lines.length);
        g.font = `500 ${Math.round(width * 0.026)}px "Inter", system-ui, sans-serif`;
        g.globalAlpha = 0.72;
        caption.lines.forEach((line, i) => {
          g.fillText(line, pad, height - pad - Math.round(width * 0.05) * (caption.lines.length - 1 - i) + Math.round(width * 0.012));
        });
        g.globalAlpha = 0.55;
        g.font = `600 ${Math.round(width * 0.02)}px "Inter", system-ui, sans-serif`;
        const mark = 'BONSAI · THE STUDIO';
        g.fillText(mark, width - pad - g.measureText(mark).width, pad + Math.round(width * 0.02));
        g.globalAlpha = 1;
      }
      return await new Promise<Blob | null>((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
    } finally {
      this.renderer.setPixelRatio(oldDpr);
      this.renderer.setSize(oldSize.x, oldSize.y, false);
      this.rig.camera.aspect = oldAspect;
      this.rig.camera.updateProjectionMatrix();
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      this.overlayGroup.visible = true;
      this.fxGroup.visible = true;
      this.highlight = savedHighlight;
      this.applyHighlight();
      this.invalidate();
    }
  }

  /** Small JPEG thumbnail of the current view for collection cards. */
  async thumbnail(size = 360): Promise<string | null> {
    const blob = await this.capture({ width: size, height: Math.round(size * 1.25), background: BACKGROUNDS[0]! });
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    return c.toDataURL('image/jpeg', 0.78);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const d of this.disposeTree) d();
    for (const d of this.overlayDispose) d();
    for (const d of this.disposers) d();
    this.disposePot?.();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
