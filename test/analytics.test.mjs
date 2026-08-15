// docs/analytics.js를 가짜 브라우저 위에서 실제로 돌린다.
// 여기서 지키려는 건 두 가지다. (1) 유입이 통째로 빠지지 않을 것,
// (2) 같은 방문이 두 번 세어지지 않을 것. 둘 다 화면에는 안 보여서
// 사람 눈으로는 못 잡는다.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { loadRatesPage } from "./helpers/rates-page.mjs";

const root = path.resolve(import.meta.dirname, "..");

function recorder() {
  const calls = [];
  return {
    calls,
    pageView: (params) => calls.push(["page_view", params]),
    event: (name, params) => calls.push([name, params]),
    debouncedEvent: (name, params) => calls.push([name, params]),
  };
}

async function loadAnalytics({ title = "테스트 제목", href = "https://example.test/rates.html" } = {}) {
  const source = await readFile(path.join(root, "docs/analytics.js"), "utf8");

  const appended = [];
  const timers = [];

  const context = {
    window: {},
    document: {
      title,
      head: { appendChild: (el) => appended.push(el) },
      createElement: () => ({}),
    },
    location: { href },
    setTimeout(fn, ms) {
      timers.push({ fn, ms, cancelled: false });
      return timers.length;
    },
    clearTimeout(id) {
      if (id && timers[id - 1]) timers[id - 1].cancelled = true;
    },
  };

  vm.runInNewContext(source, context);

  return {
    window: context.window,
    document: context.document,
    analytics: context.window.analytics,
    calls: () => context.window.dataLayer.map((args) => Array.from(args)),
    events: () =>
      context.window.dataLayer
        .map((args) => Array.from(args))
        .filter(([kind]) => kind === "event"),
    scriptSrcs: () => appended.map((el) => el.src),
    runTimers: () => {
      // 실행 중에 새 타이머가 걸릴 수 있으니 스냅샷을 떠서 돈다.
      for (const timer of [...timers]) {
        if (!timer.cancelled) {
          timer.cancelled = true;
          timer.fn();
        }
      }
    },
  };
}

test("페이지뷰 자동 전송은 꺼두고 로더가 gtag/adsense를 붙인다", async () => {
  const a = await loadAnalytics();

  const config = a.calls().find(([kind]) => kind === "config");
  assert.ok(config, "config 호출이 있어야 한다");
  assert.equal(config[2].send_page_view, false);

  const srcs = a.scriptSrcs();
  assert.ok(srcs.some((s) => s.includes("googletagmanager.com/gtag/js?id=G-")));
  assert.ok(srcs.some((s) => s.includes("adsbygoogle.js?client=ca-pub-")));
});

test("페이지뷰는 렌더가 끝난 뒤 제목·언어와 함께 나간다", async () => {
  const a = await loadAnalytics({ title: "Deposit, Savings & Loan Rates" });

  a.analytics.pageView({ site_language: "en" });

  const [, name, params] = a.events()[0];
  assert.equal(name, "page_view");
  assert.equal(params.page_title, "Deposit, Savings & Loan Rates");
  assert.equal(params.page_location, "https://example.test/rates.html");
  assert.equal(params.site_language, "en");
});

test("언어를 바꿔 다시 불려도 페이지뷰를 두 번 세지 않는다", async () => {
  const a = await loadAnalytics();

  a.analytics.pageView({ site_language: "ko" });
  a.analytics.pageView({ site_language: "en" });
  a.runTimers();

  assert.equal(a.events().filter(([, name]) => name === "page_view").length, 1);
});

test("렌더가 실패해 아무도 안 부르면 타이머가 대신 보낸다", async () => {
  const a = await loadAnalytics();

  assert.equal(a.events().length, 0);
  a.runTimers();

  const pageViews = a.events().filter(([, name]) => name === "page_view");
  assert.equal(pageViews.length, 1);
});

test("검색 이벤트는 마지막 입력 한 번으로 합쳐진다", async () => {
  const a = await loadAnalytics();

  a.analytics.debouncedEvent("news_search", { search_term: "금" });
  a.analytics.debouncedEvent("news_search", { search_term: "금리" });
  a.analytics.debouncedEvent("news_search", { search_term: "금리인하" });
  a.runTimers();

  const searches = a.events().filter(([, name]) => name === "news_search");
  assert.equal(searches.length, 1);
  assert.equal(searches[0][2].search_term, "금리인하");
});

test("금리 페이지는 첫 렌더에서 페이지뷰를, 탭 전환에서 이벤트를 보고한다", async () => {
  const analytics = recorder();
  const { clickTab } = await loadRatesPage({ analytics });

  const pageViews = analytics.calls.filter(([name]) => name === "page_view");
  assert.equal(pageViews.length, 1, "첫 렌더에서 페이지뷰가 한 번 나가야 한다");
  assert.equal(pageViews[0][1].site_language, "ko");

  clickTab("mortgage");
  const tabEvents = analytics.calls.filter(([name]) => name === "rate_tab");
  assert.equal(tabEvents.length, 1);
  assert.equal(tabEvents[0][1].rate_category, "mortgage");
});

test("계측 스크립트가 차단돼도 금리 페이지는 그대로 그려진다", async () => {
  const { byId } = await loadRatesPage();
  assert.ok(byId.get("products-body").innerHTML.includes("<tr"));
});

test("두 페이지와 서비스워커가 모두 analytics.js를 물고 있다", async () => {
  const [index, rates, sw] = await Promise.all(
    ["docs/index.html", "docs/rates.html", "docs/sw.js"].map((p) =>
      readFile(path.join(root, p), "utf8")
    )
  );

  for (const [name, html] of [
    ["index.html", index],
    ["rates.html", rates],
  ]) {
    assert.ok(html.includes('<script src="./analytics.js"></script>'), `${name}에 로더가 없다`);
    // 로더로 옮기기 전처럼 페이지에 측정 코드가 다시 박히면 두 번 계측된다.
    assert.ok(!html.includes("googletagmanager.com"), `${name}에 인라인 GA가 남아 있다`);
    assert.ok(html.includes("privacy-policy"), `${name}에 개인정보처리방침 링크가 없다`);
  }

  assert.ok(sw.includes('"./analytics.js"'), "서비스워커 셸에 analytics.js가 빠졌다");
});
