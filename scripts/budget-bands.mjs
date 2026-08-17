// 실거래를 예산 구간으로 잘라 둔다.
//
// "8억으로 서울 어디를 살 수 있나"에 답하려면 서울 한 달치 거래 수천 건을 훑어야 하는데,
// 그 파일을 화면이 받게 할 수는 없다(rates.json 570KB를 뉴스 페이지에 못 붙인 것과 같은
// 이유다). 그래서 구간마다 대표 거래 몇 건과 건수만 미리 추려 둔다. 입력값은 구간으로
// 맞춰 답하면 되고, 파일은 수십 KB에서 끝난다.
//
// 여기서 만드는 건 '매물'이 아니라 '이미 신고된 거래'다. 화면 문구도 반드시 그렇게 적어야
// 한다 - 지금 그 값에 살 수 있다는 뜻이 아니다.

// 금액은 전부 만원 단위(국토부 신고 금액이 그 단위다).
export const BAND_UNIT = 10_000; // 1억
export const BAND_MIN = 30_000; // 3억 미만은 한 칸으로 묶는다
export const BAND_MAX = 300_000; // 30억 이상도 한 칸

// 구간마다 남길 대표 거래 수. 월별로 이만큼씩 쌓여 화면에서 합쳐지므로, 석 달이면
// 구간당 18건이 된다. 늘리면 그대로 파일 크기가 된다.
export const DEALS_PER_BAND = 6;

// 지역×구간 칸마다 남길 대표 거래 수. 서울 전체 구간보다 훨씬 적게 잡는다 - 칸이 25배로
// 늘어나(서울에서 400칸쯤 된다) 같은 값을 쓰면 화면이 받는 파일이 반 메가를 넘는다.
// 석 달치가 합쳐져 칸마다 여섯 건이 되고, 그 아래 "몇 건 거래됐다"는 전수로 센다.
export const DEALS_PER_DISTRICT_BAND = 3;

// 최근 몇 달치를 들고 있을지. 지난달 거래는 다시 받지 않는다(호출 한도 때문에 이 저장소는
// 지난달 집계도 캐시해 쓴다). 그래서 달이 바뀌면 그 달 구간 데이터가 그대로 굳는다.
export const MAX_MONTHS = 3;

/** 금액이 속한 구간의 시작값. 아래·위 오픈 구간은 각각 BAND_MIN·BAND_MAX로 모인다. */
export function bandStart(amount10k) {
  if (!Number.isFinite(amount10k) || amount10k <= 0) return null;
  if (amount10k < BAND_MIN) return 0;
  if (amount10k >= BAND_MAX) return BAND_MAX;
  return Math.floor(amount10k / BAND_UNIT) * BAND_UNIT;
}

/** 구간의 끝(이 값 미만). 맨 위 구간은 끝이 없다. */
export function bandEnd(start) {
  if (start === 0) return BAND_MIN;
  if (start === BAND_MAX) return null;
  return start + BAND_UNIT;
}

// 같은 단지가 대표 자리를 다 차지하면 "이 예산대에 뭐가 있나"를 못 보여준다. 단지당 한 건만
// 남기고, 그 안에서는 최근 거래를 먼저 둔다(같은 날이면 비싼 쪽 - 예산을 다 쓰는 쪽이
// 궁금해서 들어온 화면이다).
function pickRepresentatives(deals, limit = DEALS_PER_BAND) {
  const sorted = [...deals].sort(
    (a, b) => b.date.localeCompare(a.date) || b.amount10k - a.amount10k
  );

  const seen = new Set();
  const picked = [];
  for (const deal of sorted) {
    const key = `${deal.district}|${deal.apt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(deal);
    if (picked.length >= limit) break;
  }
  return picked;
}

// 어느 지역에 몰려 있는지는 예산만큼 궁금한 정보다("8억대는 노원·도봉"). 상위 다섯 곳만.
function districtCounts(deals, limit = 5) {
  const counts = new Map();
  for (const deal of deals) counts.set(deal.district, (counts.get(deal.district) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/** 거래 목록 → 예산 구간 배열(금액 오름차순). 거래가 없는 구간은 만들지 않는다. */
export function buildBands(deals, limit = DEALS_PER_BAND) {
  const byStart = new Map();

  for (const deal of deals ?? []) {
    const start = bandStart(deal?.amount10k);
    if (start === null) continue;
    if (!byStart.has(start)) byStart.set(start, []);
    byStart.get(start).push(deal);
  }

  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, list]) => ({
      min10k: start,
      max10k: bandEnd(start),
      count: list.length,
      districts: districtCounts(list),
      deals: pickRepresentatives(list, limit),
    }));
}

/**
 * 거래 목록 → { 지역: 구간 배열 }. 거래내역 검색이 "노원구에서 8억대"처럼 두 조건을
 * 같이 걸기 때문에 지역으로 먼저 자른다.
 *
 * 저장은 이 모양 한 벌로만 한다. 서울 전체 구간을 따로 저장해 두면 같은 거래가 두 파일에
 * 나뉘어 들어가고, 한쪽만 갱신되는 날 화면마다 다른 값을 보여주게 된다 - 서울 전체는
 * flattenDistrictMonths로 다시 합쳐 만든다.
 */
export function buildDistrictBands(deals, limit = DEALS_PER_DISTRICT_BAND) {
  const byDistrict = new Map();

  for (const deal of deals ?? []) {
    const name = String(deal?.district ?? "").trim();
    // 지역 없는 거래는 검색 조건 자체가 안 선다. 서울 전체 집계에서도 빠지지만, 원본에
    // 지역이 비어 오는 경우는 없어서(구 코드로 받아온다) 실질적인 손실은 없다.
    if (!name) continue;
    if (!byDistrict.has(name)) byDistrict.set(name, []);
    byDistrict.get(name).push(deal);
  }

  return Object.fromEntries(
    [...byDistrict.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([name, list]) => [name, buildBands(list, limit)])
  );
}

/** { 기간: { 지역: 구간 } } → { 기간: 구간 }. 서울 전체는 지역별 구간을 다시 합쳐 만든다. */
export function flattenDistrictMonths(months) {
  return Object.fromEntries(
    Object.entries(months ?? {}).map(([period, byDistrict]) => [
      period,
      Object.values(byDistrict ?? {}).flat(),
    ])
  );
}

/** { 기간: { 지역: 구간 } } → { 지역: 구간 }. 지역마다 여러 달을 하나로 합친다. */
export function mergeDistrictMonths(months, limit = DEALS_PER_DISTRICT_BAND * 2) {
  const byDistrict = new Map();

  for (const [period, districts] of Object.entries(months ?? {})) {
    for (const [name, bands] of Object.entries(districts ?? {})) {
      if (!byDistrict.has(name)) byDistrict.set(name, {});
      byDistrict.get(name)[period] = bands;
    }
  }

  return Object.fromEntries(
    [...byDistrict.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([name, monthsOf]) => [name, mergeBands(monthsOf, limit)])
  );
}

/**
 * 이번 달 구간을 기존 파일에 얹는다. 지난달 것은 그대로 두고 오래된 달만 떨어뜨린다 -
 * 지난달 거래를 다시 받아올 방법이 없기 때문에, 여기서 지우면 영영 사라진다.
 */
export function mergeMonths(existing, period, bands, maxMonths = MAX_MONTHS) {
  const months = { ...(existing?.months ?? {}), [period]: bands };
  const kept = Object.keys(months)
    .sort()
    .slice(-maxMonths);
  return Object.fromEntries(kept.map((key) => [key, months[key]]));
}

/**
 * 화면이 쓰는 모양. 월별로 나뉜 구간을 하나로 합친다. 건수는 더하고, 대표 거래는 최근
 * 순으로 다시 골라 단지 중복을 뗀다(달이 달라도 같은 단지는 한 번만).
 */
export function mergeBands(months, limit = DEALS_PER_BAND * 2) {
  const byStart = new Map();

  for (const bands of Object.values(months ?? {})) {
    for (const band of bands ?? []) {
      const current = byStart.get(band.min10k);
      if (!current) {
        byStart.set(band.min10k, { ...band, deals: [...band.deals] });
        continue;
      }
      current.count += band.count;
      current.deals.push(...band.deals);
      for (const { name, count } of band.districts ?? []) {
        const found = current.districts.find((d) => d.name === name);
        if (found) found.count += count;
        else current.districts.push({ name, count });
      }
    }
  }

  return [...byStart.values()]
    .sort((a, b) => a.min10k - b.min10k)
    .map((band) => ({
      ...band,
      districts: [...band.districts].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko")).slice(0, 5),
      deals: pickRepresentatives(band.deals, limit),
    }));
}
