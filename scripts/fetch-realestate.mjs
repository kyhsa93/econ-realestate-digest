import { XMLParser } from "fast-xml-parser";
import path from "node:path";
import { DISTRICTS, districtNames } from "./realestate-districts.mjs";
import { buildSlotFile, readSlots, removeSlotFile, writeSlotFile } from "./realestate-raw.mjs";
import { planFetch, planSummary } from "./realestate-slots.mjs";

const SALE_API_URL = process.env.MOLIT_API_ENDPOINT;
const SALE_SERVICE_KEY = process.env.MOLIT_API_KEY;
const RENT_API_URL = process.env.MOLIT_RENT_API_ENDPOINT;
const RENT_SERVICE_KEY = process.env.MOLIT_RENT_API_KEY;

const CONCURRENCY = Number(process.env.MOLIT_CONCURRENCY ?? 3);
const MAX_RETRIES = 3;
const BACKFILL_LIMIT = Number(process.env.MOLIT_BACKFILL_LIMIT ?? 50);
const REQUEST_TIMEOUT_MS = Number(process.env.MOLIT_TIMEOUT_MS ?? 15_000);
const ABORT_AFTER = Number(process.env.MOLIT_ABORT_AFTER ?? 12);
const RETRY_BASE_MS = Number(process.env.MOLIT_RETRY_MS ?? 3000);
const SWEEP_DELAY_MS = Number(process.env.MOLIT_SWEEP_DELAY_MS ?? 45_000);

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function errorDetail(err) {
  const parts = [err?.message ?? String(err)];
  let cause = err?.cause;
  for (let depth = 0; cause && depth < 3; depth += 1) {
    parts.push(cause.code ?? cause.message ?? String(cause));
    cause = cause.cause;
  }
  return parts.filter(Boolean).join(" ← ");
}

async function fetchApiOnce(apiUrl, serviceKey, districtCode, yearMonth) {
  const otherParams = new URLSearchParams({
    LAWD_CD: districtCode,
    DEAL_YMD: yearMonth,
    numOfRows: "9999",
  });
  const url = `${apiUrl}?serviceKey=${serviceKey}&${otherParams.toString()}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser();
  const parsed = parser.parse(xml);

  const header = parsed?.response?.header;
  if (!header) {
    const errMsg = parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg ?? "알 수 없는 응답 형식";
    throw new Error(errMsg);
  }
  if (Number(header.resultCode) !== 0) {
    throw new Error(header.resultMsg ?? `resultCode ${header.resultCode}`);
  }

  const totalCount = Number(parsed?.response?.body?.totalCount);
  const items = parsed?.response?.body?.items?.item;
  return {
    items: items ? (Array.isArray(items) ? items : [items]) : [],
    totalCount: Number.isInteger(totalCount) ? totalCount : null,
  };
}

async function fetchApi(apiUrl, serviceKey, districtCode, yearMonth) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchApiOnce(apiUrl, serviceKey, districtCode, yearMonth);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) await sleep(attempt * RETRY_BASE_MS);
    }
  }
  throw lastErr;
}

async function main() {
  const endpoints = {
    sale: { url: SALE_API_URL, key: SALE_SERVICE_KEY, label: "매매" },
    rent: { url: RENT_API_URL, key: RENT_SERVICE_KEY, label: "전월세" },
  };
  const kinds = Object.keys(endpoints).filter((kind) => endpoints[kind].url && endpoints[kind].key);

  if (kinds.length === 0) {
    console.error("[fetch-realestate] MOLIT_API_KEY/MOLIT_RENT_API_KEY 둘 다 없음, 생략");
    return;
  }

  const now = new Date();
  const observedAt = now.toISOString();

  const plan = planFetch({
    now,
    districts: DISTRICTS,
    kinds,
    slots: await readSlots(),
    backfillLimit: BACKFILL_LIMIT,
  });
  console.log(`[fetch-realestate] 원본 슬롯 ${planSummary(plan)}`);

  let changedSlots = 0;
  let arrived = 0;
  let failedInARow = 0;
  let givenUp = false;

  async function fetchSlot(slot) {
    if (givenUp) return null;

    const { url, key, label } = endpoints[slot.kind];
    try {
      const response = await fetchApi(url, key, slot.code, slot.yearMonth);
      const written = await writeSlotFile(
        buildSlotFile({
          kind: slot.kind,
          code: slot.code,
          yearMonth: slot.yearMonth,
          items: response.items,
          totalCount: response.totalCount,
          observedAt,
        })
      );
      if (written.changed) {
        changedSlots += 1;
        arrived += written.added;
      }
      failedInARow = 0;
      return true;
    } catch (err) {
      console.error(
        `[fetch-realestate] ${districtNames.get(slot.code) ?? slot.code} ${slot.yearMonth} ${label} 조회 실패:` +
          ` ${errorDetail(err)}`
      );
      failedInARow += 1;
      if (failedInARow >= ABORT_AFTER) givenUp = true;
      return false;
    }
  }

  const results = await mapWithConcurrency(plan.fetch, CONCURRENCY, fetchSlot);

  if (givenUp) {
    const skipped = results.filter((result) => result === null).length;
    console.error(
      `[fetch-realestate] ${ABORT_AFTER}개 연속 실패로 중단했습니다.` +
        ` 남은 ${skipped}개 슬롯은 다음 실행에서 받습니다`
    );
  }

  const failedSlots = givenUp ? [] : plan.fetch.filter((_, i) => !results[i]);
  if (failedSlots.length > 0) {
    console.log(
      `[fetch-realestate] ${failedSlots.length}개 슬롯 실패,` +
        ` ${Math.round(SWEEP_DELAY_MS / 1000)}초 쉬고 재시도 스윕 시작`
    );
    await sleep(SWEEP_DELAY_MS);
    const retried = await mapWithConcurrency(failedSlots, CONCURRENCY, fetchSlot);
    const stillFailed = failedSlots.filter((_, j) => !retried[j]);
    if (stillFailed.length > 0) {
      console.error(`[fetch-realestate] 재시도 후에도 실패한 슬롯 ${stillFailed.length}개`);
    } else {
      console.log("[fetch-realestate] 재시도 스윕으로 전부 복구됨");
    }
  }

  for (const slot of plan.expired) {
    await removeSlotFile(slot.kind, slot.code, slot.yearMonth);
  }

  console.log(
    `[fetch-realestate] 원본 저장 — 갱신 ${changedSlots}슬롯 · 새 거래 ${arrived.toLocaleString("ko-KR")}건` +
      (plan.expired.length ? ` · 만료 ${plan.expired.length}슬롯 삭제` : "")
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
