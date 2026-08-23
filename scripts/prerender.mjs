import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_AMOUNT, formatWon, netInterestOf } from "./interest.mjs";
import { BUDGET_PAGES } from "./budget-pages.mjs";
import { DISTRICT_PAGES, DISTRICT_SLUGS, districtFile } from "./district-slugs.mjs";
import { districtSentences } from "./district-summary.mjs";
import { factSentences } from "./district-facts.mjs";
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
const DATA_DIR = path.join(root, "docs/data");

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

export function budgetBodyHtml(band, periodList) {
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
    `<ul class="budget-deals">${band.deals.map(budgetDealHtml).join("")}</ul>`
  );
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

export function realestateOverallHtml(realestate, kind = null, district = null) {
  const overall = district
    ? (realestate?.districts ?? []).find((d) => d.name === district)
    : realestate?.overall;
  if (!overall) return null;

  const card = (label, value, sub) =>
    `<div class="overall-card"><div class="label">${escapeHtml(label)}</div>` +
    `<div class="value">${value}</div>` +
    (sub ? `<div class="sub">${sub}</div>` : "") +
    `</div>`;

  if (district) {
    const sale = resolveMetric(overall, "sale")?.metric;
    const ratio = jeonseRatio(overall);
    return (
      (sale
        ? card(RE_LABELS.perPyeong, reMan(valueOf(sale, "sale")), "") +
          card(RE_LABELS.area, reEok(areaPrice(valueOf(sale, "sale"))), "") +
          card(RE_LABELS.count, escapeHtml(reCount(sale.transactionCount)), "")
        : card(RE_LABELS.sale, "-", "")) +
      (ratio ? card(RE_LABELS.ratio, formatPercent(ratio.ratio), "") : "")
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
    card(RE_LABELS.count, escapeHtml(reCount(metric.transactionCount)), "")
  );
}

export function districtSummaryHtml(realestate, district, locale = "ko") {
  if (!district) return "";
  const entry = (realestate?.districts ?? []).find((d) => d.name === district);
  const sentences = districtSentences(entry, realestate, locale);
  return sentences.length ? escapeHtml(sentences.join(" ")) : "";
}

/**
 * 시세 문장 아래에 붙는 두 번째 문단.
 *
 * 위 문단은 스물다섯 구가 같은 틀이다 — 평당 얼마, 평균의 몇 배, 몇 번째. 이쪽은
 * 구마다 눈에 띄는 것만 골라 말하므로 문장의 개수도 종류도 구마다 다르고, 말할 것이
 * 없는 구에서는 통째로 비어 있다. 어느 쪽인지는 `district-facts.mjs`가 정한다.
 */
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
