// 수집 워크플로와 요약 워크플로가 각자 docs를 커밋한다. 그래서 push는 언제든 밀린다.
//
// 실제로 두 실행이 겹쳐(요약 03:59:07 종료, 수집 03:58:05 시작) rebase가 충돌했고, 재시도
// 루프가 rebase 진행 중 상태를 정리하지 않아 남은 네 번도 같은 자리에서 죽었다. 커밋·푸시를
// 한 스크립트로 모아 두 워크플로가 같은 규칙을 쓰게 한다.
import test from "node:test";
import assert from "node:assert/strict";
import { access, constants, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const WORKFLOWS = [".github/workflows/daily-update.yml", ".github/workflows/summarize.yml"];

test("푸시 스크립트는 실행 가능해야 한다", async () => {
  // 커밋된 실행 권한이 빠지면 CI에서 Permission denied로만 죽는다.
  await access(path.join(root, "scripts/push-docs.sh"), constants.X_OK);
});

test("두 워크플로가 같은 푸시 스크립트를 쓴다", async () => {
  for (const file of WORKFLOWS) {
    assert.match(await read(file), /\.\/scripts\/push-docs\.sh/, `${file}가 푸시 스크립트를 쓰지 않는다`);
  }
});

// 워크플로에 push를 다시 적어 넣으면 재시도 규칙이 갈라진다.
test("워크플로가 직접 push하지 않는다", async () => {
  for (const file of WORKFLOWS) {
    const text = await read(file);
    assert.ok(!/^\s+git push\b/m.test(text), `${file}에 직접 push가 남아 있다`);
    assert.ok(!/^\s+git commit\b/m.test(text), `${file}에 직접 commit이 남아 있다`);
  }
});

test("재시도는 rebase를 반드시 되돌리고 다음으로 넘어간다", async () => {
  const script = await read("scripts/push-docs.sh");
  assert.match(script, /git rebase --abort/, "충돌로 멈춘 rebase를 정리하지 않는다");
  assert.match(script, /git pull --rebase -X theirs/, "충돌을 우리 산출물로 풀지 않는다");
});
