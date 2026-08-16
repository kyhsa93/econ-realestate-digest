// 크롤러가 받는 HTML에 그날 내용을 심는다.
//
// 이 페이지는 data/*.json을 클라이언트에서 받아 그리기 때문에, 손대지 않으면 초기
// HTML에는 "불러오는 중..."밖에 없다. 구글은 JS를 렌더링하지만 렌더 큐가 밀려서
// 하루 4번 바뀌는 내용과 궁합이 나쁘고, 네이버 Yeti와 Bing은 JS 렌더링이 약하다.
//
// 심은 내용은 화면 동작에 영향을 주지 않는다 - 클라이언트가 같은 컨테이너를
// innerHTML로 갈아끼우기 때문에, 데이터를 받은 뒤에는 어차피 전부 다시 그려진다.
// 여기 있는 건 "받기 전에도 글자가 있게" 하려는 것뿐이다.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const INDEX_PATH = path.join(root, "docs/index.html");
const RATES_PATH = path.join(root, "docs/rates.html");
const NEWS_PATH = path.join(root, "docs/news.html");
const DATA_DIR = path.join(root, "docs/data");

// 자치구 평당가는 신고 건수가 적으면 "그 구의 시세"가 아니라 "그 아파트 한 채의
// 가격"이라 화면에서 가린다. 정적 HTML은 검색 결과에 그대로 실릴 수 있으니
// 같은 기준을 반드시 지켜야 한다.
export const MIN_SAMPLE = 5;
const MAX_DISTRICTS = 10;

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function summaryHtml(summary) {
  const highlights = (summary?.highlights ?? []).filter((h) => h.textKo);
  const categories = (summary?.categories ?? []).filter((c) => c.lineKo);
  if (!highlights.length && !categories.length) return null;

  // 핵심 기사가 그날 페이지에서 가장 알맹이 있는 문단이다. 크롤러가 받는
  // HTML에서 빠지면 검색 결과에는 분야별 한 줄 요약만 남는다.
  return [
    ...highlights.map((h) => `<p><strong>${escapeHtml(h.title)}</strong> ${escapeHtml(h.textKo)}</p>`),
    ...categories.map((c) => `<p><strong>${escapeHtml(c.name)}</strong> ${escapeHtml(c.lineKo)}</p>`),
  ].join("");
}

export function marketHtml(market) {
  if (!market) return null;
  const rows = [];

  if (market.kospi?.value) {
    const change = market.kospi.change ? `${escapeHtml(market.kospi.change)}` : "-";
    rows.push(["코스피", escapeHtml(market.kospi.value), change]);
  }
  if (typeof market.usdKrw?.value === "number") {
    rows.push(["원/달러 환율", `${market.usdKrw.value.toFixed(2)}원`, "-"]);
  }
  if (market.baseRate?.value) {
    rows.push(["기준금리", `${escapeHtml(market.baseRate.value)}%`, escapeHtml(market.baseRate.effectiveFrom ?? "-")]);
  }

  if (!rows.length) return null;
  // 좁은 화면 카드 배치가 data-label을 읽는다. 클라이언트 렌더와 같은 라벨을 붙인다.
  return rows
    .map(
      ([name, value, change]) =>
        `<tr><td>${name}</td><td data-label="값">${value}</td><td data-label="증감">${change}</td></tr>`
    )
    .join("");
}

const man = (value) => `${Number(value).toLocaleString("ko-KR")}만원`;

// 클라이언트가 값 옆에 붙이는 증감·건수까지 같이 그린다. 안 그리면 데이터를 받는
// 순간 셀 높이가 바뀌면서 표 아래가 통째로 밀린다.
const changeText = (change) => {
  if (!change || typeof change.value10k !== "number") return "";
  const sign = change.value10k > 0 ? "+" : change.value10k < 0 ? "-" : "";
  return ` <span class="change">${sign}${Math.abs(change.value10k).toLocaleString("ko-KR")}만</span>`;
};
const countText = (metric) =>
  typeof metric?.transactionCount === "number"
    ? ` <span class="count">${metric.transactionCount.toLocaleString("ko-KR")}건</span>`
    : "";
const enough = (metric) => Boolean(metric) && (metric.transactionCount ?? 0) >= MIN_SAMPLE;

// 매매·전세는 평당가, 월세는 보증금/월세라 셀 모양이 다르다(화면과 같은 구성).
const saleCell = (sale) =>
  enough(sale) && sale.avgPricePerPyeong10k
    ? `${man(sale.avgPricePerPyeong10k)}${changeText(sale.change)}${countText(sale)}`
    : "-";
const jeonseCell = (jeonse) =>
  enough(jeonse) && jeonse.avgDepositPerPyeong10k
    ? `${man(jeonse.avgDepositPerPyeong10k)}${changeText(jeonse.change)}${countText(jeonse)}`
    : "-";
const wolseCell = (wolse) =>
  enough(wolse) && wolse.avgDeposit10k
    ? `${man(wolse.avgDeposit10k)} / 월 ${man(wolse.avgMonthlyRent10k)}${countText(wolse)}`
    : "-";

export function realestateHtml(realestate) {
  if (!realestate?.overall) return null;

  const districts = (realestate.districts ?? [])
    .filter((d) => (d.sale?.transactionCount ?? 0) >= MIN_SAMPLE)
    .sort((a, b) => (b.sale?.avgPricePerPyeong10k ?? 0) - (a.sale?.avgPricePerPyeong10k ?? 0))
    .slice(0, MAX_DISTRICTS);

  const row = (name, data) =>
    `<tr><td>${escapeHtml(name)}</td>` +
    `<td data-label="매매">${saleCell(data.sale)}</td>` +
    `<td data-label="전세">${jeonseCell(data.jeonse)}</td>` +
    `<td data-label="월세">${wolseCell(data.wolse)}</td></tr>`;

  return [row("서울 전체", realestate.overall), ...districts.map((d) => row(d.name, d))].join("");
}

// 기사에 붙은 우리 데이터(자치구 실거래가·현재 금리·지수). news-context.mjs가
// news.json에 넣어둔 값을 그대로 그린다. 화면(news.html·index.html)의 newsContextHtml과
// 같은 마크업이어야 한다 - 테스트가 두 결과를 직접 대조한다.
export function newsContextHtml(context) {
  if (!context?.length) return "";
  return (
    `<div class="news-context">` +
    context
      .map(
        (c) =>
          `<a class="context-chip" href="${escapeHtml(c.href)}">` +
          `<span class="context-label">${escapeHtml(c.label)}</span>` +
          `<span class="context-value">${escapeHtml(c.value)}</span></a>`
      )
      .join("") +
    `</div>`
  );
}

// 클라이언트가 그리는 마크업과 구조를 맞춘다. 다르면 데이터를 받는 순간 목록 높이가
// 바뀌면서 화면이 밀린다(광고가 붙은 페이지라 이 밀림은 수익에도 영향을 준다).
// 상대 시간("3시간 전")만은 만든 시점에 좌우돼서 넣을 수 없으므로, 같은 줄에
// 매체 이름만 넣어 줄 수를 맞춘다.
export function newsHtml(news) {
  const items = news?.items ?? [];
  if (!items.length) return null;
  return items
    .map(
      (item) =>
        `<li class="news-item">` +
        `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>` +
        `<div class="news-meta">${escapeHtml(item.source ?? "")}</div>` +
        (item.preview ? `<div class="news-preview">${escapeHtml(item.preview)}</div>` : "") +
        newsContextHtml(item.context) +
        `</li>`
    )
    .join("");
}

// news.html과 거기서 찍어낸 카테고리 페이지용. 화면 렌더와 같은 구성으로 만든다.
// category가 null이면 전체.
export function newsSummaryHtml(summary, category = null) {
  const all = (summary?.categories ?? []).filter((c) => c.lineKo);
  const shown = category ? all.filter((c) => c.key === category) : all;
  if (!shown.length) return null;
  return shown
    .map((c) => `<p><strong>${escapeHtml(c.name)}</strong> ${escapeHtml(c.lineKo)}</p>`)
    .join("");
}

export function newsListHtml(news, category = null) {
  const all = news?.items ?? [];
  const items = category ? all.filter((item) => item.category === category) : all;
  if (!items.length) return null;

  // 상대 시간("3시간 전")은 만든 시점에 좌우돼서 데이터가 그대로여도 결과가 달라진다.
  // 정적 HTML엔 매체 이름만 넣고, 시간은 클라이언트가 그린다.
  return items
    .map(
      (item) =>
        `<li class="news-item">` +
        `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>` +
        `<div class="news-meta">${escapeHtml(item.source ?? "")}</div>` +
        newsContextHtml(item.context) +
        `</li>`
    )
    .join("");
}

// 금리 페이지는 각 페이지의 첫 화면만 심는다. 안 보이는 탭까지 숨겨서 심으면
// 화면에 없는 내용을 크롤러에만 보여주는 셈이 된다.
//
// 상품 선택·정렬 규칙은 rates.html의 visibleRows와 같아야 한다 - 다르면 검색 결과에
// 뜨는 순서와 실제 화면이 어긋난다. 테스트가 실제 렌더 결과와 직접 대조한다.
const RATES_TERM = 12;
const RATES_ROWS = 20;
const SAVING_CATEGORIES = new Set(["deposit", "saving"]);

const rate = (value) => (typeof value === "number" ? `${value.toFixed(2)}%` : "-");
const rateRange = (min, max) =>
  typeof min === "number" && typeof max === "number" ? `${min.toFixed(2)}~${max.toFixed(2)}%` : rate(min ?? max);

export function ratesHeadHtml(category = "deposit") {
  return SAVING_CATEGORIES.has(category)
    ? "<tr><th>상품</th><th>기본금리</th><th>최고금리</th></tr>"
    : "<tr><th>상품</th><th>금리 유형</th><th>금리(최저~최고)</th><th>평균</th></tr>";
}

export function ratesHtml(rates, { category = "deposit", limit = RATES_ROWS } = {}) {
  const products = rates?.[category] ?? [];
  if (!products.length) return null;

  const saving = SAVING_CATEGORIES.has(category);
  const key = saving ? "maxRate" : "min";
  const asc = !saving; // 예적금은 높은 금리가, 대출은 낮은 금리가 위로 온다

  const rows = [];
  for (const product of products) {
    let best = null;
    let bestValue = null;
    let fallback = null;
    for (const option of product.options ?? []) {
      if (saving && option.term !== RATES_TERM) continue;
      fallback ??= option;
      const value = option[key];
      if (value === null || value === undefined) continue;
      if (best === null || (asc ? value < bestValue : value > bestValue)) {
        best = option;
        bestValue = value;
      }
    }
    if (best) rows.push({ product, option: best, sort: bestValue });
    else if (fallback) rows.push({ product, option: fallback, sort: null });
  }

  // 정렬할 값이 없는 상품은 빼지 않고 맨 아래로 보낸다(화면과 같은 규칙).
  rows.sort((a, b) => {
    if (a.sort === null || b.sort === null) return (a.sort === null) - (b.sort === null);
    return asc ? a.sort - b.sort : b.sort - a.sort;
  });

  if (!rows.length) return null;

  const productCell = (product) =>
    `<td><div class="product-name">${escapeHtml(product.name ?? "-")}</div>` +
    `<div class="product-company">${escapeHtml(product.company ?? "")}</div></td>`;

  return rows
    .slice(0, limit)
    .map(({ product, option }) =>
      saving
        ? `<tr>${productCell(product)}<td data-label="기본금리">${rate(option.rate)}</td>` +
          `<td class="rate-strong" data-label="최고금리">${rate(option.maxRate ?? option.rate)}</td></tr>`
        : `<tr>${productCell(product)}<td data-label="금리 유형">${escapeHtml(option.rateType ?? "-")}</td>` +
          `<td data-label="금리(최저~최고)">${rateRange(option.min, option.max)}</td>` +
          `<td class="rate-low" data-label="평균">${rate(option.avg)}</td></tr>`
    )
    .join("");
}

// 마커가 없으면 조용히 지나가지 않는다. 심었다고 생각하는데 실제로는 아무것도
// 안 들어간 상태가 제일 나쁘다.
export function applyPrerender(html, blocks) {
  let out = html;
  for (const [name, content] of Object.entries(blocks)) {
    const open = `<!--prerender:${name}-->`;
    const close = `<!--/prerender:${name}-->`;
    const start = out.indexOf(open);
    const end = out.indexOf(close);
    if (start === -1 || end === -1 || end < start) {
      throw new Error(`${name} 자리표시 주석을 찾지 못했습니다. 대상 HTML에서 마커가 지워졌는지 확인해주세요.`);
    }
    if (content == null) continue; // 데이터가 없으면 기존 안내 문구를 그대로 둔다
    out = `${out.slice(0, start + open.length)}${content}${out.slice(end)}`;
  }
  return out;
}

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const [summary, market, realestate, news] = await Promise.all(
    ["summary", "market", "realestate", "news"].map(readJson)
  );

  const blocks = {
    summary: summaryHtml(summary),
    market: marketHtml(market),
    realestate: realestateHtml(realestate),
    news: newsHtml(news),
  };

  const rates = await readJson("rates");

  for (const [file, path_, fileBlocks] of [
    ["docs/index.html", INDEX_PATH, blocks],
    ["docs/rates.html", RATES_PATH, { rates: ratesHtml(rates), ratesHead: ratesHeadHtml() }],
    [
      "docs/news.html",
      NEWS_PATH,
      { newsSummary: newsSummaryHtml(summary), newsList: newsListHtml(news) },
    ],
  ]) {
    const html = await readFile(path_, "utf8");
    const next = applyPrerender(html, fileBlocks);

    for (const [name, content] of Object.entries(fileBlocks)) {
      console.log(`  ${file} ${name.padEnd(11)} ${content ? `${content.length}자` : "데이터 없음 - 건너뜀"}`);
    }

    if (next === html) {
      console.log(`  ${file} 변경 없음`);
      continue;
    }
    await writeFile(path_, next);
    console.log(`  ${file} 갱신`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`프리렌더 실패: ${err.message}`);
    process.exit(1);
  });
}
