// 기사 옆에 이 사이트가 직접 모은 수치를 붙인다.
//
// 제목과 링크만 나열하면 포털 뉴스 목록과 다를 게 없다. 이 저장소는 국토부 실거래가와
// 금감원 예·적금·대출 금리를 매일 받아두고 있으므로, "송파 9억대 아파트" 기사 옆에
// 송파구 실거래 평당가를, "가계부채 2천조" 기사 옆에 지금 주택담보대출 최저금리를
// 같이 보여줄 수 있다. 링크가 전부 바깥으로 나가던 목록에서 우리 페이지로 돌아오는
// 길도 이걸로 생긴다.
//
// **코스피·환율·기준금리는 붙이지 않는다.** 한때 붙였다가 뺐다. 그 기사들은 지수를
// 제목에 이미 달고 있어서("[외환] 원/달러 환율 2.3원 오른 1,418.4원") 같은 숫자를
// 반복할 뿐이고, 하루 4회 갱신인 우리 값이 기사보다 낡아 보이기까지 했다. 게다가
// 지수는 어느 기사에나 같은 값이 붙어서 "이 기사에만 해당하는 수치"가 아니었고,
// 뉴욕·홍콩 증시 기사를 걸러내려고 해외/국내 시장 판별 규칙까지 달고 있어야 했다.
// 지역 시세와 상품 금리만 남기면 기사에 없는 정보만 남는다.
//
// 매칭 결과는 news.json의 item.context에 값까지 박아 넣는다. 화면에서 계산하지 않는
// 이유는 rates.json이 570KB라서다 - 뉴스 페이지가 그걸 받게 할 수는 없다. 대신
// 뉴스가 갱신될 때마다(하루 4회) 최신 데이터로 다시 계산하므로 값이 묵지 않는다.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICT_SLUGS, districtFile } from "./district-slugs.mjs";
import { MIN_SAMPLE } from "./prerender.mjs";

// 한 기사에 두 개까지만. 세 개부터는 기사 제목보다 수치가 눈에 먼저 들어온다.
const MAX_CONTEXT = 2;

// 자치구 이름이 나왔다고 다 부동산 기사는 아니다("강남 살인사건"). 부동산을 가리키는
// 말이 같이 있을 때만 평당가를 붙인다.
//
// '매물'은 넣으면 안 된다 - 증시 기사가 "차익 실현 매물", "이익확정 매물"로 쓴다.
// 실제로 홍콩·대만 증시 기사에 서울 아파트 평당가가 붙었다(과거 뉴스 대조로 발견).
const REALESTATE_HINTS = [
  "아파트", "전세", "월세", "집값", "분양", "재건축", "재개발", "주택", "매매",
  "시세", "청약", "입주", "빌라", "오피스텔", "보증금", "임대", "실거래",
  "평당", "㎡", "정비사업", "전셋값",
];

// 뉴시스·연합뉴스는 본문 첫머리에 "[서울=뉴시스] 김승민 기자 ="처럼 발신지를 적는다.
// 이 '서울'은 기사 내용과 아무 상관이 없는데, 그대로 두면 홍콩 증시 기사가 서울
// 부동산 기사로 둔갑한다. 매칭 전에 떼어낸다.
const BYLINE = /[([][^)\]]{1,12}=[^)\]]{1,15}[)\]]/g;


// 앞에 있는 규칙이 이긴다. "전세대출"은 "대출"보다, "정기예금"은 "예금"보다 먼저 봐야 한다.
const RATE_RULES = [
  {
    key: "rentLoan",
    href: "./rent-loan-rates.html",
    // 이주비 대출은 이름에 '전세'가 없고 성격도 담보대출이라 아래 mortgage 쪽이다.
    words: ["전세대출", "전세 대출", "전세자금"],
    label: "전세자금대출 최저금리",
    labelEn: "Lowest jeonse loan rate",
  },
  {
    key: "mortgage",
    href: "./mortgage-rates.html",
    words: [
      "주택담보대출", "주담대", "모기지", "집단대출", "중도금", "잔금대출",
      "보금자리론", "디딤돌", "가계대출", "가계부채", "대출여력", "대출 규제", "대출규제",
      "대출 총량", "대출총량", "깡통대출", "이주비",
    ],
    label: "주택담보대출 최저금리",
    labelEn: "Lowest mortgage rate",
  },
  {
    key: "deposit",
    href: "./deposit-rates.html",
    words: ["정기예금", "예금"],
    label: "정기예금 최고금리(12개월)",
    labelEn: "Top 12-month deposit rate",
  },
  {
    key: "saving",
    href: "./saving-rates.html",
    words: ["적금", "저축"],
    label: "적금 최고금리(12개월)",
    labelEn: "Top 12-month savings rate",
  },
];


// 예·적금은 12개월 상품끼리 비교한다(금리 페이지 화면과 같은 기준).
const SAVING_TERM = 12;
const SAVING_CATEGORIES = new Set(["deposit", "saving"]);

// 칩을 누른 사람이 도착해야 할 곳은 "그 칩에 적힌 수치가 주인공인 페이지"다.
// 한동안 전부 메인의 시세 표(#realestate-section)로 보냈는데, 그 표는 서울 전체와
// 상위 10개 구만 담고 있어서 "노원구 평당가" 칩을 누르면 노원구가 없는 표에
// 도착했다. 자치구 페이지 25개와 거래 유형별 페이지 3개를 이미 찍고 있으므로
// 칩이 가리키는 지역·유형 그대로 보낸다.
const OVERALL_HREF = {
  sale: "./apartment-sale.html",
  jeonse: "./apartment-jeonse.html",
  wolse: "./apartment-rent.html",
};

// 자치구 페이지는 한 지역의 매매·전세·월세를 한 화면에 담으므로 유형과 무관하게 하나다.
// 슬러그가 없는 이름(데이터에 새 지역이 생긴 경우)은 유형별 페이지로 보낸다.
const hrefFor = (slug, kind) =>
  slug ? `./${districtFile(slug)}` : OVERALL_HREF[kind] ?? OVERALL_HREF.sale;

const hasAny = (text, words) => words.some((word) => text.includes(word));

// index.html의 formatPyeongPrice와 같은 표기. 한 화면에서 같은 수치가 다른 모양으로
// 보이면 어느 쪽이 맞는지 읽는 사람이 판단해야 한다.
const pyeongKo = (value10k) => `${Math.round(value10k).toLocaleString("ko-KR")}만원/평`;
const pyeongEn = (value10k) =>
  `₩${(value10k / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}M/pyeong`;

const percentKo = (value) => `연 ${value.toFixed(2)}%`;
const percentEn = (value) => `${value.toFixed(2)}% p.a.`;

const enoughSample = (metric) => Boolean(metric) && (metric.transactionCount ?? 0) >= MIN_SAMPLE;

export function articleText(item) {
  return `${item?.title ?? ""} ${item?.preview ?? ""}`.replace(BYLINE, " ");
}

// 자치구는 데이터에 있는 이름만 쓴다. "송파구"라고 쓴 기사보다 "송파 9억대 아파트"처럼
// '구'를 떼고 쓰는 기사가 더 많아서 짧은 형태도 같이 본다. 다만 '중구'는 짧게 만들면
// 한 글자('중')라 아무 문장에나 걸리므로 두 글자 이상만 허용한다.
export function findDistrict(text, districts = []) {
  for (const district of districts) {
    const name = district?.name ?? "";
    if (!name) continue;
    const short = name.endsWith("구") ? name.slice(0, -1) : name;
    if (text.includes(name)) return district;
    if (short.length >= 2 && text.includes(short)) return district;
  }
  return null;
}

// 기사가 전세 얘기면 전세 시세를, 월세 얘기면 월세를 붙인다. 매매 평당가를 기본으로
// 두되 기사 맥락과 다른 지표를 들이미는 건 오히려 방해가 된다.
//
// 값은 전부 국토부 아파트 실거래 신고분이라, 빌라·오피스텔 기사에 붙어도 오해가
// 없도록 라벨에 '아파트'를 반드시 남긴다.
function realestateEntry(entry, name, nameEn, text, slug) {
  const wantsJeonse = text.includes("전세") || text.includes("전셋값");
  const wantsWolse = text.includes("월세") || text.includes("임대료");

  const candidates = [];
  if (wantsJeonse) candidates.push("jeonse");
  if (wantsWolse) candidates.push("wolse");
  candidates.push("sale", "jeonse");

  for (const kind of candidates) {
    const metric = entry?.[kind];
    if (!enoughSample(metric)) continue;

    if (kind === "sale" && metric.avgPricePerPyeong10k) {
      return {
        kind: "realestate",
        label: `${name} 아파트 매매`,
        labelEn: `${nameEn} apartment sale`,
        value: pyeongKo(metric.avgPricePerPyeong10k),
        valueEn: pyeongEn(metric.avgPricePerPyeong10k),
        href: hrefFor(slug, "sale"),
      };
    }
    if (kind === "jeonse" && metric.avgDepositPerPyeong10k) {
      return {
        kind: "realestate",
        label: `${name} 아파트 전세`,
        labelEn: `${nameEn} apartment jeonse`,
        value: pyeongKo(metric.avgDepositPerPyeong10k),
        valueEn: pyeongEn(metric.avgDepositPerPyeong10k),
        href: hrefFor(slug, "jeonse"),
      };
    }
    if (kind === "wolse" && metric.avgMonthlyRent10k) {
      const deposit = Math.round(metric.avgDeposit10k ?? 0).toLocaleString("ko-KR");
      const rent = Math.round(metric.avgMonthlyRent10k).toLocaleString("ko-KR");
      return {
        kind: "realestate",
        label: `${name} 아파트 월세`,
        labelEn: `${nameEn} apartment rent`,
        value: `보증금 ${deposit}만원 / 월 ${rent}만원`,
        valueEn: `₩${((metric.avgDeposit10k ?? 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}M + ₩${(metric.avgMonthlyRent10k / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}M/mo`,
        href: hrefFor(slug, "wolse"),
      };
    }
  }
  return null;
}

// 자치구를 짚은 기사가 가장 좋지만, "서울 월세 1000만원 흔해질 것"처럼 서울 전체를
// 두고 쓰는 기사가 더 많다. 그런 기사엔 서울 전체 평균을 붙인다 - 기사의 주장 옆에
// 실제 신고가가 나란히 놓이는 게 이 화면이 포털과 갈리는 지점이다.
function realestateContext(text, realestate) {
  if (!hasAny(text, REALESTATE_HINTS)) return null;

  const district = findDistrict(text, realestate?.districts);
  if (district) {
    const slug = DISTRICT_SLUGS[district.name] ?? null;
    return realestateEntry(district, district.name, district.name, text, slug);
  }
  if (text.includes("서울")) return realestateEntry(realestate?.overall, "서울 전체", "Seoul", text, null);
  return null;
}

// 금리 페이지가 상품을 줄 세우는 기준과 같아야 한다 - 예적금은 12개월 최고금리,
// 대출은 최저금리. 여기 값과 링크를 눌러 도착한 표의 맨 윗줄이 다르면 안 된다.
export function bestRate(rates, key) {
  const products = rates?.[key] ?? [];
  const saving = SAVING_CATEGORIES.has(key);
  let best = null;

  for (const product of products) {
    for (const option of product.options ?? []) {
      if (saving && option.term !== SAVING_TERM) continue;
      const value = saving ? option.maxRate ?? option.rate : option.min;
      if (typeof value !== "number") continue;
      if (best === null || (saving ? value > best : value < best)) best = value;
    }
  }
  return best;
}

function ratesContext(text, rates) {
  for (const rule of RATE_RULES) {
    if (!hasAny(text, rule.words)) continue;
    const value = bestRate(rates, rule.key);
    if (value === null) continue;
    return {
      kind: "rates",
      label: rule.label,
      labelEn: rule.labelEn,
      value: percentKo(value),
      valueEn: percentEn(value),
      href: rule.href,
    };
  }
  return null;
}

// 지역 시세가 가장 구체적이고, 그다음이 지금 팔리는 금리다.
export function buildContext(item, { realestate, rates } = {}) {
  const text = articleText(item);
  if (!text.trim()) return [];

  return [realestateContext(text, realestate), ratesContext(text, rates)]
    .filter(Boolean)
    .slice(0, MAX_CONTEXT);
}

// context가 하나도 없는 기사는 필드 자체를 넣지 않는다. 빈 배열을 넣으면 news.json이
// 기사 수만큼 불어나기만 하고 화면에서 달라지는 게 없다.
export function attachContext(news, data) {
  const items = (news?.items ?? []).map((item) => {
    const { context: _drop, ...rest } = item;
    const context = buildContext(item, data);
    return context.length ? { ...rest, context } : rest;
  });
  return { ...news, items };
}

const dataDir = path.resolve(import.meta.dirname, "../docs/data");

// 데이터가 없어도 뉴스 갱신 자체를 막지는 않는다. 한 종류가 빠지면 그 종류의
// 수치만 안 붙는다.
async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, `${name}.json`), "utf8"));
  } catch {
    console.warn(`  ${name}.json을 읽지 못했습니다 - 이 데이터는 기사에 붙이지 않습니다`);
    return null;
  }
}

async function main() {
  const newsFile = path.join(dataDir, "news.json");
  const [news, realestate, rates] = await Promise.all([
    readFile(newsFile, "utf8").then(JSON.parse),
    readJson("realestate"),
    readJson("rates"),
  ]);

  const next = attachContext(news, { realestate, rates });
  const counts = { realestate: 0, rates: 0 };
  let matched = 0;
  for (const item of next.items) {
    if (!item.context?.length) continue;
    matched += 1;
    for (const c of item.context) counts[c.kind] += 1;
  }

  await writeFile(newsFile, JSON.stringify(next, null, 2));
  // 아무 기사에도 안 붙는 상태는 화면상 예전과 똑같아서 눈으로는 못 알아챈다.
  console.log(
    `  기사 ${next.items.length}건 중 ${matched}건에 수치를 붙였습니다` +
      ` (실거래가 ${counts.realestate} · 금리 ${counts.rates})`
  );
  if (next.items.length && !matched) {
    console.warn("  경고: 한 건도 붙지 않았습니다. 데이터 파일이 비었는지 확인해주세요");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`뉴스 수치 연결 실패: ${err.message}`);
    process.exit(1);
  });
}
