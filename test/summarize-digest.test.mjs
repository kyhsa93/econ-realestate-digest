// 이 저장소엔 돌릴 수 있는 Ollama가 없다. 대신 스텁 HTTP 서버를 세워 요약 스크립트를
// 통째로 돌린다 - 검증 통과/숫자 환각/고유명사 환각/생성 실패를 강제해서, 각 경로가
// 화면에 무엇을 내보내는지까지 본다. 조용한 폴백이 정상 출력과 구분이 안 되는 게
// 이 파이프라인에서 제일 오래 못 알아챈 문제였다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pickHighlights } from "../scripts/summarize-digest.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(import.meta.dirname, "../scripts/summarize-digest.mjs");

function startOllamaStub(reply) {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const { prompt } = JSON.parse(raw);
      const kind = /고유명사/.test(prompt)
        ? "entities"
        : /^Translate the following Korean/m.test(prompt)
          ? "translate"
          : /한 문장 요약:$/.test(prompt)
            ? "single"
            : "paragraph";
      calls.push({ kind, prompt });
      const response = reply({ kind, prompt });
      if (response === null) {
        res.writeHead(500).end("boom");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        calls,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

const NEWS_ITEMS = [
  {
    title: "국토부, 신규 택지 후보지 발표",
    link: "https://example.com/a",
    source: "가상경제",
    category: "realestate",
    dupes: [{ title: "택지 발표", link: "https://example.com/a2", source: "다른매체" }],
  },
  {
    title: "코스피 하락 마감",
    link: "https://example.com/b",
    source: "가상경제",
    category: "stocks",
    dupes: [],
  },
];

const BODIES = {
  "https://example.com/a":
    "국토교통부는 14일 신규 공공택지 후보지를 발표했다. 이번 후보지에는 3만 가구가 들어선다. 정부는 연내 추가 발표를 예고했다. ".repeat(5),
  "https://example.com/b":
    "코스피가 전 거래일보다 12.5포인트 내린 채 거래를 마쳤다. 외국인이 순매도를 이어갔다. 원/달러 환율은 상승했다. ".repeat(5),
};

async function runSummarize(reply) {
  const stub = await startOllamaStub(reply);
  const dir = await mkdtemp(path.join(tmpdir(), "digest-"));
  const dataDir = path.join(dir, "data");
  const bodiesFile = path.join(dir, "bodies.json");

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    path.join(dataDir, "news.json"),
    JSON.stringify({ updatedAt: new Date().toISOString(), date: TODAY, items: NEWS_ITEMS })
  );
  await writeFile(bodiesFile, JSON.stringify({ date: TODAY, bodies: BODIES }));

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        SUMMARY_DATA_DIR: dataDir,
        NEWS_BODIES_FILE: bodiesFile,
        OLLAMA_URL: stub.url,
        OLLAMA_MODEL: "stub",
      },
    });
    const summary = JSON.parse(await readFile(path.join(dataDir, "summary.json"), "utf8"));
    return { summary, stdout, stderr, calls: stub.calls };
  } finally {
    await stub.close();
  }
}

// 검증은 카테고리마다 그 카테고리 기사만 원문으로 삼는다. 스텁도 프롬프트에 실제로
// 들어간 재료 안에서만 답해야 한다 - 아무 문단이나 돌려주면 정상 동작을 환각으로 오해한다.
const KO_REALESTATE =
  "국토교통부는 14일 신규 공공택지 후보지를 발표했다. 이번 후보지에는 3만 가구가 들어선다. 정부는 연내 추가 발표를 예고했다.";
const KO_STOCKS =
  "코스피가 전 거래일보다 12.5포인트 내린 채 거래를 마쳤다. 외국인이 순매도를 이어갔다. 원/달러 환율은 상승했다.";
const goodKo = (prompt) => (/코스피/.test(prompt) ? KO_STOCKS : KO_REALESTATE);

test("본문이 있으면 문단 요약과 핵심 기사가 함께 나온다", async () => {
  const { summary, stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return /코스피/.test(prompt) ? "코스피" : "국토교통부";
    if (kind === "translate") return "The ministry announced new housing sites. Some 30,000 homes will be built there.";
    return goodKo(prompt);
  });

  assert.equal(stderr, "", `폴백 로그가 남았다:\n${stderr}`);
  assert.ok(summary.highlights.length > 0, "핵심 기사가 비었다");
  assert.ok(summary.categories.every((c) => !c.isFallback), "폴백이 섞였다");

  // 한 문장짜리로 돌아가면 이번 변경이 의미가 없다.
  for (const category of summary.categories) {
    assert.ok(category.lineKo.length > 60, `카테고리 요약이 너무 짧다: ${category.lineKo}`);
  }
  for (const highlight of summary.highlights) {
    assert.ok(highlight.textKo.length > 40, `핵심 요약이 너무 짧다: ${highlight.textKo}`);
    assert.ok(highlight.textEn, "영어 요약이 없다");
  }
  assert.match(summary.summary.ko, /국토교통부/);
});

test("원문에 없는 숫자를 지어내면 그 요약은 버린다", async () => {
  let paragraphCalls = 0;
  const { summary, stderr } = await runSummarize(({ kind }) => {
    if (kind === "entities") return "없음";
    if (kind === "translate") return "Translated.";
    if (kind === "single") return "국토교통부가 신규 택지를 발표했다.";
    paragraphCalls += 1;
    // 본문에 없는 수치. 이런 게 그대로 나가면 읽는 사람은 사실로 받아들인다.
    return "국토교통부는 신규 택지 99만 가구를 공급한다고 발표했다. 분양가는 4억 5000만원으로 정해졌다.";
  });

  assert.match(stderr, /원문에 없는 숫자/);
  assert.ok(paragraphCalls >= 2, "온도를 낮춘 재시도가 없었다");
  // 문단이 막혀도 곧장 제목 나열로 가지 않고 한 문장으로 물러난다.
  const degraded = summary.categories.filter((c) => c.degraded);
  assert.ok(degraded.length > 0, "한 문장 폴백이 동작하지 않았다");
  assert.ok(
    degraded.every((c) => !c.isFallback && !c.lineKo.includes("99만")),
    "검증에 걸린 문장이 그대로 실렸다"
  );
});

test("원문에 없는 고유명사를 지어내면 그 요약은 버린다", async () => {
  const { summary, stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return "국민의당";
    if (kind === "translate") return "Translated.";
    if (kind === "single") return null;
    return goodKo(prompt);
  });

  assert.match(stderr, /원문에 없는 고유명사/);
  assert.ok(
    summary.categories.some((c) => c.isFallback && c.fallbackReason === "unverified-entity"),
    "환각이 걸러지지 않았다"
  );
});

test("모델이 죽어도 파일은 남고 폴백 이유가 기록된다", async () => {
  const { summary, stdout } = await runSummarize(() => null);

  assert.ok(summary.categories.length > 0);
  assert.ok(summary.categories.every((c) => c.isFallback && c.fallbackReason === "generation-failed"));
  // 핵심 기사는 요약이 없으면 제목만 다시 보여주느니 자리를 비운다.
  assert.equal(summary.highlights.length, 0);
  assert.match(stdout, /폴백/);
});

test("잘린 문장은 내보내지 않는다", async () => {
  // num_predict에 걸려 끊긴 꼬리가 그대로 나가면 화면에서 말이 끊겨 보인다.
  const { summary } = await runSummarize(({ kind }) => {
    if (kind === "entities") return "없음";
    if (kind === "translate") return "The ministry announced new sites.";
    if (kind === "single") return "국토교통부가 신규 택지를 발표했다.";
    return "국토교통부는 신규 공공택지 후보지를 발표했다. 정부는 연내 추가 발표를 예고했으며 구체적인 위치는";
  });

  for (const category of summary.categories) {
    assert.doesNotMatch(category.lineKo, /구체적인 위치는$/, "잘린 꼬리가 남았다");
    assert.match(category.lineKo, /[.!?]$/, "종결부호 없이 끝났다");
  }
});

test("번역이 검증에 걸리면 영어 화면은 한국어를 그대로 쓴다", async () => {
  const { summary, stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return "없음";
    // 한글이 남은 번역은 번역이 아니다.
    if (kind === "translate") return "The ministry 발표했다.";
    return goodKo(prompt);
  });

  assert.match(stderr, /번역 검증 실패/);
  assert.ok(summary.categories.every((c) => c.lineEn === c.lineKo));
});

test("핵심 기사는 여러 매체가 다룬 순으로 뽑되 한 주제가 독차지하지 않는다", () => {
  const bodies = {};
  const items = [];
  for (let i = 0; i < 6; i += 1) {
    const link = `https://example.com/re${i}`;
    items.push({ title: `부동산 ${i}`, link, category: "realestate", dupes: [{}, {}] });
    bodies[link] = "가".repeat(400);
  }
  const stockLink = "https://example.com/stock";
  items.push({ title: "증시", link: stockLink, category: "stocks", dupes: [] });
  bodies[stockLink] = "나".repeat(400);

  const picked = pickHighlights(items, bodies);
  assert.equal(picked.length, 3);
  const realestate = picked.filter((p) => p.item.category === "realestate");
  assert.ok(realestate.length <= 2, "한 카테고리가 핵심을 독차지했다");
});

test("본문이 짧은 기사는 핵심으로 뽑지 않는다", () => {
  // 재료가 없으면 결국 제목을 늘여 쓰게 된다.
  const items = [{ title: "속보", link: "https://example.com/x", category: "stocks", dupes: [{}, {}] }];
  assert.deepEqual(pickHighlights(items, { "https://example.com/x": "짧다" }), []);
});
