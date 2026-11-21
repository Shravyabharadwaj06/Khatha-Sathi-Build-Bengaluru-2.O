import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DEFAULT_LANGUAGE, getLanguage } from './languages';
import type { TranslationKey } from './locales/en';
import { fetchLanguageTranslations, getTranslatedString } from './translationService';
import { I18nContext } from './context';

const STORAGE_LANG_KEY = 'chotu.selected_language';
const STORAGE_SPOTLIGHT_KEY = 'chotu.language_spotlight_dismissed';

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [langCode, setLangCode] = useState<string>(() => {
    return localStorage.getItem(STORAGE_LANG_KEY) || DEFAULT_LANGUAGE;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isBackendActive, setIsBackendActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDictionary, setActiveDictionary] = useState<Partial<Record<TranslationKey, string>>>({});

  const [shouldShowSpotlight, setShouldShowSpotlight] = useState<boolean>(() => {
    const dismissed = localStorage.getItem(STORAGE_SPOTLIGHT_KEY);
    const hasSavedLang = localStorage.getItem(STORAGE_LANG_KEY);
    return !dismissed && !hasSavedLang;
  });

  const currentLanguage = useMemo(() => getLanguage(langCode), [langCode]);

  const applyLanguage = useCallback(async (code: string) => {
    const lang = getLanguage(code);
    setIsLoading(true);
    setError(null);

    document.documentElement.dir = lang.dir;
    document.documentElement.lang = lang.code.split('_')[0];

    try {
      const { translations, isLive } = await fetchLanguageTranslations(code);
      setActiveDictionary(translations);
      setIsBackendActive(isLive);
    } catch {
      setError('Translation service unavailable. Showing English fallback.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    applyLanguage(langCode);
  }, [langCode, applyLanguage]);

  const setLanguage = useCallback(
    async (code: string) => {
      setLangCode(code);
      localStorage.setItem(STORAGE_LANG_KEY, code);
      localStorage.setItem(STORAGE_SPOTLIGHT_KEY, 'true');
      setShouldShowSpotlight(false);
      await applyLanguage(code);
    },
    [applyLanguage]
  );

  const dismissSpotlight = useCallback(() => {
    localStorage.setItem(STORAGE_SPOTLIGHT_KEY, 'true');
    setShouldShowSpotlight(false);
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      return getTranslatedString(key, langCode, activeDictionary);
    },
    [langCode, activeDictionary]
  );

  const value = useMemo(
    () => ({
      currentLanguage,
      setLanguage,
      t,
      isLoading,
      isBackendActive,
      error,
      shouldShowSpotlight,
      dismissSpotlight,
    }),
    [
      currentLanguage,
      setLanguage,
      t,
      isLoading,
      isBackendActive,
      error,
      shouldShowSpotlight,
      dismissSpotlight,
    ]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};
