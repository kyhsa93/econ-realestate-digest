import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/build-floor-gap.mjs";
import { cellRatio, districtRows, noiseBand, tally, toCells, topRatio } from "../scripts/floor-gap.mjs";
import { floorDistrictsHtml } from "../scripts/prerender.mjs";
import { loadFloorPage } from "./helpers/floor-page.mjs";

const NOW = new Date("2026-08-29T00:00:00Z");

const deal = (floor, price, extra = {}) => ({
  sggCd: 11350,
  aptNm: "상계주공",
  excluUseAr: 84.9,
  floor,
  price,
  ...extra,
});

const rows = (...specs) => specs.map(([floor, price]) => deal(floor, price));

// 칸 하나의 비율은 반올림하지 않는다. 칸마다 반올림한 뒤 중앙값을 내면 자릿수를 잃는다.
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} ≠ ${expected}`.trim());

test("같은 칸 안에서 1층과 3층 이상을 견준다", () => {
  const cell = cellRatio(rows([1, 90000], [3, 100000], [5, 100000], [9, 100000]), {
    pick: (r) => r.floor <= 1,
    against: (r) => r.floor >= 3,
  });
  near(cell.ratio, -10);
  assert.equal(cell.deals, 1);
});

test("2층은 대조군에 넣지 않는다", () => {
  // 2층도 저층으로 값이 깎이는 자리다. 대조군에 넣으면 1층 할인이 실제보다 작아 보인다.
  const withTwo = rows([1, 90000], [2, 92000], [3, 100000], [5, 100000], [9, 100000]);
  const cell = cellRatio(withTwo, { pick: (r) => r.floor <= 1, against: (r) => r.floor >= 3 });
  near(cell.ratio, -10, "2층이 대조군에 섞였다");
});

test("대조군이 셋 미만이면 견주지 않는다", () => {
  // 둘로 낸 중앙값은 그냥 두 값의 평균이라 중앙값이라고 부를 것이 못 된다.
  assert.equal(
    cellRatio(rows([1, 90000], [3, 100000], [5, 100000]), {
      pick: (r) => r.floor <= 1,
      against: (r) => r.floor >= 3,
    }),
    null
  );
});

test("터무니없이 벌어진 칸은 버린다", () => {
  // 같은 이름의 다른 단지가 섞였거나 신고가 잘못 들어온 경우다.
  assert.equal(
    cellRatio(rows([1, 10000], [3, 100000], [5, 100000], [9, 100000]), {
      pick: (r) => r.floor <= 1,
      against: (r) => r.floor >= 3,
    }),
    null
  );
});

test("최상층은 그 칸에서 관측된 가장 높은 층이다", () => {
  const cell = topRatio(rows([15, 110000], [3, 100000], [5, 100000], [9, 100000]));
  near(cell.ratio, 10);
});

test("다섯 층을 안 넘으면 최상층을 말하지 않는다", () => {
  // 건물 높이는 실거래 자료에 없다. 4층짜리의 '최상층'은 뜻이 없다.
  assert.equal(topRatio(rows([4, 110000], [3, 100000], [3, 100000], [3, 100000])), null);
});

test("우연히 나올 수 있는 폭은 같은 입력이면 같은 답이다", () => {
  // 씨앗을 고정하지 않으면 값이 하나도 안 변한 날에도 빌드가 다른 문장을 만든다.
  const pool = Array.from({ length: 200 }, (_, i) => -12 + (i % 11));
  assert.deepEqual(noiseBand(pool, 20), noiseBand(pool, 20));
});

test("칸이 모자란 구는 값을 내되 서울과 다르다고 말하지 않는다", () => {
  const byDistrict = new Map([
    ["노원구", Array.from({ length: 40 }, () => -20)],
    ["광진구", [-20, -20, -20]],
  ]);
  const pool = Array.from({ length: 200 }, (_, i) => -8 + (i % 5));
  const [gwangjin, nowon] = districtRows(byDistrict, pool).sort((a, b) =>
    a.district.localeCompare(b.district, "ko")
  );

  assert.equal(nowon.distinct, true, "칸이 넉넉하고 한참 벗어났는데 말하지 못했다");
  assert.equal(gwangjin.band, null, "칸이 모자란데 구간을 만들었다");
  assert.equal(gwangjin.distinct, false, "칸 셋으로 서울과 다르다고 말했다");
  assert.equal(gwangjin.median, -20, "말은 못 해도 값은 남긴다");
});

// --- 화면 -------------------------------------------------------------------

/** 문턱을 넘는 구와 못 넘는 구를 같이 만든다. */
const district = (name, cells, gap) =>
  Array.from({ length: cells }, (_, i) => [
    deal(1, 100000 * (1 + gap / 100), { aptNm: `${name}${i}` }),
    deal(3, 100000, { aptNm: `${name}${i}` }),
    deal(5, 100000, { aptNm: `${name}${i}` }),
    deal(9, 100000, { aptNm: `${name}${i}` }),
  ]).flat();

const PAYLOAD = buildPayload({
  sale: { 노원구: district("노원", 40, -12), 광진구: district("광진", 4, -3) },
  jeonse: { 노원구: district("노원전세", 30, -5) },
  now: NOW,
});

test("첫 문단이 매매와 전세를 같이 말한다", async () => {
  const page = await loadFloorPage({ floor: PAYLOAD });
  assert.equal(page.leadText(), PAYLOAD.lead.ko);
  assert.match(page.leadText(), /1층은 3층 이상보다/);
  assert.match(page.leadText(), /전세는 같은 1층을/);
});

test("갈라 볼 수 없는 구도 표에서 빼지 않는다", async () => {
  // 목록에서 빼면 "우리가 못 가른 것"과 "자료가 없는 것"이 구별되지 않는다.
  const page = await loadFloorPage({ floor: PAYLOAD });
  const table = page.districtTable();
  assert.match(table, /광진구/, "말할 수 없는 구가 표에서 사라졌다");
  assert.match(table, /칸이 모자람|갈라 볼 수 없음/);
});

test("빌드가 그린 표와 화면이 그린 표가 같다", async () => {
  const page = await loadFloorPage({ floor: PAYLOAD });
  assert.equal(page.districtTable(), floorDistrictsHtml(PAYLOAD));
});

test("영어 화면에 우리가 쓴 한국어가 남지 않는다", async () => {
  // 자치구 이름은 영어 화면에서도 한글 그대로 둔다 - 이 사이트 전체의 관례다.
  const page = await loadFloorPage({ floor: PAYLOAD });
  page.toggleLang();

  const table = page.districtTable().replace(/<td>[가-힣]+구<\/td>/g, "<td></td>");
  assert.doesNotMatch(table, /[가-힣]/, "영어 표에 한국어가 남았다");
  assert.doesNotMatch(page.districtNote(), /[가-힣]/, "영어 설명에 한국어가 남았다");
});

test("자료가 없으면 없다고 말한다", async () => {
  const page = await loadFloorPage({});
  assert.match(page.leadText(), /아직 층 격차 자료가 없습니다/);
});
