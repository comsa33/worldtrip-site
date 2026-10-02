# 사진 주제 · 지구본 성능 — 인계 (coding → 다음 세션)

2026-10-02, coding 세션이 씀. 기준 문서는 `PLAN.md`(main 작업 트리의 `design/photo-themes/`). 총괄은 `jev도입검토` 세션.
이 문서만 읽고 B2 를 시작할 수 있게 썼다.

## 1. 브랜치와 커밋

- worktree: `/Users/ruo/projects/worldtrip-site-photo-themes`, 브랜치 `feat/photo-themes`
- **origin/main(4d10829)에서 땄다.** 로컬 main 의 7951b5b(Cloudinary 변환 크기 변경, 미푸시)는 없다 — 이 브랜치로 dev 를 띄워도 새 Cloudinary 변환이 생기지 않는다. 그 커밋을 끌어오지 말 것.
- upstream 추적을 풀어 두었다(실수로 main 에 푸시되지 않게). **푸시·배포는 루오님 허락 뒤에만.**
- main 작업 트리, `countryFill.ts`, 나라 칠 stash(`stash@{0}`)는 다른 세션 것 — 건드리지 않는다.

커밋(오래된 것부터):

| 커밋      | 무엇                      | 왜                                                                |
| --------- | ------------------------- | ----------------------------------------------------------------- |
| 7ad709f   | A1 사진첩 흐리기          | 보드 확정안. 고른 주제 외 사진 흐림, 파형 강조, ←→ 다음 켜진 사진 |
| 64afefa   | 14번째 주제 「나」        | 사진 앱 얼굴 인식 311장                                           |
| 66e6dbd   | `captions/` 115개 파일    | D1 캡션 도구의 원본                                               |
| f712c85   | D1 캡션 도구              | 내부용, 빌드 밖                                                   |
| c16aa5e   | 주제 줄 H2′+H2″           | 상단바 밑 한 줄, 물러남, 접힘. 바닥 줄 없앰                       |
| 5334f9c   | B1 지구본 여정 화면       | 도시 고리·스크러버 막대·흐림·←→ 다음 켜진 정거장                  |
| 4365905   | iOS 줄 스크롤             | 아래 「함정」 1                                                   |
| f20f8ac   | perf: 주제 줄·B1 경량화   | mask 제거, 물러남을 --row-k 로, 헤일로 5겹, FLIP 접힘             |
| dc43480   | perf: 국경 15° 칸         | 화면 밖·지구 뒤쪽 칸을 그리지 않음                                |
| 2d4da37   | perf: 먼 화면 국경 LOD    | 0.25px 안쪽 정점만 뺀 단계                                        |
| b5770f0   | perf: 경로선 재사용       | 지나는 구간을 매 프레임 새로 짓지 않음                            |
| c41f114   | perf: 움직일 때만 흐림 끔 | 헤더·도시 라벨·구간 툴팁                                          |
| 8426e52   | perf: 고DPR 터치 MSAA 끔  | DPR ≥ 2 + pointer: coarse                                         |
| (이 문서) | HANDOFF.md                |                                                                   |

검증 습관: 매 커밋 전 `npx eslint src`, `npx tsc -b`, `npm test`(node --test tests/, 9건), `npm run build` 를 **종료 코드로** 확인.

## 2. 작업 트리에만 있는 것 (커밋하지 않음)

- `?perf=1` 프레임 오버레이: `src/lib/perfOverlay.ts` + `src/main.tsx` 의 import 세 줄. 20초 창마다 fps · 16.7ms 초과 % · 33ms 초과 수 · p95, 앞 창 값도 표시. DOM 은 1초에 한 번.
- 기준선(origin/main + 같은 오버레이): `/private/tmp/claude-501/base` — `git worktree add --detach` 로 만든 임시 worktree, `node_modules` 는 이 worktree 것을 심볼릭 링크. 지울 땐 `rm /private/tmp/claude-501/base/node_modules && git worktree remove --force /private/tmp/claude-501/base`.
- 측정 스크립트(puppeteer-core, 실제 GPU): `node_modules/.cache/b1/` — `gputime.mjs`(EXT_disjoint_timer_query 로 프레임당 GPU 시간, idle|autoplay|globe), `glcount.mjs`(draw call·정점·버퍼 업로드/프레임), `pixdiff.mjs`(DOM 숨기고 캔버스만 두 빌드 픽셀 비교, journey|globe|mid0.xx), `mut.mjs`(프레임당 DOM 변경), `layers.mjs`(합성 레이어). node_modules 아래라 git 에 안 들어간다.

## 3. 서버 (Tailscale 100.98.29.113 에만 바인딩 — 0.0.0.0 금지, 루오님 상시 허락)

백그라운드 작업은 2시간에 꺼진다(`timeout` 7200000). 확인은 curl 한 번(폴링 금지).

```sh
# 브랜치 프로덕션 미리보기 (루오님 폰 비교용)
cd /Users/ruo/projects/worldtrip-site-photo-themes && npm run build && npx vite preview --host 100.98.29.113 --port 5182 --strictPort
# 기준선
cd /private/tmp/claude-501/base && npx vite build && npx vite preview --host 100.98.29.113 --port 5183 --strictPort
# 캡션 도구 (D1)
cd /Users/ruo/projects/worldtrip-site-photo-themes && HOST=100.98.29.113 PORT=5181 node design/caption-tool/server.mjs
# dev (HMR)
npx vite --port 5180 --strictPort --host 100.98.29.113
```

폰 비교 장면: 광주 첫 화면에서 자동 재생(스페이스/재생 버튼) 40초, `?perf=1`.

## 4. 핵심 구조

- `src/lib/photoThemes.ts` — **선택 상태는 이것 하나**(`usePhotoTheme`, `setPhotoTheme`). `THEMES`, `themesOf(photoId)`, `THEME_TOTAL`, `themeDays(theme)`, `stopThemeCount(stopId, theme)`. 데이터는 `src/data/photoTags.json`(태그 id 뿐, Apple 설명문 없음 — 넣으면 안 된다).
- `src/lib/themeStep.ts` — ←→ 규칙 `stepIndex(count, from, dir, lit)`: 켜진 게 있으면 다음 켜진 곳, 끝이면 제자리, 아무것도 안 켜졌으면 평소대로. 테스트 `tests/themeStep.test.ts`.
- `src/components/themes/ThemeRow.tsx` + `.css` — 주제 줄. props: `lang`, `moving`(물러남), `halo`(지구본용, `--ground` 색 헤일로), `floating`(지구본 위: 폭을 낱말만큼), `wake`(마우스가 올라오면 깨울 요소, 상단바 ref). 물러남은 `--row-k`(@property) 하나로 모든 색을 color-mix. 접힘은 2초, FLIP(transform). 넘침: 네이티브 overflow-x + pan-x, 세로 휠→가로, 마우스 끌기.
- 사진첩: `PhotoGallery.tsx`(줄은 `.pb__themerow`, 흐리기는 `data-t` + `<style>` 한 규칙), `JourneySheet.tsx`(타일 `data-t`, 파형 `themeDays`).
- 지구본: `JourneyExperience.tsx`
  - 줄: `.journey-themes`(globe 'off' 일 때만). 미니맵·레일·필름스트립·나라 지도는 `--trow` 만큼 내려감(둘러보기에선 0).
  - `ThemeRings.tsx` — 켜진 도시 고리, **점 셰이더 하나 · draw call 하나**, 반지름 k·√n+min px(데스크톱 4.2/6, 폰 3.4/5), 두 번 다 그 주제면 바깥 가는 고리. 버퍼는 선택이 바뀔 때만.
  - `Scrubber.tsx` — `bars` 막대(높이 3+√n·3.6), 채움선은 `scaleX`.
  - 움직임 신호: `orbitHeld`(OrbitControls start/end), `scrubHeld`, `wheelBusy`, `playing`, `following`(진행 스프링 미수렴). `globeMoving` → 루트 `data-globe-moving`(600ms 꼬리) → CSS 가 흐림을 끔.
  - MSAA: 모듈 상수 `MSAA`(DPR ≥ 2 + coarse 면 false).
- `WorldBorders.tsx` — 국경을 15° 칸 × 3단계(LEVELS_DEG 0/0.03/0.08)로. 매 프레임 1°의 화면 px 로 단계를 고르고(MAX_ERR_PX 0.25), 칸마다 실제 구로 화면·지평선 판정. **정렬용 구는 옛 한 덩어리의 구**(아래 함정 4).
- 경로선 `RouteLine` 의 `cut={{ at, keep }}` — 지나는 구간을 instanceCount(걸은 쪽)와 dashOffset(남은 쪽)으로.
- D1 캡션 도구: `design/caption-tool/`(server.mjs·index.html·review.json). 원본은 **`src/data/captions/<cityCode>.json`** 한 곳(b76d503 에서 옮김)이고 도구가 저장소 prettier 로 포맷해 쓴다. 사이트도 같은 파일을 `src/lib/captions.ts` 로 읽는다. 사진은 main 작업 트리의 `photos/cities/`(Cloudinary 금지), 단서는 main 의 `design/photo-themes/facts.jsonl`(로컬 전용).

## 5. 배운 함정

1. **iOS(WebKit — iOS Chrome 포함)는 `pointer-events: none` 인 스크롤 컨테이너를 넘기지 않는다**(자식만 auto 여도). 빈 곳 통과는 컨테이너 폭을 줄여서.
2. **캔버스(매 프레임 바뀜) 위 DOM 의 backdrop-filter · mask-image · 그룹 opacity 는 iPhone 에서 비싸다.** 흐림만 꺼도 fps 33~35 → 40~48. 새 DOM 을 지구본 위에 올릴 때 이 셋을 쓰지 않는다.
3. **headless(M1) 측정은 iPhone 과 다르다.** 국경 칸 나누기로 M1 GPU −60% 였지만 iPhone fps 는 그대로였다. 판단은 루오님 폰 `?perf=1` 로.
4. **투명 물체 정렬도 겉모양이다.** three 는 geometry 경계 구 중심으로 투명 물체를 정렬한다. 국경을 칸으로 나누자 현재 나라 굵은 윤곽 위로 옅은 국경이 그려져 속이 빈 선이 됐다 → 칸마다 정렬용 구를 옛 전체의 구로 두고, 화면 판정은 직접 한다. 바꿀 땐 `pixdiff.mjs` 로 확인.
5. 커밋 훅(lint-staged)의 prettier 가 JSON 줄바꿈을 바꾼다(captions). 내용은 같다.
6. `cameraResting`(0.002 임계)은 쉬는 화면에서도 거의 참이 되지 않는다 — 움직임 신호로 쓰지 말 것.
7. Android 에뮬레이터 금지(전역 규칙). **이 Mac 엔 Simulator.app 이 없다**(simctl 은 있으나 openurl 시간 초과) — iOS 문제는 코드 비교로 가리고 루오님 폰에서 확인.
8. 확인용 스위치(`?off`, `?gx`)는 작업 트리에만 두고 커밋 전에 걷는다.

## 6. B2 를 시작할 때 볼 것

- 보드 B2 대지: https://claude.ai/artifact/Vrp9XJgK3jzA58bBJWtFEB (생성기 main 의 `design/photo-themes/gen.mjs` 의 `B2desk`/`B2phone`: 둘러보기의 먼 지구본에 고리 한 겹, litK 2.2/litMin 2.6, 폰 1.5/2).
- 둘러보기 구조: `useGlobeView.ts`(모드 off/on/leaving), `GlobeView.tsx`(문, 이름표 driver), `Scene` 의 `globe` prop. 지금 주제 줄과 `ThemeRings` 는 **globe === 'off' 에서만** 그린다 — B2 는 'on' 에서 같은 선택을 쓰는 한 겹. 줄의 자리(보드는 H2′: 상단바 밑, 둘러보기에서도 같은 자리)도 정할 것.
- 메모리 `globe-view-proposal`: **OrbitControls prop 이 빠지면 북극으로 튄다.**
- 먼 화면 overdraw: 둘러보기는 여정보다 GPU 가 몇 배 무겁다(M1 7.6ms → LOD 후 4.1ms). 고리는 ThemeRings 처럼 셰이더 하나로, 겹침을 의식해서.
- 캔버스 위 DOM 에 흐림·마스크·그룹 opacity 금지(함정 2).

## 7. 남은 일

1. **B (멈추면 그리지 않기, frameloop "demand")** — 이번에 못 했다. 원칙: 무언가 움직이는 동안 + 수렴할 때까지만 invalidate. lerp/스프링은 오차 임계값으로 멈추고, 시간으로 자르지 않는다. useFrame 11곳:
   - `DotGlobe.tsx:160` DotGlobe(hush lerp) · `CityBounds.tsx:57` CityOutline · `CityBounds.tsx:102` CityBounds(blend) · `WorldBorders.tsx:311`(hush lerp, 칸 판정 — 카메라가 움직일 때만 필요)
   - `JourneyExperience.tsx:346` CityRing(스프링·handoff) · `:500` RouteLine(reveal) · `:563` RevealDriver · `:773` Camera(세 막 이동·follow)
   - `JourneyDot.tsx:79` HeadTracker(닷 자리·리본) · `:345` NoteSideProbe · `GlobeView.tsx:96` GlobeLabelDriver
   - 그 밖에 깨지면 안 되는 것: OrbitControls 감쇠·autoRotate(줌 < 0.2), 지도 끌기 힌트, 소리 연동(turnedTo), 테마 전환, 탭 복귀, 사진첩 열림('never').
2. **B2** — 위 6.
3. **C3** — `api/search`(방화벽은 총괄). Apple 설명문은 api 데이터에도 넣지 않는다. 정거장 요약은 `cityNotes.json` en + 주제별 수. "나/내 사진/셀카" → me. 요점은 `code-notes.md` 「Vercel api/」 절.
4. ~~통합 — captions 를 cityPhotos.json 에~~ → 캡션은 사이트가 `src/data/captions/` 를 직접 읽는다(b76d503). cityPhotos.json 에 넣지 않는다.

마지막 폰 측정(iOS Safari, 자동 재생): 기준선 5183 fps 33.7~35.9 / 16.7ms 초과 73~75%. 브랜치에 흐림 끔 39.7~47.8 / 37~50%, MSAA 끔 39.6~42.8 / 44~48% (둘 다 이번에 기본값으로 반영). 반영 후 기준선 대비 한 번 더 재는 것은 총괄이 루오님께 부탁하기로 했다.

---

# 2차 인계 (고급인력 → dev coder, 2026-10-02)

fe79fcf 이후. 브랜치 `feat/photo-themes`, worktree 그대로, **푸시 안 함**. 모든 커밋은 eslint · tsc -b · npm test · npm run build 종료 코드 0 으로 확인했다.

## 8. 커밋 (fe79fcf 이후, 오래된 것부터)

| 커밋    | 무엇                                                   | 왜 / 핵심                                                                                                                                             |
| ------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 51dbaf8 | perf: frameloop "demand"                               | 멈추면 그리지 않는다. 움직이는 것은 프레임 안에서 다음 프레임을 청한다(§9). 멈춘 화면 픽셀은 전과 같다(선 가장자리 한 샘플 차이).                     |
| 60c0ed5 | fix: 둘러보기 물러남이 끝난 줄 모르던 것               | `length() === fit` 반올림. demand 에서 멈춘 지구본이 계속 그려지던 원인.                                                                              |
| a1dc520 | feat: B2 — 둘러보기에 주제 줄·고리, 닿는 고리는 하나로 | `ThemeRings.tsx` 전면. 묶음은 카메라 거리로만(지도 배율 7% 마다 다시), 합치고 갈라질 때 ease. 합친 고리 누르면 갈라질 만큼 다가감(Camera 'aim' 단계). |
| dd714a4 | fix: 나라 지도 틀이 칸보다 크면 안 그림                | 벨기에 세로 폰 ⊔. 칸의 95% 기준.                                                                                                                      |
| 827c29c | fix: 합친 고리 탭은 더블탭의 첫 탭이 아님              | `useGlobeView.ts` `ringPress.at`.                                                                                                                     |
| 8e157a0 | chore: 고리 크기 벤치                                  | `themeRingScale.ts` RING_FAR, ?tune=1 슬라이더.                                                                                                       |
| 2e6db26 | feat: 혼자 있는 고리 → 사진첩                          | `handleOpenStop(city, stopId)`. 폰 여정 화면은 캔버스가 터치를 안 받아 누름을 window 에서 듣는다(제 일을 가진 요소는 제외).                           |
| d6fcfc8 | feat: 고리에서 원으로 열리고 고리로 닫힘               | 첫 켜진 사진 한 장 보기, 누르는 동안 고리 14% 조임, pointer 커서, 44px 누름.                                                                          |
| e6349fd | fix: 여정 화면 고리 누름이 goToCity 까지 일으키던 것   | 고리가 이김(`ringPress.at` 500ms).                                                                                                                    |
| 0ec3a58 | feat: 전환을 --ring 하나로                             | 처음 60% 원인 채 비행, 나머지 열림. 480/400ms. 인화지 타일 프리로드, 최대 120ms 대기.                                                                 |
| eb49f0d | fix: 끝까지 당기면 어떤 묶음이든 갈라짐                | 최대 확대의 70% 부터 핀 3px + 묶음 기준 0. 「가장 큰 도시를 연다」는 뺌.                                                                              |
| 379efb4 | feat: 둘러보기 혼자 있는 고리는 먼저 다가감            | 거리 4.5 (`COME_TO`), 그 안쪽이면 사진첩. 고리 누름 뒤 click 은 삼킨다.                                                                               |
| b76d503 | feat: 캡션 연결                                        | 원본 `src/data/captions/`, `src/lib/captions.ts` lazy glob, 사진첩 `.pb__cap`. **dev HMR 은 확인 못 함**(아래 §13).                                   |

## 9. 지금 동작 규칙 (루오님 확정)

- **여정 화면(globe 'off')**: 주제 켜면 B1 고리(묶지 않음). 혼자 있는 고리 누름 = 그 주제가 있는 첫 체류의, 시간순 첫 켜진 사진이 **원으로** 열림. 현재 도시 표식과 겹치면 고리가 이긴다. 도시 클릭 → goToCity 는 고리가 없을 때만.
- **둘러보기('on'·'leaving')**: 닿는 고리는 하나(무게중심, 사진 수 합, 바깥 가는 고리). 합친 고리 누름 = 갈라질 만큼 다가감. 혼자 있는 고리 누름 = 카메라 거리 > 4.5×1.08 이면 4.5 까지 다가감(여정 그대로, 손으로 잡으면 멈춤), 그 안쪽이면 사진첩. 「멀리서 누르면 가까이, 가까이서 누르면 안으로」.
- **최대 확대**: 가장 가까운 배율의 70% 부터 고리가 핀(3px)으로 줄며 묶음 기준이 0 으로 풀려, 끝까지 당기면 모두 혼자 선다(1.9px 떨어진 쌍도 있어 반지름만으로는 보장 불가). 누름 영역 44px, 겹치면 가장 가까운 고리.
- **닫기**: ✕·Esc·아래로 쓸기 → 지금 사진의 도시 고리로 원으로(없거나 주제 꺼지면 기존 규칙). 필름스트립에서 연 책은 사각으로. 열리다 닫거나 닫히다 잡아도 --ring 값에서 이어짐. reduced-motion 은 바로.
- **더블탭**: 합친 고리에 닿은 첫 탭은 「전체로 물러나기」의 첫 탭이 아니다. 혼자 있는 고리 더블탭은 첫 탭 동작(다가가기/열기) 그대로.
- **둘러보기에서 고리는 지도보다 천천히 커진다**(배율의 0.35 제곱, B1 크기 넘지 않음). 여정으로 돌아오면 0.2초에 B1 크기로.
- **가로 폰 사진첩**: 필름 띠·캡션 접힘 유지(9월 13일 결정, 6968f3c). 주제 줄은 그대로.
- **?tune=1 기본값(확정)**: 둘러보기 고리 폰 k 0.95 · min 1.6 · 선 1.1, 데스크톱 1.6 · 2.6 · 1.3, 성장 지수 0.35, 합치는 간격 1px, 핀 3px(`themeRingScale.ts` RING_FAR) / 고리→사진첩 열기 480ms · 닫기 400ms · 원 비율 0.6(RING_MOVE).

## 10. demand 아래에서 지켜야 할 것

- 캔버스는 `frameloop="demand"`(사진첩 열리면 'never'). 프레임은 `invalidate()` 가 청해야 그려진다.
- 스스로 움직이는 것은 **useFrame 안에서** 수렴 전까지 `invalidate()` 를 부른다(Camera, HeadTracker, CityRing 스프링, RevealDriver, hush ease, CityBounds, NoteSideProbe, ThemeRings). 멈춤은 시간이 아니라 **오차 문턱**(카메라는 땅 위 0.002px/프레임).
- React 가 바꾼 것·탭 복귀·GL 컨텍스트 복원은 `Wake` 컴포넌트가 한 프레임을 청한다. React 밖의 rAF(첫 걸음 기울임 useLean)는 제 rAF 안에서 `invalidate` 를 import 해 부른다.
- 오래 멈췄다 시작하는 첫 프레임은 delta 가 크다: 한 프레임만큼(1/60)만 가게 하라(`fresh` 패턴). 이걸 빼먹으면 첫 프레임이 튄다.
- 새 움직임을 더하면 반드시 「멈춘 뒤 프레임 0」을 확인하라(`node_modules/.cache/b1/demand.mjs` 가 초당 프레임을 센다).

## 11. --ring 전환 구조 (PhotoGallery)

- `.pb` 루트의 `--ring`(0 = 고리 위, 1 = 열림)과 `--pull` 을 transition 으로 움직인다. 슬롯 transform 과 프레임 clip-path 는 CSS 가 `--ring` 에서 계산(`--ring-hold` 까지는 원으로 비행, 나머지는 원이 모서리까지). 양 끝 좌표는 `setRing()` 이 `--ring-ax/ay/as`(고리) `--ring-bx/by/bs`(제자리 또는 손가락 아래 lift) `--ring-r0/r1` 로 쓴다.
- 고리 위치는 `ThemeRings` 가 `spot` ref 에 넣어 주는 함수로 묻는다(그려진 반지름 포함, 화면 밖이면 null).
- 열림은 첫 켜진 사진의 **인화지 타일(srcFor 480 exact)** decode 를 최대 120ms 기다린다. 본 사진 URL 은 틀 너비(배치 뒤 결정)로 정해져 누르는 시점에 알 수 없고, 짐작으로 부르면 Cloudinary 에 새 파생 크기가 생긴다 — **절대 금지**.

## 12. 캡션

- 원본 **`src/data/captions/<cityCode>.json`** 한 곳(cityCode = 사진 id 의 번호 앞부분). 캡션 도구(`design/caption-tool/server.mjs`)도 같은 경로. cityPhotos.json 에는 넣지 않는다.
- `src/lib/captions.ts`: `import.meta.glob` lazy — 도시를 볼 때 그 파일만(빌드는 도시마다 청크 하나, dist 에 captions 외 design 파일 없음을 grep 으로 확인). `useCaption(photoId, lang)` 은 파일이 오기 전 `undefined` 를 주고 `.pb__text` 가 한 줄 자리를 비워 둔다.

## 13. 남은 일

1. **dev HMR 확인** — 캡션 파일을 고쳤을 때 dev 서버에서 사진첩에 바로 반영되는지 보지 못했다(preview 는 재빌드로 반영됨을 확인). JSON 변경이 glob importer 를 거쳐 PhotoGallery 로 전파되는지 한 번 보고, 안 되면 `captions.ts` 에 `import.meta.hot` 처리.
2. **C3** — `api/search`(방화벽은 총괄). Apple 설명문은 api 데이터에도 넣지 않는다.
3. **통합·배포** — 마지막 프로덕션 배포는 루오님 허락 뒤 한 번(Cloudinary). 푸시 전 `npm run build`.
4. **?perf=1 오버레이**(`src/lib/perfOverlay.ts` + `src/main.tsx` 세 줄, 작업 트리에만) — 남길지 걷을지 정한다. 커밋하지 말 것.
5. 측정 스크립트는 `node_modules/.cache/b1/`(demand.mjs 프레임 수, b2cast.mjs 전환 프레임 녹화, b2stuck/b2come 고리 누름, capshot 캡션). git 밖.
