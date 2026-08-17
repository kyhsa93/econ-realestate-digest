import test from "node:test";
import assert from "node:assert/strict";
import { access, constants, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const WORKFLOWS = [".github/workflows/daily-update.yml", ".github/workflows/summarize.yml"];

test("푸시 스크립트는 실행 가능해야 한다", async () => {
  await access(path.join(root, "scripts/push-docs.sh"), constants.X_OK);
});

test("두 워크플로가 같은 푸시 스크립트를 쓴다", async () => {
  for (const file of WORKFLOWS) {
    assert.match(await read(file), /\.\/scripts\/push-docs\.sh/, `${file}가 푸시 스크립트를 쓰지 않는다`);
  }
});

test("워크플로가 직접 push하지 않는다", async () => {
  for (const file of WORKFLOWS) {
    const text = await read(file);
    assert.ok(!/^\s+git push\b/m.test(text), `${file}에 직접 push가 남아 있다`);
    assert.ok(!/^\s+git commit\b/m.test(text), `${file}에 직접 commit이 남아 있다`);
  }
});

test("실거래 원본도 함께 커밋한다", async () => {
  for (const file of ["scripts/push-docs.sh", "scripts/update-all.mjs"]) {
    const text = await read(file);
    assert.match(text, /git status --porcelain -- docs raw/, `${file}가 원본 변경을 보지 않는다`);
  }
});

test("원본 디렉터리가 없는 날에도 커밋이 된다", async () => {
  const { execFile } = await import("node:child_process");
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const base = await mkdtemp(path.join(tmpdir(), "push-docs-"));
  const remote = path.join(base, "remote.git");
  const work = path.join(base, "work");

  await run("git", ["init", "-q", "--bare", remote]);
  await run("git", ["clone", "-q", remote, work]);
  await run("git", ["config", "user.email", "t@t"], { cwd: work });
  await run("git", ["config", "user.name", "t"], { cwd: work });
  await mkdir(path.join(work, "docs"), { recursive: true });
  await writeFile(path.join(work, "docs/data.json"), "{}");

  const { stdout } = await run(path.join(root, "scripts/push-docs.sh"), ["테스트 커밋"], { cwd: work });

  const { stdout: log } = await run("git", ["log", "--oneline", "-1"], { cwd: work });
  assert.match(log, /테스트 커밋/, `커밋되지 않았다: ${stdout}`);

  const { stdout: files } = await run("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: work });
  assert.match(files, /docs\/data\.json/);
});

test("재시도는 rebase를 반드시 되돌리고 다음으로 넘어간다", async () => {
  const script = await read("scripts/push-docs.sh");
  assert.match(script, /git rebase --abort/, "충돌로 멈춘 rebase를 정리하지 않는다");
  assert.match(script, /git pull --rebase -X theirs/, "충돌을 우리 산출물로 풀지 않는다");
});
