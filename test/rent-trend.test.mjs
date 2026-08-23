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

// 보증금은 내내 같고 월세만 오르는 여섯 주. 두 값이 서로 다른 이야기를 한다는 것이
// 이 카드가 있는 이유라, 픽스처도 그렇게 만든다.
const WEEKS = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"];
const RENTS = [96, 102, 108, 114, 120, 126];

const TREND = {
  updatedAt: "2026-08-21T00:00:00.000Z",
  weeks: WEEKS,
  pendingWeeks: [],
  overall: Object.fromEntries(
    WEEKS.map((week, i) => [
      week,
      {
        sale: { avgPricePerPyeong10k: 4400 + i, transactionCount: 300 + i },
        jeonse: { avgDepositPerPyeong10k: 3000 + i, transactionCount: 400 + i },
        wolse: { avgDeposit10k: 22000, avgMonthlyRent10k: RENTS[i], transactionCount: 600 + i },
      },
    ])
  ),
  districts: {},
};

const wolsePage = (extra = {}) =>
  loadRealestatePage({ realestate: REALESTATE, trend: TREND, kind: "wolse", ...extra });

test("월세 페이지는 보증금 말고 월세 자체의 추이도 그린다", async () => {
  // 보증금과 월세는 서로 바꿔 넣을 수 있는 값이다 — 보증금을 올리면 월세가 내려간다.
  // 그래서 보증금 추이만 그리면 시장이 어디로 가는지 절반만 보인다. 이 픽스처에서
  // 보증금은 여섯 주 내내 2억 2천으로 붙박이고 월세만 96에서 126으로 오른다.
  const page = await wolsePage();

  assert.equal(page.cardHidden("rent-card"), false, "월세 카드가 숨어 있습니다");
  assert.ok(page.byId("rent-chart").innerHTML.length > 0, "월세 그래프가 비어 있습니다");
  assert.equal(page.cardLabel("rent"), "월세(매달 내는 돈)");
  assert.equal(page.cardCurrent("rent"), "월 126만원");
  assert.match(page.cardMinMax("rent"), /96/);

  // 보증금 카드는 그대로 붙박이 값을 그린다. 둘이 같은 값을 그리고 있으면 카드를 하나
  // 더 놓은 뜻이 없다.
  assert.equal(page.cardCurrent("trend"), "22,000만원");
});

test("월세 카드는 보증금과 거래량 사이에 있다", async () => {
  // 요청받은 자리다. 보증금 → 월세 → 거래량 순으로 읽혀야, 세 카드가 "얼마를 맡기고
  // 매달 얼마를 내는 계약이 몇 건 있었나" 한 문장으로 읽힌다.
  const { readFile } = await import("node:fs/promises");
  const html = await readFile("docs/apartment-rent.html", "utf8");
  const at = (id) => html.indexOf(`id="${id}-card"`);
  assert.ok(at("trend") > 0 && at("rent") > 0 && at("volume") > 0);
  assert.ok(at("rent") > at("trend"), "월세 카드가 보증금 카드보다 위에 있습니다");
  assert.ok(at("rent") < at("volume"), "월세 카드가 거래량 카드보다 아래에 있습니다");
});

test("월세가 아닌 화면에서는 월세 카드가 나오지 않는다", async () => {
  // 위 카드가 매매나 전세를 그리는 화면에서 그 옆에 월세만 끼면 무엇의 추이인지
  // 읽히지 않는다.
  for (const kind of [null, "sale", "jeonse"]) {
    const page = await loadRealestatePage({ realestate: REALESTATE, trend: TREND, kind });
    assert.equal(page.cardHidden("rent-card"), true, `kind=${kind}에서 월세 카드가 보입니다`);
  }
});

test("영어로 보면 월세 카드도 영어로 적힌다", async () => {
  const page = await wolsePage({ locale: "en" });
  assert.equal(page.cardLabel("rent"), "Monthly rent itself");
  assert.doesNotMatch(page.cardCurrent("rent"), /[가-힣]/);
});

test("주가 모자라면 월세 카드도 함께 접힌다", async () => {
  // 한 주짜리 자료로 추이를 그리면 선이 아니라 점이다. 보증금 카드가 접히는 조건과
  // 같은 조건에서 같이 접혀야, 한쪽만 남아 화면이 이상해지지 않는다.
  const short = {
    ...TREND,
    weeks: [WEEKS[0]],
    overall: { [WEEKS[0]]: TREND.overall[WEEKS[0]] },
  };
  const page = await loadRealestatePage({ realestate: REALESTATE, trend: short, kind: "wolse" });
  assert.equal(page.cardHidden("rent-card"), true);
  assert.equal(page.cardHidden("trend-card"), true);
});
