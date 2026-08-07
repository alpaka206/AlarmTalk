import AVFoundation
import SwiftUI
import UniformTypeIdentifiers

// AlarmEditorSheet 에서 분리한 에디터 하위 컴포넌트/헬퍼 모음.
// 동작/디자인 변경 없음 — 동일 모듈 내 internal 로 가시성만 조정해 파일만 분리.

struct CachedLocalAlarmAudio {
    let fileName: String
    let cacheKey: String
}

struct FamilyLocalVoiceUploadSource {
    let url: URL
    let durationMs: Int
    let displayName: String
}

enum LocalAlarmAudioError: LocalizedError {
    case missingSource
    case tooShort
    case tooLong
    case invalidDuration

    var errorDescription: String? {
        switch self {
        case .missingSource:
            return "녹음하거나 파일을 선택해 주세요."
        case .tooShort:
            return "1초 이상 들리는 음성이 필요해요."
        case .tooLong:
            return "알람 음성은 최대 \(AlarmAudioLimits.maxDurationMillis / 1000)초까지 사용할 수 있어요."
        case .invalidDuration:
            return "오디오 길이를 확인하지 못했어요."
        }
    }
}

enum AlarmLocalAudioInputMode: String, CaseIterable, Hashable, Identifiable {
    case record
    case file

    var id: String { rawValue }

    var label: String {
        switch self {
        case .record: return "녹음"
        case .file: return "파일"
        }
    }
}

struct LocalAlarmAudioEditor: View {
    @Binding var mode: AlarmLocalAudioInputMode
    let isRecording: Bool
    let elapsedMs: Int
    let hasRecording: Bool
    let existingAudioLabel: String?
    let fileName: String?
    let fileDurationMs: Int?
    @Binding var cropStartMs: Int
    @Binding var cropEndMs: Int
    let isPreviewing: Bool
    let message: String?
    let onModeChange: (AlarmLocalAudioInputMode) -> Void
    let onRecord: () -> Void
    let onPickFile: () -> Void
    let onPreview: () -> Void
    let onClear: () -> Void

    @Environment(\.voiceAlarmTheme) private var theme

    private var sourceReady: Bool {
        switch mode {
        case .record:
            return hasRecording || existingAudioLabel != nil
        case .file:
            return fileDurationMs != nil || existingAudioLabel != nil
        }
    }

    private var durationLabel: String {
        switch mode {
        case .record:
            return HelperFormatters.audioTimeLabel(elapsedMs)
        case .file:
            guard let fileDurationMs else { return "0:00" }
            return HelperFormatters.audioTimeLabel(max(0, min(cropEndMs, fileDurationMs) - cropStartMs))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("녹음/파일", selection: Binding(
                get: { mode },
                set: { onModeChange($0) }
            )) {
                ForEach(AlarmLocalAudioInputMode.allCases) { option in
                    Text(option.label).tag(option)
                }
            }
            .pickerStyle(.segmented)

            if mode == .record {
                recordingCard
            } else {
                fileCard
            }

            if sourceReady {
                HStack(spacing: 8) {
                    Button(action: onPreview) {
                        Label(isPreviewing ? "정지" : "미리듣기", systemImage: isPreviewing ? "stop.fill" : "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isRecording)

                    Button(role: .destructive, action: onClear) {
                        Label("지우기", systemImage: "trash")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isRecording)
                }
            }

            if let message {
                Text(message)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(isRecording ? theme.palette.primary : theme.palette.onSurfaceVariant)
            }
        }
    }

    private var recordingCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(isRecording ? "녹음 중…" : (hasRecording ? "녹음을 저장했어요." : "녹음 또는 파일 업로드"))
                        .font(theme.typography.labelLarge)
                    Text("\(durationLabel) / \(HelperFormatters.audioTimeLabel(Int(AlarmAudioLimits.maxDurationMillis)))")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .monospacedDigit()
                }
                Spacer()
                Button(action: onRecord) {
                    Image(systemName: isRecording ? "stop.fill" : "mic.fill")
                        .font(.headline)
                        .frame(width: 42, height: 42)
                }
                .buttonStyle(.borderedProminent)
                .tint(isRecording ? theme.palette.error : theme.palette.primary)
            }
            if let existingAudioLabel, !hasRecording {
                Text(existingAudioLabel)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
        }
        .padding(12)
        .background(theme.palette.surfaceVariant.opacity(0.36))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var fileCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(fileName ?? "파일 업로드")
                        .font(theme.typography.labelLarge)
                        .lineLimit(1)
                    Text(fileDurationMs.map { "전체 \(HelperFormatters.audioTimeLabel($0)) · 사용할 구간 \(durationLabel)" } ?? "최대 \(AlarmAudioLimits.maxDurationMillis / 1000)초")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                Spacer()
                Button(action: onPickFile) {
                    Label("선택", systemImage: "folder")
                }
                .buttonStyle(.bordered)
            }

            if let fileDurationMs, fileDurationMs > Int(AlarmAudioLimits.maxDurationMillis) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("자를 구간 \(HelperFormatters.audioTimeLabel(cropStartMs)) - \(HelperFormatters.audioTimeLabel(min(cropEndMs, fileDurationMs)))")
                        .font(.caption.weight(.semibold))
                    Slider(
                        value: Binding(
                            get: { Double(cropStartMs) / 1000.0 },
                            set: { seconds in
                                let maxStart = max(0, fileDurationMs - Int(AlarmAudioLimits.maxDurationMillis))
                                cropStartMs = min(maxStart, max(0, Int(seconds * 1000)))
                                cropEndMs = min(fileDurationMs, cropStartMs + Int(AlarmAudioLimits.maxDurationMillis))
                            }
                        ),
                        in: 0...(Double(max(0, fileDurationMs - Int(AlarmAudioLimits.maxDurationMillis))) / 1000.0),
                        step: 1
                    )
                }
            }

            if let existingAudioLabel, fileDurationMs == nil {
                Text(existingAudioLabel)
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            }
        }
        .padding(12)
        .background(theme.palette.surfaceVariant.opacity(0.36))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

}

// ⚠ **`FamilyAlarmTargetPicker` 를 되살리지 말 것**(2026-08-07 삭제).
// 편집기 안에서 받는 사람을 바꾸던 카드다. 안드로이드에는 그런 컨트롤이 없고, 가족 알람은
// 한 번 보내면 보낸 사람이 고칠 수 없다 — '누구에게' 는 「누구를 깨울까요?」 시트에서 한 번
// 정하는 값이지 편집 중에 오가는 값이 아니다. 자세한 이유는 `AlarmEditorSheet` 주석 참조.

enum FamilyAlarmScheduleRules {
    private static let familyAlarmMinLeadMillis: Int64 = 30 * 60 * 1000

    static func memberLabel(_ member: FamilyGroupMember) -> String {
        if let name = member.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        if let email = member.email?.trimmingCharacters(in: .whitespacesAndNewlines), !email.isEmpty {
            return email
        }
        return "멤버"
    }

    static func quietScheduleLabel(_ member: FamilyGroupMember) -> String {
        quietWindows(member).map { window in
            "\(HelperFormatters.quietDaysLabel(window.days)) \(window.start)-\(window.end)"
        }.joined(separator: " · ")
    }

    static func targetStatusText(leadTooSoon: Bool, quietUnavailable: Bool) -> String {
        if leadTooSoon { return "지금부터 30분 뒤 알람부터 설정할 수 있어요." }
        if quietUnavailable { return "상대가 이 시간에는 알람을 받지 않도록 해뒀어요." }
        return "설정 가능"
    }

    static func isLeadTooSoon(
        hour: Int,
        minute: Int,
        repeatDaysMask: Int,
        holidayOff: Bool,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> Bool {
        let fireAtMillis = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: hour,
            minute: minute,
            repeatDaysMask: repeatDaysMask,
            holidayOff: holidayOff,
            nowMillis: nowMillis
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(
            hour: hour,
            minute: minute,
            referenceMillis: nowMillis
        )
        return fireAtMillis - nowMillis < familyAlarmMinLeadMillis
    }

    static func isTimeUnavailable(
        member: FamilyGroupMember,
        hour: Int,
        minute: Int,
        repeatDaysMask: Int,
        nowMillis: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> Bool {
        let dayIndices = targetDayIndices(hour: hour, minute: minute, repeatDaysMask: repeatDaysMask, nowMillis: nowMillis)
        return quietWindows(member).contains { window in
            dayIndices.contains { dayIndex in blocks(window: window, dayIndex: dayIndex, hour: hour, minute: minute) }
        }
    }

    private static func quietWindows(_ member: FamilyGroupMember) -> [FamilyAlarmQuietWindow] {
        let fallback = FamilyAlarmQuietWindow(
            days: safeQuietDays(member.familyAlarmQuietDays),
            start: safeQuietTime(member.familyAlarmQuietStart, fallback: "09:00"),
            end: safeQuietTime(member.familyAlarmQuietEnd, fallback: "18:30")
        )
        let windows = (member.familyAlarmQuietWindows ?? []).compactMap { window -> FamilyAlarmQuietWindow? in
            let start = safeQuietTime(window.start, fallback: "")
            let end = safeQuietTime(window.end, fallback: "")
            guard !start.isEmpty, !end.isEmpty else { return nil }
            return FamilyAlarmQuietWindow(days: safeQuietDays(window.days), start: start, end: end)
        }
        return windows.isEmpty ? [fallback] : windows
    }

    private static func targetDayIndices(hour: Int, minute: Int, repeatDaysMask: Int, nowMillis: Int64) -> [Int] {
        if repeatDaysMask != 0 {
            return (0...6).filter { repeatDaysMask & (1 << $0) != 0 }
        }
        let fireAt = (try? AlarmTimeCalculator.nextFireAtMillis(
            hour: hour,
            minute: minute,
            repeatDaysMask: 0,
            nowMillis: nowMillis
        )) ?? LocalAlarmRecord.fallbackFireAtMillis(hour: hour, minute: minute, referenceMillis: nowMillis)
        let date = Date(timeIntervalSince1970: TimeInterval(fireAt) / 1000.0)
        return [(Calendar.current.component(.weekday, from: date) - 1) % 7]
    }

    private static func blocks(window: FamilyAlarmQuietWindow, dayIndex: Int, hour: Int, minute: Int) -> Bool {
        guard safeQuietDays(window.days).contains(dayIndex),
              let start = parseQuietTime(window.start),
              let end = parseQuietTime(window.end) else {
            return false
        }
        let target = hour * 60 + minute
        if start <= end {
            return target >= start && target < end
        }
        return target >= start || target < end
    }

    private static func parseQuietTime(_ value: String) -> Int? {
        let parts = value.split(separator: ":")
        guard parts.count >= 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]),
              (0...23).contains(hour),
              (0...59).contains(minute) else {
            return nil
        }
        return hour * 60 + minute
    }

    private static func safeQuietDays(_ days: [Int]?) -> [Int] {
        let normalized = Array(Set(days?.filter { (0...6).contains($0) } ?? [])).sorted()
        return normalized.isEmpty ? [1, 2, 3, 4, 5] : normalized
    }

    private static func safeQuietTime(_ value: String?, fallback: String) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? fallback : trimmed
    }

}

struct EditorLanguageOption: Identifiable {
    let code: String
    let label: String
    var id: String { code }
}

let ttsLanguages: [EditorLanguageOption] = [
    .init(code: "ko", label: "한국어"),
    .init(code: "en", label: "영어"),
    .init(code: "ja", label: "일본어")
]

let ttsTranslationLanguages: [EditorLanguageOption] = [
    .init(code: "ko", label: "한국어"),
    .init(code: "en", label: "영어"),
    .init(code: "ja", label: "일본어"),
    .init(code: "fr", label: "프랑스어"),
    .init(code: "it", label: "이탈리아어")
]

// ⚠ **`VoiceRepeatEditor` / `VoiceVolumeEditor` 를 되살리지 말 것**(2026-08-07 삭제).
// 편집기 본문에 반복 세그먼트와 음량 슬라이더를 펼쳐 두던 뷰들이다. 안드로이드는 둘 다
// '목소리 크기' 행이 여는 상세(`VoiceOutputSettingsPane`)에만 두고, 본문에는 요약 행
// 하나만 낸다. 인라인으로 두면 세부 설정의 '음성 출력' 행과 합쳐 같은 값을 바꾸는 자리가
// 셋이 됐다. 삭제 시점의 `VoiceVolumeEditor` 는 하한도 30% 로 잘못 잡고 있었다(규약은 10%).

extension VoiceProfile {
    var isReadyForAlarmSelection: Bool {
        (status == nil || status == "ready") && isDraft != true
    }
}

extension FamilyVoiceProfile {
    var isReadyForAlarmSelection: Bool {
        (status == nil || status == "ready") && isShared != false
    }
}

struct SharedVoiceSelectionSetupSheet: View {
    let profile: FamilyVoiceProfile
    let isWorking: Bool
    let onCancel: () -> Void
    let onPreview: () -> Void
    let onConfirm: (String, String) -> Void

    @State private var relationshipSelection = VoiceRelationshipSelection()
    @State private var listenerTitle: String = ""
    @State private var submitted = false

    private var trimmedRelationship: String {
        relationshipSelection.resolved
    }

    private var trimmedListener: String {
        listenerTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("공유받은 목소리 설정")
                        .font(.title3.weight(.bold))
                    Text("알람에서 이 목소리가 나를 어떻게 부를지 정해요.")
                        .font(.subheadline)
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 12) {
                Image(systemName: "mic.circle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(AlarmTalkTheme.secondary)
                VStack(alignment: .leading, spacing: 3) {
                    Text(profile.name)
                        .font(.headline)
                    Text(profile.sharedFromLabel)
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
            field(
                title: "이 목소리가 나를 부를 이름",
                placeholder: "예: 지호야, 여보",
                text: $listenerTitle,
                showError: submitted && trimmedListener.isEmpty
            )
            VoiceListenerPreviewCard(
                listenerTitle: listenerTitle,
                relationshipLabel: trimmedRelationship
            )

            Button(action: onPreview) {
                Label("미리듣기", systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(isWorking)

            Button("저장하고 선택") {
                submitted = true
                if !trimmedRelationship.isEmpty && !trimmedListener.isEmpty {
                    onConfirm(trimmedRelationship, trimmedListener)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .frame(maxWidth: .infinity)
            .disabled(isWorking)

            Spacer(minLength: 0)
        }
        .padding(20)
        .onAppear {
            relationshipSelection = parseVoiceRelationshipLabel(profile.relationshipLabel)
            listenerTitle = profile.listenerTitle ?? ""
        }
    }

    private func field(
        title: String,
        placeholder: String,
        text: Binding<String>,
        showError: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AlarmTalkTheme.textSecondary)
            TextField(placeholder, text: text)
                .textFieldStyle(.roundedBorder)
                .onChange(of: text.wrappedValue) { _, newValue in
                    if newValue.count > 30 {
                        text.wrappedValue = String(newValue.prefix(30))
                    }
                }
            if showError {
                Text("꼭 입력해 주세요.")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AlarmTalkTheme.error)
            }
        }
    }
}

#if DEBUG
#Preview("AlarmEditorSheet — create (light)") {
    NavigationStack {
        AlarmEditorSheet(
            target: .create(),
            onClose: {},
            onJumpToVoices: {},
            onSchedulingDidFinish: {}
        )
    }
    .voiceAlarmPreviewEnvironment()
}

#Preview("AlarmEditorSheet — create (dark)") {
    NavigationStack {
        AlarmEditorSheet(
            target: .create(),
            onClose: {},
            onJumpToVoices: {},
            onSchedulingDidFinish: {}
        )
    }
    .preferredColorScheme(.dark)
    .voiceAlarmPreviewEnvironment()
}

#Preview("AlarmEditorSheet — edit existing") {
    NavigationStack {
        AlarmEditorSheet(
            target: .edit("preview-existing"),
            onClose: {},
            onJumpToVoices: {},
            onSchedulingDidFinish: {}
        )
    }
    .voiceAlarmPreviewEnvironment()
}
#endif
