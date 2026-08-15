// 필터·검색·탭이 주소에 남지 않으면 걸러놓은 화면을 공유할 수 없고, 뒤로가기가
// 필터를 되돌리는 대신 사이트를 빠져나간다. 주소로 들어왔을 때 그 상태로 열리는지를 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { loadRatesPage } from "./helpers/rates-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

test("메인은 주소의 카테고리·검색어로 시작한다", async () => {
  // vm 컨텍스트에서 만들어진 객체라 프로토타입이 달라 deepEqual은 못 쓴다.
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

  // 주소의 탭이 meta보다 우선한다(공유된 링크가 이겨야 한다).
  const overridden = await loadRatesPage({ file: "docs/rent-loan-rates.html", search: "?tab=saving" });
  assert.equal(overridden.state.category, "saving");
});

test("검색은 기록을 쌓지 않고 탭·필터는 쌓는다", async () => {
  for (const file of ["docs/index.html", "docs/rates.html"]) {
    const html = await read(file);
    // 글자마다 pushState하면 뒤로가기가 못 쓰게 된다.
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
  // 상품군별 페이지는 기본 탭이 다르다. deposit을 기준으로 삼으면 그 페이지들에
  // 의미 없는 ?tab=이 붙는다.
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
  // 오늘보다 뒤로는 갈 수 없다.
  assert.ok(html.includes("if (next > kstToday()) return;"), "미래 날짜를 막지 않는다");
});

test("뉴스 페이지도 읽은 기사를 표시한다", async () => {
  const html = await read("docs/news.html");
  // 메인과 같은 저장소를 써야 한 곳에서 읽은 게 다른 곳에도 반영된다.
  assert.ok(html.includes('const READ_NEWS_KEY = "readNews"'), "읽음 저장소가 메인과 다르다");
  assert.ok(html.includes("markNewsRead(link.getAttribute"), "클릭을 읽음으로 기록하지 않는다");
  assert.ok(html.includes(".news-item.read"), "읽은 기사 스타일이 없다");
});

// 데이터는 멀쩡한데 보관 범위 밖 날짜를 열었을 뿐인데도 "불러오지 못했습니다"가 떠서,
// 사이트가 고장난 것처럼 보였다. 하루씩 넘기는 버튼이 생기면서 훨씬 쉽게 도달하게 됐다.
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
  await new Promise((r) => setTimeout(r, 30));
  const newsHtml = String(missing.byId("news-list").innerHTML);
  assert.ok(newsHtml.includes("기록이 없습니다"), `기록 없음 안내가 아니다: ${newsHtml.slice(0, 80)}`);
  assert.ok(!newsHtml.includes("불러오지 못했습니다"), "기록 없음을 로드 실패로 말한다");

  // 보관 범위 안의 날짜는 그대로 그려진다.
  const present = await load("?date=2026-08-13");
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(String(present.byId("news-list").innerHTML).includes("news-item"), "있는 기록을 못 그린다");
});

// 히스토리마다 보관 시작일이 다르다(뉴스 08-09, 시장지표 08-10). 날짜 하나로 뭉뚱그려
// 판정하면 뉴스는 멀쩡히 나오는데 시장지표만 "불러오지 못했습니다"가 뜬다.
test("일부 섹션만 기록이 없는 날짜도 오류라고 말하지 않는다", async () => {
  const { readFile } = await import("node:fs/promises");
  const histories = await Promise.all(
    ["news-history", "market-history"].map((n) =>
      readFile(path.join(root, `docs/data/${n}.json`), "utf8").then(JSON.parse)
    )
  );
  const [newsDates, marketDates] = histories.map((h) => h.map((e) => e.date));
  const onlyNews = newsDates.find((d) => !marketDates.includes(d));
  assert.ok(onlyNews, "한쪽에만 있는 날짜가 없어 이 테스트가 무의미하다");

  const page = await loadIndexPage({
    search: `?date=${onlyNews}`,
    fetch: async (url) => {
      const name = String(url).split("/data/")[1].split(".json")[0];
      try {
        return { ok: true, json: async () => JSON.parse(await readFile(path.join(root, `docs/data/${name}.json`), "utf8")) };
      } catch {
        return { ok: false, json: async () => ({}) };
      }
    },
  });
  await new Promise((r) => setTimeout(r, 30));

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

// 네 파일 중 하나만 실패해도 배너는 "데이터를 불러오지 못했습니다"라고만 해서,
// 나머지가 멀쩡한데도 전체가 고장난 것처럼 보였고 무엇이 문제인지도 알 수 없었다.
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
    await new Promise((r) => setTimeout(r, 30));
    const text = page.byId("load-error-text").textContent;
    assert.ok(text.includes(label), `${file} 실패인데 배너가 "${text}"다`);
    // 받침에 맞는 조사여야 한다("시장지표을(를)"처럼 나오면 안 된다).
    assert.ok(!text.includes("을(를)"), `조사가 자동으로 안 붙는다: ${text}`);
  }

  // 이유가 없으면 제보를 받아도 원인(오프라인/배포 어긋남/본문 깨짐)을 못 좁힌다.
  const withReason = await loadWithFailure("summary");
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(
    /\(HTTP \d+\)/.test(withReason.byId("load-error-text").textContent),
    `실패 이유가 안 실린다: ${withReason.byId("load-error-text").textContent}`
  );

  // 요약은 "아직 없음"과 "못 받음"이 화면에서 구분돼야 한다.
  const summaryFailed = await loadWithFailure("summary");
  await new Promise((r) => setTimeout(r, 30));
  const box = String(summaryFailed.byId("summary-box").textContent);
  assert.ok(box.includes("불러오지 못했습니다"), `요약 실패가 정상 빈 화면처럼 보인다: ${box}`);
});

// 넷 중 하나가 순간적으로 실패한 것뿐인데도 배너가 남아 있었다. 실제 제보가 그랬다 -
// 갱신 시각도 정상이고 나중에 직접 받아보면 네 파일 다 200인데 배너만 떠 있었다.
test("한 번 실패해도 자동으로 다시 받아보고, 성공하면 오류를 안 보여준다", async () => {
  const { readFile } = await import("node:fs/promises");
  const tried = new Set();

  const page = await loadIndexPage({
    fetch: async (url) => {
      const name = String(url).split("/data/")[1]?.split(".json")[0];
      if (!name) throw new TypeError("Failed to fetch");
      // 첫 요청만 실패하고, 다시 받으면 성공하는 상황.
      if (name === "summary" && !tried.has(name)) {
        tried.add(name);
        return { ok: false, status: 503, json: async () => ({}) };
      }
      try {
        return { ok: true, json: async () => JSON.parse(await readFile(path.join(root, `docs/data/${name}.json`), "utf8")) };
      } catch {
        return { ok: false, status: 404, json: async () => ({}) };
      }
    },
  });

  assert.equal(page.byId("load-error").hidden, true, "복구됐는데도 오류 배너가 남아 있다");
  assert.ok(String(page.byId("summary-box").innerHTML).includes("summary-category"), "재시도 결과를 안 그린다");
});

// 배너가 플래그로 뜨면, 데이터가 다 있는데 배너만 떠 있는 상태가 생긴다.
// 지금 화면에 실제로 빠진 데이터가 있을 때만 뜨게 한다.
test("데이터가 다 있으면 어떤 경우에도 오류 배너가 뜨지 않는다", async () => {
  const html = await read("docs/index.html");
  assert.ok(
    html.includes('["market", "news", "summary", "realestate"].filter((key) => !cache[key])'),
    "배너가 여전히 플래그로 뜬다"
  );
  assert.ok(html.includes("showLoadError(missingNow.length > 0)"), "배너 조건이 화면 상태와 무관하다");
});
