import { enTranslations, type TranslationKey } from './locales/en';
import { hiTranslations } from './locales/hi';
import { knTranslations } from './locales/kn';
import { urTranslations } from './locales/ur';

/**
 * Built-in static translations for high-frequency languages.
 * All other scheduled languages can be dynamically loaded or requested via IndicTrans2 backend service.
 */
const staticDictionaries: Record<string, Partial<Record<TranslationKey, string>>> = {
  eng_Latn: enTranslations,
  hin_Deva: hiTranslations,
  kan_Knda: knTranslations,
  urd_Arab: urTranslations,
};

export interface IndicTransRequest {
  srcLang: string;
  tgtLang: string;
  strings: Record<string, string>;
}

export interface IndicTransResponse {
  translatedStrings: Record<string, string>;
  modelUsed?: string;
}

const TRANSLATION_CACHE_KEY_PREFIX = 'chotu.i18n.cache.';

/**
 * Cache for dynamic translations retrieved via the backend service
 */
function getCachedTranslations(langCode: string): Partial<Record<TranslationKey, string>> | null {
  try {
    const raw = localStorage.getItem(`${TRANSLATION_CACHE_KEY_PREFIX}${langCode}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedTranslations(langCode: string, dict: Partial<Record<TranslationKey, string>>): void {
  try {
    localStorage.setItem(`${TRANSLATION_CACHE_KEY_PREFIX}${langCode}`, JSON.stringify(dict));
  } catch {
    // quota exceeded or private mode
  }
}

/**
 * In-memory registry of active translations
 */
const loadedTranslations: Record<string, Partial<Record<TranslationKey, string>>> = {
  ...staticDictionaries,
};

/**
 * Clean integration point for IndicTrans2 backend translation service.
 * In development / static frontend mode, it attempts to fetch from VITE_INDICTRANS2_API_URL
 * or falls back gracefully to cached/static strings and English defaults.
 */
export async function fetchLanguageTranslations(
  targetLang: string
): Promise<{ translations: Partial<Record<TranslationKey, string>>; isLive: boolean }> {
  // If we already have the language loaded in memory, return immediately
  if (loadedTranslations[targetLang] && Object.keys(loadedTranslations[targetLang]!).length > 0) {
    return { translations: loadedTranslations[targetLang]!, isLive: false };
  }

  // Check localStorage cache
  const cached = getCachedTranslations(targetLang);
  if (cached && Object.keys(cached).length > 0) {
    loadedTranslations[targetLang] = cached;
    return { translations: cached, isLive: false };
  }

  const backendUrl = import.meta.env.VITE_INDICTRANS2_API_URL;

  if (backendUrl) {
    try {
      const payload: IndicTransRequest = {
        srcLang: 'eng_Latn',
        tgtLang: targetLang,
        strings: enTranslations as Record<string, string>,
      };

      const res = await fetch(`${backendUrl}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data: IndicTransResponse = await res.json();
        if (data.translatedStrings) {
          const dict = data.translatedStrings as Partial<Record<TranslationKey, string>>;
          loadedTranslations[targetLang] = dict;
          setCachedTranslations(targetLang, dict);
          return { translations: dict, isLive: true };
        }
      }
    } catch {
      // Backend unavailable or network error
    }
  }

  // English fallback
  return { translations: {}, isLive: false };
}

/**
 * Synchronous lookup for a translation key with English fallback.
 */
export function getTranslatedString(
  key: TranslationKey,
  langCode: string,
  customDict?: Partial<Record<TranslationKey, string>>
): string {
  if (langCode === 'eng_Latn') {
    return enTranslations[key] || key;
  }

  if (customDict && customDict[key]) {
    return customDict[key]!;
  }

  const activeDict = loadedTranslations[langCode];
  if (activeDict && activeDict[key]) {
    return activeDict[key]!;
  }

  // Fallback to English
  return enTranslations[key] || key;
}
