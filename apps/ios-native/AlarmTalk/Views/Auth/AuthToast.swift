import SwiftUI

/// 로그인·가입·비밀번호 찾기 화면의 안내(`AuthViewModel.statusMessage`)를 화면 **위쪽** 토스트로 띄운다(2026-11-15 오너 —
/// "인증 코드를 보냈어요" 가 폼 맨 아래 글줄이라 키보드 뒤에 숨었다). 몇 초 뒤 스스로 걷힌다. 안드로이드 짝은 위쪽 안내 자리
/// (`ui/app/AlarmTalkAppHelpers.kt` 의 `TopMessageHost` → `PrettySnackbar`) — 색도 그쪽과 같다(안내 tertiary · 오류 error).
///
/// - 오류(`statusIsError`)는 5초, 안내는 3초 뒤에 걷힌다.
/// - **누르는 것을 아래로 넘긴다** — 위쪽 뒤로가기 줄에 얹혀도 그 버튼은 그대로 눌린다.
/// - VoiceOver 에는 뜨는 순간 소리로 알린다.
/// - 입력칸 바로 아래의 오류(로그인 실패·인증 코드 거절)는 여기로 오지 않는다 — 고칠 칸 옆에 있어야 해서 지금 자리 그대로다.
struct AuthToastModifier: ViewModifier {
    let message: String?
    let isError: Bool
    let onExpire: () -> Void
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            ZStack {
                if let message {
                    toast(message)
                        // 새 안내는 새 토스트로 내려온다 — 같은 자리에서 글자만 바뀌면 바뀐 줄 모른다.
                        .id(message)
                        .transition(transition)
                        .task(id: message) {
                            AccessibilityNotification.Announcement(message).post()
                            try? await Task.sleep(for: .seconds(isError ? 5 : 3))
                            guard !Task.isCancelled else { return }
                            withAnimation(reduceMotion ? nil : .easeIn(duration: 0.18)) { onExpire() }
                        }
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.24), value: message)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .allowsHitTesting(false)
        }
    }

    private func toast(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: isError ? "exclamationmark.circle" : "checkmark.circle")
            // 이미 번역한 문장이다(`String(localized:)`) — `Text(String)` 은 받은 글자를 그대로 그린다.
            Text(text)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(theme.typography.bodyMedium)
        .foregroundStyle(isError ? theme.palette.onError : theme.palette.onTertiary)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(
            isError ? theme.palette.error : theme.palette.tertiary,
            in: RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
        )
        .floatingChromeShadow()
    }

    /// 위에서 살짝 내려오며 감속하고, 걷힐 때는 더 빠르다(CLAUDE.md 「동작(애니메이션) 원칙」). 동작 줄이기면 나타나기만 한다.
    private var transition: AnyTransition {
        let insertion: AnyTransition = reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity)
        return .asymmetric(insertion: insertion, removal: .opacity)
    }
}

extension View {
    /// [AuthToastModifier] — 인증 화면의 `statusMessage` 를 위쪽 토스트로.
    func authToast(message: String?, isError: Bool, onExpire: @escaping () -> Void) -> some View {
        modifier(AuthToastModifier(message: message, isError: isError, onExpire: onExpire))
    }
}
