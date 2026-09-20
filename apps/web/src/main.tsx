import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MaxUI } from '@maxhub/max-ui';

import { App } from './App.js';
import '@maxhub/max-ui/dist/styles.css';
import './styles.css';

const root = document.getElementById('root');

if (!root) throw new Error('Root element was not found');

createRoot(root).render(
  <StrictMode>
    <MaxUI>
      <App />
    </MaxUI>
  </StrictMode>,
);
