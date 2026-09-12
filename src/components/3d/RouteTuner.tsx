import { useEffect } from 'react';
import { GLOBE, type Theme } from '../../theme';
import { chroma, mix, resetTuning, setTuning, useTuning, type Tuning } from './routeTuning';
import './RouteTuner.css';

/** Dev only — `?tune=1`. Not shipped. */
export function RouteTuner({ theme }: { theme: Theme }) {
  const t = useTuning();
  // the defaults belong to a theme, so switching themes starts the bench over
  useEffect(() => resetTuning(theme), [theme]);
  const sphere = GLOBE[theme].sphere;
  const border = mix(GLOBE[theme].ink, theme === 'light' ? 0.55 : 0.42, sphere);
  const ahead = mix(t.aheadColor, t.aheadOpacity, sphere);
  const past = mix(GLOBE[theme].routePast, t.pastLandOpacity, sphere);

  const num = (k: keyof Tuning, label: string, min: number, max: number, step: number) => (
    <label className="tuner__row" key={k}>
      <span className="tuner__k">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={t[k] as number}
        onChange={(e) => setTuning({ [k]: Number(e.target.value) } as Partial<Tuning>)}
      />
      <b className="tuner__v">{(t[k] as number).toFixed(2)}</b>
    </label>
  );

  const snippet = `// src/theme.ts — GLOBE.${theme}
routeAhead: '${t.aheadColor}',        // 화면값 ${ahead}
routeAheadOpacity: ${t.aheadOpacity},

// src/components/3d/JourneyExperience.tsx
const trail = (transport: string) =>
  transport === 'flight'
    ? { width: ${t.pastAir}, opacity: ${t.pastAirOpacity} }
    : { width: ${t.pastLand}, opacity: ${t.pastLandOpacity} };
// src/components/3d/cityZoom.ts
export const ZOOM_DEFAULTS = { zMax: ${t.zMax}, zMin: ${t.zMin}, slope: ${t.zSlope}, near: ${t.zNear}, hold: ${t.zHold} };

const trailAhead = (transport: string) =>
  transport === 'flight' ? ${t.aheadAir} : ${t.aheadLand};

// src/components/3d/WorldBorders.tsx
lineWidth={${t.borderBase}}   // 일반
lineWidth={${t.borderActive}}   // 활성

// src/styles/index.css — :root${theme === 'light' ? "[data-theme='light']" : ''}
--route-ahead: ${t.aheadColor};
--route-ahead-o: ${t.aheadOpacity};`;

  return (
    <div className="tuner">
      <div className="tuner__head">
        경로 조정 <span>?tune=1 · {theme}</span>
      </div>

      <div className="tuner__group">지나온 선</div>
      {num('pastLand', '육로 굵기', 0.5, 3, 0.05)}
      {num('pastAir', '항공 굵기', 0.2, 2, 0.05)}
      {num('pastLandOpacity', '육로 투명도', 0.2, 1, 0.01)}
      {num('pastAirOpacity', '항공 투명도', 0.2, 1, 0.01)}

      <div className="tuner__group">아직 안 간 선</div>
      {num('aheadLand', '육로 굵기', 0.3, 3, 0.05)}
      {num('aheadAir', '항공 굵기', 0.2, 2, 0.05)}
      {num('aheadOpacity', '투명도', 0.1, 1, 0.01)}
      <label className="tuner__row">
        <span className="tuner__k">색</span>
        <input
          type="color"
          value={t.aheadColor}
          onChange={(e) => setTuning({ aheadColor: e.target.value })}
        />
        <b className="tuner__v">{t.aheadColor}</b>
      </label>

      <div className="tuner__group">국경선</div>
      {num('borderBase', '일반 굵기', 0.5, 5, 0.1)}
      {num('borderActive', '활성 굵기', 0.5, 6, 0.1)}

      <div className="tuner__group">도시</div>
      {num('glyph', '장소 기호 굵기', 0.3, 3, 0.05)}
      {num('cityFill', '도시 색 · 지나온', 0, 0.6, 0.005)}
      {num('cityFillAhead', '도시 색 · 아직', 0, 0.6, 0.005)}
      {num('cityFillHover', '도시 색 · 손 아래', 0, 0.8, 0.005)}

      <div className="tuner__group">카메라 거리</div>
      {num('zMax', '가장 가까이', 1, 2.3, 0.05)}
      {num('zMin', '가장 멀리', 0, 1.6, 0.05)}
      {num('zSlope', '10배마다 물러남', 0.2, 1.2, 0.05)}
      {num('zNear', '다 당기는 거리 km', 5, 200, 5)}
      {num('zHold', '무시하는 차이', 0, 0.6, 0.05)}

      <div className="tuner__group">화면에 찍히는 값</div>
      <div className="tuner__swatches">
        <Swatch label="아직" hex={ahead} note={`채도 ${chroma(ahead)}`} warn={chroma(ahead) < 25} />
        <Swatch label="국경" hex={border} />
        <Swatch label="지나옴" hex={past} />
      </div>

      <div className="tuner__note">
        아직 안 간 선은 바탕({sphere}) 쪽으로 물러나야 하고, 국경과는 밝기가 아니라 따뜻함으로
        갈려야 합니다. 채도 25 아래로 내려가면 갈색이 회색이 됩니다.
      </div>

      <div className="tuner__buttons">
        <button type="button" onClick={() => resetTuning(theme)}>
          되돌리기
        </button>
        <button type="button" onClick={() => navigator.clipboard?.writeText(snippet)}>
          값 복사
        </button>
      </div>
      <pre className="tuner__code">{snippet}</pre>
    </div>
  );
}

function Swatch({
  label,
  hex,
  note,
  warn,
}: {
  label: string;
  hex: string;
  note?: string;
  warn?: boolean;
}) {
  return (
    <div className="tuner__sw">
      <i style={{ background: hex }} />
      <span>{label}</span>
      <b>{hex}</b>
      {note && <em className={warn ? 'is-warn' : undefined}>{note}</em>}
    </div>
  );
}
