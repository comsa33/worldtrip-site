import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Calendar, MapPin, Camera, BookOpen, Star } from 'lucide-react';
import countriesData from '../data/countries.json';
import type { Country } from '../types';
import './CountryDetailPage.css';

export default function CountryDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);
  
  const countries = countriesData.countries as Country[];
  const country = countries.find(c => c.slug === slug);
  
  useEffect(() => {
    if (country) {
      document.documentElement.setAttribute('data-country-theme', country.slug);
      setIsVisible(true);
      return () => {
        document.documentElement.removeAttribute('data-country-theme');
      };
    }
  }, [country]);
  
  if (!country) {
    return (
      <div className="country-not-found">
        <div className="container">
          <h1>Country not found</h1>
          <Link to="/countries" className="btn btn-primary">
            View all countries
          </Link>
        </div>
      </div>
    );
  }
  
  const countryIndex = countries.findIndex(c => c.code === country.code);
  const prevCountry = countryIndex > 0 ? countries[countryIndex - 1] : null;
  const nextCountry = countryIndex < countries.length - 1 ? countries[countryIndex + 1] : null;
  
  return (
    <div className={`country-detail ${isVisible ? 'is-visible' : ''}`}>
      {/* Hero */}
      <section className="country-hero">
        <div 
          className="country-hero__bg"
          style={{ background: country.theme.gradient }}
        />
        <div className="country-hero__overlay" />
        
        <div className="container country-hero__content">
          <button 
            onClick={() => navigate(-1)} 
            className="country-hero__back btn btn-ghost"
          >
            <ArrowLeft size={18} />
            <span>Back</span>
          </button>
          
          <div className="country-hero__main">
            <span className="country-hero__code">{country.code}</span>
            <h1 className="country-hero__title">{country.name.ko}</h1>
            <p className="country-hero__english">{country.name.en}</p>
            <p className="country-hero__native">{country.name.native}</p>
          </div>
          
          <div className="country-hero__stats">
            <div className="hero-stat glass-card">
              <Calendar size={18} />
              <div className="hero-stat__content">
                <span className="hero-stat__value">{country.stats.days}</span>
                <span className="hero-stat__label">Days</span>
              </div>
            </div>
            <div className="hero-stat glass-card">
              <MapPin size={18} />
              <div className="hero-stat__content">
                <span className="hero-stat__value">{country.stats.cities}</span>
                <span className="hero-stat__label">Cities</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      
      {/* Content */}
      <section className="country-content">
        <div className="container">
          {/* Cities */}
          <div className="content-block glass-card">
            <div className="content-block__header">
              <MapPin size={20} />
              <h2>방문 도시</h2>
            </div>
            <div className="cities-list">
              {country.visits.flatMap(visit => 
                visit.cities.map((city, idx) => (
                  <span 
                    key={`${visit.order}-${idx}`} 
                    className="city-chip"
                    style={{ background: country.theme.gradient }}
                  >
                    {city}
                  </span>
                ))
              )}
            </div>
          </div>
          
          {/* Gallery Placeholder */}
          <div className="content-block glass-card">
            <div className="content-block__header">
              <Camera size={20} />
              <h2>갤러리</h2>
            </div>
            <div className="content-placeholder">
              <Camera size={32} className="placeholder-icon" />
              <p className="placeholder-title">사진이 곧 추가될 예정입니다</p>
              <p className="placeholder-hint">
                /public/assets/images/countries/{country.slug}/
              </p>
            </div>
          </div>
          
          {/* Stories Placeholder */}
          <div className="content-block glass-card">
            <div className="content-block__header">
              <BookOpen size={20} />
              <h2>이야기</h2>
            </div>
            <div className="content-placeholder">
              <BookOpen size={32} className="placeholder-icon" />
              <p className="placeholder-title">여행 이야기가 곧 추가될 예정입니다</p>
              <p className="placeholder-hint">
                /src/data/countries/{country.slug}.json
              </p>
            </div>
          </div>
          
          {/* Highlights Placeholder */}
          <div className="content-block glass-card">
            <div className="content-block__header">
              <Star size={20} />
              <h2>하이라이트</h2>
            </div>
            <div className="content-placeholder">
              <Star size={32} className="placeholder-icon" />
              <p className="placeholder-title">하이라이트가 곧 추가될 예정입니다</p>
            </div>
          </div>
        </div>
      </section>
      
      {/* Navigation */}
      <section className="country-nav">
        <div className="container">
          <div className="country-nav__grid">
            {prevCountry ? (
              <Link 
                to={`/countries/${prevCountry.slug}`}
                className="nav-card nav-card--prev glass-card"
              >
                <ArrowLeft size={18} />
                <div className="nav-card__content">
                  <span className="nav-card__label">Previous</span>
                  <span className="nav-card__name">{prevCountry.name.ko}</span>
                </div>
              </Link>
            ) : <div />}
            
            {nextCountry && (
              <Link 
                to={`/countries/${nextCountry.slug}`}
                className="nav-card nav-card--next glass-card"
              >
                <div className="nav-card__content">
                  <span className="nav-card__label">Next</span>
                  <span className="nav-card__name">{nextCountry.name.ko}</span>
                </div>
                <ArrowRight size={18} />
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
