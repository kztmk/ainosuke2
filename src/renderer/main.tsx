import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n/index.js';
import { App } from './App.js';
import { AppStateProvider } from './state.js';
import { startLicenseAutoRefresh } from './firebase/licenseSync.js';
import './styles.css';

// ライセンストークンのバックグラウンド自動更新（サインイン＋サブスク有効時に exp 接近で再発行）
startLicenseAutoRefresh();

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
createRoot(container).render(
  <React.StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </React.StrictMode>,
);
