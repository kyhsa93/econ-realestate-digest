import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "summary.json");

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:1.5b";

// 소형 모델(1.5B)에게 "15개 제목을 통째로 보고 알아서 그룹핑"을 시키면
// 그룹핑을 안 하거나(전부 나열) 숫자를 지어내는 문제가 있었음.
// 그래서 그룹핑은 키워드로 결정론적으로 먼저 하고, LLM은 카테고리 하나당
// "이미 비슷한 제목들"만 보고 한 문장으로 압축하는 훨씬 쉬운 일만 시킨다.
const CATEGORIES = [
  { name: "금리·예금·투자상품", keywords: ["금리", "예금", "저축", "IMA", "발행어음", "펀드", "채권", "증권사"] },
  { name: "부동산", keywords: ["아파트", "부동산", "전세", "월세", "매물", "분양", "세제", "주택", "재건축", "청약"] },
  { name: "증시·환율", keywords: ["코스피", "코스닥", "증시", "주가", "환율", "달러", "원화"] },
];
const FALLBACK_CATEGORY = "기타 경제 소식";
const MAX_ITEMS_PER_CATEGORY = 8;

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, `${name}.json`), "utf-8"));
  } catch {
    return null;
  }
}

function categorize(items) {
  const buckets = new Map();
  for (const item of items) {
    const title = item.title ?? "";
    const matched = CATEGORIES.find((c) => c.keywords.some((k) => title.includes(k)));
    const name = matched?.name ?? FALLBACK_CATEGORY;
    if (!buckets.has(name)) buckets.set(name, []);
    buckets.get(name).push(title);
  }
  return buckets;
}

function stripHanzi(text) {
  // 소형 모델이 가끔 한자를 섞어 출력하는 경우가 있어 방어적으로 제거
  return text.replace(/[一-鿿]/g, "");
}

function containsUnverifiedNumber(sentence, sourceText) {
  const numbers = sentence.match(/\d[\d,.]*/g) ?? [];
  return numbers.some((n) => !sourceText.includes(n));
}

function buildBucketPrompt(category, titles) {
  const list = titles.slice(0, MAX_ITEMS_PER_CATEGORY).map((t, i) => `${i + 1}. ${t}`).join("\n");
  return `다음은 "${category}" 주제의 오늘자 한국 경제 뉴스 제목들이야.

${list}

이 제목들을 종합해서 한국어 한 문장으로 요약해줘.
규칙:
- 딱 한 문장만 출력해. 번호나 목록 형식 쓰지 마.
- 제목에 나온 단어와 사실만 사용하고, 제목에 없는 숫자·수치·전망·원인은 절대 지어내지 마.
- 투자 조언이나 예측은 하지 마.
- 한국어(한글)로만 작성해. 한자, 중국어, 영어 단어를 섞지 마.

한 문장 요약:`;
}

async function generate(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.1, top_p: 0.7, num_predict: 120 },
    }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const json = await res.json();
  if (!json.response) throw new Error("ollama 응답에 response 필드 없음");
  return stripHanzi(json.response).trim().split("\n")[0].trim();
}

async function summarizeBucket(category, titles) {
  const sourceText = titles.join(" ");
  const prompt = buildBucketPrompt(category, titles);

  let sentence;
  try {
    sentence = await generate(prompt);
  } catch (err) {
    console.error(`[summarize-digest] "${category}" 요약 실패: ${err.message}`);
    sentence = null;
  }

  if (!sentence || containsUnverifiedNumber(sentence, sourceText)) {
    if (sentence) {
      console.error(`[summarize-digest] "${category}" 요약에 검증 안 된 숫자 포함, 대체 문구 사용: ${sentence}`);
    }
    sentence = `${category} 관련 뉴스 ${titles.length}건`;
  }

  return `- ${sentence}`;
}

async function main() {
  const news = await readJson("news");

  if (!news?.items?.length) {
    console.error("[summarize-digest] news 데이터 없음, 요약 생략");
    return;
  }

  const buckets = categorize(news.items);
  const lines = [];
  for (const [category, titles] of buckets) {
    lines.push(await summarizeBucket(category, titles));
  }

  if (lines.length === 0) {
    console.error("[summarize-digest] 요약할 카테고리 없음");
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    outFile,
    JSON.stringify({ updatedAt: new Date().toISOString(), model: MODEL, summary: lines.join("\n") }, null, 2)
  );

  console.log("[summarize-digest] 저장 완료");
}

main();
