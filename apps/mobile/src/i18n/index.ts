import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import ko from './ko.json';
import en from './en.json';

const deviceLang = Localization.getLocales()[0]?.languageCode ?? 'ko';

i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
  },
  lng: deviceLang === 'ko' ? 'ko' : 'en',
  fallbackLng: 'ko',
  interpolation: { escapeValue: false },
});

const LOCALE_MAP: Record<string, string> = { ko: 'ko-KR', en: 'en-US' };

export function getDateLocale(): string {
  return LOCALE_MAP[i18n.language] ?? 'en-US';
}

export default i18n;
