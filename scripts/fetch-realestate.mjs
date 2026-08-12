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

// "국민평형"(흔히 "34평형")은 공급면적 기준 표현이라 전용면적으로는 딱 떨어지지
// 않고, 실제 매물은 84.3~84.99㎡ 사이에 몰려 있지만 82~83㎡대 변형도 존재한다.
// 정확한 평형 코드가 실거래 API에 없어서, 이 범위를 근사치로 삼는다.
const NATIONAL_PYEONG_MIN_M2 = 82;
const NATIONAL_PYEONG_MAX_M2 = 86;

function filterByArea(items, minArea, maxArea) {
  return items.filter((item) => {
    const area = Number(item.excluUseAr);
    return Number.isFinite(area) && area >= minArea && area <= maxArea;
  });
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
  const items = results.flat();
  return {
    sale: summarizeSale(items),
    saleNational84: summarizeSale(filterByArea(items, NATIONAL_PYEONG_MIN_M2, NATIONAL_PYEONG_MAX_M2)),
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

// 매매·전세는 "평당 가격" 성격이라 값 하나에 증감을 바로 붙인다.
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

// 월세는 보증금과 월세가 성격이 달라 하나로 압축하지 않고, 각각 따로 증감을 계산한다.
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

  // 워크플로가 수동으로 여러 번 트리거돼도(오늘 테스트하면서 실제로 겪음)
  // 하루에 한 번만 25개구 전체를 다시 조회하진 않아 데이터포털 일일 호출
  // 한도를 아낀다. 다만 하루 1회 제한보다 "최소 한 번은 전 구 데이터를
  // 성공시키는 것"이 우선이라, 오늘 이미 조회했더라도 초반 네트워크
  // 이슈 등으로 일부 구가 통째로 빠진 채 저장돼 있으면 그 누락분만
  // 다시 조회해서 채운다.
  let existing = null;
  try {
    existing = JSON.parse(await readFile(outFile, "utf-8"));
  } catch {
    existing = null; // 기존 파일 없으면 그냥 진행
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

  // 이번 달치만 조회 (예전엔 월초 표본 부족을 피하려고 지난달까지 2개월을
  // 합쳤는데, 요청량이 2배가 돼서 25개구 조회 시 데이터포털 일일 한도에
  // 걸리는 걸 겪었음 - 이번 달만 봐도 대체로 충분한 표본이 쌓이는 편이라
  // 요청량을 줄이는 쪽을 택함).
  const yearMonths = [kstYearMonth(now, 0)];

  async function fetchDistrictEntry({ code, name }) {
    const entry = { code, name, sale: null, saleNational84: null, jeonse: null, wolse: null };

    if (hasSale) {
      try {
        const saleResult = await fetchDistrictSale(code, yearMonths);
        entry.sale = saleResult.sale;
        entry.saleNational84 = saleResult.saleNational84;
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
  }

  const results = await mapWithConcurrency(targetDistricts, CONCURRENCY, fetchDistrictEntry);

  // 데이터포털 요청이 실행 초반 잠깐(수십 초) 네트워크 레벨로 통째로 실패하는
  // 경우를 실제로 겪었다(첫 두 동시 요청 웨이브가 fetch failed로 재시도까지
  // 다 소진). 개별 재시도 백오프만으로는 그 구간을 못 버티므로, 1차 조회가
  // 전부 끝난 뒤(=네트워크가 안정됐을 시점) 실패한 구만 모아 한 번 더 훑는다.
  const failedIndexes = results.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
  if (failedIndexes.length > 0) {
    console.log(`[fetch-realestate] ${failedIndexes.length}개구 실패, 재시도 스윕 시작`);
    const retried = await mapWithConcurrency(
      failedIndexes.map((i) => targetDistricts[i]),
      CONCURRENCY,
      fetchDistrictEntry
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

  // 오늘 이미 저장돼 있던 구 데이터(있다면)와 이번에 새로 채운 구 데이터를
  // 합쳐서 이번 실행에서도 여전히 실패한 구가 있어도 기존 성공분은 보존한다.
  const newlyFetched = results.filter(Boolean);
  const districtsMap = new Map(existingIsToday ? (existing.districts ?? []).map((d) => [d.code, d]) : []);
  for (const d of newlyFetched) districtsMap.set(d.code, d);
  const districts = [...districtsMap.values()];

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

  const overall = { sale: overallSale, saleNational84: overallSaleNational84, jeonse: overallJeonse, wolse: overallWolse };
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
