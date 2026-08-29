import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICTS } from "./realestate-districts.mjs";
import { readSlotFile } from "./realestate-raw.mjs";
import { recentMonths } from "./realestate-source.mjs";
import { cellRatios, spreadOf } from "./complex-ratio.mjs";

const root = path.resolve(import.meta.dirname, "..");

/** 시세 화면과 같은 창. 칸 하나에 매매·전세가 각각 세 건씩 있어야 해서 짧으면 안 찬다. */
export const MONTHS = 6;

const outFile = process.env.COMPLEX_RATIO_FILE
  ? path.resolve(process.env.COMPLEX_RATIO_FILE)
  : path.join(root, "docs/data/complex-ratio.json");

const itemsOf = (files) =>
  files.filter((file) => file?.ok !== false && Array.isArray(file?.items)).flatMap((file) => file.items);

/** DISTRICTS 순서로 담는다 - 끝나는 대로 담으면 출력 순서가 그날그날 달라진다. */
export async function readRaw(months, dir) {
  const perDistrict = await Promise.all(
    DISTRICTS.map(async ({ code, name }) => {
      const [sales, rents] = await Promise.all([
        Promise.all(months.map((ym) => readSlotFile("sale", code, ym, dir))).then(itemsOf),
        Promise.all(months.map((ym) => readSlotFile("rent", code, ym, dir))).then(itemsOf),
      ]);
      return [name, { sales, rents }];
    })
  );
  return Object.fromEntries(perDistrict);
}

export function buildPayload({ byDistrict, now }) {
  const districts = {};
  const all = [];

  for (const [name, { sales, rents }] of Object.entries(byDistrict ?? {})) {
    const ratios = cellRatios(sales, rents);
    all.push(...ratios);
    const spread = spreadOf(ratios);
    if (spread) districts[name] = spread;
  }

  if (!all.length) return null;
  return { updatedAt: now.toISOString(), seoul: spreadOf(all), districts };
}

async function main() {
  const now = new Date();
  const byDistrict = await readRaw(recentMonths(now, MONTHS));
  const payload = buildPayload({ byDistrict, now });

  if (!payload) {
    console.log("  단지별 전세가율을 낼 거래가 없습니다 - 기존 파일을 그대로 둡니다");
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));

  const { seoul, districts } = payload;
  console.log(
    `  단지·평형 ${seoul.cells.toLocaleString("ko-KR")}칸 · 서울 중앙 ${seoul.median}% (절반이 ${seoul.q1}~${seoul.q3}%)`
  );
  console.log(`  분위를 말할 수 있는 자치구 ${Object.keys(districts).length}곳`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`단지별 전세가율 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
