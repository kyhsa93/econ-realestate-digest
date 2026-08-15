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
import { loadIndexPage } from "./helpers/index-page.mjs";

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

async function loadAnalytics({
  title = "테스트 제목",
  href = "https://example.test/rates.html",
  search = "",
} = {}) {
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
    location: { href, search },
    URLSearchParams,
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
  // 블로그와 같은 속성을 쓰므로 이게 빠지면 보고서에서 두 사이트가 섞인다.
  assert.equal(config[2].content_group, "digest");

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

  a.analytics.debouncedEvent("search", { search_term: "금" });
  a.analytics.debouncedEvent("search", { search_term: "금리" });
  a.analytics.debouncedEvent("search", { search_term: "금리인하" });
  a.runTimers();

  const searches = a.events().filter(([, name]) => name === "search");
  assert.equal(searches.length, 1);
  assert.equal(searches[0][2].search_term, "금리인하");
});

test("DebugView는 ?ga_debug=1을 붙였을 때만 켜진다", async () => {
  const off = await loadAnalytics();
  assert.equal(off.calls().find(([kind]) => kind === "config")[2].debug_mode, undefined);

  const on = await loadAnalytics({ search: "?ga_debug=1" });
  assert.equal(on.calls().find(([kind]) => kind === "config")[2].debug_mode, true);
});

// GA4에서 value는 이벤트 값(숫자)으로 예약된 이름이라 문자열을 실으면 수집이 안 된다.
test("이벤트 매개변수에 GA4 예약 이름을 쓰지 않는다", async () => {
  const [index, rates] = await Promise.all(
    ["docs/index.html", "docs/rates.html"].map((p) => readFile(path.join(root, p), "utf8"))
  );

  for (const [name, html] of [
    ["index.html", index],
    ["rates.html", rates],
  ]) {
    const params = [...html.matchAll(/window\.analytics\?\.\w+\(([\s\S]*?)\);/g)].map((m) => m[1]);
    for (const block of params) {
      assert.ok(!/[{,]\s*value:/.test(block), `${name}에 예약 매개변수 value가 쓰였다: ${block}`);
    }
  }
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

test("데이터를 못 받으면 어느 파일이 실패했는지 남는다", async () => {
  const analytics = recorder();
  await loadIndexPage({ analytics });

  const failures = analytics.calls.filter(([name]) => name === "exception");
  // 오늘치 4종(market/news/summary/realestate)은 없으면 페이지가 제구실을 못 한다.
  const fatal = failures.filter(([, params]) => params.fatal);
  assert.equal(fatal.length, 4, `fatal 4건이어야 한다: ${JSON.stringify(failures)}`);
  for (const key of ["market", "news", "summary", "realestate"]) {
    assert.ok(
      fatal.some(([, params]) => params.description.includes(`load ${key}:`)),
      `${key} 실패가 안 남았다`
    );
  }

  // 히스토리는 없어도 오늘 화면은 멀쩡하니 같은 무게로 다루지 않는다.
  assert.ok(failures.some(([, params]) => params.fatal === false));
  // GA 매개변수 값 상한이 100자라 그 안에서 끊어 보낸다.
  assert.ok(failures.every(([, params]) => params.description.length <= 100));
});

test("금리 페이지도 로드 실패를 남긴다", async () => {
  const analytics = recorder();
  await loadRatesPage({ analytics, fetch: async () => ({ ok: false, json: async () => ({}) }) });

  const failures = analytics.calls.filter(([name]) => name === "exception");
  assert.ok(
    failures.some(([, params]) => params.description.includes("load rates:") && params.fatal),
    `rates 실패가 안 남았다: ${JSON.stringify(failures)}`
  );
});

test("섹션은 화면에 들어왔을 때 한 번만 센다", async () => {
  const analytics = recorder();
  const page = await loadIndexPage({ analytics });

  assert.equal(page.observedCount(), 5, "다섯 섹션 모두 관찰이 걸려야 한다");
  assert.equal(analytics.calls.filter(([n]) => n === "section_view").length, 0, "보기 전엔 안 센다");

  page.scrollTo(0);
  page.scrollTo(0);
  page.scrollTo(1);

  const views = analytics.calls.filter(([n]) => n === "section_view");
  assert.equal(views.length, 2, "같은 섹션을 다시 봐도 한 번이다");
  assert.deepEqual(
    views.map(([, params]) => params.section_name),
    ["summary", "market"]
  );
  assert.equal(views[0][1].view_type, "today");
});

// 뉴스 섹션은 화면보다 길어서 "50% 노출"이 영원히 성립하지 않는다.
// 그 조건으로 재면 제일 많이 읽는 섹션이 한 번도 안 잡힌다.
test("섹션 노출은 길이에 좌우되는 조건으로 재지 않는다", async () => {
  const page = await loadIndexPage({ analytics: recorder() });
  const { options } = page.observer();

  assert.ok(options.rootMargin?.includes("-"), "화면 가운데 띠로 재야 한다");
  assert.ok(
    options.threshold === undefined || options.threshold === 0,
    `길이에 좌우되는 threshold를 쓰고 있다: ${options.threshold}`
  );
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
