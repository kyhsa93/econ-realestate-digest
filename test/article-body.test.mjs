import test from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, extractArticleBody, isScrapable, stripTags } from "../scripts/article-body.mjs";

const HANKYUNG_URL = "https://www.hankyung.com/article/2026081425951";
const YNA_URL = "https://www.yna.co.kr/view/AKR20260815011500002";

const hankyungPage = `<!doctype html><html><head>
<meta name="description" content="김윤덕 장관 용산공원 전체, 주택 공급지로 검토">
</head><body>
<nav>집코노미 한경 PREMIUM9 구독하기</nav>
<div class="article-body" id="articletxt">
<script>const apiDomain = location.host.startsWith("stg-") ? "https://apidev.hankyung.com" : "https://api.hankyung.com";</script>
<p>국토부 장관 &quot;모든 가능성 열고 어린이정원&middot;캠프킴 등도 활용&quot;</p>
<p>정부가 연내 발표할 신규 공공택지 후보지에 서울 용산어린이정원을 포함하는 방안을 추진한다.</p>
<p>김윤덕 국토교통부 장관은 14일 세종시에서 열린 기자간담회에서 이같이 밝혔다.</p>
</div>
</div>
<footer>저작권자 ⓒ 한국경제</footer>
</body></html>`;

const ynaPage = `<!doctype html><html><head>
<meta property="og:description" content="(서울=연합뉴스) 이세원 기자 = 다음 주에는 한국개발연구원의 수정 경제전망이 발표된다.">
</head><body>
<article class="story-news">
<p class="txt-con">다음 주에는 한국개발연구원의 수정 경제전망이 발표된다.</p>
<p class="txt-con">KDI는 5월 보고서에서 올해 한국의 실질 국내총생산이 작년보다 2.5% 성장할 것이라고 내다봤다.</p>
<p>한지훈 기자 구독 구독중</p>
<p>인공지능이 자동으로 요약한 내용입니다.</p>
</article>
</body></html>`;

test("한경 기사에서 본문 문단만 뽑는다", () => {
  const body = extractArticleBody(HANKYUNG_URL, hankyungPage);

  assert.match(body, /신규 공공택지 후보지/);
  assert.match(body, /어린이정원·캠프킴/, "HTML 엔티티가 그대로 남았다");
  assert.doesNotMatch(body, /apiDomain|location\.host/, "컨테이너 안의 스크립트가 본문에 섞였다");
  assert.doesNotMatch(body, /집코노미|저작권자/, "컨테이너 밖 내비게이션·푸터가 딸려 왔다");
});

test("연합 기사에서 구독 위젯과 자동요약 안내를 걸러낸다", () => {
  const body = extractArticleBody(YNA_URL, ynaPage);

  assert.match(body, /한국개발연구원의 수정 경제전망/);
  assert.match(body, /2\.5% 성장/, "숫자가 사라지면 요약에 쓸 알맹이가 없다");
  assert.doesNotMatch(body, /구독중/);
  assert.doesNotMatch(body, /인공지능이 자동으로/);
});

test("매체별 규칙이 안 맞으면 meta description으로 물러난다", () => {
  const page = `<html><head><meta name="description" content="정부가 부동산 대책을 발표했다. 이번 대책은 공급 확대에 초점을 맞췄다."></head>
<body><div class="unknown-layout">본문</div></body></html>`;

  const body = extractArticleBody(HANKYUNG_URL, page);
  assert.match(body, /공급 확대에 초점/);
});

test("본문이라 할 수 없을 만큼 짧으면 없는 것으로 친다", () => {
  const page = `<html><head><meta name="description" content="속보"></head><body></body></html>`;
  assert.equal(extractArticleBody(HANKYUNG_URL, page), null);
});

test("robots.txt가 막아둔 경로와 대상 외 매체는 아예 받지 않는다", () => {
  assert.ok(isScrapable(YNA_URL));
  assert.ok(isScrapable(HANKYUNG_URL));

  assert.equal(isScrapable("https://www.yna.co.kr/view/AEN20260815000100320"), false);
  assert.equal(isScrapable("https://www.hankyung.com/article/download/123"), false);

  assert.equal(isScrapable("https://www.mk.co.kr/news/realestate/12128759"), false);
  assert.equal(isScrapable("https://biz.chosun.com/real_estate/2026/08/15/ABC/"), false);

  assert.equal(isScrapable("http://www.yna.co.kr/view/AKR1"), false, "평문 HTTP까지 받을 이유가 없다");
  assert.equal(isScrapable("not a url"), false);
});

test("숫자 엔티티와 이름 엔티티를 모두 되돌린다", () => {
  assert.equal(decodeEntities("&#039;전세&#039; &amp; &#x27;월세&#x27;"), "'전세' & '월세'");
  assert.equal(stripTags("<p>가계대출&hellip;</p><p>35조원</p>"), "가계대출… 35조원");
});
