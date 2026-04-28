#!/usr/bin/env bash
# .ralph/run.sh - Ralph Loop main harness
set -u  # set -e 는 쓰지 않는다. 루프가 실패해도 계속 돌아야 하므로.

# ---------- 설정 ----------
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RALPH_DIR="$PROJECT_DIR/.ralph"
LOG_DIR="$RALPH_DIR/logs"
JOURNAL_DIR="$RALPH_DIR/JOURNAL"

MAX_ITERATIONS="${MAX_ITERATIONS:-150}"
STALL_TIMEOUT="${STALL_TIMEOUT:-1800}"     # 30분 (음성/TTS 통신 시간 고려)
COOLDOWN="${COOLDOWN:-10}"
MAX_IDLE="${MAX_IDLE:-5}"                  # 연속 N회 변경 없으면 자동 종료
BRANCH="${RALPH_BRANCH:-develop_loop}"     # develop_loop 브랜치에서 작업 (리뷰 후 develop으로 PR 머지)
PUSH_ENABLED="${RALPH_PUSH:-1}"            # 1=push 후 자동배포, 0=로컬만

mkdir -p "$LOG_DIR" "$JOURNAL_DIR"
cd "$PROJECT_DIR" || exit 1

# SSL 우회 (네트워크 환경 대응)
export NODE_TLS_REJECT_UNAUTHORIZED=0

# ---------- 브랜치 준비 ----------
git fetch --all --quiet || true

# develop 브랜치가 없으면 main에서 생성
if ! git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git checkout -b "$BRANCH" "origin/$BRANCH"
  else
    git checkout -b "$BRANCH"
  fi
else
  git checkout "$BRANCH" || { echo "branch checkout failed"; exit 1; }
  git pull --rebase origin "$BRANCH" 2>/dev/null || true
fi

echo "[$(date)] Ralph harness start on branch $BRANCH" | tee -a "$LOG_DIR/harness.log"

# ---------- 메인 루프 ----------
iteration=0
idle_count=0
commit_count=0
stop_reason=""

while (( iteration < MAX_ITERATIONS )); do
  iteration=$((iteration + 1))
  ts="$(date +%Y%m%d-%H%M%S)"
  log_file="$LOG_DIR/loop-${ts}-iter${iteration}.log"

  # heartbeat 갱신 (watchdog가 감시)
  touch "$RALPH_DIR/heartbeat"

  echo "=== iter $iteration @ $ts ===" | tee -a "$log_file"

  # Claude 실행 - 무개입 모드
  timeout --signal=SIGTERM "$STALL_TIMEOUT" \
    claude -p \
      --dangerously-skip-permissions \
      --output-format stream-json \
      --verbose \
      < "$RALPH_DIR/PROMPT.md" \
      >> "$log_file" 2>&1 &
  CLAUDE_PID=$!
  echo $CLAUDE_PID > "$RALPH_DIR/claude.pid"

  wait $CLAUDE_PID
  exit_code=$?
  rm -f "$RALPH_DIR/claude.pid"

  # 변경사항 있으면 자동 커밋
  if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
    git add -A
    git commit -m "ralph: iter ${iteration} @ ${ts} (exit=${exit_code})" \
      --no-verify || true

    # ⚠️ 자동 배포 비활성화 - 사용자 요청으로 push 주석 처리
    # if [ "$PUSH_ENABLED" = "1" ]; then
    #   git push origin "$BRANCH" 2>>"$log_file" || {
    #     echo "[iter $iteration] push failed, will retry next iter" >> "$log_file"
    #   }
    # fi
    echo "[iter $iteration] committed (commits stay local)" >> "$log_file"
    idle_count=0
    commit_count=$((commit_count + 1))
  else
    idle_count=$((idle_count + 1))
    echo "[iter $iteration] no changes (idle ${idle_count}/${MAX_IDLE})" >> "$log_file"

    if (( idle_count >= MAX_IDLE )); then
      stop_reason="IDLE_LIMIT"
      echo "[iter $iteration] idle limit reached (${MAX_IDLE} consecutive no-change iterations)" \
        | tee -a "$log_file"
      break
    fi
  fi

  # 스톨 기록
  if [ "$exit_code" = "124" ] || [ "$exit_code" = "137" ]; then
    {
      echo "## iter ${iteration} @ ${ts}"
      echo "- exit=${exit_code} (timeout ${STALL_TIMEOUT}s)"
      echo "- log=${log_file}"
      echo ""
    } >> "$JOURNAL_DIR/stalls.md"
  fi

  sleep "$COOLDOWN"
done

# ---------- 종료 요약 ----------
if [ -z "$stop_reason" ]; then
  stop_reason="MAX_ITERATIONS"
fi

summary="[$(date)] Ralph harness stopped: reason=${stop_reason}, iterations=${iteration}, commits=${commit_count}, final_idle=${idle_count}"
echo "$summary" | tee -a "$LOG_DIR/harness.log"
