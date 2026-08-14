import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const newsFile = path.join(dataDir, "news.json");
const historyFile = path.join(dataDir, "news-history.json");

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:14b";
const DISABLE_THINKING = process.env.OLLAMA_THINK === "false";
const MAX_TRANSLATE_ATTEMPTS = 2;

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
    (_match, c1, u1, c2, u2) => (parseCoefficient(c1) * MAJOR_UNITS[u1] + parseCoefficient(c2) * MAJOR_UNITS[u2]).toLocaleString("en-US")
  );
  result = result.replace(
    new RegExp(`(${numTokenRe})(조|억|만)`, "g"),
    (_match, c, u) => (parseCoefficient(c) * MAJOR_UNITS[u]).toLocaleString("en-US")
  );
  return result;
}

function extractNormalizedNumbers(original, normalized) {
  if (original === normalized) return [];
  const numbers = normalized.match(/\d{1,3}(?:,\d{3})+/g) ?? [];
  return numbers.map((n) => n.replace(/,/g, ""));
}

async function translateTitle(title, attempt = 1) {
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
      options: { temperature: attempt > 1 ? 0.6 : 0.2, top_p: 0.8, num_predict: 80 },
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

function isBadTranslation(text, original, requiredNumbers) {
  if (!text) return true;
  if (/[가-힣]/.test(text)) return true;
  if (/[一-鿿]/.test(text)) return true;
  if (text.length > Math.max(200, original.length * 4)) return true;
  const textDigits = text.replace(/,/g, "");
  if (requiredNumbers.some((n) => !textDigits.includes(n))) return true;
  return false;
}

async function translateItems(items) {
  for (const item of items) {
    const requiredNumbers = extractNormalizedNumbers(item.title, normalizeKoreanAmounts(item.title));
    if (item.titleEn && !isBadTranslation(item.titleEn, item.title, requiredNumbers)) continue;
    try {
      let accepted = null;
      for (let attempt = 1; attempt <= MAX_TRANSLATE_ATTEMPTS; attempt++) {
        const translated = await translateTitle(item.title, attempt);
        if (!isBadTranslation(translated, item.title, requiredNumbers)) {
          accepted = translated;
          break;
        }
        console.error(
          `[translate-news] 번역 반려(${attempt}/${MAX_TRANSLATE_ATTEMPTS}): ${item.title}\n  -> ${translated}`
        );
      }
      item.titleEn = accepted ?? item.title;
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
  }

  if (history.length) {
    for (const day of history) {
      if (news?.date && day.date === news.date) {
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
