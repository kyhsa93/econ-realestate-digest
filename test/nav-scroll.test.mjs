import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");

function fakeNav({ scrollWidth, clientWidth, scrollLeft = 0, current = null }) {
  const classes = new Set();
  const listeners = {};
  return {
    scrollWidth,
    clientWidth,
    scrollLeft,
    classes,
    classList: {
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
    },
    querySelector: () => current,
    addEventListener: (type, fn) => ((listeners[type] ||= []).push(fn), undefined),
    fire: (type) => (listeners[type] ?? []).forEach((fn) => fn()),
  };
}

async function run(navs, lang = "ko") {
  const source = await readFile(path.join(root, "docs/nav.js"), "utf8");
  const list = navs;
  list.length = navs.length;
  const skip = { textContent: "", getAttribute: () => "Skip to content" };
  vm.runInNewContext(source, {
    document: {
      querySelectorAll: () => list,
      querySelector: () => skip,
      documentElement: { getAttribute: () => lang },
    },
    window: { addEventListener() {} },
  });
  return navs;
}

test("넘치지 않는 내비게이션에는 페이드를 켜지 않는다", async () => {
  const [nav] = await run([fakeNav({ scrollWidth: 300, clientWidth: 300 })]);
  assert.deepEqual([...nav.classes], [], "다 보이는데 더 있다고 말한다");
});

test("넘치면 남은 쪽에만 페이드를 켠다", async () => {
  const [left] = await run([fakeNav({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 })]);
  assert.deepEqual([...left.classes], ["scroll-end"], "왼쪽 끝인데 왼쪽에도 페이드를 켰다");

  const [mid] = await run([fakeNav({ scrollWidth: 800, clientWidth: 400, scrollLeft: 200 })]);
  assert.deepEqual([...mid.classes].sort(), ["scroll-end", "scroll-start"]);

  const [right] = await run([fakeNav({ scrollWidth: 800, clientWidth: 400, scrollLeft: 400 })]);
  assert.deepEqual([...right.classes], ["scroll-start"], "끝까지 밀었는데 더 있다고 말한다");
});

test("잘려 나간 현재 항목을 스크롤 안으로 데려온다", async () => {
  const current = { offsetLeft: 620, offsetWidth: 120 };
  const [nav] = await run([fakeNav({ scrollWidth: 800, clientWidth: 400, current })]);
  // 가운데로: 620 - (400 - 120) / 2 = 480
  assert.equal(nav.scrollLeft, 480, "현재 항목이 화면 밖에 그대로 남았다");
});

test("다 보이는 내비게이션은 스크롤을 건드리지 않는다", async () => {
  const current = { offsetLeft: 200, offsetWidth: 80 };
  const [nav] = await run([fakeNav({ scrollWidth: 300, clientWidth: 300, current })]);
  assert.equal(nav.scrollLeft, 0);
});

test("스크롤할 때마다 남은 쪽을 다시 센다", async () => {
  const [nav] = await run([fakeNav({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 })]);
  nav.scrollLeft = 400;
  nav.fire("scroll");
  assert.deepEqual([...nav.classes], ["scroll-start"]);
});

test("모든 페이지가 nav.js를 부른다", async () => {
  const docs = path.join(root, "docs");
  for (const file of (await readdir(docs)).filter((f) => f.endsWith(".html"))) {
    const html = await readFile(path.join(docs, file), "utf8");
    assert.ok(html.includes('src="./nav.js"'), `docs/${file}이 nav.js를 부르지 않는다`);
  }
});

test("2층이 누를 수 있는 것으로 보인다", async () => {
  const css = await readFile(path.join(root, "docs/style.css"), "utf8");
  const rule = css.match(/\n\.sub-nav a \{([^}]*)\}/)?.[1];

  assert.ok(rule, ".sub-nav a 규칙이 없다");
  // 회색 글씨만으로는 링크인지 문단인지 구분이 안 된다. 테두리가 그 구분을 준다.
  assert.match(rule, /border: 1px solid/, "2층 항목에 테두리가 없다");

  for (const cls of ["scroll-start", "scroll-end"]) {
    assert.ok(css.includes(`.sub-nav.${cls}`), `${cls} 페이드 규칙이 없다`);
  }
});

test("영어 화면에서는 건너뛰기 링크도 영어다", async () => {
  const source = await readFile(path.join(root, "docs/nav.js"), "utf8");
  const make = (lang) => {
    const skip = { textContent: "본문 바로가기", getAttribute: (n) => (n === "data-skip-en" ? "Skip to content" : null) };
    const list = [];
    vm.runInNewContext(source, {
      document: {
        querySelectorAll: () => list,
        querySelector: () => skip,
        documentElement: { getAttribute: () => lang },
      },
      window: { addEventListener() {} },
    });
    return skip.textContent;
  };
  assert.equal(make("ko"), "본문 바로가기");
  assert.equal(make("en"), "Skip to content");
});

test("모든 페이지에 본문으로 건너뛰는 길이 있다", async () => {
  const docs = path.join(root, "docs");
  for (const file of (await readdir(docs)).filter((f) => f.endsWith(".html"))) {
    const html = await readFile(path.join(docs, file), "utf8");
    assert.match(html, /<a class="skip-link" href="#main"/, `docs/${file}에 건너뛰기 링크가 없다`);
    assert.match(html, /<main id="main">/, `docs/${file}의 본문에 닿을 곳이 없다`);
  }
});
