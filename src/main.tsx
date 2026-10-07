import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// react and react-dom are Preact (preact/compat, see vite.config.ts).
//
// Prerendered pages (scripts/prerender.ts) already show the first screen in #root: on
// a round page, its match cards. The app renders into a hidden element beside it and
// takes its place once it has the data to show (App calls onReady), so the cards don't
// turn back into loading placeholders while the data loads. Safety net: swap anyway
// after SWAP_AFTER_MS.
const SWAP_AFTER_MS = 15000;
const pre = document.getElementById('root')!;
let host = pre;
let swapped = true;
if (pre.firstElementChild) {
  host = document.createElement('div');
  host.hidden = true;
  pre.after(host);
  swapped = false;
}
const swap = () => {
  if (swapped) return;
  swapped = true;
  pre.remove();
  host.id = 'root';
  host.hidden = false;
};
// Swap once the crests of the first cards are decoded (they're cached: the prerendered
// page loaded them), so they don't blink; never wait more than a moment for that.
let readying = false;
const onReady = () => {
  if (swapped || readying) return;
  readying = true;
  const crests = [...host.querySelectorAll<HTMLImageElement>('.grid > .card:nth-child(-n+6) img.badge')]
    .map((img) => img.decode().catch(() => {}));
  Promise.race([Promise.all(crests), new Promise((r) => setTimeout(r, 200))]).then(swap);
};
setTimeout(swap, SWAP_AFTER_MS);

createRoot(host).render(
  <StrictMode>
    <App onReady={onReady} />
  </StrictMode>,
);
