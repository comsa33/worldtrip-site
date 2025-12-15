import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Compass, Map, Clock, Globe as GlobeIcon } from 'lucide-react';
import Globe from '../components/3d/Globe';
import journeyData from '../data/journey.json';
import './HomePage.css';

export default function HomePage() {
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    setIsVisible(true);
  }, []);
  
  const scrollToContent = () => {
    window.scrollTo({
      top: window.innerHeight,
      behavior: 'smooth'
    });
  };
  
  return (
    <div className={`home-page ${isVisible ? 'is-visible' : ''}`}>
      {/* Hero Section */}
      <section className="hero">
        {/* Background gradient */}
        <div className="hero__bg">
          <div className="hero__gradient-1" />
          <div className="hero__gradient-2" />
        </div>
        
        {/* Globe */}
        <div className="hero__globe">
          <Globe />
        </div>
        
        {/* Content Overlay */}
        <div className="hero__content">
          <div className="hero__text">
            <p className="hero__eyebrow">2016.07 — 2017.06</p>
            <h1 className="hero__title">
              <span className="hero__title-line">Around the</span>
              <span className="hero__title-line hero__title-accent">World</span>
            </h1>
            <p className="hero__subtitle">
              345일간의 세계일주 배낭여행
            </p>
          </div>
          
          <div className="hero__cta">
            <Link to="/journey" className="btn btn-primary btn-lg">
              <span>여정 탐색하기</span>
              <ArrowRight size={18} />
            </Link>
            <Link to="/countries" className="btn btn-secondary btn-lg">
              <Map size={18} />
              <span>국가 보기</span>
            </Link>
          </div>
        </div>
        
        {/* Scroll indicator */}
        <button className="hero__scroll" onClick={scrollToContent} aria-label="Scroll down">
          <span className="hero__scroll-text">Scroll</span>
          <ChevronDown size={20} className="hero__scroll-icon" />
        </button>
      </section>
      
      {/* Story Section */}
      <section className="story-section">
        <div className="container">
          <div className="story-content">
            <div className="story-header">
              <span className="section-label">The Story</span>
              <h2 className="section-title">어느 날, 갑자기</h2>
            </div>
            
            <div className="story-card glass-card">
              <p className="story-text">
                18살에 읽었던 책 한 권이 떠올랐습니다.
                <br /><br />
                9년간 운영하던 영어학원과 차를 정리하고,
                <br />
                배낭 하나 메고 <strong>무계획으로 떠났습니다.</strong>
              </p>
              <blockquote className="story-quote">
                "지금 아니면 영영 못 갈 것 같았다."
              </blockquote>
              <Link to="/about" className="story-link">
                <span>전체 이야기 읽기</span>
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>
      
      {/* Stats Section */}
      <section className="stats-section">
        <div className="container">
          <div className="stats-grid">
            <div className="stat-item glass-card">
              <div className="stat-item__icon">
                <Clock size={24} />
              </div>
              <div className="stat-item__content">
                <span className="stat-item__value">{journeyData.totalDays}</span>
                <span className="stat-item__label">Days of Journey</span>
              </div>
            </div>
            
            <div className="stat-item glass-card">
              <div className="stat-item__icon">
                <GlobeIcon size={24} />
              </div>
              <div className="stat-item__content">
                <span className="stat-item__value">{journeyData.totalCountries}</span>
                <span className="stat-item__label">Countries Visited</span>
              </div>
            </div>
            
            <div className="stat-item glass-card">
              <div className="stat-item__icon">
                <Compass size={24} />
              </div>
              <div className="stat-item__content">
                <span className="stat-item__value">5</span>
                <span className="stat-item__label">Continents Explored</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      
      {/* Route Preview */}
      <section className="route-section">
        <div className="container">
          <div className="route-header">
            <span className="section-label">Route</span>
            <h2 className="section-title">여정의 경로</h2>
          </div>
          
          <div className="route-visual">
            <div className="route-line" />
            <div className="route-stops">
              {['KR', 'VN', 'MY', 'ID', 'LA', 'TH', 'IN', 'NP', 'JP', 'AE', 'EG', 'ES', 'IT', 'RS', 'HU', 'PL', 'CZ', 'BE', 'MA', 'PT', 'BR', 'PY', 'AR', 'CL', 'BO', 'PE', 'EC', 'CO'].map((code, index) => (
                <div 
                  key={code} 
                  className="route-stop"
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <div className="route-stop__dot" />
                  <span className="route-stop__code">{code}</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="route-cta">
            <Link to="/journey" className="btn btn-primary">
              <span>타임라인으로 보기</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
