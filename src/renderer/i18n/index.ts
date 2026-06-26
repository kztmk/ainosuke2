/**
 * i18n 初期化（§8.5）。Phase 1 は ja のみ。文字列はハードコードせずここのリソースを参照する。
 * 日付・数値は Intl 経由でフォーマットを一元化する（locale ヘルパ）。
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ja } from './ja.js';

export const LOCALE = 'ja-JP';

void i18n.use(initReactI18next).init({
  resources: { ja: { translation: ja } },
  lng: 'ja',
  fallbackLng: 'ja',
  interpolation: { escapeValue: false },
  returnNull: false,
});

const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
const numberFmt = new Intl.NumberFormat(LOCALE);

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

export function formatNumber(n: number): string {
  return numberFmt.format(n);
}

export default i18n;
