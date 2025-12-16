/* eslint-disable react-refresh/only-export-components */
// =============================================================================
// i18n - Internationalization System
// Extensible for future language additions (ja, zh, es, etc.)
// =============================================================================

export type Language = 'ko' | 'en';

export const SUPPORTED_LANGUAGES: { code: Language; name: string; nativeName: string }[] = [
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'en', name: 'English', nativeName: 'English' },
  // Future: { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  // Future: { code: 'zh', name: 'Chinese', nativeName: '中文' },
  // Future: { code: 'es', name: 'Spanish', nativeName: 'Español' },
];

export const DEFAULT_LANGUAGE: Language = 'ko';

// UI Translations
export const translations: Record<Language, Record<string, string>> = {
  ko: {
    // Navigation
    'nav.home': '홈',
    'nav.journey': '여정',
    'nav.countries': '국가',
    'nav.about': '소개',

    // Journey
    'journey.title': '세계일주 배낭여행',
    'journey.subtitle': '345일간의 여정',
    'journey.scrollToExplore': '스크롤하여 탐험하기',
    'journey.flying': '비행 중',
    'journey.walking': '이동 중',
    'journey.destination': '목적지',
    'journey.transport': '이동수단',
    'journey.days': '일',
    'journey.cities': '도시',
    'journey.stop': '번째 방문지',
    'journey.of': '/',
    'journey.photoComingSoon': '사진 추가 예정',
    'journey.complete': '여행 완료',

    // Transport
    'transport.bus': '버스',
    'transport.train': '기차',
    'transport.flight': '비행기',
    'transport.boat': '보트',
    'transport.trek': '트레킹',
    'transport.start': '출발',

    // Continents
    'continent.asia': '아시아',
    'continent.middle-east': '중동',
    'continent.africa': '아프리카',
    'continent.europe': '유럽',
    'continent.south-america': '남미',

    // Common
    'common.next': '다음',
    'common.prev': '이전',
    'common.close': '닫기',
    'common.language': '언어',
  },
  en: {
    // Navigation
    'nav.home': 'Home',
    'nav.journey': 'Journey',
    'nav.countries': 'Countries',
    'nav.about': 'About',

    // Journey
    'journey.title': 'World Backpacking Trip',
    'journey.subtitle': '345 Days Around the World',
    'journey.scrollToExplore': 'Scroll to explore',
    'journey.flying': 'In Flight',
    'journey.walking': 'Traveling',
    'journey.destination': 'Destination',
    'journey.transport': 'Transport',
    'journey.days': 'days',
    'journey.cities': 'cities',
    'journey.stop': 'th stop',
    'journey.of': 'of',
    'journey.photoComingSoon': 'Photos coming soon',
    'journey.complete': 'Journey Complete',

    // Transport
    'transport.bus': 'Bus',
    'transport.train': 'Train',
    'transport.flight': 'Flight',
    'transport.boat': 'Boat',
    'transport.trek': 'Trek',
    'transport.start': 'Start',

    // Continents
    'continent.asia': 'Asia',
    'continent.middle-east': 'Middle East',
    'continent.africa': 'Africa',
    'continent.europe': 'Europe',
    'continent.south-america': 'South America',

    // Common
    'common.next': 'Next',
    'common.prev': 'Previous',
    'common.close': 'Close',
    'common.language': 'Language',
  },
};

// Hook for translations
import { useState, useEffect, createContext, useContext } from 'react';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  getLocalizedName: (obj: { ko?: string; en?: string } | string) => string;
}

export const I18nContext = createContext<I18nContextType | null>(null);

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('language') as Language;
      if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
        return saved;
      }
      // Detect browser language
      const browserLang = navigator.language.split('-')[0];
      if (browserLang === 'ko') return 'ko';
    }
    return DEFAULT_LANGUAGE;
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('language', lang);
    }
  };

  const t = (key: string): string => {
    return translations[language][key] || translations[DEFAULT_LANGUAGE][key] || key;
  };

  const getLocalizedName = (obj: { ko?: string; en?: string } | string): string => {
    if (typeof obj === 'string') return obj;
    return obj[language] || obj[DEFAULT_LANGUAGE] || obj.en || obj.ko || '';
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, getLocalizedName }}>
      {children}
    </I18nContext.Provider>
  );
}
