#!/bin/sh
# 실기기 검증용 빌드/설치.
#
# ⚠ 정식 번들 ID `com.voicealarm.nativeapp.ios` 와 App Group
# `group.com.voicealarm.nativeapp.ios.shared` 는 **다른 개발자 팀이 선점**하고 있어
# 이 팀 계정으로는 등록이 안 된다("cannot be registered … not available").
# 그래서 로컬 실기기 검증만 임시 번들 ID + App Group 없는 entitlements 로 서명한다.
# 배포에는 쓰지 말 것 — project.yml 의 정식 값이 릴리스 기준이다.
set -e
TEAM="${DEVELOPMENT_TEAM:?DEVELOPMENT_TEAM 환경변수를 지정할 것 (예: 29N7GX354N)}"
DEVICE="${DEVICE_UDID:?DEVICE_UDID 환경변수를 지정할 것}"
cd "$(dirname "$0")/.."
xcodegen generate
xcodebuild -project AlarmTalkNative.xcodeproj -scheme AlarmTalk -configuration Debug \
  -destination "id=$DEVICE" -allowProvisioningUpdates -skipPackagePluginValidation \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
  PRODUCT_BUNDLE_IDENTIFIER=com.voicealarm.nativeapp.ios.devtest \
  CODE_SIGN_ENTITLEMENTS=AlarmTalk/Configuration/DeviceTest.entitlements \
  "$@" build
