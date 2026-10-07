import Foundation

/// 등록한 목소리를 **울릴 때 다듬는 값** — 목소리 높이 하나. 규칙은 `docs/spec/voice-and-message.md` §4-3.
///
/// 등록 미리듣기 화면(`VoicePreviewConfirmView`)에서 들으면서 고르고, 그 목소리로 울리는
/// **모든 알람**에 같은 값이 실린다. iOS 에서 소리를 바꿀 수 있는 자리는 AlarmKit 에 넘기는
/// 파일뿐이라(`AlarmSoundStaging`), 이 값은 스테이징할 때 파일에 **구워 넣는다.**
///
/// 높이는 TD-PSOLA(`VoicePitchShifter`)로 바꾼다 — 목소리 몸집(포먼트)은 그대로 두고 높이만
/// 움직인다. `AVAudioUnitTimePitch` 는 몸집까지 같이 움직여 변조된 목소리로 들렸다(2026-10-07
/// 사용자 판단). 음량·굵기 슬라이더도 같은 날 뺐다 — 크기는 원래 미리듣기와 같게 되맞춘다.
///
/// 범위·눈금은 안드로이드 슬라이더와 **같은 숫자**여야 한다 — 한쪽에서만 만들 수 있는 값이
/// 생기면 같은 목소리가 두 기기에서 다르게 운다.
struct VoiceTuning: Codable, Equatable, Sendable {
    /// 값이 어디서 왔는가. 소리와 무관하다 — 파일 이름·예약 지문에는 들어가지 않는다.
    enum Source: String, Codable, Sendable {
        /// 자동 추천값 그대로(사용자가 슬라이더를 건드리지 않았다).
        case suggested
        /// 사용자가 슬라이더로 바꿨다.
        case user
    }

    /// 목소리 높이(반음). 길이는 바꾸지 않는다.
    var pitchSt: Double
    var source: Source
    /// 저장할 때 그 목소리의 **교체 세대**(`VoiceProfile.customAudioInvalidatedAt`). 다른 기기에서 같은 목소리를
    /// 제자리 교체하면 프로필 id 는 그대로라, 이 세대가 달라진 것으로 옛 녹음 기준 값을 알아보고 지운다
    /// (`VoiceTuningStore.forgetIfReplaced`, Codex #870). 소리와 무관하다 — 꼬리표·지문에 넣지 않는다.
    var generation: String? = nil

    static let pitchRange: ClosedRange<Double> = -6...3
    static let step: Double = 0.5

    static let neutral = VoiceTuning(pitchSt: 0, source: .suggested)

    /// 범위 안으로 자르고 눈금(0.5)에 맞춘다. 저장·굽기·지문 전에 언제나 거친다 —
    /// 0.49999 같은 값이 파일 이름을 하나 더 만들지 않게.
    func normalized() -> VoiceTuning {
        VoiceTuning(pitchSt: Self.snap(pitchSt, to: Self.pitchRange), source: source, generation: generation)
    }

    /// **소리를 바꾸는 값만으로 만든 꼬리표** — 스테이징 파일 이름과 예약 지문에 들어간다.
    /// 중립(0)이면 nil — 그래야 다듬지 않은 목소리의 지문·파일 이름이 이 기능 이전과
    /// **같게** 남아, 앱을 올리자마자 모든 알람이 재예약되지 않는다.
    ///
    /// 0.1 반음 단위 정수로 적는다(`s-15`). 점(.)을 넣지 않는 이유: 스테이징 파일을 찾는
    /// `stagedFileName(forBaseName:)` 이 마지막 점 뒤를 확장자로 본다. 접두 `s` 는 PSOLA 로
    /// 구운 파일이라는 표시다 — 굽는 방식이 바뀌면 접두를 바꿔 옛 파일과 지문을 갈라야 한다.
    var soundTag: String? {
        let p = Int((normalized().pitchSt * 10).rounded())
        return p == 0 ? nil : "s\(p)"
    }

    var isNeutral: Bool { soundTag == nil }

    /// 들리는 소리가 같은가(출처는 보지 않는다).
    func soundsSame(as other: VoiceTuning) -> Bool { soundTag == other.soundTag }

    private static func snap(_ value: Double, to range: ClosedRange<Double>) -> Double {
        guard value.isFinite else { return 0 }
        let snapped = (value / step).rounded(.toNearestOrAwayFromZero) * step
        let clamped = min(max(snapped, range.lowerBound), range.upperBound)
        // -0.0 을 0 으로 — 꼬리표·표시에 "-0" 이 나오지 않게.
        return clamped == 0 ? 0 : clamped
    }
}

/// 다듬기 값을 **계정 × 목소리** 단위로 기기에 둔다(서버 동기화 없음 — 스펙 §4-3).
///
/// 키: `voice_tuning<suffix>_<userId>_<voiceProfileId>`. 중립값은 저장하지 않고 키를 지운다 —
/// '없음' 과 '중립' 을 한 상태로 둬야 교체(같은 프로필 id 재사용) 때 옛 값이 남지 않는다.
///
/// ⚠ 읽는 곳은 `AlarmSoundResolver.plan` 이다. 값이 바뀌면 plan 의 지문이 바뀌고,
/// `AlarmScheduleReconciler` 가 그 목소리를 쓰는 알람을 **새 파일로 다시 예약한다.**
///
/// 지우는 곳: 목소리 삭제·민감 동의 철회는 그 목소리 값([remove(voiceProfileID:)]), 명시적
/// 로그아웃·탈퇴는 그 계정 값 전부([clear(userID:)]). 자동 만료에서는 지우지 않는다 — 같은 사람이
/// 다시 로그인하는 경우가 대부분이고, 알람은 그대로 울린다.
struct VoiceTuningStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// 저장된 값. 없거나 중립이면 nil.
    func tuning(userID: String?, voiceProfileID: String?) -> VoiceTuning? {
        guard let key = Self.key(userID: userID, voiceProfileID: voiceProfileID),
              let data = defaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode(VoiceTuning.self, from: data) else { return nil }
        let normalized = decoded.normalized()
        return normalized.isNeutral ? nil : normalized
    }

    /// 저장한다. 중립이면 지운다.
    /// - Returns: **들리는 소리가 바뀌었는가** — true 면 호출부가 예약을 맞춰야 한다.
    @discardableResult
    func save(_ tuning: VoiceTuning, userID: String?, voiceProfileID: String?) -> Bool {
        guard let key = Self.key(userID: userID, voiceProfileID: voiceProfileID) else { return false }
        let previous = self.tuning(userID: userID, voiceProfileID: voiceProfileID) ?? .neutral
        let next = tuning.normalized()
        if next.isNeutral {
            defaults.removeObject(forKey: key)
        } else if let data = try? JSONEncoder().encode(next) {
            defaults.set(data, forKey: key)
        }
        return !previous.soundsSame(as: next)
    }

    /// 그 목소리가 **새 교체 세대**로 바뀌었으면 옛 녹음 기준 값을 지운다 — `VoiceReplacementMarkerStore` 가 새
    /// 세대를 반영할 때 부른다. 같은 세대로 저장한 값(이 기기에서 교체하며 고른 값)은 남긴다 — 그래서 늦게 온
    /// 푸시·재시도의 순서와 상관없이 맞다.
    func forgetIfReplaced(userID: String?, voiceProfileID: String?, generation: String?) {
        guard let key = Self.key(userID: userID, voiceProfileID: voiceProfileID),
              let data = defaults.data(forKey: key),
              let stored = try? JSONDecoder().decode(VoiceTuning.self, from: data) else { return }
        if stored.generation?.nilIfBlank != generation?.nilIfBlank {
            defaults.removeObject(forKey: key)
        }
    }

    /// 그 계정의 값 중 `accessible` 에 없는 목소리의 것을 지운다 — 권위 있는 목록으로 접근을 잃은 목소리가 확인됐을 때
    /// (삭제·공유 해제, 다른 기기에서 일어난 것 포함). 그 목소리를 쓰는 알람이 없어도 지운다(Codex #870). 지웠으면 true.
    @discardableResult
    func retainOnly(userID: String?, voiceProfileIDs accessible: Set<String>) -> Bool {
        guard let userID = userID?.trimmingCharacters(in: .whitespacesAndNewlines), !userID.isEmpty else { return false }
        let prefix = "\(Self.keyPrefix)\(userID)_"
        var removed = false
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
            if !accessible.contains(String(key.dropFirst(prefix.count))) {
                defaults.removeObject(forKey: key)
                removed = true
            }
        }
        return removed
    }

    /// 그 계정의 값을 모두 지운다 — 명시적 로그아웃·탈퇴(`AuthViewModel.clearAccountPreferences`).
    func clear(userID: String?) {
        guard let userID = userID?.trimmingCharacters(in: .whitespacesAndNewlines), !userID.isEmpty else { return }
        let prefix = "\(Self.keyPrefix)\(userID)_"
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
            defaults.removeObject(forKey: key)
        }
    }

    /// 그 목소리의 값을 **모든 계정에서** 지운다 — 목소리 삭제·민감 동의 철회. 목소리 id 는 계정을
    /// 넘어 겹치지 않으므로, 계정을 모르는 삭제 경로(`VoiceStudioViewModel.handleDeletedVoiceProfile`)도 쓸 수 있다.
    func remove(voiceProfileID: String?) {
        guard let voiceProfileID = voiceProfileID?.trimmingCharacters(in: .whitespacesAndNewlines),
              !voiceProfileID.isEmpty else { return }
        let suffix = "_\(voiceProfileID)"
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(Self.keyPrefix) && key.hasSuffix(suffix) {
            defaults.removeObject(forKey: key)
        }
    }

    private static var keyPrefix: String { "voice_tuning\(TestIsolation.storageSuffix)_" }

    static func key(userID: String?, voiceProfileID: String?) -> String? {
        guard let userID = userID?.trimmingCharacters(in: .whitespacesAndNewlines), !userID.isEmpty,
              let voiceProfileID = voiceProfileID?.trimmingCharacters(in: .whitespacesAndNewlines),
              !voiceProfileID.isEmpty else { return nil }
        return "\(keyPrefix)\(userID)_\(voiceProfileID)"
    }
}
