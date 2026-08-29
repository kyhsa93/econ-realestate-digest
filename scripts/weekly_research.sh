#!/usr/bin/env bash
# 일주일에 한 번, 경쟁 서비스와 사람들이 실제로 묻는 것을 살펴 집계에 없는 답을 찾고
# 값이 되는 것만 GitHub 이슈로 올린다.
#
# 무엇을 어떤 기준으로 올릴지는 여기 없다 — `research/HOWTO.md`가 사양이고, 그 사양은
# 다시 `DIRECTION.md`를 기준으로 삼는다. 이 스크립트는 언제 돌릴지만 정한다.
#
# **매시간 돌되 이번 주 몫이 끝났으면 즉시 끝난다.** 정해진 요일 정해진 시각에 한 번만
# 돌게 하면 그때 PC가 꺼져 있는 주는 통째로 건너뛴다. 데스크톱 cron은 폴링으로 짜고
# 실행 여부는 게이트가 정하는 것이 맞다 — 켜는 순간 놓친 주를 따라잡는다.
#
#   crontab:  25 * * * *  /home/young/workspace/jipgye/scripts/weekly_research.sh
#
# 주 단위인 것은 경쟁 서비스가 하루 만에 바뀌지 않기 때문이다. 매일 돌리면 같은 것을
# 다시 보고 없는 차이를 만들어 내게 된다.
#
# 수동 실행:  weekly_research.sh now    (이번 주 몫을 이미 했어도 강제로 한 번 더)
# 로그: ~/.local/state/jipgye-research/YYYY-MM.log

set -uo pipefail

# cron의 PATH는 비어 있다시피 하다. node는 nvm 아래 있어서 특히 잘 빠진다.
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
if [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGDIR="$HOME/.local/state/jipgye-research"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/$(date +%Y-%m).log"
STATE="$LOGDIR/last-week"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

FORCE=""
[ "${1:-}" = "now" ] && FORCE=1

# 동시 실행 방지. 매시간 도는데 앞 회차가 아직 돌고 있을 수 있다.
exec 9>"$LOGDIR/lock"
flock -n 9 || { log "skip: 이전 회차 실행 중"; exit 0; }

# ISO 주차. 연말연시에 해가 바뀌어도 주가 겹치거나 빠지지 않는다.
WEEK="$(date +%G-W%V)"
# 대부분의 회차는 여기서 끝난다. git도 안 건드리고 로그도 안 남긴다.
if [ -z "$FORCE" ] && [ "$WEEK" = "$(cat "$STATE" 2>/dev/null)" ]; then
  exit 0
fi

cd "$REPO" || { log "fail: 저장소 없음 $REPO"; exit 1; }

# 원격이 앞서 있으면 낡은 코드를 두고 조사하게 된다. Actions가 하루 여러 번 데이터를
# 커밋하므로 거의 항상 앞서 있다.
git pull --rebase --quiet origin main 2>>"$LOG" || log "warn: pull 실패, 로컬 상태로 진행"

log "조사 시작 $WEEK ($(git rev-parse --short HEAD))"

PROMPT="경쟁 서비스와 사람들이 실제로 묻는 것을 살펴, 집계에 없는 답 가운데 값이 되는 것만
GitHub 이슈로 올려라. 모든 산출물은 한국어로 쓴다.

## 사양서를 먼저 읽어라

무엇을 어떤 기준으로 올릴지는 이 프롬프트가 아니라 저장소 파일에 있다. 이 순서로 읽어라:

1. \`research/HOWTO.md\` — 절차, 올릴 것과 올리지 말 것, 이슈 형식. **가장 중요하다. 전부 읽고 그대로 따른다.**
2. \`DIRECTION.md\` — **이 봇은 이 문서의 집행자다.** 1부(대상·해자·하지 않는 것·체크리스트 열한 가지)와 3부(이미 정해 둔 다음 할 일)를 전부 읽어라.
3. \`README.md\` — 이 사이트가 무엇이고 데이터를 어떻게 세는지

## 반드시 지킬 것

- **\`gh issue list --state all --limit 100\` 을 가장 먼저 실행해라.** 닫힌 것도 본다.
  이미 있는 것, 이미 사람이 판단해 닫은 것을 다시 올리지 마라.
- **표본을 세지 않은 제안은 올리지 마라.** \`raw/\`에서 실제로 세고, 그 명령과 출력을
  이슈에 붙여라. 셀 수 없으면 올리지 마라.
- **본 것과 못 본 것을 갈라 적어라.** 경쟁 서비스는 대부분 자바스크립트로 그리는 화면이라
  받아 온 HTML만으로는 실제 화면을 못 본다. 확인된 것만 사실로 쓰고, 못 본 것은 못 봤다고
  적어라.
- **GA와 Search Console에는 붙을 수 없다.** 우리 사용자의 유입·검색어를 볼 방법이 없으니
  '사용자 데이터를 보니'로 시작하는 문장을 쓰지 마라. 공개 정황은 링크를 붙이고 공개
  정황이라고 밝혀라.
- **0건으로 끝나는 주가 정상이다.** 최대 2건이고, 2는 상한이지 목표가 아니다.
  올릴 것이 없으면 아무것도 하지 말고 그렇게 보고해라.
- **커밋하지 마라. push하지 마라. 저장소 파일을 고치지 마라.** 남기는 것은 이슈뿐이다.
  세어 보려고 만든 스크립트는 저장소 밖에 두고 끝나면 지워라.
- **질문하지 마라. 답할 사람이 없다.** 헤드리스로 도는 작업이다. 물어보고 멈추면 찾아
  놓은 것까지 버려진다. 올리든 안 올리든 스스로 정하고, 정한 이유를 보고해라.
- **다른 조사가 도는지 확인하지 마라.** 부르는 스크립트가 lock으로 하나만 돌게 막는다.
  프로세스 목록에 보이는 \`weekly_research.sh\`와 \`claude -p\`는 너 자신이다.
- 라벨은 \`research\`와 \`enhancement\`를 단다.

## 마무리

무엇을 봤고 무엇을 올렸는지(또는 왜 안 올렸는지) 짧게 보고해라. 후보를 검토하다 떨어뜨렸다면
어느 체크리스트 항목에서 떨어졌는지까지 적어라."

timeout 3600 claude -p "$PROMPT" \
  --model claude-sonnet-5 \
  --allowedTools Bash Read Glob Grep WebSearch WebFetch \
  >> "$LOG" 2>&1
RC=$?

# 손댄 것이 없어야 정상이다. 사양서가 고치지 말라고 했지만, 어긴 흔적은 남겨 둔다.
DIRTY="$(git status --porcelain | head -5)"
if [ -n "$DIRTY" ]; then
  log "warn: 작업 트리가 더럽다 — 사양서는 파일을 고치지 말라고 되어 있다"
  echo "$DIRTY" >> "$LOG"
fi

if [ "$RC" -ne 0 ]; then
  # 실패한 주는 이번 주 몫으로 치지 않는다. 다음 시각에 다시 시도한다.
  log "fail: claude 종료코드 $RC — 다음 회차에 재시도"
  exit "$RC"
fi

echo "$WEEK" > "$STATE"
OPEN="$(gh issue list --state open --label research --limit 50 2>/dev/null | wc -l)"
log "조사 끝 $WEEK — 열린 제안 이슈 ${OPEN}건"
