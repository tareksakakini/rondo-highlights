import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// react and react-dom are Preact (preact/compat, see vite.config.ts). Prerendered pages
// put static content in #root for crawlers; clear it rather than have Preact diff
// against it, as React's createRoot would.
const root = document.getElementById('root')!;
root.textContent = '';
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
