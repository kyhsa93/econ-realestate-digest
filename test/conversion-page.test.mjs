import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { LOAN_LTV, compare, monthlyCost } from "../scripts/conversion.mjs";

const root = path.resolve(import.meta.dirname, "..");
const PAGE = path.join(root, "docs/jeonse-vs-wolse.html");

/**
 * 화면은 사용자가 가진 돈을 바꿀 때마다 다시 재야 해서 계산을 한 벌 더 가지고 있다.
 * 두 벌이 갈라지면 빌드가 내는 숫자와 화면이 보여주는 숫자가 달라지는데, 그건
 * 어느 쪽도 틀렸다고 말해 주지 않으므로 여기서 같은 입력에 같은 답이 나오는지 본다.
 */
async function pageCalculator() {
  const html = await readFile(PAGE, "utf8");
  const source = /const TAX_RATE = [\s\S]*?\n}\n\nconst cache = /.exec(html);
  assert.ok(source, "화면의 계산 코드를 찾지 못했습니다. 함수 이름이 바뀌었는지 확인하세요.");

  // 별도 컨텍스트에서 돌리면 거기서 만들어진 객체가 다른 realm에 속해, 값이 같아도
  // deepStrictEqual이 프로토타입 때문에 실패한다. 같은 realm에서 평가하되 전역이
  // 더럽혀지지 않도록 즉시실행 함수로 감싼다.
  const body = source[0].replace("\nconst cache = ", "");
  return vm.runInThisContext(`(() => { ${body}\nreturn { monthlyCost, compare, TAX_RATE, EOK }; })()`);
}

const CASES = [
  { jeonse10k: 50_000, deposit10k: 20_000, monthly10k: 125, cash10k: 20_000 },
  { jeonse10k: 95_000, deposit10k: 40_000, monthly10k: 220, cash10k: 30_000 },
  { jeonse10k: 95_000, deposit10k: 40_000, monthly10k: 220, cash10k: 10_000 },
  { jeonse10k: 62_500, deposit10k: 10_000, monthly10k: 173.8, cash10k: 70_000 },
  { jeonse10k: 30_000, deposit10k: 5_000, monthly10k: 90, cash10k: 0 },
  { jeonse10k: 68_750, deposit10k: 30_000, monthly10k: 140, cash10k: 68_750 },
];

const RATES = { loanRate: 4.38, depositRate: 3.8 };

test("화면의 월 비용 계산이 빌드 쪽과 한 자리도 다르지 않다", async () => {
  const page = await pageCalculator();

  for (const item of CASES) {
    for (const [label, args] of [
      ["전세", { deposit10k: item.jeonse10k }],
      ["월세", { deposit10k: item.deposit10k, monthlyRent10k: item.monthly10k }],
    ]) {
      const mine = monthlyCost({ ...args, cash10k: item.cash10k, ...RATES });
      const theirs = page.monthlyCost({ ...args, cash10k: item.cash10k, ...RATES, ltv: LOAN_LTV });
      assert.deepEqual(theirs, mine, `${label} ${JSON.stringify(item)}에서 두 계산이 갈라졌다`);
    }
  }
});

test("화면의 비교 결과가 빌드 쪽과 같은 쪽을 고른다", async () => {
  const page = await pageCalculator();

  for (const item of CASES) {
    const mine = compare({ ...item, ...RATES });
    const theirs = page.compare({ ...item, ...RATES, ltv: LOAN_LTV });
    assert.deepEqual(theirs, mine, `${JSON.stringify(item)}에서 두 비교가 갈라졌다`);
  }
});

test("화면이 쓰는 이자소득세율이 금리 화면과 같다", async () => {
  const page = await pageCalculator();
  const { TAX_RATE } = await import("../scripts/interest.mjs");
  assert.equal(page.TAX_RATE, TAX_RATE);
});

test("화면이 대출 한도를 빌드와 같은 값으로 넘긴다", async () => {
  // ltv는 화면이 스스로 정하지 않고 conversion.json에 실려 온다. 빌드가 넣는 값과
  // 테스트가 쓰는 값이 같아야 위의 두 검사가 의미를 가진다.
  const { buildPayload } = await import("../scripts/build-conversion.mjs");
  const deal = (extra) => ({
    district: "노원구",
    dong: "하계동",
    apt: "극동아파트",
    area: 84.9,
    date: "2026-08-14",
    renewal: false,
    ...extra,
  });
  const deals = ["가", "나", "다"].flatMap((name) => [
    deal({ apt: name, deposit10k: 50_000 }),
    deal({ apt: name, deposit10k: 20_000, monthlyRent10k: 125 }),
  ]);

  const payload = buildPayload({
    deals,
    rates: { rentLoan: [{ options: [{ min: 3, max: 5, avg: 4 }] }], deposit: [{ options: [{ term: 12, rate: 3.8 }] }] },
    months: ["202608"],
    now: new Date("2026-08-26T00:00:00Z"),
  });

  assert.equal(payload.ltv, LOAN_LTV);
});
