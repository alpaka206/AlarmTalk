import SwiftUI

/// 서버 status 문자열 정규화. 여러 뷰(행·목록·편집)가 같은 판정을 써야 해서 파일 스코프에 둔다.
func normalizedStatus(_ raw: String?) -> String {
    let status = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return status.isEmpty ? "ready" : status
}

// VoiceProfileManagementPanel 에서 분리한 행/다이얼로그 하위 컴포넌트.
// 동작/디자인 변경 없음 — internal 가시성만 조정.

// MARK: - Row

// MARK: - Edit dialog

// MARK: - Delete dialog

/// 삭제 확인 다이얼로그. force 토글 + 영향받는 알람 수 안내.
struct SharedVoiceViewerInfoDialog: View {
    let profileName: String
    let sharedFromLabel: String
    let initialRelationship: String
    let initialListenerTitle: String
    let isWorking: Bool
    let onCancel: () -> Void
    let onPreview: () -> Void
    let onConfirm: (String, String) -> Void

    @State private var relationshipSelection = VoiceRelationshipSelection()
    @State private var listenerTitle: String = ""
    @State private var submitted: Bool = false

    private var trimmedRelationship: String {
        relationshipSelection.resolved
    }
    private var trimmedListener: String {
        listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var listenerError: Bool { submitted && trimmedListener.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Text("공유받은 목소리 설정")
                    .font(.title3.weight(.bold))
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                .buttonStyle(.plain)
            }
            Text("'\(profileName)' 가 내게 어떻게 말할지 알려주세요.")
                .font(.subheadline)
                .foregroundStyle(AlarmTalkTheme.textSecondary)

            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(AlarmTalkTheme.secondary.opacity(0.18))
                    Image(systemName: "mic")
                        .foregroundStyle(AlarmTalkTheme.secondary)
                }
                .frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text(profileName)
                        .font(.headline)
                    Text(sharedFromLabel)
                        .font(.caption)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .background(AlarmTalkTheme.surfaceVariant.opacity(0.55))
            .overlay(
                RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.card).stroke(AlarmTalkTheme.outline, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.card))

            VoiceRelationshipInputField(
                selection: $relationshipSelection,
                submitted: submitted
            )

            VStack(alignment: .leading, spacing: 6) {
                Text("이 목소리가 나를 부를 호칭")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                TextField("예: 지호야, 우리 강아지", text: $listenerTitle)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: listenerTitle) { _, newValue in
                        if newValue.count > 30 {
                            listenerTitle = InputSanitizer.clampDisplayName(newValue)
                        }
                    }
                if listenerError {
                    Text("필수 입력 값입니다.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AlarmTalkTheme.error)
                }
            }

            VoiceListenerPreviewCard(
                listenerTitle: listenerTitle,
                relationshipLabel: trimmedRelationship
            )

            VStack(spacing: 8) {
                Button(action: onPreview) {
                    Label("미리듣기", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isWorking)

                Button("저장") {
                    submitted = true
                    if !trimmedRelationship.isEmpty && !trimmedListener.isEmpty {
                        onConfirm(trimmedRelationship, trimmedListener)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .frame(maxWidth: .infinity)
                .disabled(isWorking)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .onAppear {
            relationshipSelection = parseVoiceRelationshipLabel(initialRelationship)
            listenerTitle = initialListenerTitle
        }
    }
}


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
    private let thumbSize: CGFloat = 26
    private let trackHeight: CGFloat = 6
    private let controlHeight: CGFloat = 44

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let usable = max(1, width - thumbSize)
            let span = CGFloat(max(1, durationMs))
            let safeStart = min(max(cropStartMs, 0), durationMs)
            let safeEnd = min(max(cropEndMs, safeStart), durationMs)
            let startX = thumbSize / 2 + usable * CGFloat(safeStart) / span
            let endX = thumbSize / 2 + usable * CGFloat(safeEnd) / span
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
                if isStart {
                    // 시작 핸들은 [end-max, end-min] 안에서만 — 구간 길이를 min~max 로 유지.
                    let lower = max(0, cropEndMs - maxDurationMs)
                    let upper = max(lower, cropEndMs - minDurationMs)
                    cropStartMs = min(max(raw, lower), upper)
                } else {
                    // 끝 핸들은 [start+min, min(duration, start+max)] 안에서만.
                    let lower = cropStartMs + minDurationMs
                    let upper = max(lower, min(durationMs, cropStartMs + maxDurationMs))
                    cropEndMs = min(max(raw, lower), upper)
                }
            }
    }
}

#if DEBUG
#Preview("VoiceProfileManagementPanel (light)") {
    VoiceProfileManagementPanel(route: .constant(.management))
        .voiceAlarmPreviewEnvironment()
}

#Preview("VoiceProfileManagementPanel (dark)") {
    VoiceProfileManagementPanel(route: .constant(.management))
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}

#endif
