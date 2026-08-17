import { XMLParser } from "fast-xml-parser";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { attachPrevious, isPreviousUsable } from "./realestate-previous.mjs";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "realestate.json");
const historyFile = path.join(dataDir, "realestate-history.json");
// 지난달 요약. 달이 바뀔 때 한 번만 받고 커밋해 둔다 - CI는 매번 새 러너라 gitignore된
// 캐시는 남지 않고, 그러면 매일 두 달치를 조회해 호출 한도에 걸린다.
const previousFile = path.join(dataDir, "realestate-prev.json");
// 개별 거래 원본. 화면이 받는 docs/data가 아니라 캐시에 둔다 - 서울 한 달치가 수천 건이라
// 여기 두면 화면이 받는 파일이 커지고 커밋 이력도 매일 그만큼 불어난다. 화면에 나가는 건
// build-budget-deals.mjs가 여기서 추려낸 예산 구간 데이터뿐이다.
const dealsFile = process.env.REALESTATE_DEALS_FILE
  ? path.resolve(process.env.REALESTATE_DEALS_FILE)
  : path.resolve(import.meta.dirname, "../cache/realestate-deals.json");
const HISTORY_MAX_DAYS = 180;

const SALE_API_URL = process.env.MOLIT_API_ENDPOINT;
const SALE_SERVICE_KEY = process.env.MOLIT_API_KEY;
const RENT_API_URL = process.env.MOLIT_RENT_API_ENDPOINT;
const RENT_SERVICE_KEY = process.env.MOLIT_RENT_API_KEY;

const DISTRICTS = [
  { code: "11110", name: "종로구" },
  { code: "11140", name: "중구" },
  { code: "11170", name: "용산구" },
  { code: "11200", name: "성동구" },
  { code: "11215", name: "광진구" },
  { code: "11230", name: "동대문구" },
  { code: "11260", name: "중랑구" },
  { code: "11290", name: "성북구" },
  { code: "11305", name: "강북구" },
  { code: "11320", name: "도봉구" },
  { code: "11350", name: "노원구" },
  { code: "11380", name: "은평구" },
  { code: "11410", name: "서대문구" },
  { code: "11440", name: "마포구" },
  { code: "11470", name: "양천구" },
  { code: "11500", name: "강서구" },
  { code: "11530", name: "구로구" },
  { code: "11545", name: "금천구" },
  { code: "11560", name: "영등포구" },
  { code: "11590", name: "동작구" },
  { code: "11620", name: "관악구" },
  { code: "11650", name: "서초구" },
  { code: "11680", name: "강남구" },
  { code: "11710", name: "송파구" },
  { code: "11740", name: "강동구" },
];

const PYEONG_M2 = 3.3058;

// 25개구가 한꺼번에 UND_ERR_CONNECT_TIMEOUT으로 죽는 날이 잦다. 개별 요청이 아니라 그
// 시각 러너와 국토부 서버 사이 경로가 통째로 막히는 모양새라(전부 성공 아니면 전부 실패),
// 우리가 밀어넣는 동시 요청 수를 줄여 그 원인에서 우리 몫을 덜어낸다.
const CONCURRENCY = Number(process.env.MOLIT_CONCURRENCY ?? 3);
const MAX_RETRIES = 3;

// 재시도 간격. 1초·2초는 연결이 막힌 상황에 너무 짧았다 - 5분 안에 세 번을 다 소진하고
// 포기했는데, 52분 뒤 실행은 25개구가 전부 성공했다. 몇 초가 아니라 몇십 초를 기다린다.
const RETRY_BASE_MS = Number(process.env.MOLIT_RETRY_MS ?? 3000);

// 한 바퀴를 다 돌고 나서 실패한 구만 다시 훑기 전에 쉬는 시간. 앞의 재시도가 이미 그
// 구를 세 번 두드린 직후라, 바로 다시 두드려봐야 같은 벽을 만난다.
const SWEEP_DELAY_MS = Number(process.env.MOLIT_SWEEP_DELAY_MS ?? 45_000);

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kstDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

function kstYearMonth(date, monthsAgo = 0) {
  const kstNow = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  kstNow.setMonth(kstNow.getMonth() - monthsAgo);
  const y = kstNow.getFullYear();
  const m = String(kstNow.getMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

async function fetchApiOnce(apiUrl, serviceKey, districtCode, yearMonth) {
  const otherParams = new URLSearchParams({
    LAWD_CD: districtCode,
    DEAL_YMD: yearMonth,
    numOfRows: "9999",
  });
  const url = `${apiUrl}?serviceKey=${serviceKey}&${otherParams.toString()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`http ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser();
  const parsed = parser.parse(xml);

  const header = parsed?.response?.header;
  if (!header) {
    const errMsg = parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg ?? "알 수 없는 응답 형식";
    throw new Error(errMsg);
  }
  if (Number(header.resultCode) !== 0) {
    throw new Error(header.resultMsg ?? `resultCode ${header.resultCode}`);
  }

  const items = parsed?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

async function fetchApi(apiUrl, serviceKey, districtCode, yearMonth) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchApiOnce(apiUrl, serviceKey, districtCode, yearMonth);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) await sleep(attempt * RETRY_BASE_MS);
    }
  }
  throw lastErr;
}

// 계약이 해제된 거래는 "있었던 일"이 아니다. 국토부는 해제분을 지우지 않고 해제 표시만
// 달아 그대로 내려주므로, 걸러내지 않으면 평균에 섞인다. 평균에 섞이는 건 작은 편향이지만
// 예산 검색처럼 거래를 단지 이름과 함께 한 건씩 보여주는 화면에서는 취소된 거래를 실제
// 거래인 것처럼 게시하게 된다.
//
// 스펙상 해제 표시는 cdealType("O")이고 해제일은 cdealDay인데, 둘 중 하나만 채워 내려오는
// 응답도 있어 어느 쪽이든 값이 있으면 해제로 본다. 빈 칸은 XML 파서가 빈 문자열로 준다.
export function isCancelledDeal(item) {
  const filled = (value) => String(value ?? "").trim().length > 0;
  return filled(item?.cdealType) || filled(item?.cdealDay);
}

export function dropCancelled(items) {
  return items.filter((item) => !isCancelledDeal(item));
}

// Node의 fetch는 네트워크 단계에서 실패하면 메시지가 "fetch failed" 한 줄뿐이고 진짜
// 이유(DNS·연결 거부·타임아웃·인증서)는 err.cause에 들어간다. 25개구가 한꺼번에
// "fetch failed"로 죽은 날 로그만 보고는 API가 죽은 건지 우리가 막힌 건지 알 수가 없었다.
export function errorDetail(err) {
  const parts = [err?.message ?? String(err)];
  let cause = err?.cause;
  for (let depth = 0; cause && depth < 3; depth += 1) {
    parts.push(cause.code ?? cause.message ?? String(cause));
    cause = cause.cause;
  }
  return parts.filter(Boolean).join(" ← ");
}

function parseWon10k(value) {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

const NATIONAL_PYEONG_MIN_M2 = 82;
const NATIONAL_PYEONG_MAX_M2 = 86;

function filterByArea(items, minArea, maxArea) {
  return items.filter((item) => {
    const area = Number(item.excluUseAr);
    return Number.isFinite(area) && area >= minArea && area <= maxArea;
  });
}

// 예산 검색이 쓸 개별 거래. 집계만 남기고 버리던 것을 한 건씩 남긴다.
//
// 단지 이름이 없는 거래는 담지 않는다. 예산 화면은 "어느 아파트가 그 값에 팔렸나"에
// 답하는 자리라, 이름 없는 줄은 보여줄 수도 없고 세어봐야 의미도 없다.
export function normalizeDeal(item, districtName) {
  const amount10k = parseWon10k(item?.dealAmount);
  const area = Number(item?.excluUseAr);
  const apt = String(item?.aptNm ?? "").trim();
  const year = Number(item?.dealYear);
  const month = Number(item?.dealMonth);
  const day = Number(item?.dealDay);

  if (!apt) return null;
  if (amount10k == null || amount10k <= 0) return null;
  if (!Number.isFinite(area) || area <= 0) return null;
  // 빈 칸은 Number("")가 0이라 정수 검사만으로는 통과해버린다(날짜가 "2026-08-00"이 됐다).
  const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (!inRange(year, 1900, 2999) || !inRange(month, 1, 12) || !inRange(day, 1, 31)) return null;

  const floor = Number(item?.floor);
  const buildYear = Number(item?.buildYear);

  return {
    district: districtName,
    dong: String(item?.umdNm ?? "").trim(),
    apt,
    area: Math.round(area * 100) / 100,
    floor: Number.isFinite(floor) && floor > 0 ? floor : null,
    amount10k,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    buildYear: Number.isInteger(buildYear) && buildYear > 1900 ? buildYear : null,
  };
}

function summarizeSale(items) {
  let totalAmountWon = 0;
  let totalArea = 0;
  let count = 0;

  for (const item of items) {
    const amount10k = parseWon10k(item.dealAmount);
    const area = Number(item.excluUseAr);
    if (amount10k == null || amount10k <= 0 || !Number.isFinite(area) || area <= 0) continue;
    totalAmountWon += amount10k * 10_000;
    totalArea += area;
    count += 1;
  }

  if (count === 0 || totalArea === 0) return null;

  const avgPricePerM2 = totalAmountWon / totalArea;
  return {
    avgPricePerM2,
    avgPricePerPyeong10k: Math.round((avgPricePerM2 * PYEONG_M2) / 10_000),
    transactionCount: count,
  };
}

function summarizeRent(items) {
  const jeonseRows = [];
  const wolseRows = [];

  for (const item of items) {
    const deposit10k = parseWon10k(item.deposit);
    const monthlyRent10k = parseWon10k(item.monthlyRent);
    const area = Number(item.excluUseAr);
    if (deposit10k == null || deposit10k <= 0 || !Number.isFinite(area) || area <= 0) continue;

    if (monthlyRent10k && monthlyRent10k > 0) {
      wolseRows.push({ deposit10k, monthlyRent10k });
    } else {
      jeonseRows.push({ deposit10k, area });
    }
  }

  let jeonse = null;
  if (jeonseRows.length > 0) {
    const totalDepositWon = jeonseRows.reduce((sum, r) => sum + r.deposit10k * 10_000, 0);
    const totalArea = jeonseRows.reduce((sum, r) => sum + r.area, 0);
    const avgDepositPerM2 = totalDepositWon / totalArea;
    jeonse = {
      avgDepositPerM2,
      avgDepositPerPyeong10k: Math.round((avgDepositPerM2 * PYEONG_M2) / 10_000),
      transactionCount: jeonseRows.length,
    };
  }

  let wolse = null;
  if (wolseRows.length > 0) {
    wolse = {
      avgDeposit10k: Math.round(wolseRows.reduce((sum, r) => sum + r.deposit10k, 0) / wolseRows.length),
      avgMonthlyRent10k: Math.round(wolseRows.reduce((sum, r) => sum + r.monthlyRent10k, 0) / wolseRows.length),
      transactionCount: wolseRows.length,
    };
  }

  return { jeonse, wolse };
}

async function fetchDistrictSale(districtCode, yearMonths) {
  const results = await Promise.all(yearMonths.map((ym) => fetchApi(SALE_API_URL, SALE_SERVICE_KEY, districtCode, ym)));
  const all = results.flat();
  const items = dropCancelled(all);
  return {
    sale: summarizeSale(items),
    saleNational84: summarizeSale(filterByArea(items, NATIONAL_PYEONG_MIN_M2, NATIONAL_PYEONG_MAX_M2)),
    items,
    cancelledCount: all.length - items.length,
  };
}

async function fetchDistrictRent(districtCode, yearMonths) {
  const results = await Promise.all(yearMonths.map((ym) => fetchApi(RENT_API_URL, RENT_SERVICE_KEY, districtCode, ym)));
  return summarizeRent(results.flat());
}

async function readHistory() {
  try {
    return JSON.parse(await readFile(historyFile, "utf-8"));
  } catch {
    return [];
  }
}

function findBaseline(history, now) {
  if (!history.length) return null;
  const target = new Date(now);
  target.setDate(target.getDate() - 7);
  const targetDate = kstDateString(target);
  const older = history.filter((h) => h.date <= targetDate);
  const baseline = older.length ? older[older.length - 1] : history[0];
  return baseline.date === kstDateString(now) ? null : baseline;
}

function computeChange(currentValue, baselineValue) {
  if (currentValue == null || baselineValue == null) return null;
  const value10kDiff = currentValue - baselineValue;
  const percent = baselineValue !== 0 ? (value10kDiff / baselineValue) * 100 : null;
  return { value10k: value10kDiff, percent };
}

function withSaleChange(sale, baselineSale, baselineDate) {
  if (!sale) return sale;
  const change = computeChange(sale.avgPricePerPyeong10k, baselineSale?.avgPricePerPyeong10k);
  return change ? { ...sale, change, baselineDate } : sale;
}

function withJeonseChange(jeonse, baselineJeonse, baselineDate) {
  if (!jeonse) return jeonse;
  const change = computeChange(jeonse.avgDepositPerPyeong10k, baselineJeonse?.avgDepositPerPyeong10k);
  return change ? { ...jeonse, change, baselineDate } : jeonse;
}

function withWolseChange(wolse, baselineWolse, baselineDate) {
  if (!wolse) return wolse;
  const depositChange = computeChange(wolse.avgDeposit10k, baselineWolse?.avgDeposit10k);
  const monthlyRentChange = computeChange(wolse.avgMonthlyRent10k, baselineWolse?.avgMonthlyRent10k);
  if (!depositChange && !monthlyRentChange) return wolse;
  return { ...wolse, depositChange, monthlyRentChange, baselineDate };
}

function attachChanges(overall, districts, baseline) {
  const baselineDate = baseline?.date;
  const findBaselineDistrict = (code) => baseline?.districts?.find((d) => d.code === code);

  return {
    overall: {
      sale: withSaleChange(overall.sale, baseline?.overall?.sale, baselineDate),
      saleNational84: withSaleChange(overall.saleNational84, baseline?.overall?.saleNational84, baselineDate),
      jeonse: withJeonseChange(overall.jeonse, baseline?.overall?.jeonse, baselineDate),
      wolse: withWolseChange(overall.wolse, baseline?.overall?.wolse, baselineDate),
    },
    districts: districts.map((d) => {
      const b = findBaselineDistrict(d.code);
      return {
        ...d,
        sale: withSaleChange(d.sale, b?.sale, baselineDate),
        saleNational84: withSaleChange(d.saleNational84, b?.saleNational84, baselineDate),
        jeonse: withJeonseChange(d.jeonse, b?.jeonse, baselineDate),
        wolse: withWolseChange(d.wolse, b?.wolse, baselineDate),
      };
    }),
  };
}

async function appendHistory(history, now, entry) {
  const today = kstDateString(now);
  const record = { date: today, ...entry };

  const idx = history.findIndex((h) => h.date === today);
  if (idx >= 0) {
    history[idx] = record;
  } else {
    history.push(record);
  }

  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length > HISTORY_MAX_DAYS) {
    history = history.slice(history.length - HISTORY_MAX_DAYS);
  }

  await writeFile(historyFile, JSON.stringify(history, null, 2));
}

function weightedAverage(list, getValue, getWeight) {
  let totalWeighted = 0;
  let totalWeight = 0;
  for (const item of list) {
    const v = getValue(item);
    const w = getWeight(item);
    if (v == null || !w) continue;
    totalWeighted += v * w;
    totalWeight += w;
  }
  return totalWeight ? totalWeighted / totalWeight : null;
}

/**
 * 조회에 실패한 구를 지난번에 받아둔 값으로 채운다.
 *
 * 그냥 빠뜨리면 표가 조용히 24개구가 되고, 읽는 사람은 그 구에 거래가 없었다고 읽는다 -
 * 못 받은 것과 거래가 없는 것은 전혀 다른 얘기다.
 *
 * 채운 구에는 그 값을 실제로 받은 시각(staleAt)을 남긴다. 이미 묵어 있던 구를 또 못
 * 받았다면 그때 시각을 그대로 물려받아야 한다 - 매번 오늘로 갱신하면 며칠째 묵은 값이
 * 어제 받은 값처럼 보인다.
 */
export function carryForward(allDistricts, fetched, existing, existingIsToday) {
  const fetchedByCode = new Map((fetched ?? []).map((d) => [d.code, d]));
  const existingByCode = new Map((existing?.districts ?? []).map((d) => [d.code, d]));

  const districts = [];
  const carriedNames = [];

  for (const { code, name } of allDistricts) {
    const fresh = fetchedByCode.get(code);
    if (fresh) {
      districts.push(fresh);
      continue;
    }

    const old = existingByCode.get(code);
    if (!old) continue;

    // 오늘 이미 받아둔 구다(누락분만 다시 도는 실행). 묵은 값이 아니다.
    if (existingIsToday) {
      districts.push(old);
      continue;
    }

    districts.push({ ...old, staleAt: old.staleAt ?? existing.updatedAt });
    carriedNames.push(name);
  }

  return { districts, carriedNames };
}

// 서울 전체 평균. 구별 값을 신고 건수로 가중해 합친다.
//
// 화면에 나가는 값과 history에 남기는 값이 서로 다른 구 집합에서 나오기 때문에 함수로
// 뺐다 - 조회에 실패해 지난번 값으로 채운 구는 화면에는 있어야 하지만, "오늘 신고분"
// 기록에 섞이면 그날 추이가 며칠 전 값으로 만들어진다.
function computeOverall(districts) {
  const saleDistricts = districts.filter((d) => d.sale);
  const overallSaleAvgM2 = weightedAverage(saleDistricts, (d) => d.sale.avgPricePerM2, (d) => d.sale.transactionCount);
  const overallSale =
    overallSaleAvgM2 == null
      ? null
      : {
          avgPricePerM2: overallSaleAvgM2,
          avgPricePerPyeong10k: Math.round((overallSaleAvgM2 * PYEONG_M2) / 10_000),
          transactionCount: saleDistricts.reduce((sum, d) => sum + d.sale.transactionCount, 0),
        };

  const saleNational84Districts = districts.filter((d) => d.saleNational84);
  const overallSaleNational84AvgM2 = weightedAverage(
    saleNational84Districts,
    (d) => d.saleNational84.avgPricePerM2,
    (d) => d.saleNational84.transactionCount
  );
  const overallSaleNational84 =
    overallSaleNational84AvgM2 == null
      ? null
      : {
          avgPricePerM2: overallSaleNational84AvgM2,
          avgPricePerPyeong10k: Math.round((overallSaleNational84AvgM2 * PYEONG_M2) / 10_000),
          transactionCount: saleNational84Districts.reduce((sum, d) => sum + d.saleNational84.transactionCount, 0),
        };

  const jeonseDistricts = districts.filter((d) => d.jeonse);
  const overallJeonseAvgM2 = weightedAverage(
    jeonseDistricts,
    (d) => d.jeonse.avgDepositPerM2,
    (d) => d.jeonse.transactionCount
  );
  const overallJeonse =
    overallJeonseAvgM2 == null
      ? null
      : {
          avgDepositPerM2: overallJeonseAvgM2,
          avgDepositPerPyeong10k: Math.round((overallJeonseAvgM2 * PYEONG_M2) / 10_000),
          transactionCount: jeonseDistricts.reduce((sum, d) => sum + d.jeonse.transactionCount, 0),
        };

  const wolseDistricts = districts.filter((d) => d.wolse);
  const overallWolse =
    wolseDistricts.length === 0
      ? null
      : {
          avgDeposit10k: Math.round(
            weightedAverage(wolseDistricts, (d) => d.wolse.avgDeposit10k, (d) => d.wolse.transactionCount)
          ),
          avgMonthlyRent10k: Math.round(
            weightedAverage(wolseDistricts, (d) => d.wolse.avgMonthlyRent10k, (d) => d.wolse.transactionCount)
          ),
          transactionCount: wolseDistricts.reduce((sum, d) => sum + d.wolse.transactionCount, 0),
        };
  return { sale: overallSale, saleNational84: overallSaleNational84, jeonse: overallJeonse, wolse: overallWolse };
}

async function main() {
  const hasSale = Boolean(SALE_SERVICE_KEY && SALE_API_URL);
  const hasRent = Boolean(RENT_SERVICE_KEY && RENT_API_URL);
  if (!hasSale && !hasRent) {
    console.error("[fetch-realestate] MOLIT_API_KEY/MOLIT_RENT_API_KEY 둘 다 없음, 생략");
    return;
  }

  const now = new Date();

  let existing = null;
  try {
    existing = JSON.parse(await readFile(outFile, "utf-8"));
  } catch {
    existing = null;
  }

  const existingIsToday =
    Boolean(existing?.updatedAt) && kstDateString(new Date(existing.updatedAt)) === kstDateString(now);
  const existingDistrictCodes = new Set((existing?.districts ?? []).map((d) => d.code));
  const targetDistricts = existingIsToday ? DISTRICTS.filter((d) => !existingDistrictCodes.has(d.code)) : DISTRICTS;

  if (existingIsToday && targetDistricts.length === 0) {
    console.log(`[fetch-realestate] 오늘(${kstDateString(now)}) 25개구 전부 이미 조회 완료, 생략`);
    return;
  }
  if (existingIsToday) {
    console.log(`[fetch-realestate] 오늘 이미 조회했지만 ${targetDistricts.length}개구 누락, 누락분만 재조회`);
  }

  const yearMonths = [kstYearMonth(now, 0)];

  // 예산 검색용 거래는 이번 달 조회분만 모은다. 지난달 캐시를 채우려고 도는 조회까지
  // 담으면 "최근 거래"에 지난달이 섞인다.
  const dealsByDistrict = new Map();
  let cancelledTotal = 0;

  async function fetchDistrictEntry({ code, name }, months = yearMonths, collectDeals = true) {
    const entry = { code, name, sale: null, saleNational84: null, jeonse: null, wolse: null };

    if (hasSale) {
      try {
        const saleResult = await fetchDistrictSale(code, months);
        entry.sale = saleResult.sale;
        entry.saleNational84 = saleResult.saleNational84;
        // 거래 원본은 entry에 싣지 않는다. entry는 realestate.json·history·지난달 캐시로
        // 그대로 흘러가는 값이라, 여기 실으면 세 파일이 한꺼번에 수십 배로 불어난다.
        if (collectDeals) {
          dealsByDistrict.set(code, saleResult.items.map((item) => normalizeDeal(item, name)).filter(Boolean));
          cancelledTotal += saleResult.cancelledCount;
        }
      } catch (err) {
        console.error(`[fetch-realestate] ${name} 매매 조회 실패: ${errorDetail(err)}`);
      }
    }
    if (hasRent) {
      try {
        const rent = await fetchDistrictRent(code, months);
        entry.jeonse = rent.jeonse;
        entry.wolse = rent.wolse;
      } catch (err) {
        console.error(`[fetch-realestate] ${name} 전월세 조회 실패: ${errorDetail(err)}`);
      }
    }

    return entry.sale || entry.jeonse || entry.wolse ? entry : null;
  }

  const results = await mapWithConcurrency(targetDistricts, CONCURRENCY, (d) => fetchDistrictEntry(d));

  const failedIndexes = results.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
  if (failedIndexes.length > 0) {
    console.log(
      `[fetch-realestate] ${failedIndexes.length}개구 실패,` +
        ` ${Math.round(SWEEP_DELAY_MS / 1000)}초 쉬고 재시도 스윕 시작`
    );
    await sleep(SWEEP_DELAY_MS);
    const retried = await mapWithConcurrency(
      failedIndexes.map((i) => targetDistricts[i]),
      CONCURRENCY,
      (d) => fetchDistrictEntry(d)
    );
    failedIndexes.forEach((i, j) => {
      if (retried[j]) results[i] = retried[j];
    });
    const stillFailed = failedIndexes.filter((i) => !results[i]).map((i) => targetDistricts[i].name);
    if (stillFailed.length > 0) {
      console.error(`[fetch-realestate] 재시도 후에도 실패: ${stillFailed.join(", ")}`);
    } else {
      console.log("[fetch-realestate] 재시도 스윕으로 전부 복구됨");
    }
  }

  const newlyFetched = results.filter(Boolean);

  // 한 구도 못 받았으면 파일을 건드리지 않는다. 지난번 값으로만 채운 파일을 새로 쓰면
  // 내용은 그대로인데 updatedAt만 오늘로 바뀌어, 화면이 "오늘 받은 값"이라고 말하게 된다.
  if (newlyFetched.length === 0) {
    console.error("[fetch-realestate] 모든 지역 조회 실패, 기존 데이터를 그대로 둡니다");
    return;
  }

  const { districts, carriedNames } = carryForward(DISTRICTS, newlyFetched, existing, existingIsToday);

  if (carriedNames.length > 0) {
    console.warn(
      `[fetch-realestate] ${carriedNames.length}개구를 지난번 값으로 채웠습니다: ${carriedNames.join(", ")}`
    );
  }

  const overall = computeOverall(districts);
  const period = yearMonths[0];

  const history = await readHistory();
  const baseline = findBaseline(history, now);
  const withChanges = attachChanges(overall, districts, baseline);

  // 지난달 값을 얹는다. 이번 달 신고가 아직 얇은 구는 화면이 이쪽으로 대체하고,
  // 그 셀이 어느 달 기준인지 같이 표시한다.
  const previousPeriod = kstYearMonth(now, 1);
  let previous = null;
  try {
    previous = JSON.parse(await readFile(previousFile, "utf-8"));
  } catch {
    previous = null;
  }

  if (!isPreviousUsable(previous, previousPeriod)) {
    console.log(`[fetch-realestate] 지난달(${previousPeriod}) 캐시 없음, 이번 한 번만 조회`);
    try {
      const prevResults = await mapWithConcurrency(DISTRICTS, CONCURRENCY, (d) =>
        fetchDistrictEntry(d, [previousPeriod], false)
      );
      const prevDistricts = prevResults.filter(Boolean);
      if (prevDistricts.length) {
        previous = { period: previousPeriod, fetchedAt: now.toISOString(), districts: prevDistricts };
        await writeFile(previousFile, JSON.stringify(previous, null, 2));
        console.log(`[fetch-realestate] 지난달 캐시 저장 (${prevDistricts.length}개구)`);
      } else {
        previous = null;
      }
    } catch (err) {
      // 지난달 조회가 실패해도 이번 달 데이터는 그대로 낸다. 다음 실행에서 다시 시도된다.
      console.error(`[fetch-realestate] 지난달 조회 실패: ${errorDetail(err)}`);
      previous = null;
    }
  }

  // 오늘 일부 구만 재조회한 경우에도 조회한 구의 거래만 갈아끼우고 나머지는 남긴다.
  // 조용히 사라지는 지역이 생기면 예산 화면에서 그 구가 통째로 빠져 보인다.
  async function writeDeals(dealsPeriod, at) {
    if (dealsByDistrict.size === 0) return;

    let existingDeals = null;
    try {
      existingDeals = JSON.parse(await readFile(dealsFile, "utf-8"));
    } catch {
      existingDeals = null;
    }

    const byDistrict = new Map(
      existingDeals?.period === dealsPeriod ? Object.entries(existingDeals.districts ?? {}) : []
    );
    for (const [code, deals] of dealsByDistrict) byDistrict.set(code, deals);

    const districtsObj = Object.fromEntries(byDistrict);
    const total = Object.values(districtsObj).reduce((sum, list) => sum + list.length, 0);

    await mkdir(path.dirname(dealsFile), { recursive: true });
    await writeFile(
      dealsFile,
      JSON.stringify({ period: dealsPeriod, updatedAt: at.toISOString(), districts: districtsObj }, null, 2)
    );

    // 해제분을 몇 건 걸렀는지 남긴다. 조용히 걸러내면 필드 이름이 바뀌어 한 건도 못 거르는
    // 날이 와도 화면상 달라지는 게 없어 알아챌 방법이 없다.
    console.log(
      `[fetch-realestate] 예산 검색용 거래 ${total.toLocaleString("ko-KR")}건 저장` +
        ` (해제 ${cancelledTotal.toLocaleString("ko-KR")}건 제외)`
    );
  }

  const payload = attachPrevious({ updatedAt: now.toISOString(), period, ...withChanges }, previous);

  await mkdir(dataDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  // history는 추이 그래프와 "며칠 전 대비" 기준선의 재료다. 지난번 값으로 채운 구를 오늘
  // 신고분으로 기록하면 그날 변화가 0으로 눌리고, 그 왜곡이 180일치에 남는다.
  await appendHistory(history, now, {
    period,
    overall: carriedNames.length ? computeOverall(newlyFetched) : overall,
    districts: newlyFetched,
  });
  await writeDeals(period, now);

  console.log(
    `[fetch-realestate] 저장 완료 (매매 ${saleDistricts.length}개구, 전세 ${jeonseDistricts.length}개구, 월세 ${wolseDistricts.length}개구)`
  );
}

// 다른 파일에서 이 모듈의 함수를 가져다 쓰는 순간(테스트가 그렇다) import만으로 조회가
// 시작되면 안 된다. 저장소의 다른 스크립트와 같은 가드를 둔다.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
