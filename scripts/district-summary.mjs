// 자치구 페이지에 그 지역만의 문장을 붙인다.
//
// 25개 페이지가 구조는 같고 숫자만 다르면 크롤러 눈에는 템플릿을 대량으로 찍어낸
// 것으로 보인다(이 계정은 이미 한 번 "가치 없는 콘텐츠"로 지적받은 적이 있다).
// 그렇다고 지역마다 손으로 글을 쓸 수는 없으므로, **그 지역 데이터로만 만들 수 있는
// 문장**을 낸다 - 서울 평균 대비 몇 배인지, 몇 번째인지, 전세가율이 어느 쪽인지,
// 값이 가장 비슷한 구가 어디인지. 숫자가 다르면 문장 구성도 달라진다.
//
// 규칙 하나: 데이터가 말하는 것만 쓴다. "투자 유망" 같은 판단이나 전망은 넣지 않는다.
// 표본이 모자라면 문장을 지어내는 대신 그 사실을 밝힌다.
import {
  areaPrice,
  formatEok,
  formatMan,
  formatPercent,
  jeonseRatio,
  resolveMetric,
  valueOf,
} from "./realestate-format.mjs";

const round1 = (n) => Math.round(n * 10) / 10;

// 자치구 이름은 전부 '구'로 끝나 받침이 없지만, 조사를 고정해두면 나중에 지역 단위가
// 바뀔 때(동·시) 바로 어색해진다. 마지막 글자의 받침을 보고 고른다.
function hasFinalConsonant(word) {
  const code = String(word).charCodeAt(String(word).length - 1) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}
const topicParticle = (word) => (hasFinalConsonant(word) ? "은" : "는");

/** 표본이 충분한 구들 사이에서 매매 평당가 순위(1부터). 못 구하면 null. */
function saleRank(entry, districts) {
  const value = valueOf(resolveMetric(entry, "sale")?.metric, "sale");
  if (!value) return null;

  const priced = districts
    .map((d) => valueOf(resolveMetric(d, "sale")?.metric, "sale"))
    .filter((v) => typeof v === "number");
  if (priced.length < 2) return null;

  return { rank: priced.filter((v) => v > value).length + 1, total: priced.length };
}

/** 매매 평당가가 가장 가까운 다른 구. 페이지마다 다른 문장이 나오게 하는 축이다. */
function nearestDistrict(entry, districts) {
  const value = valueOf(resolveMetric(entry, "sale")?.metric, "sale");
  if (!value) return null;

  let best = null;
  for (const other of districts) {
    if (other.name === entry.name) continue;
    const otherValue = valueOf(resolveMetric(other, "sale")?.metric, "sale");
    if (typeof otherValue !== "number") continue;
    const gap = Math.abs(otherValue - value);
    if (!best || gap < best.gap) best = { name: other.name, value: otherValue, gap };
  }
  return best;
}

/**
 * 자치구 하나에 대한 서술 문장들. 화면과 정적 HTML이 같은 문장을 내야 하므로
 * 문자열 배열로 돌려주고, 감싸는 마크업은 부르는 쪽이 만든다.
 */
export function districtSentences(entry, realestate, locale = "ko") {
  if (!entry) return [];

  const districts = realestate?.districts ?? [];
  const overall = realestate?.overall;
  const en = locale === "en";
  const out = [];

  const sale = resolveMetric(entry, "sale");
  const overallSale = resolveMetric(overall, "sale");

  if (sale) {
    const value = valueOf(sale.metric, "sale");
    const overallValue = valueOf(overallSale?.metric, "sale");
    const ratio = overallValue ? round1(value / overallValue) : null;

    let first = en
      ? `Apartments in ${entry.name} trade at ${formatMan(value, locale)} per pyeong`
      : `${entry.name} 아파트 매매가는 평당 ${formatMan(value, locale)}입니다`;

    if (ratio) {
      // 1.0배는 "같다"고 쓰는 게 자연스럽다.
      const comparison = en
        ? ratio === 1
          ? `, the same as the Seoul average of ${formatMan(overallValue, locale)}`
          : `, ${ratio}× the Seoul average of ${formatMan(overallValue, locale)}`
        : ratio === 1
          ? `. 서울 평균 ${formatMan(overallValue, locale)}과 같은 수준입니다`
          : `. 서울 평균 ${formatMan(overallValue, locale)}의 ${ratio}배입니다`;
      first += comparison;
    }
    out.push(`${first}.`);

    const rank = saleRank(entry, districts);
    if (rank) {
      // 1위·꼴찌를 "1번째로 높습니다"라고 쓰면 사람이 쓴 문장으로 안 읽힌다.
      const ko =
        rank.rank === 1
          ? `신고 건수가 충분한 ${rank.total}개 구 가운데 가장 높습니다.`
          : rank.rank === rank.total
            ? `신고 건수가 충분한 ${rank.total}개 구 가운데 가장 낮습니다.`
            : `신고 건수가 충분한 ${rank.total}개 구 가운데 ${rank.rank}번째로 높습니다.`;
      const suffix = rank.rank === 1 ? "st" : rank.rank === 2 ? "nd" : rank.rank === 3 ? "rd" : "th";
      const eng =
        rank.rank === 1
          ? `That is the highest among the ${rank.total} districts with enough reported transactions.`
          : rank.rank === rank.total
            ? `That is the lowest among the ${rank.total} districts with enough reported transactions.`
            : `That is ${rank.rank}${suffix} among the ${rank.total} districts with enough reported transactions.`;
      out.push(en ? eng : ko);
    }

    out.push(
      en
        ? `For an 84m² unit that works out to about ${formatEok(areaPrice(value), locale)}.`
        : `84㎡(약 25평) 기준으로 환산하면 약 ${formatEok(areaPrice(value), locale)}입니다.`
    );

    const nearest = nearestDistrict(entry, districts);
    if (nearest) {
      out.push(
        en
          ? `The closest district by price is ${nearest.name} at ${formatMan(nearest.value, locale)} per pyeong.`
          : `평당가가 가장 가까운 지역은 ${nearest.name}(${formatMan(nearest.value, locale)})입니다.`
      );
    }
  } else {
    // 값을 못 내는 상태를 문장으로 덮지 않는다. 왜 비어 있는지가 오히려 정보다.
    const reported = entry.sale?.transactionCount ?? 0;
    out.push(
      en
        ? `Only ${reported} apartment sales have been reported in ${entry.name} this month, too few to average.`
        : `${entry.name}${topicParticle(entry.name)} 이번 달 아파트 매매 신고가 ${reported}건뿐이라 평균을 내지 않았습니다.`
    );

    // 매매를 못 내도 전세는 신고가 훨씬 많아 값이 있는 경우가 흔하다. 그것마저
    // 빼면 페이지가 통째로 빈 것처럼 보인다.
    const jeonseOnly = resolveMetric(entry, "jeonse");
    if (jeonseOnly) {
      const deposit = valueOf(jeonseOnly.metric, "jeonse");
      out.push(
        en
          ? `Jeonse deposits average ${formatMan(deposit, locale)} per pyeong, or about ${formatEok(areaPrice(deposit), locale)} for an 84m² unit.`
          : `전세는 평당 보증금 ${formatMan(deposit, locale)}으로, 84㎡ 기준 약 ${formatEok(areaPrice(deposit), locale)}입니다.`
      );
    }
  }

  const ratio = jeonseRatio(entry);
  const overallRatio = overall ? jeonseRatio(overall) : null;
  if (ratio) {
    let sentence = en
      ? `The jeonse ratio is ${formatPercent(ratio.ratio)}`
      : `전세가율은 ${formatPercent(ratio.ratio)}입니다`;

    if (overallRatio) {
      const diff = ratio.ratio - overallRatio.ratio;
      const side = en
        ? Math.abs(diff) < 1
          ? `, close to the Seoul average of ${formatPercent(overallRatio.ratio)}`
          : `, ${diff > 0 ? "above" : "below"} the Seoul average of ${formatPercent(overallRatio.ratio)}`
        : Math.abs(diff) < 1
          ? `. 서울 평균 ${formatPercent(overallRatio.ratio)}과 비슷합니다`
          : `. 서울 평균 ${formatPercent(overallRatio.ratio)}보다 ${diff > 0 ? "높은" : "낮은"} 편입니다`;
      sentence += side;
    }
    out.push(`${sentence}.`);
  }

  const wolse = resolveMetric(entry, "wolse");
  if (wolse) {
    out.push(
      en
        ? `Monthly rentals average a ${formatMan(wolse.metric.avgDeposit10k, locale)} deposit with ${formatMan(wolse.metric.avgMonthlyRent10k, locale)} per month.`
        : `월세는 보증금 ${formatMan(wolse.metric.avgDeposit10k, locale)}에 월 ${formatMan(wolse.metric.avgMonthlyRent10k, locale)} 수준입니다.`
    );
  }

  // 마지막은 이 숫자들이 몇 건에 근거하는지. 표본 크기를 밝히지 않으면 위 문장들이
  // 실제보다 단단해 보인다.
  const counts = ["sale", "jeonse", "wolse"]
    .map((kind) => ({ kind, metric: resolveMetric(entry, kind)?.metric }))
    .filter((c) => c.metric);
  if (counts.length) {
    const labels = { sale: en ? "sales" : "매매", jeonse: en ? "jeonse" : "전세", wolse: en ? "rentals" : "월세" };
    const parts = counts.map((c) =>
      en
        ? `${c.metric.transactionCount.toLocaleString("en-US")} ${labels[c.kind]}`
        : `${labels[c.kind]} ${c.metric.transactionCount.toLocaleString("ko-KR")}건`
    );
    out.push(
      en
        ? `These figures are based on ${parts.join(", ")} reported to the government.`
        : `이 숫자들은 정부에 신고된 ${parts.join(", ")}을 집계한 것입니다.`
    );
  }

  return out;
}
