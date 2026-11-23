import SwiftUI

/// 서버 status 문자열 정규화. 여러 뷰(행·목록·편집)가 같은 판정을 써야 해서 파일 스코프에 둔다.
func normalizedStatus(_ raw: String?) -> String {
    let status = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return status.isEmpty ? "ready" : status
}

// VoiceProfileManagementPanel 에서 분리한 하위 컴포넌트.
// 동작/디자인 변경 없음 — internal 가시성만 조정.

// MARK: - Audio crop range slider

/// 파일/영상에서 학습에 쓸 구간을 양쪽 핸들로 직접 고르는 두-엄지(dual-thumb) 슬라이더.
///
/// Android `VoiceInputControls.AudioCropRangeSelector`(RangeSlider) 의 iOS 대응.
/// SwiftUI 에는 RangeSlider 가 없어 GeometryReader + DragGesture 로 구현하고,
/// 선택 구간 길이를 항상 `minDurationMs ≤ (end-start) ≤ maxDurationMs` 로 클램프한다
/// (Android 의 클램핑 로직과 동일: 한 핸들을 움직여 구간이 max 를 넘으면 반대편을 밀고,
/// min 보다 짧아지면 반대편을 당긴다).
struct AudioCropRangeSlider: View {
    let durationMs: Int
    let minDurationMs: Int
    let maxDurationMs: Int
    @Binding var cropStartMs: Int
    @Binding var cropEndMs: Int

    private let coordinateSpaceName = "audioCropRangeTrack"
    /// 손잡이 지름 — 손잡이 위 시각 글자(`AudioCropThumbLabels`)가 같은 자리를 셈하려고 연다.
    static let thumbSize: CGFloat = 26
    private var thumbSize: CGFloat { Self.thumbSize }
    private let trackHeight: CGFloat = 6
    private let controlHeight: CGFloat = 44

    /// 폭 `width` 인 막대에서 `ms` 자리의 손잡이 가운데 x. 손잡이 반지름만큼 들여 그린다.
    static func thumbCenterX(ms: Int, durationMs: Int, width: CGFloat) -> CGFloat {
        let usable = max(1, width - thumbSize)
        let span = CGFloat(max(1, durationMs))
        let safe = CGFloat(min(max(ms, 0), max(durationMs, 0)))
        return thumbSize / 2 + usable * safe / span
    }

    /// ⚠ **짧은 파일(12초 미만)도 그린다** — 안드로이드처럼 파일을 고르면 언제나 자르기 막대가 나온다(못 넘어가는 이유는
    /// 하단 버튼이 말한다). 그때 구간 하한·상한을 파일 길이로 줄인다(안드로이드 `constrainedAudioCropRange` 와 같다) —
    /// 줄이지 않으면 끝 손잡이가 파일 끝 너머(12초)로 밀린다.
    private var effectiveMinDurationMs: Int { min(max(minDurationMs, 0), max(durationMs, 0)) }
    private var effectiveMaxDurationMs: Int { min(max(maxDurationMs, effectiveMinDurationMs), max(durationMs, 0)) }

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let usable = max(1, width - thumbSize)
            let safeStart = min(max(cropStartMs, 0), durationMs)
            let safeEnd = min(max(cropEndMs, safeStart), durationMs)
            let startX = Self.thumbCenterX(ms: safeStart, durationMs: durationMs, width: width)
            let endX = Self.thumbCenterX(ms: safeEnd, durationMs: durationMs, width: width)
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(AlarmTalkTheme.surfaceVariant)
                    .frame(width: width, height: trackHeight)
                Capsule()
                    .fill(AlarmTalkTheme.primary)
                    .frame(width: max(trackHeight, endX - startX), height: trackHeight)
                    .offset(x: startX)
                rangeThumb
                    .position(x: startX, y: controlHeight / 2)
                    .gesture(thumbDrag(isStart: true, usable: usable))
                rangeThumb
                    .position(x: endX, y: controlHeight / 2)
                    .gesture(thumbDrag(isStart: false, usable: usable))
            }
            .frame(width: width, height: controlHeight)
            .coordinateSpace(.named(coordinateSpaceName))
        }
        .frame(height: controlHeight)
    }

    private var rangeThumb: some View {
        Circle()
            .fill(AlarmTalkTheme.surface)
            .frame(width: thumbSize, height: thumbSize)
            .overlay(Circle().stroke(AlarmTalkTheme.primary, lineWidth: 2))
            .shadow(color: Color.black.opacity(0.12), radius: 2, y: 1)
    }

    private func thumbDrag(isStart: Bool, usable: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(coordinateSpaceName))
            .onChanged { value in
                let span = CGFloat(max(1, durationMs))
                let raw = Int(((value.location.x - thumbSize / 2) / max(1, usable)) * span)
                let minMs = effectiveMinDurationMs
                let maxMs = effectiveMaxDurationMs
                if isStart {
                    // 시작 핸들은 [end-max, end-min] 안에서만 — 구간 길이를 min~max 로 유지.
                    let lower = max(0, cropEndMs - maxMs)
                    let upper = max(lower, cropEndMs - minMs)
                    cropStartMs = min(max(raw, lower), upper)
                } else {
                    // 끝 핸들은 [start+min, min(duration, start+max)] 안에서만.
                    let lower = min(cropStartMs + minMs, durationMs)
                    let upper = max(lower, min(durationMs, cropStartMs + maxMs))
                    cropEndMs = min(max(raw, lower), upper)
                }
            }
    }
}

/// 자르기 막대 손잡이 **위**의 시작·끝 시각 — 손잡이를 따라 움직이고, 둘이 가까워 겹치면 "0:10–0:40" 하나로 합쳐 구간
/// 가운데에 둔다. 안드로이드 `ui/components/VoiceInputControls.kt` 의 `AudioCropRangeSelector`(`CropThumbLabel` 폭 48)와 같은 규칙이다.
/// 가로 자리는 iOS 막대(`AudioCropRangeSlider`)가 손잡이를 그리는 자리와 같게 셈한다.
struct AudioCropThumbLabels: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @ScaledMetric(relativeTo: .caption) private var rowHeight: CGFloat = 16

    let durationMs: Int
    let startMs: Int
    let endMs: Int

    private static let labelWidth: CGFloat = 48

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let labelWidth = Self.labelWidth
            let maxLabelX = max(width - labelWidth, 0)
            let safeStart = min(max(startMs, 0), durationMs)
            let safeEnd = min(max(endMs, safeStart), durationMs)
            let startX = min(max(AudioCropRangeSlider.thumbCenterX(ms: safeStart, durationMs: durationMs, width: width) - labelWidth / 2, 0), maxLabelX)
            let endX = min(max(AudioCropRangeSlider.thumbCenterX(ms: safeEnd, durationMs: durationMs, width: width) - labelWidth / 2, 0), maxLabelX)
            ZStack(alignment: .topLeading) {
                if endX - startX < labelWidth {
                    let combinedWidth = labelWidth * 2
                    let centerX = min(max((startX + endX) / 2 + labelWidth / 2 - combinedWidth / 2, 0), max(width - combinedWidth, 0))
                    label("\(HelperFormatters.audioTimeLabel(safeStart))–\(HelperFormatters.audioTimeLabel(safeEnd))")
                        .frame(width: combinedWidth)
                        .offset(x: centerX)
                } else {
                    label(HelperFormatters.audioTimeLabel(safeStart))
                        .frame(width: labelWidth)
                        .offset(x: startX)
                    label(HelperFormatters.audioTimeLabel(safeEnd))
                        .frame(width: labelWidth)
                        .offset(x: endX)
                }
            }
        }
        .frame(height: rowHeight)
        .accessibilityHidden(true)
    }

    private func label(_ text: String) -> some View {
        Text(verbatim: text)
            .font(theme.typography.labelMedium)
            .fontWeight(.semibold)
            .foregroundStyle(theme.palette.primary)
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
    }
}

#if DEBUG
#Preview("VoiceProfileManagementPanel (light)") {
    VoiceProfileManagementPanel(route: .constant(.management), monthlyLimitNoticeOpen: .constant(false))
        .voiceAlarmPreviewEnvironment()
}

#Preview("VoiceProfileManagementPanel (dark)") {
    VoiceProfileManagementPanel(route: .constant(.management), monthlyLimitNoticeOpen: .constant(false))
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}

#endif
