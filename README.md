# 경제·부동산 데일리 다이제스트

매일 아침 경제/부동산 뉴스와 자산 시장 지표(코스피·환율·기준금리)를 자동으로 갱신해 보여주는 GitHub Pages 사이트.

사이트: https://kyhsa93.github.io/econ-realestate-digest/

## 구조

- `scripts/fetch-news.mjs` — 경제지 RSS 파싱 → `docs/data/news.json`
- `scripts/fetch-market.mjs` — 코스피/환율/기준금리 조회 → `docs/data/market.json`
- `scripts/update-all.mjs` — 위 두 스크립트 실행 후 변경사항 커밋/푸시
- `docs/index.html` — 정적 페이지, 클라이언트에서 `data/*.json`을 fetch해 렌더링

## 로컬 실행

```
npm install
npm run update
```

## 한국 부동산 가격 추이

현재 미포함. KB부동산 데이터허브는 비공식 API + 봇 차단으로 접근 불가함을 확인했고,
공식 대안(공공데이터포털 실거래가 API, 한국부동산원 R-ONE)은 개인 인증키/로그인이 필요해
추후 인증키 발급 후 `scripts/fetch-realestate.mjs`를 추가해 연동 예정.
