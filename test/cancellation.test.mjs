import test from "node:test";
import assert from "node:assert/strict";
import {
  cancellationTiming,
  dayGap,
  dealDate,
  districtStats,
  isCancelled,
  isRegistered,
  leadSentence,
  parseShortDate,
  priceStanding,
  registrationByMonth,
  registrationStats,
} from "../scripts/cancellation.mjs";
import { buildPayload } from "../scripts/build-cancellation.mjs";

const NOW = new Date("2026-08-26T00:00:00Z");

const sale = (extra = {}) => ({
  sggCd: 11350,
  aptNm: "극동아파트",
  jibun: "123",
  excluUseAr: 84.9,
  dealAmount: "100,000",
  dealYear: 2026,
  dealMonth: 3,
  dealDay: 10,
  rgstDate: "26.05.15",
  cdealType: "",
  cdealDay: "",
  ...extra,
});

const cancelled = (extra = {}) => sale({ cdealType: "O", cdealDay: "26.04.08", rgstDate: "", ...extra });
const unregistered = (extra = {}) => sale({ rgstDate: "", ...extra });

test("국토부의 두 자리 연도 날짜를 읽는다", () => {
  assert.equal(parseShortDate("26.08.18").toISOString().slice(0, 10), "2026-08-18");
  assert.equal(parseShortDate(""), null);
  assert.equal(parseShortDate("2026-08-18"), null);
  assert.equal(parseShortDate("26.13.99"), null);
});

test("해제는 유형이나 해제일 중 하나만 있어도 해제다", () => {
  assert.equal(isCancelled(sale({ cdealType: "O" })), true);
  assert.equal(isCancelled(sale({ cdealDay: "26.04.08" })), true);
  assert.equal(isCancelled(sale()), false);
  assert.equal(isRegistered(sale()), true);
  assert.equal(isRegistered(unregistered()), false);
});

test("계약일에서 해제일까지 걸린 날을 센다", () => {
  assert.equal(dayGap(dealDate(sale()), parseShortDate("26.04.08")), 29);
  assert.equal(dayGap(null, parseShortDate("26.04.08")), null);
});

test("해제가 신고 기한 안에 일어났는지 센다", () => {
  const timing = cancellationTiming([
    cancelled({ cdealDay: "26.03.20" }),
    cancelled({ cdealDay: "26.04.08" }),
    cancelled({ cdealDay: "26.07.20" }),
    sale(),
  ]);

  assert.equal(timing.counted, 3);
  assert.equal(timing.medianDays, 29);
  assert.equal(timing.withinFilingWindow, 66.7);
  assert.equal(timing.overQuarter, 33.3);
});

test("해제 거래가 같은 단지에서 비쌌는지를 세어 본 대로 낸다", () => {
  const standing = priceStanding([
    sale({ dealAmount: "100,000" }),
    sale({ dealAmount: "100,000", dealDay: 11 }),
    cancelled({ dealAmount: "120,000" }),
    cancelled({ dealAmount: "80,000", dealDay: 12 }),
    cancelled({ dealAmount: "100,000", dealDay: 13 }),
  ]);

  assert.equal(standing.compared, 3);
  assert.equal(standing.higher, 1);
  assert.equal(standing.similar, 1);
  assert.equal(standing.lower, 1);
  assert.equal(standing.medianRatio, 1);
});

test("같은 단지에 남은 거래가 없으면 견줄 수 없어 세지 않는다", () => {
  assert.equal(priceStanding([cancelled(), cancelled({ dealDay: 12 })]), null);
});

test("면적이 다르면 같은 단지라도 따로 견준다", () => {
  const standing = priceStanding([
    sale({ dealAmount: "100,000", excluUseAr: 84.9 }),
    cancelled({ dealAmount: "60,000", excluUseAr: 59.9 }),
  ]);
  assert.equal(standing, null);
});

test("아직 안 익은 계약월은 미등기 통계에서 통째로 뺀다", () => {
  // 3월은 열에 여덟이 등기를 마쳤고, 8월은 하나도 못 마쳤다. 8월 계약이 등기 전인
  // 것은 시간이 모자라서지 늦어서가 아니므로 세면 안 된다.
  const march = [
    ...Array.from({ length: 8 }, (_, i) => sale({ dealMonth: 3, dealDay: i + 1 })),
    ...Array.from({ length: 2 }, (_, i) => unregistered({ dealMonth: 3, dealDay: i + 20 })),
  ];
  const august = Array.from({ length: 10 }, (_, i) => unregistered({ dealMonth: 8, dealDay: i + 1 }));

  const stats = registrationStats([...march, ...august]);

  assert.deepEqual(stats.matureMonths, ["2026-03"]);
  assert.equal(stats.matured, 10);
  assert.equal(stats.stale, 2);
  assert.equal(stats.staleShare, 20);
});

test("등기까지 걸린 날의 중앙값은 등기가 끝난 거래에서만 낸다", () => {
  const stats = registrationStats([
    sale({ dealMonth: 3, dealDay: 1, rgstDate: "26.03.31" }),
    sale({ dealMonth: 3, dealDay: 1, rgstDate: "26.05.30" }),
    ...Array.from({ length: 8 }, (_, i) => sale({ dealMonth: 3, dealDay: i + 2, rgstDate: "26.05.01" })),
  ]);

  assert.equal(stats.registered, 10);
  assert.ok(stats.medianDays > 0);
});

test("해제된 거래는 등기 통계에 들어가지 않는다", () => {
  const stats = registrationStats([
    ...Array.from({ length: 8 }, (_, i) => sale({ dealDay: i + 1 })),
    ...Array.from({ length: 2 }, (_, i) => unregistered({ dealDay: i + 20 })),
    ...Array.from({ length: 50 }, (_, i) => cancelled({ dealDay: (i % 28) + 1 })),
  ]);

  assert.equal(stats.matured, 10);
  assert.equal(stats.stale, 2);
});

test("계약월별 등기율은 시간이 지날수록 오르는 곡선으로 나온다", () => {
  const rows = registrationByMonth([
    sale({ dealMonth: 3 }),
    sale({ dealMonth: 3, dealDay: 11 }),
    unregistered({ dealMonth: 8 }),
    sale({ dealMonth: 8, dealDay: 11 }),
  ]);

  assert.deepEqual(
    rows.map((r) => [r.month, r.share]),
    [["2026-03", 100], ["2026-08", 50]]
  );
});

test("자치구별 미등기율은 서울이 정한 익은 달로만 잰다", () => {
  const mature = ["2026-03"];
  const rows = districtStats(
    {
      노원구: [
        ...Array.from({ length: 100 }, (_, i) => sale({ dealMonth: 3, dealDay: (i % 28) + 1 })),
        ...Array.from({ length: 100 }, (_, i) => unregistered({ dealMonth: 8, dealDay: (i % 28) + 1 })),
      ],
    },
    mature
  );

  // 8월의 미등기 100건은 아직 안 익은 달이라 세지 않는다.
  assert.equal(rows[0].matured, 100);
  assert.equal(rows[0].stale, 0);
  assert.equal(rows[0].staleShare, 0);
  assert.equal(rows[0].deals, 200);
});

test("표본이 얇은 구는 비율을 말하지 않는다", () => {
  const rows = districtStats({ 중구: [sale(), cancelled({ dealDay: 12 })] }, ["2026-03"]);

  assert.equal(rows[0].deals, 2);
  assert.equal(rows[0].cancelledShare, null);
  assert.equal(rows[0].staleShare, null);
});

test("첫 문단은 세어 본 결과대로 말한다 - 흔한 이야기와 어긋나더라도", () => {
  const low = leadSentence(
    {
      deals: 1000,
      cancelled: 25,
      timing: { medianDays: 29, withinFilingWindow: 51.3 },
      standing: { higherShare: 21, lowerShare: 29.9, medianRatio: 1 },
      months: ["202603", "202608"],
    },
    "ko"
  );
  assert.match(low, /흔히 말하는 것과 달리/);
  assert.match(low, /2\.5%/);

  const high = leadSentence(
    {
      deals: 1000,
      cancelled: 25,
      timing: { medianDays: 29, withinFilingWindow: 51.3 },
      standing: { higherShare: 60, lowerShare: 10, medianRatio: 1.1 },
      months: ["202603"],
    },
    "ko"
  );
  assert.match(high, /실제로 비싼 축이다/);
});

test("해제가 없으면 문장을 만들지 않는다", () => {
  assert.equal(leadSentence({ deals: 1000, cancelled: 0 }, "ko"), null);
});

test("빌드 결과에 서울 요약과 자치구 표와 월별 곡선이 함께 들어간다", () => {
  const byDistrict = {
    노원구: [
      ...Array.from({ length: 100 }, (_, i) => sale({ dealMonth: 3, dealDay: (i % 28) + 1 })),
      ...Array.from({ length: 20 }, (_, i) => unregistered({ dealMonth: 3, dealDay: (i % 28) + 1, dealAmount: "90,000" })),
      cancelled({ dealAmount: "120,000" }),
    ],
  };

  const payload = buildPayload({ byDistrict, months: ["202603"], now: NOW });

  assert.equal(payload.seoul.deals, 121);
  assert.equal(payload.seoul.cancelled, 1);
  assert.ok(payload.seoul.leadKo.includes("해제"));
  assert.equal(payload.districts.length, 1);
  assert.equal(payload.registrationByMonth[0].month, "2026-03");
  assert.equal(payload.slugs["노원구"], "nowon");
});

test("거래가 하나도 없으면 화면을 만들지 않는다", () => {
  assert.equal(buildPayload({ byDistrict: {}, months: ["202603"], now: NOW }), null);
});

test("자치구는 늘 같은 순서로 담긴다", async () => {
  // 완료되는 대로 담으면 그날 디스크가 어느 파일을 먼저 내주었는지가 출력 순서가 되고,
  // 자치구 링크 줄이 빌드할 때마다 뒤바뀌어 뜻 없는 변경이 매일 커밋된다.
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const nodePath = await import("node:path");
  const { readRawSales } = await import("../scripts/build-cancellation.mjs");
  const { DISTRICTS } = await import("../scripts/realestate-districts.mjs");

  const dir = await mkdtemp(nodePath.join(tmpdir(), "raw-order-"));
  await mkdir(nodePath.join(dir, "sale"), { recursive: true });

  // 일부러 DISTRICTS의 역순으로 써 둔다.
  for (const { code } of [...DISTRICTS].reverse()) {
    await writeFile(
      nodePath.join(dir, "sale", `${code}-202603.json`),
      JSON.stringify({ ok: true, items: [sale({ sggCd: Number(code) })] })
    );
  }

  const byDistrict = await readRawSales(["202603"], dir);
  assert.deepEqual(Object.keys(byDistrict), DISTRICTS.map((d) => d.name));
});
