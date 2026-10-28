import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addStone,
  applyWireToSelected,
  commit,
  cutSelected,
  getCopperPreferred,
  grow,
  hasUnlock,
  nudgeSelected,
  openPortrait,
  previewWork,
  rearrangeStones,
  removeStone,
  removeWireFromSelected,
  selectBranch,
  selectNext,
  selectParent,
  setCare,
  setCopperPreferred,
  setPot,
  setTool,
  toggleSilhouette,
  toggleTurntable,
} from '../app/actions';
import { emitFx, view } from '../app/bus';
import { type StudioState, activeRecord, getState, useStore } from '../app/store';
import { calendarLabel, type TreeRecord } from '../game/model';
import { POT_COLORS, POT_SHAPES, STONE_KINDS } from '../game/pots';
import { type Metric, analyze } from '../game/scoring';
import { unlockDef } from '../game/unlocks';
import { computeLayout } from '../tree/layout';
import { canWire, holdFraction, normaliseCutT, previewPrune } from '../tree/ops';
import { SPECIES } from '../tree/species';
import type { Branch, TreeState } from '../tree/types';
import {
  IconArrow,
  IconCamera,
  IconClose,
  IconGrow,
  IconLock,
  IconPlus,
  IconRotateLeft,
  IconRotateRight,
  IconShape,
  IconShears,
  IconSilhouette,
  IconTurntable,
  IconUp,
  IconView,
  IconWire,
  IconPot,
  IconSurface,
} from './icons';

export function branchLabel(tree: TreeState, b: Branch): string {
  if (b.kind === 'trunk') return b.parentId === null ? 'Trunk base' : 'Trunk (leader)';
  let depth = 0;
  let cur: Branch | undefined = b;
  while (cur && cur.kind !== 'trunk') {
    depth++;
    cur = cur.parentId ? tree.branches[cur.parentId] : undefined;
  }
  return depth <= 1 ? 'Primary branch' : depth === 2 ? 'Secondary branch' : 'Twig';
}

const cm = (r: number) => `${(r * 2 * 10).toFixed(1)} cm`;

export function BranchFacts({ tree, b }: { tree: TreeState; b: Branch }) {
  const age = Math.max(0, Math.round((tree.day - b.bornDay) / 36) / 10);
  const kids = Object.values(tree.branches).filter((c) => c.parentId === b.id).length;
  return (
    <span className="panel-sub">
      {cm(b.radius)} thick · {kids} {kids === 1 ? 'offshoot' : 'offshoots'}
      {b.bornDay > 25 ? ` · grown ${age < 1 ? 'this year' : `${age} yr ago`}` : ''}
    </span>
  );
}

// ------------------------------------------------------------- prune

export function PrunePanel({ st }: { st: StudioState }) {
  const tree = st.history.present.tree;
  const b = st.selected ? tree.branches[st.selected] : undefined;
  if (!b) {
    return (
      <div className="panel" data-testid="panel-prune">
        <div className="panel-head">
          <span className="panel-title">Shears</span>
          <BranchStepper />
        </div>
        <p className="hint" style={{ margin: '2px 0 0' }}>
          Tap a branch. What would be removed turns <strong style={{ color: 'var(--vermilion)' }}>red</strong> first.
        </p>
      </div>
    );
  }
  const t = normaliseCutT(tree, b.id, st.cutT);
  const preview = previewPrune(tree, b.id, st.cutT);
  const isBase = b.parentId === null && t === 0;
  const pct = Math.round(preview.foliageFraction * 100);
  const removedCount = preview.removed.length;
  return (
    <div className="panel" data-testid="panel-prune">
      <div className="panel-head">
        <div>
          <div className="panel-title">{branchLabel(tree, b)}</div>
          <BranchFacts tree={tree} b={b} />
        </div>
        <button className="icon-btn plain" onClick={() => selectBranch(null)} aria-label="Deselect branch">
          <IconClose />
        </button>
      </div>
      <p className="hint" style={{ margin: '6px 0 10px' }}>
        {isBase ? (
          'The base of the trunk can’t be removed. Drag the blades up the trunk to chop the top instead.'
        ) : t === 0 ? (
          <>
            Removes this branch{removedCount > 1 ? ` and ${removedCount - 1} more` : ''} · <strong>{pct}%</strong> of the foliage.
          </>
        ) : (
          <>
            Shortens it to <strong>{Math.round(t * 100)}%</strong>
            {removedCount ? ` · removes ${removedCount} offshoot${removedCount > 1 ? 's' : ''}` : ''} · {pct}% of the foliage.
          </>
        )}{' '}
        {!isBase && pct > 35 && <span className="warn-text">A heavy cut.</span>}
      </p>
      <div className="row">
        <button className="btn small" onClick={selectParent} disabled={!b.parentId} aria-label="Select parent branch">
          <IconUp /> Parent
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn cut" onClick={cutSelected} disabled={isBase} data-testid="cut-button">
          <IconShears /> Cut
        </button>
      </div>
    </div>
  );
}

function BranchStepper() {
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className="btn small ghost" onClick={() => selectNext(-1)} aria-label="Select previous branch">
        <IconArrow dir="left" />
      </button>
      <button className="btn small ghost" onClick={() => selectNext(1)} aria-label="Select next branch">
        <IconArrow dir="right" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------- shape

export function ShapePanel({ st }: { st: StudioState }) {
  const tree = st.history.present.tree;
  const b = st.selected ? tree.branches[st.selected] : undefined;
  if (!b) {
    return (
      <div className="panel" data-testid="panel-shape">
        <div className="panel-head">
          <span className="panel-title">Shape</span>
          <BranchStepper />
        </div>
        <p className="hint" style={{ margin: '2px 0 0' }}>
          Tap a branch, then drag the <strong>round handle</strong> to aim it and the <strong>diamond</strong> to curve it.
        </p>
      </div>
    );
  }
  const hold = Math.round(holdFraction(tree, b) * 100);
  const wireCheck = canWire(b);
  return (
    <div className="panel" data-testid="panel-shape">
      <div className="panel-head">
        <div>
          <div className="panel-title">{branchLabel(tree, b)}</div>
          <BranchFacts tree={tree} b={b} />
        </div>
        <button className="icon-btn plain" onClick={() => selectBranch(null)} aria-label="Deselect branch">
          <IconClose />
        </button>
      </div>
      <p className="hint" style={{ margin: '6px 0 8px' }}>
        {st.resisting ? (
          <span className="warn-text">The wood resists – thicker wood bends less. Wire it to go further.</span>
        ) : b.wire ? (
          <>
            <strong>Wired</strong> – holds the full bend while it sets ({Math.round(b.wire.set * 100)}% set).
          </>
        ) : (
          <>
            Bare wood keeps about <strong>{hold}%</strong> of a bend and springs back the rest.
          </>
        )}
      </p>
      <div className="row">
        <div className="row" style={{ gap: 4 }} role="group" aria-label="Nudge branch">
          <button className="chip" onClick={() => nudgeSelected('up')} aria-label="Raise branch">
            <IconArrow dir="up" />
          </button>
          <button className="chip" onClick={() => nudgeSelected('down')} aria-label="Lower branch">
            <IconArrow dir="down" />
          </button>
          <button className="chip" onClick={() => nudgeSelected('left')} aria-label="Swing branch left">
            <IconArrow dir="left" />
          </button>
          <button className="chip" onClick={() => nudgeSelected('right')} aria-label="Swing branch right">
            <IconArrow dir="right" />
          </button>
          <button className="chip" onClick={() => nudgeSelected('curve+')} aria-label="More curve">
            ⌒+
          </button>
          <button className="chip" onClick={() => nudgeSelected('curve-')} aria-label="Less curve">
            ⌒−
          </button>
        </div>
        <span style={{ flex: 1 }} />
        {!b.wire && (
          <button className="btn small" onClick={applyWireToSelected} disabled={!wireCheck.ok} title={wireCheck.ok ? undefined : wireCheck.reason}>
            <IconWire /> Wire it
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- wire

export function WirePanel({ st }: { st: StudioState }) {
  const tree = st.history.present.tree;
  const b = st.selected ? tree.branches[st.selected] : undefined;
  const wired = Object.values(tree.branches).filter((x) => x.wire);
  const copperOk = hasUnlock('tool:copper');
  const [copper, setCopper] = useState(getCopperPreferred());
  const sp = SPECIES[tree.species];
  if (!b) {
    return (
      <div className="panel" data-testid="panel-wire">
        <div className="panel-head">
          <span className="panel-title">Training wire</span>
          <span className="panel-sub">{wired.length ? `${wired.length} branch${wired.length > 1 ? 'es' : ''} wired` : 'No wire on'}</span>
        </div>
        <p className="hint" style={{ margin: '4px 0 0' }}>
          Tap a branch to wire it. Wire holds any bend; with time the branch <strong>sets</strong> and keeps the shape when the wire comes off. Leave it on too long and it bites.
        </p>
        {wired.length > 0 && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={() => selectBranch(wired[0]!.id)}>
              Select wired branch
            </button>
          </div>
        )}
      </div>
    );
  }
  const check = canWire(b);
  const remaining = b.wire ? Math.max(0, Math.round(((1 - b.wire.set) * sp.growth.wireSetDays) / (b.wire.copper ? 1.5 : 1))) : 0;
  return (
    <div className="panel" data-testid="panel-wire">
      <div className="panel-head">
        <div>
          <div className="panel-title">{branchLabel(tree, b)}</div>
          <BranchFacts tree={tree} b={b} />
        </div>
        <button className="icon-btn plain" onClick={() => selectBranch(null)} aria-label="Deselect branch">
          <IconClose />
        </button>
      </div>
      {b.wire ? (
        <>
          <div style={{ margin: '8px 0 4px' }} className="row between">
            <span className="hint">
              {b.wire.copper ? 'Copper' : 'Aluminium'} wire · <strong>{Math.round(b.wire.set * 100)}% set</strong>
              {b.wire.set < 1 ? ` · ~${remaining} days to go` : ' · ready to remove'}
            </span>
          </div>
          <div className="meter" aria-hidden>
            <i style={{ width: `${b.wire.set * 100}%`, background: b.wire.bite > 0.05 ? 'var(--vermilion)' : undefined }} />
          </div>
          {b.wire.bite > 0.05 && <p className="hint warn-text" style={{ margin: '6px 0 0' }}>The wire is biting into the bark – remove it now.</p>}
          <p className="hint" style={{ margin: '6px 0 8px' }}>Drag the handles to bend it – wired wood holds the whole bend.</p>
          <div className="row end">
            <button className="btn" onClick={removeWireFromSelected}>
              Remove wire
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint" style={{ margin: '6px 0 8px' }}>
            {check.ok ? 'Wrap this branch so it holds the shape you give it.' : check.reason}
          </p>
          <div className="row">
            {copperOk && (
              <button
                className="chip"
                aria-pressed={copper}
                onClick={() => {
                  setCopper(!copper);
                  setCopperPreferred(!copper);
                }}
              >
                Copper
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn primary" onClick={applyWireToSelected} disabled={!check.ok} data-testid="apply-wire">
              <IconWire /> Apply wire
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- grow

export function GrowPanel({ st }: { st: StudioState }) {
  const record = useStore(activeRecord);
  const tree = st.history.present.tree;
  if (!record) return null;
  const r = st.lastReport;
  const vig = Math.round(tree.health * 100);
  return (
    <div className="panel" data-testid="panel-grow">
      <div className="panel-head">
        <span className="panel-title">{calendarLabel(tree)}</span>
        <span className="panel-sub">Vigour {vig}%</span>
      </div>
      <div className="meter" style={{ margin: '8px 0 10px' }} aria-label={`Vigour ${vig}%`} role="meter" aria-valuenow={vig} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${vig}%`, background: vig < 50 ? 'var(--gold)' : undefined }} />
      </div>
      <div className="row" role="group" aria-label="Care">
        <button className="chip" aria-pressed={record.care.feed} onClick={() => setCare({ feed: !record.care.feed })}>
          Feed
        </button>
        <button className="chip" aria-pressed={record.care.placement === 'sun'} onClick={() => setCare({ placement: 'sun' })}>
          Full sun
        </button>
        <button className="chip" aria-pressed={record.care.placement === 'partial'} onClick={() => setCare({ placement: 'partial' })}>
          Part shade
        </button>
      </div>
      <div className="row" style={{ marginTop: 10, gap: 6 }}>
        <button className="btn small grow" onClick={() => grow(7)} data-testid="grow-week">
          +1 week
        </button>
        <button className="btn small grow" onClick={() => grow(30)}>
          +1 month
        </button>
        <button className="btn small grow" onClick={() => grow(90)} data-testid="grow-season">
          +1 season
        </button>
        <button className="btn small grow" onClick={() => grow(360)}>
          +1 year
        </button>
      </div>
      {r && (
        <p className="hint" style={{ margin: '8px 0 0', fontSize: 12.5 }}>
          Last {r.days} days: {r.newShoots.length} new shoots · vigour {Math.round(r.healthBefore * 100)}→{Math.round(r.healthAfter * 100)}%
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------- pot

/** Range slider that previews live and records a single undo step on release. */
function LiveSlider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  apply: (v: number) => void;
  preview: (v: number) => void;
}) {
  const [v, setV] = useState(props.value);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setV(props.value);
  }, [props.value]);
  const finish = () => {
    if (!dragging.current) return;
    dragging.current = false;
    props.apply(v);
  };
  return (
    <div className="slider">
      <label>{props.label}</label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={v}
        aria-label={props.label}
        onChange={(e) => {
          const nv = Number(e.target.value);
          setV(nv);
          if (!dragging.current) {
            // Keyboard / click: commit directly.
            props.apply(nv);
          } else props.preview(nv);
        }}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onBlur={finish}
      />
      <output>{props.format(v)}</output>
    </div>
  );
}

const lockNote = (key?: string) => (key ? `Locked – ${unlockDef(key)?.description ?? 'earn it in Challenges'}` : undefined);

export function PotPanel({ st }: { st: StudioState }) {
  const work = st.history.present;
  const pot = work.pot;
  return (
    <div className="panel" data-testid="panel-pot">
      <div className="panel-head">
        <span className="panel-title">Pot</span>
        <span className="panel-sub">{POT_SHAPES.find((s) => s.id === pot.shape)?.note}</span>
      </div>
      <div className="scroll-x" style={{ margin: '10px -14px 8px' }} role="group" aria-label="Pot shape">
        {POT_SHAPES.map((s) => {
          const locked = !hasUnlock(s.unlock);
          return (
            <button key={s.id} className="chip" aria-pressed={pot.shape === s.id} disabled={locked} title={lockNote(locked ? s.unlock : undefined)} onClick={() => setPot({ shape: s.id })}>
              {locked && <IconLock />}
              {s.name}
            </button>
          );
        })}
      </div>
      <div className="scroll-x" style={{ gap: 8, margin: '4px -14px 8px', padding: '2px 14px' }} role="group" aria-label="Pot colour">
        {POT_COLORS.map((c) => {
          const locked = !hasUnlock(c.unlock);
          return (
            <button
              key={c.id}
              className="swatch"
              style={{ background: c.hex }}
              aria-pressed={pot.colorId === c.id}
              aria-label={`${c.name}${c.material === 'glazed' ? ' (glazed)' : ' (unglazed)'}${locked ? ' – locked' : ''}`}
              title={locked ? lockNote(c.unlock) : c.name}
              disabled={locked}
              onClick={() => setPot({ colorId: c.id })}
            >
              {locked && <IconLock />}
            </button>
          );
        })}
      </div>
      <LiveSlider
        label="Size"
        min={0.75}
        max={1.3}
        step={0.05}
        value={pot.size}
        format={(v) => `${Math.round(v * 100)}%`}
        preview={(v) => previewWork({ ...getState().studio!.history.present, pot: { ...pot, size: v } })}
        apply={(v) => setPot({ size: v })}
      />
    </div>
  );
}

// ------------------------------------------------------------- surface

export function SurfacePanel({ st }: { st: StudioState }) {
  const work = st.history.present;
  const s = work.surface;
  return (
    <div className="panel" data-testid="panel-surface">
      <div className="panel-head">
        <span className="panel-title">Surface</span>
        <span className="panel-sub">{s.stones.length}/5 stones</span>
      </div>
      <div style={{ marginTop: 6 }}>
        <LiveSlider
          label="Moss"
          min={0}
          max={1}
          step={0.05}
          value={s.moss}
          format={(v) => `${Math.round(v * 100)}%`}
          preview={(v) => previewWork({ ...getState().studio!.history.present, surface: { ...s, moss: v } })}
          apply={(v) => commit({ ...getState().studio!.history.present, surface: { ...s, moss: v } })}
        />
      </div>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        {STONE_KINDS.map((k) => {
          const locked = !hasUnlock(k.unlock);
          return (
            <button key={k.id} className="chip" disabled={locked || s.stones.length >= 5} onClick={() => addStone(k.id)} title={lockNote(locked ? k.unlock : undefined)}>
              {locked ? <IconLock /> : <IconPlus />} {k.name}
            </button>
          );
        })}
      </div>
      {s.stones.length > 0 && (
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          {s.stones.map((stone, i) => (
            <button key={stone.id} className="chip" onClick={() => removeStone(stone.id)} aria-label={`Remove stone ${i + 1}`}>
              {STONE_KINDS.find((k) => k.id === stone.kind)?.name} <IconClose />
            </button>
          ))}
          <button className="chip" onClick={rearrangeStones}>
            Rearrange
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- view / compose

function useYaw(): number {
  const [yaw, setYaw] = useState(view.yaw);
  useEffect(() => {
    let t = 0;
    return view.onChange(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setYaw(view.yaw), 220);
    });
  }, []);
  return yaw;
}

export function MetricBar({ m }: { m: Metric }) {
  const cls = m.score < 45 ? 'low' : m.score < 70 ? 'mid' : '';
  return (
    <div className="metric">
      <span className="metric-name">{m.label}</span>
      <span className="metric-score">{Math.round(m.score)}</span>
      <div className={`bar ${cls}`}>
        <i style={{ width: `${Math.max(3, m.score)}%` }} />
      </div>
      <span className="metric-note">{m.note}</span>
    </div>
  );
}

export function ViewPanel({ st, record }: { st: StudioState; record: TreeRecord }) {
  const work = st.history.present;
  const yaw = useYaw();
  const analysis = useMemo(() => analyze(work, yaw, computeLayout(work.tree)), [work, yaw]);
  const [open, setOpen] = useState(false);
  const shown = (['silhouette', 'space', 'structure', 'balance'] as const).map((k) => analysis.metrics[k]);
  const weakest = [...shown].sort((a, b) => a.score - b.score)[0]!;
  return (
    <div className="panel" data-testid="panel-view">
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <button className="chip" aria-pressed={st.silhouette} onClick={toggleSilhouette}>
          <IconSilhouette /> Silhouette
        </button>
        <button className="chip" aria-pressed={st.turntable} onClick={toggleTurntable}>
          <IconTurntable /> Turntable
        </button>
        <button className="chip" onClick={() => emitFx({ type: 'orbit', yaw: -Math.PI / 4, pitch: 0 })} aria-label="Rotate left 45 degrees">
          <IconRotateLeft />
        </button>
        <button className="chip" onClick={() => emitFx({ type: 'orbit', yaw: Math.PI / 4, pitch: 0 })} aria-label="Rotate right 45 degrees">
          <IconRotateRight />
        </button>
      </div>
      <button className="row between" style={{ width: '100%', marginTop: 10 }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span style={{ textAlign: 'left' }}>
          <span className="panel-title" style={{ fontSize: 15 }}>
            Studio critique
          </span>
          <span className="panel-sub" style={{ display: 'block' }}>
            {weakest.score < 70 ? weakest.note : 'Looking good from this side. Try another angle.'}
          </span>
        </span>
        <span className="chip">{open ? 'Less' : 'More'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {shown.map((m) => (
            <MetricBar key={m.id} m={m} />
          ))}
          <p className="hint" style={{ fontSize: 12, margin: '6px 0 0' }}>
            Judged from the angle you’re looking at – this is the tree’s front.
          </p>
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn small wide" onClick={() => openPortrait(record.id)}>
          <IconCamera /> Portrait mode
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- dock

const TOOLS = [
  { id: 'prune', label: 'Shears', Icon: IconShears },
  { id: 'shape', label: 'Shape', Icon: IconShape },
  { id: 'wire', label: 'Wire', Icon: IconWire },
  { id: 'grow', label: 'Grow', Icon: IconGrow },
  { id: 'pot', label: 'Pot', Icon: IconPot },
  { id: 'surface', label: 'Surface', Icon: IconSurface },
  { id: 'view', label: 'Look', Icon: IconView },
] as const;

export function ToolDock({ tool }: { tool: string }) {
  return (
    <nav className="dock" aria-label="Tools">
      {TOOLS.map(({ id, label, Icon }) => (
        <button key={id} className={`tool ${id}`} aria-pressed={tool === id} onClick={() => setTool(id)} data-testid={`tool-${id}`}>
          <Icon />
          {label}
        </button>
      ))}
    </nav>
  );
}
