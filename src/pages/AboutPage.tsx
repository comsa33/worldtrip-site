import { useState, useEffect } from 'react';
import { Mail, Briefcase, BookOpen, GraduationCap, Plane, MapPin, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import './AboutPage.css';

export default function AboutPage() {
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    setIsVisible(true);
  }, []);
  
  return (
    <div className={`about-page ${isVisible ? 'is-visible' : ''}`}>
      {/* Hero */}
      <section className="about-hero">
        <div className="container">
          <span className="section-label">Story</span>
          <h1 className="about-hero__title">About</h1>
          <p className="about-hero__subtitle">여행자의 이야기</p>
        </div>
      </section>
      
      {/* Story */}
      <section className="about-story">
        <div className="container">
          <div className="story-grid">
            {/* The Beginning */}
            <div className="story-block glass-card">
              <div className="story-block__icon">
                <BookOpen size={24} />
              </div>
              <h3 className="story-block__title">시작은 한 권의 책</h3>
              <p className="story-block__text">
                18살, 대학 입시를 준비하던 시절에 우연히 읽었던 
                "바람난 부부의 세계일주"라는 책이 있었습니다. 
                평범한 부부가 모든 것을 정리하고 세계를 여행하는 이야기였죠.
              </p>
            </div>
            
            {/* Career */}
            <div className="story-block glass-card">
              <div className="story-block__icon">
                <GraduationCap size={24} />
              </div>
              <h3 className="story-block__title">디자인, 그리고 영어</h3>
              <p className="story-block__text">
                대학에서 디자인을 전공하고, 프리랜서로 다양한 디자인 작업을 했습니다.
                그러다 영어 교육에 관심을 갖게 되었고, 
                토익쉽/고파토익 어학원을 설립해 9년간 운영했습니다.
              </p>
            </div>
            
            {/* The Decision */}
            <div className="story-block story-block--highlight glass-card">
              <div className="story-block__icon">
                <Plane size={24} />
              </div>
              <h3 className="story-block__title">지금 아니면 안된다</h3>
              <p className="story-block__text">
                어느 날 문득, 18살에 읽었던 그 책이 떠올랐습니다.
                9년간 운영하던 학원, 타고 다니던 차, 모든 것을 정리했습니다.
              </p>
              <blockquote className="story-block__quote">
                "지금 아니면 영영 못 갈 것 같았다."
              </blockquote>
            </div>
            
            {/* The Journey */}
            <div className="story-block glass-card">
              <div className="story-block__icon">
                <MapPin size={24} />
              </div>
              <h3 className="story-block__title">345일간의 여정</h3>
              <p className="story-block__text">
                2016년 7월부터 2017년 6월까지, 약 1년간 30개국을 여행했습니다.
                아시아에서 시작해 중동, 유럽, 아프리카, 그리고 남미까지.
                중간에 친구 결혼식 사회를 보기 위해 잠깐 한국에 다녀오기도 했죠.
              </p>
            </div>
            
            {/* After */}
            <div className="story-block glass-card">
              <div className="story-block__icon">
                <Briefcase size={24} />
              </div>
              <h3 className="story-block__title">그 후의 삶</h3>
              <p className="story-block__text">
                여행을 마치고 돌아와 다시 영어학원 일을 시작했습니다.
                하지만 여행에서 얻은 넓은 시야와 디자인 배경이
                저를 새로운 길로 이끌었습니다.
                지금은 AI 에이전트 플랫폼 개발자로 일하고 있습니다.
              </p>
            </div>
          </div>
        </div>
      </section>
      
      {/* Timeline */}
      <section className="about-timeline">
        <div className="container">
          <h2 className="timeline-title">Life Journey</h2>
          <div className="life-path">
            <div className="life-path__line" />
            <div className="life-path__items">
              <div className="path-item">
                <div className="path-item__marker" />
                <div className="path-item__content">
                  <span className="path-item__title">디자인 전공</span>
                </div>
              </div>
              <div className="path-item">
                <div className="path-item__marker" />
                <div className="path-item__content">
                  <span className="path-item__title">영어학원 9년</span>
                </div>
              </div>
              <div className="path-item path-item--highlight">
                <div className="path-item__marker" />
                <div className="path-item__content">
                  <span className="path-item__title">세계일주</span>
                  <span className="path-item__date">2016-2017</span>
                </div>
              </div>
              <div className="path-item">
                <div className="path-item__marker" />
                <div className="path-item__content">
                  <span className="path-item__title">영어학원</span>
                </div>
              </div>
              <div className="path-item">
                <div className="path-item__marker" />
                <div className="path-item__content">
                  <span className="path-item__title">AI 개발자</span>
                  <span className="path-item__date">현재</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      
      {/* CTA */}
      <section className="about-cta">
        <div className="container">
          <div className="cta-card glass-card">
            <h2 className="cta-title">여정을 함께 하세요</h2>
            <p className="cta-text">
              345일간의 여행 기록을 둘러보세요.
            </p>
            <div className="cta-buttons">
              <Link to="/journey" className="btn btn-primary">
                <span>여정 보기</span>
                <ArrowRight size={16} />
              </Link>
              <a 
                href="mailto:comsa333@gmail.com" 
                className="btn btn-secondary"
              >
                <Mail size={16} />
                <span>Contact</span>
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
