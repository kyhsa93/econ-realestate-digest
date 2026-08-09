import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "summary.json");

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:1.5b";

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, `${name}.json`), "utf-8"));
  } catch {
    return null;
  }
}

function buildPrompt(news, market) {
  const newsLines = (news?.items ?? [])
    .slice(0, 15)
    .map((item) => `- [${item.source}] ${item.title}`)
    .join("\n");

  const marketLines = [
    market?.kospi ? `코스피 ${market.kospi.value} (${market.kospi.change})` : null,
    market?.usdKrw ? `원/달러 환율 ${Number(market.usdKrw.value).toFixed(2)}원` : null,
    market?.baseRate ? `한국은행 기준금리 ${market.baseRate.value}% (${market.baseRate.effectiveFrom} 부터)` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `아래는 오늘 수집된 한국 경제/부동산 뉴스 제목 목록과 자산 시장 지표야.
이 내용을 바탕으로 한국어로 4~6문장짜리 오늘의 요약을 작성해줘.
뉴스에 없는 내용을 지어내지 말고, 실제 제목에 언급된 내용만 요약해.
과장된 전망이나 투자 조언은 하지 말고 사실 전달 위주로 작성해.

[시장 지표]
${marketLines || "정보 없음"}

[오늘의 뉴스 제목]
${newsLines || "정보 없음"}

요약:`;
}

async function generate(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const json = await res.json();
  if (!json.response) throw new Error("ollama 응답에 response 필드 없음");
  return json.response.trim();
}

async function main() {
  const [news, market] = await Promise.all([readJson("news"), readJson("market")]);

  if (!news && !market) {
    console.error("[summarize-digest] news/market 데이터 없음, 요약 생략");
    return;
  }

  const prompt = buildPrompt(news, market);

  let summary;
  try {
    summary = await generate(prompt);
  } catch (err) {
    console.error(`[summarize-digest] 요약 생성 실패: ${err.message}`);
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    outFile,
    JSON.stringify({ updatedAt: new Date().toISOString(), model: MODEL, summary }, null, 2)
  );

  console.log("[summarize-digest] 저장 완료");
}

main();
