import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/build-renewal-facts.mjs";
import { renewalDistrictsHtml } from "../scripts/prerender.mjs";
import { loadRenewalPage } from "./helpers/renewal-page.mjs";

// 3월 계약은 신고 기한(30일)이 지나 마감됐다. 마감된 달만 세므로 이 날짜라야 잡힌다.
const NOW = new Date("2026-08-26T00:00:00Z");

const lease = (extra = {}) => ({
  sggCd: 11350,
  aptNm: "상계주공",
  excluUseAr: 84.9,
  dealYear: 2026,
  dealMonth: 3,
  monthlyRent: "0",
  preMonthlyRent: "0",
  contractType: "갱신",
  useRRRight: "사용",
  deposit: "90,000",
  preDeposit: "88,000",
  ...extra,
});

/** 갱신 n건과, 견줄 상대가 되는 신규 세 건. 신규가 셋은 있어야 맞물린다. */
const district = (name, renewals) => [
  ...Array.from({ length: renewals }, () => lease({ aptNm: `${name}단지` })),
  ...Array.from({ length: 3 }, () => lease({ aptNm: `${name}단지`, contractType: "신규", deposit: "100,000", preDeposit: "" })),
];

const PAYLOAD = buildPayload({
  byDistrict: {
    // 문턱(맞물린 60건 · 요구권 200건)을 넉넉히 넘는 구와, 양쪽 다 못 넘는 구.
    노원구: district("노원", 250),
    강남구: district("강남", 20),
  },
  now: NOW,
});

const open = (extra = {}) => loadRenewalPage({ renewal: PAYLOAD, ...extra });

test("첫 문단은 빌드가 만든 문장을 그대로 쓴다", async () => {
  const page = await open();
  assert.equal(page.leadText(), PAYLOAD.lead.ko);
  assert.match(page.leadText(), /10\.0% 적게 냅니다/);
});

test("천장 문단은 인상률 평균을 쓰지 않는 이유까지 말한다", async () => {
  const page = await open();
  assert.equal(page.capLeadText(), PAYLOAD.capLead.ko);
  assert.match(page.capLeadText(), /상한 5%/);
});

test("문턱을 못 넘은 구는 비우지 않고 못 넘었다고 적는다", async () => {
  // 빈칸은 자료가 없는 것인지 우리가 안 낸 것인지 구별되지 않는다.
  // 그 구별이 이 사이트가 파는 것이라 값 자리에 이유를 적고 건수는 남긴다.
  const row = PAYLOAD.table.find((r) => r.district === "강남구");
  assert.equal(row.gapMedian, null, "표본이 모자란데 값을 냈다");
  assert.equal(row.gapMatched, 20, "값을 못 낸 이유가 될 건수까지 지웠다");

  const table = (await open()).districtTable();
  assert.match(table, /표본 부족/);
  assert.match(table, /강남구/);
});

test("빌드가 그린 표와 화면이 그린 표가 같다", async () => {
  // 같은 규칙이 프리렌더와 브라우저 양쪽에 있다. 갈라지면 자바스크립트가 붙는 순간
  // 표가 조용히 바뀌는데, 어느 쪽이 맞는지는 아무도 말해 주지 않는다.
  const page = await open();
  assert.equal(page.districtTable(), renewalDistrictsHtml(PAYLOAD));
});

test("영어 화면에 우리가 쓴 한국어가 남지 않는다", async () => {
  // 자치구 이름은 영어 화면에서도 한글 그대로 둔다 - 이 사이트 전체의 관례다
  // (자치구 페이지 영문 요약도 "Apartments in 종로구"라고 쓴다). 그래서 표에서는
  // 이름 칸을 뺀 나머지, 즉 머리글과 우리가 지어 넣은 말만 본다.
  const page = await open();
  page.toggleLang();

  const table = page.districtTable();
  const withoutNames = table.replace(/<td>[가-힣]+구<\/td>/g, "<td></td>");
  assert.doesNotMatch(withoutNames, /[가-힣]/, "영어 표에 한국어가 남았다");
  assert.match(table, /Renewal − new/, "머리글이 안 바뀌었다");
  assert.match(table, /Too few/, "표본 부족 표시가 안 바뀌었다");

  assert.doesNotMatch(page.leadText(), /[가-힣]/, "영어 첫 문단에 한국어가 남았다");
  assert.doesNotMatch(page.capLeadText(), /[가-힣]/, "영어 천장 문단에 한국어가 남았다");
  assert.doesNotMatch(page.districtNote(), /[가-힣]/, "영어 설명에 한국어가 남았다");
});

test("자료가 없으면 없다고 말한다", async () => {
  const page = await loadRenewalPage({});
  assert.match(page.leadText(), /아직 재계약 자료가 없습니다/);
});
