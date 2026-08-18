import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICT_SLUGS, districtFile } from "./district-slugs.mjs";
import {
  BASE_AREA_M2,
  MIN_SAMPLE,
  areaPrice,
  formatEok,
  monthLabel,
} from "./realestate-format.mjs";

const MAX_CONTEXT = 2;

const REALESTATE_HINTS = [
  "아파트", "전세", "월세", "집값", "분양", "재건축", "재개발", "주택", "매매",
  "시세", "청약", "입주", "빌라", "오피스텔", "보증금", "임대", "실거래",
  "평당", "㎡", "정비사업", "전셋값",
];

const BYLINE = /[([][^)\]]{1,12}=[^)\]]{1,15}[)\]]/g;

const RATE_RULES = [
  {
    key: "rentLoan",
    href: "./rent-loan-rates.html",
    words: ["전세대출", "전세 대출", "전세자금"],
    label: "전세자금대출 최저금리",
    labelEn: "Lowest jeonse loan rate",
  },
  {
    key: "mortgage",
    href: "./mortgage-rates.html",
    words: [
      "주택담보대출", "주담대", "모기지", "집단대출", "중도금", "잔금대출",
      "보금자리론", "디딤돌", "가계대출", "가계부채", "대출여력", "대출 규제", "대출규제",
      "대출 총량", "대출총량", "깡통대출", "이주비",
    ],
    label: "주택담보대출 최저금리",
    labelEn: "Lowest mortgage rate",
  },
  {
    key: "deposit",
    href: "./deposit-rates.html",
    words: ["정기예금", "예금"],
    label: "정기예금 최고금리(12개월)",
    labelEn: "Top 12-month deposit rate",
  },
  {
    key: "saving",
    href: "./saving-rates.html",
    words: ["적금", "저축"],
    label: "적금 최고금리(12개월)",
    labelEn: "Top 12-month savings rate",
  },
];

const SAVING_TERM = 12;
const SAVING_CATEGORIES = new Set(["deposit", "saving"]);

const OVERALL_HREF = {
  sale: "./apartment-sale.html",
  jeonse: "./apartment-jeonse.html",
  wolse: "./apartment-rent.html",
};

const hrefFor = (slug, kind) =>
  slug ? `./${districtFile(slug)}` : OVERALL_HREF[kind] ?? OVERALL_HREF.sale;

const hasAny = (text, words) => words.some((word) => text.includes(word));

const areaKo = (perPyeong10k) => formatEok(areaPrice(perPyeong10k, BASE_AREA_M2), "ko");
const areaEn = (perPyeong10k) => formatEok(areaPrice(perPyeong10k, BASE_AREA_M2), "en");

const CHANGE_MIN_SAMPLE = 20;

const baselineKo = (date) => {
  const [, month, day] = String(date ?? "").split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : null;
};
const baselineEn = (date) => {
  const label = monthLabel(`0000${String(date ?? "").slice(5, 7)}`, "en");
  const day = Number(String(date ?? "").slice(8, 10));
  return label && day ? `${label} ${day}` : null;
};

const signed = (value) => `${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(1)}%`;

function noteOf(metric, change, window, locale) {
  const count = metric?.transactionCount;
  if (typeof count !== "number") return null;

  const span = window?.weeks ? (locale === "en" ? `last ${window.weeks} weeks` : `최근 ${window.weeks}주`) : "";
  const parts = [
    locale === "en"
      ? `${count.toLocaleString("en-US")} deals${span ? ` in the ${span}` : ""}`
      : `${span ? `${span} ` : ""}계약 ${count.toLocaleString("ko-KR")}건`,
  ];

  const baseline = locale === "en" ? baselineEn(metric.baselineDate) : baselineKo(metric.baselineDate);
  if (count >= CHANGE_MIN_SAMPLE && typeof change?.percent === "number" && baseline) {
    parts.push(
      locale === "en" ? `${signed(change.percent)} vs ${baseline}` : `${baseline} 대비 ${signed(change.percent)}`
    );
  }
  return parts.join(" · ");
}

const percentKo = (value) => `연 ${value.toFixed(2)}%`;
const percentEn = (value) => `${value.toFixed(2)}% p.a.`;

const enoughSample = (metric) => Boolean(metric) && (metric.transactionCount ?? 0) >= MIN_SAMPLE;

export function articleText(item) {
  return `${item?.title ?? ""} ${item?.preview ?? ""}`.replace(BYLINE, " ");
}

export function findDistrict(text, districts = []) {
  for (const district of districts) {
    const name = district?.name ?? "";
    if (!name) continue;
    const short = name.endsWith("구") ? name.slice(0, -1) : name;
    if (text.includes(name)) return district;
    if (short.length >= 2 && text.includes(short)) return district;
  }
  return null;
}

export function metricEntry(entry, kind, { name, nameEn, slug = null, window } = {}) {
  const metric = entry?.[kind];
  if (!enoughSample(metric)) return null;

  const common = { kind: "realestate", href: hrefFor(slug, kind) };

  if (kind === "sale" && metric.avgPricePerPyeong10k) {
    return {
      ...common,
      label: `${name} 아파트 ${BASE_AREA_M2}㎡ 매매`,
      labelEn: `${nameEn} apartment ${BASE_AREA_M2}㎡ sale`,
      value: areaKo(metric.avgPricePerPyeong10k),
      valueEn: areaEn(metric.avgPricePerPyeong10k),
      note: noteOf(metric, metric.change, window, "ko"),
      noteEn: noteOf(metric, metric.change, window, "en"),
    };
  }
  if (kind === "jeonse" && metric.avgDepositPerPyeong10k) {
    return {
      ...common,
      label: `${name} 아파트 ${BASE_AREA_M2}㎡ 전세`,
      labelEn: `${nameEn} apartment ${BASE_AREA_M2}㎡ jeonse`,
      value: areaKo(metric.avgDepositPerPyeong10k),
      valueEn: areaEn(metric.avgDepositPerPyeong10k),
      note: noteOf(metric, metric.change, window, "ko"),
      noteEn: noteOf(metric, metric.change, window, "en"),
    };
  }
  if (kind === "wolse" && metric.avgMonthlyRent10k) {
    const deposit = Math.round(metric.avgDeposit10k ?? 0).toLocaleString("ko-KR");
    const rent = Math.round(metric.avgMonthlyRent10k).toLocaleString("ko-KR");
    return {
      ...common,
      label: `${name} 아파트 월세`,
      labelEn: `${nameEn} apartment rent`,
      value: `보증금 ${deposit}만원 / 월 ${rent}만원`,
      valueEn: `₩${((metric.avgDeposit10k ?? 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}M + ₩${(metric.avgMonthlyRent10k / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}M/mo`,
      note: noteOf(metric, metric.depositChange, window, "ko"),
      noteEn: noteOf(metric, metric.depositChange, window, "en"),
    };
  }
  return null;
}

function realestateEntry(entry, name, nameEn, text, slug, window) {
  const wantsJeonse = text.includes("전세") || text.includes("전셋값");
  const wantsWolse = text.includes("월세") || text.includes("임대료");

  const candidates = [];
  if (wantsJeonse) candidates.push("jeonse");
  if (wantsWolse) candidates.push("wolse");
  candidates.push("sale", "jeonse");

  for (const kind of candidates) {
    const entryOf = metricEntry(entry, kind, { name, nameEn, slug, window });
    if (entryOf) return entryOf;
  }
  return null;
}

function realestateContext(text, realestate) {
  if (!hasAny(text, REALESTATE_HINTS)) return null;

  const window = realestate?.window;
  const district = findDistrict(text, realestate?.districts);
  if (district) {
    const slug = DISTRICT_SLUGS[district.name] ?? null;
    return realestateEntry(district, district.name, district.name, text, slug, window);
  }
  if (text.includes("서울")) {
    return realestateEntry(realestate?.overall, "서울 전체", "Seoul", text, null, window);
  }
  return null;
}

export function buildRealestateStats(realestate) {
  const entries = ["sale", "jeonse", "wolse"]
    .map((kind) =>
      metricEntry(realestate?.overall, kind, {
        name: "서울",
        nameEn: "Seoul",
        window: realestate?.window,
      })
    )
    .filter(Boolean);

  return entries.length === 3 ? entries : null;
}

export function bestRate(rates, key) {
  const products = rates?.[key] ?? [];
  const saving = SAVING_CATEGORIES.has(key);
  let best = null;

  for (const product of products) {
    for (const option of product.options ?? []) {
      if (saving && option.term !== SAVING_TERM) continue;
      const value = saving ? option.maxRate ?? option.rate : option.min;
      if (typeof value !== "number") continue;
      if (best === null || (saving ? value > best : value < best)) best = value;
    }
  }
  return best;
}

function ratesContext(text, rates) {
  for (const rule of RATE_RULES) {
    if (!hasAny(text, rule.words)) continue;
    const value = bestRate(rates, rule.key);
    if (value === null) continue;
    return {
      kind: "rates",
      label: rule.label,
      labelEn: rule.labelEn,
      value: percentKo(value),
      valueEn: percentEn(value),
      href: rule.href,
    };
  }
  return null;
}

export function buildContext(item, { realestate, rates } = {}) {
  const text = articleText(item);
  if (!text.trim()) return [];

  return [realestateContext(text, realestate), ratesContext(text, rates)]
    .filter(Boolean)
    .slice(0, MAX_CONTEXT);
}

export function attachContext(news, data) {
  const { realestateStats: _dropStats, ...base } = news ?? {};
  const items = (base.items ?? []).map((item) => {
    const { context: _drop, ...rest } = item;
    const context = buildContext(item, data);
    return context.length ? { ...rest, context } : rest;
  });

  const realestateStats = buildRealestateStats(data?.realestate);
  return realestateStats ? { ...base, items, realestateStats } : { ...base, items };
}

const dataDir = path.resolve(import.meta.dirname, "../docs/data");

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, `${name}.json`), "utf8"));
  } catch {
    console.warn(`  ${name}.json을 읽지 못했습니다 - 이 데이터는 기사에 붙이지 않습니다`);
    return null;
  }
}

async function main() {
  const newsFile = path.join(dataDir, "news.json");
  const [news, realestate, rates] = await Promise.all([
    readFile(newsFile, "utf8").then(JSON.parse),
    readJson("realestate"),
    readJson("rates"),
  ]);

  const next = attachContext(news, { realestate, rates });
  const counts = { realestate: 0, rates: 0 };
  let matched = 0;
  for (const item of next.items) {
    if (!item.context?.length) continue;
    matched += 1;
    for (const c of item.context) counts[c.kind] += 1;
  }

  await writeFile(newsFile, JSON.stringify(next, null, 2));
  console.log(
    `  기사 ${next.items.length}건 중 ${matched}건에 수치를 붙였습니다` +
      ` (실거래가 ${counts.realestate} · 금리 ${counts.rates})`
  );
  if (next.items.length && !matched) {
    console.warn("  경고: 한 건도 붙지 않았습니다. 데이터 파일이 비었는지 확인해주세요");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`뉴스 수치 연결 실패: ${err.message}`);
    process.exit(1);
  });
}
