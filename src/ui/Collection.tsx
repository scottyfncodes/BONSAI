import { dismissNotice, openSheet, openTree, readThumb } from '../app/actions';
import { useStore } from '../app/store';
import { Seal } from './art';
import { STYLE_LABELS, ageYears, styleOf } from '../game/model';
import { SPECIES } from '../tree/species';
import { IconMore, IconPlus, IconSettings, IconStar, TreeMark } from './icons';

export function Collection() {
  const trees = useStore((s) => s.trees);
  const order = useStore((s) => s.order);
  const activeId = useStore((s) => s.activeId);
  const notice = useStore((s) => s.notice);
  useStore((s) => s.thumbs);
  const list = order.map((id) => trees[id]!).filter(Boolean);
  return (
    <div className="page" data-testid="collection">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <div className="eyebrow">
              <Seal size={22} /> Your bench
            </div>
            <h1>Collection</h1>
            <p>
              {list.length} tree{list.length === 1 ? '' : 's'} in progress
            </p>
          </div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="icon-btn" onClick={() => openSheet({ kind: 'settings' })} aria-label="Settings and backups" data-testid="open-settings">
              <IconSettings />
            </button>
            <button className="btn primary" onClick={() => openSheet({ kind: 'newTree' })} data-testid="new-tree">
              <IconPlus /> New tree
            </button>
          </div>
        </div>
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button onClick={dismissNotice}>OK</button>
          </div>
        )}
        {list.length === 0 ? (
          <div className="empty">
            <TreeMark />
            <h2>Your bench is empty</h2>
            <p>Every collection begins with one sapling. Choose a species and make your first cut.</p>
            <button className="btn primary" onClick={() => openSheet({ kind: 'newTree' })}>
              <IconPlus /> Start a sapling
            </button>
          </div>
        ) : (
          <div className="grid">
            {list.map((r) => {
              const thumb = readThumb(r.id);
              const best = r.history.reduce((m, a) => Math.max(m, a.stars), 0);
              return (
                <div key={r.id} style={{ position: 'relative' }}>
                  <button className="card" style={{ width: '100%' }} onClick={() => openTree(r.id)} data-testid="tree-card">
                    <div className="card-art">
                      {thumb ? <img src={thumb} alt="" /> : <TreeMark className="placeholder" />}
                      {r.id === activeId && <span className="card-badge active">On the bench</span>}
                      {r.challenge && r.id !== activeId && (
                        <span className="card-badge">
                          {best > 0 ? (
                            <>
                              {Array.from({ length: best }, (_, i) => (
                                <IconStar key={i} style={{ width: 11, height: 11, color: 'var(--gold)' }} />
                              ))}
                            </>
                          ) : (
                            'Challenge'
                          )}
                        </span>
                      )}
                    </div>
                    <div className="card-body">
                      <h3>{r.name}</h3>
                      <div className="card-meta">
                        {SPECIES[r.species].name} · {STYLE_LABELS[styleOf(r)]}
                      </div>
                      <div className="card-meta">{ageYears(r)} years old</div>
                    </div>
                  </button>
                  <button className="card-more" onClick={() => openSheet({ kind: 'treeOptions', treeId: r.id })} aria-label={`Options for ${r.name}`}>
                    <IconMore />
                  </button>
                </div>
              );
            })}
            <button className="new-card" onClick={() => openSheet({ kind: 'newTree' })}>
              <IconPlus />
              New tree
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
