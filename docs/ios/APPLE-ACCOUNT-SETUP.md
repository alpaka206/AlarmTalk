# Apple 개발자 계정 세팅 — 값만 채우면 되는 상태

코드는 전부 끝나 있다. **여기 적힌 값만 발급받아 지정된 자리에 넣으면 동작한다.**
값이 없으면 각 경로가 조용히 통과하지 않고 명시적으로 실패한다(fail-closed).

> ✅ **가입은 이미 끝났다(2026-09-08 이 맥에서 재확인).** 서명 인증서
> `Apple Development: GYUWON KIM`(`security find-identity -v -p codesigning`), 팀
> `29N7GX354N`, `com.alarmtalk.app`·`com.alarmtalk.app.widget` 프로비저닝 프로파일
> (`~/Library/Developer/Xcode/UserData/Provisioning Profiles`, 만료 2027-08),
> App Store Connect 앱 레코드(Apple ID `6799711245` — `lib/app-version.ts` 의 `IOS.storeUrl`)가
> 전부 있고, iPhone 14 Pro(iOS 26.6.1)에 Debug 빌드 설치도 된다.
> **아래 0~5장은 "다시 하라" 가 아니라 값이 어디서 나와 어디로 들어가는지의 참조표다.**
>
> **Apple ID(무료) ≠ Apple Developer Program(연 $99).**
> 이 앱은 엔타이틀먼트가 App Groups + Sign in with Apple 이라 **무료 Apple ID(Personal
> Team)로는 실기기 실행조차 안 된다.**
> 시뮬레이터 빌드·테스트는 계정 없이도 된다.

---

## 0. 가입 · Team ID

1. <https://developer.apple.com/programs/> 에서 Apple Developer Program 가입(연 $99).
   개인이면 승인 즉시, 법인이면 D-U-N-S 확인이 붙어 며칠 걸린다.
2. 가입 후 <https://developer.apple.com/account> → **Membership details** 에서 **Team ID**
   (10자 영숫자, 예: `A1B2C3D4E5`)를 확인한다.
3. Xcode 에 계정을 추가한다: Xcode → Settings → Accounts → `+` → Apple ID.

### Team ID 를 넣는 자리

`project.yml` 은 **일부러 비워 두었다**(`DEVELOPMENT_TEAM: "$(DEVELOPMENT_TEAM)"`).
팀 ID 를 레포에 커밋하지 않기 위한 구조이니 그대로 두고, 아래 둘 중 하나로 주입한다.

- **Xcode UI**: 프로젝트 → 각 타깃 → Signing & Capabilities → Team 선택
- **명령줄**: `xcodebuild ... DEVELOPMENT_TEAM=A1B2C3D4E5`

> 시뮬레이터 빌드·테스트에는 팀 ID 가 필요 없다. 실기기·TestFlight·심사에만 필요하다.

---

## 1. App ID 등록 (2개)

> ⚠ **번들 ID 는 `com.alarmtalk.app` 이다.** 이 문서는 한동안 `com.voicealarm.nativeapp.ios`
> 라고 적고 있었는데, **`project.yml` 의 실제 값과 달랐다.** 그 문자열은 Apple 이 등록을
> 거부하고(과거에 만들었다 지운 것으로 보인다) App Store Connect 앱 레코드 생성부터
> 막힌다 — 2026-08-08 에 실제로 그 벽에 부딪혔다.
> 실제 값은 언제나 `apps/ios-native/project.yml` 의 `PRODUCT_BUNDLE_IDENTIFIER` 다.

<https://developer.apple.com/account/resources/identifiers> → Identifiers → `+` → App IDs → App

| | Bundle ID |
|---|---|
| 앱 | `com.alarmtalk.app` |
| 위젯 확장 | `com.alarmtalk.app.widget` |

**앱**(`com.alarmtalk.app`)에 켤 Capability 3개:

- ☑ **App Groups**
- ☑ **Sign in with Apple**
- ☑ **Push Notifications**

**위젯**(`com.alarmtalk.app.widget`)에 켤 것:

- ☑ **App Groups**

> 이 목록은 `apps/ios-native/AlarmTalk/AlarmTalk.entitlements` ·
> `apps/ios-native/AlarmTalkWidget/AlarmTalkWidget.entitlements` 와 정확히 일치해야 한다.
> 하나라도 빠지면 실기기 빌드가 provisioning 오류로 막힌다.

## 2. App Group 생성

Identifiers → App Groups → `+`

```
group.com.alarmtalk.app.shared
```

**엔타이틀먼트 파일의 문자열과 한 글자도 다르면 안 된다.** 이 컨테이너로 앱과 위젯이
오디오 캐시를 공유하고, 그게 잠금화면에서 목소리가 나오는 경로다.

## 3. Keychain Sharing 그룹

엔타이틀먼트에 `$(AppIdentifierPrefix)com.alarmtalk.app.keychain` 이 이미 들어 있다.
`$(AppIdentifierPrefix)` 는 Team ID 로 자동 치환되므로 **따로 등록할 것은 없다.**
Xcode 의 Signing & Capabilities 에 Keychain Sharing 이 자동으로 잡히는지만 확인한다.

---

## 4. Sign in with Apple — 값이 **둘로 갈린다** (로그인 검증 / 연결 해제)

```
APPLE_BUNDLE_ID=com.alarmtalk.app        # ① 로그인 검증(aud 대조)
APPLE_TEAM_ID=29N7GX354N                 # ② 연결 해제용 client_secret 서명
APPLE_SIGNIN_KEY_ID=<Sign in with Apple 키의 Key ID>
APPLE_SIGNIN_PRIVATE_KEY=<그 키의 .p8 내용 전체(PEM)>
```

**① 로그인 검증에는 `.p8` 이 필요 없다.** 네이티브 앱 로그인은 앱이 준 identity token 을
애플 공개키(JWKS, `https://appleid.apple.com/auth/keys`)로 검증하는 방식이라 비밀키를
쓰지 않는다(`lib/apple-oauth.ts`).

⚠ **② 그러나 `.p8` 을 안 만들면 탈퇴가 반쪽이 된다.** 계정 삭제 때
`POST https://appleid.apple.com/auth/revoke` 로 **Sign in with Apple 연결을 끊는다**
(`lib/apple-revoke.ts` — 호출부는 `routes/user.ts` 의 탈퇴, `index.ts` 의 예약 삭제).
폐기는 우리가 우리임을 증명하는 요청이라 client_secret(ES256 JWT)이 필요하고, 그래서
**Developer Portal → Keys 에서 "Sign in with Apple" 키를 발급**해야 한다. 심사 지침
5.1.1(v) 가 요구하는 항목이라 선택이 아니다 — 안 끊으면 탈퇴자의 '설정 → Apple 계정'
목록에 우리 앱이 영원히 남는다.
⚠ **이 키를 `APPLE_KEY_ID`/`APPLE_PRIVATE_KEY` 에 넣지 말 것** — 그 둘은 5장의 결제
검증 키(App Store Server API)다. 섞으면 결제 검증이 통째로 죽는다.

이 값이 없으면 `POST /auth/apple` 이 **500 `AUTH_APPLE_CONFIG_MISSING`** 으로 떨어진다
(aud 를 대조하지 못하면 다른 앱용으로 발급된 유효한 애플 토큰도 통과해 버리기 때문).

## 5. 인앱결제 — App Store Connect

### 5-1. 앱 레코드 생성
<https://appstoreconnect.apple.com> → 앱 → `+` → 새로운 앱. Bundle ID 는 위 `...ios`.

### 5-2. 구독 상품 3개 등록

**상품 ID 를 아래와 정확히 같게** 만들어야 한다. 이 값은
`apps/ios-native/AlarmTalk/Configuration/StoreKitConfiguration.storekit` 및 백엔드
`packages/backend/src/lib/apple-storekit.ts` 의 매핑과 일치해야 한다.

| 상품 ID | 플랜 | 한국 가격 | 정원 |
|---|---|---|---|
| `com.alarmtalk.app.personal_monthly` | personal | ₩3,900 | 1인 |
| `com.alarmtalk.app.couple_monthly` | couple | ₩6,900 | 2인 |
| `com.alarmtalk.app.family_monthly` | family | ₩14,900 | 5인 |

전부 **자동 갱신 구독(Auto-Renewable Subscription)**, 월간.

⚠ ****셋 다** 같은 구독 그룹에 넣는다**(`AlarmTalk Subscriptions`). 그래야 플랜 변경이
StoreKit 업그레이드/다운그레이드로 처리된다 — 앱에 '이용권 변경' UI 가 없는 이유가
이것이다(`docs/spec/billing-lifecycle.md` 의 「의도된 플랫폼 차이」).

⚠ 가격의 권위는 **App Store Connect** 이고 DB `price_krw` 는 표시용이다. 둘을 일치시켜
둔다 — 위 값은 마이그레이션 `#52` 의 시드가이고 안드로이드 Play 상품과도 같다.
`.storekit` 파일도 지금은 같은 값을 담고 있다(`displayPrice` 3900 / 6900 / 14900 + 선물 3900).
시뮬레이터 전용이라 실제 과금과는 무관하지만, 표시 금액이 어긋나면 사람이 헷갈리므로
가격을 바꿀 때 **함께** 고친다.

### 5-2b. 선물 상품 1개 등록 — **소모성(Consumable)**

| 상품 ID | 한국 가격 | 유형 |
|---|---|---|
| `com.alarmtalk.app.personal_gift_1m` | ₩3,900 | **소모성(Consumable)** |

⚠ **자동 갱신 구독으로 만들지 말 것.** 자동 갱신 구독은 남에게 줄 수 없다(스토어가
구매자 계정에 묶는다). 그래서 선물은 1회성 상품을 팔고 그 대금으로 **바우처 코드**를
발급한다 — 서버가 `isAppleGiftProductId` 로 갈라 구독 갈래를 타지 않게 한다
(`routes/billing-apple.ts`). 구독으로 만들면 `expiresDate` 검사에 걸려 결제가 통째로
거절되거나, 구매자 본인이 이용권을 받게 된다.

⚠ **구독 그룹에 넣지 않는다.** 소모성 상품은 그룹 개념이 없다.

> 발급되는 바우처의 유효기간은 **받는 사람이 등록할 때까지의 기한**(30일)이고,
> 등록한 시점부터 개인 플랜 1개월이 시작된다.

### 5-3. App Store Server API 키 발급

App Store Connect → 사용자 및 액세스 → 통합 → **App Store Connect API** → 키 생성
(**In-App Purchase** 권한).

발급 결과 3가지를 서버에 넣는다:

| 화면에 보이는 이름 | 넣을 환경변수 |
|---|---|
| Issuer ID (UUID) | `APPLE_ISSUER_ID` |
| Key ID | `APPLE_KEY_ID` |
| `.p8` 파일 내용 전체(PEM) | `APPLE_PRIVATE_KEY` |

> **`.p8` 은 다운로드가 딱 한 번만 된다.** 잃어버리면 키를 새로 만들어야 한다.
> 이 키는 **결제 검증 전용**이고 4번의 로그인과는 무관하다.

넷 중 하나라도 비면 `POST /billing/apple/confirm` 이 **503 `APPLE_BILLING_UNCONFIGURED`**
로 떨어진다(애플에 물어보지 못한 채 통과시키면 클라 주장을 그대로 믿는 것이 되므로).

---

## 6. 값을 넣는 자리 (백엔드)

로컬 파일에 넣고 워커로 동기화한다. 키 이름은 이미 등록해 두었다
(`scripts/sync-worker-secrets.ts` 의 `WORKER_SECRET_KEYS`, `wrangler.toml` 주석,
`.dev.vars.example`).

```bash
# packages/backend/.dev.vars.dev  (prod 는 .dev.vars.prod)
# 키가 **네 갈래**다 — `.dev.vars.example:42-45` 와 같은 구분이다.
# ① 로그인 검증
APPLE_BUNDLE_ID=com.alarmtalk.app
# ② 탈퇴 시 Sign in with Apple 연결 해제 (4장)
APPLE_TEAM_ID=29N7GX354N
APPLE_SIGNIN_KEY_ID=ABC123DEFG
APPLE_SIGNIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
# ③ 결제 검증 (5-3장) — ②와 **다른 키다**
APPLE_ISSUER_ID=57246542-96fe-1a63-e053-0824d011072a
APPLE_KEY_ID=ABC123DEFG
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
# ④ 푸시 (7장) — 또 다른 키다
APNS_KEY_ID=8S2AH3937P
APNS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

```bash
cd packages/backend
npm run secrets:sync:dev     # dev 워커로
npm run secrets:sync:prod    # prod 워커로
```

### 결제 검증 키가 살아 있는지 확인하는 법

없는 구독 ID 로 `GET /inApps/v1/subscriptions/{id}` 를 쏴 보면 **인증만** 따로 볼 수 있다.

| 응답 | 뜻 |
| --- | --- |
| 401 | 인증 실패 — Key ID / Issuer ID / `.p8` 조합이 틀렸다 **또는 그 환경에 앱이 없다** |
| 400 `Invalid transaction id` | **인증 통과** (ID 만 가짜라 거부) |
| 404 | 인증 통과, 그런 구독이 없다 |

⚠ **401 을 곧바로 "키가 틀렸다" 로 읽지 말 것.** 2026-08-10 실측에서 같은 JWT 로
production 은 401, sandbox 는 400 이 나왔다 — 키는 정상이고 **앱이 아직 프로덕션에
안 올라가서** 프로덕션 호스트가 안 열린 것이다. 출시하면 프로덕션도 열린다.
(그래서 `apple-storekit.ts` 는 401 을 만나면 샌드박스를 마저 본다 —
`docs/spec/billing-lifecycle.md` 참조.)

## 7. 푸시(APNs) — **Firebase 를 거치지 않는다**

구현은 끝났다(`lib/apns.ts` 서버 · `PushNotificationCoordinator.swift` 앱).
**iOS 는 Firebase 를 쓰지 않는다** — 필요한 건 "토큰으로 알림 하나 보내기" 뿐이고
APNs 인증은 App Store Server API 와 똑같은 ES256 JWT 라, SDK·`GoogleService-Info.plist`
없이 서버가 직접 쏘는 쪽이 훨씬 가볍다. 이유는 `lib/apns.ts` 머리 주석에 있다.

필요한 값은 넷: `APNS_KEY_ID` · `APNS_PRIVATE_KEY` · `APPLE_TEAM_ID` · `APPLE_BUNDLE_ID`.
⚠ **결제 검증 키(`APPLE_KEY_ID`/`APPLE_PRIVATE_KEY`)와 다른 키다.** 서로 넣으면 401 만 난다.

### ⚠ APNs 키는 **환경에 묶일 수 있다**

2026-08-10 실측에서 우리 키 둘이 **정확히 반대 환경**에서만 동작했다:

| 키 | sandbox | production |
| --- | --- | --- |
| `3CNKCBLC5U` | ✅ 통과 | ❌ 403 `BadEnvironmentKeyInToken` |
| `8S2AH3937P` | ❌ 403 `BadEnvironmentKeyInToken` | ✅ 통과 |

**이건 우리 구조에서 문제가 되지 않는다.** 워커가 환경별로 갈리고
(`apnsConfigFromEnv` 의 `useSandbox: ENVIRONMENT !== 'production'`) 앱 빌드도
같은 축으로 갈리기 때문이다 — 각 워커에 그 환경 키를 넣으면 **코드 변경 없이** 맞는다.

| 빌드 | 백엔드 | APNs 호스트 | 넣을 키 |
| --- | --- | --- | --- |
| Debug (Xcode 직접 설치) | `api-dev` (dev 워커) | sandbox | `.dev.vars.dev` |
| Release (TestFlight·출시) | `api` (prod 워커) | production | `.dev.vars.prod` |

⚠ **TestFlight 는 프로덕션 APNs 다**(샌드박스가 아니다). 위 표대로 prod 워커를
보므로 짝이 맞는다.

**검증법** — 가짜 토큰(0 × 64)으로 쏴 보면 인증만 따로 볼 수 있다.

| 응답 | 뜻 |
| --- | --- |
| 400 `BadDeviceToken` | **키 정상** (토큰만 가짜라 거부) |
| 403 `BadEnvironmentKeyInToken` | 키는 살아 있으나 **그 환경용이 아니다** |
| 403 `InvalidProviderToken` | Key ID 와 `.p8` 이 짝이 아니거나 **키가 폐기됐다** |

서버 코드는 그냥 `fetch` 를 쓴다(`lib/apns.ts` — Workers 의 fetch 는 HTTP/2 로 나간다).
`node:http2` 가 필요한 건 **로컬에서 Node 로 찔러 볼 때뿐**이다 — Node 의 `fetch`(undici)는
HTTP/1.1 이라 APNs 가 거절한다.

> ⚠ **미해결(2026-08-10)**: `.dev.vars.dev` 의 APNs 키가 양쪽 호스트에서
> `InvalidProviderToken` 이다. Key ID 는 `3CNKCBLC5U` 인데 짝이 되는 `.p8` 이
> 아니거나 그 키가 폐기된 것으로 보인다(`.secrets/` 에 그 파일이 남아 있지 않다).
> **prod 는 정상이라 출시에는 영향이 없고, 막히는 건 dev 워커 푸시뿐이다.**
> 해결은 둘 중 하나 — ① `3CNKCBLC5U` 의 `.p8` 을 다시 받아 넣는다,
> ② 두 환경 모두 되는 키 하나를 새로 발급해 dev·prod 양쪽에 같은 값을 넣는다.

---

## 8. 다 넣고 나서 확인하는 순서

```bash
# 1) 시뮬레이터 — 계정 없이도 되던 것들이 그대로인지
cd apps/ios-native && xcodegen generate
xcodebuild -project AlarmTalkNative.xcodeproj -scheme AlarmTalk -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -skipPackagePluginValidation CODE_SIGNING_ALLOWED=NO build

# 2) 실기기 — 여기서부터 계정이 필요하다
xcodebuild ... DEVELOPMENT_TEAM=<Team ID> -destination 'platform=iOS,name=<기기명>'

# 3) 백엔드
cd packages/backend && npx vitest run
```

**실기기에서만 확인 가능한 것** — `DEVICE-SPIKE.md` 참고. 가장 중요한 것은
**번들 동봉 `.caf` 가 알람음으로 재생되는가**다. 이게 안 되면 무료 티어의 약속
("그 사람 목소리로 깨어난다")이 성립하지 않아 제품 정의부터 다시 봐야 한다.
