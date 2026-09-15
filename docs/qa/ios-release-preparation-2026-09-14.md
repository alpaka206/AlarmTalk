# iOS 첫 출시 준비 — 2026-09-14

기준 develop: `d5893dde`(#741 머지). 수정 PR: [#742](https://github.com/alpaka206/AlarmTalk/pull/742). 사용자가 최신 develop 실기기 설치와 가능한 출시 준비
전체를 요청했다. 빌드·로그·기기 기록은 프로젝트 내부의 기존 ignored 경로에만 보관한다.

## 완료한 것

- iPhone 14 Pro: `com.alarmtalk.app`, 1.2.5(1) 설치·실행.
- Android S23 Ultra·A32: `com.alarmtalk.app.dev`, 1.2.5(25) 설치·실행.
- iOS Release 아카이브, Apple Distribution 인증서와 앱·위젯 App Store 프로파일 생성,
  배포 서명 IPA 내보내기. Apple 사전 검증과 업로드 모두 오류 없이 완료.
  Privacy Manifest 수정본 **1.2.5(2)**도 검증·업로드·처리 `VALID`를 확인하고
  1.2.5 제출 버전에 연결했다(앞서 설치한 개발 기기 앱은 빌드 1).
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
  판매 국가는 사용자 지정대로 EU 27개국을 제외한 **148개 국가·지역**으로 저장했다.
  앱·구독 3개·선물 1개 모두 같은 목록이며 API 재조회로 일치를 확인했다.
- 실제 iPhone 17 Pro Max 화면으로 만든 목업 5장(1320×2868) 등록. Apple 처리 상태 `COMPLETE`.
- 구독 3개와 소모성 선물 1개에 심사용 화면·진입 방법을 등록. 네 상품 모두
  `READY_TO_SUBMIT`. 결제 화면 촬영은 UI 확인이며 Sandbox 실구매 검증이 아니다.
- App Privacy 누락 항목을 보완하고 소유자 확인 후 **게시**했다(13개 유형·18개 목적 조합).
  제품 상호작용, 충돌 데이터, 기타 진단, 사용자가 선택한 대략적 지역을 반영했다.
  사용자 ID 분석·제품 상호작용의 사용량 산정 목적을 추가하고 민감 정보·지역의
  개인 맞춤화도 사용자에게 연결된 데이터로 신고했다. 광고 추적은 없으며, 앱의
  `PrivacyInfo.xcprivacy`도 동일한 13개 유형·18개 목적 조합으로 보완했다.
- 연령 설문에 사용자 콘텐츠·메시지 공유·건강/웰빙 테마를 반영. 가입 시 만 14세 이상을
  요구하므로 스토어 선택지 중 그 요건 이상인 **16+**로 설정했다. App Store 표시도
  재확인했다(글로벌 16+, 한국 15+). 콘텐츠 권한은
  타사 콘텐츠 사용 및 필요한 권한 보유로 설정했다. ElevenLabs 계정의 활성 Enterprise
  상태, 정식 제공 중인 `eleven_v3`, 이용약관의 사용자 콘텐츠 이용 허락을 확인했다.
  이 확인이 개별 녹음의 권리 증빙이나 Enterprise 별도 계약서 검토를 대체하지는 않는다.
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

## 소유자 답변 반영 — 2026-09-14 후속

- 비즈니스 새로고침 결과: 유료·무료 앱 계약, 은행 계좌, 미국 세금 양식 2종, 대한민국
  전자상거래법 정보는 **활성화됨**. 대한민국 세금 양식만 **대기 중**이다.
- prod 전용 심사 계정을 생성하고 실제 `/api/auth/login` 200을 확인했다. 기존 사용자
  수정·DB 초기화는 없었다. 가입과 같은 비밀번호 해시·빈 가족 방해금지 시간 기본값을 썼다.
  계정은 무료로 시작해 Apple Sandbox에서 네 상품을 구매할 수 있다. 최초 로그인 동의는
  심사자가 직접 확인하며, 실제 사람의 녹음·공유 데이터는 넣지 않았다.
- 심사 연락처 전화번호·이메일 로그인·비밀번호·진입 안내를 App Store Connect 심사 정보에
  저장하고 재조회했다. 개인정보·자격증명은 아래 ignored 로컬 자료에만 보관한다.
- 정식 URL `https://alarm-talk.com/privacy/`를 전용 필드에 등록했다. 앱 설명에는
  `https://alarm-talk.com/terms/`, 개인정보 URL, Apple 표준 EULA 링크를 넣었다.
- **공개 웹 본문은 아직 정책 버전 4**다. 직접 GET으로 확인했으며, Apple 로그인·App Store
  결제·사용 기록 설명이 있는 저장소의 버전 5와 다르다. iOS 심사 전에 웹도 최신화해야 한다.
- 아이폰 목업 5장(1320×2868)을 등록했고 모두 Apple 처리 `COMPLETE`를 확인했다.
  첫 화면·알람 편집·목소리 선택·파일 업로드·목소리 공유의 실제 iOS 화면과 원본 앱 아이콘을
  사용했다. 배경만 이미지 생성 도구를 사용하고 원본 화면은 HTML/CSS 아이폰 프레임에 넣었다.
  유료 기능 조건도 표시했다. 현재 등록된 스크린샷은 새 목업 5장이다.
- 목업 원본 촬영 XCTest 1개 성공. 수정한 Privacy Manifest와 App Privacy의 13개 유형·18개
  목적 조합 일치, plist 구문 검사, 이미지 규격 5장 검증 성공.
- 앱 1.2.5(2)·구독 그룹·구독 3개·선물 1개, **총 6개 항목을 같은 심사 초안**에
  추가했다. Apple 처리·연결을 API로 재확인했으며 심사 제출은 하지 않았다.
- App Store Server Notifications URL은 비어 있다. 현재 서버에 Apple 알림 수신 라우트가
  없으므로 존재하지 않는 주소를 등록하지 않았다. 현재 구현은 구매 확인·구독 조회 및
  만료 처리의 StoreKit 재조회 경로를 사용한다. 실제 갱신·취소 반영은 TestFlight에서 검증한다.
- 유료 계약 활성화 후 재확인해도 Server API 더미 거래 조회는 Sandbox 400(인증 통과),
  Production 401이었다. 실거래 성공으로 기록하지 않으며, 운영 인증 원인은 미확정이다.

## 남은 순서와 소유자 작업

1. **대한민국 세금 양식 처리 확인**: 현재 `대기 중`. Apple이 추가 자료를 요구하면 소유자가
   제공한다. 유료 계약·은행·미국 세금·한국 규정 입력은 완료됐으므로 다시 요청하지 않는다.
2. **Play 25 게재**: 준비된 production 초안을 심사·게재한다. 단순 업로드/초안 상태는
   아래 서버 배포 조건을 충족하지 않는다. 실제 스토어 다운로드 가능 여부를 확인한다.
3. **수정 PR → develop → main**: 필수 체크·리뷰를 거쳐 반영한다. main 배포·제자리
   마이그레이션 성공 후 `/api/app/version?platform=ios`와 동의 문서 버전을 재확인한다.
   공개 웹의 이용약관·개인정보처리방침도 저장소의 버전 5로 배포하고 직접 GET으로 확인한다.
   운영 DB 초기화나 보호 설정 우회는 하지 않는다.
4. **iOS 운영 백엔드 검증**: TestFlight에서 Apple 로그인·탈퇴 연결 해제, 네 상품 조회,
   Sandbox 구매/복원/취소/선물 발급·등록, 실제 APNs 수신을 확인한다. 기존 API 키는
   Sandbox 인증만 별도로 검증됐고 Production의 과거 401 원인은 확정하지 않는다.
5. **실기기 알람**: 잠금·앱 종료·오프라인에서 울림/해제/다시 울림, 가족 알람 수신 후
   로컬 예약, 계정 전환 시 이전 계정 알람 분리를 확인한다.
6. **첫 심사 제출**: 현재 같은 초안에 연결된 iOS 빌드·구독 그룹·구독 3개·소모성 선물을
   운영 검증 완료 후 함께 제출한다. 현재는 초안 준비 단계이며 앱 심사·공개 출시 완료가 아니다.

### 왜 main을 먼저 배포하지 않았나

실제 Play production 조회 결과 공개 버전은 **24**다. 최신 develop은 Android 최소 버전
**25**, 동의 문서 버전 **5**를 사용한다. 새 APK가 스토어에 나오기 전에 서버를 바꾸면
강제 업데이트 또는 `POLICY_VERSION_MISMATCH`로 가입·재동의가 막힌다.
따라서 위 2 → 3 순서는 `CLAUDE.md`의 기존 릴리스 규약에 따른다.

## 로컬 산출물과 비밀값

- iOS: `apps/ios-native/DerivedData/release-completion-20260914/`
  (`AppStoreExport/AlarmTalk.ipa`, `AppStoreExport-build2/AlarmTalk.ipa`, 검증·업로드 로그).
- 목업: 위 경로의 `iphone-mockups/` (`index.html`, 최종 PNG 5장, `render.mjs`,
  원본 화면·아이콘, 배경 생성 프롬프트 `README.md`, 업로드 결과).
- 심사 계정·App Store 심사 정보 사본: 위 경로의 `review-account-private.json`,
  `review-detail-saved-private.json`(파일 권한 600). git/PR/채팅에 값을 옮기지 않는다.
- 최종 아카이브: `apps/ios-native/DerivedData/Archives/AlarmTalk-1.2.5-build2-20260914.xcarchive`.
- Android: `apps/android-native/app/build/outputs/bundle/prodRelease/app-prod-release.aab`.
- 새 APNs·기존 App Store Connect API `.p8`: `packages/backend/.secrets/`.
  로컬 dev APNs 설정은 `.dev.vars.dev`에 갱신했다.
- 배포 인증서 개인 키·암호화 p12·프로파일: 위 iOS 산출물의 `signing/`.
  `.p8`과 개인 키는 한 번만 내려받을 수 있는 자료다. 소유자가 안전한 별도 보관소에
  백업해야 하며, 파일 내용·비밀번호·Worker 바인딩은 git/PR/채팅에 옮기지 않는다.

## 기준 문서

- [상품 현지화와 구독](https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions/)
- [첫 인앱결제 제출](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/)
- [스크린샷 규격](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [App Privacy 항목](https://developer.apple.com/app-store/app-privacy-details/)
- [암호화 수출 선언](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)
- [EU 회원국 목록](https://european-union.europa.eu/principles-countries-history/eu-countries_en)
- [ElevenLabs 상업적 이용 조건](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform)
- [Eleven v3 정식 제공](https://elevenlabs.io/blog/eleven-v3-is-now-generally-available)

## 2026-09-15 재확인 — App Store Connect API 로 실제 상태 조회

`asc-api.mjs` 의 키(7R4M96QGPF)로 다시 읽었다. 어제 기록과 달라진 것과 남은 것만 적는다.

**스토어에 이미 들어가 있는 것(API 확인)**
- 버전 `1.2.5` `READY_FOR_REVIEW`, 빌드 **2** 연결(`VALID`, 암호화 비해당 선언 포함).
- ko 메타데이터: 설명 733자·검색어·프로모션 문구·부제·지원/마케팅/개인정보 URL. iPhone 6.7"
  스크린샷 5장 전부 `COMPLETE`. `TARGETED_DEVICE_FAMILY=1` 이라 iPad 스크린샷은 필요 없다.
- 심사 정보: 연락처·데모 계정(필수)·심사 노트 저장됨.
- 연령 등급 16+ 오버라이드, 콘텐츠 권한 `USES_THIRD_PARTY_CONTENT`, 카테고리 유틸리티, 무료.
- 구독 3개·소모성 1개 `READY_TO_SUBMIT`, 구독 그룹 ko 현지화 `PREPARE_FOR_SUBMISSION`(정상 —
  심사와 함께 나간다).
- **심사 제출 초안 1개에 항목 6개**(앱 버전·구독 그룹·구독 3·선물 1)가 `READY_FOR_REVIEW` 로
  묶여 있고 **`submittedDate` 가 비어 있다** — 아직 제출 버튼을 누르지 않은 상태다.
- 공개 웹 약관·개인정보처리방침이 **버전 5** 로 배포됐다(어제는 4). `GET /api/app/version
  ?platform=ios` 는 min 1 / latest 1.
- Android 는 Play production 에 **versionCode 26(1.2.6)** 이 게재 완료(`completed`)다. prod
  백엔드의 `minSupported: 25`·문서 버전 5 와 맞는다.

**남은 것 — 제출 전에 소유자가 정할 일**
1. **TestFlight 베타 그룹이 0개**다. 빌드 2 는 한 번도 TestFlight 로 실기기에 깔린 적이 없다.
   어제 문서의 4번(Apple 로그인·Sandbox 구매/복원·APNs 실수신)과 5번(잠금·종료·오프라인
   울림)은 그래서 미검증이다. 내부 테스터 그룹을 만들어 빌드 2 를 넣으면 곧바로 할 수 있다.
   건너뛰고 제출하는 것도 가능하지만, 첫 심사에서 결제·로그인이 막히면 리젝 사유가 된다.
2. **대한민국 세금 양식 `대기 중`** — API 로는 안 보인다. App Store Connect > 비즈니스에서
   상태를 본다. 유료 앱 계약 자체는 활성이라 제출은 막히지 않는다.
3. **App Store Server API 운영 401** 원인 미확정. Sandbox 는 통과. 앱이 스토어에 실제로
   게재되기 전에는 운영 엔드포인트가 401 을 돌려주는 것으로 알려져 있어, 출시 뒤 **첫 실제
   구매의 `/billing/apple/confirm` 을 지켜봐야** 한다.
4. App Store Server Notifications URL 은 비어 있다(수신 라우트가 없다). 갱신·해지 반영은
   StoreKit 재조회에 의존한다 — 출시 뒤 별도 과제.
5. "이 버전의 새로운 기능"(`whatsNew`) 은 비어 있다. 첫 출시라 필수는 아니다.

**제출 자체는 API 한 번이다**: `PATCH /v1/reviewSubmissions/adf974af-…` `submitted: true`.
1번을 건너뛸지 결정한 뒤 누른다.
