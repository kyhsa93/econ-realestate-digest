import test from "node:test";
import assert from "node:assert/strict";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

const REALESTATE = {
  updatedAt: "2026-08-21T00:00:00.000Z",
  period: "202608",
  overall: {
    sale: { avgPricePerPyeong10k: 5112, transactionCount: 993 },
    jeonse: { avgDepositPerPyeong10k: 2928, transactionCount: 685 },
    wolse: { avgDeposit10k: 19063, avgMonthlyRent10k: 117, transactionCount: 1071 },
  },
  districts: [
    {
      code: "11350",
      name: "노원구",
      sale: { avgPricePerPyeong10k: 3798, transactionCount: 155 },
      jeonse: { avgDepositPerPyeong10k: 1958, transactionCount: 39 },
      wolse: { avgDeposit10k: 10434, avgMonthlyRent10k: 85, transactionCount: 81 },
    },
  ],
};

const WEEKS = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"];

// 계열마다 모양을 다르게 준다. 셋 다 같은 방향으로 움직이면 마지막 주가 어느
// 그래프에서나 끝점이라 세로 위치까지 같아지고, 그러면 그래프가 정말 제 값에 찍혔는지
// 구분되지 않는다. 마지막 주에서 보증금은 최고, 월세는 최저, 거래량은 중간이다.
const DEPOSIT = [22000, 22100, 22200, 22300, 22400, 22500];
const RENT = [126, 120, 114, 108, 102, 96];
const COUNT = [600, 640, 700, 660, 720, 680];

const week = (i, extra = {}) => ({
  sale: { avgPricePerPyeong10k: 4400 + i * 10, transactionCount: 300 + i },
  jeonse: { avgDepositPerPyeong10k: 3000 + i * 10, transactionCount: 400 + i },
  wolse: { avgDeposit10k: DEPOSIT[i], avgMonthlyRent10k: RENT[i], transactionCount: COUNT[i] },
  ...extra,
});

const TREND = {
  updatedAt: "2026-08-21T00:00:00.000Z",
  weeks: WEEKS,
  pendingWeeks: [],
  overall: Object.fromEntries(WEEKS.map((w, i) => [w, week(i)])),
  districts: {},
};

const wolse = (trend = TREND) =>
  loadRealestatePage({ realestate: REALESTATE, trend, kind: "wolse" });

const SHOWN = ["trend", "rent", "volume"];

test("한 그래프를 짚으면 같은 축을 쓰는 그래프가 모두 그 주에 찍힌다", async () => {
  const page = await wolse();
  page.pointAt("volume", 1); // 거래량 그래프의 오른쪽 끝 = 마지막 주

  for (const prefix of SHOWN) {
    assert.notEqual(page.marker(prefix), null, `${prefix} 마커가 안 찍혔습니다`);
  }
  assert.match(page.tipHtml(), /2026-08-10/, "마지막 주를 짚었는데 다른 주가 적혔습니다");

  // 높이는 각자 제 값이라 달라야 한다. 이 픽스처에서 마지막 주는 보증금이 최고,
  // 월세가 최저, 거래량이 중간이다.
  const ys = SHOWN.map((p) => page.marker(p).y);
  assert.equal(new Set(ys).size, 3, `세 그래프가 같은 높이에 찍혔습니다: ${ys.join(", ")}`);
});

test("다른 주를 짚으면 세 그래프가 함께 옮겨 간다", async () => {
  // 가로 좌표를 서로 견주지는 않는다. 그래프마다 y축 눈금 글자 폭이 달라 — "22,013만원"과
  // "617건"은 자릿수가 다르다 — 왼쪽 여백이 다르고, 그래서 같은 주라도 픽셀 위치는
  // 몇 px 어긋난다. 각자의 좌표계 안에서 함께 움직이는지가 확인할 것이다.
  const page = await wolse();

  page.pointAt("trend", 0);
  const left = SHOWN.map((p) => page.marker(p).x);
  const firstDate = /(\d{4}-\d{2}-\d{2})/.exec(page.tipHtml())[1];

  page.pointAt("trend", 1);
  const right = SHOWN.map((p) => page.marker(p).x);
  const lastDate = /(\d{4}-\d{2}-\d{2})/.exec(page.tipHtml())[1];

  assert.notEqual(firstDate, lastDate, "왼쪽 끝과 오른쪽 끝이 같은 주입니다");
  for (let i = 0; i < SHOWN.length; i += 1) {
    assert.ok(right[i] > left[i], `${SHOWN[i]}가 따라 움직이지 않았습니다`);
  }
});

test("말풍선이 그 주의 모든 값을 한 번에 보여준다", async () => {
  const page = await wolse();
  page.pointAt("trend", 1);

  const tip = page.tipHtml();
  assert.equal(page.tipHidden(), false);
  assert.match(tip, /2026-08-10/);
  assert.match(tip, /월세 보증금\(평당 아님\)/);
  assert.match(tip, /22,500만원/);
  assert.match(tip, /월세\(매달 내는 돈\)/);
  assert.match(tip, /월 96만원/);
  assert.match(tip, /월세 거래량/);
  assert.match(tip, /680건/);
  // 손이 올라간 줄은 표시가 다르다. 어느 그래프를 짚었는지는 여전히 알아야 한다.
  assert.match(tip, /class="tip-row here"><span class="tip-label">월세 보증금/);
});

test("점 개수가 다른 그래프에서도 한 주 밀리지 않는다", async () => {
  // 광진구는 실제로 매매가 스물세 주, 전세가 스물네 주다. 인덱스를 그대로 옮기면
  // 짧은 쪽이 한 주씩 밀리고, 밀렸다는 사실은 화면 어디에도 드러나지 않는다.
  const ragged = {
    ...TREND,
    overall: Object.fromEntries(
      WEEKS.map((w, i) => [
        w,
        // 첫 주에는 매매 값이 없다 → 매매 계열만 한 점 짧아진다.
        i === 0 ? week(i, { sale: { transactionCount: 300 } }) : week(i),
      ])
    ),
  };
  const page = await loadRealestatePage({ realestate: REALESTATE, trend: ragged, kind: null });

  // 매매(5점)와 거래량(6점)이 한 화면에 있다. 거래량의 첫 주를 짚으면 매매에는
  // 그 주가 없으므로 매매 마커는 찍히지 않아야 한다 — 엉뚱한 주에 찍히면 안 된다.
  page.pointAt("volume", 0);
  const first = page.marker("volume").x;
  assert.equal(page.marker("trend"), null, "그 주에 값이 없는 그래프에 마커가 찍혔습니다");
  assert.doesNotMatch(page.tipHtml(), /매매 평당가/, "값이 없는 주인데 말풍선에 값이 적혔습니다");

  // 둘 다 값이 있는 주에서는 나란히 찍힌다.
  page.pointAt("volume", 1);
  assert.ok(page.marker("volume").x > first, "오른쪽을 짚었는데 마커가 왼쪽에 있습니다");
  assert.equal(page.marker("trend").x, page.marker("volume").x);
});

test("접혀 있는 그래프에는 찍지 않는다", async () => {
  // 월세 화면의 전세가율 카드는 그려는 두었으나 숨긴다. 숨긴 그래프에 표시를 찍어 봐야
  // 아무도 보지 못하고, 말풍선만 한 줄 길어진다.
  const page = await wolse();
  assert.equal(page.cardHidden("ratio-card"), true, "전제가 깨졌습니다 — 전세가율 카드가 보입니다");

  page.pointAt("trend", 1);
  assert.equal(page.marker("ratio"), null, "숨긴 그래프에 마커가 찍혔습니다");
  assert.doesNotMatch(page.tipHtml(), /전세가율/);
});

test("그래프 밖으로 나가면 모든 표시가 사라진다", async () => {
  const page = await wolse();
  page.pointAt("rent", 0.5);
  assert.notEqual(page.marker("trend"), null);

  page.app.hideChartTip();
  assert.equal(page.tipHidden(), true);
  for (const prefix of ["trend", "rent", "volume"]) {
    assert.equal(page.marker(prefix), null, `${prefix} 마커가 남았습니다`);
  }
});
