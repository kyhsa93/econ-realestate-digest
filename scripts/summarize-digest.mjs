import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { FALLBACK_CATEGORY, categoryOf } from "./categories.mjs";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "summary.json");
const historyFile = path.join(dataDir, "summary-history.json");
const HISTORY_MAX_DAYS = 180;

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:14b";
// qwen3 계열은 추론(thinking) 모드가 기본으로 켜져 있어서, 끄지 않으면 응답
// 앞머리에 <think> 블록이 붙고 num_predict 예산을 추론이 다 써버린다(요약이
// 통째로 폐기됨). 반대로 thinking을 지원하지 않는 모델에 이 필드를 보내면
// 오류가 나므로, 필요한 모델에서만 OLLAMA_THINK=false로 켠다.
const DISABLE_THINKING = process.env.OLLAMA_THINK === "false";

// 소형 모델(1.5B)에게 "15개 제목을 통째로 보고 알아서 그룹핑"을 시키면
// 그룹핑을 안 하거나(전부 나열) 숫자를 지어내는 문제가 있었음.
// 그래서 그룹핑은 키워드로 결정론적으로 먼저 하고, LLM은 카테고리 하나당
// "이미 비슷한 제목들"만 보고 한 문장으로 압축하는 훨씬 쉬운 일만 시킨다.
//
// 파이프라인: 한국어 요약 생성 -> (숫자 검증 + YES/NO 검수) -> 통과한 것만
// 영어로 번역 -> 번역도 검증. 예전엔 한국어/영어를 각각 헤드라인에서 독립
// 생성했는데, "요약과 번역을 동시에" 시키는 게 오류가 더 많아서(예: 영어
// 버전에서 "15억원"을 "yuan"으로 오역 + 없는 통계까지 지어냄) 순서를 바꿈.
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
    // fetch-news.mjs가 수집 시점에 붙여둔 category를 그대로 쓴다. 화면의 뉴스
    // 목록 필터와 요약 묶음이 어긋나지 않게 하기 위함.
    const matched = categoryOf(item);
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

function buildBucketPrompt(label, titles, isUngroupable) {
  const list = titles.slice(0, MAX_ITEMS_PER_CATEGORY).map((t, i) => `${i + 1}. ${t}`).join("\n");

  // "기타" 묶음은 주제가 하나로 안 묶이는 제목들이라, 다른 카테고리와 같은
  // "종합해서 한 문장" 지시를 그대로 주면 서로 무관한 사건을 억지로 엮기 쉽다.
  // 엮지 말고 나열하듯 요약하라고 따로 못박는다.
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

// num_predict가 80이던 시절엔 3b가 짧게 끊어 써서 문제가 없었는데, 14b급
// 모델은 문장을 길게 이어 쓰다가 예산에 걸려 문장이 중간에 잘렸다(실험에서
// "...강화되고," 로 끝나는 요약이 나옴). 특히 "기타" 묶음은 서로 다른 소식을
// 나열하느라 훨씬 길어져서 150으로도 잘렸다. firstSentence()가 어차피 첫 문장만
// 남기므로 예산은 넉넉히 준다.
async function generateKoSentence(prompt) {
  const raw = await callOllama(prompt, { temperature: 0.1, top_p: 0.7, num_predict: 220 });
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
// 잔여 위험이 있어, 별도로 한 번 더 확인한다.
//
// 예전에는 이 단계도 LLM에게 "요약이 원문에 충실한가"를 YES/NO로 물었는데,
// 3b 모델이 이 판단 자체를 못 해서 사실상 항상 NO를 뱉었다(CI에서 며칠 연속
// 모든 카테고리가 폴백 처리 - 원문 제목의 단어만 쓴 문장까지 NO). 기준을
// "원문에 없는 고유명사"로 좁혀도 여전히 전부 NO였다.
//
// 그래서 판단을 모델에게 맡기지 않는다. 모델에게는 "문장에서 고유명사를
// 뽑아라"는 추출 작업만 시키고(작은 모델도 하는 일), 원문에 있는지 없는지
// 대조는 숫자 검증과 똑같이 코드가 substring으로 한다.
const MAX_EXTRACTED_ENTITIES = 10;
const MAX_ENTITY_LENGTH = 20;
// 모델이 고유명사가 아닌 일반 명사를 섞어 내놓는 경우가 있어, 이런 단어는
// 원문에 없더라도 폐기 사유로 삼지 않는다.
const ENTITY_STOPWORDS = new Set([
  "정부", "시장", "경제", "금리", "주택", "부동산", "증시", "환율", "은행", "대출", "가격", "물가",
  // 14b 모델 비교 실험에서 실제로 걸린 것들: 원문의 "美 CNBC"를 "미디어"로 뭉뚱그린
  // 요약이 고유명사 미검증으로 폐기됐다.
  "미디어", "언론", "당국", "업계", "기업", "정책", "지역", "소비자", "투자자", "국내", "해외",
]);
// "코스피지수"처럼 모델이 접미어를 붙여 내놓는 경우를 대비해 이 꼬리표는 떼고 한 번 더 대조한다.
const ENTITY_SUFFIXES = ["지수", "증시", "시장", "정부", "당국", "은행", "그룹"];

// 한국 뉴스 제목은 국가명을 한자 한 글자로 줄여 쓴다("日증시", "美금리", "韓").
// 요약 문장은 당연히 "일본 증시"처럼 풀어 쓰므로, 원문 대조를 그대로 하면
// 멀쩡한 표현이 "원문에 없는 고유명사"로 걸린다(실제로 발생). 대조용 원문에
// 풀어쓴 형태를 같이 넣어둔다.
const HANJA_COUNTRY_ABBREV = {
  韓: "한국", 日: "일본", 美: "미국", 中: "중국", 北: "북한", 英: "영국",
  獨: "독일", 佛: "프랑스", 露: "러시아", 伊: "이탈리아", 濠: "호주", 印: "인도", 加: "캐나다",
};

function expandHanjaAbbrev(text) {
  return text.replace(/[韓日美中北英獨佛露伊濠印加]/g, (c) => HANJA_COUNTRY_ABBREV[c] ?? c);
}

// 한자 약어와 같은 이유. 제목은 "국힘"이라 쓰고 요약은 "국민의힘"이라 쓰면
// 같은 대상인데도 원문에 없는 고유명사로 걸린다(실제로 발생). 어느 쪽 표기가
// 원문에 있든 반대쪽 표기도 대조 대상에 넣어둔다.
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
    // 모델이 목록 대신 문장을 뱉으면 토큰이 비정상적으로 길어진다 -> 버린다
    .filter((token) => token.length >= 2 && token.length <= MAX_ENTITY_LENGTH && !/없음|none/i.test(token))
    .slice(0, MAX_EXTRACTED_ENTITIES);
}

// 반환값: 원문에서 근거를 못 찾은 고유명사 목록(비어 있으면 통과).
async function unverifiedEntities(sentence, sourceText) {
  let entities;
  try {
    entities = await extractProperNouns(sentence);
  } catch (err) {
    // 추출 자체가 실패하면 근거 없이 폐기하지 않고 통과시킨다(숫자 검증은 이미 통과한 상태).
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

// isFallback도 함께 반환한다: 폴백(헤드라인 나열)이면 main()에서 영어
// 버전도 문장 번역 없이 nameEn으로 결정론적으로 만들어서, 번역까지 실패했을
// 때 영어 요약에 한국어 카테고리 라벨이 섞여 남는 걸 방지한다.
//
// fallbackReason은 어느 단계에서 걸러졌는지를 summary.json에 남기기 위한 것.
// 폴백은 화면상 "라벨: 제목 나열"이라 정상 요약과 구분이 잘 안 가서, 검수가
// 과하게 빡빡해져 전 카테고리가 조용히 폴백으로 떨어져도 눈치채기 어려웠다.
const FALLBACK_REASONS = {
  GENERATION_FAILED: "generation-failed",
  UNVERIFIED_NUMBER: "unverified-number",
  UNVERIFIED_ENTITY: "unverified-entity",
};

// "기타" 묶음은 예전엔 아예 요약을 시도하지 않고(3b가 서로 무관한 사건을 억지로
// 엮어 지어내서) 제목 나열로만 뒀는데, 모델을 14b로 올리면서 다른 카테고리와
// 똑같이 요약을 시도한다. 대신 프롬프트에서 "엮지 말고 나열하듯"을 못박고,
// 지어내면 어차피 아래 숫자/고유명사 검증에 걸려 나열로 되돌아간다.
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

// 번역이 아니라 원문을 그대로 남기거나(한글이 그대로 섞여 있음), 모델이
// 딴소리를 늘어놓은 경우(비정상적으로 길어짐), 혹은 코드로 미리 정규화해 넘긴
// 큰 숫자를 모델이 누락/변형한 경우(단위 환산 오류의 잔여 위험)를 걸러내
// 원문 한국어로 폴백한다. (translate-news.mjs의 검증 로직과 같되 길이 상한만 다름)
//
// 길이 상한은 원래 뉴스 "제목"(짧음)에 맞춰 잡힌 값이라, 요약 "문장"에는 너무
// 빡빡했다. 한국어는 영어보다 압축적이라 번역하면 3배 안팎으로 길어지는데
// 상한이 딱 3배여서 멀쩡한 번역이 반려되고 영어 요약에 한국어 문장이 그대로
// 남는 일이 있었다(실제 발생). 문장 기준으로 여유를 준다.
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

  // 카테고리별 실패는 이미 위에서 개별로 로그를 남기지만, "오늘 몇 개가
  // 폴백이었나"는 로그를 다 훑어야 알 수 있었다. 한 줄로 집계해서 남긴다.
  const fallen = categoryEntries.filter((c) => c.isFallback);
  const breakdown = [...new Set(fallen.map((c) => c.fallbackReason))]
    .map((r) => `${r} x${fallen.filter((c) => c.fallbackReason === r).length}`)
    .join(", ");
  console.log(
    `[summarize-digest] 저장 완료 (폴백 ${fallen.length}/${categoryEntries.length}${breakdown ? `: ${breakdown}` : ""})`
  );
}

main();
