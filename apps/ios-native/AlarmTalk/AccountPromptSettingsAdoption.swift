import Foundation

/// 서버의 계정 설정(`dynamic_prompt_settings`)을 이 기기에 받아 적은 결과.
/// 안드로이드 `data/DynamicPromptPreferenceStore.kt` 의 `AccountSettingsAdoption` 과 같다.
enum AccountPromptSettingsAdoption: Equatable {
    /// 서버 값을 받아들였다(바뀐 게 없었을 수도 있다). 공휴일 국가도 서버 지역을 따라도 된다.
    case accepted
    /// 이 기기에 서버보다 새 변경이 있어 **덮지 않았다.** 호출부는 이 값을 다시 올린다.
    /// 공휴일 국가도 서버 지역을 따르지 않는다 — 이 기기에서 고를 때 이미 맞췄다.
    case localPending(DynamicPromptSettings)
    /// 서버 값을 받아들여야 했는데 **기기에 적지 못했다**(키체인 쓰기 실패). 기기 값은 옛것 그대로다 —
    /// 호출부는 공휴일 국가를 서버 지역으로 옮기지 않는다(화면·알람이 읽는 기기 값과 달력의 나라가 갈라진다,
    /// Codex #837). 다음 계정 응답에 다시 받아 적는다. 안드로이드는 SharedPreferences 라 이 갈래가 없다.
    case localWriteFailed
}

/// **계정 설정 받아 적기**(2026-09-30, 스펙 voice-and-message.md 「계정의 지역·사주는 기기에 받아 적는다」).
///
/// 설정 '지역'·'운세 정보' 행과 편집기는 **이 기기 값**(키체인)을 읽고, 서버에서 계정 설정을 받을 때마다
/// 여기서 그 값을 맞춘다. 안드로이드 `DynamicPromptPreferenceStore.adoptAccountSettings` 와 **같은 규칙**이다:
///
///  - **이 기기에 아직 안 올라간 변경이 있으면 덮지 않는다**(`saveLocalEdit` 뒤 서버 저장이 실패했거나
///    `AuthViewModel.updateProfile` 이 다른 요청 때문에 건너뛴 경우). 서버가 준 값은 그 변경보다
///    **옛것**이다 — 덮으면 방금 고른 지역이 다음 실행에 조용히 되돌아가고, 공휴일 국가만 새 나라에 남는다.
///    그때는 `.localPending` 을 돌려주고 호출부(`AlarmTalkApp`)가 로컬 값을 다시 올린다. 서버 값이
///    로컬과 같아졌으면(올리기는 성공했는데 응답을 못 받은 경우) 표시만 내린다.
///  - 그 밖에는 **서버가 이긴다**(다른 기기에서 바꾼 값). 단 묶음(날씨·사주)마다 서버가 비어 있으면
///    로컬을 그대로 둔다 — 비어 있는 것은 '지웠다' 가 아니라 '아직 안 올라갔다' 다(서버에는 이 값을
///    지우는 경로가 없다).
///
/// ⚠ **"서버 값이 있으면 서버, 없으면 기기" 로 되돌리지 말 것**(2026-09-30 전 iOS). 그 규칙은 두 곳에서
/// 안드로이드와 갈렸다: 오프라인에서 고른 지역이 다음 실행에 서버의 옛 지역으로 되돌아갔고, 서버에 사주만
/// 있으면 **기기에만 있던 지역까지 '미설정'** 으로 보였다(통째로 서버 값을 썼다).
extension DynamicPromptPreferences {

    /// '아직 안 올라간 변경' 표시의 UserDefaults 키(계정별). 값은 참/거짓뿐이라 키체인에 두지 않는다.
    static let unsyncedDefaultsKeyPrefix = "dynamic_prompt_settings_unsynced_"

    static func unsyncedDefaultsKey(userID: String?) -> String? {
        guard let userID = userID.nilIfBlank else { return nil }
        return unsyncedDefaultsKeyPrefix + userID
    }

    /// 사용자가 **이 기기에서** 고친 지역·사주를 적는다 — '아직 안 올라간 변경' 표시를 함께 남긴다.
    /// 호출부는 곧바로 서버에 올리고(`AuthViewModel.updateProfile`), 성공하면 `markPushed` 가 표시를 내린다.
    /// 안드로이드 `saveWeatherLocation`·`saveFortuneInfo` 와 같다.
    ///
    /// ⚠ **키체인에 적지 못했으면 표시를 남기지 않는다**(Codex #837). 키체인에는 옛 값이 그대로라, 표시만 남으면
    /// 서버 저장이 성공해도 `markPushed` 가 그 옛 값과 비교해 표시를 못 내리고, 다음 받아 적기가 옛 값을
    /// `.localPending` 으로 **다시 올려 방금 저장한 새 값을 덮는다.** 표시가 없으면 서버 값이 이긴다 —
    /// 올리기가 성공했으면 그게 새 값이다.
    /// - Parameter write: 기기 값을 적는 곳(테스트가 실패를 흉내 낸다). 기본은 키체인(`save(userID:)`).
    /// - Returns: 적었는가.
    @discardableResult
    func saveLocalEdit(
        userID: String?,
        defaults: UserDefaults = .standard,
        write: (DynamicPromptPreferences, String?) -> Bool = { $0.save(userID: $1) }
    ) -> Bool {
        guard write(self, userID) else { return false }
        guard let key = Self.unsyncedDefaultsKey(userID: userID) else { return true }
        defaults.set(true, forKey: key)
        return true
    }

    /// 이 기기에 아직 서버로 안 올라간 지역·사주 변경이 있는가.
    static func hasUnsyncedChange(userID: String?, defaults: UserDefaults = .standard) -> Bool {
        guard let key = unsyncedDefaultsKey(userID: userID) else { return false }
        return defaults.bool(forKey: key)
    }

    /// 서버 저장이 성공했다. 올린 값이 **지금도** 기기 값과 같을 때만 표시를 내린다 — 올리는 사이에
    /// 또 고쳤으면 그 새 값은 아직 안 올라갔다. ⚠ 세션을 갈아 끼우기(`refreshUser`) **전에** 부른다 —
    /// 늦으면 새 세션을 받는 순간 방금 올린 값을 '안 올라간 변경' 으로 보고 한 번 더 올린다.
    static func markPushed(userID: String?, pushed: DynamicPromptSettings, defaults: UserDefaults = .standard) {
        guard let key = unsyncedDefaultsKey(userID: userID) else { return }
        if load(userID: userID).toSettings() == pushed {
            defaults.removeObject(forKey: key)
        }
    }

    /// 명시적 로그아웃·탈퇴에서 값과 함께 지운다(`clear(userID:)` 가 부른다). 남기면 다시 로그인했을 때
    /// 빈 기기 값이 서버를 이겨 계정 값을 받아 오지 못한다.
    static func clearUnsyncedMark(userID: String?, defaults: UserDefaults = .standard) {
        guard let key = unsyncedDefaultsKey(userID: userID) else { return }
        defaults.removeObject(forKey: key)
    }

    /// 서버의 계정 설정을 이 기기에 받아 적는다. **멱등이다** — 같은 값을 몇 번 받아도 결과가 같다.
    /// 규칙은 이 파일 머리 주석. `server == nil`(옛 서버·로그인 전)이면 아무것도 하지 않는다.
    ///
    /// - Parameter write: 기기 값을 적는 곳(테스트가 실패를 흉내 낸다). 기본은 키체인(`save(userID:)`).
    @discardableResult
    static func adoptAccount(
        userID: String?,
        server: DynamicPromptSettings?,
        defaults: UserDefaults = .standard,
        write: (DynamicPromptPreferences, String?) -> Bool = { $0.save(userID: $1) }
    ) -> AccountPromptSettingsAdoption {
        guard let server, let key = unsyncedDefaultsKey(userID: userID) else { return .accepted }
        let local = load(userID: userID)
        let remote = from(settings: server)
        if defaults.bool(forKey: key) {
            if local == remote {
                defaults.removeObject(forKey: key)
                return .accepted
            }
            return .localPending(local.toSettings())
        }
        var next = local
        let remoteHasWeather = !remote.weatherCountry.isEmpty || !remote.weatherCity.isEmpty
        if remoteHasWeather {
            next.weatherCountry = remote.weatherCountry
            next.weatherCity = remote.weatherCity
        }
        let remoteHasFortune = !remote.fortuneGender.isEmpty ||
            !remote.fortuneBirthDate.isEmpty ||
            !remote.fortuneBirthTime.isEmpty
        if remoteHasFortune {
            next.fortuneGender = remote.fortuneGender
            next.fortuneBirthDate = remote.fortuneBirthDate
            next.fortuneBirthTime = remote.fortuneBirthTime
        }
        // ⚠ 적지 못했으면 받아들였다고 말하지 않는다 — 기기 값은 옛것인데 공휴일 국가만 서버 지역을 따르면
        //   둘이 갈라진다(Codex #837).
        if next != local, !write(next, userID) {
            return .localWriteFailed
        }
        return .accepted
    }

    /// 화면이 읽는 값 — 계정 설정을 받아 적은 **뒤의** 이 기기 값(설정 화면·편집기).
    /// 안드로이드 설정 화면의 `adoptAccountSettings` → `read` 와 같은 순서다.
    static func current(userID: String?, server: DynamicPromptSettings?) -> DynamicPromptPreferences {
        adoptAccount(userID: userID, server: server)
        return load(userID: userID)
    }
}
