// "지금 다시 요약할 만한가" 판정.
//
// 이 판정이 너무 자주 참이면 분리한 의미가 없고(하루 네 번 다시 40분씩 돈다), 너무 자주
// 거짓이면 요약이 며칠씩 묵는다. 양쪽 경계를 다 고정해둔다.
import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../scripts/summary-needed.mjs";

const NOW = new Date("2026-08-17T05:00:00.000Z"); // KST 2026-08-17 14:00

const article = (n, extra = {}) => ({
  title: `기사 ${n}`,
  titleEn: `Article ${n}`,
  link: `https://example.com/${n}`,
  ...extra,
});

const news = (count, extra = (i) => ({})) => ({
  updatedAt: NOW.toISOString(),
  items: Array.from({ length: count }, (_, i) => article(i, extra(i))),
});

const source = (count) => ({ links: Array.from({ length: count }, (_, i) => `https://example.com/${i}`) });
const summaryAt = (iso) => ({ updatedAt: iso });

test("오늘 요약이 아직 없으면 돌린다", () => {
  // 2026-08-16T05:00Z = KST 8월 16일 14:00, 즉 어제 만든 요약이다.
  const { needed, reason } = decide(news(24), summaryAt("2026-08-16T05:00:00.000Z"), source(24), NOW);
  assert.equal(needed, true);
  assert.match(reason, /오늘\(2026-08-17\) 요약이 아직 없습니다/);
});

// KST 기준으로 봐야 한다. UTC로 재면 한국 시간 아침에 만든 요약이 "어제 것"이 된다.
test("날짜는 서울 기준으로 센다", () => {
  // 2026-08-16T23:00Z = KST 8월 17일 08:00, 즉 오늘 아침에 만든 요약이다.
  const morning = new Date("2026-08-17T04:00:00.000Z");
  const { needed } = decide(news(24), summaryAt("2026-08-16T23:00:00.000Z"), source(24), morning);
  assert.equal(needed, false, "오늘 아침 요약을 어제 것으로 봤다");
});

test("요약 이후 기사가 충분히 새로 들어오면 돌린다", () => {
  // 24건 중 10건이 요약에 없던 기사
  const { needed, reason } = decide(news(24), summaryAt(NOW.toISOString()), source(14), NOW);
  assert.equal(needed, true);
  assert.match(reason, /새 기사 10건/);
});

test("몇 건 안 바뀌었으면 건너뛴다", () => {
  const { needed, reason } = decide(news(24), summaryAt(NOW.toISOString()), source(20), NOW);
  assert.equal(needed, false);
  assert.match(reason, /새 기사 4건/);
});

// 영어 화면에 한국어 제목이 여러 줄 남는 상태를 오래 두지 않는다.
test("번역이 밀리면 요약 기준에 못 미쳐도 돌린다", () => {
  const untranslated = news(24, (i) => (i < 6 ? { titleEn: undefined } : {}));
  const { needed, reason } = decide(untranslated, summaryAt(NOW.toISOString()), source(24), NOW);
  assert.equal(needed, true);
  assert.match(reason, /번역 안 된 기사 6건/);
});

// 이 기능 이전에 만들어진 요약에는 "무엇을 보고 썼는지"가 없다. 셀 수가 없으니 한 번
// 다시 쓰고 기록을 남긴다.
test("요약이 다룬 기사 목록이 없으면 한 번 돌린다", () => {
  const { needed, reason } = decide(news(24), summaryAt(NOW.toISOString()), null, NOW);
  assert.equal(needed, true);
  assert.match(reason, /기사 목록이 없습니다/);
});

test("뉴스가 없으면 돌리지 않는다", () => {
  assert.equal(decide({ items: [] }, null, null, NOW).needed, false);
  assert.equal(decide(null, null, null, NOW).needed, false);
});
