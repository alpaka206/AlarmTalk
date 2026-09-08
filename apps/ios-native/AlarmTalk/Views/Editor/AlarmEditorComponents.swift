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

/// 알람에 붙일 오디오의 입력 방식.
///
/// ⚠ **`file` 을 되살리지 말 것** — 알람 편집기에는 파일 업로드가 없다(위 주석 참조).
/// 값이 하나뿐이지만 열거형을 남겨 두는 이유는 저장된 옛 값(`"file"`)을 읽을 때
/// 조용히 깨지지 않게 하기 위해서다.
enum AlarmLocalAudioInputMode: String, CaseIterable, Hashable, Identifiable {
    case record

    var id: String { rawValue }
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
    let onPreview: () -> Void
    let onClear: () -> Void

    private var sourceReady: Bool { hasRecording || existingAudioLabel != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // ⚠ **알람 편집기에는 파일 업로드가 없다 — 녹음뿐이다**(2026-08-11 정리).
            // 안드로이드 알람 편집기에는 처음부터 파일 선택 런처가 없고, iOS 에만
            // '녹음/파일' 세그먼트가 남아 있었다.
            //
            // ⚠ **녹음 카드를 여기서 다시 그리지 말 것** — `RecordingCard` 하나를
            // 목소리 등록 화면과 함께 쓴다(2026-08-16 정리).
            RecordingCard(
                isRecording: isRecording,
                elapsedMs: elapsedMs,
                maxDurationMs: Int(AlarmAudioLimits.maxDurationMillis),
                hasRecording: sourceReady,
                isPreviewing: isPreviewing,
                // 카드 제목이 이미 상태를 말한다 — 남기는 건 아직 아무것도 없고 녹음 중도
                // 아닐 때뿐이다(마이크 권한 거부처럼 달리 나타나지 않는 사실).
                note: (isRecording || sourceReady) ? existingNote : (message ?? existingNote),
                onRecord: onRecord,
                onPreview: onPreview,
                onRedo: onClear
            )
        }
    }

    /// 알람에 이미 붙어 있는 오디오 이름 — 방금 녹음한 것이 없을 때만 알린다.
    private var existingNote: String? {
        guard !hasRecording, let existingAudioLabel else { return nil }
        return existingAudioLabel
    }
}

// ⚠ **`FamilyAlarmTargetPicker` 를 되살리지 말 것**(2026-08-07 삭제).
// 편집기 안에서 받는 사람을 바꾸던 카드다. 안드로이드에는 그런 컨트롤이 없고, 가족 알람은
// 한 번 보내면 보낸 사람이 고칠 수 없다 — '누구에게' 는 「누구를 깨울까요?」 시트에서 한 번
// 정하는 값이지 편집 중에 오가는 값이 아니다. 자세한 이유는 `AlarmEditorSheet` 주석 참조.

// ⚠ **리드타임 판정을 여기에 다시 두지 말 것.** 2026-08-24 까지 이 타입에는 30분짜리
// `familyAlarmMinLeadMillis` 와 `isLeadTooSoon`·`targetStatusText` 가 남아 있었는데, 부르는
// 곳이 하나도 없었다. 살아 있는 가드는 `AlarmEditorSheet.familyAlarmMinLeadMillis`(5분)
// 하나이고, 값은 안드로이드 `FAMILY_ALARM_MIN_LEAD_MILLIS`·서버
// `FAMILY_ALARM_MIN_LEAD_MINUTES` 와 **같아야 한다**. 죽은 사본이 옛 값을 들고 있으면
// 그걸 고치고 고쳤다고 믿게 된다(실제로 오늘 리드타임을 내릴 때 그럴 뻔했다).
enum FamilyAlarmScheduleRules {
    static func quietScheduleLabel(_ member: FamilyGroupMember) -> String {
        quietWindows(member).map { window in
            "\(HelperFormatters.quietDaysLabel(window.days)) \(window.start)-\(window.end)"
        }.joined(separator: " · ")
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
                RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.card).stroke(AlarmTalkTheme.outline, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.card))

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
                .onChange(of: text.wrappedValue) { _, newValue in
                    let cleaned = InputSanitizer.clampDisplayName(newValue)
                    if cleaned != newValue { text.wrappedValue = cleaned }
                }
                .alarmTalkFieldStyle()
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
