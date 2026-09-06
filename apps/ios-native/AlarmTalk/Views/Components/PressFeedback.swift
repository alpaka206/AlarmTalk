import SwiftUI

/// **누르면 살짝 줄어든다.** 목록 행·설정 행처럼 누를 수 있는 자리에 공통으로 건다.
///
/// ⚠ **`.buttonStyle(.plain)` 만 두지 말 것**(2026-09-06). `.plain` 은 아무 반응도 주지
/// 않아서, 행을 눌러도 화면이 바뀌기 전까지는 눌렸는지 알 수 없다 — 느린 화면 전환에서
/// 사용자가 한 번 더 누른다. 안드로이드는 같은 자리를 `graphicsLayer` 축소로 알린다
/// (`ui/components/ControlsAndPermissions.kt` 의 `pressScale`) — 같은 값·같은 감각이다.
///
/// 색을 바꾸지 않고 **크기만** 건드리는 이유: 행마다 배경이 달라(카드 위/시트 안) 눌림
/// 색을 하나로 정할 수 없고, 어두운 배경에서는 색 변화가 거의 안 보인다.
struct PressScaleButtonStyle: ButtonStyle {
    /// 눌렀을 때의 배율. 행은 넓어서 0.98 로도 충분히 읽힌다(작은 버튼은 더 줄여야 보인다).
    var scale: CGFloat = 0.98

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.spring(response: 0.24, dampingFraction: 0.9), value: configuration.isPressed)
    }
}

extension View {
    /// 탭 제스처로 만든 자리(버튼이 아닌 곳)에 같은 축소를 건다.
    ///
    /// ⚠ 알람 행처럼 **스와이프 제스처가 이미 붙은** 자리에 쓴다. `Button` 으로 감싸면
    /// 스와이프와 싸우므로, 누름 상태만 `@GestureState` 로 따로 받아 여기에 넘긴다.
    func pressScale(_ pressed: Bool, scale: CGFloat = 0.98) -> some View {
        scaleEffect(pressed ? scale : 1)
            .animation(.spring(response: 0.24, dampingFraction: 0.9), value: pressed)
    }
}
