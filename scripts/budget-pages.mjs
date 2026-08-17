export const BUDGET_PAGE_EOK = Array.from({ length: 18 }, (_, i) => i + 3);

export const budgetPageFile = (eok) => `budget-${eok}eok.html`;

export const BUDGET_PAGES = BUDGET_PAGE_EOK.map((eok) => ({
  eok,
  min10k: eok * 10_000,
  file: budgetPageFile(eok),
  title: `${eok}억대로 살 수 있는 서울 아파트 - 최근 실거래`,
  description:
    `예산 ${eok}억대(${eok}억~${eok + 1}억)로 서울에서 실제 거래된 아파트를 모았습니다.` +
    " 국토교통부에 신고된 실거래 자료이며, 단지·전용면적·층·거래일과 거래가 많은 지역을 함께 보여줍니다.",
  titleEn: `Seoul Apartments Around \u20a9${(eok / 10).toFixed(1)}B - Recent Deals`,
}));
