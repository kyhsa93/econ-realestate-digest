// "이 상품에 넣으면 세후로 얼마 받나"를 계산한다.
//
// 금리 비교로 검색해서 들어오는 사람이 실제로 알고 싶은 건 연 몇 %가 아니라 내 손에
// 들어오는 금액이다. 상위에 노출되는 비교 사이트들은 전부 이걸 답하는데(3,000만원
// 기준 세후 이자를 손으로 계산해 몇 개 상품에 대해 적어둔다), 이 저장소는 공시 원본
// 700개 넘는 상품을 매일 받아두고도 금리만 보여주고 있었다. 계산은 확정적이라
// 전 상품에 대해 자동으로 할 수 있고, 그게 손으로 몇 개만 적는 글보다 나은 지점이다.
//
// 화면(docs/rates.html)에도 같은 계산이 복제돼 있다. 프리렌더와 화면이 다른 숫자를
// 내면 데이터를 받는 순간 표가 바뀌므로, 테스트가 두 결과를 직접 대조한다.

// 이자소득세 14% + 지방소득세 1.4%. 비과세종합저축·세금우대(새마을금고·신협 등)는
// 가입 자격이 따로 있어서 여기 기본 계산에는 넣지 않는다.
export const TAX_RATE = 0.154;

// 화면이 처음 보여주는 금액. 예금은 목돈을 한 번에 넣고 적금은 매달 부으므로 기준이
// 다르다. 1,000만원은 곱하기 쉬워서(3,000만원이면 3배) 다른 금액을 가늠하기도 쉽다.
// 정적 HTML도 이 금액으로 심는다 - 화면과 다른 값을 심으면 데이터를 받는 순간
// 표의 숫자가 통째로 바뀐다.
export const DEFAULT_AMOUNT = { deposit: 10_000_000, saving: 300_000 };

// 적금은 매달 붓는 상품이라 회차마다 이자가 붙는 기간이 다르다. 자유적립식은 매달
// 넣는 금액이 제각각이라 계산 자체가 성립하지 않으므로 정액적립식(매달 같은 금액)을
// 가정한다. 공시 API가 적립 유형을 주지 않아서 상품별로 구분할 방법도 없다.
function savingInterest(monthly, monthlyRate, term, compound) {
  if (!compound) {
    // 1회차는 term개월, 2회차는 term-1개월... 합이 term(term+1)/2 개월분이다.
    return monthly * monthlyRate * ((term * (term + 1)) / 2);
  }
  let total = 0;
  for (let n = term; n >= 1; n -= 1) total += monthly * ((1 + monthlyRate) ** n - 1);
  return total;
}

function depositInterest(amount, monthlyRate, term, compound) {
  if (!compound) return amount * monthlyRate * term;
  return amount * ((1 + monthlyRate) ** term - 1);
}

// 공시의 금리 유형은 "단리"/"복리" 문자열로 온다. 복리는 월복리로 계산한다.
const isCompound = (option) => (option?.rateTypeName ?? "").includes("복리");

/**
 * 세전·세후 이자와 만기 수령액을 낸다. 계산할 수 없으면 null을 준다
 * (금리나 기간이 없는 옵션이 실제로 있어서, 0원으로 채우면 표가 거짓말을 한다).
 *
 * amount는 예금이면 예치금, 적금이면 매달 넣는 금액이다.
 */
export function interestOf(option, { amount, saving = false, useMaxRate = true } = {}) {
  const rate = useMaxRate ? option?.maxRate ?? option?.rate : option?.rate;
  const term = option?.term;
  if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
  if (typeof term !== "number" || !Number.isFinite(term) || term <= 0) return null;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;

  const monthlyRate = rate / 100 / 12;
  const compound = isCompound(option);
  const gross = saving
    ? savingInterest(amount, monthlyRate, term, compound)
    : depositInterest(amount, monthlyRate, term, compound);

  const tax = gross * TAX_RATE;
  const principal = saving ? amount * term : amount;
  return {
    gross: Math.round(gross),
    tax: Math.round(tax),
    net: Math.round(gross - tax),
    principal,
    maturity: Math.round(principal + gross - tax),
  };
}

export const netInterestOf = (option, opts) => interestOf(option, opts)?.net ?? null;

// 화면과 정적 HTML이 같은 문자열을 내야 한다. 원 단위까지 적는 이유는 상품끼리
// 몇 만원 차이를 비교하려고 보는 숫자라서다 - 만원 단위로 끊으면 비교가 안 된다.
export function formatWon(value, locale = "ko") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const n = Math.round(value);
  return locale === "en"
    ? `₩${n.toLocaleString("en-US")}`
    : `${n.toLocaleString("ko-KR")}원`;
}
