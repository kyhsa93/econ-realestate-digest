import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFile(path.join(root, file), "utf8");

// 방향 문서가 있는데 아무도 안 가리키면 없는 것과 같다. 이 저장소에서 문서가 낡는
// 방식은 늘 같았다 - 같은 말이 두 곳에 적히고 한쪽만 고쳐진다. 그래서 README와
// 봇 사양서는 요약과 링크만 두고 본문은 DIRECTION.md 한 곳에만 있다.
test("방향 문서로 가는 길이 README와 봇 사양서에 있다", async () => {
  // 주간 조사 봇은 이 문서의 집행자다 - 사양서가 방향을 안 가리키면
  // 봇은 무엇이 값이 되는지를 스스로 지어내게 된다.
  for (const file of ["README.md", "audit/HOWTO.md", "research/HOWTO.md"]) {
    assert.match(await read(file), /DIRECTION\.md/, `${file}이 방향 문서를 안 가리킨다`);
  }
});

test("방향 문서가 세 부를 다 갖고 있다", async () => {
  const doc = await read("DIRECTION.md");
  for (const heading of ["## 1부.", "## 2부.", "## 3부."]) {
    assert.ok(doc.includes(heading), `${heading}가 없다`);
  }
  // 3부가 비면 "다음에 무엇을 할까"에 답이 없는 문서가 된다.
  const next = doc.slice(doc.indexOf("## 3부."), doc.indexOf("## 이 문서를 언제 고치나"));
  const items = [...next.matchAll(/^### \d+\. /gm)];
  assert.ok(items.length >= 1, "다음에 할 일이 하나도 없다");
});

test("메모리 링크 문법이 새어 나오지 않았다", async () => {
  // [[이름]]은 내 기억 파일의 문법이지 이 저장소의 것이 아니다.
  assert.doesNotMatch(await read("DIRECTION.md"), /\[\[/);
});
