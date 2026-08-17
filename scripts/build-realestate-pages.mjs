import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICT_PAGES } from "./district-slugs.mjs";
import {
  applyPrerender,
  districtLinksHtml,
  districtSummaryHtml,
  realestateHeadHtml,
  realestateOverallHtml,
  realestateTableHtml,
} from "./prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");
const SOURCE_PATH = path.join(root, "docs/realestate.html");
const BASE_URL = "https://kyhsa93.github.io/econ-realestate-digest/";

const BASE_TITLE = "서울 아파트 시세 - 25개 자치구 실거래가";
const BASE_DESCRIPTION =
  "국토교통부 실거래 신고 자료로 서울 25개 자치구의 아파트 매매·전세·월세 시세를 평당가와 84㎡ 환산가로 함께 보여줍니다. 매일 갱신합니다.";

const BASE_TITLE_KEY = 'title: "서울 아파트 시세",';
const BASE_TITLE_KEY_EN = 'title: "Seoul Apartment Prices",';

export const REALESTATE_PAGES = [
  {
    kind: "sale",
    file: "apartment-sale.html",
    title: "서울 아파트 매매 시세 - 자치구별 평당가·84㎡ 환산",
    description:
      "서울 25개 자치구 아파트 매매 실거래가를 평당가와 84㎡ 환산가로 비교합니다. 국토교통부 신고 자료를 매일 갱신하며, 신고 건수가 적은 지역은 평균을 내지 않습니다.",
    titleEn: "Seoul Apartment Sale Prices by District",
  },
  {
    kind: "jeonse",
    file: "apartment-jeonse.html",
    title: "서울 아파트 전세 시세 - 자치구별 평당 보증금·84㎡ 환산",
    description:
      "서울 25개 자치구 아파트 전세 실거래 보증금을 평당가와 84㎡ 환산가로 비교합니다. 국토교통부 신고 자료를 매일 갱신하며, 신고 건수가 적은 지역은 평균을 내지 않습니다.",
    titleEn: "Seoul Apartment Jeonse Prices by District",
  },
  {
    kind: "wolse",
    file: "apartment-rent.html",
    title: "서울 아파트 월세 시세 - 자치구별 보증금·월세",
    description:
      "서울 25개 자치구 아파트 월세 실거래 보증금과 월세를 비교합니다. 국토교통부 신고 자료를 매일 갱신하며, 신고 건수가 적은 지역은 평균을 내지 않습니다.",
    titleEn: "Seoul Apartment Monthly Rent by District",
  },
];

function replaceOnce(html, needle, replacement, what) {
  if (!html.includes(needle)) throw new Error(`${what}를 찾지 못했습니다: ${needle.slice(0, 60)}`);
  return html.replace(needle, replacement);
}

export function buildRealestatePage(baseHtml, page, realestate) {
  let html = baseHtml;

  html = html.replaceAll(BASE_TITLE, page.title);
  html = html.replaceAll(BASE_DESCRIPTION, page.description);
  html = html.replaceAll(`${BASE_URL}realestate.html`, `${BASE_URL}${page.file}`);

  html = replaceOnce(html, BASE_TITLE_KEY, `title: ${JSON.stringify(page.title)},`, "한국어 제목 사전");
  html = replaceOnce(html, BASE_TITLE_KEY_EN, `title: ${JSON.stringify(page.titleEn)},`, "영어 제목 사전");

  html = replaceOnce(
    html,
    '<link rel="canonical"',
    `<meta name="realestate-kind" content="${page.kind}">\n<link rel="canonical"`,
    "정규 URL 링크"
  );

  html = replaceOnce(
    html,
    '<a href="./realestate.html" data-re-page="all" aria-current="page">',
    '<a href="./realestate.html" data-re-page="all">',
    "시세 전체 링크"
  );

  html = replaceOnce(
    html,
    `<a href="./${page.file}" data-re-page="${page.kind}">`,
    `<a href="./${page.file}" data-re-page="${page.kind}" aria-current="page">`,
    "거래 유형 링크"
  );

  return applyPrerender(html, {
    realestateOverall: realestateOverallHtml(realestate, page.kind),
    realestateHead: realestateHeadHtml(page.kind),
    realestateTable: realestateTableHtml(realestate, page.kind),
    districtLinks: "",
    districtSummaryKo: "",
    districtSummaryEn: "",
  });
}

export function buildDistrictPage(baseHtml, district, realestate) {
  const title = `${district.name} 아파트 시세 - 매매·전세·월세 실거래가`;
  const description =
    `${district.name} 아파트 매매·전세·월세 실거래가를 평당가와 84㎡ 환산가로 보여줍니다. ` +
    "국토교통부 신고 자료를 매일 갱신하며, 신고 건수가 적으면 지난달 기준으로 표시합니다.";
  const titleEn = `${district.name} Apartment Prices - Sale, Jeonse & Rent`;

  let html = baseHtml;
  html = html.replaceAll(BASE_TITLE, title);
  html = html.replaceAll(BASE_DESCRIPTION, description);
  html = html.replaceAll(`${BASE_URL}realestate.html`, `${BASE_URL}${district.file}`);

  html = replaceOnce(html, BASE_TITLE_KEY, `title: ${JSON.stringify(title)},`, "한국어 제목 사전");
  html = replaceOnce(html, BASE_TITLE_KEY_EN, `title: ${JSON.stringify(titleEn)},`, "영어 제목 사전");
  html = replaceOnce(
    html,
    '<link rel="canonical"',
    `<meta name="realestate-district" content="${district.name}">\n<link rel="canonical"`,
    "정규 URL 링크"
  );

  html = replaceOnce(
    html,
    '<a href="./realestate.html" data-re-page="all" aria-current="page">',
    '<a href="./realestate.html" data-re-page="all">',
    "시세 전체 링크"
  );

  return applyPrerender(html, {
    realestateOverall: realestateOverallHtml(realestate, null, district.name),
    realestateHead: realestateHeadHtml(null, district.name),
    realestateTable: realestateTableHtml(realestate, null, district.name),
    districtLinks: districtLinksHtml(district.name),
    districtSummaryKo: districtSummaryHtml(realestate, district.name, "ko"),
    districtSummaryEn: districtSummaryHtml(realestate, district.name, "en"),
  });
}

async function main() {
  const [baseHtml, realestate] = await Promise.all([
    readFile(SOURCE_PATH, "utf8"),
    readFile(path.join(root, "docs/data/realestate.json"), "utf8").then(JSON.parse),
  ]);

  for (const page of REALESTATE_PAGES) {
    await write(page.file, buildRealestatePage(baseHtml, page, realestate));
  }

  let created = 0;
  let updated = 0;
  for (const district of DISTRICT_PAGES) {
    const result = await write(district.file, buildDistrictPage(baseHtml, district, realestate), true);
    if (result === "생성") created += 1;
    if (result === "갱신") updated += 1;
  }
  console.log(`  자치구 페이지 ${DISTRICT_PAGES.length}개 (생성 ${created} · 갱신 ${updated})`);

  async function write(file, html, quiet = false) {
    const target = path.join(root, "docs", file);
    const before = await readFile(target, "utf8").catch(() => null);
    if (before === html) {
      if (!quiet) console.log(`  docs/${file} 변경 없음`);
      return "변경 없음";
    }
    await writeFile(target, html);
    const what = before === null ? "생성" : "갱신";
    if (!quiet) console.log(`  docs/${file} ${what}`);
    return what;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`부동산 페이지 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
