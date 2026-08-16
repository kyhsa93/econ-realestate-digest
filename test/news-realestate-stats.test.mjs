// 부동산 뉴스 페이지 맨 위의 서울 시세 카드.
//
// 이 카드는 기사를 하나도 누르지 않아도 남는 수치라서, 값이 틀리거나 엉뚱한 페이지에
// 뜨면 페이지의 신뢰가 통째로 흔들린다. 특히 두 가지를 본다 - 증시·금리 페이지에는
// 뜨지 않는가, 그리고 프리렌더가 심은 카드를 클라이언트가 같은 모양으로 다시 그리는가.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { attachContext, buildRealestateStats } from "../scripts/news-context.mjs";
import { newsRealestateStatsHtml } from "../scripts/prerender.mjs";
import { loadNewsPage } from "./helpers/news-page.mjs";

const root = path.resolve(import.meta.dirname, "..");

const REALESTATE = {
  period: "202608",
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
  districts: [],
};

const newsWith = (realestate) =>
  attachContext(
    {
      updatedAt: new Date().toISOString(),
      items: [
        {
          title: "송파 9억대 아파트",
          titleEn: "Songpa apartment",
          link: "https://example.com/a",
          source: "가상경제",
          category: "realestate",
          publishedAt: new Date().toISOString(),
        },
      ],
    },
    { realestate }
  );

test("서울 매매·전세·월세 세 장이 각자 제 페이지로 간다", () => {
  const stats = buildRealestateStats(REALESTATE);
  assert.deepEqual(
    stats.map((s) => [s.label, s.value, s.href]),
    [
      ["서울 아파트 84㎡ 매매", "11억 3,049만원", "./apartment-sale.html"],
      ["서울 아파트 84㎡ 전세", "6억 5,329만원", "./apartment-jeonse.html"],
      ["서울 아파트 월세", "보증금 22,166만원 / 월 96만원", "./apartment-rent.html"],
    ]
  );
  assert.equal(stats[0].note, "8월 신고 575건 · 8/10 대비 +8.3%");
});

// 월초에는 신고가 덜 쌓여 한두 지표만 남는데, 그걸 "오늘의 시세"라고 부르기는 어렵다.
test("세 지표가 다 서지 않으면 지표 줄 자체를 만들지 않는다", () => {
  const thin = {
    period: "202608",
    overall: { sale: { avgPricePerPyeong10k: 4449, transactionCount: 3 }, jeonse: null, wolse: null },
  };
  assert.equal(buildRealestateStats(thin), null);
  assert.ok(!("realestateStats" in newsWith(thin)));
});

test("부동산 페이지에서 프리렌더와 화면 렌더가 같은 카드를 그린다", async () => {
  const news = newsWith(REALESTATE);
  const page = await loadNewsPage({ news, summary: { categories: [] }, category: "realestate" });

  assert.equal(page.byId("realestate-stats-section").hidden, false);
  assert.equal(page.byId("realestate-stats").innerHTML, newsRealestateStatsHtml(news));
});

// 증시 기사 위에 아파트 시세가 놓일 이유는 없다. 전체 뉴스 페이지도 마찬가지다.
test("부동산이 아닌 페이지에서는 지표 줄이 숨어 있다", async () => {
  const news = newsWith(REALESTATE);

  for (const category of [null, "stocks", "rates"]) {
    const page = await loadNewsPage({ news, summary: { categories: [] }, category });
    assert.equal(page.byId("realestate-stats-section").hidden, true, `${category ?? "전체"} 페이지에 지표가 떴다`);
  }
});

test("영어 화면은 카드도 영어로 그린다", async () => {
  const news = newsWith(REALESTATE);
  const page = await loadNewsPage({
    news,
    summary: { categories: [] },
    category: "realestate",
    locale: "en",
  });

  const html = page.byId("realestate-stats").innerHTML;
  assert.ok(html.includes("Seoul apartment 84㎡ sale"), "영어 라벨이 안 보인다");
  assert.ok(html.includes("575 deals in Aug"), "영어 보조 설명이 안 보인다");
  assert.ok(!html.includes("11억 3,049만원"), "영어 화면에 한국어 표기가 남아 있다");
});

// 정적 HTML은 검색 결과에 그대로 실린다. 커밋된 페이지에서 이 줄이 빠지거나 반대로
// 다른 페이지에 새어 들어가면 데이터를 받기 전 화면이 어긋난다.
test("커밋된 페이지에서 부동산 페이지만 지표 줄을 펴고 있다", async () => {
  const open = async (file) => readFile(path.join(root, "docs", file), "utf8");

  const realestate = await open("realestate-news.html");
  assert.match(realestate, /<section id="realestate-stats-section">/);
  assert.match(realestate, /<a class="stat-card" href="\.\/apartment-sale\.html">/);

  for (const file of ["news.html", "stock-news.html", "rate-news.html"]) {
    assert.match(await open(file), /<section id="realestate-stats-section" hidden>/, `${file}에 지표가 펴져 있다`);
  }
});
