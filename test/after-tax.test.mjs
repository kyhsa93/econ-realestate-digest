// 세후 이자는 이 페이지가 처음으로 "연 몇 %"가 아니라 "내가 얼마 받나"에 답하는
// 숫자다. 틀리면 금리를 잘못 적는 것보다 나쁘다 - 사람들이 이 값을 보고 상품을
// 고르기 때문이다. 그래서 손계산과 직접 대조하고, 화면과 정적 HTML이 같은 값을
// 내는지도 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_AMOUNT, TAX_RATE, formatWon, interestOf } from "../scripts/interest.mjs";
import { ratesHeadHtml, ratesHtml } from "../scripts/prerender.mjs";
import { loadRatesPage } from "./helpers/rates-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const netCells = (html) =>
  [...html.matchAll(/class="net-interest"[^>]*>([^<]*)</g)].map((m) => m[1].trim());

const simple = (term, rate) => ({ term, rate, maxRate: rate, rateTypeName: "단리" });
const compound = (term, rate) => ({ term, rate, maxRate: rate, rateTypeName: "복리" });

test("정기예금 단리 계산이 손계산과 같다", () => {
  // 1,000만원 × 4.10% × 12개월 = 410,000원, 세금 15.4% = 63,140원
  const r = interestOf(simple(12, 4.1), { amount: 10_000_000 });
  assert.equal(r.gross, 410_000);
  assert.equal(r.tax, 63_140);
  assert.equal(r.net, 346_860);
  assert.equal(r.maturity, 10_346_860);
});

test("적금은 매달 붓는 회차만큼만 이자가 붙는다", () => {
  // 월 30만원 × (3.85%/12) × (12×13/2 = 78개월분) = 75,075원
  // 1년치 원금 360만원에 3.85%를 그대로 곱한 138,600원이 아니다.
  const r = interestOf(simple(12, 3.85), { amount: 300_000, saving: true });
  assert.equal(r.gross, 75_075);
  assert.equal(r.principal, 3_600_000);
  assert.equal(r.net, Math.round(75_075 * (1 - TAX_RATE)));
});

test("복리는 단리보다 이자가 많다", () => {
  const s = interestOf(simple(12, 4.1), { amount: 10_000_000 });
  const c = interestOf(compound(12, 4.1), { amount: 10_000_000 });
  assert.ok(c.gross > s.gross, `복리(${c.gross})가 단리(${s.gross})보다 커야 한다`);
  // 월복리 12회: 1,000만 × ((1+0.041/12)^12 - 1)
  assert.equal(c.gross, Math.round(10_000_000 * ((1 + 0.041 / 12) ** 12 - 1)));
});

// 금리나 기간이 비어 있는 옵션이 공시에 실제로 있다. 0원으로 채우면 표가 거짓말을 한다.
test("계산할 수 없으면 값을 지어내지 않는다", () => {
  assert.equal(interestOf({ term: 12, rate: null, maxRate: null }, { amount: 1000 }), null);
  assert.equal(interestOf(simple(null, 3), { amount: 1000 }), null);
  assert.equal(interestOf(simple(12, 3), { amount: 0 }), null);
  assert.equal(formatWon(null), "-");
});

test("우대조건을 못 채우는 사람을 위해 기본금리로도 계산할 수 있다", () => {
  const option = { term: 12, rate: 2.45, maxRate: 3.85, rateTypeName: "단리" };
  const max = interestOf(option, { amount: 10_000_000 });
  const base = interestOf(option, { amount: 10_000_000, useMaxRate: false });
  assert.ok(base.net < max.net);
  assert.equal(base.gross, Math.round(10_000_000 * 0.0245));
});

test("정적 HTML의 세후 이자가 실제 첫 화면과 같다", async () => {
  const [rates, { byId }] = await Promise.all([
    readFile(path.join(root, "docs/data/rates.json"), "utf8").then(JSON.parse),
    loadRatesPage(),
  ]);

  const rendered = netCells(byId.get("products-body").innerHTML);
  const prerendered = netCells(ratesHtml(rates));

  assert.ok(prerendered.length > 0, "정적 표에 세후 이자가 없다");
  assert.deepEqual(prerendered, rendered.slice(0, prerendered.length));
  assert.ok(ratesHeadHtml("deposit").includes("세후 이자"), "머리글에 세후 이자가 없다");
});

test("대출 표에는 세후 이자 열이 없다", () => {
  assert.ok(!ratesHeadHtml("mortgage").includes("세후 이자"));
  assert.equal(ratesHeadHtml("mortgage").match(/<th>/g).length, 4);
});

// 금액을 바꾸는 게 이 기능의 핵심이다. 입력이 표에 반영되지 않으면 "1,000만원 기준
// 예시"를 하나 적어둔 것과 다를 게 없다.
test("금액을 바꾸면 표의 세후 이자가 따라 바뀐다", async () => {
  const { byId, sandbox } = await loadRatesPage();
  const before = netCells(byId.get("products-body").innerHTML);

  const input = byId.get("amount-input");
  assert.ok(input, "금액 입력칸이 없다");
  input.value = String(DEFAULT_AMOUNT.deposit * 3);
  input.dispatch("input");

  const after = netCells(byId.get("products-body").innerHTML);
  assert.notDeepEqual(after, before, "금액을 3배로 올렸는데 표가 그대로다");

  // 예금은 단순 비례라 정확히 3배여야 한다(반올림 오차 1원까지 허용).
  const won = (s) => Number(s.replace(/[^\d]/g, ""));
  assert.ok(Math.abs(won(after[0]) - won(before[0]) * 3) <= 1, `${before[0]} → ${after[0]}`);
  assert.equal(sandbox.__state.amounts.deposit, DEFAULT_AMOUNT.deposit * 3);
});

test("빈 칸이나 0을 넣어도 표가 무너지지 않는다", async () => {
  const { byId } = await loadRatesPage();
  const before = netCells(byId.get("products-body").innerHTML);

  const input = byId.get("amount-input");
  for (const bad of ["", "0", "-5", "abc"]) {
    input.value = bad;
    input.dispatch("input");
  }
  assert.deepEqual(netCells(byId.get("products-body").innerHTML), before);
});

test("세후 이자 기준으로 정렬할 수 있다", async () => {
  const { byId, clickSortHeader } = await loadRatesPage();
  clickSortHeader("netInterest");

  const won = (s) => Number(s.replace(/[^\d]/g, ""));
  const values = netCells(byId.get("products-body").innerHTML).filter((v) => v !== "-").map(won);
  assert.ok(values.length > 1, "정렬할 행이 없다");
  const sorted = [...values].sort((a, b) => b - a);
  assert.deepEqual(values, sorted, "내림차순으로 줄 서 있지 않다");
});

// 예금은 목돈, 적금은 매달 붓는 돈이라 기준이 다르다. 적금 탭에서 "월 1,000만원"을
// 묻는 화면이 되면 안 된다.
test("적금 탭은 월 납입액 기준으로 바뀐다", async () => {
  const { byId, clickTab, sandbox } = await loadRatesPage();
  clickTab("saving");
  assert.equal(sandbox.__state.amounts.saving, DEFAULT_AMOUNT.saving);

  // 입력칸에 실제로 그 금액이 적혀 나가는지는 다시 그려진 마크업에서 본다
  // (하네스는 innerHTML을 갈아끼워도 노드 객체의 value를 건드리지 않는다).
  const controls = byId.get("controls").innerHTML;
  assert.match(controls, new RegExp(`id="amount-input"[^>]*value="${DEFAULT_AMOUNT.saving}"`));
  assert.ok(controls.includes("월 납입액"), "적금 탭인데 라벨이 예치금액이다");
});

test("기본 금액은 주소에 남기지 않고, 바꾸면 남긴다", async () => {
  const { byId, sandbox } = await loadRatesPage();
  assert.ok(!sandbox.location.search.includes("amt="), "기본값이 주소에 남았다");

  const input = byId.get("amount-input");
  input.value = "20000000";
  input.dispatch("input");
  assert.ok(sandbox.location.search.includes("amt=20000000"), sandbox.location.search);
});

test("주소로 들어온 금액으로 시작한다", async () => {
  const { sandbox } = await loadRatesPage({ search: "?amt=50000000" });
  assert.equal(sandbox.__state.amounts.deposit, 50_000_000);
});
