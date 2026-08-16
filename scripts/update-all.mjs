import { execSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function run(cmd) {
  execSync(cmd, { cwd: repoRoot, stdio: "inherit" });
}

async function main() {
  run("node scripts/fetch-news.mjs");
  run("node scripts/fetch-market.mjs");
  run("node scripts/build-history-lite.mjs");
  // 프리렌더가 news.json을 읽어 정적 HTML에 심으므로, 기사에 수치를 붙이는 건
  // 반드시 그 전이어야 한다.
  run("node scripts/news-context.mjs");
  run("node scripts/prerender.mjs");
  run("node scripts/build-rate-pages.mjs");
  run("node scripts/build-news-pages.mjs");

  const status = execSync("git status --porcelain -- docs", { cwd: repoRoot }).toString().trim();
  if (!status) {
    console.log("[update-all] 변경사항 없음, 커밋 생략");
    return;
  }

  run("git add docs");
  run(
    `git commit -m "chore: 데일리 데이터 갱신 $(TZ=Asia/Seoul date +%Y-%m-%d)"`
  );
  run("git push");
  console.log("[update-all] 커밋 및 푸시 완료");
}

main();
