import test from "node:test";
import assert from "node:assert/strict";
import {
  GAP_EXPLAIN,
  MIN_CELLS,
  MIN_CELLS_MEDIAN,
  MIN_DEALS_PER_SIDE,
  cellRatios,
  spreadOf,
  spreadSentence,
} from "../scripts/complex-ratio.mjs";
import { buildPayload } from "../scripts/build-complex-ratio.mjs";

const NOW = new Date("2026-08-29T00:00:00Z");
const sale = (amount, extra = {}) => ({ aptNm: "가상아파트", excluUseAr: 59.94, dealAmount: amount, ...extra });
const rent = (deposit, extra = {}) => ({ aptNm: "가상아파트", excluUseAr: 59.94, deposit, monthlyRent: 0, contractType: "신규", ...extra });
const many = (n, make) => Array.from({ length: n }, () => make());

test("같은 단지 같은 평형에서 각각 중앙값을 내어 나눈다", () => {
  const ratios = cellRatios(many(3, () => sale("100,000")), many(3, () => rent("60,000")));
  assert.deepEqual(ratios, [60]);
});

test("한쪽이 세 건에 못 미치면 그 칸은 세지 않는다", () => {
  assert.equal(MIN_DEALS_PER_SIDE, 3);
  assert.deepEqual(cellRatios(many(2, () => sale("100,000")), many(3, () => rent("60,000"))), []);
  assert.deepEqual(cellRatios(many(3, () => sale("100,000")), many(2, () => rent("60,000"))), []);
});

test("평형이 다르면 같은 단지라도 다른 칸이다", () => {
  const ratios = cellRatios(
    many(3, () => sale("100,000")),
    many(3, () => rent("60,000", { excluUseAr: 84.97 }))
  );
  assert.deepEqual(ratios, [], "59㎡ 매매를 84㎡ 전세와 나눴다");
});

test("해제된 매매와 갱신 전세는 시세가 아니다", () => {
  const cancelled = [...many(3, () => sale("100,000", { cdealType: "해제" })), ...many(3, () => sale("100,000"))];
  // 해제 셋을 빼면 살아 있는 매매가 셋이라 칸은 그대로 선다
  assert.deepEqual(cellRatios(cancelled, many(3, () => rent("60,000"))), [60]);

  const renewals = many(3, () => rent("40,000", { contractType: "갱신" }));
  assert.deepEqual(cellRatios(many(3, () => sale("100,000")), renewals), [], "갱신 보증금으로 전세가율을 냈다");
});

test("반전세는 순수 전세와 섞지 않는다", () => {
  const halfRent = many(3, () => rent("30,000", { monthlyRent: 60 }));
  assert.deepEqual(cellRatios(many(3, () => sale("100,000")), halfRent), []);
});

test("견줄 값이 잘못 붙은 칸은 버린다", () => {
  // 같은 자치구에 같은 이름을 쓰는 다른 단지가 있으면 이런 값이 나온다.
  assert.deepEqual(cellRatios(many(3, () => sale("100,000")), many(3, () => rent("1,000"))), []);
  assert.deepEqual(cellRatios(many(3, () => sale("10,000")), many(3, () => rent("60,000"))), []);
});

test("칸 수에 따라 말하는 것이 달라진다", () => {
  assert.ok(MIN_CELLS_MEDIAN < MIN_CELLS, "중앙값 문턱이 분위 문턱보다 낮아야 한다");
  const ratios = (n) => Array.from({ length: n }, (_, i) => 40 + i);

  assert.equal(spreadOf(ratios(MIN_CELLS_MEDIAN - 1)), null, "열 칸도 안 되는데 말을 했다");

  const thin = spreadOf(ratios(MIN_CELLS - 1));
  assert.equal(typeof thin.median, "number");
  assert.equal(thin.q1, undefined, "칸이 모자란데 사분위를 냈다");

  const full = spreadOf(ratios(MIN_CELLS));
  assert.equal(typeof full.q1, "number");
  assert.equal(typeof full.q3, "number");
});

test("자치구 값과 크게 어긋날 때만 왜 어긋나는지까지 적는다", () => {
  const spread = { cells: 100, median: 50, q1: 45, q3: 55 };

  const close = spreadSentence(spread, 50 + GAP_EXPLAIN - 1);
  assert.ok(!close.includes("서로 달라"), "가까운데 굳이 설명을 붙였다");
  assert.match(close, /45~55%/);

  const far = spreadSentence(spread, 50 + GAP_EXPLAIN + 1);
  assert.match(far, /매매가 신고된 단지와 전세가 신고된 단지가 서로 달라/);
});

test("칸이 모자란 구는 범위 없이 중앙값만 말한다", () => {
  const line = spreadSentence({ cells: 18, median: 55.6 }, 83.7);
  assert.match(line, /18칸/);
  assert.match(line, /중앙값이 55\.6%/);
  assert.ok(!/절반이/.test(line), "사분위가 없는데 범위를 말했다");
  // 28%p나 어긋나는 구다 - 이유를 적지 않으면 그냥 모순되는 값 둘이다
  assert.match(line, /서로 달라/);
});

test("말할 것이 없으면 문장을 만들지 않는다", () => {
  assert.equal(spreadSentence(null, 50), null);
});

test("빌드 결과에는 칸이 찬 자치구만 들어간다", () => {
  const payload = buildPayload({
    now: NOW,
    byDistrict: {
      넉넉구: { sales: many(3, () => sale("100,000")), rents: many(3, () => rent("60,000")) },
      빈구: { sales: [], rents: [] },
    },
  });
  // 한 칸짜리 구는 문턱에 걸려 빠지고, 서울 집계에는 그 칸도 들어간다
  assert.equal(payload.districts.넉넉구, undefined);
  assert.equal(payload.seoul, null, "칸 하나로 서울 분포를 냈다");
  assert.ok(payload.updatedAt);
});

test("거래가 하나도 없으면 파일을 만들지 않는다", () => {
  assert.equal(buildPayload({ now: NOW, byDistrict: { 빈구: { sales: [], rents: [] } } }), null);
});
