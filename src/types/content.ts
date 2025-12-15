// Content types for galleries and stories

export interface GalleryImage {
  id: string;
  src: string;
  caption: string;
  date: string;
  location: string;
}

export interface Story {
  id: string;
  title: string;
  date: string;
  content: string; // Markdown content
  thumbnail?: string;
}

export interface CountryHero {
  image: string;
  title: string;
  subtitle: string;
}

export interface CountryContent {
  countryCode: string;
  hero: CountryHero;
  gallery: GalleryImage[];
  stories: Story[];
  highlights: string[];
}
