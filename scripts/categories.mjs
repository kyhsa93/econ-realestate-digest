// 뉴스 카테고리 정의. fetch-news.mjs가 수집 단계에서 기사마다 category(key)를
// 붙이고, summarize-digest.mjs는 그 key를 그대로 재사용해 요약 묶음을 만든다.
// (예전에는 분류 로직이 summarize-digest.mjs 안에만 있어서, 화면의 뉴스 목록과
// AI 요약이 같은 기준으로 묶여 있다는 보장이 없었다.)

export const CATEGORIES = [
  {
    key: "rates",
    name: "금리·예금·투자상품",
    nameEn: "Rates, Deposits & Investment Products",
    keywords: ["금리", "예금", "저축", "IMA", "발행어음", "펀드", "채권", "증권사"],
  },
  {
    key: "realestate",
    name: "부동산",
    nameEn: "Real Estate",
    keywords: ["아파트", "부동산", "전세", "월세", "매물", "분양", "세제", "주택", "재건축", "청약"],
  },
  {
    key: "stocks",
    name: "증시·환율",
    nameEn: "Stocks & FX",
    keywords: ["코스피", "코스닥", "증시", "주가", "환율", "달러", "원화"],
  },
];

export const FALLBACK_CATEGORY = {
  key: "other",
  name: "기타 경제 소식",
  nameEn: "Other Economic News",
  keywords: [],
};

const BY_KEY = new Map([...CATEGORIES, FALLBACK_CATEGORY].map((c) => [c.key, c]));

// 키워드 순서(= CATEGORIES 배열 순서)가 곧 우선순위다. 예를 들어 "주택담보대출
// 금리" 같은 제목은 금리 쪽으로 먼저 걸린다.
export function categorizeTitle(title) {
  return CATEGORIES.find((c) => c.keywords.some((k) => (title ?? "").includes(k))) ?? FALLBACK_CATEGORY;
}

// 기사에 category가 이미 붙어 있으면 그걸 쓰고(수집 시점 분류), 이 필드가 없던
// 시절에 저장된 기사는 제목으로 다시 분류한다.
export function categoryOf(item) {
  return (item.category && BY_KEY.get(item.category)) || categorizeTitle(item.title);
}
