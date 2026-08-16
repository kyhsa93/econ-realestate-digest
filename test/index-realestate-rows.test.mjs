// 정적 HTML은 상위 10개 구만 심는데 화면이 25개를 다 그리면, 데이터를 받는 순간
// 표가 열한 행에서 스물여섯 행으로 늘어나면서 아래 섹션이 통째로 밀린다. 광고가
// 붙은 페이지라 이 밀림은 수익에도 영향을 준다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) =>
  readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);

async function page() {
  const names = [
    "summary", "market", "realestate", "news",
    "realestate-history-lite", "market-history", "summary-history", "news-history",
  ];
  const data = {};
  for (const name of names) data[name] = await readJson(name);
  return loadIndexPage({
    fetch: async (url) => {
      const name = String(url).match(/\/([a-z-]+)\.json/)?.[1];
      return data[name] ? { ok: true, json: async () => data[name] } : { ok: false, json: async () => ({}) };
    },
  });
}

const districtRows = (p) => p.app.document.querySelectorAll("#realestate-grid tr[data-district-name]");
const visible = (p) => districtRows(p).filter((r) => !r.hidden);

test("처음에는 상위 10개 구만 보인다", async () => {
  const p = await page();
  assert.equal(districtRows(p).length, 25, "25개 구가 DOM에 다 있어야 검색이 된다");
  assert.equal(visible(p).length, 10);
});

test("정적 HTML과 보이는 행 수가 같다", async () => {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  const prerendered = html.split("<!--prerender:realestate-->")[1].split("<!--/prerender")[0];
  const p = await page();
  // 정적 표에는 '서울 전체' 행이 하나 더 있다
  assert.equal((prerendered.match(/<tr/g) ?? []).length, visible(p).length + 1);
});

// 안 그리면 "강북구"를 검색해도 안 나온다. 감춰만 두고 검색할 때 다시 보인다.
test("감춘 구도 검색하면 나온다", async () => {
  const p = await page();
  const hiddenNames = districtRows(p)
    .filter((r) => r.hidden)
    .map((r) => r.getAttribute("data-district-name"));
  assert.ok(hiddenNames.length > 0, "감춰진 구가 없다");

  const target = hiddenNames[0];
  const input = p.byId("realestate-search-input");
  input.value = target;
  input.dispatch("input");

  const shown = visible(p).map((r) => r.getAttribute("data-district-name"));
  assert.ok(shown.includes(target), `${target}를 검색했는데 안 나온다: ${shown.join(", ")}`);
});

test("검색어를 지우면 다시 10개로 돌아간다", async () => {
  const p = await page();
  const input = p.byId("realestate-search-input");
  input.value = "구";
  input.dispatch("input");
  assert.ok(visible(p).length > 10, "검색 중에는 전체가 대상이어야 한다");

  input.value = "";
  input.dispatch("input");
  assert.equal(visible(p).length, 10);
});

// 그냥 잘라두면 서울에 열 개 구만 있는 것처럼 보인다.
test("감춘 구가 있으면 전체 보기로 안내한다", async () => {
  const p = await page();
  const link = p.byId("realestate-more");
  assert.equal(link.hidden, false);
  assert.match(link.textContent, /25개/);

  const input = p.byId("realestate-search-input");
  input.value = "강남";
  input.dispatch("input");
  assert.equal(link.hidden, true, "검색 중에는 안내를 띄우지 않는다");
});
