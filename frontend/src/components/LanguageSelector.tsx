import React, { useState, useRef, useEffect, useMemo, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n/useI18n';
import { SUPPORTED_LANGUAGES, type LanguageInfo } from '../i18n/languages';

interface LanguageSelectorProps {
  id?: string;
  variant?: 'light' | 'dark' | 'header';
  className?: string;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  id = 'lang-selector',
  variant = 'light',
  className = '',
}) => {
  const { currentLanguage, setLanguage, t, isLoading, shouldShowSpotlight, dismissSpotlight } = useI18n();

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter languages by query (name, nativeName, script, or code)
  const filteredLanguages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return SUPPORTED_LANGUAGES;
    return SUPPORTED_LANGUAGES.filter(
      (lang) =>
        lang.name.toLowerCase().includes(q) ||
        lang.nativeName.toLowerCase().includes(q) ||
        lang.script.toLowerCase().includes(q) ||
        lang.code.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // First-visit spotlight state: spotlight active on this selector
  const [isSpotlightActive, setIsSpotlightActive] = useState(false);

  useEffect(() => {
    if (shouldShowSpotlight) {
      setIsSpotlightActive(true);
      // Auto-dismiss spotlight after 2000ms as required
      const timer = setTimeout(() => {
        setIsSpotlightActive(false);
        dismissSpotlight();
      }, 2000);
      return () => clearTimeout(timer);
    } else {
      setIsSpotlightActive(false);
    }
  }, [shouldShowSpotlight, dismissSpotlight]);

  // Handle outside clicks to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setHighlightedIndex(0);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const handleSelectLanguage = (lang: LanguageInfo) => {
    setLanguage(lang.code);
    setIsOpen(false);
    if (isSpotlightActive) {
      setIsSpotlightActive(false);
      dismissSpotlight();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % filteredLanguages.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + filteredLanguages.length) % filteredLanguages.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredLanguages[highlightedIndex]) {
        handleSelectLanguage(filteredLanguages[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  // Button visual variants matching design tokens:
  // Ink: #0F0F56, Blue: #C2DCE3, Yellow: #EDEA43, White: #FFFFFF
  const isDarkVariant = variant === 'dark';

  return (
    <div
      ref={containerRef}
      id={id}
      className={`relative inline-block text-left ${className}`}
      style={{ zIndex: isSpotlightActive || isOpen ? 100 : 30 }}
    >
      {/* Dimmed backdrop when spotlight is active */}
      {isSpotlightActive && (
        <div
          className="fixed inset-0 bg-[#0F0F56]/80 transition-opacity duration-300 pointer-events-none"
          style={{ zIndex: 90 }}
          aria-hidden="true"
        />
      )}

      {/* Main Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`${t('lang.selector.label')}: ${currentLanguage.name} (${currentLanguage.nativeName})`}
        className={`inline-flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-lg border text-xs sm:text-sm font-semibold transition-all relative ${
          isDarkVariant
            ? 'bg-[#0F0F56] text-white border-white/20 hover:bg-[#1a1a70]'
            : 'bg-white text-[#0F0F56] border-[#0F0F56]/20 hover:bg-[#f4f4f0]'
        } ${
          isSpotlightActive
            ? 'ring-4 ring-[#EDEA43] shadow-[0_0_20px_rgba(237,234,67,0.8)] scale-105 z-[100]'
            : 'shadow-sm'
        }`}
        style={{
          boxShadow: isSpotlightActive
            ? '0 0 0 4px #EDEA43, 0 10px 25px -5px rgba(15,15,86,0.5)'
            : '2px 2px 0px rgba(15,15,86,0.15)',
        }}
      >
        <span className="material-symbols-outlined text-base text-[#0F0F56]/70 leading-none" aria-hidden="true">
          language
        </span>
        <span className="font-bold flex items-center gap-1.5">
          <span>{currentLanguage.nativeName}</span>
          <span className="opacity-60 text-xs hidden sm:inline">({currentLanguage.name})</span>
        </span>
        {isLoading ? (
          <span className="w-3.5 h-3.5 border-2 border-[#0F0F56] border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className="material-symbols-outlined text-base opacity-70 leading-none">
            {isOpen ? 'expand_less' : 'expand_more'}
          </span>
        )}
      </button>

      {/* Friendly First-Visit Tooltip */}
      {isSpotlightActive && (
        <div
          role="tooltip"
          className="absolute top-full mt-2.5 right-0 sm:left-0 bg-[#EDEA43] text-[#0F0F56] p-3 rounded-lg shadow-xl border-2 border-[#0F0F56] min-w-[260px] sm:min-w-[300px] z-[101] animate-in fade-in zoom-in-95 duration-200"
          style={{
            boxShadow: '3px 3px 0px #0F0F56',
          }}
        >
          {/* Arrow pointing up */}
          <div
            className="absolute -top-2 right-6 sm:left-6 w-3 h-3 bg-[#EDEA43] border-t-2 border-l-2 border-[#0F0F56] rotate-45"
            aria-hidden="true"
          />
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-xl text-[#0F0F56]">translate</span>
              <p className="font-bold text-xs sm:text-sm leading-tight text-[#0F0F56]">
                {t('lang.spotlight.tooltip')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsSpotlightActive(false);
                dismissSpotlight();
              }}
              className="text-[#0F0F56] hover:opacity-75 font-bold text-xs uppercase px-1 py-0.5 border border-[#0F0F56]/40 rounded bg-white/40"
              aria-label="Dismiss language spotlight"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Searchable Accessible Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 sm:right-auto sm:left-0 mt-2 w-72 sm:w-80 bg-white rounded-xl border-2 border-[#0F0F56] shadow-[4px_4px_0px_#0F0F56] overflow-hidden z-[110] animate-in fade-in-50 duration-150"
          role="listbox"
          aria-label="Select website language"
        >
          {/* Search Header */}
          <div className="p-2.5 bg-[#FAF9F5] border-b border-[#0F0F56]/15">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-2 text-[#0F0F56]/50 text-lg pointer-events-none">
                search
              </span>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('lang.selector.searchPlaceholder')}
                className="w-full pl-9 pr-8 py-1.5 text-xs sm:text-sm bg-white border border-[#0F0F56]/30 rounded-md text-[#1b1c1a] focus:outline-none focus:border-[#0F0F56] focus:ring-1 focus:ring-[#0F0F56]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2 text-xs text-gray-500 hover:text-black"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="flex items-center justify-between mt-1 px-1 text-[11px] text-[#464650] font-medium">
              <span>IndicTrans2 (22 Scheduled Languages)</span>
              <span>{filteredLanguages.length} available</span>
            </div>
          </div>

          {/* Languages Scroll List */}
          <div
            ref={listRef}
            className="max-h-64 overflow-y-auto py-1 divide-y divide-[#0F0F56]/5"
            style={{ overscrollBehavior: 'contain' }}
          >
            {filteredLanguages.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-500 font-medium">
                {t('lang.selector.noResults')}
              </div>
            ) : (
              filteredLanguages.map((lang, idx) => {
                const isSelected = lang.code === currentLanguage.code;
                const isHighlighted = idx === highlightedIndex;

                return (
                  <button
                    key={lang.code}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectLanguage(lang)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between text-xs sm:text-sm transition-colors ${
                      isSelected
                        ? 'bg-[#C2DCE3] font-bold text-[#0F0F56]'
                        : isHighlighted
                        ? 'bg-[#f4f4f0] text-[#0F0F56]'
                        : 'text-[#1b1c1a] hover:bg-[#FAF9F5]'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm leading-tight flex items-center gap-1.5">
                        <span style={{ fontFamily: lang.fontFamily }}>{lang.nativeName}</span>
                        {lang.dir === 'rtl' && (
                          <span className="text-[10px] px-1 bg-yellow-200 text-yellow-900 rounded font-normal">
                            RTL
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-gray-500 font-normal">
                        {lang.name} • {lang.script} ({lang.code.split('_')[0]})
                      </span>
                    </div>
                    {isSelected && (
                      <span className="material-symbols-outlined text-base text-[#0F0F56]">check</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
