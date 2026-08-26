import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renewalFacts, seoulTally, tally } from "./renewal-facts.mjs";
import { DISTRICTS } from "./realestate-districts.mjs";
import { readSlotFile } from "./realestate-raw.mjs";
import { recentMonths } from "./realestate-source.mjs";

const root = path.resolve(import.meta.dirname, "..");

// 신고 기한이 지나 닫힌 달만 세므로, 창이 짧으면 셀 것이 거의 남지 않는다.
export const MONTHS = 6;

const outFile = process.env.RENEWAL_FACTS_FILE
  ? path.resolve(process.env.RENEWAL_FACTS_FILE)
  : path.join(root, "docs/data/renewal-facts.json");

export async function readRawRents(months) {
  const byDistrict = {};

  await Promise.all(
    months.flatMap((yearMonth) =>
      DISTRICTS.map(async ({ code, name }) => {
        const file = await readSlotFile("rent", code, yearMonth);
        if (file?.ok === false || !Array.isArray(file?.items)) return;
        (byDistrict[name] ??= []).push(...file.items);
      })
    )
  );

  return byDistrict;
}

export function buildPayload({ byDistrict, now }) {
  const seoul = seoulTally(byDistrict, now);
  if (!seoul.renewals) return null;

  const districts = {};
  for (const [name, items] of Object.entries(byDistrict ?? {})) {
    const facts = renewalFacts(tally(items, now), seoul);
    if (facts) districts[name] = facts;
  }

  return { updatedAt: now.toISOString(), seoul, districts };
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
  console.log(`  문턱을 넘은 자치구 ${Object.keys(districts).length}곳: ${Object.keys(districts).join(", ") || "없음"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`재계약 관찰 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
