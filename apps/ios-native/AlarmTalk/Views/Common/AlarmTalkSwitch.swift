import SwiftUI

/// 앱 공용 스위치. 안드로이드 `ui/components/ControlsAndPermissions.kt` 의
/// `AlarmTalkSwitch` 에 대응한다.
///
/// ⚠ **`Toggle` 을 맨몸으로 쓰지 말 것.** SwiftUI 기본 스위치는 iOS 기본 초록이라,
/// `.tint` 를 빠뜨린 화면만 앱 파란색이 아닌 초록으로 뜬다. 실제로 세 곳이 그랬고,
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
    var muted = false

    func body(content: Content) -> some View {
        content
            .toggleStyle(
                AlarmTalkToggleStyle(
                    palette: theme.palette,
                    isDark: colorScheme == .dark,
                    muted: muted
                )
            )
    }
}

/// 트랙·손잡이 색을 **둘 다** 우리가 정하는 스위치.
///
/// 모양은 안드로이드 M3 `Switch`(`AlarmTalkSwitch`)와 같다(2026-11-22 두 앱 통일) — 트랙 52×32, 손잡이 **꺼짐 16 / 켜짐 24**,
/// 꺼짐 트랙은 `surfaceVariant` 에 `outline` 2 테두리, 켜짐 트랙은 테두리 없이 `primary`, 손잡이는 둘 다 흰색이고 그림자가 없다.
/// 그전 iOS 는 시스템 스위치 크기(51×31 · 손잡이 27 고정 · 그림자)였다.
private struct AlarmTalkToggleStyle: ToggleStyle {
    let palette: AlarmTalkPalette
    let isDark: Bool
    /// 회색으로 그린다 — 켜져 있어도 강조색을 쓰지 않는다(권한이 없어 울리지 않는 알람의 스위치, 2026-11-09 오너).
    var muted = false

    private var trackColor: Color {
        // 안드로이드: checkedTrackColor = primary / uncheckedTrackColor = surfaceVariant
        muted ? palette.outline : palette.primary
    }

    // 손잡이는 **양쪽 상태 모두 흰색**이다(2026-08-10 결정).
    // iOS 시스템 스위치가 그렇고, 사용자가 그 모양을 유지하길 원했다 —
    // 안드로이드를 이쪽으로 맞춘다(`ControlsAndPermissions.kt` 의 `AlarmTalkSwitch`).
    private var thumbColor: Color { .white }

    /// 트랙 크기 — M3 `SwitchDefaults` 의 52×32.
    private static let trackWidth: CGFloat = 52
    private static let trackHeight: CGFloat = 32
    /// 손잡이 지름 — 꺼짐 16 · 켜짐 24(M3). 손잡이 중심은 언제나 트랙 끝에서 16 안쪽이다.
    private static let thumbOff: CGFloat = 16
    private static let thumbOn: CGFloat = 24

    func makeBody(configuration: Configuration) -> some View {
        let thumb = configuration.isOn ? Self.thumbOn : Self.thumbOff
        return HStack {
            configuration.label
            Spacer(minLength: 0)
            ZStack(alignment: configuration.isOn ? .trailing : .leading) {
                Capsule()
                    .fill(configuration.isOn ? trackColor : palette.surfaceVariant)
                    // 꺼짐만 테두리 — 트랙 **안쪽**으로 2(M3 꺼짐 트랙의 `outline` 2 테두리).
                    .overlay(
                        Capsule().strokeBorder(
                            configuration.isOn ? Color.clear : palette.outline,
                            lineWidth: 2
                        )
                    )
                    .frame(width: Self.trackWidth, height: Self.trackHeight)
                // ⚠ **켜짐·꺼짐 크기가 다르다**(2026-11-22 — 안드로이드 M3 와 같게). 2026-08-10 에는 iOS 시스템 스위치처럼
                //   27 고정이었고 "부풀었다 줄어드는 움직임이 낯설다" 고 적었지만, 두 앱의 스위치를 같은 물건으로 맞추기로 했다.
                Circle()
                    .fill(thumbColor)
                    .frame(width: thumb, height: thumb)
                    // 중심을 트랙 끝에서 16 안쪽에 둔다 — 꺼짐은 끝에서 8, 켜짐은 4 떨어진다.
                    .padding(.horizontal, (Self.trackHeight - thumb) / 2)
            }
            .frame(width: Self.trackWidth, height: Self.trackHeight)
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
    /// 앱 공용 스위치 색·스타일을 입힌다. `muted` 면 켜짐·꺼짐과 상관없이 회색이다(`AlarmRow.switchMuted`).
    func alarmTalkSwitch(muted: Bool = false) -> some View {
        modifier(AlarmTalkSwitchStyle(muted: muted))
    }
}

/// 단계가 있는 막대(목소리 크기·목소리 높이) — 트랙 4 · 흰 손잡이 20(옅은 그림자) · 손잡이 반지름만큼 들여 그린다. 안드로이드
/// `ui/components/WakerVolumeSlider.kt` 의 `WakerStepSlider` 와 같은 모양이다. `origin` 이 없으면 왼쪽 끝부터 채우고(음량), 있으면
/// 그 값부터 손잡이까지만 채우고 그 자리에 눈금을 둔다(목소리 높이의 '원래', 시안 A 2026-11-15).
///
/// ⚠ **시스템 `Slider` 로 되돌리지 말 것.** iOS 26 의 손잡이는 넓적한 흰 알약이라 100% 에서 막대 오른쪽 끝에 얼룩처럼 붙고
/// (2026-11-22 오너 "로딩바 오른쪽 끝에 살짝 뭐가 있는 건 어쩔 수 없는 거야?"), 안드로이드의 동그라미와 다른 물건이 된다.
/// 시스템 슬라이더는 손잡이 모양을 바꿀 수 없어 직접 그린다 — 원래 '톤 조절' 화면 전용이던 막대를 꺼내 '목소리 크기' 에도 쓴다.
///
/// 손을 떼거나(끌기 끝) 읽어 주기로 한 칸 옮기면 `onEditingEnded` 를 부른다 — 부르는 쪽이 그 값으로 들려준다.
struct WakerStepSlider: View {
    static let thumbSize: CGFloat = 20

    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    /// 채움을 시작할 값. nil 이면 왼쪽 끝부터.
    var origin: Double? = nil
    let accessibilityLabel: String
    let accessibilityValue: String
    var onEditingEnded: () -> Void = {}

    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        GeometryReader { geo in
            let inset = Self.thumbSize / 2
            let track = max(geo.size.width - Self.thumbSize, 1)
            let valueX = inset + track * fraction(value)
            let originX = inset + track * fraction(origin ?? range.lowerBound)
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(theme.palette.surfaceVariant)
                    .frame(width: track, height: 4)
                    .offset(x: inset)
                Capsule()
                    .fill(theme.palette.primary)
                    .frame(width: abs(valueX - originX), height: 4)
                    .offset(x: min(valueX, originX))
                if origin != nil {
                    Capsule()
                        .fill(theme.palette.onSurfaceVariant)
                        .frame(width: 2, height: 12)
                        .offset(x: originX - 1)
                }
                Circle()
                    .fill(Color.white)
                    .frame(width: Self.thumbSize, height: Self.thumbSize)
                    .shadow(color: .black.opacity(0.35), radius: 1.5, y: 1)
                    .offset(x: valueX - inset)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        guard isEnabled else { return }
                        let raw = range.lowerBound + Double((drag.location.x - inset) / track) * (range.upperBound - range.lowerBound)
                        let next = snapped(raw)
                        if next != value { value = next }
                    }
                    .onEnded { _ in
                        guard isEnabled else { return }
                        onEditingEnded()
                    }
            )
        }
        .frame(height: 44)
        .opacity(isEnabled ? 1 : 0.38)
        .accessibilityElement()
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(accessibilityValue)
        .accessibilityAdjustableAction { direction in
            guard isEnabled else { return }
            switch direction {
            case .increment: value = snapped(value + step)
            case .decrement: value = snapped(value - step)
            @unknown default: return
            }
            onEditingEnded()
        }
    }

    private func fraction(_ v: Double) -> CGFloat {
        CGFloat((v - range.lowerBound) / (range.upperBound - range.lowerBound))
    }

    private func snapped(_ raw: Double) -> Double {
        let clamped = min(max(raw, range.lowerBound), range.upperBound)
        return range.lowerBound + ((clamped - range.lowerBound) / step).rounded() * step
    }
}
