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

async function collect(server, { rawDir, dataDir, dealsFile, backfillLimit = 0, env = {} }, steps = STEPS) {
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
      REALESTATE_DEALS_FILE: dealsFile,
      MOLIT_BACKFILL_LIMIT: String(backfillLimit),
      MOLIT_SWEEP_DELAY_MS: "0",
      MOLIT_RETRY_MS: "0",
      ...env,
    },
  };

  let stdout = "";
  for (const step of steps) stdout += (await run("node", [step], options)).stdout;
  return { stdout };
}

async function workspace() {
  const dir = await mkdtemp(path.join(tmpdir(), "collect-"));
  return {
    rawDir: path.join(dir, "raw"),
    dataDir: path.join(dir, "data"),
    dealsFile: path.join(dir, "deals.json"),
  };
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

  const previous = await readJson(path.join(space.dataDir, "realestate-prev.json"));
  assert.equal(previous.period, refreshMonths(NOW)[1]);
  assert.equal(previous.districts.length, DISTRICT_COUNT);
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
