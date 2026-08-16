// 내비게이션은 페이지를 추가할 때마다 조용히 길어진다. 실제로 한 줄에 일곱 개가 쌓여
// 좁은 화면에서 가로로 밀리는 상태까지 갔다. 원인은 개수가 아니라 층위였다 - 사이트
// 섹션(뉴스·시세·금리)과 그 안의 분류(부동산 뉴스, 매매/전세/월세)를 같은 줄에 섞어
// 놓으면 페이지가 늘 때마다 그 줄이 길어질 수밖에 없다.
//
// 그래서 규칙을 테스트로 못박는다: 1층은 섹션만, 그 개수는 고정. 세부는 2층으로.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const docs = path.join(root, "docs");

const pages = async () =>
  (await readdir(docs)).filter((f) => f.endsWith(".html")).sort();

const navBlock = (html, cls) =>
  new RegExp(`<nav class="${cls}"[\\s\\S]*?</nav>`).exec(html)?.[0] ?? null;

const links = (block) => [...(block ?? "").matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map((m) => ({
  attrs: m[0].slice(0, m[0].indexOf(">")),
  text: m[1].trim(),
}));

// 섹션은 넷뿐이다(다이제스트·뉴스·시세·금리). 여기에 다섯 번째를 더하고 싶어지면
// 그건 대개 2층으로 가야 할 항목이다.
const SECTION_COUNT = 4;

test("모든 페이지의 1층 내비게이션이 섹션 넷을 넘지 않는다", async () => {
  for (const file of await pages()) {
    const html = await readFile(path.join(docs, file), "utf8");
    const block = navBlock(html, "page-nav");
    if (!block) continue;
    const items = links(block);
    assert.ok(
      items.length <= SECTION_COUNT,
      `${file}: 1층이 ${items.length}개다(${items.map((i) => i.text).join(", ")}). 세부 분류는 sub-nav로 옮기세요.`
    );
  }
});

test("페이지마다 지금 보고 있는 섹션이 하나만 표시된다", async () => {
  for (const file of await pages()) {
    const html = await readFile(path.join(docs, file), "utf8");
    const block = navBlock(html, "page-nav");
    if (!block) continue;
    const active = links(block).filter((i) => i.attrs.includes('class="active"'));
    assert.equal(active.length, 1, `${file}: 1층 활성 표시가 ${active.length}개다`);
  }
});

// aria-current="page"는 '지금 이 URL'을 가리키는 링크에만 붙어야 한다. 부동산 뉴스
// 페이지에서 1층 '뉴스'는 같은 섹션일 뿐 현재 페이지가 아니므로 class로만 표시한다.
test("현재 페이지 표시는 페이지당 하나뿐이다", async () => {
  for (const file of await pages()) {
    const html = await readFile(path.join(docs, file), "utf8");
    const blocks = [navBlock(html, "page-nav"), navBlock(html, "sub-nav")].filter(Boolean);
    if (!blocks.length) continue;
    const current = blocks
      .flatMap((b) => links(b))
      .filter((i) => i.attrs.includes('aria-current="page"'));
    assert.ok(
      current.length <= 1,
      `${file}: aria-current가 ${current.length}개다(${current.map((i) => i.text).join(", ")})`
    );
  }
});

test("세부 분류가 있는 페이지는 2층에서 자기 위치를 표시한다", async () => {
  const expected = {
    "news.html": "전체",
    "realestate-news.html": "부동산",
    "stock-news.html": "증시·환율",
    "rate-news.html": "금리",
    "realestate.html": "전체",
    "apartment-sale.html": "매매",
    "apartment-jeonse.html": "전세",
    "apartment-rent.html": "월세",
  };

  for (const [file, label] of Object.entries(expected)) {
    const html = await readFile(path.join(docs, file), "utf8");
    const block = navBlock(html, "sub-nav");
    assert.ok(block, `${file}: 2층 내비게이션이 없다`);
    const current = links(block).filter((i) => i.attrs.includes('aria-current="page"'));
    assert.equal(current.length, 1, `${file}: 2층 현재 표시가 ${current.length}개다`);
    assert.equal(current[0].text, label, `${file}: 2층 현재 표시가 "${current[0].text}"다`);
  }
});

test("모든 페이지가 네 섹션 서로에게 닿는다", async () => {
  const targets = ["./index.html", "./news.html", "./realestate.html", "./rates.html"];
  for (const file of await pages()) {
    const html = await readFile(path.join(docs, file), "utf8");
    const block = navBlock(html, "page-nav");
    if (!block) continue;
    for (const target of targets) {
      assert.ok(block.includes(`href="${target}"`), `${file}: ${target} 링크가 없다`);
    }
  }
});
