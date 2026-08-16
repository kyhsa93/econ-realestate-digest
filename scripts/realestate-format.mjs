// 평당가를 "그래서 한 채에 얼마인가"로 옮긴다.
//
// 국토부 실거래 데이터가 주는 건 전용면적 기준 평당가인데, 집을 알아보는 사람이
// 검색하는 건 "강남구 84㎡가 얼마"이지 "평당 얼마"가 아니다. 세후 이자를 넣은 것과
// 같은 이유다 - 우리가 가진 숫자를 사람이 실제로 묻는 형태로 옮기는 것.
//
// 84㎡(국민주택 규모)를 기본으로 삼는다. 아파트 분양·매매에서 가장 흔한 면적이라
// 이걸 기준으로 삼으면 다른 평형도 가늠이 되지만, 실제로는 59㎡를 찾는 사람도 많아서
// 화면에서 바꿀 수 있게 열어둔다(전용면적 기준).
export const BASE_AREA_M2 = 84;
export const AREA_OPTIONS = [59, 84, 114];

// 1평 = 3.3058㎡. 84㎡는 25.41평이다.
const PYEONG_PER_M2 = 1 / 3.3058;
export const pyeongOf = (areaM2) => areaM2 * PYEONG_PER_M2;
export const BASE_AREA_PYEONG = pyeongOf(BASE_AREA_M2);

/** 화면에서 넘어온 평형이 우리가 지원하는 값인지. 아니면 기본값으로 돌린다. */
export const normalizeArea = (value) =>
  AREA_OPTIONS.includes(Number(value)) ? Number(value) : BASE_AREA_M2;

// 자치구 평당가는 신고 건수가 적으면 "그 구의 시세"가 아니라 "그 아파트 한 채의
// 가격"이다. 화면 표와 같은 기준으로 가린다(prerender.mjs의 MIN_SAMPLE과 같은 값).
export const MIN_SAMPLE = 5;

export const hasEnoughSample = (metric) =>
  Boolean(metric) && (metric.transactionCount ?? 0) >= MIN_SAMPLE;

/** 평당가(만원) → 주어진 면적 기준 금액(만원). 값이 없으면 null. */
export function areaPrice(pricePerPyeong10k, areaM2 = BASE_AREA_M2) {
  if (typeof pricePerPyeong10k !== "number" || !Number.isFinite(pricePerPyeong10k)) return null;
  return Math.round(pricePerPyeong10k * pyeongOf(areaM2));
}

// 억 단위로 끊어 읽는 게 한국에서 집값을 말하는 방식이다. 11억 3,004만원처럼
// 억과 만원을 같이 적으면 자릿수를 세지 않아도 크기가 잡힌다.
export function formatEok(value10k, locale = "ko") {
  if (typeof value10k !== "number" || !Number.isFinite(value10k)) return "-";
  const n = Math.round(value10k);

  if (locale === "en") {
    // 영어 화면은 억 단위 감각이 없으므로 백만원 단위로 옮긴다.
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

// 거래 유형마다 값이 들어 있는 필드가 다르다. 화면과 정적 HTML이 같은 곳을 보게
// 한 군데에 모아둔다.
export const KIND_FIELDS = {
  sale: { metric: "sale", value: "avgPricePerPyeong10k" },
  jeonse: { metric: "jeonse", value: "avgDepositPerPyeong10k" },
  wolse: { metric: "wolse", value: "avgDeposit10k" },
};

/** 자치구 하나에서 거래 유형에 해당하는 값을 꺼낸다. 표본이 모자라면 null. */
export function metricOf(entry, kind) {
  const field = KIND_FIELDS[kind];
  if (!field) return null;
  const metric = entry?.[field.metric];
  if (!hasEnoughSample(metric)) return null;
  const value = metric[field.value];
  return typeof value === "number" && Number.isFinite(value) ? metric : null;
}

export const valueOf = (metric, kind) => metric?.[KIND_FIELDS[kind].value] ?? null;

/**
 * 이번 달 표본이 모자라면 지난달 값으로 대체한다. 어느 쪽을 썼는지 같이 돌려주는 게
 * 핵심이다 - 화면이 그걸 표시해야 표를 읽는 사람이 기준을 안다. 값을 조용히
 * 바꿔치기하면 "8월 시세"라고 적힌 표에 7월 숫자가 섞인다.
 */
export function resolveMetric(entry, kind) {
  const current = metricOf(entry, kind);
  if (current) return { metric: current, isPrevious: false };

  const previous = entry?.prev ? metricOf(entry.prev, kind) : null;
  if (previous) return { metric: previous, isPrevious: true };

  return null;
}

/**
 * 전세가율 = 전세 평당 보증금 / 매매 평당가. 매매가 대비 전세가 얼마나 비싼지를
 * 한 숫자로 보여주는 지표라 갭투자 부담과 보증금 회수 위험을 가늠할 때 쓰인다.
 * 우리는 매매·전세 평당가를 둘 다 갖고 있으므로 계산만 하면 되는데, 이걸 표로
 * 주는 곳이 드물다.
 *
 * 두 지표가 서로 다른 달 기준이면 내지 않는다 - 7월 전세를 8월 매매로 나눈 값은
 * 어느 시점의 전세가율도 아니다. 한쪽 표본이 모자랄 때도 마찬가지다(매매 5건짜리
 * 구에서 30%가 나오는 건 시세가 아니라 그 한 채의 가격 때문이다).
 */
export function jeonseRatio(entry) {
  const sale = resolveMetric(entry, "sale");
  const jeonse = resolveMetric(entry, "jeonse");
  if (!sale || !jeonse || sale.isPrevious !== jeonse.isPrevious) return null;

  const salePrice = valueOf(sale.metric, "sale");
  const jeonsePrice = valueOf(jeonse.metric, "jeonse");
  if (!salePrice || !jeonsePrice) return null;

  return { ratio: (jeonsePrice / salePrice) * 100, isPrevious: sale.isPrevious };
}

export const formatPercent = (value) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "-";

/** 대체된 셀에 붙일 기준 월. "202607" → "7월". */
export function monthLabel(period, locale = "ko") {
  const month = Number(String(period ?? "").slice(4, 6));
  if (!Number.isInteger(month) || month < 1 || month > 12) return "";
  if (locale === "en") {
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1];
  }
  return `${month}월`;
}
