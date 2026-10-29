import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { boot } from './app/actions';
import './styles.css';
import { App } from './ui/App';

// iOS Safari ignores user-scalable=no; stop page pinch-zoom from hijacking tree gestures.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

boot();
document.getElementById('splash')?.remove();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
