#!/bin/bash
# docs/legal 의 '정책 버전: N' 을 읽어 Swift 상수로 내보낸다.
#
# 안드로이드가 app/build.gradle.kts:101 에서 하는 일과 같다. 서버의
# CURRENT_POLICY_VERSION 과 클라가 보내는 document_version 이 어긋나면 동의 기록이
# 409 POLICY_VERSION_MISMATCH 로 전부 거부되므로, 손으로 관리하지 않고 문서에서 뽑는다.
#
# 두 문서의 버전이 다르면 여기서 빌드를 세운다 — 조용히 한쪽만 올라가는 것이 가장 위험하다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEGAL_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)/docs/legal"
OUT="$SCRIPT_DIR/../AlarmTalk/Generated/LegalPolicyVersion.swift"

read_version() {
  local file="$1"
  [ -f "$file" ] || { echo "법무 문서를 찾을 수 없다: $file" >&2; exit 1; }
  local v
  v="$(grep -E '^정책 버전:[[:space:]]*[0-9]+[[:space:]]*$' "$file" | head -1 | sed -E 's/^정책 버전:[[:space:]]*([0-9]+)[[:space:]]*$/\1/')"
  [ -n "$v" ] || { echo "$file 에서 '정책 버전: N' 줄을 찾지 못했다. 문서 머리말을 확인할 것." >&2; exit 1; }
  echo "$v"
}

PRIVACY="$(read_version "$LEGAL_DIR/privacy-policy.ko.md")"
TERMS="$(read_version "$LEGAL_DIR/terms-of-service.ko.md")"

if [ "$PRIVACY" != "$TERMS" ]; then
  echo "법무 문서 정책 버전이 서로 다르다: privacy-policy=$PRIVACY terms-of-service=$TERMS" >&2
  exit 1
fi

NEXT="// 이 파일은 scripts/generate-legal-version.sh 가 만든다. 직접 고치지 말 것.
// 출처: docs/legal/privacy-policy.ko.md · docs/legal/terms-of-service.ko.md 의 '정책 버전' 머리말.
enum LegalPolicy {
    /// 이 빌드가 번들에 담고 있는 법무 문서의 버전. \`POST /user/consents\` 의
    /// \`document_version\` 으로 보낸다. 서버의 CURRENT_POLICY_VERSION 과 다르면
    /// 409 POLICY_VERSION_MISMATCH 로 거부된다.
    static let bundledVersion = \"$PRIVACY\"
}
"

# 내용이 같으면 건드리지 않는다(불필요한 재컴파일 방지).
if [ ! -f "$OUT" ] || [ "$(cat "$OUT")" != "$NEXT" ]; then
  printf '%s' "$NEXT" > "$OUT"
  echo "LegalPolicyVersion.swift 갱신: $PRIVACY"
else
  echo "LegalPolicyVersion.swift 최신: $PRIVACY"
fi
