import { XMLParser } from "fast-xml-parser";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "realestate.json");
const historyFile = path.join(dataDir, "realestate-history.json");
const HISTORY_MAX_DAYS = 180;

const API_URL = process.env.MOLIT_API_ENDPOINT;
const SERVICE_KEY = process.env.MOLIT_API_KEY;

// 강남/서초/송파(고가권) + 마포/노원(중저가권)을 섞어서 서울 아파트값의
// 대략적인 흐름을 보려는 것이지, 전국을 대표하는 표본은 아니다.
const DISTRICTS = [
  { code: "11680", name: "강남구" },
  { code: "11650", name: "서초구" },
  { code: "11710", name: "송파구" },
  { code: "11440", name: "마포구" },
  { code: "11350", name: "노원구" },
];

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

async function fetchDistrictMonth(districtCode, yearMonth) {
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

async function appendHistory(now, entry) {
  let history = [];
  try {
    history = JSON.parse(await readFile(historyFile, "utf-8"));
  } catch {
    // 최초 실행이면 이전 기록 없음
  }

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

  const districts = [];
  for (const { code, name } of DISTRICTS) {
    try {
      const result = await fetchDistrict(code, name, yearMonths);
      if (result) districts.push(result);
      else console.error(`[fetch-realestate] ${name}: 최근 2개월 거래 없음`);
    } catch (err) {
      console.error(`[fetch-realestate] ${name} 조회 실패: ${err.message}`);
    }
  }

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
  const payload = { updatedAt: now.toISOString(), period, overall, districts };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  await appendHistory(now, { period, overall, districts });

  console.log(`[fetch-realestate] 저장 완료 (${districts.length}개 지역, ${totalCount}건)`);
}

main();
