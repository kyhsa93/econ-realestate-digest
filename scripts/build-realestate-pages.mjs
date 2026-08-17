// 거래 유형별 시세 페이지(아파트 매매/전세/월세)를 realestate.html에서 찍어낸다.
//
// 왜 나누나: 상품군별 금리 페이지와 같은 이유다. 사람들이 검색하는 말은 "부동산"이
// 아니라 "서울 아파트 매매 시세", "강남 전세 시세"처럼 거래 유형 단위이고, 한 페이지에
// 세 유형을 다 담으면 어느 검색 의도에도 정확히 걸리지 않는다. 날짜별 아카이브와 달리
// 페이지 수가 늘지 않으면서 의도마다 착지점이 생긴다.
//
// index.html에도 같은 표가 있지만 거기는 종합 대시보드의 한 섹션이라 제목·설명이
// "데일리 다이제스트"다. 검색 결과에 뜨는 제목이 곧 클릭 이유이므로 착지 페이지는
// 자기 제목을 가져야 한다.
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

// 화면 사전(T.ko/T.en)의 제목도 같이 바꿔야 한다. 안 그러면 하이드레이션 뒤에
// 클라이언트가 제목을 원래대로 되돌려놓는다(금리 페이지에서 겪은 함정).
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

  // 화면 사전의 제목. 생성된 페이지는 자기 유형의 제목만 쓰므로 세 유형 키를 다 바꾸지
  // 않고 기본 title만 바꾸면 된다(kind가 정해지면 titleSale/Jeonse/Wolse를 쓴다).
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
    // 이 페이지도 25개 구 표를 그대로 갖고 있고 이름이 곧 링크다. 같은 목록을 아래
    // 한 번 더 두지 않는다.
    districtLinks: "",
    districtSummaryKo: "",
    districtSummaryEn: "",
  });
}

// 자치구별 페이지. "강남구 아파트 시세"처럼 지역 단위로 검색하는 사람에게 착지점을
// 만든다. 거래 유형 페이지와 달리 한 지역의 세 유형을 한꺼번에 보여주므로 kind는 없다.
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

  // 이 페이지는 거래 유형 축이 아니므로 2층 내비게이션에서 현재 표시를 넘긴다.
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
  // 25줄을 매번 찍으면 로그에서 다른 게 안 보인다.
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
