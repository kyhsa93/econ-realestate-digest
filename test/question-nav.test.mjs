import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const indexHtml = () => readFile(path.join(root, "docs/index.html"), "utf8");

const links = async () => {
  const html = await indexHtml();
  const block = /<nav class="question-nav"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return [...block.matchAll(/<a id="([^"]+)" href="([^"]+)">([^<]*)<\/a>/g)].map((m) => ({
    id: m[1],
    href: m[2],
    text: m[3],
  }));
};

test("질문 입구가 첫 화면에 있다", async () => {
  const items = await links();
  assert.ok(items.length >= 5, `질문이 ${items.length}개뿐이다`);
  for (const item of items) {
    assert.match(item.text, /[가-힣]/, `${item.id}에 글이 없다`);
  }
});

test("질문은 조건을 넣지 않아도 답이 보이는 화면으로 보낸다", async () => {
  // 빈 화면으로 보내면 질문을 누른 사람이 다시 막힌다. 실거래 검색만 예외인데,
  // 그건 "조건을 걸어 찾기"라고 적혀 있어 무엇을 해야 하는지 알고 들어간다.
  const files = new Set((await readdir(path.join(root, "docs"))).filter((f) => f.endsWith(".html")));
  const items = await links();

  for (const item of items) {
    const file = item.href.replace("./", "");
    assert.ok(files.has(file), `${item.id}가 없는 페이지 ${file}로 보낸다`);
    if (file === "deal-search.html") continue;
    const html = await readFile(path.join(root, "docs", file), "utf8");
    assert.ok(
      /<!--prerender:[a-zA-Z]+-->[\s\S]{40,}?<!--\/prerender/.test(html),
      `${file}이 미리 그려 둔 답 없이 비어 있다`
    );
  }
});

test("데이터 섹션보다 앞에 있다", async () => {
  const html = await indexHtml();
  assert.ok(
    html.indexOf('class="question-nav"') < html.indexOf('<section id="market-section">'),
    "질문 입구가 표 밑에 있다"
  );
});

test("한 줄로 접히고 잘린 쪽에 페이드가 붙는다", async () => {
  const [css, nav] = await Promise.all([
    readFile(path.join(root, "docs/style.css"), "utf8"),
    readFile(path.join(root, "docs/nav.js"), "utf8"),
  ]);
  // 질문 여섯 개를 세로로 쌓으면 3단계에서 시세표를 접어 번 자리를 도로 까먹는다.
  assert.match(css, /\.question-nav \{[^}]*overflow-x: auto/);
  assert.match(nav, /querySelectorAll\([^)]*question-nav/, "nav.js가 이 줄을 안 본다");
  for (const cls of ["scroll-start", "scroll-end"]) {
    assert.ok(css.includes(`.question-nav.${cls}`), `${cls} 페이드 규칙이 없다`);
  }
});

test("영어 화면에서는 질문도 영어다", async () => {
  const load = (storage) =>
    loadIndexPage({ storage, fetch: async () => ({ ok: false, json: async () => ({}) }) });
  const items = await links();

  const ko = await load();
  const en = await load({ lang: "en" });
  for (const item of items) {
    assert.match(ko.byId(item.id).textContent, /[가-힣]/, `${item.id} 한국어가 비었다`);
    assert.match(en.byId(item.id).textContent, /^[\x20-\x7E₩]+$/, `${item.id} 영어 화면에 한국어가 남았다`);
  }
});
