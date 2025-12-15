// Country and travel data types

export interface CountryName {
  en: string;
  ko: string;
  native: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface CountryTheme {
  primary: string;
  secondary: string;
  pattern: string;
  gradient: string;
}

export interface CountryVisit {
  order: number;
  startDate: string;
  endDate: string;
  cities: string[];
  note?: string; // e.g., "결혼식 사회로 잠깐 귀국"
}

export interface CountryStats {
  days: number;
  cities: number;
}

export interface Country {
  code: string;
  name: CountryName;
  slug: string;
  continent: 'asia' | 'middle-east' | 'africa' | 'europe' | 'south-america';
  coordinates: Coordinates;
  theme: CountryTheme;
  visits: CountryVisit[];
  stats: CountryStats;
}

export interface CountriesData {
  countries: Country[];
}
