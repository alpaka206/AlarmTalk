# iOS 첫 출시 준비 — 2026-09-14

기준 develop: `d5893dde`(#741 머지). 수정 PR: [#742](https://github.com/alpaka206/AlarmTalk/pull/742). 사용자가 최신 develop 실기기 설치와 가능한 출시 준비
전체를 요청했다. 빌드·로그·기기 기록은 프로젝트 내부의 기존 ignored 경로에만 보관한다.

## 완료한 것

- iPhone 14 Pro: `com.alarmtalk.app`, 1.2.5(1) 설치·실행.
- Android S23 Ultra·A32: `com.alarmtalk.app.dev`, 1.2.5(25) 설치·실행.
- iOS Release 아카이브, Apple Distribution 인증서와 앱·위젯 App Store 프로파일 생성,
  배포 서명 IPA 내보내기. Apple 사전 검증과 업로드 모두 오류 없이 완료.
  Apple 처리 결과는 `VALID`이며 1.2.5 제출 버전에 연결했다.
  Xcode의 `No Accounts`는 수동 배포 서명과 기존 App Store Connect API 키로 해결했다.
- Android `bundleProdRelease` 25 빌드·서명. Google Play production 트랙에 **초안**으로 저장.
  공개 버전 24는 유지했고, 심사 제출·출시 전환은 하지 않았다.
- 운영 Worker의 Apple 로그인·연결 해제·결제·APNs 시크릿 9개 등록.
  dev 결제 키 3개 등록 및 별도 Sandbox APNs 키 2개 교체·등록.
  기존 dev APNs 키는 Developer Portal에 없고 인증도 실패했다. 운영 APNs 키는 Production
  전용이므로 개발 환경에 재사용하지 않았다. 새 Sandbox 키는 더미 토큰 요청의
  `400 BadDeviceToken`까지 확인했다(인증 통과이며 실제 기기 배달 확인은 별도).
- App Store Connect 버전 `1.0` → `1.2.5`, 한국어 소개·부제·검색어·프로모션 문구,
  지원·마케팅·개인정보 URL, 저작권 입력. 공개 URL의 최종 응답 200 확인.
  앱 다운로드 가격은 무료로 저장하고, 지원하지 않는 Mac·Vision Pro 배포는 껐다.
  판매 국가는 사용자 선택을 기다리고 있다.
- 실제 iPhone 17 Pro Max 시뮬레이터 화면 3장(1320×2868) 등록. Apple 처리 상태 `COMPLETE`.
- 구독 3개와 소모성 선물 1개에 심사용 화면·진입 방법을 등록. 네 상품 모두
  `READY_TO_SUBMIT`. 결제 화면 촬영은 UI 확인이며 Sandbox 실구매 검증이 아니다.
- App Privacy **미게시 초안**의 누락 항목 보완: 제품 상호작용, 충돌 데이터, 기타 진단,
  사용자가 선택한 대략적 지역. 사용 기록의 사용자 ID 분석 목적을 추가하고 민감 정보의
  개인 맞춤화도 사용자에게 연결된 데이터로 수정했다. 광고 추적은 신고하지 않았다.
- 연령 설문에 사용자 콘텐츠·메시지 공유·건강/웰빙 테마를 반영. 가입 시 만 14세 이상을
  요구하므로 스토어 선택지 중 그 요건 이상인 **16+**로 설정했다. 최종 제출 전에
  사업자가 개인정보 신고·연령 등급·제공 콘텐츠 권리를 함께 확인해야 한다.
- `ITSAppUsesNonExemptEncryption=false`: OS TLS·Keychain과 해시를 사용하는 현재 앱 구성에
  맞춘 선언. 최종 Release IPA에 포함됨을 확인했다.

## 상품 현지화

실제 스토어에는 이미 아래 한국어 이름이 저장돼 있었다. 사용자 변경을 유지하고 로컬
`.storekit`을 이 값과 맞췄다. 한국어 설명은 요청한 문구와 일치한다.

| 상품 | 한국어 이름 | 한국어 설명 | 한국 가격 |
| --- | --- | --- | --- |
| Personal | AlarmTalk 개인플랜 | 내 목소리 알람 1인 요금제, 매월 자동 갱신 | 월 3,900원 |
| Couple | AlarmTalk 커플플랜 | 두 사람이 함께 쓰는 요금제, 매월 자동 갱신 | 월 6,900원 |
| Family | AlarmTalk 가족플랜 | 가족이 함께 쓰는 요금제, 매월 자동 갱신 | 월 14,900원 |
| 선물 | AlarmTalk 개인플랜 1달 이용권 | 퍼스널 1개월 이용권 선물, 1회성 결제 | 3,900원 |

Apple Family Sharing은 네 상품 모두 꺼져 있다. 앱 자체의 커플·가족 초대와 별도 기능이다.
로컬 Family 상품만 `familyShareable=true`였던 불일치도 바로잡았다.

## #730 최신 후속 지적

[같은 개인 상품 복구 시 강한 권한 재계산](https://github.com/alpaka206/AlarmTalk/pull/730#discussion_r4000406397):
보류된 개인 구독이 복구될 때 `users.plan`을 개인 등급으로 직접 쓰면, 이미 유효한
커플·가족 멤버 권한을 덮어쓴다. 기존 공통 `resolvePlanAfterSuspend`로 모든 유효 권한을
다시 고르고, 실제 등급이 바뀐 구매자도 커밋 후 동기화 알림 대상에 포함한다.

Apple/Google × 커플/가족 네 가지 실제 DB 회귀 사례에서 권한 유지, 이미 잘못 내려간
등급 복구, 반복 처리 시 알림 중복 방지를 확인했다. 새 마이그레이션은 없다.

리뷰가 이어진 원인은 동일한 유효 권한 규칙이 조회·복구·만료·초대·기기 동기화의 여러
경로에 나뉘어 있었기 때문이다. 개별 지적을 고쳐도 다른 진입점이 옛 판정을 쓰면 새
지적이 나온다. 이번에는 복구 경로도 공통 선택기를 호출한다. 테스트 통과가 아직
찾지 못한 모든 경합과 실기기 동작까지 보장하지는 않는다.

## 검증 기록

- 백엔드 전체: 116개 파일, **1,838 통과·64 건너뜀**, 타입 검사 통과.
- 최신 develop iOS 유닛: XCTest 817 통과·9 건너뜀, Swift Testing 15 통과.
  시뮬레이터도 CI와 같은 ad-hoc 서명과 한국어/한국 설정을 사용했다.
- iOS Release 아카이브, 엄격한 코드 서명 검사, App Store export 및 Apple 검증 성공.
- Android dev APK·prod Release AAB 빌드 성공. AAB 서명 및 번들 법무 파일 확인.
- UI 촬영: 탭·편집기·이용권, 선물 안내 화면. 시뮬레이터 촬영이 실제 구매·알람 울림을
  검증한 것으로 해석되지 않도록 촬영 테스트에 명시했다.

## 남은 순서와 소유자 작업

1. **사업자 확인**: App Store Connect → 비즈니스에서 법인 정보·대한민국 규정 준수 정보를
   확인하고 유료 앱 계약에 서명한다. 현재 무료 앱 계약만 활성화돼 있고 유료 계약은 `신규`다.
   이어지는 세금·은행 정보를 본인이 입력·확인한다. EU를 선택하면 DSA 거래자 확인도 필요하다.
2. **출시 국가 및 심사 정보**: 판매 국가 선택, 심사 연락처 전화번호와 테스트 계정 준비.
   비밀번호·인증 코드는 채팅이나 git에 넣지 않고 App Store Connect 심사 정보에 직접 입력한다.
   앱 권한·콘텐츠 권리와 개인정보 초안도 확인 후 게시한다.
   심사 설명 초안은 로컬 `review-detail-draft.json`에 준비했다. Apple API가 `contactPhone`
   필수 오류로 저장을 거부했으므로 전화번호를 추정해서 채우지 않았다.
3. **Play 25 게재**: 준비된 production 초안을 심사·게재한다. 단순 업로드/초안 상태는
   아래 서버 배포 조건을 충족하지 않는다. 실제 스토어 다운로드 가능 여부를 확인한다.
4. **수정 PR → develop → main**: 필수 체크·리뷰를 거쳐 반영한다. main 배포·제자리
   마이그레이션 성공 후 `/api/app/version?platform=ios`와 동의 문서 버전을 재확인한다.
   운영 DB 초기화나 보호 설정 우회는 하지 않는다.
5. **iOS 운영 백엔드 검증**: TestFlight에서 Apple 로그인·탈퇴 연결 해제, 네 상품 조회,
   Sandbox 구매/복원/취소/선물 발급·등록, 실제 APNs 수신을 확인한다. 기존 API 키는
   Sandbox 인증만 별도로 검증됐고 Production의 과거 401 원인은 확정하지 않는다.
6. **실기기 알람**: 잠금·앱 종료·오프라인에서 울림/해제/다시 울림, 가족 알람 수신 후
   로컬 예약, 계정 전환 시 이전 계정 알람 분리를 확인한다.
7. **첫 심사 제출**: 처리 완료된 iOS 빌드와 구독 그룹·구독 3개·소모성 선물을 같은 첫
   제출에 포함한다. 현재는 업로드와 초안 준비 단계이며 앱 심사·공개 출시 완료가 아니다.

### 왜 main을 먼저 배포하지 않았나

실제 Play production 조회 결과 공개 버전은 **24**다. 최신 develop은 Android 최소 버전
**25**, 동의 문서 버전 **5**를 사용한다. 새 APK가 스토어에 나오기 전에 서버를 바꾸면
강제 업데이트 또는 `POLICY_VERSION_MISMATCH`로 가입·재동의가 막힌다.
따라서 위 3 → 4 순서는 `CLAUDE.md`의 기존 릴리스 규약에 따른다.

## 로컬 산출물과 비밀값

- iOS: `apps/ios-native/DerivedData/release-completion-20260914/`
  (`AppStoreExport/AlarmTalk.ipa`, 촬영 PNG, 검증 로그, Apple 업로드 로그 사본).
- 아카이브: `apps/ios-native/DerivedData/Archives/AlarmTalk-1.2.5-ready-20260914.xcarchive`.
- Android: `apps/android-native/app/build/outputs/bundle/prodRelease/app-prod-release.aab`.
- 새 APNs·기존 App Store Connect API `.p8`: `packages/backend/.secrets/`.
  로컬 dev APNs 설정은 `.dev.vars.dev`에 갱신했다.
- 배포 인증서 개인 키·암호화 p12·프로파일: 위 iOS 산출물의 `signing/`.
  `.p8`과 개인 키는 한 번만 내려받을 수 있는 자료다. 소유자가 안전한 별도 보관소에
  백업해야 하며, 파일 내용·비밀번호·Worker 바인딩은 git/PR/채팅에 옮기지 않는다.

## Apple 기준 문서

- [상품 현지화와 구독](https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions/)
- [첫 인앱결제 제출](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/)
- [스크린샷 규격](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [App Privacy 항목](https://developer.apple.com/app-store/app-privacy-details/)
- [암호화 수출 선언](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)
