/**
 * 층이 값을 얼마나 가르는가.
 *
 * "1층이라 좀 깎아 드릴게요"를 들은 사람이 그게 정상인지 알 방법이 없었다. 시세표는
 * 자치구 평균이라 층을 뭉개고, 거래 목록에는 층이 있지만 같은 값끼리 견주어 주지 않는다.
 *
 * 견주는 자리는 <strong>같은 자치구, 같은 단지, 같은 전용면적</strong>이다. 이렇게 묶으면
 * 단지가 낡았는지 역에서 먼지 같은 것이 통제된다 - 한 칸 안에서는 층 말고 다른 것이
 * 거의 같기 때문이다. 층만 다른 두 값을 견주는 것이 이 계산의 전부다.
 *
 * 여섯 달을 한 칸에 담으므로 시점 차이는 통제되지 않는다. 그래서 만들 때 확인했다 -
 * 저층 거래의 중앙 계약월과 나머지의 중앙 계약월이 칸마다 얼마나 벌어지는지를 재 보면
 * 중앙값 0.00개월이었다. 저층 거래가 유독 앞이나 뒤에 몰려서 생긴 착시가 아니다.
 */

/** 저층으로 보는 층. 2층도 저층 취급을 받으므로 대조군에서는 뺀다. */
export const LOW_FLOOR = 1;
export const REST_FLOOR_FROM = 3;

/**
 * 대조군이 몇 건은 있어야 하는가. 둘로 낸 중앙값은 그냥 두 값의 평균이라
 * 중앙값이라고 부를 것이 못 된다. 단지별 전세가율·갱신 격차와 같은 규칙이다.
 */
export const MIN_REST_DEALS = 3;

/**
 * 한쪽이 이만큼 벗어난 칸은 견줄 값이 잘못 붙은 것으로 본다. 같은 이름의 다른 단지가
 * 섞였거나 신고가 잘못 들어온 경우다.
 */
export const OUTLIER = 50;

/**
 * 자치구가 자기 값을 말하려면 칸이 몇 개 있어야 하는가.
 *
 * 서울 칸을 크기별로 다시 뽑아 보면, 서울과 똑같은 구에서도 중앙값이 이만큼 흔들린다:
 *
 *   n=10  폭 6.7%p     n=30  폭 4.1%p
 *   n=20  폭 5.0%p     n=50  폭 3.3%p
 *
 * 자치구 사이의 실제 차이가 8.8%p(-9.5% ~ -0.7%)인데 n=10이면 흔들림이 그 폭의
 * 대부분을 삼킨다. 20개를 하한으로 두고, 거기에 더해 <strong>자기 크기에서 우연히
 * 나올 수 있는 구간 바깥</strong>일 때만 말한다.
 */
export const MIN_CELLS = 20;

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round1 = (value) => Math.round(value * 10) / 10;

/** 같은 자치구·단지·전용면적이면 한 칸이다. */
export const cellKey = (item) => `${item?.sggCd}|${item?.aptNm}|${item?.excluUseAr}`;

/**
 * 칸 하나에서 저층이 나머지보다 얼마나 싼가. 견줄 수 없으면 null이다.
 *
 * `pick`이 무엇을 저층으로 볼지 정한다 - 1층을 볼 때도 있고 최상층을 볼 때도 있어서
 * 같은 계산을 두 번 쓴다.
 */
export function cellRatio(rows, { pick, against }) {
  const target = rows.filter(pick);
  const rest = rows.filter(against);
  if (!target.length || rest.length < MIN_REST_DEALS) return null;

  const restMedian = median(rest.map((row) => row.price));
  if (!(restMedian > 0)) return null;

  const ratio = (median(target.map((row) => row.price)) / restMedian - 1) * 100;
  if (!Number.isFinite(ratio) || Math.abs(ratio) > OUTLIER) return null;
  return { ratio, deals: target.length };
}

const isLow = (row) => row.floor <= LOW_FLOOR;
const isRest = (row) => row.floor >= REST_FLOOR_FROM;

/**
 * 최상층은 그 칸에서 관측된 가장 높은 층으로 본다. 건물 높이는 실거래 자료에 없다.
 * 다섯 층은 넘어야 "최상층"이라는 말이 뜻을 갖는다.
 */
const TOP_MIN_FLOOR = 5;

export function topRatio(rows) {
  const highest = Math.max(...rows.map((row) => row.floor));
  if (!Number.isFinite(highest) || highest < TOP_MIN_FLOOR) return null;
  return cellRatio(rows, {
    pick: (row) => row.floor === highest,
    against: (row) => row.floor >= REST_FLOOR_FROM && row.floor < highest,
  });
}

/** 거래 목록을 칸으로 묶는다. 자치구 이름은 칸마다 하나뿐이다. */
export function toCells(byDistrict) {
  const cells = new Map();
  for (const [district, items] of Object.entries(byDistrict ?? {})) {
    for (const item of items ?? []) {
      const floor = Number(item?.floor);
      const price = Number(item?.price);
      if (!Number.isFinite(floor) || !(price > 0)) continue;
      const key = `${district}|${cellKey(item)}`;
      if (!cells.has(key)) cells.set(key, { district, rows: [] });
      cells.get(key).rows.push({ floor, price });
    }
  }
  return [...cells.values()];
}

/** 서울 전체와 자치구별로 접는다. */
export function tally(cells) {
  const low = [];
  const top = [];
  const byDistrict = new Map();
  let lowDeals = 0;

  for (const { district, rows } of cells) {
    const lowCell = cellRatio(rows, { pick: isLow, against: isRest });
    if (lowCell) {
      low.push(lowCell.ratio);
      lowDeals += lowCell.deals;
      if (!byDistrict.has(district)) byDistrict.set(district, []);
      byDistrict.get(district).push(lowCell.ratio);
    }
    const topCell = topRatio(rows);
    if (topCell) top.push(topCell.ratio);
  }

  return {
    low: summarize(low, lowDeals),
    top: summarize(top),
    byDistrict,
  };
}

function summarize(ratios, deals = null) {
  if (!ratios.length) return { cells: 0, median: null, cheaperShare: null, deals };
  return {
    cells: ratios.length,
    median: round1(median(ratios)),
    cheaperShare: round1((ratios.filter((r) => r < 0).length / ratios.length) * 100),
    deals,
  };
}

/**
 * 자치구가 서울과 다르다고 말할 수 있는지.
 *
 * 문턱을 값에 맞춰 고르면 결과에 끼워 맞추는 것이 된다. 그래서 <strong>자기 칸 수에서
 * 우연히 나올 수 있는 구간</strong>을 서울 표본에서 직접 만들어 놓고, 그 바깥일 때만
 * 말한다. 재추출은 씨앗을 고정해 돌리므로 같은 입력이면 같은 답이 나온다 - 빌드가
 * 매일 다른 문장을 만들면 그것부터가 오류다.
 */
export function noiseBand(pool, size, { rounds = 600, seed = 20260829 } = {}) {
  if (!pool.length || size <= 0) return null;
  let state = seed;
  const next = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const medians = [];
  for (let round = 0; round < rounds; round += 1) {
    const sample = [];
    for (let i = 0; i < size; i += 1) sample.push(pool[Math.floor(next() * pool.length)]);
    medians.push(median(sample));
  }
  medians.sort((a, b) => a - b);
  return {
    low: round1(medians[Math.floor(medians.length * 0.05)]),
    high: round1(medians[Math.floor(medians.length * 0.95)]),
  };
}

/**
 * 화면이 그대로 그리는 한 줄. 문턱은 여기서 한 번만 적용한다.
 *
 * 말할 수 없는 구도 <strong>빼지 않고</strong> 값과 칸 수를 그대로 싣되, 서울과 다르다고
 * 말할 수 있는지를 따로 표시한다. 목록에서 빼 버리면 "우리가 못 가른 것"과 "자료가 없는
 * 것"이 화면에서 구별되지 않는다.
 */
export function districtRows(byDistrict, pool) {
  const rows = [];
  for (const [district, ratios] of byDistrict) {
    const band = ratios.length >= MIN_CELLS ? noiseBand(pool, ratios.length) : null;
    const value = round1(median(ratios));
    rows.push({
      district,
      cells: ratios.length,
      median: value,
      band,
      distinct: Boolean(band && (value < band.low || value > band.high)),
    });
  }
  return rows.sort((a, b) => a.median - b.median || a.district.localeCompare(b.district, "ko"));
}

const size = (value) => Math.abs(value).toFixed(1);

/** 서울 한 문단. 이 화면에 온 사람이 묻는 것은 "얼마나 깎는 게 정상인가" 하나다. */
export function leadSentence(sale, jeonse, locale = "ko") {
  if (!sale?.low?.cells || sale.low.median === null) return null;
  const en = locale === "en";
  const tag = en ? "en-US" : "ko-KR";
  const cells = sale.low.cells.toLocaleString(tag);
  const jeonseText = jeonse?.low?.median === null || !jeonse?.low?.cells ? null : size(jeonse.low.median);

  const head = en
    ? `In the same complex and the same unit type, a first-floor apartment sells for ${size(sale.low.median)}% less than the third floor and up — the median across ${cells} matched unit types, and it comes out cheaper in ${sale.low.cheaperShare}% of them.`
    : `같은 단지 같은 평형에서 1층은 3층 이상보다 ${size(sale.low.median)}% 싸게 팔립니다. 맞물린 ${cells}칸의 중앙값이고, 그 가운데 ${sale.low.cheaperShare}%에서 1층이 더 쌌습니다.`;

  if (!jeonseText) return head;

  return en
    ? `${head} Jeonse discounts the same floor by only ${jeonseText}% — the disadvantage of a first floor shows up more in reselling than in living there.`
    : `${head} 전세는 같은 1층을 ${jeonseText}%만 깎습니다 — 1층의 불리함은 사는 것보다 되파는 데 더 크게 얹힙니다.`;
}

/**
 * 최상층 한 문단. 통념과 어긋나는 쪽이 이 화면의 값어치다.
 *
 * "웃돈이 없다"고 말하려면 두 가지가 같이 성립해야 한다 - 중앙값 차이가 1층 효과(7%대)에
 * 견주어 한 자릿수 아래로 작고, 더 싼 칸과 더 비싼 칸이 반반에 가까워야 한다. 둘 중
 * 하나만 보면 "작지만 한쪽으로 쏠린 차이"를 없다고 말하게 된다.
 */
export const TOP_FLAT_MEDIAN = 1;
export const TOP_FLAT_SHARE = [40, 60];

export function topSentence(sale, locale = "ko") {
  if (!sale?.top?.cells || sale.top.median === null) return null;
  const en = locale === "en";
  const tag = en ? "en-US" : "ko-KR";
  const cells = sale.top.cells.toLocaleString(tag);
  const signed = `${sale.top.median > 0 ? "+" : ""}${sale.top.median}%`;
  const balanced =
    sale.top.cheaperShare >= TOP_FLAT_SHARE[0] && sale.top.cheaperShare <= TOP_FLAT_SHARE[1];
  const flat = Math.abs(sale.top.median) < TOP_FLAT_MEDIAN && balanced;

  const body = en
    ? `Against the floors below it in the same unit type, the top floor differs by a median ${signed} across ${cells} matched unit types, and ${sale.top.cheaperShare}% of them came in cheaper.`
    : `같은 평형의 아래층들과 견주면 최상층은 중앙값 ${signed} 차이입니다. 맞물린 ${cells}칸이고, 그 가운데 ${sale.top.cheaperShare}%는 오히려 더 쌌습니다.`;

  if (!flat) return body;

  return en
    ? `The top floor carries no premium. ${body} Whatever a top floor is worth, the filings do not show it as a higher price — unlike the first floor, which they do show.`
    : `최상층에는 웃돈이 붙지 않습니다. ${body} 최상층에 값어치가 있든 없든 신고된 가격에는 그것이 더 비싼 값으로 나타나지 않습니다 — 1층은 나타나는데 말입니다.`;
}

/**
 * 자치구 이야기. 갈린다고 말할 수 있는 곳이 몇인지부터 적는다.
 *
 * 순위를 적지 않는 것이 요점이다. 스물다섯 줄을 크기순으로 늘어놓으면 읽는 사람은
 * 그것을 순위로 읽는데, 대부분의 줄 사이 간격은 표본이 만든 흔들림 안에 있다.
 */
export function districtSentence(rows, seoulMedian, locale = "ko") {
  if (!rows?.length) return null;
  const en = locale === "en";
  const distinct = rows.filter((row) => row.distinct);
  const total = rows.length;

  if (!distinct.length) {
    return en
      ? `No district stands apart from Seoul as a whole: every district figure falls inside the range a district identical to Seoul could produce at its own sample size.`
      : `서울 전체와 다르다고 말할 수 있는 자치구는 없습니다. 어느 구의 값이든 서울과 똑같은 구에서도 그 표본 크기라면 나올 수 있는 범위 안에 들어갑니다.`;
  }

  const ref = typeof seoulMedian === "number" ? seoulMedian : null;
  const deeper = distinct.filter((row) => ref !== null && row.median < ref);
  const shallower = distinct.filter((row) => ref === null || row.median >= ref);
  const list = (items) => items.map((row) => `${row.district} ${size(row.median)}%`).join(", ");

  const parts = [];
  if (deeper.length) {
    parts.push(en ? `${list(deeper)} discount it more` : `${list(deeper)}는 더 크게 깎이고`);
  }
  if (shallower.length) {
    parts.push(en ? `${list(shallower)} discount it less` : `${list(shallower)}는 덜 깎입니다`);
  }

  return en
    ? `Of ${total} districts, ${distinct.length} sit outside the range a district identical to Seoul could produce at their sample size — ${parts.join(", while ")}. The rest cannot be told apart from Seoul, and this page says so instead of ranking them.`
    : `자치구 ${total}곳 가운데 ${distinct.length}곳만 서울(${size(ref ?? 0)}%)과 다르다고 말할 수 있습니다 — ${parts.join(", ")}. 나머지는 서울과 갈라 볼 수 없습니다. 이 화면이 스물다섯 줄을 순위로 적지 않는 것은 그래서입니다.`;
}
