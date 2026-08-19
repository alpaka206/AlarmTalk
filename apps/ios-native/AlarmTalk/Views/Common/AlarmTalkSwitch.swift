import SwiftUI

/// 앱 공용 스위치. 안드로이드 `ui/components/ControlsAndPermissions.kt` 의
/// `AlarmTalkSwitch` 에 대응한다.
///
/// ⚠ **`Toggle` 을 맨몸으로 쓰지 말 것.** SwiftUI 기본 스위치는 iOS 기본 초록이라,
/// `.tint` 를 빠뜨린 화면만 앱 파란색이 아닌 초록으로 뜬다. 실제로 세 곳이 그랬고
/// (구성원 관리의 '상대 알람 허용', 목소리 등록의 '목소리 공유'·'잡음 제거'),
/// 같은 누락이 새 화면마다 반복될 자리였다 — 색을 호출부에 맡기는 대신 스타일에 넣는다.
///
/// ⚠ **`.tint` 만으로는 안드로이드와 같아지지 않는다.** `.tint` 는 켜짐 **트랙**만
/// 바꾸고 손잡이는 흰색 그대로다. 다크 팔레트의 `primary`(#A6D2FF)는 원래 어두운 배경
/// 위에 글자로 쓰라고 만든 **옅은 하늘색**이라, 그 위에 흰 손잡이를 얹으면 대비가
/// 거의 없어 스위치가 바래 보인다(2026-08-10 실기기 확인).
/// 안드로이드는 이 문제를 이미 손잡이 색을 따로 지정해 풀어 두었다:
///   - 켜짐 손잡이: 다크에서 `onPrimaryContainer`(밝은 하늘 #D9ECFF)
///     — `onPrimary` 는 진네이비라 트랙보다 어두워져 꺼짐으로 오독된다.
///   - 꺼짐 손잡이: 다크에서 `onSurfaceVariant`(밝은 회색)
///     — `surface` 는 트랙(`surfaceVariant`)과 동화돼 알맹이가 안 보인다.
/// 같은 규칙을 여기서도 쓴다.
struct AlarmTalkSwitchStyle: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .toggleStyle(
                AlarmTalkToggleStyle(
                    palette: theme.palette,
                    isDark: colorScheme == .dark
                )
            )
    }
}

/// 트랙·손잡이 색을 **둘 다** 우리가 정하는 스위치.
private struct AlarmTalkToggleStyle: ToggleStyle {
    let palette: AlarmTalkPalette
    let isDark: Bool

    private var trackColor: Color {
        // 안드로이드: checkedTrackColor = primary / uncheckedTrackColor = surfaceVariant
        palette.primary
    }

    // 손잡이는 **양쪽 상태 모두 흰색**이다(2026-08-10 결정).
    // iOS 시스템 스위치가 그렇고, 사용자가 그 모양을 유지하길 원했다 —
    // 안드로이드를 이쪽으로 맞춘다(`ControlsAndPermissions.kt` 의 `AlarmTalkSwitch`).
    private var thumbColor: Color { .white }

    func makeBody(configuration: Configuration) -> some View {
        HStack {
            configuration.label
            Spacer(minLength: 0)
            ZStack(alignment: configuration.isOn ? .trailing : .leading) {
                Capsule()
                    .fill(configuration.isOn ? trackColor : palette.surfaceVariant)
                    .overlay(
                        Capsule().stroke(
                            configuration.isOn ? Color.clear : palette.outline,
                            lineWidth: 1
                        )
                    )
                    .frame(width: 51, height: 31)
                Circle()
                    .fill(thumbColor)
                    .shadow(color: .black.opacity(0.15), radius: 1, y: 1)
                    // ⚠ **켜짐·꺼짐 크기가 같다.** iOS 시스템 스위치는 손잡이 지름이
                    // 상태와 무관하게 27 이다(누르고 있는 동안만 옆으로 늘어난다).
                    // 상태에 따라 20↔27 로 바꾸면 그건 Material 방식이라, 전환할 때마다
                    // 손잡이가 부풀었다 줄어드는 낯선 움직임이 된다.
                    .frame(width: 27, height: 27)
                    .padding(.horizontal, 2)
            }
            .frame(width: 51, height: 31)
            .contentShape(Rectangle())
            .onTapGesture {
                withAnimation(.easeInOut(duration: 0.18)) {
                    configuration.isOn.toggle()
                }
            }
            .accessibilityAddTraits(.isButton)
        }
    }
}

extension View {
    /// 앱 공용 스위치 색·스타일을 입힌다.
    func alarmTalkSwitch() -> some View {
        modifier(AlarmTalkSwitchStyle())
    }
}
