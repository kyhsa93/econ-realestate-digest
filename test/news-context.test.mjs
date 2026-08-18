import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { attachContext, bestRate, buildContext, findDistrict } from "../scripts/news-context.mjs";
import { DISTRICT_PAGES, DISTRICT_SLUGS } from "../scripts/district-slugs.mjs";
import { newsContextHtml, newsListHtml, ratesHtml, realestateTableHtml } from "../scripts/prerender.mjs";
import { loadNewsPage } from "./helpers/news-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) =>
  readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);

const district = (name, extra = {}) => ({
  code: "11000",
  name,
  sale: { avgPricePerPyeong10k: 6912, transactionCount: 16 },
  jeonse: { avgDepositPerPyeong10k: 3375, transactionCount: 168 },
  wolse: { avgDeposit10k: 39481, avgMonthlyRent10k: 132, transactionCount: 110 },
  ...extra,
});

const REALESTATE = {
  window: { from: "2026-06-15", to: "2026-07-12", weeks: 4 },
  overall: {
    sale: {
      avgPricePerPyeong10k: 4449,
      transactionCount: 575,
      change: { value10k: 340, percent: 8.27451934777318 },
      baselineDate: "2026-08-10",
    },
    jeonse: { avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
    wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
  },
  districts: [district("중구"), district("송파구"), district("노원구")],
};

const RATES = {
  deposit: [{ options: [{ term: 12, rate: 2.9, maxRate: 3.4 }, { term: 6, rate: 2.5, maxRate: 9.9 }] }],
  saving: [{ options: [{ term: 12, rate: 3.0, maxRate: 4.1 }] }],
  mortgage: [{ options: [{ min: 3.64, max: 5.2, avg: 4.1 }] }],
  rentLoan: [{ options: [{ min: 3.28, max: 4.4, avg: 3.9 }] }],
};

const DATA = { realestate: REALESTATE, rates: RATES };
const context = (title, preview = null) => buildContext({ title, preview }, DATA);

test("자치구를 짚은 부동산 기사에 그 구의 평당가가 붙는다", () => {
  const [first] = context("송파 9억대 아파트, 하나 남았습니다");
  assert.equal(first.kind, "realestate");
  assert.equal(first.label, "송파구 아파트 84㎡ 매매");
  assert.equal(first.value, "17억 5,633만원");
  assert.equal(first.href, "./district-songpa.html");
});

test("자치구 칩은 그 구 페이지로, 서울 전체 칩은 거래 유형별 페이지로 간다", () => {
  assert.equal(context("노원구 아파트 신고가")[0].href, "./district-nowon.html");
  assert.equal(context("송파 전세 매물 급감")[0].href, "./district-songpa.html");

  assert.equal(context("서울 빌라값 들썩")[0].href, "./apartment-sale.html");
  assert.equal(context("서울 전세 계약 전 확인하세요")[0].href, "./apartment-jeonse.html");
  assert.equal(context('"서울 월세 1000만원 흔해질 것"')[0].href, "./apartment-rent.html");
});

test("칩이 가리키는 페이지가 모두 존재한다", async () => {
  const targets = new Set(
    [...DISTRICT_PAGES.map((d) => `./${d.file}`), "./apartment-sale.html", "./apartment-jeonse.html", "./apartment-rent.html"]
  );
  for (const href of targets) {
    await access(path.join(root, "docs", href.slice(2)));
  }

  const districts = REALESTATE.districts.map((d) => d.name);
  assert.deepEqual(
    districts.filter((name) => !targets.has(`./district-${DISTRICT_SLUGS[name]}.html`)),
    [],
    "자치구 페이지가 없는 지역에 칩이 붙는다"
  );
});

test("자치구 이름만 있고 부동산 얘기가 아니면 시세를 붙이지 않는다", () => {
  assert.deepEqual(context("송파 지역 축제 이번 주말 개최"), []);
});

test("한 글자로 줄어드는 자치구 이름은 짧은 형태로 찾지 않는다", () => {
  assert.equal(findDistrict("아파트 값이 중간에서 멈췄다", REALESTATE.districts), null);
  assert.equal(findDistrict("중구 아파트 거래량", REALESTATE.districts)?.name, "중구");
});

test("기사가 전세·월세를 다루면 그 지표를 붙인다", () => {
  assert.equal(context("송파 전세 매물 급감")[0].label, "송파구 아파트 84㎡ 전세");

  const [wolse] = context('"서울 월세 1000만원 흔해질 것"…종부세 개편에 세입자 불똥');
  assert.equal(wolse.label, "서울 전체 아파트 월세");
  assert.equal(wolse.value, "보증금 22,166만원 / 월 96만원");
});

test("칩에 신고 건수를 같이 적는다", () => {
  assert.equal(context("송파 9억대 아파트")[0].note, "최근 4주 계약 16건");
  assert.equal(context("송파 9억대 아파트")[0].noteEn, "16 deals in the last 4 weeks");
});

test("변화율은 표본이 넉넉할 때만 적는다", () => {
  assert.equal(context("서울 빌라값 들썩")[0].note, "최근 4주 계약 575건 · 8/10 대비 +8.3%");
  assert.equal(context("서울 빌라값 들썩")[0].noteEn, "575 deals in the last 4 weeks · +8.3% vs Aug 10");

  assert.ok(!context("송파 9억대 아파트")[0].note.includes("대비"));
});

test("신고 건수가 적은 지표는 붙이지 않는다", () => {
  const thin = {
    overall: REALESTATE.overall,
    districts: [district("노원구", { sale: { avgPricePerPyeong10k: 9999, transactionCount: 2 }, jeonse: null, wolse: null })],
  };
  assert.deepEqual(buildContext({ title: "노원구 아파트 신고가" }, { realestate: thin }), []);
});

test("자치구가 없으면 서울 기사에 서울 전체 평균을 붙인다", () => {
  assert.equal(context("서울 빌라값 들썩")[0].label, "서울 전체 아파트 84㎡ 매매");
  assert.deepEqual(context("수도권 아파트를 1억대로 입주?"), []);
});

test("이주비 대출은 전세자금대출이 아니라 담보대출 쪽으로 간다", () => {
  const [first] = context("이주비 대출 완화…중소·중견사 정비사업 기회 열리나");
  assert.equal(first.label, "주택담보대출 최저금리");
  assert.equal(first.href, "./mortgage-rates.html");
});

test("전세대출 기사는 전세자금대출 금리로 간다", () => {
  const [first] = context('"비거주 1주택자 전세대출 막힌다"더니…반전 있었다');
  assert.equal(first.label, "전세자금대출 최저금리");
  assert.equal(first.value, "연 3.28%");
});

test("한 기사에 두 개까지만 붙인다", () => {
  const many = context("서울 아파트 전세 매매 가계부채 대출 총출동");
  assert.equal(many.length, 2);
  assert.deepEqual(many.map((c) => c.kind), ["realestate", "rates"]);
});

test("금리 값이 금리 페이지 첫 줄과 같은 기준으로 뽑힌다", async () => {
  const rates = await readJson("rates");

  for (const [key, cell] of [
    ["deposit", /class="rate-strong"[^>]*>([\d.]+)%/],
    ["mortgage", /data-label="금리\(최저~최고\)">([\d.]+)~/],
  ]) {
    const top = ratesHtml(rates, { category: key, limit: 1 }).match(cell)?.[1];
    const best = bestRate(rates, key);
    assert.ok(typeof best === "number", `${key} 상품이 한 건도 없다`);
    assert.equal(best.toFixed(2), top, `${key} 금리가 금리 페이지 첫 줄과 다릅니다`);
  }
});

test("84㎡ 환산가가 시세 페이지 표에 적힌 값과 같다", async () => {
  const realestate = await readJson("realestate");
  const [chip] = buildContext({ title: "서울 아파트 매매 시세 오름세" }, { realestate });

  assert.ok(chip, "서울 전체 매매 표본이 모자라 칩이 안 붙었다");
  assert.equal(chip.href, "./apartment-sale.html");
  assert.ok(
    realestateTableHtml(realestate, "sale").includes(chip.value),
    `칩 값(${chip.value})이 매매 시세 표에 없습니다`
  );
});

test("발신지 표기의 '서울'을 기사 내용으로 착각하지 않는다", () => {
  const found = context(
    "[올댓차이나] 홍콩 증시, 기술주에 이익매물로 나흘째 속락 마감",
    "[서울=뉴시스]이재준 기자 = 홍콩 증시는 14일 주력 기술주에 이익확정 매물이 선행하고 실적 부진 종목에 매도가 쏟아지면서 4거래일 연속 하락 마감했다."
  );
  assert.deepEqual(found, [], `홍콩 증시 기사에 국내 수치가 붙었다: ${JSON.stringify(found)}`);
});

test("증시 기사의 '매물'은 부동산 신호가 아니다", () => {
  assert.deepEqual(context("서울 투자자들, 차익 실현 매물 쏟아내"), []);
});

test("기사에 이미 있는 숫자(지수·환율)는 붙이지 않는다", () => {
  assert.deepEqual(context("[외환] 원/달러 환율 2.3원 오른 1,418.4원(15:30 기준가)"), []);
  assert.deepEqual(context("코스피, 지난주 5일 연속 상승…외국인 순매수로 지수 견인"), []);
  assert.deepEqual(context("금통위 기준금리 동결"), []);
});

test("붙여 쓴 '대출규제'도 대출 기사로 본다", () => {
  assert.equal(
    context("청년은 입주 못하는 '반값아파트'…바뀐 대출규제에 계약포기 속출")[0].label,
    "주택담보대출 최저금리"
  );
});

test("붙일 게 없는 기사에는 context 필드를 만들지 않는다", () => {
  const news = { items: [{ title: "송파구 아파트 신고가" }, { title: "국무회의 열려" }] };
  const [withContext, without] = attachContext(news, DATA).items;
  assert.equal(withContext.context.length, 1);
  assert.ok(!("context" in without));
});

test("두 번 붙여도 결과가 같다", () => {
  const news = { items: [{ title: "송파구 아파트 신고가" }] };
  assert.deepEqual(attachContext(attachContext(news, DATA), DATA), attachContext(news, DATA));
});

test("프리렌더가 심은 칩을 클라이언트가 그대로 다시 그린다", async () => {
  const news = {
    updatedAt: new Date().toISOString(),
    items: [
      {
        title: "송파 9억대 아파트",
        link: "https://example.com/a",
        source: "가상경제",
        category: "realestate",
        publishedAt: new Date().toISOString(),
        context: buildContext({ title: "송파 9억대 아파트" }, DATA),
      },
    ],
  };

  const page = await loadNewsPage({ news, summary: { categories: [] } });
  const rendered = page.newsListHtml();
  const prerendered = newsListHtml(news);

  assert.ok(prerendered.includes(newsContextHtml(news.items[0].context)), "프리렌더에 칩이 없다");
  assert.ok(rendered.includes(newsContextHtml(news.items[0].context)), "화면 렌더에 칩이 없다");
});

test("영어 화면은 칩도 영어로 그린다", async () => {
  const news = {
    updatedAt: new Date().toISOString(),
    items: [
      {
        title: "송파 9억대 아파트",
        titleEn: "Songpa apartment",
        link: "https://example.com/a",
        source: "가상경제",
        category: "realestate",
        publishedAt: new Date().toISOString(),
        context: buildContext({ title: "송파 9억대 아파트" }, DATA),
      },
    ],
  };

  const page = await loadNewsPage({ news, summary: { categories: [] }, locale: "en" });
  const rendered = page.newsListHtml();
  assert.ok(rendered.includes("송파구 apartment 84㎡ sale"), "영어 라벨이 안 보인다");
  assert.ok(rendered.includes("₩1,756M"), "영어 표기 금액이 안 보인다");
  assert.ok(rendered.includes("16 deals in the last 4 weeks"), "영어 보조 설명이 안 보인다");
  assert.ok(!rendered.includes("17억 5,633만원"), "영어 화면에 한국어 표기가 남아 있다");
  assert.ok(!rendered.includes("신고 16건"), "영어 화면에 한국어 보조 설명이 남아 있다");
});
