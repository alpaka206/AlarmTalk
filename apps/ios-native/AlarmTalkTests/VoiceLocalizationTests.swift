import Foundation
import Testing
@testable import AlarmTalk

@MainActor
struct VoiceLocalizationTests {
    @Test("새 목소리 이름은 비워 시작하고 빈 이름으로 등록하지 않는다")
    func emptyNameIsRequired() async {
        let vm = VoiceStudioViewModel()
        #expect(vm.cloneName.isEmpty)
        let session = AuthSession(token: "unused-test-token", user: AuthUser(id: "voice-localization", email: "test@example.test"))
        #expect(await vm.uploadRecordingForClone(session: session) == nil)
        #expect(vm.statusMessage == String(localized: "목소리 이름을 입력해 주세요."))
    }

    @Test("준비 상태·등록·오디오 오류는 영어와 일본어로 조회된다", arguments: ["en", "ja"])
    func translatedVoiceFlow(language: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        for key in [
            "준비 중이에요", "준비됐어요", "다시 시도하기",
            "보낸 사람 쪽에서 이 목소리를 만들고 있어요. 다 되면 알람에서 고를 수 있어요.",
            "이제 오프라인에서도 목소리로 울려요.", "목소리를 만들다 실패했어요. 다시 시도해 주세요.",
            "목소리를 만들고 있어요. 몇 분 걸릴 수 있어요.", "목소리를 받고 있어요. 앱을 닫아도 계속 받아요.",
            "녹음하려면 마이크 권한이 필요해요.", "예시 대본", "알람을 읽어줄 언어", "공유 설정",
            "선택한 파일에서 오디오를 찾지 못했어요. 다른 파일로 시도해 주세요.",
        ] {
            let value = bundle.localizedString(forKey: key, value: nil, table: nil)
            #expect(value != key, "\(language): \(key)")
        }
        #expect(bundle.localizedString(forKey: "voice.section.default", value: nil, table: nil)
                == (language == "en" ? "Default voices" : "基本の声"))
        let quota = bundle.localizedString(forKey: "생성 가능 %lld/%lld회", value: nil, table: nil)
        #expect(String(format: quota, 1, 2).contains("1/2"))
    }
}
