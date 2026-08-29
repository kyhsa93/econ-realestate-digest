import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  districtRows,
  districtSentence,
  leadSentence,
  tally,
  toCells,
  topSentence,
} from "./floor-gap.mjs";
import { DISTRICTS } from "./realestate-districts.mjs";
import { DISTRICT_SLUGS } from "./district-slugs.mjs";
import { readSlotFile } from "./realestate-raw.mjs";
import { recentMonths } from "./realestate-source.mjs";

const root = path.resolve(import.meta.dirname, "..");

/** 한 칸에 대조군 세 건이 모이려면 창이 짧아서는 안 된다. 시세 화면과 같은 여섯 달. */
export const MONTHS = 6;

const outFile = process.env.FLOOR_GAP_FILE
  ? path.resolve(process.env.FLOOR_GAP_FILE)
  : path.join(root, "docs/data/floor-gap.json");

const amount = (value) => Number(String(value ?? "").replace(/,/g, ""));

/**
 * 자치구를 DISTRICTS 순서로 담는다. 완료되는 대로 담으면 그날 디스크가 어느 파일을
 * 먼저 내주었는지가 출력 순서가 되어, 값이 하나도 안 변해도 매일 diff가 난다.
 */
async function readRaw(kind, months, dir, toPrice) {
  const perDistrict = await Promise.all(
    DISTRICTS.map(async ({ code, name }) => {
      const files = await Promise.all(months.map((yearMonth) => readSlotFile(kind, code, yearMonth, dir)));
      const items = files
        .filter((file) => file?.ok !== false && Array.isArray(file?.items))
        .flatMap((file) => file.items)
        .map(toPrice)
        .filter(Boolean);
      return [name, items];
    })
  );
  return Object.fromEntries(perDistrict.filter(([, items]) => items.length));
}

/** 해제된 거래는 없던 일이 된 값이라 뺀다. 시세 화면이 빼는 것과 같은 이유다. */
export const saleRow = (item) => {
  if (String(item?.cdealType ?? "").trim()) return null;
  const price = amount(item?.dealAmount);
  return price > 0 ? { ...item, price } : null;
};

/**
 * 전세는 순수 전세만 본다. 반전세는 보증금과 월세를 한 값으로 묶어야 하는데, 묶는
 * 배수가 곧 전월세전환율이라 이 화면과 무관한 값을 끌어들이게 된다.
 */
export const jeonseRow = (item) => {
  if (amount(item?.monthlyRent) !== 0) return null;
  const price = amount(item?.deposit);
  return price > 0 ? { ...item, price } : null;
};

export function buildPayload({ sale, jeonse, now }) {
  const saleCells = toCells(sale);
  const saleTally = tally(saleCells);
  if (!saleTally.low.cells) return null;

  const jeonseTally = tally(toCells(jeonse));

  // 우연히 나올 수 있는 폭은 서울 칸 전체에서 뽑는다 - 자치구 값을 그 안에 넣어 본다.
  const pool = [...saleTally.byDistrict.values()].flat();
  const rows = districtRows(saleTally.byDistrict, pool);

  const slugs = {};
  for (const { name } of DISTRICTS) {
    if (DISTRICT_SLUGS[name]) slugs[name] = DISTRICT_SLUGS[name];
  }

  return {
    updatedAt: now.toISOString(),
    months: MONTHS,
    sale: { low: saleTally.low, top: saleTally.top },
    jeonse: { low: jeonseTally.low, top: jeonseTally.top },
    districts: rows,
    slugs,
    lead: { ko: leadSentence(saleTally, jeonseTally, "ko"), en: leadSentence(saleTally, jeonseTally, "en") },
    topLead: { ko: topSentence(saleTally, "ko"), en: topSentence(saleTally, "en") },
    districtLead: {
      ko: districtSentence(rows, saleTally.low.median, "ko"),
      en: districtSentence(rows, saleTally.low.median, "en"),
    },
  };
}

async function main() {
  const now = new Date();
  const months = recentMonths(now, MONTHS);
  const [sale, jeonse] = await Promise.all([
    readRaw("sale", months, undefined, saleRow),
    readRaw("rent", months, undefined, jeonseRow),
  ]);

  const payload = buildPayload({ sale, jeonse, now });
  if (!payload) {
    console.log("  층 격차: 견줄 칸이 없어 건너뜀");
    return;
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload, null, 2));

  const speak = payload.districts.filter((row) => row.distinct).length;
  console.log(
    `  층 격차: 1층 ${payload.sale.low.median}% (칸 ${payload.sale.low.cells}) · ` +
      `전세 ${payload.jeonse.low.median}% · 최상층 ${payload.sale.top.median}% · ` +
      `서울과 다르다고 말할 수 있는 구 ${speak}곳`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
