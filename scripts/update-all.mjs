import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function run(cmd) {
  execSync(cmd, { cwd: repoRoot, stdio: "inherit" });
}

function trackedPaths() {
  return ["docs", "raw"].filter((dir) => existsSync(path.join(repoRoot, dir)));
}

async function main() {
  run("node scripts/fetch-news.mjs");
  run("node scripts/fetch-market.mjs");
  run("node scripts/build-realestate.mjs");
  run("node scripts/build-budget-deals.mjs");
  run("node scripts/build-conversion.mjs");
  run("node scripts/build-cancellation.mjs");
  run("node scripts/build-renewal-facts.mjs");
  run("node scripts/build-complex-ratio.mjs");
  run("node scripts/build-search-index.mjs");
  run("node scripts/news-context.mjs");
  run("node scripts/prerender.mjs");
  run("node scripts/build-rate-pages.mjs");
  run("node scripts/build-news-pages.mjs");
  run("node scripts/build-budget-pages.mjs");
  run("node scripts/build-realestate-pages.mjs");

  const status = execSync("git status --porcelain -- docs raw", { cwd: repoRoot }).toString().trim();
  if (!status) {
    console.log("[update-all] 변경사항 없음, 커밋 생략");
    return;
  }

  run(`git add ${trackedPaths().join(" ")}`);
  run(
    `git commit -m "chore: 데일리 데이터 갱신 $(TZ=Asia/Seoul date +%Y-%m-%d)"`
  );
  run("git push");
  console.log("[update-all] 커밋 및 푸시 완료");
}

main();
