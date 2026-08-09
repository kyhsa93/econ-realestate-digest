import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "summary.json");
const historyFile = path.join(dataDir, "summary-history.json");
const HISTORY_MAX_DAYS = 180;

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:1.5b";

// 소형 모델(1.5B)에게 "15개 제목을 통째로 보고 알아서 그룹핑"을 시키면
// 그룹핑을 안 하거나(전부 나열) 숫자를 지어내는 문제가 있었음.
// 그래서 그룹핑은 키워드로 결정론적으로 먼저 하고, LLM은 카테고리 하나당
// "이미 비슷한 제목들"만 보고 한 문장으로 압축하는 훨씬 쉬운 일만 시킨다.
// 한국어/영어 요약을 각각 별도로 생성한다 (번역이 아니라 언어별로 따로 생성).
const CATEGORIES = [
  {
    name: "금리·예금·투자상품",
    nameEn: "Rates, Deposits & Investment Products",
    keywords: ["금리", "예금", "저축", "IMA", "발행어음", "펀드", "채권", "증권사"],
  },
  {
    name: "부동산",
    nameEn: "Real Estate",
    keywords: ["아파트", "부동산", "전세", "월세", "매물", "분양", "세제", "주택", "재건축", "청약"],
  },
  {
    name: "증시·환율",
    nameEn: "Stocks & FX",
    keywords: ["코스피", "코스닥", "증시", "주가", "환율", "달러", "원화"],
  },
];
const FALLBACK_CATEGORY = { name: "기타 경제 소식", nameEn: "Other Economic News", keywords: [] };
const MAX_ITEMS_PER_CATEGORY = 5;

function kstDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, `${name}.json`), "utf-8"));
  } catch {
    return null;
  }
}

function categorize(items) {
  const buckets = new Map(); // category object -> titles[]
  for (const item of items) {
    const title = item.title ?? "";
    const matched = CATEGORIES.find((c) => c.keywords.some((k) => title.includes(k))) ?? FALLBACK_CATEGORY;
    if (!buckets.has(matched)) buckets.set(matched, []);
    buckets.get(matched).push(title);
  }
  return [...buckets.entries()].map(([category, titles]) => ({ category, titles }));
}

function stripHanzi(text) {
  // 소형 모델이 가끔 한자를 섞어 출력하는 경우가 있어 방어적으로 제거
  return text.replace(/[一-鿿]/g, "");
}

function stripHangul(text) {
  // 영어 요약에 한글이 그대로 섞여 나오는 경우가 있어 방어적으로 제거
  return text.replace(/[가-힣ᄀ-ᇿ㄰-㆏]/g, "");
}

// "생성된 숫자가 원문 어딘가에 있는지"만 substring으로 검증했더니, 원문의
// 다른(무관한) 숫자와 우연히 겹치기만 해도 통과되면서 실제로는 지어낸 금액
// ("200억 원", "824억 원" 등)이 그대로 노출되는 사례가 나왔다. 숫자가 어떤
// 맥락에서 왜 등장했는지까지 검증할 방법이 없으니, 아예 LLM이 합성한 문장에는
// 숫자를 하나도 허용하지 않는다 (실제 정확한 수치는 시장 지표 카드에 이미
// 별도로 정확하게 표시되고 있으므로, 요약 문장에서는 없어도 정보 손실이 적다).
function containsAnyNumber(sentence) {
  return /\d/.test(sentence);
}

// 모델이 "한 문장만"을 지키지 않고 여러 문장을 이어 쓰면서
// 서로 다른 제목을 하나의 인과관계로 엮어 지어내는 경우가 있어,
// 첫 문장 하나만 잘라서 사용한다.
function firstSentence(text) {
  const idx = text.search(/[.!?](?!\d)/);
  return idx === -1 ? text : text.slice(0, idx + 1);
}

function listCategory(label, titles) {
  const shown = titles.slice(0, 3).join(", ");
  const more = titles.length > 3 ? ` +${titles.length - 3}` : "";
  return `- ${label}: ${shown}${more}`;
}

function buildBucketPrompt(label, titles, lang) {
  const list = titles.slice(0, MAX_ITEMS_PER_CATEGORY).map((t, i) => `${i + 1}. ${t}`).join("\n");

  if (lang === "ko") {
    return `다음은 "${label}" 주제의 오늘자 한국 경제 뉴스 제목들이야.

${list}

이 제목들을 종합해서 한국어 한 문장으로 요약해줘.
규칙:
- 딱 한 문장만 출력해. 번호나 목록 형식 쓰지 마. 문장을 두 개 이상 잇지 마.
- 제목에 나온 단어와 사실만 사용하고, 제목에 없는 숫자·수치·전망·원인은 절대 지어내지 마.
- 숫자나 %, 금액을 문장에 절대 쓰지 마. 정확한 수치는 이미 다른 곳에 표로 나와 있으니, 여기서는 "상승", "증가", "발표" 같은 서술적 표현만 써.
- 서로 다른 제목을 인과관계("~때문에", "~해서")로 엮지 마. 각 제목은 독립된 별개의 사실이야.
- 투자 조언이나 예측은 하지 마.
- 한국어(한글)로만 작성해. 한자, 중국어, 영어 단어를 섞지 마.

한 문장 요약:`;
  }

  return `The following are today's Korean economic news headlines (originally written in Korean) under the topic "${label}":

${list}

Summarize these into exactly ONE English sentence.
Rules:
- Output exactly one sentence. No lists or numbering. Do not chain two or more sentences together.
- Only use facts and words actually present in the headlines above; never invent numbers, figures, forecasts, or causes that aren't stated.
- Never include any numbers, percentages, or amounts in the sentence. Exact figures are already shown elsewhere on the page — describe qualitatively instead (e.g. "rose", "increased", "announced").
- Do not connect different headlines with causal language ("because", "as a result", "due to") — each headline is an independent, unrelated fact.
- Do not give investment advice or predictions.
- Write only in English. Do not leave any Korean or Chinese words untranslated.

One-sentence summary:`;
}

async function generate(prompt, lang) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.1, top_p: 0.7, num_predict: 80 },
    }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const json = await res.json();
  if (!json.response) throw new Error("ollama 응답에 response 필드 없음");
  let text = stripHanzi(json.response);
  if (lang === "en") text = stripHangul(text);
  const firstLine = text.trim().split("\n")[0].trim();
  return firstSentence(firstLine);
}

async function summarizeBucketLine(bucket, lang) {
  const label = lang === "ko" ? bucket.category.name : bucket.category.nameEn;

  // "기타" 묶음은 애초에 주제가 하나로 안 묶이는 제목들이라, LLM에게 하나의
  // 문장으로 합성시키면 서로 무관한 사건을 억지로 엮어 지어내기 쉽다.
  // 그래서 합성 없이 결정론적으로 나열만 한다 (제목 자체는 언어와 무관하게 원문 그대로).
  if (bucket.category === FALLBACK_CATEGORY) {
    return listCategory(label, bucket.titles);
  }

  const prompt = buildBucketPrompt(label, bucket.titles, lang);

  let sentence;
  try {
    sentence = await generate(prompt, lang);
  } catch (err) {
    console.error(`[summarize-digest] "${label}" (${lang}) 요약 실패: ${err.message}`);
    sentence = null;
  }

  if (!sentence || containsAnyNumber(sentence)) {
    if (sentence) {
      console.error(`[summarize-digest] "${label}" (${lang}) 요약에 숫자 포함, 대체 문구 사용: ${sentence}`);
    }
    sentence = lang === "ko" ? `${label} 관련 뉴스 ${bucket.titles.length}건` : `${bucket.titles.length} news items about ${label}`;
  }

  return `- ${sentence}`;
}

async function appendHistory(now, entry) {
  let history = [];
  try {
    history = JSON.parse(await readFile(historyFile, "utf-8"));
  } catch {
    // 최초 실행이면 이전 기록 없음
  }

  const today = kstDateString(now);
  const record = { date: today, ...entry };

  const idx = history.findIndex((h) => h.date === today);
  if (idx >= 0) {
    history[idx] = record; // 같은 날 재실행 시 덮어쓰기 (중복 방지)
  } else {
    history.push(record);
  }

  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length > HISTORY_MAX_DAYS) {
    history = history.slice(history.length - HISTORY_MAX_DAYS);
  }

  await writeFile(historyFile, JSON.stringify(history, null, 2));
}

async function main() {
  const news = await readJson("news");

  if (!news?.items?.length) {
    console.error("[summarize-digest] news 데이터 없음, 요약 생략");
    return;
  }

  const buckets = categorize(news.items);
  const koLines = [];
  const enLines = [];
  for (const bucket of buckets) {
    koLines.push(await summarizeBucketLine(bucket, "ko"));
    enLines.push(await summarizeBucketLine(bucket, "en"));
  }

  if (koLines.length === 0) {
    console.error("[summarize-digest] 요약할 카테고리 없음");
    return;
  }

  const now = new Date();
  const summary = { ko: koLines.join("\n"), en: enLines.join("\n") };

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    outFile,
    JSON.stringify({ updatedAt: now.toISOString(), model: MODEL, summary }, null, 2)
  );
  await appendHistory(now, { model: MODEL, summary });

  console.log("[summarize-digest] 저장 완료");
}

main();
