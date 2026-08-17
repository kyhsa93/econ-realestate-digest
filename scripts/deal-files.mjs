// 자치구별 실거래 전수 파일(docs/data/deals-<슬러그>.json).
//
// 검색 조건을 늘리려면 표본이 아니라 전수가 있어야 한다. 예산 구간 파일은 칸마다 대표
// 거래 몇 건만 담는데(budget-bands.mjs), 거기에 면적·연식 같은 조건을 더 걸면 걸리는
// 대상은 '대표로 뽑힌 몇 건'뿐이면서 화면에 적히는 건수는 전수다. 조건을 늘리는 순간
// 건수가 거짓말이 되는 구조라, 조건이 붙을 자리를 지역별 전수 파일로 옮긴다.
//
// 서울 전체를 한 파일에 담지 않는 이유는 전과 같다 - 석 달치가 수천 건이라 화면이 받는
// 파일이 수백 KB가 된다. 지역으로 먼저 자르면 구마다 수십 KB로 끝나고, 실제로 이 화면에
// 들어오는 사람은 "노원구에서 8억"처럼 지역을 먼저 고른다.
//
// 이 파일은 화면이 받는 자료인 동시에 **지난달 거래의 유일한 보관처**다. 거래 원본은
// gitignore된 캐시라 러너가 바뀌면 사라지고, 호출 한도 때문에 지난달을 다시 받을 수도
// 없다. 그래서 새로 쓸 때 기존 파일에 들어 있던 지난달치를 그대로 물려받는다
// (budget-months.json이 달마다 굳은 구간을 들고 있는 것과 같은 자리다).
import { DISTRICT_SLUGS } from "./district-slugs.mjs";

// 몇 달치를 들고 있을지. 예산 구간 파일과 같은 값을 쓴다 - 두 화면이 같은 기간을 말해야
// "8월 신고분 기준"이라는 문구가 양쪽에서 같은 뜻이 된다.
export const MAX_MONTHS = 3;

/** 거래일(2026-08-14) → 신고 기간(202608). */
export function periodOf(date) {
  const text = String(date ?? "");
  const period = text.slice(0, 4) + text.slice(5, 7);
  return /^\d{6}$/.test(period) ? period : null;
}

// 지역 이름은 파일 이름이 곧 열쇠라 거래마다 다시 담지 않는다(deal-search.json과 같은
// 규칙). 나머지는 조건으로 쓰이므로 전부 남긴다 - 여기서 떼면 그 조건을 못 만든다.
function trimDeal({ district: _name, ...deal }) {
  return deal;
}

/**
 * 이번 달 거래를 기존 파일에 얹는다.
 *
 * 이번 달은 통째로 갈아끼운다(하루에도 여러 번 신고가 쌓여 같은 달을 매번 다시 받는다).
 * 지난달은 손대지 않고, 보관 기간을 넘긴 달만 떨어뜨린다.
 */
export function mergeDeals(existingDeals, period, freshDeals, maxMonths = MAX_MONTHS) {
  const kept = (existingDeals ?? []).filter((deal) => periodOf(deal?.date) !== period);
  const all = [...kept, ...(freshDeals ?? []).map(trimDeal)].filter((deal) => periodOf(deal?.date));

  const periods = [...new Set(all.map((deal) => periodOf(deal.date)))].sort().slice(-maxMonths);
  const within = new Set(periods);

  // 최근 거래가 먼저. 같은 날이면 비싼 쪽을 앞에 둔다(예산을 다 쓰는 쪽이 궁금해서
  // 들어온 화면이다 - 구간 대표를 고르는 규칙과 같다).
  const deals = all
    .filter((deal) => within.has(periodOf(deal.date)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.amount10k - a.amount10k);

  return { periods, deals };
}

/**
 * 거래 원본 → { 슬러그: 파일 내용 }.
 *
 * existingByDistrict는 { 지역 이름: 지난번 파일 }이다. 이번 달에 거래가 한 건도 없는
 * 구도 파일을 다시 써야 한다 - 빼면 지난달치까지 같이 사라진다.
 */
export function buildDealFiles(source, existingByDistrict, now, maxMonths = MAX_MONTHS) {
  const period = source?.period;
  if (!period) return null;

  const freshByDistrict = new Map();
  for (const deal of Object.values(source?.districts ?? {}).flat()) {
    const name = String(deal?.district ?? "").trim();
    if (!name || !DISTRICT_SLUGS[name]) continue;
    if (!freshByDistrict.has(name)) freshByDistrict.set(name, []);
    freshByDistrict.get(name).push(deal);
  }

  const names = new Set([...freshByDistrict.keys(), ...Object.keys(existingByDistrict ?? {})]);
  const updatedAt = now.toISOString();
  const files = {};

  for (const name of [...names].sort((a, b) => a.localeCompare(b, "ko"))) {
    const slug = DISTRICT_SLUGS[name];
    if (!slug) continue;

    const { periods, deals } = mergeDeals(
      existingByDistrict?.[name]?.deals,
      period,
      freshByDistrict.get(name) ?? [],
      maxMonths
    );
    // 거래가 한 건도 안 남은 구는 파일을 만들지 않는다. 빈 파일을 내려보내면 화면이
    // "조건에 맞는 거래가 없다"와 "이 구는 자료가 없다"를 같은 모양으로 말하게 된다.
    if (!deals.length) continue;

    files[slug] = { district: name, updatedAt, periods, deals };
  }

  return files;
}

export const dealFileName = (slug) => `deals-${slug}.json`;
