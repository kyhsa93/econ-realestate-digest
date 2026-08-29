import { spreadSentence } from "./complex-ratio.mjs";
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

function hasFinalConsonant(word) {
  const code = String(word).charCodeAt(String(word).length - 1) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}
const topicParticle = (word) => (hasFinalConsonant(word) ? "은" : "는");

function saleRank(entry, districts) {
  const value = valueOf(resolveMetric(entry, "sale")?.metric, "sale");
  if (!value) return null;

  const priced = districts
    .map((d) => valueOf(resolveMetric(d, "sale")?.metric, "sale"))
    .filter((v) => typeof v === "number");
  if (priced.length < 2) return null;

  return { rank: priced.filter((v) => v > value).length + 1, total: priced.length };
}

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

export function districtSentences(entry, realestate, locale = "ko", spread = null) {
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
    const reported = entry.sale?.transactionCount ?? 0;
    out.push(
      en
        ? `Only ${reported} apartment sales have been reported in ${entry.name} this month, too few to average.`
        : `${entry.name}${topicParticle(entry.name)} 이번 달 아파트 매매 신고가 ${reported}건뿐이라 평균을 내지 않았습니다.`
    );

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

    // 자치구 값은 구 전체 평균 둘을 나눈 것이라 어느 단지의 전세가율도 아닐 수 있다.
    // 칸 하나하나에서 낸 값의 분포를 바로 뒤에 붙여, 그 하나를 얼마나 믿을지 알린다.
    const spreadLine = spreadSentence(spread, ratio.ratio, locale);
    if (spreadLine) out.push(spreadLine);
  }

  const wolse = resolveMetric(entry, "wolse");
  if (wolse) {
    out.push(
      en
        ? `Monthly rentals average a ${formatMan(wolse.metric.avgDeposit10k, locale)} deposit with ${formatMan(wolse.metric.avgMonthlyRent10k, locale)} per month.`
        : `월세는 보증금 ${formatMan(wolse.metric.avgDeposit10k, locale)}에 월 ${formatMan(wolse.metric.avgMonthlyRent10k, locale)} 수준입니다.`
    );
  }

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
