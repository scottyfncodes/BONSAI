import { useCallback, useRef, useState } from 'react';
import { closePortrait, hasUnlock, toast } from '../app/actions';
import { getState, setState, useStore } from '../app/store';
import { sound } from '../audio/sound';
import { STYLE_LABELS, ageYears, calendarLabel, styleOf } from '../game/model';
import { putPortrait } from '../persist/portraits';
import { BACKGROUNDS, type Stage } from '../render/stage';
import { SPECIES } from '../tree/species';
import { downloadBlob, shareBlob, slug } from './Gallery';
import { IconCamera, IconClose, IconDownload, IconLock, IconShare, IconTurntable } from './icons';
import { TreeViewport } from './TreeViewport';

export function PortraitMode() {
  const id = useStore((s) => s.portraitId);
  const r = useStore((s) => (s.portraitId ? s.trees[s.portraitId] : undefined));
  const [bg, setBg] = useState(BACKGROUNDS[0]!.id);
  const [turntable, setTurntable] = useState(!matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Blob | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const onStage = useCallback((s: Stage | null) => {
    stageRef.current = s;
  }, []);
  if (!id || !r) return null;
  const background = BACKGROUNDS.find((b) => b.id === bg) ?? BACKGROUNDS[0]!;
  const sp = SPECIES[r.species];
  const lines = [`${sp.name} · ${STYLE_LABELS[styleOf(r)]}`, `${ageYears(r)} years · ${calendarLabel(r.work.tree)}`];

  const capture = async () => {
    const stage = stageRef.current;
    if (!stage || busy) return;
    setBusy(true);
    sound.unlock();
    try {
      const blob = await stage.capture({ width: 1200, height: 1500, background, caption: { title: r.name, lines } });
      if (!blob) throw new Error('capture failed');
      setLast(blob);
      sound.snip(0.1);
      try {
        await putPortrait({
          id: `p${Date.now().toString(36)}`,
          treeId: r.id,
          treeName: r.name,
          caption: `${r.name} – ${lines.join(' · ')}`,
          background: background.id,
          createdAt: Date.now(),
          blob,
        });
        setState({ galleryVersion: getState().galleryVersion + 1 });
        toast('Portrait saved to your Gallery.', 'success');
      } catch {
        toast('Couldn’t store the portrait here – use Save to download it.', 'warn');
      }
    } catch {
      toast('Couldn’t capture this view. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portrait" role="dialog" aria-modal="true" aria-label={`Portrait of ${r.name}`} data-testid="portrait">
      <TreeViewport work={r.work} interactive={false} turntable={turntable} scenery={background.scenery} onStage={onStage} framing={{ center: 0.4, fill: 0.56 }}>
        <div className="portrait-caption" style={{ color: background.ink }}>
          <h2>{r.name}</h2>
          {lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      </TreeViewport>
      <div className="portrait-top">
        <button className="icon-btn" onClick={closePortrait} aria-label="Close portrait mode">
          <IconClose />
        </button>
        <button className="icon-btn" aria-pressed={turntable} onClick={() => setTurntable(!turntable)} aria-label={turntable ? 'Stop turntable' : 'Start turntable'}>
          <IconTurntable />
        </button>
      </div>
      <div className="portrait-controls">
        <div className="row" style={{ justifyContent: 'center', gap: 10 }} role="group" aria-label="Backdrop">
          {BACKGROUNDS.map((b) => {
            const locked = !hasUnlock(b.unlock);
            return (
              <button
                key={b.id}
                className="bg-swatch"
                style={{ background: b.css }}
                aria-pressed={bg === b.id}
                aria-label={`${b.name}${locked ? ' – locked' : ''}`}
                disabled={locked}
                onClick={() => setBg(b.id)}
              >
                {locked && (
                  <span className="lock">
                    <IconLock />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          {last && (
            <>
              <button className="btn" onClick={() => downloadBlob(last, `${slug(r.name)}.png`)}>
                <IconDownload /> Save
              </button>
              <button
                className="btn"
                onClick={async () => {
                  if (!(await shareBlob(last, `${slug(r.name)}.png`, r.name))) downloadBlob(last, `${slug(r.name)}.png`);
                }}
              >
                <IconShare /> Share
              </button>
            </>
          )}
          <button className="btn primary" onClick={capture} disabled={busy} data-testid="capture">
            <IconCamera /> {busy ? 'Capturing…' : 'Capture'}
          </button>
        </div>
      </div>
    </div>
  );
}
