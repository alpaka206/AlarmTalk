import SwiftUI

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

