import { useI18n } from '../../i18n';
import './AboutOverlay.css';

interface AboutOverlayProps {
  visible: boolean;
}

export default function AboutOverlay({ visible }: AboutOverlayProps) {
  const { language } = useI18n();
  
  if (!visible) return null;
  
  const content = {
    ko: {
      title: "여정의 시작",
      subtitle: "2016년 7월, 광주",
      story: `18살, 대학 입시를 준비하던 시절 우연히 읽었던 
"바람난 부부의 세계일주"라는 책이 있었습니다.

9년간 운영하던 영어학원과 차를 정리하고,
배낭 하나 메고 무계획으로 떠났습니다.`,
      quote: "지금 아니면 영영 못 갈 것 같았다."
    },
    en: {
      title: "The Beginning",
      subtitle: "July 2016, Gwangju",
      story: `At 18, while preparing for college entrance exams,
I came across a book called "Around the World Journey."

After running an English academy for 9 years,
I sold everything and left with just a backpack.`,
      quote: "If not now, then never."
    }
  };
  
  const t = content[language as 'ko' | 'en'] || content.ko;
  
  return (
    <div className="about-overlay">
      <div className="about-overlay__card">
        <h2 className="about-overlay__title">{t.title}</h2>
        <p className="about-overlay__subtitle">{t.subtitle}</p>
        <p className="about-overlay__story">{t.story}</p>
        <blockquote className="about-overlay__quote">
          "{t.quote}"
        </blockquote>
      </div>
    </div>
  );
}
