import Foundation

/// 새 알람 편집기가 열릴 때 쓸 **직전 선택값**을 계정별로 기억한다.
///
/// `CLAUDE.md` 「알람 편집기 기본값 = 직전 선택 유지」의 iOS 구현이다. 안드로이드
/// `DynamicPromptPreferenceStore`(SharedPreferences) 미러이고 **키도 같다**:
///   - `last_message_context_<userId>` : 문구 종류(`preset`/`weather`/`fortune`/`love`/`medication`)
///   - `last_manual_text_<userId>`     : 직접 입력 문구
///
/// 규약(안드로이드와 동일):
///  - **기록 시점은 알람 저장 성공 시 한 곳뿐이다.** 편집기에서 눌러만 보고 취소한 것은
///    기억하지 않는다. 선택 즉시 저장하는 코드를 넣지 말 것.
///  - **적용 대상은 새 알람뿐이다.** 기존 알람을 열 때는 저장된 자기 값만 쓴다 —
///    열기만 해도 문구가 바뀌면 안 된다.
///  - **마지막 선택은 하나다.** 생성형 문구를 저장하면 직접 입력 기록을 **지운다**
///    (별도 '어느 쪽이 마지막' 플래그를 두지 않는다 — 플래그와 값이 어긋나는 상태 자체를
///    없앤다). 그래서 `lastManualText` 가 차 있다 = 마지막이 직접 입력이었다.
///
/// ⚠ **직접 입력 문구를 기억하는 건 2026-08-06 에 바뀐 규칙이다.** 그전에는 "기억하지
/// 않는다" 였는데, 종류만 이어받으면 새 알람이 **빈 직접입력**으로 열려 저장이 막히는 게
/// 실질적 근거였다. 문구를 함께 이어받으면 그 문제가 사라지므로 규칙도 바뀌었다.
///
///   - `last_free_bucket_<userId>`    : 무료 테마(버킷). 안드로이드와 같은 키 이름이다.
struct DynamicPromptPreferenceStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: 문구 종류

    /// 마지막으로 **저장에 성공한** 문구 종류. 한 번도 고른 적 없으면 nil.
    func lastMessageContext(userID: String?) -> String? {
        guard let key = contextKey(userID) else { return nil }
        return defaults.string(forKey: key)?.nilIfBlank
    }

    /// 생성형 문구 종류를 기록한다. **직접 입력 기록은 함께 지운다**(마지막 선택은 하나).
    func saveLastMessageContext(userID: String?, context: String?) {
        guard let key = contextKey(userID) else { return }
        if let context = context.nilIfBlank {
            defaults.set(context, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
        if let manualKey = manualTextKey(userID) {
            defaults.removeObject(forKey: manualKey)
        }
    }

    // MARK: 직접 입력 문구

    /// 마지막으로 **저장에 성공한** 직접 입력 문구. 차 있으면 마지막 선택이 직접 입력이었다는 뜻.
    func lastManualText(userID: String?) -> String? {
        guard let key = manualTextKey(userID) else { return nil }
        return defaults.string(forKey: key)?.nilIfBlank
    }

    /// 직접 입력 문구를 기록한다. **문구 종류 기록은 함께 지운다**(마지막 선택은 하나).
    ///
    /// ⚠ 기억하는 값은 입력 원문이 아니라 **알람에 실제로 저장된 문구**여야 한다
    /// (`record.voiceText`). 잠금화면 문구와 음성을 맞추려고 그 값을 저장하기 때문이다.
    func saveLastManualText(userID: String?, text: String?) {
        guard let key = manualTextKey(userID) else { return }
        if let text = text.nilIfBlank {
            defaults.set(text, forKey: key)
            if let contextKey = contextKey(userID) {
                defaults.removeObject(forKey: contextKey)
            }
        } else {
            defaults.removeObject(forKey: key)
        }
    }

    // MARK: 무료 테마(버킷)

    /// 마지막으로 **저장에 성공한** 무료 테마. 한 번도 고른 적 없으면 nil.
    func lastFreeBucket(userID: String?) -> String? {
        guard let key = freeBucketKey(userID) else { return nil }
        return defaults.string(forKey: key)?.nilIfBlank
    }

    /// 무료 테마를 기록한다.
    ///
    /// ⚠ **직접 입력 기록과 섞지 말 것.** 예전에는 테마를 담을 키가 없어서, 테마를 골라
    /// 저장하면 **서버 스톡 클립의 문장**이 `last_manual_text` 로 새어 들어갔다. 그러면
    /// 다음 새 알람이 '직접 입력' 으로 열리고 테마 선택은 매번 초기화된다(2026-08-07 수정).
    func saveLastFreeBucket(userID: String?, bucket: String?) {
        guard let key = freeBucketKey(userID) else { return }
        if let bucket = bucket?.nilIfBlank {
            defaults.set(bucket, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }

    /// **테마(버킷)로 저장된 알람**의 직전 선택을 적는다 — 안드로이드 `MainViewModel.rememberMessageChoiceUsed` 의 버킷 갈래 짝.
    ///
    /// ⚠ **테마만 적고 끝내지 말 것**(2026-10-29 두 앱 비교). 예전 iOS 는 테마만 적었다. 그러면 (1) 유료 클론은 문구 종류
    /// 다섯이 **전부** 테마로 저장되므로 종류가 영영 기록되지 않아 새 클론 알람이 낡은 종류로 열렸고, (2) 직접 입력을 한 번
    /// 저장한 뒤에는 테마 저장이 그 기록을 지우지 못해 새 알람이 매번 그 옛 문구로 열렸다. 종류를 적으면 직접 입력 기록이
    /// 지워진다(`saveLastMessageContext`) — 마지막 선택은 하나다.
    func saveBucketChoice(userID: String?, bucket: String, voiceProfileID: String?, randomContext: String?) {
        if isFreeFixedVoiceID(voiceProfileID) {
            // 기본 목소리·추가 팩: 고른 것이 테마 그 자체다 — 테마와 그 종류를 함께 적는다.
            saveLastFreeBucket(userID: userID, bucket: bucket)
            if let context = RandomPromptContext.forBucket(bucket)?.rawValue {
                saveLastMessageContext(userID: userID, context: context)
            }
        } else if let context = randomContext.nilIfBlank ?? RandomPromptContext.forBucket(bucket)?.rawValue {
            // 클론의 사전렌더 테마: 고른 것은 **문구 종류**이고 테마는 그 결과다 — 테마로는 적지 않는다.
            saveLastMessageContext(userID: userID, context: context)
        }
    }

    // MARK: 세션 정리

    /// 명시적 로그아웃·탈퇴에서만 부른다.
    ///
    /// ⚠ **자동 401 에서 지우지 말 것.** 같은 사람이 다시 로그인할 때 취향을 잃는다
    /// (안드로이드에서 실제로 회귀했던 지점 — Codex #646).
    func clear(userID: String?) {
        if let key = contextKey(userID) { defaults.removeObject(forKey: key) }
        if let key = manualTextKey(userID) { defaults.removeObject(forKey: key) }
        if let key = freeBucketKey(userID) { defaults.removeObject(forKey: key) }
    }

    private func contextKey(_ userID: String?) -> String? {
        guard let id = normalized(userID) else { return nil }
        return "last_message_context_\(id)"
    }

    private func freeBucketKey(_ userID: String?) -> String? {
        guard let id = normalized(userID) else { return nil }
        return "last_free_bucket_\(id)"
    }

    private func manualTextKey(_ userID: String?) -> String? {
        guard let id = normalized(userID) else { return nil }
        return "last_manual_text_\(id)"
    }

    private func normalized(_ userID: String?) -> String? { userID.nilIfBlank }
}
