// 자치구별 페이지의 주소 조각.
//
// "강남구 아파트 시세"처럼 지역 단위로 검색하는 사람이 많은데, 지금은 25개 구가 한 표에
// 들어 있어서 그 의도로 들어올 착지점이 없다. 거래 유형별 페이지를 만든 것과 같은
// 이유로 구별 페이지를 찍는다.
//
// 로마자 표기는 국어의 로마자 표기법(문화체육관광부 고시)을 따른다 - 서울시가 안내판과
// 지하철역에 쓰는 표기라 검색어와도 맞고, 임의로 지어내면 나중에 바꿀 수 없다(주소가
// 바뀌면 그때까지 쌓인 색인이 날아간다).
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

/** 슬러그로 자치구 이름을 되찾는다. 화면이 meta 값으로 자기 지역을 찾을 때 쓴다. */
export const districtNameOf = (slug) =>
  Object.keys(DISTRICT_SLUGS).find((name) => DISTRICT_SLUGS[name] === slug) ?? null;

export const DISTRICT_PAGES = Object.entries(DISTRICT_SLUGS).map(([name, slug]) => ({
  name,
  slug,
  file: districtFile(slug),
}));
