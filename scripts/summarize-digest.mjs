import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { FALLBACK_CATEGORY, categoryOf } from "./categories.mjs";

const dataDir = process.env.SUMMARY_DATA_DIR
  ? path.resolve(process.env.SUMMARY_DATA_DIR)
  : path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "summary.json");
const sourceFile = process.env.SUMMARY_SOURCE_FILE
  ? path.resolve(process.env.SUMMARY_SOURCE_FILE)
  : path.join(dataDir, "summary-source.json");
const historyFile = path.join(dataDir, "summary-history.json");
const bodiesFile = process.env.NEWS_BODIES_FILE
  ? path.resolve(process.env.NEWS_BODIES_FILE)
  : path.resolve(import.meta.dirname, "../cache/news-bodies.json");
const HISTORY_MAX_DAYS = 180;

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:14b";
const DISABLE_THINKING = process.env.OLLAMA_THINK === "false";

const MAX_ITEMS_PER_CATEGORY = 5;
const BODY_CHARS_IN_CATEGORY_PROMPT = 400;
const BODY_CHARS_IN_HIGHLIGHT_PROMPT = 900;

const CATEGORY_SENTENCES = 5;
const HIGHLIGHT_SENTENCES = 3;
const HIGHLIGHT_COUNT = 4;
const MAX_HIGHLIGHTS_PER_CATEGORY = 2;
const MIN_HIGHLIGHT_BODY = 250;

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

const COEFFICIENT = "\\d+(?:\\.\\d+)?(?:(?:천|백|십)\\d*)?";
const MAJOR_UNIT = "(?:조|억|만)";
const AMOUNT_RUN = new RegExp(`${COEFFICIENT}${MAJOR_UNIT}(?:\\s*${COEFFICIENT}${MAJOR_UNIT})*`, "g");
const AMOUNT_PART = new RegExp(`(${COEFFICIENT})(${MAJOR_UNIT})`, "g");

export function normalizeKoreanAmounts(text) {
  return text.replace(AMOUNT_RUN, (run) => {
    let total = 0;
    for (const [, coefficient, unit] of run.matchAll(AMOUNT_PART)) {
      total += parseCoefficient(coefficient) * MAJOR_UNITS[unit];
    }
    return total.toLocaleString("en-US");
  });
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

function cleanGenerated(raw) {
  return stripHanzi(raw)
    .replace(/<[^>]*>/g, " ")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function completeSentences(text, maxSentences) {
  const parts = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part && /[.!?]$/.test(part));

  return parts.length > 0 ? parts.slice(0, maxSentences).join(" ") : null;
}

function listCategory(label, titles) {
  const shown = titles.slice(0, 3).join(", ");
  const more = titles.length > 3 ? ` +${titles.length - 3}` : "";
  return `${label}: ${shown}${more}`;
}

function renderMaterial(items, bodies, bodyChars) {
  return items
    .map((item, index) => {
      const body = bodies[item.link];
      const excerpt = body ? `\n   ${body.slice(0, bodyChars)}` : "";
      return `${index + 1}. ${item.title}${excerpt}`;
    })
    .join("\n\n");
}

const COMMON_RULES = `- 위에 적힌 사실만 사용해. 위에 없는 숫자·수치·전망·원인은 절대 지어내지 마.
- 숫자와 금액은 위에 적힌 표기를 그대로 옮겨. 반올림하거나 단위를 바꾸지 마.
- 서로 다른 기사를 인과관계("~때문에", "~해서")로 엮지 마. 별개의 사실이면 별개 문장으로 써.
- 단체·정당·기관·인물 이름은 위에 적힌 표기를 그대로 써. 줄임말을 임의로 풀어쓰거나 다른 이름으로 바꾸지 마.
- 투자 조언이나 예측은 하지 마.
- 한국어(한글)로만 작성해. 한자, 중국어, 영어 단어를 섞지 마.
- 번호나 목록 기호를 쓰지 말고 이어지는 문단으로 써.
- 각 문장은 반드시 마침표로 끝내.`;

function buildCategoryPrompt(label, items, bodies, isUngroupable) {
  const material = renderMaterial(items.slice(0, MAX_ITEMS_PER_CATEGORY), bodies, BODY_CHARS_IN_CATEGORY_PROMPT);

  const intro = isUngroupable
    ? `다음은 오늘자 한국 경제 뉴스야. 서로 주제가 다른 소식들이고, 각 항목은 제목과 기사 본문 일부야.

${material}

이 소식들을 하나로 엮지 말고, 오늘 어떤 일이 있었는지 차례로 짚어주는 한국어 ${CATEGORY_SENTENCES}문장 문단으로 요약해줘.`
    : `다음은 "${label}" 주제의 오늘자 한국 경제 뉴스야. 각 항목은 제목과 기사 본문 일부야.

${material}

이 기사들을 종합해서 한국어 ${CATEGORY_SENTENCES}문장 문단으로 요약해줘. 무슨 일이 있었고 어떤 수치가 나왔는지 구체적으로 써.`;

  return `${intro}
규칙:
- ${CATEGORY_SENTENCES}문장 안팎으로 쓰고, 전체 300자에서 400자 사이로 맞춰.
${COMMON_RULES}

요약:`;
}

function buildSingleSentencePrompt(label, items, bodies) {
  const material = renderMaterial(items.slice(0, MAX_ITEMS_PER_CATEGORY), bodies, BODY_CHARS_IN_CATEGORY_PROMPT);

  return `다음은 "${label}" 주제의 오늘자 한국 경제 뉴스야.

${material}

이 기사들을 종합해서 한국어 한 문장으로 요약해줘.
규칙:
- 딱 한 문장만 출력해.
${COMMON_RULES}

한 문장 요약:`;
}

function buildHighlightPrompt(item, body) {
  return `다음은 오늘자 한국 경제 뉴스 한 건이야.

제목: ${item.title}
본문: ${body.slice(0, BODY_CHARS_IN_HIGHLIGHT_PROMPT)}

이 기사를 한국어 ${HIGHLIGHT_SENTENCES}문장으로 요약해줘. 무슨 일이 있었는지, 누가 무엇을 했는지, 어떤 수치가 나왔는지를 담아.
규칙:
- ${HIGHLIGHT_SENTENCES}문장 안팎으로 쓰고, 전체 150자에서 250자 사이로 맞춰.
- 제목을 그대로 옮겨 쓰지 말고 본문 내용으로 설명해.
${COMMON_RULES}

요약:`;
}

function describeError(err) {
  const cause = err?.cause?.code ?? err?.cause?.message;
  return cause ? `${err.message} (${cause})` : err.message;
}

async function callOllama(prompt, options) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: true,
      options,
      ...(DISABLE_THINKING ? { think: false } : {}),
    }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);

  const decoder = new TextDecoder();
  let pending = "";
  let text = "";

  const consume = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const chunk = JSON.parse(trimmed);
    if (chunk.error) throw new Error(`ollama error: ${chunk.error}`);
    if (typeof chunk.response === "string") text += chunk.response;
  };

  for await (const bytes of res.body) {
    pending += decoder.decode(bytes, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  consume(pending);

  if (!text) throw new Error("ollama 응답이 비어 있음");
  return text;
}

async function generateKoText(prompt, { maxSentences, numPredict, temperature }) {
  const raw = await callOllama(prompt, { temperature, top_p: 0.7, num_predict: numPredict });
  return completeSentences(cleanGenerated(raw), maxSentences);
}

function containsUnverifiedNumber(sentence, sourceText) {
  const numbers = sentence.match(/\d[\d,.]*/g) ?? [];
  return numbers.some((n) => !sourceText.includes(n));
}

const MAX_EXTRACTED_ENTITIES = 20;
const MAX_ENTITY_LENGTH = 20;
const ENTITY_STOPWORDS = new Set([
  "정부", "시장", "경제", "금리", "주택", "부동산", "증시", "환율", "은행", "대출", "가격", "물가",
  "미디어", "언론", "당국", "업계", "기업", "정책", "지역", "소비자", "투자자", "국내", "해외",
  "물가지수", "소비자물가", "소비자물가지수", "생산자물가", "생산자물가지수", "기준금리",
  "가계대출", "가계부채", "가계신용", "전세대출", "주택담보대출", "국고채", "종부세",
  "주식시장", "채권시장", "분양가", "공시가", "판매신용",
]);
const ENTITY_SUFFIXES = ["지수", "증시", "시장", "정부", "당국", "은행", "그룹"];
const DATE_PREFIX = /^\d*(?:년|월|일|분기|반기)/;

function isGenericTerm(normalized) {
  if (ENTITY_STOPWORDS.has(normalized)) return true;
  const withoutDate = normalized.replace(DATE_PREFIX, "");
  return withoutDate !== normalized && ENTITY_STOPWORDS.has(withoutDate);
}

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

  const raw = await callOllama(prompt, { temperature: 0, top_p: 0.5, num_predict: 160 });
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
    console.error(`[summarize-digest] 고유명사 추출 실패, 통과 처리: ${describeError(err)}`);
    return [];
  }

  const haystack = normalizeForEntityMatch(
    `${sourceText} ${expandHanjaAbbrev(sourceText)} ${alternateAbbrevForms(sourceText)}`
  );
  const haystackWithoutDigits = haystack.replace(/\d/g, "");

  return entities.filter((entity) => {
    const normalized = normalizeForEntityMatch(entity);
    if (!normalized || isGenericTerm(normalized)) return false;
    if (haystack.includes(normalized)) return false;

    const withoutDigits = normalized.replace(/\d/g, "");
    if (withoutDigits.length >= 2 && haystackWithoutDigits.includes(withoutDigits)) return false;

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

function sourceTextFor(items, bodies) {
  return items.map((item) => `${item.title} ${bodies[item.link] ?? ""}`).join(" ");
}

async function verifyKoText(label, text, sourceText) {
  if (containsUnverifiedNumber(text, sourceText)) {
    console.error(`[summarize-digest] "${label}" 요약에 원문에 없는 숫자 포함: ${text}`);
    return FALLBACK_REASONS.UNVERIFIED_NUMBER;
  }

  const unverified = await unverifiedEntities(text, sourceText);
  if (unverified.length > 0) {
    console.error(
      `[summarize-digest] "${label}" 요약에 원문에 없는 고유명사(${unverified.join(", ")}) 포함: ${text}`
    );
    return FALLBACK_REASONS.UNVERIFIED_ENTITY;
  }

  return null;
}

async function generateVerified({ label, prompt, sourceText, maxSentences, numPredict }) {
  let lastReason = FALLBACK_REASONS.GENERATION_FAILED;

  for (const temperature of [0.1, 0]) {
    let text;
    try {
      text = await generateKoText(prompt, { maxSentences, numPredict, temperature });
    } catch (err) {
      console.error(`[summarize-digest] "${label}" 생성 실패: ${describeError(err)}`);
      return { text: null, reason: FALLBACK_REASONS.GENERATION_FAILED };
    }

    if (!text) {
      console.error(`[summarize-digest] "${label}" 완결된 문장을 못 얻음`);
      lastReason = FALLBACK_REASONS.GENERATION_FAILED;
      continue;
    }

    const reason = await verifyKoText(label, text, sourceText);
    if (!reason) return { text, reason: null };
    lastReason = reason;
  }

  return { text: null, reason: lastReason };
}

async function summarizeCategory(bucket, bodies) {
  const label = bucket.category.name;
  const isUngroupable = bucket.category === FALLBACK_CATEGORY;
  const items = bucket.items.slice(0, MAX_ITEMS_PER_CATEGORY);
  const sourceText = sourceTextFor(items, bodies);

  const paragraph = await generateVerified({
    label,
    prompt: buildCategoryPrompt(label, items, bodies, isUngroupable),
    sourceText,
    maxSentences: CATEGORY_SENTENCES,
    numPredict: 620,
  });
  if (paragraph.text) return { line: paragraph.text, fallbackReason: null, degraded: false };

  console.error(`[summarize-digest] "${label}" 문단 요약 실패(${paragraph.reason}), 한 문장으로 재시도`);
  const single = await generateVerified({
    label,
    prompt: buildSingleSentencePrompt(label, items, bodies),
    sourceText,
    maxSentences: 1,
    numPredict: 200,
  });
  if (single.text) return { line: single.text, fallbackReason: null, degraded: true };

  return { line: listCategory(label, bucket.titles), fallbackReason: paragraph.reason, degraded: false };
}

async function summarizeHighlight(item, body) {
  const label = `핵심: ${item.title.slice(0, 20)}`;
  const sourceText = sourceTextFor([item], { [item.link]: body });

  const result = await generateVerified({
    label,
    prompt: buildHighlightPrompt(item, body),
    sourceText,
    maxSentences: HIGHLIGHT_SENTENCES,
    numPredict: 400,
  });

  if (!result.text) {
    console.error(`[summarize-digest] 핵심 기사 요약 실패(${result.reason}): ${item.title}`);
    return null;
  }

  return {
    title: item.title,
    link: item.link,
    source: item.source,
    category: item.category ?? FALLBACK_CATEGORY.key,
    textKo: result.text,
  };
}

export function pickHighlights(items, bodies) {
  const ranked = items
    .map((item, index) => ({ item, body: bodies[item.link] ?? "", recency: -index }))
    .filter((entry) => entry.body.length >= MIN_HIGHLIGHT_BODY)
    .sort((a, b) => (b.item.dupes?.length ?? 0) - (a.item.dupes?.length ?? 0) || b.recency - a.recency);

  const picked = [];
  const perCategory = new Map();
  for (const entry of ranked) {
    if (picked.length >= HIGHLIGHT_COUNT) break;
    const key = entry.item.category ?? FALLBACK_CATEGORY.key;
    const used = perCategory.get(key) ?? 0;
    if (used >= MAX_HIGHLIGHTS_PER_CATEGORY) continue;
    perCategory.set(key, used + 1);
    picked.push(entry);
  }
  return picked;
}

function isBadTranslation(text, original, requiredNumbers) {
  if (!text) return true;
  if (/[가-힣]/.test(text)) return true;
  if (/[一-鿿]/.test(text)) return true;
  if (text.length > Math.max(400, original.length * 4)) return true;
  const textDigits = text.replace(/,/g, "");
  if (requiredNumbers.some((n) => !textDigits.includes(n))) return true;
  return false;
}

function buildTranslatePrompt(normalized, hint) {
  return `Translate the following Korean text into natural, concise English.
The text may already contain plain Arabic numerals (e.g. "80,000,000") - if so, keep those numbers exactly as they are, do not round or rewrite them, just translate the surrounding Korean words (e.g. "원" -> "won").
Keep every sentence: do not merge, drop, or add sentences.
Write the translation in English only - do not use Chinese characters or any other language.
Translate names of parties, institutions and people literally. Do NOT add roles or descriptions that are not in the Korean text (for example, never label a party as "ruling" or "opposition").
Output ONLY the translation. No quotes, no explanation.${hint ? `\n${hint}` : ""}

Korean: ${normalized}

English:`;
}

function rejectionHint(rejected) {
  if (!rejected) return null;
  const hanzi = rejected.match(/[一-鿿]+/g);
  if (hanzi) {
    return `IMPORTANT: your previous attempt contained the Chinese characters "${[...new Set(hanzi)].join(", ")}". Write those words in plain English instead.`;
  }
  if (/[가-힣]/.test(rejected)) {
    return "IMPORTANT: your previous attempt left Korean words untranslated. Every word must be English.";
  }
  return "IMPORTANT: your previous attempt was rejected. Keep every number exactly as written and translate the whole text.";
}

async function translateKoText(text, numPredict) {
  const normalized = normalizeKoreanAmounts(text);
  const requiredNumbers = extractNormalizedNumbers(text, normalized);

  let lastRejected = null;

  for (const temperature of [0.2, 0]) {
    let translated;
    try {
      const prompt = buildTranslatePrompt(normalized, rejectionHint(lastRejected));
      const raw = await callOllama(prompt, { temperature, top_p: 0.8, num_predict: numPredict });
      const joined = raw.trim().replace(/\s*\n+\s*/g, " ").replace(/^["'“‘]+|["'”’]+$/g, "").trim();
      translated = completeSentences(joined, 12) ?? joined;
    } catch (err) {
      console.error(`[summarize-digest] 번역 실패, 한국어 유지: ${describeError(err)}`);
      return { text, translated: false };
    }

    if (!isBadTranslation(translated, text, requiredNumbers)) return { text: translated, translated: true };
    lastRejected = translated;
  }

  const withoutHanzi = (lastRejected ?? "").replace(/[一-鿿]+/g, " ").replace(/\s+/g, " ").trim();
  if (withoutHanzi && !isBadTranslation(withoutHanzi, text, requiredNumbers)) {
    console.error(`[summarize-digest] 한자를 걷어내고 번역 채택: ${withoutHanzi}`);
    return { text: withoutHanzi, translated: true };
  }

  console.error(`[summarize-digest] 번역 검증 실패, 한국어 유지: ${lastRejected}`);
  return { text, translated: false };
}

async function readBodies(newsDate) {
  try {
    const cached = JSON.parse(await readFile(bodiesFile, "utf-8"));
    if (newsDate && cached.date && cached.date !== newsDate) {
      console.error(`[summarize-digest] 본문 캐시 날짜(${cached.date})가 news(${newsDate})와 다름, 무시`);
      return null;
    }
    return cached.bodies ?? null;
  } catch {
    return null;
  }
}

function summaryText(highlights, categories, locale) {
  const isEn = locale === "en";
  return [
    ...highlights.map((h) => `- ${h.title}: ${(isEn ? h.textEn : h.textKo) ?? h.textKo}`),
    ...categories.map((c) => `- ${isEn ? c.nameEn : c.name}: ${isEn ? c.lineEn : c.lineKo}`),
  ].join("\n");
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

  const bodies = (await readBodies(news.date)) ?? {};
  if (Object.keys(bodies).length === 0) {
    console.error("[summarize-digest] 기사 본문 없음, 제목만으로 요약한다");
  }

  const highlightEntries = [];
  for (const { item, body } of pickHighlights(news.items, bodies)) {
    const highlight = await summarizeHighlight(item, body);
    if (highlight) highlightEntries.push(highlight);
  }

  const buckets = categorize(news.items);
  const categoryEntries = [];
  for (const bucket of buckets) {
    const { line, fallbackReason, degraded } = await summarizeCategory(bucket, bodies);
    const isFallback = fallbackReason !== null;
    categoryEntries.push({
      key: bucket.category.key,
      name: bucket.category.name,
      nameEn: bucket.category.nameEn,
      lineKo: line,
      lineEn: isFallback ? listCategory(bucket.category.nameEn, bucket.titles) : null,
      isFallback,
      fallbackReason,
      degraded,
      items: bucket.items
        .slice(0, MAX_ITEMS_PER_CATEGORY)
        .map((i) => ({ title: i.title, link: i.link, source: i.source })),
    });
  }

  if (categoryEntries.length === 0) {
    console.error("[summarize-digest] 요약할 카테고리 없음");
    return;
  }

  for (const highlight of highlightEntries) {
    highlight.textEn = (await translateKoText(highlight.textKo, 480)).text;
  }
  for (const entry of categoryEntries) {
    if (entry.lineEn === null) entry.lineEn = (await translateKoText(entry.lineKo, 700)).text;
  }

  const summary = {
    ko: summaryText(highlightEntries, categoryEntries, "ko"),
    en: summaryText(highlightEntries, categoryEntries, "en"),
  };
  const payload = { model: MODEL, summary, highlights: highlightEntries, categories: categoryEntries };

  await mkdir(dataDir, { recursive: true });
  await writeFile(outFile, JSON.stringify({ updatedAt: now.toISOString(), ...payload }, null, 2));
  await writeFile(
    sourceFile,
    JSON.stringify(
      {
        updatedAt: now.toISOString(),
        newsUpdatedAt: news.updatedAt ?? null,
        links: news.items.map((item) => item.link).filter(Boolean),
      },
      null,
      2
    )
  );
  await appendHistory(now, payload);

  const fallen = categoryEntries.filter((c) => c.isFallback);
  const breakdown = [...new Set(fallen.map((c) => c.fallbackReason))]
    .map((r) => `${r} x${fallen.filter((c) => c.fallbackReason === r).length}`)
    .join(", ");
  console.log(
    `[summarize-digest] 저장 완료 ` +
      `(핵심 ${highlightEntries.length}/${HIGHLIGHT_COUNT}건, ` +
      `카테고리 ${categoryEntries.length}개 중 폴백 ${fallen.length}${breakdown ? `: ${breakdown}` : ""}, ` +
      `한 문장으로 축소 ${categoryEntries.filter((c) => c.degraded).length}, ` +
      `한국어 ${summary.ko.length}자)`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`요약 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
