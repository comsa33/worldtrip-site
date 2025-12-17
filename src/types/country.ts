export interface CountryName {
  en: string;
  ko: string;
  native: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
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
  stats: CountryStats;
}

export interface CountriesData {
  countries: Country[];
}
