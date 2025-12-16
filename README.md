# 🌍 세계일주 배낭여행 웹사이트

2016년 7월부터 2017년 6월까지의 세계일주 배낭여행을 기록한 인터랙티브 3D 웹사이트입니다.

## 🚀 시작하기

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 프로덕션 빌드
npm run build
```

## 📁 프로젝트 구조

```
/backpacking-site
├── /public
│   └── /assets/images/textures   # 지구 텍스처
│
├── /src
│   ├── /components
│   │   ├── /3d                   # 3D 여정 컴포넌트
│   │   │   ├── JourneyExperience.tsx  # 메인 3D 여정
│   │   │   └── Globe.tsx         # 지구본
│   │   ├── /about                # About 오버레이
│   │   └── /gallery              # 폴라로이드 갤러리
│   │
│   ├── /data
│   │   ├── journey.json          # 여정 데이터 (경로, 도시)
│   │   ├── countries.json        # 국가 정보
│   │   ├── cities.json           # 도시 좌표
│   │   └── cityPhotos.json       # 갤러리 사진 (Cloudinary)
│   │
│   ├── /i18n                     # 다국어 지원 (한/영)
│   ├── /types                    # TypeScript 타입
│   ├── /scripts                  # 유틸리티 스크립트
│   └── /styles                   # 글로벌 CSS
```

## ☁️ Cloudinary 사진 관리

이 프로젝트는 Cloudinary를 사용하여 사진을 관리합니다.

### 초기 설정

1. [Cloudinary](https://cloudinary.com)에 가입
2. `.env.sample`을 복사하여 `.env` 파일 생성
3. Cloudinary 대시보드에서 API 키 정보 입력:
   ```bash
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   ```

### 도시 폴더 생성

모든 여행 도시의 폴더를 Cloudinary에 생성:
```bash
node scripts/create-cloudinary-folders.js
```

### 사진 업로드

1. Cloudinary 웹 대시보드 → Media Library → cities/{도시명} 폴더로 이동
2. 사진을 드래그 앤 드롭으로 업로드

### 갤러리 동기화

Cloudinary에 업로드된 사진을 앱 갤러리에 연결:
```bash
node scripts/sync-cloudinary-photos.js
```

이 스크립트는 `src/data/cityPhotos.json`을 자동으로 업데이트합니다.

> **참고**: 동기화 후 `cityPhotos.json`에서 `date`와 `caption`을 수동으로 입력하세요.

## ✏️ 콘텐츠 수정 가이드

### 여정 데이터 수정

`src/data/journey.json`에서 도시, 이동수단, 날짜 등을 수정할 수 있습니다.

### 국가 테마 색상

`src/styles/index.css`에서 국가별 테마 색상을 수정:
```css
[data-country-theme="vietnam"] {
  --color-accent-primary: #DA251D;
  --color-accent-secondary: #FFCD00;
}
```

### 다국어 지원

`src/i18n/` 폴더에서 한국어/영어 번역을 관리합니다.

## 🛠️ 기술 스택

- **Framework**: React 18 + TypeScript
- **Build**: Vite
- **3D**: Three.js + React Three Fiber + Drei
- **Icons**: Lucide React
- **Styling**: Vanilla CSS + CSS Variables
- **Image Hosting**: Cloudinary

## 📄 라이선스

© 2025 이루오. All rights reserved.
