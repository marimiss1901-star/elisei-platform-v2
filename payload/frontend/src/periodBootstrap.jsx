import React from 'react';
import { createRoot } from 'react-dom/client';
import GlobalPeriodBar from './components/GlobalPeriodBar.jsx';

const HOST_ID = 'elisei-global-period-host';

function findContentRoot() {
  const selectors = [
    '[data-elisei-main]',
    'main',
    '[role="main"]',
    '.main-content',
    '.content-area',
    '.dashboard-content',
    '.page-content',
    '#root',
  ];
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (node) return node;
  }
  return document.body;
}

function mountPeriodBar() {
  if (typeof document === 'undefined' || document.getElementById(HOST_ID)) return;
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-elisei-period-host', 'true');
  const target = findContentRoot();
  target.prepend(host);
  createRoot(host).render(
    <React.StrictMode>
      <GlobalPeriodBar />
    </React.StrictMode>,
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountPeriodBar, { once: true });
} else {
  mountPeriodBar();
}
