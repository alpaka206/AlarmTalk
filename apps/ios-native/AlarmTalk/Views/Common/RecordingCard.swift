import SwiftUI

/// 녹음 카드의 원형 버튼 — **크기를 여기서만 정한다.**
///
/// ⚠ **`.buttonStyle(.borderedProminent)` + `.frame(42)` 로 되돌리지 말 것**(2026-08-16
/// 지적 "마이크 버튼이 불필요하게 크다"). 그 조합은 **라벨**이 42 이고 버튼 스타일이 그
/// 바깥에 패딩을 더해 실제로는 60pt 를 넘었다. 안드로이드는 버튼 자체가 48dp·글리프 26dp 다
/// (`VoiceInputControls`). 여기서는 44pt(아이폰 최소 터치 타깃) 원 + 20pt 글리프로 맞춘다.
struct RecordingCircleButton: View {
    let systemName: String
    let filled: Bool
    let tint: Color
    let onTint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(filled ? onTint : tint)
                .frame(width: 44, height: 44)
                .background(
                    Circle().fill(filled ? tint : tint.opacity(0.12))
                )
        }
        .buttonStyle(.plain)
    }
}


/// **녹음 카드 — 알람 편집기와 목소리 등록이 함께 쓴다.**
///
/// ⚠ **화면마다 새로 만들지 말 것**(2026-08-16 정리). 예전에는 편집기는 이 카드,
/// 목소리 등록은 **지름 100pt 원형 버튼 + 18칸 파형**으로 서로 달랐다 — 같은 일(녹음)을
/// 하는 화면이 두 앱 × 두 화면에서 네 가지 모양이었다.
/// 안드로이드 대응물은 `ui/components/VoiceInputControls.kt` 의 `VoiceRecordControls` 다.
///
/// 왼쪽이 **지금 무슨 상태인지**(제목 + 시간), 오른쪽이 **지금 할 수 있는 동작**이다.
struct RecordingCard: View {
    let isRecording: Bool
    let elapsedMs: Int
    let maxDurationMs: Int
    /// 녹음물이 이미 있는가(방금 녹음했거나 알람에 붙어 있거나).
    let hasRecording: Bool
    let isPreviewing: Bool
    /// 기본 상태 문구를 바꿔야 하는 경우(예: 12초 미달). nil이면 공용 기본 문구를 쓴다.
    var statusText: String? = nil
    /// 카드 아래 한 줄. **상태를 되풀이하지 말 것** — 제목이 이미 말한다.
    let note: String?
    let onRecord: () -> Void
    let onPreview: (() -> Void)?
    let onRedo: (() -> Void)?

    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 상태 글자 — 안드로이드 `common_voice_record_status_recording` 처럼 말줄임표 없는 "녹음 중" 이다.
    private var title: String {
        if isRecording { return String(localized: "녹음 중") }
        if let statusText { return statusText }
        return hasRecording ? String(localized: "녹음을 저장했어요") : String(localized: "녹음하기")
    }

    /// "0:12 / 2:00" — 녹음 중에는 흐른 시간만 강조색이다(뒤의 '/ 2:00' 은 흐린 글자 그대로). 안드로이드 `VoiceRecordControls` 의
    /// 시간 줄과 같다. 숫자뿐이라 번역하지 않는다.
    private var timeLabel: AttributedString {
        var elapsed = AttributedString(HelperFormatters.audioTimeLabel(elapsedMs))
        elapsed.foregroundColor = isRecording ? theme.palette.primary : theme.palette.onSurfaceVariant
        var limit = AttributedString(" / \(HelperFormatters.audioTimeLabel(maxDurationMs))")
        limit.foregroundColor = theme.palette.onSurfaceVariant
        return elapsed + limit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    // bodyMedium · SemiBold — 안드로이드 `VoiceRecordControls` 의 상태 글자와 같다.
                    Text(title)
                        .font(theme.typography.bodyMedium)
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.palette.onSurface)
                    HStack(spacing: 6) {
                        Text(timeLabel)
                            .font(theme.typography.bodySmall)
                            .monospacedDigit()
                            .lineLimit(1)
                        // 실제 마이크 크기 — 애니메이션만으로는 마이크가 죽어 있어도 티가 안 난다.
                        if isRecording {
                            RecordingLevelBars(meter: .shared, color: theme.palette.primary)
                        }
                    }
                }
                Spacer(minLength: 0)
                if hasRecording, !isRecording {
                    // 재생·다시 녹음 사이 12 — 안드로이드 카드 한 줄의 `spacedBy(12)` 와 같다.
                    HStack(spacing: 12) {
                        if let onPreview {
                            RecordingCircleButton(
                                systemName: isPreviewing ? "stop.fill" : "play.fill",
                                filled: true,
                                tint: theme.palette.primary,
                                onTint: theme.palette.onPrimary,
                                action: onPreview
                            )
                            .accessibilityLabel(Text(isPreviewing ? String(localized: "정지") : String(localized: "들어보기")))
                        }
                        if let onRedo {
                            RecordingCircleButton(
                                systemName: "arrow.counterclockwise",
                                filled: false,
                                tint: theme.palette.primary,
                                onTint: theme.palette.onPrimary,
                                action: onRedo
                            )
                            .accessibilityLabel(Text(String(localized: "다시 녹음")))
                        }
                    }
                } else {
                    ZStack {
                        // 녹음 중 마이크 버튼 뒤에서 퍼져 나가는 링 — 안드로이드 `RecordPulseRing` 과 같은 값.
                        if isRecording && !reduceMotion {
                            RecordPulseRing(color: theme.palette.primary)
                        }
                        RecordingCircleButton(
                            systemName: isRecording ? "stop.fill" : "mic.fill",
                            filled: true,
                            tint: theme.palette.primary,
                            onTint: theme.palette.onPrimary,
                            action: onRecord
                        )
                        .accessibilityLabel(Text(isRecording ? String(localized: "녹음 정지") : String(localized: "녹음 시작")))
                    }
                }
            }
            if let note, !note.isEmpty {
                Text(note)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
        }
        .padding(16)
        // 모서리 22 · 카드 테두리색 — 안드로이드 `VoiceRecordControls` 의 `WakerCardShape` · `wakerCardBorder()`.
        .background(theme.palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                .stroke(theme.palette.cardBorder, lineWidth: 1)
        )
    }
}

/// 녹음 중 마이크 크기 막대 넷 — 안드로이드 `VoiceInputControls.kt` 의 `RecordingLevelBars` 와 같은 값이다(폭 3, 높이
/// 3~14, 사이 2, 막대별 배율 0.55·1·0.75·0.4, 하한 0.1, 220ms 보간).
///
/// ⚠ 마이크 크기는 **이 뷰만** 본다(`RecordingLevelMeter`) — 카드나 화면이 보면 250ms 마다 화면 전체가 다시 그려진다.
private struct RecordingLevelBars: View {
    @ObservedObject var meter: RecordingLevelMeter
    let color: Color

    private static let scales: [Float] = [0.55, 1, 0.75, 0.4]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Self.scales.indices, id: \.self) { index in
                Capsule()
                    .fill(color)
                    .frame(width: 3, height: 3 + CGFloat(min(max(meter.level * Self.scales[index], 0.1), 1)) * 11)
            }
        }
        .frame(height: 14)
        // 안드로이드 `tween(220)` 의 기본 곡선(FastOutSlowIn)과 같다.
        .animation(.timingCurve(0.4, 0, 0.2, 1, duration: 0.22), value: meter.level)
        .accessibilityHidden(true)
    }
}

/// 녹음 중 마이크 버튼 뒤에서 퍼져 나가는 링 — 1.4초마다 버튼 크기에서 1.45배까지 커지며 32% → 0 으로 옅어진다
/// (안드로이드 `RecordPulseRing` 과 같은 값). 배치에 끼지 않는다(크기·투명도만 움직인다).
private struct RecordPulseRing: View {
    let color: Color
    @State private var expanded = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 44, height: 44)
            .scaleEffect(expanded ? 1.45 : 1)
            .opacity(expanded ? 0 : 0.32)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onAppear {
                withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) {
                    expanded = true
                }
            }
    }
}
