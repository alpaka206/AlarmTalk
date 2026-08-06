import SwiftUI

/// 목소리를 등록하거나 문구를 만들려는 **순간에** 받는 음성 처리 동의.
///
/// 가입 게이트에서 필수로 받지 않는 이유: 음성 생체정보(`voice_biometric`)와 국외 이전
/// (`overseas_transfer`)은 목소리를 등록하는 사람에게만 필요한 별도 동의다. 가입 필수로
/// 묶으면 목소리를 등록하지 않을 사용자에게까지 생체정보 처리 동의를 이용 조건으로 요구하게
/// 된다(개인정보보호법 제22조제5항). 서버도 같은 지점(`voice-profile`·`tts` 라우트)에서만
/// 강제한다 — 그 403 이 이 시트를 연다.
///
/// 앞의 두 체크는 **이용자 확인**(서버 동의 유형 없음), 뒤의 두 체크가 서버에 기록되는 동의다.
/// 문구는 `docs/legal/consent-and-permission-copy.ko.md` §2 를 따른다.
///
/// Android `VoiceConsentSheet.kt` 의 1:1 포팅.
struct VoiceConsentSheet: View {
    let busy: Bool
    let types: [String]
    /// 동의 직후 목소리 등록이 이어지는가.
    let registeringVoice: Bool
    let onAgree: () -> Void
    let onDismiss: () -> Void

    @State private var ownership = false
    @State private var liability = false
    @State private var biometric = false
    @State private var overseas = false

    private var asksBiometric: Bool { types.contains("voice_biometric") }
    private var asksOverseas: Bool { types.contains("overseas_transfer") }

    /// ⚠ **'목소리 등록' 문맥인지는 무엇을 묻는가가 아니라 동의 직후 무엇을 하는가로 정한다.**
    /// 생체정보 동의는 이미 유효하고 국외 이전만 빠진 상태에서도 등록은 그대로 이어진다 —
    /// 묻는 항목으로 문맥을 파생하면 그 자리에서 TTS 문구가 떠서, 사용자는 '문구 생성 동의'
    /// 인 줄 알고 눌렀는데 실제로는 녹음이 올라가고 클론이 만들어진다.
    /// 반대로 국외 이전만 받는 TTS 자리에서 등록 이야기를 꺼내면, 등록하지도 않는 사용자에게
    /// 등록 책임 확인을 받는 꼴이 된다.
    private var registrationContext: Bool { asksBiometric || registeringVoice }

    /// 소유·책임 확인은 등록 문맥이면 받는다. 동의 체크는 **그 동의를 실제로 요구할 때만** —
    /// 이미 유효한 동의를 다시 묻지 않는다.
    private var allChecked: Bool {
        (!registrationContext || (ownership && liability))
            && (!asksBiometric || biometric)
            && (!asksOverseas || overseas)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(registrationContext ? "목소리 등록에는 별도 동의가 필요해요" : "알람 문구를 만들려면 동의가 필요해요")
                .font(.headline)
                .foregroundStyle(AlarmTalkTheme.text)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(registrationContext ? Self.voiceBody : Self.ttsBody)
                        .font(.footnote)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    if registrationContext {
                        check($ownership, "본인 또는 권한과 동의를 받은 사람의 목소리만 등록합니다.")
                        check($liability, "무단 등록, 저작권·인격권 침해, 사칭으로 생기는 책임이 등록한 사람에게 있음을 확인합니다.")
                    }
                    if asksBiometric {
                        check($biometric, "내 목소리(생체정보)를 음성 프로필 생성·클론·TTS 생성에 사용하는 것에 동의합니다.")
                    }
                    if asksOverseas {
                        check($overseas, "음성 AI 처리를 위해 목소리와 문구가 국외(미국 등)로 이전·처리되는 것에 동의합니다.")
                    }
                }
            }
            .frame(maxHeight: 320)

            HStack {
                Spacer()
                Button("취소", action: onDismiss)
                    .disabled(busy)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                Button(action: onAgree) {
                    // 동의 뒤에 이어서 만들 등록 요청이 없으면 '목소리 만들기' 라고 하면
                    // 안 한 일을 했다고 말하는 셈이다. 반대로 등록이 이어지면 그렇게 말해야 한다.
                    Text(registrationContext ? "동의하고 목소리 만들기" : "동의하고 계속하기")
                        .fontWeight(.semibold)
                }
                .disabled(!allChecked || busy)
                .padding(.leading, 12)
            }
        }
        .padding(20)
        .background(AlarmTalkTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .padding(24)
    }

    private func check(_ binding: Binding<Bool>, _ label: String) -> some View {
        Button {
            binding.wrappedValue.toggle()
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: binding.wrappedValue ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(binding.wrappedValue ? AlarmTalkTheme.primary : AlarmTalkTheme.textSecondary)
                Text(label)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.text)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private static let voiceBody = """
        등록한 목소리는 음성 프로필 생성, 알람 문구 읽어주기, 알람 재생과 기기 캐싱에 쓰여요. \
        음성 클론과 읽어주기는 음성 AI 제공자 ElevenLabs를 통해 처리되고, 이 과정에서 목소리와 \
        문구가 국외로 전송돼요. 알람톡은 목소리를 공개 검색·광고·데이터 판매에 쓰지 않고, 자체 \
        범용 AI 모델 학습에도 쓰지 않아요. 음성 프로필은 언제든 삭제할 수 있어요.
        """

    private static let ttsBody = """
        알람 문구를 목소리로 만들 때, 문구와 목소리가 음성 AI 제공자(ElevenLabs)와 문구 생성\
        (Google, 미국)을 거쳐 처리돼요. 이 과정에서 데이터가 국외로 전송됩니다. 동의하지 않아도 \
        알람 자체는 쓸 수 있지만, 목소리로 읽어주는 알람은 만들 수 없어요.
        """
}

#if DEBUG
#Preview("목소리 등록 동의") {
    VoiceConsentSheet(
        busy: false, types: ["voice_biometric", "overseas_transfer"], registeringVoice: true,
        onAgree: {}, onDismiss: {}
    )
    .voiceAlarmPreviewEnvironment()
}

#Preview("TTS 국외이전만") {
    VoiceConsentSheet(
        busy: false, types: ["overseas_transfer"], registeringVoice: false,
        onAgree: {}, onDismiss: {}
    )
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}
#endif
