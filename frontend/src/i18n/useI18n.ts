import { useContext } from 'react';
import { I18nContext, type I18nContextType } from './context';
import { SUPPORTED_LANGUAGES } from './languages';
import { enTranslations, type TranslationKey } from './locales/en';

export function useI18n(): I18nContextType {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      currentLanguage: SUPPORTED_LANGUAGES[0],
      setLanguage: async () => {},
      t: (key: TranslationKey) => enTranslations[key] || key,
      isLoading: false,
      isBackendActive: false,
      error: null,
      shouldShowSpotlight: false,
      dismissSpotlight: () => {},
    };
  }
  return ctx;
}
