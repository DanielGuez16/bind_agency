/**
 * Internationalisation de l'application.
 *
 * Langue détectée depuis l'appareil au premier lancement, surchargeable par
 * l'utilisateur, choix persisté, repli sur l'anglais.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18n } from 'i18n-js';
import { getLocales } from 'expo-localization';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { en } from './en';
import { es } from './es';

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const FALLBACK_LOCALE: SupportedLocale = 'en';
const STORAGE_KEY = 'bind.locale';

export const catalogues = { en, es };

function createI18n(locale: SupportedLocale): I18n {
  const i18n = new I18n(catalogues);
  i18n.defaultLocale = FALLBACK_LOCALE;
  i18n.enableFallback = true;
  i18n.locale = locale;
  return i18n;
}

export function isSupported(value: string | null | undefined): value is SupportedLocale {
  return SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

/** Langue de l'appareil si on la parle, anglais sinon. */
export function detectDeviceLocale(): SupportedLocale {
  const languageCode = getLocales?.()?.[0]?.languageCode;
  return isSupported(languageCode) ? languageCode : FALLBACK_LOCALE;
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

type I18nValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: Translate;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: SupportedLocale;
}) {
  const [locale, setLocaleState] = useState<SupportedLocale>(
    initialLocale ?? detectDeviceLocale(),
  );

  // Le choix persisté l'emporte sur la langue de l'appareil, mais seulement
  // après le premier rendu : l'écran ne doit pas attendre le disque pour
  // s'afficher.
  useEffect(() => {
    if (initialLocale) return;
    let annule = false;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!annule && isSupported(stored)) setLocaleState(stored);
      })
      .catch(() => {
        // Un stockage indisponible ne doit pas empêcher l'app de s'afficher.
      });

    return () => {
      annule = true;
    };
  }, [initialLocale]);

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<I18nValue>(() => {
    const i18n = createI18n(locale);
    return {
      locale,
      setLocale,
      t: (key, params) => i18n.t(key, params),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) {
    throw new Error('useI18n doit être utilisé dans un I18nProvider');
  }
  return value;
}
