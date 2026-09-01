import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUDGET_PAGES, BUDGET_PAGE_EOK, budgetPageFile } from "./budget-pages.mjs";
import { applyPrerender, budgetBodyHtml, budgetFactsHtml, districtLinksHtml } from "./prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");
const REALESTATE_PATH = path.join(root, "docs/realestate.html");
const BASE_URL = "https://kyhsa93.github.io/jipgye/";

const BASE_TITLE = "서울 아파트 시세 - 25개 자치구 실거래가";
const BASE_DESCRIPTION =
  "국토교통부 실거래 신고 자료로 서울 25개 자치구의 아파트 매매·전세·월세 시세를 평당가와 84㎡ 환산가로 함께 보여줍니다. 매일 갱신합니다.";
const BASE_TITLE_KEY = 'title: "서울 아파트 시세",';
const BASE_TITLE_KEY_EN = 'title: "Seoul Apartment Prices",';

function replaceOnce(html, needle, replacement, what) {
  if (!html.includes(needle)) throw new Error(`${what}를 찾지 못했습니다: ${needle.slice(0, 60)}`);
  return html.replace(needle, replacement);
}

function navHtml(page) {
  const links = [];
  if (BUDGET_PAGE_EOK.includes(page.eok - 1)) {
    links.push(`<a href="./${budgetPageFile(page.eok - 1)}">${page.eok - 1}억대</a>`);
  }
  if (BUDGET_PAGE_EOK.includes(page.eok + 1)) {
    links.push(`<a href="./${budgetPageFile(page.eok + 1)}">${page.eok + 1}억대</a>`);
  }
  links.push(`<a href="./deal-search.html?budget=${page.eok}">조건을 더해 찾기</a>`);
  return links.join("");
}

export function buildBudgetPage(baseHtml, page, budget, rates = null) {
  const band = (budget?.bands ?? []).find((b) => b.min10k === page.min10k) ?? null;
  const body = budgetBodyHtml(band, budget?.periods, rates);
  if (!body) return null;

  let html = baseHtml;

  html = html.replaceAll(BASE_TITLE, page.title);
  html = html.replaceAll(BASE_DESCRIPTION, page.description);
  html = html.replaceAll(`${BASE_URL}realestate.html`, `${BASE_URL}${page.file}`);
  html = replaceOnce(html, BASE_TITLE_KEY, `title: ${JSON.stringify(page.title)},`, "한국어 제목 사전");
  html = replaceOnce(html, BASE_TITLE_KEY_EN, `title: ${JSON.stringify(page.titleEn)},`, "영어 제목 사전");

  html = replaceOnce(
    html,
    '<link rel="canonical"',
    `<meta name="budget-band" content="${page.min10k}">\n<link rel="canonical"`,
    "정규 URL 링크"
  );

  html = replaceOnce(
    html,
    '<section id="budget-section" hidden>',
    '<section id="budget-section">',
    "예산 섹션"
  );

  // 스물다섯 줄짜리 자치구 시세표는 여기 있을 것이 아니다.
  //
  // 이 표는 realestate.html이 원본인데 예산 페이지 열여덟 장에 그대로 복사돼 나갔다.
  // 페이지 본문의 절반이 옆 페이지와 글자까지 같아지는 가장 큰 원인이었고, "10억대로
  // 뭘 살 수 있나"에 답하지도 않는다. 표는 접고 자치구 링크만 남긴다 — 링크가 있어야
  // 자치구 페이지로 가는 길이 끊기지 않는다.
  html = replaceOnce(
    html,
    '<section id="district-section">',
    '<section id="district-section" hidden>',
    "자치구 시세 섹션"
  );

  return applyPrerender(html, {
    budgetResult: body,
    budgetFactsKo: budgetFactsHtml(band, "ko"),
    budgetFactsEn: budgetFactsHtml(band, "en"),
    budgetPageNav: navHtml(page),
    // 섹션을 접는 것만으로는 부족하다. hidden은 눈에만 안 보일 뿐 스물다섯 줄이
    // HTML에는 그대로 실려 나가고, 중복을 재면 접기 전과 같은 값이 나온다.
    realestateHead: "",
    realestateTable: "",
    districtLinks: districtLinksHtml(null, "자치구별 시세 보기"),
  });
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

async function main() {
  const budget = await readJson(path.join(root, "docs/data/budget-deals.json"));
  // 금리가 아직 없는 날에도 예산 페이지는 나와야 한다. 월 상환액 문단만 빠진다.
  const rates = await readJson(path.join(root, "docs/data/rates.json"));
  if (!budget?.bands?.length) {
    console.log("  예산 데이터가 없습니다 - 예산 페이지를 만들지 않습니다");
    return;
  }

  const baseHtml = await readFile(REALESTATE_PATH, "utf8");


  let created = 0;
  let updated = 0;
  const skipped = [];

  for (const page of BUDGET_PAGES) {
    const html = buildBudgetPage(baseHtml, page, budget, rates);
    if (!html) {
      skipped.push(`${page.eok}억대`);
      continue;
    }

    const target = path.join(root, "docs", page.file);
    const before = await readFile(target, "utf8").catch(() => null);
    if (before === html) continue;
    await writeFile(target, html);
    if (before === null) created += 1;
    else updated += 1;
  }

  console.log(`  예산 페이지 (생성 ${created} · 갱신 ${updated})${skipped.length ? ` · 거래 없어 건너뜀: ${skipped.join(", ")}` : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`예산 페이지 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
