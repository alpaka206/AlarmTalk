> ⚠️ 아카이브(2026-07-15): P0 2건(표시가격 하드코딩, RTDN 토큰 비교) 수정 완료. 남은 Play Console 체크리스트는 launch-tracking.ko.md 로 이관.

# 구글 플레이 결제 감사 — 연동 정확성 & 결제 보안

> 작성: 2026-07-08. 멀티에이전트 심층 감사(finder 5 → 통합/보안 종합 → 적대적 검증 → 리포트) + 리뷰어 직접 재확인.
> 라이브 프로브: dev RTDN=503(미설정) / prod RTDN=403(배포됨·시크릿 설정됨) — 규약 "prod 미배포"와 상충(확인 필요).
> P0 중 RTDN 위조 등급상승은 본 세션에서 이미 수정+테스트 완료(billing-google-rtdn.ts). 표시가격 P0는 미수정.

All findings verified first-hand. I have a complete, independently-confirmed picture. Writing the report.

---

# AlarmTalk 결제 감사 리포트 — 구글 플레이 연동 & 결제 보안

> 감사 범위: `packages/backend`(Google/Apple confirm, RTDN 웹훅, voucher/promo, checkout·change-plan 스텁, test-codes) + `apps/android-native`(Play Billing 클라이언트, 구매 UI). 아래 판정은 전부 코드를 직접 열람하고, RTDN 설정 상태는 dev/prod 라이브 프로브로 실측한 결과다. 코드로 확인 불가한 항목은 **미확정**으로 명시했다.

---

## 0. 두 줄 결론

- **연동 판정:** 서버 권위 검증 골격은 **모범적으로 올바르다**(클라는 토큰만 전송·acknowledge 미수행, 서버가 Play Developer API 재조회로 상태·만료·상품·번들을 재검증, plan은 서버 화이트리스트). **그러나 출시 가능 상태는 아니다** — (a) 표시 가격이 Play `ProductDetails`가 아니라 로케일 하드코딩 문자열이라 **컴플라이언스 결함(High)**, (b) 실 결제 E2E가 **미실증**.
- **보안 판정:** 스푸핑·재생·IDOR·무결제 디스펜서 계열의 **critical 없음**. 다만 **RTDN 웹훅이 위조된 알림 본문의 상품ID로 플랜 등급을 결정**해, RTDN 공유 토큰을 아는 주체가 자기 저가 구독을 family로 셀프 승격 + 가족 초대코드까지 획득할 수 있는 **High(조건부) 권한상승**이 실재한다(두 사전 종합은 이를 low로 과소평가했음 — 본 감사에서 코드로 재현·격상).

---

## 1. 구글 플레이 결제 연동

### 1.1 한 줄 판정
**서버 권위(server-authoritative) 방식으로 올바르게 구현됨. 단, 표시 가격 컴플라이언스 결함(High)과 실 결제 E2E 미실증으로 "심사 통과·출시 가능" 상태는 아님.**

### 1.2 전체 흐름 (실제 코드 기준)

| 단계 | 위치 | 동작 |
|---|---|---|
| ① 클라 구매 | `PlayBillingManager.kt:164-191` | BillingClient v7, `ensureConnected`(mutex+`withTimeout`+`isActive` 가드), `launchBillingFlow`. `onPurchasesUpdated`가 PURCHASED/PENDING/취소/`ITEM_ALREADY_OWNED`/에러를 완결 분기(`:222-260`) |
| ② 서버로 전달 | `BillingApi.kt:88-92`, `:138-142` | 클라는 **`purchase_token`+`product_id`+`package_name`만** 전송. **plan 미전송, acknowledge 미수행**(설계 주석 `PlayBillingManager.kt:56-57`) |
| ③ 서버 검증 | `billing-google.ts:122-163` | 서비스계정 Bearer로 `purchases/subscriptionsv2/tokens/{token}` **재조회**. `subscriptionState∈{ACTIVE,GRACE}`(`:142`)·만료 미래(`:161`)일 때만 통과. 클라 주장 상태 무시 |
| ④ 상품·플랜 확정 | `billing-google.ts:97`, `:152-159` | `planKey`는 서버 상수 `GOOGLE_PRODUCT_TO_PLAN_KEY`로만(`:29-33`), 권위 `lineItem.productId`와 교차대조해 불일치 시 `PRODUCT_MISMATCH`(400) |
| ⑤ acknowledge | `billing-google.ts:196-219` | `acknowledgementState==PENDING`이면 **서버가** `:acknowledge` POST(3일 자동환불 방지). 클라는 절대 안 함 |
| ⑥ entitlement | `store-billing.ts:90-235` | `(provider, provider_transaction_id)` 조회 → 타 유저면 409, 동일 유저·동일 plan이면 만료만 idempotent 갱신, 그 외 신규 구독. family면 plan_group+owner 멤버십+초대 바우처 발급 |
| ⑦ RTDN 동기화 | `billing-google-rtdn.ts:94-264` | Pub/Sub push 수신. 알림 본문 불신, 토큰 재조회 상태로 `entitle`/`cancel_at_period_end`/`deactivate`/`suspend` 결정 |
| ⑧ 유실 복구 | `PlayBillingManager.kt:199-220` | 앱 시작 시 미acknowledge 구매를 재조회·재전송 → confirm 유실 자동 복구 |

### 1.3 잘 된 점 (중요도순, file:line)

1. **클라가 신뢰 판단을 서버에 완전 위임** — plan을 안 보내고 acknowledge도 안 함. 등급·승인이 전부 서버 소관. `BillingApi.kt:88-92`, `PlayBillingManager.kt:56-57`.
2. **서버 권위 재조회** — 클라 주장이 아니라 Play Developer API `subscriptionsv2.get` 결과로만 상태·만료·상품 판정. `billing-google.ts:123-163`.
3. **plan 서버 화이트리스트 + 교차대조** — `GOOGLE_PRODUCT_TO_PLAN_KEY`(`:29-33`), 권위 productId 불일치 거부(`:157-159`). 저가 토큰으로 고가 plan 취득 불가(confirm 경로 한정).
4. **acknowledge 서버 수행**으로 3일 자동환불 방지. `:196-219`.
5. **멱등·재생 방어** — `store_transactions` UNIQUE(provider, tx)(`migrations.ts:865`) + 타유저 409(`store-billing.ts:105-106`). 영수증 공유·재생 차단.
6. **fail-closed** — 시크릿 미설정 시 confirm 503(`billing-google.ts:77`), RTDN 503(`billing-google-rtdn.ts:98`).
7. **클라 연결 견고성** — mutex+타임아웃+isActive로 재연결/데드락 안전 처리, 미확인 구매 재전송 복구. `PlayBillingManager.kt:95-124,199-220`.

### 1.4 누락·결함 (심각도순, file:line)

**[High · 컴플라이언스] 표시 가격이 Play `ProductDetails`가 아니라 로케일 하드코딩 문자열**
- 화면·다이얼로그 가격은 전부 `stringResource(R.string.billing_plan_*_price)`로 채워짐: `BillingPanels.kt:93,103,113,125`(카드 렌더 `:547`, 구매 다이얼로그 `:342`).
- **직접 grep 결과 `formattedPrice`/`pricingPhases`/`priceAmountMicros` 참조가 안드로이드 전체에 0건.** `ProductDetails`는 `launchPurchase`에서 `offerToken` 추출용으로만 쓰이고(`PlayBillingManager.kt:171,179`) 가격 표시로 이어지지 않는다. `preloadProducts()`는 캐시 적재만.
- 문자열 리소스는 단말 **UI 언어**로 분기(values=₩, values-en=$, values-ja=¥)라 **Play 청구 국가/통화와 무관**. 예: 한국 Play 계정 + 영어 로케일 단말 → 원화 청구인데 화면엔 `$3.90`. 금액도 Play Console 가격 변경과 무관하게 하드코딩되어 조용히 드리프트.
- 리스크: Google Play 결제 정책(앱 내 가격은 `ProductDetails`에서 표기)과의 정합성 문제 → **심사 반려/청구가격 불일치**.
- 수정안: `queryProductDetails` → `subscriptionOfferDetails[].pricingPhases.pricingPhaseList[].formattedPrice`를 UI로 노출. 서버 `price_krw`(`BillingApi.kt:34`)나 로케일 리소스로 대체하지 말 것.

**[Medium · 출시 리스크] 실 결제 E2E 미실증**
- **라이브 실측:** dev RTDN(`https://api-dev.alarm-talk.com/api/billing/google/rtdn`) → **503 `RTDN_UNCONFIGURED`** = dev 워커에 Google 결제 시크릿 3종 전무. dev는 무결제 checkout 스텁에만 의존.
- **정정(중요):** 프로덕션 RTDN(`https://api.alarm-talk.com/...`) → **403 `RTDN_BAD_TOKEN`**(503 아님). 설정 게이트(`billing-google-rtdn.ts:98`)를 통과했다는 뜻 → **prod 워커는 배포되어 있고 3종 시크릿(`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`/`ANDROID_PACKAGE_NAME`/`GOOGLE_RTDN_VERIFICATION_TOKEN`)이 모두 설정됨.** 두 사전 종합의 "prod 미배포·전 환경 시크릿 부재" 전제는 **반증**됨.
- 따라서 confirm/RTDN 검증 로직은 prod에서 실 Play를 상대로 **실행 가능**. 다만 실 카드청구까지 완주하는지는 Play Console 외부설정(구독상품 게시·서명 릴리스 트랙·서비스계정 앱 권한·RTDN 토픽/푸시URL)에 달렸고 이는 리포 밖 → **미확정**(사용자 메모리상 "Play Console 대기").
- 부수 관찰: prod가 결제 시크릿까지 얹혀 라이브라는 점은 프로젝트 규약 "prod 미배포(dev only)"와 어긋나 보임 → **의도된 것인지 사용자 확인 권장.**
- dev E2E 불가 이중 장벽: dev 빌드 패키지 `com.alarmtalk.app.dev`(`build.gradle.kts:162`, `applicationIdSuffix=".dev"`)는 서버 기대값 `com.alarmtalk.app`과 달라, 설령 dev에 시크릿을 넣어도 `PACKAGE_MISMATCH`(`billing-google.ts:93`)로 막힘.

**[Low] acknowledge 단발 시도** — `PENDING`일 때 confirm에서 1회만 POST, 실패는 로깅 후 200 반환(`billing-google.ts:196-219`). RTDN entitle 분기는 재-entitle하되 **재-acknowledge를 하지 않음**(`:184-205`). 단발 실패가 반복되면 3일 자동환불 여지. 운영 재시도/모니터링 존재 여부는 **미확정**. 수정안: ack 실패 시 재시도 큐 또는 미ack 구독 스캐너.

**[Low] 구독 오퍼 무자격 선택** — `subscriptionOfferDetails?.firstOrNull()?.offerToken`(`PlayBillingManager.kt:171`). 현재 월간 단일 오퍼라 무해하나, 무료체험/인트로 오퍼 추가 시 자격 없는 오퍼를 집을 수 있음. 수정안: 명시적 `basePlanId`/`offerId` 선택 + eligibility 확인.

---

## 2. 결제 보안 — 취약점 (심각도순)

> **critical: 없음.** 무료로 상위 플랜을 얻는 원격·무인증 실현 경로는 확인되지 않았다. 아래 High 1건은 서버 시크릿(RTDN 토큰) 보유가 전제인 조건부 권한상승이다.

### [HIGH · 조건부] RTDN 위조 알림의 상품ID로 플랜 등급 결정 → 셀프 권한상승 + 가족 초대코드 탈취
**공격 시나리오**
1. 공격자가 정상적으로 최저가 `personal_monthly`를 구매·confirm → `store_transactions`에 (google, 토큰T, plan=personal) 매핑.
2. RTDN 공유 토큰을 보유한 상태에서, 자신의 토큰T + `subscriptionId="family_monthly"` + 임의 `notificationType`을 담은 **위조 Pub/Sub 알림을 POST**.
3. 서버는 토큰T를 재조회 → 공격자의 **진짜 ACTIVE personal 구독**을 받으므로 `state=ACTIVE`, 만료 미래 → `action='entitle'`(`billing-google-rtdn.ts:182`).
4. 그러나 등급 결정 상품ID가 **재조회 결과가 아니라 위조 본문**에서 나온다: `productId = sub.subscriptionId`(`:126`) → `planKey = googlePlanKeyFromProductId(productId)`(`:185`)가 위조된 `family_monthly`→`family`로 파생.
5. `applyStoreEntitlement`가 personal 구독을 취소하고 **family 구독·plan_group·owner 멤버십·공유 가능한 초대 바우처**를 생성, `users.plan='family'`(`store-billing.ts:160-204`).

**결과:** personal 요금(₩3,900)만 내고 family 등급(₩14,900) + 재배포 가능한 초대코드 획득(초대코드는 타인에게 무료 entitlement를 주므로 손실 증폭).

**핵심 원인 (신뢰경계 비대칭)**
- confirm 라우트는 위조 방지를 위해 권위 `lineItem.productId`와 교차대조한다: `billing-google.ts:157-159`(`PRODUCT_MISMATCH`). Apple도 동일 검증(`billing-apple.ts:229`).
- **RTDN 라우트에는 이 검증이 통째로 없다.** `:178-180`의 `lineItems.find(productId 일치) ?? lineItems[0]`는 불일치 시 거부가 아니라 **조용히 첫 lineItem으로 폴백(만료값만 사용)**하고, 등급용 `productId`는 위조값 그대로 `:185`로 흘러간다.

**노출 지점**
- RTDN 라우트는 `authMiddleware`(`index.ts:224`) **이전에** 마운트(`index.ts:220`)라 사용자 JWT 인증이 없고, **Google OIDC 서명 검증도 없음**. 유일 방어는 `?token=` 공유 토큰 비교(`billing-google-rtdn.ts:102-103`)뿐.

**실현성 경계(정직한 평가)**
- 공유 토큰은 클라에 노출되지 않는 서버 시크릿(현재 prod에 설정됨) → **임의 외부 공격자는 즉시 악용 불가.** 그래서 critical이 아니라 **High(조건부)**.
- 다만 토큰은 URL 쿼리로 전달되어 Cloudflare/프록시 로그에 남을 수 있고(`:102` 비교도 비상수시간), 유출 시 이 경로는 **무인증 권한상승**이 된다. 또한 대상은 자기 계정 셀프 승격에 한정(타인 토큰은 불투명해 타깃 불가).

**수정안 (P1, 사실상 원라인)**
- entitle 시 `planKey`를 **위조 가능한 `sub.subscriptionId`가 아니라 재조회 `lineItem.productId`(권위)에서** 파생. 즉 `googlePlanKeyFromProductId(lineItem.productId)`.
- 그리고 confirm과 동일하게 `sub.subscriptionId !== lineItem.productId`면 거부(또는 무시), `lineItem.productId` 결측 시 502.
- 이중방어: RTDN 엔드포인트에 **Google OIDC id_token(audience/issuer) 검증** 추가, 토큰을 쿼리 대신 헤더+상수시간 비교로.

---

### [MEDIUM · 취약점 아님, 검증 공백] 견고한 서버검증이 실 스토어로 E2E 실행된 적 없음
- dev 무설정(503, 실측), prod는 설정됐으나 실 카드청구 완주는 Play Console 외부설정에 의존(미확정). subscriptionsv2 응답 스키마 가정(`lineItem.productId`/`expiryTime` 상존)·acknowledge·`PRODUCT_MISMATCH`·RTDN 재조회가 실응답으로 검증된 증거 없음.
- 근거: `billing-google.ts:77`, `billing-google-rtdn.ts:98`(둘 다 fail-closed 503), 라이브 프로브 결과(§1.4).
- 수정안: prod 스테이징 트랙에서 라이선스 테스터로 실 구매 1회 E2E(구매→confirm 200→acknowledge→RTDN RENEWED/CANCEL 왕복) 후 출시. subscriptionsv2 계약 테스트로 `productId`/`expiryTime` 상존 가정 고정.

### [LOW] confirm 라우트 productId falsy-skip (방어심층)
- `if (lineItem.productId && lineItem.productId !== parsed.product_id)`(`billing-google.ts:157`) — 권위 `productId`가 빈값이면 교차대조를 건너뛰고 클라 `product_id`가 planKey를 결정(`:97`).
- **반증 결과 실현 불가:** `find` 실패 시 `lineItems[0]`(진짜 personal, truthy)로 폴백해 검사가 발동(`:152-153`). 빈 productId는 실 응답에서 나오지 않음.
- 수정안: 일관성 위해 planKey를 권위 `lineItem.productId`에서 파생, 결측 시 502.

### [LOW] RTDN 토큰 비상수시간 비교 + URL 쿼리 노출 + OIDC 부재
- `c.req.query('token') !== verifyToken`(`billing-google-rtdn.ts:102`). 다른 시크릿 경로(init-db/admin)는 상수시간을 씀. 토큰 유출 시에도 권위 재조회 때문에 무에서 entitlement 생성은 불가하나, 위 High 승격 경로의 게이트가 이 토큰 하나뿐이라는 점이 문제. 수정안: 상수시간 비교 + 헤더 이동 + OIDC 병행.

### [LOW] Apple `originalTransactionId` 클라 폴백
- `providerTransactionId: tx.originalTransactionId ?? original_transaction_id`(`billing-apple.ts:258`) — 검증 응답 결측 시 클라 입력이 멱등/소유권 키에 섞일 이론적 여지. 실 응답은 항상 채워 실현성 극저. 수정안: 결측 시 502.

### [LOW] `/test-codes` prod 하드게이트 부재 (fail-closed지만 env 의존)
- checkout 스텁은 `ENVIRONMENT==='production'`이면 무조건 비활성(`billing-mutation.ts:96`)인데, 무료 유료코드 발급(`/test-codes`)은 그 하드게이트 없이 `TEST_CODE_ISSUER_EMAILS` 화이트리스트에만 의존(`:123-124`, `:333-334`).
- 미설정 시 빈 Set→전원 403(fail-closed, `:113-114`)이라 기본은 안전. 단 prod에서 이 env가 실수로 설정되지 않을 것 + JWT email이 "검증된" 이메일일 것에 의존. 수정안: `/test-codes`에도 production 하드게이트 추가. (JWT email이 항상 검증 이메일인지는 auth 라우트 별도 확인 필요 → **미확정**.)

### [LOW] `resolveUserPk` google_id 단독 조회 (가용성, 권한상승 아님)
- `SELECT id FROM users WHERE google_id = ?`(`billing-helpers.ts:47`). apple_id만 있고 google_id가 NULL인 계정은 confirm이 404. 방향은 정상사용자 차단(안전측), 타계정 오결속 위험은 없음. 수정안: `authMiddleware`가 이미 해석한 `userIdPK` 재사용.

---

## 3. 반증 검증 결과 요약

| # | 주장 | 판정 | 근거(직접 확인) |
|---|---|---|---|
| 1 | 플랜상승 스푸핑: 저가 토큰+고가 product_id로 confirm 우회 | **REFUTED** | `find`→`lineItems[0]` 폴백(`billing-google.ts:152-153`)으로 실 productId(truthy)가 유지 → `PRODUCT_MISMATCH`(`:157`). 빈 productId는 모킹에서만 가능, 외부 주입점 없음 |
| 2 | cross-user 재생·영수증공유 | **REFUTED**(방어 견고) | 정체성은 검증 JWT sub(`auth.ts`), 타유저 토큰 409(`store-billing.ts:105-106`), UNIQUE 인덱스+단일라이터로 경쟁도 원자적(`migrations.ts:865`) |
| 3 | **RTDN 위조로 entitlement 변경 불가** | **REFUTED(=취약점 실재)** | 403 게이트·미매핑 no-op은 사실이나, `planKey`가 위조 본문 `sub.subscriptionId`에서 파생(`billing-google-rtdn.ts:126,185`) → **셀프 등급상승 성립**. §2 High |
| 4 | 무결제 디스펜서(prod stub / test-codes) | **CONFIRMED**(안전) | prod 하드 비활성(`billing-mutation.ts:96`), test-codes 화이트리스트 fail-closed 403(`:113-114,333-334`) |
| 5 | IDOR (타계정 식별자 주입) | **CONFIRMED**(방어됨) | 모든 뮤테이션 JWT 파생 userPk, 소유권 게이트 |
| 6 | 표시가격이 오직 로케일 리소스, 실가격 덮어쓰기 없음 | **CONFIRMED** | grep `formattedPrice` 등 0건, 가격 소스는 `BillingPanels.kt:93-125`뿐. §1.4 High |
| 7 | 실 결제 어느 환경도 E2E 불가(prod 미배포) | **REFUTED(부분)** | 라이브 프로브: dev 503 / **prod 403(시크릿 설정됨·배포됨)**. 단 Play Console 완주는 **미확정** |

---

## 4. 우선순위 조치 + 출시 전 체크리스트

### 조치 (P0/P1/P2)
- **P0 — 표시 가격을 `ProductDetails.formattedPrice`로 교체** (`BillingPanels.kt:93-125`). 심사·청구 정합성 직결. 출시 차단 항목.
- **P0 — RTDN 등급 결정을 권위 `lineItem.productId`로 변경** (`billing-google-rtdn.ts:126,178-185`). confirm/Apple과 동일하게 위조 productId 거부. High 권한상승 제거.
- **P1 — 실 결제 E2E 1회 실증**: prod(또는 dev용 별도 리스팅+시크릿+패키지)에서 구매→confirm 200→acknowledge→RTDN 왕복 확인. acknowledge 실패 재시도 경로 추가.
- **P1 — RTDN 이중방어**: Google OIDC id_token 검증 추가, 토큰 상수시간 비교·헤더 이동(`:102`).
- **P2 — 하드닝**: `/test-codes` prod 하드게이트, `resolveUserPk` `userIdPK` 재사용, Apple originalTransactionId 결측 시 502, 구독 오퍼 명시적 선택.
- **P2 — 정책 확인**: prod가 결제 시크릿까지 얹혀 라이브인 점이 "dev only" 규약과 상충 → 의도 여부 사용자 확인.

### 출시 전 Play Console 체크리스트 (리포 밖 → 코드로 확인 불가, **미확정** 항목)
- [ ] 구독 상품 `personal_monthly`/`couple_monthly`/`family_monthly` + 베이스플랜 게시 상태
- [ ] 서명된 릴리스 트랙(내부/비공개)에 결제 가능한 빌드 업로드, 라이선스 테스터 등록
- [ ] 서비스계정(`play-publisher@…`)에 해당 앱 Play Developer API 권한 부여
- [ ] RTDN: Pub/Sub 토픽 + push 구독 URL에 `?token=<GOOGLE_RTDN_VERIFICATION_TOKEN>` 정확히 설정
- [ ] Pub/Sub push에 OIDC 서비스계정 인증을 인프라 레벨로 함께 걸었는지(코드엔 OIDC 검증 없음 → **미확정**)
- [ ] `secrets:sync:prod` 및 prod 워커 배포 완료(라이브 프로브상 시크릿은 이미 설정됨 — 재확인)
- [ ] 표시 가격이 실제 Play 청구 통화/금액과 일치하는지 실기기 확인
- [ ] JWT email 클레임이 항상 "검증된" 이메일인지(test-codes 화이트리스트 신뢰 전제) — auth 라우트 확인
