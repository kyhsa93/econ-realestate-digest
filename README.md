# 경제·부동산 데일리 다이제스트

매일 아침 경제/부동산 뉴스, 자산 시장 지표(코스피·환율·기준금리), 한국 부동산 실거래가,
오픈소스 AI 요약(한/영)을 GitHub Actions로 자동 갱신해 보여주는 GitHub Pages 사이트.

사이트: https://kyhsa93.github.io/econ-realestate-digest/

## 구조

- `scripts/fetch-news.mjs` — 경제지 RSS 파싱 → `docs/data/news.json`
- `scripts/fetch-market.mjs` — 코스피/환율/기준금리 조회 → `docs/data/market.json`
- `scripts/fetch-realestate.mjs` — 국토교통부 아파트매매·전월세 실거래가 API(서울 25개 자치구 전체,
  이번 달)로 구별 매매/전세 평당가 + 월세(보증금·월세 평균) + 서울 전체 평균, 1주일 전 대비
  증감(매매·전세만)까지 조회 → `docs/data/realestate.json` (예전엔 월초 표본 부족을 피하려고
  지난달까지 2개월을 합쳤는데, 요청량이 2배가 돼서 25개구 조회 시 일일 호출 한도에 걸려서
  이번 달만 조회하도록 변경)
  (`MOLIT_API_KEY`+`MOLIT_API_ENDPOINT`는 매매, `MOLIT_RENT_API_KEY`+`MOLIT_RENT_API_ENDPOINT`는
  전월세 — 둘은 독립적으로 동작해서 한쪽만 등록돼 있어도 그쪽만 조회함)
- `scripts/summarize-digest.mjs` — 로컬 Ollama(qwen2.5:3b)로 오늘의 뉴스를 카테고리별로 한국어/영어 요약 → `docs/data/summary.json`
- `scripts/translate-news.mjs` — 뉴스 제목을 영어로 번역(`titleEn`) → `docs/data/news.json`
- `scripts/update-all.mjs` — 로컬에서 수동으로 fetch + git commit/push까지 한 번에 실행할 때 사용 (CI에서는 사용 안 함)
- `docs/index.html` — 정적 페이지, 클라이언트에서 `data/*.json`을 fetch해 렌더링, 한/영 언어 전환 지원.
  `?date=YYYY-MM-DD` 쿼리를 붙이면 별도 아카이브 페이지 없이 이 페이지 자체가 각 `*-history.json`에서
  그 날짜 기록을 찾아 오늘과 똑같은 섹션 구성(요약/시장지표/부동산/뉴스)으로 다시 렌더링함(실시간 환율만
  예외 — 그 날짜의 배치 값을 그대로 보여줌). 페이지 하단 "지난 기록" 목록에서 날짜별로 이동 가능
- `.github/workflows/daily-update.yml` — 매일 08:00 KST(23:00 UTC)에 뉴스/시장/부동산 지표 수집 → Ollama 설치 후 AI 요약·번역 생성 → 변경사항 커밋/푸시

## 로컬 실행

```
npm install
npm run update   # 뉴스+시장지표 수집 후 커밋/푸시까지
```

AI 요약은 로컬에 Ollama가 설치돼 있어야 테스트 가능:

```
ollama pull qwen2.5:3b
node scripts/summarize-digest.mjs
```

## 자동화

GitHub Actions(`daily-update.yml`)가 매일 자동 실행. 수동 실행은 Actions 탭에서
"Daily digest update" 워크플로를 `workflow_dispatch`로 트리거.

(참고: 이전에 Claude 클라우드 루틴으로 자동화를 시도했으나 GitHub Actions로 전환하며 비활성화함)

## 한국 부동산 가격 추이

공공데이터포털 "국토교통부_아파트매매 실거래자료" + "국토교통부_아파트 전월세 실거래가 자료" API 사용
(KB부동산 데이터허브는 비공식 API + 봇 차단으로 접근 불가함을 먼저 확인함). 서비스키뿐 아니라 API
엔드포인트 URL도 GitHub 저장소 Secret으로 주입함:

- `MOLIT_API_KEY` / `MOLIT_API_ENDPOINT` — 아파트매매
- `MOLIT_RENT_API_KEY` / `MOLIT_RENT_API_ENDPOINT` — 아파트 전월세

로컬 실행 시에는 환경변수로 넘기면 됨:

```
MOLIT_API_KEY=발급받은키 MOLIT_API_ENDPOINT=매매_엔드포인트 \
MOLIT_RENT_API_KEY=발급받은키 MOLIT_RENT_API_ENDPOINT=전월세_엔드포인트 \
node scripts/fetch-realestate.mjs
```

작업 시작 직후 잠깐 네트워크가 불안정해서 앞쪽 몇 개 구가 통째로 fetch failed로
빠지는 경우를 실제로 겪어서(개별 재시도 백오프만으론 못 버팀), 1차 조회가 끝난 뒤
실패한 구만 모아 한 번 더 훑는 재시도 스윕을 둠.

전월세는 전세(보증금만)와 월세(보증금+월세)를 나눠서 집계함: 전세는 매매처럼 평당
보증금으로, 월세는 면적 정규화 없이 평균 보증금/월세 그대로 표시. 증감 추적(1주일 전 대비)은
매매·전세에만 적용 — 월세는 보증금/월세 두 축이라 하나의 증감 지표로 압축하지 않음.

서울 25개 자치구 전체를 추적하며, 서울 기준 값이지 전국 대표값은 아님.
가격 증감은 히스토리에서 1주일 전에 가장 가까운 기록을 기준값으로 비교함
(도입 초기라 7일치가 없으면 가장 오래된 기록을 대신 사용).
