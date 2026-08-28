import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const css = () => readFile(path.join(root, "docs/style.css"), "utf8");

// :root 바깥의 규칙만 훑는다. 축척 자체는 :root에 숫자로 적혀 있어야 하기 때문이다.
// 주석은 먼저 걷어낸다 - 안에 쉼표가 있으면 셀렉터 목록으로 딸려 들어온다.
function rules(text) {
  return [...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ sel: sel.trim().replace(/\s+/g, " "), body }))
    .filter((r) => !r.sel.startsWith(":root"));
}

const parts = (sel) => sel.split(",").map((s) => s.trim()).sort().join(", ");

test("글자 크기는 축척에서만 고른다", async () => {
  const strays = rules(await css())
    .map((r) => ({ sel: r.sel, size: r.body.match(/font-size:\s*([^;]+);/)?.[1]?.trim() }))
    // .method-body code처럼 둘러싼 글에 비례해야 하는 곳만 em으로 남긴다.
    .filter((r) => r.size && !r.size.startsWith("var(--fs-") && !r.size.endsWith("em"));

  // 축척을 안 쓰는 크기가 하나 생기면 다음 것이 그 옆에 붙는다. 스물두 단계는
  // 그렇게 늘어났고, 그때는 무엇이 무엇보다 커야 하는지 아무도 말할 수 없었다.
  assert.deepEqual(strays, [], `축척 밖 글자 크기: ${strays.map((s) => `${s.sel}(${s.size})`).join(", ")}`);
});

test("축척의 바닥이 한글이 읽히는 크기다", async () => {
  const scale = (await css()).match(/:root \{([\s\S]*?)\n\}/)[1];
  const sizes = [...scale.matchAll(/--fs-[a-z0-9]+:\s*([\d.]+)rem;/g)].map((m) => Number(m[1]));

  assert.ok(sizes.length >= 8, `축척 단계가 ${sizes.length}개뿐이다`);
  assert.ok(Math.min(...sizes) >= 0.78, `${Math.min(...sizes)}rem은 한글이 뭉갠다`);
});

test("입력칸은 iOS가 화면을 확대하지 않는 크기다", async () => {
  const text = await css();
  const field = Number(text.match(/--fs-field:\s*([\d.]+)rem;/)[1]);
  // 16px 미만이면 iOS Safari가 초점이 갈 때 화면을 당겨 버리고, 되돌려주지 않는다.
  assert.ok(field >= 1, `--fs-field가 ${field}rem이라 초점에서 화면이 확대된다`);

  const small = rules(text)
    .filter((r) => /\b(input|select|textarea)\b/.test(r.sel) && !/\[type="(checkbox|radio)"\]/.test(r.sel))
    .filter((r) => {
      const size = r.body.match(/font-size:\s*([^;]+);/)?.[1]?.trim();
      return size && size !== "var(--fs-field)";
    });

  assert.deepEqual(small.map((r) => r.sel), [], "입력칸이 --fs-field보다 작은 크기를 쓴다");
});

test("표와 카드의 숫자는 자릿수를 세로로 맞춘다", async () => {
  const text = await css();
  const fixed = new Set(
    rules(text)
      .filter((r) => r.body.includes("tabular-nums"))
      .flatMap((r) => r.sel.split(",").map((s) => s.trim()))
  );

  // 이 사이트는 5,211만원과 11,227만원을 위아래로 놓고 비교하는 것이 전부다.
  // 비례폭 숫자로 적으면 만 자리가 어긋나 눈이 열을 따라가지 못한다.
  for (const sel of [".data-table td", ".change", ".count", ".history-current", ".rate-table td"]) {
    assert.ok(fixed.has(sel), `${sel}에 고정폭 숫자가 없다`);
  }
});

test("숫자 열은 오른쪽, 이름 열은 왼쪽에 붙인다", async () => {
  const text = await css();
  const find = (want) => rules(text).find((r) => parts(r.sel) === parts(want));
  const cells = find(".data-table td, .data-table th");
  const first = find(".data-table th:first-child, .data-table td:first-child");
  assert.ok(cells && first, "표 정렬 규칙을 찾지 못했다");

  assert.match(cells.body, /text-align: right/, "숫자 열이 오른쪽에 붙지 않는다");
  assert.match(first.body, /text-align: left/, "지역·지표 이름까지 오른쪽으로 밀렸다");
});

test("누르는 것은 손가락이 닿는 크기다", async () => {
  const text = await css();
  const tap = Number(text.match(/--tap:\s*(\d+)px;/)[1]);
  // 알약 탭 30px, 아이콘 버튼 36px, 뉴스 칩 26px이었다. 셋 다 엄지 끝보다 작다.
  assert.ok(tap >= 44, `--tap이 ${tap}px다`);

  const uses = (sel) => {
    const rule = rules(text).find((r) => parts(r.sel) === parts(sel));
    assert.ok(rule, `${sel} 규칙이 없다`);
    assert.match(rule.body, /(min-height|height): var\(--tap\)/, `${sel}이 --tap을 안 쓴다`);
  };
  for (const sel of [".page-nav a", ".sub-nav a", ".news-chip", ".lang-toggle", ".icon-toggle"]) uses(sel);
});

test("키보드로 훑을 때 지금 어디인지 보인다", async () => {
  const text = await css();
  const focus = rules(text).filter((r) => r.sel.includes(":focus-visible") && /outline:/.test(r.body));
  assert.ok(focus.length, "초점 테두리 규칙이 없다");

  const covered = new Set(focus.flatMap((r) => r.sel.split(",").map((x) => x.trim())));
  for (const sel of ["a:focus-visible", "button:focus-visible", "input:focus-visible", "select:focus-visible"]) {
    assert.ok(covered.has(sel), `${sel}에 초점 테두리가 없다`);
  }
});

test("스크린리더만 읽는 자리가 화면에서는 안 보인다", async () => {
  const rule = rules(await css()).find((r) => r.sel === ".sr-only");
  assert.ok(rule, ".sr-only가 없다");
  // display:none이면 스크린리더도 안 읽는다. 잘라내되 살려 둬야 한다.
  assert.ok(!/display:\s*none/.test(rule.body), ".sr-only를 display:none으로 감췄다");
  assert.match(rule.body, /clip-path|clip:/, ".sr-only가 화면에서 안 잘렸다");
});

test("걸러낸 결과를 소리로도 알린다", async () => {
  const { readFile } = await import("node:fs/promises");
  const has = async (file, id) => {
    const html = await readFile(path.join(root, "docs", file), "utf8");
    const tag = new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";
    assert.match(tag, /role="status"/, `docs/${file}의 #${id}가 알림 영역이 아니다`);
  };
  await has("index.html", "realestate-status");
  await has("index.html", "news-status");
  await has("deal-search.html", "search-status");
  await has("rates.html", "show-more");
});

// --- 액센트 -----------------------------------------------------------------

const HEX = /^#([0-9a-f]{6})$/i;

function luminance(hex) {
  const [r, g, b] = HEX.exec(hex)[1].match(/../g).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// :root, 다크 미디어쿼리, data-theme 둘 - 네 갈래 모두에서 색이 맞아야 한다.
function palettes(text) {
  const blocks = [...text.matchAll(/(:root(?:\[data-theme="[a-z]+"\])?)\s*\{([^}]*)\}/g)];
  return blocks.map(([, sel, body]) => {
    const vars = Object.fromEntries(
      [...body.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]])
    );
    return { sel, vars };
  });
}

test("네 갈래 팔레트가 모두 액센트를 갖는다", async () => {
  const text = await css();
  const found = palettes(text).filter((p) => p.vars["--accent"]);
  // :root · @media dark의 :root · [data-theme="dark"] · [data-theme="light"]
  assert.equal(found.length, 4, `액센트를 정의한 팔레트가 ${found.length}개다`);
});

test("액센트 위의 글자가 읽힌다", async () => {
  for (const { sel, vars } of palettes(await css())) {
    if (!vars["--accent"]) continue;
    const onAccent = contrast(vars["--accent"], vars["--accent-on"]);
    assert.ok(onAccent >= 4.5, `${sel}: 채운 탭의 글자 대비가 ${onAccent.toFixed(1)}:1이다`);

    // 2층 현재 항목은 카드 위에 액센트 글씨로 앉는다.
    if (vars["--card"]) {
      const onCard = contrast(vars["--accent"], vars["--card"]);
      assert.ok(onCard >= 4.5, `${sel}: 카드 위 액센트 대비가 ${onCard.toFixed(1)}:1이다`);
    }
  }
});

test("액센트를 데이터 안에는 쓰지 않는다", async () => {
  // 표 안의 파랑은 이미 '하락'이라는 뜻이다. 같은 자리에 다른 뜻의 파랑을
  // 놓으면 둘 다 못 읽는다. 액센트는 어디에 있고 무엇을 골랐는지만 말한다.
  const inData = rules(await css())
    .filter((r) => r.body.includes("var(--accent)"))
    .filter((r) => /\.(data-table|rate-table|change|count|price-strong|rate-strong|history-current)\b/.test(r.sel));

  assert.deepEqual(inData.map((r) => r.sel), [], "액센트가 데이터 안까지 들어왔다");
});
