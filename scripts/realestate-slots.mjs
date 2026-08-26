/**
 * 화면이 세는 창. 시세도 추이 그래프도 이만큼만 본다.
 *
 * 보관 창(RETENTION_MONTHS)과 일부러 갈라 둔다. 원본을 더 오래 들고 있는 것과
 * 화면이 그만큼을 세는 것은 다른 결정이다 - 둘을 한 상수로 묶으면 저장 기간을
 * 늘린 날 추이 그래프가 조용히 몇 년짜리로 바뀐다.
 */
export const WINDOW_MONTHS = 6;

/**
 * 원본을 들고 있는 기간.
 *
 * 같은 물건이 두 번 팔린 것을 견주려면(반복거래) 두 거래 사이가 벌어져 있어야 하는데,
 * 여섯 달 안에서는 그런 쌍이 거의 없다. 국토부는 지난 달도 조회할 수 있고 planFetch가
 * 빈 슬롯을 하루에 조금씩 메우므로, 창만 넓혀 두면 나머지는 시간이 채운다.
 */
export const RETENTION_MONTHS = 24;

export const MONTH_START_GRACE_DAYS = 3;

export function kstDateParts(date) {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const [year, month, day] = text.split("-").map(Number);
  return { year, month, day };
}

export function yearMonthOf(date) {
  const { year, month } = kstDateParts(date);
  return `${year}${String(month).padStart(2, "0")}`;
}

export function shiftMonth(yearMonth, delta) {
  const text = String(yearMonth ?? "");
  if (!/^\d{6}$/.test(text)) return null;

  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  if (month < 1 || month > 12) return null;

  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}${String((index % 12) + 1).padStart(2, "0")}`;
}

export function windowMonths(now, count = WINDOW_MONTHS) {
  const current = yearMonthOf(now);
  return Array.from({ length: count }, (_, i) => shiftMonth(current, -i));
}

export function refreshMonths(now) {
  const current = yearMonthOf(now);
  const months = [current, shiftMonth(current, -1)];
  if (kstDateParts(now).day <= MONTH_START_GRACE_DAYS) months.push(shiftMonth(current, -2));
  return months;
}

export const slotKey = (kind, code, yearMonth) => `${kind}:${code}:${yearMonth}`;

export function parseSlotKey(key) {
  const [kind, code, yearMonth] = String(key).split(":");
  return { kind, code, yearMonth };
}

export function slotStateOf(meta, refreshing) {
  if (refreshing) return "stale";
  if (!meta) return "missing";
  if (meta.ok === false) return "broken";
  if (!Number.isInteger(meta.count)) return "broken";
  if (Number.isInteger(meta.totalCount) && meta.totalCount !== meta.count) return "broken";
  return "frozen";
}

export function planFetch({
  now,
  districts,
  kinds,
  slots = {},
  backfillLimit = Infinity,
  windowSize = RETENTION_MONTHS,
}) {
  const months = windowMonths(now, windowSize);
  const within = new Set(months);
  const refreshing = new Set(refreshMonths(now).filter((month) => within.has(month)));

  const refresh = [];
  const broken = [];
  const missing = [];

  for (const yearMonth of months) {
    for (const kind of kinds) {
      for (const { code } of districts) {
        const state = slotStateOf(slots[slotKey(kind, code, yearMonth)], refreshing.has(yearMonth));
        if (state === "frozen") continue;
        const slot = { kind, code, yearMonth, reason: state };
        if (state === "stale") refresh.push(slot);
        else if (state === "broken") broken.push(slot);
        else missing.push(slot);
      }
    }
  }

  const queued = [...broken, ...missing];
  const backfill = queued.slice(0, backfillLimit);

  return {
    fetch: [...refresh, ...backfill],
    expired: Object.keys(slots)
      .map(parseSlotKey)
      .filter((slot) => !within.has(slot.yearMonth)),
    pending: queued.length - backfill.length,
  };
}

export function planSummary(plan) {
  const countOf = (reason) => plan.fetch.filter((slot) => slot.reason === reason).length;
  const parts = [
    `갱신 ${countOf("stale")}`,
    `재조회 ${countOf("broken")}`,
    `신규 ${countOf("missing")}`,
  ];
  if (plan.pending > 0) parts.push(`대기 ${plan.pending}`);
  if (plan.expired.length > 0) parts.push(`만료 ${plan.expired.length}`);
  return parts.join(" · ");
}
