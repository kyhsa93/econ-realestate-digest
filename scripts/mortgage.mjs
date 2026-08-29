/**
 * 예산을 월 상환액으로 옮긴다.
 *
 * 예산대 화면은 "10억대면 어디까지"에는 답했지만 "그래서 매달 얼마"에는 답하지 않았다.
 * 그 답을 내려면 실거래와 대출 금리가 같이 있어야 하는데, 이 저장소는 둘 다 매일 받는다.
 * 부동산계산기 류가 금리를 사용자에게 직접 입력하라고 하는 자리가 정확히 여기다.
 *
 * <strong>대출 한도는 가정하지 않는다.</strong> LTV·DSR은 규제지역과 소득에 따라 갈리고
 * 해마다 바뀌는데, 그것을 하나로 정해 적으면 이 화면은 매년 조용히 틀린 숫자를 자신 있게
 * 적는 화면이 된다. 그래서 <strong>1억당 매달 얼마</strong>로 낸다 - 얼마를 빌릴지는
 * 읽는 사람이 알고, 그 사람이 곱하면 된다.
 */

/** 금액은 이 저장소 어디서나 만원 단위다. */
export const MAN_PER_EOK = 10_000;

/** 원리금균등 30년. 주택담보대출에서 가장 흔한 조건이고, 화면에 그렇게 적는다. */
export const YEARS = 30;

/**
 * 아파트를 담보로 나누어 갚는 상품만 본다.
 *
 * 공시에는 주택 유형(아파트/연립/단독)과 상환 방식(분할/일시)이 섞여 있다. 일시상환은
 * 매달 이자만 내다가 만기에 원금을 갚는 것이라 월 상환액의 뜻이 아예 다르다.
 */
export const APARTMENT = { mortgageType: "아파트", repayType: "분할상환방식" };

export function apartmentOptions(rates) {
  return (rates?.mortgage ?? []).flatMap((product) =>
    (product.options ?? [])
      .filter(
        (option) =>
          option?.mortgageType === APARTMENT.mortgageType &&
          option?.repayType === APARTMENT.repayType &&
          Number.isFinite(Number(option?.min))
      )
      .map((option) => ({ company: product.company, min: Number(option.min) }))
  );
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * 대표 금리는 최저금리의 <strong>중앙값</strong>이다.
 *
 * 가장 낮은 하나를 쓰면 우대조건을 다 채운 사람의 값이 모두의 값처럼 보인다. 금리 화면이
 * 기본금리와 최고금리를 나란히 두고 그 격차가 우대조건에 달렸다고 적는 것과 같은 이유다.
 * 대신 상품마다 얼마나 벌어져 있는지를 같이 낸다 - 그 폭이 이 숫자의 오차다.
 */
export function rateSpread(options) {
  if (!options?.length) return null;
  const mins = options.map((option) => option.min);
  return {
    count: options.length,
    low: Math.min(...mins),
    mid: Math.round(median(mins) * 100) / 100,
    high: Math.max(...mins),
  };
}

/**
 * 원리금균등 월 상환액. 원금과 결과 모두 만원 단위다.
 *
 * 금리가 0이면 나눗셈이 무너지므로 따로 본다. 실무에서 0%는 없지만, 값이 비어 온 날
 * Number("")가 0이 되어 흘러드는 것을 이 저장소는 이미 겪었다(기준금리 0.00% 사건).
 */
export function monthlyPayment(principal, annualPercent, years = YEARS) {
  const months = Math.round(years * 12);
  if (!(principal > 0) || !Number.isFinite(annualPercent) || months <= 0) return null;
  if (annualPercent <= 0) return principal / months;

  const rate = annualPercent / 100 / 12;
  const growth = (1 + rate) ** months;
  return (principal * rate * growth) / (growth - 1);
}

const man = (value) => `${Math.round(value).toLocaleString("ko-KR")}만원`;

/**
 * 예산대 한 문단. 1억당 값이 먼저고, 그 예산에서 절반을 빌리는 경우를 하나 붙인다.
 *
 * 절반은 규제가 정한 값이 아니라 읽는 사람이 곱셈을 시작할 자리다. 그래서 "절반을
 * 빌린다면"이라고 조건으로 적는다.
 */
export function loanSentence(spread, { eok, years = YEARS } = {}) {
  if (!spread) return null;

  const perEok = monthlyPayment(MAN_PER_EOK, spread.mid, years);
  if (!perEok) return null;

  const lowPay = monthlyPayment(MAN_PER_EOK, spread.low, years);
  const highPay = monthlyPayment(MAN_PER_EOK, spread.high, years);

  const head =
    `1억을 ${years}년 원리금균등으로 빌리면 매달 ${man(perEok)}입니다. ` +
    `아파트 담보대출 최저금리의 중앙값 연 ${spread.mid}% 기준이고, 상품 ${spread.count}개가 ` +
    `연 ${spread.low}%에서 ${spread.high}%까지 벌어져 있어 같은 1억이 ` +
    `매달 ${man(lowPay)}에서 ${man(highPay)} 사이가 됩니다.`;

  if (!Number.isFinite(eok)) return head;

  const half = monthlyPayment((eok * MAN_PER_EOK) / 2, spread.mid, years);
  if (!half) return head;

  return (
    `${head} 이 예산에서 절반인 ${(eok / 2).toLocaleString("ko-KR")}억을 빌린다면 ` +
    `매달 ${man(half)}입니다 — 얼마를 빌릴 수 있는지는 규제지역인지와 소득에 따라 ` +
    `갈리므로 여기서는 정하지 않고, 1억당 값을 곱하시면 됩니다.`
  );
}
