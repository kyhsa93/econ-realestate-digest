# 경제·부동산 데일리 다이제스트

매일 아침 경제/부동산 뉴스, 자산 시장 지표(코스피·환율·기준금리), 한국 부동산 실거래가,
오픈소스 AI 요약(한/영)을 GitHub Actions로 자동 갱신해 보여주는 GitHub Pages 사이트.

사이트: https://kyhsa93.github.io/econ-realestate-digest/

## 구조

- `scripts/fetch-news.mjs` — 경제지 RSS 파싱 → `docs/data/news.json`
- `scripts/fetch-market.mjs` — 코스피/환율/기준금리 조회 → `docs/data/market.json`
- `scripts/fetch-realestate.mjs` — 국토교통부 아파트매매 실거래가 API(서울 5개구: 강남·서초·송파·마포·노원, 최근 2개월)로
  평당가 조회 → `docs/data/realestate.json` (`MOLIT_API_KEY` 필요, 없으면 조용히 생략)
- `scripts/summarize-digest.mjs` — 로컬 Ollama(qwen2.5:1.5b)로 오늘의 뉴스를 카테고리별로 한국어/영어 요약 → `docs/data/summary.json`
- `scripts/translate-news.mjs` — 뉴스 제목을 영어로 번역(`titleEn`) → `docs/data/news.json`
- `scripts/update-all.mjs` — 로컬에서 수동으로 fetch + git commit/push까지 한 번에 실행할 때 사용 (CI에서는 사용 안 함)
- `docs/index.html` — 정적 페이지, 클라이언트에서 `data/*.json`을 fetch해 렌더링, 한/영 언어 전환 지원
- `.github/workflows/daily-update.yml` — 매일 08:00 KST(23:00 UTC)에 뉴스/시장/부동산 지표 수집 → Ollama 설치 후 AI 요약·번역 생성 → 변경사항 커밋/푸시

## 로컬 실행

```
npm install
npm run update   # 뉴스+시장지표 수집 후 커밋/푸시까지
```

AI 요약은 로컬에 Ollama가 설치돼 있어야 테스트 가능:

```
ollama pull qwen2.5:1.5b
node scripts/summarize-digest.mjs
```

## 자동화

GitHub Actions(`daily-update.yml`)가 매일 자동 실행. 수동 실행은 Actions 탭에서
"Daily digest update" 워크플로를 `workflow_dispatch`로 트리거.

(참고: 이전에 Claude 클라우드 루틴으로 자동화를 시도했으나 GitHub Actions로 전환하며 비활성화함)

## 한국 부동산 가격 추이

공공데이터포털 "국토교통부_아파트매매 실거래자료" API 사용 (KB부동산 데이터허브는 비공식
API + 봇 차단으로 접근 불가함을 먼저 확인함). 서비스키뿐 아니라 API 엔드포인트 URL도
GitHub 저장소 Secret으로 주입함(`MOLIT_API_KEY`, `MOLIT_API_ENDPOINT`). 로컬 실행 시에는
환경변수로 넘기면 됨:

```
MOLIT_API_KEY=발급받은키 \
MOLIT_API_ENDPOINT=http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev \
node scripts/fetch-realestate.mjs
```

서울 5개구(강남·서초·송파·마포·노원)만 추적하는 표본이라 전국 대표값은 아님.
