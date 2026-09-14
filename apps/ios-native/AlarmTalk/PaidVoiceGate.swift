import Foundation

/// 플랜 상수.
///
/// ⚠ **원본은 `packages/shared/src/schemas/plan.ts` 다.** 네이티브는 TS 를 가져다 쓸 수
/// 없어 손으로 두되, 값이 어긋나면 `scripts/check-plan-constants.py`(CI)가 잡는다.
/// 목록을 호출부에서 즉석으로 만들지 말 것 — 그렇게 네 벌로 갈라져 있었다.
enum PaidPlans {
    /// 유료로 치는 `users.plan` 값.
    static let userPlans: Set<String> = ["personal", "plus", "couple", "family"]
    /// 유료로 치는 `plans.plan_type`. 커플은 `key='couple'` + `plan_type='family'` 다.
    static let planTypes: Set<String> = ["personal", "family"]
}

/// 유료 목소리 권한을 **예약 시점에** 재확인한다.
///
/// ## 왜 예약 시점인가 — iOS 와 안드로이드의 결정적 차이
///
/// 안드로이드는 `RingingService` 가 **울릴 때** 로컬 영속 구독으로 유료 권한을 다시 보고,
/// 무료로 떨어졌으면 그 자리에서 기본 톤으로 강등한다. 푸시가 유실돼도, 앱을 몇 주 안 열어도,
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

    /// 이 알람이 **유료 목소리**를 쓰는가. 안드로이드 `alarmUsesPaidVoice` 와 동일.
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
        guard isSystemVoiceId(record.voiceProfileId) else { return false }

        let noCachedAudio = record.localAudioUri?.nilIfBlank == nil && record.rawAudioUri?.nilIfBlank == nil
        let stockClipAudio = record.audioCacheKey?.hasPrefix("stock_") == true
        let language = record.voiceLanguage?.trimmingCharacters(in: .whitespaces)
        let presetGeneratedAudio = record.voiceRandomPrompt
            && record.voiceRandomContext?.trimmingCharacters(in: .whitespaces) == "preset"
            && (language == nil || language!.isEmpty || language == "ko")
        return noCachedAudio || stockClipAudio || presetGeneratedAudio
    }

    /// 로컬에 저장된 구독 스냅샷으로 유료 목소리 권한이 살아 있는지 본다.
    ///
    /// - 스냅샷에 구독 응답 자체가 없으면 **판단 불가 → true**(강등하지 않는다).
    /// - 응답은 있는데 `subscription` 이 nil 이면 서버가 '본인 구독 없음' 이라고 답한 것이다.
    ///   그때는 커플/가족 그룹 접근이 있는지 본다(본인 구독 없이 그룹으로 쓰는 멤버).
    /// - 본인 구독이 있으면 만료 시각까지 검사한다(그룹 체크로 만료 게이트를 우회하지 않게).
    /// **유료 목소리 판정 — 우선순위 다섯 단**(2026-08-31, 안드로이드 `resolvePaidVoiceAccess`
    /// 와 같은 규칙). 2단(`users.plan = free` 가 남은 구독 행보다 위다)이 이 목록에서
    /// 빠져 있었다 — 2026-09-02 정정. 전문은 `docs/spec/billing-lifecycle.md`.
    ///
    /// 1. **스토어가 유효하다고 하면 유료다 — 서버 만료로 절대 뒤집지 않는다**
    ///    (`docs/spec/billing-lifecycle.md` 「스토어가 권위다」). 자동갱신은 스토어에서 먼저
    ///    일어나고 서버 반영이 늦을 수 있는데, 그때 옛 만료시각으로 막으면 **돈을 내는
    ///    사용자가 잠긴다** — 스펙이 더 나쁘다고 못박은 방향이다.
    /// 2. 서버가 내 구독을 알면 그 상태·만료로 가른다.
    /// 3. 서버가 '구독 없음' 이라 답했으면 그룹 접근을 본다.
    /// 4. 스냅샷이 없으면 **모른다** — 무료가 아니다.
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
        // ① 보류(ON_HOLD·결제 재시도)는 **행을 남긴다** — 서버의 `propagateGroupMemberPlans`
        //    는 멤버의 그룹 연동 구독을 취소하지 않고 재계산에서 제외만 하므로, 행은
        //    `status: active` 인 채 남고 `users.plan` 만 free 로 내려간다. 행부터 보면
        //    결제가 밀린 그룹 멤버가 계속 유료로 읽힌다.
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
            // ⚠ **`users.plan` 이 그룹보다 위다.** 결제 보류는 그룹을 남긴 채 이 값만
            // 회수하므로, 그룹만 보면 소유자 결제가 밀린 멤버가 계속 유료로 읽힌다.
            switch plan {
            case .some(let plan) where PaidPlans.userPlans.contains(plan):
                return .entitled
            default:
                // ⚠ **여기서 `.unknown` 을 돌려주지 말 것.** '모름' 은 서버에 **한 번도 못
                // 물어본** 상태(스냅샷 자체가 없음)의 뜻이다. 여기는 서버가 "본인 구독 없음"
                // 이라고 **답했고** 그룹 접근도 없는 상태라 근거가 다 모인 무료다 — 모름으로
                // 접으면 낙관 규칙에 걸려 **무료 사용자의 유료 목소리가 영영 강등되지 않는다**
                // (2026-09-01: 앞 회차에서 이 갈래를 `.unknown` 으로 바꿨다가
                // `test_noSubscriptionAndNoGroup_downgrades` 등 2건이 깨져 있었다).
                return hasGroupAccess(response: response, familyGroup: snapshot.familyGroup)
                    ? .entitled : .notEntitled
            }
        }
        return isSubscriptionActive(subscription, now: now) ? .entitled : .notEntitled
    }

    /// **모르면 잠그지 않는다.** 예약 강등 판단이 쓴다 — 이 파일 맨 위의 fail-open 원칙 그대로다.
    static func isEntitled(snapshot: AccessSnapshot, now: Date = Date()) -> Bool {
        resolve(snapshot: snapshot, now: now) != .notEntitled
    }

    /// 예약 시점에 이 알람의 유료 목소리를 기본 톤으로 강등해야 하는가.
    ///
    /// **본인 소유(`localOwned`) 알람만 대상이다.** 공유받은 알람(`receivedRemote`)은
    /// 보낸 사람의 구독으로 성립하는 것이라 받는 쪽 구독으로 판단하지 않는다.
    /// 무료 시스템 보이스는 애초에 강등 대상이 아니다.
    static func shouldDowngrade(
        record: LocalAlarmRecord,
        snapshot: AccessSnapshot,
        now: Date = Date()
    ) -> Bool {
        guard record.originEnum == .localOwned else { return false }
        guard !usesFreeSystemVoice(record) else { return false }
        guard usesPaidVoice(record) else { return false }
        return !isEntitled(snapshot: snapshot, now: now)
    }

    /// 강등된 형태 — **알람은 그대로 울린다.** 목소리만 빼고 기본 알람음으로 떨어뜨린다.
    ///
    /// ⚠ 이 값을 store 에 쓰지 **않는다.** 예약에 쓸 사운드를 고르기 위한 일시적 형태일 뿐이고,
    /// 저장해 버리면 구독을 되살렸을 때 되돌릴 원본이 사라진다.
    static func downgraded(_ record: LocalAlarmRecord) -> LocalAlarmRecord {
        var next = record
        next.playMode = AlarmPlayMode.alarmOnly.rawValue
        return next
    }

    // MARK: - 내부

    private static func hasGroupAccess(
        response: BillingSubscriptionResponse,
        familyGroup: FamilyGroupCurrentResponse?
    ) -> Bool {
        // 그룹에 소속돼 있으면 본인 구독이 없어도 유료 목소리를 쓴다.
        if let group = familyGroup?.group, group.id.nilIfBlank != nil { return true }
        // 응답이 플랜을 직접 알려 주면 그걸로도 본다.
        if let planType = response.plan?.planType.lowercased(),
           planType == "couple" || planType == "family" {
            return true
        }
        return false
    }

    private static func isSubscriptionActive(_ subscription: BillingSubscription, now: Date) -> Bool {
        let status = subscription.status.lowercased()
        // 회복형 상태(ON_HOLD/PAUSED)는 그룹·공유를 그대로 두므로 권한을 회수하지 않는다.
        // 서버 `resolvePlanAfterSuspend` 와 같은 취급이다.
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
