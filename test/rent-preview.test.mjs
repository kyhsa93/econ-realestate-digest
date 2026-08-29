import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PREVIEW_ROWS, buildPayload } from "../scripts/build-rent-preview.mjs";
import { loadDealSearchPage } from "./helpers/deal-search-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);
const NOW = new Date("2026-08-29T00:00:00Z");

const deal = (extra = {}) => ({ dong: "상계동", apt: "가상", area: 59, floor: 3, deposit10k: 40000, date: "2026-08-01", ...extra });

test("전세와 월세를 갈라 담고 갱신은 뺀다", () => {
  const payload = buildPayload({
    now: NOW,
    byDistrict: {
      노원구: {
        periods: ["202608"],
        deals: [
          deal(),
          deal({ monthlyRent10k: 80 }),
          // 시세와 같은 규칙 - 갱신은 이전 조건을 잇는 것이라 지금 값이 아니다.
          deal({ renewal: true }),
        ],
      },
    },
  });
  assert.equal(payload.jeonse.total, 1);
  assert.equal(payload.wolse.total, 1);
  assert.equal(payload.jeonse.deals[0].district, "노원구", "어느 구 거래인지 안 담겼다");
});

test("담는 순서가 매일 같다", () => {
  // 같은 날짜가 여럿이면 읽어 온 순서대로 담히고, 그러면 값이 그대로여도 매일 diff가 난다.
  const rows = (order) => ({
    노원구: { deals: order.map((apt) => deal({ apt, date: "2026-08-01" })) },
  });
  const a = buildPayload({ now: NOW, byDistrict: rows(["다", "가", "나"]) });
  const b = buildPayload({ now: NOW, byDistrict: rows(["나", "다", "가"]) });
  assert.deepEqual(
    a.jeonse.deals.map((d) => d.apt),
    b.jeonse.deals.map((d) => d.apt)
  );
});

test("최근 것부터 정해진 수만 담는다", () => {
  const deals = Array.from({ length: PREVIEW_ROWS + 20 }, (_, i) =>
    deal({ apt: `가상${i}`, date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}` })
  );
  const payload = buildPayload({ now: NOW, byDistrict: { 노원구: { deals } } });
  assert.equal(payload.jeonse.deals.length, PREVIEW_ROWS);
  assert.equal(payload.jeonse.total, deals.length, "건수는 담은 수가 아니라 전체여야 한다");
  const dates = payload.jeonse.deals.map((d) => d.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), "최근 것부터가 아니다");
});

test("전월세 신고가 없으면 만들지 않는다", () => {
  assert.equal(buildPayload({ now: NOW, byDistrict: { 노원구: { deals: [] } } }), null);
});

// --- 화면 ------------------------------------------------------------------

const load = async (extra) => {
  const page = await loadDealSearchPage({
    budget: await readJson("budget-deals"),
    search: await readJson("deal-search"),
    ...extra,
  });
  for (let i = 0; i < 300 && !page.resultHtml(); i += 1) await new Promise((r) => setTimeout(r, 5));
  return page;
};
const settle = async () => {
  for (let i = 0; i < 200; i += 1) await new Promise((r) => setTimeout(r, 5));
};

test("전세로 바꿔도 빈 화면이 아니다", async () => {
  const page = await load({ rentPreview: await readJson("rent-preview") });
  page.chooseKind("jeonse");
  await settle();
  const html = page.resultHtml();
  assert.match(html, /서울 전체 전세에서/, "서울 전체 건수를 안 보여준다");
  assert.match(html, /budget-deal/, "거래 목록이 없다");
});

test("조건을 걸면 맛보기로 세지 않는다", async () => {
  // 최근 서른 건 위에서 "60㎡ 미만"을 세면 서울에서 그 조건에 맞는 거래 수가
  // 아니라 이 목록 안의 수가 나온다. 화면에서는 구별되지 않는다.
  const page = await load({ rentPreview: await readJson("rent-preview") });
  page.chooseKind("jeonse");
  page.chooseArea("under60");
  await settle();
  const html = page.resultHtml();
  assert.ok(!/budget-deal/.test(html), "맛보기 목록 위에서 조건을 걸어 세었다");
  assert.match(html, /지역을 하나 골라야/);
});

test("맛보기 파일이 없으면 전과 똑같이 돈다", async () => {
  const page = await load({});
  page.chooseKind("jeonse");
  await settle();
  assert.match(page.resultHtml(), /지역을 하나 골라야/);
});

test("월세 값에 단위를 두 번 붙이지 않는다", async () => {
  const page = await load({ rentPreview: await readJson("rent-preview") });
  page.chooseKind("wolse");
  await settle();
  assert.ok(!/만원만원/.test(page.resultHtml()), "월 23만원만원 - 단위가 겹쳤다");
  assert.match(page.resultHtml(), /월 \d[\d,]*만원/);
});
