export const DISTRICT_SLUGS = {
  종로구: "jongno",
  중구: "jung",
  용산구: "yongsan",
  성동구: "seongdong",
  광진구: "gwangjin",
  동대문구: "dongdaemun",
  중랑구: "jungnang",
  성북구: "seongbuk",
  강북구: "gangbuk",
  도봉구: "dobong",
  노원구: "nowon",
  은평구: "eunpyeong",
  서대문구: "seodaemun",
  마포구: "mapo",
  양천구: "yangcheon",
  강서구: "gangseo",
  구로구: "guro",
  금천구: "geumcheon",
  영등포구: "yeongdeungpo",
  동작구: "dongjak",
  관악구: "gwanak",
  서초구: "seocho",
  강남구: "gangnam",
  송파구: "songpa",
  강동구: "gangdong",
};

export const districtFile = (slug) => `district-${slug}.html`;

export const districtNameOf = (slug) =>
  Object.keys(DISTRICT_SLUGS).find((name) => DISTRICT_SLUGS[name] === slug) ?? null;

export const DISTRICT_PAGES = Object.entries(DISTRICT_SLUGS).map(([name, slug]) => ({
  name,
  slug,
  file: districtFile(slug),
}));
