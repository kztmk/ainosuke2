import { defineConfig } from 'electron-vite';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Firebase Web 構成は秘密ではないが、GitHub の Secret Scanning 回避と dev/prod 切替のため
// .env.dev / .env.prod（gitignore）から読み込み、renderer に define で注入する。
// dev(serve)=development → .env.dev、build=production → .env.prod。
export default defineConfig(({ mode }) => {
  const envName = mode === 'production' ? 'prod' : 'dev';
  const env = loadEnv(envName, process.cwd(), 'VITE_');
  const firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
  };

  return {
    main: {},
    preload: {},
    renderer: {
      plugins: [react(), tailwindcss()],
      define: {
        __FIREBASE_CONFIG__: JSON.stringify(firebaseConfig),
      },
    },
  };
});
