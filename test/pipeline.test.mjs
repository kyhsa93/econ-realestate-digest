import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

const scriptsIn = (text) =>
  [...text.matchAll(/node scripts\/([a-z-]+\.mjs)/g)].map((m) => m[1]);

/**
 * 매일 도는 워크플로가 update-all이 부르는 빌더를 하나라도 빠뜨리면, 그 빌더가
 * 만드는 파일은 사람이 손으로 돌릴 때까지 그대로 멈춘다. 화면은 멀쩡하고 숫자도
 * 그럴듯해서 아무도 모른다 - 실제로 전세vs월세·해제·등기·재계약 셋이 사흘 동안
 * 8월 26일자에 멈춰 있었다.
 */
test("워크플로가 update-all이 부르는 빌더를 다 부른다", async () => {
  const [workflow, updateAll] = await Promise.all([
    read(".github/workflows/daily-update.yml"),
    read("scripts/update-all.mjs"),
  ]);

  const wanted = scriptsIn(updateAll);
  assert.ok(wanted.length >= 10, `update-all이 부르는 스크립트를 ${wanted.length}개밖에 못 읽었다`);

  const running = new Set(scriptsIn(workflow));
  const missing = wanted.filter((name) => !running.has(name));
  assert.deepEqual(missing, [], `워크플로가 안 부르는 빌더: ${missing.join(", ")}`);
});

test("파생 데이터를 만드는 빌더가 원본 수집과 같은 단계에 있다", async () => {
  const workflow = await read(".github/workflows/daily-update.yml");
  // 원본(raw)을 읽는 빌더들이다. 수집이 건너뛰어지는 날에는 이들도 같이 쉬어야
  // 어제 원본으로 오늘 값을 다시 만드는 일이 없다.
  const step = workflow.split("- name: 실거래 수집")[1]?.split("- name:")[0] ?? "";
  for (const name of ["build-conversion.mjs", "build-cancellation.mjs", "build-renewal-facts.mjs", "build-complex-ratio.mjs"]) {
    assert.ok(step.includes(name), `${name}이 실거래 수집 단계 밖에 있다`);
  }
});
