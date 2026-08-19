#!/bin/sh
# 실기기 검증용 빌드/설치.
#
# ⚠ **이 스크립트가 존재하던 이유는 2026-08-06 에 사라졌다.**
# 예전 번들 ID `com.voicealarm.nativeapp.ios` 와 그 App Group 을 다른 개발자 팀이
# 선점하고 있어("cannot be registered … not available") 정식 값으로는 서명이 안 됐고,
# 그래서 임시 번들 ID + App Group 없는 entitlements 라는 우회로가 필요했다.
# 이제 번들 ID 는 우리가 가진 `com.alarmtalk.app` 라 **정식 값 그대로 실기기에 올라간다.**
#
# 남겨 두는 건 App Group·키체인 공유가 없는 상태를 일부러 재현해 보고 싶을 때뿐이다
# (`AudioCacheStore` 폴백 검증 등). 평소 실기기 설치는 그냥 Xcode/xcodebuild 로 하면 된다.
set -e
TEAM="${DEVELOPMENT_TEAM:?DEVELOPMENT_TEAM 환경변수를 지정할 것 (예: 29N7GX354N)}"
DEVICE="${DEVICE_UDID:?DEVICE_UDID 환경변수를 지정할 것}"
cd "$(dirname "$0")/.."
xcodegen generate
xcodebuild -project AlarmTalkNative.xcodeproj -scheme AlarmTalk -configuration Debug \
  -destination "id=$DEVICE" -allowProvisioningUpdates -skipPackagePluginValidation \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
  PRODUCT_BUNDLE_IDENTIFIER=com.alarmtalk.app.devtest \
  CODE_SIGN_ENTITLEMENTS=AlarmTalk/Configuration/DeviceTest.entitlements \
  "$@" build
