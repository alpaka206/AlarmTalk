import SwiftUI

/// 목소리를 등록하거나 문구를 만들려는 **순간에** 받는 음성 처리 동의.
///
/// 가입 게이트에서 필수로 받지 않는 이유: 음성 생체정보(`voice_biometric`)와 국외 이전
/// (`overseas_transfer`)은 목소리를 등록하는 사람에게만 필요한 별도 동의다. 가입 필수로
/// 묶으면 목소리를 등록하지 않을 사용자에게까지 생체정보 처리 동의를 이용 조건으로 요구하게
/// 된다(개인정보보호법 제22조제5항). 서버도 같은 지점(`voice-profile`·`tts` 라우트)에서만
/// 강제한다 — 그 403 이 이 시트를 연다.
///
/// 목소리 권리 확인은 받지 않는다 — 약관 제7조(가입 필수 동의)의 권리 보증으로 갈음한다(2026-11-15 오너). 예전에는
/// '추가' 입구 모달이 등록마다 따로 물었다.
/// 문구는 `docs/legal/consent-and-permission-copy.ko.md` §2 를 따른다.
///
/// Android `VoiceConsentSheet.kt` 의 1:1 포팅.
struct VoiceConsentSheet: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let busy: Bool
    let types: [String]
    /// 동의 직후 목소리 등록이 이어지는가.
    let registeringVoice: Bool
    let onAgree: () -> Void
    let onDismiss: () -> Void
    /// 직전 동의 기록이 실패한 이유 — 버튼 줄 위에 빨간 글자로 그린다(`AuthViewModel.actionErrorMessage`).
    var errorMessage: String? = nil

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

    /// 이미 유효한 법정 동의는 다시 묻지 않는다.
    private var allChecked: Bool {
        (!asksBiometric || biometric) && (!asksOverseas || overseas)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // titleMedium · Bold — 안드로이드 `VoiceConsentSheet` 의 제목과 같다.
            Text(registrationContext ? String(localized: "목소리 등록에는 별도 동의가 필요해요") : String(localized: "알람 문구를 만들려면 동의가 필요해요"))
                .font(theme.typography.titleMedium)
                .fontWeight(.bold)
                .foregroundStyle(theme.palette.onSurface)

            // ⚠ **높이 상한을 박지 말 것**(2026-11-15). 예전에는 320 이었는데, 등록 자리에서 생체정보(부연 세 줄)와 다른
            // 항목을 함께 받으면 그 높이를 넘어 맨 아래 항목이 가려진 채 확인 버튼이 꺼져 있었다.
            // 화면에 들어가면 그대로 그리고, 넘칠 때만 스크롤한다. 안드로이드는 같은 자리에 `weight(1f, fill = false)` 를 쓴다.
            ViewThatFits(in: .vertical) {
                consentItems
                ScrollView { consentItems }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            // 두 글자 버튼이 오른쪽 끝에 맞닿아 있다(안드로이드 `TextButton` 둘 — 글자는 둘 다 강조색, '확인' 만 SemiBold).
            HStack(spacing: 0) {
                Spacer()
                textButton(String(localized: "취소"), enabled: !busy, action: onDismiss)
                // '확인' 하나다(2026-11-15 오너: "체크하면 동의니깐 확인으로 해도 되지않을까?"). 동의는 체크가 하고 이
                // 버튼은 그 체크를 낸다. 무엇이 이어지는지는 제목·본문이 말한다(`registrationContext`). 안드로이드와 같다.
                textButton(String(localized: "확인"), weight: .semibold, enabled: allChecked && !busy, action: onAgree)
            }
        }
        .padding(20)
        .background(theme.palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.extraLarge, style: .continuous))
        .padding(24)
    }

    /// 글자 버튼 — 안드로이드 M3 `TextButton` 과 같은 값(labelLarge · 강조색 · 높이 40 · 좌우 12, 잠기면 onSurface 38%).
    private func textButton(
        _ title: String,
        weight: Font.Weight? = nil,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(theme.typography.labelLarge)
                .fontWeight(weight)
                .foregroundStyle(enabled ? theme.palette.primary : theme.palette.onSurface.opacity(0.38))
                .padding(.horizontal, 12)
                .frame(minHeight: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    /// 본문과 체크 항목 — 화면에 들어가면 그대로, 넘치면 스크롤 안에 그린다(위 `ViewThatFits`).
    private var consentItems: some View {
        VStack(alignment: .leading, spacing: 12) {
            // 본문 12(bodySmall) — 안드로이드와 같다.
            Text(registrationContext ? Self.voiceBody : Self.ttsBody)
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onSurfaceVariant)
                .fixedSize(horizontal: false, vertical: true)

            if asksBiometric {
                // 목소리 등록 자리에서는 예전 이름 화면 체크칸의 문구(법무 문서 §2② — 라벨 + 부연 세 문단)를 그대로 쓴다.
                // 체크칸을 이 시트로 옮겼기 때문이다(2026-11-15). 판정은 안드로이드와 같은 `registrationContext` 다.
                if registrationContext {
                    check(
                        $biometric,
                        String(localized: "음성 생체정보 처리에 동의해요"),
                        // 쓰이는 곳과 '지우면 함께 삭제' 는 위 본문이 말한다 — 여기서 되풀이하지 않는다(2026-11-15 오너).
                        description: String(localized: "목소리는 개인을 식별·재현할 수 있는 생체정보로 처리돼요.\n본인 또는 적법한 권한과 동의를 받은 사람의 목소리만 등록할 수 있어요(이용약관 제7조).\n더보기에서 언제든 동의를 철회할 수 있어요.")
                    )
                } else {
                    check($biometric, String(localized: "내 목소리(생체정보)를 음성 프로필 생성·클론·TTS 생성에 사용하는 것에 동의합니다."))
                }
            }
            if asksOverseas {
                check($overseas, String(localized: "음성 AI 처리를 위해 목소리와 문구가 국외(미국 등)로 이전·처리되는 것에 동의합니다."))
            }
        }
    }

    private func check(_ binding: Binding<Bool>, _ label: String, description: String? = nil) -> some View {
        Button {
            binding.wrappedValue.toggle()
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: binding.wrappedValue ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(binding.wrappedValue ? theme.palette.primary : theme.palette.onSurfaceVariant)
                // 체크 문구·부연 모두 12(bodySmall) — 안드로이드 `VoiceConsentCheck` 와 같다.
                VStack(alignment: .leading, spacing: 4) {
                    Text(label)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurface)
                        .multilineTextAlignment(.leading)
                    if let description {
                        Text(description)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// 문장마다 한 줄이다(2026-11-15 오너). 안드로이드 `voice_consent_body` 와 같은 네 줄.
    private static var voiceBody: String { String(localized: """
        등록한 목소리는 음성 프로필 생성, 알람 문구 읽어주기, 알람 재생과 기기 캐싱에 쓰여요.
        음성 클론과 읽어주기는 음성 AI 제공자 ElevenLabs를 통해 처리되고, 이 과정에서 목소리와 \
        문구가 국외로 전송돼요.
        알람톡은 목소리를 공개 검색·광고·데이터 판매에 쓰지 않고, 자체 범용 AI 모델 학습에도 쓰지 않아요.
        음성 프로필은 언제든 삭제할 수 있고, 지우면 목소리도 함께 삭제돼요.
        """) }

    /// 안드로이드 `tts_consent_body` 와 같은 말 — 어미도 '전송돼요.' 로 맞춘다(예전 iOS 는 '전송됩니다.' 였다).
    private static var ttsBody: String { String(localized: """
        알람 문구를 목소리로 만들 때, 문구와 목소리가 음성 AI 제공자(ElevenLabs)와 문구 생성\
        (Google, 미국)을 거쳐 처리돼요. 이 과정에서 데이터가 국외로 전송돼요. 동의하지 않아도 \
        알람 자체는 쓸 수 있지만, 목소리로 읽어주는 알람은 만들 수 없어요.
        """) }
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
