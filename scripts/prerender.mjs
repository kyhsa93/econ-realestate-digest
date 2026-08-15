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
const DATA_DIR = path.join(root, "docs/data");

// 자치구 평당가는 신고 건수가 적으면 "그 구의 시세"가 아니라 "그 아파트 한 채의
// 가격"이라 화면에서 가린다. 정적 HTML은 검색 결과에 그대로 실릴 수 있으니
// 같은 기준을 반드시 지켜야 한다.
const MIN_SAMPLE = 5;
const MAX_DISTRICTS = 10;

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function summaryHtml(summary) {
  const categories = (summary?.categories ?? []).filter((c) => c.lineKo);
  if (!categories.length) return null;
  return categories
    .map((c) => `<p><strong>${escapeHtml(c.name)}</strong> ${escapeHtml(c.lineKo)}</p>`)
    .join("");
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
  return rows.map(([name, value, change]) => `<tr><td>${name}</td><td>${value}</td><td>${change}</td></tr>`).join("");
}

const man = (value) => `${Number(value).toLocaleString("ko-KR")}만원`;
const enough = (metric) => Boolean(metric) && (metric.transactionCount ?? 0) >= MIN_SAMPLE;

// 매매·전세는 평당가, 월세는 보증금/월세라 셀 모양이 다르다(화면과 같은 구성).
const saleCell = (sale) => (enough(sale) && sale.avgPricePerPyeong10k ? man(sale.avgPricePerPyeong10k) : "-");
const jeonseCell = (jeonse) =>
  enough(jeonse) && jeonse.avgDepositPerPyeong10k ? man(jeonse.avgDepositPerPyeong10k) : "-";
const wolseCell = (wolse) =>
  enough(wolse) && wolse.avgDeposit10k
    ? `${man(wolse.avgDeposit10k)} / 월 ${man(wolse.avgMonthlyRent10k)}`
    : "-";

export function realestateHtml(realestate) {
  if (!realestate?.overall) return null;

  const districts = (realestate.districts ?? [])
    .filter((d) => (d.sale?.transactionCount ?? 0) >= MIN_SAMPLE)
    .sort((a, b) => (b.sale?.avgPricePerPyeong10k ?? 0) - (a.sale?.avgPricePerPyeong10k ?? 0))
    .slice(0, MAX_DISTRICTS);

  const row = (name, data) =>
    `<tr><td>${escapeHtml(name)}</td><td>${saleCell(data.sale)}</td><td>${jeonseCell(data.jeonse)}</td><td>${wolseCell(
      data.wolse
    )}</td></tr>`;

  return [row("서울 전체", realestate.overall), ...districts.map((d) => row(d.name, d))].join("");
}

export function newsHtml(news) {
  const items = news?.items ?? [];
  if (!items.length) return null;
  return items
    .map(
      (item) =>
        `<li class="news-item"><a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">${escapeHtml(
          item.title
        )}</a> <span class="news-source">${escapeHtml(item.source ?? "")}</span></li>`
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
      throw new Error(`${name} 자리표시 주석을 찾지 못했습니다. index.html에서 마커가 지워졌는지 확인해주세요.`);
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

  const html = await readFile(INDEX_PATH, "utf8");
  const next = applyPrerender(html, blocks);

  for (const [name, content] of Object.entries(blocks)) {
    console.log(`  ${name.padEnd(11)} ${content ? `${content.length}자` : "데이터 없음 - 건너뜀"}`);
  }

  if (next === html) {
    console.log("변경 없음");
    return;
  }
  await writeFile(INDEX_PATH, next);
  console.log("docs/index.html 갱신");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`프리렌더 실패: ${err.message}`);
    process.exit(1);
  });
}
