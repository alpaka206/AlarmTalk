import SwiftUI

/// Elevation / shadow tokens that approximate the Compose elevation steps used
/// by `WakerDesign` cards and buttons on Android. SwiftUI does not expose
/// the same Material elevation model, so each step is expressed as the
/// `.shadow` parameters required to visually match the Android renderer.
struct AlarmTalkElevationStep: Equatable {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat
}

struct AlarmTalkElevation: Equatable {
    let none: AlarmTalkElevationStep
    let sm: AlarmTalkElevationStep
    let md: AlarmTalkElevationStep
    let lg: AlarmTalkElevationStep
}

extension AlarmTalkElevation {
    static let `default`: AlarmTalkElevation = {
        let shadowColor = Color.black.opacity(0.08)
        return AlarmTalkElevation(
            none: AlarmTalkElevationStep(color: .clear, radius: 0, x: 0, y: 0),
            sm: AlarmTalkElevationStep(color: shadowColor, radius: 4, x: 0, y: 1),
            md: AlarmTalkElevationStep(color: shadowColor, radius: 12, x: 0, y: 4),
            lg: AlarmTalkElevationStep(color: shadowColor, radius: 24, x: 0, y: 8)
        )
    }()
}

extension View {
    /// Applies an elevation step as a SwiftUI shadow.
    func vocaElevation(_ step: AlarmTalkElevationStep) -> some View {
        shadow(color: step.color, radius: step.radius, x: step.x, y: step.y)
    }
}
