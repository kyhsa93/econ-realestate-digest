import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_RATE,
  SAMPLE_KEY,
  SAMPLE_MAX_ROWS,
  changedOn,
  clampRows,
  ecosKey,
  searchUrl,
  statisticSearch,
} from "../scripts/ecos.mjs";
import { baseRateFrom, rateLabel, ymdLabel } from "../scripts/fetch-market.mjs";

const day = (time, value) => ({ TIME: time, DATA_VALUE: value });
const reply = (body, ok = true) => async () => ({ ok, json: async () => body });

test("키가 없으면 공개 sample 키로 돈다", () => {
  assert.equal(ecosKey({}), SAMPLE_KEY);
  assert.equal(ecosKey({ ECOS_API_KEY: "  " }), SAMPLE_KEY, "공백만 있는 키를 키로 봤다");
  assert.equal(ecosKey({ ECOS_API_KEY: " abc " }), "abc");
});

test("sample 키는 열 건을 넘겨 부르면 조회 자체가 오류다", () => {
  // 부르고 나서 자르는 게 아니라 부르기 전에 자른다.
  assert.equal(clampRows(SAMPLE_KEY, 401), SAMPLE_MAX_ROWS);
  assert.equal(clampRows(SAMPLE_KEY, 5), 5);
  assert.equal(clampRows("real-key", 401), 401);
});

test("조회 주소는 ECOS가 정한 자리 순서를 지킨다", () => {
  const url = searchUrl({ key: "k", ...BASE_RATE, from: "20260820", to: "20260829", rows: 10 });
  assert.equal(
    url,
    "https://ecos.bok.or.kr/api/StatisticSearch/k/json/kr/1/10/722Y001/D/20260820/20260829/0101000"
  );
});

test("결과 없음과 잘못 물어봄을 가른다", async () => {
  // 둘 다 200으로 오고 RESULT에 코드만 다르게 담긴다. 뭉뚱그리면 코드를 잘못
  // 적어 놓고도 "오늘은 데이터가 없는 날"로 넘어가게 된다.
  const empty = await statisticSearch({}, { fetchImpl: reply({ RESULT: { CODE: "INFO-200", MESSAGE: "없음" } }) });
  assert.deepEqual(empty, []);

  await assert.rejects(
    () => statisticSearch({}, { fetchImpl: reply({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키가 유효하지 않습니다" } }) }),
    /INFO-100/
  );
});

test("응답이 이상하면 조용히 넘기지 않는다", async () => {
  await assert.rejects(() => statisticSearch({}, { fetchImpl: reply({}, false) }), /ecos http/);
  await assert.rejects(() => statisticSearch({}, { fetchImpl: reply({ StatisticSearch: {} }) }), /형식 이상/);
});

test("값이 마지막으로 바뀐 날을 창 안에서 찾는다", () => {
  assert.equal(
    changedOn([day("20260825", "2.75"), day("20260826", "2.75"), day("20260827", "3")]),
    "20260827"
  );
  // 창이 통째로 같은 값이면 바뀐 것은 그 전이다 - 모른다고 해야 한다.
  assert.equal(changedOn([day("20260825", "3"), day("20260826", "3")]), null);
  assert.equal(changedOn([day("20260827", "3")]), null);
  assert.equal(changedOn([]), null);
});

test("ECOS 표기를 화면 표기로 옮긴다", () => {
  assert.equal(ymdLabel("20260827"), "2026년 08월 27일");
  assert.equal(ymdLabel("2026-08-27"), null);
  assert.equal(rateLabel("3"), "3.00", "ECOS는 3.00을 3으로 준다");
  assert.equal(rateLabel("2.75"), "2.75");
  assert.equal(rateLabel(""), null);
  assert.equal(rateLabel(null), null);
  assert.equal(rateLabel("-"), null, "ECOS가 결측을 '-'로 주는 자리가 있다");
});

test("값이 비어 온 날 기준금리가 0.00%로 둔갑하지 않는다", async () => {
  // Number("")는 0이다. 숫자로 바꿔 보고 판단하면 이 사고가 조용히 난다.
  await assert.rejects(() => baseRateFrom([day("20260827", "")], null), /형식 이상/);
  await assert.rejects(() => baseRateFrom([day("20260827", "-")], null), /형식 이상/);
});

test("창 안에서 바뀌었으면 그 날을 시행일로 쓴다", async () => {
  const got = await baseRateFrom(
    [day("20260826", "2.75"), day("20260827", "3")],
    { value: "2.75", effectiveFrom: "2026년 07월 10일" },
    { bok: async () => assert.fail("스크래핑을 부를 이유가 없다") }
  );
  assert.deepEqual(got, { value: "3.00", effectiveFrom: "2026년 08월 27일" });
});

test("값이 그대로면 지난번 시행일을 그대로 쓴다", async () => {
  const got = await baseRateFrom(
    [day("20260826", "3"), day("20260827", "3")],
    { value: "3.00", effectiveFrom: "2026년 08월 27일" },
    { bok: async () => assert.fail("적어 둔 시행일이 있는데 스크래핑을 불렀다") }
  );
  assert.deepEqual(got, { value: "3.00", effectiveFrom: "2026년 08월 27일" });
});

test("적어 둔 것이 없으면 그때만 포털을 긁는다", async () => {
  // 첫 실행에서 금리가 열흘보다 오래전에 바뀐 경우다.
  const got = await baseRateFrom([day("20260826", "3"), day("20260827", "3")], null, {
    bok: async () => ({ value: "3.00", effectiveFrom: "2026년 08월 27일" }),
  });
  assert.equal(got.effectiveFrom, "2026년 08월 27일");
});

test("포털까지 막히면 시행일 없이 값만 낸다", async () => {
  const got = await baseRateFrom([day("20260827", "3")], null, {
    bok: async () => {
      throw new Error("표 형식 이상");
    },
  });
  assert.deepEqual(got, { value: "3.00", effectiveFrom: null });
  // 화면은 시행일이 없으면 그 칸을 비운다 - "null 부터"라고 적지 않는다.
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  assert.match(html, /market\.baseRate\.effectiveFrom \? t\("baseRateSince"\)/);
});

test("응답이 비면 어제 값을 그대로 쓰지 않고 실패로 넘긴다", async () => {
  await assert.rejects(() => baseRateFrom([], null), /응답 없음/);
});
