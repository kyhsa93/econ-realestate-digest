import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { FALLBACK_CATEGORY, categoryOf } from "./categories.mjs";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "summary.json");
const historyFile = path.join(dataDir, "summary-history.json");
const HISTORY_MAX_DAYS = 180;

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:14b";
const DISABLE_THINKING = process.env.OLLAMA_THINK === "false";

const MAX_ITEMS_PER_CATEGORY = 5;

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
  const buckets = new Map();
  for (const item of items) {
    const matched = categoryOf(item);
    if (!buckets.has(matched)) buckets.set(matched, []);
    buckets.get(matched).push(item);
  }
  return [...buckets.entries()].map(([category, items]) => ({
    category,
    items,
    titles: items.map((i) => i.title ?? ""),
  }));
}

function stripHanzi(text) {
  return text.replace(/[一-鿿]/g, "");
}

function firstSentence(text) {
  const idx = text.search(/[.!?](?!\d)/);
  return idx === -1 ? text : text.slice(0, idx + 1);
}

function listCategory(label, titles) {
  const shown = titles.slice(0, 3).join(", ");
  const more = titles.length > 3 ? ` +${titles.length - 3}` : "";
  return `- ${label}: ${shown}${more}`;
}

function buildBucketPrompt(label, titles, isUngroupable) {
  const list = titles.slice(0, MAX_ITEMS_PER_CATEGORY).map((t, i) => `${i + 1}. ${t}`).join("\n");

  const intro = isUngroupable
    ? `다음은 오늘자 한국 경제 뉴스 제목들이야. 서로 주제가 다른 소식들이야.

${list}

이 제목들을 하나로 엮지 말고, 오늘 어떤 소식들이 있었는지 나열하듯 한국어 한 문장으로 요약해줘.`
    : `다음은 "${label}" 주제의 오늘자 한국 경제 뉴스 제목들이야.

${list}

이 제목들을 종합해서 한국어 한 문장으로 요약해줘.`;

  return `${intro}
규칙:
- 딱 한 문장만 출력해. 번호나 목록 형식 쓰지 마. 문장을 두 개 이상 잇지 마.
- 제목에 나온 단어와 사실만 사용하고, 제목에 없는 숫자·수치·전망·원인은 절대 지어내지 마.
- 숫자나 %, 금액을 문장에 절대 쓰지 마. 정확한 수치는 이미 다른 곳에 표로 나와 있으니, 여기서는 "상승", "증가", "발표" 같은 서술적 표현만 써.
- 서로 다른 제목을 인과관계("~때문에", "~해서")로 엮지 마. 각 제목은 독립된 별개의 사실이야.
- 단체·정당·기관·인물 이름은 제목에 적힌 표기를 그대로 써. 줄임말을 임의로 풀어쓰거나 다른 이름으로 바꾸지 마.
- 투자 조언이나 예측은 하지 마.
- 한국어(한글)로만 작성해. 한자, 중국어, 영어 단어를 섞지 마.

한 문장 요약:`;
}

async function callOllama(prompt, options) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options,
      ...(DISABLE_THINKING ? { think: false } : {}),
    }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const json = await res.json();
  if (!json.response) throw new Error("ollama 응답에 response 필드 없음");
  return json.response;
}

async function generateKoSentence(prompt) {
  const raw = await callOllama(prompt, { temperature: 0.1, top_p: 0.7, num_predict: 220 });
  const firstLine = stripHanzi(raw).trim().split("\n")[0].trim();
  return firstSentence(firstLine);
}

function containsUnverifiedNumber(sentence, sourceText) {
  const numbers = sentence.match(/\d[\d,.]*/g) ?? [];
  return numbers.some((n) => !sourceText.includes(n));
}

const MAX_EXTRACTED_ENTITIES = 10;
const MAX_ENTITY_LENGTH = 20;
const ENTITY_STOPWORDS = new Set([
  "정부", "시장", "경제", "금리", "주택", "부동산", "증시", "환율", "은행", "대출", "가격", "물가",
  "미디어", "언론", "당국", "업계", "기업", "정책", "지역", "소비자", "투자자", "국내", "해외",
]);
const ENTITY_SUFFIXES = ["지수", "증시", "시장", "정부", "당국", "은행", "그룹"];

const HANJA_COUNTRY_ABBREV = {
  韓: "한국", 日: "일본", 美: "미국", 中: "중국", 北: "북한", 英: "영국",
  獨: "독일", 佛: "프랑스", 露: "러시아", 伊: "이탈리아", 濠: "호주", 印: "인도", 加: "캐나다",
};

function expandHanjaAbbrev(text) {
  return text.replace(/[韓日美中北英獨佛露伊濠印加]/g, (c) => HANJA_COUNTRY_ABBREV[c] ?? c);
}

const KOREAN_ABBREV_PAIRS = [
  ["국힘", "국민의힘"], ["한은", "한국은행"], ["국토부", "국토교통부"], ["기재부", "기획재정부"],
  ["금감원", "금융감독원"], ["금융위", "금융위원회"], ["공정위", "공정거래위원회"],
  ["산업부", "산업통상자원부"], ["복지부", "보건복지부"], ["노동부", "고용노동부"],
  ["중기부", "중소벤처기업부"], ["해수부", "해양수산부"], ["행안부", "행정안전부"],
  ["부동산원", "한국부동산원"], ["주금공", "한국주택금융공사"], ["산은", "산업은행"],
  ["기은", "기업은행"], ["국조실", "국무조정실"],
];

function alternateAbbrevForms(text) {
  return KOREAN_ABBREV_PAIRS.flatMap(([short, full]) => {
    if (text.includes(short)) return [full];
    if (text.includes(full)) return [short];
    return [];
  }).join(" ");
}

function normalizeForEntityMatch(text) {
  return text.replace(/[^\p{L}\p{N}]/gu, "");
}

async function extractProperNouns(sentence) {
  const prompt = `다음 문장에서 고유명사(기관·기업·인물·지역·지수 이름)만 골라 쉼표로 구분해 나열해.
고유명사가 없으면 "없음"이라고만 답해. 설명이나 다른 말은 절대 하지 마.

문장: ${sentence}

고유명사:`;

  const raw = await callOllama(prompt, { temperature: 0, top_p: 0.5, num_predict: 60 });
  return raw
    .trim()
    .split("\n")[0]
    .split(/[,、]/)
    .map((token) => token.trim().replace(/^[-*\d.\s]+/, ""))
    .filter((token) => token.length >= 2 && token.length <= MAX_ENTITY_LENGTH && !/없음|none/i.test(token))
    .slice(0, MAX_EXTRACTED_ENTITIES);
}

async function unverifiedEntities(sentence, sourceText) {
  let entities;
  try {
    entities = await extractProperNouns(sentence);
  } catch (err) {
    console.error(`[summarize-digest] 고유명사 추출 실패, 통과 처리: ${err.message}`);
    return [];
  }

  const haystack = normalizeForEntityMatch(
    `${sourceText} ${expandHanjaAbbrev(sourceText)} ${alternateAbbrevForms(sourceText)}`
  );
  return entities.filter((entity) => {
    if (ENTITY_STOPWORDS.has(entity)) return false;
    const normalized = normalizeForEntityMatch(entity);
    if (!normalized || haystack.includes(normalized)) return false;
    const stripped = ENTITY_SUFFIXES.reduce(
      (acc, suffix) => (acc.endsWith(suffix) && acc.length > suffix.length ? acc.slice(0, -suffix.length) : acc),
      normalized
    );
    return !(stripped.length >= 2 && haystack.includes(stripped));
  });
}

const FALLBACK_REASONS = {
  GENERATION_FAILED: "generation-failed",
  UNVERIFIED_NUMBER: "unverified-number",
  UNVERIFIED_ENTITY: "unverified-entity",
};

async function summarizeBucketKo(bucket) {
  const label = bucket.category.name;
  const isUngroupable = bucket.category === FALLBACK_CATEGORY;

  const sourceText = bucket.titles.join(" ");
  const prompt = buildBucketPrompt(label, bucket.titles, isUngroupable);

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

  if (sentence) {
    const unverified = await unverifiedEntities(sentence, sourceText);
    if (unverified.length > 0) {
      console.error(
        `[summarize-digest] "${label}" 요약에 원문에 없는 고유명사(${unverified.join(", ")}) 포함: ${sentence}`
      );
      sentence = null;
      reason = FALLBACK_REASONS.UNVERIFIED_ENTITY;
    }
  }

  if (!sentence) {
    return { line: listCategory(label, bucket.titles), fallbackReason: reason ?? FALLBACK_REASONS.GENERATION_FAILED };
  }

  return { line: `- ${sentence}`, fallbackReason: null };
}

function isBadTranslation(text, original, requiredNumbers) {
  if (!text) return true;
  if (/[가-힣]/.test(text)) return true;
  if (/[一-鿿]/.test(text)) return true;
  if (text.length > Math.max(240, original.length * 4)) return true;
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
Translate names of parties, institutions and people literally. Do NOT add roles or descriptions that are not in the Korean sentence (for example, never label a party as "ruling" or "opposition").
Output ONLY the translated sentence. No quotes, no explanation.

Korean: ${normalized}

English:`;

  let translated;
  try {
    const raw = await callOllama(prompt, { temperature: 0.2, top_p: 0.8, num_predict: 300 });
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
  }

  const today = kstDateString(now);
  const record = { date: today, ...entry };

  const idx = history.findIndex((h) => h.date === today);
  if (idx >= 0) {
    history[idx] = record;
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
  const newsDate = news.date ?? kstDateString(new Date(news.updatedAt ?? now));
  if (newsDate !== today) {
    console.error(`[summarize-digest] news.json이 오늘(${today}) 것이 아님(${newsDate}), 요약 생략`);
    return;
  }

  const buckets = categorize(news.items);
  const koLines = [];
  const enLines = [];
  const categoryEntries = [];

  for (const bucket of buckets) {
    const { line: koLine, fallbackReason } = await summarizeBucketKo(bucket);
    const isFallback = fallbackReason !== null;
    koLines.push(koLine);

    let enLine;
    if (isFallback) {
      enLine = listCategory(bucket.category.nameEn, bucket.titles);
    } else {
      enLine = await translateKoLine(koLine);
    }
    enLines.push(enLine);

    categoryEntries.push({
      key: bucket.category.key,
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

  const fallen = categoryEntries.filter((c) => c.isFallback);
  const breakdown = [...new Set(fallen.map((c) => c.fallbackReason))]
    .map((r) => `${r} x${fallen.filter((c) => c.fallbackReason === r).length}`)
    .join(", ");
  console.log(
    `[summarize-digest] 저장 완료 (폴백 ${fallen.length}/${categoryEntries.length}${breakdown ? `: ${breakdown}` : ""})`
  );
}

main();
