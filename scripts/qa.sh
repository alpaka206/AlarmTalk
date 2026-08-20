#!/usr/bin/env bash
# 실기기 QA 조작·캡처 헬퍼(로컬 전용).
#
# 안드로이드는 adb 로 즉시 조작되고, 캡처는 qa-shots/ 에 순번을 붙여 쌓는다.
# 아이폰은 adb 같은 실시간 경로가 없어 XCUITest 묶음으로 따로 돈다.
#
#   scripts/qa.sh shot s23 01-무료-홈        # 캡처만
#   scripts/qa.sh tap  s23 540 1200          # 좌표 탭(기기 실제 픽셀)
#   scripts/qa.sh tapn s23 0.5 0.62          # 정규화 탭(0~1) — 해상도 무관
#   scripts/qa.sh text s23 "안녕"            # 입력
#   scripts/qa.sh key  s23 BACK              # 키
#   scripts/qa.sh theme s23 dark|light       # OS 테마
#   scripts/qa.sh ui   s23                   # 화면 요소 덤프(라벨 찾기용)
set -euo pipefail

ADB="$HOME/Library/Android/sdk/platform-tools/adb"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOTS="$ROOT/qa-shots"
mkdir -p "$SHOTS"

dev() {
  case "$1" in
    s23) echo "R3CW300EZBA" ;;
    a32) echo "RF9R40323AP" ;;
    *) echo "$1" ;;
  esac
}

cmd="$1"; shift
case "$cmd" in
  shot)
    d=$(dev "$1"); name="$2"
    "$ADB" -s "$d" exec-out screencap -p > "$SHOTS/$name.png"
    echo "$SHOTS/$name.png"
    ;;
  tap)
    d=$(dev "$1"); "$ADB" -s "$d" shell input tap "$2" "$3"
    ;;
  tapn)
    d=$(dev "$1")
    size=$("$ADB" -s "$d" shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1)
    w=${size%x*}; h=${size#*x}
    x=$(python3 -c "print(int($w*$2))"); y=$(python3 -c "print(int($h*$3))")
    "$ADB" -s "$d" shell input tap "$x" "$y"
    ;;
  text)
    d=$(dev "$1"); shift
    # 한글은 adb input text 로 안 들어간다 — 호출부가 ASCII 만 쓰거나 클립보드를 쓴다.
    "$ADB" -s "$d" shell input text "$(printf '%s' "$1" | sed 's/ /%s/g')"
    ;;
  key)
    d=$(dev "$1"); "$ADB" -s "$d" shell input keyevent "KEYCODE_$2"
    ;;
  theme)
    d=$(dev "$1"); mode="$2"
    [ "$mode" = "dark" ] && "$ADB" -s "$d" shell cmd uimode night yes || "$ADB" -s "$d" shell cmd uimode night no
    ;;
  ui)
    d=$(dev "$1")
    "$ADB" -s "$d" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    "$ADB" -s "$d" shell cat /sdcard/ui.xml 2>/dev/null \
      | tr '>' '\n' | grep -oE 'text="[^"]+"|content-desc="[^"]+"|bounds="[^"]+"' \
      | paste - - 2>/dev/null | head -60
    ;;
  taplbl)
    # 라벨로 누른다 — 좌표 추측은 시스템 내비바를 눌러 홈으로 나가는 사고가 난다.
    d=$(dev "$1"); label="$2"
    "$ADB" -s "$d" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    xy=$("$ADB" -s "$d" shell cat /sdcard/ui.xml 2>/dev/null | python3 "$ROOT/scripts/qa-find.py" "$label") || true
    if [ -z "$xy" ]; then echo "없음: $label" >&2; exit 2; fi
    "$ADB" -s "$d" shell input tap $xy
    echo "tapped $label @ $xy"
    ;;
  find)
    d=$(dev "$1"); label="$2"
    "$ADB" -s "$d" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    "$ADB" -s "$d" shell cat /sdcard/ui.xml 2>/dev/null | python3 "$ROOT/scripts/qa-find.py" "$label" --all
    ;;
  launch)
    d=$(dev "$1"); "$ADB" -s "$d" shell monkey -p com.alarmtalk.app.dev -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    ;;
  *) echo "모르는 명령: $cmd" >&2; exit 1 ;;
esac
