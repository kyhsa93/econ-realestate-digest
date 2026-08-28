import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { loadRatesPage } from "./helpers/rates-page.mjs";
import { RATE_PAGES } from "../scripts/build-rate-pages.mjs";
import { NEWS_PAGES } from "../scripts/build-news-pages.mjs";

const root = path.resolve(import.meta.dirname, "..");

const until = async (check) => {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
};
const read = (rel) => readFile(path.join(root, rel), "utf8");

test("메인은 주소의 카테고리·검색어로 시작한다", async () => {
  const plain = (await loadIndexPage()).app.__newsState();
  assert.equal(plain.cat, "all");
  assert.equal(plain.q, "");

  const filtered = (await loadIndexPage({ search: "?cat=realestate&q=전세" })).app.__newsState();
  assert.equal(filtered.cat, "realestate");
  assert.equal(filtered.q, "전세");
});

test("금리 페이지는 주소의 탭·기간·검색어로 시작한다", async () => {
  const plain = await loadRatesPage();
  assert.equal(plain.state.category, "deposit");

  const restored = await loadRatesPage({ search: "?tab=mortgage&type=변동금리&q=카카오" });
  assert.equal(restored.state.category, "mortgage");
  assert.equal(restored.state.rateType, "변동금리");
  assert.equal(restored.state.query, "카카오");
});

test("상품군별 페이지는 주소가 없어도 자기 탭으로 시작한다", async () => {
  const page = await loadRatesPage({ file: "docs/rent-loan-rates.html" });
  assert.equal(page.state.category, "rentLoan");

  const overridden = await loadRatesPage({ file: "docs/rent-loan-rates.html", search: "?tab=saving" });
  assert.equal(overridden.state.category, "saving");
});

test("검색은 기록을 쌓지 않고 탭·필터는 쌓는다", async () => {
  for (const file of ["docs/index.html", "docs/rates.html"]) {
    const html = await read(file);
    assert.ok(
      /history\[push \? "pushState" : "replaceState"\]/.test(html),
      `${file}에 기록 방식 구분이 없다`
    );
    assert.ok(html.includes('syncUrl({ push: true })'), `${file}에서 되돌릴 수 있는 조작을 기록하지 않는다`);
    assert.ok(html.includes('addEventListener("popstate"'), `${file}에 뒤로가기 처리가 없다`);
  }
});

test("기본값은 주소에 남기지 않는다", async () => {
  const html = await read("docs/rates.html");
  assert.ok(html.includes('["tab", state.category, DEFAULT_CATEGORY]'), "기본 탭 기준이 페이지에 맞지 않는다");
  assert.ok(html.includes('if (value === empty) next.delete(key);'), "기본값을 지우지 않는다");
});

test("부동산 표도 머리글로 정렬한다", async () => {
  const html = await read("docs/index.html");
  for (const key of ["name", "sale", "jeonse", "wolse"]) {
    assert.ok(html.includes(`data-re-sort="${key}"`), `${key} 정렬 머리글이 없다`);
  }
  assert.ok(html.includes('aria-sort'), "정렬 상태를 알리지 않는다");
});

test("아카이브를 하루씩 넘길 수 있다", async () => {
  const html = await read("docs/index.html");
  assert.ok(html.includes('id="archive-prev-day"') && html.includes('id="archive-next-day"'), "이전/다음 날 버튼이 없다");
  assert.ok(html.includes("if (next > kstToday()) return;"), "미래 날짜를 막지 않는다");
});

test("뉴스 페이지도 읽은 기사를 표시한다", async () => {
  const html = await read("docs/news.html");
  assert.ok(html.includes('const READ_NEWS_KEY = "readNews"'), "읽음 저장소가 메인과 다르다");
  assert.ok(html.includes("markNewsRead(link.getAttribute"), "클릭을 읽음으로 기록하지 않는다");
  assert.ok((await read("docs/style.css")).includes(".news-item.read"), "읽은 기사 스타일이 없다");
});

test("기록이 없는 날짜는 오류가 아니라 기록 없음으로 알린다", async () => {
  const { readFile } = await import("node:fs/promises");
  const load = (search) =>
    loadIndexPage({
      search,
      fetch: async (url) => {
        const name = String(url).split("/data/")[1].split(".json")[0];
        try {
          return { ok: true, json: async () => JSON.parse(await readFile(path.join(root, `docs/data/${name}.json`), "utf8")) };
        } catch {
          return { ok: false, json: async () => ({}) };
        }
      },
    });

  const missing = await load("?date=2026-01-01");
  await until(() => String(missing.byId("news-list").innerHTML).includes("기록이 없습니다"));
  const newsHtml = String(missing.byId("news-list").innerHTML);
  assert.ok(newsHtml.includes("기록이 없습니다"), `기록 없음 안내가 아니다: ${newsHtml.slice(0, 80)}`);
  assert.ok(!newsHtml.includes("불러오지 못했습니다"), "기록 없음을 로드 실패로 말한다");

  const newsHistory = JSON.parse(await readFile(path.join(root, "docs/data/news-history.json"), "utf8"));
  const kept = newsHistory.findLast((entry) => entry.items?.length)?.date;
  assert.ok(kept, "뉴스 기록이 하나도 없어 '있는 날'을 고를 수 없다");

  const present = await load(`?date=${kept}`);
  await until(() => String(present.byId("news-list").innerHTML).includes("news-item"));
  assert.ok(String(present.byId("news-list").innerHTML).includes("news-item"), "있는 기록을 못 그린다");
});

test("일부 섹션만 기록이 없는 날짜도 오류라고 말하지 않는다", async () => {
  const { readFile } = await import("node:fs/promises");
  const readHistory = (name) =>
    readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);

  const [newsHistory, marketHistory] = await Promise.all([
    readHistory("news-history"),
    readHistory("market-history"),
  ]);

  const onlyNews = newsHistory.findLast((entry) => entry.items?.length)?.date;
  assert.ok(onlyNews, "뉴스 기록이 하나도 없어 이 상태를 만들 수 없다");
  const marketWithout = marketHistory.filter((entry) => entry.date !== onlyNews);

  const page = await loadIndexPage({
    search: `?date=${onlyNews}`,
    fetch: async (url) => {
      const name = String(url).split("/data/")[1].split(".json")[0];
      if (name === "market-history") return { ok: true, json: async () => marketWithout };
      try {
        return { ok: true, json: async () => JSON.parse(await readFile(path.join(root, `docs/data/${name}.json`), "utf8")) };
      } catch {
        return { ok: false, json: async () => ({}) };
      }
    },
  });
  await until(() => String(page.byId("news-list").innerHTML).includes("news-item"));

  const news = String(page.byId("news-list").innerHTML);
  const market = String(page.byId("market-grid").innerHTML);
  assert.ok(news.includes("news-item"), "그날 뉴스는 있는데 안 그린다");
  assert.ok(market.includes("기록이 없습니다"), `기록 없음 안내가 아니다: ${market.slice(0, 80)}`);
  assert.ok(!market.includes("불러오지 못했습니다"), "기록 없음을 로드 실패로 말한다");
});

test("보관 범위보다 뒤로는 넘기지 못한다", async () => {
  const html = await read("docs/index.html");
  assert.ok(html.includes('document.getElementById("archive-prev-day").disabled'), "이전 날 버튼을 막지 않는다");
  assert.ok(html.includes("input.min = dates[0]"), "날짜 선택 범위를 제한하지 않는다");
});

test("무엇을 못 받았는지 이름을 말한다", async () => {
  const { readFile } = await import("node:fs/promises");

  const loadWithFailure = (failing) =>
    loadIndexPage({
      fetch: async (url) => {
        const name = String(url).split("/data/")[1]?.split(".json")[0];
        if (!name) throw new TypeError("Failed to fetch");
        if (name === failing) return { ok: false, status: 404, json: async () => ({}) };
        try {
          return { ok: true, json: async () => JSON.parse(await readFile(path.join(root, `docs/data/${name}.json`), "utf8")) };
        } catch {
          return { ok: false, status: 404, json: async () => ({}) };
        }
      },
    });

  for (const [file, label] of [["summary", "AI 요약"], ["market", "시장지표"], ["news", "뉴스"], ["realestate", "부동산"]]) {
    const page = await loadWithFailure(file);
    await until(() => String(page.byId("load-error-text").textContent).includes(label));
    const text = page.byId("load-error-text").textContent;
    assert.ok(text.includes(label), `${file} 실패인데 배너가 "${text}"다`);
    assert.ok(!text.includes("을(를)"), `조사가 자동으로 안 붙는다: ${text}`);
  }

  const withReason = await loadWithFailure("summary");
  await until(() => /\(HTTP \d+\)/.test(String(withReason.byId("load-error-text").textContent)));
  assert.ok(
    /\(HTTP \d+\)/.test(withReason.byId("load-error-text").textContent),
    `실패 이유가 안 실린다: ${withReason.byId("load-error-text").textContent}`
  );

  const summaryFailed = await loadWithFailure("summary");
  await until(() => String(summaryFailed.byId("summary-box").textContent).includes("불러오지 못했습니다"));
  const box = String(summaryFailed.byId("summary-box").textContent);
  assert.ok(box.includes("불러오지 못했습니다"), `요약 실패가 정상 빈 화면처럼 보인다: ${box}`);
});

test("데이터가 다 있으면 어떤 경우에도 오류 배너가 뜨지 않는다", async () => {
  const html = await read("docs/index.html");
  assert.ok(
    html.includes('["market", "news", "summary", "realestate"].filter((key) => !cache[key])'),
    "배너가 여전히 플래그로 뜬다"
  );
  assert.ok(html.includes("showLoadError(missing.length > 0"), "배너 조건이 화면 상태와 무관하다");
  assert.ok(
    html.includes('textContent = show ? text : ""'),
    "감출 때 문구를 비우지 않는다"
  );
});

test("감춰야 할 요소가 CSS 때문에 계속 보이지 않는다", async () => {
  const css = await read("docs/style.css");
  assert.match(css, /\[hidden\] \{\s*display: none !important;\s*\}/, "감춤 보호 규칙이 없다");

  const files = [
    "docs/index.html",
    "docs/rates.html",
    "docs/news.html",
    ...RATE_PAGES.map((p) => `docs/${p.file}`),
    ...NEWS_PAGES.map((p) => `docs/${p.file}`),
  ];

  for (const file of files) {
    assert.ok(
      (await read(file)).includes('href="./style.css"'),
      `${file}이 스타일시트를 부르지 않아 감춤 규칙이 닿지 않는다`
    );
  }
});

test("아카이브에서는 부동산 섹션을 접는다", async () => {
  const { readFile } = await import("node:fs/promises");
  const load = (search) =>
    loadIndexPage({
      search,
      fetch: async (url) => {
        const name = String(url).split("/data/")[1].split(".json")[0];
        try {
          return { ok: true, json: async () => JSON.parse(await readFile(path.join(root, `docs/data/${name}.json`), "utf8")) };
        } catch {
          return { ok: false, status: 404, json: async () => ({}) };
        }
      },
    });

  const newsHistory = JSON.parse(await readFile(path.join(root, "docs/data/news-history.json"), "utf8"));
  const kept = newsHistory.findLast((entry) => entry.items?.length)?.date;

  const archive = await load(`?date=${kept}`);
  await until(() => String(archive.byId("news-list").innerHTML).includes("news-item"));
  assert.equal(archive.byId("realestate-section").hidden, true, "지난 날짜에 부동산을 그리려 한다");

  const today = await load("");
  await until(() => String(today.byId("realestate-grid").innerHTML).includes("<tr"));
  assert.equal(today.byId("realestate-section").hidden, false, "오늘 화면에서 부동산이 사라졌다");
});

test("부동산 기록은 아카이브 날짜 목록에 넣지 않는다", async () => {
  const html = await read("docs/index.html");

  assert.ok(
    !/archiveDates[\s\S]{0,200}realestateHistory/.test(html),
    "부동산 기록 날짜가 아카이브 목록에 섞인다"
  );
  assert.ok(!html.includes('realestateHistory: "realestate-history"'), "쓰지 않는 기록을 계속 받는다");
});
