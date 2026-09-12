# #734 프로젝트 전반 점검 — 2026-09-12

대상은 #734의 최신 지적 3건과 #730에 포함되는 현재 체크아웃이다. 결제·세션·권한·그룹·
데이터 보존·입력/업로드·네이티브 빌드·랜딩·의존성을 위험 중심으로 점검했다.
전 파일의 무결점이나 스토어/운영 환경의 정상 동작을 보장하는 기록은 아니다.

## 최신 리뷰 처리

| 지적 | 수정 | 회귀 검증 |
| --- | --- | --- |
| Apple REVOKED의 미래 만료를 유료 갱신으로 적용 | ACTIVE/GRACE만 권한 부여. 종료·보류를 명시적으로 구분 | 실제 SQLite에서 REVOKED/EXPIRED의 미래 만료, 그룹 해체·보관 유예 확인 |
| 갱신 때 초대 코드 만료 누락 | 공통 entitlement 쓰기 안에서 issued/used 코드와 멤버 구독 기간 연장 | issued/used/expired 코드, 소유자·멤버 권한/기간 검증 |
| iOS plan 새로고침 실패 후에도 StoreKit 진행 | 서버가 plan과 구독을 같은 읽기 트랜잭션으로 반환. 앱이 한 번에 저장한 성공만 허용 | 실제 URLSession·세션 저장소·권한 저장소로 실패/누락/취소/재로그인/재시작 스냅샷 확인 |

## 함께 고친 결함과 중복 제거

- 결제 전 조회·만료 크론·RTDN 종료/보류는 `billing-reconciliation.ts`를 공유한다.
  스토어 I/O는 쓰기 락 밖에서 하고, 구독·영수증이 바뀌었으면 트랜잭션 안에서 거절한다.
- 보류 때 그룹을 보존하고, 회복 때 멤버 권한·기간과 삭제 유예를 같은 트랜잭션으로 복구한다.
  소유자의 유효 구독이 남아 있으면 멤버만 독립적으로 만료시키지 않는다.
- 구독 스냅샷은 `user_plan`·구독·갱신 스토어를 같은 DB 읽기 트랜잭션에서 구성한다.
  양 앱은 오래된 세션/세대의 응답을 버리고, Play는 SDK의 비동기 제품 조회 이후에도 재검사한다.
- Apple 유예 만료는 `gracePeriodExpiresDate`를 사용한다. 알 수 없는 상태/조회 실패는
  종료로 추정하지 않는다. 만료 크론의 기존 72시간 조회 장애 유예는 유지한다.
- 결제일은 Apple `purchaseDate`, Play 최신 성공 주문의 실제 처리 시각을 사용한다.
  연장·유예·중복 전송을 새 결제로 추정하지 않는다. 예약 교체의 아직 소유하지 않은 상품도 배제한다.
- 선물의 실제 구매일을 저장하고, 탈퇴 시 한 구독에 연결된 여러 증빙을 각각 보존한다.
  토큰 없는 기존 Apple 구독의 바인딩 조회도 저장 키인 originalTransactionId를 사용한다.
- 환불 조회 중 같은 체인의 새 갱신이 반영되면 옛 종료 응답으로 현재 구독/그룹을 지우지 않는다.
- JWT 만료/주체 형식과 정확한 만료 경계를 검사한다. 서버 JWT 설정 누락은 401이 아닌 503이며,
  iOS는 인증 토큰 없이 보낸 요청의 401로 현재 세션을 종료하지 않는다.
- Content-Length 누락/조작과 무관하게 실제 바디 스트림에 25 MiB 상한을 적용한다.
  프로필 PATCH의 null/배열/원시 JSON은 500 대신 400으로 거절한다.
- Android 알림 권한 예외 처리를 기존 runCatching과 동일한 명시적 catch로 표현했다.
  울림 예약·시간 계산·재생·로컬 권한 판정의 동작은 바꾸지 않았다.
- 취약한 baseline-browser-mapping, @humanfs/node, Wrangler/Miniflare 간접 의존성을
  기존 호환 범위 내에서 갱신했다. CI에 high 이상 의존성 감사와 Android release lint를 추가했다.

중복된 SQL 큐 기반 Apple 만료/보류 테스트는 실제 마이그레이션을 적용한 독립 파일 SQLite
통합 테스트로 이관했다. 트랜잭션 롤백, 조회 중 갱신/교체, 멤버 독립 구독, 72시간 경계,
반복 알림 방지, RTDN 실제 HTTP 라우트도 검증한다.

## 로컬 검증 결과

| 검사 | 결과 |
| --- | --- |
| Backend | 112 파일, 1,681 통과 / 기존 64 스킵 |
| Shared / Voice | 16 / 11 통과 |
| Android devDebug 단위 테스트 | 421 통과, 스킵/실패 0 |
| Android assembleDevDebug / lintProdRelease | 성공. 기존 lint 경고는 남아 있으며 오류 0 |
| iOS 전체 테스트 | XCTest 736건 중 9 스킵, 실패 0 + Swift Testing 15 통과 (실행 통과 합계 742) |
| iOS Release unsigned 빌드 | 성공 |
| TypeScript 4 workspace / ESLint | 성공 |
| 저장소 검사 7종 | 주석 참조·문서 링크·권한 writer·플랜 상수·테스트 격리·NOT NULL INSERT·입력 sanitizer 모두 성공 |
| Landing production build | 성공, 로케일 HTML 14개 처리 |
| Worker dry-run build | 성공. 배포하지 않음 |
| npm audit (개발 의존성 포함) | 취약점 0 |

테스트 실패 없이 **2,871건 통과, 기존 스킵 73건**이다. 스킵된 검사를 통과로 세지 않았다.
PR의 실제 CI 결과는 GitHub Checks에서 최종 커밋 기준으로 확인한다.

## 자동 검증으로 대체하지 않은 것

- 실제 Play Orders API 권한과 주문 응답: 스테이징 결제/복원으로 확인해야 한다. 서비스 계정에
  접근 권한이 없으면 새 코드가 날짜를 지어내지 않고 실패하므로 출시 전 필수 확인이다.
- App Store/Play 실제 결제 시트와 자동갱신/환불/푸시, 비행기 모드·잠금·권한 회수 알람:
  실기기에서 확인해야 한다. 이번 세션은 스토어 결제를 만들지 않았고 Android 기기가 연결되지 않았다.
- 마이그레이션 114 전 결제일 없는 원장: 과거 추정 폴백을 유지했다. 실제 과거 결제일과 이미
  보존한 원장은 코드만으로 복원할 수 없으므로 별도 운영 점검이 필요하다.
- #730의 Play v25 선게재, stock 240개 게시, Apple/APNs 운영 설정, iOS 미출시 조건은 그대로다.
  #734/#730 머지, 운영 배포·마이그레이션·원장 수정은 수행하지 않았다.

남은 실행 체크리스트는 [dev 테스트 핸드오프](dev-test-handoff.md)에 모았다.

## 외부 계약 확인 근거

- [Google Orders](https://developers.google.com/android-publisher/api-ref/rest/v3/orders):
  `orderHistory.processedEvent.eventTime`과 주문/구매 토큰 대조.
- [Google SubscriptionPurchaseV2](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2):
  line item의 `latestSuccessfulOrderId`와 예약 교체의 소유 여부.
