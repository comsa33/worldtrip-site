# 🌍 세계일주 배낭여행 웹사이트

2016년 7월부터 2017년 6월까지의 세계일주 배낭여행을 기록한 인터랙티브 웹사이트입니다.

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
│   └── /assets/images
│       ├── /countries      # 국가별 이미지 폴더
│       ├── /icons          # 아이콘/로고
│       └── /textures       # 3D 텍스처
│
├── /src
│   ├── /components         # 재사용 컴포넌트
│   │   ├── /3d             # 3D 관련 (Globe 등)
│   │   ├── /layout         # 레이아웃 (Header, Footer)
│   │   └── /country        # 국가 관련
│   │
│   ├── /pages              # 페이지 컴포넌트
│   ├── /data               # JSON 데이터
│   ├── /types              # TypeScript 타입
│   ├── /hooks              # 커스텀 훅
│   └── /styles             # CSS 스타일
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

---

## ✏️ 콘텐츠 추가/수정 가이드

### 1. 사진 추가하기

1. `public/assets/images/countries/{국가slug}/` 폴더 생성
2. 이미지 파일 추가 (예: `hero.jpg`, `photo-01.jpg`)
3. `src/data/countries/{국가slug}.json` 파일 생성/수정:

```json
{
  "countryCode": "VN",
  "hero": {
    "image": "/assets/images/countries/vietnam/hero.jpg",
    "title": "Vietnam",
    "subtitle": "쌀국수와 오토바이의 나라"
  },
  "gallery": [
    {
      "id": "vn-001",
      "src": "/assets/images/countries/vietnam/halong-bay.jpg",
      "caption": "하롱베이의 일출",
      "date": "2016-07-10",
      "location": "Ha Long Bay"
    }
  ]
}
```

### 2. 글(스토리) 추가하기

`src/data/countries/{국가slug}.json` 파일의 `stories` 배열에 추가:

```json
{
  "stories": [
    {
      "id": "story-vn-001",
      "title": "첫 번째 여정의 시작",
      "date": "2016-07-01",
      "content": "마크다운 형식의 글 내용...",
      "thumbnail": "/assets/images/countries/vietnam/story-1-thumb.jpg"
    }
  ]
}
```

### 3. 국가 정보 수정하기

`src/data/countries.json` 파일에서 해당 국가 정보 수정:

```json
{
  "code": "VN",
  "name": { "en": "Vietnam", "ko": "베트남", "native": "Việt Nam" },
  "theme": {
    "primary": "#DA251D",
    "secondary": "#FFCD00",
    "gradient": "linear-gradient(135deg, #DA251D 0%, #FFCD00 100%)"
  },
  "stats": { "days": 14, "cities": 3 }
}
```

### 4. 새 국가 추가하기

1. `src/data/countries.json`에 국가 정보 추가
2. `src/data/journey.json`에 여정 순서 추가
3. `src/styles/index.css`에 테마 색상 추가:
   ```css
   [data-country-theme="newcountry"] {
     --color-accent-primary: #XXXXXX;
     --color-accent-secondary: #XXXXXX;
   }
   ```

## 🎨 커스터마이징

### 색상 변경

`src/styles/index.css`의 `:root` CSS 변수 수정:

```css
:root {
  --color-accent-primary: #6366f1;   /* 메인 액센트 */
  --color-accent-secondary: #8b5cf6; /* 보조 액센트 */
}
```

### 국가 테마 색상

각 국가 페이지는 자동으로 해당 국가의 테마 색상이 적용됩니다.
`countries.json`의 `theme` 객체를 수정하면 됩니다.

## 🛠️ 기술 스택

- **Framework**: React 18 + TypeScript
- **Build**: Vite
- **3D**: Three.js + React Three Fiber
- **Animation**: GSAP (추후 추가 예정)
- **Routing**: React Router v6
- **Icons**: Lucide React
- **Styling**: Vanilla CSS + CSS Variables

## 📝 TODO

- [ ] 사진 갤러리 컴포넌트 구현
- [ ] 마크다운 스토리 렌더링
- [ ] GSAP 스크롤 애니메이션 추가
- [ ] 페이지 전환 애니메이션
- [ ] 다국어 지원 (한/영)
- [ ] 다크/라이트 모드 토글

## 📄 라이선스

© 2025 이루오. All rights reserved.
