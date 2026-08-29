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
    html.indexOf('class="question-nav"') < html.search(/<section id="/),
    "질문 입구가 표 밑에 있다"
  );
});

test("여섯 개가 스크롤 없이 한눈에 보인다", async () => {
  const css = await readFile(path.join(root, "docs/style.css"), "utf8");
  const block = /\.question-nav \{([^}]*)\}/.exec(css)?.[1] ?? "";

  // 전에는 한 줄로 접어 가로로 밀게 했다. 사이트에서 제일 눌려야 하는 자리를
  // 스크롤 뒤에 감춰 두면 뒤의 셋은 없는 것이나 같다.
  assert.match(block, /display: grid/, "질문 입구가 격자가 아니다");
  assert.doesNotMatch(block, /overflow-x: auto/, "질문 입구가 아직 가로로 잘린다");
  assert.ok(!css.includes(".question-nav.scroll-"), "가로 페이드 규칙이 남아 있다");
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
