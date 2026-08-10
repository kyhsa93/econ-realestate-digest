import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const newsFile = path.join(dataDir, "news.json");
const historyFile = path.join(dataDir, "news-history.json");

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:1.5b";

async function translateTitle(title) {
  const prompt = `Translate the following Korean news headline into natural, concise English.
Output ONLY the translated headline. No quotes, no explanation, no extra commentary, no notes.

Korean headline: ${title}

English headline:`;

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.2, top_p: 0.8, num_predict: 80 },
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
// 딴소리를 늘어놓은 경우(비정상적으로 길어짐)를 걸러내 원문 한국어로 폴백한다.
function isBadTranslation(text, original) {
  if (!text) return true;
  if (/[가-힣]/.test(text)) return true; // 한글이 그대로 남아있으면 번역 실패로 간주
  if (text.length > Math.max(120, original.length * 3)) return true; // 비정상적으로 길면 딴소리
  return false;
}

async function translateItems(items) {
  for (const item of items) {
    // titleEn이 원문과 똑같으면 "실패해서 원문으로 폴백해둔 것"이므로
    // 번역된 것으로 치지 않고 다음 실행에서 다시 시도한다.
    if (item.titleEn && item.titleEn !== item.title) continue;
    try {
      const translated = await translateTitle(item.title);
      if (isBadTranslation(translated, item.title)) {
        console.error(`[translate-news] 번역 실패로 원문 유지: ${item.title}`);
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
