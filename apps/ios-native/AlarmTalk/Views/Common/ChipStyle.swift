import SwiftUI

/// 하위 전체화면의 공용 뒤로가기 — 화살표 하나다(2026-11-15 오너: "동그라미 빼고"). Android `WakerBackButton` 과 같은 자리를
/// 쓰되 글리프는 플랫폼 규약대로 SF Symbol 이다. 누르는 범위(44)는 그대로다 — 원이 없어졌다고 줄이지 말 것.
/// (시스템 내비게이션 바의 뒤로가기는 이 부품이 아니다 — iOS 26 이 그리는 그대로 둔다.)
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
                .contentShape(Rectangle())
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
    /// 고정 팔레트 화면(로그인·가입)의 글자·뒤로가기 색. 없으면 테마의 `onSurface`.
    var tint: Color? = nil

    var body: some View {
        ZStack {
            Text(title)
                .font(theme.typography.titleMedium)
                .fontWeight(.semibold)
                .foregroundStyle(tint ?? theme.palette.onSurface)
                .lineLimit(1)
            if let onBack {
                WakerBackButton(enabled: backEnabled, tint: tint, action: onBack)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(minHeight: 44)
        .padding(.horizontal, 20)
        // 상단바 아래 간격은 앱 전체 24 다(2026-11-15 오너: "상단 간격을 전체로 늘려서 공통으로 같도록") — 안드로이드
        // `WakerTopBarBottomGap` 과 같다. 화면마다 본문 위에 여백을 따로 더하지 말 것.
        .padding(.bottom, 24)
    }
}

