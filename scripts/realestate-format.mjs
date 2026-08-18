export const BASE_AREA_M2 = 84;
export const AREA_OPTIONS = [59, 84, 114];

const PYEONG_PER_M2 = 1 / 3.3058;
export const pyeongOf = (areaM2) => areaM2 * PYEONG_PER_M2;
export const BASE_AREA_PYEONG = pyeongOf(BASE_AREA_M2);

export const normalizeArea = (value) =>
  AREA_OPTIONS.includes(Number(value)) ? Number(value) : BASE_AREA_M2;

export const MIN_SAMPLE = 5;

export const hasEnoughSample = (metric) =>
  Boolean(metric) && (metric.transactionCount ?? 0) >= MIN_SAMPLE;

export function areaPrice(pricePerPyeong10k, areaM2 = BASE_AREA_M2) {
  if (typeof pricePerPyeong10k !== "number" || !Number.isFinite(pricePerPyeong10k)) return null;
  return Math.round(pricePerPyeong10k * pyeongOf(areaM2));
}

export function formatEok(value10k, locale = "ko") {
  if (typeof value10k !== "number" || !Number.isFinite(value10k)) return "-";
  const n = Math.round(value10k);

  if (locale === "en") {
    return `₩${(n / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;
  }

  const eok = Math.floor(n / 10000);
  const man = n % 10000;
  if (!eok) return `${man.toLocaleString("ko-KR")}만원`;
  if (!man) return `${eok}억원`;
  return `${eok}억 ${man.toLocaleString("ko-KR")}만원`;
}

export const formatMan = (value10k, locale = "ko") =>
  typeof value10k === "number" && Number.isFinite(value10k)
    ? locale === "en"
      ? `₩${(value10k / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`
      : `${Math.round(value10k).toLocaleString("ko-KR")}만원`
    : "-";

export const KIND_FIELDS = {
  sale: { metric: "sale", value: "avgPricePerPyeong10k" },
  jeonse: { metric: "jeonse", value: "avgDepositPerPyeong10k" },
  wolse: { metric: "wolse", value: "avgDeposit10k" },
};

export function metricOf(entry, kind) {
  const field = KIND_FIELDS[kind];
  if (!field) return null;
  const metric = entry?.[field.metric];
  if (!hasEnoughSample(metric)) return null;
  const value = metric[field.value];
  return typeof value === "number" && Number.isFinite(value) ? metric : null;
}

export const valueOf = (metric, kind) => metric?.[KIND_FIELDS[kind].value] ?? null;

export function resolveMetric(entry, kind) {
  const metric = metricOf(entry, kind);
  return metric ? { metric } : null;
}

export function jeonseRatio(entry) {
  const sale = resolveMetric(entry, "sale");
  const jeonse = resolveMetric(entry, "jeonse");
  if (!sale || !jeonse) return null;

  const salePrice = valueOf(sale.metric, "sale");
  const jeonsePrice = valueOf(jeonse.metric, "jeonse");
  if (!salePrice || !jeonsePrice) return null;

  return { ratio: (jeonsePrice / salePrice) * 100 };
}

export const formatPercent = (value) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "-";

export function monthLabel(period, locale = "ko") {
  const month = Number(String(period ?? "").slice(4, 6));
  if (!Number.isInteger(month) || month < 1 || month > 12) return "";
  if (locale === "en") {
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1];
  }
  return `${month}월`;
}
