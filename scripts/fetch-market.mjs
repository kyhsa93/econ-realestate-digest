import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BASE_RATE, KOSPI, changedOn, clampRows, ecosKey, statisticSearch } from "./ecos.mjs";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "market.json");
const historyFile = path.join(dataDir, "market-history.json");
const HISTORY_MAX_DAYS = 180;

function kstDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

const kstYmd = (date) => kstDateString(date).replaceAll("-", "");

/** ECOS의 20260827을 화면이 쓰는 "2026년 08월 27일"로. */
export function ymdLabel(time) {
  const text = String(time ?? "");
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}년 ${text.slice(4, 6)}월 ${text.slice(6, 8)}일`;
}

/**
 * ECOS는 3.00을 "3"으로 준다. 화면은 늘 소수 둘째 자리까지 적어 왔다.
 *
 * 숫자로 바꿔 보고 판단하면 안 된다 - Number("")는 0이라, 값이 비어 온 날
 * 기준금리가 0.00%로 둔갑한다. 생긴 것부터 본다.
 */
export function rateLabel(value) {
  const text = String(value ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text).toFixed(2);
}

/** ECOS의 20260828을 화면이 쓰는 "8/28"로. */
export function shortYmd(time) {
  const text = String(time ?? "");
  if (!/^\d{8}$/.test(text)) return null;
  return `${Number(text.slice(4, 6))}/${Number(text.slice(6, 8))}`;
}

/**
 * 마감된 종가 둘로 값과 등락을 낸다.
 *
 * 등락을 계열 안에서 직접 빼는 것이 요점이다. 전에는 값은 이쪽에서, 등락은 저쪽에서
 * 받아 와 둘이 서로를 설명하지 못했다 - 저장된 값끼리 빼면 45.87이 움직였는데 등락은
 * 0.00이라고 적혀 있는 날이 사흘 연속 나왔다(이슈 #1).
 *
 * 앞 종가가 없으면 등락을 지어내지 않고 비운다. 0.00은 "안 움직였다"는 뜻이라
 * "모른다"의 자리에 놓으면 안 된다 - 그게 바로 이 오류가 났던 방식이다.
 */
export function kospiFrom(rows) {
  if (!rows.length) throw new Error("ecos 코스피 응답 없음");

  const last = rows.at(-1);
  const value = Number(last.DATA_VALUE);
  if (!Number.isFinite(value)) throw new Error("ecos 코스피 값 형식 이상");

  const format = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const asOf = shortYmd(last.TIME);

  const prev = rows.at(-2);
  const prevValue = prev ? Number(prev.DATA_VALUE) : NaN;
  if (!Number.isFinite(prevValue)) {
    return { value: format(value), change: null, direction: null, asOf };
  }

  const diff = value - prevValue;
  return {
    value: format(value),
    change: format(diff),
    direction: diff > 0 ? "RISING" : diff < 0 ? "FALLING" : "UNCHANGED",
    asOf,
  };
}

/** 종가 둘을 잡으려면 주말과 연휴를 건너뛸 만큼은 봐야 한다. */
export const KOSPI_WINDOW_DAYS = { sample: 9, keyed: 30 };

async function fetchKospi(now = new Date()) {
  const key = ecosKey();
  const span = key === "sample" ? KOSPI_WINDOW_DAYS.sample : KOSPI_WINDOW_DAYS.keyed;
  const rows = await statisticSearch({
    key,
    ...KOSPI,
    from: kstYmd(new Date(now.getTime() - span * 86400000)),
    to: kstYmd(now),
    rows: clampRows(key, span + 1),
  });
  return kospiFrom(rows);
}

async function fetchUsdKrw() {
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) throw new Error(`fx http ${res.status}`);
  const json = await res.json();
  const krw = json.rates?.KRW;
  if (!krw) throw new Error("fx 응답 형식 이상");
  return { value: krw, asOf: json.time_last_update_utc };
}

/**
 * 환율의 전일 대비. 매일 값을 쌓아 두고도 증감 칸이 늘 비어 있었다(이슈 #2).
 *
 * 견주는 상대는 <strong>어제 수집분</strong>이지 어제 종가가 아니다. 이 값은 하루 한 번
 * 받아 두는 스냅숏이라 종가라고 부를 것이 없고, 그래서 화면도 "전일 수집분 대비"라고
 * 적는다. 기준을 안 적으면 코스피 종가 등락과 같은 것으로 읽힌다.
 */
export function usdKrwWithChange(current, history = []) {
  if (!current?.value) return current;

  const today = String(current.date ?? "");
  const prev = [...history].reverse().find((entry) => entry.date !== today && Number.isFinite(Number(entry?.usdKrw?.value)));
  const prevValue = Number(prev?.usdKrw?.value);
  if (!Number.isFinite(prevValue)) return { ...current, change: null, direction: null, prevValue: null };

  const diff = Number(current.value) - prevValue;
  return {
    ...current,
    prevValue,
    change: diff.toFixed(2),
    direction: diff > 0 ? "RISING" : diff < 0 ? "FALLING" : "UNCHANGED",
  };
}

/** 견줄 때만 쓰는 날짜는 저장하지 않는다. 화면이 안 보는 값이 파일에 남으면 뜻이 생긴다. */
const withoutDate = (usdKrw) => {
  if (!usdKrw) return usdKrw;
  const { date, ...rest } = usdKrw;
  return rest;
};

/**
 * 기준금리를 포털 HTML에서 긁던 옛 경로. 이제는 ECOS가 시행일을 못 줄 때만 부른다 -
 * sample 키는 열흘치만 주므로, 금리가 그보다 오래전에 바뀌었고 이전 기록도 없는
 * 첫 실행에서 그렇다.
 */
async function fetchBaseRateFromBok() {
  const res = await fetch("https://www.bok.or.kr/portal/singl/baseRate/list.do?menuNo=200643", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`base rate http ${res.status}`);
  const html = await res.text();
  const match = html.match(
    /<td class="fb">(\d{4})<\/td>\s*<td>(\d{1,2}월\s*\d{1,2}일)<\/td>\s*<td>([\d.]+)<\/td>/
  );
  if (!match) throw new Error("기준금리 표 형식 이상");
  const [, year, dateLabel, rate] = match;
  return { value: rate, effectiveFrom: `${year}년 ${dateLabel}` };
}

/** sample 키로 한 번에 받을 수 있는 열 건에 맞춘 창. 키가 있으면 넓게 본다. */
export const BASE_RATE_WINDOW_DAYS = { sample: 9, keyed: 400 };

export async function baseRateFrom(rows, previous, { bok = fetchBaseRateFromBok } = {}) {
  if (!rows.length) throw new Error("ecos 기준금리 응답 없음");

  const value = rateLabel(rows.at(-1).DATA_VALUE);
  if (!value) throw new Error("ecos 기준금리 값 형식 이상");

  const changed = changedOn(rows);
  if (changed) return { value, effectiveFrom: ymdLabel(changed) };

  // 받아 온 창이 통째로 같은 값이면 시행일은 그 전이다. 값이 그대로면 지난번에
  // 적어 둔 시행일이 여전히 맞다.
  if (previous?.value === value && previous?.effectiveFrom) {
    return { value, effectiveFrom: previous.effectiveFrom };
  }

  const scraped = await bok().catch(() => null);
  return { value, effectiveFrom: scraped?.effectiveFrom ?? null };
}

async function fetchBaseRate(previous, now = new Date()) {
  const key = ecosKey();
  const span = key === "sample" ? BASE_RATE_WINDOW_DAYS.sample : BASE_RATE_WINDOW_DAYS.keyed;
  const rows = await statisticSearch({
    key,
    ...BASE_RATE,
    from: kstYmd(new Date(now.getTime() - span * 86400000)),
    to: kstYmd(now),
    rows: clampRows(key, span + 1),
  });
  return baseRateFrom(rows, previous);
}

async function fetchWithFallback(label, fn, previous) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[fetch-market] ${label} 실패: ${err.message}`);
    return previous ?? null;
  }
}

async function main() {
  let previous = {};
  try {
    previous = JSON.parse(await readFile(outFile, "utf-8"));
  } catch {
  }

  const [kospi, usdKrw, baseRate] = await Promise.all([
    fetchWithFallback("코스피", fetchKospi, previous.kospi),
    fetchWithFallback("원달러환율", fetchUsdKrw, previous.usdKrw),
    fetchWithFallback("기준금리", () => fetchBaseRate(previous.baseRate), previous.baseRate),
  ]);

  const now = new Date();
  const history = await readHistory();
  const usdKrwWithPrev = withoutDate(
    usdKrwWithChange(usdKrw ? { ...usdKrw, date: kstDateString(now) } : usdKrw, history)
  );

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    outFile,
    JSON.stringify({ updatedAt: now.toISOString(), kospi, usdKrw: usdKrwWithPrev, baseRate }, null, 2)
  );

  await appendHistory(now, { kospi, usdKrw: usdKrwWithPrev, baseRate }, history);

  console.log("[fetch-market] 저장 완료");
}

async function readHistory() {
  try {
    const parsed = JSON.parse(await readFile(historyFile, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendHistory(now, snapshot, history = []) {
  const today = kstDateString(now);
  const entry = { date: today, ...snapshot };

  const idx = history.findIndex((h) => h.date === today);
  if (idx >= 0) {
    history[idx] = entry;
  } else {
    history.push(entry);
  }

  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length > HISTORY_MAX_DAYS) {
    history = history.slice(history.length - HISTORY_MAX_DAYS);
  }

  await writeFile(historyFile, JSON.stringify(history, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
