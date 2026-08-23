import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPrerender, jsonForScript, rateFactsData, rateFactsHtml, ratesHeadHtml, ratesHtml } from "./prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");
const RATES_PATH = path.join(root, "docs/rates.html");
const BASE_URL = "https://kyhsa93.github.io/econ-realestate-digest/";

const BASE_TITLE = "예금·적금·대출 금리 비교";
const BASE_DESCRIPTION =
  "금융감독원 금융상품통합비교공시 데이터를 매일 갱신해 은행·저축은행 정기예금과 적금 금리, 주택담보대출·전세자금대출 금리를 한 표에서 비교합니다.";

export const RATE_PAGES = [
  {
    category: "deposit",
    file: "deposit-rates.html",
    title: "정기예금 금리 비교 - 은행·저축은행 12개월",
    description:
      "은행·저축은행 정기예금 금리를 12개월 기준 최고금리 순으로 비교합니다. 금융감독원 금융상품통합비교공시 데이터를 매일 갱신합니다.",
  },
  {
    category: "saving",
    file: "saving-rates.html",
    title: "적금 금리 비교 - 은행·저축은행 12개월",
    description:
      "은행·저축은행 적금 금리를 12개월 기준 최고금리 순으로 비교합니다. 금융감독원 금융상품통합비교공시 데이터를 매일 갱신합니다.",
  },
  {
    category: "mortgage",
    file: "mortgage-rates.html",
    title: "주택담보대출 금리 비교 - 은행별 최저금리",
    description:
      "은행 주택담보대출 금리를 최저금리 순으로 비교합니다. 금리 유형과 금리 범위, 지난달 평균금리를 함께 보여주며 매일 갱신합니다.",
  },
  {
    category: "rentLoan",
    file: "rent-loan-rates.html",
    title: "전세자금대출 금리 비교 - 은행별 최저금리",
    description:
      "은행 전세자금대출 금리를 최저금리 순으로 비교합니다. 금리 유형과 금리 범위, 지난달 평균금리를 함께 보여주며 매일 갱신합니다.",
  },
];

function replaceOnce(html, needle, replacement, what) {
  if (!html.includes(needle)) throw new Error(`${what}를 찾지 못했습니다: ${needle.slice(0, 60)}`);
  return html.replace(needle, replacement);
}

export function buildRatePage(baseHtml, page, rates) {
  let html = baseHtml;

  html = html.replaceAll(BASE_TITLE, page.title);
  html = html.replaceAll(BASE_DESCRIPTION, page.description);

  html = html.replaceAll(`${BASE_URL}rates.html`, `${BASE_URL}${page.file}`);

  html = replaceOnce(
    html,
    '<link rel="canonical"',
    `<meta name="rates-category" content="${page.category}">\n<link rel="canonical"`,
    "정규 URL 링크"
  );

  html = replaceOnce(
    html,
    '<a id="nav-rates" href="./rates.html" class="active" aria-current="page">',
    '<a id="nav-rates" href="./rates.html" class="active">',
    "금리 비교 내비게이션"
  );

  html = replaceOnce(
    html,
    `<a href="./${page.file}" data-rate-page="${page.category}">`,
    `<a href="./${page.file}" data-rate-page="${page.category}" aria-current="page">`,
    "상품군 링크"
  );

  return applyPrerender(html, {
    rates: ratesHtml(rates, { category: page.category }),
    ratesHead: ratesHeadHtml(page.category),
    // 이 페이지가 처음 그리는 상품군의 문단은 HTML에 구워 넣고, 나머지 세 개는 탭을
    // 눌렀을 때 쓰라고 한 덩이로 같이 넘긴다.
    rateFactsKo: rateFactsHtml(rates, page.category, "ko"),
    rateFactsEn: rateFactsHtml(rates, page.category, "en"),
    rateFactsData: jsonForScript(rateFactsData(rates)),
  });
}

async function main() {
  const [baseHtml, rates] = await Promise.all([
    readFile(RATES_PATH, "utf8"),
    readFile(path.join(root, "docs/data/rates.json"), "utf8").then(JSON.parse),
  ]);

  for (const page of RATE_PAGES) {
    const html = buildRatePage(baseHtml, page, rates);
    const target = path.join(root, "docs", page.file);
    const before = await readFile(target, "utf8").catch(() => null);
    if (before === html) {
      console.log(`  docs/${page.file} 변경 없음`);
      continue;
    }
    await writeFile(target, html);
    console.log(`  docs/${page.file} ${before === null ? "생성" : "갱신"}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`금리 페이지 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
