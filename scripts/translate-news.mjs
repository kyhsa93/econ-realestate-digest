import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const newsFile = path.join(dataDir, "news.json");
const historyFile = path.join(dataDir, "news-history.json");

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:14b";
// qwen3 계열은 추론(thinking) 모드가 기본으로 켜져 있어서, 끄지 않으면 응답
// 앞머리에 <think> 블록이 붙어 번역문이 통째로 검증에 걸린다. 반대로 thinking을
// 지원하지 않는 모델에 이 필드를 보내면 오류가 나므로 필요한 모델에서만 켠다.
// (summarize-digest.mjs와 동일한 처리)
const DISABLE_THINKING = process.env.OLLAMA_THINK === "false";

// 한국어는 만/억/조 단위로 4자리씩 묶어 읽어서(영어의 천 단위 그룹과 다름),
// 작은 모델이 "8천만원"을 "$8 million"으로, "15억원"을 "15 million won"으로
// 자릿수/통화를 통째로 잘못 바꾸는 사례가 실제로 나왔다. 모델에게 단위 환산을
// 맡기지 않고, 코드에서 먼저 아라비아 숫자로 바꿔준 뒤 번역을 시킨다.
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
  const numTokenRe = "\\d+(?:\\.\\d+)?(?:천|백|십)?"; // "15.6억"처럼 소수점 있는 계수도 지원
  // 복합 표현 먼저 처리: "1억5천만" 형태
  let result = text.replace(
    new RegExp(`(${numTokenRe})(억|조)\\s*(${numTokenRe})(만)`, "g"),
    (_match, c1, u1, c2, u2) => (parseCoefficient(c1) * MAJOR_UNITS[u1] + parseCoefficient(c2) * MAJOR_UNITS[u2]).toLocaleString("en-US")
  );
  // 단일 단위 표현: "8천만", "15억", "20조"
  result = result.replace(
    new RegExp(`(${numTokenRe})(조|억|만)`, "g"),
    (_match, c, u) => (parseCoefficient(c) * MAJOR_UNITS[u]).toLocaleString("en-US")
  );
  return result;
}

// normalizeKoreanAmounts가 실제로 변환한 큰 숫자들 (자릿수 검증용)
function extractNormalizedNumbers(original, normalized) {
  if (original === normalized) return [];
  const numbers = normalized.match(/\d{1,3}(?:,\d{3})+/g) ?? [];
  return numbers.map((n) => n.replace(/,/g, ""));
}

async function translateTitle(title) {
  const normalizedTitle = normalizeKoreanAmounts(title);
  const prompt = `Translate the following Korean news headline into natural, concise English.
The headline may already contain plain Arabic numerals (e.g. "80,000,000") - if so, keep those numbers exactly as they are, do not round or rewrite them, just translate the surrounding Korean words (e.g. "원" -> "won").
Write the translation in English only - do not use Chinese characters or any other language.
Output ONLY the translated headline. No quotes, no explanation, no extra commentary, no notes.

Korean headline: ${normalizedTitle}

English headline:`;

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.2, top_p: 0.8, num_predict: 80 },
      ...(DISABLE_THINKING ? { think: false } : {}),
    }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const json = await res.json();
  if (!json.response) throw new Error("ollama 응답에 response 필드 없음");

  return json.response
    .trim()
    .split("\n")[0]
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "");
}

// 번역이 아니라 원문을 그대로 남기거나(한글이 그대로 섞여 있음), 모델이
// 딴소리를 늘어놓은 경우(비정상적으로 길어짐), 혹은 코드로 미리 정규화해 넘긴
// 큰 숫자를 모델이 누락/변형한 경우(단위 환산 오류의 잔여 위험)를 걸러내
// 원문 한국어로 폴백한다.
function isBadTranslation(text, original, requiredNumbers) {
  if (!text) return true;
  if (/[가-힣]/.test(text)) return true; // 한글이 그대로 남아있으면 번역 실패로 간주
  if (/[一-鿿]/.test(text)) return true; // 영어 대신 중국어로 번역해버리는 경우가 있어 방어
  if (text.length > Math.max(120, original.length * 3)) return true; // 비정상적으로 길면 딴소리
  const textDigits = text.replace(/,/g, "");
  if (requiredNumbers.some((n) => !textDigits.includes(n))) return true;
  return false;
}

async function translateItems(items) {
  for (const item of items) {
    const requiredNumbers = extractNormalizedNumbers(item.title, normalizeKoreanAmounts(item.title));
    // 이미 붙어있는 titleEn이 지금 기준으로도 "정상 번역"이면 스킵하고,
    // 원문 폴백이었거나(이전 실패) 지금 기준으로 불량 판정되면(예: 이전에는
    // 못 걸러냈던 중국어 오역) 다시 시도한다. isBadTranslation 판정 기준을
    // 강화할 때마다 과거에 통과했던 나쁜 번역도 자동으로 재시도 대상이 된다.
    if (item.titleEn && !isBadTranslation(item.titleEn, item.title, requiredNumbers)) continue;
    try {
      const translated = await translateTitle(item.title);
      if (isBadTranslation(translated, item.title, requiredNumbers)) {
        // 반려된 번역문 자체를 같이 남긴다. 원문 제목만 찍으면 왜 걸렸는지
        // (한글 잔존/길이 초과/숫자 누락) 로그만 보고는 알 수가 없었다.
        console.error(`[translate-news] 번역 실패로 원문 유지: ${item.title}\n  -> 반려된 번역: ${translated}`);
        item.titleEn = item.title;
      } else {
        item.titleEn = translated;
      }
    } catch (err) {
      console.error(`[translate-news] "${item.title}" 번역 실패: ${err.message}`);
      item.titleEn = item.title;
    }
  }
}

async function main() {
  let news = null;
  try {
    news = JSON.parse(await readFile(newsFile, "utf-8"));
  } catch {
    console.error("[translate-news] news.json 없음, 생략");
  }

  if (news?.items?.length) {
    await translateItems(news.items);
    await writeFile(newsFile, JSON.stringify(news, null, 2));
  }

  let history = [];
  try {
    history = JSON.parse(await readFile(historyFile, "utf-8"));
  } catch {
    // 히스토리 파일 없으면 생략
  }

  if (history.length) {
    for (const day of history) {
      if (news?.date && day.date === news.date) {
        // news.json과 오늘 히스토리 항목은 같은 내용이라 재번역하지 않고 재사용
        day.items = news.items;
        continue;
      }
      await translateItems(day.items ?? []);
    }
    await writeFile(historyFile, JSON.stringify(history, null, 2));
  }

  console.log("[translate-news] 번역 완료");
}

main();
