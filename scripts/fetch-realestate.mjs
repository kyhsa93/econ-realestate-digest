import { XMLParser } from "fast-xml-parser";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "realestate.json");
const historyFile = path.join(dataDir, "realestate-history.json");
const HISTORY_MAX_DAYS = 180;

const SALE_API_URL = process.env.MOLIT_API_ENDPOINT;
const SALE_SERVICE_KEY = process.env.MOLIT_API_KEY;
const RENT_API_URL = process.env.MOLIT_RENT_API_ENDPOINT;
const RENT_SERVICE_KEY = process.env.MOLIT_RENT_API_KEY;

// 서울 25개 자치구 전체. 전국이 아니라 "서울" 기준 평균/구별 값이다.
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

// 데이터포털이 짧은 시간에 몰리는 요청에 종종 "fetch failed"(네트워크
// 레벨)로 실패하는 걸 확인해서, 재시도와 동시 요청 수 제한을 둔다.
// 매매+전월세를 같이 조회하면서 요청량이 다시 2배가 되는 만큼 유지한다.
const CONCURRENCY = 5;
const MAX_RETRIES = 3;

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
  // serviceKey는 URLSearchParams로 넣으면 안 됨: 공공데이터포털에서 발급되는
  // "Encoding" 인증키는 이미 퍼센트 인코딩된 문자열이라, searchParams.set()이
  // 한 번 더 인코딩해버리면(%가 %25로 바뀌는 식) 키가 깨져서 403이 난다.
  // 그래서 serviceKey만 raw 그대로 쿼리스트링에 붙이고, 나머지 파라미터만
  // URLSearchParams로 인코딩한다.
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
    // 서비스키 오류 등은 OpenAPI_ServiceResponse 포맷으로 옴
    const errMsg = parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg ?? "알 수 없는 응답 형식";
    throw new Error(errMsg);
  }
  // fast-xml-parser가 "00"/"000" 같은 숫자로만 된 문자열을 자동으로 숫자
  // 0으로 바꿔버려서, 문자열로 비교하면 정상 응답도 에러로 오판된다.
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
      if (attempt < MAX_RETRIES) await sleep(attempt * 1000);
    }
  }
  throw lastErr;
}

function parseWon10k(value) {
  // "120,000" (만원 단위, 쉼표 포함 문자열) -> 120000 (만원)
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function summarizeSale(items) {
  let totalAmountWon = 0;
  let totalArea = 0;
  let count = 0;

  for (const item of items) {
    const amount10k = parseWon10k(item.dealAmount);
    const area = Number(item.excluUseAr);
    // Number("")는 0이라 값이 비어있는 행이 "0원 거래"로 잘못 집계되는 걸 방지
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

// 전월세 API는 전세(월세 0원)와 월세(보증금+월세) 거래가 섞여서 온다.
// 성격이 달라서 하나로 합치지 않고 따로 집계한다: 전세는 매매처럼
// 평당 보증금으로, 월세는 면적 정규화 없이 평균 보증금/월세 그대로 보여준다.
function summarizeRent(items) {
  const jeonseRows = [];
  const wolseRows = [];

  for (const item of items) {
    const deposit10k = parseWon10k(item.deposit);
    const monthlyRent10k = parseWon10k(item.monthlyRent);
    const area = Number(item.excluUseAr);
    // Number("")는 0이라 보증금이 비어있는 행이 "0원 보증금"으로 잘못 집계되는 걸 방지
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
  return summarizeSale(results.flat());
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

// "이번 주 거래"만 따로 집계하지 않고, 매일 갱신되는 이번 달 누적 평균의
// 스냅샷을 1주일 간격으로 비교한다. 실거래 신고가 계약 후 최대 30일까지
// 늦게 들어오기 때문에, 계약일 기준으로 진짜 주간 집계를 하면 최근 1~2주는
// 신고가 덜 끝나서 표본이 인위적으로 적어 보이는 문제가 있어 이 방식을 택함.
// 1주일 전에 가장 가까운(그 이전) 기록을 기준값으로 삼는다. 아직 7일치가
// 없으면(도입 초기) 가장 오래된 기록을 기준값으로 쓴다.
function findBaseline(history, now) {
  if (!history.length) return null;
  const target = new Date(now);
  target.setDate(target.getDate() - 7);
  const targetDate = kstDateString(target);
  const older = history.filter((h) => h.date <= targetDate);
  const baseline = older.length ? older[older.length - 1] : history[0];
  // 오늘 처음 쌓인 기록만 있으면 기준값이 오늘 자신이 되어버려 "오늘 대비
  // 0%"라는 의미 없는 비교가 나온다. 그럴 땐 아직 비교할 과거가 없는 것으로 취급.
  return baseline.date === kstDateString(now) ? null : baseline;
}

function computeChange(currentValue, baselineValue) {
  if (currentValue == null || baselineValue == null) return null;
  const value10kDiff = currentValue - baselineValue;
  const percent = baselineValue !== 0 ? (value10kDiff / baselineValue) * 100 : null;
  return { value10k: value10kDiff, percent };
}

// 월세는 보증금/월세 두 축이라 하나의 증감 지표로 압축하기 애매해서
// 증감 추적은 매매·전세(둘 다 "평당 가격" 성격)에만 붙인다.
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

function attachChanges(overall, districts, baseline) {
  const baselineDate = baseline?.date;
  const findBaselineDistrict = (code) => baseline?.districts?.find((d) => d.code === code);

  return {
    overall: {
      sale: withSaleChange(overall.sale, baseline?.overall?.sale, baselineDate),
      jeonse: withJeonseChange(overall.jeonse, baseline?.overall?.jeonse, baselineDate),
      wolse: overall.wolse,
    },
    districts: districts.map((d) => {
      const b = findBaselineDistrict(d.code);
      return {
        ...d,
        sale: withSaleChange(d.sale, b?.sale, baselineDate),
        jeonse: withJeonseChange(d.jeonse, b?.jeonse, baselineDate),
      };
    }),
  };
}

async function appendHistory(history, now, entry) {
  const today = kstDateString(now);
  const record = { date: today, ...entry };

  const idx = history.findIndex((h) => h.date === today);
  if (idx >= 0) {
    history[idx] = record; // 같은 날 재실행 시 덮어쓰기 (중복 방지)
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

async function main() {
  const hasSale = Boolean(SALE_SERVICE_KEY && SALE_API_URL);
  const hasRent = Boolean(RENT_SERVICE_KEY && RENT_API_URL);
  if (!hasSale && !hasRent) {
    console.error("[fetch-realestate] MOLIT_API_KEY/MOLIT_RENT_API_KEY 둘 다 없음, 생략");
    return;
  }

  const now = new Date();
  // 이번 달치만 조회 (예전엔 월초 표본 부족을 피하려고 지난달까지 2개월을
  // 합쳤는데, 요청량이 2배가 돼서 25개구 조회 시 데이터포털 일일 한도에
  // 걸리는 걸 겪었음 - 이번 달만 봐도 대체로 충분한 표본이 쌓이는 편이라
  // 요청량을 줄이는 쪽을 택함).
  const yearMonths = [kstYearMonth(now, 0)];

  const results = await mapWithConcurrency(DISTRICTS, CONCURRENCY, async ({ code, name }) => {
    const entry = { code, name, sale: null, jeonse: null, wolse: null };

    if (hasSale) {
      try {
        entry.sale = await fetchDistrictSale(code, yearMonths);
      } catch (err) {
        console.error(`[fetch-realestate] ${name} 매매 조회 실패: ${err.message}`);
      }
    }
    if (hasRent) {
      try {
        const rent = await fetchDistrictRent(code, yearMonths);
        entry.jeonse = rent.jeonse;
        entry.wolse = rent.wolse;
      } catch (err) {
        console.error(`[fetch-realestate] ${name} 전월세 조회 실패: ${err.message}`);
      }
    }

    return entry.sale || entry.jeonse || entry.wolse ? entry : null;
  });

  const districts = results.filter(Boolean);
  if (districts.length === 0) {
    console.error("[fetch-realestate] 모든 지역 조회 실패, 기존 데이터 유지");
    return;
  }

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

  const overall = { sale: overallSale, jeonse: overallJeonse, wolse: overallWolse };
  const period = yearMonths[0];

  // 히스토리는 변화율 계산 없이 원값만 저장(나중에 다른 기준일로도 재계산
  // 가능하게), 화면에 보여줄 오늘자 realestate.json에만 1주일 전 대비 증감을 붙인다.
  const history = await readHistory();
  const baseline = findBaseline(history, now);
  const withChanges = attachChanges(overall, districts, baseline);

  const payload = { updatedAt: now.toISOString(), period, ...withChanges };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  await appendHistory(history, now, { period, overall, districts });

  console.log(
    `[fetch-realestate] 저장 완료 (매매 ${saleDistricts.length}개구, 전세 ${jeonseDistricts.length}개구, 월세 ${wolseDistricts.length}개구)`
  );
}

main();
