// 정기예금만 356개, 적금은 328개다. 전부 한 번에 그리면 스크롤이 끝없이 길어지고,
// 정적 HTML(상위 20개)을 받은 화면이 데이터를 받는 순간 열여덟 배로 늘어난다.
import test from "node:test";
import assert from "node:assert/strict";
import { loadRatesPage } from "./helpers/rates-page.mjs";

const rowCount = (html) => (html.match(/<tr>/g) ?? []).length;
const body = (page) => page.byId.get("products-body").innerHTML;
const more = (page) => page.byId.get("show-more").innerHTML;

// 버튼은 innerHTML로 새로 그려지므로 하네스의 노드 맵에 없다. 화면이 컨테이너에
// 위임해 두었으니(다시 그릴 때마다 리스너를 붙이면 한 번의 클릭이 여러 번 처리된다)
// 클릭 대상만 흉내내면 실제와 같은 경로를 탄다.
const clickShowMore = (page) =>
  page.byId.get("show-more").dispatch("click", { target: { id: "show-more-button" } });

test("처음에는 20개만 그린다", async () => {
  const page = await loadRatesPage();
  assert.equal(rowCount(body(page)), 20);
});

// 그냥 잘라두면 사용자는 그게 전부인 줄 안다.
test("남은 개수와 전체 개수를 밝힌다", async () => {
  const page = await loadRatesPage();
  const text = more(page).replace(/<[^>]+>/g, " ");
  assert.match(text, /336개 남음/);
  assert.match(text, /356개 중 20개/);
});

test("더 보기를 누르면 20개씩 늘어난다", async () => {
  const page = await loadRatesPage();
  assert.match(more(page), /show-more-button/, "더 보기 버튼이 없다");

  clickShowMore(page);
  assert.equal(rowCount(body(page)), 40);

  clickShowMore(page);
  assert.equal(rowCount(body(page)), 60);
});

// 걸러낸 결과의 21번째부터 보여주면 사용자는 왜 위가 비었는지 알 수 없다.
test("탭·정렬·필터를 바꾸면 다시 20개부터 본다", async () => {
  const page = await loadRatesPage();
  clickShowMore(page);
  assert.equal(rowCount(body(page)), 40);

  page.clickTab("saving");
  assert.equal(rowCount(body(page)), 20, "탭을 바꿨는데 이전 개수가 남았다");

  clickShowMore(page);
  page.clickSortHeader("rate");
  assert.equal(rowCount(body(page)), 20, "정렬을 바꿨는데 이전 개수가 남았다");
});

test("상품이 20개 이하인 탭에는 더 보기가 없다", async () => {
  const page = await loadRatesPage();
  page.clickTab("mortgage"); // 34개지만 필터에 따라 줄어든다
  const shown = rowCount(body(page));
  const text = more(page).replace(/<[^>]+>/g, " ");
  if (shown < 20) {
    assert.ok(!text.includes("더 보기"), `${shown}개뿐인데 더 보기가 떴다`);
  }
});

// 정적 HTML이 심는 20개와 화면의 첫 20개가 같아야 데이터를 받는 순간 표가 안 흔들린다.
test("정적 HTML과 초기 화면의 행 수가 같다", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname, "..");
  const html = await readFile(path.join(root, "docs/rates.html"), "utf8");
  const prerendered = html.split("<!--prerender:rates-->")[1].split("<!--/prerender")[0];

  const page = await loadRatesPage();
  assert.equal(rowCount(prerendered), rowCount(body(page)));
});
