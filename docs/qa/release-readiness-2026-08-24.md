# 네이티브 출시 최종 점검 — 2026-08-24

대상 브랜치: `feat/voice-driven-revocation`

## 결론

코드와 로컬 배포 산출물은 출시 가능한 수준까지 검증됐다. 다만 아래 P0 실기기·배포 조건을
끝내기 전에는 iOS 첫 출시와 Android 업데이트를 스토어에 제출하지 않는다.

1. Android와 iOS 모두 앱 종료·잠금·비행기 모드에서 실제 알람 발사를 확인한다.
2. 현재 저장소의 백엔드를 production에 먼저 배포한다. 지금 production의 iOS 버전 조회는
   Android 최소/최신 빌드와 Play Store URL을 반환한다. 저장소의 `app-version.ts`에는 올바른
   iOS 분기가 있으므로 배포 상태 문제다.
3. App Store 첫 제출 상품 4종의 실제 가격 조회와 Apple 결제 검증을 TestFlight/심사 환경에서
   확인한다.
4. App Store Connect의 개인정보 영양성분표가 `PrivacyInfo.xcprivacy`와 법무 문서의 항목과
   일치하는지 제출 직전에 대조한다.

## 확인한 범위

- iOS 화면: 로그인·가입·동의·알람 목록/편집·목소리 목록/등록·가족·결제·설정과 계정 삭제,
  공휴일, 운세, 목소리 선택, 이용권, 동의 상세 모달을 UI 테스트 캡처로 확인했다.
- Android 화면: S23(Android 16)과 A32(Android 13)에서 알람 목록/편집, 목소리/문구 선택,
  가족 대상, 결제, 설정, 테마/언어 화면을 확인했다.
- 네이티브 공통: 목소리 등록 첫 화면의 제목·뒤로가기·녹음/파일 선택·안내 문구를 Android
  기준으로 맞췄다. iOS의 기존 `12초 이상 2분 이하로 녹음해 주세요` 고정 안내는 제거했고,
  실제 12초~2분 검증 로직은 유지했다.
- iOS 네트워크: 알람·내 목소리·가족 목소리를 두 뷰모델이 중복 조회하던 경로와 읽히지 않는
  상태를 제거했다.
- Android 네트워크: `/code/register`가 이미 프로모까지 처리하므로 구형 프로모 폴백과
  UI가 쓰지 않는 checkout 클라이언트 경로를 제거했다. 서버의 구형 라우트는 배포 중인
  이전 앱 호환 때문에 유지했다.
- 백엔드: production의 테스트 코드 발급 라우트를 404로 닫고, 법정 보존기간이 끝난 가명
  결제 기록을 cron에서 파기하며, 음성 LRU 로그를 구조화했다.
- 개인정보: 앱이 직접 사용하는 UserDefaults(`CA92.1`)와 앱 컨테이너 파일 메타데이터
  (`C617.1`), 실제 수집 데이터 유형을 `PrivacyInfo.xcprivacy`에 선언했다. Release Archive
  번들 루트 포함과 plist·코드서명 검증까지 통과했다.
- 문서: 현재 구현과 어긋난 Android/iOS/백엔드/공유 패키지/랜딩 README, QA, 법무 문서와
  과거 iOS 진행 문서를 정리했다. 과거 감사 문서는 삭제하지 않고 보관 문서임을 표시했다.

## 자동 검증 결과

| 대상 | 결과 |
| --- | --- |
| Backend | ESLint·TypeScript 통과, Vitest 1,470 통과(64 skip) |
| Shared / Voice | 16 + 11 테스트 통과 |
| 의존성 | `npm audit` production/full 모두 취약점 0 |
| Android dev | 단위 테스트·Lint·`assembleDevDebug` 통과 |
| Android release | 서명·R8·리소스 축소 포함 `bundleProdRelease` 통과 |
| iOS unit | 618 통과, 9 skip, 실패 0 + Swift Testing 5 통과 |
| iOS UI | 최종 선택 스위트 7 통과, 화면 전수 캡처 스위트 통과 |
| iOS release | Release Archive·embedded widget·코드서명 검증 통과 |
| 저장소 정합성 | 크로스플랫폼 참조·문서 링크·입력 새니타이저·DB INSERT·테스트 격리 검사 통과 |

`npm run format:check`는 저장소 기존 TypeScript 100개 파일의 Prettier 차이로 실패한다. 이번
변경에서 새 포맷 위반을 만들지는 않았으며, 릴리스 수정과 무관한 전수 재포맷은 하지 않았다.

## 실기기 설치 상태

- Galaxy S23 `R3CW300EZBA`: 최신 dev APK 덮어설치·MainActivity 실행 확인.
- Galaxy A32 `RF9R40323AP`: 최신 dev APK 덮어설치·알람 목록과 로컬 목소리 이름 즉시 표시 확인.
- iPhone 14 Pro(iOS 26.6): 최신 Debug 앱 덮어설치·실행 확인.

설치 과정에서 앱 데이터는 삭제하지 않았고 알람 생성·변경·발사는 하지 않았다.

## 출시 차단은 아니지만 남은 후속

- iOS 클립 선다운로드 Live Activity는 UI/위젯 껍데기만 있고 시작·진행·종료 연결이 없다.
  준비 화면 자체와 알람 생성 관문은 동작하므로 기능 정확성보다 백그라운드 진행 UX 문제다.
- iOS App Store Server Notifications 수신 라우트가 없다. 앱 전경 동기화와 5분 cron 만료
  재확인은 있지만 환불·취소 즉시 반영은 다음 전경/재확인까지 늦을 수 있다.
- dev 워커 APNs 키는 무효이고 Google RTDN도 미설정이다. production은 별도 APNs/RTDN 설정을
  사용하므로 출시 전 production 푸시 한 건을 실제로 보내 확인한다.
- Android에 deprecated API 경고가 남아 있고 iOS에는 `UIScreen.main`, AVFoundation 동기
  staging 관련 경고가 남아 있다. 현재 빌드는 통과하지만 SDK 교체 전에 갱신한다.
- Android Baseline Profile은 없다. 정확성 문제는 아니지만 시작 성능 최적화 후속이다.

## 발사 검증 기록 규칙

실제 발사 검증은 `dev-test-handoff.md`의 P0 절차를 따른다. Android는 RingingActivity,
iOS는 AlarmKit을 앱 종료·잠금·비행기 모드 각각에서 확인하고, 목소리·문구·30초 트림·스누즈·
해제 후 다음 예약까지 기록한다. 한 갈래라도 실패하면 두 스토어 제출을 보류한다.
