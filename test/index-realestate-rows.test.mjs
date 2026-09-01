import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) =>
  readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);

let loaded = null;

async function page() {
  const names = [
    "summary", "market", "realestate", "news",
    "realestate-trend", "market-history", "summary-history", "news-history",
  ];
  const data = {};
  for (const name of names) data[name] = await readJson(name);
  loaded = data.realestate;
  return loadIndexPage({
    fetch: async (url) => {
      const name = String(url).match(/\/([a-z-]+)\.json/)?.[1];
      return data[name] ? { ok: true, json: async () => data[name] } : { ok: false, json: async () => ({}) };
    },
  });
}

// scripts/prerender.mjs의 MAX_DISTRICTS, index.html의 MAX_VISIBLE_DISTRICTS와 같은 수.
const VISIBLE = 4;
const districtCount = () => loaded.districts.length;
const shownCount = () => Math.min(districtCount(), VISIBLE);

const districtRows = (p) => p.app.document.querySelectorAll("#realestate-grid tr[data-district-name]");
const visible = (p) => districtRows(p).filter((r) => !r.hidden);

test("처음에는 상위 네 개 구만 보인다", async () => {
  const p = await page();
  assert.equal(districtRows(p).length, districtCount(), "받은 구가 DOM에 다 있어야 검색이 된다");
  assert.equal(visible(p).length, shownCount());
});

test("정적 HTML과 보이는 행 수가 같다", async () => {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  const prerendered = html.split("<!--prerender:realestate-->")[1].split("<!--/prerender")[0];
  const p = await page();
  assert.equal((prerendered.match(/<tr/g) ?? []).length, visible(p).length + 1);
});

test("감춘 구도 검색하면 나온다", async () => {
  const p = await page();
  const hiddenNames = districtRows(p)
    .filter((r) => r.hidden)
    .map((r) => r.getAttribute("data-district-name"));
  assert.equal(hiddenNames.length, districtCount() - shownCount(), "감춘 구 수가 안 맞는다");
  assert.ok(hiddenNames.length > 0, "감춰진 구가 없어 검색으로 되살아나는지 볼 수 없다");

  const target = hiddenNames[0];
  const input = p.byId("realestate-search-input");
  input.value = target;
  input.dispatch("input");

  const shown = visible(p).map((r) => r.getAttribute("data-district-name"));
  assert.ok(shown.includes(target), `${target}를 검색했는데 안 나온다: ${shown.join(", ")}`);
});

test("검색어를 지우면 다시 접힌다", async () => {
  const p = await page();
  const input = p.byId("realestate-search-input");
  input.value = "구";
  input.dispatch("input");
  assert.equal(visible(p).length, districtCount(), "검색 중에는 전체가 대상이어야 한다");

  input.value = "";
  input.dispatch("input");
  assert.equal(visible(p).length, shownCount());
});

const showMore = (p) => p.byId("realestate-show-more");
const clickShowMore = (p) => showMore(p).dispatch("click", { target: { id: "realestate-show-more-button" } });

test("더 보기를 누르면 나머지 구가 펼쳐진다", async () => {
  const p = await page();
  assert.equal(showMore(p).hidden, false, "접어 놓고 펼 방법을 주지 않았다");
  assert.match(showMore(p).innerHTML, /realestate-show-more-button/, "펼치기 버튼이 없다");
  assert.match(
    showMore(p).innerHTML,
    new RegExp(`${districtCount() - shownCount()}`),
    "몇 개가 남았는지 말하지 않는다"
  );

  clickShowMore(p);
  assert.equal(visible(p).length, districtCount(), "펼쳤는데 전부 보이지 않는다");

  clickShowMore(p);
  assert.equal(visible(p).length, shownCount(), "접기가 되지 않는다");
});

test("검색 중에는 접었다는 말을 하지 않는다", async () => {
  const p = await page();
  const input = p.byId("realestate-search-input");
  input.value = "강남";
  input.dispatch("input");
  assert.equal(showMore(p).hidden, true, "검색 결과 밑에 '몇 개 더 보기'가 남았다");

  input.value = "";
  input.dispatch("input");
  assert.equal(showMore(p).hidden, false);
});

test("몇 개가 남았는지 소리로도 알린다", async () => {
  const p = await page();
  assert.match(p.byId("realestate-status").textContent, new RegExp(`${shownCount()}`), "접힌 뒤 건수를 안 알린다");

  const input = p.byId("realestate-search-input");
  input.value = "강남";
  input.dispatch("input");
  assert.match(p.byId("realestate-status").textContent, /1/, "검색 결과 건수를 안 알린다");

  assert.ok(p.byId("news-status").textContent.length > 0, "뉴스 건수를 안 알린다");
});

test("감춘 구가 있으면 전체 보기로 안내한다", async () => {
  const p = await page();
  const link = p.byId("realestate-more");
  assert.equal(link.hidden, false);
  assert.match(link.textContent, new RegExp(`${districtCount()}개`));

  const input = p.byId("realestate-search-input");
  input.value = "강남";
  input.dispatch("input");
  assert.equal(link.hidden, true, "검색 중에는 안내를 띄우지 않는다");
});

test("메인 화면 추이 카드에도 양 축 눈금과 짚을 자리를 둔다", async () => {
  const p = await page();
  const grid = p.byId("realestate-history-grid").innerHTML;

  assert.ok(grid.includes("polyline"), "추이 카드가 그려지지 않았다");
  assert.match(grid, /class="axis y"/, "세로 눈금이 없다");
  assert.match(grid, /class="axis x[^"]*"/, "가로 눈금이 없다");
  assert.match(grid, /class="marker" hidden/, "짚어줄 표시가 없다");
  assert.match(grid, /class="history-chart" id="chart-\d+"/, "차트마다 식별자가 없다");
  assert.ok(!grid.includes('preserveAspectRatio="none"'), "가로로 늘어나 글자가 찌그러진다");
});

test("메인 화면도 덜 찬 주를 점선으로 잇는다", async () => {
  const p = await page();
  const grid = p.byId("realestate-history-grid").innerHTML;
  const trend = await readJson("realestate-trend");

  if (!(trend.pendingWeeks ?? []).length) {
    assert.ok(!grid.includes('spark pending'), "잠정 주가 없는데 점선을 그었다");
    return;
  }

  assert.match(grid, /class="[^"]*\bpending\b[^"]*"[^>]*stroke-dasharray/, "잠정 구간이 점선이 아니다");
  assert.match(
    p.byId("realestate-history-note").textContent,
    /점선/,
    "점선이 무엇인지 밝히지 않았다"
  );
});

test("시장 지표에는 잠정 구간이 없다", async () => {
  const p = await page();
  const grid = p.byId("history-grid").innerHTML;

  assert.ok(!grid.includes('spark pending'), "신고 기한과 무관한 지표에 점선을 그었다");
});

test("시장 지표 추이도 같은 모양으로 그린다", async () => {
  const p = await page();
  const grid = p.byId("history-grid").innerHTML;

  assert.ok(grid.includes("polyline"), "시장 지표 추이가 그려지지 않았다");
  assert.match(grid, /class="axis y"/);
  assert.match(grid, /class="axis x[^"]*"/);
});
