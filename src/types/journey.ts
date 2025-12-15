// Journey timeline types

export interface JourneyStop {
  order: number;
  countryCode: string;
  startDate: string;
  endDate: string;
  isTransit?: boolean; // 잠깐 경유
  note?: string;
}

export interface JourneyData {
  title: string;
  startDate: string; // 2016-07-01
  endDate: string;   // 2017-06-30
  totalDays: number;
  totalCountries: number;
  stops: JourneyStop[];
}
