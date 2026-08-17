export const TAX_RATE = 0.154;

export const DEFAULT_AMOUNT = { deposit: 10_000_000, saving: 300_000 };

function savingInterest(monthly, monthlyRate, term, compound) {
  if (!compound) {
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

const isCompound = (option) => (option?.rateTypeName ?? "").includes("복리");

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

export function formatWon(value, locale = "ko") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const n = Math.round(value);
  return locale === "en"
    ? `₩${n.toLocaleString("en-US")}`
    : `${n.toLocaleString("ko-KR")}원`;
}
