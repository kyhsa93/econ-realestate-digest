import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const docs = path.join(root, "docs");

/**
 * 검색에 내보내기로 한 페이지 전부.
 *
 * 이 목록이 여기 있는 이유는 한 번 크게 새었기 때문이다. 예산대 페이지 열여덟 장이
 * 만들어진 뒤로 줄곧 사이트맵 밖에 있었다 — 파일은 있고, 링크도 (한 곳에서) 걸려 있고,
 * 아무 검사도 실패하지 않았는데 검색에는 존재하지 않았다.
 *
 * 그렇게 된 것은 페이지와 사이트맵이 서로 다른 저장소에 있어서다. 페이지는 여기 있고
 * 사이트맵 목록은 블로그의 `scripts/postbuild.ts`에 손으로 적혀 있으니, 어느 쪽도 상대를
 * 볼 수 없었다. 이 배열이 그 사이를 잇는다: 페이지를 늘리거나 색인에서 빼면 여기가
 * 깨지고, 깨진 김에 저쪽도 고치게 된다.
 */
const INDEXABLE = [
  "about.html",
  "apartment-jeonse.html",
  "apartment-rent.html",
  "apartment-sale.html",
  "budget-10eok.html",
  "budget-11eok.html",
  "budget-12eok.html",
  "budget-13eok.html",
  "budget-14eok.html",
  "budget-15eok.html",
  "budget-16eok.html",
  "budget-17eok.html",
  "budget-18eok.html",
  "budget-19eok.html",
  "budget-20eok.html",
  "budget-3eok.html",
  "budget-4eok.html",
  "budget-5eok.html",
  "budget-6eok.html",
  "budget-7eok.html",
  "budget-8eok.html",
  "budget-9eok.html",
  "deposit-rates.html",
  "district-dobong.html",
  "district-dongdaemun.html",
  "district-dongjak.html",
  "district-eunpyeong.html",
  "district-gangbuk.html",
  "district-gangdong.html",
  "district-gangnam.html",
  "district-gangseo.html",
  "district-geumcheon.html",
  "district-guro.html",
  "district-gwanak.html",
  "district-gwangjin.html",
  "district-jongno.html",
  "district-jung.html",
  "district-jungnang.html",
  "district-mapo.html",
  "district-nowon.html",
  "district-seocho.html",
  "district-seodaemun.html",
  "district-seongbuk.html",
  "district-seongdong.html",
  "district-songpa.html",
  "district-yangcheon.html",
  "district-yeongdeungpo.html",
  "district-yongsan.html",
  "index.html",
  "method.html",
  "mortgage-rates.html",
  "rates.html",
  "realestate.html",
  "rent-loan-rates.html",
  "saving-rates.html",
];

const htmlPages = async () =>
  (await readdir(docs)).filter((f) => f.endsWith(".html")).sort();

const read = (file) => readFile(path.join(docs, file), "utf8");

test("색인에 내보내는 페이지가 목록과 같다", async () => {
  const found = [];
  for (const file of await htmlPages()) {
    const html = await read(file);
    if (!/<meta name="robots" content="noindex/.test(html)) found.push(file);
  }

  assert.deepEqual(
    found,
    INDEXABLE,
    "색인 대상이 바뀌었습니다. 이 배열과 함께 kyhsa93.github.io/scripts/postbuild.ts의 " +
      "digestSubPages도 고쳐야 사이트맵에 반영됩니다 — 한쪽만 고치면 페이지가 검색에서 사라집니다."
  );
});

test("어느 페이지도 다른 페이지에서 닿지 않는 채로 있지 않다", async () => {
  // 사이트맵에 넣는 것만으로는 부족하다. 예산대 페이지는 실거래 검색 한 곳에서만 링크가
  // 걸려 있었는데, 그 한 곳마저 없었다면 사이트맵에 적어 둔들 권위가 흘러갈 길이 없다.
  const files = await htmlPages();
  const inbound = new Map(files.map((f) => [f, 0]));
  for (const file of files) {
    const html = await read(file);
    for (const target of new Set([...html.matchAll(/href="\.\/([a-z0-9-]+\.html)/g)].map((m) => m[1]))) {
      if (target !== file && inbound.has(target)) inbound.set(target, inbound.get(target) + 1);
    }
  }

  const orphans = [...inbound].filter(([, n]) => n === 0).map(([f]) => f);
  assert.deepEqual(orphans, [], `어디서도 링크되지 않는 페이지: ${orphans.join(", ")}`);
});

test("읽을거리 두 장은 모든 페이지에서 닿는다", async () => {
  // 방법론과 소개는 이 사이트가 무엇으로 만들어졌는지를 말하는 유일한 글이다. 어느
  // 페이지에서 들어오든 한 번에 닿아야 한다.
  const files = await htmlPages();
  for (const file of files) {
    const html = await read(file);
    for (const target of ["method.html", "about.html"]) {
      assert.ok(html.includes(`href="./${target}"`), `${file}: ${target} 링크가 없습니다`);
    }
  }
});
