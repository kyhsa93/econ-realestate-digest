import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildSlotFile,
  readSlotFile,
  readSlots,
  removeSlotFile,
  writeSlotFile,
} from "../scripts/realestate-raw.mjs";

const AT = "2026-08-17T23:07:00.000Z";

const item = (extra = {}) => ({
  aptNm: "상계주공7",
  dealAmount: "52,000",
  dealDay: 14,
  dealMonth: 8,
  dealYear: 2026,
  excluUseAr: 45.9,
  umdNm: "상계동",
  ...extra,
});

const slot = (items, extra = {}) =>
  buildSlotFile({ kind: "sale", code: "11350", yearMonth: "202608", items, observedAt: AT, ...extra });

const dir = () => mkdtemp(path.join(tmpdir(), "raw-"));

test("응답을 그대로 담고 건수를 함께 남긴다", () => {
  const file = slot([item(), item({ aptNm: "중계무지개" })]);

  assert.equal(file.count, 2);
  assert.equal(file.totalCount, 2);
  assert.equal(file.ok, true);
  assert.equal(file.items[0].dealAmount, "52,000");
});

test("응답이 잘렸으면 totalCount로 드러난다", () => {
  const file = slot([item()], { totalCount: 9999 });
  assert.equal(file.count, 1);
  assert.equal(file.totalCount, 9999);
});

test("키 순서와 거래 순서가 달라도 같은 바이트가 된다", async () => {
  const root = await dir();
  const forward = slot([item(), item({ aptNm: "중계무지개" })]);
  const shuffled = slot([
    { umdNm: "상계동", excluUseAr: 45.9, dealYear: 2026, dealMonth: 8, dealDay: 14, dealAmount: "52,000", aptNm: "중계무지개" },
    { umdNm: "상계동", excluUseAr: 45.9, dealYear: 2026, dealMonth: 8, dealDay: 14, dealAmount: "52,000", aptNm: "상계주공7" },
  ]);

  await writeSlotFile(forward, root);
  const before = await readFile(path.join(root, "sale/11350-202608.json"), "utf-8");
  const second = await writeSlotFile(shuffled, root);

  assert.equal(second.changed, false, "순서만 다른 응답에 파일을 다시 썼다");
  assert.equal(await readFile(path.join(root, "sale/11350-202608.json"), "utf-8"), before);
});

test("거래 한 건이 한 줄로 저장된다", async () => {
  const root = await dir();
  await writeSlotFile(slot([item(), item({ aptNm: "중계무지개" })]), root);

  const text = await readFile(path.join(root, "sale/11350-202608.json"), "utf-8");
  assert.equal(text.split("\n").filter((line) => line.startsWith("{\"aptNm\"")).length, 2);
});

test("내용이 바뀌면 직전 관측 시각을 남긴다", async () => {
  const root = await dir();
  await writeSlotFile(slot([item()]), root);

  const later = "2026-08-18T23:07:00.000Z";
  const result = await writeSlotFile(
    slot([item(), item({ aptNm: "새로들어온단지" })], { observedAt: later }),
    root
  );

  assert.equal(result.changed, true);
  assert.equal(result.added, 1, "새로 들어온 건수를 세지 못했다");

  const file = await readSlotFile("sale", "11350", "202608", root);
  assert.equal(file.observedAt, later);
  assert.equal(file.previousObservedAt, AT);
});

test("관측 시각만 달라진 응답은 다시 쓰지 않는다", async () => {
  const root = await dir();
  await writeSlotFile(slot([item()]), root);
  const result = await writeSlotFile(slot([item()], { observedAt: "2026-08-18T23:07:00.000Z" }), root);

  assert.equal(result.changed, false);
  assert.equal((await readSlotFile("sale", "11350", "202608", root)).observedAt, AT);
});

test("거래가 없는 달도 성공으로 남긴다", async () => {
  const root = await dir();
  await writeSlotFile(slot([]), root);

  const slots = await readSlots(root);
  assert.deepEqual(slots["sale:11350:202608"], { ok: true, count: 0, totalCount: 0 });
});

test("저장된 슬롯 요약을 모은다", async () => {
  const root = await dir();
  await writeSlotFile(slot([item()]), root);
  await writeSlotFile(
    buildSlotFile({ kind: "rent", code: "11110", yearMonth: "202607", items: [], ok: false, observedAt: AT }),
    root
  );

  const slots = await readSlots(root);
  assert.deepEqual(Object.keys(slots).sort(), ["rent:11110:202607", "sale:11350:202608"]);
  assert.equal(slots["rent:11110:202607"].ok, false);
});

test("깨진 파일은 실패로 잡는다", async () => {
  const root = await dir();
  await mkdir(path.join(root, "sale"), { recursive: true });
  await writeFile(path.join(root, "sale/11110-202605.json"), "{ 망가짐");

  assert.deepEqual((await readSlots(root))["sale:11110:202605"], { ok: false });
});

test("저장소가 비어 있어도 읽힌다", async () => {
  assert.deepEqual(await readSlots(await dir()), {});
});

test("만료된 슬롯을 지운다", async () => {
  const root = await dir();
  await writeSlotFile(slot([item()]), root);
  await removeSlotFile("sale", "11350", "202608", root);

  assert.deepEqual(await readSlots(root), {});
  await removeSlotFile("sale", "11350", "202608", root);
});
