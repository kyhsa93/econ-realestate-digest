import test from "node:test";
import assert from "node:assert/strict";
import { kospiFrom, shortYmd, usdKrwWithChange } from "../scripts/fetch-market.mjs";
import { loadIndexPage } from "./helpers/index-page.mjs";

const close = (time, value) => ({ TIME: time, DATA_VALUE: String(value) });

test("등락은 같은 계열의 종가 둘에서 뺀다", async () => {
  // 이슈 #1: 값은 이쪽에서, 등락은 저쪽에서 받아 오면 둘이 서로를 설명하지 못한다.
  // 저장된 값끼리 빼면 45.87이 움직인 날 등락에 0.00이 적혀 있었다.
  const kospi = kospiFrom([close("20260827", 6912.37), close("20260828", 6788.88)]);

  assert.equal(kospi.value, "6,788.88");
  assert.equal(kospi.change, "-123.49");
  assert.equal(kospi.direction, "FALLING");
  // 등락이 그 계열에서 나온 값인지를 못 박는다. 부동소수점 끝자리는 상관없다.
  const derived = Number(kospi.change.replace(/,/g, ""));
  assert.ok(Math.abs(derived - (6788.88 - 6912.37)) < 0.005, `등락 ${derived}가 종가 차이와 다르다`);
});

test("앞 종가가 없으면 등락을 0.00이 아니라 비운다", async () => {
  // 0.00은 "안 움직였다"는 뜻이다. "모른다"의 자리에 놓으면 그게 바로 이 오류였다.
  const kospi = kospiFrom([close("20260828", 6788.88)]);

  assert.equal(kospi.value, "6,788.88");
  assert.equal(kospi.change, null);
  assert.equal(kospi.direction, null);
});

test("주말과 연휴를 건너뛴 두 종가로도 잰다", async () => {
  // 8월 15~17일이 비어도 14일 종가와 18일 종가로 재야 한다.
  const kospi = kospiFrom([close("20260814", 6977.94), close("20260818", 6869.83)]);
  assert.equal(kospi.change, "-108.11");
  assert.equal(kospi.asOf, "8/18");
});

test("어느 장의 종가인지 남긴다", async () => {
  // 하루 늦은 값이라 날짜를 안 적으면 "오늘 코스피"로 읽힌다.
  assert.equal(shortYmd("20260828"), "8/28");
  assert.equal(shortYmd("2026-08-28"), null);
  assert.equal(shortYmd(""), null);
});

test("환율은 전일 수집분과 견준다", async () => {
  // 이슈 #2: 매일 값을 쌓아 두고도 증감 칸이 늘 비어 있었다.
  const history = [
    { date: "2026-08-27", usdKrw: { value: 1390.0 } },
    { date: "2026-08-28", usdKrw: { value: 1381.567326 } },
  ];
  const fx = usdKrwWithChange({ value: 1377.942221, date: "2026-08-29" }, history);

  assert.equal(fx.change, "-3.63");
  assert.equal(fx.direction, "FALLING");
  assert.equal(fx.prevValue, 1381.567326);
});

test("같은 날 기록과는 견주지 않는다", async () => {
  // 하루에 여러 번 도는 날 자기 자신과 빼면 늘 0.00이 된다 - 이슈 #1이 났던 방식이다.
  const history = [
    { date: "2026-08-28", usdKrw: { value: 1381.5 } },
    { date: "2026-08-29", usdKrw: { value: 1377.9 } },
  ];
  const fx = usdKrwWithChange({ value: 1377.942221, date: "2026-08-29" }, history);
  assert.equal(fx.prevValue, 1381.5);
});

test("견줄 기록이 없으면 지어내지 않는다", async () => {
  const fx = usdKrwWithChange({ value: 1377.9, date: "2026-08-29" }, []);
  assert.equal(fx.change, null);
  assert.equal(fx.direction, null);
});

test("화면이 종가 날짜와 환율 증감을 함께 적는다", async () => {
  const page = await loadIndexPage({ fetch: async () => ({ ok: false, json: async () => ({}) }) });
  page.app.renderMarket({
    kospi: { value: "6,788.88", change: "-123.49", direction: "FALLING", asOf: "8/28" },
    usdKrw: { value: 1377.94, prevValue: 1381.57, change: "-3.63", direction: "FALLING" },
    baseRate: { value: "3.00", effectiveFrom: "2026년 08월 27일" },
  });

  const html = page.byId("market-grid").innerHTML;
  assert.match(html, /8\/28 종가/, "어느 장의 종가인지 안 적었다");
  assert.match(html, /-3\.63/, "환율 증감 칸이 비어 있다");
  assert.match(html, /전일 수집분 대비/, "환율 증감의 기준을 안 적었다");
});
