import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { buildPayload, complexesByDistrict, squash } from "../scripts/build-search-index.mjs";

const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-08-29T00:00:00Z");

// --- 색인 -------------------------------------------------------------------

test("자치구는 '구'를 떼고도, 영문 슬러그로도 찾힌다", () => {
  const { entries } = buildPayload({ byDistrict: {}, now: NOW });
  const gangnam = entries.find((e) => e.text === "강남구");
  assert.ok(gangnam);
  assert.ok(gangnam.also.includes("강남"), "'강남'으로 못 찾는다");
  assert.ok(gangnam.also.includes("gangnam"), "영문 슬러그로 못 찾는다");
});

test("단지는 자치구별로 묶어 이름만 담는다", () => {
  // 항목마다 자치구와 주소를 되풀이하면 색인이 579KB가 됐다. 주소는 브라우저가 만든다.
  const grouped = complexesByDistrict({
    노원구: [{ apt: "상계주공7" }, { apt: "상계주공7" }, { apt: "중계무지개" }],
    강남구: [{ apt: "래미안" }, { apt: "" }],
  });
  assert.deepEqual(grouped.노원구, ["상계주공7", "중계무지개"], "같은 단지를 두 번 담았다");
  assert.deepEqual(grouped.강남구, ["래미안"], "이름 없는 거래를 담았다");
});

test("담는 순서가 매일 같다", () => {
  // 읽어 온 순서대로 담으면 값이 그대로여도 매일 diff가 난다.
  const a = complexesByDistrict({ 노원구: [{ apt: "나" }, { apt: "가" }, { apt: "다" }] });
  const b = complexesByDistrict({ 노원구: [{ apt: "다" }, { apt: "가" }, { apt: "나" }] });
  assert.deepEqual(a.노원구, b.노원구);
});

test("실제 색인이 브라우저가 들고 있어도 되는 크기다", async () => {
  const raw = await readFile(path.join(root, "docs/data/search-index.json"), "utf8");
  const kb = Buffer.byteLength(raw) / 1024;
  // 페이지마다 받는 파일이다. 100KB를 넘으면 항목 대신 다른 방법을 찾아야 한다.
  assert.ok(kb < 100, `색인이 ${kb.toFixed(0)}KB다`);

  const data = JSON.parse(raw);
  const complexes = Object.values(data.complexes).reduce((n, v) => n + v.length, 0);
  assert.ok(complexes > 1000, `단지가 ${complexes}개뿐이다`);
});

test("색인의 화면 주소가 전부 실재한다", async () => {
  const files = new Set((await readdir(path.join(root, "docs"))).filter((f) => f.endsWith(".html")));
  const { entries } = buildPayload({ byDistrict: {}, now: NOW });
  for (const entry of entries) {
    const file = entry.href.replace("./", "").split("?")[0];
    assert.ok(files.has(file), `${entry.text} → 없는 페이지 ${file}`);
  }
});

// --- 찾는 쪽 ----------------------------------------------------------------

const INDEX = {
  entries: [
    { kind: "district", text: "강남구", href: "./district-gangnam.html", also: ["강남", "gangnam"] },
    { kind: "budget", text: "10억대 아파트", href: "./budget-10eok.html", also: ["10억", "10"] },
    { kind: "screen", text: "전세 vs 월세", href: "./jeonse-vs-wolse.html", also: ["전환율"] },
  ],
  dongs: { 강남구: ["역삼동"], 노원구: ["상계동"] },
  complexes: { 강남구: ["강남래미안", "개포주공"], 노원구: ["상계주공7"] },
};

/** search.js를 가짜 DOM에 올려 검색 동작만 꺼내 본다. */
async function runSearch(query) {
  const source = await readFile(path.join(root, "docs/search.js"), "utf8");
  const listeners = {};
  const el = (extra = {}) => ({
    addEventListener: (type, fn) => ((listeners[type] ||= []).push(fn), undefined),
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
    contains: () => true,
    innerHTML: "",
    hidden: true,
    value: "",
    ...extra,
  });
  const input = el({ value: query });
  const list = el();
  const form = el({ querySelector: (sel) => (sel === "input" ? input : list) });

  const events = [];
  vm.runInNewContext(source, {
    document: { querySelector: (sel) => (sel === ".site-search" ? form : null), addEventListener() {} },
    fetch: async () => ({ ok: true, json: async () => INDEX }),
    location: { href: "" },
    URLSearchParams,
    window: { analytics: { debouncedEvent: (name, params) => events.push({ name, params }) } },
  });

  for (const fn of listeners.input ?? []) await fn({});
  await new Promise((r) => setTimeout(r, 5));
  runSearch.events = events;
  return list.innerHTML;
}

test("자치구를 친 사람에게 자치구 페이지를 먼저 준다", async () => {
  const html = await runSearch("강남");
  const first = /<span class="hit">([^<]*)</.exec(html)?.[1];
  // "강남"을 친 사람은 대개 강남구를 찾지, 강남이 이름에 든 단지를 찾지 않는다.
  assert.equal(first, "강남구", `첫 결과가 ${first}다`);
  assert.match(html, /강남래미안/, "단지가 아예 안 나온다");
});

test("단지 이름을 자치구 고르지 않고 서울 전체에서 찾는다", async () => {
  // 전에는 deal-search에서 자치구를 먼저 골라야 단지명 검색이 동작했다.
  const html = await runSearch("상계주공");
  assert.match(html, /상계주공7/);
  assert.match(html, /district=%EB%85%B8%EC%9B%90%EA%B5%AC/, "어느 구인지 주소에 안 담겼다");
  assert.match(html, /class="where">노원구</, "어느 구인지 안 보여준다");
});

test("예산과 지표 이름으로도 들어간다", async () => {
  assert.match(await runSearch("10억"), /budget-10eok\.html/);
  assert.match(await runSearch("전환율"), /jeonse-vs-wolse\.html/);
});

test("빈 검색어에는 아무것도 띄우지 않는다", async () => {
  assert.equal(await runSearch("   "), "");
});

test("공백과 대소문자를 무시하고 맞춘다", () => {
  assert.equal(squash(" Gangnam 구 "), "gangnam구");
});

// --- 정해진 이름이 아닌 말 --------------------------------------------------

test("동 이름으로 찾는다", async () => {
  // 사람은 "강남구"보다 "역삼동"으로 동네를 부른다.
  const html = await runSearch("역삼동");
  assert.match(html, /역삼동/);
  assert.match(html, /dong=%EC%97%AD%EC%82%BC%EB%8F%99/, "동 조건이 주소에 안 담겼다");
});

test("이름으로 딱 맞으면 조건 추측을 얹지 않는다", async () => {
  // "상계동"을 친 사람에게 "노원구 상계동 (조건으로 찾기)"를 먼저 주면 같은 말이 두 번이다.
  const html = await runSearch("상계동");
  const first = /<span class="hit">([^<]*)</.exec(html)?.[1];
  assert.equal(first, "상계동");
});

test("금액과 면적을 조건으로 읽는다", async () => {
  assert.match(await runSearch("3억5천"), /3\.5억대/);
  assert.match(await runSearch("84㎡"), /84㎡/);
  // 34평을 쳤는데 112㎡라고 답하면 맞게 읽혔는지 알 수 없다.
  assert.match(await runSearch("34평"), /34평/);
  assert.match(await runSearch("34평"), /area=85-135/, "평을 제곱미터로 환산해 구간을 못 잡았다");
});

test("두 가지를 같이 쳐도 받는다", async () => {
  const html = await runSearch("강남구 84㎡");
  assert.match(html, /강남구 · 84㎡/);
  assert.match(html, /district=%EA%B0%95%EB%82%A8%EA%B5%AC/);
  assert.match(html, /area=60-85/);
});

test("긴 이름이 짧은 이름에 먹히지 않는다", async () => {
  const html = await runSearch("상계동 60㎡");
  assert.match(html, /상계동/);
  assert.match(html, /area=60(?!-)/);
});

test("못 찾으면 무엇을 찾을 수 있는지 말한다", async () => {
  // 전에는 드롭다운이 그냥 사라졌다 - 고장 났는지 잘못 쳤는지 알 수 없었다.
  const html = await runSearch("학군");
  assert.match(html, /찾지 못했습니다|site-search-miss/);
  assert.match(html, /자치구·동·단지 이름/, "무엇을 찾을 수 있는지 안 알려준다");
  assert.match(html, /다루지 않습니다/, "없는 데이터를 없다고 말하지 않는다");
  assert.match(html, /학군/, "친 글자를 되비추지 않는다");
});

test("못 찾은 말을 모은다", async () => {
  await runSearch("학군");
  const miss = runSearch.events.find((e) => e.name === "search_miss");
  assert.ok(miss, "못 찾은 검색어를 기록하지 않는다");
  assert.equal(miss.params.search_term, "학군");
});

test("빈 검색어에는 안내도 띄우지 않는다", async () => {
  assert.equal(await runSearch("   "), "");
});

test("색인의 동이 실제 자치구에 붙어 있다", async () => {
  const data = JSON.parse(await readFile(path.join(root, "docs/data/search-index.json"), "utf8"));
  const districts = new Set(
    buildPayload({ byDistrict: {}, now: NOW }).entries.filter((e) => e.kind === "district").map((e) => e.text)
  );
  const dongs = Object.entries(data.dongs ?? {});
  assert.ok(dongs.length >= 20, `동을 담은 자치구가 ${dongs.length}개뿐이다`);
  for (const [district, names] of dongs) {
    assert.ok(districts.has(district), `${district}는 자치구가 아니다`);
    assert.ok(names.length > 0);
  }
});
