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

struct FamilyAlarmTargetPicker: View {
    let recipients: [FamilyGroupMember]
    let selectedRecipientID: String?
    let hour: Int
    let minute: Int
    let repeatDaysMask: Int
    let holidayOff: Bool
    let onSelect: (String) -> Void

    @Environment(\.voiceAlarmTheme) private var theme

    private var selectedRecipient: FamilyGroupMember? {
        if let selectedRecipientID,
           let selected = recipients.first(where: { $0.userId == selectedRecipientID }) {
            return selected
        }
        return recipients.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if recipients.isEmpty {
                Text("상대가 내 알람 맞추기를 허용하면 여기에 표시돼요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
            } else {
                ForEach(recipients) { recipient in
                    recipientRow(recipient, selected: recipient.userId == selectedRecipient?.userId)
                }
                if let selectedRecipient {
                    let leadTooSoon = FamilyAlarmScheduleRules.isLeadTooSoon(
                        hour: hour,
                        minute: minute,
                        repeatDaysMask: repeatDaysMask,
                        holidayOff: holidayOff
                    )
                    let quietUnavailable = FamilyAlarmScheduleRules.isTimeUnavailable(
                        member: selectedRecipient,
                        hour: hour,
                        minute: minute,
                        repeatDaysMask: repeatDaysMask
                    )
                    targetStatus(
                        blocked: leadTooSoon || quietUnavailable,
                        text: FamilyAlarmScheduleRules.targetStatusText(
                            leadTooSoon: leadTooSoon,
                            quietUnavailable: quietUnavailable
                        )
                    )
                    Text("받지 않는 시간: \(FamilyAlarmScheduleRules.quietScheduleLabel(selectedRecipient))")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
            }
        }
    }

    private func recipientRow(_ recipient: FamilyGroupMember, selected: Bool) -> some View {
        Button {
            onSelect(recipient.userId)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: selected ? "checkmark.circle.fill" : "person.circle")
                    .font(.title3)
                    .foregroundStyle(selected ? theme.palette.primary : theme.palette.onSurfaceVariant)
                VStack(alignment: .leading, spacing: 2) {
                    Text(FamilyAlarmScheduleRules.memberLabel(recipient))
                        .font(theme.typography.labelLarge)
                        .foregroundStyle(theme.palette.onSurface)
                    if let email = recipient.email, !email.isEmpty {
                        Text(email)
                            .font(theme.typography.bodySmall)
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(selected ? theme.palette.primaryContainer.opacity(0.35) : theme.palette.surfaceVariant.opacity(0.34))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(selected ? theme.palette.primary.opacity(0.42) : theme.palette.outlineVariant.opacity(0.62), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func targetStatus(blocked: Bool, text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(blocked ? AlarmTalkTheme.error : AlarmTalkTheme.primaryDark)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                blocked ? AlarmTalkTheme.error.opacity(0.12) : AlarmTalkTheme.primary.opacity(0.12),
                in: Capsule()
            )
    }
}

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

struct ManualVoiceMessageEditor: View {
    @Binding var text: String
    @Binding var translationEnabled: Bool
    @Binding var language: String
    let onInvalidatePreparedAudio: () -> Void

    @Environment(\.voiceAlarmTheme) private var theme

    private var limitedText: Binding<String> {
        Binding(
            get: { text },
            set: { newValue in
                text = String(newValue.prefix(200))
                onInvalidatePreparedAudio()
            }
        )
    }

    private var translationToggle: Binding<Bool> {
        Binding(
            get: { translationEnabled },
            set: { enabled in
                translationEnabled = enabled
                if enabled && language == "ko" {
                    language = "en"
                } else if !enabled {
                    language = "ko"
                }
                onInvalidatePreparedAudio()
            }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("직접 입력")
                    .font(theme.typography.titleSmall)
                Spacer()
                Text("\(text.count)/200")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .monospacedDigit()
            }

            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text("알람에서 들려줄 음성 메시지를 입력해 주세요")
                        .font(theme.typography.bodyMedium)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                        // 시각적 placeholder 일 뿐이라 VoiceOver 에는 노출하지 않는다
                        // (실 입력 라벨은 아래 TextEditor 가 제공).
                        .accessibilityHidden(true)
                }
                TextEditor(text: limitedText)
                    .frame(minHeight: 86)
                    .scrollContentBackground(.hidden)
                    .background(Color.clear)
                    .accessibilityLabel(Text("알람 음성 메시지"))
                    .accessibilityValue(Text(text.isEmpty ? "비어 있음" : text))
            }
            .padding(8)
            .background(theme.palette.surfaceVariant.opacity(0.36))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(theme.palette.outlineVariant.opacity(0.62), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 8) {
                Toggle("번역", isOn: translationToggle)
                    .tint(theme.palette.primary)
                if translationEnabled {
                    Picker("번역 언어", selection: Binding(
                        get: { language },
                        set: { newValue in
                            language = newValue
                            onInvalidatePreparedAudio()
                        }
                    )) {
                        ForEach(ttsTranslationLanguages) { option in
                            Text(option.label).tag(option.code)
                        }
                    }
                    .pickerStyle(.menu)
                } else {
                    Text("사용 안 함")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
            }
            .padding(12)
            .background(theme.palette.surfaceVariant.opacity(0.34))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

struct VoiceRepeatEditor: View {
    @Binding var repeatVoice: Bool
    @Environment(\.voiceAlarmTheme) private var theme

    init(isRepeating repeatVoice: Binding<Bool>) {
        self._repeatVoice = repeatVoice
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("반복 재생")
                .font(theme.typography.titleSmall)
            HStack(spacing: 8) {
                repeatButton("한 번만", selected: !repeatVoice) {
                    repeatVoice = false
                }
                repeatButton("반복", selected: repeatVoice) {
                    repeatVoice = true
                }
            }
        }
    }

    private func repeatButton(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(theme.typography.labelLarge)
                .fontWeight(.semibold)
                .foregroundStyle(selected ? theme.palette.onPrimaryContainer : theme.palette.onSurface)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(selected ? theme.palette.primaryContainer : theme.palette.surfaceVariant.opacity(0.44))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct VoiceVolumeEditor: View {
    @Binding var volumePercent: Int
    @Environment(\.voiceAlarmTheme) private var theme

    private var volumeBinding: Binding<Double> {
        Binding(
            get: { Double(max(30, min(100, volumePercent))) },
            set: { volumePercent = max(30, min(100, Int($0.rounded()))) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("목소리 크기")
                    .font(theme.typography.titleSmall)
                Spacer()
                Text("\(max(30, min(100, volumePercent)))%")
                    .font(theme.typography.labelLarge)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .monospacedDigit()
            }
            Slider(value: volumeBinding, in: 30...100, step: 10)
                .tint(theme.palette.primary)
        }
    }
}

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

struct AlarmVoiceProfilePicker: View {
    let ownProfiles: [VoiceProfile]
    let familyVoices: [FamilyVoiceProfile]
    let selectedProfileID: String?
    /// 온보딩/목소리 탭에서 고른 기본(시스템) 목소리. 시스템 음성은 이 1개만 목록에 노출한다.
    var defaultVoiceId: String?
    /// 프로필 목록을 비동기로 불러오는 중인지. 초기 fetch 동안에는 ownProfiles /
    /// familyVoices 가 잠깐 비어 있어, loading 을 무시하면 '삭제된 목소리' 경고가
    /// 잘못 깜빡인다. Android `VoiceAudioCard.kt` 의 `!voiceProfileBusy` 게이트 미러.
    let loading: Bool
    let onSelectOwn: (VoiceProfile) -> Void
    let onSelectShared: (FamilyVoiceProfile) -> Void

    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        // 알람창에선 기본(시스템) 목소리를 못 바꾼다(변경은 목소리 탭). 기본 목소리와
        // 기존 알람의 저장된 시스템 목소리만 남겨, 편집 중 조용한 목소리 변경을 막는다.
        let hasDefaultSystemVoice = defaultVoiceId != nil &&
            ownProfiles.contains { $0.id == defaultVoiceId && isSystemVoice($0) }
        let readyOwnProfiles = ownProfiles
            .filter(\.isReadyForAlarmSelection)
            .filter {
                !isSystemVoice($0) ||
                    !hasDefaultSystemVoice ||
                    $0.id == defaultVoiceId ||
                    $0.id == selectedProfileID
            }
        let readyFamilyVoices = familyVoices.filter(\.isReadyForAlarmSelection)
        // 저장된 voiceProfileId 가 더 이상 선택 가능한 목소리로 해석되지 않으면
        // 조용히 다른 목소리로 바꾸지 않고 빨간 경고만 띄운다. 선택값은 그대로 두어
        // 저장된 알람은 계속 울리되, 문구를 바꾸려면 사용자가 직접 다시 고르게 한다
        // (Android `VoiceAudioCard.kt` selectedProfileUnavailable 미러).
        // 단, 로딩 중에는 프로필 배열이 잠깐 비어 false-positive 가 나므로 제외한다.
        let selectedProfileUnavailable: Bool = {
            guard !loading else { return false }
            guard let selectedID = selectedProfileID, !selectedID.isEmpty else { return false }
            let resolves = readyOwnProfiles.contains { $0.id == selectedID }
                || readyFamilyVoices.contains { $0.id == selectedID }
            return !resolves
        }()
        VStack(alignment: .leading, spacing: 8) {
            if readyOwnProfiles.isEmpty && readyFamilyVoices.isEmpty {
                Text("사용할 수 있는 목소리가 없어요. 먼저 목소리를 만들어 주세요.")
                    .font(theme.typography.bodySmall)
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(theme.palette.surfaceVariant.opacity(0.44))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            } else {
                ForEach(readyOwnProfiles) { profile in
                    voiceRow(
                        name: profile.name,
                        detail: profile.isShared == true ? "내 목소리 · 공유 중" : "내 목소리",
                        selected: profile.id == selectedProfileID,
                        badge: nil,
                        action: { onSelectOwn(profile) }
                    )
                }
                ForEach(readyFamilyVoices) { profile in
                    voiceRow(
                        name: profile.name,
                        detail: profile.sharedFromLabel,
                        selected: profile.id == selectedProfileID,
                        badge: nil,
                        action: { onSelectShared(profile) }
                    )
                }
            }
            if selectedProfileUnavailable {
                selectedProfileUnavailableCallout
            }
        }
    }

    private var selectedProfileUnavailableCallout: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("삭제된 목소리")
                .font(theme.typography.labelLarge)
                .foregroundStyle(theme.palette.onErrorContainer)
            Text("이 알람에 저장된 목소리는 그대로 울리지만, 문구를 바꾸려면 다른 목소리를 선택해 주세요.")
                .font(theme.typography.bodySmall)
                .foregroundStyle(theme.palette.onErrorContainer.opacity(0.78))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(theme.palette.errorContainer.opacity(0.58))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func voiceRow(
        name: String,
        detail: String,
        selected: Bool,
        badge: String?,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: selected ? "checkmark.circle.fill" : "mic.circle")
                    .font(.title3)
                    .foregroundStyle(selected ? theme.palette.primary : theme.palette.onSurfaceVariant)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(theme.typography.labelLarge)
                        .foregroundStyle(theme.palette.onSurface)
                    Text(detail)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                Spacer(minLength: 0)
                if let badge {
                    Text(badge)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(theme.palette.primary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(theme.palette.primaryContainer.opacity(0.55))
                        .clipShape(Capsule())
                }
            }
            .padding(12)
            .background(selected ? theme.palette.primaryContainer.opacity(0.35) : theme.palette.surfaceVariant.opacity(0.34))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(selected ? theme.palette.primary.opacity(0.42) : theme.palette.outlineVariant.opacity(0.62), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
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
