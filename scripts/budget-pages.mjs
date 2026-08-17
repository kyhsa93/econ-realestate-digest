// 예산 구간 페이지의 주소와 제목.
//
// 구간 목록은 데이터가 아니라 여기 고정으로 둔다. 그날 거래에 따라 페이지가 생겼다
// 사라지면 색인된 주소가 404가 된다 - 한 번 만든 주소는 유지해야 한다.
//
// 3억~20억. 서울 아파트 거래가 실제로 두껍게 쌓이는 구간이고, 이 범위 밖은 검색도
// 거래도 드물어 페이지를 세워봐야 빈 화면이 된다.
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
