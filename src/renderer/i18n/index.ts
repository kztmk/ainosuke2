/**
 * i18n 初期化（§8.5）。Phase 1 は ja のみ。文字列はハードコードせずここのリソースを参照する。
 * 日付・数値は Intl 経由でフォーマットを一元化する（locale ヘルパ）。
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Locale } from '../../shared/domain.js';
import { ja } from './ja.js';
import { en } from './en.js';

const INTL_LOCALE: Record<Locale, string> = { ja: 'ja-JP', en: 'en-US' };

void i18n.use(initReactI18next).init({
  resources: { ja: { translation: ja }, en: { translation: en } },
  lng: 'ja',
  fallbackLng: 'ja',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** 現在の言語に追従する Intl フォーマット（日付/数値の一元化・§8.5）。 */
function intlLocale(): string {
  return INTL_LOCALE[(i18n.language as Locale)] ?? 'ja-JP';
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(intlLocale()).format(n);
}

export default i18n;
