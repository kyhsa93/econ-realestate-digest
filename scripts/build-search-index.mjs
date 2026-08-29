import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUDGET_PAGES } from "./budget-pages.mjs";
import { DISTRICT_PAGES, DISTRICT_SLUGS } from "./district-slugs.mjs";
import { dealFileName } from "./deal-files.mjs";

/**
 * 무엇을 넣어도 받는 검색창이 쓰는 색인.
 *
 * 검색이 세 군데로 쪼개져 있었다 - 첫 화면의 지역 검색, 금리 화면의 상품 검색,
 * 그리고 '실거래 검색'이라는 이름의 화면(정작 검색창은 없고 셀렉트 일곱 개다).
 * 단지명으로 찾으려면 자치구를 먼저 골라야 해서 "래미안"을 서울 전체에서 못 찾았다.
 *
 * 그래서 자치구·예산대·화면·단지를 한 파일에 모은다. 단지가 3,300개쯤인데 이름만
 * 담으면 60KB 안쪽이라 브라우저가 통째로 받아 들고 있어도 된다. 고른 뒤에 그
 * 자치구의 전수 파일 하나만 더 받으면 된다 - 스물다섯 개를 다 받을 이유가 없다.
 */

const root = path.resolve(import.meta.dirname, "..");

const outFile = process.env.SEARCH_INDEX_FILE
  ? path.resolve(process.env.SEARCH_INDEX_FILE)
  : path.join(root, "docs/data/search-index.json");

/** 조건을 넣지 않아도 답이 보이는 화면들. 검색으로 여기까지는 바로 간다. */
export const SCREENS = [
  { text: "아파트 시세", href: "./realestate.html", also: ["시세", "실거래가"] },
  { text: "매매 시세", href: "./apartment-sale.html", also: ["매매"] },
  { text: "전세 시세", href: "./apartment-jeonse.html", also: ["전세", "전세가율"] },
  { text: "월세 시세", href: "./apartment-rent.html", also: ["월세"] },
  { text: "전세 vs 월세", href: "./jeonse-vs-wolse.html", also: ["전환율", "전월세전환율", "월 실부담"] },
  { text: "해제·등기", href: "./cancelled-deals.html", also: ["해제", "취소", "등기", "미등기"] },
  { text: "실거래 검색", href: "./deal-search.html", also: ["조건", "검색"] },
  { text: "정기예금 금리", href: "./deposit-rates.html", also: ["예금", "금리", "이자"] },
  { text: "적금 금리", href: "./saving-rates.html", also: ["적금"] },
  { text: "주택담보대출 금리", href: "./mortgage-rates.html", also: ["주담대", "담보대출", "대출"] },
  { text: "전세자금대출 금리", href: "./rent-loan-rates.html", also: ["전세대출", "전세자금"] },
  { text: "경제·부동산 뉴스", href: "./news.html", also: ["뉴스", "기사"] },
  { text: "숫자를 만드는 방법", href: "./method.html", also: ["집계", "기준", "방법"] },
];

/** 검색어를 맞춰 볼 때 공백과 대소문자는 무시한다. */
export const squash = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, "");

export function staticEntries() {
  const entries = [];

  for (const district of DISTRICT_PAGES) {
    entries.push({
      kind: "district",
      text: district.name,
      href: `./${district.file}`,
      // "강남"으로도 "gangnam"으로도 찾힌다
      also: [district.name.replace(/구$/, ""), DISTRICT_SLUGS[district.name]],
    });
  }

  for (const page of BUDGET_PAGES) {
    entries.push({
      kind: "budget",
      text: `${page.eok}억대 아파트`,
      href: `./${page.file}`,
      also: [`${page.eok}억`, String(page.eok)],
    });
  }

  for (const screen of SCREENS) {
    entries.push({ kind: "screen", text: screen.text, href: screen.href, also: screen.also });
  }

  return entries;
}

/**
 * 단지는 자치구별로 이름만 묶는다.
 *
 * 처음에는 항목마다 {kind, text, district, href}를 담았더니 579KB가 됐다. href의
 * 한글이 퍼센트 인코딩되면서 세 배로 부풀고, 자치구 이름이 3,360번 되풀이됐기
 * 때문이다. 주소는 브라우저가 만들면 되고 자치구는 묶으면 한 번만 적으면 된다.
 */
export function complexesByDistrict(byDistrict) {
  const out = {};

  for (const district of DISTRICT_PAGES) {
    const deals = byDistrict?.[district.name];
    if (!deals?.length) continue;
    const names = new Set();
    for (const deal of deals) {
      const name = String(deal?.apt ?? "").trim();
      if (name) names.add(name);
    }
    // 이름 순으로 고정한다 - 읽어 온 순서대로 담으면 값이 그대로여도 매일 diff가 난다.
    if (names.size) out[district.name] = [...names].sort((a, b) => a.localeCompare(b, "ko"));
  }

  return out;
}

export function buildPayload({ byDistrict, now }) {
  return {
    updatedAt: now.toISOString(),
    entries: staticEntries(),
    complexes: complexesByDistrict(byDistrict),
  };
}

async function readDeals() {
  const byDistrict = {};
  for (const district of DISTRICT_PAGES) {
    const file = path.join(root, "docs/data", dealFileName(DISTRICT_SLUGS[district.name]));
    const json = await readFile(file, "utf8").then(JSON.parse).catch(() => null);
    if (json?.deals?.length) byDistrict[district.name] = json.deals;
  }
  return byDistrict;
}

async function main() {
  const payload = buildPayload({ byDistrict: await readDeals(), now: new Date() });
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));

  const counts = payload.entries.reduce((acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc), {});
  const complexes = Object.values(payload.complexes).reduce((sum, names) => sum + names.length, 0);
  const size = JSON.stringify(payload).length;
  console.log(
    `  검색 색인 자치구 ${counts.district ?? 0} · 예산대 ${counts.budget ?? 0} · 화면 ${counts.screen ?? 0} · ` +
      `단지 ${complexes.toLocaleString("ko-KR")} · ${(size / 1024).toFixed(0)}KB`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`검색 색인 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
