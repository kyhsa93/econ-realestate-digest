#!/usr/bin/env bash
# docs 변경을 커밋하고 밀어넣는다. 수집 워크플로와 요약 워크플로가 같이 쓴다.
#
# 두 워크플로가 각자 docs를 커밋하기 때문에 push는 언제든 밀릴 수 있다. concurrency로
# 같은 줄에 세워도 실제로 겹친 적이 있다(요약이 03:59:07에 끝났는데 수집이 03:58:05에
# 시작했다). 그래서 "밀리면 받아서 다시 얹는다"가 이 스크립트의 전부다.
#
# 두 가지를 반드시 지킨다.
#   - rebase가 충돌로 멈추면 다음 시도 전에 반드시 abort한다. 안 그러면 rebase 진행 중
#     상태로 남아 남은 재시도가 전부 같은 자리에서 죽는다(실제로 5번을 그렇게 날렸다).
#   - 충돌은 우리 쪽 산출물로 푼다(-X theirs는 rebase에서 '얹는 커밋' 쪽이다). 데이터
#     파일은 스크립트가 매번 전체를 다시 쓰는 성격이라 나중 실행 결과가 맞고, 하루치가
#     잠깐 어긋나도 다음 수집이 정정한다.
set -euo pipefail

message="${1:?커밋 메시지가 필요합니다}"

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

if git diff --quiet -- docs; then
  echo "변경사항 없음, 커밋 생략"
  exit 0
fi

git add docs
git commit -m "$message"

branch="$(git rev-parse --abbrev-ref HEAD)"

for i in 1 2 3 4 5; do
  if git push; then
    exit 0
  fi

  echo "push 실패($i) - 원격 변경을 받아 다시 얹는다"
  git rebase --abort 2>/dev/null || true

  if ! git pull --rebase -X theirs origin "$branch"; then
    echo "rebase 충돌을 풀지 못했습니다. 되돌리고 다시 시도합니다"
    git rebase --abort 2>/dev/null || true
  fi

  sleep $((i * 5))
done

echo "push 재시도 모두 실패"
exit 1
