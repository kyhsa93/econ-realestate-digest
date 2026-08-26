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
