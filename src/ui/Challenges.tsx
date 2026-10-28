import { challengeRecords, hasUnlock, openSheet, openTree } from '../app/actions';
import { useStore } from '../app/store';
import { CHALLENGES } from '../game/challenges';
import { unlockDef } from '../game/unlocks';
import { SPECIES } from '../tree/species';
import { IconCheck, IconChevron, IconLock, TreeMark } from './icons';
import { Stars } from './Studio';

export function Challenges() {
  const profile = useStore((s) => s.profile);
  useStore((s) => s.trees);
  return (
    <div className="page" data-testid="challenges">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <div className="eyebrow">Artistic challenges</div>
            <h1>Challenges</h1>
            <p>Each has many right answers. Scores explain themselves.</p>
          </div>
        </div>
        {CHALLENGES.map((def) => {
          const bestStars = Math.max(0, ...def.variants.map((v) => profile.best[v.id]?.stars ?? 0));
          return (
            <section key={def.id} className="challenge" aria-labelledby={`ch-${def.id}`}>
              <div className={`challenge-hero hero-${def.id}`}>
                <TreeMark className="art" />
                <Stars n={bestStars} />
                <h2 id={`ch-${def.id}`}>{def.title}</h2>
                <p>{def.tagline}</p>
              </div>
              <div className="challenge-body">
                {def.variants.map((v) => {
                  const locked = !hasUnlock(v.unlock);
                  const best = profile.best[v.id];
                  const inProgress = challengeRecords(def.id, v.id)[0];
                  return (
                    <button
                      key={v.id}
                      className={`variant${locked ? ' locked' : ''}`}
                      onClick={() => (locked ? undefined : inProgress ? openTree(inProgress.id) : openSheet({ kind: 'challengeIntro', challengeId: def.id, variantId: v.id }))}
                      disabled={locked}
                      data-testid={`variant-${v.id}`}
                    >
                      <div className="v-main">
                        <div className="v-name">{v.name}</div>
                        <div className="v-meta">
                          {locked
                            ? `Locked – ${unlockDef(v.unlock!)?.description ?? 'earn more stars'}`
                            : `${SPECIES[v.species].name}${v.budget ? ` · ${v.budget} moves` : ''}${best ? ` · best ${best.score}` : ''}${inProgress ? ' · in progress' : ''}`}
                        </div>
                      </div>
                      {locked ? <IconLock style={{ width: 20, height: 20 }} /> : best ? <Stars n={best.stars} /> : null}
                      {!locked && <IconChevron style={{ width: 20, height: 20, color: 'var(--muted)' }} />}
                    </button>
                  );
                })}
                <div className="rewards" aria-label="Rewards">
                  {([1, 2, 3] as const).map((lvl) =>
                    def.rewards[lvl].map((key) => {
                      const earned = profile.claimed.includes(`${def.id}:${lvl}`);
                      return (
                        <span key={key} className={`reward${earned ? ' earned' : ''}`} title={unlockDef(key)?.description}>
                          {earned ? <IconCheck /> : <IconLock />}
                          {'★'.repeat(lvl)} {unlockDef(key)?.name ?? key}
                        </span>
                      );
                    }),
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
