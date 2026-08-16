// 월초에 표 절반이 비는 걸 막는다.
//
// 국토부 실거래는 계약 후 30일 안에 신고하면 되기 때문에, 매달 1일이 지나면 그 달
// 신고분이 거의 없다. 실제로 8월 10일에는 25개 구 중 12곳만 표본 5건을 넘겼고
// 15일이 되어서야 24곳이 됐다. 그동안 검색으로 들어온 사람은 "신고 3건"만 적힌
// 반쪽짜리 표를 본다.
//
// 예전에 이번 달과 지난달을 합쳐서 받아본 적이 있는데, 25개 구를 두 달치 조회하면
// 일일 호출 한도에 걸려서 되돌렸다(README에 기록). 그래서 지난달 값은 따로 캐시해
// 두고 **달이 바뀔 때 한 번만** 받는다. 평소 호출량은 그대로다.
//
// 값을 섞지는 않는다. 이번 달 표본이 모자란 지표만 지난달 값으로 대체하고, 그 셀이
// 어느 달 기준인지 화면에 밝힌다. 두 달을 합산해 평균 내면 "이번 달 시세"도 "지난달
// 시세"도 아닌 값이 되고, 그건 표를 읽는 사람이 알 수 없는 왜곡이다.

/** 지난달 캐시가 지금 쓸 수 있는 것인지. period가 맞아야 한다. */
export function isPreviousUsable(cache, previousPeriod) {
  return Boolean(cache) && cache.period === previousPeriod && Array.isArray(cache.districts);
}

const METRIC_KEYS = ["sale", "saleNational84", "jeonse", "wolse"];

function pickMetrics(entry) {
  if (!entry) return null;
  const out = {};
  for (const key of METRIC_KEYS) {
    if (entry[key]) out[key] = entry[key];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 이번 달 결과에 지난달 값을 `prev`로 얹는다. 값을 덮어쓰지 않는다 - 어느 쪽을 쓸지는
 * 화면이 표본을 보고 정하고, 그때 기준 월도 같이 표시한다.
 */
export function attachPrevious(current, previous) {
  if (!previous?.districts?.length) return current;

  const byCode = new Map(previous.districts.map((d) => [d.code, d]));
  const districts = (current.districts ?? []).map((district) => {
    const prev = pickMetrics(byCode.get(district.code));
    return prev ? { ...district, prev } : district;
  });

  const overallPrev = pickMetrics(previous.overall);
  const overall = overallPrev ? { ...current.overall, prev: overallPrev } : current.overall;

  return { ...current, previousPeriod: previous.period, overall, districts };
}
