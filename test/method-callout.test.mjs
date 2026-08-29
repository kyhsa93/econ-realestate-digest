import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const indexHtml = () => readFile(path.join(root, "docs/index.html"), "utf8");

// 이 사이트가 대형 부동산 앱과 다른 점은 사실상 집계 기준을 밝힌다는 것 하나다.
// 그게 푸터 링크 한 줄로만 있으면 아무도 안 본다.
test("첫 화면에서 집계 기준으로 가는 길이 데이터보다 앞에 있다", async () => {
  const html = await indexHtml();
  const callout = html.indexOf('class="method-callout"');
  const firstData = html.indexOf('<section id="market-section">');

  assert.notEqual(callout, -1, "집계 기준 안내가 첫 화면에 없다");
  assert.ok(callout < firstData, "집계 기준 안내가 첫 데이터 섹션보다 뒤에 있다");
  assert.match(html.slice(callout, firstData), /href="\.\/method\.html"/, "method.html로 가지 않는다");
});

test("푸터 링크는 그대로 둔다", async () => {
  // 나머지 예순한 장은 여전히 푸터로만 닿는다.
  assert.match(await indexHtml(), /id="footer-method"/, "푸터 링크까지 걷어냈다");
});

test("안내가 데이터 앞을 막지 않는다", async () => {
  const html = await indexHtml();
  const text = /<p id="method-callout-text">([^<]*)<\/p>/.exec(html)?.[1] ?? "";

  assert.ok(text.length > 0, "안내 문구가 비었다");
  // 3단계에서 시세표를 열한 행에서 다섯 행으로 접어 요약까지의 길을 줄여 놨다.
  // 이 안내가 길어지면 그때 번 자리를 도로 까먹는다. 지금 91자, 모바일 세 줄.
  assert.ok(text.length <= 120, `안내가 ${text.length}자다 - 첫 화면을 도로 잡아먹는다`);
});

const load = (storage) =>
  loadIndexPage({
    storage,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  });

test("한국어 화면은 한국어로, 영어 화면은 영어로 말한다", async () => {
  const ko = await load();
  assert.match(ko.byId("method-callout-text").textContent, /신고된 실거래/);
  assert.match(ko.byId("method-callout-link").textContent, /숫자를 만드는 방법/);

  const en = await load({ lang: "en" });
  assert.match(en.byId("method-callout-text").textContent, /reported to the Ministry of Land/);
  assert.match(en.byId("method-callout-link").textContent, /How these numbers are made/);
  assert.ok(
    !/신고된 실거래/.test(en.byId("method-callout-text").textContent),
    "영어 화면에 한국어가 남았다"
  );
});
