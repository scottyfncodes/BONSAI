import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { advanceOnboarding, commitFrom, previewWork, selectBranch, setCutT, setDragging } from '../app/actions';
import { onFx, view } from '../app/bus';
import { getState } from '../app/store';
import { sound } from '../audio/sound';
import type { Workpiece } from '../game/model';
import { Stage } from '../render/stage';
import { bezierPoint, computeLayout, type TreeLayout } from '../tree/layout';
import { MIN_SHORTEN_T, aimTip, curveTo, holdFraction, lerpShape, normaliseCutT, previewPrune, releaseShape } from '../tree/ops';
import { seasonOf } from '../tree/species';
import type { BranchId } from '../tree/types';
import type { V3 } from '../tree/vec';
import { IconShears } from './icons';

export interface ViewportProps {
  work: Workpiece;
  interactive: boolean;
  selected?: BranchId | null;
  tool?: string;
  cutT?: number;
  silhouette?: boolean;
  turntable?: boolean;
  /** CSS background override (portrait backdrops). */
  background?: string;
  /** A handle drag is in progress: render coarser for speed. */
  dragging?: boolean;
  /** Where the tree sits on screen (see CameraRig.framing). */
  framing?: { center: number; fill: number };
  onStage?: (stage: Stage | null) => void;
  children?: ReactNode;
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TreeViewport(props: ViewportProps) {
  const { work, interactive, selected = null, tool = 'view', cutT = 0, silhouette = false, turntable = false, dragging = false } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [status, setStatus] = useState<'ok' | 'unavailable' | 'lost'>('ok');
  const framed = useRef(false);
  const layout = useMemo(() => computeLayout(work.tree), [work.tree]);
  const layoutRef = useRef<TreeLayout>(layout);
  layoutRef.current = layout;
  const onStage = props.onStage;
  // Framing is fixed for the lifetime of a viewport; read it once at mount.
  const framingRef = useRef(props.framing);

  // --- Create / dispose the 3D stage.
  useEffect(() => {
    const host = hostRef.current!;
    const stage = Stage.create(host);
    if (!stage) {
      setStatus('unavailable');
      return;
    }
    stage.reducedMotion = reducedMotion();
    if (framingRef.current) stage.rig.framing = framingRef.current;
    stage.onContextChange = (lost) => setStatus(lost ? 'lost' : 'ok');
    stageRef.current = stage;
    onStage?.(stage);
    const offFrame = stage.onFrame(() => view.setYaw(stage.rig.pose.yaw));
    return () => {
      offFrame();
      onStage?.(null);
      stage.dispose();
      stageRef.current = null;
      framed.current = false;
    };
  }, [onStage]);

  // --- Keep the scene in sync with the work.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.interactiveQuality = dragging;
    stage.setScene({ tree: work.tree, layout, pot: work.pot, surface: work.surface });
    if (!framed.current) {
      stage.frameTree(true);
      framed.current = true;
    }
  }, [work, layout, dragging]);

  // --- Selection / prune preview.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const valid = selected && work.tree.branches[selected] ? selected : null;
    const removal = valid && tool === 'prune' ? previewPrune(work.tree, valid, cutT) : null;
    stage.setHighlight({
      selected: valid,
      removal,
      tone: tool === 'prune' ? 'prune' : tool === 'wire' ? 'wire' : tool === 'shape' ? 'shape' : 'inspect',
    });
  }, [selected, tool, cutT, work.tree]);

  useEffect(() => {
    stageRef.current?.setSilhouette(silhouette);
  }, [silhouette, work]);

  useEffect(() => {
    stageRef.current?.setTurntable(turntable);
  }, [turntable]);

  // --- One-shot effects from actions.
  useEffect(
    () =>
      onFx((e) => {
        const stage = stageRef.current;
        if (!stage) return;
        if (e.type === 'cut') stage.playCut(e.before, e.preview);
        else if (e.type === 'pulse') stage.pulse(e.id);
        else if (e.type === 'resetCamera') stage.frameTree(false);
        else if (e.type === 'frame') {
          framed.current = false;
          stage.frameTree(false);
          framed.current = true;
        } else if (e.type === 'orbit') stage.rig.orbit(e.yaw, e.pitch);
        else if (e.type === 'zoom') stage.rig.zoom(e.factor);
        stage.invalidate();
      }),
    [],
  );

  // --- Camera & tap gestures.
  useEffect(() => {
    const host = hostRef.current!;
    type Pt = { x: number; y: number; sx: number; sy: number; t: number };
    const pts = new Map<number, Pt>();
    let mode: 'none' | 'tap' | 'orbit' | 'pinch' | 'pan' = 'none';
    let pinch = { d: 0, cx: 0, cy: 0 };
    let lastMove = 0;
    let vYaw = 0;
    let lastTap = 0;

    const local = (e: PointerEvent | WheelEvent) => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pinchInfo = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 };
    };

    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.handle')) return;
      const stage = stageRef.current;
      if (!stage) return;
      sound.unlock();
      host.setPointerCapture(e.pointerId);
      const p = local(e);
      pts.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now() });
      stage.rig.spin = 0;
      if (pts.size === 1) mode = e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'tap';
      else if (pts.size === 2) {
        mode = 'pinch';
        pinch = pinchInfo();
      }
    };

    const move = (e: PointerEvent) => {
      const pt = pts.get(e.pointerId);
      const stage = stageRef.current;
      if (!pt || !stage) return;
      const p = local(e);
      const dx = p.x - pt.x;
      const dy = p.y - pt.y;
      pt.x = p.x;
      pt.y = p.y;
      const now = performance.now();
      if (mode === 'tap' && Math.hypot(p.x - pt.sx, p.y - pt.sy) > (e.pointerType === 'touch' ? 9 : 5)) {
        mode = 'orbit';
        if (getState().studio?.turntable === false) stage.setTurntable(false);
      }
      if (mode === 'orbit') {
        stage.rig.orbit(-dx * 0.0085, dy * 0.006);
        const dt = Math.max(1, now - lastMove);
        vYaw = vYaw * 0.6 + ((-dx * 0.0085) / dt) * 1000 * 0.4;
        lastMove = now;
        advanceOnboarding(3);
      } else if (mode === 'pan') {
        stage.rig.pan(dx, dy, host.clientHeight);
      } else if (mode === 'pinch' && pts.size === 2) {
        const info = pinchInfo();
        if (pinch.d > 0 && info.d > 0) stage.rig.zoom(pinch.d / info.d);
        stage.rig.pan(info.cx - pinch.cx, info.cy - pinch.cy, host.clientHeight);
        pinch = info;
      }
      stage.invalidate();
    };

    const up = (e: PointerEvent) => {
      const pt = pts.get(e.pointerId);
      const stage = stageRef.current;
      pts.delete(e.pointerId);
      if (!pt || !stage) return;
      const now = performance.now();
      if (mode === 'tap' && now - pt.t < 600 && interactive) {
        const hit = stage.pick(pt.sx, pt.sy, e.pointerType === 'touch' ? 26 : 12);
        if (hit) selectBranch(hit.branchId, hit.t);
        else {
          if (now - lastTap < 320) stage.rig.reset();
          lastTap = now;
          selectBranch(null);
        }
      } else if (mode === 'orbit' && now - lastMove < 80 && !reducedMotion()) {
        stage.rig.spin = Math.max(-4, Math.min(4, vYaw));
      }
      if (pts.size === 0) mode = 'none';
      else if (mode === 'pinch') mode = 'none'; // don't jump into orbit with the remaining finger
    };

    const wheel = (e: WheelEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      e.preventDefault();
      stage.rig.zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      stage.invalidate();
    };
    const ctx = (e: Event) => e.preventDefault();

    host.addEventListener('pointerdown', down);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
    host.addEventListener('wheel', wheel, { passive: false });
    host.addEventListener('contextmenu', ctx);
    return () => {
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
      host.removeEventListener('wheel', wheel);
      host.removeEventListener('contextmenu', ctx);
    };
  }, [interactive]);

  const season = seasonOf(work.tree.day);
  return (
    <div
      ref={hostRef}
      className={`viewport season-${season}${silhouette ? ' silhouette' : ''}`}
      style={props.background ? { background: props.background } : undefined}
      data-testid="viewport"
    >
      {status !== 'ok' && (
        <div className="fallback" role="alert">
          <div>
            <h2>{status === 'lost' ? 'Restoring the view…' : 'This browser can’t show 3D right now'}</h2>
            <p>
              {status === 'lost'
                ? 'The graphics context was reset by the system. Your tree is safe.'
                : 'BONSAI needs WebGL. Try enabling hardware acceleration or updating your browser. Your trees are saved and will be here when you return.'}
            </p>
          </div>
        </div>
      )}
      {interactive && status === 'ok' && (
        <Handles stageRef={stageRef} layoutRef={layoutRef} work={work} selected={selected} tool={tool} cutT={cutT} />
      )}
      {props.children}
    </div>
  );
}

// ---------------------------------------------------------------- handles

interface HandleProps {
  stageRef: React.RefObject<Stage | null>;
  layoutRef: React.RefObject<TreeLayout>;
  work: Workpiece;
  selected: BranchId | null;
  tool: string;
  cutT: number;
}

function Handles({ stageRef, layoutRef, work, selected, tool, cutT }: HandleProps) {
  const tipRef = useRef<HTMLButtonElement>(null);
  const midRef = useRef<HTMLButtonElement>(null);
  const cutRef = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState<'tip' | 'mid' | 'cut' | null>(null);
  const [resist, setResist] = useState(false);
  const branch = selected ? work.tree.branches[selected] : undefined;
  const showShape = !!branch && (tool === 'shape' || (tool === 'wire' && !!branch.wire));
  const showCut = !!branch && tool === 'prune';
  const effT = selected ? normaliseCutT(work.tree, selected, cutT) : 0;
  const cutTRef = useRef(effT);
  cutTRef.current = effT;

  // Position handles every rendered frame (no React re-render).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !selected) return;
    const place = (el: HTMLElement | null, p: V3 | null) => {
      if (!el) return;
      if (!p) {
        el.style.visibility = 'hidden';
        return;
      }
      const s = stage.project(p);
      el.style.visibility = s.visible ? 'visible' : 'hidden';
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
    };
    const update = () => {
      const l = layoutRef.current?.get(selected);
      if (!l) return;
      place(tipRef.current, bezierPoint(l, 1));
      place(midRef.current, bezierPoint(l, 0.5));
      place(cutRef.current, bezierPoint(l, Math.max(cutTRef.current, 0.03)));
    };
    update();
    stage.invalidate();
    return stage.onFrame(update);
  }, [stageRef, layoutRef, selected, showShape, showCut]);

  const startShapeDrag = (kind: 'tip' | 'mid') => (e: React.PointerEvent) => {
    const stage = stageRef.current;
    const st = getState().studio;
    if (!stage || !st || !selected) return;
    e.stopPropagation();
    e.preventDefault();
    sound.unlock();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const base = st.history.present;
    const baseLayout = computeLayout(base.tree);
    const l = baseLayout.get(selected);
    if (!l) return;
    const anchor = bezierPoint(l, kind === 'tip' ? 1 : 0.5);
    const hostRect = stage.container.getBoundingClientRect();
    let live = base;
    let lastLimited = false;
    let lastTickX = e.clientX;
    let lastTickY = e.clientY;
    setActive(kind);
    setDragging(true);
    stage.setTurntable(false);

    const onMove = (ev: PointerEvent) => {
      const world = stage.unproject(ev.clientX - hostRect.left, ev.clientY - hostRect.top, anchor);
      const res = kind === 'tip' ? aimTip(base.tree, baseLayout, selected, world) : curveTo(base.tree, baseLayout, selected, world);
      if (!res.ok) return;
      live = { ...base, tree: res.tree };
      previewWork(live);
      const limited = !!res.limited;
      if (limited && !lastLimited) {
        sound.creak();
        sound.haptic(12);
      }
      if (limited !== lastLimited) setResist(limited);
      lastLimited = limited;
      if (Math.hypot(ev.clientX - lastTickX, ev.clientY - lastTickY) > 18) {
        sound.bendTick();
        lastTickX = ev.clientX;
        lastTickY = ev.clientY;
      }
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      setActive(null);
      setResist(false);
      if (live === base) {
        commitFrom(base, base);
        return;
      }
      const released = releaseShape(base.tree, live.tree, selected);
      const finalWork = { ...base, tree: released };
      const b = base.tree.branches[selected]!;
      const wired = !!b.wire;
      const from = live.tree.branches[selected]!.shape;
      const to = released.branches[selected]!.shape;
      if (wired || reducedMotion() || holdFraction(base.tree, b) >= 0.99) {
        commitFrom(base, finalWork);
        if (wired) sound.confirm();
        else sound.rustle(0.3);
        return;
      }
      // Bare wood springs part of the way back – show it happening.
      sound.rustle(0.35);
      const t0 = performance.now();
      const dur = 260;
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        const e2 = 1 - Math.pow(1 - k, 3);
        if (k < 1) {
          const shape = lerpShape(from, to, e2);
          previewWork({ ...base, tree: { ...live.tree, branches: { ...live.tree.branches, [selected]: { ...live.tree.branches[selected]!, shape } } } });
          requestAnimationFrame(step);
        } else commitFrom(base, finalWork);
      };
      requestAnimationFrame(step);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  const startCutDrag = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage || !selected) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const rect = stage.container.getBoundingClientRect();
    setActive('cut');
    const onMove = (ev: PointerEvent) => {
      const t = stage.nearestT(selected, ev.clientX - rect.left, ev.clientY - rect.top);
      const snapped = t < MIN_SHORTEN_T ? 0 : t;
      if ((snapped === 0) !== (cutTRef.current === 0)) sound.tap();
      setCutT(snapped);
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      setActive(null);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  if (!selected || !branch) return null;
  const wired = !!branch.wire;
  return (
    <div className="handles">
      {showShape && (
        <>
          <button
            ref={midRef}
            type="button"
            className={`handle mid${active === 'mid' ? ' active' : ''}${resist && active === 'mid' ? ' resist' : ''}${wired ? ' wired' : ''}`}
            aria-label="Curve handle – drag to change the branch's curvature"
            onPointerDown={startShapeDrag('mid')}
          >
            <span className="handle-label">{resist ? 'The wood resists' : 'Curve'}</span>
          </button>
          <button
            ref={tipRef}
            type="button"
            className={`handle tip${active === 'tip' ? ' active' : ''}${resist && active === 'tip' ? ' resist' : ''}${wired ? ' wired' : ''}`}
            aria-label="Direction handle – drag to aim the branch"
            onPointerDown={startShapeDrag('tip')}
          >
            <span className="handle-label">{resist ? 'The wood resists' : 'Aim'}</span>
          </button>
        </>
      )}
      {showCut && (
        <button
          ref={cutRef}
          type="button"
          className={`handle cut${active === 'cut' ? ' active' : ''}`}
          aria-label="Cut point – drag along the branch to shorten instead of removing"
          onPointerDown={startCutDrag}
        >
          <span className="blade">
            <IconShears />
          </span>
          <span className="handle-label">{effT === 0 ? 'Remove at base' : `Shorten to ${Math.round(effT * 100)}%`}</span>
        </button>
      )}
    </div>
  );
}
