// 평당가를 "그래서 한 채에 얼마인가"로 옮긴다.
//
// 국토부 실거래 데이터가 주는 건 전용면적 기준 평당가인데, 집을 알아보는 사람이
// 검색하는 건 "강남구 84㎡가 얼마"이지 "평당 얼마"가 아니다. 세후 이자를 넣은 것과
// 같은 이유다 - 우리가 가진 숫자를 사람이 실제로 묻는 형태로 옮기는 것.
//
// 84㎡(국민주택 규모)를 기준으로 삼는다. 아파트 분양·매매에서 가장 흔한 면적이고,
// 다른 평형은 여기서 비례로 가늠할 수 있다.
export const BASE_AREA_M2 = 84;

// 1평 = 3.3058㎡. 84㎡는 25.41평이다.
const PYEONG_PER_M2 = 1 / 3.3058;
export const BASE_AREA_PYEONG = BASE_AREA_M2 * PYEONG_PER_M2;

// 자치구 평당가는 신고 건수가 적으면 "그 구의 시세"가 아니라 "그 아파트 한 채의
// 가격"이다. 화면 표와 같은 기준으로 가린다(prerender.mjs의 MIN_SAMPLE과 같은 값).
export const MIN_SAMPLE = 5;

export const hasEnoughSample = (metric) =>
  Boolean(metric) && (metric.transactionCount ?? 0) >= MIN_SAMPLE;

/** 평당가(만원) → 84㎡ 기준 금액(만원). 값이 없으면 null. */
export function areaPrice(pricePerPyeong10k) {
  if (typeof pricePerPyeong10k !== "number" || !Number.isFinite(pricePerPyeong10k)) return null;
  return Math.round(pricePerPyeong10k * BASE_AREA_PYEONG);
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
