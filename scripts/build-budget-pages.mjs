// 예산 구간마다 착지 페이지를 찍는다(budget-8eok.html 등).
//
// 왜 나누나: "8억으로 살 수 있는 서울 아파트"처럼 예산 단위로 검색한다. 시세 페이지의
// 입력창은 이미 답을 갖고 있지만, 검색 결과에서 그 화면으로 들어올 길이 없다. 자치구
// 페이지·거래 유형 페이지를 찍은 것과 같은 이유다.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUDGET_PAGES, BUDGET_PAGE_EOK, budgetPageFile } from "./budget-pages.mjs";
import { applyPrerender, budgetBodyHtml, budgetLinksHtml } from "./prerender.mjs";

const root = path.resolve(import.meta.dirname, "..");
const REALESTATE_PATH = path.join(root, "docs/realestate.html");
const BASE_URL = "https://kyhsa93.github.io/econ-realestate-digest/";

// 문서 제목과 화면 사전의 제목은 값이 다르다(사전 쪽이 짧다). 문서 제목을 먼저 통째로
// 바꾸면서 사전 키까지 같이 갈아버리면 그다음 치환이 대상을 못 찾는다 - 거래 유형
// 페이지가 쓰는 값을 그대로 쓴다.
const BASE_TITLE = "서울 아파트 시세 - 25개 자치구 실거래가";
const BASE_DESCRIPTION =
  "국토교통부 실거래 신고 자료로 서울 25개 자치구의 아파트 매매·전세·월세 시세를 평당가와 84㎡ 환산가로 함께 보여줍니다. 매일 갱신합니다.";
const BASE_TITLE_KEY = 'title: "서울 아파트 시세",';
const BASE_TITLE_KEY_EN = 'title: "Seoul Apartment Prices",';

function replaceOnce(html, needle, replacement, what) {
  if (!html.includes(needle)) throw new Error(`${what}를 찾지 못했습니다: ${needle.slice(0, 60)}`);
  return html.replace(needle, replacement);
}

// 옆 칸으로 가는 길. 예산은 한 번에 정해지는 값이 아니라 "조금 더 쓰면 뭐가 되나"를
// 오가며 잡는 값이라, 정적 페이지에서도 이 이동이 있어야 한다.
function navHtml(page) {
  const links = [];
  if (BUDGET_PAGE_EOK.includes(page.eok - 1)) {
    links.push(`<a href="./${budgetPageFile(page.eok - 1)}">${page.eok - 1}억대</a>`);
  }
  if (BUDGET_PAGE_EOK.includes(page.eok + 1)) {
    links.push(`<a href="./${budgetPageFile(page.eok + 1)}">${page.eok + 1}억대</a>`);
  }
  links.push(`<a href="./realestate.html?budget=${page.eok}">다른 예산으로 찾기</a>`);
  return links.join("");
}

export function buildBudgetPage(baseHtml, page, budget, links = budgetLinksHtml()) {
  const band = (budget?.bands ?? []).find((b) => b.min10k === page.min10k) ?? null;
  const body = budgetBodyHtml(band, budget?.periods);
  if (!body) return null;

  let html = baseHtml;

  html = html.replaceAll(BASE_TITLE, page.title);
  html = html.replaceAll(BASE_DESCRIPTION, page.description);
  html = html.replaceAll(`${BASE_URL}realestate.html`, `${BASE_URL}${page.file}`);
  html = replaceOnce(html, BASE_TITLE_KEY, `title: ${JSON.stringify(page.title)},`, "한국어 제목 사전");
  html = replaceOnce(html, BASE_TITLE_KEY_EN, `title: ${JSON.stringify(page.titleEn)},`, "영어 제목 사전");

  // 화면은 이 값으로 자기가 어느 구간을 다루는 페이지인지 안다.
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

  return applyPrerender(html, {
    budgetResult: body,
    budgetPageNav: navHtml(page),
    budgetLinks: links,
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
  if (!budget?.bands?.length) {
    console.log("  예산 데이터가 없습니다 - 예산 페이지를 만들지 않습니다");
    return;
  }

  const sourceHtml = await readFile(REALESTATE_PATH, "utf8");

  // 링크로 걸 목록을 먼저 정한다. 거래가 없어 못 만드는 구간까지 링크하면 404가 되고,
  // 예전에 찍어둔 페이지는 살아 있으므로 그것도 목록에 남긴다.
  const bandOf = (page) => (budget.bands ?? []).find((b) => b.min10k === page.min10k) ?? null;
  const exists = async (page) =>
    Boolean(await readFile(path.join(root, "docs", page.file), "utf8").catch(() => null));

  const linked = [];
  for (const page of BUDGET_PAGES) {
    if (bandOf(page) || (await exists(page))) linked.push(page);
  }
  const links = budgetLinksHtml(linked);

  // 링크를 먼저 시세 페이지에 심고, 그 결과를 예산 페이지의 원본으로 쓴다. 순서를 뒤집으면
  // 예산 페이지에는 빈 링크 자리가 남고, 시세 페이지에서 찍어내는 자치구·거래 유형 페이지와도
  // 내용이 어긋난다(그 어긋남을 "커밋된 페이지가 지금 찍은 결과와 같다" 테스트가 잡아냈다).
  const baseHtml = applyPrerender(sourceHtml, { budgetLinks: links });
  if (baseHtml !== sourceHtml) await writeFile(REALESTATE_PATH, baseHtml);

  let created = 0;
  let updated = 0;
  const skipped = [];

  for (const page of BUDGET_PAGES) {
    const html = buildBudgetPage(baseHtml, page, budget, links);
    if (!html) {
      // 거래가 없는 구간은 페이지를 갈아엎지 않고 그대로 둔다. 한 번 만든 주소는
      // 살려두되, 그날 데이터가 얇다고 빈 화면으로 덮어쓰지는 않는다.
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
