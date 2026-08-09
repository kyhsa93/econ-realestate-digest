# 경제·부동산 데일리 다이제스트

매일 아침 경제/부동산 뉴스, 자산 시장 지표(코스피·환율·기준금리), 오픈소스 AI 요약을
GitHub Actions로 자동 갱신해 보여주는 GitHub Pages 사이트.

사이트: https://kyhsa93.github.io/econ-realestate-digest/

## 구조

- `scripts/fetch-news.mjs` — 경제지 RSS 파싱 → `docs/data/news.json`
- `scripts/fetch-market.mjs` — 코스피/환율/기준금리 조회 → `docs/data/market.json`
- `scripts/summarize-digest.mjs` — 로컬 Ollama(qwen2.5:1.5b)로 오늘의 뉴스/시장 지표를 한국어로 요약 → `docs/data/summary.json`
- `scripts/update-all.mjs` — 로컬에서 수동으로 fetch + git commit/push까지 한 번에 실행할 때 사용 (CI에서는 사용 안 함)
- `docs/index.html` — 정적 페이지, 클라이언트에서 `data/*.json`을 fetch해 렌더링
- `.github/workflows/daily-update.yml` — 매일 08:00 KST(23:00 UTC)에 뉴스/시장 지표 수집 → Ollama 설치 후 AI 요약 생성 → 변경사항 커밋/푸시

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

현재 미포함. KB부동산 데이터허브는 비공식 API + 봇 차단으로 접근 불가함을 확인했고,
공식 대안(공공데이터포털 실거래가 API, 한국부동산원 R-ONE)은 개인 인증키/로그인이 필요해
추후 인증키 발급 후 `scripts/fetch-realestate.mjs`를 추가해 연동 예정.
