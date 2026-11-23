import SwiftUI

/// 위쪽 토스트의 종류 — 색과 아이콘을 고른다. 안드로이드 `MessageSeverity`(`ui/app/AlarmTalkAppHelpers.kt`)와 같은 세 갈래다.
///
/// - `success`: 사용자가 한 일이 끝났다(발송·적용·해지·철회). tertiary 바탕 + 체크.
/// - `error`: 하려던 일이 실패했거나 거절됐다. error 바탕 + 느낌표.
/// - `info`: 그 밖 — 진행 중("구매를 확인하고 있어요…")·결과 없음·보류. secondaryContainer 바탕 + i.
enum AuthToastStyle: Equatable {
    case success
    case error
    case info
}

/// 화면 **위쪽** 토스트 — 로그인·가입·비밀번호 찾기의 안내(`AuthViewModel.statusMessage`)로 시작했고(2026-11-15 오너 —
/// "인증 코드를 보냈어요" 가 폼 맨 아래 글줄이라 키보드 뒤에 숨었다), 로그인한 뒤의 결과 안내(이용권 결제·복원·해지, 동의 철회)도
/// 같은 자리·같은 모양을 쓴다. 몇 초 뒤 스스로 걷힌다. 안드로이드 짝은 위쪽 안내 자리
/// (`ui/app/AlarmTalkAppHelpers.kt` 의 `TopMessageHost` → `PrettySnackbar`) — 색·아이콘 22·간격 12·글자 굵기도 그쪽과 같다.
///
/// - 오류는 5초, 안내·성공은 3초 뒤에 걷힌다.
/// - **누르는 것을 아래로 넘긴다** — 위쪽 뒤로가기 줄에 얹혀도 그 버튼은 그대로 눌린다.
/// - VoiceOver 에는 뜨는 순간 소리로 알린다.
/// - 입력칸 바로 아래의 오류(로그인 실패·인증 코드 거절)는 여기로 오지 않는다 — 고칠 칸 옆에 있어야 해서 지금 자리 그대로다.
struct AuthToastModifier: ViewModifier {
    let message: String?
    let style: AuthToastStyle
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
                            try? await Task.sleep(for: .seconds(style == .error ? 5 : 3))
                            guard !Task.isCancelled else { return }
                            withAnimation(reduceMotion ? nil : .easeIn(duration: 0.18)) { onExpire() }
                        }
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.24), value: message)
            .padding(.horizontal, 16)
            // 상단 안전 영역 아래 16 — 안드로이드 `PrettySnackbar` 자리와 같다(2026-11-22, 그전 8).
            .padding(.top, 16)
            .allowsHitTesting(false)
        }
    }

    private func toast(_ text: String) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: iconName)
                .font(.system(size: 18, weight: .regular))
                .frame(width: 22, height: 22)
                .accessibilityHidden(true)
            // 이미 번역한 문장이다(`String(localized:)`) — `Text(String)` 은 받은 글자를 그대로 그린다.
            Text(text)
                .fontWeight(.medium)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(theme.typography.bodyMedium)
        .foregroundStyle(contentColor)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(
            containerColor,
            in: RoundedRectangle(cornerRadius: theme.shapes.medium, style: .continuous)
        )
        .floatingChromeShadow()
    }

    private var iconName: String {
        switch style {
        case .success: return "checkmark.circle"
        case .error: return "exclamationmark.circle"
        case .info: return "info.circle"
        }
    }

    private var containerColor: Color {
        switch style {
        case .success: return theme.palette.tertiary
        case .error: return theme.palette.error
        case .info: return theme.palette.secondaryContainer
        }
    }

    private var contentColor: Color {
        switch style {
        case .success: return theme.palette.onTertiary
        case .error: return theme.palette.onError
        case .info: return theme.palette.onSecondaryContainer
        }
    }

    /// 위에서 살짝 내려오며 감속하고, 걷힐 때는 더 빠르다(CLAUDE.md 「동작(애니메이션) 원칙」). 동작 줄이기면 나타나기만 한다.
    private var transition: AnyTransition {
        let insertion: AnyTransition = reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity)
        return .asymmetric(insertion: insertion, removal: .opacity)
    }
}

extension View {
    /// [AuthToastModifier] — 인증 화면의 `statusMessage` 를 위쪽 토스트로. 오류가 아니면 성공 모양이다(예전 그대로).
    func authToast(message: String?, isError: Bool, onExpire: @escaping () -> Void) -> some View {
        authToast(message: message, style: isError ? .error : .success, onExpire: onExpire)
    }

    /// [AuthToastModifier] — 종류(성공·오류·안내)를 직접 고른다.
    func authToast(message: String?, style: AuthToastStyle, onExpire: @escaping () -> Void) -> some View {
        modifier(AuthToastModifier(message: message, style: style, onExpire: onExpire))
    }
}
