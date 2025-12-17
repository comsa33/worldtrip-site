export interface CountryName {
  en: string;
  ko: string;
  native: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Country {
  code: string;
  name: CountryName;
  coordinates: Coordinates;
}

export interface CountriesData {
  countries: Country[];
}
