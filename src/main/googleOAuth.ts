/**
 * Google OAuth（Desktop / installed app）クライアント設定の読み込み。
 *
 * dev: プロジェクト直下の `google-oauth.local.json`（gitignore）から読む。未設置なら空＝未設定
 * （Google サインインは not_configured を返し、UI はエラー表示）。
 *
 * シークレットは Desktop 型なら Google 公式見解で「非機密」だが、git 履歴に残さないため
 * ローカル JSON 運用とする。prod 配布時は extraResources 等での注入に切替（Phase 4）。
 *
 * google-oauth.local.json の形:
 *   { "clientId": "xxxx.apps.googleusercontent.com", "clientSecret": "GOCSPX-..." }
 */
import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { GoogleOAuthConfig } from './services/googleAuth/googleAuth.js';

export function loadGoogleOAuth(): GoogleOAuthConfig {
  try {
    const p = path.join(app.getAppPath(), 'google-oauth.local.json');
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8')) as Partial<GoogleOAuthConfig>;
      return { clientId: j.clientId ?? '', clientSecret: j.clientSecret ?? '' };
    }
  } catch {
    /* 壊れた JSON 等は未設定扱い */
  }
  return { clientId: '', clientSecret: '' };
}
