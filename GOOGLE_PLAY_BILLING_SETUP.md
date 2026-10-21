# Google Play 결제 — 상품 코드 plug-in 런북

> **요약**: 코드는 이미 끝났다. Google Play Billing Library 연동·구매 플로우·서버 검증(confirm)·
> RTDN 웹훅·요금제 시드까지 전부 구현되어 있고, 구독 상품도 Play Console(`com.alarmtalk.app`)에 만들어져
> 프로덕션에서 판매 중이다. 남은 콘솔 작업은 아래 6절에서 체크되지 않은 항목이다(RTDN 연결 등).
> 이 문서는 그 plug-in 지점을 한 곳에 모은 체크리스트다.
>
> 가격 추천(원가·수수료·세금·지불의향 분석)은 루트의 **`PRICING.md`** 참고.

---

## 0. 현재 상태 (이미 되어 있는 것)

| 영역 | 상태 | 위치 |
|------|------|------|
| Billing 라이브러리 | ✅ 의존성 추가됨 (`billing-ktx:8.0.0`) | `apps/android-native/app/build.gradle.kts` |
| `com.android.vending.BILLING` 권한 | ✅ 라이브러리 매니페스트가 **자동 병합** (수동 추가 불필요) | (Billing Library 8.x 내장) |
| 구매 플로우 (연결·조회·구매·재전송) | ✅ 구현 | `…/billing/PlayBillingManager.kt` |
| 구매 → 서버 검증 호출 | ✅ 구현 | `…/ui/main/MainViewModelBillingActions.kt` (`startPlayPurchase`→`confirmGooglePurchase`) |
| 서버 검증·acknowledge | ✅ 구현 (`POST /api/billing/google/confirm`) | `packages/backend/src/routes/billing-google.ts` |
| RTDN 웹훅 (갱신·취소·환불 동기화) | ✅ 구현 (`POST /api/billing/google/rtdn`) | `packages/backend/src/routes/billing-google-rtdn.ts` |
| 요금제(plan) 시드 | ✅ DB 시드 존재 | `packages/backend/src/lib/migrations.ts` (id=6, id=26) |

> ⚠️ `app/build/.../AndroidManifest.xml`(병합 산출물)에 BILLING 권한이 안 보일 수 있는데,
> 이는 billing 의존성 추가 **이전**에 만들어진 stale 빌드 산출물일 뿐이다. 클린 빌드하면 병합된다.
> 확인: `./gradlew :app:processProdReleaseManifestForPackage` 후 병합 매니페스트에서 `com.android.vending.BILLING` 검색.

---

## 1. 상품 코드(Product ID) — "꽂는" 단일 규칙

상품 ID는 **`{planKey}_monthly`** 규칙으로 이미 코드에 박혀 있다. Play Console에 **정확히 이 ID로** 상품을 만들기만 하면 된다.

| 플랜(planKey) | **Play Console 구독 상품 ID** | plan_type | 현재 시드가(price_krw) |
|---------------|------------------------------|-----------|------------------------|
| `personal` (개인) | `personal_monthly` | personal | **₩3,900** |

> ✅ **가격이 코드/DB 에 반영됨**(마이그레이션 `#52 plan-prices-and-family-5`, `migrations.ts`). 근거·수익률은 `PRICING.md`.
> Play Console 상품 가격도 위 표에 맞춰 설정하면 된다.
> ⚠ 커플·가족(`couple_monthly`·`family_monthly`)은 2026-10-20 에 이용권과 함께 없앴다 — 아래 §2 의 4.

이 매핑이 정의된 곳 (변경 시 **3곳을 같이** 맞춰야 한다 — 의도된 다중 진실 공급원, 서로 주석으로 교차참조됨):

1. **Android** — `…/billing/PlayBillingManager.kt` `PlayBillingProducts` (+ `productIdFor()`)
2. **백엔드(Google)** — `…/lib/play-subscriptions.ts` `googlePlanKeyFromProductId`(`routes/billing-google.ts` 가 다시 내보낸다)
3. **DB plans 시드** — `…/lib/migrations.ts` (planKey·price_krw)

> 새 플랜을 추가하려면: ① 위 1~3에 planKey 추가 → ② Play Console에 `{planKey}_monthly` 상품 생성.
> **플러스(상품 `personal_monthly`)는 추가 코드 변경이 전혀 필요 없다.** Play Console에서 상품만 만들면 끝.

---

## 2. Play Console 작업 (운영자)

1. **앱 등록 / 업로드**: `prod` 플레이버 패키지명은 **`com.alarmtalk.app`** (dev는 `.dev` 접미사라 Play상 별개 앱).
   결제 테스트는 Play에 올라간 빌드(내부 테스트 트랙 이상)에서만 동작한다.
2. **구독 상품 생성** — *Monetize → Products → Subscriptions*:
   - 상품 ID: `personal_monthly` (위 표와 **철자 동일**, 자동갱신 구독)
   - **base plan(월간, auto-renewing)** + **가격**(아래 §4) 설정 후 **활성화(Active)**.
3. ⚠ **선물 상품(`personal_gift_1m`, 일회성 인앱 상품)은 만들지 않는다 — 2026-10-14 폐지, 되살리지 말 것.**
   iOS 1.2.12 가 App Store 심사 지침 3.1.1 로 두 번째 반려됐다("선물 코드로 디지털 기능을 연다"). 선물은 산 사람이
   스토어로 냈어도 **받는 사람이 코드를 쳐서** 유료 기능을 여는 것이라, 서버·두 앱에서 통째로 지웠다
   ([`docs/spec/plan-gates.md`](docs/spec/plan-gates.md) 「선물 코드 — 폐지」).
   - 콘솔의 그 상품은 **판매를 내렸다**: 구매 옵션 `personal-gift-1m` 이 `INACTIVE` 다(2026-10-14, Play Developer API
     `oneTimeProducts.purchaseOptions:batchUpdateStates`). 예전에 만든 상품이라 지우지 않고 남긴다 — 다시 켜지 말 것.
   - 서버는 그 상품의 구매를 Play 를 부르기 전에 400 `UNKNOWN_PRODUCT` 로 돌려준다 — 코드를 만들지 않고 확인
     (acknowledge)도 하지 않으므로 Play 가 3일 뒤 자동 환불한다. 앱(1.2.13~)은 1회성 상품을 조회·판매하지 않는다
     (`PlayBillingProducts.all` — 1.2.16 부터 개인 구독 하나).
   - 할인·무료 이용이 필요하면 **Play 프로모션 코드**(Play Console 에서 만든다 — 결제가 Play 를 거친다)를 쓴다.
     우리 서버에 코드 체계를 다시 만들지 않는다.
4. ⚠ **커플·가족 구독(`couple_monthly`·`family_monthly`)은 2026-10-20 폐지 — 기본 요금제를 비활성화한다**(오너, 운영 서버
   배포 전 — `docs/qa/dev-test-handoff.md` 「다음 할 일」 2-①). 커플·가족 이용권과 거기에 딸린 초대 코드·목소리 공유·가족
   알람을 없앴다([`docs/spec/plan-gates.md`](docs/spec/plan-gates.md) 「커플·가족 이용권 — 폐지」).
   - 서버는 두 상품의 구매를 Play 를 부르기 전에 400 `UNKNOWN_PRODUCT` 로 돌려준다 — 확인(acknowledge)하지 않으므로 Play 가
     3일 뒤 자동 환불한다. 기본 요금제를 끄면 옛 앱(1.2.15 까지)의 구매 시작부터 막힌다.
   - 상품은 지우지 않고 남긴다 — 다시 켜지 말 것. 앱(1.2.16~)은 두 상품을 조회·판매하지 않는다.
5. **라이선스 테스터 등록** — *Setup → License testing*: 테스트 계정은 실제 청구 없이 구매 가능.
6. **(중요) RTDN 연결** — *Monetize → Monetization setup → Real-time developer notifications*:
   - Cloud Pub/Sub 토픽 생성 → push 구독 URL을
     `https://api.alarm-talk.com/api/billing/google/rtdn?token=<GOOGLE_RTDN_VERIFICATION_TOKEN>` 로 설정.
   - 토픽에 `google-play-developer-notifications@system.gserviceaccount.com` publish 권한 부여.
   - Play Console에서 **Send test notification**으로 200 응답 확인.
7. **Play Developer API 서비스 계정** — Google Cloud Console에서 서비스 계정 + JSON 키 생성,
   Play Console에서 해당 계정에 *View financial data / Manage orders* 권한 부여 (서버 검증용).

---

## 3. 서버 시크릿 (운영자)

검증/RTDN 라우트는 아래 시크릿이 **없으면 503**(`GOOGLE_BILLING_UNCONFIGURED` / `RTDN_UNCONFIGURED`)을 낸다.
> ⚠ 이 3개도 `scripts/sync-worker-secrets.ts` 의 **자동 동기화 대상이다**(`WORKER_SECRET_KEYS`). `npm run secrets:sync:prod` 로 올린다 — 예전 문서는 "수동 등록" 이라고 적었지만 사실이 아니다(2026-08-11 확인).

```bash
cd packages/backend
# Play Developer API 서비스 계정 JSON (파일 내용 전체)
wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_JSON --env production
# prod 패키지명
echo "com.alarmtalk.app" | wrangler secret put ANDROID_PACKAGE_NAME --env production
# RTDN push URL 의 ?token= 값과 동일하게
wrangler secret put GOOGLE_RTDN_VERIFICATION_TOKEN --env production
```

> 로컬(dev)에서 검증 흐름을 테스트하려면 같은 키들을 `packages/backend/.dev.vars.dev`에 넣는다.

---

## 4. 가격 — "꽂는" 두 곳

가격은 **두 곳**이 따로 논다. 헷갈리지 말 것:

- **Play Console 가격 = 실제 청구 권위(authoritative).** 사용자가 보는 가격·결제·통화·VAT 처리는 전부 Play가 한다.
- **DB `price_krw` = 표시/내부 참고용.** 앱 내 플랜 카드 표시 등에 쓰인다. Play 가격과 **일치시켜** 두는 게 좋다.

### DB 가격을 바꾸려면 (마이그레이션 1개 추가)

기존 마이그레이션은 **수정 금지**(이미 적용됨). `…/lib/migrations.ts` 맨 끝에 새 마이그레이션을 추가한다:

```ts
{
  id: <다음 번호>,
  name: 'plan-price-update-2026',
  statements: [
    `UPDATE plans SET price_krw = <개인가>  WHERE key = 'personal'`,
  ],
},
```

> 추천 가격 2종과 근거는 루트 **`PRICING.md`** 참고. 가격을 정하면 위 `<…>`에 숫자만 채우면 된다.

---

## 5. 검증 (End-to-end 스모크)

1. 백엔드 결제 테스트(이미 green 유지):
   ```bash
   cd packages/backend && npm test -- billing
   ```
   관련: `billing-google-rtdn.test.ts`, `billing.test.ts`, `billing-mutation.test.ts`, `store-billing` 등.
2. Play 내부 테스트 트랙 빌드 설치 → 플랜 구매 → 시트 완료 후:
   - `POST /api/billing/google/confirm` 200 + `subscription.status=active` 확인.
   - `users.plan`이 `plus`(personal)로 미러되는지.
3. Play Console에서 구독 **취소** → RTDN이 `cancel_at_period_end`로 동기화되는지 로그 확인.

---

## 6. 한눈에 보는 plug-in 체크리스트

- [x] Play Console에 `personal_monthly` 구독 상품 생성·가격설정·활성화 (`com.alarmtalk.app` 에 등록, 프로덕션 판매 중)
- [ ] `couple_monthly` / `family_monthly` 기본 요금제 비활성화 — 운영 서버 배포 전(§2 의 4)
- [ ] `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` / `ANDROID_PACKAGE_NAME` / `GOOGLE_RTDN_VERIFICATION_TOKEN` 시크릿 등록
- [ ] RTDN Pub/Sub 토픽 + push 구독(URL에 token) 연결, test notification 200 확인
- [ ] DB `price_krw`를 Play 가격과 일치(마이그레이션 추가)
- [ ] 라이선스 테스터로 구매→confirm→active 스모크
