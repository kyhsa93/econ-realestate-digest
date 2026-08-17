import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.RATES_OUT_DIR
  ? path.resolve(process.env.RATES_OUT_DIR)
  : path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "rates.json");
const historyFile = path.join(dataDir, "rates-history.json");
const metaFile = path.join(dataDir, "rates-meta.json");
const HISTORY_MAX_DAYS = 180;

const API_KEY = process.env.FSS_FINLIFE_API_KEY;

const API_BASE = process.env.FSS_API_BASE ?? "https://finlife.fss.or.kr/finlifeapi";

const USER_AGENT = "Mozilla/5.0 (compatible; econ-realestate-digest/1.0)";

const BANK = "020000";
const SAVINGS_BANK = "030300";

const SECTOR_BY_GROUP = { [BANK]: "bank", [SAVINGS_BANK]: "savingsBank" };

const CATEGORIES = [
  { key: "deposit", endpoint: "depositProductsSearch", groups: [BANK, SAVINGS_BANK], kind: "saving" },
  { key: "saving", endpoint: "savingProductsSearch", groups: [BANK, SAVINGS_BANK], kind: "saving" },
  { key: "mortgage", endpoint: "mortgageLoanProductsSearch", groups: [BANK], kind: "loan" },
  { key: "rentLoan", endpoint: "rentHouseLoanProductsSearch", groups: [BANK], kind: "loan" },
];

const MAX_PAGES = 20;

function kstDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clean(v) {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

async function fetchPage(endpoint, topFinGrpNo, pageNo) {
  const url = `${API_BASE}/${endpoint}.json?auth=${API_KEY}&topFinGrpNo=${topFinGrpNo}&pageNo=${pageNo}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const json = await res.json();
  const result = json?.result;
  if (!result) throw new Error("result 필드 없음");
  if (result.err_cd && result.err_cd !== "000") {
    throw new Error(`API 오류 ${result.err_cd}: ${result.err_msg ?? ""}`.trim());
  }
  return result;
}

async function fetchAllPages(endpoint, topFinGrpNo) {
  const baseList = [];
  const optionList = [];
  let disclosureMonth = null;

  let pageNo = 1;
  let maxPageNo = 1;
  while (pageNo <= maxPageNo && pageNo <= MAX_PAGES) {
    const result = await fetchPage(endpoint, topFinGrpNo, pageNo);
    baseList.push(...(result.baseList ?? []));
    optionList.push(...(result.optionList ?? []));
    disclosureMonth ??= result.baseList?.[0]?.dcls_month ?? null;

    const reported = toNumber(result.max_page_no);
    if (pageNo === 1 && reported && reported > 1) maxPageNo = reported;
    if (reported && reported > MAX_PAGES) {
      console.warn(
        `[fetch-rates] ${endpoint}/${topFinGrpNo}: max_page_no=${reported}인데 ${MAX_PAGES}페이지까지만 수집`
      );
    }
    pageNo += 1;
  }

  return { baseList, optionList, disclosureMonth };
}

function joinProducts({ baseList, optionList, sectorByProduct }, kind) {
  const optionsByProduct = new Map();
  for (const opt of optionList) {
    const id = `${opt.fin_co_no}:${opt.fin_prdt_cd}`;
    if (!optionsByProduct.has(id)) optionsByProduct.set(id, []);
    optionsByProduct.get(id).push(kind === "saving" ? savingOption(opt) : loanOption(opt));
  }
  if (kind === "saving") {
    for (const [id, options] of optionsByProduct) {
      optionsByProduct.set(id, dedupeSavingOptions(options));
    }
  }

  const products = [];
  for (const base of baseList) {
    const id = `${base.fin_co_no}:${base.fin_prdt_cd}`;
    const options = (optionsByProduct.get(id) ?? []).filter(Boolean);
    if (options.length === 0) continue;
    products.push({
      id,
      sector: sectorByProduct.get(id) ?? "bank",
      company: clean(base.kor_co_nm),
      name: clean(base.fin_prdt_nm),
      joinWay: clean(base.join_way),
      ...(kind === "saving"
        ? {
            joinDeny: clean(base.join_deny),
            joinMember: clean(base.join_member),
            maxLimit: toNumber(base.max_limit),
            spclCnd: clean(base.spcl_cnd),
            mtrtInt: clean(base.mtrt_int),
          }
        : {
            loanInciExpn: clean(base.loan_inci_expn),
            erlyRpayFee: clean(base.erly_rpay_fee),
            dlyRate: clean(base.dly_rate),
            loanLmt: clean(base.loan_lmt),
          }),
      options,
    });
  }
  return products;
}

function dedupeSavingOptions(options) {
  const bestByTerm = new Map();
  for (const opt of options) {
    if (!opt) continue;
    const key = opt.term;
    const current = bestByTerm.get(key);
    const rate = opt.maxRate ?? opt.rate ?? -Infinity;
    const currentRate = current ? current.maxRate ?? current.rate ?? -Infinity : -Infinity;
    if (!current || rate > currentRate) bestByTerm.set(key, opt);
  }
  return [...bestByTerm.values()].sort((a, b) => (a.term ?? 0) - (b.term ?? 0));
}

function savingOption(opt) {
  const term = toNumber(opt.save_trm);
  const rate = toNumber(opt.intr_rate);
  const maxRate = toNumber(opt.intr_rate2);
  if (term === null && rate === null && maxRate === null) return null;
  return {
    term,
    rateTypeName: clean(opt.intr_rate_type_nm),
    rate,
    maxRate,
  };
}

function loanOption(opt) {
  const min = toNumber(opt.lend_rate_min);
  const max = toNumber(opt.lend_rate_max);
  const avg = toNumber(opt.lend_rate_avg);
  if (min === null && max === null && avg === null) return null;
  return {
    mortgageType: clean(opt.mrtg_type_nm),
    repayType: clean(opt.rpay_type_nm),
    rateType: clean(opt.lend_rate_type_nm),
    min,
    max,
    avg,
  };
}

function bestSavingAt(products, term, sector) {
  let best = null;
  for (const product of products) {
    if (sector && product.sector !== sector) continue;
    for (const opt of product.options) {
      if (opt.term !== term) continue;
      const rate = opt.maxRate ?? opt.rate;
      if (rate === null) continue;
      if (!best || rate > best.rate) {
        best = { rate, baseRate: opt.rate, company: product.company, name: product.name };
      }
    }
  }
  return best;
}

function lowestLoan(products) {
  let best = null;
  for (const product of products) {
    for (const opt of product.options) {
      const rate = opt.avg ?? opt.min;
      if (rate === null) continue;
      if (!best || rate < best.rate) {
        best = { rate, company: product.company, name: product.name, rateType: opt.rateType };
      }
    }
  }
  return best;
}

async function fetchCategory(category) {
  const merged = { baseList: [], optionList: [], disclosureMonth: null, sectorByProduct: new Map() };
  for (const group of category.groups) {
    const part = await fetchAllPages(category.endpoint, group);
    for (const base of part.baseList) {
      merged.sectorByProduct.set(`${base.fin_co_no}:${base.fin_prdt_cd}`, SECTOR_BY_GROUP[group]);
    }
    merged.baseList.push(...part.baseList);
    merged.optionList.push(...part.optionList);
    merged.disclosureMonth ??= part.disclosureMonth;
  }
  return {
    disclosureMonth: merged.disclosureMonth,
    products: joinProducts(merged, category.kind),
  };
}

async function main() {
  if (!API_KEY) throw new Error("FSS_FINLIFE_API_KEY 환경변수가 필요합니다");

  const now = new Date();
  const today = kstDateString(now);

  const meta = await readMeta();
  if (process.env.RATES_FORCE !== "1" && meta.lastFetchedDate === today) {
    console.log(`[fetch-rates] 오늘(${today}) 이미 조회함 - 건너뜀 (다시 받으려면 RATES_FORCE=1)`);
    return;
  }

  let previous = {};
  try {
    previous = JSON.parse(await readFile(outFile, "utf-8"));
  } catch {
  }

  const result = {};
  let disclosureMonth = null;
  let failed = 0;

  for (const category of CATEGORIES) {
    try {
      const { products, disclosureMonth: month } = await fetchCategory(category);

      const kept = previous[category.key] ?? [];
      if (products.length === 0 && kept.length > 0) {
        failed += 1;
        console.warn(
          `[fetch-rates] ${category.key}: 0건으로 왔다 - 지난번 ${kept.length}건을 그대로 둔다`
        );
        result[category.key] = kept;
        continue;
      }

      result[category.key] = products;
      disclosureMonth ??= month;
      console.log(`[fetch-rates] ${category.key}: 상품 ${products.length}건`);
    } catch (err) {
      failed += 1;
      console.error(`[fetch-rates] ${category.key} 실패: ${err.message}`);
      result[category.key] = previous[category.key] ?? [];
    }
  }

  if (failed === CATEGORIES.length) {
    throw new Error("모든 상품군 수집 실패 - 기존 데이터를 덮어쓰지 않고 중단합니다");
  }

  const payload = {
    updatedAt: now.toISOString(),
    disclosureMonth: disclosureMonth ?? previous.disclosureMonth ?? null,
    ...result,
  };

  await mkdir(dataDir, { recursive: true });

  if (sameContent(previous, payload)) {
    console.log("[fetch-rates] 공시 내용 변화 없음 - rates.json 그대로 둠");
  } else {
    await writeFile(outFile, JSON.stringify(payload));
  }

  await appendHistory(now, result);

  await writeFile(metaFile, JSON.stringify({ lastFetchedDate: today, lastFetchedAt: now.toISOString() }));

  console.log(`[fetch-rates] 저장 완료 (실패 ${failed}/${CATEGORIES.length})`);
}

async function readMeta() {
  try {
    return JSON.parse(await readFile(metaFile, "utf-8"));
  } catch {
    return {};
  }
}

function sameHistoryValue(a, b) {
  const withoutDate = ({ date, ...rest }) => JSON.stringify(rest);
  return withoutDate(a) === withoutDate(b);
}

function sameContent(a, b) {
  const withoutTimestamp = ({ updatedAt, ...rest }) => JSON.stringify(rest);
  return withoutTimestamp(a) === withoutTimestamp(b);
}

async function appendHistory(now, result) {
  let history = [];
  try {
    history = JSON.parse(await readFile(historyFile, "utf-8"));
  } catch {
  }

  const entry = {
    date: kstDateString(now),
    deposit12: {
      bank: bestSavingAt(result.deposit ?? [], 12, "bank"),
      savingsBank: bestSavingAt(result.deposit ?? [], 12, "savingsBank"),
    },
    saving12: {
      bank: bestSavingAt(result.saving ?? [], 12, "bank"),
      savingsBank: bestSavingAt(result.saving ?? [], 12, "savingsBank"),
    },
    mortgage: lowestLoan(result.mortgage ?? []),
    rentLoan: lowestLoan(result.rentLoan ?? []),
  };

  const idx = history.findIndex((h) => h.date === entry.date);
  if (idx >= 0) {
    history[idx] = entry;
  } else {
    const last = history[history.length - 1];
    if (last && sameHistoryValue(last, entry)) {
      console.log("[fetch-rates] 대표 금리 변화 없음 - 히스토리 추가 생략");
      return;
    }
    history.push(entry);
  }

  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length > HISTORY_MAX_DAYS) {
    history = history.slice(history.length - HISTORY_MAX_DAYS);
  }

  await writeFile(historyFile, JSON.stringify(history, null, 2));
}

main().catch((err) => {
  console.error(`[fetch-rates] ${err.message}`);
  process.exit(1);
});
