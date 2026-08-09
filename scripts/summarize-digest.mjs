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

// 시장 지표(코스피/환율/기준금리)는 이미 화면에 숫자로 정확히 표시되므로
// AI에게는 넘기지 않는다 — 작은 모델이 숫자를 섞어 지어내는 걸 방지하기 위함.
function buildPrompt(news) {
  const newsLines = (news?.items ?? [])
    .slice(0, 15)
    .map((item, i) => `${i + 1}. ${item.title}`)
    .join("\n");

  return `너는 한국 경제 뉴스 편집 보조야. 아래는 오늘 수집된 뉴스 제목 15개야.
이걸 정확히 3개의 주제 그룹으로 압축해야 해. 15개를 그대로 나열하면 안 돼.

[뉴스 제목]
${newsLines || "정보 없음"}

규칙:
- 반드시 3줄만 출력해. 그 이상도 이하도 안 돼.
- 각 줄은 "- "로 시작하고, 여러 제목을 하나의 문장으로 압축해서 요약해.
- 제목에 나온 단어와 사실만 사용하고, 제목에 없는 숫자·수치·전망·원인은 절대 지어내지 마.
- 투자 조언이나 예측은 하지 마.
- 다른 설명 없이 3줄만 출력해.

예시 출력 형식 (내용은 예시일 뿐, 실제 제목 기반으로 새로 작성할 것):
- 금리와 예금 상품 관련 소식이 이어짐
- 서울 아파트 매물과 세제개편 관련 뉴스가 다수
- 환율 변동성에 대한 보도가 있음

출력:`;
}

async function generate(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.1, top_p: 0.7, num_predict: 400 },
    }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const json = await res.json();
  if (!json.response) throw new Error("ollama 응답에 response 필드 없음");
  return json.response.trim();
}

async function main() {
  const news = await readJson("news");

  if (!news?.items?.length) {
    console.error("[summarize-digest] news 데이터 없음, 요약 생략");
    return;
  }

  const prompt = buildPrompt(news);

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
