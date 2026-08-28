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
