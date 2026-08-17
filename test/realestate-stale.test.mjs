// 조회에 실패해 지난번 값을 그대로 들고 있는 구.
//
// 값을 채워 넣는 것 자체는 옳다 - 표에서 구가 통째로 빠지면 읽는 사람은 그 지역에 거래가
// 없었다고 읽는다. 다만 조용히 채우면 그게 오늘 신고분인 줄 안다. 지난달 값으로 대체할 때
// 기준 월을 적는 것과 같은 규율이다.
import test from "node:test";
import assert from "node:assert/strict";
import { realestateTableHtml } from "../scripts/prerender.mjs";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

const district = (name, extra = {}) => ({
  code: name === "노원구" ? "11350" : "11110",
  name,
  sale: { avgPricePerPyeong10k: 3624, transactionCount: 41 },
  jeonse: { avgDepositPerPyeong10k: 1913, transactionCount: 174 },
  wolse: { avgDeposit10k: 11548, avgMonthlyRent10k: 64, transactionCount: 138 },
  ...extra,
});

const REALESTATE = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  period: "202608",
  overall: {
    sale: { avgPricePerM2: 13_457_520, avgPricePerPyeong10k: 4449, transactionCount: 575 },
    jeonse: { avgDepositPerM2: 7_777_223, avgDepositPerPyeong10k: 2571, transactionCount: 2525 },
    wolse: { avgDeposit10k: 22166, avgMonthlyRent10k: 96, transactionCount: 2223 },
  },
  districts: [district("노원구"), district("종로구", { staleAt: "2026-08-14T23:32:15.722Z" })],
};

test("지난번 값을 들고 있는 구에 받은 날짜를 적는다", async () => {
  const page = await loadRealestatePage({ realestate: REALESTATE });
  const html = page.tableHtml();

  // 2026-08-14T23:32Z는 KST로 8월 15일이다. 날짜는 서울 기준으로 적는다.
  assert.match(html, /종로구 <span class="prev-tag" title="[^"]*조회에 실패[^"]*">8\. 15\.<\/span>/);
  assert.ok(!/노원구 <span class="prev-tag"/.test(html), "새로 받은 구에 묵은 표시가 붙었다");
});

test("프리렌더와 화면이 같은 표시를 낸다", async () => {
  const page = await loadRealestatePage({ realestate: REALESTATE });
  assert.equal(page.tableHtml(), realestateTableHtml(REALESTATE));
});

test("영어 화면에서도 표시가 남는다", async () => {
  const page = await loadRealestatePage({ realestate: REALESTATE, locale: "en" });
  const html = page.tableHtml();
  assert.match(html, /종로구 <span class="prev-tag" title="[^"]*lookup failed[^"]*">/);
});

// staleAt이 없거나 값이 깨졌다고 표가 무너지면 안 된다.
test("표시가 없거나 깨진 값은 조용히 넘어간다", async () => {
  const broken = {
    ...REALESTATE,
    districts: [district("노원구"), district("종로구", { staleAt: "그날쯤" })],
  };
  const page = await loadRealestatePage({ realestate: broken });
  assert.ok(!page.tableHtml().includes("prev-tag"));
});
