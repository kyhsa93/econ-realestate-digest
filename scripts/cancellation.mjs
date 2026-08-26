/**
 * 신고된 뒤에 일어나는 두 가지 - 해제와 등기.
 *
 * 시세 화면은 해제된 거래를 빼고 센다(dropCancelled). 빼는 것이 맞지만, 뺀 것이
 * 무엇이었는지는 어디에도 남지 않는다. 여기서는 그 뺀 쪽을 본다.
 */

const pad = (n) => String(n).padStart(2, "0");

/** 국토부는 날짜를 "26.08.18"로 준다. */
export function parseShortDate(value) {
  const text = String(value ?? "").trim();
  const matched = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(text);
  if (!matched) return null;
  const [, y, m, d] = matched;
  const year = 2000 + Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC는 13월이나 99일을 다음 해로 굴려 버린다. 굴러간 값은 원래 숫자와
  // 달라지므로, 되읽어 같은지 보는 것으로 걸러낸다.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function dealDate(item) {
  const y = Number(item?.dealYear);
  const m = Number(item?.dealMonth);
  const d = Number(item?.dealDay);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

export const dayGap = (from, to) => (from && to ? Math.round((to - from) / 86400000) : null);

export const isCancelled = (item) =>
  String(item?.cdealType ?? "").trim().length > 0 || String(item?.cdealDay ?? "").trim().length > 0;

export const isRegistered = (item) => String(item?.rgstDate ?? "").trim().length > 0;

export const monthKey = (item) => `${item?.dealYear}-${pad(item?.dealMonth)}`;

export const amountOf = (item) => {
  const value = Number(String(item?.dealAmount ?? "").replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
};

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 해제된 거래가 그 단지에서 비싼 축이었는지.
 *
 * "신고가만 올려 두고 취소한다"는 말이 사실이라면 해제 건은 같은 단지·같은 면적의
 * 남은 거래보다 높아야 한다. 실제로 그런지는 세어 보기 전에는 알 수 없고,
 * 세어 본 결과를 그대로 싣는다.
 */
export function priceStanding(items) {
  const groups = new Map();

  for (const item of items ?? []) {
    const area = Number(item?.excluUseAr);
    const amount = amountOf(item);
    if (!Number.isFinite(area) || !amount) continue;

    const key = `${item.sggCd} ${item.aptNm} ${item.jibun ?? ""} ${Math.round(area)}`;
    if (!groups.has(key)) groups.set(key, { cancelled: [], live: [] });
    groups.get(key)[isCancelled(item) ? "cancelled" : "live"].push(amount);
  }

  let higher = 0;
  let similar = 0;
  let lower = 0;
  const ratios = [];

  for (const group of groups.values()) {
    if (!group.cancelled.length || !group.live.length) continue;
    const mid = median(group.live);
    for (const amount of group.cancelled) {
      const ratio = amount / mid;
      ratios.push(ratio);
      if (ratio > 1.02) higher += 1;
      else if (ratio < 0.98) lower += 1;
      else similar += 1;
    }
  }

  const compared = higher + similar + lower;
  if (!compared) return null;

  const share = (n) => Math.round((n / compared) * 1000) / 10;
  return {
    compared,
    higher,
    similar,
    lower,
    higherShare: share(higher),
    similarShare: share(similar),
    lowerShare: share(lower),
    medianRatio: Math.round(median(ratios) * 1000) / 1000,
  };
}

/**
 * 등기가 늦은 거래를 세려면 "늦었다"고 할 기준이 있어야 하는데, 이것을 등기까지
 * 걸린 날의 분포에서 뽑으면 안 된다. 그 분포에는 이미 등기된 건만 들어 있어서
 * 빠른 쪽으로 기운다 - 아직 등기가 안 된 느린 건들은 애초에 세어지지 않는다.
 *
 * 대신 계약월 단위로 본다. 그 달 계약의 열에 여덟이 이미 등기를 마쳤다면 그 달은
 * 익은 달이고, 거기 남은 미등기는 시간이 모자라서가 아니다. 아직 안 익은 달은
 * 통째로 모집단에서 뺀다 - 이번 달 계약이 등기 전인 것은 당연한 일이라 세면 거짓말이 된다.
 */
export const MATURE_SHARE = 0.8;

export function registrationStats(items, matureShare = MATURE_SHARE) {
  const live = (items ?? []).filter((item) => !isCancelled(item));
  if (!live.length) return null;

  const gaps = [];
  for (const item of live) {
    if (!isRegistered(item)) continue;
    const gap = dayGap(dealDate(item), parseShortDate(item.rgstDate));
    if (gap !== null && gap >= 0 && gap < 400) gaps.push(gap);
  }

  const months = new Map();
  for (const item of live) {
    const key = monthKey(item);
    if (!months.has(key)) months.set(key, { filed: 0, registered: 0 });
    const row = months.get(key);
    row.filed += 1;
    if (isRegistered(item)) row.registered += 1;
  }

  const mature = new Set(
    [...months.entries()].filter(([, row]) => row.registered / row.filed >= matureShare).map(([key]) => key)
  );

  const matured = live.filter((item) => mature.has(monthKey(item)));
  const stale = matured.filter((item) => !isRegistered(item));

  return {
    medianDays: gaps.length ? median(gaps) : null,
    registered: gaps.length,
    matureMonths: [...mature].sort(),
    matured: matured.length,
    stale: stale.length,
    staleShare: matured.length ? Math.round((stale.length / matured.length) * 1000) / 10 : null,
  };
}

/** 계약월별 등기 완료율. 미등기가 시간의 함수라는 것을 이 곡선이 보여준다. */
export function registrationByMonth(items) {
  const months = new Map();

  for (const item of items ?? []) {
    if (isCancelled(item)) continue;
    const key = monthKey(item);
    if (!months.has(key)) months.set(key, { month: key, filed: 0, registered: 0 });
    const row = months.get(key);
    row.filed += 1;
    if (isRegistered(item)) row.registered += 1;
  }

  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({ ...row, share: Math.round((row.registered / row.filed) * 1000) / 10 }));
}

/** 자치구별 해제율과 등기 지연율. 표본이 얇은 구는 비율을 말하지 않는다. */
export const MIN_DEALS = 100;

export function districtStats(itemsByDistrict, matureMonths = null, minDeals = MIN_DEALS) {
  const rows = [];
  // 익은 달은 서울 전체에서 한 번 정하고 모든 구에 같이 적용한다. 구마다 따로
  // 정하면 어떤 구는 넉 달, 어떤 구는 두 달을 세게 되어 비율끼리 견줄 수 없다.
  const mature = matureMonths ? new Set(matureMonths) : null;

  for (const [district, items] of Object.entries(itemsByDistrict ?? {})) {
    if (!items?.length) continue;
    const cancelled = items.filter(isCancelled).length;
    const scoped = mature ? items.filter((item) => mature.has(monthKey(item))) : items;
    const live = scoped.filter((item) => !isCancelled(item));
    const staleCount = live.filter((item) => !isRegistered(item)).length;
    const registration = mature
      ? { matured: live.length, stale: staleCount, staleShare: live.length ? Math.round((staleCount / live.length) * 1000) / 10 : null }
      : registrationStats(items);

    rows.push({
      district,
      deals: items.length,
      cancelled,
      cancelledShare: items.length >= minDeals ? Math.round((cancelled / items.length) * 1000) / 10 : null,
      matured: registration?.matured ?? 0,
      stale: registration?.stale ?? 0,
      staleShare: (registration?.matured ?? 0) >= minDeals ? registration.staleShare : null,
    });
  }

  return rows.sort((a, b) => (b.cancelledShare ?? -1) - (a.cancelledShare ?? -1) || a.district.localeCompare(b.district, "ko"));
}

export function cancellationTiming(items) {
  const gaps = [];
  for (const item of items ?? []) {
    if (!isCancelled(item)) continue;
    const gap = dayGap(dealDate(item), parseShortDate(item.cdealDay));
    if (gap !== null && gap > -10 && gap < 400) gaps.push(gap);
  }
  if (!gaps.length) return null;

  return {
    counted: gaps.length,
    medianDays: median(gaps),
    withinFilingWindow: Math.round((gaps.filter((g) => g <= 30).length / gaps.length) * 1000) / 10,
    overQuarter: Math.round((gaps.filter((g) => g > 90).length / gaps.length) * 1000) / 10,
  };
}

const monthLabel = (yearMonth) => `${String(yearMonth).slice(0, 4)}.${String(yearMonth).slice(4, 6)}`;

/**
 * 첫 문단. 전세·월세 화면과 같이 빌드에서 두 언어를 미리 만들어 넘긴다.
 * 해제가 최고가였는지는 세어 본 결과대로만 말한다 - 그 편이 흔한 이야기와
 * 어긋나더라도 그렇다.
 */
export function leadSentence({ deals, cancelled, timing, standing, months }, locale = "ko") {
  if (!deals || !cancelled) return null;

  const share = Math.round((cancelled / deals) * 1000) / 10;
  const span = months?.length ? `${monthLabel(months[0])}~${monthLabel(months[months.length - 1])}` : "";

  if (locale === "en") {
    const verdict = !standing
      ? ""
      : standing.higherShare > standing.lowerShare + 10
        ? ` Cancelled deals do skew high: ${standing.higherShare}% sat above the median of what remained in the same complex, against ${standing.lowerShare}% below.`
        : ` They are not the top prints people assume: ${standing.higherShare}% sat above the median of what remained in the same complex, while ${standing.lowerShare}% sat below.`;
    return (
      `Of ${deals.toLocaleString("en-US")} filed sales${span ? ` in ${span}` : ""}, ${cancelled.toLocaleString("en-US")} were later cancelled — ${share}%.` +
      (timing ? ` Half of them were undone within ${timing.medianDays} days, inside the 30-day filing window.` : "") +
      verdict
    );
  }

  const verdict = !standing
    ? ""
    : standing.higherShare > standing.lowerShare + 10
      ? ` 해제된 거래는 실제로 비싼 축이다 — 같은 단지에 남은 거래의 중앙값보다 높았던 것이 ${standing.higherShare}%, 낮았던 것이 ${standing.lowerShare}%다.`
      : ` 흔히 말하는 것과 달리 해제 거래가 그 단지 최고가인 것은 아니다 — 같은 단지에 남은 거래의 중앙값보다 높았던 것이 ${standing.higherShare}%인 반면, 낮았던 것이 ${standing.lowerShare}%로 오히려 더 많다.`;

  return (
    `${span ? `${span} ` : ""}신고된 매매 ${deals.toLocaleString("ko-KR")}건 가운데 ${cancelled.toLocaleString("ko-KR")}건이 나중에 해제됐다. ${share}%다.` +
    (timing ? ` 절반은 ${timing.medianDays}일 안에 지워졌는데, 신고 기한 30일 안이다.` : "") +
    verdict
  );
}
