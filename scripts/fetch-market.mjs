import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "market.json");

async function fetchKospi() {
  const res = await fetch("https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI", {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.naver.com/" },
  });
  if (!res.ok) throw new Error(`kospi http ${res.status}`);
  const json = await res.json();
  const item = json.datas?.[0];
  if (!item) throw new Error("kospi 응답 형식 이상");
  return {
    value: item.closePrice,
    change: item.compareToPreviousClosePrice,
    direction: item.compareToPreviousPrice?.name ?? null,
  };
}

async function fetchUsdKrw() {
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) throw new Error(`fx http ${res.status}`);
  const json = await res.json();
  const krw = json.rates?.KRW;
  if (!krw) throw new Error("fx 응답 형식 이상");
  return { value: krw, asOf: json.time_last_update_utc };
}

async function fetchBaseRate() {
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
    // 최초 실행이면 이전 데이터 없음
  }

  const [kospi, usdKrw, baseRate] = await Promise.all([
    fetchWithFallback("코스피", fetchKospi, previous.kospi),
    fetchWithFallback("원달러환율", fetchUsdKrw, previous.usdKrw),
    fetchWithFallback("기준금리", fetchBaseRate, previous.baseRate),
  ]);

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    outFile,
    JSON.stringify({ updatedAt: new Date().toISOString(), kospi, usdKrw, baseRate }, null, 2)
  );

  console.log("[fetch-market] 저장 완료");
}

main();
