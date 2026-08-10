import { XMLParser } from "fast-xml-parser";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "realestate.json");
const historyFile = path.join(dataDir, "realestate-history.json");
const HISTORY_MAX_DAYS = 180;

const API_URL = process.env.MOLIT_API_ENDPOINT;
const SERVICE_KEY = process.env.MOLIT_API_KEY;

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

// 데이터포털이 짧은 시간에 몰리는 요청에 종종 "fetch failed"(네트워크
// 레벨)로 실패하는 걸 확인해서, 재시도와 동시 요청 수 제한을 둔다.
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

const PYEONG_M2 = 3.3058;

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

async function fetchDistrictMonthOnce(districtCode, yearMonth) {
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
  const url = `${API_URL}?serviceKey=${SERVICE_KEY}&${otherParams.toString()}`;

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

async function fetchDistrictMonth(districtCode, yearMonth) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchDistrictMonthOnce(districtCode, yearMonth);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) await sleep(attempt * 1000);
    }
  }
  throw lastErr;
}

function parseAmount(dealAmount) {
  // "120,000" (만원 단위, 쉼표 포함 문자열) -> 1,200,000,000원
  const cleaned = String(dealAmount ?? "").replace(/,/g, "").trim();
  const value = Number(cleaned);
  return Number.isFinite(value) ? value * 10_000 : null;
}

function summarizeTransactions(items) {
  let totalAmount = 0; // 원
  let totalArea = 0; // ㎡
  let count = 0;

  for (const item of items) {
    const amount = parseAmount(item.dealAmount);
    const area = Number(item.excluUseAr);
    if (amount == null || !Number.isFinite(area) || area <= 0) continue;
    totalAmount += amount;
    totalArea += area;
    count += 1;
  }

  if (count === 0 || totalArea === 0) return null;

  const avgPricePerM2 = totalAmount / totalArea;
  const avgPricePerPyeong10k = Math.round((avgPricePerM2 * PYEONG_M2) / 10_000); // 만원 단위

  return { avgPricePerM2, avgPricePerPyeong10k, transactionCount: count };
}

async function fetchDistrict(districtCode, name, yearMonths) {
  const results = await Promise.all(yearMonths.map((ym) => fetchDistrictMonth(districtCode, ym)));
  const items = results.flat();
  const summary = summarizeTransactions(items);
  if (!summary) return null;
  return { code: districtCode, name, ...summary };
}

async function readHistory() {
  try {
    return JSON.parse(await readFile(historyFile, "utf-8"));
  } catch {
    return [];
  }
}

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

function withChange(current, baselineValue) {
  if (baselineValue == null) return current;
  const value10kDiff = current.avgPricePerPyeong10k - baselineValue;
  const percent = baselineValue !== 0 ? (value10kDiff / baselineValue) * 100 : null;
  return { ...current, change: { value10k: value10kDiff, percent } };
}

function attachChanges(overall, districts, baseline) {
  if (!baseline) return { overall, districts };
  const baselineDistrict = (code) => baseline.districts?.find((d) => d.code === code)?.avgPricePerPyeong10k;
  return {
    overall: { ...withChange(overall, baseline.overall?.avgPricePerPyeong10k), baselineDate: baseline.date },
    districts: districts.map((d) => ({
      ...withChange(d, baselineDistrict(d.code)),
      baselineDate: baseline.date,
    })),
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

async function main() {
  if (!SERVICE_KEY || !API_URL) {
    console.error("[fetch-realestate] MOLIT_API_KEY 또는 MOLIT_API_ENDPOINT 없음, 생략");
    return;
  }

  const now = new Date();
  // 최근 신고분은 그 달 안에도 계속 들어오므로, 이번 달+지난달 2개월치를
  // 합쳐서 봐야 월초에 표본이 너무 적어지는 걸 피할 수 있다.
  const yearMonths = [kstYearMonth(now, 0), kstYearMonth(now, 1)];

  const results = await mapWithConcurrency(DISTRICTS, CONCURRENCY, async ({ code, name }) => {
    try {
      const result = await fetchDistrict(code, name, yearMonths);
      if (!result) console.error(`[fetch-realestate] ${name}: 최근 2개월 거래 없음`);
      return result;
    } catch (err) {
      console.error(`[fetch-realestate] ${name} 조회 실패: ${err.message}`);
      return null;
    }
  });
  const districts = results.filter(Boolean);

  if (districts.length === 0) {
    console.error("[fetch-realestate] 모든 지역 조회 실패, 기존 데이터 유지");
    return;
  }

  const totalAmountWeighted = districts.reduce((sum, d) => sum + d.avgPricePerM2 * d.transactionCount, 0);
  const totalCount = districts.reduce((sum, d) => sum + d.transactionCount, 0);
  const overallAvgPricePerM2 = totalAmountWeighted / totalCount;
  const overall = {
    avgPricePerM2: overallAvgPricePerM2,
    avgPricePerPyeong10k: Math.round((overallAvgPricePerM2 * PYEONG_M2) / 10_000),
    transactionCount: totalCount,
  };

  const period = `${yearMonths[1]}~${yearMonths[0]}`;

  // 히스토리는 변화율 계산 없이 원값만 저장(나중에 다른 기준일로도 재계산
  // 가능하게), 화면에 보여줄 오늘자 realestate.json에만 1주일 전 대비 증감을 붙인다.
  const history = await readHistory();
  const baseline = findBaseline(history, now);
  const withChanges = attachChanges(overall, districts, baseline);

  const payload = { updatedAt: now.toISOString(), period, ...withChanges };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  await appendHistory(history, now, { period, overall, districts });

  console.log(`[fetch-realestate] 저장 완료 (${districts.length}개 지역, ${totalCount}건)`);
}

main();
