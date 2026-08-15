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
