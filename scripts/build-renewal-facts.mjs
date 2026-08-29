import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { capLead, districtRow, renewalFacts, seoulLead, seoulTally, sortRows, tally } from "./renewal-facts.mjs";
import { DISTRICT_SLUGS } from "./district-slugs.mjs";
import { DISTRICTS } from "./realestate-districts.mjs";
import { readSlotFile } from "./realestate-raw.mjs";
import { recentMonths } from "./realestate-source.mjs";

const root = path.resolve(import.meta.dirname, "..");

// 신고 기한이 지나 닫힌 달만 세므로, 창이 짧으면 셀 것이 거의 남지 않는다.
export const MONTHS = 6;

const outFile = process.env.RENEWAL_FACTS_FILE
  ? path.resolve(process.env.RENEWAL_FACTS_FILE)
  : path.join(root, "docs/data/renewal-facts.json");

/**
 * 자치구를 DISTRICTS 순서로 담는다 - 완료되는 대로 담으면 출력 순서가 그날그날
 * 달라져 뜻 없는 변경이 매일 커밋된다.
 */
export async function readRawRents(months, dir) {
  const perDistrict = await Promise.all(
    DISTRICTS.map(async ({ code, name }) => {
      const files = await Promise.all(months.map((yearMonth) => readSlotFile("rent", code, yearMonth, dir)));
      const items = files
        .filter((file) => file?.ok !== false && Array.isArray(file?.items))
        .flatMap((file) => file.items);
      return [name, items];
    })
  );

  return Object.fromEntries(perDistrict.filter(([, items]) => items.length));
}

export function buildPayload({ byDistrict, now }) {
  const seoul = seoulTally(byDistrict, now);
  if (!seoul.renewals) return null;

  // 자치구 페이지가 쓰는 쪽(문턱을 넘은 관찰만)과 재계약 화면이 쓰는 쪽(스물다섯 구
  // 전부, 문턱을 못 넘었으면 못 넘었다고 적을 수 있게 건수까지)을 같이 담는다.
  // 한 번 센 것을 두 모양으로 내보내는 것이라 세는 일은 여전히 한 곳에서만 한다.
  const districts = {};
  const table = [];

  for (const [name, items] of Object.entries(byDistrict ?? {})) {
    const districtTally = tally(items, now);
    const facts = renewalFacts(districtTally, seoul);
    if (facts) districts[name] = facts;
    table.push(districtRow(name, districtTally));
  }

  const slugs = {};
  for (const row of table) {
    if (DISTRICT_SLUGS[row.district]) slugs[row.district] = DISTRICT_SLUGS[row.district];
  }

  return {
    updatedAt: now.toISOString(),
    seoul,
    districts,
    table: sortRows(table),
    slugs,
    lead: { ko: seoulLead(seoul, "ko"), en: seoulLead(seoul, "en") },
    capLead: { ko: capLead(seoul, "ko"), en: capLead(seoul, "en") },
  };
}

async function main() {
  const now = new Date();
  const byDistrict = await readRawRents(recentMonths(now, MONTHS));
  const payload = buildPayload({ byDistrict, now });

  if (!payload) {
    console.log("  갱신 신고가 없습니다 - 기존 재계약 관찰을 그대로 둡니다");
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));

  const { seoul, districts } = payload;
  console.log(
    `  재계약 ${seoul.renewals.toLocaleString("ko-KR")}건 · 요구권 행사 ${seoul.rightUsed.toLocaleString("ko-KR")}건 중` +
      ` 상한 미달 ${seoul.capMissShare}% · 전세→월세 전환 ${seoul.toWolseShare}%`
  );
  if (seoul.gapMatched) {
    console.log(
      `  갱신 vs 신규 전세: 맞물린 ${seoul.gapMatched.toLocaleString("ko-KR")}건 중앙값 ${seoul.gapMedian}% ·` +
        ` 시세보다 싸게 맺어진 재계약 ${seoul.gapCheaperShare}%`
    );
  }
  console.log(`  문턱을 넘은 자치구 ${Object.keys(districts).length}곳: ${Object.keys(districts).join(", ") || "없음"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`재계약 관찰 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
