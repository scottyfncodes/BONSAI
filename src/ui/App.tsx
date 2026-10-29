import { navigate } from '../app/actions';
import { type Route, useStore } from '../app/store';
import { Challenges } from './Challenges';
import { Collection } from './Collection';
import { Gallery } from './Gallery';
import { IconTabChallenges, IconTabCollection, IconTabGallery, IconTabStudio } from './icons';
import { PortraitMode } from './Portrait';
import { Sheets } from './Sheets';
import { Studio } from './Studio';

const TABS: { id: Route; label: string; Icon: typeof IconTabStudio }[] = [
  { id: 'studio', label: 'Studio', Icon: IconTabStudio },
  { id: 'challenges', label: 'Challenges', Icon: IconTabChallenges },
  { id: 'collection', label: 'Collection', Icon: IconTabCollection },
  { id: 'gallery', label: 'Gallery', Icon: IconTabGallery },
];

export function App() {
  const loaded = useStore((s) => s.loaded);
  const route = useStore((s) => s.route);
  const toasts = useStore((s) => s.toasts);
  const announcement = useStore((s) => s.announcement);
  if (!loaded) return <div className="splash">Bonsai</div>;
  return (
    <div className="app">
      <main className="screen">
        {/* The Studio stays mounted so the 3D view and camera survive tab switches. */}
        <div style={{ position: 'absolute', inset: 0, visibility: route === 'studio' ? 'visible' : 'hidden' }} aria-hidden={route !== 'studio'}>
          <Studio />
        </div>
        {route === 'challenges' && <Challenges />}
        {route === 'collection' && <Collection />}
        {route === 'gallery' && <Gallery />}
      </main>
      <nav className="tabbar" aria-label="Primary">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className="tab" aria-current={route === id ? 'page' : undefined} onClick={() => navigate(id)} data-testid={`tab-${id}`}>
            <Icon />
            <span>{label}</span>
            <span className="tab-dot" />
          </button>
        ))}
      </nav>
      <PortraitMode />
      <Sheets />
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
