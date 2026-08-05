import SwiftUI

// VoiceProfileManagementPanel 에서 분리한 행/다이얼로그 하위 컴포넌트.
// 동작/디자인 변경 없음 — internal 가시성만 조정.

// MARK: - Row

/// 단일 목소리 프로필 행. Android `VoiceProfileRow` 와 동일한 슬롯.
struct VoiceProfileRow: View {
    let profile: VoiceProfile
    let isSelected: Bool
    let canShareVoice: Bool
    let onSelect: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onToggleShare: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(AlarmTalkTheme.surfaceVariant)
                    Image(systemName: "mic")
                        .foregroundStyle(AlarmTalkTheme.primary)
                }
                .frame(width: 40, height: 40)

                VStack(alignment: .leading, spacing: 3) {
                    Text(profile.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AlarmTalkTheme.text)
                    HStack(spacing: 6) {
                        if shouldShowStatusPill {
                            statusPill
                        }
                        if profile.isShared == true {
                            sharedPill
                        }
                    }
                }
                Spacer()
                Menu {
                    Button("선택", action: onSelect)
                    Button("정보 수정", action: onEdit)
                    if canShareVoice {
                        Toggle("공유 허용", isOn: Binding(
                            get: { profile.isShared ?? false },
                            set: { onToggleShare($0) }
                        ))
                    } else {
                        Button("공유 허용") {}
                            .disabled(true)
                    }
                    Divider()
                    Button("삭제", role: .destructive, action: onDelete)
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                        .frame(width: 36, height: 36)
                }
            }

            HStack(spacing: 8) {
                Button(isSelected ? "선택됨" : "이 목소리 사용", action: onSelect)
                    .buttonStyle(.bordered)
                    .tint(isSelected ? AlarmTalkTheme.primary : AlarmTalkTheme.textSecondary)
                    .disabled(isSelected)
                Spacer()
                Button {
                    onEdit()
                } label: {
                    Image(systemName: "pencil")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(AlarmTalkTheme.primary)
                Button(role: .destructive) {
                    onDelete()
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(AlarmTalkTheme.error)
            }
        }
        .padding(14)
        .background(AlarmTalkTheme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isSelected ? AlarmTalkTheme.primary : AlarmTalkTheme.outline, lineWidth: isSelected ? 1.5 : 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var shouldShowStatusPill: Bool {
        let status = normalizedStatus(profile.status)
        return status != "ready"
    }

    private var statusPill: some View {
        let status = normalizedStatus(profile.status)
        let bg: Color
        let fg: Color
        switch status {
        case "ready":
            bg = AlarmTalkTheme.accent.opacity(0.18); fg = AlarmTalkTheme.accent
        case "processing":
            bg = AlarmTalkTheme.secondary.opacity(0.18); fg = AlarmTalkTheme.secondary
        case "deleting":
            bg = AlarmTalkTheme.surfaceVariant; fg = AlarmTalkTheme.textSecondary
        case "failed":
            bg = AlarmTalkTheme.error.opacity(0.18); fg = AlarmTalkTheme.error
        default:
            bg = AlarmTalkTheme.surfaceVariant; fg = AlarmTalkTheme.textSecondary
        }
        return Text(statusLabel(status))
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(bg, in: Capsule())
            .foregroundStyle(fg)
    }

    private var sharedPill: some View {
        Text("공유 중")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(AlarmTalkTheme.primary.opacity(0.15), in: Capsule())
            .foregroundStyle(AlarmTalkTheme.primary)
    }

    private func statusLabel(_ raw: String) -> String {
        switch raw {
        case "ready": return "사용 가능"
        case "processing": return "학습 중"
        case "deleting": return "삭제 중"
        case "failed": return "실패"
        default: return "상태 확인 중"
        }
    }

    private func normalizedStatus(_ raw: String?) -> String {
        let status = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return status.isEmpty ? "ready" : status
    }
}

struct FamilyVoiceProfileRow: View {
    let profile: FamilyVoiceProfile
    let onEdit: () -> Void

    /// Android `SharedVoiceProfileRow.needsViewerInfo` (VoiceProfileManagementPanel.kt:1477) 와 동일.
    /// 관계/호칭 중 하나라도 비어 있으면 "설정하기" CTA 버튼을 노출.
    private var needsViewerInfo: Bool {
        profile.requiresViewerInfo
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(AlarmTalkTheme.secondary.opacity(0.18))
                    Image(systemName: "person.wave.2")
                        .foregroundStyle(AlarmTalkTheme.secondary)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 3) {
                    Text(profile.name).font(.subheadline.weight(.semibold))
                    Text(profile.sharedFromLabel)
                        .font(.caption)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                Spacer()
                Button(action: onEdit) {
                    Image(systemName: "pencil")
                        .font(.callout)
                        .foregroundStyle(AlarmTalkTheme.primary)
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("내 정보 수정")
            }
            if needsViewerInfo {
                Button(action: onEdit) {
                    Text("이 목소리가 나를 어떻게 부를지 설정")
                        .font(.footnote.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(AlarmTalkTheme.primary)
            }
        }
        .padding(12)
        .background(AlarmTalkTheme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 12).stroke(AlarmTalkTheme.outline, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

}

// MARK: - Edit dialog

/// 프로필 이름 + 공유 토글 동시 편집 다이얼로그.
struct VoiceProfileEditDialog: View {
    let initialName: String
    let initialRelationship: String
    let initialListenerTitle: String
    let initialIsShared: Bool
    let canShareVoice: Bool
    let onCancel: () -> Void
    let onSave: (String, String, String, Bool) -> Void

    @State private var name: String = ""
    @State private var relationshipSelection = VoiceRelationshipSelection()
    @State private var listenerTitle: String = ""
    @State private var isShared: Bool = false
    @State private var submitted = false

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedRelationship: String {
        relationshipSelection.resolved
    }

    private var trimmedListenerTitle: String {
        listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Text("정보 수정")
                    .font(.title3.weight(.bold))
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("닫기"))
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("이름")
                    .font(.caption)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                TextField("목소리 이름", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: name) { _, newValue in
                        let cleaned = InputSanitizer.clampVoiceName(newValue)
                        if cleaned != newValue {
                            name = cleaned
                        }
                    }
                if submitted && trimmedName.isEmpty {
                    Text("목소리 이름을 입력해 주세요.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AlarmTalkTheme.error)
                }
            }

            VoiceRelationshipInputField(
                selection: $relationshipSelection,
                submitted: submitted
            )

            VStack(alignment: .leading, spacing: 6) {
                Text("이 목소리가 나를 부를 호칭")
                    .font(.caption)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                TextField("예: 지호야, 여보", text: $listenerTitle)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: listenerTitle) { _, newValue in
                        if newValue.count > 30 {
                            listenerTitle = String(newValue.prefix(30))
                        }
                    }
                if submitted && trimmedListenerTitle.isEmpty {
                    Text("이 목소리가 나를 부를 이름을 입력해 주세요.")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AlarmTalkTheme.error)
                }
            }

            VoiceListenerPreviewCard(
                listenerTitle: listenerTitle,
                relationshipLabel: trimmedRelationship
            )

            Toggle(isOn: $isShared) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("목소리 공유").font(.subheadline.weight(.semibold))
                    Text(shareDescription)
                        .font(.caption)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
            }
            .disabled(!canShareVoice)

            Button("저장") {
                submitted = true
                guard !trimmedName.isEmpty,
                      !trimmedRelationship.isEmpty,
                      !trimmedListenerTitle.isEmpty else {
                    return
                }
                onSave(trimmedName, trimmedRelationship, trimmedListenerTitle, isShared)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
        }
        .padding(20)
        .onAppear {
            name = initialName
            relationshipSelection = parseVoiceRelationshipLabel(initialRelationship)
            listenerTitle = initialListenerTitle
            isShared = initialIsShared
        }
    }

    private var shareDescription: String {
        if !canShareVoice {
            return "공유는 커플/가족 이용권에서 사용할 수 있어요."
        }
        return isShared ? "이용권을 같이 사용하는 사람들에게 목소리를 공유해요." : "내 계정에서만 사용해요."
    }
}

// MARK: - Delete dialog

/// 삭제 확인 다이얼로그. force 토글 + 영향받는 알람 수 안내.
struct VoiceProfileDeleteDialog: View {
    let profileName: String
    @Binding var force: Bool
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Text("목소리 삭제")
                    .font(.title3.weight(.bold))
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
            }

            Text("'\(profileName)' 목소리를 삭제할까요?")
                .font(.subheadline)
            Text("이 목소리를 쓰는 메시지는 텍스트만 남고, 알람은 기본 알람음으로 바뀌어요. 저장된 음원 파일도 함께 삭제돼요.")
                .font(.footnote)
                .foregroundStyle(AlarmTalkTheme.textSecondary)

            Toggle(isOn: $force) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("사용 중인 알람도 함께 정리").font(.subheadline.weight(.semibold))
                    Text(force ? "기본 알람음으로 강등돼요" : "사용 중이면 삭제하지 않아요")
                        .font(.caption)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
            }

            HStack {
                Button("취소", action: onCancel)
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                Button(role: .destructive, action: onConfirm) {
                    Text("삭제")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.error)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
    }
}

// MARK: - Shared voice viewer info dialog

/// 공유받은 음성에 대해 viewer 가 자신과의 관계와 호칭을 설정하는 다이얼로그.
///
/// Android `SharedVoiceViewerInfoDialog`
/// (`VoiceProfileManagementPanel.kt:1543`) 와 1:1 대응. 둘 다 필수이며, 비어 있으면
/// 인라인 오류 메시지를 띄우고 저장을 막는다.
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
                RoundedRectangle(cornerRadius: 16).stroke(AlarmTalkTheme.outline, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))

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
                            listenerTitle = String(newValue.prefix(30))
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

#Preview("Delete dialog") {
    VoiceProfileDeleteDialog(
        profileName: "아침 목소리",
        force: .constant(true),
        onCancel: {},
        onConfirm: {}
    )
    .padding()
}
#endif
