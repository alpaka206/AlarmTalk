import SwiftUI

/// 권한 상태/역할/만료일 등을 표시하는 capsule pill.
///
/// ContentView 의 `permissionPill(_:)` 헬퍼를 옮긴 것. 알람 권한 라벨,
/// 가족 그룹 역할, 구독 만료일 등 다양한 컨텍스트에서 동일 스타일을 쓴다.
struct PermissionPill: View {
    // ⚠ **`LocalizedStringKey` 로 바꾸지 말 것.** 실제 호출부(`PeoplePanel`)가 넘기는 값은
    // 서버가 준 역할 문자열을 그대로 흘릴 수 있어서(알 수 없는 role 은 원문 표시),
    // 키로 받으면 서버 값을 카탈로그에서 조회하게 된다. 번역은 넘기는 쪽 책임이다.
    let text: String

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(AlarmTalkTheme.text)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(AlarmTalkTheme.surfaceVariant, in: Capsule())
    }
}

/// 화면 상단 큰 제목 + 부제목 묶음.
///
/// ContentView 의 `screenHeader(title:subtitle:)` 를 옮긴 것.
/// 음성/알람/메시지 등 일반 탭과 보조 시트 모두에서 동일 스타일을 쓴다.
struct ScreenHeader: View {
    let title: LocalizedStringKey
    var subtitle: LocalizedStringKey? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(AlarmTalkTheme.text)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 하위 전체화면의 공용 원형 뒤로가기. Android `WakerBackButton`과 같은 자리·표면을 쓰되
/// 글리프는 플랫폼 규약대로 SF Symbol을 쓴다.
struct WakerBackButton: View {
    @Environment(\.voiceAlarmTheme) private var theme

    var enabled = true
    var tint: Color? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "chevron.backward")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(tint ?? theme.palette.onSurface)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Color.white.opacity(0x1F / 255.0)))
                .overlay(
                    Circle().stroke(Color.hex(0xA6D2FF).opacity(0x5C / 255.0), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.38)
        .accessibilityLabel("뒤로")
    }
}

/// 좌측 공용 뒤로가기 + 가운데 17pt 제목. 뒤로갈 수 없는 진행 단계는 `onBack=nil`로
/// 제목만 남긴다. Android `WakerTopBar`와 같은 골격이다.
struct WakerTopBar: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let title: LocalizedStringKey
    var onBack: (() -> Void)?
    var backEnabled = true

    var body: some View {
        ZStack {
            Text(title)
                .font(theme.typography.titleMedium)
                .fontWeight(.semibold)
                .foregroundStyle(theme.palette.onSurface)
                .lineLimit(1)
            if let onBack {
                WakerBackButton(enabled: backEnabled, action: onBack)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(minHeight: 44)
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
    }
}

#if DEBUG
#Preview("Chips") {
    VStack(alignment: .leading, spacing: 16) {
        ScreenHeader(title: "알람", subtitle: "현재 활성 알람 3개")
        HStack {
            PermissionPill(text: "허용됨")
            PermissionPill(text: "만료 2026-06-01")
            PermissionPill(text: "owner")
        }
    }
    .padding()
}

#Preview("Chips (dark)") {
    VStack(alignment: .leading, spacing: 16) {
        ScreenHeader(title: "메시지")
        PermissionPill(text: "허용됨")
    }
    .padding()
    .preferredColorScheme(.dark)
}
#endif
