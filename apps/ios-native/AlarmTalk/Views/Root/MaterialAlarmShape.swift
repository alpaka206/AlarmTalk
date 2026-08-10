import SwiftUI

/// 하단 탭의 **알람 아이콘** — 안드로이드 Material `Icons.Outlined.Alarm` 과 같은 도형이다.
///
/// ⚠ **SF Symbol `alarm` 으로 되돌리지 말 것.** 두 아이콘은 실제로 다르다 — SF 는 둥근 종에
/// 바닥 다리가 있고 바늘이 9시 방향, Material 은 각진 종에 다리가 없고 바늘이 4~5시 방향이다.
/// 목소리·더보기 탭은 아이폰(SF) 모양으로 통일했지만, **알람만 안드로이드 모양**으로 맞추는
/// 것이 사용자 결정이다(2026-08-10).
///
/// 좌표는 Material 아이콘의 24×24 path 를 **바이트코드에서 그대로 추출**한 값이다(추측 아님).
/// Material Icons 는 Apache-2.0 이라 두 앱에 같은 도형을 실을 수 있다 — SF Symbol 을 안드로이드로
/// 옮길 수 없었던 것과 반대 방향이다.
///
/// 안드로이드 대응: `ui/app/AlarmTalkBottomBar.kt` 의 알람 탭(`Icons.Outlined/Filled.Alarm`).
/// ⚠ Material 은 Outlined 와 Filled 의 path 가 사실상 같다 — 그래서 선택 상태는 **색으로만**
/// 구분한다(안드로이드도 마찬가지). 채운 변형을 따로 만들지 말 것.
struct MaterialAlarmShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let k = min(rect.width, rect.height) / 24
        func s(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * k, y: rect.minY + y * k)
        }
        p.move(to: s(12.5, 8.0))
        p.addLine(to: s(11.0, 8.0))
        p.addLine(to: s(11.0, 14.0))
        p.addLine(to: s(15.75, 16.85))
        p.addLine(to: s(16.5, 15.62))
        p.addLine(to: s(12.5, 13.25))
        p.closeSubpath()
        p.move(to: s(17.337, 1.81))
        p.addLine(to: s(21.944, 5.655))
        p.addLine(to: s(20.664, 7.19))
        p.addLine(to: s(16.054, 3.347))
        p.closeSubpath()
        p.move(to: s(6.663, 1.81))
        p.addLine(to: s(7.945, 3.346))
        p.addLine(to: s(3.337, 7.19))
        p.addLine(to: s(2.057, 5.654))
        p.closeSubpath()
        p.move(to: s(12.0, 4.0))
        p.addCurve(to: s(3.0, 13.0), control1: s(7.03, 4.0), control2: s(3.0, 8.03))
        p.addCurve(to: s(12.0, 22.0), control1: s(3.0, 17.97), control2: s(7.03, 22.0))
        p.addCurve(to: s(21.0, 13.0), control1: s(16.97, 22.0), control2: s(21.0, 17.97))
        p.addCurve(to: s(12.0, 4.0), control1: s(21.0, 8.03), control2: s(16.97, 4.0))
        p.closeSubpath()
        p.move(to: s(12.0, 20.0))
        p.addCurve(to: s(5.0, 13.0), control1: s(8.14, 20.0), control2: s(5.0, 16.86))
        p.addCurve(to: s(12.0, 6.0), control1: s(5.0, 9.14), control2: s(8.14, 6.0))
        p.addCurve(to: s(19.0, 13.0), control1: s(15.86, 6.0), control2: s(19.0, 9.14))
        p.addCurve(to: s(12.0, 20.0), control1: s(19.0, 16.86), control2: s(15.86, 20.0))
        p.closeSubpath()
        return p
    }
}
