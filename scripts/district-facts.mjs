/**
 * 자치구 페이지가 서로 다른 이야기를 하게 만드는 관찰들.
 *
 * 시세 문장은 스물다섯 구가 전부 같은 틀이었다. 평당 얼마, 서울 평균의 몇 배, 몇 번째,
 * 84㎡로 환산하면 얼마. 숫자만 바뀌고 문장은 하나였고, 그건 읽는 사람에게도 검색엔진에도
 * 같은 페이지 스물다섯 장이다.
 *
 * 여기서 뽑는 것은 자치구별 전수 거래 파일에 이미 들어 있던 것들이다 — 어느 동에서
 * 거래가 나왔는지, 몇 평짜리인지, 언제 지은 건물인지. 시세표는 이걸 평균 하나로 뭉개
 * 버리는데, 뭉개기 전의 분포가 구마다 완전히 다르다. 노원구는 열 건 중 여섯 건이 60㎡
 * 아래고 준공 30년을 넘긴 단지가 예순네 건 중 하나가 아니라 셋 중 둘이다. 용산구는
 * 85㎡ 넘는 거래가 열 건 중 넷이다. 같은 "평당 얼마"로는 절대 안 나오는 이야기다.
 *
 * **눈에 띄는 것만 말한다.** 이게 이 파일의 전부다. 모든 구에 같은 다섯 문장을 더 붙이면
 * 여섯 문장짜리 틀이 열한 문장짜리 틀이 될 뿐이고, 그러면 아무것도 고쳐지지 않는다.
 * 그래서 관찰마다 문턱이 있고, 문턱을 넘은 것만 문장이 된다 — 한 동에 거래가 몰린 구는
 * 그 이야기를 하고, 고르게 흩어진 구는 흩어졌다는 이야기를 하고, 어느 쪽도 아닌 구는
 * 그 문장을 아예 갖지 않는다.
 */

/**
 * 비중을 말하려면 얼마나 있어야 하는가.
 *
 * 종로구는 석 달 신고가 예순일곱 건이다. 그 위에서 "열 건 중 넷이 대형"이라고 하면
 * 스물일곱 건짜리 이야기가 되고, 한 단지가 입주하면 다음 주에 뒤집힌다. 표본 위에
 * 조건을 얹으면 건수가 거짓말을 한다는 건 실거래 검색에서 이미 한 번 겪은 일이라,
 * 얇은 구는 비중 이야기를 하지 않고 개별 거래만 말한다.
 */
const MIN_DEALS = 120;

/** 소형·대형을 가르는 전용면적. 60과 85는 청약과 세제가 쓰는 선이다. */
const SMALL_AREA = 60;
const LARGE_AREA = 85;

/** 재건축 연한. 신축은 입주장이 시세를 끌어올리는 구간이라 따로 본다. */
const OLD_YEARS = 30;
const NEW_YEARS = 5;

/**
 * 직거래가 이만큼이면 시세를 읽는 방식이 달라진다.
 *
 * 중개를 끼지 않은 거래에는 가족 간 증여성 거래와 시행사–수분양자 정산이 섞인다.
 * 둘 다 시장에서 붙은 값이 아니라서, 비중이 크면 그 구의 평균은 "지금 사면 이 값"이
 * 아니게 된다. 스물다섯 구가 0%에서 41%까지 갈리는데 시세표에는 흔적이 없다.
 */
const DIRECT_HEAVY = 0.1;

const share = (count, total) => (total ? count / total : 0);
const pct = (ratio) => Math.round(ratio * 100);

function counted(items, key) {
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * 거래 목록에서 말할 만한 것을 고른다.
 *
 * 문턱을 넘지 못한 관찰은 `null`이 아니라 아예 키가 없다 — 문장을 만드는 쪽이
 * "있으면 말한다"만 하면 되게.
 */
export function districtFacts(dealFile) {
  const deals = dealFile?.deals ?? [];
  if (!deals.length) return null;

  const facts = { total: deals.length, months: dealFile?.periods?.length ?? null };

  // 가장 비싸게 팔린 것. 이건 문턱이 없다 — 구마다 다른 단지가 나오고, 비중과 달리
  // 표본이 얇아도 거짓말을 하지 않는다. 실제로 그 값에 팔린 한 건이다.
  const top = deals.reduce((a, b) => (b.amount10k > a.amount10k ? b : a));
  facts.top = { dong: top.dong, apt: top.apt, area: top.area, amount10k: top.amount10k };

  if (deals.length < MIN_DEALS) return facts;

  // 어느 동에 몰려 있는가. 한 동이 절반을 가져가는 구가 있고 스물세 개 동에
  // 흩어진 구가 있는데, 시세표에서는 둘 다 "평당 얼마" 한 줄이다.
  const dongs = counted(deals, (d) => d.dong);
  const [topDong, topDongCount] = dongs[0];
  const topDongShare = share(topDongCount, deals.length);
  if (topDongShare >= 0.4) {
    facts.concentrated = { dong: topDong, share: topDongShare, dongs: dongs.length };
  } else if (topDongShare <= 0.2 && dongs.length >= 8) {
    facts.spreadOut = { dongs: dongs.length, share: topDongShare };
  }

  // 어떤 평형이 팔리는가.
  const small = share(deals.filter((d) => d.area < SMALL_AREA).length, deals.length);
  const large = share(deals.filter((d) => d.area > LARGE_AREA).length, deals.length);
  if (small >= 0.55) facts.smallHeavy = { share: small };
  else if (large >= 0.3) facts.largeHeavy = { share: large };

  // 언제 지은 건물이 팔리는가. 30년을 넘긴 거래가 셋 중 둘이면 그 구의 시세는
  // 집값 이야기가 아니라 재건축 이야기다.
  const dated = deals.filter((d) => typeof d.buildYear === "number" && d.buildYear > 0);
  if (dated.length >= MIN_DEALS) {
    const thisYear = new Date(dealFile.updatedAt ?? Date.now()).getUTCFullYear();
    const old = share(dated.filter((d) => thisYear - d.buildYear >= OLD_YEARS).length, dated.length);
    const fresh = share(dated.filter((d) => thisYear - d.buildYear <= NEW_YEARS).length, dated.length);
    if (old >= 0.35) facts.old = { share: old, years: OLD_YEARS };
    else if (fresh >= 0.2) facts.fresh = { share: fresh, years: NEW_YEARS };
  }

  // 한 단지가 구를 대표해 버리는 경우. 대단지 입주장이면 그 구의 평균은 그 단지의
  // 평균에 가깝고, 그건 시세를 읽는 사람이 알아야 하는 사실이다.
  const apts = counted(deals, (d) => `${d.dong}|${d.apt}`);
  const [topAptKey, topAptCount] = apts[0];
  const topAptShare = share(topAptCount, deals.length);
  if (topAptShare >= 0.05) {
    const [dong, apt] = topAptKey.split("|");
    facts.oneComplex = { dong, apt, count: topAptCount, share: topAptShare };
  }

  const direct = share(deals.filter((d) => d.direct).length, deals.length);
  if (direct >= DIRECT_HEAVY) facts.directHeavy = { share: direct };

  // 아무 문턱도 넘지 못한 구.
  //
  // 여기서 문장을 지어내지 않는 것이 이 파일의 규칙인데, 그렇다고 빈손으로 두는 것도
  // 맞지 않다. 튀는 데가 없다는 것 자체가 사실이고, "서울 평균에 가까운 동네를 찾고
  // 있다"는 사람에게는 그게 답이기 때문이다. 그래서 지어내는 대신 무엇을 재고서 그런
  // 말을 하는지를 밝힌다 — 문턱을 넘은 게 하나라도 있으면 이 문장은 나오지 않는다.
  const notable = ["concentrated", "spreadOut", "smallHeavy", "largeHeavy", "old", "fresh", "oneComplex", "directHeavy"];
  if (!notable.some((k) => facts[k])) facts.typical = true;

  return facts;
}

/** 억 단위로 읽는 금액. 시세 문장이 쓰는 형식과 같게 맞춘다. */
function eok(amount10k, en) {
  const value = amount10k / 10000;
  const text = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return en ? `₩${text}00M` : `${text}억원`;
}

const area = (value) => `${Number(value).toFixed(0)}㎡`;

/**
 * 고른 관찰을 문장으로.
 *
 * 창(窓)을 먼저 밝히고 시작한다. 시세표는 최근 네 주 계약분이고 여기 숫자는 석 달
 * 신고분이라, 두 숫자가 어긋나 보일 때 어느 쪽이 무엇인지 읽는 사람이 알 수 있어야 한다.
 */
export function factSentences(facts, locale = "ko") {
  if (!facts) return [];
  const en = locale === "en";
  const out = [];
  const n = facts.total.toLocaleString(en ? "en-US" : "ko-KR");

  const wide = facts.concentrated || facts.spreadOut || facts.smallHeavy || facts.largeHeavy ||
    facts.old || facts.fresh || facts.oneComplex || facts.directHeavy || facts.typical;
  if (wide) {
    const months = facts.months ?? 3;
    out.push(
      en
        ? `Looking at all ${n} transactions reported over the past ${months} months rather than the four-week average above:`
        : `위 시세표의 최근 네 주가 아니라, 최근 ${months}개월 동안 신고된 ${n}건을 전부 놓고 보면 이렇습니다.`
    );
  }

  if (facts.concentrated) {
    const { dong, share: s, dongs } = facts.concentrated;
    out.push(
      en
        ? `${pct(s)}% of them are in ${dong} alone, out of ${dongs} neighbourhoods with any sales at all — the district average is largely that one neighbourhood's average.`
        : `그 가운데 ${pct(s)}%가 ${dong} 한 곳에서 나왔습니다. 거래가 잡힌 동이 ${dongs}곳인데도 그렇습니다 — 이 구의 평균은 사실상 ${dong} 평균에 가깝습니다.`
    );
  } else if (facts.spreadOut) {
    const { dongs, share: s } = facts.spreadOut;
    out.push(
      en
        ? `They are spread across ${dongs} neighbourhoods with no single one above ${pct(s)}%, so the district average is an average of genuinely different places.`
        : `${dongs}개 동에 흩어져 있고 한 동이 ${pct(s)}%를 넘지 않습니다. 이 구의 평균은 서로 다른 동네를 실제로 평균 낸 값입니다.`
    );
  }

  if (facts.smallHeavy) {
    out.push(
      en
        ? `${pct(facts.smallHeavy.share)}% are under ${SMALL_AREA}m², so what trades here is mostly small units.`
        : `전용 ${SMALL_AREA}㎡ 미만이 ${pct(facts.smallHeavy.share)}%입니다. 이 동네에서 팔리는 것은 대부분 소형입니다.`
    );
  } else if (facts.largeHeavy) {
    out.push(
      en
        ? `${pct(facts.largeHeavy.share)}% are over ${LARGE_AREA}m², a large-unit share few districts match.`
        : `전용 ${LARGE_AREA}㎡ 초과가 ${pct(facts.largeHeavy.share)}%입니다. 대형 비중이 이만큼 높은 구는 많지 않습니다.`
    );
  }

  if (facts.old) {
    out.push(
      en
        ? `${pct(facts.old.share)}% are in buildings at least ${facts.old.years} years old — at that share the price here is being set by redevelopment expectations as much as by the flats themselves.`
        : `준공 ${facts.old.years}년을 넘긴 단지가 ${pct(facts.old.share)}%입니다. 이 정도면 이 구의 시세는 집 자체보다 재건축 기대가 만드는 값에 가깝습니다.`
    );
  } else if (facts.fresh) {
    out.push(
      en
        ? `${pct(facts.fresh.share)}% are in buildings under ${facts.fresh.years} years old, so recent move-ins are carrying the average.`
        : `준공 ${facts.fresh.years}년 이내 단지가 ${pct(facts.fresh.share)}%입니다. 최근 입주 물량이 평균을 끌고 있습니다.`
    );
  }

  if (facts.oneComplex) {
    const { dong, apt, count, share: s } = facts.oneComplex;
    out.push(
      en
        ? `A single complex, ${apt} in ${dong}, accounts for ${count} of them (${pct(s)}%).`
        : `한 단지가 유독 많이 팔렸습니다 — ${dong} ${apt} ${count}건으로 전체의 ${pct(s)}%입니다.`
    );
  }

  if (facts.directHeavy) {
    out.push(
      en
        ? `${pct(facts.directHeavy.share)}% were direct deals with no agent involved — those include family transfers and developer settlements, which are not prices the open market set, so read the district average with that in mind.`
        : `중개를 끼지 않은 직거래가 ${pct(facts.directHeavy.share)}%입니다. 직거래에는 가족 간 증여성 거래와 시행사 정산이 섞이는데 둘 다 시장에서 붙은 값이 아니라, 이 구의 평균은 "지금 사면 이 값"과 거리가 있을 수 있습니다.`
    );
  }

  if (facts.typical) {
    out.push(
      en
        ? `Nothing here stands out: no single neighbourhood dominates, the mix of unit sizes and building ages sits near the Seoul middle, and no one complex or direct-deal cluster is moving the average. If you are looking for a district that reads like Seoul itself, this is one of them.`
        : `튀는 데가 없습니다. 한 동이 거래를 가져가지도, 평형이나 연식이 한쪽으로 쏠리지도, 한 단지나 직거래가 평균을 흔들지도 않았습니다 — 넷 다 서울 중간에 가깝습니다. 서울 평균에 가까운 동네를 찾고 있다면 이런 구가 그것입니다.`
    );
  }

  if (facts.top) {
    const { dong, apt, area: size, amount10k } = facts.top;
    out.push(
      en
        ? `The highest price in the period was ${eok(amount10k, en)} for a ${area(size)} unit at ${apt} in ${dong}.`
        : `기간 중 가장 비싸게 팔린 것은 ${dong} ${apt} ${area(size)}로 ${eok(amount10k, en)}입니다.`
    );
  }

  return out;
}
