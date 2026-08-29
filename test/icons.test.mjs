import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { icon } from "../scripts/build-icons.mjs";

const root = path.resolve(import.meta.dirname, "..");

// 아이콘은 손으로 그린 그림이 아니라 scripts/build-icons.mjs의 출력이다.
// 손으로 갈아 끼우면 화면의 워드마크와 조용히 갈라진다.
test("앱 아이콘은 스크립트가 그린 것과 같다", async () => {
  for (const size of [192, 512]) {
    const committed = await readFile(path.join(root, `docs/icons/icon-${size}.png`));
    assert.ok(
      committed.equals(icon(size)),
      `docs/icons/icon-${size}.png가 원본과 어긋납니다. node scripts/build-icons.mjs를 실행하세요.`
    );
  }
});

// 마크와 워드마크는 같은 모양이어야 한다. 한쪽만 고치는 것을 막을 방법은
// 렌더링 없이는 없으므로, 최소한 획 수가 같은지는 본다.
test("워드마크도 같은 획으로 그린다", async () => {
  const css = await readFile(path.join(root, "docs/style.css"), "utf8");
  const block = /\.wordmark::before,\n\.brand::before \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const bars = [...block.matchAll(/no-repeat/g)].length;
  assert.equal(bars, 4, `워드마크의 세로 획이 ${bars}대다`);
  assert.match(block, /linear-gradient\(1\d\ddeg/, "가로지르는 획이 없다");
});
