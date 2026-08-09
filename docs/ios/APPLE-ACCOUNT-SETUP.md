# Apple 개발자 계정 세팅 — 값만 채우면 되는 상태

코드는 전부 끝나 있다. **여기 적힌 값만 발급받아 지정된 자리에 넣으면 동작한다.**
값이 없으면 각 경로가 조용히 통과하지 않고 명시적으로 실패한다(fail-closed).

> **Apple ID(무료) ≠ Apple Developer Program(연 $99).**
> 이 앱은 엔타이틀먼트가 App Groups + Sign in with Apple 이라 **무료 Apple ID(Personal
> Team)로는 실기기 실행조차 안 된다.** 유료 가입이 필요하다.
> 시뮬레이터 빌드·테스트는 계정 없이 지금도 된다(현재 288 tests 통과 중).

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

**앱**(`...ios`)에 켤 Capability 3개:

- ☑ **App Groups**
- ☑ **Sign in with Apple**
- ☑ **Push Notifications**

**위젯**(`...ios.widget`)에 켤 것:

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

## 4. Sign in with Apple — 서버에 넣을 값은 **하나뿐**

```
APPLE_BUNDLE_ID=com.alarmtalk.app
```

**`.p8` 개인키가 필요 없다.** 네이티브 앱 로그인은 앱이 준 identity token 을 애플 공개키
(JWKS, `https://appleid.apple.com/auth/keys`)로 검증하는 방식이라 비밀키를 쓰지 않는다.
`.p8` / Service ID / client_secret 은 **웹·서버 대 서버 플로우**(authorization code 교환,
토큰 폐기)에서만 필요하다 — 우리는 안 쓴다. 헷갈려서 만들지 말 것.

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

⚠ **넷 다 같은 구독 그룹에 넣는다**(`AlarmTalk Subscriptions`). 그래야 플랜 변경이
StoreKit 업그레이드/다운그레이드로 처리된다 — 앱에 '이용권 변경' UI 가 없는 이유가
이것이다(`docs/spec/billing-lifecycle.md` 의 「의도된 플랫폼 차이」).

⚠ 가격의 권위는 **App Store Connect** 이고 DB `price_krw` 는 표시용이다. 둘을 일치시켜
둔다 — 위 값은 마이그레이션 `#52` 의 시드가이고 안드로이드 Play 상품과도 같다.
`.storekit` 파일의 $1.99/$3.99/$5.99 는 **시뮬레이터 테스트용 참고값**이라 여기와 무관하다.

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
APPLE_BUNDLE_ID=com.alarmtalk.app
APPLE_ISSUER_ID=57246542-96fe-1a63-e053-0824d011072a
APPLE_KEY_ID=ABC123DEFG
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
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

### ⚠ 키를 만들 때 **Sandbox 전용으로 만들지 말 것**

Developer Portal 의 APNs 키 생성 화면에는 갈래가 둘이다:

| 고른 것 | 샌드박스 | 프로덕션 |
| --- | --- | --- |
| Apple Push Notification service (APNs) | ✅ | ✅ |
| **…(APNs) — Sandbox** | ✅ | ❌ `BadEnvironmentKeyInToken` |

2026-08-10 실측에서 현재 키(`3CNKCBLC5U`)가 **Sandbox 전용**으로 확인됐다:

```
production   403  BadEnvironmentKeyInToken
sandbox      400  BadDeviceToken   ← 인증은 통과(가짜 토큰이라 거부된 것뿐)
```

개발·TestFlight 는 이대로 되지만 **출시하면 프로덕션 푸시가 전부 막힌다.**
`apnsConfigFromEnv` 가 `ENVIRONMENT === 'production'` 일 때만 프로덕션 호스트로
보내므로 dev 워커는 지금도 정상이고, **막히는 건 prod 워커뿐**이다.

**출시 전에 할 일**: Certificates → Keys 에서 제한 없는 APNs 키를 새로 만들고
`.p8`·Key ID 를 `.dev.vars.prod` 에 넣은 뒤 `npm run secrets:sync:prod`.
검증은 가짜 토큰으로 쏴 보면 된다 — `BadDeviceToken` 이면 키가 정상이고,
`InvalidProviderToken` 이면 Key ID/Team ID 가 틀린 것이다.

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
