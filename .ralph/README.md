# Ralph Loop Harness

VoiceAlarm 프로젝트의 야간 무인 자율 개발 시스템.

## 사전 요구사항

### 1. Claude Code CLI 설치 (필수)

Ralph 루프는 `claude` 명령어를 호출합니다. CLI가 PATH에 있어야 합니다.

```powershell
# Claude Code 설치 확인
claude --version

# 없으면 설치 (방법 1: npm)
npm install -g @anthropic-ai/claude-code

# 또는 (방법 2: 공식 설치 페이지)
# https://claude.com/claude-code 참고
```

### 2. Git Bash 환경

Windows에서는 Git Bash 또는 WSL 에서 실행해야 합니다 (`run.sh` 가 bash 스크립트).

### 3. 환경변수 / 시크릿

- `packages/backend/.dev.vars` (백엔드 로컬 시크릿)
- `apps/mobile/.env`

위 파일들이 채워져 있어야 루프가 빌드/테스트를 수행할 수 있습니다.

### 4. GitHub 인증 (자동배포용)

루프가 develop 브랜치에 push 하면 GitHub Actions가 배포를 트리거합니다. push 권한이 있어야 합니다.

```powershell
gh auth login
git remote -v   # origin 이 https://github.com/perso-devrel/voice_alarm.git 인지 확인
```

## 실행 방법

### 드라이런 (먼저 한 번)

```bash
cd /c/Users/EST/Desktop/alarm
MAX_ITERATIONS=2 ./.ralph/run.sh
```

2번 돌고 종료. 정상이면 `.ralph/logs/` 에 로그가 쌓이고 develop 브랜치에 커밋이 생깁니다.

### 본 가동

```bash
# 별도 터미널 1: watchdog 띄우기
./.ralph/watchdog.sh &

# 별도 터미널 2: 메인 루프
./.ralph/run.sh
```

### 환경변수로 조정

```bash
MAX_ITERATIONS=100 STALL_TIMEOUT=2400 COOLDOWN=15 ./.ralph/run.sh
```

| 변수 | 기본 | 의미 |
|---|---|---|
| `MAX_ITERATIONS` | 300 | 최대 반복 횟수 (비용 가드) |
| `STALL_TIMEOUT` | 1800 | 한 iteration 의 타임아웃 (초) |
| `COOLDOWN` | 10 | iteration 사이 sleep (초) |
| `RALPH_BRANCH` | develop | 작업 브랜치 |
| `RALPH_PUSH` | 1 | 1=push 활성화 (자동배포), 0=로컬만 |
| `NODE_TLS_REJECT_UNAUTHORIZED` | 0 | SSL 우회 (회사망 대응) |

## 다음 날 아침 리뷰

```bash
./.ralph/summary.sh > review.md
```

`review.md` 를 보고 develop 브랜치의 변경사항을 검토. 좋으면:

```bash
gh pr create --base main --head develop --title "release: ..." --body "..."
gh pr merge <num> --merge
```

## 안전 장치

- ❌ main 브랜치 직접 수정 금지
- ❌ `.env` / `.dev.vars` / 시크릿 커밋 금지
- ❌ `test/` 폴더 내 오디오 파일 커밋 금지
- ❌ `git push --force` 금지
- ✅ 변경 없으면 커밋 skip
- ✅ 스톨 시 watchdog가 강제 종료, 다음 iter 자동 재시작
- ✅ 모든 결정은 JOURNAL 에 기록

## 파일 구조

```
.ralph/
├── README.md         # 이 문서
├── run.sh            # 메인 harness
├── watchdog.sh       # 스톨 감시
├── summary.sh        # 아침 리뷰 도구
├── PROMPT.md         # Claude 에게 주입되는 프롬프트
├── STATE.md          # 현재 상태 (Claude 가 갱신)
├── BACKLOG.md        # 할 일 목록 (Claude 가 갱신)
├── JOURNAL/          # iteration 별 작업 일지
│   ├── 01-init.md
│   └── stalls.md
├── logs/             # (gitignored) 원시 stdout
├── heartbeat         # (gitignored) watchdog 신호
└── claude.pid        # (gitignored) 현재 claude 프로세스 PID
```
