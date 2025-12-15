import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, MapPin, ArrowRight, Plane } from 'lucide-react';
import countriesData from '../data/countries.json';
import journeyData from '../data/journey.json';
import type { Country } from '../types';
import './JourneyPage.css';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

function getDaysBetween(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

export default function JourneyPage() {
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    setIsVisible(true);
  }, []);
  
  const countries = countriesData.countries as Country[];
  const stops = journeyData.stops;
  
  const timelineItems = useMemo(() => {
    return stops.map(stop => {
      const country = countries.find(c => c.code === stop.countryCode);
      return {
        ...stop,
        country,
        days: getDaysBetween(stop.startDate, stop.endDate)
      };
    });
  }, [countries, stops]);
  
  return (
    <div className={`journey-page ${isVisible ? 'is-visible' : ''}`}>
      {/* Hero */}
      <section className="journey-hero">
        <div className="container">
          <div className="journey-hero__content">
            <span className="section-label">Timeline</span>
            <h1 className="journey-hero__title">여정</h1>
            <p className="journey-hero__subtitle">
              {journeyData.totalDays}일간의 시간순 기록
            </p>
            <div className="journey-hero__meta glass-card">
              <div className="meta-item">
                <Calendar size={16} />
                <span>{journeyData.startDate.replace(/-/g, '.')}</span>
              </div>
              <Plane size={16} className="meta-arrow" />
              <div className="meta-item">
                <Calendar size={16} />
                <span>{journeyData.endDate.replace(/-/g, '.')}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      
      {/* Timeline */}
      <section className="timeline-section">
        <div className="container">
          <div className="timeline">
            {timelineItems.map((item, index) => {
              const country = item.country;
              if (!country) return null;
              
              return (
                <div 
                  key={`${item.countryCode}-${item.order}`}
                  className="timeline-item"
                  style={{ 
                    '--delay': `${index * 0.03}s`,
                    '--accent': country.theme.primary
                  } as React.CSSProperties}
                >
                  <div className="timeline-item__marker">
                    <div className="timeline-item__dot" />
                    <div className="timeline-item__line" />
                  </div>
                  
                  <Link 
                    to={`/countries/${country.slug}`}
                    className="timeline-item__card glass-card"
                  >
                    <div 
                      className="timeline-item__accent"
                      style={{ background: country.theme.gradient }}
                    />
                    
                    <div className="timeline-item__header">
                      <div className="timeline-item__order">
                        {String(item.order + 1).padStart(2, '0')}
                      </div>
                      <div className="timeline-item__info">
                        <h3 className="timeline-item__name">{country.name.ko}</h3>
                        <span className="timeline-item__native">{country.name.en}</span>
                      </div>
                      {item.note && (
                        <span 
                          className="timeline-item__badge"
                          style={{ background: country.theme.primary }}
                        >
                          {item.note}
                        </span>
                      )}
                    </div>
                    
                    <div className="timeline-item__details">
                      <div className="timeline-item__date">
                        <Calendar size={14} />
                        <span>{formatDate(item.startDate)} — {formatDate(item.endDate)}</span>
                      </div>
                      <div className="timeline-item__stats">
                        <span className="stat">{item.days}일</span>
                        {country.stats.cities > 0 && (
                          <>
                            <span className="stat-divider">·</span>
                            <span className="stat">{country.stats.cities}개 도시</span>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="timeline-item__arrow">
                      <ArrowRight size={16} />
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
          
          {/* End marker */}
          <div className="timeline-end">
            <div className="timeline-end__marker">
              <MapPin size={20} />
            </div>
            <p className="timeline-end__text">여행의 끝, 새로운 시작</p>
          </div>
        </div>
      </section>
    </div>
  );
}
