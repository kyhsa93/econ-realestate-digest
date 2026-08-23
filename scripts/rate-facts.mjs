/**
 * 금리 표가 보여주는 것 옆에, 표만 봐서는 놓치는 것.
 *
 * 금리 페이지 다섯 장은 이 사이트에서 본문이 가장 얇은데(각 1,000자 남짓) 하필
 * 광고 단가는 가장 높은 자리다. 그런데 얇은 이유가 자료가 없어서가 아니다 —
 * 금감원이 주는 필드에는 우대조건, 중도상환수수료, 부대비용, 가입 경로가 전부 들어와
 * 있고 화면이 표 네 칸만 그리고 있을 뿐이다.
 *
 * 그리고 그 안에 사람이 가장 많이 속는 것이 들어 있다. 지금 적금 표 1위는 최고 14%인데
 * 우대조건을 못 채우면 2%다. 표에는 두 숫자가 나란히 있지만, 12%p가 조건부라는 말은
 * 어디에도 없다.
 *
 * 규칙은 자치구 쪽(`district-facts.mjs`)과 같다. **문턱을 넘은 것만 말한다.** 다섯 장에
 * 같은 다섯 문장을 붙이면 표 위에 또 하나의 틀이 생길 뿐이다.
 */

/** 화면 표가 한 번에 보여주는 줄 수. `prerender.mjs`의 `RATES_ROWS`와 같아야 한다. */
const SHOWN_ROWS = 20;
/** 예적금 표가 고르는 기간. `prerender.mjs`의 `RATES_TERM`과 같아야 한다. */
const TERM = 12;

const SAVING = new Set(["deposit", "saving"]);
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * 표가 고르는 것과 똑같이 고른다.
 *
 * 여기서 세는 모집단이 화면의 표와 다르면 두 숫자가 서로를 부정한다 — "356개 중
 * 43개"라고 써 놓고 표에는 열두 달짜리가 아닌 것이 섞여 있으면 읽는 사람이 맞출 수가
 * 없다. 그래서 고르는 규칙을 `ratesHtml`에서 그대로 가져왔다.
 */
function ranked(rates, category) {
  const products = rates?.[category] ?? [];
  const saving = SAVING.has(category);
  const rows = [];

  for (const product of products) {
    let best = null;
    let bestValue = null;
    for (const option of product.options ?? []) {
      if (saving && option.term !== TERM) continue;
      const value = saving ? option.maxRate : option.min;
      if (value === null || value === undefined) continue;
      if (best === null || (saving ? value > bestValue : value < bestValue)) {
        best = option;
        bestValue = value;
      }
    }
    if (best) rows.push({ product, option: best, sort: bestValue });
  }

  rows.sort((a, b) => (saving ? b.sort - a.sort : a.sort - b.sort));
  return rows;
}

export function rateFacts(rates, category) {
  const rows = ranked(rates, category);
  if (rows.length < 5) return null;

  const facts = { category, total: rows.length, shown: Math.min(SHOWN_ROWS, rows.length) };

  // 표가 잘려 있다는 사실. 지금 화면은 스무 줄만 보여주면서 그 말을 하지 않는다.
  if (rows.length > SHOWN_ROWS) facts.truncated = true;

  if (SAVING.has(category)) {
    // 이 파일이 있는 이유. 표 맨 위 상품이 조건부라면 그게 이 페이지에서 가장 중요한 사실이다.
    const top = rows[0];
    const base = top.option.rate;
    const max = top.option.maxRate;
    if (typeof base === "number" && typeof max === "number" && max - base >= 0.5) {
      facts.topConditional = {
        company: top.product.company,
        name: top.product.name,
        base,
        max,
        gap: round2(max - base),
      };
    }

    const gapped = rows.filter(
      (r) => typeof r.option.rate === "number" && typeof r.option.maxRate === "number" && r.option.maxRate > r.option.rate
    );
    if (pct(gapped.length, rows.length) >= 10) {
      const widest = gapped.reduce((a, b) =>
        b.option.maxRate - b.option.rate > a.option.maxRate - a.option.rate ? b : a
      );
      facts.conditional = {
        count: gapped.length,
        share: pct(gapped.length, rows.length),
        // 1위와 같은 상품이면 굳이 두 번 말하지 않는다.
        widest:
          facts.topConditional && widest.product.name === facts.topConditional.name
            ? null
            : {
                company: widest.product.company,
                name: widest.product.name,
                base: widest.option.rate,
                max: widest.option.maxRate,
                gap: round2(widest.option.maxRate - widest.option.rate),
              },
      };
    }

    // 상위권이 저축은행 일색이면 예금자보호 한도가 실제로 걸리는 이야기가 된다.
    const head = rows.slice(0, SHOWN_ROWS);
    const thrift = head.filter((r) => r.product.sector === "savingsBank").length;
    if (pct(thrift, head.length) >= 70) {
      facts.thriftHeavy = { count: thrift, of: head.length };
    }

    // 영업점을 안 거치는 상품. 표에서는 이름 옆에 붙는 "(비대면)" 정도로만 드러난다.
    const online = rows.filter((r) => r.product.joinWay && !r.product.joinWay.includes("영업점")).length;
    if (pct(online, rows.length) >= 40) {
      facts.online = { count: online, share: pct(online, rows.length) };
    }
  } else {
    // 대출은 금리만 비교하면 안 되는 쪽이다. 붙는 비용이 상품마다 다르고 표에 없다.
    const fee = rows.filter((r) => r.product.erlyRpayFee).length;
    if (pct(fee, rows.length) >= 80) facts.earlyFee = { count: fee, of: rows.length };

    const spreads = rows
      .filter((r) => typeof r.option.min === "number" && typeof r.option.max === "number")
      .map((r) => ({ ...r, spread: round2(r.option.max - r.option.min) }))
      .sort((a, b) => b.spread - a.spread);
    if (spreads.length && spreads[0].spread >= 1.5) {
      const w = spreads[0];
      facts.spread = {
        company: w.product.company,
        name: w.product.name,
        min: w.option.min,
        max: w.option.max,
        spread: w.spread,
      };
    }
  }

  return facts;
}

const rate = (v) => `${Number(v).toFixed(2)}%`;

export function factSentences(facts, locale = "ko") {
  if (!facts) return [];
  const en = locale === "en";
  const out = [];

  if (facts.truncated) {
    out.push(
      en
        ? `The table shows the top ${facts.shown} of ${facts.total.toLocaleString("en-US")} products; sorting or searching re-ranks all of them.`
        : `표에 보이는 것은 ${facts.total.toLocaleString("ko-KR")}개 가운데 상위 ${facts.shown}개입니다. 정렬과 검색은 전체를 대상으로 다시 줄을 세웁니다.`
    );
  }

  if (facts.topConditional) {
    const { company, name, base, max, gap } = facts.topConditional;
    out.push(
      en
        ? `The product at the top of the table, ${name} from ${company}, is listed at ${rate(max)} — but that is with every bonus condition met. Without them it pays ${rate(base)}, a gap of ${gap} points. The table shows both numbers side by side; which one you actually get depends on conditions that are not in the table.`
        : `표 맨 위에 있는 ${company} ${name}은 ${rate(max)}로 적혀 있지만, 그건 우대조건을 전부 채웠을 때입니다. 조건 없이 받는 금리는 ${rate(base)}로 ${gap}%p 차이입니다. 표에 두 숫자가 나란히 있어도, 실제로 어느 쪽을 받을지는 표에 없는 조건이 정합니다.`
    );
  }

  if (facts.conditional) {
    const { count, share, widest } = facts.conditional;
    let text = en
      ? `${count} of these (${share}%) advertise a higher rate than they pay without conditions.`
      : `이 가운데 ${count}개(${share}%)는 조건 없이 받는 금리보다 높은 숫자를 내걸고 있습니다.`;
    if (widest) {
      text += en
        ? ` The widest gap is ${company(widest)} at ${rate(widest.base)} against ${rate(widest.max)} — ${widest.gap} points.`
        : ` 격차가 가장 큰 것은 ${widest.company} ${widest.name}으로 ${rate(widest.base)}와 ${rate(widest.max)}, ${widest.gap}%p 차이입니다.`;
    }
    out.push(text);
  }

  if (facts.thriftHeavy) {
    out.push(
      en
        ? `${facts.thriftHeavy.count} of the top ${facts.thriftHeavy.of} are savings banks rather than commercial banks. Rates there run higher, and deposit insurance is per institution up to a statutory ceiling — worth checking before splitting a large amount.`
        : `상위 ${facts.thriftHeavy.of}개 중 ${facts.thriftHeavy.count}개가 은행이 아니라 저축은행입니다. 금리가 높은 대신 예금자보호는 금융회사별 한도까지라, 금액이 크면 나눠 넣을지 먼저 확인할 부분입니다.`
    );
  }

  if (facts.online) {
    out.push(
      en
        ? `${facts.online.count} (${facts.online.share}%) cannot be opened at a branch at all — internet or mobile only.`
        : `${facts.online.count}개(${facts.online.share}%)는 영업점에서는 아예 가입되지 않습니다. 인터넷이나 스마트폰 전용입니다.`
    );
  }

  if (facts.earlyFee) {
    out.push(
      en
        ? `All ${facts.earlyFee.of} carry an early-repayment fee, and every one of them also lists incidental costs. Comparing on the headline rate alone leaves both out.`
        : `${facts.earlyFee.of}개 전부 중도상환수수료가 붙고, 부대비용 항목도 전부 따로 적혀 있습니다. 표에 나온 금리만 견주면 이 둘이 빠집니다.`
    );
  }

  if (facts.spread) {
    const { company: c, name, min, max, spread } = facts.spread;
    out.push(
      en
        ? `The rate on a loan is a range, not a number: ${name} from ${c} runs ${rate(min)} to ${rate(max)}, ${spread} points apart. Where you land inside that range is set by your credit and collateral, not by the product.`
        : `대출 금리는 하나의 숫자가 아니라 구간입니다. ${c} ${name}은 ${rate(min)}에서 ${rate(max)}까지 ${spread}%p 폭입니다. 그 안에서 어디에 걸릴지는 상품이 아니라 신용과 담보가 정합니다.`
    );
  }

  return out;
}

function company(w) {
  return `${w.company} ${w.name}`;
}
