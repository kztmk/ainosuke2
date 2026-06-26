import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n/index.js';
import { App } from './App.js';
import { AppStateProvider } from './state.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
createRoot(container).render(
  <React.StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </React.StrictMode>,
);
