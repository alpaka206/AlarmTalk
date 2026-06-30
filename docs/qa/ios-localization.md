# iOS 로컬라이즈(ko/en/ja) 설정 가이드

Android는 `ko`(기본)·`en`·`ja` 3개 로케일을 `strings.xml`(각 ~1,118개)로 제공한다.
iOS는 그동안 로컬라이즈 인프라가 전혀 없어 모든 문자열이 한국어로 하드코딩되어 있었다(영어·일본어 사용자도 전부 한국어 UI). 이 문서는 Android와 동일한 3개 로케일을 iOS에 붙이는 방법을 정리한다.

## 핵심 원리 — "한국어 리터럴이 곧 키"

SwiftUI `Text("좋은 아침이에요")` 의 인자는 `LocalizedStringKey` 다. 즉 **문자열 리터럴 자체가 로컬라이즈 키**로 쓰인다.
따라서 호출부를 바꾸지 않고 **String Catalog(`.xcstrings`)** 에 그 한국어 키에 대한 en/ja 번역만 채워 넣으면 자동으로 번역된다.

- `sourceLanguage = ko` → `ko` 값 = 키 자체.
- `en`/`ja` 값은 `Localizable.xcstrings` 가 제공.
- 매칭은 **한국어 텍스트 완전 일치** 기준 — 띄어쓰기·문장부호까지 똑같아야 적용된다.

## 이 레포에 이미 적용된 것

- **표시명 통일**: `Info.plist` `CFBundleDisplayName` `알람톡` → `AlarmTalk` (Android `app_name` 이 전 로케일 "AlarmTalk" 인 것과 일치).
- **개발 언어**: `project.yml` `options.developmentLanguage: ko` (소스 = 한국어).
- **권한 설명 로컬라이즈**: `AlarmTalk/InfoPlist.xcstrings` — `NSAlarmKitUsageDescription` / `NSMicrophoneUsageDescription` / `NSLocationWhenInUseUsageDescription` 의 ko/en/ja.
- **UI 문자열 카탈로그**: `AlarmTalk/Localizable.xcstrings` — 화면에 보이는 한국어 문자열을 키로, Android `strings.xml` 의 en/ja 를 매핑(매칭 안 되는 iOS 전용 문자열은 직접 번역). 보간(`\(...)`) 이 든 포맷 문자열은 1차 대상에서 제외(아래 TODO).

## Mac에서 한 번 해야 하는 활성화 작업

윈도우(이 환경)에서는 Xcode 빌드가 불가능해 **프로젝트 `knownRegions` 에 en·ja 등록**을 자동으로 끝낼 수 없다. Mac에서 1회:

1. `cd apps/ios-native && xcodegen generate` (project.yml 반영).
2. Xcode로 `AlarmTalkNative.xcodeproj` 열기 → 프로젝트 설정 → **Info ▸ Localizations** 에서 **Korean(기본)** 확인하고 **English**, **Japanese** 추가(`+`). 이러면 `knownRegions = [ko, en, ja, Base]` 가 된다.
3. 빌드 1회. Xcode가 `Localizable.xcstrings` / `InfoPlist.xcstrings` 를 인식하고, 코드 안의 `Text("…")` 리터럴 중 **카탈로그에 아직 없는 키**를 자동 추출(extract)해 채운다.
4. 자동 추출로 새로 생긴 키(보간 포맷 문자열 포함)의 en/ja 를 Android `strings.xml` 기준으로 채운다.
5. 시뮬레이터 언어를 English/日本語로 바꿔 화면 확인.

## 남은 작업(TODO)

- **보간 포맷 문자열**: `"남은 슬롯 \(n)개"` 같은 동적 문자열은 카탈로그에서 `%lld` 형태 포맷 키로 다뤄야 해 1차 추출에서 제외했다. Xcode 자동 추출 후 포맷 키로 번역 채우기.
- **String(format:) / 비-Text 경로**: `Text` 가 아닌 곳(예: 알림 본문, 일부 에러 문자열)은 `String(localized:)` 로 감싸야 로컬라이즈된다. 점진 적용.
- **번역 검수**: `src="translated"`(Android 매칭 없이 자동 번역) 항목은 네이티브 검수 권장. 일본어는 음성 프롬프트 톤과 정합성 유의.

## 매핑 규칙(요약)

- iOS 한국어 리터럴 → `values/strings.xml` 에서 동일 한국어 검색 → `name` 획득 → `values-en` / `values-ja` 의 같은 `name` 값으로 en/ja.
- 매칭 실패(iOS 전용 문구)는 직접 번역.
