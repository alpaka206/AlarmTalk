import Foundation

/// 플랜 상수.
///
/// ⚠ **원본은 `packages/shared/src/schemas/plan.ts` 다.** 네이티브는 TS 를 가져다 쓸 수
/// 없어 손으로 두되, 값이 어긋나면 `scripts/check-plan-constants.py`(CI)가 잡는다.
/// 목록을 호출부에서 즉석으로 만들지 말 것 — 그렇게 네 벌로 갈라져 있었다.
enum PaidPlans {
    /// 유료로 치는 `users.plan` 값.
    static let userPlans: Set<String> = ["personal", "plus"]
    /// 유료로 치는 `plans.plan_type`.
    static let planTypes: Set<String> = ["personal"]
}

/// 유료 목소리 권한을 **예약 시점에** 재확인한다.
///
/// ## 왜 예약 시점인가 — iOS 와 안드로이드의 결정적 차이
///
/// 안드로이드는 `RingingService` 가 **울릴 때** 로컬 영속 구독으로 유료 권한을 다시 보고,
/// 무료로 떨어졌으면 그 자리에서 기본 목소리로 바꾼다(2026-09-29 전에는 기본 톤). 푸시가 유실돼도, 앱을 몇 주 안 열어도,
/// 오프라인이어도 그 게이트가 막아 준다.
///
/// **iOS 에는 그 자리가 없다.** AlarmKit 은 발사 시점에 우리 코드를 실행하지 않는다
/// (해제 시점의 `stopIntent` 뿐이다). 예약해 둔 사운드가 그대로 울린다. 그래서 같은 판단을
/// **예약·재예약 시점으로 옮긴다** — `AlarmKitViewModel.schedule` 이 사운드를 고르기 전에 본다.
///
/// 그 결과 판정 시점이 최대 '다음 예약까지' 만큼 이르다. 구독이 만료돼도 이미 예약된 알람은
/// 다음 재예약 전까지 유료 목소리로 울릴 수 있다. 이건 iOS 의 구조적 한계이지 버그가 아니다 —
/// 반대 방향(멀쩡한 알람을 무음화)보다 이쪽이 안전하다.
///
/// ## fail-open 이 원칙이다
///
/// 어떤 단계에서 실패하든 **강등하지 않는다.** 알람 앱에서 잘못된 강등은 "목소리가 안 나옴"
/// 이지만, 판단 실패로 알람을 건드리는 건 사용자가 기대고 자는 것을 흔드는 일이다.
/// 스냅샷이 아예 없으면(한 번도 조회 못 함) 판단 불가로 보고 그대로 둔다.
/// 유료 목소리 권한 판정 결과. **'모른다' 를 '무료' 와 구분하는 것이 이 타입의 존재 이유다**
/// (안드로이드 `PaidVoiceAccess` 와 같은 뜻).
enum PaidVoiceAccess {
    case entitled
    case notEntitled
    case unknown
}

enum PaidVoiceGate {

    /// 이 알람이 **유료 목소리**를 쓰는가. 안드로이드 `hasVoiceResources` 와 동일.
    /// ⚠ **재생 방식만으로 판단하지 말 것.** `playModeEnum != .alarmOnly` 를 단독 조건으로
    /// 두면 **말할 자원이 하나도 없는 알람**이 유료로 잡힌다 — 그러면 한 번도 유료였던 적
    /// 없는 계정이 강등 대상이 된다(2026-08-18 실계정 확인). 짝인
    /// `LocalAlarmRecord.usesPaidVoiceFeatures` 의 같은 주석 참조 — **항상 같이 고친다.**
    static func usesPaidVoice(_ record: LocalAlarmRecord) -> Bool {
        record.localAudioUri?.nilIfBlank != nil
            || record.rawAudioUri?.nilIfBlank != nil
            || record.voiceProfileId?.nilIfBlank != nil
            || record.ttsMessageId?.nilIfBlank != nil
    }

    /// 무료 플랜에서도 쓸 수 있는 **시스템 스톡 보이스** 알람인가.
    /// 안드로이드 `SystemVoices.usesFreeSystemVoiceAlarm` 과 동일한 판정이다.
    static func usesFreeSystemVoice(_ record: LocalAlarmRecord) -> Bool {
        if record.playModeEnum == .alarmOnly { return false }
        // **직접 녹음은 유료 기능이 아니다**(2026-08-12 확정). 내 폰의 파일을 그대로
        // 재생하는 것이라 서버 자산을 쓰지 않는다. 예전에는 여기서 곧바로 false 로
        // 떨어뜨려, 무료 사용자의 녹음 알람이 **예약 시점에 알람음으로 강등**됐다.
        // `localAudioUri` 를 함께 보는 이유는 강등 표식(소스만 남고 파일은 없는 빈 껍데기)을
        // '녹음' 으로 오인하지 않기 위해서다. 안드로이드 `usesFreeSystemVoiceAlarm` 과 같다.
        if record.voiceSourceEnum == .localAudio {
            return record.localAudioUri?.nilIfBlank != nil
        }
        // **기본(시스템) 목소리 알람은 무엇을 말하든 무료다**(2026-10-26, `docs/spec/voice-and-message.md` §8 — 안드로이드
        // `usesFreeSystemVoiceAlarm` 과 같다). 무료도 기본 목소리 직접 입력을 월 3회 만들고, 이미 만든 기본 목소리 결과는 등급이
        // 바뀌어도 계속 쓴다. 예전에는 스톡 클립·프리셋만 무료로 보고 직접 입력 결과는 유료로 읽어, 무료가 만든 직접 입력
        // 알람이 예약 시점에 강등됐다. 유료 판정은 **등록(클론) 목소리**에만 남는다.
        // ⚠ 모르는 목소리 id(내부 시험 기기에만 남은 옛 추가 음성팩 등)는 무료가 아니다 — 무료면 이 판정으로 기본 목소리가
        // 되고, 유료면 접근권 대조(`VoiceStudioViewModel.reconcileInaccessibleVoiceAlarms`)가 기본 목소리로 바꾼다.
        return isSystemVoiceId(record.voiceProfileId)
    }

    /// 로컬에 저장된 구독 스냅샷으로 유료 목소리 권한이 살아 있는지 본다.
    ///
    /// - 스냅샷에 구독 응답 자체가 없으면 **판단 불가 → true**(강등하지 않는다).
    /// - 응답은 있는데 `subscription` 이 nil 이면 서버가 '본인 구독 없음' 이라고 답한 것이다.
    ///   그때는 남은 `users.plan` 으로 가른다.
    /// - 본인 구독이 있으면 만료 시각까지 검사한다.
    /// **유료 목소리 판정 — 우선순위 다섯 단**(2026-08-31, 안드로이드 `resolvePaidVoiceAccess`
    /// 와 같은 규칙). 2단(`users.plan = free` 가 남은 구독 행보다 위다)이 이 목록에서
    /// 빠져 있었다 — 2026-09-02 정정. 전문은 `docs/spec/billing-lifecycle.md`.
    ///
    /// 1. **스토어가 유효하다고 하면 유료다 — 서버 만료로 절대 뒤집지 않는다**
    ///    (`docs/spec/billing-lifecycle.md` 「스토어가 권위다」). 자동갱신은 스토어에서 먼저
    ///    일어나고 서버 반영이 늦을 수 있는데, 그때 옛 만료시각으로 막으면 **돈을 내는
    ///    사용자가 잠긴다** — 스펙이 더 나쁘다고 못박은 방향이다.
    /// 2. 서버가 `users.plan = free` 라고 하면 무료다(남은 구독 행보다 위 — 보류).
    /// 3. 서버가 내 구독을 알면 그 상태·만료로 가른다.
    /// 4. 서버가 '구독 없음' 이라 답했으면 남은 `users.plan` 으로 본다.
    /// 5. 스냅샷이 없으면 **모른다** — 무료가 아니다.
    static func resolve(snapshot: AccessSnapshot, now: Date = Date()) -> PaidVoiceAccess {
        // ⚠ **기한이 지난 스토어 신호는 없는 것으로 본다.** 기한 없이 믿으면 한 번 유료였던
        // 기기가 영구 통행증을 갖는다 — 전경 갱신 없이 배경 예약만 도는 사이 만료돼도
        // 클론 오디오가 계속 예약된다(2026-08-31 리뷰).
        if snapshot.storePlanKey != nil,
           let untilMillis = snapshot.storeEntitlementUntilMillis,
           Date(timeIntervalSince1970: Double(untilMillis) / 1000) > now {
            return .entitled
        }
        let plan = snapshot.userPlan?.trimmingCharacters(in: .whitespaces).lowercased()
        // ⚠ **서버가 free 라고 말하면 남아 있는 구독 행보다도, '모름' 보다도 먼저다.**
        // ① 보류(ON_HOLD·결제 재시도)는 **행을 남긴다** — 행은 `status: active` 인 채 남고
        //    `users.plan` 만 free 로 내려간다(서버 `resolvePlanAfterSuspend`). 행부터 보면
        //    결제가 밀린 사용자가 계속 유료로 읽힌다.
        // ② 콜드 스타트·첫 로그인에는 `subscriptionResponse` 가 아직 nil 인데, 그때
        //    `.unknown` 으로 떨어지면 낙관 규칙에 걸려 무료 사용자에게 보관 중인 클론
        //    목소리와 유료 전용 컨트롤이 열린다(2026-09-01 리뷰). `users.plan` 은 서버가
        //    이미 준 값이라 스냅샷을 기다릴 이유가 없다.
        // 신규 결제는 막지 않는다 — 서버가 행과 **같은 트랜잭션에서** plan 을 올리고,
        // 산 직후는 어차피 위의 스토어 신호가 잡는다.
        if plan == "free" { return .notEntitled }
        // 스냅샷도 없고 plan 도 모르면 그때가 진짜 '모름' 이다.
        guard let response = snapshot.subscriptionResponse else { return .unknown }
        guard let subscription = response.subscription else {
            switch plan {
            case .some(let plan) where PaidPlans.userPlans.contains(plan):
                return .entitled
            default:
                // ⚠ **여기서 `.unknown` 을 돌려주지 말 것.** '모름' 은 서버에 **한 번도 못
                // 물어본** 상태(스냅샷 자체가 없음)의 뜻이다. 여기는 서버가 "본인 구독 없음"
                // 이라고 **답했고** `users.plan` 도 유료가 아닌 상태라 근거가 다 모인 무료다 —
                // 모름으로 접으면 낙관 규칙에 걸려 **무료 사용자의 유료 목소리가 영영 강등되지
                // 않는다**(2026-09-01: 앞 회차에서 이 갈래를 `.unknown` 으로 바꿨다가 테스트
                // 2건이 깨져 있었다).
                return .notEntitled
            }
        }
        return isSubscriptionActive(subscription, now: now) ? .entitled : .notEntitled
    }

    /// **모르면 잠그지 않는다.** 예약 강등 판단이 쓴다 — 이 파일 맨 위의 fail-open 원칙 그대로다.
    static func isEntitled(snapshot: AccessSnapshot, now: Date = Date()) -> Bool {
        resolve(snapshot: snapshot, now: now) != .notEntitled
    }

    /// 화면이 **지금 들고 있는 값**으로 판정할 스냅샷을 만든다(저장된 캐시가 아니다).
    ///
    /// ⚠ **화면마다 손으로 조립하지 말 것.** 목소리 탭 입구와 등록 제출이 서로 다른 판정기를
    /// 쓰고 있었다 — 입구는 이 판정기, 제출은 `PlanTier.bestKnown` 이라, 서버가 `users.plan`
    /// 으로만 유료를 준 계정은 **녹음을 다 마치고 제출에서** "유료 이용권에서 사용할 수
    /// 있어요" 로 막혔다. 둘 다 이걸 거친다.
    ///
    /// ⚠ **살아 있는 StoreKit 신호에는 기한을 붙이지 않는다**(2026-08-31 리뷰). 이 스냅샷은
    /// 캐시가 아니라 **지금 방금 읽은 값**이라 신선도를 의심할 이유가 없다. 기한을 비워 두면
    /// 판정기가 기한을 함께 요구하므로 **살아 있는 신호가 한 번도 이기지 못한다** — 먼 미래를
    /// 준다('지금 유효' 라는 뜻이다).
    ///
    /// ⚠ **`userPlan` 을 빼지 말 것.** 남은 구독 행보다 먼저 보는 값이라, 빼면 결제 보류(행은
    /// 남고 plan 만 free)에서 행이 유료로 답한다.
    static func liveSnapshot(
        subscriptionResponse: BillingSubscriptionResponse?,
        storeTier: PlanTier,
        user: AuthUser?
    ) -> AccessSnapshot {
        let storeEntitled = storeTier.meetsOrExceeds(.personal)
        return AccessSnapshot(
            subscriptionResponse: subscriptionResponse,
            storePlanKey: storeEntitled ? storeTier.rawValue : nil,
            storeEntitlementUntilMillis: storeEntitled ? Int64.max : nil,
            userPlan: user?.plan
        )
    }

    /// 예약 시점에 이 알람의 유료 목소리를 **기본 목소리로** 바꿔야 하는가
    /// (`DefaultVoiceSubstitute` — 2026-09-29 전에는 기본 톤이었다. billing-lifecycle.md 「목소리를 못 쓰게 되면」).
    ///
    /// 무료 시스템 보이스는 애초에 강등 대상이 아니다.
    static func shouldDowngrade(
        record: LocalAlarmRecord,
        snapshot: AccessSnapshot,
        now: Date = Date()
    ) -> Bool {
        guard !usesFreeSystemVoice(record) else { return false }
        guard usesPaidVoice(record) else { return false }
        return !isEntitled(snapshot: snapshot, now: now)
    }

    // MARK: - 내부

    private static func isSubscriptionActive(_ subscription: BillingSubscription, now: Date) -> Bool {
        let status = subscription.status.lowercased()
        // 회복형 상태(ON_HOLD/PAUSED)는 행으로는 권한을 회수하지 않는다 — 회수는 위의 `users.plan` 이
        // 가른다. 서버 `resolvePlanAfterSuspend` 와 같은 취급이다.
        if status == "on_hold" || status == "paused" { return true }
        if status == "canceled" || status == "expired" { return false }

        // 만료 시각이 있으면 그때까지만 유효하다.
        if let expires = subscription.expiresAt.nilIfBlank, let expiryDate = parseTimestamp(expires) {
            return expiryDate > now
        }
        // 만료를 모르면 회수하지 않는다(fail-open).
        return true
    }

    /// 서버는 `expires_at` 을 ISO8601 로도, SQLite `datetime('now')` 형식
    /// (`YYYY-MM-DD HH:MM:SS`, UTC)으로도 내려준다. 둘 다 받아들인다.
    ///
    /// ⚠ 포매터를 static 으로 캐시하지 않는다 — `ISO8601DateFormatter`/`DateFormatter` 는
    /// `Sendable` 이 아니라 Swift 6 에서 공유 가변 상태가 된다. 예약은 자주 일어나는 일이
    /// 아니라 매번 만들어도 무해하다.
    static func parseTimestamp(_ raw: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: raw) { return date }

        let sqlite = DateFormatter()
        sqlite.locale = Locale(identifier: "en_US_POSIX")
        sqlite.timeZone = TimeZone(identifier: "UTC")
        sqlite.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return sqlite.date(from: raw)
    }
}
