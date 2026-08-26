import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AREA_BANDS, LOAN_LTV, cellNote, conversionPairs, districtRates, leadSentence, median, verdictOf } from "./conversion.mjs";
import { DISTRICT_SLUGS } from "./district-slugs.mjs";
import { readRentSource, recentMonths } from "./realestate-source.mjs";

const root = path.resolve(import.meta.dirname, "..");

// 자치구를 세 면적대로 다시 쪼개면 한 칸이 얇아진다. 시세 화면이 쓰는 3개월로는
// 75칸 중 두 칸이 비어서, 여기서만 여섯 달을 본다. 전환율은 주 단위로 움직이는
// 값이 아니라 길게 봐도 무디어지지 않는다.
export const MONTHS = 6;

const outFile = process.env.CONVERSION_FILE
  ? path.resolve(process.env.CONVERSION_FILE)
  : path.join(root, "docs/data/conversion.json");

const ratesFile = process.env.RATES_FILE
  ? path.resolve(process.env.RATES_FILE)
  : path.join(root, "docs/data/rates.json");

/** 전세자금대출 금리. 표에 있는 그대로 구간이라 대표값과 함께 폭도 같이 낸다. */
export function loanRateOf(rates) {
  const options = (rates?.rentLoan ?? []).flatMap((product) => product?.options ?? []);
  const avgs = options.map((o) => o?.avg).filter((v) => Number.isFinite(v));
  if (!avgs.length) return null;

  const mins = options.map((o) => o?.min).filter((v) => Number.isFinite(v));
  const maxes = options.map((o) => o?.max).filter((v) => Number.isFinite(v));

  return {
    rate: Math.round(median(avgs) * 100) / 100,
    min: mins.length ? Math.min(...mins) : null,
    max: maxes.length ? Math.max(...maxes) : null,
    products: (rates?.rentLoan ?? []).length,
  };
}

/**
 * 예금 금리는 기본금리로 센다. 최고금리는 우대조건을 다 채웠을 때의 값이라
 * 보증금으로 쓰고 남은 목돈을 그냥 넣어두는 이 계산과는 전제가 다르다.
 */
export function depositRateOf(rates) {
  const twelve = (rates?.deposit ?? [])
    .flatMap((product) => product?.options ?? [])
    .filter((o) => o?.term === 12 && Number.isFinite(o?.rate))
    .map((o) => o.rate);
  if (!twelve.length) return null;
  return { rate: Math.round(median(twelve) * 100) / 100, products: twelve.length };
}

export function buildPayload({ deals, rates, months, now }) {
  const pairs = conversionPairs(deals);
  const cells = districtRates(pairs);
  if (!cells.length) return null;

  const loan = loanRateOf(rates);
  const deposit = depositRateOf(rates);
  if (!loan || !deposit) return null;

  const seoulRate = Math.round(median(pairs.map((p) => p.rate)) * 100) / 100;
  const labelOf = (key) => AREA_BANDS.find((b) => b.key === key)?.label ?? key;
  const labelEnOf = (key) => ({ under60: "under 60m2", "60to85": "60-85m2", over85: "85m2 and up" })[key] ?? key;

  const noted = cells.map((cell) => ({
    ...cell,
    noteKo: cellNote(cell, loan.rate, labelOf(cell.band), "ko"),
    noteEn: cellNote(cell, loan.rate, labelEnOf(cell.band), "en"),
  }));

  return {
    updatedAt: now.toISOString(),
    months,
    ltv: LOAN_LTV,
    bands: AREA_BANDS.map(({ key, label }) => ({ key, label })),
    slugs: Object.fromEntries(
      [...new Set(cells.map((c) => c.district))].filter((name) => DISTRICT_SLUGS[name]).map((name) => [name, DISTRICT_SLUGS[name]])
    ),
    seoul: {
      rate: seoulRate,
      pairs: pairs.length,
      verdict: verdictOf(seoulRate, loan.rate),
      leadKo: leadSentence({ rate: seoulRate, loanRate: loan.rate, pairs: pairs.length, months }, "ko"),
      leadEn: leadSentence({ rate: seoulRate, loanRate: loan.rate, pairs: pairs.length, months }, "en"),
    },
    loan,
    deposit,
    cells: noted,
  };
}

async function main() {
  const now = new Date();
  const months = recentMonths(now, MONTHS);
  const source = await readRentSource(now, months);
  const deals = Object.values(source.districts ?? {}).flat();

  if (!deals.length) {
    console.log("  전월세 원본이 없습니다 - 기존 전환율 데이터를 그대로 둡니다");
    return;
  }

  let rates = null;
  try {
    rates = JSON.parse(await readFile(ratesFile, "utf-8"));
  } catch {
    console.log("  금리 데이터가 없습니다 - 기존 전환율 데이터를 그대로 둡니다");
    return;
  }

  const payload = buildPayload({ deals, rates, months, now });
  if (!payload) {
    console.log("  전환율을 낼 수 있는 단지가 없습니다 - 기존 전환율 데이터를 그대로 둡니다");
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));

  console.log(
    `  전월세 전환율 ${payload.cells.length}칸 · 단지쌍 ${payload.seoul.pairs.toLocaleString("ko-KR")}개` +
      ` (${months[0]}~${months[months.length - 1]} 신규계약)`
  );
  console.log(
    `  서울 중앙 전환율 ${payload.seoul.rate}% · 전세자금대출 ${payload.loan.rate}% · 예금 ${payload.deposit.rate}%`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`전환율 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
