/**
 * 단지·평형 하나하나에서 낸 전세가율.
 *
 * 화면의 전세가율은 자치구 전체의 <strong>전세 평당 보증금 ÷ 매매 평당가</strong>다.
 * 두 값 모두 평당으로 맞춰져 있으니 넓이는 정규화되지만, 두 평균이 <strong>서로 다른
 * 단지들</strong>에서 나온다는 문제는 남는다. 전세 신고가 어떤 단지에 몰리고 매매
 * 신고가 다른 단지에 몰리면, 그 비율은 어느 단지의 전세가율도 아니게 된다.
 *
 * 실제로 벌어진다. 매매와 전세가 함께 신고된 단지·평형에서 하나씩 낸 값의 중앙값과
 * 견주면 자치구 값이 중앙 6.1%p 어긋나고, 종로구는 83.7% 대 55.6%로 28%p 벌어진다.
 * 어긋남은 거래가 적을수록 커진다 - 칸 40개 미만인 구는 평균 14.7%p, 80개 이상인
 * 구는 3.6%p다(로그 칸수와의 상관 -0.62). 표본이 쌓이면 두 단지 구성이 서로
 * 닮아 가기 때문이다.
 *
 * 그래서 여기서는 같은 단지의 같은 평형에서 매매와 전세를 각각 중앙값으로 내고,
 * 그 하나짜리 비율들을 모아 분포로 본다. 자치구 값 하나로는 안 보이는 것을 본다.
 */

/** 한쪽이라도 이만큼 안 되면 그 칸의 중앙값은 시세라고 할 것이 못 된다. */
export const MIN_DEALS_PER_SIDE = 3;

/** 분위를 말하려면 칸이 이만큼은 있어야 한다. 스물이면 1사분위가 다섯 번째 값이다. */
export const MIN_CELLS = 20;

/**
 * 중앙값만 말하는 데 필요한 칸.
 *
 * 분위 문턱만 두면 정작 보정이 가장 필요한 구가 빠진다 - 자치구 값이 크게 어긋나는
 * 것은 거래가 적은 구인데, 거래가 적으면 칸도 적어서 분위를 못 낸다. 종로구가
 * 83.7% 대 55.6%로 28%p 벌어지는데 칸이 열여덟 개다. 중앙값은 분위보다 훨씬 적은
 * 점으로도 서므로, 그 구간에서는 범위 없이 중앙값 하나만 말한다.
 */
export const MIN_CELLS_MEDIAN = 10;

/**
 * 이 밖으로 나가는 칸은 견줄 값이 잘못 붙은 것으로 본다. 같은 자치구에 같은 이름을
 * 쓰는 다른 단지가 있거나 신고가 잘못 들어온 경우다.
 */
export const RATIO_FLOOR = 5;
export const RATIO_CEILING = 130;

/**
 * 자치구 값과 이만큼 벌어지면 왜 벌어지는지까지 적는다. 칸이 넉넉한 구에서 두 값이
 * 어긋나는 폭이 평균 3.6%p이므로, 그 두 배를 넘으면 표본 구성 탓으로 본다.
 */
export const GAP_EXPLAIN = 8;

const number = (value) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  return /^-?\d+$/.test(text) ? Number(text) : 0;
};

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

/** 같은 단지의 같은 전용면적. 평형이 다르면 같은 단지라도 다른 값이다. */
export const cellKey = (item) => `${item?.aptNm}|${item?.excluUseAr}`;

/** 해제된 거래는 시세가 아니다. */
const liveSale = (item) => !String(item?.cdealType ?? "").trim() && number(item?.dealAmount) > 0;

/** 갱신은 이전 조건을 잇는 것이라 지금 값이 아니고, 반전세는 한 값으로 묶을 수 없다. */
const newJeonse = (item) =>
  String(item?.contractType ?? "").trim() !== "갱신" &&
  number(item?.monthlyRent) === 0 &&
  number(item?.deposit) > 0;

/** 자치구 하나의 신고들에서 칸별 전세가율을 뽑는다. */
export function cellRatios(sales, rents) {
  const sale = new Map();
  const jeonse = new Map();

  for (const item of sales ?? []) {
    if (!String(item?.aptNm ?? "").trim() || !liveSale(item)) continue;
    const key = cellKey(item);
    if (!sale.has(key)) sale.set(key, []);
    sale.get(key).push(number(item.dealAmount));
  }
  for (const item of rents ?? []) {
    if (!String(item?.aptNm ?? "").trim() || !newJeonse(item)) continue;
    const key = cellKey(item);
    if (!jeonse.has(key)) jeonse.set(key, []);
    jeonse.get(key).push(number(item.deposit));
  }

  const ratios = [];
  for (const [key, sales10k] of sale) {
    const deposits = jeonse.get(key);
    if (!deposits || sales10k.length < MIN_DEALS_PER_SIDE || deposits.length < MIN_DEALS_PER_SIDE) continue;
    const price = median(sales10k);
    if (price <= 0) continue;
    const ratio = (median(deposits) / price) * 100;
    if (ratio <= RATIO_FLOOR || ratio >= RATIO_CEILING) continue;
    ratios.push(ratio);
  }
  return ratios;
}

const round = (value) => Math.round(value * 10) / 10;

/** 칸들의 분포. 칸이 모자라면 범위를 빼고, 더 모자라면 아무 말도 하지 않는다. */
export function spreadOf(ratios) {
  if (!ratios?.length || ratios.length < MIN_CELLS_MEDIAN) return null;
  const spread = { cells: ratios.length, median: round(median(ratios)) };
  if (ratios.length < MIN_CELLS) return spread;
  return { ...spread, q1: round(quantile(ratios, 0.25)), q3: round(quantile(ratios, 0.75)) };
}

/**
 * 자치구 전세가율 문장 뒤에 붙는 한 문장.
 *
 * 자치구 값과 크게 어긋날 때는 왜 어긋나는지까지 적는다 - 두 숫자를 나란히 놓고
 * 설명하지 않으면 읽는 사람에게는 그냥 서로 모순되는 값 둘이다.
 */
export function spreadSentence(spread, districtRatio, locale = "ko") {
  if (!spread) return null;
  const en = locale === "en";
  const { cells, q1, q3 } = spread;

  const n = cells.toLocaleString(en ? "en-US" : "ko-KR");
  const hasRange = typeof q1 === "number" && typeof q3 === "number";
  const head = hasRange
    ? en
      ? `Measured one unit type at a time across the ${n} unit types where both a sale and a jeonse were reported, half fall between ${q1}% and ${q3}%`
      : `매매와 전세가 함께 신고된 단지·평형 ${n}칸에서 하나씩 내면 절반이 ${q1}~${q3}%에 들어옵니다`
    : en
      ? `Measured one unit type at a time across the ${n} unit types where both a sale and a jeonse were reported, the median is ${spread.median}%`
      : `매매와 전세가 함께 신고된 단지·평형 ${n}칸에서 하나씩 내면 중앙값이 ${spread.median}%입니다`;

  const gap = typeof districtRatio === "number" ? Math.abs(spread.median - districtRatio) : 0;
  if (gap < GAP_EXPLAIN) return `${head}.`;

  return en
    ? `${head} — the district figure divides one district-wide average by another, and here the complexes filing sales are not the ones filing jeonse.`
    : `${head} — 위 자치구 값은 구 전체 평균 둘을 나눈 것인데, 이 구에서는 매매가 신고된 단지와 전세가 신고된 단지가 서로 달라 그만큼 벌어집니다.`;
}
