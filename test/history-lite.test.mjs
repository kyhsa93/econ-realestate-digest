// 메인 화면이 받는 부동산 히스토리를 줄인 것이라, 지켜야 할 건 두 가지다.
// (1) 화면이 예전과 똑같이 그려질 것, (2) 파일이 다시 무한정 자라지 않을 것.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LITE_DAYS, toLite } from "../scripts/build-history-lite.mjs";
import { loadIndexPage } from "./helpers/index-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);

test("커밋된 경량 파일이 원본에서 다시 만든 결과와 같다", async () => {
  const [full, lite] = await Promise.all([readJson("realestate-history"), readJson("realestate-history-lite")]);
  assert.deepEqual(
    lite,
    toLite(full),
    "realestate-history-lite.json이 원본과 어긋납니다. node scripts/build-history-lite.mjs를 실행하세요."
  );
});

test("경량 파일은 날짜 수 상한이 있어서 무한정 자라지 않는다", async () => {
  const lite = await readJson("realestate-history-lite");
  assert.ok(lite.length <= LITE_DAYS, `${lite.length}일치가 들어 있다`);

  // 차트가 slice(-30)만 그리므로 상한을 그보다 크게 잡되 과하지 않게 둔다.
  assert.ok(LITE_DAYS >= 30 && LITE_DAYS <= 60, `상한이 ${LITE_DAYS}일이면 차트 구간과 안 맞는다`);
});

test("차트가 안 쓰는 필드는 빼서 크기를 줄인다", async () => {
  const [full, lite] = await Promise.all([readJson("realestate-history"), readJson("realestate-history-lite")]);
  const text = JSON.stringify(lite);

  for (const field of ["change", "baselineDate", "avgPricePerM2", "avgDeposit10k", "avgMonthlyRent10k"]) {
    assert.ok(!text.includes(`"${field}"`), `차트가 안 쓰는 ${field}가 남아 있다`);
  }

  const fullSize = JSON.stringify(full).length;
  assert.ok(text.length < fullSize, `줄어들지 않았다 (${text.length} vs ${fullSize})`);
});

// 이 테스트가 이번 변경의 핵심이다. 데이터를 줄였는데 차트가 달라지면 의미가 없다.
test("경량 파일로 그린 차트가 원본으로 그린 것과 완전히 같다", async () => {
  const [full, lite, today] = await Promise.all([
    readJson("realestate-history"),
    readJson("realestate-history-lite"),
    readJson("realestate"),
  ]);

  const page = await loadIndexPage();
  page.app.__cache.realestate = today;

  page.app.renderRealestateHistory(full);
  const fromFull = page.byId("realestate-history-grid").innerHTML;

  page.app.renderRealestateHistory(lite);
  const fromLite = page.byId("realestate-history-grid").innerHTML;

  assert.ok(fromFull.length > 0, "원본으로도 차트가 안 그려졌다 - 테스트가 아무것도 검사하지 못한다");
  assert.equal(fromLite, fromFull, "경량 파일로 그린 차트가 다르다");
});

test("메인 화면은 경량 파일을, 아카이브는 원본을 받는다", async () => {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");

  assert.ok(html.includes('realestateHistory: "realestate-history-lite"'), "경량 파일 매핑이 없다");
  assert.ok(
    html.includes('loadHistoryInto("realestateHistory", { lite: true })'),
    "메인 화면이 경량 파일을 받지 않는다"
  );

  // 아카이브는 그날의 전체 내용이 필요해서 원본(HISTORY_FILES)을 그대로 받아야 한다.
  assert.ok(
    html.includes("Object.keys(HISTORY_FILES).map((key) => loadHistoryInto(key))"),
    "아카이브가 원본 히스토리를 받지 않는다"
  );
});
