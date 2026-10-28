import { useEffect, useRef, useState } from 'react';
import {
  challengeRecords,
  closeSheet,
  deleteTree,
  hasUnlock,
  navigate,
  newTree,
  openPortrait,
  openSheet,
  openTree,
  renameTree,
  setStyleOverride,
  startChallenge,
  unlockNames,
  updateSettings,
} from '../app/actions';
import { type Sheet, useStore } from '../app/store';
import { challengeDef, variantDef } from '../game/challenges';
import { STYLE_LABELS, type TreeStyle, styleOf } from '../game/model';
import { unlockDef } from '../game/unlocks';
import { PRESET_LABELS, type SaplingPreset } from '../tree/generate';
import { SPECIES, SPECIES_IDS } from '../tree/species';
import type { SpeciesId } from '../tree/types';
import { IconCamera, IconCircleCheck, IconCircleX, IconLock, IconPencil, IconPlus, IconSettings, IconTrash, TreeMark } from './icons';
import { MetricBar } from './Panels';
import { Stars } from './Studio';

export function Sheets() {
  const sheet = useStore((s) => s.sheet);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sheet) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, button');
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [sheet]);
  if (!sheet) return null;
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="sheet" role="dialog" aria-modal="true" ref={ref} data-testid={`sheet-${sheet.kind}`}>
        <div className="grabber" />
        <SheetBody sheet={sheet} />
      </div>
    </div>
  );
}

function SheetBody({ sheet }: { sheet: NonNullable<Sheet> }) {
  switch (sheet.kind) {
    case 'newTree':
      return <NewTree />;
    case 'treeOptions':
      return <TreeOptions id={sheet.treeId} />;
    case 'rename':
      return <Rename id={sheet.treeId} />;
    case 'confirmDelete':
      return <ConfirmDelete id={sheet.treeId} />;
    case 'challengeIntro':
      return <ChallengeIntro challengeId={sheet.challengeId} variantId={sheet.variantId} />;
    case 'challengeResult':
      return <ChallengeResultView sheet={sheet} />;
    case 'settings':
      return <SettingsSheet />;
  }
}

const SPECIES_TINT: Record<SpeciesId, string> = { juniper: '#e5ead6', maple: '#f7ddd5', pine: '#dfe5dc' };
const SPECIES_INK: Record<SpeciesId, string> = { juniper: '#5d7838', maple: '#cf472d', pine: '#3c5124' };

function NewTree() {
  const [species, setSpecies] = useState<SpeciesId>('juniper');
  const [preset, setPreset] = useState<SaplingPreset>('nursery');
  const presets: { id: SaplingPreset; unlock?: string }[] = [
    { id: 'nursery' },
    { id: 'literati', unlock: 'sapling:literati' },
    { id: 'collected', unlock: 'sapling:collected' },
  ];
  return (
    <>
      <h2>Start a tree</h2>
      <p className="lead">Each species grows, bends and heals differently.</p>
      {SPECIES_IDS.map((id) => {
        const sp = SPECIES[id];
        return (
          <button key={id} className="option" aria-pressed={species === id} onClick={() => setSpecies(id)} data-testid={`species-${id}`}>
            <span className="o-swatch" style={{ background: SPECIES_TINT[id], color: SPECIES_INK[id] }}>
              <TreeMark style={{ width: 30, height: 30 }} />
            </span>
            <span>
              <span className="o-name">{sp.name}</span> <span className="o-latin">{sp.latin}</span>
              <span className="o-desc" style={{ display: 'block' }}>
                {sp.blurb}
              </span>
              <span className="traits">
                {sp.traits.map((t) => (
                  <span key={t} className="trait">
                    {t}
                  </span>
                ))}
              </span>
            </span>
          </button>
        );
      })}
      <div className="row" style={{ margin: '6px 0 16px' }} role="group" aria-label="Starting material">
        {presets.map((p) => {
          const locked = !hasUnlock(p.unlock);
          return (
            <button key={p.id} className="chip" aria-pressed={preset === p.id} disabled={locked} onClick={() => setPreset(p.id)} title={locked ? unlockDef(p.unlock!)?.description : undefined}>
              {locked && <IconLock />}
              {PRESET_LABELS[p.id]}
            </button>
          );
        })}
      </div>
      <button className="btn primary wide" onClick={() => newTree(species, preset)} data-testid="plant">
        <IconPlus /> Put it on the bench
      </button>
    </>
  );
}

function TreeOptions({ id }: { id: string }) {
  const r = useStore((s) => s.trees[id]);
  const activeId = useStore((s) => s.activeId);
  const route = useStore((s) => s.route);
  if (!r) return null;
  const style = styleOf(r);
  return (
    <>
      <h2>{r.name}</h2>
      <p className="lead">
        {SPECIES[r.species].name} · {STYLE_LABELS[style]}
        {r.styleOverride ? '' : ' (detected)'}
      </p>
      {(activeId !== id || route !== 'studio') && (
        <button className="menu-item" onClick={() => openTree(id)}>
          <TreeMark style={{ width: 22, height: 22 }} /> Open in Studio
        </button>
      )}
      <button className="menu-item" onClick={() => openSheet({ kind: 'rename', treeId: id })}>
        <IconPencil /> Rename
      </button>
      <button className="menu-item" onClick={() => openPortrait(id)}>
        <IconCamera /> Portrait mode
      </button>
      <div className="menu-item" style={{ flexWrap: 'wrap', padding: '10px 4px', gap: 6 }}>
        <span style={{ width: '100%', fontSize: 13, color: 'var(--muted)' }}>Style</span>
        <button className="chip" aria-pressed={!r.styleOverride} onClick={() => setStyleOverride(id, null)}>
          Auto
        </button>
        {(Object.keys(STYLE_LABELS) as TreeStyle[]).map((s) => (
          <button key={s} className="chip" aria-pressed={r.styleOverride === s} onClick={() => setStyleOverride(id, s)}>
            {STYLE_LABELS[s]}
          </button>
        ))}
      </div>
      <button className="menu-item" onClick={() => openSheet({ kind: 'settings' })}>
        <IconSettings /> Sound &amp; settings
      </button>
      <button className="menu-item danger" onClick={() => openSheet({ kind: 'confirmDelete', treeId: id })}>
        <IconTrash /> Delete tree
      </button>
    </>
  );
}

function Rename({ id }: { id: string }) {
  const r = useStore((s) => s.trees[id]);
  const [name, setName] = useState(r?.name ?? '');
  if (!r) return null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        renameTree(id, name);
      }}
    >
      <h2>Name this tree</h2>
      <p className="lead">A good name is part of the presentation.</p>
      <input className="field" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Tree name" autoFocus />
      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" className="btn grow" onClick={closeSheet}>
          Cancel
        </button>
        <button type="submit" className="btn primary grow" disabled={!name.trim()}>
          Save name
        </button>
      </div>
    </form>
  );
}

function ConfirmDelete({ id }: { id: string }) {
  const r = useStore((s) => s.trees[id]);
  if (!r) return null;
  return (
    <>
      <h2>Delete “{r.name}”?</h2>
      <p className="lead">This removes the tree and its edit history from this device. Portraits you saved stay in the Gallery.</p>
      <div className="row">
        <button className="btn grow" onClick={closeSheet}>
          Keep it
        </button>
        <button className="btn cut grow" onClick={() => deleteTree(id)} data-testid="confirm-delete">
          <IconTrash /> Delete
        </button>
      </div>
    </>
  );
}

function ChallengeIntro({ challengeId, variantId }: { challengeId: string; variantId: string }) {
  const def = challengeDef(challengeId);
  const v = variantDef(challengeId, variantId);
  if (!def || !v) return null;
  const existing = challengeRecords(challengeId, variantId);
  return (
    <>
      <div className="eyebrow">Challenge</div>
      <h2>
        {def.title} · {v.name}
      </h2>
      <p className="lead">{def.brief}</p>
      <ul style={{ paddingLeft: 18, margin: '0 0 14px', color: 'var(--ink-2)', fontSize: 14 }}>
        {def.tips.map((t) => (
          <li key={t} style={{ marginBottom: 4 }}>
            {t}
          </li>
        ))}
        {v.budget !== undefined && <li>Budget: {v.budget} moves.</li>}
        {v.maxPrimaries !== undefined && <li>Keep at most {v.maxPrimaries} primary branches.</li>}
        {v.maxCrossings !== undefined && <li>At most {v.maxCrossings} crossing branch visible from the front.</li>}
      </ul>
      <p className="hint" style={{ marginBottom: 14 }}>
        Judged on: {Object.keys(def.weights).join(', ')}. Stars at 60 · 74 · 87.
      </p>
      {existing.length > 0 && (
        <button className="btn wide" style={{ marginBottom: 8 }} onClick={() => openTree(existing[0]!.id)}>
          Continue your attempt
        </button>
      )}
      <button className="btn primary wide" onClick={() => startChallenge(challengeId, variantId)} data-testid="begin-challenge">
        {existing.length ? 'Start a fresh attempt' : 'Begin'}
      </button>
    </>
  );
}

function ChallengeResultView({ sheet }: { sheet: Extract<NonNullable<Sheet>, { kind: 'challengeResult' }> }) {
  const { result, unlocked } = sheet;
  const r = useStore((s) => s.trees[sheet.treeId]);
  const def = r?.challenge ? challengeDef(r.challenge.challengeId) : undefined;
  const headline = !result.passed
    ? 'Not quite ready for the judges'
    : result.stars === 3
      ? 'A masterpiece'
      : result.stars === 2
        ? 'Beautifully done'
        : result.stars === 1
          ? 'A worthy tree'
          : 'A promising start';
  return (
    <>
      <div className="eyebrow">{def?.title ?? 'Challenge'} · judged</div>
      <h2>{headline}</h2>
      <div className="result-score">
        <span className="big" data-testid="result-score">
          {result.score}
        </span>
        <Stars n={result.stars} />
      </div>
      {result.requirements.map((q) => (
        <div key={q.label} className={`req ${q.met ? 'met' : 'unmet'}`}>
          {q.met ? <IconCircleCheck /> : <IconCircleX />}
          <span>
            {q.label}
            <small>{q.detail}</small>
          </span>
        </div>
      ))}
      {unlocked.length > 0 && (
        <div className="unlock-banner" role="status">
          <strong>Unlocked</strong>
          {unlockNames(unlocked).join(' · ')}
        </div>
      )}
      <div style={{ margin: '8px 0 14px' }}>
        {result.metrics.map((m) => (
          <MetricBar key={m.id} m={m} />
        ))}
      </div>
      <div className="row">
        <button className="btn grow" onClick={closeSheet}>
          Keep refining
        </button>
        <button className="btn primary grow" onClick={() => navigate('challenges')}>
          All challenges
        </button>
      </div>
    </>
  );
}

function SettingsSheet() {
  const st = useStore((s) => s.profile.settings);
  return (
    <>
      <h2>Sound &amp; settings</h2>
      <p className="lead">Sound respects your device’s silent switch where supported.</p>
      <div className="stack">
        <button className="chip" aria-pressed={!st.muted} onClick={() => updateSettings({ muted: !st.muted })}>
          Sound effects {st.muted ? 'off' : 'on'}
        </button>
        <div className="slider">
          <label htmlFor="vol">Volume</label>
          <input id="vol" type="range" min={0} max={1} step={0.05} value={st.volume} onChange={(e) => updateSettings({ volume: Number(e.target.value) })} />
          <output>{Math.round(st.volume * 100)}%</output>
        </div>
        <button className="chip" aria-pressed={st.ambient} onClick={() => updateSettings({ ambient: !st.ambient })}>
          Garden ambience {st.ambient ? 'on' : 'off'}
        </button>
        <button className="chip" aria-pressed={st.haptics} onClick={() => updateSettings({ haptics: !st.haptics })}>
          Haptics {st.haptics ? 'on' : 'off'} <span style={{ opacity: 0.6, fontWeight: 400 }}>(where supported)</span>
        </button>
      </div>
      <p className="hint" style={{ marginTop: 16, fontSize: 12.5 }}>
        Your trees are saved on this device only. Clearing website data removes them.
      </p>
      <button className="btn wide" style={{ marginTop: 8 }} onClick={closeSheet}>
        Done
      </button>
    </>
  );
}
