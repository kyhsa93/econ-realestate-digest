# 경제·부동산 데일리 다이제스트

경제/부동산 뉴스(하루 4회), 자산 시장 지표(코스피·환율·기준금리), 한국 부동산 실거래가,
오픈소스 AI 요약(한/영)을 GitHub Actions로 자동 갱신해 보여주는 GitHub Pages 사이트.

사이트: https://kyhsa93.github.io/econ-realestate-digest/

## 구조

- `scripts/fetch-news.mjs` — 경제지 RSS 파싱 → `docs/data/news.json`. 기사마다 카테고리(`category`),
  한두 줄 미리보기(`preview`), 같은 사건을 다룬 다른 매체(`dupes`)를 함께 저장한다
- `scripts/categories.mjs` — 뉴스 카테고리(키워드) 정의. 수집(`fetch-news`)과 요약(`summarize-digest`)이
  같은 기준으로 묶이도록 공유하는 모듈
- `scripts/fetch-market.mjs` — 코스피/환율/기준금리 조회 → `docs/data/market.json`
- `scripts/fetch-realestate.mjs` — 국토교통부 아파트매매·전월세 실거래가 API(서울 25개 자치구 전체,
  이번 달)로 구별 매매/전세 평당가 + 월세(보증금·월세 평균) + 서울 전체 평균, 1주일 전 대비
  증감(매매·전세만)까지 조회 → `docs/data/realestate.json` (예전엔 월초 표본 부족을 피하려고
  지난달까지 2개월을 합쳤는데, 요청량이 2배가 돼서 25개구 조회 시 일일 호출 한도에 걸려서
  이번 달만 조회하도록 변경)
  (`MOLIT_API_KEY`+`MOLIT_API_ENDPOINT`는 매매, `MOLIT_RENT_API_KEY`+`MOLIT_RENT_API_ENDPOINT`는
  전월세 — 둘은 독립적으로 동작해서 한쪽만 등록돼 있어도 그쪽만 조회함)
- `scripts/summarize-digest.mjs` — 로컬 Ollama(qwen3:14b)로 오늘의 뉴스를 카테고리별로 한국어/영어 요약 →
  `docs/data/summary.json`. 생성한 문장은 코드로 검증한다: 원문에 없는 숫자(substring 대조)와
  원문에 없는 고유명사(모델에겐 추출만 시키고 대조는 코드가 함)가 있으면 폐기하고 헤드라인
  나열로 대체하며, 그 사유를 `categories[].fallbackReason`에 남긴다
- `scripts/translate-news.mjs` — 뉴스 제목을 영어로 번역(`titleEn`) → `docs/data/news.json`
- `scripts/update-all.mjs` — 로컬에서 수동으로 fetch + git commit/push까지 한 번에 실행할 때 사용 (CI에서는 사용 안 함)
- `docs/index.html` — 정적 페이지, 클라이언트에서 `data/*.json`을 fetch해 렌더링, 한/영 언어 전환 지원.
  뉴스 섹션은 카테고리 필터·검색·상대 시간("3시간 전")·읽은 기사 흐리게(로컬 저장) 지원.
  `?date=YYYY-MM-DD` 쿼리를 붙이면 별도 아카이브 페이지 없이 이 페이지 자체가 각 `*-history.json`에서
  그 날짜 기록을 찾아 오늘과 똑같은 섹션 구성(요약/시장지표/부동산/뉴스)으로 다시 렌더링함(실시간 환율만
  예외 — 그 날짜의 배치 값을 그대로 보여줌). 페이지 하단 "지난 기록" 목록에서 날짜별로 이동 가능
- `.github/workflows/summary-experiment.yml` — 수동 전용. 요약 모델을 바꾸기 전에 저장소에 이미
  커밋된 그날 뉴스로 모델을 비교해보는 용도(뉴스를 다시 받지 않아 모델 간 조건이 같음).
  결과는 로그로만 출력하고 커밋/배포하지 않음. qwen3 계열은 `disable_thinking`을 켜야 함
  (`OLLAMA_THINK=false` → 요청에 `think: false` 추가)
- `.github/workflows/daily-update.yml` — 하루 4회(08·12·16·20시 KST) 실행. 매 실행마다 뉴스 수집 +
  AI 요약 + 제목 영어 번역을 하고, 아침 실행(`MODE=full`)만 시장지표/부동산까지 추가로 수집한다
  (부동산 실거래가 API의 일일 호출 한도 때문에 그쪽만 아침 1회로 고정). 이후 변경사항
  커밋/푸시 → Pages 배포.
  요약/번역 모델은 `OLLAMA_MODEL`(현재 `qwen3:14b`) + `OLLAMA_THINK=false`를 job 레벨 env로 주입한다.
  러너가 4코어 CPU(GPU 없음)/16GB RAM이라 RAM에 들어가는 상한이 14b급(Q4 약 9GB)이고, 같은 뉴스로
  qwen2.5:14b와 비교 실행해서 고른 값이다. 그만큼 느려서 실행 1회에 15~20분 걸린다(요약·번역이 대부분)

## 로컬 실행

```
npm install
npm run update   # 뉴스+시장지표 수집 후 커밋/푸시까지
```

AI 요약은 로컬에 Ollama가 설치돼 있어야 테스트 가능(qwen3 계열은 thinking을 꺼야 하므로
`OLLAMA_THINK=false`가 필요하다 — 안 끄면 응답에 `<think>` 블록이 붙어 전부 폐기된다):

```
ollama pull qwen3:14b
OLLAMA_THINK=false node scripts/summarize-digest.mjs
```

## 자동화

GitHub Actions(`daily-update.yml`)가 하루 4회 자동 실행. 수동 실행은 Actions 탭에서
"Digest update" 워크플로를 `workflow_dispatch`로 트리거하며, 이때 `mode`(full/news)를 골라
전체 갱신인지 뉴스만 갱신인지 정할 수 있다.

(참고: 이전에 Claude 클라우드 루틴으로 자동화를 시도했으나 GitHub Actions로 전환하며 비활성화함)

## GA / 애드센스

`kyhsa93.github.io` 블로그와 동일한 GA4 속성(`G-Z1LH7S1ZE5`)·애드센스 게시자(`ca-pub-1195159445218373`)를
그대로 재사용함. 두 값 다 방문자 브라우저에 그대로 노출되는 공개 값이라 시크릿으로 다루지 않고
`docs/index.html`에 직접 하드코딩함.

별도 쿠키 동의 배너 없이 페이지 로드 시 GA/애드센스 스크립트를 바로 불러옴(요청에 따라 배너 제거).

`ads.txt`는 도메인 루트(`kyhsa93.github.io/ads.txt`)에서 서빙돼야 하는데, 이 저장소는 프로젝트
페이지(`kyhsa93.github.io/econ-realestate-digest/`)라 이 저장소만으로는 둘 수 없음 — 이미 블로그
저장소(`kyhsa93.github.io`)의 `public/ads.txt`가 같은 게시자 ID로 도메인 루트를 커버하고 있어서
별도 조치가 필요 없었음(확인 완료).

애드센스 자동 광고(Auto ads) 설정만 돼 있고 이 페이지에 명시적 광고 슬롯(`<ins>`)은 아직 없음 —
광고 배치는 별도 요청 시 진행.

개인정보처리방침은 별도 페이지를 두지 않고, 블로그 저장소(`kyhsa93.github.io`)가 이미 갖고 있는
`https://kyhsa93.github.io/privacy-policy`를 footer에서 그대로 링크함(같은 GA4/애드센스 계정을
쓰므로 내용도 동일하게 적용됨).

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
