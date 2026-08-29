import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICT_PAGES, DISTRICT_SLUGS } from "./district-slugs.mjs";
import { rentFileName } from "./deal-files.mjs";

/**
 * 자치구를 고르기 전에 보여줄 전월세 맛보기.
 *
 * 실거래 검색에서 매매는 조건 없이도 결과가 나온다 - 서울 전체 12,650건과 최근
 * 거래 목록이 바로 뜬다. 그런데 전세나 월세로 바꾸는 순간 "자치구를 고르세요"만
 * 남는다. 전월세 전수 파일이 자치구별로 쪼개져 있고 스물다섯 개를 합치면 6.8MB라
 * 서울 전체를 그 자리에서 만들 수 없기 때문이다.
 *
 * 그래서 서울 전체 건수와 최근 몇 건만 미리 만들어 둔다.
 *
 * 중요한 것은 <strong>이 파일로 조건을 거르지 않는다</strong>는 점이다. 여기 담긴
 * 것은 최근 몇 건뿐이라, 그 위에 "60㎡ 미만"을 얹으면 나오는 건수는 서울에서
 * 그 조건에 맞는 거래 수가 아니라 이 목록 안의 수다. 화면에서는 구별되지 않는다.
 * 조건이 하나라도 걸리면 자치구를 고르게 해서 전수 파일을 읽는다 - 시세 화면이
 * 자치구별 전수 파일을 따로 두는 것과 같은 이유다.
 */

const root = path.resolve(import.meta.dirname, "..");

/** 맛보기로 보여줄 최근 거래 수. 화면이 한 번에 그리는 수(30)에 맞춘다. */
export const PREVIEW_ROWS = 30;

const outFile = process.env.RENT_PREVIEW_FILE
  ? path.resolve(process.env.RENT_PREVIEW_FILE)
  : path.join(root, "docs/data/rent-preview.json");

const isWolse = (deal) => Number(deal?.monthlyRent10k ?? 0) > 0;

export function buildPayload({ byDistrict, now }) {
  const buckets = { jeonse: [], wolse: [] };
  const counts = { jeonse: 0, wolse: 0 };
  let periods = null;

  for (const district of DISTRICT_PAGES) {
    const file = byDistrict?.[district.name];
    if (!file?.deals?.length) continue;
    periods ??= file.periods ?? null;

    for (const deal of file.deals) {
      // 시세와 같은 규칙 - 갱신은 이전 조건을 잇는 것이라 지금 값이 아니다.
      if (deal?.renewal === true) continue;
      const kind = isWolse(deal) ? "wolse" : "jeonse";
      counts[kind] += 1;
      buckets[kind].push({ ...deal, district: district.name });
    }
  }

  if (!counts.jeonse && !counts.wolse) return null;

  const recent = (rows) =>
    [...rows]
      // 날짜가 같으면 자치구·단지 이름으로 묶어 순서를 고정한다. 그러지 않으면
      // 값이 그대로여도 빌드마다 목록 순서가 바뀌어 매일 diff가 난다.
      .sort(
        (a, b) =>
          String(b.date).localeCompare(String(a.date)) ||
          a.district.localeCompare(b.district, "ko") ||
          String(a.apt).localeCompare(String(b.apt), "ko")
      )
      .slice(0, PREVIEW_ROWS);

  return {
    updatedAt: now.toISOString(),
    periods,
    jeonse: { total: counts.jeonse, deals: recent(buckets.jeonse) },
    wolse: { total: counts.wolse, deals: recent(buckets.wolse) },
  };
}

async function readRents() {
  const byDistrict = {};
  for (const district of DISTRICT_PAGES) {
    const file = path.join(root, "docs/data", rentFileName(DISTRICT_SLUGS[district.name]));
    const json = await readFile(file, "utf8").then(JSON.parse).catch(() => null);
    if (json) byDistrict[district.name] = json;
  }
  return byDistrict;
}

async function main() {
  const payload = buildPayload({ byDistrict: await readRents(), now: new Date() });
  if (!payload) {
    console.log("  전월세 신고가 없습니다 - 맛보기를 만들지 않습니다");
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));
  const size = JSON.stringify(payload).length;
  console.log(
    `  전월세 맛보기 전세 ${payload.jeonse.total.toLocaleString("ko-KR")}건 · ` +
      `월세 ${payload.wolse.total.toLocaleString("ko-KR")}건 (각 최근 ${PREVIEW_ROWS}건) · ${(size / 1024).toFixed(0)}KB`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`전월세 맛보기 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
