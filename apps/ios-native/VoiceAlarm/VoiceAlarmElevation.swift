import SwiftUI

/// Elevation / shadow tokens that approximate the Compose elevation steps used
/// by `VocaWakeDesign` cards and buttons on Android. SwiftUI does not expose
/// the same Material elevation model, so each step is expressed as the
/// `.shadow` parameters required to visually match the Android renderer.
struct VoiceAlarmElevationStep: Equatable {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat
}

struct VoiceAlarmElevation: Equatable {
    let none: VoiceAlarmElevationStep
    let sm: VoiceAlarmElevationStep
    let md: VoiceAlarmElevationStep
    let lg: VoiceAlarmElevationStep
}

extension VoiceAlarmElevation {
    static let `default`: VoiceAlarmElevation = {
        let shadowColor = Color.black.opacity(0.08)
        return VoiceAlarmElevation(
            none: VoiceAlarmElevationStep(color: .clear, radius: 0, x: 0, y: 0),
            sm: VoiceAlarmElevationStep(color: shadowColor, radius: 4, x: 0, y: 1),
            md: VoiceAlarmElevationStep(color: shadowColor, radius: 12, x: 0, y: 4),
            lg: VoiceAlarmElevationStep(color: shadowColor, radius: 24, x: 0, y: 8)
        )
    }()
}

extension View {
    /// Applies an elevation step as a SwiftUI shadow.
    func vocaElevation(_ step: VoiceAlarmElevationStep) -> some View {
        shadow(color: step.color, radius: step.radius, x: step.x, y: step.y)
    }
}
