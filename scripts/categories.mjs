
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

export function categorizeTitle(title) {
  return CATEGORIES.find((c) => c.keywords.some((k) => (title ?? "").includes(k))) ?? FALLBACK_CATEGORY;
}

export function categoryOf(item) {
  return (item.category && BY_KEY.get(item.category)) || categorizeTitle(item.title);
}
