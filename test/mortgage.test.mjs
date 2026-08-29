import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { apartmentOptions, loanSentence, monthlyPayment, rateSpread } from "../scripts/mortgage.mjs";
import { budgetLoanHtml } from "../scripts/prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");

const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} ${actual} ≈ ${expected}`.trim());

const RATES = {
  mortgage: [
    {
      company: "가나은행",
      options: [
        { mortgageType: "아파트", repayType: "분할상환방식", min: 4 },
        { mortgageType: "아파트", repayType: "만기일시상환방식", min: 3 },
        { mortgageType: "연립·다세대", repayType: "분할상환방식", min: 3.5 },
      ],
    },
    {
      company: "다라은행",
      options: [
        { mortgageType: "아파트", repayType: "분할상환방식", min: 5 },
        { mortgageType: "아파트", repayType: "분할상환방식", min: 6 },
      ],
    },
  ],
};

test("원리금균등 월 상환액을 낸다", () => {
  // 1억(10,000만원)을 30년 5.11%로 빌리면 매달 54.36만원이다.
  near(monthlyPayment(10_000, 5.11, 30), 54.36, 0.02, "1억 30년 5.11%");
  // 기간이 짧아지면 매달 더 낸다.
  assert.ok(monthlyPayment(10_000, 5.11, 20) > monthlyPayment(10_000, 5.11, 30));
});

test("금리가 0이어도 무너지지 않는다", () => {
  // 실무에 0%는 없지만 값이 비어 온 날 Number("")가 0이 되어 흘러드는 것을 이미 겪었다.
  near(monthlyPayment(3_600, 0, 30), 10, 0.001, "원금을 개월로 나눈 값");
  assert.equal(monthlyPayment(0, 5), null);
  assert.equal(monthlyPayment(10_000, Number.NaN), null);
});

test("아파트를 나누어 갚는 상품만 고른다", () => {
  // 일시상환은 매달 이자만 내는 것이라 월 상환액의 뜻이 아예 다르다.
  const options = apartmentOptions(RATES);
  assert.deepEqual(options.map((o) => o.min), [4, 5, 6]);
});

test("대표 금리는 가장 낮은 것이 아니라 중앙값이다", () => {
  // 최저 하나를 쓰면 우대조건을 다 채운 사람의 값이 모두의 값처럼 보인다.
  const spread = rateSpread(apartmentOptions(RATES));
  assert.equal(spread.mid, 5, "중앙값이 아니다");
  assert.equal(spread.low, 4);
  assert.equal(spread.high, 6);
  assert.equal(spread.count, 3);
});

test("금리가 없으면 문단을 만들지 않는다", () => {
  // 금리 수집이 실패한 날에도 예산 페이지 자체는 나와야 한다.
  assert.equal(rateSpread([]), null);
  assert.equal(loanSentence(null, { eok: 10 }), null);
  assert.equal(budgetLoanHtml({ min10k: 100_000 }, null), "");
});

test("한도는 가정하지 않고 1억당 값으로 말한다", () => {
  const sentence = loanSentence(rateSpread(apartmentOptions(RATES)), { eok: 10 });
  assert.match(sentence, /1억을 30년 원리금균등으로/);
  assert.match(sentence, /1억당 값을 곱하시면/);
  // LTV·DSR을 하나로 정해 적으면 해마다 조용히 틀린 화면이 된다.
  assert.doesNotMatch(sentence, /LTV|DSR/);
});

test("예산 페이지에 월 상환액 문단이 붙어 있다", async () => {
  const html = await readFile(path.join(root, "docs/budget-10eok.html"), "utf8");
  assert.match(html, /<p class="budget-loan">/, "예산 페이지에 문단이 없다");
  assert.match(html, /1억을 30년 원리금균등으로 빌리면/);
});
