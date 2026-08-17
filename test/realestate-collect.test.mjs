import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { errorXml, rentItem, saleItem, startFakeMolit, successXml } from "./helpers/fake-molit.mjs";
import { refreshMonths, windowMonths } from "../scripts/realestate-slots.mjs";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date();
const PERIOD = windowMonths(NOW)[0];
const DISTRICT_COUNT = 25;
const STEPS = ["scripts/fetch-realestate.mjs", "scripts/build-realestate.mjs"];

async function collect(server, { rawDir, dataDir, backfillLimit = 0, env = {} }, steps = STEPS) {
  const options = {
    cwd: root,
    env: {
      ...process.env,
      MOLIT_API_ENDPOINT: server.saleUrl,
      MOLIT_API_KEY: "test",
      MOLIT_RENT_API_ENDPOINT: server.rentUrl,
      MOLIT_RENT_API_KEY: "test",
      REALESTATE_RAW_DIR: rawDir,
      REALESTATE_DATA_DIR: dataDir,
      MOLIT_BACKFILL_LIMIT: String(backfillLimit),
      MOLIT_SWEEP_DELAY_MS: "0",
      MOLIT_RETRY_MS: "0",
      ...env,
    },
  };

  let stdout = "";
  for (const step of steps) {
    const result = await run("node", [step], options);
    stdout += result.stdout + result.stderr;
  }
  return { stdout };
}

async function workspace() {
  const dir = await mkdtemp(path.join(tmpdir(), "collect-"));
  return { rawDir: path.join(dir, "raw"), dataDir: path.join(dir, "data") };
}

const readJson = async (file) => JSON.parse(await readFile(file, "utf-8"));
const rawNames = async (dir, kind) => (await readdir(path.join(dir, kind))).sort();

test("당월과 전월 원본을 25개구씩 받아 남긴다", async (t) => {
  const server = await startFakeMolit((kind) => successXml([kind === "sale" ? saleItem() : rentItem()]));
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);

  const [current, previous] = refreshMonths(NOW);
  const expected = [current, previous].sort();

  for (const kind of ["sale", "rent"]) {
    const names = await rawNames(space.rawDir, kind);
    assert.equal(names.length, DISTRICT_COUNT * 2, `${kind} 슬롯 수가 다르다`);
    assert.deepEqual([...new Set(names.map((name) => name.slice(6, 12)))].sort(), expected);
  }
});

test("원본은 응답을 그대로 담고 건수를 함께 남긴다", async (t) => {
  const server = await startFakeMolit((kind) =>
    successXml([kind === "sale" ? saleItem({ aptNm: "원본확인" }) : rentItem()])
  );
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);

  const file = await readJson(path.join(space.rawDir, "sale", `11110-${PERIOD}.json`));
  assert.equal(file.ok, true);
  assert.equal(file.count, 1);
  assert.equal(file.totalCount, 1);
  assert.equal(file.items[0].aptNm, "원본확인");
  assert.equal(file.items[0].dealingGbn, "중개거래");
});

test("기존 산출물은 당월 기준 그대로 만들어진다", async (t) => {
  const server = await startFakeMolit((kind, { yearMonth }) => {
    const amount = yearMonth === PERIOD ? "52,000" : "40,000";
    return successXml([kind === "sale" ? saleItem({ dealAmount: amount }) : rentItem()]);
  });
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);

  const payload = await readJson(path.join(space.dataDir, "realestate.json"));
  assert.equal(payload.period, PERIOD);
  assert.equal(payload.districts.length, DISTRICT_COUNT);
  assert.equal(payload.overall.sale.transactionCount, DISTRICT_COUNT, "당월 거래만 세야 한다");

  assert.equal(payload.previousPeriod, refreshMonths(NOW)[1], "지난달 비교값을 원본에서 만들지 않았다");
});

test("응답이 그대로면 원본 파일을 다시 쓰지 않는다", async (t) => {
  const server = await startFakeMolit((kind) => successXml([kind === "sale" ? saleItem() : rentItem()]));
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);
  const file = path.join(space.rawDir, "sale", `11110-${PERIOD}.json`);
  const before = await stat(file);

  await collect(server, space);
  const after = await stat(file);

  assert.equal(after.mtimeMs, before.mtimeMs, "내용이 같은데 파일을 다시 썼다");
});

test("새로 신고된 거래만 유입으로 센다", async (t) => {
  let extra = false;
  const server = await startFakeMolit((kind) => {
    if (kind !== "sale") return successXml([rentItem()]);
    return successXml(extra ? [saleItem(), saleItem({ aptNm: "새로들어온단지" })] : [saleItem()]);
  });
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);
  extra = true;
  const { stdout } = await collect(server, space);

  const file = await readJson(path.join(space.rawDir, "sale", `11110-${PERIOD}.json`));
  assert.equal(file.count, 2);
  assert.ok(file.previousObservedAt, "직전 관측 시각을 남기지 않았다");
  assert.match(stdout, new RegExp(`새 거래 ${DISTRICT_COUNT * 2}건`), stdout);
});

test("조회에 실패한 슬롯은 남기지 않아 다음 실행이 다시 받는다", async (t) => {
  let failing = true;
  const server = await startFakeMolit((kind, { code }) => {
    if (failing && kind === "sale" && code === "11110") return errorXml("LIMITED NUMBER OF SERVICE REQUESTS");
    return successXml([kind === "sale" ? saleItem() : rentItem()]);
  });
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);
  assert.ok(!(await rawNames(space.rawDir, "sale")).includes(`11110-${PERIOD}.json`), "실패한 슬롯이 저장됐다");

  failing = false;
  await collect(server, space);
  assert.ok((await rawNames(space.rawDir, "sale")).includes(`11110-${PERIOD}.json`), "실패한 슬롯을 다시 받지 않았다");
});

test("백필은 상한만큼만, 남은 몫은 다음 실행이 이어받는다", async (t) => {
  const server = await startFakeMolit((kind) => successXml([kind === "sale" ? saleItem() : rentItem()]));
  t.after(() => server.close());
  const space = await workspace();

  const { stdout } = await collect(server, { ...space, backfillLimit: 10 });

  assert.match(stdout, /신규 10\b/, stdout);
  assert.match(stdout, /대기 \d+/, stdout);

  const total = (await rawNames(space.rawDir, "sale")).length + (await rawNames(space.rawDir, "rent")).length;
  assert.equal(total, DISTRICT_COUNT * 2 * 2 + 10, "갱신분 외에 상한만큼만 받아야 한다");
});

test("잘린 응답은 확정으로 굳히지 않고 다음 실행에 다시 받는다", async (t) => {
  let truncated = true;
  const server = await startFakeMolit((kind) => {
    if (kind !== "sale") return successXml([rentItem()]);
    return truncated ? successXml([saleItem()], 9999) : successXml([saleItem()]);
  });
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, { ...space, backfillLimit: 400 });
  const older = windowMonths(NOW)[3];
  assert.equal((await readJson(path.join(space.rawDir, "sale", `11110-${older}.json`))).totalCount, 9999);

  truncated = false;
  const { stdout } = await collect(server, { ...space, backfillLimit: 400 });

  assert.match(stdout, /재조회 \d+/, stdout);
  assert.equal((await readJson(path.join(space.rawDir, "sale", `11110-${older}.json`))).totalCount, 1);
});

test("원본만 있으면 조회 없이 산출물을 다시 만든다", async (t) => {
  const server = await startFakeMolit((kind) => successXml([kind === "sale" ? saleItem() : rentItem()]));
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);
  const first = await readFile(path.join(space.dataDir, "realestate.json"), "utf-8");

  await server.close();
  await collect(server, space, ["scripts/build-realestate.mjs"]);
  const second = await readFile(path.join(space.dataDir, "realestate.json"), "utf-8");

  const strip = (text) => text.replace(/"updatedAt": "[^"]+"/g, "");
  assert.equal(strip(second), strip(first), "원본만으로 같은 산출물을 만들지 못했다");
});

test("수집이 통째로 실패해도 지난 원본으로 산출물을 만든다", async (t) => {
  const server = await startFakeMolit((kind) => successXml([kind === "sale" ? saleItem() : rentItem()]));
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);

  const dead = { saleUrl: "http://127.0.0.1:1/sale", rentUrl: "http://127.0.0.1:1/rent" };
  const { stdout } = await collect(dead, space);

  assert.match(stdout, /저장 완료/, stdout);
  const payload = JSON.parse(await readFile(path.join(space.dataDir, "realestate.json"), "utf-8"));
  assert.equal(payload.districts.length, DISTRICT_COUNT);
});

test("전월세도 지역별 전수 파일로 남긴다", async (t) => {
  const server = await startFakeMolit((kind, { yearMonth }) => {
    const on = { dealYear: Number(yearMonth.slice(0, 4)), dealMonth: Number(yearMonth.slice(4)) };
    return kind === "sale"
      ? successXml([saleItem(on)])
      : successXml([
          rentItem(on),
          rentItem({ ...on, aptNm: "월세단지", monthlyRent: "150", deposit: "10,000" }),
          rentItem({ ...on, aptNm: "갱신단지", contractType: "갱신", deposit: "45,000" }),
        ]);
  });
  t.after(() => server.close());
  const space = await workspace();

  const { stdout } = await collect(server, space);

  const months = refreshMonths(NOW);
  const file = JSON.parse(await readFile(path.join(space.dataDir, "rents-jongno.json"), "utf-8"));
  assert.equal(file.district, "종로구");
  assert.deepEqual(file.periods, [...months].sort(), "받아둔 달이 다 담기지 않았다");
  assert.equal(file.deals.length, 3 * months.length);

  const jeonse = file.deals.find((deal) => deal.apt === "테스트단지");
  const wolse = file.deals.find((deal) => deal.apt === "월세단지");
  assert.ok(!("monthlyRent10k" in jeonse), "전세에 월세 항목이 남았다");
  assert.equal(wolse.monthlyRent10k, 150);
  assert.equal(file.deals.find((deal) => deal.apt === "갱신단지").renewal, true);
  assert.ok(file.deals.every((deal) => !("district" in deal)), "지역 이름이 거래마다 남았다");

  const total = DISTRICT_COUNT * months.length;
  assert.match(stdout, new RegExp(`전세 ${total * 2}건 · 월세 ${total}건`), stdout);
  assert.match(stdout, new RegExp(`갱신계약 ${total}건`), stdout);
});

test("날마다 새로 들어온 신고만 주간 시세로 쌓인다", async (t) => {
  let extra = 0;
  const server = await startFakeMolit((kind) => {
    const rows = Array.from({ length: 1 + extra }, (_, i) =>
      kind === "sale"
        ? saleItem({ aptNm: `단지${i}`, dealAmount: `${50000 + i * 1000}` })
        : rentItem({ aptNm: `전월세${i}`, deposit: `${30000 + i * 1000}` })
    );
    return successXml(rows);
  });
  t.after(() => server.close());
  const space = await workspace();

  await collect(server, space);
  const first = JSON.parse(await readFile(path.join(space.rawDir, "sale", `11110-${PERIOD}.json`), "utf-8"));
  assert.deepEqual(first.arrivals, {}, "처음 받은 거래에 신고일을 붙였다");

  extra = 2;
  await collect(server, space);
  const second = JSON.parse(await readFile(path.join(space.rawDir, "sale", `11110-${PERIOD}.json`), "utf-8"));
  assert.equal(Object.keys(second.arrivals).length, 2, "새로 들어온 두 건만 잡아야 한다");
  assert.equal(second.count, 3);
});

test("연달아 실패하면 남은 슬롯을 다음 실행으로 넘긴다", async (t) => {
  const server = await startFakeMolit(() => undefined);
  t.after(() => server.close());
  const space = await workspace();

  const { stdout } = await collect(
    server,
    { ...space, backfillLimit: 50, env: { MOLIT_ABORT_AFTER: "5" } },
    ["scripts/fetch-realestate.mjs"]
  );

  assert.match(stdout, /5개 연속 실패로 중단했습니다/, stdout);
  assert.match(stdout, /남은 \d+개 슬롯은 다음 실행에서 받습니다/, stdout);
  assert.ok(!stdout.includes("재시도 스윕"), "전부 막힌 상태에서 스윕까지 돌았다");
});

test("한 슬롯이 실패해도 나머지는 계속 받는다", async (t) => {
  const server = await startFakeMolit((kind, { code }) =>
    kind === "sale" && code === "11110" ? undefined : successXml([kind === "sale" ? saleItem() : rentItem()])
  );
  t.after(() => server.close());
  const space = await workspace();

  const { stdout } = await collect(server, { ...space, env: { MOLIT_ABORT_AFTER: "5" } });

  assert.ok(!stdout.includes("연속 실패로 중단"), stdout);
  assert.ok((await rawNames(space.rawDir, "sale")).length >= DISTRICT_COUNT, "성공한 슬롯이 저장되지 않았다");
});
