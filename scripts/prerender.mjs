import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_AMOUNT, formatWon, netInterestOf } from "./interest.mjs";
import { BUDGET_PAGES } from "./budget-pages.mjs";
import { DISTRICT_PAGES, DISTRICT_SLUGS, districtFile } from "./district-slugs.mjs";
import { districtSentences } from "./district-summary.mjs";
import { factSentences } from "./district-facts.mjs";
import { renewalSentences } from "./renewal-facts.mjs";
import { apartmentOptions, loanSentence, rateSpread } from "./mortgage.mjs";
import { rateFacts, factSentences as rateSentences } from "./rate-facts.mjs";
import {
  KIND_FIELDS,
  areaPrice,
  formatEok,
  formatMan,
  formatPercent,
  jeonseRatio,
  metricOf,
  monthLabel,
  resolveMetric,
  valueOf,
} from "./realestate-format.mjs";

const root = path.resolve(import.meta.dirname, "..");
const INDEX_PATH = path.join(root, "docs/index.html");
const RATES_PATH = path.join(root, "docs/rates.html");
const NEWS_PATH = path.join(root, "docs/news.html");
const REALESTATE_PATH = path.join(root, "docs/realestate.html");
const CONVERSION_PATH = path.join(root, "docs/jeonse-vs-wolse.html");
const CANCELLATION_PATH = path.join(root, "docs/cancelled-deals.html");
const RENEWAL_PATH = path.join(root, "docs/renewal-vs-new.html");
const FLOOR_PATH = path.join(root, "docs/floor-gap.html");
const DATA_DIR = path.join(root, "docs/data");

export const MIN_SAMPLE = 5;
// 첫 화면에 그리는 자치구 수. 모바일에서 표는 행마다 카드로 펼쳐지므로
// 열한 행이면 요약까지 1,500px을 내려야 한다. 나머지는 표 밑 '더 보기'로 편다.
// index.html의 MAX_VISIBLE_DISTRICTS와 같아야 한다 - 다르면 자바스크립트가
// 붙는 순간 표 길이가 튀고, 그걸 index-realestate-rows 검사가 잡는다.
const MAX_DISTRICTS = 4;

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

  return [
    ...highlights.map((h) => `<p><strong>${escapeHtml(h.title)}</strong> ${escapeHtml(h.textKo)}</p>`),
    ...categories.map((c) => `<p><strong>${escapeHtml(c.name)}</strong> ${escapeHtml(c.lineKo)}</p>`),
  ].join("");
}

export function marketHtml(market) {
  if (!market) return null;
  const rows = [];

  if (market.kospi?.value) {
    // 하루 늦은 종가다. 어느 장의 값인지 화면 쪽 renderMarket과 같이 적는다.
    const asOf = market.kospi.asOf ? ` <span class="count">${escapeHtml(market.kospi.asOf)} 종가</span>` : "";
    const change = market.kospi.change ? `${escapeHtml(market.kospi.change)}` : "-";
    rows.push([`코스피${asOf}`, escapeHtml(market.kospi.value), change]);
  }
  if (typeof market.usdKrw?.value === "number") {
    const change = market.usdKrw.change
      ? `<span title="전일 수집분 대비">${escapeHtml(market.usdKrw.change)}</span>`
      : "-";
    rows.push(["원/달러 환율", `${market.usdKrw.value.toFixed(2)}원`, change]);
  }
  if (market.baseRate?.value) {
    rows.push(["기준금리", `${escapeHtml(market.baseRate.value)}%`, escapeHtml(market.baseRate.effectiveFrom ?? "-")]);
  }

  if (!rows.length) return null;
  return rows
    .map(
      ([name, value, change]) =>
        `<tr><td>${name}</td><td data-label="값">${value}</td><td data-label="증감">${change}</td></tr>`
    )
    .join("");
}

const man = (value) => `${Number(value).toLocaleString("ko-KR")}만원`;

const lowSampleText = (metric) =>
  `<span class="low-sample" title="신고 ${metric.transactionCount}건이라 평균을 내기엔 표본이 부족합니다">` +
  `표본 ${metric.transactionCount}건</span>`;

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

const metricCell = (metric, valueText) => {
  if (!metric) return "-";
  if (!enough(metric)) return lowSampleText(metric);
  return valueText(metric) ?? "-";
};

const saleCell = (sale) =>
  metricCell(sale, (m) =>
    m.avgPricePerPyeong10k ? `${man(m.avgPricePerPyeong10k)}${changeText(m.change)}${countText(m)}` : null
  );
const jeonseCell = (jeonse) =>
  metricCell(jeonse, (m) =>
    m.avgDepositPerPyeong10k ? `${man(m.avgDepositPerPyeong10k)}${changeText(m.change)}${countText(m)}` : null
  );
const wolseCell = (wolse) =>
  metricCell(wolse, (m) =>
    m.avgDeposit10k ? `${man(m.avgDeposit10k)} / 월 ${man(m.avgMonthlyRent10k)}${countText(m)}` : null
  );

export function realestateHtml(realestate) {
  if (!realestate?.overall) return null;

  const priceOf = (d) => ((d.sale?.transactionCount ?? 0) >= MIN_SAMPLE ? d.sale?.avgPricePerPyeong10k ?? null : null);
  const districts = [...(realestate.districts ?? [])]
    .sort((a, b) => {
      const [x, y] = [priceOf(a), priceOf(b)];
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    })
    .slice(0, MAX_DISTRICTS);

  const row = (name, data) =>
    `<tr><td>${escapeHtml(name)}</td>` +
    `<td data-label="매매">${saleCell(data.sale)}</td>` +
    `<td data-label="전세">${jeonseCell(data.jeonse)}</td>` +
    `<td data-label="월세">${wolseCell(data.wolse)}</td></tr>`;

  return [row("서울 전체", realestate.overall), ...districts.map((d) => row(d.name, d))].join("");
}

export function newsContextHtml(context) {
  if (!context?.length) return "";
  return (
    `<div class="news-context">` +
    context
      .map(
        (c) =>
          `<a class="context-chip" href="${escapeHtml(c.href)}">` +
          `<span class="context-label">${escapeHtml(c.label)}</span>` +
          `<span class="context-value">${escapeHtml(c.value)}</span>` +
          (c.note ? `<span class="context-note">${escapeHtml(c.note)}</span>` : "") +
          `</a>`
      )
      .join("") +
    `</div>`
  );
}

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

const budgetBandLabel = (band) => {
  const from = Math.round(band.min10k / 10_000);
  const to = band.max10k === null ? null : Math.round(band.max10k / 10_000);
  if (to === null) return `${from}억 이상`;
  if (from === 0) return `${to}억 미만`;
  return `${from}억대`;
};

const budgetWhen = (date) => {
  const [, month, day] = String(date ?? "").split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : "";
};

function budgetDealHtml(deal) {
  const place = [deal.district, deal.dong, deal.apt].filter(Boolean).join(" ");
  const spec = [`${deal.area}㎡`, deal.floor ? `${deal.floor}층` : null].filter(Boolean).join(" · ");
  return (
    `<li class="budget-deal">` +
    `<span class="place">${escapeHtml(place)}</span>` +
    `<span class="spec">${escapeHtml(spec)}</span>` +
    `<span class="when">${escapeHtml(budgetWhen(deal.date))}</span>` +
    `<span class="price">${escapeHtml(formatEok(deal.amount10k))}</span>` +
    `</li>`
  );
}

/**
 * 이 예산이 서울에서 어디로 가는가.
 *
 * 지역 순위는 이미 아래 줄에 숫자로 있지만, 숫자를 세 개 읽고 나서야 알게 되는 것과
 * 한 문장으로 읽는 것은 다르다. 그리고 예산대마다 답이 실제로 다르다 — 4억대는 노원·
 * 도봉·중랑이고 18억대는 강동·송파·성동이라, 이 한 줄이 열여덟 장에서 열여덟 번
 * 다른 말을 한다.
 *
 * 상위 세 구가 절반을 넘을 때만 쓴다. 고르게 흩어진 예산대에서 "여기에 몰려 있다"고
 * 하면 사실이 아니고, 그럴 때는 흩어졌다는 것이 답이다.
 */
function budgetWhereHtml(band) {
  const districts = band.districts ?? [];
  if (districts.length < 3 || !band.count) return "";

  const top3 = districts.slice(0, 3);
  const share = top3.reduce((sum, d) => sum + d.count, 0) / band.count;
  const names = top3.map((d) => d.name).join("·");
  const label = budgetBandLabel(band);

  const text =
    share >= 0.5
      ? `${label} 거래의 ${Math.round(share * 100)}%가 ${names} 세 곳에서 나왔습니다. 이 예산으로 서울에서 고를 수 있는 곳은 사실상 여기입니다.`
      : districts.length >= 10
        ? `${label} 거래는 ${districts.length}개 구에 흩어져 있고 상위 세 곳(${names})을 합쳐도 ${Math.round(share * 100)}%입니다. 이 예산에서는 지역이 아니라 단지가 선택을 가릅니다.`
        : "";

  return text ? `<p class="budget-where">${escapeHtml(text)}</p>` : "";
}

export function budgetBodyHtml(band, periodList, rates = null) {
  if (!band) return null;

  const periods = (periodList ?? []).map((p) => monthLabel(p)).filter(Boolean).join(", ");
  const districts = (band.districts ?? [])
    .map((d) => `${escapeHtml(d.name)} ${d.count.toLocaleString("ko-KR")}`)
    .join(" · ");

  return (
    `<p class="budget-summary">${escapeHtml(`${budgetBandLabel(band)}에서 ${band.count.toLocaleString("ko-KR")}건이 거래됐습니다.`)}` +
    (periods ? ` <span class="when">${escapeHtml(`${periods} 신고분 기준`)}</span>` : "") +
    `</p>` +
    budgetWhereHtml(band) +
    (districts ? `<div class="budget-districts">거래가 많은 지역: ${districts}</div>` : "") +
    `<ul class="budget-deals">${band.deals.map(budgetDealHtml).join("")}</ul>` +
    budgetLoanHtml(band, rates)
  );
}

/**
 * "그래서 매달 얼마"를 붙인다. 이 화면은 예산에 답하면서 정작 그 예산이 매달 얼마가
 * 되는지는 말하지 않고 있었다 - 실거래와 금리를 같이 받는 곳이라야 자동으로 물릴 수 있다.
 */
export function budgetLoanHtml(band, rates) {
  const spread = rateSpread(apartmentOptions(rates));
  const eok = Number.isFinite(band?.min10k) ? band.min10k / 10_000 : null;
  const sentence = loanSentence(spread, { eok });
  if (!sentence) return "";
  return `<p class="budget-loan">${sentence}</p>`;
}

export { budgetBandLabel };

function linksBlockHtml(id, heading, links) {
  if (!links) return "";
  return (
    `<h3 class="district-links-heading" id="${id}-heading">${escapeHtml(heading)}</h3>` +
    `<div class="district-links" id="${id}">${links}</div>`
  );
}

export function newsRealestateStatsHtml(news) {
  const stats = news?.realestateStats ?? [];
  if (!stats.length) return null;
  return stats
    .map(
      (s) =>
        `<a class="stat-card" href="${escapeHtml(s.href)}">` +
        `<span class="stat-label">${escapeHtml(s.label)}</span>` +
        `<span class="stat-value">${escapeHtml(s.value)}</span>` +
        (s.note ? `<span class="stat-sub">${escapeHtml(s.note)}</span>` : "") +
        `</a>`
    )
    .join("");
}

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

const RE_LABELS = {
  district: "지역",
  sale: "매매",
  jeonse: "전세",
  wolse: "월세",
  perPyeong: "평당가",
  perPyeongDeposit: "평당 보증금",
  area: "84㎡ 환산",
  deposit: "평균 보증금",
  monthly: "평균 월세",
  count: "거래건수",
  ratio: "전세가율",
  ratioByComplex: "단지별 중앙값",
  overall: "서울 전체",
};

const reCount = (n) => `${n.toLocaleString("ko-KR")}건`;
const reMan = (v) => formatMan(v);
const reEok = (v) => formatEok(v);

function reHeadLabels(kind) {
  if (!kind) return [RE_LABELS.district, RE_LABELS.sale, RE_LABELS.jeonse, RE_LABELS.wolse];
  if (kind === "wolse") return [RE_LABELS.district, RE_LABELS.deposit, RE_LABELS.monthly, RE_LABELS.count];
  if (kind === "jeonse") {
    return [RE_LABELS.district, RE_LABELS.perPyeongDeposit, RE_LABELS.area, RE_LABELS.ratio, RE_LABELS.count];
  }
  return [RE_LABELS.district, RE_LABELS.perPyeong, RE_LABELS.area, RE_LABELS.count];
}

export function realestateHeadHtml(kind = null, district = null) {
  const labels = district
    ? ["구분", RE_LABELS.perPyeong, RE_LABELS.area, RE_LABELS.count]
    : reHeadLabels(kind);
  return `<tr>${labels.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}</tr>`;
}

function reChange(change, baselineDate) {
  if (!change || typeof change.value10k !== "number" || change.value10k === 0) return "";
  const dir = change.value10k > 0 ? "up" : "down";
  const arrow = change.value10k > 0 ? "▲" : "▼";
  const title = baselineDate ? ` title="${escapeHtml(`${baselineDate} 대비`)}"` : "";
  return ` <span class="change ${dir}"${title}>${arrow}${reMan(Math.abs(change.value10k))}</span>`;
}

const reCountSpan = (metric) =>
  typeof metric?.transactionCount === "number"
    ? ` <span class="count">${escapeHtml(reCount(metric.transactionCount))}</span>`
    : "";


function reLowSample(metric) {
  const n = metric?.transactionCount ?? 0;
  return `<span class="low-sample" title="${escapeHtml(`이번 달 신고가 ${n}건뿐이라 평균을 내지 않았습니다.`)}">${escapeHtml(`신고 ${n}건`)}</span>`;
}

function reCells(entry, kind) {
  const resolved = resolveMetric(entry, kind);
  if (!resolved) {
    const raw = entry?.[KIND_FIELDS[kind].metric];
    return [raw ? reLowSample(raw) : "-", "-", "-"];
  }
  const { metric } = resolved;
  const change = (c, d) => reChange(c, d);

  if (kind === "wolse") {
    return [
      `<span class="price-strong">${reMan(metric.avgDeposit10k)}</span>${change(metric.depositChange, metric.baselineDate)}`,
      `<span class="price-strong">월 ${reMan(metric.avgMonthlyRent10k)}</span>${change(metric.monthlyRentChange, metric.baselineDate)}`,
      `<span class="count">${escapeHtml(reCount(metric.transactionCount))}</span>`,
    ];
  }
  const perPyeong = valueOf(metric, kind);
  const cells = [
    `<span class="price-strong">${reMan(perPyeong)}</span>${change(metric.change, metric.baselineDate)}`,
    `<span class="price-strong">${reEok(areaPrice(perPyeong))}</span>`,
  ];
  if (kind === "jeonse") {
    const ratio = jeonseRatio(entry);
    cells.push(ratio ? `<span class="ratio">${formatPercent(ratio.ratio)}</span>` : "-");
  }
  cells.push(`<span class="count">${escapeHtml(reCount(metric.transactionCount))}</span>`);
  return cells;
}

function reAllCells(entry) {
  return ["sale", "jeonse", "wolse"].map((kind) => {
    const resolved = resolveMetric(entry, kind);
    if (!resolved) {
      const raw = entry?.[KIND_FIELDS[kind].metric];
      return raw ? reLowSample(raw) : "-";
    }
    const { metric } = resolved;
    if (kind === "wolse") {
      return `${reMan(metric.avgDeposit10k)} / 월 ${reMan(metric.avgMonthlyRent10k)}${reCountSpan(metric)}`;
    }
    const change = reChange(metric.change, metric.baselineDate);
    return `${reMan(valueOf(metric, kind))}${change}${reCountSpan(metric)}`;
  });
}

function reStaleTag(entry) {
  const at = entry?.staleAt;
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const label = date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
  return ` <span class="prev-tag" title="${escapeHtml("이 지역은 오늘 실거래 조회에 실패해 지난번에 받은 값을 그대로 보여줍니다.")}">${escapeHtml(label)}</span>`;
}

function reDistrictLink(label) {
  const slug = DISTRICT_SLUGS[label];
  return slug ? `<a href="./${districtFile(slug)}">${escapeHtml(label)}</a>` : escapeHtml(label);
}

function reRow(entry, label, isOverall, kind) {
  const labels = reHeadLabels(kind);
  const cells = kind ? reCells(entry, kind) : reAllCells(entry);
  const body = cells
    .map((cell, i) => `<td data-label="${escapeHtml(labels[i + 1])}">${cell}</td>`)
    .join("");
  const name = isOverall ? escapeHtml(label) : reDistrictLink(label);
  return `<tr class="${isOverall ? "overall-row" : ""}"><td>${name}${reStaleTag(entry)}</td>${body}</tr>`;
}

function reSorted(districts, kind) {
  const key = kind ?? "sale";
  return [...districts].sort((a, b) => {
    const av = valueOf(resolveMetric(a, key)?.metric, key);
    const bv = valueOf(resolveMetric(b, key)?.metric, key);
    if (av === null && bv === null) return (a.name ?? "").localeCompare(b.name ?? "");
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });
}

function reDistrictRows(entry) {
  const labels = [RE_LABELS.sale, RE_LABELS.jeonse, RE_LABELS.wolse];
  return ["sale", "jeonse", "wolse"]
    .map((kind, i) => {
      const cell = (price, area, count) =>
        `<tr><td>${escapeHtml(labels[i])}</td>` +
        `<td data-label="${escapeHtml(RE_LABELS.perPyeong)}">${price}</td>` +
        `<td data-label="${escapeHtml(RE_LABELS.area)}">${area}</td>` +
        `<td data-label="${escapeHtml(RE_LABELS.count)}">${count}</td></tr>`;

      const resolved = resolveMetric(entry, kind);
      if (!resolved) {
        const raw = entry?.[KIND_FIELDS[kind].metric];
        return cell(raw ? reLowSample(raw) : "-", "-", "-");
      }
      const { metric } = resolved;
        const change = reChange(metric.change, metric.baselineDate);
      const price =
        kind === "wolse"
          ? `<span class="price-strong">${reMan(metric.avgDeposit10k)}</span> / <span class="price-strong">월 ${reMan(metric.avgMonthlyRent10k)}</span>`
          : `<span class="price-strong">${reMan(valueOf(metric, kind))}</span>${change}`;
      const area = kind === "wolse" ? "-" : `<span class="price-strong">${reEok(areaPrice(valueOf(metric, kind)))}</span>`;
      return cell(price, area, `<span class="count">${escapeHtml(reCount(metric.transactionCount))}</span>`);
    })
    .join("");
}

export function realestateTableHtml(realestate, kind = null, district = null) {
  const districts = realestate?.districts ?? [];
  if (district) {
    const entry = districts.find((d) => d.name === district);
    return entry ? reDistrictRows(entry) : null;
  }
  if (!realestate?.overall && !districts.length) return null;
  return (
    (realestate.overall ? reRow(realestate.overall, RE_LABELS.overall, true, kind) : "") +
    reSorted(districts, kind)
      .map((d) => reRow(d, d.name ?? "-", false, kind))
      .join("")
  );
}

export function realestateOverallHtml(realestate, kind = null, district = null, spread = null) {
  const overall = district
    ? (realestate?.districts ?? []).find((d) => d.name === district)
    : realestate?.overall;
  if (!overall) return null;

  const card = (label, value, sub) =>
    `<div class="overall-card"><div class="label">${escapeHtml(label)}</div>` +
    `<div class="value">${value}</div>` +
    (sub ? `<div class="sub">${sub}</div>` : "") +
    `</div>`;

  // 전세가율 카드 옆에 칸 하나하나에서 낸 값의 중앙값을 나란히 둔다.
  // 표의 값은 이 표의 두 열을 나눈 것이라 표와는 맞고, 이 값은 실제 단지와 맞는다.
  // 하나를 다른 하나로 갈아 끼우면 같은 행의 숫자들과 어긋나므로 둘을 같이 둔다.
  const complexCard = () =>
    spread
      ? card(
          RE_LABELS.ratioByComplex,
          formatPercent(spread.median),
          escapeHtml(`단지·평형 ${spread.cells.toLocaleString("ko-KR")}칸`)
        )
      : "";

  if (district) {
    const sale = resolveMetric(overall, "sale")?.metric;
    const ratio = jeonseRatio(overall);
    return (
      (sale
        ? card(RE_LABELS.perPyeong, reMan(valueOf(sale, "sale")), "") +
          card(RE_LABELS.area, reEok(areaPrice(valueOf(sale, "sale"))), "") +
          card(RE_LABELS.count, escapeHtml(reCount(sale.transactionCount)), "")
        : card(RE_LABELS.sale, "-", "")) +
      (ratio ? card(RE_LABELS.ratio, formatPercent(ratio.ratio), "") : "") +
      complexCard()
    );
  }

  if (!kind) {
    return ["sale", "jeonse", "wolse"]
      .map((k) => {
        const metric = resolveMetric(overall, k)?.metric;
        const label = RE_LABELS[k];
        if (!metric) return card(label, "-", "");
        if (k === "wolse") {
          return card(
            label,
            `${reMan(metric.avgDeposit10k)} / 월 ${reMan(metric.avgMonthlyRent10k)}`,
            escapeHtml(reCount(metric.transactionCount))
          );
        }
        return card(
          label,
          reMan(valueOf(metric, k)),
          `${escapeHtml(RE_LABELS.area)} ${reEok(areaPrice(valueOf(metric, k)))} · ${escapeHtml(reCount(metric.transactionCount))}`
        );
      })
      .join("");
  }

  const metric = resolveMetric(overall, kind)?.metric;
  if (!metric) return card(RE_LABELS.overall, "-", "");
  if (kind === "wolse") {
    return (
      card(RE_LABELS.deposit, reMan(metric.avgDeposit10k), "") +
      card(RE_LABELS.monthly, `월 ${reMan(metric.avgMonthlyRent10k)}`, "") +
      card(RE_LABELS.count, escapeHtml(reCount(metric.transactionCount)), "")
    );
  }
  const perPyeong = valueOf(metric, kind);
  const ratio = kind === "jeonse" ? jeonseRatio(overall) : null;
  return (
    card(kind === "jeonse" ? RE_LABELS.perPyeongDeposit : RE_LABELS.perPyeong, reMan(perPyeong), "") +
    card(RE_LABELS.area, reEok(areaPrice(perPyeong)), "") +
    (ratio ? card(RE_LABELS.ratio, formatPercent(ratio.ratio), "") : "") +
    (kind === "jeonse" ? complexCard() : "") +
    card(RE_LABELS.count, escapeHtml(reCount(metric.transactionCount)), "")
  );
}

export function districtSummaryHtml(realestate, district, locale = "ko", spread = null) {
  if (!district) return "";
  const entry = (realestate?.districts ?? []).find((d) => d.name === district);
  const sentences = districtSentences(entry, realestate, locale, spread);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}

/**
 * 시세 문장 아래에 붙는 두 번째 문단.
 *
 * 위 문단은 스물다섯 구가 같은 틀이다 — 평당 얼마, 평균의 몇 배, 몇 번째. 이쪽은
 * 구마다 눈에 띄는 것만 골라 말하므로 문장의 개수도 종류도 구마다 다르고, 말할 것이
 * 없는 구에서는 통째로 비어 있다. 어느 쪽인지는 `district-facts.mjs`가 정한다.
 */
/**
 * 재계약에서 나온 관찰. 매매 거래에서 뽑은 관찰과 문단을 나눈다 - 앞 문단은 매매
 * 신고분 이야기이고 이쪽은 전월세 갱신 이야기라, 한 문단에 이어 붙이면 같은 표본을
 * 두고 하는 말처럼 읽힌다.
 */
export function districtRenewalHtml(facts, locale = "ko") {
  const sentences = renewalSentences(facts, locale);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}

export function districtFactsHtml(facts, locale = "ko") {
  const sentences = factSentences(facts, locale);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}

export function districtLinksHtml(current = null) {
  const links = DISTRICT_PAGES.map(({ name, file }) =>
    name === current
      ? `<a href="./${file}" aria-current="page">${escapeHtml(name)}</a>`
      : `<a href="./${file}">${escapeHtml(name)}</a>`
  ).join("");
  return linksBlockHtml("district-links", "다른 지역", links);
}

const RATES_TERM = 12;
const RATES_ROWS = 20;
const SAVING_CATEGORIES = new Set(["deposit", "saving"]);

const rate = (value) => (typeof value === "number" ? `${value.toFixed(2)}%` : "-");
const rateRange = (min, max) =>
  typeof min === "number" && typeof max === "number" ? `${min.toFixed(2)}~${max.toFixed(2)}%` : rate(min ?? max);

const RATE_CATEGORIES = ["deposit", "saving", "mortgage", "rentLoan"];

/**
 * 표가 보여주는 것 옆에 붙는 문단.
 *
 * 어느 상품군인지는 이 페이지에서 탭으로 바뀐다 — 페이지를 다시 받지 않는다. 그래서
 * 네 상품군 것을 빌드에서 미리 계산해 한 덩이로 넘기고, 화면은 고르기만 한다. 같은
 * 계산을 브라우저 쪽에 한 벌 더 두면 차트 코드처럼 두 곳을 같이 고쳐야 하는 짐이 하나
 * 더 생기고, 실제로 그 짐 때문에 같은 수정을 두 번 한 적이 있다.
 */
export function rateFactsData(rates) {
  const out = {};
  for (const category of RATE_CATEGORIES) {
    const facts = rateFacts(rates, category);
    out[category] = { ko: rateSentences(facts, "ko"), en: rateSentences(facts, "en") };
  }
  return out;
}

/**
 * `<script type="application/json">` 안에 넣을 수 있게 만든 JSON.
 *
 * `JSON.stringify`는 `<`도 `/`도 건드리지 않는다. 상품 이름에 `</script`가 들어 있으면
 * 그 자리에서 스크립트 태그가 닫히고 뒤가 마크업이 된다 — 이 데이터는 금감원 API에서
 * 그대로 받아 오는 것이라 내용을 우리가 정하지 못한다.
 */
export function jsonForScript(value) {
  return JSON.stringify(value).replaceAll("</", "<\\/").replaceAll("<!--", "<\\u0021--");
}

export function rateFactsHtml(rates, category = "deposit", locale = "ko") {
  const sentences = rateSentences(rateFacts(rates, category), locale);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}

export function ratesHeadHtml(category = "deposit") {
  return SAVING_CATEGORIES.has(category)
    ? "<tr><th>상품</th><th>기본금리</th><th>최고금리</th><th>세후 이자</th></tr>"
    : "<tr><th>상품</th><th>금리 유형</th><th>금리(최저~최고)</th><th>평균</th></tr>";
}

export function ratesHtml(rates, { category = "deposit", limit = RATES_ROWS } = {}) {
  const products = rates?.[category] ?? [];
  if (!products.length) return null;

  const saving = SAVING_CATEGORIES.has(category);
  const key = saving ? "maxRate" : "min";
  const asc = !saving;

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

  rows.sort((a, b) => {
    if (a.sort === null || b.sort === null) return (a.sort === null) - (b.sort === null);
    return asc ? a.sort - b.sort : b.sort - a.sort;
  });

  if (!rows.length) return null;

  const productCell = (product) =>
    `<td><div class="product-name">${escapeHtml(product.name ?? "-")}</div>` +
    `<div class="product-company">${escapeHtml(product.company ?? "")}</div></td>`;

  const amount = DEFAULT_AMOUNT[saving && category === "saving" ? "saving" : "deposit"];
  const netCell = (option) => {
    const net = netInterestOf(option, { amount, saving: category === "saving" });
    return net === null ? "-" : formatWon(net);
  };

  return rows
    .slice(0, limit)
    .map(({ product, option }) =>
      saving
        ? `<tr>${productCell(product)}<td data-label="기본금리">${rate(option.rate)}</td>` +
          `<td class="rate-strong" data-label="최고금리">${rate(option.maxRate ?? option.rate)}</td>` +
          `<td class="net-interest" data-label="세후 이자">${netCell(option)}</td></tr>`
        : `<tr>${productCell(product)}<td data-label="금리 유형">${escapeHtml(option.rateType ?? "-")}</td>` +
          `<td data-label="금리(최저~최고)">${rateRange(option.min, option.max)}</td>` +
          `<td class="rate-low" data-label="평균">${rate(option.avg)}</td></tr>`
    )
    .join("");
}

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
    if (content == null) continue;
    out = `${out.slice(0, start + open.length)}${content}${out.slice(end)}`;
  }
  return out;
}

/**
 * 전세·월세 화면의 첫 문단과 표. 문장은 빌드가 이미 만들어 두었으므로 여기서는
 * 고르기만 한다. 표는 화면이 고른 자치구를 굵게 하려고 다시 그리지만, 조건을
 * 넣기 전에 보이는 첫 벌은 여기서 구워 나가야 검색에 걸린다.
 */
export const CONVERSION_BAND = "60to85";

export function conversionLeadHtml(conversion) {
  return conversion?.seoul?.leadKo ? escapeHtml(conversion.seoul.leadKo) : null;
}

export function conversionTableHtml(conversion, band = CONVERSION_BAND) {
  const rows = (conversion?.cells ?? []).filter((cell) => cell.band === band);
  if (!rows.length) return null;

  const label = conversion.bands?.find((b) => b.key === band)?.label ?? band;
  const eok = (value10k) => `${(Math.round((value10k / 10000) * 100) / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억`;
  const man = (value10k) => `${Math.round(value10k).toLocaleString("ko-KR")}만원`;

  const body = [...rows]
    .sort((a, b) => b.rate - a.rate)
    .map(
      (cell) =>
        `<tr><td>${escapeHtml(cell.district)}</td><td>${cell.rate}%</td>` +
        `<td>${escapeHtml(eok(cell.jeonse10k))}</td>` +
        `<td>${escapeHtml(`${eok(cell.deposit10k)} / ${man(cell.monthly10k)}`)}</td>` +
        `<td>${cell.pairs.toLocaleString("ko-KR")}</td></tr>`
    )
    .join("");

  return (
    `<caption class="cost-label" style="caption-side:top;text-align:left;padding-bottom:8px;">${escapeHtml(`${label} 기준`)}</caption>` +
    `<thead><tr><th>자치구</th><th>전환율</th><th>전세</th><th>월세</th><th>단지</th></tr></thead>` +
    `<tbody>${body}</tbody>`
  );
}

export function conversionDistrictLinksHtml(conversion) {
  const slugs = conversion?.slugs ?? {};
  const links = Object.entries(slugs)
    .map(([name, slug]) => `<a href="./district-${escapeHtml(slug)}.html">${escapeHtml(name)}</a>`)
    .join("");
  return links || null;
}

/** 해제·등기 화면. 조건을 넣을 것이 없는 읽는 화면이라 첫 벌이 곧 본문이다. */
export function cancelLeadHtml(cancellation) {
  return cancellation?.seoul?.leadKo ? escapeHtml(cancellation.seoul.leadKo) : null;
}

export function cancelMonthLeadHtml(cancellation) {
  const reg = cancellation?.seoul?.registration;
  if (!reg?.medianDays) return null;
  return escapeHtml(
    `등기까지 걸린 날은 중앙값 ${reg.medianDays}일입니다. 익은 달의 계약 ${reg.matured.toLocaleString("ko-KR")}건 가운데` +
      ` ${reg.stale.toLocaleString("ko-KR")}건(${reg.staleShare}%)이 아직 등기를 마치지 않았습니다.`
  );
}

export function cancelDistrictsHtml(cancellation) {
  const rows = cancellation?.districts ?? [];
  if (!rows.length) return null;

  const pct = (value) => (value === null || value === undefined ? "-" : `${value}%`);
  const body = rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.district)}</td><td>${row.deals.toLocaleString("ko-KR")}</td>` +
        `<td>${row.cancelled.toLocaleString("ko-KR")}</td><td>${escapeHtml(pct(row.cancelledShare))}</td>` +
        `<td>${row.stale.toLocaleString("ko-KR")}</td><td>${escapeHtml(pct(row.staleShare))}</td></tr>`
    )
    .join("");

  return (
    `<thead><tr><th>자치구</th><th>신고</th><th>해제</th><th>해제율</th><th>미등기</th><th>미등기율</th></tr></thead>` +
    `<tbody>${body}</tbody>`
  );
}

export function cancelMonthsHtml(cancellation) {
  const rows = cancellation?.registrationByMonth ?? [];
  if (!rows.length) return null;

  const mature = new Set(cancellation?.seoul?.registration?.matureMonths ?? []);
  const body = rows
    .map(
      (row) =>
        `<tr${mature.has(row.month) ? ' class="spot"' : ""}><td>${escapeHtml(row.month)}</td>` +
        `<td>${row.filed.toLocaleString("ko-KR")}</td><td>${row.registered.toLocaleString("ko-KR")}</td><td>${row.share}%</td></tr>`
    )
    .join("");

  return `<thead><tr><th>계약월</th><th>계약</th><th>등기 완료</th><th>완료율</th></tr></thead><tbody>${body}</tbody>`;
}

export function cancelDistrictLinksHtml(cancellation) {
  const slugs = cancellation?.slugs ?? {};
  const links = Object.entries(slugs)
    .map(([name, slug]) => `<a href="./district-${escapeHtml(slug)}.html">${escapeHtml(name)}</a>`)
    .join("");
  return links || null;
}

/** 재계약 화면. 문턱은 빌더가 이미 적용했으므로 여기서는 형식만 입힌다. */
export function renewalLeadHtml(renewal) {
  return renewal?.lead?.ko ? escapeHtml(renewal.lead.ko) : null;
}

export function renewalCapLeadHtml(renewal) {
  return renewal?.capLead?.ko ? escapeHtml(renewal.capLead.ko) : null;
}

export function renewalDistrictsHtml(renewal) {
  const rows = renewal?.table ?? [];
  if (!rows.length) return null;

  const pct = (value) => (value === null || value === undefined ? "-" : `${value}%`);
  const body = rows
    .map((row) => {
      // 문턱을 못 넘은 칸은 비우지 않는다. 화면 쪽 renderDistrictTable과 같은 규칙이다.
      const gap =
        row.gapMedian === null
          ? '<span class="low-sample">표본 부족</span>'
          : escapeHtml(pct(row.gapMedian));
      return (
        `<tr><td>${escapeHtml(row.district)}</td><td>${gap}</td>` +
        `<td>${escapeHtml(pct(row.gapCheaperShare))}</td><td>${row.gapMatched.toLocaleString("ko-KR")}</td>` +
        `<td>${escapeHtml(pct(row.capMissShare))}</td><td>${row.rightUsed.toLocaleString("ko-KR")}</td></tr>`
      );
    })
    .join("");

  return (
    `<thead><tr><th>자치구</th><th>갱신 − 신규</th><th>시세보다 싼 비율</th>` +
    `<th>맞물린 계약</th><th>상한 미달</th><th>요구권 행사</th></tr></thead><tbody>${body}</tbody>`
  );
}

export function renewalDistrictLinksHtml(renewal) {
  const slugs = renewal?.slugs ?? {};
  const links = Object.entries(slugs)
    .map(([name, slug]) => `<a href="./district-${escapeHtml(slug)}.html">${escapeHtml(name)}</a>`)
    .join("");
  return links || null;
}

/** 층 격차 화면. 문턱과 문장은 빌더가 이미 정했으므로 여기서는 표만 만든다. */
export function floorDistrictsHtml(floor) {
  const rows = floor?.districts ?? [];
  if (!rows.length) return null;

  // 갈라 볼 수 없는 구도 빼지 않는다 - 화면 쪽 renderDistrictTable과 같은 규칙이다.
  const body = rows
    .map((row) => {
      const verdict = row.distinct
        ? "다르다"
        : `<span class="low-sample">${row.band ? "갈라 볼 수 없음" : "칸이 모자람"}</span>`;
      return (
        `<tr><td>${escapeHtml(row.district)}</td><td>${row.median}%</td>` +
        `<td>${row.cells.toLocaleString("ko-KR")}</td><td>${verdict}</td></tr>`
      );
    })
    .join("");

  return (
    `<thead><tr><th>자치구</th><th>1층 − 3층 이상</th><th>맞물린 칸</th>` +
    `<th>서울과 다른가</th></tr></thead><tbody>${body}</tbody>`
  );
}

export function floorDistrictLinksHtml(floor) {
  const slugs = floor?.slugs ?? {};
  const links = Object.entries(slugs)
    .map(([name, slug]) => `<a href="./district-${escapeHtml(slug)}.html">${escapeHtml(name)}</a>`)
    .join("");
  return links || null;
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
  const conversion = await readJson("conversion");
  const cancellation = await readJson("cancellation");
  const renewal = await readJson("renewal-facts");
  const floor = await readJson("floor-gap");

  for (const [file, path_, fileBlocks] of [
    ["docs/index.html", INDEX_PATH, blocks],
    ["docs/rates.html", RATES_PATH, { rates: ratesHtml(rates), ratesHead: ratesHeadHtml(), rateFactsKo: rateFactsHtml(rates, "deposit", "ko"), rateFactsEn: rateFactsHtml(rates, "deposit", "en"), rateFactsData: jsonForScript(rateFactsData(rates)) }],
    [
      "docs/news.html",
      NEWS_PATH,
      { newsSummary: newsSummaryHtml(summary), newsList: newsListHtml(news) },
    ],
    [
      "docs/realestate.html",
      REALESTATE_PATH,
      {
        realestateOverall: realestateOverallHtml(realestate),
        realestateHead: realestateHeadHtml(),
        realestateTable: realestateTableHtml(realestate),
        districtLinks: "",
        districtSummaryKo: "",
        districtSummaryEn: "",
        districtFactsKo: "",
        districtFactsEn: "",
        districtRenewalKo: "",
        districtRenewalEn: "",
      },
    ],
    [
      "docs/jeonse-vs-wolse.html",
      CONVERSION_PATH,
      {
        conversionLead: conversionLeadHtml(conversion),
        conversionTable: conversionTableHtml(conversion),
        conversionDistrictLinks: conversionDistrictLinksHtml(conversion),
      },
    ],
    [
      "docs/renewal-vs-new.html",
      RENEWAL_PATH,
      {
        renewalLead: renewalLeadHtml(renewal),
        renewalCapLead: renewalCapLeadHtml(renewal),
        renewalDistricts: renewalDistrictsHtml(renewal),
        renewalDistrictLinks: renewalDistrictLinksHtml(renewal),
      },
    ],
    [
      "docs/floor-gap.html",
      FLOOR_PATH,
      {
        floorLead: floor?.lead?.ko ? escapeHtml(floor.lead.ko) : null,
        floorTopLead: floor?.topLead?.ko ? escapeHtml(floor.topLead.ko) : null,
        floorDistrictLead: floor?.districtLead?.ko ? escapeHtml(floor.districtLead.ko) : null,
        floorDistricts: floorDistrictsHtml(floor),
        floorDistrictLinks: floorDistrictLinksHtml(floor),
      },
    ],
    [
      "docs/cancelled-deals.html",
      CANCELLATION_PATH,
      {
        cancelLead: cancelLeadHtml(cancellation),
        cancelDistricts: cancelDistrictsHtml(cancellation),
        cancelMonthLead: cancelMonthLeadHtml(cancellation),
        cancelMonths: cancelMonthsHtml(cancellation),
        cancelDistrictLinks: cancelDistrictLinksHtml(cancellation),
      },
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
