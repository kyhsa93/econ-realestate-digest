/**
 * 갱신계약에서만 나오는 관찰들.
 *
 * 시세는 신규 계약만 센다. 갱신은 이전 조건을 잇는 것이라 지금 시세가 아니어서 그런데,
 * 그렇게 버려지는 것이 서울 전월세 신고의 절반이다. 버려진 쪽에는 시세표에 없는 것이
 * 하나 들어 있다 - 같은 세입자가 <strong>전에 내던 조건</strong>이 나란히 적혀 있다.
 *
 * 다만 인상률 자체는 지표가 되지 못한다. 계약갱신요구권을 쓰면 5%가 상한이고, 실제로
 * 요구권을 행사한 계약의 절반 이상이 5% 언저리에 붙어 있다. 그 평균을 내는 것은 시장을
 * 재는 것이 아니라 법조문을 다시 읽는 것에 가깝다. 상한이 없는 합의 갱신도 중앙값이
 * 5.0%에서 움직이지 않는데, 5%가 법을 떠나 관행의 기준점이 되었기 때문이다.
 *
 * 그래서 여기서 보는 것은 인상률이 아니라 <strong>천장에 닿았는지</strong>다.
 * 상한까지 올리지 못한 계약이 많다는 것은 그 동네에서 집주인이 부르는 값을 시장이
 * 다 받아 주지 않았다는 뜻이고, 그건 상한이 있기 때문에 오히려 읽을 수 있는 신호다.
 */

/** 상한(5%)에 닿지 못했다고 볼 선. 신고 값의 반올림을 감안해 조금 아래에 둔다. */
export const CAP_MISS_BELOW = 4.5;

/**
 * 비율을 말하려면 얼마나 있어야 하는가. 자치구 페이지의 다른 관찰과 같은 이유로
 * 얇은 구는 비율 이야기를 하지 않는다.
 */
export const MIN_RENEWALS = 200;

/** 서울 값 대비 이만큼 벗어나야 말할 거리가 된다. */
export const CAP_MISS_LOW = 38;
export const CAP_MISS_HIGH = 53;
export const TO_WOLSE_LOW_RATIO = 0.7;
export const TO_WOLSE_HIGH_RATIO = 1.5;

/**
 * 갱신 보증금을 견줄 "지금 새로 구하면 얼마"를 만들려면 같은 칸에 신규 계약이
 * 최소 몇 건 있어야 하는가. 둘로 낸 중앙값은 그냥 두 값의 평균이라 중앙값이라고
 * 부를 것이 못 된다.
 */
export const MIN_MARKET_DEALS = 3;

/**
 * 자치구가 이 격차를 말하려면 맞물린 표본이 얼마나 있어야 하는가.
 *
 * 서울 표본 4,176건을 부트스트랩(400회)해 표본 크기별로 중앙값이 얼마나 흔들리는지
 * 재 보고 정했다. 서울과 같은 동네인데도 우연히 나올 수 있는 범위다:
 *
 *   n= 20  -15.8% ~ -2.6%   n= 60  -12.5% ~ -5.0%
 *   n= 40  -13.1% ~ -4.1%   n=100  -11.5% ~ -5.5%
 *
 * 60건 아래로 내려가면 폭이 9%p를 넘어, 서울과 똑같은 구가 "유독 싸다"로도
 * "차이가 없다"로도 찍힐 수 있다.
 */
export const MIN_GAP_SAMPLE = 60;

/**
 * 한쪽이 90%를 넘게 벗어난 것은 견줄 값이 잘못 붙은 것으로 본다. 같은 단지명에
 * 다른 단지가 섞였거나 신고가 잘못 들어온 경우다.
 */
export const GAP_OUTLIER = 90;

/**
 * 서울 격차 대비 이만큼 벗어나야 말할 거리가 된다.
 *
 * 위 부트스트랩의 n=60 구간(-12.5% ~ -5.0%) 바깥에 두 문턱을 놓는다. 서울이
 * -9.7%일 때 1.5배는 -14.6%, 0.45배는 -4.4%로 둘 다 그 구간 밖이다 - 우연만으로는
 * 어느 쪽 문장도 나오지 않는다는 뜻이다.
 */
export const GAP_WIDE_RATIO = 1.5;
export const GAP_NARROW_RATIO = 0.45;

const number = (value) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text || !/^-?\d+$/.test(text)) return 0;
  return Number(text);
};

const isRenewal = (item) =>
  String(item?.contractType ?? "").trim() === "갱신" && String(item?.preDeposit ?? "").trim().length > 0;

const usedRight = (item) => String(item?.useRRRight ?? "").trim() === "사용";

/**
 * 계약월이 신고 기한까지 지나 더 들어올 것이 없는 달인지.
 *
 * 전월세도 계약 후 30일 안에 신고한다. 아직 기한이 남은 달을 같이 세면 그 달은
 * 늘 표본이 얇고, 얇은 표본이 비율을 흔든다 - 이 저장소가 시세 그래프에서 실선과
 * 점선을 나눈 것과 같은 이유다.
 */
export function isClosedMonth(year, month, now) {
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const deadline = new Date(monthEnd.getTime() + 30 * 86400000);
  return now >= deadline;
}

/** 갱신 신고 한 건이 어느 칸에 들어가는지. */
export function classify(item) {
  const oldRent = number(item?.preMonthlyRent);
  const newRent = number(item?.monthlyRent);
  const oldDeposit = number(item?.preDeposit);
  const newDeposit = number(item?.deposit);

  const wasJeonse = oldRent === 0;
  const isJeonse = newRent === 0;

  if (wasJeonse !== isJeonse) {
    return { switched: wasJeonse ? "toWolse" : "toJeonse", wasJeonse };
  }

  if (oldDeposit <= 0) return { wasJeonse };

  // 전세는 보증금끼리, 월세는 보증금과 월세를 한 값으로 묶어 견준다. 묶는 배수는
  // 화면 계산과 무관한 내부 값이라, 같은 유형끼리 견주기만 하면 무엇이든 상관없다.
  const before = wasJeonse ? oldDeposit : oldDeposit + oldRent * 100;
  const after = isJeonse ? newDeposit : newDeposit + newRent * 100;
  if (before <= 0) return { wasJeonse };

  return { wasJeonse, changePct: ((after - before) / before) * 100, right: usedRight(item) };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const pureJeonse = (item) => number(item?.monthlyRent) === 0 && number(item?.deposit) > 0;

/**
 * 같은 단지 · 같은 전용면적 · 같은 달.
 *
 * 면적을 구간으로 묶지 않는 것은 같은 단지라도 평형이 다르면 값이 다르기 때문이다.
 * 묶으면 표본은 늘지만(마감월 기준 4,176 -> 6,118건) 59㎡ 갱신을 63㎡ 신규와
 * 견주게 된다. 늘어난 표본이 그 값을 하지 않는다.
 */
const marketKey = (item) =>
  `${item?.sggCd}|${item?.aptNm}|${item?.excluUseAr}|${item?.dealYear}-${item?.dealMonth}`;

/**
 * 갱신 보증금이 "지금 새로 구하면 얼마"보다 얼마나 싼가.
 *
 * 시세표는 신규 계약만 세고 갱신은 버린다. 그래서 화면 어디에도 세입자가 실제로
 * 묻는 것에 대한 답이 없었다 - 갱신하는 게 나은가, 옮기는 게 나은가. 같은 단지
 * 같은 평형에서 같은 달에 맺어진 신규 계약의 중앙값을 그 사람이 지금 새로 구할 때의
 * 값으로 보고, 갱신 보증금이 거기서 얼마나 떨어져 있는지를 잰다.
 *
 * 순수 전세끼리만 견준다. 반전세는 보증금과 월세를 묶어야 하는데, 묶는 배수가
 * 곧 전월세전환율이라 이 화면이 답해야 할 것을 먼저 가정해 버린다.
 *
 * 맞물리려면 같은 칸에 신규가 세 건 있어야 하므로, 거래가 도는 큰 단지 쪽으로
 * 기운다. 화면에 그렇게 적는다.
 */
export function renewalGap(items, now) {
  const rows = (items ?? []).filter((item) => {
    const year = Number(item?.dealYear);
    const month = Number(item?.dealMonth);
    if (!Number.isInteger(year) || !Number.isInteger(month)) return false;
    if (!isClosedMonth(year, month, now)) return false;
    return Boolean(String(item?.aptNm ?? "").trim()) && pureJeonse(item);
  });

  const market = new Map();
  for (const item of rows) {
    if (String(item?.contractType ?? "").trim() !== "신규") continue;
    const key = marketKey(item);
    if (!market.has(key)) market.set(key, []);
    market.get(key).push(number(item.deposit));
  }

  const gaps = [];
  for (const item of rows) {
    if (String(item?.contractType ?? "").trim() !== "갱신") continue;
    const pool = market.get(marketKey(item));
    if (!pool || pool.length < MIN_MARKET_DEALS) continue;
    const asking = median(pool);
    if (asking <= 0) continue;
    const gap = ((number(item.deposit) - asking) / asking) * 100;
    if (!Number.isFinite(gap) || Math.abs(gap) > GAP_OUTLIER) continue;
    gaps.push(gap);
  }

  if (!gaps.length) return { gapMatched: 0, gapMedian: null, gapCheaperShare: null };

  return {
    gapMatched: gaps.length,
    gapMedian: Math.round(median(gaps) * 10) / 10,
    gapCheaperShare: Math.round((gaps.filter((g) => g < 0).length / gaps.length) * 1000) / 10,
  };
}

/** 자치구 하나의 갱신 신고들을 세어 정리한다. */
export function tally(items, now) {
  const counts = { renewals: 0, rightUsed: 0, capMissed: 0, fromJeonse: 0, toWolse: 0 };

  for (const item of items ?? []) {
    const year = Number(item?.dealYear);
    const month = Number(item?.dealMonth);
    if (!Number.isInteger(year) || !Number.isInteger(month)) continue;
    if (!isClosedMonth(year, month, now)) continue;
    if (!isRenewal(item)) continue;

    counts.renewals += 1;
    const row = classify(item);

    if (row.wasJeonse) {
      counts.fromJeonse += 1;
      if (row.switched === "toWolse") counts.toWolse += 1;
    }

    if (row.right && Number.isFinite(row.changePct)) {
      counts.rightUsed += 1;
      if (row.changePct < CAP_MISS_BELOW) counts.capMissed += 1;
    }
  }

  return {
    ...counts,
    capMissShare: counts.rightUsed ? Math.round((counts.capMissed / counts.rightUsed) * 1000) / 10 : null,
    toWolseShare: counts.fromJeonse ? Math.round((counts.toWolse / counts.fromJeonse) * 1000) / 10 : null,
    ...renewalGap(items, now),
  };
}

export function seoulTally(byDistrict, now) {
  const all = Object.values(byDistrict ?? {}).flat();
  return tally(all, now);
}

/**
 * 문턱을 넘은 것만 남긴다. 넘지 못한 관찰은 키가 아예 없다 -
 * 자치구 페이지의 다른 관찰과 같은 규칙이다.
 */
export function renewalFacts(districtTally, seoul) {
  if (!districtTally) return null;
  const facts = {};

  if (districtTally.rightUsed >= MIN_RENEWALS && districtTally.capMissShare !== null) {
    const share = districtTally.capMissShare;
    if (share <= CAP_MISS_LOW) facts.capReached = { share, seoul: seoul?.capMissShare ?? null, counted: districtTally.rightUsed };
    else if (share >= CAP_MISS_HIGH) facts.capMissed = { share, seoul: seoul?.capMissShare ?? null, counted: districtTally.rightUsed };
  }

  // 격차는 음수다(갱신이 싸다). 서울보다 더 벌어졌으면 곱하기 1.4보다 작고,
  // 덜 벌어졌으면 곱하기 0.5보다 크다.
  if (
    districtTally.gapMatched >= MIN_GAP_SAMPLE &&
    districtTally.gapMedian !== null &&
    typeof seoul?.gapMedian === "number" &&
    seoul.gapMedian < 0
  ) {
    const shared = {
      gap: districtTally.gapMedian,
      seoul: seoul.gapMedian,
      cheaper: districtTally.gapCheaperShare,
      counted: districtTally.gapMatched,
    };
    if (districtTally.gapMedian <= seoul.gapMedian * GAP_WIDE_RATIO) facts.renewGapWide = shared;
    else if (districtTally.gapMedian >= seoul.gapMedian * GAP_NARROW_RATIO) facts.renewGapNarrow = shared;
  }

  if (districtTally.fromJeonse >= MIN_RENEWALS && districtTally.toWolseShare !== null && seoul?.toWolseShare) {
    const share = districtTally.toWolseShare;
    if (share >= seoul.toWolseShare * TO_WOLSE_HIGH_RATIO) {
      facts.toWolseHeavy = { share, seoul: seoul.toWolseShare, counted: districtTally.fromJeonse };
    } else if (share <= seoul.toWolseShare * TO_WOLSE_LOW_RATIO) {
      facts.toWolseLight = { share, seoul: seoul.toWolseShare, counted: districtTally.fromJeonse };
    }
  }

  return Object.keys(facts).length ? facts : null;
}

/** 자치구 페이지가 쓰는 문장. 갯수가 아니라 그 값이 무엇을 뜻하는지까지 적는다. */
export function renewalSentences(facts, locale = "ko") {
  if (!facts) return [];
  const en = locale === "en";
  const out = [];

  if (facts.capMissed) {
    const { share, seoul } = facts.capMissed;
    out.push(
      en
        ? `Among renewals where the tenant invoked the statutory right, ${share}% ended below the 5% cap, against ${seoul}% across Seoul — the ceiling is there, and landlords here are more often not reaching it.`
        : `계약갱신요구권을 쓴 재계약 가운데 ${share}%가 상한 5%에 못 미친 선에서 맺어졌습니다. 서울 전체는 ${seoul}%입니다 — 상한이 있는데도 거기까지 못 올린 계약이 이만큼이라는 것은, 집주인이 부르는 값을 이 동네 시장이 다 받아 주지 않았다는 뜻입니다.`
    );
  } else if (facts.capReached) {
    const { share, seoul } = facts.capReached;
    out.push(
      en
        ? `Among renewals where the tenant invoked the statutory right, only ${share}% ended below the 5% cap, against ${seoul}% across Seoul — here the ceiling is usually reached.`
        : `계약갱신요구권을 쓴 재계약 가운데 상한 5%에 못 미친 것은 ${share}%뿐입니다. 서울 전체는 ${seoul}%입니다 — 이 동네에서는 대체로 상한까지 올라갑니다.`
    );
  }

  const cheaper = (value) => Math.abs(value).toFixed(1);

  if (facts.renewGapWide) {
    const { gap, seoul, counted } = facts.renewGapWide;
    out.push(
      en
        ? `Renewing tenants here pay ${cheaper(gap)}% less than the median new lease signed the same month for the same unit type in the same complex, against ${cheaper(seoul)}% across Seoul (${counted.toLocaleString("en-US")} matched leases). Moving out costs more here than it does elsewhere.`
        : `이 동네에서 재계약하는 세입자는 같은 단지 같은 평형에 그달 새로 맺어진 계약보다 ${cheaper(gap)}% 싼 보증금을 냅니다. 서울 전체는 ${cheaper(seoul)}%입니다(맞물린 계약 ${counted.toLocaleString("ko-KR")}건) — 나가서 다시 구하면 그만큼을 더 내야 한다는 뜻입니다.`
    );
  } else if (facts.renewGapNarrow) {
    const { gap, seoul, cheaper: cheaperShare, counted } = facts.renewGapNarrow;
    // 0.0%를 "0.0% 싸다"로 적으면 문장이 아니다. 그리고 갱신이 더 비쌀 수도 있다.
    const flat = Math.abs(gap) < 0.05;
    const higher = gap >= 0.05;
    const headKo = flat
      ? "이 동네의 재계약 보증금은 같은 단지 같은 평형의 새 계약과 사실상 차이가 없습니다"
      : higher
        ? `이 동네의 재계약 보증금은 같은 단지 같은 평형의 새 계약보다 오히려 ${cheaper(gap)}% 높습니다`
        : `이 동네의 재계약 보증금은 같은 단지 같은 평형의 새 계약보다 ${cheaper(gap)}% 낮은 데 그칩니다`;
    const headEn = flat
      ? "Renewal deposits here sit essentially level with new leases for the same unit type in the same complex"
      : higher
        ? `Renewal deposits here run ${cheaper(gap)}% above new leases for the same unit type in the same complex`
        : `Renewing tenants here pay only ${cheaper(gap)}% less than the median new lease for the same unit type`;
    out.push(
      en
        ? `${headEn}, against ${cheaper(seoul)}% below across Seoul, and only ${cheaperShare}% of renewals came in under the market at all (${counted.toLocaleString("en-US")} matched leases). Staying put saves little here.`
        : `${headKo}. 서울 전체는 ${cheaper(seoul)}% 낮고, 여기서는 재계약 가운데 시세보다 싸게 맺어진 것이 ${cheaperShare}%뿐입니다(맞물린 계약 ${counted.toLocaleString("ko-KR")}건) — 눌러앉아 아끼는 것이 별로 없습니다.`
    );
  }

  if (facts.toWolseHeavy) {
    const { share, seoul } = facts.toWolseHeavy;
    out.push(
      en
        ? `Of tenants who had been on jeonse, ${share}% switched to monthly rent when they renewed, against ${seoul}% across Seoul.`
        : `전세로 살던 세입자가 재계약 때 월세로 바꾼 비율이 ${share}%입니다. 서울 전체는 ${seoul}%입니다 — 이 동네에서 전세가 유독 빠르게 월세로 바뀌고 있습니다.`
    );
  } else if (facts.toWolseLight) {
    const { share, seoul } = facts.toWolseLight;
    out.push(
      en
        ? `Of tenants who had been on jeonse, only ${share}% switched to monthly rent when they renewed, against ${seoul}% across Seoul.`
        : `전세로 살던 세입자가 재계약 때 월세로 바꾼 비율이 ${share}%로, 서울 전체 ${seoul}%보다 낮습니다 — 이 동네는 아직 전세가 전세로 남습니다.`
    );
  }

  return out;
}
