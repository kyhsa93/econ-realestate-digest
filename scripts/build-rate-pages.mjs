// 상품군별 금리 페이지(정기예금/적금/주택담보대출/전세자금대출)를 rates.html에서 찍어낸다.
//
// 왜 페이지를 나누나: 사람들이 검색하는 말은 "금리 비교"가 아니라 "정기예금 금리 비교",
// "전세자금대출 금리"처럼 상품군 단위다. 탭은 버튼이라 크롤러에겐 링크가 아니고, 한 URL로는
// 검색 의도 하나에만 걸린다. 페이지를 나누면 의도마다 착지점이 생기고 그게 쌓인다.
//
// 왜 복제하지 않고 찍어내나: rates.html은 CSS·스크립트가 전부 인라인인 60KB짜리 단일 파일이라
// 손으로 복제하면 다음 수정 때 네 벌이 어긋난다. 원본은 하나로 두고 제목·설명·정규 URL·첫 탭·
// 정적 표만 갈아끼운다. 첫 탭은 <meta name="rates-category">로만 갈리고 로직은 공유한다.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPrerender, ratesHeadHtml, ratesHtml } from "./prerender.mjs";

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

  // 제목·설명은 <title>, og, twitter, 그리고 스크립트 안의 사전까지 같은 문자열이다.
  // 사전까지 안 바꾸면 하이드레이션 뒤에 클라이언트가 제목을 원래대로 되돌려놓는다.
  html = html.replaceAll(BASE_TITLE, page.title);
  html = html.replaceAll(BASE_DESCRIPTION, page.description);

  // 정규 URL과 og:url만 바꾼다(og:image 같은 다른 절대 경로는 그대로 둔다).
  html = html.replaceAll(`${BASE_URL}rates.html`, `${BASE_URL}${page.file}`);

  html = replaceOnce(
    html,
    '<link rel="canonical"',
    `<meta name="rates-category" content="${page.category}">\n<link rel="canonical"`,
    "정규 URL 링크"
  );

  // 상품군별 페이지에서도 섹션은 여전히 '금리 비교'라 활성 표시(class)는 남기고,
  // 현재 페이지를 가리키는 aria-current만 뗀다(현재 페이지는 이 파일이 아니다).
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
