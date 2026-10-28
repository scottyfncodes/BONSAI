import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cutSelected,
  emitResetCamera,
  openSheet,
  redo,
  selectBranch,
  selectNext,
  selectParent,
  setTool,
  skipOnboarding,
  storeThumbnail,
  submitChallenge,
  undo,
  updateSettings,
} from '../app/actions';
import { emitFx, view } from '../app/bus';
import { type StudioState, activeRecord, getState, useStore } from '../app/store';
import { sound } from '../audio/sound';
import { challengeDef, evaluateChallenge, movesUsed, variantDef } from '../game/challenges';
import { type TreeRecord, ageYears, calendarLabel } from '../game/model';
import type { Stage } from '../render/stage';
import { SPECIES } from '../tree/species';
import { IconChevronDown, IconCircleCheck, IconCircleX, IconMuted, IconRecenter, IconRedo, IconSound, IconStar, IconUndo } from './icons';
import { GrowPanel, MetricBar, PotPanel, PrunePanel, ShapePanel, SurfacePanel, ToolDock, ViewPanel, WirePanel } from './Panels';
import { TreeViewport } from './TreeViewport';

export function Studio() {
  const st = useStore((s) => s.studio);
  const record = useStore(activeRecord);
  const stageRef = useRef<Stage | null>(null);
  const onStage = useCallback((s: Stage | null) => {
    stageRef.current = s;
  }, []);

  useStudioKeys();
  useThumbnails(stageRef, record?.id ?? null, st);

  if (!st || !record) {
    return (
      <div className="studio">
        <div className="empty" style={{ paddingTop: 120 }}>
          <h2>Your bench is empty</h2>
          <p>Start a sapling from the Collection to begin.</p>
        </div>
      </div>
    );
  }
  const work = st.history.present;
  return (
    <div className="studio">
      <TreeViewport
        work={work}
        interactive
        selected={st.selected}
        tool={st.tool}
        cutT={st.cutT}
        silhouette={st.silhouette}
        turntable={st.turntable}
        dragging={st.dragging}
        onStage={onStage}
      />
      <StudioHeader record={record} st={st} />
      {record.challenge ? <ChallengeHud record={record} st={st} /> : <Coach st={st} />}
      <div className="studio-bottom">
        <div className="edit-row">
          <button className="icon-btn" onClick={undo} disabled={!st.history.past.length} aria-label="Undo" data-testid="undo">
            <IconUndo />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!st.history.future.length} aria-label="Redo" data-testid="redo">
            <IconRedo />
          </button>
          <span className="spacer" />
          <button className="icon-btn" onClick={emitResetCamera} aria-label="Reset camera">
            <IconRecenter />
          </button>
        </div>
        {st.tool === 'prune' && <PrunePanel st={st} />}
        {st.tool === 'shape' && <ShapePanel st={st} />}
        {st.tool === 'wire' && <WirePanel st={st} />}
        {st.tool === 'grow' && <GrowPanel st={st} />}
        {st.tool === 'pot' && <PotPanel st={st} />}
        {st.tool === 'surface' && <SurfacePanel st={st} />}
        {st.tool === 'view' && <ViewPanel st={st} record={record} />}
        <ToolDock tool={st.tool} />
      </div>
    </div>
  );
}

function StudioHeader({ record, st }: { record: TreeRecord; st: StudioState }) {
  const saveStatus = useStore((s) => s.saveStatus);
  const muted = useStore((s) => s.profile.settings.muted);
  const sp = SPECIES[record.species];
  return (
    <header className="studio-top">
      <button className="tree-title" onClick={() => openSheet({ kind: 'treeOptions', treeId: record.id })} aria-label={`${record.name} – tree options`}>
        <h1>
          {record.name} <IconChevronDown style={{ width: 16, height: 16, verticalAlign: 'middle', opacity: 0.5 }} />
        </h1>
        <span className="meta">
          {sp.name.split(' ').pop()} · {ageYears(record)} yrs · {calendarLabel(st.history.present.tree)}
        </span>
      </button>
      <div className="top-actions">
        <SaveBadge status={saveStatus} />
        <button
          className="icon-btn"
          onClick={() => {
            sound.unlock();
            updateSettings({ muted: !muted });
          }}
          aria-label={muted ? 'Turn sound on' : 'Mute sound'}
          aria-pressed={!muted}
        >
          {muted ? <IconMuted /> : <IconSound />}
        </button>
      </div>
    </header>
  );
}

function SaveBadge({ status }: { status: string }) {
  const error = useStore((s) => s.saveError);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    if (status === 'saved') {
      const t = window.setTimeout(() => setVisible(false), 2200);
      return () => window.clearTimeout(t);
    }
  }, [status]);
  if (status === 'idle') return null;
  const label = status === 'saving' ? 'Saving' : status === 'error' ? 'Not saved' : 'Saved';
  return (
    <span className={`save-badge ${status}`} style={{ opacity: visible || status !== 'saved' ? 1 : 0 }} role="status" title={error ?? undefined} data-testid="save-badge">
      <span className="dot" />
      {label}
    </span>
  );
}

// ------------------------------------------------------------- challenge HUD

function useLiveResult(record: TreeRecord) {
  const [yaw, setYaw] = useState(view.yaw);
  useEffect(() => {
    let t = 0;
    return view.onChange(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setYaw(view.yaw), 250);
    });
  }, []);
  return useMemo(() => {
    const def = record.challenge ? challengeDef(record.challenge.challengeId) : undefined;
    const v = record.challenge ? variantDef(record.challenge.challengeId, record.challenge.variantId) : undefined;
    if (!def || !v) return null;
    return { def, v, result: evaluateChallenge(record, def, v, yaw) };
  }, [record, yaw]);
}

function ChallengeHud({ record, st }: { record: TreeRecord; st: StudioState }) {
  const live = useLiveResult(record);
  const [open, setOpen] = useState(false);
  if (!live) return null;
  const { def, v, result } = live;
  const used = movesUsed(record);
  const submitted = record.challenge?.submitted;
  const r = 17;
  const c = 2 * Math.PI * r;
  const color = result.passed ? (result.score >= 74 ? 'var(--moss)' : 'var(--gold)') : 'var(--vermilion)';
  return (
    <>
      <div className="hud" data-testid="challenge-hud">
        <button className="hud-main" onClick={() => setOpen(!open)} aria-expanded={open}>
          <div className="hud-title">{def.title}</div>
          <div className="hud-goal">
            {v.budget !== undefined ? `Moves ${used}/${v.budget} · ` : ''}
            {result.requirements.filter((q) => !q.met).length
              ? `To do: ${result.requirements.find((q) => !q.met)!.label.toLowerCase()}`
              : submitted
                ? `Last judged ${submitted.score} · ${'★'.repeat(submitted.stars) || 'no stars'}`
                : 'Requirements met – refine and submit'}
          </div>
        </button>
        <div className="ring" aria-label={`Live score ${result.score}`}>
          <svg viewBox="0 0 42 42">
            <circle cx="21" cy="21" r={r} fill="none" stroke="var(--paper-2)" strokeWidth="4" />
            <circle cx="21" cy="21" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(c * result.score) / 100} ${c}`} />
          </svg>
          <span>{result.score}</span>
        </div>
        <button className="btn small primary" onClick={submitChallenge} disabled={st.dragging} data-testid="submit-challenge">
          Judge
        </button>
      </div>
      {open && (
        <div className="panel hud-detail" data-testid="hud-detail">
          <p className="hint" style={{ margin: '0 0 8px' }}>
            {def.brief}
          </p>
          {result.requirements.map((q) => (
            <div key={q.label} className={`req ${q.met ? 'met' : 'unmet'}`}>
              {q.met ? <IconCircleCheck /> : <IconCircleX />}
              <span>
                {q.label}
                <small>{q.detail}</small>
              </span>
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            {result.metrics.map((m) => (
              <MetricBar key={m.id} m={m} />
            ))}
          </div>
          <p className="hint" style={{ fontSize: 12, marginTop: 8 }}>
            Stars at 60 · 74 · 87. Judges look from the angle you’re facing. {def.tips[0]}
          </p>
        </div>
      )}
    </>
  );
}

export function Stars({ n, size }: { n: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${n} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <IconStar key={i} className={i <= n ? '' : 'off'} style={size ? { width: size, height: size } : undefined} />
      ))}
    </span>
  );
}

// ------------------------------------------------------------- onboarding coach

function Coach({ st }: { st: StudioState }) {
  const step = useStore((s) => s.profile.onboarding);
  if (step >= 99) return null;
  let text: string;
  if (step === 0) text = st.selected ? 'Tap Cut to prune it. Undo is always one tap away.' : 'Drag to turn the tree. Tap a branch to choose it.';
  else if (step === 1) text = st.selected ? 'Tap Cut to prune it. Undo is always one tap away.' : 'Tap a branch, then tap Cut.';
  else text = 'Now turn the tree and look at the new silhouette.';
  if (st.tool !== 'prune') return null;
  return (
    <div className="coach" role="status" data-testid="coach">
      <span>{text}</span>
      <button onClick={skipOnboarding}>Skip tips</button>
    </div>
  );
}

// ------------------------------------------------------------- keyboard

function useStudioKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getState();
      if (s.route !== 'studio' || s.sheet || s.portraitId || !s.studio) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod) return;
      switch (e.key) {
        case 'ArrowLeft':
          emitFx({ type: 'orbit', yaw: -0.18, pitch: 0 });
          break;
        case 'ArrowRight':
          emitFx({ type: 'orbit', yaw: 0.18, pitch: 0 });
          break;
        case 'ArrowUp':
          emitFx({ type: 'orbit', yaw: 0, pitch: 0.08 });
          break;
        case 'ArrowDown':
          emitFx({ type: 'orbit', yaw: 0, pitch: -0.08 });
          break;
        case '+':
        case '=':
          emitFx({ type: 'zoom', factor: 0.88 });
          break;
        case '-':
          emitFx({ type: 'zoom', factor: 1.14 });
          break;
        case '0':
          emitResetCamera();
          break;
        case 'Escape':
          selectBranch(null);
          break;
        case ']':
          selectNext(1);
          break;
        case '[':
          selectNext(-1);
          break;
        case 'p':
          selectParent();
          break;
        case 'Delete':
        case 'Backspace':
          if (s.studio.tool === 'prune' && s.studio.selected) cutSelected();
          break;
        default: {
          const tools = ['prune', 'shape', 'wire', 'grow', 'pot', 'surface', 'view'] as const;
          const n = Number(e.key);
          if (n >= 1 && n <= tools.length) setTool(tools[n - 1]!);
          else return;
        }
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// ------------------------------------------------------------- thumbnails

function useThumbnails(stageRef: React.RefObject<Stage | null>, id: string | null, st: StudioState | null) {
  const work = st?.history.present;
  const silhouette = st?.silhouette;
  const dragging = st?.dragging;
  useEffect(() => {
    if (!id || !work || silhouette || dragging) return;
    const t = window.setTimeout(() => {
      const stage = stageRef.current;
      if (!stage || getState().activeId !== id || getState().studio?.dragging) return;
      try {
        storeThumbnail(id, stage.thumbnail());
      } catch {
        /* thumbnails are best-effort */
      }
    }, 1800);
    return () => window.clearTimeout(t);
  }, [stageRef, id, work, silhouette, dragging]);
}
