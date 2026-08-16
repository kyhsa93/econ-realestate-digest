// 기사에 붙는 수치의 규칙을 과거 뉴스 전체로 대조해본다.
//
// 뉴스는 매일 바뀌는데 매칭 규칙은 만든 날의 기사 스물몇 건을 보고 정해진다. 그날
// 화면만 보면 규칙이 멀쩡해 보여서, 다른 날 어떻게 어긋나는지는 이렇게 지난 기사를
// 통째로 훑어보는 수밖에 없다. 실제로 이 대조로 잡은 것들:
//
//   - "[서울=뉴시스]" 발신지 표기 때문에 홍콩 증시 기사에 서울 아파트 평당가가 붙었다
//   - 증시 기사의 "차익 실현 매물"이 부동산 신호로 읽혔다
//   - 코스피·환율 칩이 기사 제목에 이미 있는 숫자를 반복하고 있었다(그래서 뺐다)
//
// 규칙을 손볼 때마다 돌려서 붙는 수보다 '무엇에 붙었는지'를 본다. 커버리지는
// 높을수록 좋은 게 아니다 - 우리 데이터로 답할 수 없는 기사(수도권·지방·해외)에는
// 안 붙는 게 맞다.
//
//   node scripts/backtest-news-context.mjs           지난 기사 전체
//   node scripts/backtest-news-context.mjs --days 3  최근 3일
//   node scripts/backtest-news-context.mjs --matched 붙은 기사도 전부 출력
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildContext } from "./news-context.mjs";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const readJson = async (name) => {
  try {
    return JSON.parse(await readFile(path.join(dataDir, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
};

function parseArgs(argv) {
  const days = argv.includes("--days") ? Number(argv[argv.indexOf("--days") + 1]) : null;
  return { days: Number.isFinite(days) ? days : null, showMatched: argv.includes("--matched") };
}

async function main() {
  const { days, showMatched } = parseArgs(process.argv.slice(2));
  const [history, realestate, rates] = await Promise.all(
    ["news-history", "realestate", "rates"].map(readJson)
  );

  if (!history?.length) {
    console.error("news-history.json이 없습니다. 뉴스를 한 번이라도 수집한 뒤 실행해주세요.");
    process.exit(1);
  }

  // 값 자체는 오늘 데이터라 과거 기사의 그날 시세와는 다르다. 여기서 보려는 건
  // 값이 아니라 "어떤 기사에 어떤 종류가 붙는가"다.
  const data = { realestate, rates };
  const target = days ? history.slice(-days) : history;

  const byLabel = new Map();
  const seen = new Set();
  const unique = [];
  let total = 0;
  let matched = 0;

  for (const day of target) {
    let dayMatched = 0;
    for (const item of day.items ?? []) {
      total += 1;
      const context = buildContext(item, data);
      if (context.length) {
        matched += 1;
        dayMatched += 1;
        for (const c of context) byLabel.set(c.label, (byLabel.get(c.label) ?? 0) + 1);
      }
      // 같은 기사가 여러 날 남아 있으므로 제목 기준으로 한 번만 모은다.
      if (!seen.has(item.title)) {
        seen.add(item.title);
        unique.push({ title: item.title, context });
      }
    }
    const count = day.items?.length ?? 0;
    const rate = count ? Math.round((dayMatched / count) * 100) : 0;
    console.log(`${day.date}  ${String(dayMatched).padStart(3)}/${String(count).padStart(3)}  ${rate}%`);
  }

  console.log(`\n합계 ${matched}/${total} (${total ? Math.round((matched / total) * 100) : 0}%), 고유 기사 ${unique.length}건`);

  console.log("\n=== 붙은 종류 ===");
  for (const [label, n] of [...byLabel].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${label}`);
  }

  console.log("\n=== 아무것도 안 붙은 기사 ===");
  for (const u of unique.filter((u) => !u.context.length)) console.log(`  · ${u.title}`);

  if (showMatched) {
    console.log("\n=== 붙은 기사 ===");
    for (const u of unique.filter((u) => u.context.length)) {
      console.log(`  ✓ ${u.title}`);
      console.log(`      ${u.context.map((c) => `${c.label}=${c.value}`).join(" | ")}`);
    }
  } else {
    console.log("\n(붙은 기사까지 보려면 --matched)");
  }
}

main().catch((err) => {
  console.error(`대조 실패: ${err.message}`);
  process.exit(1);
});
