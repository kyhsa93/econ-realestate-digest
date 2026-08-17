# 경제·부동산 데일리 다이제스트

경제/부동산 뉴스, 자산 시장 지표, 서울 아파트 실거래가, 예적금·대출 금리를 GitHub Actions로
모아 GitHub Pages에 올리는 정적 사이트. AI 요약(한/영)은 러너에 설치한 Ollama로 만든다.

사이트: https://kyhsa93.github.io/econ-realestate-digest/

## 데이터 흐름

```
외부 API/RSS → scripts/fetch-*.mjs → raw/ 또는 docs/data/*.json
                                   → scripts/build-*.mjs → docs/data/*.json + 정적 HTML
                                   → 커밋 → Pages 배포
```

실거래만 흐름이 하나 더 있다. 국토부 응답을 `raw/`에 원본 그대로 6개월치 보관하고,
화면이 받는 파일은 전부 거기서 다시 만든다.

## 스크립트

### 수집

| 파일 | 하는 일 |
|---|---|
| `fetch-news.mjs` | 경제지 RSS → `docs/data/news.json` (카테고리·미리보기·중복 매체 포함) |
| `fetch-market.mjs` | 코스피·환율·기준금리 → `docs/data/market.json` |
| `fetch-realestate.mjs` | 국토부 실거래 API → `raw/<sale\|rent>/<구코드>-<년월>.json` |
| `fetch-rates.mjs` | 금감원 금융상품 공시 → `docs/data/rates.json` |
| `article-body.mjs` | RSS가 본문을 안 주는 매체의 기사 본문 수집 (`cache/news-bodies.json`) |

### 실거래 원본

| 파일 | 하는 일 |
|---|---|
| `realestate-slots.mjs` | (종류, 자치구, 년월) 슬롯 단위로 무엇을 받을지 정한다 |
| `realestate-raw.mjs` | 원본 저장·읽기. 응답이 같으면 다시 쓰지 않는다 |
| `realestate-source.mjs` | 원본에서 최근 석 달 거래를 꺼낸다 |
| `realestate-districts.mjs` | 서울 25개 자치구 코드·이름 |
| `realestate-metrics.mjs` | 평당가·평균 계산, 거래 정규화 |
| `realestate-weekly.mjs` | 신고가 들어온 주 기준 시세 집계 |
| `realestate-previous.mjs` | 지난달 요약을 이번 달 값에 `prev`로 얹는다 (덮어쓰거나 합산하지 않는다) |

**받는 규칙**: 당월과 전월은 날마다 다시 받고(계약 후 30일 이내 신고라 지난달 계약분이
이번 달 내내 들어온다), 매월 1~3일에는 전전월까지 넓힌다. 나머지 넉 달은 파일이 있으면
건드리지 않는다. 없거나 깨진 슬롯은 한 실행에 최대 100개씩 채운다(`MOLIT_BACKFILL_LIMIT`).

**신고일**: 국토부 응답에 신고일이 없어서, 어제 원본에 없다가 오늘 나타난 거래를 그날 신고로
본다. 원본 파일의 `arrivals`에 남긴다. 처음 받은 달의 거래에는 날짜를 붙이지 않는다.

### 가공

| 파일 | 하는 일 |
|---|---|
| `build-realestate.mjs` | 원본 → `realestate.json`·히스토리·주간 시세·`rents-<슬러그>.json` |
| `build-budget-deals.mjs` | 원본 → 예산 구간(`budget-deals.json`·`deal-search.json`)·`deals-<슬러그>.json` |
| `budget-bands.mjs` | 거래를 1억 단위 구간으로 자른다 (3억 미만·30억 이상은 각각 한 칸) |
| `deal-files.mjs` | 자치구별 전수 거래 파일 생성 |
| `build-history-lite.mjs` | 메인 차트용 경량 히스토리 (최근 35일, 필요한 필드만) |
| `realestate-format.mjs` | 평당가를 84㎡ 환산가로 옮긴다 |
| `district-summary.mjs` | 자치구 페이지의 서술 문단 (그 지역 데이터로만 만들 수 있는 문장) |
| `interest.mjs` | 예적금 세후 이자 계산 (세율 15.4%, 적금은 회차별 이자 기간 반영) |
| `news-context.mjs` | 기사에 자체 수집 수치를 붙인다 (자치구 평당가, 예금·대출 금리) |
| `categories.mjs` | 뉴스 카테고리 정의. 수집과 요약이 공유 |
| `summary-needed.mjs` | 지금 다시 요약할 만한지 판정 |
| `summarize-digest.mjs` | Ollama로 카테고리별 한/영 요약. 생성 문장은 원문 대조로 검증 |
| `translate-news.mjs` | 뉴스 제목 영어 번역 |

### 페이지 생성

| 파일 | 하는 일 |
|---|---|
| `prerender.mjs` | `docs/data/*.json`을 정적 마크업으로 `index.html`·`rates.html`에 심는다 |
| `build-rate-pages.mjs` | 상품군별 금리 페이지 4개 |
| `build-realestate-pages.mjs` | 거래 유형별 3개 + 자치구별 25개 |
| `build-news-pages.mjs` | 분야별 뉴스 페이지 3개 |
| `build-budget-pages.mjs` | 예산 구간별 착지 페이지 |
| `budget-pages.mjs`, `district-slugs.mjs` | 위 페이지들의 주소 조각 |

### 그 밖

| 파일 | 하는 일 |
|---|---|
| `update-all.mjs` | 로컬에서 수집·빌드·커밋을 한 번에 |
| `push-docs.sh` | `docs`와 `raw`를 커밋·푸시. 실패 시 rebase 후 재시도 |
| `backtest-news-context.mjs` | 뉴스 매칭 규칙을 과거 기사 전체로 대조 (`--days N`) |

## 화면

| 페이지 | 내용 |
|---|---|
| `index.html` | 종합 다이제스트. `?date=`로 아카이브 |
| `news.html` | 뉴스 허브 + AI 요약 |
| `realestate.html` | 아파트 시세 (자치구별 평당가·84㎡ 환산가) |
| `deal-search.html` | 실거래 검색. 매매·전세·월세를 지역·금액·면적·연식·단지명으로 |
| `rates.html` | 예적금·대출 금리 비교. 세후 이자 열 포함 |
| `analytics.js` | GA4 + 애드센스 로더 (블로그 저장소와 공유) |

## 로컬 실행

```
npm install
npm run update        # 수집 → 빌드 → 커밋·푸시
npm test
```

실거래·금리는 인증키가 필요하다(`.env`는 커밋되지 않는다).

```
node --env-file=.env scripts/fetch-realestate.mjs
node --env-file=.env scripts/build-realestate.mjs
```

AI 요약은 로컬 Ollama가 있어야 한다.

```
ollama pull qwen3:14b
OLLAMA_THINK=false node scripts/summarize-digest.mjs
```

테스트는 인증키 없이 전부 돈다. 외부 API는 스텁 서버로 대신한다
(`test/helpers/fake-molit.mjs`, `FSS_API_BASE`).

## 자동화

| 워크플로 | 언제 | 하는 일 |
|---|---|---|
| `daily-update.yml` | 하루 4회 (08·12·16·20시 KST) | 뉴스 수집. 아침(`MODE=full`)만 시장지표·실거래·금리까지 |
| `summarize.yml` | 위 워크플로 뒤 | AI 요약·번역. `summary-needed`가 필요하다고 할 때만 모델을 받는다 |
| `summary-experiment.yml` | 수동 | 커밋된 뉴스로 요약 모델 비교. 커밋·배포하지 않는다 |

수동 실행은 Actions 탭에서 `workflow_dispatch`로. `daily-update`는 `mode`(full/news),
`summarize`는 `force`를 고를 수 있다. 두 워크플로는 `concurrency: digest-pipeline`으로
같은 줄에 선다(둘 다 `docs`를 커밋한다).

## 환경변수

| 이름 | 용도 |
|---|---|
| `MOLIT_API_KEY` / `MOLIT_API_ENDPOINT` | 아파트 매매 실거래 |
| `MOLIT_RENT_API_KEY` / `MOLIT_RENT_API_ENDPOINT` | 아파트 전월세 실거래 |
| `FSS_FINLIFE_API_KEY` | 금감원 금융상품 공시 |
| `OLLAMA_MODEL` / `OLLAMA_THINK` | 요약 모델 (현재 `qwen3:14b`, `false`) |
| `MOLIT_CONCURRENCY` / `MOLIT_RETRY_MS` / `MOLIT_SWEEP_DELAY_MS` / `MOLIT_BACKFILL_LIMIT` | 실거래 수집 조절 (3 / 3000 / 45000 / 100) |
| `SUMMARY_NEW_ARTICLES` / `SUMMARY_UNTRANSLATED` | 재요약 판정 임계값 |
| `RATES_FORCE` | 같은 날 금리를 다시 받는다 |

엔드포인트 URL도 시크릿으로 주입한다. 매매와 전월세는 독립적이라 한쪽만 등록해도 그쪽만 돈다.

**금감원 키는 finlife.fss.or.kr에서 직접 발급받는 32자리이고, 파라미터명이 `serviceKey`가
아니라 `auth`다. 요청에 User-Agent가 없으면 서버가 TLS 핸드셰이크 직후 연결을 끊는다.**

## 지키는 규칙

**데이터**

- 자치구 평당가는 그 달 신고가 5건 미만이면 값을 내지 않는다. 표가 평당가 내림차순이라
  비싼 한 건이 잡힌 구가 맨 위로 올라간다. 정적 HTML에서도 같은 기준을 지킨다.
- 증감 기준값은 같은 달 안에서만 찾는다. 달이 바뀌면 이레가 찰 때까지 증감이 빈다.
- 거래내역 검색은 계약일 기준, 주간 시세는 신고일 기준이다.
- 화면 문구는 "신고된 거래"라고 적는다. 매물이 아니다.
- 조건에 맞는 전수 자료가 없으면 요약으로 대신 답하지 않고 그 사실을 적는다.
- AI 요약은 원문에 없는 숫자·고유명사가 있으면 폐기하고 사유를 `fallbackReason`에 남긴다.

**화면**

- 필터·검색·탭은 주소에 남긴다. 검색은 `replaceState`, 되돌릴 만한 조작만 `pushState`.
- 정적 마크업과 클라이언트 렌더는 구조·글자를 맞춘다. 어긋나면 데이터를 받는 순간 화면이 튄다.
  상대 시간("3시간 전")만은 정적 HTML에 넣지 않는다.
- `hidden` 요소에 CSS로 `display`를 지정하지 않는다. 모든 페이지에
  `[hidden] { display: none !important; }`를 둔다.
- 기록이 없는 날짜와 로드 실패를 구분해 말하고, 판정은 섹션마다 따로 한다.
- 로드 실패 문구에는 원인(`HTTP 503`)을 싣고 재시도 버튼을 준다.
- 서비스워커는 네트워크 우선. 캐시 키에서 쿼리를 뗀다.

**분량**

- 화면이 받는 파일은 필요한 만큼만 담는다. `rates.json`은 570KB라 뉴스 페이지에 붙이지 않고
  값을 미리 계산해 넣는다. 히스토리는 경량본을 따로 만든다.
- 자치구별 전수 파일은 지역마다 나눈다. 전월세는 매매의 여덟 배라 서울 전체를 한 번에 받지 않고
  지역을 고르게 한다.

## GA / 애드센스

블로그(`kyhsa93.github.io`)와 같은 GA4 속성(`G-Z1LH7S1ZE5`)·애드센스 게시자
(`ca-pub-1195159445218373`)를 쓴다. 둘 다 브라우저에 노출되는 공개 값이라 `docs/analytics.js`에
직접 둔다.

- 페이지뷰는 자동 전송하지 않는다(`send_page_view: false`). 저장된 언어로 제목을 바꾼 뒤
  `analytics.pageView({ site_language })`를 부르고, 렌더가 실패하면 4초 타이머가 대신 보낸다.
- 사이트 구분은 페이지의 `<meta name="site-group">`을 `content_group`으로 싣는다.
  같은 도메인·같은 속성을 여러 프로젝트가 쓰기 때문이다.
- 커스텀 이벤트: `news_filter` `news_click` `archive_jump` `district_select` `share`(index),
  `rate_tab` `rate_sort` `rate_filter` `product_expand`(rates), `deal_search`(검색),
  `section_view`, `exception`, `search`·`language_switch`(공통).
- **매개변수 이름에 `value`를 쓰지 않는다.** GA4 예약어라 문자열이 수집되지 않는다
  (`filter_value`를 쓴다).
- `?ga_debug=1`을 붙이면 DebugView에 찍힌다.

`ads.txt`는 블로그 저장소가 도메인 루트에서 서빙한다. 개인정보처리방침도 블로그의
`https://kyhsa93.github.io/privacy-policy`를 링크한다.

## 출처

- 뉴스: 경제지 RSS (매일경제는 robots.txt에서 크롤러를 막아 제외)
- 실거래: 공공데이터포털 국토교통부 아파트 매매·전월세 실거래 자료. 서울 25개 자치구 전체
- 금리: 금융감독원 금융상품통합비교공시
- 시장 지표: 코스피·원달러 환율·한국은행 기준금리
