// 상품을 20개씩 끊어 그린다. 전부 한 번에 그리면 스크롤이 끝없이 길어지고, 정적
// HTML(상위 20개)을 받은 화면이 데이터를 받는 순간 열여덟 배로 늘어난다.
//
// **개수를 단언하는 테스트는 그날 공시가 아니라 여기서 만든 상품 목록으로 돈다.**
// 예전에는 "12개월 정기예금 356개"라고 실제 개수를 적어두고 있었는데, 그건 은행이
// 상품 하나를 내놓거나 거둬들이면 깨지는 값이다. 이 저장소의 CI는 수집 뒤에 테스트를
// 다시 돌려 통과해야만 커밋하므로, 그렇게 깨지면 기능은 멀쩡한데 그날 수집분이 통째로
// 유실된다. 검사하려는 건 "20개씩 끊고 남은 개수를 밝히는가"지 상품이 몇 개인지가 아니다.
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

const savingProducts = (prefix, count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    sector: "bank",
    company: `${prefix}은행`,
    name: `${prefix} 상품 ${i}`,
    options: [{ term: 12, rateTypeName: "단리", rate: 3 + i / 100, maxRate: 3.5 + i / 100 }],
  }));

const loanProducts = (prefix, count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    sector: "bank",
    company: `${prefix}은행`,
    name: `${prefix} 상품 ${i}`,
    options: [{ rateType: "변동금리", mortgageType: "아파트", min: 3 + i / 100, max: 4 + i / 100, avg: null }],
  }));

// 정기예금 65개, 적금 25개, 주택담보대출 12개. 페이징 경계(20·40·60)와 "한 쪽으로
// 끝나는 탭"을 한 벌로 덮으려고 고른 수다.
const RATES = {
  updatedAt: "2026-08-17T00:00:00.000Z",
  disclosureMonth: "202607",
  deposit: savingProducts("예금", 65),
  saving: savingProducts("적금", 25),
  mortgage: loanProducts("주담대", 12),
  rentLoan: loanProducts("전세대출", 8),
};

const open = () => loadRatesPage({ rates: RATES });

test("처음에는 20개만 그린다", async () => {
  assert.equal(rowCount(body(await open())), 20);
});

// 그냥 잘라두면 사용자는 그게 전부인 줄 안다.
test("남은 개수와 전체 개수를 밝힌다", async () => {
  const page = await open();
  const text = more(page).replace(/<[^>]+>/g, " ");
  assert.match(text, /45개 남음/);
  assert.match(text, /65개 중 20개/);
});

test("더 보기를 누르면 20개씩 늘어난다", async () => {
  const page = await open();
  assert.match(more(page), /show-more-button/, "더 보기 버튼이 없다");

  clickShowMore(page);
  assert.equal(rowCount(body(page)), 40);

  clickShowMore(page);
  assert.equal(rowCount(body(page)), 60);
});

// 마지막 장은 20개가 안 된다. 남은 만큼만 늘고 거기서 버튼이 사라져야 한다.
test("마지막 장을 지나면 더 보기가 사라진다", async () => {
  const page = await open();
  clickShowMore(page);
  clickShowMore(page);
  clickShowMore(page);

  assert.equal(rowCount(body(page)), 65);
  assert.ok(!more(page).includes("show-more-button"), "다 그렸는데 더 보기가 남았다");
});

// 걸러낸 결과의 21번째부터 보여주면 사용자는 왜 위가 비었는지 알 수 없다.
test("탭·정렬·필터를 바꾸면 다시 20개부터 본다", async () => {
  const page = await open();
  clickShowMore(page);
  assert.equal(rowCount(body(page)), 40);

  page.clickTab("saving");
  assert.equal(rowCount(body(page)), 20, "탭을 바꿨는데 이전 개수가 남았다");

  clickShowMore(page);
  page.clickSortHeader("rate");
  assert.equal(rowCount(body(page)), 20, "정렬을 바꿨는데 이전 개수가 남았다");
});

test("상품이 20개 이하인 탭에는 더 보기가 없다", async () => {
  const page = await open();
  page.clickTab("mortgage");

  assert.equal(rowCount(body(page)), 12);
  assert.ok(!more(page).includes("더 보기"), "12개뿐인데 더 보기가 떴다");
});

// 정적 HTML이 심는 20개와 화면의 첫 20개가 같아야 데이터를 받는 순간 표가 안 흔들린다.
// 이 한 건만 실제 자료로 돈다 - 커밋된 HTML과 그 HTML을 만든 자료를 맞대보는 게
// 목적이라 재료를 바꾸면 검사할 것 자체가 없어진다. 양쪽이 같은 자료에서 나오므로
// 상품이 몇 개든 개수는 함께 움직인다.
test("정적 HTML과 초기 화면의 행 수가 같다", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname, "..");
  const html = await readFile(path.join(root, "docs/rates.html"), "utf8");
  const prerendered = html.split("<!--prerender:rates-->")[1].split("<!--/prerender")[0];

  const page = await loadRatesPage();
  assert.equal(rowCount(prerendered), rowCount(body(page)));
});
