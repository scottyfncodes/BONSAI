import { useEffect, useMemo, useState } from 'react';
import { openPortrait, readThumb, toast } from '../app/actions';
import { getState, setState, useStore } from '../app/store';
import { Seal } from './art';
import { type Portrait, deletePortrait, listPortraits } from '../persist/portraits';
import { IconCamera, IconClose, IconDownload, IconShare, IconTrash, TreeMark } from './icons';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function shareBlob(blob: Blob, filename: string, title: string): Promise<boolean> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bonsai';

export function Gallery() {
  const version = useStore((s) => s.galleryVersion);
  const trees = useStore((s) => s.trees);
  const order = useStore((s) => s.order);
  const activeId = useStore((s) => s.activeId);
  useStore((s) => s.thumbs);
  const [portraits, setPortraits] = useState<Portrait[] | null>(null);
  const [error, setError] = useState(false);
  const [viewing, setViewing] = useState<Portrait | null>(null);

  useEffect(() => {
    let alive = true;
    listPortraits()
      .then((p) => alive && setPortraits(p))
      .catch(() => {
        if (alive) {
          setError(true);
          setPortraits([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [version]);

  const urls = useMemo(() => new Map((portraits ?? []).map((p) => [p.id, URL.createObjectURL(p.blob)])), [portraits]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const list = order.map((id) => trees[id]!).filter(Boolean);
  const startTree = activeId ?? list[0]?.id;

  return (
    <div className="page" data-testid="gallery">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <div className="eyebrow">
              <Seal size={22} /> Presentation
            </div>
            <h1>Gallery</h1>
            <p>Portraits of your trees, framed and lit for keeps.</p>
          </div>
          {startTree && (
            <button className="btn primary" onClick={() => openPortrait(startTree)}>
              <IconCamera /> Portrait
            </button>
          )}
        </div>
        {error && <div className="notice">Portrait storage isn’t available in this browser mode. You can still download portraits as you take them.</div>}
        {portraits && portraits.length === 0 && !error && (
          <div className="empty" style={{ paddingTop: 20 }}>
            <IconCamera />
            <h2>No portraits yet</h2>
            <p>Open a tree in Portrait mode, choose a backdrop and capture it. Portraits never include the interface.</p>
          </div>
        )}
        {portraits && portraits.length > 0 && (
          <div className="portrait-grid">
            {portraits.map((p) => (
              <button key={p.id} className="portrait-tile" onClick={() => setViewing(p)} aria-label={`Portrait of ${p.treeName}`}>
                <img src={urls.get(p.id)} alt={p.caption} />
              </button>
            ))}
          </div>
        )}
        {list.length > 0 && (
          <>
            <h2 className="section-title">Your trees</h2>
            <div className="grid">
              {list.map((r) => {
                const thumb = readThumb(r.id);
                return (
                  <button key={r.id} className="card" onClick={() => openPortrait(r.id)}>
                    <div className="card-art">{thumb ? <img src={thumb} alt="" /> : <TreeMark className="placeholder" />}</div>
                    <div className="card-body">
                      <h3>{r.name}</h3>
                      <div className="card-meta">Open portrait mode</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      {viewing && (
        <div className="viewer" role="dialog" aria-modal="true" aria-label={viewing.caption} onClick={(e) => e.target === e.currentTarget && setViewing(null)}>
          <img src={urls.get(viewing.id)} alt={viewing.caption} />
          <div className="row">
            <button className="btn" onClick={() => downloadBlob(viewing.blob, `${slug(viewing.treeName)}.png`)}>
              <IconDownload /> Save
            </button>
            <button
              className="btn"
              onClick={async () => {
                const ok = await shareBlob(viewing.blob, `${slug(viewing.treeName)}.png`, viewing.treeName);
                if (!ok) downloadBlob(viewing.blob, `${slug(viewing.treeName)}.png`);
              }}
            >
              <IconShare /> Share
            </button>
            <button
              className="btn"
              onClick={async () => {
                await deletePortrait(viewing.id).catch(() => toast('Could not delete portrait.', 'error'));
                setViewing(null);
                setState({ galleryVersion: getState().galleryVersion + 1 });
              }}
              aria-label="Delete portrait"
            >
              <IconTrash />
            </button>
            <button className="btn" onClick={() => setViewing(null)} aria-label="Close">
              <IconClose />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
