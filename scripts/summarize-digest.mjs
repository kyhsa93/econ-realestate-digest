import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { FALLBACK_CATEGORY, categoryOf } from "./categories.mjs";

// fetch-rates와 같은 방식. 테스트가 실제 docs/data를 덮어쓰지 않게 하려는 것이다.
const dataDir = process.env.SUMMARY_DATA_DIR
  ? path.resolve(process.env.SUMMARY_DATA_DIR)
  : path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "summary.json");
const historyFile = path.join(dataDir, "summary-history.json");
const bodiesFile = process.env.NEWS_BODIES_FILE
  ? path.resolve(process.env.NEWS_BODIES_FILE)
  : path.resolve(import.meta.dirname, "../cache/news-bodies.json");
const HISTORY_MAX_DAYS = 180;

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:14b";
const DISABLE_THINKING = process.env.OLLAMA_THINK === "false";

const MAX_ITEMS_PER_CATEGORY = 5;
// 프롬프트에 넣을 기사당 본문 길이. 길수록 재료는 좋아지지만 CPU 러너에서는
// 프롬프트 처리 시간도 같이 늘어난다.
const BODY_CHARS_IN_CATEGORY_PROMPT = 400;
const BODY_CHARS_IN_HIGHLIGHT_PROMPT = 900;

// 사람이 3분쯤 읽는 분량(한국어 1,500자 안팎)을 핵심 3건과 카테고리 문단으로 나눈다.
const CATEGORY_SENTENCES = 4;
const HIGHLIGHT_SENTENCES = 3;
const HIGHLIGHT_COUNT = 3;
const MAX_HIGHLIGHTS_PER_CATEGORY = 2;
// 이보다 본문이 짧으면 두세 문장을 채울 재료가 없어서 결국 제목을 늘여 쓰게 된다.
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

// 계수는 "5천470"처럼 작은 단위 뒤에 숫자가 더 붙는다. 여기서 뒷자리를 놓치면
// 큰 단위만 변환되고 나머지가 글자로 남아 숫자가 통째로 망가진다.
const COEFFICIENT = "\\d+(?:\\.\\d+)?(?:(?:천|백|십)\\d*)?";
const MAJOR_UNIT = "(?:조|억|만)";
// 큰 단위는 여러 개가 이어 붙는다("6조5천470억원", "1천865조8천억원"). 한 번에 한
// 단위씩 바꾸면 "6조"만 숫자가 되고 뒤가 남아 6,000,000,000,0005천47,000,000,000이
// 된다. 제목만 다룰 땐 이런 표기가 드물었는데 본문이 들어오면서 흔해졌다.
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

// 모델은 목록 기호나 <think> 잔재를 붙여 놓기도 한다. 문단으로 쓰려면 줄 단위로
// 정리해서 한 덩어리로 이어붙여야 화면에서도 문단으로 보인다.
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

// num_predict에 걸려 잘린 마지막 조각은 버린다. 종결부호로 끝나지 않는 문장을
// 그대로 내보내면 화면에서 말이 끊긴 채로 보인다.
// 문장 경계는 "종결부호 + 공백"으로만 인정한다 - "2.5%"의 점에서 자르지 않으려면
// 이 조건이 필요하다.
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

// 제목만 주면 모델이 할 수 있는 건 제목을 바꿔 쓰는 것뿐이다. 본문이 붙어야
// 요약에 알맹이가 생긴다.
function renderMaterial(items, bodies, bodyChars) {
  return items
    .map((item, index) => {
      const body = bodies[item.link];
      const excerpt = body ? `\n   ${body.slice(0, bodyChars)}` : "";
      return `${index + 1}. ${item.title}${excerpt}`;
    })
    .join("\n\n");
}

// 숫자를 금지하는 대신 "원문에 적힌 그대로만"으로 바꾼다. 경제 뉴스에서 수치를
// 빼면 읽을 알맹이가 사라지는데, 이제 본문이 프롬프트에 들어오므로 코드가
// 원문 대조로 걸러낼 수 있다.
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
- ${CATEGORY_SENTENCES}문장 안팎으로 쓰고, 전체 250자에서 350자 사이로 맞춰.
${COMMON_RULES}

요약:`;
}

// 문단 생성이 검증에서 막혔을 때 쓴다. 짧고 밋밋하지만 제목 나열보다는 낫다.
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

// "fetch failed" 한 줄로는 왜 실패했는지 알 수가 없다. 원인은 cause에 들어 있다.
function describeError(err) {
  const cause = err?.cause?.code ?? err?.cause?.message;
  return cause ? `${err.message} (${cause})` : err.message;
}

// stream:false로 부르면 생성이 끝날 때까지 응답 헤더가 오지 않는데, Node fetch의
// headersTimeout 기본값은 300초다. 프롬프트에 기사 본문이 들어가고 num_predict가
// 커지면서 재료가 많은 카테고리가 이 한도를 넘겨 통째로 실패했다. 조각으로 받으면
// 계속 바이트가 흐르므로 한도에 걸리지 않는다.
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
    // 마지막 조각은 줄이 덜 끝났을 수 있으니 다음 덩어리와 이어 붙인다.
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

// 문단이 길어지면 고유명사도 많아진다. 상한이 낮으면 뒤쪽 고유명사가 검증에서
// 아예 빠져버려서, 검사를 하는 것처럼 보이지만 실제로는 안 하는 구간이 생긴다.
const MAX_EXTRACTED_ENTITIES = 20;
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
    if (ENTITY_STOPWORDS.has(entity)) return false;
    const normalized = normalizeForEntityMatch(entity);
    if (!normalized || haystack.includes(normalized)) return false;

    // 원문 "미국 7월 물가지수"에서 모델이 "월 물가지수"를 고유명사로 뽑아내면
    // 숫자가 떨어져 나가 대조에 실패한다. 실제로 멀쩡한 문단이 이 이유로 버려졌다.
    // 숫자는 containsUnverifiedNumber가 따로 대조하므로 여기선 빼고 본다.
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

// 대조용 원문. 제목만 넣던 시절에는 본문에 있는 정상 수치도 "원문에 없는 숫자"로
// 걸렸다. 프롬프트에 넣은 재료와 대조 대상이 같아야 한다.
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

// 검증에 걸리면 온도를 낮춰 한 번 더 시도한다. 실제로 걸리는 대부분은 모델이
// 한 번 상상해서 덧붙인 경우라, 같은 프롬프트로도 두 번째엔 통과하는 일이 많다.
async function generateVerified({ label, prompt, sourceText, maxSentences, numPredict }) {
  let lastReason = FALLBACK_REASONS.GENERATION_FAILED;

  for (const temperature of [0.1, 0]) {
    let text;
    try {
      text = await generateKoText(prompt, { maxSentences, numPredict, temperature });
    } catch (err) {
      // 모델 호출 자체가 안 되는 상황은 다시 불러도 마찬가지다.
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
    numPredict: 500,
  });
  if (paragraph.text) return { line: paragraph.text, fallbackReason: null, degraded: false };

  // 문단이 막혔다고 곧장 제목 나열로 가지 않는다. 한 문장 요약은 오래 굴려본
  // 방식이라 성공률이 높고, 검증을 통과한 이상 제목 나열보다 읽을 값어치가 있다.
  console.error(`[summarize-digest] "${label}" 문단 요약 실패(${paragraph.reason}), 한 문장으로 재시도`);
  const single = await generateVerified({
    label,
    prompt: buildSingleSentencePrompt(label, items, bodies),
    sourceText,
    maxSentences: 1,
    numPredict: 200,
  });
  if (single.text) return { line: single.text, fallbackReason: null, degraded: true };

  // 이유는 본 요약이 왜 반려됐는지를 남긴다. 뒤이은 한 문장 시도의 실패 사유는
  // 로그로 충분하고, 진단에 필요한 건 처음 걸린 지점이다.
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

  // 핵심 기사는 요약이 없으면 실을 이유가 없다. 제목만 다시 보여주는 칸이
  // 되느니 그 자리를 비우는 게 낫다.
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

// 여러 매체가 같이 다룬 기사가 그날의 큰 뉴스다. 모델에게 고르라고 하면 호출이
// 늘어나는 데다 근거 없는 판단이 섞이는데, 이건 수집 단계에서 이미 센 값이다.
export function pickHighlights(items, bodies) {
  const ranked = items
    .map((item, index) => ({ item, body: bodies[item.link] ?? "", recency: -index }))
    .filter((entry) => entry.body.length >= MIN_HIGHLIGHT_BODY)
    .sort((a, b) => (b.item.dupes?.length ?? 0) - (a.item.dupes?.length ?? 0) || b.recency - a.recency);

  const picked = [];
  const perCategory = new Map();
  for (const entry of ranked) {
    if (picked.length >= HIGHLIGHT_COUNT) break;
    // 부동산 기사가 절반을 넘는 날이 흔해서, 막아두지 않으면 핵심 세 칸이
    // 전부 같은 주제로 채워진다.
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
  // 한국어는 영어보다 압축적이라 번역하면 3~4배로 늘어난다. 상한을 빠듯하게
  // 잡으면 멀쩡한 번역이 반려돼 영어 화면에 한국어가 그대로 남는다.
  if (text.length > Math.max(400, original.length * 4)) return true;
  const textDigits = text.replace(/,/g, "");
  if (requiredNumbers.some((n) => !textDigits.includes(n))) return true;
  return false;
}

async function translateKoText(text, numPredict) {
  const normalized = normalizeKoreanAmounts(text);
  const requiredNumbers = extractNormalizedNumbers(text, normalized);

  const prompt = `Translate the following Korean text into natural, concise English.
The text may already contain plain Arabic numerals (e.g. "80,000,000") - if so, keep those numbers exactly as they are, do not round or rewrite them, just translate the surrounding Korean words (e.g. "원" -> "won").
Keep every sentence: do not merge, drop, or add sentences.
Write the translation in English only - do not use Chinese characters or any other language.
Translate names of parties, institutions and people literally. Do NOT add roles or descriptions that are not in the Korean text (for example, never label a party as "ruling" or "opposition").
Output ONLY the translation. No quotes, no explanation.

Korean: ${normalized}

English:`;

  // 반려되면 온도를 낮춰 한 번 더. 실제로 걸린 건 한국어 "공시가"를 한자 公示로
  // 옮겨버린 경우였는데, 이런 건 한 번 더 굴리면 대개 사라진다. 반려를 그대로
  // 받아들이면 영어 화면에 한국어 문단이 통째로 남는다.
  let lastRejected = null;

  for (const temperature of [0.2, 0]) {
    let translated;
    try {
      const raw = await callOllama(prompt, { temperature, top_p: 0.8, num_predict: numPredict });
      // 문단은 여러 줄로 나뉘어 올 수 있다. 예전처럼 첫 줄만 쓰면 번역이 통째로 잘린다.
      const joined = raw.trim().replace(/\s*\n+\s*/g, " ").replace(/^["'“‘]+|["'”’]+$/g, "").trim();
      // 한국어 쪽과 달리 여기선 잘린 꼬리를 못 찾아도 통째로 버리지 않는다. 번역은
      // 예산이 넉넉해 잘릴 일이 드물고, 마침표가 빠진 것 때문에 영어 화면에 한국어를
      // 남기는 편이 더 나쁘다. 한글·한자·길이·숫자 검증은 아래에서 그대로 한다.
      translated = completeSentences(joined, 12) ?? joined;
    } catch (err) {
      // 호출 자체가 안 되는 상황은 다시 불러도 마찬가지다.
      console.error(`[summarize-digest] 번역 실패, 한국어 유지: ${describeError(err)}`);
      return { text, translated: false };
    }

    if (!isBadTranslation(translated, text, requiredNumbers)) return { text: translated, translated: true };
    lastRejected = translated;
  }

  console.error(`[summarize-digest] 번역 검증 실패, 한국어 유지: ${lastRejected}`);
  return { text, translated: false };
}

// 어제 본문으로 오늘 요약을 쓰면 사실이 어긋난다. 날짜가 다르면 없는 것으로 친다.
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

// categories를 못 읽는 경로(옛 데이터·프리렌더 폴백)에서도 같은 내용이 보이게
// 통짜 텍스트를 같이 만들어 둔다.
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

  // 본문은 fetch-news가 같은 실행에서 떨궈둔 것이다. 없으면 예전처럼 제목만
  // 보고 쓰게 되므로, 조용히 넘어가지 말고 남긴다.
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
      // 폴백은 번역할 문장이 아니라 제목 목록이라, 여기서 영어 목록으로 맞춰둔다.
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

  // 번역은 한국어가 다 나온 뒤에 몰아서 한다. 실패해도 한국어 화면은 그대로다.
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
