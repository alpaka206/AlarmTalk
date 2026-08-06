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
/// ⚠ `last_free_bucket_<userId>` 는 만들지 않는다 — iOS 에는 무료 버킷 회전 개념이 아직 없다.
/// 버킷을 구현하면 그때 같은 키 이름으로 추가할 것.
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
        if let context = context?.trimmingCharacters(in: .whitespacesAndNewlines), !context.isEmpty {
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
        if let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            defaults.set(text, forKey: key)
            if let contextKey = contextKey(userID) {
                defaults.removeObject(forKey: contextKey)
            }
        } else {
            defaults.removeObject(forKey: key)
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
    }

    private func contextKey(_ userID: String?) -> String? {
        guard let id = normalized(userID) else { return nil }
        return "last_message_context_\(id)"
    }

    private func manualTextKey(_ userID: String?) -> String? {
        guard let id = normalized(userID) else { return nil }
        return "last_manual_text_\(id)"
    }

    private func normalized(_ userID: String?) -> String? {
        guard let id = userID?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty else {
            return nil
        }
        return id
    }
}
