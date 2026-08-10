import SwiftUI

/// 가족 알람 "설정 불가 시간" 편집 모달.
///
/// Android `FamilyAlarmQuietTimeDialog` (`ui/settings/SettingsScreenComponents.kt`) 의 SwiftUI
/// 포팅. 시간대 목록(최대 8개)을 관리하며, 각 시간대마다 요일 선택과 시작/종료
/// 시각을 편집한다. 저장 시 `[FamilyAlarmQuietWindow]` 를 콜백으로 돌려준다.
///
/// 요일 인덱스 컨벤션: Android 와 동일하게 0=일요일, 1=월요일 ... 6=토요일.
/// 시간 문자열은 "HH:mm" 두 자리.
struct FamilyAlarmQuietTimeDialog: View {
    let initialWindows: [FamilyAlarmQuietWindow]
    let onCancel: () -> Void
    let onConfirm: ([FamilyAlarmQuietWindow]) -> Void

    /// 편집 중인 시간대 목록. 한 행이 빠지지 않도록 최소 1행을 유지.
    @State private var drafts: [QuietWindowDraft] = []
    @State private var pickerTarget: QuietTimePickerTarget?

    /// ⚠ **서버 상한과 같아야 한다.** 백엔드 `family-alarm-settings.ts` 의
    /// `MAX_QUIET_WINDOWS = 2` 를 넘기면 `PATCH /user/me` 가 400 으로 통째로 거절한다.
    /// iOS 는 8 로 두고 있었다 — 3개째부터 저장이 **말없이 실패**했다(2026-08-07 수정).
    private static let maxWindows = 2

    /// 요일은 **프리셋 3택**이다(평일 / 주말 / 매일).
    ///
    /// ⚠ **개별 요일 토글로 되돌리지 말 것.** 서버 `coerceToPresetDays` 가 어떤 조합이든
    /// 이 셋 중 하나로 **말없이 확장**하므로, 개별로 고르게 하면 고른 것과 저장된 것이
    /// 달라진다(예: 월·수만 골라도 평일 전체로 저장된다). 안드로이드는 처음부터
    /// `QUIET_DAY_PRESETS` 3택이다.
    static let dayPresets: [(label: String, days: Set<Int>)] = [
        ("평일", [1, 2, 3, 4, 5]),
        ("주말", [0, 6]),
        ("매일", [0, 1, 2, 3, 4, 5, 6]),
    ]

    private var isValid: Bool {
        !drafts.isEmpty && drafts.allSatisfy { $0.isValid }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(drafts.enumerated()), id: \.offset) { index, draft in
                        QuietWindowCard(
                            index: index,
                            draft: draft,
                            removable: drafts.count > 1,
                            onSelectDays: { days in selectDayPreset(index: index, days: days) },
                            onPickStart: {
                                pickerTarget = QuietTimePickerTarget(index: index, isStart: true)
                            },
                            onPickEnd: {
                                pickerTarget = QuietTimePickerTarget(index: index, isStart: false)
                            },
                            onRemove: {
                                drafts.remove(at: index)
                            }
                        )
                    }
                    Button {
                        if drafts.count < Self.maxWindows {
                            drafts.append(QuietWindowDraft.defaultEvening)
                        }
                    } label: {
                        Text("+ 시간 추가")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(drafts.count >= Self.maxWindows)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
            }
            footer
        }
        .background(AlarmTalkTheme.background)
        .onAppear {
            // initialWindows 가 비어 있어도 최소 한 행을 채워 사용자가 입력을 시작할 수 있게 한다.
            // Android `FamilyAlarmQuietWindow()` 기본값(평일 09:00~18:30)과 동일하게 시드한다.
            let seeds = initialWindows.isEmpty
                ? [FamilyAlarmQuietWindow(days: [1, 2, 3, 4, 5], start: "09:00", end: "18:30")]
                : initialWindows
            drafts = seeds.map(QuietWindowDraft.init(window:))
        }
        .sheet(item: $pickerTarget) { target in
            QuietTimePicker(
                title: target.isStart ? "시작 시간" : "종료 시간",
                initialHour: hour(forTarget: target),
                initialMinute: minute(forTarget: target),
                onCancel: { pickerTarget = nil },
                onConfirm: { hh, mm in
                    apply(hour: hh, minute: mm, target: target)
                    pickerTarget = nil
                }
            )
            .presentationDetents([.medium])
        }
    }

    // MARK: - Subviews

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("설정 불가 시간")
                    .font(.title3.weight(.bold))
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                .buttonStyle(.plain)
            }
            Text("선택한 시간대에는 다른 사람이 내게 알람을 만들 수 없어요.")
                .font(.footnote)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
        }
        .padding(20)
    }

    private var footer: some View {
        // ⚠ **[취소]를 다시 넣지 말 것 — 헤더 X 와 같은 일이다.**
        // CLAUDE.md 「닫기(X)를 버튼과 같이 두지 말 것」. 안드로이드 대응 화면
        // (`ui/settings/SettingsScreenComponents.kt` 의 설정 불가 시간 다이얼로그)도
        // `ModalDialogTitle` 의 X + [저장] **둘뿐**이고 취소가 없다.
        HStack(spacing: 10) {
            Button("저장") {
                onConfirm(drafts.map { $0.toWindow() })
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .frame(maxWidth: .infinity)
            .disabled(!isValid)
        }
        .padding(20)
        .background(AlarmTalkTheme.surface)
        .overlay(
            Rectangle()
                .fill(AlarmTalkTheme.outline.opacity(0.5))
                .frame(height: 1),
            alignment: .top
        )
    }

    // MARK: - Edits

    /// 프리셋 집합을 **통째로 대입**한다. 개별 요일을 켜고 끄지 않는다(위 주석 참조).
    private func selectDayPreset(index: Int, days: Set<Int>) {
        guard drafts.indices.contains(index) else { return }
        var draft = drafts[index]
        draft.days = days
        drafts[index] = draft
    }

    private func hour(forTarget target: QuietTimePickerTarget) -> Int {
        guard drafts.indices.contains(target.index) else { return 9 }
        let draft = drafts[target.index]
        return target.isStart ? draft.startHour : draft.endHour
    }

    private func minute(forTarget target: QuietTimePickerTarget) -> Int {
        guard drafts.indices.contains(target.index) else { return 0 }
        let draft = drafts[target.index]
        return target.isStart ? draft.startMinute : draft.endMinute
    }

    private func apply(hour: Int, minute: Int, target: QuietTimePickerTarget) {
        guard drafts.indices.contains(target.index) else { return }
        var draft = drafts[target.index]
        if target.isStart {
            draft.startHour = hour
            draft.startMinute = minute
        } else {
            draft.endHour = hour
            draft.endMinute = minute
        }
        drafts[target.index] = draft
    }
}

// MARK: - Draft model

private struct QuietWindowDraft: Equatable {
    var days: Set<Int>           // 0..6
    var startHour: Int           // 0..23
    var startMinute: Int         // 0..59
    var endHour: Int             // 0..23
    var endMinute: Int           // 0..59

    static let defaultEvening = QuietWindowDraft(
        days: [1, 2, 3, 4, 5],
        startHour: 22,
        startMinute: 0,
        endHour: 7,
        endMinute: 0
    )

    init(days: Set<Int>, startHour: Int, startMinute: Int, endHour: Int, endMinute: Int) {
        self.days = days
        self.startHour = startHour
        self.startMinute = startMinute
        self.endHour = endHour
        self.endMinute = endMinute
    }

    init(window: FamilyAlarmQuietWindow) {
        let cleanedDays = window.days.filter { (0...6).contains($0) }
        days = Set(cleanedDays.isEmpty ? [1, 2, 3, 4, 5] : cleanedDays)
        let start = QuietWindowDraft.parse(window.start, fallbackHour: 9, fallbackMinute: 0)
        let end = QuietWindowDraft.parse(window.end, fallbackHour: 18, fallbackMinute: 30)
        startHour = start.hour
        startMinute = start.minute
        endHour = end.hour
        endMinute = end.minute
    }

    var isValid: Bool {
        !days.isEmpty &&
            (0...23).contains(startHour) &&
            (0...59).contains(startMinute) &&
            (0...23).contains(endHour) &&
            (0...59).contains(endMinute)
    }

    func toWindow() -> FamilyAlarmQuietWindow {
        FamilyAlarmQuietWindow(
            days: days.sorted(),
            start: QuietWindowDraft.timeString(hour: startHour, minute: startMinute),
            end: QuietWindowDraft.timeString(hour: endHour, minute: endMinute)
        )
    }

    private static func parse(_ raw: String, fallbackHour: Int, fallbackMinute: Int) -> (hour: Int, minute: Int) {
        let parts = raw.split(separator: ":")
        let h = parts.first.flatMap { Int($0) } ?? fallbackHour
        let m = parts.dropFirst().first.flatMap { Int($0) } ?? fallbackMinute
        return (max(0, min(23, h)), max(0, min(59, m)))
    }

    private static func timeString(hour: Int, minute: Int) -> String {
        String(format: "%02d:%02d", max(0, min(23, hour)), max(0, min(59, minute)))
    }
}

// MARK: - Picker target

private struct QuietTimePickerTarget: Identifiable {
    let index: Int
    let isStart: Bool
    var id: String { "\(index)-\(isStart)" }
}

// MARK: - Card

private struct QuietWindowCard: View {
    let index: Int
    let draft: QuietWindowDraft
    let removable: Bool
    let onSelectDays: (Set<Int>) -> Void
    let onPickStart: () -> Void
    let onPickEnd: () -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("시간대 \(index + 1)")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if removable {
                    Button(role: .destructive, action: onRemove) {
                        Image(systemName: "trash")
                            .foregroundStyle(AlarmTalkTheme.error)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("이 시간대 삭제")
                }
            }
            HStack(spacing: 6) {
                ForEach(FamilyAlarmQuietTimeDialog.dayPresets, id: \.label) { preset in
                    let selected = draft.days == preset.days
                    Button {
                        onSelectDays(preset.days)
                    } label: {
                        Text(preset.label)
                            .font(.footnote.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 36)
                            .background(
                                selected ? AlarmTalkTheme.primary : AlarmTalkTheme.surfaceVariant,
                                in: Capsule()
                            )
                            .foregroundStyle(selected ? Color.white : AlarmTalkTheme.text)
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack(spacing: 8) {
                timeChip(label: timeLabel(hour: draft.startHour, minute: draft.startMinute), action: onPickStart)
                Text("~")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
                timeChip(label: timeLabel(hour: draft.endHour, minute: draft.endMinute), action: onPickEnd)
            }
        }
        .padding(14)
        .background(AlarmTalkTheme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.small).stroke(AlarmTalkTheme.outline, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.small))
    }

    private func timeChip(label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.title3.weight(.bold))
                .foregroundStyle(AlarmTalkTheme.primary)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(AlarmTalkTheme.primary.opacity(0.15), in: RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.small))
                .overlay(
                    RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.small)
                        .stroke(AlarmTalkTheme.primary.opacity(0.5), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func timeLabel(hour: Int, minute: Int) -> String {
        String(format: "%d:%02d", hour, minute)
    }
}

// MARK: - Time picker

/// 단순 시:분 픽커. SwiftUI `DatePicker(.wheel)` 의 hour/minute 만 사용.
private struct QuietTimePicker: View {
    let title: LocalizedStringKey
    let initialHour: Int
    let initialMinute: Int
    let onCancel: () -> Void
    let onConfirm: (Int, Int) -> Void

    @State private var selection: Date = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(title)
                    .font(.title3.weight(.bold))
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .foregroundStyle(AlarmTalkTheme.textSecondary)
                }
                .buttonStyle(.plain)
            }
            DatePicker(
                "",
                selection: $selection,
                displayedComponents: [.hourAndMinute]
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .frame(maxWidth: .infinity)
            // 취소는 위 X 하나로 낸다(같은 이유 — `footer` 주석 참조).
            HStack(spacing: 10) {
                Button("확인") {
                    let cal = Calendar(identifier: .gregorian)
                    let parts = cal.dateComponents([.hour, .minute], from: selection)
                    onConfirm(parts.hour ?? 0, parts.minute ?? 0)
                }
                .buttonStyle(.borderedProminent)
                .tint(AlarmTalkTheme.primary)
                .frame(maxWidth: .infinity)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .onAppear {
            var comps = DateComponents()
            comps.hour = initialHour
            comps.minute = initialMinute
            selection = Calendar(identifier: .gregorian).date(from: comps) ?? Date()
        }
    }
}

#if DEBUG
#Preview("FamilyAlarmQuietTimeDialog") {
    FamilyAlarmQuietTimeDialog(
        initialWindows: [
            FamilyAlarmQuietWindow(days: [1, 2, 3, 4, 5], start: "22:00", end: "07:00"),
            FamilyAlarmQuietWindow(days: [0, 6], start: "00:00", end: "10:00"),
        ],
        onCancel: {},
        onConfirm: { _ in }
    )
}
#endif
