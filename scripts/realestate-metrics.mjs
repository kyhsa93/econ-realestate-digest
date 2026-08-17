const PYEONG_M2 = 3.3058;
const NATIONAL_PYEONG_MIN_M2 = 82;
const NATIONAL_PYEONG_MAX_M2 = 86;

export function kstDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

function parseWon10k(value) {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function filterByArea(items, minArea, maxArea) {
  return items.filter((item) => {
    const area = Number(item.excluUseAr);
    return Number.isFinite(area) && area >= minArea && area <= maxArea;
  });
}

function weightedAverage(list, getValue, getWeight) {
  let totalWeighted = 0;
  let totalWeight = 0;
  for (const item of list) {
    const v = getValue(item);
    const w = getWeight(item);
    if (v == null || !w) continue;
    totalWeighted += v * w;
    totalWeight += w;
  }
  return totalWeight ? totalWeighted / totalWeight : null;
}

export function isCancelledDeal(item) {
  const filled = (value) => String(value ?? "").trim().length > 0;
  return filled(item?.cdealType) || filled(item?.cdealDay);
}

export function dropCancelled(items) {
  return items.filter((item) => !isCancelledDeal(item));
}

export function dealingDirect(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text === "직거래";
}

function commonDealFields(item, districtName) {
  const area = Number(item?.excluUseAr);
  const apt = String(item?.aptNm ?? "").trim();
  const year = Number(item?.dealYear);
  const month = Number(item?.dealMonth);
  const day = Number(item?.dealDay);

  if (!apt) return null;
  if (!Number.isFinite(area) || area <= 0) return null;
  const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (!inRange(year, 1900, 2999) || !inRange(month, 1, 12) || !inRange(day, 1, 31)) return null;

  const floor = Number(item?.floor);
  const buildYear = Number(item?.buildYear);

  return {
    district: districtName,
    dong: String(item?.umdNm ?? "").trim(),
    apt,
    area: Math.round(area * 100) / 100,
    floor: Number.isFinite(floor) && floor > 0 ? floor : null,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    buildYear: Number.isInteger(buildYear) && buildYear > 1900 ? buildYear : null,
  };
}

export function normalizeDeal(item, districtName) {
  const amount10k = parseWon10k(item?.dealAmount);
  if (amount10k == null || amount10k <= 0) return null;

  const common = commonDealFields(item, districtName);
  if (!common) return null;

  const direct = dealingDirect(item?.dealingGbn);
  const { date, buildYear, ...rest } = common;

  return {
    ...rest,
    amount10k,
    date,
    buildYear,
    ...(direct === null ? {} : { direct }),
  };
}

export function contractRenewal(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text === "갱신";
}

export function normalizeRentDeal(item, districtName) {
  const deposit10k = parseWon10k(item?.deposit);
  if (deposit10k == null || deposit10k <= 0) return null;

  const common = commonDealFields(item, districtName);
  if (!common) return null;

  const monthlyRent10k = parseWon10k(item?.monthlyRent) ?? 0;
  const renewal = contractRenewal(item?.contractType);
  const { date, buildYear, ...rest } = common;

  return {
    ...rest,
    deposit10k,
    ...(monthlyRent10k > 0 ? { monthlyRent10k } : {}),
    date,
    buildYear,
    ...(renewal === null ? {} : { renewal }),
  };
}

function summarizeSale(items) {
  let totalAmountWon = 0;
  let totalArea = 0;
  let count = 0;

  for (const item of items) {
    const amount10k = parseWon10k(item.dealAmount);
    const area = Number(item.excluUseAr);
    if (amount10k == null || amount10k <= 0 || !Number.isFinite(area) || area <= 0) continue;
    totalAmountWon += amount10k * 10_000;
    totalArea += area;
    count += 1;
  }

  if (count === 0 || totalArea === 0) return null;

  const avgPricePerM2 = totalAmountWon / totalArea;
  return {
    avgPricePerM2,
    avgPricePerPyeong10k: Math.round((avgPricePerM2 * PYEONG_M2) / 10_000),
    transactionCount: count,
  };
}

export function isRenewalContract(item) {
  return contractRenewal(item?.contractType) === true;
}

export function summarizeRent(items) {
  const jeonseRows = [];
  const wolseRows = [];
  let renewalCount = 0;

  for (const item of items) {
    if (isRenewalContract(item)) {
      renewalCount += 1;
      continue;
    }

    const deposit10k = parseWon10k(item.deposit);
    const monthlyRent10k = parseWon10k(item.monthlyRent);
    const area = Number(item.excluUseAr);
    if (deposit10k == null || deposit10k <= 0 || !Number.isFinite(area) || area <= 0) continue;

    if (monthlyRent10k && monthlyRent10k > 0) {
      wolseRows.push({ deposit10k, monthlyRent10k });
    } else {
      jeonseRows.push({ deposit10k, area });
    }
  }

  let jeonse = null;
  if (jeonseRows.length > 0) {
    const totalDepositWon = jeonseRows.reduce((sum, r) => sum + r.deposit10k * 10_000, 0);
    const totalArea = jeonseRows.reduce((sum, r) => sum + r.area, 0);
    const avgDepositPerM2 = totalDepositWon / totalArea;
    jeonse = {
      avgDepositPerM2,
      avgDepositPerPyeong10k: Math.round((avgDepositPerM2 * PYEONG_M2) / 10_000),
      transactionCount: jeonseRows.length,
    };
  }

  let wolse = null;
  if (wolseRows.length > 0) {
    wolse = {
      avgDeposit10k: Math.round(wolseRows.reduce((sum, r) => sum + r.deposit10k, 0) / wolseRows.length),
      avgMonthlyRent10k: Math.round(wolseRows.reduce((sum, r) => sum + r.monthlyRent10k, 0) / wolseRows.length),
      transactionCount: wolseRows.length,
    };
  }

  return { jeonse, wolse, renewalCount };
}

export function summarizeSaleItems(all) {
  const items = dropCancelled(all);
  return {
    sale: summarizeSale(items),
    saleNational84: summarizeSale(filterByArea(items, NATIONAL_PYEONG_MIN_M2, NATIONAL_PYEONG_MAX_M2)),
    items,
    cancelledCount: all.length - items.length,
  };
}

export function computeOverall(districts) {
  const saleDistricts = districts.filter((d) => d.sale);
  const overallSaleAvgM2 = weightedAverage(saleDistricts, (d) => d.sale.avgPricePerM2, (d) => d.sale.transactionCount);
  const overallSale =
    overallSaleAvgM2 == null
      ? null
      : {
          avgPricePerM2: overallSaleAvgM2,
          avgPricePerPyeong10k: Math.round((overallSaleAvgM2 * PYEONG_M2) / 10_000),
          transactionCount: saleDistricts.reduce((sum, d) => sum + d.sale.transactionCount, 0),
        };

  const saleNational84Districts = districts.filter((d) => d.saleNational84);
  const overallSaleNational84AvgM2 = weightedAverage(
    saleNational84Districts,
    (d) => d.saleNational84.avgPricePerM2,
    (d) => d.saleNational84.transactionCount
  );
  const overallSaleNational84 =
    overallSaleNational84AvgM2 == null
      ? null
      : {
          avgPricePerM2: overallSaleNational84AvgM2,
          avgPricePerPyeong10k: Math.round((overallSaleNational84AvgM2 * PYEONG_M2) / 10_000),
          transactionCount: saleNational84Districts.reduce((sum, d) => sum + d.saleNational84.transactionCount, 0),
        };

  const jeonseDistricts = districts.filter((d) => d.jeonse);
  const overallJeonseAvgM2 = weightedAverage(
    jeonseDistricts,
    (d) => d.jeonse.avgDepositPerM2,
    (d) => d.jeonse.transactionCount
  );
  const overallJeonse =
    overallJeonseAvgM2 == null
      ? null
      : {
          avgDepositPerM2: overallJeonseAvgM2,
          avgDepositPerPyeong10k: Math.round((overallJeonseAvgM2 * PYEONG_M2) / 10_000),
          transactionCount: jeonseDistricts.reduce((sum, d) => sum + d.jeonse.transactionCount, 0),
        };

  const wolseDistricts = districts.filter((d) => d.wolse);
  const overallWolse =
    wolseDistricts.length === 0
      ? null
      : {
          avgDeposit10k: Math.round(
            weightedAverage(wolseDistricts, (d) => d.wolse.avgDeposit10k, (d) => d.wolse.transactionCount)
          ),
          avgMonthlyRent10k: Math.round(
            weightedAverage(wolseDistricts, (d) => d.wolse.avgMonthlyRent10k, (d) => d.wolse.transactionCount)
          ),
          transactionCount: wolseDistricts.reduce((sum, d) => sum + d.wolse.transactionCount, 0),
        };

  return { sale: overallSale, saleNational84: overallSaleNational84, jeonse: overallJeonse, wolse: overallWolse };
}

export function findBaseline(history, now, period) {
  const target = new Date(now);
  target.setDate(target.getDate() - 7);
  const targetDate = kstDateString(target);

  const older = history.filter((h) => h.period === period && h.date <= targetDate);
  if (!older.length) return null;

  const baseline = older[older.length - 1];
  return baseline.date === kstDateString(now) ? null : baseline;
}

function computeChange(currentValue, baselineValue) {
  if (currentValue == null || baselineValue == null) return null;
  const value10kDiff = currentValue - baselineValue;
  const percent = baselineValue !== 0 ? (value10kDiff / baselineValue) * 100 : null;
  return { value10k: value10kDiff, percent };
}

function withSaleChange(sale, baselineSale, baselineDate) {
  if (!sale) return sale;
  const change = computeChange(sale.avgPricePerPyeong10k, baselineSale?.avgPricePerPyeong10k);
  return change ? { ...sale, change, baselineDate } : sale;
}

function withJeonseChange(jeonse, baselineJeonse, baselineDate) {
  if (!jeonse) return jeonse;
  const change = computeChange(jeonse.avgDepositPerPyeong10k, baselineJeonse?.avgDepositPerPyeong10k);
  return change ? { ...jeonse, change, baselineDate } : jeonse;
}

function withWolseChange(wolse, baselineWolse, baselineDate) {
  if (!wolse) return wolse;
  const depositChange = computeChange(wolse.avgDeposit10k, baselineWolse?.avgDeposit10k);
  const monthlyRentChange = computeChange(wolse.avgMonthlyRent10k, baselineWolse?.avgMonthlyRent10k);
  if (!depositChange && !monthlyRentChange) return wolse;
  return { ...wolse, depositChange, monthlyRentChange, baselineDate };
}

export function attachChanges(overall, districts, baseline) {
  const baselineDate = baseline?.date;
  const findBaselineDistrict = (code) => baseline?.districts?.find((d) => d.code === code);

  return {
    overall: {
      sale: withSaleChange(overall.sale, baseline?.overall?.sale, baselineDate),
      saleNational84: withSaleChange(overall.saleNational84, baseline?.overall?.saleNational84, baselineDate),
      jeonse: withJeonseChange(overall.jeonse, baseline?.overall?.jeonse, baselineDate),
      wolse: withWolseChange(overall.wolse, baseline?.overall?.wolse, baselineDate),
    },
    districts: districts.map((d) => {
      const b = findBaselineDistrict(d.code);
      return {
        ...d,
        sale: withSaleChange(d.sale, b?.sale, baselineDate),
        saleNational84: withSaleChange(d.saleNational84, b?.saleNational84, baselineDate),
        jeonse: withJeonseChange(d.jeonse, b?.jeonse, baselineDate),
        wolse: withWolseChange(d.wolse, b?.wolse, baselineDate),
      };
    }),
  };
}

export function carryForward(allDistricts, fetched, existing, existingIsToday) {
  const fetchedByCode = new Map((fetched ?? []).map((d) => [d.code, d]));
  const existingByCode = new Map((existing?.districts ?? []).map((d) => [d.code, d]));

  const districts = [];
  const carriedNames = [];

  for (const { code, name } of allDistricts) {
    const fresh = fetchedByCode.get(code);
    if (fresh) {
      districts.push(fresh);
      continue;
    }

    const old = existingByCode.get(code);
    if (!old) continue;

    if (existingIsToday) {
      districts.push(old);
      continue;
    }

    districts.push({ ...old, staleAt: old.staleAt ?? existing.updatedAt });
    carriedNames.push(name);
  }

  return { districts, carriedNames };
}

export function fetchSummary(districts) {
  const countOf = (key) => (districts ?? []).filter((d) => d?.[key]).length;
  return `매매 ${countOf("sale")}개구, 전세 ${countOf("jeonse")}개구, 월세 ${countOf("wolse")}개구`;
}
