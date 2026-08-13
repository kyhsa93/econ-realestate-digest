import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

// 출력 경로도 테스트가 실제 docs/data를 덮어쓰지 않도록 바꿔 끼울 수 있게 한다.
const dataDir = process.env.RATES_OUT_DIR
  ? path.resolve(process.env.RATES_OUT_DIR)
  : path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "rates.json");
const historyFile = path.join(dataDir, "rates-history.json");
const HISTORY_MAX_DAYS = 180;

const API_KEY = process.env.FSS_FINLIFE_API_KEY;

// 금감원 오픈API는 공공데이터포털이 아니라 finlife.fss.or.kr에서 직접 발급받는
// 32자리 인증키를 쓰고, 파라미터명도 serviceKey가 아니라 auth다. 엔드포인트가
// 활용신청마다 달라지지 않아서(상품군이 경로로만 갈림) MOLIT처럼 URL을 시크릿으로
// 빼지 않고 여기 상수로 둔다.
// 테스트에서 스텁 서버로 바꿔 끼울 수 있게 열어둔다(운영에서는 설정하지 않는다).
const API_BASE = process.env.FSS_API_BASE ?? "https://finlife.fss.or.kr/finlifeapi";

// User-Agent를 안 보내면 서버가 TLS 핸드셰이크 직후 연결을 그냥 끊어버린다
// (curl 기준 "unexpected eof while reading"). 404나 에러 응답이 아니라 아예
// 응답이 없어서 원인을 찾기 어려우니 반드시 유지할 것.
const USER_AGENT = "Mozilla/5.0 (compatible; econ-realestate-digest/1.0)";

// 권역코드. 예·적금은 저축은행 금리가 1금융권보다 확연히 높아서 비교 대상에
// 넣어야 의미가 있고, 대출은 은행권만 본다(저축은행 주담대는 성격이 다르다).
const BANK = "020000";
const SAVINGS_BANK = "030300";

// 화면에서 "은행만 보기"를 거를 수 있게 상품마다 권역을 태깅한다. 저축은행은
// 금리가 높은 대신 예금자보호 한도까지 쪼개 넣어야 하는 등 성격이 달라서
// 한 표에 섞어두기만 하면 오히려 오해를 부른다.
const SECTOR_BY_GROUP = { [BANK]: "bank", [SAVINGS_BANK]: "savingsBank" };

const CATEGORIES = [
  { key: "deposit", endpoint: "depositProductsSearch", groups: [BANK, SAVINGS_BANK], kind: "saving" },
  { key: "saving", endpoint: "savingProductsSearch", groups: [BANK, SAVINGS_BANK], kind: "saving" },
  { key: "mortgage", endpoint: "mortgageLoanProductsSearch", groups: [BANK], kind: "loan" },
  { key: "rentLoan", endpoint: "rentHouseLoanProductsSearch", groups: [BANK], kind: "loan" },
];

// 한 권역에서 상품이 아무리 많아도 이 페이지 수를 넘기지 않는다. 응답의
// max_page_no를 그대로 믿고 돌면 API가 이상한 값을 줬을 때 무한정 호출하게 된다.
const MAX_PAGES = 20;

function kstDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 응답에 섞여 오는 공백/개행을 정리한다. 우대조건(spcl_cnd)이 특히 지저분하다. */
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
  // err_cd "000"이 정상. 인증키 오류(010)든 뭐든 여기서 걸러야 빈 배열을
  // 정상 응답으로 착각하지 않는다.
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

/** baseList(상품)와 optionList(금리 옵션)를 회사코드+상품코드로 묶는다. */
function joinProducts({ baseList, optionList, sectorByProduct }, kind) {
  const optionsByProduct = new Map();
  for (const opt of optionList) {
    const id = `${opt.fin_co_no}:${opt.fin_prdt_cd}`;
    if (!optionsByProduct.has(id)) optionsByProduct.set(id, []);
    optionsByProduct.get(id).push(kind === "saving" ? savingOption(opt) : loanOption(opt));
  }

  const products = [];
  for (const base of baseList) {
    const id = `${base.fin_co_no}:${base.fin_prdt_cd}`;
    const options = (optionsByProduct.get(id) ?? []).filter(Boolean);
    // 금리 옵션이 하나도 없는 상품은 화면에 보여줄 값이 없다.
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

function savingOption(opt) {
  const term = toNumber(opt.save_trm);
  const rate = toNumber(opt.intr_rate);
  const maxRate = toNumber(opt.intr_rate2);
  // 기간도 금리도 없는 옵션은 버린다(간혹 빈 껍데기가 섞여 온다).
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

/** 예·적금 상품 중 특정 기간에서 최고 우대금리를 주는 것을 찾는다. */
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

/** 대출 상품 중 평균금리가 가장 낮은 것을 찾는다. */
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
    // 권역을 순차로 도는 건 상대방 서버를 배려하는 목적도 있지만, 한 권역이
    // 실패했을 때 어느 권역인지 로그에 남기려는 목적이 더 크다.
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

  let previous = {};
  try {
    previous = JSON.parse(await readFile(outFile, "utf-8"));
  } catch {
    // 최초 실행이면 이전 데이터 없음
  }

  const result = {};
  let disclosureMonth = null;
  let failed = 0;

  for (const category of CATEGORIES) {
    try {
      const { products, disclosureMonth: month } = await fetchCategory(category);
      result[category.key] = products;
      disclosureMonth ??= month;
      console.log(`[fetch-rates] ${category.key}: 상품 ${products.length}건`);
    } catch (err) {
      failed += 1;
      // 한 상품군이 실패해도 나머지는 갱신한다. 직전 값이 있으면 그대로 유지해
      // 화면에서 섹션이 통째로 사라지는 것을 막는다.
      console.error(`[fetch-rates] ${category.key} 실패: ${err.message}`);
      result[category.key] = previous[category.key] ?? [];
    }
  }

  if (failed === CATEGORIES.length) {
    throw new Error("모든 상품군 수집 실패 - 기존 데이터를 덮어쓰지 않고 중단합니다");
  }

  const now = new Date();
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    outFile,
    JSON.stringify(
      { updatedAt: now.toISOString(), disclosureMonth: disclosureMonth ?? previous.disclosureMonth ?? null, ...result },
      null,
      2
    )
  );

  await appendHistory(now, result);

  console.log(`[fetch-rates] 저장 완료 (실패 ${failed}/${CATEGORIES.length})`);
}

async function appendHistory(now, result) {
  let history = [];
  try {
    history = JSON.parse(await readFile(historyFile, "utf-8"));
  } catch {
    // 최초 실행이면 이전 히스토리 없음
  }

  // 히스토리에는 상품 전체가 아니라 "그날의 대표값"만 남긴다. 상품 목록을
  // 통째로 쌓으면 며칠 만에 수 MB가 되고, 추이 그래프에 필요한 건 대표값뿐이다.
  // 은행과 저축은행은 금리대 자체가 달라서 한 선으로 합치면 저축은행 값만
  // 보이는 그래프가 된다. 12개월 기준으로 권역을 나눠 남긴다.
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
    history[idx] = entry; // 같은 날 재실행 시 덮어쓰기 (중복 방지)
  } else {
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
