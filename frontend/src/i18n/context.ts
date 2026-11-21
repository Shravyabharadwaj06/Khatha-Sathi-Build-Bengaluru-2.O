import { createContext } from 'react';
import type { LanguageInfo } from './languages';
import type { TranslationKey } from './locales/en';

export interface I18nContextType {
  currentLanguage: LanguageInfo;
  setLanguage: (langCode: string) => Promise<void>;
  t: (key: TranslationKey) => string;
  isLoading: boolean;
  isBackendActive: boolean;
  error: string | null;
  shouldShowSpotlight: boolean;
  dismissSpotlight: () => void;
}

export const I18nContext = createContext<I18nContextType | null>(null);
