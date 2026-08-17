// cache/realestate-deals.json(거래 원본) → docs/data/budget-deals.json(예산 구간)과
// docs/data/deal-search.json(지역×예산 구간).
//
// 원본은 gitignore된 캐시라 CI 러너가 바뀌면 사라진다. 그래서 이 스크립트는 "재료가
// 없으면 기존 결과를 그대로 둔다". 하루 4회 갱신 중 부동산 조회가 도는 건 한 번뿐이고,
// 나머지 세 번은 재료 없이 실행되기 때문이다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MAX_MONTHS,
  buildDistrictBands,
  flattenDistrictMonths,
  mergeBands,
  mergeDistrictMonths,
  mergeMonths,
} from "./budget-bands.mjs";
import { buildDealFiles, dealFileName } from "./deal-files.mjs";
import { DISTRICT_SLUGS } from "./district-slugs.mjs";

const root = path.resolve(import.meta.dirname, "..");

const dealsFile = process.env.REALESTATE_DEALS_FILE
  ? path.resolve(process.env.REALESTATE_DEALS_FILE)
  : path.join(root, "cache/realestate-deals.json");

// 화면이 받는 파일. 월별 원본을 합쳐 놓은 결과만 담는다.
const outFile = process.env.BUDGET_DEALS_FILE
  ? path.resolve(process.env.BUDGET_DEALS_FILE)
  : path.join(root, "docs/data/budget-deals.json");

// 거래내역 검색 화면이 받는 파일. 지역을 고른 뒤에야 쓰이는 자료라 예산 파일과 나눠 둔다 -
// 한 파일로 합치면 예산 섹션만 보는 시세 페이지가 25배 큰 파일을 받게 된다.
const searchFile = process.env.DEAL_SEARCH_FILE
  ? path.resolve(process.env.DEAL_SEARCH_FILE)
  : path.join(root, "docs/data/deal-search.json");

// 달마다 굳은 구간을 보관하는 파일. 지난달 거래는 다시 받아올 수 없어서(호출 한도 때문에
// 이 저장소는 지난달 집계도 캐시해 쓴다) 커밋해 두어야 다음 달에 합칠 수 있다. 화면은 이
// 파일을 받지 않는다 - 합쳐 둔 결과와 내용이 겹쳐서, 같이 내려보내면 크기만 세 배가 된다
// (realestate-prev.json이 docs/data에 있으면서 화면에 안 나가는 것과 같은 자리다).
const monthsFile = process.env.BUDGET_MONTHS_FILE
  ? path.resolve(process.env.BUDGET_MONTHS_FILE)
  : path.join(root, "docs/data/budget-months.json");

// 자치구별 전수 파일이 놓이는 자리. 화면은 지역을 고른 뒤에야 이 중 한 개를 받는다.
const dealFilesDir = process.env.DEAL_FILES_DIR
  ? path.resolve(process.env.DEAL_FILES_DIR)
  : path.join(root, "docs/data");

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

// 지역이 곧 열쇠인 파일이라 그 안에서 지역 이름을 또 들고 있을 이유가 없다. 구간마다
// 붙는 지역 분포(districts)도 한 지역뿐이라 읽을 값이 없고, 준공연도는 화면이 쓰지
// 않는다. 칸이 수백 개라 이 셋만 떼어도 화면이 받는 파일이 눈에 띄게 줄어든다.
const trimForSearch = (byDistrict) =>
  Object.fromEntries(
    Object.entries(byDistrict).map(([name, bands]) => [
      name,
      bands.map(({ districts: _counts, deals, ...band }) => ({
        ...band,
        deals: deals.map(({ district: _name, buildYear: _year, ...deal }) => deal),
      })),
    ])
  );

// 지역별 전수 파일의 주소 조각. 화면이 25개 슬러그를 다시 적어 두면 구 이름이 하나
// 바뀌는 날 두 곳을 같이 고쳐야 하고, 한쪽만 고치면 그 구만 조용히 검색이 안 된다.
const slugsFor = (byDistrict) =>
  Object.fromEntries(
    Object.keys(byDistrict)
      .filter((name) => DISTRICT_SLUGS[name])
      .map((name) => [name, DISTRICT_SLUGS[name]])
  );

export function buildPayload(source, existingMonths, now) {
  const deals = Object.values(source?.districts ?? {}).flat();
  if (!deals.length) return null;

  const months = mergeMonths(existingMonths, source.period, buildDistrictBands(deals), MAX_MONTHS);
  const periods = Object.keys(months).sort();
  const updatedAt = now.toISOString();
  const byDistrict = mergeDistrictMonths(months);

  return {
    screen: { updatedAt, periods, bands: mergeBands(flattenDistrictMonths(months)) },
    search: { updatedAt, periods, slugs: slugsFor(byDistrict), districts: trimForSearch(byDistrict) },
    months: { updatedAt, months },
  };
}

// 지난번에 써 둔 자치구별 파일을 지역 이름으로 되읽는다. 이 파일들이 지난달 거래의
// 유일한 보관처라, 못 읽으면 그 구의 지난달치가 그대로 사라진다.
async function readExistingDealFiles() {
  const entries = await Promise.all(
    Object.entries(DISTRICT_SLUGS).map(async ([name, slug]) => {
      const file = await readJson(path.join(dealFilesDir, dealFileName(slug)));
      return file?.deals?.length ? [name, file] : null;
    })
  );
  return Object.fromEntries(entries.filter(Boolean));
}

async function writeDealFiles(source, now) {
  const files = buildDealFiles(source, await readExistingDealFiles(), now);
  if (!files) return;

  await mkdir(dealFilesDir, { recursive: true });
  await Promise.all(
    Object.entries(files).map(([slug, payload]) =>
      // 지역 파일도 사람이 읽는 자료가 아니다. 구마다 수백 건이라 들여쓰기만으로
      // 화면이 받는 양이 세 배가 된다.
      writeFile(path.join(dealFilesDir, dealFileName(slug)), JSON.stringify(payload))
    )
  );

  const all = Object.values(files).flatMap((file) => file.deals);
  const direct = all.filter((deal) => deal.direct === true).length;
  const unknown = all.filter((deal) => !("direct" in deal)).length;
  console.log(
    `  자치구별 전수 ${Object.keys(files).length}개 파일 · 거래 ${all.length.toLocaleString("ko-KR")}건` +
      ` (직거래 ${direct.toLocaleString("ko-KR")}건 · 거래형태 미상 ${unknown.toLocaleString("ko-KR")}건)`
  );
}

async function main() {
  const source = await readJson(dealsFile);
  if (!source?.period) {
    // 조용히 넘어가지 않는다. 재료가 계속 안 잡히는 상태와 "오늘은 조회를 안 한 날"은
    // 화면상 구분이 안 가서, 로그가 없으면 며칠이 지나도 알아채지 못한다.
    console.log("  거래 원본이 없습니다 - 기존 예산 데이터를 그대로 둡니다");
    return;
  }

  const existingMonths = await readJson(monthsFile);
  const now = new Date();
  const payload = buildPayload(source, existingMonths, now);
  if (!payload) {
    console.log(`  ${source.period} 거래가 한 건도 없습니다 - 기존 예산 데이터를 그대로 둡니다`);
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload.screen, null, 2));
  await mkdir(path.dirname(searchFile), { recursive: true });
  // 검색 파일은 칸이 수백 개라 들여쓰기만으로 파일이 눈에 띄게 커진다.
  await writeFile(searchFile, JSON.stringify(payload.search));
  await mkdir(path.dirname(monthsFile), { recursive: true });
  // 이 파일은 사람이 읽는 자료가 아니라 다음 달을 위한 상태다. 들여쓰기만으로 세 배가
  // 되는데, 매일 커밋되는 파일이라 그 차이가 그대로 저장소에 쌓인다.
  await writeFile(monthsFile, JSON.stringify(payload.months));
  await writeDealFiles(source, now);

  const total = payload.screen.bands.reduce((sum, band) => sum + band.count, 0);
  console.log(
    `  예산 구간 ${payload.screen.bands.length}칸 · 거래 ${total.toLocaleString("ko-KR")}건` +
      ` (${payload.screen.periods.join(", ")})`
  );
  console.log(`  거래내역 검색 ${Object.keys(payload.search.districts).length}개 지역`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`예산 구간 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
