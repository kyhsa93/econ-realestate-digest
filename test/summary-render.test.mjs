import test from "node:test";
import assert from "node:assert/strict";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { summaryHtml } from "../scripts/prerender.mjs";

const SUMMARY = {
  updatedAt: new Date().toISOString(),
  model: "stub",
  summary: { ko: "- 국토부: 요약", en: "- Ministry: summary" },
  highlights: [
    {
      title: "국토부, 신규 택지 후보지 발표",
      link: "https://example.com/a",
      source: "가상경제",
      category: "realestate",
      textKo: "국토교통부는 14일 신규 공공택지 후보지를 발표했다. 이번 후보지에는 3만 가구가 들어선다.",
      textEn: "The ministry announced new public housing sites on the 14th.",
    },
  ],
  categories: [
    {
      key: "realestate",
      name: "부동산",
      nameEn: "Real Estate",
      lineKo: "정부가 택지 공급 계획을 내놨다. 서울시는 다른 견해를 냈다. 협의는 연내 이어진다.",
      lineEn: "The government announced a land supply plan.",
      isFallback: false,
      fallbackReason: null,
      degraded: false,
      items: [{ title: "국토부, 신규 택지 후보지 발표", link: "https://example.com/a", source: "가상경제" }],
    },
  ],
};

async function renderWith(summary, storage) {
  const page = await loadIndexPage({
    storage,
    fetch: async (url) => {
      const name = String(url).split("/data/")[1].split(".json")[0];
      if (name === "summary") return { ok: true, json: async () => summary };
      return { ok: false, json: async () => ({}) };
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  return String(page.byId("summary-box").innerHTML);
}

test("핵심 기사 섹션이 분야별 요약 위에 그려진다", async () => {
  const html = await renderWith(SUMMARY);

  assert.ok(html.includes("오늘의 핵심"), "핵심 섹션 제목이 없다");
  assert.ok(html.includes("신규 공공택지 후보지를 발표했다"), "핵심 요약 본문이 없다");
  assert.ok(html.includes("https://example.com/a"), "원문 링크가 없다");
  assert.ok(
    html.indexOf("오늘의 핵심") < html.indexOf("분야별 요약"),
    "핵심이 분야별 요약보다 아래에 있다"
  );
});

test("영어 화면은 영어 요약을 쓴다", async () => {
  const html = await renderWith(SUMMARY, { lang: "en" });

  assert.ok(html.includes("Today's Top Stories"));
  assert.ok(html.includes("The ministry announced new public housing sites"));
  assert.ok(!html.includes("국토교통부는 14일"), "영어 화면에 한국어 요약이 남았다");
});

test("핵심 기사가 없는 날은 섹션째 빠지고 분야별 요약만 남는다", async () => {
  const html = await renderWith({ ...SUMMARY, highlights: [] });

  assert.ok(!html.includes("오늘의 핵심"), "빈 섹션이 남았다");
  assert.ok(html.includes("정부가 택지 공급 계획을 내놨다"));
});

test("모델이 쓴 문장에 태그가 섞여도 HTML로 실행되지 않는다", async () => {
  const html = await renderWith({
    ...SUMMARY,
    highlights: [{ ...SUMMARY.highlights[0], textKo: "<img src=x onerror=alert(1)> 발표했다." }],
    categories: [{ ...SUMMARY.categories[0], lineKo: "<script>alert(1)</script> 발표했다." }],
  });

  assert.ok(!html.includes("<img src=x"), "태그가 그대로 들어갔다");
  assert.ok(!html.includes("<script>alert"), "스크립트가 그대로 들어갔다");
  assert.ok(html.includes("&lt;img src=x"), "이스케이프된 흔적이 없다");
});

test("프리렌더 HTML에도 핵심 기사가 들어간다", () => {
  const html = summaryHtml(SUMMARY);

  assert.ok(html.includes("신규 공공택지 후보지를 발표했다"));
  assert.ok(html.includes("정부가 택지 공급 계획을 내놨다"));
  assert.ok(html.indexOf("신규 공공택지") < html.indexOf("정부가 택지 공급"), "핵심이 뒤에 있다");
});
