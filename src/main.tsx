import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { boot } from './app/actions';
import './styles.css';
import { App } from './ui/App';

boot();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
