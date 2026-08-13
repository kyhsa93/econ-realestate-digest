import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "summary.json");
const historyFile = path.join(dataDir, "summary-history.json");
const HISTORY_MAX_DAYS = 180;

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";

// 소형 모델(1.5B)에게 "15개 제목을 통째로 보고 알아서 그룹핑"을 시키면
// 그룹핑을 안 하거나(전부 나열) 숫자를 지어내는 문제가 있었음.
// 그래서 그룹핑은 키워드로 결정론적으로 먼저 하고, LLM은 카테고리 하나당
// "이미 비슷한 제목들"만 보고 한 문장으로 압축하는 훨씬 쉬운 일만 시킨다.
//
// 파이프라인: 한국어 요약 생성 -> (숫자 검증 + YES/NO 검수) -> 통과한 것만
// 영어로 번역 -> 번역도 검증. 예전엔 한국어/영어를 각각 헤드라인에서 독립
// 생성했는데, "요약과 번역을 동시에" 시키는 게 오류가 더 많아서(예: 영어
// 버전에서 "15억원"을 "yuan"으로 오역 + 없는 통계까지 지어냄) 순서를 바꿈.
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

// 한국어는 만/억/조 단위로 4자리씩 묶어 읽어서(영어의 천 단위 그룹과 다름),
// 작은 모델이 "8천만원"을 "$8 million"으로, "15억원"을 "15 million won"으로
// 자릿수/통화를 통째로 잘못 바꾸는 사례가 실제로 나왔다. 모델에게 단위 환산을
// 맡기지 않고, 코드에서 먼저 아라비아 숫자로 바꿔준 뒤 번역을 시킨다.
// ("기타" 카테고리의 헤드라인 나열 줄을 번역할 때 실제로 쓰인다 - 생성된
// 요약 문장은 애초에 숫자를 안 쓰도록 지시하므로 대부분 no-op.)
const MAJOR_UNITS = { 조: 1_000_000_000_000, 억: 100_000_000, 만: 10_000 };
const MINOR_UNITS = { 천: 1_000, 백: 100, 십: 10 };

function parseCoefficient(str) {
  let value = 0;
  let rest = str;
  for (const unit of Object.keys(MINOR_UNITS)) {
    const idx = rest.indexOf(unit);
    if (idx !== -1) {
      const numPart = rest.slice(0, idx);
      value += (numPart === "" ? 1 : Number(numPart)) * MINOR_UNITS[unit];
      rest = rest.slice(idx + unit.length);
    }
  }
  if (rest !== "") value += Number(rest);
  return value;
}

function normalizeKoreanAmounts(text) {
  const numTokenRe = "\\d+(?:\\.\\d+)?(?:천|백|십)?";
  let result = text.replace(
    new RegExp(`(${numTokenRe})(억|조)\\s*(${numTokenRe})(만)`, "g"),
    (_m, c1, u1, c2, u2) => (parseCoefficient(c1) * MAJOR_UNITS[u1] + parseCoefficient(c2) * MAJOR_UNITS[u2]).toLocaleString("en-US")
  );
  result = result.replace(
    new RegExp(`(${numTokenRe})(조|억|만)`, "g"),
    (_m, c, u) => (parseCoefficient(c) * MAJOR_UNITS[u]).toLocaleString("en-US")
  );
  return result;
}

function extractNormalizedNumbers(original, normalized) {
  if (original === normalized) return [];
  const numbers = normalized.match(/\d{1,3}(?:,\d{3})+/g) ?? [];
  return numbers.map((n) => n.replace(/,/g, ""));
}

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
  const buckets = new Map(); // category object -> news item[]
  for (const item of items) {
    const title = item.title ?? "";
    const matched = CATEGORIES.find((c) => c.keywords.some((k) => title.includes(k))) ?? FALLBACK_CATEGORY;
    if (!buckets.has(matched)) buckets.set(matched, []);
    buckets.get(matched).push(item);
  }
  // titles는 요약 생성/검증 코드가 계속 문자열 배열로 쓰므로 그대로 유지하고,
  // items(원문 title/link/source)는 요약의 근거가 된 기사 링크를 노출하는 데 쓴다.
  return [...buckets.entries()].map(([category, items]) => ({
    category,
    items,
    titles: items.map((i) => i.title ?? ""),
  }));
}

function stripHanzi(text) {
  // 소형 모델이 가끔 한자를 섞어 출력하는 경우가 있어 방어적으로 제거
  return text.replace(/[一-鿿]/g, "");
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

function buildBucketPrompt(label, titles) {
  const list = titles.slice(0, MAX_ITEMS_PER_CATEGORY).map((t, i) => `${i + 1}. ${t}`).join("\n");

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

async function callOllama(prompt, options) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, options }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const json = await res.json();
  if (!json.response) throw new Error("ollama 응답에 response 필드 없음");
  return json.response;
}

async function generateKoSentence(prompt) {
  const raw = await callOllama(prompt, { temperature: 0.1, top_p: 0.7, num_predict: 80 });
  const firstLine = stripHanzi(raw).trim().split("\n")[0].trim();
  return firstSentence(firstLine);
}

// "생성된 숫자가 원문 어딘가에 있는지"만 substring으로 검증했더니, 원문의
// 다른(무관한) 숫자와 우연히 겹치기만 해도 통과되면서 실제로는 지어낸 금액이
// 그대로 노출되는 사례가 나왔었다("200억 원" 등). 반대로 숫자를 아예 전부
// 금지했더니 이번엔 대부분의 요약이 검증 실패로 "OO 관련 뉴스 N건" 같은
// 정보 없는 대체 문구로 빠져버렸다(사용자 피드백). 번역과 달리 이건 같은
// 언어·같은 카테고리 안에서만 요약하는 거라 단위 환산 오류 위험은 없으므로,
// 다시 substring 검증으로 되돌리되 실패 시 폴백을 "N건"이 아니라 실제
// 헤드라인 나열로 바꿔서, 어느 쪽이든 최소한 실질적인 내용은 보이게 한다.
function containsUnverifiedNumber(sentence, sourceText) {
  const numbers = sentence.match(/\d[\d,.]*/g) ?? [];
  return numbers.some((n) => !sourceText.includes(n));
}

// 숫자 검증을 통과해도 "원문에 없는 기관·기업·인물·지역을 끌어다 붙이는"
// 잔여 위험이 있어, 별도로 한 번 더 확인한다. 작은 모델에게 "틀린 부분을
// 알아서 고쳐 써라"는 못 믿을 일이라(잘못 고치다가 새로운 오류를 만들 수
// 있음), 여기서는 YES/NO 판정만 시키고 NO가 나오면 고쳐 쓰게 하지 않고
// 곧장 안전한 헤드라인 나열로 대체한다.
//
// 예전 프롬프트는 "원문에 없는 숫자·통계·인과관계·사실이 하나라도 섞여
// 있으면 NO"였는데, 이 기준이 요약이라면 당연히 하게 되는 압축·재서술까지
// 걸러내면서 3b 모델이 사실상 전부 NO를 뱉었다(실제로 CI에서 3일 연속
// 모든 카테고리가 폴백 처리돼 "AI 요약"이 헤드라인 나열만 남았음 - 원문
// 제목을 거의 그대로 옮긴 문장까지 NO 판정). 검증 대상을 "원문에 없는
// 숫자·고유명사"로 좁히고, 압축/재서술은 명시적으로 허용한다.
async function reviewKoSentence(sentence, titles) {
  const list = titles.slice(0, MAX_ITEMS_PER_CATEGORY).map((t, i) => `${i + 1}. ${t}`).join("\n");
  const prompt = `다음은 원문 뉴스 제목들과, 그걸 요약했다는 문장이야.

[원문 제목]
${list}

[요약 문장]
${sentence}

요약 문장에 원문 제목에 없는 숫자나 고유명사(기관·기업·인물·지역 이름)가 들어 있으면 "NO",
그렇지 않으면 "YES"라고만 답해.
여러 제목을 한 문장으로 압축하거나, 표현을 바꿔 쓰거나, "상승세"·"우려" 같은 일반적인
서술을 쓴 것은 문제가 아니야. 그런 경우엔 "YES"라고 답해.
다른 말은 하지 마.`;

  try {
    const raw = await callOllama(prompt, { temperature: 0, top_p: 0.5, num_predict: 8 });
    const text = raw.trim().toLowerCase();
    if (text.startsWith("no")) return false;
    if (text.startsWith("yes")) return true;
    return true; // 판정이 애매하면 통과시킴 (검수 실패로 과도하게 폐기하지 않기 위함)
  } catch (err) {
    console.error(`[summarize-digest] 검수 실패, 통과 처리: ${err.message}`);
    return true;
  }
}

// isFallback도 함께 반환한다: 폴백(헤드라인 나열)이면 main()에서 영어
// 버전도 문장 번역 없이 nameEn으로 결정론적으로 만들어서, 번역까지 실패했을
// 때 영어 요약에 한국어 카테고리 라벨이 섞여 남는 걸 방지한다.
//
// fallbackReason은 어느 단계에서 걸러졌는지를 summary.json에 남기기 위한 것.
// 폴백은 화면상 "라벨: 제목 나열"이라 정상 요약과 구분이 잘 안 가서, 검수가
// 과하게 빡빡해져 전 카테고리가 조용히 폴백으로 떨어져도 눈치채기 어려웠다.
const FALLBACK_REASONS = {
  UNGROUPABLE: "ungroupable-category", // "기타" 묶음 - 설계상 항상 폴백
  GENERATION_FAILED: "generation-failed",
  UNVERIFIED_NUMBER: "unverified-number",
  REVIEW_REJECTED: "review-rejected",
};

async function summarizeBucketKo(bucket) {
  const label = bucket.category.name;

  // "기타" 묶음은 애초에 주제가 하나로 안 묶이는 제목들이라, LLM에게 하나의
  // 문장으로 합성시키면 서로 무관한 사건을 억지로 엮어 지어내기 쉽다.
  // 그래서 합성 없이 결정론적으로 나열만 한다.
  if (bucket.category === FALLBACK_CATEGORY) {
    return { line: listCategory(label, bucket.titles), fallbackReason: FALLBACK_REASONS.UNGROUPABLE };
  }

  const sourceText = bucket.titles.join(" ");
  const prompt = buildBucketPrompt(label, bucket.titles);

  let sentence;
  let reason = null;
  try {
    sentence = await generateKoSentence(prompt);
  } catch (err) {
    console.error(`[summarize-digest] "${label}" 요약 실패: ${err.message}`);
    sentence = null;
    reason = FALLBACK_REASONS.GENERATION_FAILED;
  }

  if (sentence && containsUnverifiedNumber(sentence, sourceText)) {
    console.error(`[summarize-digest] "${label}" 요약에 검증 안 된 숫자 포함: ${sentence}`);
    sentence = null;
    reason = FALLBACK_REASONS.UNVERIFIED_NUMBER;
  }

  if (sentence && !(await reviewKoSentence(sentence, bucket.titles))) {
    console.error(`[summarize-digest] "${label}" 요약이 검수 실패(NO): ${sentence}`);
    sentence = null;
    reason = FALLBACK_REASONS.REVIEW_REJECTED;
  }

  if (!sentence) {
    return { line: listCategory(label, bucket.titles), fallbackReason: reason ?? FALLBACK_REASONS.GENERATION_FAILED };
  }

  return { line: `- ${sentence}`, fallbackReason: null };
}

// 번역이 아니라 원문을 그대로 남기거나(한글이 그대로 섞여 있음), 모델이
// 딴소리를 늘어놓은 경우(비정상적으로 길어짐), 혹은 코드로 미리 정규화해 넘긴
// 큰 숫자를 모델이 누락/변형한 경우(단위 환산 오류의 잔여 위험)를 걸러내
// 원문 한국어로 폴백한다. (translate-news.mjs와 동일한 검증 로직)
function isBadTranslation(text, original, requiredNumbers) {
  if (!text) return true;
  if (/[가-힣]/.test(text)) return true;
  if (/[一-鿿]/.test(text)) return true;
  if (text.length > Math.max(160, original.length * 3)) return true;
  const textDigits = text.replace(/,/g, "");
  if (requiredNumbers.some((n) => !textDigits.includes(n))) return true;
  return false;
}

async function translateKoLine(koLine) {
  const text = koLine.replace(/^-\s*/, "");
  const normalized = normalizeKoreanAmounts(text);
  const requiredNumbers = extractNormalizedNumbers(text, normalized);

  const prompt = `Translate the following Korean sentence into natural, concise English.
The sentence may already contain plain Arabic numerals (e.g. "80,000,000") - if so, keep those numbers exactly as they are, do not round or rewrite them, just translate the surrounding Korean words (e.g. "원" -> "won").
Write the translation in English only - do not use Chinese characters or any other language.
Output ONLY the translated sentence. No quotes, no explanation.

Korean: ${normalized}

English:`;

  let translated;
  try {
    const raw = await callOllama(prompt, { temperature: 0.2, top_p: 0.8, num_predict: 120 });
    translated = raw.trim().split("\n")[0].trim().replace(/^["'“‘]+|["'”’]+$/g, "");
  } catch (err) {
    console.error(`[summarize-digest] 번역 실패, 한국어 유지: ${err.message}`);
    return koLine;
  }

  if (isBadTranslation(translated, text, requiredNumbers)) {
    console.error(`[summarize-digest] 번역 검증 실패, 한국어 유지: ${translated}`);
    return koLine;
  }

  return `- ${translated}`;
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

  const now = new Date();
  const today = kstDateString(now);
  // news.json의 date(KST)는 fetch-news.mjs에서 매겨진다. RSS가 그날 전부
  // 실패하면 fetch-news.mjs는 news.json을 갱신하지 않고 조용히 넘어가므로,
  // 디스크에 남아있는 news.json이 실제로 "오늘" 것인지 확인하지 않으면 어제
  // 뉴스로 오늘 날짜 요약을 만들어버릴 수 있다. date 필드가 없는 과거
  // news.json(이 검증을 추가하기 전에 저장된 것)은 updatedAt으로 대체 판단.
  const newsDate = news.date ?? kstDateString(new Date(news.updatedAt ?? now));
  if (newsDate !== today) {
    console.error(`[summarize-digest] news.json이 오늘(${today}) 것이 아님(${newsDate}), 요약 생략`);
    return;
  }

  const buckets = categorize(news.items);
  const koLines = [];
  const enLines = [];
  // 요약 문장이 어떤 기사를 근거로 했는지 화면에서 바로 확인할 수 있도록,
  // 실제로 프롬프트에 넣은 만큼(MAX_ITEMS_PER_CATEGORY)만 링크로 남긴다.
  const categoryEntries = [];

  for (const bucket of buckets) {
    const { line: koLine, fallbackReason } = await summarizeBucketKo(bucket);
    const isFallback = fallbackReason !== null;
    koLines.push(koLine);

    let enLine;
    if (isFallback) {
      // 헤드라인을 그대로 나열한 줄(원래 "기타"거나, 다른 카테고리가 생성/검증/
      // 검수에 실패해 나열로 대체된 경우)은 문장 번역이 아니라 카테고리 레이블만
      // nameEn으로 바꾸면 되고, 원문 헤드라인 자체는 한/영 모두 한국어 그대로
      // 유지한다. 번역까지 실패했을 때 영어 요약에 한국어 라벨이 남는 걸 방지.
      enLine = listCategory(bucket.category.nameEn, bucket.titles);
    } else {
      enLine = await translateKoLine(koLine);
    }
    enLines.push(enLine);

    categoryEntries.push({
      name: bucket.category.name,
      nameEn: bucket.category.nameEn,
      lineKo: koLine.replace(/^-\s*/, ""),
      lineEn: enLine.replace(/^-\s*/, ""),
      isFallback,
      fallbackReason,
      items: bucket.items
        .slice(0, MAX_ITEMS_PER_CATEGORY)
        .map((i) => ({ title: i.title, link: i.link, source: i.source })),
    });
  }

  if (koLines.length === 0) {
    console.error("[summarize-digest] 요약할 카테고리 없음");
    return;
  }

  const summary = { ko: koLines.join("\n"), en: enLines.join("\n") };

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    outFile,
    JSON.stringify({ updatedAt: now.toISOString(), model: MODEL, summary, categories: categoryEntries }, null, 2)
  );
  await appendHistory(now, { model: MODEL, summary, categories: categoryEntries });

  // 카테고리별 실패는 이미 위에서 개별로 로그를 남기지만, "오늘 몇 개가
  // 폴백이었나"는 로그를 다 훑어야 알 수 있었다. 한 줄로 집계해서 남긴다.
  // ("기타" 묶음은 설계상 항상 폴백이라 분모에서 제외한다.)
  const summarizable = categoryEntries.filter((c) => c.fallbackReason !== FALLBACK_REASONS.UNGROUPABLE);
  const fallen = summarizable.filter((c) => c.isFallback);
  const breakdown = [...new Set(fallen.map((c) => c.fallbackReason))]
    .map((r) => `${r} x${fallen.filter((c) => c.fallbackReason === r).length}`)
    .join(", ");
  console.log(
    `[summarize-digest] 저장 완료 (폴백 ${fallen.length}/${summarizable.length}${breakdown ? `: ${breakdown}` : ""})`
  );
}

main();
