#!/usr/bin/env bash
# 하루 한 번, 저장소를 로컬에서 돌려 보고 고칠 값이 있는 것만 GitHub 이슈로 올린다.
#
# 무엇을 어떤 기준으로 올리는지는 여기 없다 — `audit/HOWTO.md`가 사양이다.
# 사양을 고치려면 그 파일만 고치면 되고, 이 스크립트는 언제 돌릴지만 정한다.
#
# **매시간 돌되 오늘 몫이 끝났으면 즉시 끝난다.** 자정에 딱 맞춰 한 번만 돌게 하면
# 그 시각에 PC가 꺼져 있는 날은 그냥 건너뛴다. 데스크톱 cron은 폴링으로 짜고 실행
# 여부는 게이트가 정하는 것이 맞다 — 켜는 순간 놓친 날을 따라잡는다.
#
#   crontab:  5 * * * *  /home/young/workspace/econ-realestate-digest/scripts/daily_audit.sh
#
# 수동 실행:  daily_audit.sh now    (오늘 몫을 이미 했어도 강제로 한 번 더)
# 로그: ~/.local/state/econ-digest-audit/YYYY-MM.log

set -uo pipefail

# cron의 PATH는 비어 있다시피 하다. node는 nvm 아래 있어서 특히 잘 빠진다.
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
if [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGDIR="$HOME/.local/state/econ-digest-audit"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/$(date +%Y-%m).log"
STATE="$LOGDIR/last-day"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

FORCE=""
[ "${1:-}" = "now" ] && FORCE=1

# 동시 실행 방지. 매시간 도는데 앞 회차가 아직 돌고 있을 수 있다.
exec 9>"$LOGDIR/lock"
flock -n 9 || { log "skip: 이전 회차 실행 중"; exit 0; }

DAY="$(date +%F)"
# 대부분의 회차는 여기서 끝난다. git도 안 건드리고 로그도 안 남긴다.
if [ -z "$FORCE" ] && [ "$DAY" = "$(cat "$STATE" 2>/dev/null)" ]; then
  exit 0
fi

cd "$REPO" || { log "fail: 저장소 없음 $REPO"; exit 1; }

# 원격이 앞서 있으면 낡은 코드를 점검하게 된다. 이 저장소는 Actions가 하루 여러 번
# 데이터를 커밋하므로 거의 항상 앞서 있다.
git pull --rebase --quiet origin main 2>>"$LOG" || log "warn: pull 실패, 로컬 상태로 진행"

log "점검 시작 $DAY ($(git rev-parse --short HEAD))"

PROMPT="이 저장소를 로컬에서 직접 돌려 보고, 고칠 값이 있는 것만 GitHub 이슈로 올려라.
모든 산출물은 한국어로 쓴다.

## 사양서를 먼저 읽어라

무엇을 어떤 기준으로 올릴지는 이 프롬프트가 아니라 저장소 파일에 있다. 이 순서로 읽어라:

1. \`audit/HOWTO.md\` — 절차, 올릴 것과 올리지 말 것, 이슈 형식. **가장 중요하다. 전부 읽고 그대로 따른다.**
2. \`README.md\` — 이 사이트가 무엇이고 데이터를 어떻게 세는지
3. \`docs/method.html\` — 집계 기준과 '하지 않는 것'. 여기 적힌 것을 제안하면 안 된다.

## 반드시 지킬 것

- **\`gh issue list --state all --limit 100\` 을 가장 먼저 실행해라.** 닫힌 것도 본다.
  이미 있는 것을 다시 올리지 마라.
- **전부 실제로 실행해서 확인해라.** 추측으로 쓴 문장은 이슈에 넣지 마라. 모든 주장에
  명령과 그 출력이 붙어야 한다.
- **0건으로 끝나는 날이 정상이다.** 최대 3건이고, 3은 상한이지 목표가 아니다.
  올릴 것이 없으면 아무것도 하지 말고 그렇게 보고해라.
- **커밋하지 마라. push하지 마라. 저장소 파일을 고치지 마라.** 남기는 것은 이슈뿐이다.
  \`npm test\`가 깨져 있어도 고치지 말고 깨진 사실만 이슈로 올려라.
- **질문하지 마라. 답할 사람이 없다.** 헤드리스로 도는 작업이다. 물어보고 멈추면 찾아
  놓은 것까지 버려진다. 올리든 안 올리든 스스로 정하고, 정한 이유를 보고해라.
- **다른 감사가 도는지 확인하지 마라.** 부르는 스크립트가 lock으로 하나만 돌게 막는다.
  프로세스 목록에 보이는 \`daily_audit.sh\`와 \`claude -p\`는 너 자신이다.
- 라벨은 오류에 \`bug\`, 개선에 \`enhancement\`, 둘 다에 \`audit\`을 단다.

## 마무리

무엇을 확인했고 무엇을 올렸는지(또는 왜 안 올렸는지) 짧게 보고해라."

timeout 3600 claude -p "$PROMPT" \
  --model claude-sonnet-5 \
  --allowedTools Bash Read Glob Grep WebFetch \
  >> "$LOG" 2>&1
RC=$?

# 손댄 것이 없어야 정상이다. 사양서가 고치지 말라고 했지만, 어긴 흔적은 남겨 둔다.
DIRTY="$(git status --porcelain | head -5)"
if [ -n "$DIRTY" ]; then
  log "warn: 작업 트리가 더럽다 — 사양서는 파일을 고치지 말라고 되어 있다"
  echo "$DIRTY" >> "$LOG"
fi

if [ "$RC" -ne 0 ]; then
  # 실패한 날은 오늘 몫으로 치지 않는다. 다음 시각에 다시 시도한다.
  log "fail: claude 종료코드 $RC — 다음 회차에 재시도"
  exit "$RC"
fi

echo "$DAY" > "$STATE"
OPEN="$(gh issue list --state open --label audit --limit 50 2>/dev/null | wc -l)"
log "점검 끝 $DAY — 열린 점검 이슈 ${OPEN}건"
