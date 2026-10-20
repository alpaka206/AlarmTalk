import Foundation
import Testing
@testable import AlarmTalk

@MainActor
struct VoiceLocalizationTests {
    @Test("관계 프리셋은 기기 언어로 보여 준다", arguments: ["en", "ja", "ko"])
    func relationshipPresetFollowsLanguage(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        #expect(VoiceRelationshipPreset.mom.localizedDisplayLabel(bundle: bundle)
                == (language == "en" ? "Mom" : language == "ja" ? "お母さん" : "엄마"))
    }

    @Test("편집기 목소리 선택의 내 목소리 보조 줄은 안드로이드와 같은 말이다", arguments: ["en", "ja", "ko"])
    func ownVoiceOptionDetailMatchesAndroid(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        // 안드로이드 `editor2_voice_detail_mine`.
        #expect(ownVoiceOptionDetail(bundle: bundle)
                == ["en": "My voice", "ja": "自分の声", "ko": "내 목소리"][language])
    }

    @Test("알람 행의 목소리 이름은 관계 라벨이 아니라 이름이다")
    func alarmRowUsesVoiceName() {
        var own = VoiceProfile(id: "own", name: "우리 엄마 목소리", status: "ready")
        own.relationshipLabel = "엄마"
        #expect(alarmRowVoiceName(voiceProfileID: "own", profiles: [own]) == "우리 엄마 목소리")
        #expect(alarmRowVoiceName(voiceProfileID: "missing", profiles: [own]) == nil)
    }

    @Test("새 목소리 이름은 비워 시작하고 빈 이름으로 등록하지 않는다")
    func emptyNameIsRequired() async {
        let vm = VoiceStudioViewModel()
        #expect(vm.cloneName.isEmpty)
        // 취소하거나 이전 등록을 마친 뒤 같은 앱 전역 모델로 다시 시작해도 비어야 한다.
        for previousName in ["지난 목소리", "다른 목소리"] {
            vm.cloneName = previousName
            vm.beginVoiceCreation()
            #expect(vm.cloneName.isEmpty)
        }
        let session = AuthSession(token: "unused-test-token", user: AuthUser(id: "voice-localization", email: "test@example.test"))
        #expect(await vm.uploadRecordingForClone(session: session) == nil)
        #expect(vm.statusMessage == String(localized: "목소리 이름을 입력해 주세요."))
    }

    /// 등록 확정 화면 문구(스펙 voice-and-message §4-1·§4-3) — 안드로이드 `VoiceRegistrationCopyTest` 가 지키는 값과 같다.
    /// 재시도 안내는 톤 카드의 듣기 버튼을, 높이 오류는 화면 이름 `톤` 을 말한다(문구 옆 재생 버튼·'목소리 높이' 는 없다).
    @Test("등록 확정 화면 문구는 안드로이드와 같은 번역이다", arguments: ["en", "ja"])
    func confirmStepCopy(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        let expected: [String: [String: String]] = [
            "톤 조절": ["en": "Tone", "ja": "トーン調整"],
            "원본 듣기": ["en": "Play original", "ja": "元の声を聞く"],
            "현재 톤 듣기": ["en": "Play current tone", "ja": "今のトーンで聞く"],
            "이전에 저장한 목소리는 삭제하고 이 목소리로 등록할게요.": [
                "en": "Your saved voice will be deleted and this voice will be registered instead.",
                "ja": "保存した声は削除して、この声で登録します。",
            ],
            "문구를 아직 준비하지 못했어요. 듣기 버튼을 눌러 다시 시도해 주세요.": [
                "en": "The line isn't ready yet. Tap a play button to try again.",
                "ja": "フレーズをまだ準備できていません。再生ボタンを押してもう一度お試しください。",
            ],
            "톤 값이 올바르지 않아요. 다시 맞춰 주세요.": [
                "en": "The tone value isn't valid. Please adjust it and try again.",
                "ja": "トーンの値が正しくありません。調整し直してください。",
            ],
            "톤은 목소리를 등록할 때만 정할 수 있어요.": [
                "en": "Tone can only be set when you register a voice.",
                "ja": "トーンは声を登録するときにだけ設定できます。",
            ],
        ]
        for (key, values) in expected {
            #expect(bundle.localizedString(forKey: key, value: nil, table: nil) == values[language], "\(language): \(key)")
        }
    }

    /// 말소리가 거의 없는 등록 녹음의 거절(`VOICE_CLONE_NO_SPEECH` — 스펙 voice-and-message §4-1). 안드로이드 문자열과
    /// 같은 세 언어의 문장이다 — 카탈로그에서 빠지면 영어·일본어 기기에 한국어가 그대로 뜬다.
    @Test("말소리가 없는 녹음의 거절 문장은 영어와 일본어로 조회된다", arguments: ["en", "ja"])
    func noSpeechRejectionCopy(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        let key = "녹음에서 말소리를 거의 찾지 못했어요. 조용한 곳에서 문장을 또렷하게 읽으며 다시 녹음해 주세요."
        let expected = [
            "en": "We couldn't find much speech in the recording. Please record again in a quiet place, reading the sentences clearly.",
            "ja": "録音から話し声がほとんど見つかりませんでした。静かな場所で、文をはっきり読みながらもう一度録音してください。",
        ]
        #expect(bundle.localizedString(forKey: key, value: nil, table: nil) == expected[language])
    }

    @Test("준비 상태·등록·오디오 오류는 영어와 일본어로 조회된다", arguments: ["en", "ja"])
    func translatedVoiceFlow(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        for key in [
            "준비 중이에요", "준비됐어요", "다시 시도하기",
            "이제 오프라인에서도 목소리로 울려요.", "목소리를 만들다 실패했어요. 다시 시도해 주세요.",
            "목소리를 만들고 있어요. 몇 분 걸릴 수 있어요.", "목소리를 받고 있어요. 앱을 닫아도 계속 받아요.",
            "녹음하려면 마이크 권한이 필요해요.", "예시 대본", "알람을 읽어줄 언어",
            "선택한 파일에서 오디오를 찾지 못했어요. 다른 파일로 시도해 주세요.",
        ] {
            let value = bundle.localizedString(forKey: key, value: nil, table: nil)
            #expect(value != key, "\(language): \(key)")
        }
        #expect(bundle.localizedString(forKey: "voice.section.default", value: nil, table: nil)
                == (language == "en" ? "Default voices" : "基本の声"))
        #expect(bundle.localizedString(forKey: "voice.register.submit", value: nil, table: nil)
                == (language == "en" ? "Register" : "登録"))
        #expect(VoiceRelationshipPreset.grandson.localizedDisplayLabel(bundle: bundle)
                == (language == "en" ? "Grandchild" : "孫"))
        let quota = bundle.localizedString(forKey: "생성 가능 %lld/%lld회", value: nil, table: nil)
        #expect(String(format: quota, 1, 2).contains("1/2"))
    }
}
