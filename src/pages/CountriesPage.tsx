import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Grid, List, ChevronRight } from 'lucide-react';
import countriesData from '../data/countries.json';
import type { Country } from '../types';
import './CountriesPage.css';

const continentLabels: Record<string, string> = {
  'all': 'All',
  'asia': 'Asia',
  'middle-east': 'Middle East',
  'africa': 'Africa',
  'europe': 'Europe',
  'south-america': 'South America'
};

export default function CountriesPage() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedContinent, setSelectedContinent] = useState<string>('all');
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    setIsVisible(true);
  }, []);
  
  const countries = countriesData.countries as Country[];
  
  const filteredCountries = useMemo(() => {
    if (selectedContinent === 'all') return countries;
    return countries.filter(c => c.continent === selectedContinent);
  }, [countries, selectedContinent]);
  
  const continents = useMemo(() => {
    const unique = [...new Set(countries.map(c => c.continent))];
    return ['all', ...unique];
  }, [countries]);
  
  return (
    <div className={`countries-page ${isVisible ? 'is-visible' : ''}`}>
      {/* Hero */}
      <section className="countries-hero">
        <div className="container">
          <span className="section-label">Destinations</span>
          <h1 className="countries-hero__title">방문 국가</h1>
          <p className="countries-hero__subtitle">
            {countries.length}개국의 이야기
          </p>
        </div>
      </section>
      
      {/* Controls */}
      <section className="countries-controls">
        <div className="container">
          <div className="controls-wrapper">
            {/* Continent Filter */}
            <div className="filter-tabs">
              {continents.map(continent => (
                <button
                  key={continent}
                  onClick={() => setSelectedContinent(continent)}
                  className={`filter-tab ${selectedContinent === continent ? 'filter-tab--active' : ''}`}
                >
                  {continentLabels[continent] || continent}
                </button>
              ))}
            </div>
            
            {/* View Mode Toggle */}
            <div className="view-toggle">
              <button
                onClick={() => setViewMode('grid')}
                className={`view-btn ${viewMode === 'grid' ? 'view-btn--active' : ''}`}
                aria-label="Grid view"
              >
                <Grid size={18} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`view-btn ${viewMode === 'list' ? 'view-btn--active' : ''}`}
                aria-label="List view"
              >
                <List size={18} />
              </button>
            </div>
          </div>
        </div>
      </section>
      
      {/* Countries */}
      <section className="countries-section">
        <div className="container">
          <div className={`countries-${viewMode}`}>
            {filteredCountries.map((country, index) => (
              <Link
                key={country.code}
                to={`/countries/${country.slug}`}
                className={`country-card-item country-card-item--${viewMode}`}
                style={{
                  '--delay': `${index * 0.03}s`,
                  '--accent': country.theme.primary,
                  '--accent-gradient': country.theme.gradient
                } as React.CSSProperties}
              >
                <div className="country-card-item__gradient" />
                
                <div className="country-card-item__content">
                  <div className="country-card-item__header">
                    <span className="country-card-item__code">{country.code}</span>
                    <ChevronRight size={16} className="country-card-item__arrow" />
                  </div>
                  
                  <h3 className="country-card-item__name">{country.name.ko}</h3>
                  <p className="country-card-item__english">{country.name.en}</p>
                  
                  <div className="country-card-item__meta">
                    <span>{country.stats.days} days</span>
                    <span className="meta-divider">·</span>
                    <span>{country.stats.cities} cities</span>
                  </div>
                </div>
                
                <div 
                  className="country-card-item__accent-bar"
                  style={{ background: country.theme.gradient }}
                />
              </Link>
            ))}
          </div>
          
          {filteredCountries.length === 0 && (
            <div className="no-results">
              <p>No countries found in this region.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
