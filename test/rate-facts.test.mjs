import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { rateFacts, factSentences } from "../scripts/rate-facts.mjs";
import { jsonForScript, rateFactsData } from "../scripts/prerender.mjs";
import { RATE_PAGES } from "../scripts/build-rate-pages.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readRates = () => read("docs/data/rates.json").then(JSON.parse);
const CATEGORIES = ["deposit", "saving", "mortgage", "rentLoan"];

test("상품군마다 다른 것을 말한다", async () => {
  // 금리 다섯 장은 이 사이트에서 본문이 가장 얇은데 광고 단가는 가장 높은 자리다.
  // 문단을 붙이는 것이 목적이 아니라 상품군마다 다른 것을 말하는 것이 목적이라,
  // 여기서 재는 것은 분량이 아니라 말하는 종류다.
  const rates = await readRates();
  const shapes = new Map();
  for (const category of CATEGORIES) {
    const facts = rateFacts(rates, category);
    assert.ok(facts, `${category}: 관찰이 하나도 안 나왔습니다`);
    const shape = ["truncated", "topConditional", "conditional", "thriftHeavy", "online", "earlyFee", "spread"]
      .filter((k) => facts[k])
      .join("+");
    shapes.set(category, shape);
  }
  assert.ok(new Set(shapes.values()).size >= 3, `조합이 ${new Set(shapes.values()).size}가지뿐입니다: ${[...shapes.values()].join(" / ")}`);
});

test("세는 모집단이 화면 표와 같다", async () => {
  // 이게 어긋나면 두 숫자가 서로를 부정한다 — "356개 중 43개"라고 써 놓고 표에는
  // 열두 달짜리가 아닌 것이 섞여 있으면 읽는 사람이 맞출 수가 없다.
  const rates = await readRates();
  const { ratesHtml } = await import("../scripts/prerender.mjs");

  for (const category of CATEGORIES) {
    const facts = rateFacts(rates, category);
    const shownRows = (ratesHtml(rates, { category }).match(/class="product-name"/g) ?? []).length;
    assert.equal(facts.shown, shownRows, `${category}: 문단은 ${facts.shown}개, 표는 ${shownRows}개를 보여줍니다`);
    assert.ok(facts.total >= shownRows, `${category}: 전체가 보이는 것보다 적습니다`);
  }
});

test("표 맨 위가 조건부면 그렇다고 말한다", async () => {
  // 이 파일이 있는 이유다. 적금 표 1위는 최고 14%인데 우대조건을 못 채우면 2%다.
  // 표에 두 숫자가 나란히 있어도 12%p가 조건부라는 말은 어디에도 없었다.
  const rates = await readRates();
  const facts = rateFacts(rates, "saving");
  assert.ok(facts.topConditional, "적금 1위의 조건부 격차를 못 잡았습니다");
  assert.ok(facts.topConditional.gap >= 0.5);

  const said = factSentences(facts, "ko").join(" ");
  assert.match(said, /표 맨 위에 있는/);
  assert.match(said, /우대조건을 전부 채웠을 때/);
  assert.match(said, new RegExp(`${facts.topConditional.gap}%p`));
});

test("대출은 금리만 보면 안 된다고 적는다", async () => {
  const rates = await readRates();
  for (const category of ["mortgage", "rentLoan"]) {
    const said = factSentences(rateFacts(rates, category), "ko").join(" ");
    assert.match(said, /중도상환수수료/, `${category}: 수수료 이야기가 없습니다`);
    assert.match(said, /하나의 숫자가 아니라 구간/, `${category}: 금리 구간 이야기가 없습니다`);
  }
});

test("표본이 모자라면 아무 말도 하지 않는다", async () => {
  assert.equal(rateFacts({ deposit: [] }, "deposit"), null);
  assert.equal(rateFacts({}, "deposit"), null);
  assert.deepEqual(factSentences(null), []);

  // 문턱을 못 넘은 관찰은 키가 아예 없다. 억지로 채우면 다시 하나의 틀이 된다.
  const flat = {
    deposit: Array.from({ length: 30 }, (_, i) => ({
      company: `은행${i}`,
      name: `상품${i}`,
      sector: "bank",
      joinWay: "영업점",
      options: [{ term: 12, rate: 3, maxRate: 3 }],
    })),
  };
  const facts = rateFacts(flat, "deposit");
  for (const key of ["topConditional", "conditional", "thriftHeavy", "online"]) {
    assert.equal(facts[key], undefined, `${key}는 문턱을 못 넘었는데 나왔습니다`);
  }
  assert.equal(factSentences(facts, "ko").length, 1, "잘렸다는 말 한 줄만 남아야 합니다");
});

test("영문도 같은 관찰을 말한다", async () => {
  const rates = await readRates();
  for (const category of CATEGORIES) {
    const facts = rateFacts(rates, category);
    const ko = factSentences(facts, "ko");
    const en = factSentences(facts, "en");
    assert.equal(ko.length, en.length, `${category}: 한쪽에만 있는 문장이 있습니다`);
    // 은행·상품 이름은 한글이 맞다. 없어야 하는 것은 한국어 문장이라 종결어미로 잡는다.
    assert.doesNotMatch(en.join(" "), /입니다|습니다/, `${category}: 영문에 한국어 문장이 섞였습니다`);
  }
});

test("상품 이름이 script 태그를 닫고 나오지 못한다", async () => {
  // 이 JSON은 `<script type="application/json">` 안에 들어가는데, JSON.stringify는
  // `<`도 `/`도 건드리지 않는다. 금감원에서 그대로 받아 오는 이름이라 내용을 우리가
  // 정하지 못한다.
  const nasty = jsonForScript({ a: "</script><img src=x onerror=alert(1)>", b: "<!--" });
  assert.doesNotMatch(nasty, /<\/script/i);
  assert.doesNotMatch(nasty, /<!--/);
  assert.deepEqual(JSON.parse(nasty), { a: "</script><img src=x onerror=alert(1)>", b: "<!--" });
});

test("페이지에 심긴 문장이 지금 데이터로 만든 것과 같다", async () => {
  // 화면이 탭을 눌렀을 때 쓰는 덩이와, HTML에 구워 놓은 문단이 어긋나면 탭 한 번에
  // 문장이 바뀐다.
  const rates = await readRates();
  const data = rateFactsData(rates);

  for (const page of RATE_PAGES) {
    const html = await read(`docs/${page.file}`);
    const baked = /<!--prerender:rateFactsKo-->([\s\S]*?)<!--\/prerender/.exec(html)[1];
    const want = data[page.category].ko.join(" ");
    assert.ok(baked.length > 0, `${page.file}: 문단이 비어 있습니다`);
    // 구워진 쪽은 HTML 이스케이프가 되어 있으므로 문장 부호를 뺀 뒤 견준다.
    const plain = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    assert.equal(plain(baked), want, `${page.file}: 구워진 문단이 데이터와 다릅니다`);

    // 덩이는 스크립트 태그 안의 프리렌더 표시 사이에 있다.
    const blob = /<!--prerender:rateFactsData-->([\s\S]*?)<!--\/prerender:rateFactsData-->/.exec(html)[1];
    assert.ok(
      html.includes(`<script type="application/json" id="rate-facts-data"><!--prerender:rateFactsData-->`),
      `${page.file}: 덩이가 스크립트 태그 안에 있지 않습니다`
    );
    const parsed = JSON.parse(blob);
    assert.deepEqual(parsed[page.category].ko, data[page.category].ko, `${page.file}: 탭용 덩이가 다릅니다`);
    assert.deepEqual(Object.keys(parsed).sort(), CATEGORIES.slice().sort(), `${page.file}: 네 상품군이 다 없습니다`);
  }
});
